import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Corrections from "../../packages/contracts/src/corrections";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("correction review recovers a lost aggregate response and blocks the competing alternative", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const base = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
    key: string = crypto.randomUUID(),
  ): Promise<S["Type"]> => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, origin, "content-type": "application/json", "idempotency-key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    const responseBody = await response.text();

    expect(response.status, responseBody).toBe(200);

    return Schema.decodeSync(Schema.fromJsonString(schema))(responseBody);
  };

  const initial = await call("/ledger", Accounting.LedgerSnapshot);
  const setup = await call("/setup", Accounting.BookSetup);

  const evidence = await call("/evidence", Accounting.Evidence, {
    title: "Syntetiskt original för rättelse",
    content: "Synthetic 125.00 SEK transfer corrected to 70.00 SEK. No company data.",
    mediaType: "text/plain",
    origin: "Synthetic browser correction recovery",
  });

  const plan = await call("/change-sets", Accounting.ChangeSet, {
    kind: "manual_journal",
    evidenceId: evidence.id,
    eventKey: `correction_browser_${crypto.randomUUID()}`,
    accountingPeriodId: "period_synthetic_2026",
    postingDate: setup.today,
    series: "A",
    description: "Syntetiskt oföränderligt original",
    rationale: "Retain the original while correcting the synthetic transfer",
    taxAssessment: "not_applicable",
    lines: [
      {
        accountId: "account_bank",
        debitMinor: "12500",
        creditMinor: "0",
        description: "Original bank debit",
      },
      {
        accountId: "account_clearing",
        debitMinor: "0",
        creditMinor: "12500",
        description: "Original clearing credit",
      },
    ],
  });

  const originalApproval = await call(`/change-sets/${plan.id}/approvals`, Accounting.Approval, {
    version: plan.version,
    planDigest: plan.planDigest,
  });

  const originalReceipt = await call(
    `/change-sets/${plan.id}/execute`,
    Accounting.ExecutionReceipt,
    {
      version: plan.version,
      planDigest: plan.planDigest,
      approvalId: originalApproval.id,
    },
  );

  const original = await call(`/vouchers/${originalReceipt.voucherId}`, Accounting.Voucher);
  const before = await call("/ledger", Accounting.LedgerSnapshot);

  expect(BigInt(before.sequence) - BigInt(initial.sequence)).toBe(1n);
  expect(
    BigInt(
      before.accounts.find((entry) => entry.accountId === "account_bank")?.balanceMinor ?? "0",
    ) -
      BigInt(
        initial.accounts.find((entry) => entry.accountId === "account_bank")?.balanceMinor ?? "0",
      ),
  ).toBe(12500n);

  const prepare = async (amount: "7000" | "9000") => {
    const intent: typeof Corrections.CorrectionIntent.Type = {
      datePolicy: "explicit_open_period",
      accountingPeriodId: "period_synthetic_2026",
      postingDate: setup.today,
      rationale: `Synthetic alternative ${amount} minor units`,
      replacement: {
        description: `Syntetisk ersättning ${amount}`,
        lines: [
          {
            accountId: "account_bank",
            debitMinor: amount,
            creditMinor: "0",
            description: "Corrected bank debit",
          },
          {
            accountId: "account_clearing",
            debitMinor: "0",
            creditMinor: amount,
            description: "Corrected clearing credit",
          },
        ],
      },
    };

    const impact = await call(
      `/vouchers/${original.id}/correction-impact-reviews`,
      Corrections.CorrectionImpact,
      intent,
    );

    expect(impact.basis.blockers).toEqual([]);
    expect(
      impact.basis.netChange.find((entry) => entry.accountId === "account_bank")?.deltaMinor,
    ).toBe(amount === "7000" ? "-5500" : "-3500");

    const bundle = await call(
      `/vouchers/${original.id}/correction-bundles`,
      Corrections.CorrectionBundle,
      {
        ...intent,
        impactReview: { id: impact.id, digest: impact.digest },
      },
    );

    return { impact, bundle };
  };

  const first = await prepare("7000");
  const competing = await prepare("9000");
  const workQuery = "?status=all&kind=journal";

  const reviewUrl = (id: string) =>
    `${workspace}/tools?view=corrections&work=${encodeURIComponent(workQuery)}&bundle=${encodeURIComponent(id)}`;

  const confirm = screen.getByRole(
    "checkbox",
    "Jag har granskat båda rättelsedelarna och motiveringen.",
  );

  const approve = screen.getByRole("button", "Godkänn hela rättelsepaketet");
  const execute = screen.getByRole("button", "Bokför motbokning och ersättning");

  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);
  const constituentUrl = `${workspace}/reviews/${first.bundle.reversal.id}/${first.bundle.reversal.planDigest}?status=all&kind=journal`;
  await app.open(constituentUrl);
  await expect(screen.getByRole("heading", "Granska hela rättelsen")).toBeVisible({
    timeout: 90_000,
  });
  await expect(screen.getByRole("heading", "Exakt motbokning")).toBeVisible();
  await expect(screen.getByRole("heading", "Ersättning")).toBeVisible();
  await expect(approve).toBeDisabled();
  await expect(execute).toBeDisabled();
  const constituentScreenshot = await app.screenshot("correction-child-opens-complete-bundle");
  await app.open(`${workspace}/reviews/${first.bundle.replacement.id}/`);
  await expect(screen.getByRole("heading", "Granska hela rättelsen")).toBeVisible();
  await expect(approve).toBeDisabled();
  await app.open(`${workspace}/reviews/${first.bundle.reversal.id}/sha256:${"0".repeat(64)}`);
  await expect(screen.getByRole("alert")).toContainText(
    "Länken stämmer inte med det låsta förslaget",
  );
  await expect(approve).toHaveCount(0);
  await expect(execute).toHaveCount(0);
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);
  await app.open(reviewUrl(first.bundle.id));
  await expect(screen.getByRole("heading", "Granska hela rättelsen")).toBeVisible({
    timeout: 90_000,
  });
  await expect(screen.getByRole("heading", "Exakt motbokning")).toBeVisible();
  await expect(screen.getByRole("heading", "Ersättning")).toBeVisible();
  await expect(screen.getByRole("heading", "Granskning av rättelsens följder")).toBeVisible();
  await expect(
    screen.getByRole("table", "Föreslagna saldoförändringar (minsta valutaenhet)"),
  ).toContainText(/account_bank\s+-5500/);
  await expect(approve).toBeDisabled();
  await expect(execute).toBeDisabled();
  await agent.assert(
    "The complete correction review shows the exact reversal, replacement and proposed net changes, and posting requires confirmation and operator approval. Return the configured JSON judgment.",
  );
  await expect(execute).toBeDisabled();
  await confirm.focus();
  await confirm.press("Space");
  await expect(confirm).toBeChecked();
  await expect(approve).toBeEnabled();
  await approve.focus();
  await approve.press("Enter");
  await expect(execute).toBeEnabled();

  const approved = await call(
    `/correction-bundles/${first.bundle.id}`,
    Corrections.CorrectionBundleView,
  );

  if (!approved.approval) throw new Error("Browser approval was not retained");

  let committed: typeof Corrections.CorrectionBundleReceipt.Type | undefined;
  let executionKey = "";
  const executionPath = `${base}/correction-bundles/${first.bundle.id}/execute`;

  await browser.route(executionPath, async (route) => {
    try {
      executionKey = route.request.headers["idempotency-key"] ?? "";

      expect(executionKey).toMatch(/^[a-zA-Z0-9_-]{8,128}$/);

      const response = await fetch(route.request.url, {
        method: route.request.method,
        headers: { ...route.request.headers, cookie, origin },
        body: route.request.postData ?? undefined,
        signal: AbortSignal.timeout(20_000),
      });

      const responseBody = await response.text();

      expect(response.status, responseBody).toBe(200);
      committed = Schema.decodeSync(Schema.fromJsonString(Corrections.CorrectionBundleReceipt))(
        responseBody,
      );
    } finally {
      await route.abort();
    }
  });
  await execute.focus();
  await execute.press("Enter");
  await expect.poll(() => committed?.bundleId).toBe(first.bundle.id);
  await browser.unroute(executionPath);

  if (!committed) throw new Error("The real aggregate execution did not return a receipt");

  const receipt = committed;

  await browser.evaluate("() => localStorage.clear()");
  await browser.reload();
  await expect(screen.getByRole("heading", "Kvitto för hela rättelsepaketet")).toBeVisible();
  await expect(
    screen.getByText(`${receipt.id}, ${receipt.committedAt}`, { exact: true }),
  ).toBeVisible();
  await expect(
    screen.getByText(`Bevarat original: ${original.id}`, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    screen.getByText(
      `Exakt motbokning: ${receipt.reversal.voucherId}, ${receipt.reversal.voucherNumber}, ${receipt.reversal.sequence}`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    screen.getByText(
      `Ersättning: ${receipt.replacement.voucherId}, ${receipt.replacement.voucherNumber}, ${receipt.replacement.sequence}`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(execute).toHaveCount(0);

  const receiptScreenshot = await app.screenshot(
    "correction-aggregate-after-lost-response-and-reload",
  );

  const recovered = await call(
    `/correction-bundles/${first.bundle.id}`,
    Corrections.CorrectionBundleView,
  );

  const byOriginal = await call(
    `/vouchers/${original.id}/correction-bundle`,
    Corrections.CorrectionBundleView,
  );

  const requestRecovery = await call(
    `/correction-requests/${executionKey}`,
    Corrections.CorrectionRequestRecovery,
  );

  const replay = await call(
    `/correction-bundles/${first.bundle.id}/execute`,
    Corrections.CorrectionBundleReceipt,
    {
      version: first.bundle.version,
      bundleDigest: first.bundle.bundleDigest,
      approvalId: approved.approval.id,
    },
    executionKey,
  );

  const reversal = await call(`/vouchers/${receipt.reversal.voucherId}`, Accounting.Voucher);
  const replacement = await call(`/vouchers/${receipt.replacement.voucherId}`, Accounting.Voucher);

  const chain = await call(
    `/vouchers/${original.id}/correction-chain`,
    Corrections.CorrectionChain,
  );

  const after = await call("/ledger", Accounting.LedgerSnapshot);

  expect(recovered.receipt).toEqual(receipt);
  expect(byOriginal.receipt).toEqual(receipt);
  expect(requestRecovery.status).toBe("recorded");
  expect(requestRecovery.result).toEqual(receipt);
  expect(replay).toEqual(receipt);
  expect(reversal.sequence).toBe(receipt.reversal.sequence);
  expect(replacement.sequence).toBe(receipt.replacement.sequence);
  expect(reversal.action.lines.find((line) => line.accountId === "account_bank")?.creditMinor).toBe(
    "12500",
  );
  expect(
    replacement.action.lines.find((line) => line.accountId === "account_bank")?.debitMinor,
  ).toBe("7000");
  expect(chain.receipts).toEqual([receipt]);
  expect(chain.vouchers).toHaveLength(3);
  expect(chain.balances.find((entry) => entry.accountId === "account_bank")?.balanceMinor).toBe(
    "7000",
  );
  expect(await call(`/vouchers/${original.id}`, Accounting.Voucher)).toEqual(original);
  expect(BigInt(after.sequence) - BigInt(before.sequence)).toBe(2n);
  expect(
    BigInt(
      after.accounts.find((entry) => entry.accountId === "account_bank")?.balanceMinor ?? "0",
    ) -
      BigInt(
        before.accounts.find((entry) => entry.accountId === "account_bank")?.balanceMinor ?? "0",
      ),
  ).toBe(-5500n);

  await app.open(reviewUrl(competing.bundle.id));
  await expect(screen.getByRole("heading", "Granska hela rättelsen")).toBeVisible();
  await expect(
    screen.getByText(
      "Registrerade uppgifter har ändrats. Skapa en ny granskning och ett nytt paket; återanvänd inte godkännandet.",
      { exact: true },
    ),
  ).toBeVisible();
  await confirm.focus();
  await confirm.press("Space");
  await expect(confirm).toBeChecked();
  await expect(approve).toBeDisabled();
  await expect(execute).toBeDisabled();

  const competingView = await call(
    `/correction-bundles/${competing.bundle.id}`,
    Corrections.CorrectionBundleView,
  );

  const staleImpact = await call(
    `/correction-impact-reviews/${competing.impact.id}`,
    Corrections.CorrectionImpactView,
  );

  expect(competingView.receipt).toBeNull();
  expect(competingView.approval).toBeNull();
  expect(staleImpact.snapshotCurrent).toBe(false);
  await expect(
    screen.getByText(`Kvitto för hela rättelsepaketet: ${receipt.id}`, { exact: true }),
  ).toBeVisible();

  const staleScreenshot = await app.screenshot(
    "correction-competing-alternative-blocked-with-current-receipt",
  );

  const receiptLink = screen.getByRole("link", first.bundle.id, { exact: true });

  await expect(receiptLink).toHaveAttribute("href", reviewUrl(first.bundle.id).replace(origin, ""));
  await receiptLink.focus();
  await receiptLink.press("Enter");
  await expect(browser).toHaveURL(reviewUrl(first.bundle.id));
  await expect(screen.getByRole("heading", "Kvitto för hela rättelsepaketet")).toBeVisible();
  await screen.getByRole("link", "Tillbaka till arbetet").focus();
  await screen.getByRole("link", "Tillbaka till arbetet").press("Enter");
  await expect(browser).toHaveURL(`${workspace}/work${workQuery}`);

  await app.open(`${workspace}/books?view=vouchers&record=${original.id}`);
  await expect(
    screen.getByRole(
      "heading",
      `${original.action.series}${original.number}, ${original.action.description}`,
    ),
  ).toBeVisible();
  await expect(screen.getByRole("table", "Bokförda rader")).toContainText("125,00");
  await expect(screen.getByText(original.action.rationale, { exact: true })).toBeVisible();
  const originalScreenshot = await app.screenshot("correction-retained-original-readable-in-books");

  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(after);
  await writeFile(
    join(process.env.OPENERP_E2E_OUTPUT!, "posting-correction-recovery-journey.json"),
    JSON.stringify(
      {
        scenario:
          "Synthetic correction from 12500 to 7000 minor units with competing 9000 alternative",
        executionKey,
        initial,
        before,
        after,
        original,
        bundleId: first.bundle.id,
        competingBundleId: competing.bundle.id,
        receipt,
        recoveredReceipt: recovered.receipt,
        originalDiscoveredReceipt: byOriginal.receipt,
        requestRecovery,
        replay,
        reversal,
        replacement,
        chain,
        competingReceipt: competingView.receipt,
        competingApproval: competingView.approval,
        competingSnapshotCurrent: staleImpact.snapshotCurrent,
        constituentUrl,
        screenshots: {
          constituentScreenshot,
          receiptScreenshot,
          staleScreenshot,
          originalScreenshot,
        },
        expected: { ledgerIncrement: "2", bankDeltaMinor: "-5500", chainBankBalanceMinor: "7000" },
      },
      null,
      2,
    ),
  );
});
