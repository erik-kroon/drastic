import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure mileage math for one trip claim.
// NEXT-34 leaf: distance-based reimbursement with a distinct entitlement,
// a tax-free ceiling and a taxable excess. Distance is an exact
// unit-bearing value: entitlement and ceiling are exact rationals rounded
// half up, never truncated. The entitlement profile and the tax exemption
// profile are separately selected releases; neither is inferred from the
// other and no universal mileage rate exists here. The exempt component
// hands off through the NEXT-33 employee-claim owner and the taxable
// component through payroll, exactly once each. A missing required fact
// is an incomplete claim, never a defaulted private-car assumption.

export const MileageFailureCode = Schema.Literals([
  "IncompleteTripFacts",
  "UnsupportedTripProfile",
  "DuplicateTripClaim",
  "OverlappingTripClaim",
  "TaxableWithoutPayroll",
  "StaleTripBasis",
  "AlreadyAwarded",
  "RecoveryBasisMissing",
  "UnbalancedAward",
]);

export type MileageFailureCode = typeof MileageFailureCode.Type;

export const MileageFailure = Schema.Struct({
  code: MileageFailureCode,
  message: Description,
});

export type MileageFailure = typeof MileageFailure.Type;

export type Checked<A> = Result.Result<A, MileageFailure>;

function fail(code: MileageFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const VehicleOwnership = Schema.Literals(["private_car", "company_car", "other_vehicle"]);

export type VehicleOwnership = typeof VehicleOwnership.Type;

export const TripRevision = Schema.Struct({
  id: Identifier,
  claimantId: Identifier,
  businessPurpose: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  departureOn: AccountingDate,
  arrivalOn: AccountingDate,
  routeEvidenceRef: Identifier,
  routeReviewed: Schema.Boolean,
  origin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  destination: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  distanceInMeters: MinorUnits,
  vehicleIdentity: Schema.NullOr(Identifier),
  ownershipKind: VehicleOwnership,
  fuelPayer: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  previousRevision: Schema.NullOr(Identifier),
});

export type TripRevision = typeof TripRevision.Type;

export const MileageRuleRelease = Schema.Struct({
  releaseId: Identifier,
  distanceUnitMeters: MinorUnits,
  entitlementRateMinorPerUnit: MinorUnits,
  taxExemptRateMinorPerUnit: MinorUnits,
  requiresVehicleIdentity: Schema.Boolean,
  requiresFuelPayer: Schema.Boolean,
  evidenceSourceHash: Digest,
});

export type MileageRuleRelease = typeof MileageRuleRelease.Type;

export const MileageSplit = Schema.Struct({
  distanceUnitsNumerator: MinorUnits,
  distanceUnitsDenominator: MinorUnits,
  entitlementMinor: MinorUnits,
  exemptionCeilingMinor: MinorUnits,
  exemptPaidPartMinor: MinorUnits,
  taxablePartMinor: MinorUnits,
});

export type MileageSplit = typeof MileageSplit.Type;

export const CalculateMileageInput = Schema.Struct({
  trip: TripRevision,
  release: MileageRuleRelease,
});

export type CalculateMileageInput = typeof CalculateMileageInput.Type;

function halfUp(numerator: bigint, denominator: bigint) {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;

  return sign * (quotient + (remainder * 2n >= denominator ? 1n : 0n));
}

// Exact distance split. Meters and the release unit form an exact rational;
// entitlement and ceiling round half up from it. The exempt part is the
// min of entitlement and ceiling under a per-distance-ceiling profile, and
// the taxable part is the remainder. Conservation is rechecked, not
// assumed.
export function calculateMileage(input: CalculateMileageInput): Checked<MileageSplit> {
  const meters = BigInt(input.trip.distanceInMeters);
  const unit = BigInt(input.release.distanceUnitMeters);

  if (unit <= 0n) {
    return fail("UnsupportedTripProfile", "The release distance unit must be positive.");
  }

  if (meters < 0n) {
    return fail("IncompleteTripFacts", "The trip distance cannot be negative.");
  }

  if (input.release.requiresVehicleIdentity && input.trip.vehicleIdentity === null) {
    return fail(
      "IncompleteTripFacts",
      "The profile requires vehicle identity; the trip is incomplete without it.",
    );
  }

  if (input.release.requiresFuelPayer && input.trip.fuelPayer === null) {
    return fail(
      "IncompleteTripFacts",
      "The profile requires the fuel payer; no private-car default is assumed.",
    );
  }

  const entitlementRate = BigInt(input.release.entitlementRateMinorPerUnit);
  const exemptRate = BigInt(input.release.taxExemptRateMinorPerUnit);

  if (entitlementRate < 0n || exemptRate < 0n) {
    return fail("UnsupportedTripProfile", "Release rates cannot be negative.");
  }

  const entitlement = halfUp(meters * entitlementRate, unit);
  const ceiling = halfUp(meters * exemptRate, unit);
  const exempt = entitlement < ceiling ? entitlement : ceiling;
  const taxable = entitlement - exempt;

  if (exempt + taxable !== entitlement) {
    return fail("UnbalancedAward", "The exempt and taxable parts do not conserve the entitlement.");
  }

  return Result.succeed({
    distanceUnitsNumerator: amount(meters),
    distanceUnitsDenominator: amount(unit),
    entitlementMinor: amount(entitlement),
    exemptionCeilingMinor: amount(ceiling),
    exemptPaidPartMinor: amount(exempt),
    taxablePartMinor: amount(taxable),
  });
}

export const PayoutRoute = Schema.Literals(["direct_payment", "payroll"]);

export type PayoutRoute = typeof PayoutRoute.Type;

export const TripAwardPlan = Schema.Struct({
  awardId: Identifier,
  tripRevisionId: Identifier,
  ruleReleaseId: Identifier,
  split: MileageSplit,
  exemptSourceIdentity: Identifier,
  taxableSourceIdentity: Identifier,
  payoutRoute: PayoutRoute,
  payrollProfilePresent: Schema.Boolean,
});

export type TripAwardPlan = typeof TripAwardPlan.Type;

export const PrepareAwardInput = Schema.Struct({
  awardId: Identifier,
  trip: TripRevision,
  release: MileageRuleRelease,
  priorAwardTripIds: Schema.Array(Identifier),
  overlappingTripIds: Schema.Array(Identifier),
  payoutRoute: PayoutRoute,
  payrollProfilePresent: Schema.Boolean,
});

export type PrepareAwardInput = typeof PrepareAwardInput.Type;

// Award preparation seals the split with two disjoint source identities:
// the exempt component for the employee-claim owner and the taxable
// component for payroll. A second key over the same trip never mints a
// second award, and a taxable component without a payroll owner refuses
// instead of falling back to direct payment.
export function prepareTripAward(input: PrepareAwardInput): Checked<TripAwardPlan> {
  if (input.priorAwardTripIds.includes(input.trip.id)) {
    return fail(
      "DuplicateTripClaim",
      "This trip already has an award under an earlier key.",
    );
  }

  if (input.overlappingTripIds.includes(input.trip.id)) {
    return fail(
      "OverlappingTripClaim",
      "An overlapping trip claim for the same economic travel is already retained.",
    );
  }

  if (!input.trip.routeReviewed) {
    return fail("IncompleteTripFacts", "The route is a suggestion until it is reviewed.");
  }

  const split = calculateMileage({ trip: input.trip, release: input.release });

  if (Result.isFailure(split)) return Result.fail(split.failure);

  const taxable = BigInt(split.success.taxablePartMinor);

  if (taxable > 0n && !input.payrollProfilePresent) {
    return fail(
      "TaxableWithoutPayroll",
      "A taxable component needs the payroll owner; direct payment cannot take it.",
    );
  }

  if (taxable > 0n && input.payoutRoute === "direct_payment") {
    return fail(
      "TaxableWithoutPayroll",
      "Direct payment is refused while a taxable component needs payroll.",
    );
  }

  return Result.succeed({
    awardId: input.awardId,
    tripRevisionId: input.trip.id,
    ruleReleaseId: input.release.releaseId,
    split: split.success,
    exemptSourceIdentity: `${input.awardId}-exempt`,
    taxableSourceIdentity: `${input.awardId}-taxable`,
    payoutRoute: taxable > 0n ? "payroll" : input.payoutRoute,
    payrollProfilePresent: input.payrollProfilePresent,
  });
}

export const SameKeyAwardInput = Schema.Struct({
  existingCommandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  existingTripRevisionId: Identifier,
  tripRevisionId: Identifier,
  existingPlan: TripAwardPlan,
});

export type SameKeyAwardInput = typeof SameKeyAwardInput.Type;

// The same trip under a second key recovers no second award.
export function replayTripAward(input: SameKeyAwardInput): Checked<TripAwardPlan> {
  if (input.tripRevisionId !== input.existingTripRevisionId) {
    return fail(
      "DuplicateTripClaim",
      "A different trip cannot reuse a committed award identity.",
    );
  }

  if (input.commandKey !== input.existingCommandKey) {
    return fail("AlreadyAwarded", "This trip already has an award under an earlier key.");
  }

  return Result.succeed(input.existingPlan);
}

export const TripCorrectionInput = Schema.Struct({
  plan: TripAwardPlan,
  revisedTrip: TripRevision,
  release: MileageRuleRelease,
  handoffConsumed: Schema.Boolean,
  lawfulRecoveryBasis: Schema.NullOr(Identifier),
  correctionId: Identifier,
});

export type TripCorrectionInput = typeof TripCorrectionInput.Type;

export const TripCorrection = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("replacing_award"),
    correctionId: Identifier,
    plan: TripAwardPlan,
  }),
  Schema.Struct({
    kind: Schema.Literal("consumed_delta"),
    correctionId: Identifier,
    originalAwardId: Identifier,
    exemptDeltaMinor: MinorUnits,
    taxableDeltaMinor: MinorUnits,
    recoveryBasis: Identifier,
  }),
]);

export type TripCorrection = typeof TripCorrection.Type;

// Revising distance never edits the award. Before the handoff is consumed
// the replacement is exact; after payment or payroll reporting the delta
// carries the original reference and a lawful recovery basis, never an
// unexplained negative net salary.
export function correctTripAward(input: TripCorrectionInput): Checked<TripCorrection> {
  if (input.revisedTrip.id !== input.plan.tripRevisionId) {
    return fail("StaleTripBasis", "The correction names a different trip than the award.");
  }

  const split = calculateMileage({ trip: input.revisedTrip, release: input.release });

  if (Result.isFailure(split)) return Result.fail(split.failure);

  if (!input.handoffConsumed) {
    const replacement = prepareTripAward({
      awardId: input.correctionId,
      trip: input.revisedTrip,
      release: input.release,
      priorAwardTripIds: [],
      overlappingTripIds: [],
      payoutRoute: input.plan.payoutRoute,
      payrollProfilePresent: input.plan.payrollProfilePresent,
    });

    if (Result.isFailure(replacement)) return Result.fail(replacement.failure);

    return Result.succeed({ kind: "replacing_award", correctionId: input.correctionId, plan: replacement.success });
  }

  if (input.lawfulRecoveryBasis === null) {
    return fail(
      "RecoveryBasisMissing",
      "A consumed award needs a lawful recovery basis for its delta.",
    );
  }

  return Result.succeed({
    kind: "consumed_delta",
    correctionId: input.correctionId,
    originalAwardId: input.plan.awardId,
    exemptDeltaMinor: (BigInt(split.success.exemptPaidPartMinor) - BigInt(input.plan.split.exemptPaidPartMinor)).toString(),
    taxableDeltaMinor: (BigInt(split.success.taxablePartMinor) - BigInt(input.plan.split.taxablePartMinor)).toString(),
    recoveryBasis: input.lawfulRecoveryBasis,
  });
}
