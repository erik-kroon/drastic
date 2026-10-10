import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Accounting from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Db from "../../db/payroll/paid-recovery";
import * as RunDb from "../../db/payroll/runs";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { validateComparison } from "./paid-comparison-basis";
import { currentCalculation } from "./run-basis";
import { readRetained } from "./settlement-support";
import { getSettlementInTransaction } from "./settlements";
import { ClaimReviewLink, readPaidRecoveryRecord } from "./paid-recovery-records";

export const currentPaidRecoveryAssessment = Effect.fn("payroll.currentPaidRecoveryAssessment")(
  function* (
    tx: Transaction,
    scope: Scope,
    assessment: typeof Recovery.PaidRecoveryAssessment.Type,
  ) {
    const { comparison, paid } = yield* validateComparison(tx, scope, assessment.comparisonId);
    const { calculation } = yield* currentCalculation(tx, scope, assessment.capacity.calculationId);

    if (
      comparison.digest !== assessment.comparisonDigest ||
      paid.digest !== assessment.paidEventDigest ||
      calculation.planDigest !== assessment.capacity.digest ||
      calculation.employeeId !== assessment.employee.id ||
      calculation.calculation.payableMinor !== assessment.capacity.availableNetMinor
    )
      return yield* failure("StaleDependency");

    return { comparison, paid, calculation };
  },
);

function related<A>(
  tx: Transaction,
  scope: Scope,
  table: Exclude<Db.RecordTable, "payroll_paid_recovery_assessments">,
  id: string,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const rows = yield* Db.related(tx, scope.bookId, table, id);

    if (rows.length > 100) return yield* failure("UnsupportedProfile");
    const records = [];

    for (const row of rows) {
      const identity = row.body.id;

      if (typeof identity !== "string") return yield* failure("StaleDependency");
      records.push(yield* readPaidRecoveryRecord(tx, scope, table, identity, schema));
    }

    return records;
  });
}

const runView = Effect.fn("payroll.paidRecoveryRunView")(function* (
  tx: Transaction,
  scope: Scope,
  run: typeof Runs.PayrollRun.Type,
) {
  const executionRow = (yield* RunDb.readExecution(tx, scope.bookId, run.id))[0];

  const execution = executionRow
    ? yield* decode(Runs.PayrollRunExecution, executionRow.body)
    : null;

  const active = execution ? null : (yield* RunDb.readActiveApproval(tx, run))[0];

  return {
    run,
    execution,
    approval: active
      ? {
          id: active.id,
          runId: run.id,
          runDigest: run.digest,
          actorId: active.actorId,
          expiresAt: active.expiresAt,
        }
      : null,
  };
});

const assessmentIsCurrent = Effect.fn("payroll.paidRecoveryAssessmentIsCurrent")(function* (
  tx: Transaction,
  scope: Scope,
  assessment: typeof Recovery.PaidRecoveryAssessment.Type,
) {
  const result = yield* Effect.result(currentPaidRecoveryAssessment(tx, scope, assessment));

  if (Result.isSuccess(result)) return true;

  if (
    result.failure instanceof Accounting.AccountingError &&
    ["StaleDependency", "AlreadyPosted", "UnsupportedProfile", "NotFound"].includes(
      result.failure.code,
    )
  )
    return false;

  return yield* Effect.fail(result.failure);
});

const recoveryLegView = Effect.fn("payroll.paidRecoveryLegView")(function* (
  tx: Transaction,
  scope: Scope,
  employeeId: string,
  leg: typeof Recovery.PaidRecoveryLeg.Type,
) {
  const reviewRows = yield* Db.legReviews(tx, scope.bookId, leg.id);

  if (reviewRows.length > 100) return yield* failure("UnsupportedProfile");

  const reviews = [];

  for (const row of reviewRows) {
    const review = yield* decode(Settlement.SettlementReview, row.body);

    reviews.push(yield* getSettlementInTransaction(tx, scope, review.id));
  }

  const instructionIds = reviews.flatMap((row) =>
    row.execution?.instruction ? [row.execution.instruction.id] : [],
  );

  const runs = yield* Db.instructionRuns(tx, scope.bookId, instructionIds);

  if (runs.length > 100) return yield* failure("UnsupportedProfile");

  const runRow = runs.at(-1);

  const payrollRun = runRow
    ? yield* runView(tx, scope, yield* decode(Runs.PayrollRun, runRow.body))
    : null;

  const noncashRows = payrollRun
    ? yield* Db.noncashReviews(tx, scope.bookId, payrollRun.run.id, employeeId)
    : [];

  if (noncashRows.length > 100) return yield* failure("UnsupportedProfile");

  const noncashRow = noncashRows.at(-1);

  const noncashReview = noncashRow
    ? yield* decode(Settlement.SettlementReview, noncashRow.body)
    : null;

  const latest = reviews.at(-1);
  const input = latest?.review.input;

  return {
    leg,
    reviews,
    payrollRun,
    noncash: noncashReview ? yield* getSettlementInTransaction(tx, scope, noncashReview.id) : null,
    capacityCalculationId:
      input?.kind === "future_pay"
        ? (input.capacityCalculationId ?? leg.capacityCalculationId)
        : leg.capacityCalculationId,
  };
});

export const paidRecoveryView = Effect.fn("payroll.paidRecoveryView")(function* (
  tx: Transaction,
  scope: Scope,
  assessmentId: string,
) {
  const assessment = yield* readPaidRecoveryRecord(
    tx,
    scope,
    "payroll_paid_recovery_assessments",
    assessmentId,
    Recovery.PaidRecoveryAssessment,
  );

  const originalPaidEvent = yield* readRetained(
    tx,
    scope,
    "payroll_paid_events",
    assessment.paidEventId,
    Settlement.PaidPayrollEvent,
  );

  const comparison = yield* readRetained(
    tx,
    scope,
    "payroll_correction_comparisons",
    assessment.comparisonId,
    Settlement.CorrectionComparison,
  );

  const drafts = yield* related(
    tx,
    scope,
    "payroll_paid_recovery_drafts",
    assessmentId,
    Recovery.PaidRecoveryDraft,
  );

  const attachments = yield* related(
    tx,
    scope,
    "payroll_paid_recovery_attachments",
    assessmentId,
    Recovery.PaidRecoveryAttachment,
  );

  const qualifications = yield* related(
    tx,
    scope,
    "payroll_paid_recovery_qualifications",
    assessmentId,
    Recovery.PaidRecoveryQualification,
  );

  const cancellations = yield* related(
    tx,
    scope,
    "payroll_paid_recovery_cancellations",
    assessmentId,
    Recovery.PaidRecoveryCancellation,
  );

  const links = yield* related(
    tx,
    scope,
    "payroll_paid_recovery_claim_reviews",
    assessmentId,
    ClaimReviewLink,
  );

  if (drafts.length > 1 || cancellations.length > 1 || links.length > 1)
    return yield* failure("StaleDependency");
  const link = links[0];
  const claimSettlement = link ? yield* getSettlementInTransaction(tx, scope, link.reviewId) : null;
  const claimExecution = claimSettlement?.execution ?? null;
  const cancelled = cancellations[0] ?? null;
  const assessmentCurrent = yield* assessmentIsCurrent(tx, scope, assessment);
  const mutable = assessmentCurrent && !cancelled && !claimExecution;
  const legs = [];

  for (const leg of drafts.flatMap((row) => row.legs))
    legs.push(yield* recoveryLegView(tx, scope, assessment.employee.id, leg));

  return {
    assessment,
    originalPaidEvent,
    comparison,
    drafts,
    attachments,
    qualifications,
    cancellation: cancelled,
    claimReview: claimSettlement?.review ?? null,
    claimExecution,
    claimSettlement,
    claimRemainingMinor: claimExecution?.recoveryClaim
      ? (claimSettlement?.remainingReceivableMinor ?? null)
      : null,
    legs,
    current: {
      assessmentCurrent,
      canSplit: mutable && drafts.length === 0,
      canAttach: mutable && attachments.length < 100,
      canCancel: mutable,
      canPrepareClaim:
        mutable && !link && qualifications.some((row) => row.purpose === "gross_claim"),
      status: cancelled
        ? ("cancelled" as const)
        : claimExecution
          ? ("claimed" as const)
          : drafts.length
            ? ("drafted" as const)
            : ("blocked" as const),
    },
  };
});
