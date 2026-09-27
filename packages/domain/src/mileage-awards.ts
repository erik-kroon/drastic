import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";
import { PositiveRatePart } from "./exchange-rates";

// Pure distance-based mileage reimbursement. NEXT-34 leaf: exact
// entitlement calculation with the tax-free ceiling, the taxable excess
// partition, exclusive handoffs, and the award correction boundary.
//
// Distance is an exact unit-bearing value: a displayed kilometre is not a
// Swedish mile and decimals never truncate silently. Rates below are
// reviewed release inputs, never statutory defaults and never inferred
// from each other: the legal/employment entitlement and the tax exemption
// profile are selected separately. A mileage award generates no deductible
// invoice VAT from its tax-free status; parking/toll receipts keep their
// own purchase/claim identities. Posting, payroll execution and payment
// remain with their owners.

export const MileageFailureCode = Schema.Literals([
  "IncompleteTripFacts",
  "DuplicateTripAward",
  "UnsupportedProfile",
  "NonPositiveAmount",
  "UnbalancedEntitlement",
  "MissingPayrollOwner",
  "ConsumedAwardChanged",
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

export const MileageRounding = Schema.Literals(["exact", "half_up"]);

export type MileageRounding = typeof MileageRounding.Type;

export const ExactRate = Schema.Struct({
  numerator: PositiveRatePart,
  denominator: PositiveRatePart,
});

export type ExactRate = typeof ExactRate.Type;

export const MileageCalculationInput = Schema.Struct({
  distanceInMeters: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  metersPerReleaseUnit: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  entitlementRate: ExactRate,
  taxExemptRate: ExactRate,
  distanceRounding: MileageRounding,
  amountRounding: MileageRounding,
});

export type MileageCalculationInput = typeof MileageCalculationInput.Type;

export const MileageCalculation = Schema.Struct({
  distanceUnitsMinor: MinorUnits,
  entitlementMinor: MinorUnits,
  exemptionCeilingMinor: MinorUnits,
  exemptPaidPartMinor: MinorUnits,
  taxablePartMinor: MinorUnits,
});

export type MileageCalculation = typeof MileageCalculation.Type;

function roundUnits(numerator: bigint, denominator: bigint, mode: MileageRounding): Checked<bigint> {
  if (denominator <= 0n) {
    return fail("UnsupportedProfile", "A rate denominator must be positive.");
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (mode === "exact" && remainder !== 0n) {
    return fail(
      "UnbalancedEntitlement",
      "An exact rounding mode refuses a fractional unit instead of truncating it.",
    );
  }

  if (mode === "half_up" && remainder * 2n >= denominator) {
    return Result.succeed(quotient + 1n);
  }

  return Result.succeed(quotient);
}

// The simple min formula applies only to a qualified profile whose
// exemption is a per-distance ceiling. Any other car/fuel/benefit
// arrangement needs a different explicit profile and refuses here.
export function calculateMileage(input: MileageCalculationInput): Checked<MileageCalculation> {
  const meters = BigInt(input.distanceInMeters);
  const perUnit = BigInt(input.metersPerReleaseUnit);
  const units = roundUnits(meters, perUnit, input.distanceRounding);

  if (Result.isFailure(units)) return Result.fail(units.failure);

  const entitlement = roundUnits(
    units.success * BigInt(input.entitlementRate.numerator),
    BigInt(input.entitlementRate.denominator),
    input.amountRounding,
  );

  if (Result.isFailure(entitlement)) return Result.fail(entitlement.failure);

  const ceiling = roundUnits(
    units.success * BigInt(input.taxExemptRate.numerator),
    BigInt(input.taxExemptRate.denominator),
    input.amountRounding,
  );

  if (Result.isFailure(ceiling)) return Result.fail(ceiling.failure);

  const exempt = entitlement.success < ceiling.success ? entitlement.success : ceiling.success;
  const taxable = entitlement.success - exempt;

  if (entitlement.success < 0n || exempt + taxable !== entitlement.success) {
    return fail("UnbalancedEntitlement", "Exempt and taxable parts must equal the entitlement.");
  }

  return Result.succeed({
    distanceUnitsMinor: amount(units.success),
    entitlementMinor: amount(entitlement.success),
    exemptionCeilingMinor: amount(ceiling.success),
    exemptPaidPartMinor: amount(exempt),
    taxablePartMinor: amount(taxable),
  });
}

export const TripFactState = Schema.Literals(["established", "missing", "suggested"]);

export type TripFactState = typeof TripFactState.Type;

export const TripAwardInput = Schema.Struct({
  tripKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  knownTripKeys: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  businessPurpose: TripFactState,
  distance: TripFactState,
  vehicleFacts: TripFactState,
  routeReviewed: Schema.Boolean,
  calculation: MileageCalculation,
  // The taxable component has no direct-payment route: it requires the
  // payroll owner. A direct-payout selection with a taxable part and no
  // payroll profile refuses.
  payrollProfileAvailable: Schema.Boolean,
  exemptRoute: Schema.Literals(["direct_payable", "payroll"]),
  knownHandoffs: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
});

export type TripAwardInput = typeof TripAwardInput.Type;

export const TripAward = Schema.Struct({
  tripKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  exemptComponentId: Identifier,
  taxableComponentId: Schema.NullOr(Identifier),
  exemptMinor: MinorUnits,
  taxableMinor: MinorUnits,
  exemptRoute: Schema.Literals(["direct_payable", "payroll"]),
});

export type TripAward = typeof TripAward.Type;

// Sealing a trip award with disjoint exempt/taxable source identities.
// Route estimates stay suggestions until reviewed; a missing required
// vehicle fact blocks calculation but never defaults to a private car.
export function prepareTripAward(input: TripAwardInput): Checked<TripAward> {
  if (input.knownTripKeys.includes(input.tripKey)) {
    return fail("DuplicateTripAward", "This trip already has an award under another key.");
  }

  if (
    input.businessPurpose !== "established" ||
    input.distance !== "established" ||
    input.vehicleFacts !== "established" ||
    !input.routeReviewed
  ) {
    return fail(
      "IncompleteTripFacts",
      "Business purpose, distance, vehicle facts and a reviewed route are required.",
    );
  }

  const taxable = BigInt(input.calculation.taxablePartMinor);

  if (taxable > 0n && !input.payrollProfileAvailable) {
    return fail(
      "MissingPayrollOwner",
      "A taxable component requires the payroll owner; no direct-payment route exists for it.",
    );
  }

  const components =
    taxable > 0n ? [`${input.tripKey}:exempt`, `${input.tripKey}:taxable`] : [`${input.tripKey}:exempt`];

  for (const component of components) {
    if (input.knownHandoffs.includes(component)) {
      return fail("DuplicateTripAward", `Component ${component} already has a handoff.`);
    }
  }

  return Result.succeed({
    tripKey: input.tripKey,
    exemptComponentId: `trip_${input.tripKey}_exempt`,
    taxableComponentId: taxable > 0n ? `trip_${input.tripKey}_taxable` : null,
    exemptMinor: input.calculation.exemptPaidPartMinor,
    taxableMinor: input.calculation.taxablePartMinor,
    exemptRoute: input.exemptRoute,
  });
}

export const AwardCorrectionInput = Schema.Struct({
  tripKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  handoffConsumed: Schema.Boolean,
  payrollReported: Schema.Boolean,
  replacementKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  knownTripKeys: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  lawfulRecoveryBasis: Schema.NullOr(Identifier),
});

export type AwardCorrectionInput = typeof AwardCorrectionInput.Type;

// Revising distance after approval never edits the award. Before the
// handoff is consumed an exact replacing award is prepared; after payment
// or payroll reporting a delta needs an owned correction with the original
// trip reference and a lawful recovery basis. An overclaim never becomes
// an unexplained negative net salary.
export function correctTripAward(
  input: AwardCorrectionInput,
): Checked<{ readonly mode: "replacing_award" | "delta_correction"; readonly key: string }> {
  if (input.knownTripKeys.includes(input.replacementKey)) {
    return fail("DuplicateTripAward", "The replacement key is already awarded.");
  }

  if (!input.handoffConsumed && !input.payrollReported) {
    return Result.succeed({ mode: "replacing_award", key: input.replacementKey });
  }

  if (input.lawfulRecoveryBasis === null) {
    return fail(
      "ConsumedAwardChanged",
      "A consumed award needs an owned correction with a lawful recovery basis.",
    );
  }

  return Result.succeed({ mode: "delta_correction", key: input.replacementKey });
}
