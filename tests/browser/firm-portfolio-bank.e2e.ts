import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Firms from "../../packages/contracts/src/firms";
import * as Bank from "../../packages/contracts/src/reconciliation";
import * as Closing from "../../packages/contracts/src/closing";
import * as Coverage from "../../packages/contracts/src/bank-source-coverage";
import * as AccountSignoffs from "../../packages/contracts/src/bank-signoffs";
import * as Signoffs from "../../packages/contracts/src/bank-inventory-signoffs";
import * as Settlement from "../../packages/contracts/src/settlements";
import * as Reports from "../../packages/contracts/src/reports";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const families = [
  "bank_sources",
  "invoices",
  "tax",
  "payroll",
  "assets_deferrals",
  "foreign_currency",
  "owner_balances",
  "other_balances",
  "external_schedules",
  "disclosures",
];

test("portfolio preserves dated bank observations and signed whole-inventory identity through invalidation", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const seed = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(seed).origin;
  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");
  const path = "/entities/entity_synthetic/books/book_synthetic";
  const scope = { entityId: "entity_synthetic", bookId: "book_synthetic" };

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    route: string,
    schema: S,
    body?: unknown,
    key = randomUUID(),
  ): Promise<S["Type"]> => {
    const response = await fetch(`${origin}/api/v1${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (response.status !== 200)
      throw new Error(`Synthetic ${route} returned ${response.status}: ${await response.text()}`);

    return Schema.decodeUnknownSync(schema)(await response.json());
  };

  const evidence = (title: string, content: string) =>
    call(`${path}/evidence`, Accounting.Evidence, {
      title,
      mediaType: "application/json",
      content,
      origin: "Synthetic portfolio bank qualification",
    });

  const before = await call(`${path}/ledger`, Accounting.LedgerSnapshot);

  const firm = await call("/firms", Firms.CommandResult, {
    name: "Synthetic bank source bureau",
  });

  const workspace = await call(`/firms/${firm.firmId}`, Firms.Workspace);

  await call(`/firms/${firm.firmId}/clients`, Firms.CommandResult, {
    scope,
    leadId: workspace.actorId,
    nextReviewOn: null,
    note: "Synthetic declared inventory only",
    expectedRevision: 0,
  });

  const importStatement = async (startsOn: string, endsOn: string) => {
    const source = {
      kind: "synthetic_bank_statement_v1",
      statementIdentifier: randomUUID(),
      sourceBankAccountId: "portfolio_bank_source",
      accountId: "account_bank",
      currency: "SEK",
      startsOn,
      endsOn,
      openingMinor: "0",
      closingMinor: "0",
      completeness: {
        declaredComplete: true,
        basis: "Synthetic zero-activity declared statement",
      },
      rows: [],
    };

    const original = await evidence("Synthetic zero-activity statement", JSON.stringify(source));

    return call(`${path}/bank-statements`, Bank.StatementImportReceipt, {
      ...source,
      evidenceId: original.id,
      existingMatches: [],
    });
  };

  const early = await importStatement("2026-01-01", "2026-09-28");
  const historical = await call(`/firms/${firm.firmId}/portfolio`, Firms.Portfolio);
  const historicalFacts = historical.clients[0];

  if (!historicalFacts) throw new Error("The permitted synthetic bank observation is missing");

  expect(historicalFacts.bank?.accounts[0]?.differenceMinor).toBe(null);
  expect(historicalFacts.bankObservations).toHaveLength(1);
  expect(historicalFacts.bankObservations[0]?.endsOn).toBe("2026-09-28");
  expect(historicalFacts.bankObservations[0]?.account.statementId).toBe(early.statement.id);
  expect(historicalFacts.bankObservations[0]?.account.differenceMinor).toBe("0");
  expect(historicalFacts.bankInventorySignoffs).toEqual([]);

  const portfolioUrl = `/firms?firm=${encodeURIComponent(firm.firmId)}&tab=clients`;

  await app.open(portfolioUrl);
  const details = screen.getByRole("region", "Klientdetaljer", { exact: true });
  const bank = details.getByRole("region", "Bankavstämning", { exact: true });

  await expect(bank).toBeVisible();
  await expect(bank).toContainText("Okänt");
  await expect(screen.getByText("Avstämd", { exact: true })).toHaveCount(0);

  const finalStatement = await importStatement("2026-09-29", "2026-12-31");

  const capacity = await call(
    `${path}/bank-capacity-reconciliations`,
    Settlement.BankCapacityReconciliation,
    {
      accountId: "account_bank",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    },
  );

  expect(capacity.status).toBe("complete");
  expect(capacity.unmatchedSource).toEqual([]);
  expect(capacity.unmatchedLedger).toEqual([]);

  const declaration = await evidence(
    "Synthetic closing inventory declaration",
    JSON.stringify({ synthetic: true, accounts: ["account_bank"] }),
  );

  const inventoryInput = {
    evidenceId: declaration.id,
    bankAccountIds: ["account_bank"],
    families: families.map((family) => ({
      family,
      status: family === "bank_sources" ? "required" : "not_applicable",
      reviewedOn: "2026-10-08",
      evidenceId: declaration.id,
      rationale: "Explicit synthetic family declaration; no company completeness assertion",
    })),
  };

  const inventory = await call(
    `${path}/periods/period_synthetic_2026/closing-source-inventories`,
    Closing.ClosingInventory,
    inventoryInput,
  );

  const coverage = await call(`${path}/bank-source-coverage`, Coverage.BankSourceCoverageReport, {
    inventoryId: inventory.id,
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
  });

  const accountPlan = await call(`${path}/bank-signoff-plans`, AccountSignoffs.BankSignoffPlan, {
    coverageReportId: coverage.id,
    reconciliationId: capacity.id,
  });

  const review = await evidence(
    "Synthetic bank inventory review",
    JSON.stringify({ synthetic: true, reviewed: inventory.id }),
  );

  const accountSignoff = await call(
    `${path}/bank-signoff-plans/${accountPlan.id}/sign`,
    AccountSignoffs.BankReconciliationSignoff,
    {
      version: 1,
      digest: accountPlan.digest,
      evidenceId: review.id,
      rationale: "Synthetic account review only",
    },
  );

  const plan = await call(
    `${path}/bank-inventory-signoff-plans`,
    Signoffs.BankInventorySignoffPlan,
    {
      inventoryId: inventory.id,
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      signoffPlanIds: [accountPlan.id],
    },
  );

  const signed = await call(
    `${path}/bank-inventory-signoff-plans/${plan.id}/sign`,
    Signoffs.BankInventorySignoff,
    {
      version: 1,
      digest: plan.digest,
      evidenceId: review.id,
      rationale: "Synthetic whole declared bank inventory review only",
    },
  );

  const view = await call(
    `${path}/bank-inventory-signoff-plans/${plan.id}`,
    Signoffs.BankInventorySignoffView,
  );

  const current = await call(`/firms/${firm.firmId}/portfolio`, Firms.Portfolio);
  const retained = current.clients[0]?.bankInventorySignoffs[0];

  if (!view.signedArtifact || !retained)
    throw new Error("The signed inventory and its artifact must remain recoverable");

  expect(view.dependenciesCurrent).toBe(true);
  expect(retained.id).toBe(plan.id);
  expect(retained.accountIds).toEqual(["account_bank"]);
  expect(retained.signedAt).toBe(signed.signedAt);
  expect(retained.dependenciesCurrent).toBe(true);
  expect(retained.reviewScope).toBe("whole_declared_bank_inventory");
  expect(retained.coverage).toBe("declared_inventory_only");
  expect(retained.companyCompleteness).toBe("not_established");
  expect(retained.financialCloseReady).toBe(false);
  expect(retained.signedArtifact).toEqual({
    sha256: view.signedArtifact.sha256,
    byteLength: view.signedArtifact.byteLength,
  });
  expect(createHash("sha256").update(view.signedArtifact.content).digest("hex")).toBe(
    view.signedArtifact.sha256,
  );

  await app.open(portfolioUrl);
  await expect(bank.getByText("Avstämd", { exact: true })).toBeVisible();
  await app.screenshot("portfolio-current-bank-inventory");

  const report = await call(`${path}/report-snapshots`, Reports.ReportSnapshot, {
    kind: "trial_balance_v1",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
  });

  expect(report.balanced).toBe(true);
  expect(report.sequence).toBe(before.sequence);
  expect(await call(`${path}/report-snapshots/${report.id}`, Reports.ReportSnapshot)).toEqual(
    report,
  );

  const ready = await call(
    `${path}/periods/period_synthetic_2026/closing-readiness`,
    Closing.ClosingReadiness,
  );

  expect(ready.checks.filter((check) => !check.passed)).toEqual([]);
  expect(ready.locked).toBe(false);
  expect(ready.technicalCloseAllowed).toBe(true);
  expect(ready.dependencies.reportId).toBe(report.id);
  expect(ready.statutoryReady).toBe(false);
  expect(ready.statutoryBlockers.length).toBeGreaterThan(0);

  await app.open(portfolioUrl);
  await expect(details.getByRole("heading", "Inga tekniska hinder", { exact: true })).toBeVisible();
  await expect(
    details.getByText(
      "Tekniska kontroller fastställer inte fullständiga böcker eller lagstadgat bokslut.",
      { exact: true },
    ),
  ).toBeVisible();
  await app.screenshot("portfolio-technically-clear");

  const proposal = await call(
    `${path}/periods/period_synthetic_2026/closing-proposals`,
    Closing.ClosingProposal,
    {
      action: "close",
      reason: "Synthetic portfolio technical lock qualification",
    },
  );

  const approval = await call(
    `${path}/closing-proposals/${proposal.id}/approvals`,
    Closing.ClosingApproval,
    { digest: proposal.digest },
  );

  const execution = { digest: proposal.digest, approvalId: approval.id };
  const executionKey = randomUUID();

  const receipt = await call(
    `${path}/closing-proposals/${proposal.id}/executions`,
    Closing.ClosingReceipt,
    execution,
    executionKey,
  );

  expect(
    await call(
      `${path}/closing-proposals/${proposal.id}/executions`,
      Closing.ClosingReceipt,
      execution,
      executionKey,
    ),
  ).toEqual(receipt);
  expect(receipt.locked).toBe(true);
  expect(receipt.statutoryReady).toBe(false);

  if (!receipt.certificateId) throw new Error("The technical lock must retain its certificate");

  const certificate = await call(
    `${path}/closing-certificates/${receipt.certificateId}`,
    Closing.ClosingCertificateView,
  );

  const history = await call(
    `${path}/periods/period_synthetic_2026/closing-history`,
    Closing.ClosingHistory,
  );

  const locked = await call(
    `${path}/periods/period_synthetic_2026/closing-readiness`,
    Closing.ClosingReadiness,
  );

  expect(certificate.current).toBe(true);
  expect(certificate.invalidatedBy).toBe(null);
  expect(certificate.certificate.receipt).toEqual(receipt);
  expect(certificate.certificate.effectiveDependencies).toEqual(locked.dependencies);
  expect(history.items.find((item) => item.id === receipt.id)).toEqual(receipt);
  expect(locked.locked).toBe(true);
  expect(locked.technicalCloseAllowed).toBe(false);

  await app.open(portfolioUrl);
  await expect(details.getByRole("heading", "Perioden är låst", { exact: true })).toBeVisible();
  await expect(screen.getByText("Inga tekniska hinder", { exact: true })).toHaveCount(0);
  await app.screenshot("portfolio-locked-period");

  const replacementEvidence = await evidence(
    "Synthetic replacement inventory review",
    JSON.stringify({ synthetic: true, replaces: inventory.id }),
  );

  const replacement = await call(
    `${path}/periods/period_synthetic_2026/closing-source-inventories`,
    Closing.ClosingInventory,
    {
      ...inventoryInput,
      evidenceId: replacementEvidence.id,
      families: inventoryInput.families.map((family) => ({
        ...family,
        evidenceId: replacementEvidence.id,
      })),
    },
  );

  const staleView = await call(
    `${path}/bank-inventory-signoff-plans/${plan.id}`,
    Signoffs.BankInventorySignoffView,
  );

  const stale = await call(`/firms/${firm.firmId}/portfolio`, Firms.Portfolio);

  const staleCertificate = await call(
    `${path}/closing-certificates/${receipt.certificateId}`,
    Closing.ClosingCertificateView,
  );

  expect(staleView.dependenciesCurrent).toBe(false);
  expect(staleView.signedArtifact).toEqual(view.signedArtifact);
  expect(staleCertificate.current).toBe(false);
  expect(staleCertificate.certificate).toEqual(certificate.certificate);
  expect(stale.clients[0]?.bankInventorySignoffs[0]).toEqual({
    ...retained,
    dependenciesCurrent: false,
  });
  expect(await call(`${path}/ledger`, Accounting.LedgerSnapshot)).toEqual(before);

  await app.open(portfolioUrl);
  await expect(screen.getByText("Avstämd", { exact: true })).toHaveCount(0);
  await expect(bank).toContainText("Okänt");
  await agent.assert(
    "The client portfolio shows an unknown bank reconciliation state, with no reconciled label. Do not infer company completeness or financial closing readiness from the zero-activity synthetic account.",
  );
  await app.screenshot("portfolio-stale-bank-inventory");

  await writeFile(
    join(output, "firm-portfolio-bank.json"),
    JSON.stringify(
      {
        scope:
          "Real public synthetic statement/coverage/account/whole-inventory signing and retained portfolio observations",
        limits:
          "Synthetic technical clear/lock and bank currentness only; no full V1 parity, nonzero bank difference, multi-account or whole-company completeness, statutory closing or live provider qualification",
        before,
        early,
        finalStatement,
        historical,
        capacity,
        inventory,
        coverage,
        accountPlan,
        accountSignoff,
        plan,
        signed,
        view,
        current,
        report,
        ready,
        proposal,
        approval,
        receipt,
        certificate,
        history,
        locked,
        replacement,
        staleView,
        staleCertificate,
        stale,
      },
      null,
      2,
    ),
  );
});
