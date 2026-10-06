import * as Effect from "effect/Effect";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Db from "../../db/payroll/settlements";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../posting";
import { claimBalance, readRetained } from "./settlement-support";
import { verifyRecoveryLedger } from "./settlement-ledger";

export const claimOffsetCapacity = Effect.fn("payroll.claimOffsetCapacity")(function* (
  tx: Transaction,
  scope: Scope,
  claimId: string,
) {
  const balance = yield* claimBalance(tx, scope, claimId);
  const pending = yield* Db.readClaimOffsetInstructions(tx, scope.bookId, claimId);

  const cancellations = yield* Db.readClaimInstructionCancellations(tx, scope.bookId, claimId);

  if (pending.length > 100 || cancellations.length > 100)
    return yield* failure("UnsupportedProfile");

  return {
    ...balance,
    pending,
    digest: yield* digest({ balance: balance.digest, pending, cancellations }),
  };
});

export const claimOffsetComparison = Effect.fn("payroll.claimOffsetComparison")(function* (
  tx: Transaction,
  scope: Scope,
  claimId: string,
  comparisonId: string,
) {
  const capacity = yield* claimOffsetCapacity(tx, scope, claimId);

  if (capacity.claim.comparisonId !== comparisonId || BigInt(capacity.remaining) <= 0n)
    return yield* failure("StaleDependency");

  yield* verifyRecoveryLedger(tx, scope, [capacity.claim]);

  const comparison = yield* readRetained(
    tx,
    scope,
    "payroll_correction_comparisons",
    comparisonId,
    Settlement.CorrectionComparison,
  );

  const paid = yield* readRetained(
    tx,
    scope,
    "payroll_paid_events",
    capacity.claim.paidEventId,
    Settlement.PaidPayrollEvent,
  );

  if (comparison.paidEventId !== paid.id || comparison.originalPaidDigest !== paid.digest)
    return yield* failure("StaleDependency");

  return { capacity, comparison, paid };
});

export const compileClaimNetOffset = Effect.fn("payroll.compileClaimNetOffset")(function* (
  tx: Transaction,
  scope: Scope,
  input: Extract<typeof Settlement.PrepareSettlement.Type, { kind: "future_pay" }>,
  claimId: string,
) {
  const { capacity, comparison, paid } = yield* claimOffsetComparison(
    tx,
    scope,
    claimId,
    input.comparisonId,
  );

  if (capacity.pending.length || input.futureMonth <= paid.reportingPeriod)
    return yield* failure("AlreadyPosted");

  const lawfulBasis = yield* readRetained(
    tx,
    scope,
    "payroll_adjustment_bases",
    input.lawfulBasisId,
    Settlement.AdjustmentBasis,
  );

  if (
    lawfulBasis.input.kind !== "future_pay" ||
    lawfulBasis.input.recoveryClaimId !== claimId ||
    lawfulBasis.comparisonDigest !== comparison.digest ||
    lawfulBasis.input.evidenceId !== input.evidenceId ||
    lawfulBasis.input.reason !== input.reason
  )
    return yield* failure("StaleDependency");

  return {
    reportingReplacement: null,
    originalRun: paid.originalRun,
    paidEvent: paid,
    comparison,
    lawfulBasis,
    claim: yield* decode(Settlement.RecoveryClaim, capacity.claim),
    cash: null,
    economicKey: `net_recovery:${claimId}:${capacity.digest}`,
    capacityDigest: capacity.digest,
    outputs: {
      reportingReadiness: "not_applicable" as const,
      amountMinor: capacity.remaining,
      remainingReceivableMinor: capacity.remaining,
      signedGrossDeltaMinor: "0",
      contributionCorrectionMinor: "0",
    },
    lines: [],
  };
});
