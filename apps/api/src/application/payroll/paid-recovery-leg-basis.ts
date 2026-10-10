import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Effect from "effect/Effect";
import * as Metadata from "../../db/payroll/paid-recovery";
import * as Db from "../../db/payroll/settlements";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { ClaimReviewLink, LegRecord, readPaidRecoveryRecord } from "./paid-recovery-records";
import { currentCalculation } from "./run-basis";

export const paidRecoveryLegCapacity = Effect.fn("payroll.paidRecoveryLegCapacity")(function* (
  tx: Transaction,
  scope: Scope,
  input: Extract<typeof Settlement.PrepareSettlement.Type, { kind: "future_pay" }>,
  claim: typeof Settlement.RecoveryClaim.Type,
) {
  if (!input.paidRecoveryLegId) return null;

  const leg = yield* readPaidRecoveryRecord(
    tx,
    scope,
    "payroll_paid_recovery_legs",
    input.paidRecoveryLegId,
    LegRecord,
  );

  const assessment = yield* readPaidRecoveryRecord(
    tx,
    scope,
    "payroll_paid_recovery_assessments",
    leg.assessmentId,
    Recovery.PaidRecoveryAssessment,
  );

  const links = yield* Metadata.related(
    tx,
    scope.bookId,
    "payroll_paid_recovery_claim_reviews",
    assessment.id,
  );

  const link = links[0] ? yield* decode(ClaimReviewLink, links[0].body) : null;

  const executionRow = link
    ? (yield* Db.readReviewExecution(tx, scope.bookId, link.reviewId))[0]
    : null;

  const execution = executionRow
    ? yield* decode(Settlement.SettlementExecution, executionRow.body)
    : null;

  if (
    links.length !== 1 ||
    execution?.recoveryClaim?.id !== claim.id ||
    assessment.comparisonId !== claim.comparisonId ||
    assessment.paidEventId !== claim.paidEventId ||
    input.futureMonth !== leg.month ||
    (yield* Metadata.related(
      tx,
      scope.bookId,
      "payroll_paid_recovery_cancellations",
      assessment.id,
    )).length
  )
    return yield* failure("StaleDependency");

  if (
    leg.capacityCalculationId !== null &&
    input.capacityCalculationId !== undefined &&
    input.capacityCalculationId !== leg.capacityCalculationId
  )
    return yield* failure("StaleDependency");

  const calculationId = leg.capacityCalculationId ?? input.capacityCalculationId;

  if (!calculationId) return yield* failure("StaleDependency");
  const { calculation } = yield* currentCalculation(tx, scope, calculationId);

  if (
    calculation.employeeId !== assessment.employee.id ||
    calculation.calculation.earningsPeriod.startsOn.slice(0, 7) !== leg.month ||
    BigInt(calculation.calculation.payableMinor) < BigInt(leg.amountMinor) ||
    (leg.capacityCalculationId !== null && calculation.planDigest !== leg.capacityDigest)
  )
    return yield* failure("StaleDependency");

  return { leg, calculation };
});
