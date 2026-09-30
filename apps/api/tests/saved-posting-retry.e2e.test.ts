import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import * as Schema from "effect/Schema";
import { withWorkspaceBrowser } from "./support/workspace-browser";
import {
  approve,
  database,
  decoded,
  environment,
  evidence,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

async function reviewerRole(bookId: string, actorId: string, role: "operator" | "agent") {
  const admin = await database();

  try {
    await admin.query(
      "update openerp.memberships set role = $3 where book_id = $1 and actor_id = $2",
      [bookId, actorId, role],
    );
  } finally {
    await admin.end();
  }
}

test("DF-04 retries the original saved execution after reviewer authority is restored and recovers exactly one receipt", async () => {
  const book = await fixture();
  const original = await evidence(book);
  const plan = await post(book, "/change-sets", journal(original.id), Accounting.ChangeSet);
  const actorId = `reviewer_${randomBytes(8).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.actors(id,name) values ($1,'Synthetic independent reviewer')",
      [actorId],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values ($1,$2,'operator')",
      [book.bookId, actorId],
    );
    await admin.query(
      "insert into openerp.credentials(token_hash,actor_id,expires_at) values ($1,$2,now()+interval '1 day')",
      [createHash("sha256").update(token).digest("hex"), actorId],
    );
  } finally {
    await admin.end();
  }

  const approval = await approve({ ...book, token, actorId }, plan);
  const requestKey = key();

  const command = {
    operation: "execute_change",
    id: plan.id,
    input: { planDigest: plan.planDigest, version: plan.version, approvalId: approval.id },
  };

  const saved = await decoded(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify(command),
    }),
    Recovery.SavedPostingRequest,
  );

  await reviewerRole(book.bookId, actorId, "agent");

  const refused = await post(
    book,
    `/saved-posting-requests/${requestKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(refused.outcome?.state).toBe("refused");
  expect(refused.outcome?.refusal?.code).toBe("ApprovalRequired");
  expect(refused.request.retryableRefusal).toBe(true);
  expect((await persisted(book))?.vouchers).toBe(0);
  await reviewerRole(book.bookId, actorId, "operator");

  const [first, second] = await Promise.all([
    post(book, `/saved-posting-requests/${requestKey}/run`, {}, Recovery.SavedPostingRequest),
    post(book, `/saved-posting-requests/${requestKey}/run`, {}, Recovery.SavedPostingRequest),
  ]);

  expect(first.outcome?.state).toBe("committed");
  expect(second.outcome).toEqual(first.outcome);
  expect(first.request.key).toBe(saved.request.key);
  expect(first.request.commandKey).toBe(saved.request.commandKey);
  const observed = await persisted(book);
  expect(observed?.vouchers).toBe(1);

  const retained = await decoded(
    await request(book, `/saved-posting-requests/${requestKey}`),
    Recovery.SavedPostingRequest,
  );

  expect(retained.outcome).toEqual(first.outcome);
  const history = await database();

  try {
    const attempts = await history.query(
      "select attempt,state from openerp.posting_request_attempts where book_id=$1 and key=$2 order by attempt",
      [book.bookId, requestKey],
    );

    expect(attempts.rows).toEqual([
      { attempt: 1, state: "refused" },
      { attempt: 2, state: "committed" },
    ]);
    await expect(
      history.query("delete from openerp.posting_request_attempts where book_id=$1 and key=$2", [
        book.bookId,
        requestKey,
      ]),
    ).rejects.toMatchObject({ code: "P0001" });
  } finally {
    await history.end();
  }

  await writeFile(
    join(environment().artifacts, "df-04-same-key-retry.json"),
    JSON.stringify({ saved, refused, first, second, retained, observed }, null, 2),
  );
});

test("DF-04 browser retries a refused preparation without creating a new saved request", async () => {
  const book = await fixture();
  const original = await evidence(book);
  const requestKey = key();

  const saved = await decoded(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ operation: "prepare_journal", input: journal(original.id) }),
    }),
    Recovery.SavedPostingRequest,
  );

  const admin = await database();

  try {
    await admin.query("update openerp.periods set locked=true where book_id=$1", [book.bookId]);
  } finally {
    await admin.end();
  }

  const refused = await post(
    book,
    `/saved-posting-requests/${requestKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(refused.outcome?.refusal?.code).toBe("PeriodLocked");
  expect(refused.request.retryableRefusal).toBe(true);
  const reopening = await database();

  try {
    await reopening.query("update openerp.periods set locked=false where book_id=$1", [
      book.bookId,
    ]);
  } finally {
    await reopening.end();
  }

  await withWorkspaceBrowser(book, "df-04", async (page, workspace) => {
    const errors: string[] = [];
    const runs: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url().includes("saved-posting-requests"))
        runs.push(new URL(outgoing.url()).pathname);
    });
    await page.goto(`${workspace}/books?view=journal`);
    await page.getByText("Resume saved work", { exact: true }).first().click();
    await page.getByRole("button", { name: "Inspect saved request", exact: true }).click();
    await page
      .getByText(
        "Resolve the blocker, then run this saved request again. Its body and original identity stay unchanged.",
        { exact: true },
      )
      .waitFor();
    expect(
      await page
        .getByRole("button", { name: "Save as a new request and run", exact: true })
        .count(),
    ).toBe(0);
    await page
      .getByLabel(
        "I reviewed the exact saved command. Run it unchanged under my current authority.",
        { exact: true },
      )
      .check();
    const runButton = page.getByRole("button", { name: "Run this saved request", exact: true });
    await runButton.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(environment().artifacts, "df-04-browser-retry.png") });
    await runButton.focus();
    await page.keyboard.press("Enter");
    await page
      .getByText("This command committed. Preparation and approval do not mean posting.", {
        exact: true,
      })
      .last()
      .waitFor();
    await page.screenshot({ path: join(environment().artifacts, "df-04-browser-committed.png") });
    expect(runs).toEqual([`${book.path}/saved-posting-requests/${requestKey}/run`]);
    expect(errors).toEqual([]);

    const result = await decoded(
      await request(book, `/saved-posting-requests/${requestKey}`),
      Recovery.SavedPostingRequest,
    );

    expect(result.outcome?.state).toBe("committed");
    expect(result.request.commandKey).toBe(saved.request.commandKey);
    await writeFile(
      join(environment().artifacts, "df-04-browser.json"),
      JSON.stringify(
        {
          requestKey,
          unchangedKernelKey: result.request.commandKey === saved.request.commandKey,
          runs,
          errors,
          outcome: result.outcome,
        },
        null,
        2,
      ),
    );
  });
}, 120000);

test("DF-04 keeps invalid request content terminal and rejects different bytes under its saved key", async () => {
  const book = await fixture();
  const original = await evidence(book);
  const input = journal(original.id);

  const bad = {
    ...input,
    lines: input.lines.map((line, index) =>
      index === 0 ? { ...line, debitMinor: "12501" } : line,
    ),
  };

  const requestKey = key();

  const saved = await decoded(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ operation: "prepare_journal", input: bad }),
    }),
    Recovery.SavedPostingRequest,
  );

  const refused = await post(
    book,
    `/saved-posting-requests/${requestKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(refused.outcome?.refusal?.code).toBe("InvalidJournal");

  const repeated = await post(
    book,
    `/saved-posting-requests/${requestKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(repeated.outcome).toEqual(refused.outcome);
  expect(repeated.request.retryableRefusal).toBe(false);
  expect(repeated.request.key).toBe(saved.request.key);
  await failure(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ operation: "prepare_journal", input }),
    }),
    409,
    "IdempotencyConflict",
  );
  expect((await persisted(book))?.vouchers).toBe(0);
});

test("DF-04 a late attempt-record fault rolls back posting and leaves the same request runnable", async () => {
  const book = await fixture();
  const original = await evidence(book);
  const plan = await post(book, "/change-sets", journal(original.id), Accounting.ChangeSet);
  const approval = await approve(book, plan);
  const requestKey = key();

  const saved = await decoded(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({
        operation: "execute_change",
        id: plan.id,
        input: { planDigest: plan.planDigest, version: plan.version, approvalId: approval.id },
      }),
    }),
    Recovery.SavedPostingRequest,
  );

  const admin = await database();

  try {
    await admin.query(
      `create function openerp.e2e_attempt_fault() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then raise exception 'Synthetic late attempt failure'; end if; return new; end $$`,
    );
    await admin.query(
      "create trigger e2e_attempt_fault before insert on openerp.posting_request_attempts for each row execute function openerp.e2e_attempt_fault()",
    );
    await failure(
      await request(book, `/saved-posting-requests/${requestKey}/run`, { method: "POST" }),
      500,
      "InternalError",
    );
    expect((await persisted(book))?.vouchers).toBe(0);

    const commands = await admin.query(
      "select count(*)::int as count from openerp.command_receipts where book_id=$1 and key=$2",
      [book.bookId, saved.request.commandKey],
    );

    expect(commands.rows).toEqual([{ count: 0 }]);
  } finally {
    await admin.query(
      "drop trigger if exists e2e_attempt_fault on openerp.posting_request_attempts",
    );
    await admin.query("drop function if exists openerp.e2e_attempt_fault()");
    await admin.end();
  }

  const result = await post(
    book,
    `/saved-posting-requests/${requestKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(result.outcome?.state).toBe("committed");
  expect(result.request.commandKey).toBe(saved.request.commandKey);
  expect((await persisted(book))?.vouchers).toBe(1);
});

test("DF-04 recovers an old persisted state refusal without rewriting its original outcome", async () => {
  const book = await fixture();
  const original = await evidence(book);
  const requestKey = key();

  const saved = await decoded(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ operation: "prepare_journal", input: journal(original.id) }),
    }),
    Recovery.SavedPostingRequest,
  );

  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.posting_request_outcomes(book_id,key,state,result,refusal) values ($1,$2,'refused',null,$3::jsonb)",
      [
        book.bookId,
        requestKey,
        JSON.stringify({ code: "PeriodLocked", message: "Historical period refusal" }),
      ],
    );
  } finally {
    await admin.end();
  }

  const result = await post(
    book,
    `/saved-posting-requests/${requestKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(result.outcome?.state, JSON.stringify(result.outcome)).toBe("committed");
  expect(result.request.commandKey).toBe(saved.request.commandKey);
  const observation = await database();

  try {
    const old = await observation.query(
      "select state, refusal from openerp.posting_request_outcomes where book_id=$1 and key=$2",
      [book.bookId, requestKey],
    );

    expect(old.rows).toEqual([
      { state: "refused", refusal: { code: "PeriodLocked", message: "Historical period refusal" } },
    ]);
  } finally {
    await observation.end();
  }
});

test("DF-04 MCP retries the agent's own unchanged request without gaining human authority", async () => {
  const book = await fixture();
  const agent = { ...book, token: book.agentToken };
  const original = await evidence(book);
  const requestKey = key();

  const saved = await decoded(
    await request(agent, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ operation: "prepare_journal", input: journal(original.id) }),
    }),
    Recovery.SavedPostingRequest,
  );

  const admin = await database();

  try {
    await admin.query("update openerp.periods set locked=true where book_id=$1", [book.bookId]);

    const refused = await post(
      agent,
      `/saved-posting-requests/${requestKey}/run`,
      {},
      Recovery.SavedPostingRequest,
    );

    expect(refused.outcome?.refusal?.code).toBe("PeriodLocked");
    await admin.query("update openerp.periods set locked=false where book_id=$1", [book.bookId]);
  } finally {
    await admin.end();
  }

  const response = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "posting_run_request",
        arguments: { scope: { entityId: book.entityId, bookId: book.bookId }, key: requestKey },
      },
    }),
  });

  expect(response.status).toBe(200);

  const envelope = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Literal(false),
        structuredContent: Schema.Struct({ result: Recovery.SavedPostingRequest }),
      }),
    }),
  )(await response.json());

  const result = envelope.result.structuredContent.result;
  expect(result.outcome?.state).toBe("committed");
  expect(result.request.commandKey).toBe(saved.request.commandKey);
  expect((await persisted(book))?.vouchers).toBe(0);
  await writeFile(
    join(environment().artifacts, "df-04-mcp-retry.json"),
    JSON.stringify({ requestKey, result }, null, 2),
  );
});
