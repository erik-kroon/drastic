import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";
import { CurrencyCode, CurrencyScale, PositiveRatePart } from "./exchange-rates";
import { assertBalancedJournal, roundRational, type PurchaseJournalLine } from "./purchasing";

// Pure incremental open-item FX remeasurement for one book, currency and
// cutoff. NEXT-18 leaf: complete-population target carrying and incremental
// differences. The application owns capturing the eligible membership,
// locking capacities and posting; this compiler never reads a database.
//
// ADR 0008 selects incremental valuation without an automatic next-period
// reversal. Foreign quantities never change here, withdrawn rates refuse,
// and a correction after later consumption belongs to the owned chain-repair
// workflow (NEXT-41), not to this profile.

export const RemeasurementFailureCode = Schema.Literals([
  "IncompletePopulation",
  "DuplicateItem",
  "UnsupportedLaterConsumption",
  "UnsupportedRate",
  "UnsupportedScale",
  "UnbalancedJournal",
  "StalePopulation",
]);

export type RemeasurementFailureCode = typeof RemeasurementFailureCode.Type;

export const RemeasurementFailure = Schema.Struct({
  code: RemeasurementFailureCode,
  message: Description,
});

export type RemeasurementFailure = typeof RemeasurementFailure.Type;

export type Checked<A> = Result.Result<A, RemeasurementFailure>;

function fail(code: RemeasurementFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const ValuationRounding = Schema.Literals(["exact", "half_up"]);

export type ValuationRounding = typeof ValuationRounding.Type;

export const ValuationItemDirection = Schema.Literals(["receivable", "payable"]);

export type ValuationItemDirection = typeof ValuationItemDirection.Type;

export const CapacityVersion = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

// One eligible monetary item at the cutoff. The rate is a caller-evidenced
// qualified revision, never a default: an unknown, withdrawn or 1:1-defaulted
// rate must refuse before this compiler runs.
export const ValuationItem = Schema.Struct({
  itemId: Identifier,
  direction: ValuationItemDirection,
  remainingOriginalMinor: MinorUnits,
  originalScale: CurrencyScale,
  currentBookCarryingMinor: MinorUnits,
  capacityVersion: CapacityVersion,
  // A settlement, credit or other consumption dated after the cutoff needs a
  // separate full correction chain; it refuses here.
  consumedAfterCutoff: Schema.Boolean,
  rateRevisionId: Identifier,
  rateNumerator: PositiveRatePart,
  rateDenominator: PositiveRatePart,
  rounding: ValuationRounding,
});

export type ValuationItem = typeof ValuationItem.Type;

export const ValuationSelection = Schema.Struct({
  currency: CurrencyCode,
  accountingCutoff: AccountingDate,
  recordedCutoff: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  // The bounded read must prove it selected every item in scope. Valuing the
  // first page and calling it a complete remeasurement is refused.
  complete: Schema.Boolean,
  expectedItemCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  bookScale: CurrencyScale,
  controlAccountId: Identifier,
  unrealizedGainAccountId: Identifier,
  unrealizedLossAccountId: Identifier,
  economicDecisionId: Identifier,
  // A new approved reporting-rate revision at the same cutoff supersedes a
  // named prior effect. The new target is still computed less CURRENT
  // carrying; the previous delta is never reapplied.
  supersedesEffectId: Schema.NullOr(Identifier),
  items: Schema.Array(ValuationItem).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});

export type ValuationSelection = typeof ValuationSelection.Type;

export const ValuationEffect = Schema.Struct({
  itemId: Identifier,
  cutoff: AccountingDate,
  economicDecisionId: Identifier,
  priorCarryingMinor: MinorUnits,
  targetCarryingMinor: MinorUnits,
  deltaMinor: SignedMinorUnits,
  rateRevisionId: Identifier,
  predecessorEffectId: Schema.NullOr(Identifier),
});

export type ValuationEffect = typeof ValuationEffect.Type;

export const ValuationMembership = Schema.Struct({
  itemId: Identifier,
  capacityVersion: CapacityVersion,
});

export type ValuationMembership = typeof ValuationMembership.Type;

export const ValuationPlan = Schema.Struct({
  currency: CurrencyCode,
  accountingCutoff: AccountingDate,
  recordedCutoff: ValuationSelection.fields.recordedCutoff,
  economicDecisionId: Identifier,
  supersedesEffectId: Schema.NullOr(Identifier),
  membership: Schema.Array(ValuationMembership),
  effects: Schema.Array(ValuationEffect),
  journal: Schema.Array(
    Schema.Struct({
      sourceLineId: Schema.NullOr(Identifier),
      accountId: Identifier,
      debitMinor: MinorUnits,
      creditMinor: MinorUnits,
      description: Description,
    }),
  ),
  // A valuation with no delta retains its complete membership and decision
  // result but consumes no voucher number.
  consumesVoucher: Schema.Boolean,
});

export type ValuationPlan = typeof ValuationPlan.Type;

function amount(value: bigint) {
  return value.toString();
}

function addSigned(
  lines: Array<PurchaseJournalLine>,
  line: {
    readonly accountId: string;
    readonly signedMinor: bigint;
    readonly description: string;
  },
) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: null,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

// Target carrying for one item: the remaining foreign quantity converted at
// the selected reporting rate. The foreign quantity itself is unchanged.
function targetCarrying(item: ValuationItem, bookScale: number): Checked<bigint> {
  const scaleDifference = bookScale - item.originalScale;

  if (scaleDifference < 0) {
    return fail(
      "UnsupportedScale",
      `Book scale cannot be coarser than the original scale of ${item.itemId}.`,
    );
  }

  const scaled = BigInt(item.remainingOriginalMinor) * 10n ** BigInt(scaleDifference);

  const converted = roundRational(
    scaled * BigInt(item.rateNumerator),
    BigInt(item.rateDenominator),
    item.rounding,
  );

  if (Result.isFailure(converted)) {
    return fail("UnsupportedRate", converted.failure.message);
  }

  return Result.succeed(converted.success);
}

export function prepareValuation(selection: ValuationSelection): Checked<ValuationPlan> {
  if (selection.complete !== true || selection.items.length !== selection.expectedItemCount) {
    return fail(
      "IncompletePopulation",
      "A remeasurement needs the complete eligible membership, not a page of it.",
    );
  }

  const seen = new Set<string>();
  const journal: Array<PurchaseJournalLine> = [];
  const effects: Array<ValuationEffect> = [];
  const membership: Array<ValuationMembership> = [];

  for (const item of selection.items) {
    if (seen.has(item.itemId)) {
      return fail("DuplicateItem", `${item.itemId} is selected twice.`);
    }

    seen.add(item.itemId);

    if (item.consumedAfterCutoff) {
      return fail(
        "UnsupportedLaterConsumption",
        `${item.itemId} was consumed after the cutoff and needs a full correction chain.`,
      );
    }

    const target = targetCarrying(item, selection.bookScale);

    if (Result.isFailure(target)) return Result.fail(target.failure);

    const prior = BigInt(item.currentBookCarryingMinor);
    const delta = target.success - prior;

    // Receivable appreciation debits the asset and credits a gain; payable
    // appreciation credits the liability and debits a loss.
    const controlSigned = item.direction === "receivable" ? delta : -delta;

    addSigned(journal, {
      accountId: selection.controlAccountId,
      signedMinor: controlSigned,
      description: `FX valuation ${item.itemId}`,
    });

    if (controlSigned > 0n) {
      addSigned(journal, {
        accountId: selection.unrealizedGainAccountId,
        signedMinor: -controlSigned,
        description: `Unrealized FX gain ${item.itemId}`,
      });
    }

    if (controlSigned < 0n) {
      addSigned(journal, {
        accountId: selection.unrealizedLossAccountId,
        signedMinor: -controlSigned,
        description: `Unrealized FX loss ${item.itemId}`,
      });
    }

    effects.push({
      itemId: item.itemId,
      cutoff: selection.accountingCutoff,
      economicDecisionId: selection.economicDecisionId,
      priorCarryingMinor: item.currentBookCarryingMinor,
      targetCarryingMinor: amount(target.success),
      deltaMinor: amount(delta),
      rateRevisionId: item.rateRevisionId,
      predecessorEffectId: selection.supersedesEffectId,
    });
    membership.push({ itemId: item.itemId, capacityVersion: item.capacityVersion });
  }

  const finished = assertBalancedJournal(journal, 0);

  if (Result.isFailure(finished)) return fail("UnbalancedJournal", finished.failure.message);

  return Result.succeed({
    currency: selection.currency,
    accountingCutoff: selection.accountingCutoff,
    recordedCutoff: selection.recordedCutoff,
    economicDecisionId: selection.economicDecisionId,
    supersedesEffectId: selection.supersedesEffectId,
    membership,
    effects,
    journal: finished.success,
    consumesVoucher: finished.success.length > 0,
  });
}

// Execution-time membership check: a new item dated before the cutoff while
// approval was pending is a stale population, never a partial valuation.
export function assertValuationMembership(
  plan: ValuationPlan,
  current: ReadonlyArray<ValuationMembership>,
): Checked<ReadonlyArray<ValuationMembership>> {
  if (current.length !== plan.membership.length) {
    return fail("StalePopulation", "The eligible population changed after the plan was sealed.");
  }

  const versions = new Map(
    plan.membership.map((member) => [member.itemId, member.capacityVersion]),
  );

  for (const member of current) {
    if (versions.get(member.itemId) !== member.capacityVersion) {
      return fail("StalePopulation", "An item version changed after the plan was sealed.");
    }
  }

  return Result.succeed(current);
}

// Settlement basis for one item: initial carrying plus effective valuation
// deltas less effective carrying releases. Valuation P&L and settlement P&L
// attribution stay separate; a classification-only realized/unrealized
// reclassification is never another economic gain.
export function carryingAfter(
  initialCarryingMinor: string,
  valuationDeltasMinor: ReadonlyArray<string>,
  carryingReleasesMinor: ReadonlyArray<string>,
): string {
  let carrying = BigInt(initialCarryingMinor);

  for (const delta of valuationDeltasMinor) carrying += BigInt(delta);

  for (const release of carryingReleasesMinor) carrying -= BigInt(release);

  return carrying.toString();
}
