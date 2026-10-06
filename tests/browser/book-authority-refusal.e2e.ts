import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Recovery from "../../packages/contracts/src/posting-recovery";
import * as Workspace from "../../packages/contracts/src/workspace";
import { withDisposableBrowserDatabase } from "../../apps/api/tests/support/browser-database";
import { signInSyntheticOperator } from "./synthetic-session";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("current book membership refuses posting without writes and restores receipt discovery", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;
  const sessionFile = process.env.OPENERP_E2E_SESSION;

  if (!output || !sessionFile) throw new Error("Use the disposable synthetic browser launcher");
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const base = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const request = (path: string, body?: unknown, key: string = crypto.randomUUID()) =>
    fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, origin, "content-type": "application/json", "idempotency-key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
    key?: string,
  ): Promise<S["Type"]> => {
    const response = await request(path, body, key);
    expect(response.status).toBe(200);

    return Schema.decodeSync(Schema.fromJsonString(schema))(await response.text());
  };

  const financialSnapshot = () =>
    withDisposableBrowserDatabase(sessionFile, origin, async (client) => {
      const result = await client.query(`select jsonb_build_object(
      'book',(select to_jsonb(b) from openerp.books b where id='book_synthetic'),
      'plans',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from openerp.change_sets t where book_id='book_synthetic'),
      'approvals',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from openerp.approvals t where book_id='book_synthetic'),
      'vouchers',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from openerp.vouchers t where book_id='book_synthetic'),
      'lines',(select coalesce(jsonb_agg(to_jsonb(t) order by voucher_id,ordinal),'[]'::jsonb) from openerp.journal_lines t where book_id='book_synthetic'),
      'counters',(select coalesce(jsonb_agg(to_jsonb(t) order by fiscal_year_id,series),'[]'::jsonb) from openerp.series_counters t where book_id='book_synthetic'),
      'receipts',(select coalesce(jsonb_agg(to_jsonb(t) order by key),'[]'::jsonb) from openerp.command_receipts t where book_id='book_synthetic'),
      'executions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from openerp.execution_receipts t where book_id='book_synthetic'),
      'requests',(select coalesce(jsonb_agg(to_jsonb(t) order by key),'[]'::jsonb) from openerp.posting_saved_requests t where book_id='book_synthetic')
    ) as snapshot`);

      return Schema.decodeUnknownSync(Schema.Struct({ snapshot: Schema.Unknown }))(result.rows[0])
        .snapshot;
    });

  const team = await call("/workspace", Workspace.Coordination);
  const setup = await call("/setup", Accounting.BookSetup);
  const beforeLedger = await call("/ledger", Accounting.LedgerSnapshot);

  const evidence = await call("/evidence", Accounting.Evidence, {
    title: "Syntetisk behörighetskontroll",
    content: "Synthetic 125.00 SEK transfer; no company or provider data.",
    mediaType: "text/plain",
    origin: "Synthetic authority journey",
  });

  const plan = await call("/change-sets", Accounting.ChangeSet, {
    kind: "manual_journal",
    evidenceId: evidence.id,
    eventKey: `authority_${crypto.randomUUID()}`,
    accountingPeriodId: "period_synthetic_2026",
    postingDate: setup.today,
    series: "A",
    description: "Syntetisk behörighetskontroll",
    rationale: "Verify current membership admission",
    taxAssessment: "not_applicable",
    lines: [
      {
        accountId: "account_bank",
        debitMinor: "12500",
        creditMinor: "0",
        description: "Bank debit",
      },
      {
        accountId: "account_clearing",
        debitMinor: "0",
        creditMinor: "12500",
        description: "Clearing credit",
      },
    ],
  });

  const approval = await call(`/change-sets/${plan.id}/approvals`, Accounting.Approval, {
    version: 1,
    planDigest: plan.planDigest,
  });

  const execution = { version: 1, planDigest: plan.planDigest, approvalId: approval.id };
  const reviewUrl = `${workspace}/reviews/${encodeURIComponent(plan.id)}/${encodeURIComponent(plan.planDigest)}`;
  await app.open(reviewUrl);
  await expect(screen.getByRole("button", "Bokför posten", { exact: true })).toBeVisible();
  const before = await financialSnapshot();

  const unknown = await request("/saved-posting-requests", {
    operation: "unknown_financial_action",
    input: {},
  });

  expect(unknown.status).toBe(400);
  const unknownBody = await unknown.text();
  expect(await financialSnapshot()).toEqual(before);
  let removed = false;
  let deniedScreenshot = "";
  const refusals: { path: string; status: number; code: string }[] = [];

  try {
    await withDisposableBrowserDatabase(sessionFile, origin, async (client) => {
      const result = await client.query(
        "delete from openerp.memberships where book_id=$1 and actor_id=$2 and role='operator' returning actor_id",
        ["book_synthetic", team.actorId],
      );

      expect(result.rows).toHaveLength(1);
      removed = true;
    });

    for (const [path, body] of [
      [`/change-sets/${plan.id}`, undefined],
      [`/change-sets/${plan.id}/approvals`, { version: 1, planDigest: plan.planDigest }],
      [`/change-sets/${plan.id}/execute`, execution],
    ] as const) {
      const response = await request(path, body);

      const refusal = Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(
        await response.text(),
      );

      expect(response.status).toBe(403);
      expect(refusal.code).toBe("Forbidden");
      refusals.push({ path, status: response.status, code: refusal.code });
      expect(await financialSnapshot()).toEqual(before);
    }

    await browser.reload();
    await expect(screen.getByRole("alert")).toHaveText(
      "Den här boken är inte tillgänglig för ditt konto. Välj en behörig arbetsyta.",
    );
    await expect(screen.getByRole("link", "Byt arbetsyta", { exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(screen.getByRole("button", "Bokför posten", { exact: true })).toHaveCount(0);
    await expect(screen.getByRole("button", "Godkänn förslag", { exact: true })).toHaveCount(0);
    deniedScreenshot = await app.screenshot("book-current-membership-denial");
    await agent.assert(
      "The browser clearly reports in Swedish that the selected book is unavailable to this account and asks the user to choose an authorized workspace. Byt arbetsyta provides workspace navigation. It offers no financial approval or posting action and does not claim a successful posting. Return the configured JSON judgment.",
    );
    expect(await financialSnapshot()).toEqual(before);
  } finally {
    if (removed)
      await withDisposableBrowserDatabase(sessionFile, origin, async (client) => {
        const restored = await client.query(
          "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator') returning actor_id",
          ["book_synthetic", team.actorId],
        );

        expect(restored.rows).toHaveLength(1);
      });
  }

  await app.open(reviewUrl);
  await expect(screen.getByRole("button", "Bokför posten", { exact: true })).toBeVisible();
  const executionKey = crypto.randomUUID();

  const receipt = await call(
    `/change-sets/${plan.id}/execute`,
    Accounting.ExecutionReceipt,
    execution,
    executionKey,
  );

  expect(
    await call(
      `/change-sets/${plan.id}/execute`,
      Accounting.ExecutionReceipt,
      execution,
      executionKey,
    ),
  ).toEqual(receipt);
  const recovery = await call(`/posting-recovery/${plan.id}`, Recovery.PostingRecovery);
  expect(recovery.summary.executionReceipt).toEqual(receipt);
  const voucher = await call(`/vouchers/${receipt.voucherId}`, Accounting.Voucher);

  expect(
    voucher.action.lines.map(({ accountId, debitMinor, creditMinor }) => ({
      accountId,
      debitMinor,
      creditMinor,
    })),
  ).toEqual([
    { accountId: "account_bank", debitMinor: "12500", creditMinor: "0" },
    { accountId: "account_clearing", debitMinor: "0", creditMinor: "12500" },
  ]);
  const afterLedger = await call("/ledger", Accounting.LedgerSnapshot);
  expect(BigInt(afterLedger.sequence) - BigInt(beforeLedger.sequence)).toBe(1n);

  for (const [accountId, delta] of [
    ["account_bank", 12500n],
    ["account_clearing", -12500n],
  ] as const) {
    const previous = beforeLedger.accounts.find((entry) => entry.accountId === accountId);
    const current = afterLedger.accounts.find((entry) => entry.accountId === accountId);

    if (!previous || !current) throw new Error("Independent expected account missing");
    expect(current.balanceMinor).toBe((BigInt(previous.balanceMinor) + delta).toString());
  }

  await browser.reload();
  await expect(
    screen.getByRole("heading", new RegExp(`Bokfört.*Verifikation ${receipt.voucherNumber}`)),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Bokför posten", { exact: true })).toHaveCount(0);
  const receiptScreenshot = await app.screenshot("book-restored-membership-receipt-discovery");
  await writeFile(
    join(output, "book-authority-refusal-journey.json"),
    JSON.stringify(
      {
        synthetic: true,
        actorId: team.actorId,
        planId: plan.id,
        expected: { bankDeltaMinor: "12500", clearingDeltaMinor: "-12500", sequenceDelta: "1" },
        unknown: { status: unknown.status, body: unknownBody },
        refusals,
        beforeFinancialRecords: before,
        afterFinancialRecords: await financialSnapshot(),
        beforeLedger,
        afterLedger,
        receipt,
        voucher,
        recovery,
        screenshots: { deniedScreenshot, receiptScreenshot },
      },
      null,
      2,
    ),
  );
});
