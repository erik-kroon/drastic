import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";
import { CurrencyCode } from "./exchange-rates";

// Pure historical open-item adoption math for one book and cutover.
// NEXT-12 leaf: residual adoption and pool conservation without new
// recognition. Adoption adds live settlement identity, not another journal:
// no voucher is consumed and no ledger sequence increments here.
//
// No database, no runtime, no FX and no SIE parsing. Every position input
// (reviewed pool residual, effective assignments, native obligation history,
// evidenced residual at cutover) arrives as a reviewed exact amount; the
// application owns reading it from the historical import/OpeningSet owner
// (`apps/api/src/application/sie/historical-items.ts`), the commerce
// settlement owner and the approval ports. A bound failure is an error
// rather than a partial adoption or a netted pool.

export const AdoptionFailureCode = Schema.Literals([
  "AmbiguousFinancialBasis",
  "UnverifiedPoolBasis",
  "CurrencyMismatch",
  "DirectionMismatch",
  "ControlAccountMismatch",
  "IncompleteControlPartition",
  "MissingResidualEvidence",
  "UnreconciledResidualBasis",
  "NonPositiveResidual",
  "AlreadyAdopted",
  "PoolCapacityExceeded",
  "UnsupportedCreditDetail",
  "SettlementExceedsRemaining",
  "ControlDifferenceBlocked",
  "StaleAdoptionBasis",
]);

export type AdoptionFailureCode = typeof AdoptionFailureCode.Type;

export const AdoptionFailure = Schema.Struct({
  code: AdoptionFailureCode,
  message: Description,
});

export type AdoptionFailure = typeof AdoptionFailure.Type;

export type Checked<A> = Result.Result<A, AdoptionFailure>;

function fail(code: AdoptionFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function refuse<A>(result: Checked<A>): Checked<never> {
  return Result.isFailure(result)
    ? Result.fail(result.failure)
    : fail("StaleAdoptionBasis", "A checked stage unexpectedly succeeded.");
}

function amount(value: bigint) {
  return value.toString();
}

export const PoolDirection = Schema.Literals(["AR", "AP"]);

export type PoolDirection = typeof PoolDirection.Type;

export const FinancialBasis = Schema.Literals(["full_history", "opening_set"]);

export type FinancialBasis = typeof FinancialBasis.Type;

// The pool is a partition of an existing reviewed GL basis, never a new
// ledger balance. AR/AP and debit/credit directions get separate pools;
// one net balance must not hide offsetting supplier/customer positions.
export const ControlPool = Schema.Struct({
  poolId: Identifier,
  bookId: Identifier,
  historicalBasisId: Identifier,
  cutoverOn: AccountingDate,
  direction: PoolDirection,
  currency: CurrencyCode,
  controlAccountId: Identifier,
  exactReviewedResidualMinor: MinorUnits,
  // The application proves these before calling: the pool's GL identity is
  // the reviewed basis and the independent source total was verified.
  glBasisVerified: Schema.Boolean,
  independentTotalVerified: Schema.Boolean,
  // The complete reviewed control partition this pool belongs to. Partial
  // adoption names an explicit unadopted bucket elsewhere; it never labels
  // itself a full migration.
  partitionDigest: Digest,
  partitionComplete: Schema.Boolean,
  poolVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type ControlPool = typeof ControlPool.Type;

// Unknown history stays unknown: a missing original face or missing prior
// payments never default to zero. The evidenced residual at cutover is the
// only capacity source.
export const KnownAmount = Schema.Struct({
  kind: Schema.Literal("known"),
  amountMinor: MinorUnits,
});

export const UnknownAmount = Schema.Struct({
  kind: Schema.Literal("unknown"),
});

export const HistoryAmount = Schema.Union([KnownAmount, UnknownAmount]);

export type HistoryAmount = typeof HistoryAmount.Type;

export const EvidencedAmount = Schema.Struct({
  kind: Schema.Literal("evidenced"),
  amountMinor: MinorUnits,
  evidenceId: Identifier,
});

export const UnevidencedAmount = Schema.Struct({
  kind: Schema.Literal("unknown"),
});

export const ResidualEvidence = Schema.Union([EvidencedAmount, UnevidencedAmount]);

export type ResidualEvidence = typeof ResidualEvidence.Type;

export const SourceItem = Schema.Struct({
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  historicalBasisId: Identifier,
  direction: PoolDirection,
  currency: CurrencyCode,
  controlAccountId: Identifier,
  originalFace: HistoryAmount,
  priorPayments: HistoryAmount,
  residualAtCutover: ResidualEvidence,
  sourceIssueOn: Schema.NullOr(AccountingDate),
});

export type SourceItem = typeof SourceItem.Type;

export const AdoptionInput = Schema.Struct({
  pool: ControlPool,
  item: SourceItem,
  // Exactly one selected financial basis: full_history XOR opening_set.
  // Both or neither is ambiguous, never a default.
  fullHistorySelected: Schema.Boolean,
  openingSetSelected: Schema.Boolean,
  // Effective pool assignments already retained (this pool only).
  assignedMinor: Schema.Array(MinorUnits),
  // Source identities already adopted in this book/source system, plus
  // native obligation identities the full-history import already
  // established. A native obligation adopts provenance onto that identity
  // rather than creating another.
  knownSourceIdentities: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  knownNativeObligationIds: Schema.Array(Identifier),
  nativeObligationId: Schema.NullOr(Identifier),
  adoptionId: Identifier,
  liveObligationId: Identifier,
});

export type AdoptionInput = typeof AdoptionInput.Type;

export const HistoricalAdoptionPlan = Schema.Struct({
  poolId: Identifier,
  adoptionId: Identifier,
  sourceIdentity: SourceItem.fields.sourceIdentity,
  liveObligationId: Identifier,
  adoptedNativeObligation: Schema.Boolean,
  residualAtCutoverMinor: MinorUnits,
  poolAssignmentMinor: MinorUnits,
  poolVersion: ControlPool.fields.poolVersion,
  partitionDigest: Digest,
  // Unknown history is preserved as metadata, never converted to capacity.
  originalFaceKnown: Schema.Boolean,
  priorPaymentsKnown: Schema.Boolean,
  sourceIssueOn: Schema.NullOr(AccountingDate),
  // Adoption creates no journal and consumes no voucher number.
  journalIds: Schema.Array(Identifier),
  glDeltaMinor: MinorUnits,
});

export type HistoricalAdoptionPlan = typeof HistoricalAdoptionPlan.Type;

function sumMinor(values: ReadonlyArray<string>): bigint {
  let total = 0n;

  for (const value of values) total += BigInt(value);

  return total;
}

// A per-line recognition of 100000 is not automatically a 40000 residual
// after 60000 of historical payments. The complete net basis must be proved:
// when the original face and the prior payments are both known, the
// evidenced residual must equal their difference exactly.
function resolveResidual(item: SourceItem): Checked<bigint> {
  if (item.residualAtCutover.kind !== "evidenced") {
    return fail(
      "MissingResidualEvidence",
      "Adoption needs the exact evidenced outstanding at cutover, not an inferred residual.",
    );
  }

  const residual = BigInt(item.residualAtCutover.amountMinor);

  if (residual <= 0n) {
    return fail(
      "NonPositiveResidual",
      "A zero residual stays historical evidence without live capacity.",
    );
  }

  if (item.originalFace.kind === "known" && item.priorPayments.kind === "known") {
    const net = BigInt(item.originalFace.amountMinor) - BigInt(item.priorPayments.amountMinor);

    if (net !== residual) {
      return fail(
        "UnreconciledResidualBasis",
        "The evidenced residual must equal the known original face less known prior payments.",
      );
    }
  }

  return Result.succeed(residual);
}

export function prepareAdoption(input: AdoptionInput): Checked<HistoricalAdoptionPlan> {
  if (input.fullHistorySelected === input.openingSetSelected) {
    return fail(
      "AmbiguousFinancialBasis",
      "Adoption needs exactly one selected financial basis: full_history XOR opening_set.",
    );
  }

  if (!input.pool.glBasisVerified || !input.pool.independentTotalVerified) {
    return fail(
      "UnverifiedPoolBasis",
      "The pool GL identity and the independent source total must both be verified.",
    );
  }

  if (!input.pool.partitionComplete) {
    return fail(
      "IncompleteControlPartition",
      "The source item must belong to a complete reviewed control partition.",
    );
  }

  if (input.item.historicalBasisId !== input.pool.historicalBasisId) {
    return fail(
      "UnverifiedPoolBasis",
      "The source item must come from the pool's selected reviewed historical inventory.",
    );
  }

  if (input.item.currency !== input.pool.currency) {
    return fail("CurrencyMismatch", "The item currency must match the control pool currency.");
  }

  if (input.item.direction !== input.pool.direction) {
    return fail(
      "DirectionMismatch",
      "AR and AP items need separate control pools; a pool never nets them.",
    );
  }

  if (input.item.controlAccountId !== input.pool.controlAccountId) {
    return fail(
      "ControlAccountMismatch",
      "The item control account must match the control pool account.",
    );
  }

  if (input.knownSourceIdentities.includes(input.item.sourceIdentity)) {
    return fail(
      "AlreadyAdopted",
      "This source item identity was already adopted; replay the same key instead.",
    );
  }

  if (
    input.nativeObligationId !== null &&
    input.knownNativeObligationIds.includes(input.nativeObligationId)
  ) {
    return fail(
      "AlreadyAdopted",
      "A native full-history obligation already represents this item; adopt provenance onto it.",
    );
  }

  const residual = resolveResidual(input.item);

  if (Result.isFailure(residual)) return refuse(residual);

  const used = sumMinor(input.assignedMinor);
  const capacity = BigInt(input.pool.exactReviewedResidualMinor) - used;

  if (residual.success > capacity) {
    return fail(
      "PoolCapacityExceeded",
      "The residual exceeds the pool's remaining reviewed residual.",
    );
  }

  return Result.succeed({
    poolId: input.pool.poolId,
    adoptionId: input.adoptionId,
    sourceIdentity: input.item.sourceIdentity,
    liveObligationId: input.liveObligationId,
    adoptedNativeObligation: input.nativeObligationId !== null,
    residualAtCutoverMinor: amount(residual.success),
    poolAssignmentMinor: amount(residual.success),
    poolVersion: input.pool.poolVersion,
    partitionDigest: input.pool.partitionDigest,
    originalFaceKnown: input.item.originalFace.kind === "known",
    priorPaymentsKnown: input.item.priorPayments.kind === "known",
    sourceIssueOn: input.item.sourceIssueOn,
    journalIds: [],
    glDeltaMinor: "0",
  });
}

export const AdoptionCurrent = Schema.Struct({
  poolVersion: ControlPool.fields.poolVersion,
  exactReviewedResidualMinor: MinorUnits,
  assignedMinor: Schema.Array(MinorUnits),
  knownSourceIdentities: AdoptionInput.fields.knownSourceIdentities,
  knownNativeObligationIds: AdoptionInput.fields.knownNativeObligationIds,
});

export type AdoptionCurrent = typeof AdoptionCurrent.Type;

// Execution-time conservation: the plan's pool, residual and identity must
// still be current inside the owning transaction.
export function assertConservedPoolAssignment(
  plan: HistoricalAdoptionPlan,
  pool: ControlPool,
  current: AdoptionCurrent,
): Checked<HistoricalAdoptionPlan> {
  if (pool.poolId !== plan.poolId || pool.poolVersion !== plan.poolVersion) {
    return fail(
      "StaleAdoptionBasis",
      "The control pool version changed after the adoption plan was sealed.",
    );
  }

  if (
    current.poolVersion !== plan.poolVersion ||
    current.exactReviewedResidualMinor !== pool.exactReviewedResidualMinor
  ) {
    return fail(
      "StaleAdoptionBasis",
      "The reviewed pool residual changed after the adoption plan was sealed.",
    );
  }

  // The plan itself is the claimant: when the current read already lists
  // this identity, a different plan adopted it first.
  if (current.knownSourceIdentities.includes(plan.sourceIdentity)) {
    return fail(
      "AlreadyAdopted",
      "The source identity was adopted after the plan was sealed; replay instead.",
    );
  }

  const used = sumMinor(current.assignedMinor);
  const capacity = BigInt(current.exactReviewedResidualMinor) - used;

  if (BigInt(plan.poolAssignmentMinor) > capacity) {
    return fail(
      "PoolCapacityExceeded",
      "Later adoptions consumed the pool capacity this plan was sealed against.",
    );
  }

  return Result.succeed(plan);
}

export const RemainingInput = Schema.Struct({
  openingResidualMinor: MinorUnits,
  // Effective NEW settlements through the cutoff. Historical payments are
  // never subtracted again.
  settlementMinor: Schema.Array(MinorUnits),
  supportedCreditMinor: Schema.Array(MinorUnits),
  supportedCorrectionMinor: Schema.Array(MinorUnits),
});

export type RemainingInput = typeof RemainingInput.Type;

// openingResidual - NEW settlements - supported NEW credits + supported
// owned correction effects. Historical payments stay out: they are already
// reflected in the adopted opening residual.
export function historicalObligationRemaining(input: RemainingInput): Checked<string> {
  const remaining =
    BigInt(input.openingResidualMinor) -
    sumMinor(input.settlementMinor) -
    sumMinor(input.supportedCreditMinor) +
    sumMinor(input.supportedCorrectionMinor);

  if (remaining < 0n) {
    return fail(
      "SettlementExceedsRemaining",
      "Settlements and supported credits cannot exceed the adopted opening residual.",
    );
  }

  return Result.succeed(amount(remaining));
}

export const SettlementInput = Schema.Struct({
  remainingMinor: MinorUnits,
  paymentMinor: MinorUnits,
});

export type SettlementInput = typeof SettlementInput.Type;

// A supported NEW payment settles through the current commerce settlement
// owner with the historical_open_item adapter. Only payment accounting is
// created (and only when cash is not already posted); the source original
// amount and history stay metadata, never current capacity.
export function prepareSettlement(input: SettlementInput): Checked<string> {
  const remaining = BigInt(input.remainingMinor);
  const payment = BigInt(input.paymentMinor);

  if (payment <= 0n) {
    return fail("SettlementExceedsRemaining", "A new settlement needs a positive amount.");
  }

  if (payment > remaining) {
    return fail(
      "SettlementExceedsRemaining",
      "The new payment exceeds the remaining adopted residual.",
    );
  }

  return Result.succeed(amount(remaining - payment));
}

// A credit needing original line-level tax amounts cannot be compiled from
// the residual alone. Missing detail is a specific unsupported-credit
// blocker; it never prevents a separately supported payment settlement.
export function refuseResidualCredit(detail: string): Checked<never> {
  return fail(
    "UnsupportedCreditDetail",
    `A credit cannot be compiled from the residual alone without original line-level tax detail: ${detail}.`,
  );
}

// adoptedTotal + explicitlyUnadoptedResidual == independentlyReviewedPoolTotal.
// Partial adoption keeps a named unadopted bucket; it is never full migration.
export function assertPoolControl(
  poolTotalMinor: string,
  adoptedTotalMinor: string,
  unadoptedResidualMinor: string,
): Checked<string> {
  if (BigInt(adoptedTotalMinor) + BigInt(unadoptedResidualMinor) !== BigInt(poolTotalMinor)) {
    return fail(
      "ControlDifferenceBlocked",
      "Adopted plus explicitly unadopted must equal the independently reviewed pool total.",
    );
  }

  return Result.succeed(poolTotalMinor);
}

// liveResidual + postCutoverSettlements + supportedCredits - corrections ==
// adopted opening residual. Any unexplained difference blocks
// complete-register readiness.
export function assertLiveControl(input: {
  readonly openingMinor: string;
  readonly liveMinor: string;
  readonly settlementMinor: ReadonlyArray<string>;
  readonly creditMinor: ReadonlyArray<string>;
  readonly correctionMinor: ReadonlyArray<string>;
}): Checked<string> {
  const recomposed =
    BigInt(input.liveMinor) +
    sumMinor(input.settlementMinor) +
    sumMinor(input.creditMinor) -
    sumMinor(input.correctionMinor);

  if (recomposed !== BigInt(input.openingMinor)) {
    return fail(
      "ControlDifferenceBlocked",
      "Live residual plus settlements plus supported credits must recompose the adopted opening.",
    );
  }

  return Result.succeed(input.liveMinor);
}
