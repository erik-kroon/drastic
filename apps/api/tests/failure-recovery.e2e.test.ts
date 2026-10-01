import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import { withWorkspaceBrowser } from "./support/workspace-browser";
import {
  approve,
  database,
  decoded,
  environment,
  evidence,
  execution,
  fixture,
  journal,
  key,
  persisted,
  prepare,
  request,
} from "./support/fixtures";

test.each([
  ["unbalanced", "UnbalancedPosting"],
  ["both_sides", "InvalidPostingSide"],
  ["missing_account", "AccountMissing"],
  ["missing_period", "AccountingPeriodMissing"],
  ["outside_period", "PostingDateOutsidePeriod"],
  ["inactive_account", "AccountInactive"],
  ["locked_period", "PeriodLocked"],
])("DF-10 %s has one machine-readable remedy over REST and MCP", async (vector, code) => {
  const book = await fixture();
  const source = await evidence(book);
  const original = journal(source.id);

  if (vector === "inactive_account" || vector === "locked_period") {
    const admin = await database();

    try {
      if (vector === "inactive_account")
        await admin.query(
          "update openerp.accounts set active=false where book_id=$1 and id='account_bank'",
          [book.bookId],
        );
      else
        await admin.query("update openerp.periods set locked=true where book_id=$1", [book.bookId]);
    } finally {
      await admin.end();
    }
  }

  const input = {
    ...original,
    accountingPeriodId: vector === "missing_period" ? "period_absent" : original.accountingPeriodId,
    postingDate: vector === "outside_period" ? "2027-01-01" : original.postingDate,
    lines: original.lines.map((line, ordinal) => ({
      ...line,
      accountId: vector === "missing_account" && ordinal === 0 ? "account_absent" : line.accountId,
      creditMinor:
        vector === "both_sides" && ordinal === 0
          ? "1"
          : vector === "unbalanced" && line.creditMinor !== "0"
            ? "12499"
            : line.creditMinor,
    })),
  };

  const response = await request(book, "/change-sets", {
    method: "POST",
    body: JSON.stringify(input),
  });

  expect(response.status).toBe(vector === "locked_period" ? 409 : 422);
  const body = await response.json();
  expect(body).toMatchObject({ code, recovery: "permanent" });

  const rpc = await fetch(`${environment().baseUrl}/api/mcp`, {
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
        name: "ledger_prepare_journal",
        arguments: {
          scope: { entityId: book.entityId, bookId: book.bookId },
          idempotencyKey: key(),
          input,
        },
      },
    }),
  });

  const result = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Literal(true),
        content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
      }),
    }),
  )(await rpc.json());

  expect(JSON.parse(result.result.content[0]!.text)).toMatchObject({ code, recovery: "permanent" });
  await writeFile(
    join(environment().artifacts, `df-10-${vector}.json`),
    JSON.stringify({ rest: body, mcp: result }, null, 2),
  );
});

test("DF-10 a known transaction rollback is transient and the unchanged original key recovers", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const before = await persisted(book);

  const command = {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify(execution(plan, approval)),
  };

  const admin = await database();

  try {
    await admin.query(
      `create function openerp.e2e_df10_fault() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then raise exception using errcode = '40001', message = 'synthetic-private-serialization'; end if; return new; end $$`,
    );
    await admin.query(
      "create trigger e2e_df10_fault before insert on openerp.journal_lines for each row execute function openerp.e2e_df10_fault()",
    );
    const refused = await request(book, `/change-sets/${plan.id}/execute`, command);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: "TransactionRetry", recovery: "transient" });
    expect(await persisted(book)).toEqual(before);
  } finally {
    await admin.query("drop trigger if exists e2e_df10_fault on openerp.journal_lines");
    await admin.query("drop function if exists openerp.e2e_df10_fault()");
    await admin.end();
  }

  const receipt = await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, command),
    Accounting.ExecutionReceipt,
  );

  const replay = await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, command),
    Accounting.ExecutionReceipt,
  );

  expect(replay).toEqual(receipt);
  await writeFile(
    join(environment().artifacts, "df-10-transaction-retry.json"),
    JSON.stringify({ before, receipt, replay }, null, 2),
  );
});

test("DF-10 browser distinguishes a rolled-back command and preserves its saved identity on retry", async () => {
  const book = await fixture();
  const admin = await database();

  try {
    await admin.query(
      `create function openerp.e2e_df10_browser_fault() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then raise exception using errcode = '40001', message = 'synthetic browser retry fault'; end if; return new; end $$`,
    );
    await admin.query(
      "create trigger e2e_df10_browser_fault before insert on openerp.evidence for each row execute function openerp.e2e_df10_browser_fault()",
    );
    await withWorkspaceBrowser(book, "df-10", async (page, workspace) => {
      const keys: string[] = [];
      page.on("request", (outgoing) => {
        if (outgoing.method() === "POST" && outgoing.url().endsWith("/saved-posting-requests"))
          keys.push(outgoing.headers()["idempotency-key"] ?? "missing");
      });
      await page.goto(`${workspace}/books?view=journal`);
      await page.getByLabel("Title", { exact: true }).fill("DF-10 browser source");
      await page
        .getByLabel("Where is it from?", { exact: true })
        .fill("Synthetic recovery journey");
      await page
        .getByLabel("Source text or explanation", { exact: true })
        .fill("DF-10 original exact source bytes");
      await page.getByRole("button", { name: "Save source & continue" }).click();
      await page.getByText("TransactionRetry", { exact: true }).waitFor();
      await page
        .getByText(
          "The transaction was rolled back. Retry the same action without changing its fields or request key.",
          { exact: true },
        )
        .waitFor();
      await page.screenshot({
        path: join(environment().artifacts, "df-10-transient-browser.png"),
        fullPage: true,
      });
      await admin.query("drop trigger e2e_df10_browser_fault on openerp.evidence");
      await page.route("**/saved-posting-requests/*/run", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            _tag: "AccountingError",
            code: "FutureFailureCode",
            message: "Unknown proxy outcome",
            recovery: "transient",
          }),
        }),
      );
      await page.getByRole("button", { name: "Save source & continue" }).click();
      await page
        .getByText(
          "The request failed. A write may already have completed. Retry the same action without changing its fields to recover the result safely.",
          { exact: true },
        )
        .waitFor();
      await page.screenshot({
        path: join(environment().artifacts, "df-10-unknown-browser.png"),
        fullPage: true,
      });
      await page.unroute("**/saved-posting-requests/*/run");
      await page.getByRole("button", { name: "Save source & continue" }).click();
      await page.getByText("DF-10 browser source", { exact: true }).waitFor();
      expect(keys).toHaveLength(3);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).toBe(keys[0]);
      await writeFile(
        join(environment().artifacts, "df-10-browser-retry.json"),
        JSON.stringify({ keys, unchangedIdentity: true }, null, 2),
      );
    });
  } finally {
    await admin.query("drop trigger if exists e2e_df10_browser_fault on openerp.evidence");
    await admin.query("drop function if exists openerp.e2e_df10_browser_fault()");
    await admin.end();
  }
});
