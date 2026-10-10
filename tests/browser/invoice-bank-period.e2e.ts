import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Settlement from "../../packages/contracts/src/settlements";
import * as Reversals from "../../packages/contracts/src/bank-match-reversals";
import * as Candidates from "../../packages/contracts/src/bank-match-candidates";
import * as Closing from "../../packages/contracts/src/closing";
import { bankReviewFixture } from "./bank-review-fixture";

test("partial bank matching refuses a stale approval and correction preserves the ledger before VAT and period review", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const fixture = await bankReviewFixture(browser, app.baseUrl);

  const plan = await fixture.call("/bank-allocation-plans", Settlement.BankAllocationPlan, {
    accountId: "account_bank",
    reason: "Synthetic partial matching review",
    ambiguityAcknowledged: true,
    legs: [
      {
        statementId: fixture.statement.statement.id,
        rowOrdinal: 1,
        voucherId: fixture.candidate.voucherId,
        lineId: fixture.candidate.lineId,
        amountMinor: "-50000",
      },
    ],
  });

  const approval = await fixture.call(
    `/bank-allocation-plans/${plan.id}/approve`,
    Settlement.BankAllocationApproval,
    { digest: plan.digest, version: plan.version },
  );

  await fixture.consume();

  const stale = await fixture.call(
    `/bank-allocation-plans/${plan.id}`,
    Settlement.BankAllocationView,
  );

  expect(stale.dependenciesCurrent).toBe(false);
  expect(stale.execution).toBeNull();
  expect(stale.approval?.id).toBe(approval.id);
  await app.open(`${fixture.path}&plan=${plan.id}`);
  await expect(screen.getByText("Underlaget har ändrats", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Bekräfta matchning", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("Godkänd för matchning", { exact: true })).toHaveCount(0);
  await app.screenshot("bank-stale-approved-partial-plan");

  const fresh = await fixture.call("/bank-allocation-plans", Settlement.BankAllocationPlan, {
    ...plan.input,
    reason: "Fresh review of remaining stored capacity",
  });

  const freshApproval = await fixture.call(
    `/bank-allocation-plans/${fresh.id}/approve`,
    Settlement.BankAllocationApproval,
    { digest: fresh.digest, version: fresh.version },
  );

  const before = await fixture.call("/ledger", Accounting.LedgerSnapshot);
  await app.open(`${fixture.path}&plan=${fresh.id}`);
  await agent.act(
    "Save the approved partial matching plan using Bekräfta matchning. Verify Matchning sparad. The transaction is expected to retain −750,00 SEK unmatched; this is a partial match.",
  );
  await expect(screen.getByText("Matchning sparad", { exact: true })).toBeVisible();

  const saved = await fixture.call(
    `/bank-allocation-plans/${fresh.id}`,
    Settlement.BankAllocationView,
  );

  expect(saved.execution?.approvalId).toBe(freshApproval.id);
  expect(saved.execution?.legs[0]?.amountMinor).toBe("-50000");

  const matched = await fixture.call("/bank-match-candidates", Candidates.BankMatchCandidates, {
    statementId: fixture.statement.statement.id,
    rowOrdinal: 1,
  });

  expect(matched.source.remainingMinor).toBe("-75000");
  expect(
    matched.candidates.find((item) => item.lineId === fixture.candidate.lineId)?.remainingMinor,
  ).toBe("-25000");
  expect(await fixture.call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);
  await expect(screen.getByRole("link", "Granska periodens moms", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Granska periodkontroller", { exact: true })).toBeVisible();
  await app.screenshot("bank-partial-match-saved");

  const reversal = await fixture.call(
    "/bank-match-reversal-plans",
    Reversals.BankMatchReversalPlan,
    {
      target: { kind: "allocation", allocationPlanId: fresh.id },
      reason: "Synthetic correction of the selected partial match",
    },
  );

  const reversalApproval = await fixture.call(
    `/bank-match-reversal-plans/${reversal.id}/approve`,
    Reversals.BankMatchReversalApproval,
    { digest: reversal.digest, version: reversal.version },
  );

  await fixture.call(
    `/bank-match-reversal-plans/${reversal.id}/execute`,
    Reversals.BankMatchReversalExecution,
    { digest: reversal.digest, version: reversal.version, approvalId: reversalApproval.id },
  );
  await browser.reload();
  await expect(screen.getByText("Ångrad", { exact: true })).toBeVisible();

  const corrected = await fixture.call("/bank-match-candidates", Candidates.BankMatchCandidates, {
    statementId: fixture.statement.statement.id,
    rowOrdinal: 1,
  });

  expect(corrected.source.remainingMinor).toBe("-125000");
  expect(
    corrected.candidates.find((item) => item.lineId === fixture.candidate.lineId)?.remainingMinor,
  ).toBe("-75000");
  expect(await fixture.call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);
  await app.screenshot("bank-partial-match-corrected");

  await screen.getByRole("link", "Granska periodens moms", { exact: true }).press("Enter");
  expect(await browser.url()).toContain("view=actual-vat");
  await screen.getByText("Granska periodens underlag", { exact: true }).click();
  await expect(screen.getByRole("link", "Granska periodkontroller", { exact: true })).toBeVisible();
  await screen.getByRole("link", "Granska periodkontroller", { exact: true }).press("Enter");
  expect(new URL(await browser.url()).pathname).toBe(
    `${new URL(fixture.workspace).pathname}/closing`,
  );

  const readiness = await fixture.call(
    "/periods/period_synthetic_2026/closing-readiness",
    Closing.ClosingReadiness,
  );

  expect(readiness.statutoryReady).toBe(false);
  await app.screenshot("period-controls-after-bank-correction");
  await writeFile(
    join(output, "invoice-bank-period-results.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        plan,
        approval,
        stale,
        fresh,
        saved,
        matched,
        reversal,
        corrected,
        readiness,
        ledgerUnchanged: true,
      },
      null,
      2,
    ),
  );
});
