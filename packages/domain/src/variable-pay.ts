import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";
import { PositiveRatePart } from "./exchange-rates";

// Pure variable-pay and holiday-liability math. NEXT-35 leaf: work-timeline
// normalization, exact variable components, and the holiday liability as an
// owned rollforward.
//
// One reviewed employment/agreement regime applies at a time. Irregular
// schedules are explicit input: no 40-hour week, five-day or salary/30
// assumption lives here. Collective-agreement, sick-pay, waiting-deduction
// and holiday formulas are dated qualified release data, not embedded
// guesses. Components pass their bases to the existing NEXT-20
// withholding/contribution calculator; pay-run posting, NEXT-36 paid deltas
// and salary privacy remain with their owners.

export const VariablePayFailureCode = Schema.Literals([
  "DuplicateWorkSource",
  "NegativeWorkInterval",
  "OverlappingExclusiveWork",
  "UnresolvedWork",
  "UnsupportedTreatment",
  "DoubleConsumedSource",
  "NonPositiveAmount",
  "UnbalancedComponent",
  "UnbalancedJournal",
]);

export type VariablePayFailureCode = typeof VariablePayFailureCode.Type;

export const VariablePayFailure = Schema.Struct({
  code: VariablePayFailureCode,
  message: Description,
});

export type VariablePayFailure = typeof VariablePayFailure.Type;

export type Checked<A> = Result.Result<A, VariablePayFailure>;

function fail(code: VariablePayFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const WorkSegmentKind = Schema.Literals([
  "worked",
  "overtime",
  "paid_absence",
  "unpaid_absence",
  "sick",
]);

export type WorkSegmentKind = typeof WorkSegmentKind.Type;

export const WorkSegment = Schema.Struct({
  sourceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  kind: WorkSegmentKind,
  // Exact work units in the profile's declared unit (for example minutes).
  // Contractual meaning beats clock duration; DST-affected intervals the
  // profile cannot resolve arrive as explicitly unresolved, never as
  // silently converted clock time.
  unitsMinor: MinorUnits,
  scheduleDate: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
});

export type WorkSegment = typeof WorkSegment.Type;

export const NormalizedWork = Schema.Struct({
  workedMinor: MinorUnits,
  overtimeMinor: MinorUnits,
  paidAbsenceMinor: MinorUnits,
  unpaidAbsenceMinor: MinorUnits,
  sickMinor: MinorUnits,
});

export type NormalizedWork = typeof NormalizedWork.Type;

// Mutually exclusive kinds never share accounted time on the same schedule
// date: worked time and unpaid absence over the same hour is a conflict,
// not a calculation input.
const exclusivePairs: ReadonlyArray<readonly [string, string]> = [
  ["worked", "unpaid_absence"],
  ["overtime", "unpaid_absence"],
  ["worked", "sick"],
];

// Normalizing validates the timeline and totals exact units by kind.
// Overlap detection here is per schedule date between exclusive kinds;
// finer interval geometry belongs to the qualified calendar owner.
export function normalizeWork(
  segments: ReadonlyArray<WorkSegment>,
  unresolvedIntervalCount: number,
): Checked<NormalizedWork> {
  if (unresolvedIntervalCount !== 0) {
    return fail(
      "UnresolvedWork",
      "Unresolved intervals stay for review instead of entering calculation.",
    );
  }

  const seen = new Set<string>();
  const kindsByDate = new Map<string, Set<string>>();

  const totals = {
    worked: 0n,
    overtime: 0n,
    paid_absence: 0n,
    unpaid_absence: 0n,
    sick: 0n,
  };

  for (const segment of segments) {
    if (seen.has(segment.sourceId)) {
      return fail("DuplicateWorkSource", `Work source ${segment.sourceId} is reported twice.`);
    }

    seen.add(segment.sourceId);

    const units = BigInt(segment.unitsMinor);

    if (units < 0n) {
      return fail("NegativeWorkInterval", `Segment ${segment.sourceId} has negative units.`);
    }

    let kinds = kindsByDate.get(segment.scheduleDate);

    if (kinds === undefined) {
      kinds = new Set();
      kindsByDate.set(segment.scheduleDate, kinds);
    }

    for (const [first, second] of exclusivePairs) {
      if (
        (segment.kind === first && kinds.has(second)) ||
        (segment.kind === second && kinds.has(first))
      ) {
        return fail(
          "OverlappingExclusiveWork",
          `${first} and ${second} overlap on ${segment.scheduleDate}.`,
        );
      }
    }

    kinds.add(segment.kind);
    totals[segment.kind] += units;
  }

  return Result.succeed({
    workedMinor: amount(totals.worked),
    overtimeMinor: amount(totals.overtime),
    paidAbsenceMinor: amount(totals.paid_absence),
    unpaidAbsenceMinor: amount(totals.unpaid_absence),
    sickMinor: amount(totals.sick),
  });
}

export const PayComponentKind = Schema.Literals(["cash", "taxable_benefit"]);

export type PayComponentKind = typeof PayComponentKind.Type;

export const VariableEarning = Schema.Struct({
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  componentKind: PayComponentKind,
  // Exact rational quantity: unitsNumerator/unitsDenominator at rateMinor
  // per whole unit. A 75/2-hour quantity at 2000 minor/hour is exact.
  unitsNumerator: MinorUnits,
  unitsDenominator: PositiveRatePart,
  rateMinor: MinorUnits,
  // One amount may join several calculation bases without becoming several
  // expenses; each base flag routes it onward separately.
  withholdingBase: Schema.Boolean,
  contributionBase: Schema.Boolean,
  holidayAccrualBase: Schema.Boolean,
});

export type VariableEarning = typeof VariableEarning.Type;

export const PayComponent = Schema.Struct({
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  componentKind: PayComponentKind,
  amountMinor: MinorUnits,
  withholdingBase: Schema.Boolean,
  contributionBase: Schema.Boolean,
  holidayAccrualBase: Schema.Boolean,
});

export type PayComponent = typeof PayComponent.Type;

// Exact variable components. Unsupported treatments refuse rather than
// classifying every benefit as cash pay; an earning source consumed by
// another active run refuses as double consumption.
export function calculateVariablePay(
  earnings: ReadonlyArray<VariableEarning>,
  knownConsumedSources: ReadonlyArray<string>,
): Checked<ReadonlyArray<PayComponent>> {
  const seen = new Set<string>();
  const components: Array<PayComponent> = [];

  for (const earning of earnings) {
    if (seen.has(earning.sourceIdentity) || knownConsumedSources.includes(earning.sourceIdentity)) {
      return fail(
        "DoubleConsumedSource",
        `Earning source ${earning.sourceIdentity} is already consumed.`,
      );
    }

    seen.add(earning.sourceIdentity);

    const numerator = BigInt(earning.unitsNumerator);
    const denominator = BigInt(earning.unitsDenominator);
    const rate = BigInt(earning.rateMinor);

    if (numerator < 0n || denominator <= 0n || rate < 0n) {
      return fail("NonPositiveAmount", `Earning ${earning.sourceIdentity} has no exact basis.`);
    }

    const product = numerator * rate;

    if (product % denominator !== 0n) {
      return fail(
        "UnbalancedComponent",
        `Earning ${earning.sourceIdentity} has a fractional minor amount.`,
      );
    }

    const value = product / denominator;

    if (value <= 0n) {
      return fail("NonPositiveAmount", `Earning ${earning.sourceIdentity} pays nothing.`);
    }

    components.push({
      sourceIdentity: earning.sourceIdentity,
      componentKind: earning.componentKind,
      amountMinor: amount(value),
      withholdingBase: earning.withholdingBase,
      contributionBase: earning.contributionBase,
      holidayAccrualBase: earning.holidayAccrualBase,
    });
  }

  return Result.succeed(components);
}

export const HolidayMovementKind = Schema.Literals([
  "earned",
  "used",
  "expired_if_qualified",
  "paid_out",
  "corrected",
]);

export type HolidayMovementKind = typeof HolidayMovementKind.Type;

export const HolidayMovement = Schema.Struct({
  kind: HolidayMovementKind,
  unitsMinor: MinorUnits,
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type HolidayMovement = typeof HolidayMovement.Type;

export const HolidayTargetInput = Schema.Struct({
  openingUnitsMinor: MinorUnits,
  openingValueMinor: MinorUnits,
  openingSocialMinor: MinorUnits,
  movements: Schema.Array(HolidayMovement).check(Schema.isMaxLength(500)),
  // Qualified valuation of one unit at the cutoff from the retained rate
  // and earning basis, plus the reviewed contribution-provision fraction.
  valuationPerUnitMinor: MinorUnits,
  provisionNumerator: MinorUnits,
  provisionDenominator: PositiveRatePart,
});

export type HolidayTargetInput = typeof HolidayTargetInput.Type;

export const HolidayTarget = Schema.Struct({
  unitsMinor: SignedMinorUnits,
  valueMinor: SignedMinorUnits,
  socialTargetMinor: SignedMinorUnits,
});

export type HolidayTarget = typeof HolidayTarget.Type;

// The owned rollforward: opening units plus earned, less used and qualified
// expired or paid-out units, valued at the qualified per-unit basis with a
// reviewed social provision.
export function holidayTarget(input: HolidayTargetInput): Checked<HolidayTarget> {
  let units = BigInt(input.openingUnitsMinor);

  for (const movement of input.movements) {
    const movementUnits = BigInt(movement.unitsMinor);

    if (movementUnits < 0n) {
      return fail("NonPositiveAmount", "A holiday movement cannot be negative.");
    }

    if (movement.kind === "earned" || movement.kind === "corrected") {
      units += movementUnits;
    } else {
      units -= movementUnits;
    }
  }

  const perUnit = BigInt(input.valuationPerUnitMinor);
  const denominator = BigInt(input.provisionDenominator);

  if (perUnit < 0n || denominator <= 0n) {
    return fail("NonPositiveAmount", "The valuation basis must be exactly non-negative.");
  }

  const value = units * perUnit;
  const social = (value * BigInt(input.provisionNumerator)) / denominator;

  if ((value * BigInt(input.provisionNumerator)) % denominator !== 0n) {
    return fail("UnbalancedComponent", "The social provision has a fractional minor amount.");
  }

  return Result.succeed({
    unitsMinor: amount(units),
    valueMinor: amount(value),
    socialTargetMinor: amount(social),
  });
}

export const HolidayAdjustmentInput = Schema.Struct({
  currentMoneyLiabilityMinor: SignedMinorUnits,
  currentSocialProvisionMinor: SignedMinorUnits,
  target: HolidayTarget,
  expenseAccountId: Identifier,
  liabilityAccountId: Identifier,
  socialExpenseAccountId: Identifier,
  socialProvisionAccountId: Identifier,
});

export type HolidayAdjustmentInput = typeof HolidayAdjustmentInput.Type;

// The control adjustment toward the target. Negative deltas reverse the
// relevant accrual effects; they never touch paid wages.
export function compileHolidayAdjustment(
  input: HolidayAdjustmentInput,
): Checked<{ readonly moneyDeltaMinor: string; readonly socialDeltaMinor: string; readonly journal: ReadonlyArray<{
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
}> }> {
  const targetValue = BigInt(input.target.valueMinor);
  const currentMoney = BigInt(input.currentMoneyLiabilityMinor);

  const moneyDelta = targetValue - currentMoney;

  const targetSocial = BigInt(input.target.socialTargetMinor);
  const currentSocial = BigInt(input.currentSocialProvisionMinor);

  const socialDelta = targetSocial - currentSocial;

  const leg = (accountId: string, signed: bigint, description: string) =>
    signed === 0n
      ? null
      : {
          accountId,
          debitMinor: amount(signed > 0n ? signed : 0n),
          creditMinor: amount(signed < 0n ? -signed : 0n),
          description,
        };

  const journal = [
    leg(input.expenseAccountId, moneyDelta, "Holiday accrual expense"),
    leg(input.liabilityAccountId, -moneyDelta, "Holiday liability"),
    leg(input.socialExpenseAccountId, socialDelta, "Social accrual expense"),
    leg(input.socialProvisionAccountId, -socialDelta, "Social provision liability"),
  ].filter((line) => line !== null);

  return Result.succeed({
    moneyDeltaMinor: amount(moneyDelta),
    socialDeltaMinor: amount(socialDelta),
    journal,
  });
}

export const HolidayPayReleaseInput = Schema.Struct({
  accruedLiabilityMinor: MinorUnits,
  holidayPaidMinor: MinorUnits,
});

export type HolidayPayReleaseInput = typeof HolidayPayReleaseInput.Type;

// During holiday pay the compiler debits the existing liability to the
// eligible accrued extent and expenses only the unprovided remainder.
export function releaseHolidayPay(
  input: HolidayPayReleaseInput,
): Checked<{ readonly releasedMinor: string; readonly expensedRemainderMinor: string }> {
  const accrued = BigInt(input.accruedLiabilityMinor);
  const paid = BigInt(input.holidayPaidMinor);

  if (paid <= 0n) {
    return fail("NonPositiveAmount", "Holiday pay must be positive.");
  }

  const released = paid < accrued ? paid : accrued;

  return Result.succeed({
    releasedMinor: amount(released),
    expensedRemainderMinor: amount(paid - released),
  });
}
