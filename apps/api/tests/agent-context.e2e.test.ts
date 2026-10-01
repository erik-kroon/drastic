import * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/workspace";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Expenses from "@open-erp/contracts/expense-tax";
import * as Schema from "effect/Schema";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  createSession,
  environment,
  key,
  decoded,
  database,
  evidence,
  execute,
  fixture,
  journal,
  post,
  request,
} from "./support/fixtures";

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

  expect(item?.severity).toBe("material");

  const changeSets = view.snapshot.modules.find((module) => module.owner === "journal");

  expect(changeSets?.rowCount).toBe("1");

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

type Book = Awaited<ReturnType<typeof fixture>>;

type Exchange = { input: typeof Workspace.AgentContextQuery.Type; status: number; body: string };

async function admissionFixture() {
  const base = await fixture();
  const book = { ...base, token: (await createSession(base)).token };
  const source = await evidence(book);
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.fiscal_years(book_id,id,starts_on,ends_on) VALUES($1,'fy_2027','2027-01-01','2027-12-31')",
      [book.bookId],
    );
    await admin.query(
      "INSERT INTO openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) VALUES($1,'period_2027','fy_2027','2027-01-01','2027-12-31')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  return { book, source };
}

async function invoice(local: Awaited<ReturnType<typeof admissionFixture>>, date: string | null) {
  const customer = await post(
    local.book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "customer",
      displayName: "Private synthetic context customer",
      evidenceId: local.source.id,
      reason: "Context fixture",
    },
    Commerce.CounterpartyRevision,
  );

  const identity = {
    legalName: "Private synthetic identity",
    registrationId: null,
    taxId: null,
    address: null,
    countryCode: "SE",
    evidenceId: local.source.id,
  };

  return post(
    local.book,
    "/commerce/invoice-drafts",
    {
      draftKey: `context_${key()}`,
      content: {
        title: "Private synthetic invoice",
        counterpartyId: customer.id,
        counterpartyRevision: customer.revision,
        seller: identity,
        customer: identity,
        currency: "SEK",
        currencyScale: 2,
        plannedIssueDate: date,
        supplyDate: date,
        dueDate: date,
        paymentTerms: null,
        sourceTotalMinor: "12500",
        lines: [
          {
            id: "line_1",
            description: "Synthetic",
            quantity: "1",
            unitPriceMinor: "10000",
            baseMinor: "10000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "2500",
            taxDescription: "Synthetic",
            taxEvidenceId: local.source.id,
            sourceGrossMinor: "12500",
          },
        ],
      },
    },
    Drafts.InvoiceDraftRevision,
  );
}

async function expense(local: Awaited<ReturnType<typeof admissionFixture>>, date: string | null) {
  const sourceKey = `context_${key()}`;

  return post(
    local.book,
    "/expense-tax/sources",
    {
      sourceKey,
      expectedSourceDigest: null,
      facts: {
        evidenceId: local.source.id,
        sourceLocator: `Private synthetic locator ${sourceKey}`,
        description: "Private synthetic expense",
        recordClass: "synthetic",
        amounts: { grossMinor: "12500", netMinor: "10000", vatMinor: "2500" },
        currency: "SEK",
        currencyScale: 2,
        supplierJurisdiction: "SE",
        supplyJurisdiction: "SE",
        issuedOn: date,
        receivedOn: date,
        suppliedOn: date,
        taxPointOn: date,
        changeSetId: null,
        voucherId: null,
      },
    },
    Expenses.TaxSourceRevision,
  );
}

async function context(book: Book, period: string | null): Promise<Exchange> {
  const input = { goal: "close_the_year" as const, period };

  const response = await request(book, "/workspace/context", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return { input, status: response.status, body: await response.text() };
}

function view(exchange: Exchange) {
  expect(exchange.status, exchange.body).toBe(200);

  return Schema.decodeSync(Schema.fromJsonString(Workspace.BookContextView))(exchange.body);
}

async function attention(book: Book, period: string | null) {
  return decoded(
    await request(book, `/attention?status=all&sort=oldest${period ? `&period=${period}` : ""}`),
    Workspace.AttentionPage,
  );
}

async function financialState(book: Book) {
  const admin = await database();
  const state: Record<string, ReadonlyArray<{ body: string }>> = {};

  try {
    for (const table of [
      "vouchers",
      "journal_lines",
      "execution_receipts",
      "approvals",
      "outbox",
      "series_counters",
    ]) {
      state[table] = (
        await admin.query<{ body: string }>(
          `SELECT to_jsonb(t)::text AS body FROM openerp.${table} t WHERE book_id=$1 ORDER BY to_jsonb(t)::text`,
          [book.bookId],
        )
      ).rows;
    }

    return state;
  } finally {
    await admin.end();
  }
}

async function retainCase(name: string, value: object) {
  await writeFile(
    join(environment().artifacts, `context-admission-${name}.json`),
    JSON.stringify(value, null, 2),
    { mode: 0o600 },
  );
}

function assertReferences(
  exchange: Exchange,
  expected: ReadonlyArray<{
    id: string;
    owner: string;
    revision: string;
    digest: string;
    period?: string | null;
  }>,
) {
  const result = view(exchange);

  expect(result.snapshot.work.map((row) => row.identity).sort()).toEqual(
    expected.map((row) => row.id).sort(),
  );
  expect([...result.ranked.orderedIdentities].sort()).toEqual(expected.map((row) => row.id).sort());

  for (const row of expected) {
    expect(result.snapshot.work.find((ref) => ref.identity === row.id)).toMatchObject({
      owner: row.owner,
      revision: row.revision,
      digest: row.digest,
      affectedPeriod: row.period ?? null,
    });
  }

  return result;
}

test("context admission preserves owner ordinals1/2, same-row digests and selected2026/2027 journals", async () => {
  const local = await admissionFixture();

  const i26 = await invoice(local, "2026-03-15"),
    i27 = await invoice(local, "2027-03-15");

  const e26 = await expense(local, "2026-04-15"),
    e27 = await expense(local, "2027-04-15");

  const plan = await unposted(local.book, local.source.id, "period_2026", "2026-06-30");

  const ordinary26 = await attention(local.book, "period_2026"),
    ordinary27 = await attention(local.book, "period_2027");

  const before = await financialState(local.book);

  const initial26 = await context(local.book, "period_2026"),
    initial27 = await context(local.book, "period_2027");

  const revisedInvoice = await post(
    local.book,
    `/commerce/invoice-drafts/${i26.id}/revisions`,
    {
      expectedRevision: "1",
      expectedDigest: i26.digest,
      reason: "Synthetic ordinal2",
      content: { ...i26.content, title: "Private synthetic invoice revision2" },
    },
    Drafts.InvoiceDraftRevision,
  );

  const revisionResponse = await request(local.book, "/expense-tax/sources", {
    method: "POST",
    body: JSON.stringify({
      sourceKey: e26.sourceKey,
      expectedSourceDigest: e26.digest,
      facts: { ...e26.facts, description: "Private synthetic expense revision2" },
    }),
  });

  await retainCase("ordinals-owner-prerequisite", {
    owners: { i26, i27, e26, e27, plan, revisedInvoice },
    ordinary26,
    ordinary27,
    exchanges: { initial26, initial27 },
    expenseRevision: {
      status: revisionResponse.status,
      body: await revisionResponse.clone().text(),
    },
    before,
    after: await financialState(local.book),
  });
  const revisedExpense = await decoded(revisionResponse, Expenses.TaxSourceRevision);

  const revised26 = await context(local.book, "period_2026"),
    all = await context(local.book, null);

  const revisedOrdinary = await attention(local.book, "period_2026");
  const after = await financialState(local.book);

  const journalRef = {
    id: plan.id,
    owner: "change_sets",
    revision: "1",
    digest: plan.planDigest,
    period: "period_2026",
  };

  const initialRefs = [
    { id: i26.id, owner: "invoice", revision: "1", digest: i26.digest },
    { id: e26.sourceId, owner: "expense", revision: "1", digest: e26.digest },
    journalRef,
  ];

  const nextRefs = [
    { id: revisedInvoice.id, owner: "invoice", revision: "2", digest: revisedInvoice.digest },
    { id: revisedExpense.sourceId, owner: "expense", revision: "2", digest: revisedExpense.digest },
    journalRef,
  ];

  const otherRefs = [
    { id: i27.id, owner: "invoice", revision: "1", digest: i27.digest },
    { id: e27.sourceId, owner: "expense", revision: "1", digest: e27.digest },
  ];

  await retainCase("ordinals", {
    periods: ["2026-01-01/2026-12-31", "2027-01-01/2027-12-31"],
    owners: { i26, i27, e26, e27, revisedInvoice, revisedExpense, plan },
    expected: { initialRefs, nextRefs, otherRefs },
    exchanges: { initial26, initial27, revised26, all },
    ordinary26,
    ordinary27,
    revisedOrdinary,
    before,
    after,
  });
  expect(after).toEqual(before);
  expect([i26.revision, i27.revision, e26.revision, e27.revision].map(String)).toEqual([
    "1",
    "1",
    "1",
    "1",
  ]);
  expect([revisedInvoice.revision, revisedExpense.revision].map(String)).toEqual(["2", "2"]);
  expect(revisedInvoice.id).toBe(i26.id);
  expect(revisedExpense.sourceId).toBe(e26.sourceId);
  expect(revisedInvoice.digest).not.toBe(i26.digest);
  expect(revisedExpense.digest).not.toBe(e26.digest);
  expect(ordinary26.items.map((row) => row.id).sort()).toEqual(
    initialRefs.map((row) => row.id).sort(),
  );
  expect(ordinary27.items.map((row) => row.id).sort()).toEqual(
    otherRefs.map((row) => row.id).sort(),
  );

  for (const row of revisedOrdinary.items) {
    expect(row.revision).toBe(nextRefs.find((ref) => ref.id === row.id)?.digest);
    expect(row).not.toHaveProperty("sourceRevision");
    expect(row).not.toHaveProperty("ownerVersion");
    expect(row).not.toHaveProperty("ownerDigest");
  }

  const selected = assertReferences(initial26, initialRefs);
  expect(selected.snapshot.modules.find((row) => row.owner === "invoice")?.fullCount).toBe("1");
  expect(selected.snapshot.modules.find((row) => row.owner === "expense")?.fullCount).toBe("1");
  assertReferences(initial27, otherRefs);
  assertReferences(revised26, nextRefs);
  assertReferences(all, [...nextRefs, ...otherRefs]);
});

test("context admission uses inclusive retained bounds and excludes undated/foreign/missing periods", async () => {
  const local = await admissionFixture(),
    foreign = await setup();

  const dates = ["2026-01-01", "2026-12-31", "2025-12-31", "2027-01-01"];
  const sources = [];

  for (const date of dates) sources.push(await expense(local, date));
  const undated = await invoice(local, null);
  const before = await financialState(local.book);

  const selected = await context(local.book, "period_2026"),
    all = await context(local.book, null);

  const missing = await context(local.book, "period_missing"),
    other = await context(local.book, "period_2030");

  const ordinary = await attention(local.book, "period_2026");
  const after = await financialState(local.book);

  const expected = sources.map((source) => ({
    id: source.sourceId,
    owner: "expense",
    revision: "1",
    digest: source.digest,
  }));

  await retainCase("bounds", {
    foreignScope: { bookId: foreign.book.bookId, period: "period_2030" },
    dates,
    undated,
    sources,
    expected,
    exchanges: { selected, all, missing, other },
    ordinary,
    before,
    after,
  });
  expect(after).toEqual(before);
  expect(ordinary.items.map((row) => row.id).sort()).toEqual(
    expected
      .slice(0, 2)
      .map((row) => row.id)
      .sort(),
  );

  for (const refused of [missing, other]) {
    expect(refused.status, refused.body).toBe(404);
    expect(JSON.parse(refused.body)).toMatchObject({ code: "NotFound" });
    expect(refused.body).not.toContain(undated.id);
  }

  assertReferences(selected, expected.slice(0, 2));
  assertReferences(all, [
    ...expected,
    { id: undated.id, owner: "invoice", revision: "1", digest: undated.digest },
  ]);
});

test("context admission returns empty selected inventory and ignores51 out-of-period reviews", async () => {
  const local = await admissionFixture();
  const outside = [];

  for (let index = 0; index < 51; index++) outside.push(await expense(local, "2027-05-15"));
  const empty = await context(local.book, "period_2026");
  const selected = await expense(local, "2026-06-15");
  const before = await financialState(local.book);
  const small = await context(local.book, "period_2026");
  const ordinary = await attention(local.book, "period_2026");
  const after = await financialState(local.book);

  const expected = [
    { id: selected.sourceId, owner: "expense", revision: "1", digest: selected.digest },
  ];

  await retainCase("outside51", {
    outside,
    selected,
    expected,
    exchanges: { empty, small },
    ordinary,
    before,
    after,
  });
  expect(after).toEqual(before);
  assertReferences(empty, []);
  const result = assertReferences(small, expected);
  expect(result.snapshot.modules).toEqual([
    {
      owner: "expense",
      status: "available",
      rowCount: "1",
      fullCount: "1",
      hasContinuation: false,
      coverageKnown: true,
      ownerVersion: null,
    },
  ]);
  expect(ordinary.total).toBe("1");
});

test("context admission preserves50/51 all-status bound including a completed journal", async () => {
  const local = await admissionFixture();
  const plan = await unposted(local.book, local.source.id, "period_2026", "2026-06-30");
  await execute(local.book, plan);
  const sources = [];

  for (let index = 0; index < 49; index++) sources.push(await expense(local, "2026-06-15"));
  const before = await financialState(local.book);
  const fifty = await context(local.book, "period_2026");
  const ordinary50 = await attention(local.book, "period_2026");
  const added = await expense(local, "2026-06-15");
  const fiftyOne = await context(local.book, "period_2026");
  const ordinary51 = await attention(local.book, "period_2026");
  const after = await financialState(local.book);

  const expected = sources.map((source) => ({
    id: source.sourceId,
    owner: "expense",
    revision: "1",
    digest: source.digest,
  }));

  await retainCase("selected-bound", {
    sources,
    added,
    plan,
    expected,
    exchanges: { fifty, fiftyOne },
    ordinary50,
    ordinary51,
    before,
    after,
  });
  expect(after).toEqual(before);
  expect(ordinary50.total).toBe("50");
  expect(ordinary50.counts).toEqual({ open: "49", completed: "1" });
  expect(ordinary51.total).toBe("51");
  expect(fiftyOne.status).toBe(422);
  expect(JSON.parse(fiftyOne.body)).toEqual({
    _tag: "AccountingError",
    code: "UnsupportedProfile",
    message: "More than 50 attention rows are retained; this read does not page an index.",
  });
  const result = assertReferences(fifty, expected);
  expect(result.snapshot.modules.find((row) => row.owner === "journal")).toMatchObject({
    rowCount: "0",
    fullCount: "1",
  });
});

test("context admission refuses missing retained source facts without private values or financial writes", async () => {
  const local = await admissionFixture();
  const admin = await database();
  const id = `taxsource_${key().replaceAll("-", "")}`;

  try {
    await admin.query(
      "INSERT INTO openerp.expense_tax_sources(book_id,id,source_key,record_class) VALUES($1,$2,'private_missing_revision','synthetic')",
      [local.book.bookId, id],
    );
  } finally {
    await admin.end();
  }

  const before = await financialState(local.book);
  const exchange = await context(local.book, null);
  const after = await financialState(local.book);

  await retainCase("missing-facts", { id, exchange, before, after });
  expect(after).toEqual(before);
  expect(exchange.status, exchange.body).toBe(422);
  expect(JSON.parse(exchange.body)).toEqual({
    _tag: "AccountingError",
    code: "InvalidJournal",
    message:
      "A retained work row has unsupported revision or digest facts, so the index is not complete.",
  });
  expect(exchange.body).not.toContain(id);
  expect(exchange.body).not.toContain("private_missing_revision");
});

test("context admission keeps current authority and51 retained journal refusal", async () => {
  const local = await admissionFixture();

  for (let index = 0; index < 51; index++)
    await unposted(local.book, local.source.id, "period_2026", "2026-06-30");
  const before = await financialState(local.book);
  const bounded = await context(local.book, "period_2026");
  const admin = await database();

  try {
    await admin.query("DELETE FROM openerp.memberships WHERE book_id=$1 AND actor_id=$2", [
      local.book.bookId,
      local.book.actorId,
    ]);
  } finally {
    await admin.end();
  }

  const revoked = await context(local.book, "period_2026");
  const after = await financialState(local.book);

  await retainCase("authority", { exchanges: { bounded, revoked }, before, after });
  expect(after).toEqual(before);
  expect(bounded.status).toBe(422);
  expect(JSON.parse(bounded.body)).toEqual({
    _tag: "AccountingError",
    code: "UnsupportedProfile",
    message: "More than 50 attention rows are retained; this read does not page an index.",
  });
  expect(revoked.status).toBe(403);
  expect(JSON.parse(revoked.body)).toMatchObject({ code: "Forbidden" });
  expect(revoked.body).not.toContain("Private synthetic");
});
