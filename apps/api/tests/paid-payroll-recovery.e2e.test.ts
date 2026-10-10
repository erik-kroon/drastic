import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Foundation from "@open-erp/contracts/payroll-foundation";
import {
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  post,
  request,
} from "./support/fixtures";
import { paidRecoveryCensus, paidRecoveryFixture } from "./support/paid-payroll-recovery";

const root = "/payroll/paid-recoveries";

type Fixture = Awaited<ReturnType<typeof paidRecoveryFixture>>;

async function prepare(f: Fixture) {
  return post(
    f.book,
    root,
    { comparisonId: f.comparison.id, calculationId: f.capacity.id },
    Recovery.PaidRecoveryView,
  );
}

async function draft(f: Fixture) {
  const prepared = await prepare(f);

  const split = await post(
    f.book,
    `${root}/${prepared.assessment.id}/splits`,
    { assessmentDigest: prepared.assessment.digest },
    Recovery.PaidRecoveryView,
  );

  const attached = await post(
    f.book,
    `${root}/${prepared.assessment.id}/attachments`,
    {
      assessmentDigest: prepared.assessment.digest,
      evidenceId: f.source.id,
      reason: "Independent synthetic recovery claim and offset evidence",
    },
    Recovery.PaidRecoveryView,
  );

  return { prepared, split, attached };
}

async function qualifiedClaim(f: Fixture) {
  const retained = await draft(f);
  const attachment = retained.attached.attachments[0];

  if (!attachment) throw new Error("Missing retained unqualified attachment");

  const qualified = await post(
    f.qualifier,
    `${root}/${retained.prepared.assessment.id}/qualifications`,
    { attachmentId: attachment.id, attachmentDigest: attachment.digest, purpose: "gross_claim" },
    Recovery.PaidRecoveryView,
  );

  const qualification = qualified.qualifications[0];

  if (!qualification) throw new Error("Missing independent claim qualification");

  const ready = await post(
    f.book,
    `${root}/${retained.prepared.assessment.id}/claim-reviews`,
    {
      assessmentDigest: retained.prepared.assessment.digest,
      qualificationId: qualification.id,
      recoveryReceivableAccountId: "employee_recovery",
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-05",
      series: "L",
    },
    Recovery.PaidRecoveryView,
  );

  if (!ready.claimReview) throw new Error("Missing canonical claim review");

  return { ...retained, qualified, ready, review: ready.claimReview, attachment };
}

async function claim(f: Fixture) {
  const retained = await qualifiedClaim(f);

  const approval = await post(
    f.approver,
    `/payroll/settlement-reviews/${retained.review.id}/approvals`,
    { reviewDigest: retained.review.digest },
    Settlement.SettlementApproval,
  );

  const execution = await post(
    f.book,
    `/payroll/settlement-reviews/${retained.review.id}/executions`,
    { reviewDigest: retained.review.digest, approvalId: approval.id },
    Settlement.SettlementExecution,
  );

  if (!execution.recoveryClaim) throw new Error("Missing canonical receivable");

  const offset = await post(
    f.qualifier,
    `${root}/${retained.prepared.assessment.id}/qualifications`,
    {
      attachmentId: retained.attachment.id,
      attachmentDigest: retained.attachment.digest,
      purpose: "net_offset",
    },
    Recovery.PaidRecoveryView,
  );

  const qualification = offset.qualifications.find((row) => row.purpose === "net_offset");

  if (!qualification) throw new Error("Missing independent net offset qualification");

  return {
    ...retained,
    approval,
    execution,
    offset,
    qualification,
    canonicalClaim: execution.recoveryClaim,
  };
}

function offsetInput(
  f: Fixture,
  c: Awaited<ReturnType<typeof claim>>,
  leg: typeof Recovery.PaidRecoveryLeg.Type,
  calculationId?: string,
) {
  return {
    kind: "future_pay",
    recoveryClaimId: c.canonicalClaim.id,
    paidRecoveryLegId: leg.id,
    ...(calculationId ? { capacityCalculationId: calculationId } : {}),
    comparisonId: f.comparison.id,
    lawfulBasisId: c.qualification.adjustmentBasis.id,
    recoveryReceivableAccountId: null,
    futureMonth: leg.month,
    evidenceId: c.qualification.adjustmentBasis.evidence.evidenceId,
    accountingPeriodId: "period_2026",
    postingDate: `${leg.month}-05`,
    series: "L",
    reason: c.qualification.adjustmentBasis.input.reason,
  };
}

async function consume(
  f: Fixture,
  instructionId: string,
  input: typeof Calculations.PreparePayRun.Type,
) {
  const calculation = await post(
    f.book,
    "/payroll/calculations",
    { ...input, adjustmentIds: [instructionId] },
    Calculations.PayrollCalculation,
  );

  const run = await post(
    f.book,
    "/payroll/runs",
    { ...f.input, calculationIds: [calculation.id], postingDate: input.work.expectedPaymentOn },
    Runs.PayrollRun,
  );

  const approval = await post(
    f.approver,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const execution = await post(
    f.book,
    `/payroll/runs/${run.id}/executions`,
    { runDigest: run.digest, approvalId: approval.id },
    Runs.PayrollRunExecution,
  );

  return { calculation, run, approval, execution };
}

async function projection(f: Fixture) {
  const admin = await database();

  try {
    return {
      claims: (
        await admin.query(
          "SELECT body FROM openerp.payroll_recovery_claims WHERE book_id=$1 ORDER BY id",
          [f.book.bookId],
        )
      ).rows,
      allocations: (
        await admin.query(
          "SELECT body FROM openerp.payroll_recovery_allocations WHERE book_id=$1 ORDER BY id",
          [f.book.bookId],
        )
      ).rows,
      corrections: (
        await admin.query(
          "SELECT body FROM openerp.payroll_reporting_corrections WHERE book_id=$1 ORDER BY id",
          [f.book.bookId],
        )
      ).rows,
      balances: (
        await admin.query(
          "SELECT account_id,sum(debit_minor::numeric-credit_minor::numeric)::text AS balance FROM openerp.journal_lines WHERE book_id=$1 GROUP BY account_id ORDER BY account_id",
          [f.book.bookId],
        )
      ).rows,
    };
  } finally {
    await admin.end();
  }
}

async function artifact(name: string, body: unknown) {
  await writeFile(join(environment().artifacts, name), JSON.stringify(body, null, 2));
}

test("R43 retains simultaneous60000/45000 refusal, server45000/15000 split, unqualified evidence and cancellation without economics", async () => {
  const f = await paidRecoveryFixture();
  expect(f.comparison.grossDeltaMinor).toBe("-60000");
  expect(f.comparison.contributionDeltaMinor).toBe("-18852");
  expect(f.capacity.calculation.payableMinor).toBe("45000");
  const original = await f.history();
  const before = await paidRecoveryCensus(f.book);
  const c = await draft(f);
  expect(c.prepared.assessment).toMatchObject({
    targetMinor: "60000",
    contributionDeltaMinor: "-18852",
    shortfallMinor: "15000",
    blockers: ["missing_lawful_basis", "insufficient_net_capacity"],
    original: { grossMinor: "3600000", reportingPeriod: "2026-09", payableMinor: "2700000" },
    capacity: { calculationId: f.capacity.id, availableNetMinor: "45000", month: "2026-10" },
  });
  expect(
    c.split.drafts[0]?.legs.map(
      ({ month, amountMinor, capacityCalculationId, capacityDigest }) => ({
        month,
        amountMinor,
        capacityCalculationId,
        capacityDigest,
      }),
    ),
  ).toEqual([
    {
      month: "2026-10",
      amountMinor: "45000",
      capacityCalculationId: f.capacity.id,
      capacityDigest: f.capacity.planDigest,
    },
    { month: "2026-11", amountMinor: "15000", capacityCalculationId: null, capacityDigest: null },
  ]);
  expect(c.attached.qualifications).toEqual([]);
  expect(c.attached.claimReview).toBeNull();
  expect(c.attached.claimExecution).toBeNull();
  expect(await paidRecoveryCensus(f.book)).toEqual(before);

  const cancelled = await post(
    f.book,
    `${root}/${c.prepared.assessment.id}/cancellations`,
    {
      assessmentDigest: c.prepared.assessment.digest,
      reason: "Retain refused attempt and stop unexecuted recovery",
    },
    Recovery.PaidRecoveryView,
  );

  expect(cancelled.current.status).toBe("cancelled");
  expect(cancelled.assessment).toEqual(c.prepared.assessment);
  expect(cancelled.drafts).toEqual(c.split.drafts);
  expect(cancelled.attachments).toEqual(c.attached.attachments);
  expect(await f.history()).toEqual(original);
  expect(await paidRecoveryCensus(f.book)).toEqual(before);
  const list = await decoded(await request(f.book, root), Recovery.PaidRecoveryList);
  expect(list.items).toContainEqual(cancelled);
  await artifact("r43-retained-refusal.json", {
    original,
    before,
    prepared: c.prepared,
    split: c.split,
    attached: c.attached,
    cancelled,
    list,
  });
});

test("R43 refuses client money, wrong scope, employee, stale digests and revoked access before replay", async () => {
  const f = await paidRecoveryFixture();
  const prepareKey = key();
  const input = { comparisonId: f.comparison.id, calculationId: f.capacity.id };

  const prepared = await decoded(
    await request(f.book, root, {
      method: "POST",
      headers: { "idempotency-key": prepareKey },
      body: JSON.stringify(input),
    }),
    Recovery.PaidRecoveryView,
  );

  const before = await paidRecoveryCensus(f.book);

  const extra = await request(f.book, root, {
    method: "POST",
    body: JSON.stringify({ ...input, amountMinor: "1" }),
  });

  expect(extra.status).toBe(400);
  const unrelated = await fixture();
  await post(
    unrelated,
    "/payroll/access",
    { actorId: unrelated.actorId, allowed: true },
    Foundation.PayrollAccessResult,
  );
  await failure(
    await request({ ...f.book, token: unrelated.token }, root, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    403,
    "Forbidden",
  );
  await failure(await request(unrelated, `${root}/${prepared.assessment.id}`), 404, "NotFound");
  await failure(
    await request(f.book, `${root}/${prepared.assessment.id}/splits`, {
      method: "POST",
      body: JSON.stringify({ assessmentDigest: f.paid.digest }),
    }),
    409,
    "StaleDependency",
  );
  const foreign = await paidRecoveryFixture();

  await failure(
    await request(f.book, root, {
      method: "POST",
      body: JSON.stringify({ ...input, calculationId: foreign.capacity.id }),
    }),
    404,
    "NotFound",
  );

  const otherCalculation = await payrollFixtureForOtherEmployee(f);

  expect(otherCalculation.scope).toEqual(f.capacity.scope);
  expect(otherCalculation.employeeId).not.toBe(f.capacity.employeeId);

  await failure(
    await request(f.book, root, {
      method: "POST",
      body: JSON.stringify({ ...input, calculationId: otherCalculation.id }),
    }),
    409,
    "StaleDependency",
  );

  await post(
    f.book,
    "/payroll/access",
    { actorId: f.book.actorId, allowed: false },
    Foundation.PayrollAccessResult,
  );

  for (const path of [root, `${root}/${prepared.assessment.id}`])
    await failure(await request(f.book, path), 403, "Forbidden");
  await failure(
    await request(f.book, root, {
      method: "POST",
      headers: { "idempotency-key": prepareKey },
      body: JSON.stringify(input),
    }),
    403,
    "Forbidden",
  );
  await post(
    f.book,
    "/payroll/access",
    { actorId: f.book.actorId, allowed: true },
    Foundation.PayrollAccessResult,
  );
  expect(
    await decoded(
      await request(f.book, root, {
        method: "POST",
        headers: { "idempotency-key": prepareKey },
        body: JSON.stringify(input),
      }),
      Recovery.PaidRecoveryView,
    ),
  ).toEqual(prepared);
  expect(await paidRecoveryCensus(f.book)).toEqual(before);
  await artifact("r43-boundary-refusals.json", {
    prepared,
    extraStatus: extra.status,
    foreignCalculationId: foreign.capacity.id,
    otherCalculation,
    before,
    after: await paidRecoveryCensus(f.book),
  });
});

async function payrollFixtureForOtherEmployee(f: Fixture) {
  const employeeId = `synthetic_other_${key()}`;

  const employment = await post(
    f.book,
    "/payroll/revisions",
    {
      employeeId,
      kind: "employment",
      effectiveOn: "2026-01-01",
      supersedes: null,
      evidenceId: f.source.id,
      body: {
        personRef: "SYNTHETIC OTHER PERSON",
        jurisdiction: "QR",
        residency: "Synthetic",
        payTerms: "Synthetic monthly salary",
        workSchedule: "Synthetic monthly",
        taxFacts: "Synthetic fixed withholding",
      },
    },
    Foundation.PayrollRevision,
  );

  const work = await post(
    f.book,
    "/payroll/revisions",
    {
      employeeId,
      kind: "work",
      effectiveOn: "2026-10-01",
      supersedes: null,
      evidenceId: f.source.id,
      body: {
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        inputs: ["Synthetic other employee"],
      },
    },
    Foundation.PayrollRevision,
  );

  await post(
    f.book,
    "/payroll/revisions",
    {
      employeeId,
      kind: "opening",
      effectiveOn: "2026-01-01",
      supersedes: null,
      evidenceId: f.source.id,
      body: { asOf: "2026-01-01", balanceMinor: "0", obligation: "synthetic_contribution" },
    },
    Foundation.PayrollRevision,
  );

  return post(
    f.book,
    "/payroll/calculations",
    {
      ...f.octoberInput,
      employment: { ...f.octoberInput.employment, employeeId, effectiveRevision: employment.id },
      work: { ...f.octoberInput.work, effectiveRevision: work.id },
    },
    Calculations.PayrollCalculation,
  );
}

test("R43 qualification requires independent human and exact attachment; claim review remains nonfinancial", async () => {
  const f = await paidRecoveryFixture();
  const c = await draft(f);
  const attachment = c.attached.attachments[0];

  if (!attachment) throw new Error("Missing attachment");
  const path = `${root}/${c.prepared.assessment.id}/qualifications`;

  const input = {
    attachmentId: attachment.id,
    attachmentDigest: attachment.digest,
    purpose: "gross_claim",
  };

  const before = await paidRecoveryCensus(f.book);

  for (const actor of [f.book, { ...f.qualifier, token: f.reviewer.token }])
    await failure(
      await request(actor, path, { method: "POST", body: JSON.stringify(input) }),
      403,
      "ApprovalRequired",
    );
  await failure(
    await request(f.qualifier, path, {
      method: "POST",
      body: JSON.stringify({ ...input, attachmentDigest: f.paid.digest }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(f.qualifier, path, {
      method: "POST",
      body: JSON.stringify({ ...input, purpose: "net_offset" }),
    }),
    403,
    "ApprovalRequired",
  );
  const qualified = await post(f.qualifier, path, input, Recovery.PaidRecoveryView);
  const qualification = qualified.qualifications[0];

  if (!qualification) throw new Error("Missing qualified attachment");

  const ready = await post(
    f.book,
    `${root}/${c.prepared.assessment.id}/claim-reviews`,
    {
      assessmentDigest: c.prepared.assessment.digest,
      qualificationId: qualification.id,
      recoveryReceivableAccountId: "employee_recovery",
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-05",
      series: "L",
    },
    Recovery.PaidRecoveryView,
  );

  expect(ready.claimReview?.outputs).toMatchObject({
    amountMinor: "60000",
    signedGrossDeltaMinor: "-60000",
    contributionCorrectionMinor: "-18852",
  });
  expect(await paidRecoveryCensus(f.book)).toEqual(before);

  if (!ready.claimReview) throw new Error("Missing claim review");

  for (const actor of [f.book, f.qualifier])
    await failure(
      await request(actor, `/payroll/settlement-reviews/${ready.claimReview.id}/approvals`, {
        method: "POST",
        body: JSON.stringify({ reviewDigest: ready.claimReview.digest }),
      }),
      403,
      "ApprovalRequired",
    );
  await artifact("r43-independent-qualification.json", {
    prepared: c.prepared,
    attachment,
    qualified,
    ready,
    before,
    after: await paidRecoveryCensus(f.book),
  });
});

test("R43 canonical claim and two retained installments conserve60000 and settle executed zero-net without a bank fiction", async () => {
  const f = await paidRecoveryFixture();

  const originalPaid = f.paid;
  const originalHistory = await f.history();

  const alternativeOctoberCapacity = await post(
    f.book,
    "/payroll/calculations",
    {
      ...f.octoberInput,
      employment: { ...f.octoberInput.employment, monthlyCashSalary: "950000" },
    },
    Calculations.PayrollCalculation,
  );

  expect(alternativeOctoberCapacity.calculation.payableMinor).toBe("50000");

  const currentFixture = {
    ...f,
    capacity: await post(
      f.book,
      "/payroll/calculations",
      f.octoberInput,
      Calculations.PayrollCalculation,
    ),
  };

  const c = await claim(currentFixture);

  expect(c.canonicalClaim.claimedGrossMinor).toBe("60000");
  const legs = c.split.drafts[0]?.legs;
  const first = legs?.[0];
  const second = legs?.[1];

  if (!first || !second) throw new Error("Missing conserved recovery legs");

  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify(offsetInput(f, c, first, alternativeOctoberCapacity.id)),
    }),
    409,
    "StaleDependency",
  );

  const october = await f.executeReview(offsetInput(f, c, first));
  expect(october.review.outputs).toMatchObject({
    amountMinor: "45000",
    remainingReceivableMinor: "60000",
    signedGrossDeltaMinor: "0",
    contributionCorrectionMinor: "0",
  });

  if (!october.execution.instruction) throw new Error("Missing first canonical instruction");
  const novemberInput = await f.laterInput("2026-11", "15000");

  const novemberCapacity = await post(
    f.book,
    "/payroll/calculations",
    novemberInput,
    Calculations.PayrollCalculation,
  );

  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify(offsetInput(f, c, second, novemberCapacity.id)),
    }),
    409,
    "AlreadyPosted",
  );
  const octoberRun = await consume(f, october.execution.instruction.id, f.octoberInput);
  expect(octoberRun.calculation.calculation.payableMinor).toBe("0");

  const firstState = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${october.review.id}`),
    Settlement.SettlementView,
  );

  expect(firstState.netInstruction).toMatchObject({
    remainingReceivableMinor: "15000",
    consumedRunId: octoberRun.run.id,
  });
  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify(offsetInput(f, c, second)),
    }),
    409,
    "StaleDependency",
  );
  const november = await f.executeReview(offsetInput(f, c, second, novemberCapacity.id));
  expect(november.review.outputs).toMatchObject({
    amountMinor: "15000",
    signedGrossDeltaMinor: "0",
    contributionCorrectionMinor: "0",
  });

  if (!november.execution.instruction) throw new Error("Missing second canonical instruction");
  const novemberRun = await consume(f, november.execution.instruction.id, novemberInput);

  const finalState = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${november.review.id}`),
    Settlement.SettlementView,
  );

  expect(finalState.netInstruction?.remainingReceivableMinor).toBe("0");
  const noncashBefore = await projection(f);

  const noncash = await f.executeReview({
    kind: "noncash_payment",
    runId: octoberRun.run.id,
    employeeId: f.calculation.employeeId,
    evidenceId: f.source.id,
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-31",
    series: "L",
    reason: "Explicit synthetic zero-net settlement from consumed approved recovery",
  });

  expect(noncash.execution.paidEvent).toMatchObject({
    runId: octoberRun.run.id,
    paidMinor: "0",
    reportingPeriod: "2026-10",
  });
  expect(noncash.execution.postingReceipt).toBeNull();
  expect(noncash.review.cash).toBeNull();
  const after = await projection(f);
  expect(after.balances).toEqual(noncashBefore.balances);
  expect(
    after.allocations.map((row) => row.body.amountMinor).sort((a, b) => a.localeCompare(b)),
  ).toEqual(["15000", "45000"]);
  expect(after.claims).toHaveLength(1);
  expect(after.corrections).toHaveLength(1);

  const original = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${f.payment.review.id}`),
    Settlement.SettlementView,
  );

  expect(original.execution?.paidEvent).toEqual(originalPaid);
  expect(await f.history()).toEqual(originalHistory);

  const retained = await decoded(
    await request(f.book, `${root}/${c.prepared.assessment.id}`),
    Recovery.PaidRecoveryView,
  );

  expect(retained.drafts[0]?.legs[1]).toEqual(second);

  const period = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-09", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  expect(period.totals).toEqual({
    grossMinor: "3540000",
    withholdingMinor: "900000",
    contributionBaseMinor: "3540000",
  });
  expect(period.items[0]?.specificationNumber).toBe(f.paid.specificationNumber);
  await artifact("r43-complete-recovery-journey.json", {
    claim: c,
    october,
    alternativeOctoberCapacity,
    octoberRun,
    firstState,
    novemberCapacity,
    november,
    novemberRun,
    finalState,
    noncash,
    retained,
    period,
    projection: after,
    originalPaid,
  });
});

test("R43 zero-net settlement refuses positive-net and unexecuted runs without paid children", async () => {
  const f = await paidRecoveryFixture();
  const before = await paidRecoveryCensus(f.book);
  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify({
        kind: "noncash_payment",
        runId: f.run.id,
        employeeId: f.calculation.employeeId,
        evidenceId: f.source.id,
        accountingPeriodId: "period_2026",
        postingDate: "2026-09-30",
        series: "L",
        reason: "Must refuse positive actual liability",
      }),
    }),
    409,
    "AlreadyPosted",
  );

  const unexecuted = await post(
    f.book,
    "/payroll/runs",
    { ...f.input, calculationIds: [f.capacity.id], postingDate: "2026-10-31" },
    Runs.PayrollRun,
  );

  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify({
        kind: "noncash_payment",
        runId: unexecuted.id,
        employeeId: f.calculation.employeeId,
        evidenceId: f.source.id,
        accountingPeriodId: "period_2026",
        postingDate: "2026-10-31",
        series: "L",
        reason: "Must refuse unexecuted payroll",
      }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await paidRecoveryCensus(f.book)).toEqual(before);
  await artifact("r43-noncash-refusals.json", {
    run: f.run,
    unexecuted,
    before,
    after: await paidRecoveryCensus(f.book),
  });
});

test("R43 concurrent retained retries converge and canonical cancellation cannot race past consumed capacity", async () => {
  const f = await paidRecoveryFixture();
  const prepareKey = key();
  const requestInput = { comparisonId: f.comparison.id, calculationId: f.capacity.id };

  const command = () =>
    request(f.book, root, {
      method: "POST",
      headers: { "idempotency-key": prepareKey },
      body: JSON.stringify(requestInput),
    });

  const [firstResponse, secondResponse] = await Promise.all([command(), command()]);
  const first = await decoded(firstResponse, Recovery.PaidRecoveryView);
  expect(await decoded(secondResponse, Recovery.PaidRecoveryView)).toEqual(first);
  const c = await claim(f);
  const leg = c.split.drafts[0]?.legs[0];

  if (!leg) throw new Error("Missing retained first installment");
  const offset = await f.executeReview(offsetInput(f, c, leg));
  const instruction = offset.execution.instruction;

  if (!instruction) throw new Error("Missing canonical instruction");

  const state = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${offset.review.id}`),
    Settlement.SettlementView,
  );

  if (!state.netInstruction) throw new Error("Missing canonical offset state");

  const cancelInput = {
    instructionDigest: state.netInstruction.instruction.digest,
    claimBalanceDigest: state.netInstruction.claimBalanceDigest,
    reason: "Independent cancellation retains the claim and releases only this instruction",
  };

  const race = await Promise.all([
    request(f.approver, `/payroll/adjustment-instructions/${instruction.id}/cancellations`, {
      method: "POST",
      body: JSON.stringify(cancelInput),
    }),
    request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify({
        kind: "cash_recovery",
        claimId: c.canonicalClaim.id,
        ...(await f.cash("60000", "2026-10-10")),
      }),
    }),
  ]);

  expect(race[0].status).toBe(200);
  expect([200, 409]).toContain(race[1].status);
  const cancelled = await decoded(race[0], Settlement.AdjustmentInstructionCancellation);

  const restored = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${offset.review.id}`),
    Settlement.SettlementView,
  );

  expect(restored.netInstruction).toMatchObject({
    remainingReceivableMinor: "60000",
    cancellation: cancelled,
    consumedRunId: null,
  });
  await failure(
    await request(f.book, `${root}/${c.prepared.assessment.id}/cancellations`, {
      method: "POST",
      body: JSON.stringify({
        assessmentDigest: c.prepared.assessment.digest,
        reason: "Cannot undo an executed canonical claim",
      }),
    }),
    409,
    "AlreadyPosted",
  );
  const replacement = await f.executeReview(offsetInput(f, c, leg));

  if (!replacement.execution.instruction) throw new Error("Missing reissued canonical installment");
  const consumed = await consume(f, replacement.execution.instruction.id, f.octoberInput);

  const after = await decoded(
    await request(f.book, `/payroll/settlement-reviews/${replacement.review.id}`),
    Settlement.SettlementView,
  );

  if (!after.netInstruction) throw new Error("Missing consumed canonical instruction");
  await failure(
    await request(
      f.approver,
      `/payroll/adjustment-instructions/${replacement.execution.instruction.id}/cancellations`,
      {
        method: "POST",
        body: JSON.stringify({
          ...cancelInput,
          instructionDigest: after.netInstruction.instruction.digest,
          claimBalanceDigest: after.netInstruction.claimBalanceDigest,
        }),
      },
    ),
    409,
    "AlreadyPosted",
  );
  expect((await projection(f)).allocations).toHaveLength(1);
  await artifact("r43-terminal-replay-races.json", {
    first,
    claim: c,
    offset,
    raceStatuses: race.map((row) => row.status),
    cancelled,
    restored,
    replacement,
    consumed,
    after,
  });
});

test.each([
  "payroll_paid_recovery_assessments",
  "payroll_paid_recovery_drafts",
  "payroll_paid_recovery_legs",
  "payroll_paid_recovery_attachments",
  "payroll_paid_recovery_qualifications",
  "payroll_paid_recovery_claim_reviews",
  "payroll_paid_recovery_cancellations",
] as const)(
  "R43 %s fault rolls back every metadata and canonical child, then the original key succeeds once",
  async (table) => {
    const f = await paidRecoveryFixture();
    let path = root;
    let input: unknown = { comparisonId: f.comparison.id, calculationId: f.capacity.id };
    let actor = f.book;

    if (table !== "payroll_paid_recovery_assessments") {
      const retained = await prepare(f);
      path = `${root}/${retained.assessment.id}`;
      input = { assessmentDigest: retained.assessment.digest };

      if (table === "payroll_paid_recovery_drafts" || table === "payroll_paid_recovery_legs")
        path += "/splits";
      else if (table === "payroll_paid_recovery_attachments") {
        path += "/attachments";
        input = {
          assessmentDigest: retained.assessment.digest,
          evidenceId: f.source.id,
          reason: "Faulted attachment",
        };
      } else if (table === "payroll_paid_recovery_cancellations") {
        path += "/cancellations";
        input = { assessmentDigest: retained.assessment.digest, reason: "Faulted cancellation" };
      } else {
        const attached = await post(
          f.book,
          `${path}/attachments`,
          {
            assessmentDigest: retained.assessment.digest,
            evidenceId: f.source.id,
            reason: "Independent faulted lawful evidence",
          },
          Recovery.PaidRecoveryView,
        );

        const attachment = attached.attachments[0];

        if (!attachment) throw new Error("Missing fault fixture attachment");

        const qualificationInput = {
          attachmentId: attachment.id,
          attachmentDigest: attachment.digest,
          purpose: "gross_claim",
        };

        if (table === "payroll_paid_recovery_qualifications") {
          path += "/qualifications";
          input = qualificationInput;
          actor = f.qualifier;
        } else {
          const qualified = await post(
            f.qualifier,
            `${path}/qualifications`,
            qualificationInput,
            Recovery.PaidRecoveryView,
          );

          const qualification = qualified.qualifications[0];

          if (!qualification) throw new Error("Missing fault fixture qualification");
          path += "/claim-reviews";
          input = {
            assessmentDigest: retained.assessment.digest,
            qualificationId: qualification.id,
            recoveryReceivableAccountId: "employee_recovery",
            accountingPeriodId: "period_2026",
            postingDate: "2026-10-05",
            series: "L",
          };
        }
      }
    }

    const admin = await database();
    const commandKey = key();

    const snapshot = async () => {
      const rows = [];

      for (const name of [
        "command_receipts",
        "payroll_paid_recovery_assessments",
        "payroll_paid_recovery_drafts",
        "payroll_paid_recovery_legs",
        "payroll_paid_recovery_attachments",
        "payroll_paid_recovery_qualifications",
        "payroll_paid_recovery_claim_reviews",
        "payroll_paid_recovery_cancellations",
        "payroll_adjustment_bases",
        "payroll_settlement_reviews",
        "change_sets",
      ])
        rows.push({
          table: name,
          rows: (
            await admin.query(
              `SELECT to_jsonb(t) AS body FROM openerp.${admin.escapeIdentifier(name)} t WHERE book_id=$1 ORDER BY to_jsonb(t)::text COLLATE "C"`,
              [f.book.bookId],
            )
          ).rows,
        });

      return rows;
    };

    const before = await snapshot();
    const financeBefore = await paidRecoveryCensus(f.book);
    const functionName = admin.escapeIdentifier(`r43_fault_${f.book.bookId}`);
    const triggerName = admin.escapeIdentifier(`r43_fault_${f.book.bookId}`);
    const tableName = admin.escapeIdentifier(table);
    const bookLiteral = admin.escapeLiteral(f.book.bookId);

    try {
      await admin.query(
        `CREATE FUNCTION openerp.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.book_id=${bookLiteral} THEN RAISE EXCEPTION 'scoped synthetic R43 persistence fault'; END IF; RETURN NEW; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON openerp.${tableName} FOR EACH ROW EXECUTE FUNCTION openerp.${functionName}()`,
      );

      const failed = await request(actor, path, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(input),
      });

      expect(failed.status).toBe(500);
      expect(await snapshot()).toEqual(before);
      expect(await paidRecoveryCensus(f.book)).toEqual(financeBefore);
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS ${triggerName} ON openerp.${tableName}`);
      await admin.query(`DROP FUNCTION IF EXISTS openerp.${functionName}()`);
    }

    try {
      const retained = await decoded(
        await request(actor, path, {
          method: "POST",
          headers: { "idempotency-key": commandKey },
          body: JSON.stringify(input),
        }),
        Recovery.PaidRecoveryView,
      );

      expect(
        await decoded(
          await request(actor, path, {
            method: "POST",
            headers: { "idempotency-key": commandKey },
            body: JSON.stringify(input),
          }),
          Recovery.PaidRecoveryView,
        ),
      ).toEqual(retained);
      expect(await paidRecoveryCensus(f.book)).toEqual(financeBefore);
      await artifact(`r43-rollback-${table}.json`, {
        before,
        after: await snapshot(),
        retained,
        financeBefore,
      });
    } finally {
      await admin.end();
    }
  },
);

test(
  "R43 V8 populated restore retains refusal, proposal, independent qualification, claim, cancellation and partial noncash links",
  { timeout: 600000 },
  async () => {
    const { proveReminderRecovery } = await import("./support/reminder-recovery");
    const f = await paidRecoveryFixture();
    const another = await prepare(f);

    const cancelled = await post(
      f.book,
      `${root}/${another.assessment.id}/cancellations`,
      { assessmentDigest: another.assessment.digest, reason: "Retained cancelled restore fixture" },
      Recovery.PaidRecoveryView,
    );

    const c = await claim(f);
    const leg = c.split.drafts[0]?.legs[0];

    if (!leg) throw new Error("Missing restore fixture installment");
    const offset = await f.executeReview(offsetInput(f, c, leg));

    if (!offset.execution.instruction) throw new Error("Missing restore fixture instruction");
    const consumed = await consume(f, offset.execution.instruction.id, f.octoberInput);

    const noncash = await f.executeReview({
      kind: "noncash_payment",
      runId: consumed.run.id,
      employeeId: f.calculation.employeeId,
      evidenceId: f.source.id,
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-31",
      series: "L",
      reason: "Retained zero-net recovery restore fixture",
    });

    const retained = await decoded(
      await request(f.book, `${root}/${c.prepared.assessment.id}`),
      Recovery.PaidRecoveryView,
    );

    const later = c.split.drafts[0]?.legs[1];

    if (!later) throw new Error("Missing restored continuation leg");
    const novemberInput = await f.laterInput("2026-11", "15000");

    const novemberCapacity = await post(
      f.book,
      "/payroll/calculations",
      novemberInput,
      Calculations.PayrollCalculation,
    );

    const restore = (
      await proveReminderRecovery(f.book.bookId, [8], async (baseUrl) => {
        async function restoredRequest(actor: typeof f.book, path: string, input?: unknown) {
          return fetch(`${baseUrl}${actor.path}${path}`, {
            method: input === undefined ? "GET" : "POST",
            headers: {
              authorization: `Bearer ${actor.token}`,
              "content-type": "application/json",
              "idempotency-key": key(),
            },
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
          });
        }

        const initial = await decoded(
          await restoredRequest(f.book, `${root}/${c.prepared.assessment.id}`),
          Recovery.PaidRecoveryView,
        );

        expect(initial).toEqual(retained);

        const review = await decoded(
          await restoredRequest(
            f.book,
            "/payroll/settlement-reviews",
            offsetInput(f, c, later, novemberCapacity.id),
          ),
          Settlement.SettlementReview,
        );

        const approval = await decoded(
          await restoredRequest(f.approver, `/payroll/settlement-reviews/${review.id}/approvals`, {
            reviewDigest: review.digest,
          }),
          Settlement.SettlementApproval,
        );

        const execution = await decoded(
          await restoredRequest(f.book, `/payroll/settlement-reviews/${review.id}/executions`, {
            reviewDigest: review.digest,
            approvalId: approval.id,
          }),
          Settlement.SettlementExecution,
        );

        if (!execution.instruction) throw new Error("Missing actual restored instruction");

        const calculation = await decoded(
          await restoredRequest(f.book, "/payroll/calculations", {
            ...novemberInput,
            adjustmentIds: [execution.instruction.id],
          }),
          Calculations.PayrollCalculation,
        );

        const run = await decoded(
          await restoredRequest(f.book, "/payroll/runs", {
            ...f.input,
            calculationIds: [calculation.id],
            postingDate: "2026-11-30",
          }),
          Runs.PayrollRun,
        );

        const runApproval = await decoded(
          await restoredRequest(f.approver, `/payroll/runs/${run.id}/approvals`, {
            runDigest: run.digest,
          }),
          Runs.PayrollRunApproval,
        );

        const runExecution = await decoded(
          await restoredRequest(f.book, `/payroll/runs/${run.id}/executions`, {
            runDigest: run.digest,
            approvalId: runApproval.id,
          }),
          Runs.PayrollRunExecution,
        );

        const final = await decoded(
          await restoredRequest(f.book, `/payroll/settlement-reviews/${review.id}`),
          Settlement.SettlementView,
        );

        expect(final.netInstruction?.remainingReceivableMinor).toBe("0");
        expect(final.netInstruction?.consumedRunId).toBe(run.id);

        const original = await decoded(
          await restoredRequest(f.book, `/payroll/settlement-reviews/${f.payment.review.id}`),
          Settlement.SettlementView,
        );

        expect(original.execution?.paidEvent).toEqual(f.paid);

        return {
          initial,
          review,
          approval,
          execution,
          calculation,
          run,
          runApproval,
          runExecution,
          final,
          originalPaid: original.execution?.paidEvent,
        };
      })
    )[0];

    if (!restore || restore.inventory.version !== 8)
      throw new Error("Missing populated paid recovery restore proof");
    expect(restore.restoredInventory).toEqual(restore.inventory);
    expect(
      restore.inventory.paidRecoveryRecords
        .filter((row) => row.bookId === f.book.bookId)
        .map((row) => row.table),
    ).toEqual(
      expect.arrayContaining([
        "payroll_paid_recovery_assessments",
        "payroll_paid_recovery_drafts",
        "payroll_paid_recovery_legs",
        "payroll_paid_recovery_attachments",
        "payroll_paid_recovery_qualifications",
        "payroll_paid_recovery_claim_reviews",
        "payroll_paid_recovery_cancellations",
      ]),
    );
    expect(restore.bodyHashes.map((row) => row.table)).toContain("payroll_recovery_allocations");
    expect(restore.fence).toEqual({ allowConnections: false, connectionLimit: 0 });
    expect(restore.continuation).toMatchObject({
      final: { netInstruction: { remainingReceivableMinor: "0" } },
    });
    expect((await projection(f)).allocations.map((row) => row.body.amountMinor)).toEqual(["45000"]);
    await artifact("r43-populated-v8-restore.json", {
      retained,
      cancelled,
      consumed,
      noncash,
      restore,
    });
  },
);

test("paid recovery source choices retain payroll access and book scope without exposing content", async () => {
  const f = await paidRecoveryFixture();
  const foreign = await paidRecoveryFixture();
  const response = await request(f.book, "/payroll/paid-recovery-basis-sources");
  expect(response.status).toBe(200);
  const page = await decoded(response, Recovery.PaidRecoveryBasisSources);
  expect(page.scope).toEqual({ entityId: f.book.entityId, bookId: f.book.bookId });
  expect(page.items.some((source) => source.id === f.source.id)).toBe(true);
  expect(page.items.some((source) => source.id === foreign.source.id)).toBe(false);
  expect(page.items.every((source) => !("content" in source))).toBe(true);
  expect(
    (
      await request(
        { ...f.book, token: foreign.book.token },
        "/payroll/paid-recovery-basis-sources",
      )
    ).status,
  ).toBe(403);
  expect(
    (await request(f.book, `/payroll/paid-recovery-basis-sources?cursor=${foreign.source.id}`))
      .status,
  ).toBe(422);
  await writeFile(
    join(environment().artifacts, "paid-recovery-source-choices.json"),
    JSON.stringify(page, null, 2),
  );
});
