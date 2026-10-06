import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import type * as Schema from "effect/Schema";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Payroll from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Foundation from "@open-erp/contracts/payroll-foundation";
import * as PostingRecovery from "@open-erp/contracts/posting-recovery";
import * as Onboarding from "@open-erp/contracts/onboarding";
import {
  environment,
  failure,
  key,
  post,
  request,
  decoded,
  database,
  fixture,
} from "./support/fixtures";
import { proveReminderRecovery } from "./support/reminder-recovery";
import {
  mileageFixture,
  readyMileageCorrection,
  recoveryCash,
  retainMileageSource,
} from "./support/mileage-corrections";

async function replayPost<S extends Schema.Top & { readonly DecodingServices: never }>(
  book: Parameters<typeof request>[0],
  path: string,
  input: unknown,
  schema: S,
  idempotencyKey: string,
): Promise<S["Type"]> {
  return decoded(
    await request(book, path, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
    }),
    schema,
  );
}

test("paid mileage retains exact correction, submits without posting, recovers6600 and amends only1100", async () => {
  const f = await mileageFixture();
  const view = await readyMileageCorrection(f);

  if (!f.paid) throw new Error("Missing actual paid event");

  expect(view.original.reference).toBe("MIL-2026-0012");
  expect(view.original.paidOn).toBe("2026-09-25");
  expect(view.original.consumedRunId).toBe(f.run.id);
  expect(view.original.release.entitlementRateMinorPerUnit).toBe("300");
  expect(view.original.release.taxExemptRateMinorPerUnit).toBe("250");
  expect(view.comparison).toMatchObject({
    entitlementDeltaMinor: "-6600",
    exemptDeltaMinor: "-5500",
    taxableDeltaMinor: "-1100",
    contributionCorrectionMinor: "-346",
    contributionIncludedInJournal: false,
  });
  expect(
    view.journal?.lines.map(({ accountId, debitMinor, creditMinor }) => ({
      accountId,
      debitMinor,
      creditMinor,
    })),
  ).toEqual([
    { accountId: "employee_recovery", debitMinor: "6600", creditMinor: "0" },
    { accountId: "mileage_expense", debitMinor: "0", creditMinor: "5500" },
    { accountId: "mileage_taxable", debitMinor: "0", creditMinor: "1100" },
  ]);

  const review = view.settlementReview;

  if (!review) throw new Error("Missing ready settlement review");

  await failure(
    await request(f.reviewer, `/payroll/settlement-reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest }),
    }),
    403,
    "ApprovalRequired",
  );

  const submissionKey = key();

  const submitted = await replayPost(
    f.book,
    `/payroll/mileage-corrections/${view.proposal.id}/submissions`,
    {
      proposalDigest: view.proposal.digest,
      reviewDigest: review.digest,
    },
    Mileage.MileageCorrectionView,
    submissionKey,
  );

  expect(submitted.current.status).toBe("submitted");
  expect(submitted.execution).toBeNull();
  expect(submitted.current.recoveryClaimId).toBeNull();
  expect(
    await replayPost(
      f.book,
      `/payroll/mileage-corrections/${view.proposal.id}/submissions`,
      {
        proposalDigest: view.proposal.digest,
        reviewDigest: review.digest,
      },
      Mileage.MileageCorrectionView,
      submissionKey,
    ),
  ).toEqual(submitted);

  await failure(
    await request(f.book, `/payroll/settlement-reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest }),
    }),
    403,
    "ApprovalRequired",
  );

  const approval = await post(
    f.approver ?? f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    {
      reviewDigest: review.digest,
    },
    Settlement.SettlementApproval,
  );

  const executeKey = key();

  const execution = await replayPost(
    f.book,
    `/payroll/settlement-reviews/${review.id}/executions`,
    {
      reviewDigest: review.digest,
      approvalId: approval.id,
    },
    Settlement.SettlementExecution,
    executeKey,
  );

  expect(execution.recoveryClaim).toMatchObject({
    claimedGrossMinor: "1100",
    receivableMinor: "6600",
  });
  expect(execution.remainingReceivableMinor).toBe("6600");
  expect(
    await replayPost(
      f.book,
      `/payroll/settlement-reviews/${review.id}/executions`,
      {
        reviewDigest: review.digest,
        approvalId: approval.id,
      },
      Settlement.SettlementExecution,
      executeKey,
    ),
  ).toEqual(execution);

  const claim = execution.recoveryClaim;

  if (!claim) throw new Error("Missing employee recovery claim");

  const cash = await recoveryCash(f, claim.id, "6600");

  const correctedPeriod = await post(
    f.book,
    "/payroll/periods",
    {
      reportingPeriod: "2026-09",
      evidenceId: f.source.id,
    },
    Settlement.PayrollPeriod,
  );

  expect(cash.remainingReceivableMinor).toBe("0");
  expect(correctedPeriod.totals.grossMinor).toBe("4207600");
  expect(correctedPeriod.contributionCorrectionMinor).toBe("-346");
  expect(correctedPeriod.items[0]?.specificationNumber).toBe(f.paid.specificationNumber);
  expect(correctedPeriod.items[0]?.withholdingMinor).toBe("900000");
  expect(await f.originalHistory()).toEqual(f.history);

  const discovered = await decoded(
    await request(f.book, "/payroll/mileage-corrections?limit=1"),
    Mileage.MileageCorrectionPage,
  );

  expect(discovered.items[0]?.id).toBe(view.proposal.id);
  await writeFile(
    join(environment().artifacts, "r41-mileage-correction-proof.json"),
    JSON.stringify(
      {
        expectations: {
          salary: "4200100",
          originalGross: "4208700",
          revisedGross: "4207600",
          originalContribution: "1322374",
          revisedContribution: "1322028",
          receivable: "6600",
          taxable: "1100",
        },
        view,
        submitted,
        approval,
        execution,
        cash,
        correctedPeriod,
        originalHistory: f.history,
      },
      null,
      2,
    ),
  );
});

test("mileage aggregate contribution difference is345 when independently rounded paid totals differ", async () => {
  const f = await mileageFixture({ salaryMinor: "4200000" });
  const view = await readyMileageCorrection(f);

  expect(view.comparison?.contributionWitness.originalContributionMinor).toBe("1322342");
  expect(view.comparison?.contributionWitness.revisedContributionMinor).toBe("1321997");
  expect(view.comparison?.contributionCorrectionMinor).toBe("-345");
});

test("unpaid mileage and incomplete sources remain retained blocked proposals", async () => {
  const f = await mileageFixture({ pay: false });

  const view = await post(
    f.book,
    "/payroll/mileage-corrections",
    {
      ...f.proposalInput,
      routeSource: null,
      recoveryBasisSource: null,
      recoveryReason: null,
    },
    Mileage.MileageCorrectionView,
  );

  expect(view.current.status).toBe("blocked");
  expect(view.original.paidEventId).toBeNull();
  expect(view.current.canSubmit).toBe(false);
  expect(view.current.blockers.map(({ code }) => code)).toEqual(
    expect.arrayContaining(["PaidSourceMissing", "RouteEvidenceMissing", "RecoveryBasisMissing"]),
  );
  expect(
    await decoded(
      await request(f.book, `/payroll/mileage-corrections/${view.proposal.id}`),
      Mileage.MileageCorrectionView,
    ),
  ).toEqual(view);
});

test("cancelled mileage proposal retains source history and refuses approval", async () => {
  const f = await mileageFixture();
  const view = await readyMileageCorrection(f);
  const review = view.settlementReview;

  if (!review) throw new Error("Missing ready review");

  const cancelled = await post(
    f.book,
    `/payroll/mileage-corrections/${view.proposal.id}/cancellations`,
    {
      proposalDigest: view.proposal.digest,
    },
    Mileage.MileageCorrectionView,
  );

  expect(cancelled.current.status).toBe("cancelled");
  expect(cancelled.proposal).toEqual(view.proposal);
  expect(cancelled.current.canSubmit).toBe(false);
  await failure(
    await request(f.reviewer, `/payroll/settlement-reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest }),
    }),
    403,
    "ApprovalRequired",
  );
});

test("reused revision, wrong predecessor and unreviewed route cannot prepare financial authority", async () => {
  const f = await mileageFixture();

  for (const trip of [
    {
      ...f.proposalInput.revisedTrip,
      id: f.proposalInput.revisedTrip.previousRevision ?? "missing_revision",
    },
    { ...f.proposalInput.revisedTrip, previousRevision: "another_revision" },
    { ...f.proposalInput.revisedTrip, routeReviewed: false },
  ]) {
    const view = await post(
      f.book,
      "/payroll/mileage-corrections",
      { ...f.proposalInput, revisedTrip: trip },
      Mileage.MileageCorrectionView,
    );

    expect(view.current.status).toBe("blocked");
    expect(view.settlementReview).toBeNull();
  }
});

async function executeCorrection(
  f: Awaited<ReturnType<typeof mileageFixture>>,
  view: typeof Mileage.MileageCorrectionView.Type,
) {
  const review = view.settlementReview;

  if (!review) throw new Error("Missing ready correction review");

  await post(
    f.book,
    `/payroll/mileage-corrections/${view.proposal.id}/submissions`,
    {
      proposalDigest: view.proposal.digest,
      reviewDigest: review.digest,
    },
    Mileage.MileageCorrectionView,
  );

  const approval = await post(
    f.approver ?? f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    {
      reviewDigest: review.digest,
    },
    Settlement.SettlementApproval,
  );

  return post(
    f.book,
    `/payroll/settlement-reviews/${review.id}/executions`,
    {
      reviewDigest: review.digest,
      approvalId: approval.id,
    },
    Settlement.SettlementExecution,
  );
}

test("qualified future net offset consumes receivable6600 once while future gross and paid reporting stay unchanged", async () => {
  const f = await mileageFixture({ assignedApprover: true });

  await failure(await request(f.book, "/onboarding"), 404, "NotFound");
  const corrected = await readyMileageCorrection(f);
  const originalCorrection = await executeCorrection(f, corrected);
  const claim = originalCorrection.recoveryClaim;
  const paidEmployee = f.run.employees[0];

  if (!claim || !paidEmployee) throw new Error("Missing retained correction and employee");

  const lawful = await post(
    f.reviewer,
    "/payroll/adjustment-bases",
    {
      comparisonId: claim.comparisonId,
      recoveryClaimId: claim.id,
      kind: "future_pay",
      evidenceId: f.basis.evidence.id,
      reason: "Independent synthetic consent to recover from October net salary",
    },
    Settlement.AdjustmentBasis,
  );

  const offset = await post(
    f.book,
    "/payroll/settlement-reviews",
    {
      kind: "future_pay",
      recoveryClaimId: claim.id,
      comparisonId: claim.comparisonId,
      lawfulBasisId: lawful.id,
      recoveryReceivableAccountId: null,
      futureMonth: "2026-10",
      evidenceId: f.basis.evidence.id,
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-03",
      series: "L",
      reason: lawful.input.reason,
    },
    Settlement.SettlementReview,
  );

  expect(offset.outputs.amountMinor).toBe("6600");
  expect(offset.outputs.signedGrossDeltaMinor).toBe("0");
  expect(offset.postingPlan).toBeNull();

  for (const actor of [f.book, f.reviewer]) {
    await failure(
      await request(actor, `/payroll/settlement-reviews/${offset.id}/approvals`, {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify({ reviewDigest: offset.digest }),
      }),
      403,
      "ApprovalRequired",
    );
  }

  if (!f.approver || !f.assignedResponsibilities)
    throw new Error("Missing retained assigned financial authority");

  const reassigned = await post(
    f.book,
    "/onboarding/responsibilities",
    {
      expectedRevision: f.assignedResponsibilities.revision,
      assignments: {
        ...f.assignedResponsibilities.assignments,
        bookkeepingApproverId: f.reviewer.actorId,
      },
    },
    Onboarding.OnboardingResponsibilities,
  );

  await failure(
    await request(f.approver, `/payroll/settlement-reviews/${offset.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: offset.digest }),
    }),
    403,
    "ApprovalRequired",
  );

  const restoredAssignment = await post(
    f.book,
    "/onboarding/responsibilities",
    {
      expectedRevision: reassigned.revision,
      assignments: f.assignedResponsibilities.assignments,
    },
    Onboarding.OnboardingResponsibilities,
  );

  const approval = await post(
    f.approver,
    `/payroll/settlement-reviews/${offset.id}/approvals`,
    {
      reviewDigest: offset.digest,
    },
    Settlement.SettlementApproval,
  );

  const changedAssignment = await post(
    f.book,
    "/onboarding/responsibilities",
    {
      expectedRevision: restoredAssignment.revision,
      assignments: { ...restoredAssignment.assignments, bookkeepingApproverId: f.reviewer.actorId },
    },
    Onboarding.OnboardingResponsibilities,
  );

  await failure(
    await request(f.book, `/payroll/settlement-reviews/${offset.id}/executions`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: offset.digest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  await post(
    f.book,
    "/onboarding/responsibilities",
    {
      expectedRevision: changedAssignment.revision,
      assignments: restoredAssignment.assignments,
    },
    Onboarding.OnboardingResponsibilities,
  );

  const retainedOffset = await post(
    f.book,
    `/payroll/settlement-reviews/${offset.id}/executions`,
    {
      reviewDigest: offset.digest,
      approvalId: approval.id,
    },
    Settlement.SettlementExecution,
  );

  const instruction = retainedOffset.instruction;

  if (!instruction) throw new Error("Missing retained offset instruction");

  expect(instruction.netRecovery).toMatchObject({
    claimId: claim.id,
    amountMinor: "6600",
    receivableAccountId: "employee_recovery",
  });

  const original = paidEmployee.calculation.basis;
  const revisions = [];

  for (const [kind, body] of [
    [
      "employment",
      {
        personRef: "Anders Berg",
        jurisdiction: "QY",
        residency: "Synthetic",
        payTerms: "Synthetic monthly salary",
        workSchedule: "Synthetic October month",
        taxFacts: "Synthetic fixed withholding",
      },
    ],
    [
      "work",
      { periodStart: "2026-10-01", periodEnd: "2026-10-31", inputs: ["Synthetic October work"] },
    ],
    ["opening", { asOf: "2026-10-01", balanceMinor: "0", obligation: "r41_contribution" }],
  ] as const) {
    revisions.push(
      await post(
        f.book,
        "/payroll/revisions",
        {
          employeeId: paidEmployee.calculation.employeeId,
          kind,
          supersedes: null,
          effectiveOn: "2026-10-01",
          evidenceId: f.source.id,
          body,
        },
        Foundation.PayrollRevision,
      ),
    );
  }

  const employmentRevision = revisions[0];
  const workRevision = revisions[1];

  if (!employmentRevision || !workRevision) throw new Error("Missing October source revisions");

  const calculation = await post(
    f.book,
    "/payroll/calculations",
    {
      recordClass: "synthetic",
      adjustmentIds: [instruction.id],
      inputIds: [],
      employment: {
        ...original.reviewedInput.employment,
        effectiveRevision: employmentRevision.id,
      },
      work: {
        ...original.reviewedInput.work,
        effectiveRevision: workRevision.id,
        earningsPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
        expectedPaymentOn: "2026-10-25",
        adjustments: [],
        reimbursements: [],
      },
      reason: "Qualified post-tax October recovery",
    },
    Payroll.PayrollCalculation,
  );

  expect(calculation.calculation.grossMinor).toBe("4200100");
  expect(calculation.calculation.netDeductionMinor).toBe("16600");
  expect(calculation.calculation.withholdingMinor).toBe("900000");
  expect(calculation.calculation.contributionBaseMinor).toBe("4200100");
  expect(calculation.calculation.payableMinor).toBe("3283500");

  const run = await post(
    f.book,
    "/payroll/runs",
    {
      ...f.run.input,
      calculationIds: [calculation.id],
      postingDate: "2026-10-25",
      reason: "October qualified net recovery payroll",
    },
    Runs.PayrollRun,
  );

  const netApproval = await post(
    f.approver ?? f.reviewer,
    `/payroll/runs/${run.id}/approvals`,
    {
      runDigest: run.digest,
    },
    Runs.PayrollRunApproval,
  );

  const commandKey = key();

  const netRun = await replayPost(
    f.book,
    `/payroll/runs/${run.id}/executions`,
    {
      runDigest: run.digest,
      approvalId: netApproval.id,
    },
    Runs.PayrollRunExecution,
    commandKey,
  );

  expect(
    await replayPost(
      f.book,
      `/payroll/runs/${run.id}/executions`,
      {
        runDigest: run.digest,
        approvalId: netApproval.id,
      },
      Runs.PayrollRunExecution,
      commandKey,
    ),
  ).toEqual(netRun);

  const current = await decoded(
    await request(f.book, `/payroll/mileage-corrections/${corrected.proposal.id}`),
    Mileage.MileageCorrectionView,
  );

  expect(current.current.remainingReceivableMinor).toBe("0");

  const period = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-09", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  expect(period.totals.grossMinor).toBe("4207600");
  expect(period.contributionCorrectionMinor).toBe("-346");
  expect(
    run.postingPlan.groups
      .flatMap((group) => group.actions.flatMap((action) => action.lines))
      .filter((line) => line.accountId === "employee_recovery"),
  ).toMatchObject([{ debitMinor: "0", creditMinor: "6600" }]);
  await writeFile(
    join(environment().artifacts, "r41-net-pay-recovery-proof.json"),
    JSON.stringify(
      { originalCorrection, retainedOffset, calculation, run, netRun, current, period },
      null,
      2,
    ),
  );
});

test("second executed mileage revision uses150 to140 incremental lineage and cumulative paid reporting", async () => {
  const f = await mileageFixture();
  const first = await readyMileageCorrection(f);
  const firstExecution = await executeCorrection(f, first);

  const route = await retainMileageSource(f.book, "Reviewed140km route.pdf", [
    "Synthetic independent third revision",
    "MIL-2026-0012 Anders Berg",
    "Distance140km",
  ]);

  const basis = await retainMileageSource(f.book, "Reviewed140km employee attestation.pdf", [
    "Independent synthetic employee attestation",
    "Correct distance140km",
    "Qualified correction of previous150km route",
  ]);

  const proposalInput: typeof Mileage.PrepareMileageCorrection.Type = {
    ...f.proposalInput,
    previousCorrectionExecutionId: firstExecution.id,
    revisedTrip: {
      ...f.proposalInput.revisedTrip,
      id: "mil_2026_0012_r3",
      previousRevision: f.proposalInput.revisedTrip.id,
      distanceInMeters: "140000",
      routeEvidenceRef: route.occurrence.id,
    },
    routeSource: { occurrenceId: route.occurrence.id, sha256: route.occurrence.sha256 },
    recoveryBasisSource: { occurrenceId: basis.occurrence.id, sha256: basis.occurrence.sha256 },
    recoveryReason: "Independent attestation corrects the preceding150km route to140km",
  };

  const second = await readyMileageCorrection({ ...f, basis, proposalInput });

  expect(second.original.trip.distanceInMeters).toBe("172000");
  expect(second.comparison).toMatchObject({
    predecessorDistanceMeters: "150000",
    revisedDistanceMeters: "140000",
    distanceDeltaMeters: "-10000",
    entitlementDeltaMinor: "-3000",
    exemptDeltaMinor: "-2500",
    taxableDeltaMinor: "-500",
  });
  expect(second.journal).toMatchObject({ receivableMinor: "3000", claimedGrossMinor: "500" });
  const execution = await executeCorrection(f, second);

  const corrected = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-09", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  expect(corrected.totals.grossMinor).toBe("4207100");
  expect(corrected.contributionCorrectionMinor).toBe("-503");
  expect(await f.originalHistory()).toEqual(f.history);

  const stale = await post(
    f.book,
    "/payroll/mileage-corrections",
    { ...proposalInput, previousCorrectionExecutionId: firstExecution.id },
    Mileage.MileageCorrectionView,
  );

  expect(stale.current.blockers.map((row) => row.code)).toContain("StalePredecessor");
  expect(stale.current.canSubmit).toBe(false);
  await writeFile(
    join(environment().artifacts, "r41-successor-proof.json"),
    JSON.stringify({ first, firstExecution, second, execution, corrected, stale }, null, 2),
  );
});

test("current recovery inventory retains executed successor, blocked review, submission and cancellation in a fenced restore", async () => {
  const f = await mileageFixture();

  const blocked = await post(
    f.book,
    "/payroll/mileage-corrections",
    { ...f.proposalInput, routeSource: null },
    Mileage.MileageCorrectionView,
  );

  const cancelled = await readyMileageCorrection(f);
  await post(
    f.book,
    `/payroll/mileage-corrections/${cancelled.proposal.id}/cancellations`,
    { proposalDigest: cancelled.proposal.digest },
    Mileage.MileageCorrectionView,
  );
  const submitted = await readyMileageCorrection(f);

  if (!submitted.settlementReview) throw new Error("Missing retained submission review");

  await post(
    f.book,
    `/payroll/mileage-corrections/${submitted.proposal.id}/submissions`,
    {
      proposalDigest: submitted.proposal.digest,
      reviewDigest: submitted.settlementReview.digest,
    },
    Mileage.MileageCorrectionView,
  );
  const executed = await readyMileageCorrection(f);
  const execution = await executeCorrection(f, executed);
  const recovered = (await proveReminderRecovery(f.book.bookId, [7]))[0];

  if (!recovered || recovered.inventory.version !== 7)
    throw new Error("Current mileage recovery inventory missing");

  expect(recovered.restoredInventory).toEqual(recovered.inventory);
  expect(recovered.inspection.durableWork).toBe("matched");
  expect(recovered.receipt.durableWork?.inventoryVerification).toBe("matched");
  expect(recovered.suspension.resumeAllowed).toBe(false);
  expect(recovered.fence).toEqual({ allowConnections: false, connectionLimit: 0 });

  const represented = recovered.inventory.mileageCorrectionRecords.filter(
    (row) => row.bookId === f.book.bookId,
  );

  expect(
    represented.map((row) => row.table).sort((left, right) => left.localeCompare(right)),
  ).toEqual(
    [
      ...Array(4).fill("payroll_mileage_correction_proposals"),
      ...Array(3).fill("payroll_mileage_correction_review_links"),
      ...Array(2).fill("payroll_mileage_correction_submissions"),
      "payroll_mileage_correction_cancellations",
    ].sort((left, right) => left.localeCompare(right)),
  );
  expect(
    recovered.inventory.mileageCorrectionSuccessors.filter((row) => row.bookId === f.book.bookId),
  ).toMatchObject([
    {
      executionId: execution.id,
      proposalId: executed.proposal.id,
      previousExecutionId: null,
      originalInputId: f.input.id,
    },
  ]);
  await writeFile(
    join(environment().artifacts, "r41-mileage-recovery-inventory-proof.json"),
    JSON.stringify({ blocked, cancelled, submitted, executed, execution, recovered }, null, 2),
  );
}, 180000);

test("ordinary salary recovery preserves executed mileage population and stale earlier comparisons refuse", async () => {
  const f = await mileageFixture();
  const originalEmployee = f.run.employees[0];

  if (!f.paid || !originalEmployee) throw new Error("Missing paid source");

  const comparisonInput = {
    ...originalEmployee.calculation.basis.reviewedInput,
    employment: {
      ...originalEmployee.calculation.basis.reviewedInput.employment,
      monthlyCashSalary: "4190100",
    },
  };

  const earlier = await post(
    f.book,
    `/payroll/paid-events/${f.paid.id}/comparisons`,
    comparisonInput,
    Settlement.CorrectionComparison,
  );

  const mileage = await readyMileageCorrection(f);
  const mileageExecution = await executeCorrection(f, mileage);

  await failure(
    await request(f.reviewer, "/payroll/adjustment-bases", {
      method: "POST",
      body: JSON.stringify({
        comparisonId: earlier.id,
        kind: "gross_recovery",
        evidenceId: f.source.id,
        reason: "Independent ordinary salary correction",
      }),
    }),
    409,
    "StaleDependency",
  );

  const current = await post(
    f.book,
    `/payroll/paid-events/${f.paid.id}/comparisons`,
    comparisonInput,
    Settlement.CorrectionComparison,
  );

  expect(current.calculation.grossMinor).toBe("4197600");
  expect(current.mileageCorrections?.[0]?.split.taxablePartMinor).toBe("7500");

  const lawful = await post(
    f.reviewer,
    "/payroll/adjustment-bases",
    {
      comparisonId: current.id,
      kind: "gross_recovery",
      evidenceId: f.source.id,
      reason: "Independent ordinary salary correction",
    },
    Settlement.AdjustmentBasis,
  );

  const review = await post(
    f.book,
    "/payroll/settlement-reviews",
    {
      kind: "gross_recovery",
      comparisonId: current.id,
      lawfulBasisId: lawful.id,
      recoveryReceivableAccountId: "employee_recovery",
      futureMonth: null,
      evidenceId: f.source.id,
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-03",
      series: "L",
      reason: lawful.input.reason,
    },
    Settlement.SettlementReview,
  );

  expect(review.outputs.amountMinor).toBe("10000");

  const approval = await post(
    f.approver ?? f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Settlement.SettlementApproval,
  );

  const ordinary = await post(
    f.book,
    `/payroll/settlement-reviews/${review.id}/executions`,
    { reviewDigest: review.digest, approvalId: approval.id },
    Settlement.SettlementExecution,
  );

  const period = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-09", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  expect(period.totals.grossMinor).toBe("4197600");
  expect(period.contributionCorrectionMinor).toBe("-3488");
  expect(await f.originalHistory()).toEqual(f.history);
  await writeFile(
    join(environment().artifacts, "r41-mixed-recovery-proof.json"),
    JSON.stringify({ earlier, mileageExecution, current, ordinary, period }, null, 2),
  );
});

test("cancellation races execution with exactly one retained terminal consequence", async () => {
  const f = await mileageFixture();
  const view = await readyMileageCorrection(f);
  const review = view.settlementReview;

  if (!review) throw new Error("Missing ready correction review");

  await post(
    f.book,
    `/payroll/mileage-corrections/${view.proposal.id}/submissions`,
    { proposalDigest: view.proposal.digest, reviewDigest: review.digest },
    Mileage.MileageCorrectionView,
  );

  const approval = await post(
    f.approver ?? f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Settlement.SettlementApproval,
  );

  const outcomes = await Promise.all([
    request(f.book, `/payroll/settlement-reviews/${review.id}/executions`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest, approvalId: approval.id }),
    }),
    request(f.book, `/payroll/mileage-corrections/${view.proposal.id}/cancellations`, {
      method: "POST",
      body: JSON.stringify({ proposalDigest: view.proposal.digest }),
    }),
  ]);

  expect(outcomes.map((row) => row.status)).toEqual(
    outcomes[0]?.status === 200 ? [200, 409] : [403, 200],
  );

  const result = await decoded(
    await request(f.book, `/payroll/mileage-corrections/${view.proposal.id}`),
    Mileage.MileageCorrectionView,
  );

  expect(Boolean(result.execution)).not.toBe(Boolean(result.cancellation));
  expect(await f.originalHistory()).toEqual(f.history);
  await writeFile(
    join(environment().artifacts, "r41-cancel-execute-race-proof.json"),
    JSON.stringify(
      { outcomes: await Promise.all(outcomes.map((row) => row.json())), result },
      null,
      2,
    ),
  );
});

test("revoked independent approver payroll access makes approval unusable and refuses posting", async () => {
  const f = await mileageFixture();
  const view = await readyMileageCorrection(f);
  const review = view.settlementReview;

  if (!review) throw new Error("Missing ready correction review");

  await post(
    f.book,
    `/payroll/mileage-corrections/${view.proposal.id}/submissions`,
    { proposalDigest: view.proposal.digest, reviewDigest: review.digest },
    Mileage.MileageCorrectionView,
  );

  const approval = await post(
    f.approver ?? f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Settlement.SettlementApproval,
  );

  await post(
    f.book,
    "/payroll/access",
    {
      actorId: f.reviewer.actorId,
      allowed: false,
    },
    Foundation.PayrollAccessResult,
  );

  const current = await decoded(
    await request(f.book, `/payroll/mileage-corrections/${view.proposal.id}`),
    Mileage.MileageCorrectionView,
  );

  expect(current.current.approvalUsable).toBe(false);
  expect(current.execution).toBeNull();
  await failure(
    await request(f.book, `/payroll/settlement-reviews/${review.id}/executions`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  await writeFile(
    join(environment().artifacts, "r41-current-approver-proof.json"),
    JSON.stringify({ approval, current }, null, 2),
  );
});

async function preparedNetRecovery() {
  const f = await mileageFixture({ assignedApprover: true });
  const corrected = await readyMileageCorrection(f);
  const sourceExecution = await executeCorrection(f, corrected);
  const claim = sourceExecution.recoveryClaim;

  if (!claim || !f.approver) throw new Error("Missing claim and assigned independent approver");

  const lawful = await post(
    f.reviewer,
    "/payroll/adjustment-bases",
    {
      comparisonId: claim.comparisonId,
      recoveryClaimId: claim.id,
      kind: "future_pay",
      evidenceId: f.basis.evidence.id,
      reason: "Independent synthetic net salary consent",
    },
    Settlement.AdjustmentBasis,
  );

  const input = {
    kind: "future_pay" as const,
    recoveryClaimId: claim.id,
    comparisonId: claim.comparisonId,
    lawfulBasisId: lawful.id,
    recoveryReceivableAccountId: null,
    futureMonth: "2026-10",
    evidenceId: f.basis.evidence.id,
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-03",
    series: "L",
    reason: lawful.input.reason,
  };

  const review = await post(
    f.book,
    "/payroll/settlement-reviews",
    input,
    Settlement.SettlementReview,
  );

  const approval = await post(
    f.approver,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    {
      reviewDigest: review.digest,
    },
    Settlement.SettlementApproval,
  );

  const executed = await post(
    f.book,
    `/payroll/settlement-reviews/${review.id}/executions`,
    {
      reviewDigest: review.digest,
      approvalId: approval.id,
    },
    Settlement.SettlementExecution,
  );

  const view = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${review.id}`),
    Settlement.SettlementView,
  );

  if (!view.netInstruction) throw new Error("Missing discoverable retained NET instruction");

  return { f, corrected, claim, input, review, executed, state: view.netInstruction };
}

async function futureNetInput(
  f: Awaited<ReturnType<typeof mileageFixture>>,
  instructionId: string,
  salaryMinor = "4200100",
  month = "2026-10",
) {
  const original = f.run.employees[0]?.calculation.basis;

  if (!original) throw new Error("Missing original retained paid basis");
  const revisions = [];
  const startsOn = `${month}-01`;

  const endsOn = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
    .toISOString()
    .slice(0, 10);

  for (const [kind, body] of [
    [
      "employment",
      {
        personRef: "Anders Berg",
        jurisdiction: "QY",
        residency: "Synthetic",
        payTerms: "Synthetic salary",
        workSchedule: "Synthetic October",
        taxFacts: "Synthetic fixed withholding",
      },
    ],
    ["work", { periodStart: startsOn, periodEnd: endsOn, inputs: ["Synthetic October"] }],
    ["opening", { asOf: startsOn, balanceMinor: "0", obligation: "r41_contribution" }],
  ] as const) {
    revisions.push(
      await post(
        f.book,
        "/payroll/revisions",
        {
          employeeId: original.employeeId,
          kind,
          supersedes: null,
          effectiveOn: startsOn,
          evidenceId: f.source.id,
          body,
        },
        Foundation.PayrollRevision,
      ),
    );
  }

  if (!revisions[0] || !revisions[1]) throw new Error("Missing qualified future source revisions");

  return {
    recordClass: "synthetic" as const,
    adjustmentIds: [instructionId],
    inputIds: [],
    employment: {
      ...original.reviewedInput.employment,
      monthlyCashSalary: salaryMinor,
      effectiveRevision: revisions[0].id,
    },
    work: {
      ...original.reviewedInput.work,
      effectiveRevision: revisions[1].id,
      earningsPeriod: { startsOn: startsOn, endsOn: endsOn },
      expectedPaymentOn: `${month}-25`,
      adjustments: [],
      reimbursements: [],
    },
    reason: "Independent future net recovery qualification",
  };
}

async function cancelNet(c: Awaited<ReturnType<typeof preparedNetRecovery>>, state = c.state) {
  return post(
    c.f.approver ?? c.f.reviewer,
    `/payroll/adjustment-instructions/${state.instruction.id}/cancellations`,
    {
      instructionDigest: state.instruction.digest,
      claimBalanceDigest: state.claimBalanceDigest,
      reason: "Independent release because future net salary cannot carry the recovery",
    },
    Settlement.AdjustmentInstructionCancellation,
  );
}

async function revokeRunApproval(
  f: Awaited<ReturnType<typeof mileageFixture>>,
  approvalId: string,
) {
  const actor = f.approver ?? f.reviewer;

  const saved = await post(
    actor,
    "/saved-posting-authority-requests",
    {
      operation: "revoke_approval",
      id: approvalId,
      input: { reason: "Independent withdrawal before NET recovery cancellation" },
    },
    PostingRecovery.SavedPostingRequest,
  );

  const revoked = await decoded(
    await request(actor, `/saved-posting-authority-requests/${saved.request.key}/run`, {
      method: "POST",
    }),
    PostingRecovery.SavedPostingRequest,
  );

  expect(revoked.outcome?.state).toBe("committed");

  return revoked;
}

test("future NET cancellation retains originals, refuses reservations, releases insufficient-pay recovery to real cash", async () => {
  const c = await preparedNetRecovery();
  const { f, state } = c;
  const path = `/payroll/adjustment-instructions/${state.instruction.id}/cancellations`;

  const input = {
    instructionDigest: state.instruction.digest,
    claimBalanceDigest: state.claimBalanceDigest,
    reason: "Independent cancellation of infeasible future recovery",
  };

  for (const actor of [f.book, f.reviewer])
    await failure(
      await request(actor, path, { method: "POST", body: JSON.stringify(input) }),
      403,
      "ApprovalRequired",
    );
  await failure(
    await request(f.approver ?? f.reviewer, path, {
      method: "POST",
      body: JSON.stringify({ ...input, instructionDigest: c.review.digest }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(f.approver ?? f.reviewer, path, {
      method: "POST",
      body: JSON.stringify({ ...input, claimBalanceDigest: c.review.digest }),
    }),
    409,
    "StaleDependency",
  );

  const unrelated = await fixture();

  await failure(
    await request(unrelated, path, { method: "POST", body: JSON.stringify(input) }),
    403,
    "Forbidden",
  );
  await failure(
    await request({ ...f.book, token: f.book.agentToken }, path, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    403,
    "Forbidden",
  );

  if (!f.approver || !f.assignedResponsibilities)
    throw new Error("Missing assigned cancellation approver");
  await post(
    f.book,
    "/payroll/access",
    { actorId: f.approver.actorId, allowed: false },
    Foundation.PayrollAccessResult,
  );
  await failure(
    await request(f.approver, path, { method: "POST", body: JSON.stringify(input) }),
    403,
    "Forbidden",
  );
  await post(
    f.book,
    "/payroll/access",
    { actorId: f.approver.actorId, allowed: true },
    Foundation.PayrollAccessResult,
  );

  const reassigned = await post(
    f.book,
    "/onboarding/responsibilities",
    {
      expectedRevision: f.assignedResponsibilities.revision,
      assignments: {
        ...f.assignedResponsibilities.assignments,
        bookkeepingApproverId: f.reviewer.actorId,
      },
    },
    Onboarding.OnboardingResponsibilities,
  );

  await failure(
    await request(f.approver, path, { method: "POST", body: JSON.stringify(input) }),
    403,
    "ApprovalRequired",
  );
  await post(
    f.book,
    "/onboarding/responsibilities",
    {
      expectedRevision: reassigned.revision,
      assignments: f.assignedResponsibilities.assignments,
    },
    Onboarding.OnboardingResponsibilities,
  );

  const future = await futureNetInput(f, state.instruction.id);
  await failure(
    await request(f.book, "/payroll/calculations", {
      method: "POST",
      body: JSON.stringify({
        ...future,
        employment: { ...future.employment, monthlyCashSalary: "900100" },
      }),
    }),
    422,
    "InvalidJournal",
  );

  const calculation = await post(
    f.book,
    "/payroll/calculations",
    future,
    Payroll.PayrollCalculation,
  );

  const run = await post(
    f.book,
    "/payroll/runs",
    {
      ...f.run.input,
      calculationIds: [calculation.id],
      postingDate: "2026-10-25",
      reason: "Reserved NET recovery",
    },
    Runs.PayrollRun,
  );

  const approval = await post(
    f.approver ?? f.reviewer,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  await failure(
    await request(f.approver ?? f.reviewer, path, { method: "POST", body: JSON.stringify(input) }),
    409,
    "AlreadyPosted",
  );
  const revocation = await revokeRunApproval(f, approval.id);
  const replayKey = key();

  const cancelled = await replayPost(
    f.approver ?? f.reviewer,
    path,
    input,
    Settlement.AdjustmentInstructionCancellation,
    replayKey,
  );

  expect(
    await replayPost(
      f.approver ?? f.reviewer,
      path,
      input,
      Settlement.AdjustmentInstructionCancellation,
      replayKey,
    ),
  ).toEqual(cancelled);
  await failure(
    await request(f.reviewer, path, {
      method: "POST",
      headers: { "idempotency-key": replayKey },
      body: JSON.stringify(input),
    }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(f.book, "/payroll/runs", {
      method: "POST",
      body: JSON.stringify({
        ...f.run.input,
        calculationIds: [calculation.id],
        postingDate: "2026-10-25",
        reason: "Stale cancelled NET calculation",
      }),
    }),
    409,
    "StaleDependency",
  );
  const cash = await recoveryCash(f, c.claim.id, "6600");

  await failure(
    await request(f.approver ?? f.reviewer, path, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    409,
    "StaleDependency",
  );

  const after = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${c.review.id}`),
    Settlement.SettlementView,
  );

  expect(after.netInstruction?.cancellation).toEqual(cancelled);
  expect(after.netInstruction?.remainingReceivableMinor).toBe("0");
  expect(after.execution).toEqual(c.executed);
  expect(await f.originalHistory()).toEqual(f.history);
  const restore = (await proveReminderRecovery(f.book.bookId, [7]))[0];

  if (!restore || restore.inventory.version !== 7)
    throw new Error("Missing populated NET cancellation restore proof");
  expect(restore.restoredInventory).toEqual(restore.inventory);
  expect(
    restore.inventory.mileageCorrectionRecords.filter(
      (row) =>
        row.bookId === f.book.bookId &&
        row.table === "payroll_adjustment_instruction_cancellations",
    ),
  ).toHaveLength(1);
  await writeFile(
    join(environment().artifacts, "r41-net-cancellation-cash-proof.json"),
    JSON.stringify(
      {
        state,
        insufficientSalaryMinor: "900100",
        run,
        approval,
        revocation,
        cancelled,
        cash,
        after,
        restore,
      },
      null,
      2,
    ),
  );
}, 180000);

test("NET cancellation races actual run approval and permits a fresh independently approved November recovery", async () => {
  const c = await preparedNetRecovery();
  const { f, state } = c;
  const future = await futureNetInput(f, state.instruction.id);

  const calculation = await post(
    f.book,
    "/payroll/calculations",
    future,
    Payroll.PayrollCalculation,
  );

  const run = await post(
    f.book,
    "/payroll/runs",
    {
      ...f.run.input,
      calculationIds: [calculation.id],
      postingDate: "2026-10-25",
      reason: "Competing October NET admission",
    },
    Runs.PayrollRun,
  );

  const outcomes = await Promise.all([
    request(
      f.approver ?? f.reviewer,
      `/payroll/adjustment-instructions/${state.instruction.id}/cancellations`,
      {
        method: "POST",
        body: JSON.stringify({
          instructionDigest: state.instruction.digest,
          claimBalanceDigest: state.claimBalanceDigest,
          reason: "Independent release before future payroll",
        }),
      },
    ),
    request(f.approver ?? f.reviewer, `/payroll/runs/${run.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ runDigest: run.digest }),
    }),
  ]);

  const cancellationResponse = outcomes[0];
  const approvalResponse = outcomes[1];

  if (!cancellationResponse || !approvalResponse)
    throw new Error("Missing competing public outcomes");
  expect(outcomes.map((row) => row.status)).toSatisfy(
    (statuses: number[]) =>
      (statuses[0] === 200 && statuses[1] === 409) || (statuses[0] === 409 && statuses[1] === 200),
  );
  let cancelled;

  if (approvalResponse.status === 200) {
    const approved = await decoded(approvalResponse, Runs.PayrollRunApproval);
    await revokeRunApproval(f, approved.id);
    cancelled = await cancelNet(c);
  } else
    cancelled = await decoded(cancellationResponse, Settlement.AdjustmentInstructionCancellation);

  const replacement = await post(
    f.book,
    "/payroll/settlement-reviews",
    { ...c.input, futureMonth: "2026-11", postingDate: "2026-11-03" },
    Settlement.SettlementReview,
  );

  expect(replacement.economicKey).not.toBe(c.review.economicKey);

  const approved = await post(
    f.approver ?? f.reviewer,
    `/payroll/settlement-reviews/${replacement.id}/approvals`,
    { reviewDigest: replacement.digest },
    Settlement.SettlementApproval,
  );

  const reissued = await post(
    f.book,
    `/payroll/settlement-reviews/${replacement.id}/executions`,
    { reviewDigest: replacement.digest, approvalId: approved.id },
    Settlement.SettlementExecution,
  );

  if (!reissued.instruction) throw new Error("Missing retained replacement NET instruction");
  expect(reissued.instruction.netRecovery?.amountMinor).toBe("6600");
  const november = await futureNetInput(f, reissued.instruction.id, "4200100", "2026-11");

  const nextCalculation = await post(
    f.book,
    "/payroll/calculations",
    november,
    Payroll.PayrollCalculation,
  );

  expect(nextCalculation.calculation.grossMinor).toBe("4200100");
  expect(nextCalculation.calculation.payableMinor).toBe("3283500");

  const nextRun = await post(
    f.book,
    "/payroll/runs",
    {
      ...f.run.input,
      calculationIds: [nextCalculation.id],
      postingDate: "2026-11-25",
      reason: "Actual replanned November net recovery",
    },
    Runs.PayrollRun,
  );

  const nextApproval = await post(
    f.approver ?? f.reviewer,
    `/payroll/runs/${nextRun.id}/approvals`,
    { runDigest: nextRun.digest },
    Runs.PayrollRunApproval,
  );

  const executionRace = await Promise.all([
    request(f.book, `/payroll/runs/${nextRun.id}/executions`, {
      method: "POST",
      body: JSON.stringify({ runDigest: nextRun.digest, approvalId: nextApproval.id }),
    }),
    request(
      f.approver ?? f.reviewer,
      `/payroll/adjustment-instructions/${reissued.instruction.id}/cancellations`,
      {
        method: "POST",
        body: JSON.stringify({
          instructionDigest: (
            await decoded(
              await request(f.book, `/payroll/settlement-reviews/${replacement.id}`),
              Settlement.SettlementView,
            )
          ).netInstruction?.instruction.digest,
          claimBalanceDigest: state.claimBalanceDigest,
          reason: "Competing cancellation after actual payroll reservation",
        }),
      },
    ),
  ]);

  expect(executionRace.map((row) => row.status)).toEqual([200, 409]);

  const after = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${replacement.id}`),
    Settlement.SettlementView,
  );

  expect(after.netInstruction?.consumedRunId).toBe(nextRun.id);
  expect(after.netInstruction?.remainingReceivableMinor).toBe("0");
  expect(after.netInstruction?.cancellation).toBeNull();
  await failure(
    await request(
      f.approver ?? f.reviewer,
      `/payroll/adjustment-instructions/${reissued.instruction.id}/cancellations`,
      {
        method: "POST",
        body: JSON.stringify({
          instructionDigest: after.netInstruction?.instruction.digest,
          claimBalanceDigest: after.netInstruction?.claimBalanceDigest,
          reason: "Cannot cancel consumed recovery",
        }),
      },
    ),
    409,
    "AlreadyPosted",
  );
  expect(await f.originalHistory()).toEqual(f.history);
  await writeFile(
    join(environment().artifacts, "r41-net-replan-races-proof.json"),
    JSON.stringify(
      {
        original: c.executed,
        cancelled,
        replacement,
        reissued,
        nextCalculation,
        nextRun,
        nextApproval,
        approvalRaceStatuses: outcomes.map((row) => row.status),
        executionRaceStatuses: executionRace.map((row) => row.status),
        after,
      },
      null,
      2,
    ),
  );
});

test("each mileage persistence fault rolls back the complete approved financial state and permits exact retry", async () => {
  const phases = [
    "payroll_recovery_claims",
    "payroll_reporting_corrections",
    "payroll_mileage_correction_successors",
    "payroll_settlement_executions",
    "command_receipts",
  ] as const;

  const tables = [
    "series_counters",
    "vouchers",
    "journal_lines",
    "execution_receipts",
    "posting_group_receipts",
    "approval_consumptions",
    "outbox",
    "payroll_recovery_claims",
    "payroll_reporting_corrections",
    "payroll_mileage_correction_successors",
    "payroll_settlement_executions",
    "command_receipts",
    "payroll_settlement_approvals",
    "payroll_settlement_capacity_reservations",
  ];

  const admin = await database();
  const proofs = [];

  try {
    for (const phase of phases) {
      const f = await mileageFixture();
      const view = await readyMileageCorrection(f);
      const review = view.settlementReview;

      if (!review) throw new Error("Missing ready mileage review");
      await post(
        f.book,
        `/payroll/mileage-corrections/${view.proposal.id}/submissions`,
        {
          proposalDigest: view.proposal.digest,
          reviewDigest: review.digest,
        },
        Mileage.MileageCorrectionView,
      );

      const approval = await post(
        f.approver ?? f.reviewer,
        `/payroll/settlement-reviews/${review.id}/approvals`,
        { reviewDigest: review.digest },
        Settlement.SettlementApproval,
      );

      const executeKey = key();
      const input = { reviewDigest: review.digest, approvalId: approval.id };

      const snapshot = async () => {
        const rows: { [table: string]: readonly { body: Schema.JsonObject }[] } = {};

        for (const table of tables) {
          rows[table] = (
            await admin.query<{ body: Schema.JsonObject }>(
              `SELECT to_jsonb(t) AS body FROM openerp.${admin.escapeIdentifier(table)} t WHERE book_id=$1 ORDER BY to_jsonb(t)::text COLLATE "C"`,
              [f.book.bookId],
            )
          ).rows;
        }

        rows.books = (
          await admin.query("SELECT to_jsonb(t) AS body FROM openerp.books t WHERE id=$1", [
            f.book.bookId,
          ])
        ).rows;

        return rows;
      };

      const before = await snapshot();
      const functionName = admin.escapeIdentifier(`r41_fault_${f.book.bookId}`);
      const triggerName = admin.escapeIdentifier(`r41_fault_${f.book.bookId}`);
      const tableName = admin.escapeIdentifier(phase);

      const predicate =
        phase === "command_receipts"
          ? `NEW.book_id=${admin.escapeLiteral(f.book.bookId)} AND NEW.key=${admin.escapeLiteral(executeKey)}`
          : `NEW.book_id=${admin.escapeLiteral(f.book.bookId)}`;

      let failedStatus = 0;

      try {
        await admin.query(
          `CREATE FUNCTION openerp.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'scoped synthetic R41 persistence fault'; END IF; RETURN NEW; END $$`,
        );
        await admin.query(
          `CREATE TRIGGER ${triggerName} BEFORE INSERT ON openerp.${tableName} FOR EACH ROW EXECUTE FUNCTION openerp.${functionName}()`,
        );

        const failed = await request(
          f.book,
          `/payroll/settlement-reviews/${review.id}/executions`,
          {
            method: "POST",
            headers: { "idempotency-key": executeKey },
            body: JSON.stringify(input),
          },
        );

        failedStatus = failed.status;
        expect(failedStatus).toBe(500);
        expect(await snapshot()).toEqual(before);
      } finally {
        await admin.query(`DROP TRIGGER IF EXISTS ${triggerName} ON openerp.${tableName}`);
        await admin.query(`DROP FUNCTION IF EXISTS openerp.${functionName}()`);
      }

      const execution = await replayPost(
        f.book,
        `/payroll/settlement-reviews/${review.id}/executions`,
        input,
        Settlement.SettlementExecution,
        executeKey,
      );

      expect(execution.recoveryClaim).toMatchObject({
        claimedGrossMinor: "1100",
        receivableMinor: "6600",
      });

      if (!execution.postingReceipt) throw new Error("Missing actual correction journal receipt");

      const lines = (
        await admin.query(
          "SELECT account_id, debit_minor::text, credit_minor::text FROM openerp.journal_lines WHERE book_id=$1 AND voucher_id=$2 ORDER BY ordinal",
          [f.book.bookId, execution.postingReceipt.voucherId],
        )
      ).rows;

      expect(lines).toEqual([
        { account_id: "employee_recovery", debit_minor: "6600", credit_minor: "0" },
        { account_id: "mileage_expense", debit_minor: "0", credit_minor: "5500" },
        { account_id: "mileage_taxable", debit_minor: "0", credit_minor: "1100" },
      ]);

      const reporting = (
        await admin.query(
          "SELECT body FROM openerp.payroll_reporting_corrections WHERE book_id=$1 AND execution_id=$2",
          [f.book.bookId, execution.id],
        )
      ).rows;

      expect(reporting).toHaveLength(1);
      expect(reporting[0]?.body.grossCashMinor).toBe("4207600");
      const committed = await snapshot();
      expect(
        await replayPost(
          f.book,
          `/payroll/settlement-reviews/${review.id}/executions`,
          input,
          Settlement.SettlementExecution,
          executeKey,
        ),
      ).toEqual(execution);
      expect(await snapshot()).toEqual(committed);
      expect(await f.originalHistory()).toEqual(f.history);
      proofs.push({ phase, failedStatus, before, committed, execution, lines, reporting });
    }
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "r41-persistence-rollback-proof.json"),
    JSON.stringify({ phases: proofs }, null, 2),
  );
});

test("no-journal NET approval refuses an independent human without retained financial assignment", async () => {
  const f = await mileageFixture({ independentApprover: true });
  const corrected = await readyMileageCorrection(f);
  const source = await executeCorrection(f, corrected);
  const claim = source.recoveryClaim;

  if (!claim || !f.approver || f.assignedResponsibilities)
    throw new Error("Missing unassigned independent human fixture");

  const lawful = await post(
    f.reviewer,
    "/payroll/adjustment-bases",
    {
      comparisonId: claim.comparisonId,
      recoveryClaimId: claim.id,
      kind: "future_pay",
      evidenceId: f.basis.evidence.id,
      reason: "Independent synthetic consent without assigned financial approver",
    },
    Settlement.AdjustmentBasis,
  );

  const review = await post(
    f.book,
    "/payroll/settlement-reviews",
    {
      kind: "future_pay",
      recoveryClaimId: claim.id,
      comparisonId: claim.comparisonId,
      lawfulBasisId: lawful.id,
      recoveryReceivableAccountId: null,
      futureMonth: "2026-10",
      evidenceId: f.basis.evidence.id,
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-03",
      series: "L",
      reason: lawful.input.reason,
    },
    Settlement.SettlementReview,
  );

  expect(review.createdBy).not.toBe(f.approver.actorId);
  expect(review.lawfulBasis?.createdBy).not.toBe(f.approver.actorId);
  await failure(
    await request(f.approver, `/payroll/settlement-reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest }),
    }),
    403,
    "ApprovalRequired",
  );

  const after = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${review.id}`),
    Settlement.SettlementView,
  );

  expect(after.execution).toBeNull();
  expect(after.approvals).toEqual([]);
  expect(after.netInstruction).toBeNull();
  expect(after.remainingReceivableMinor).toBe("6600");
  expect(await f.originalHistory()).toEqual(f.history);
  await writeFile(
    join(environment().artifacts, "r41-net-missing-assignment-proof.json"),
    JSON.stringify({ review, after }, null, 2),
  );
});
