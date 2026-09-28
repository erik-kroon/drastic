import * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/workspace";
import { expect, test } from "vitest";
import {
  decoded,
  database,
  evidence,
  execute,
  fixture,
  journal,
  post,
  request,
} from "./support/fixtures";

// NEXT-50. An agent asks for its book context for one stated goal: per-domain
// module summaries, retained unresolved work ranked by goal prevention, and
// this build's exposed capability catalog.
//
// Every expectation below is derived from the retained postings the test
// itself made, never from the context compiler. The counterfactual that
// matters is stated per case: if the index ever invented work, hid retained
// work, or ranked a ghost above a real item, these cases fail.

async function setup() {
  const book = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.fiscal_years(book_id, id, starts_on, ends_on) VALUES ($1, 'fy_2025', '2025-01-01', '2025-12-31'), ($1, 'fy_2030', '2030-01-01', '2030-12-31')",
      [book.bookId],
    );
    await admin.query(
      "INSERT INTO openerp.periods(book_id, id, fiscal_year_id, starts_on, ends_on) VALUES ($1, 'period_2025', 'fy_2025', '2025-01-01', '2025-12-31'), ($1, 'period_2030', 'fy_2030', '2030-01-01', '2030-12-31')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const source = await evidence(book);

  return { book, source };
}

// One prepared journal that nothing has approved or executed. Its identity and
// digest below come from this response, not from the context compiler.
async function unposted(
  book: Awaited<ReturnType<typeof setup>>["book"],
  evidenceId: string,
  period: string,
  dated: string,
) {
  const input = journal(evidenceId, "12500");

  return post(
    book,
    "/change-sets",
    { ...input, postingDate: dated, accountingPeriodId: period },
    Accounting.ChangeSet,
  );
}

const goal = { goal: "close_the_year", period: null };

test("NEXT-50 reports an honest empty index for a book with nothing retained", async () => {
  const { book } = await setup();

  const view = await post(book, "/workspace/context", goal, Workspace.BookContextView);

  expect(view.snapshot.bookId).toBe(book.bookId);
  expect(view.snapshot.goal).toBe(goal.goal);
  expect(view.snapshot.work).toEqual([]);
  expect(view.ranked.orderedIdentities).toEqual([]);
  expect(view.snapshot.allowedCapabilities).toContain("workspace_list_work");

  // An empty inventory is claimable, and every reported module is known
  // non-empty-or-empty explicitly. Coverage is never unknown here.
  for (const module of view.snapshot.modules) {
    expect(module.coverageKnown).toBe(true);
  }
});

test("NEXT-50 indexes an unposted proposal with its retained identity and digest", async () => {
  const { book, source } = await setup();
  const plan = await unposted(book, source.id, "period_2030", "2030-06-30");

  const view = await post(book, "/workspace/context", goal, Workspace.BookContextView);

  expect(view.snapshot.work).toHaveLength(1);

  const item = view.snapshot.work[0];

  expect(item?.identity).toBe(plan.id);
  expect(item?.digest).toBe(plan.planDigest);
  expect(item?.owner).toBe("change_sets");
  expect(item?.kind).toBe("unposted_change_set");
  expect(item?.blockedOperation).toBe("changes_execute");
  expect(item?.missingInputs).toEqual(["approval", "execution"]);
  expect(item?.nextPermittedPreparation).toBe("approve_change_set");

  // The 2030 period has not ended, so this waits its turn rather than blocking
  // the goal.
  expect(item?.severity).toBe("material");

  const changeSets = view.snapshot.modules.find((module) => module.owner === "journal");

  expect(changeSets?.rowCount).toBe("1");

  // It is ranked first because it is the only work there is.
  expect(view.ranked.orderedIdentities).toEqual([plan.id]);
});

test("NEXT-50 ranks an unposted item in an ended period above one that can still post", async () => {
  const { book, source } = await setup();
  const open = await unposted(book, source.id, "period_2030", "2030-06-30");
  const closed = await unposted(book, source.id, "period_2025", "2025-06-30");

  const view = await post(book, "/workspace/context", goal, Workspace.BookContextView);

  const byId = new Map(view.snapshot.work.map((entry) => [entry.identity, entry]));

  expect(byId.get(closed.id)?.severity).toBe("blocks_goal");
  expect(byId.get(open.id)?.severity).toBe("material");

  // Goal prevention orders before materiality, from retained period ends and
  // the database clock rather than from any caller assertion.
  expect(view.ranked.orderedIdentities[0]).toBe(closed.id);
  expect(view.ranked.orderedIdentities).toContain(open.id);
});

test("NEXT-50 drops executed work from the index instead of reporting stale rows", async () => {
  const { book, source } = await setup();
  const plan = await unposted(book, source.id, "period_2030", "2030-06-30");

  await execute(book, plan);

  const view = await post(book, "/workspace/context", goal, Workspace.BookContextView);

  expect(view.snapshot.work.map((entry) => entry.identity)).not.toContain(plan.id);
  expect(view.ranked.orderedIdentities).not.toContain(plan.id);

  // The module still reports what it covers: one retained row, zero open.
  const changeSets = view.snapshot.modules.find((module) => module.owner === "journal");

  expect(changeSets?.rowCount).toBe("0");
  expect(changeSets?.fullCount).toBe("1");
  expect(changeSets?.coverageKnown).toBe(true);
});

test("NEXT-50 rereading the same book gives the same ranked identities", async () => {
  const { book, source } = await setup();

  await unposted(book, source.id, "period_2030", "2030-06-30");

  const first = await post(book, "/workspace/context", goal, Workspace.BookContextView);

  const second = await decoded(
    await request(book, "/workspace/context", {
      method: "POST",
      body: JSON.stringify(goal),
    }),
    Workspace.BookContextView,
  );

  expect(second.ranked.orderedIdentities).toEqual(first.ranked.orderedIdentities);
  expect(second.snapshot.principalScopeFingerprint).toBe(first.snapshot.principalScopeFingerprint);
  expect(second.snapshot.work.map((entry) => entry.identity)).toEqual(
    first.snapshot.work.map((entry) => entry.identity),
  );
});
