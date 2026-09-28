import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { SignedMinorUnits } from "./money";
import { roundRational } from "./purchasing";

// Pure late-FX chain-repair math for one monetary item. NEXT-41 leaf:
// bounded replay of the financial meaning over frozen facts after a
// reporting rate is corrected late, when settlement already consumed the
// old basis (the explicit limitation NEXT-18 records). Requires NEXT-18
// (released); the WIP-FX02-P1 paired-release calculation and the
// commerce-fx owners stay reserved and are never recreated here: each
// settlement's exact paired release arrives as a reviewed input from the
// FX owner, and this leaf replays carrying attribution around it.
//
// OPEN SCOPE DECISION: whether the consumed-chain repair is accepted
// scope and its proof obligation is undecided, so posting, revision
// advance and downstream report/close review stay with the owning
// transaction. Mixed credits, netting, foreign-cash links and cross-item
// chains need their explicit replay handlers and refuse here. A late
// rate decision never changes foreign units paid, cash consideration or
// fee evidence; ambiguous chronology blocks repair.
//
// No database and no runtime. Events arrive in qualified economic
// chronology with explicit tie-breaking. A bound failure is an error,
// never a reversed cash receipt or a reset principal.

export const ChainFailureCode = Schema.Literals([
  "IncompleteClosure",
  "UnhandledEvent",
  "ChronologyAmbiguous",
  "FinalCarryingMismatch",
  "StaleRepair",
  "AlreadyApplied",
  "ClosedPeriodBlocked",
  "UnbalancedRepair",
]);

export type ChainFailureCode = typeof ChainFailureCode.Type;

export const ChainFailure = Schema.Struct({
  code: ChainFailureCode,
  message: Description,
});

export type ChainFailure = typeof ChainFailure.Type;

export type Checked<A> = Result.Result<A, ChainFailure>;

function fail(code: ChainFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const ValuationEvent = Schema.Struct({
  kind: Schema.Literal("valuation"),
  accountingOn: AccountingDate,
  remainingForeignMinor: SignedMinorUnits,
  rateNumerator: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,18}$/)),
  rateDenominator: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,18}$/)),
  eventId: Identifier,
});

export const SettlementEvent = Schema.Struct({
  kind: Schema.Literal("settlement"),
  accountingOn: AccountingDate,
  originalUnitsMinor: SignedMinorUnits,
  // Exact paired release and cash consideration from the FX owner.
  pairedReleaseMinor: SignedMinorUnits,
  cashConsiderationMinor: SignedMinorUnits,
  direction: Schema.Literals(["receivable", "payable"]),
  eventId: Identifier,
});

export const OtherEvent = Schema.Struct({
  kind: Schema.Literal("other"),
  accountingOn: AccountingDate,
  handlerId: Schema.NullOr(Identifier),
  eventId: Identifier,
});

export const ChainEvent = Schema.Union([ValuationEvent, SettlementEvent, OtherEvent]);

export type ChainEvent = typeof ChainEvent.Type;

export const AttributionRole = Schema.Literals(["ar_movement", "pnl"]);

export type AttributionRole = typeof AttributionRole.Type;

export const AttributedLine = Schema.Struct({
  accountingOn: AccountingDate,
  role: AttributionRole,
  amountMinor: SignedMinorUnits,
});

export type AttributedLine = typeof AttributedLine.Type;

export const ChainBasis = Schema.Struct({
  itemId: Identifier,
  activeChainRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  anchorForeignMinor: SignedMinorUnits,
  anchorCarryingMinor: SignedMinorUnits,
  events: Schema.Array(ChainEvent).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  // Original owned vectors plus all previous repair deltas, per date and
  // attribution role. A date/role with no entry counts as zero.
  oldEffective: Schema.Array(AttributedLine),
  plannedCurrentCarryingMinor: SignedMinorUnits,
  repairKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  knownRepairKeys: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  closedPeriodWithoutPolicy: Schema.Boolean,
});

export type ChainBasis = typeof ChainBasis.Type;

export const ChainRepair = Schema.Struct({
  itemId: Identifier,
  repairKey: ChainBasis.fields.repairKey,
  activeChainRevision: ChainBasis.fields.activeChainRevision,
  deltas: Schema.Array(AttributedLine),
  // Attribution only: the correction never moves real cash, fees or
  // foreign quantities, so these are always zero when the repair holds.
  cashDeltaMinor: SignedMinorUnits,
  foreignDeltaMinor: SignedMinorUnits,
  endingCarryingDeltaMinor: SignedMinorUnits,
});

export type ChainRepair = typeof ChainRepair.Type;

function sumMinor(values: ReadonlyArray<string>): bigint {
  let total = 0n;

  for (const value of values) total += BigInt(value);

  return total;
}

function oldAmount(
  oldEffective: ReadonlyArray<AttributedLine>,
  accountingOn: string,
  role: AttributionRole,
): bigint {
  const line = oldEffective.find((entry) => entry.accountingOn === accountingOn && entry.role === role);

  return line === undefined ? 0n : BigInt(line.amountMinor);
}

// Replays the desired attribution over frozen facts with the corrected
// rate inserted, then diffs desired against old effective per date and
// role. A valuation moves both the carrying and the period gain; a
// settlement releases carrying and attributes the realized gain while
// preserving the actual cash consideration and fees untouched.
export function calculateChainRepair(basis: ChainBasis): Checked<ChainRepair> {
  if (basis.closedPeriodWithoutPolicy) {
    return fail(
      "ClosedPeriodBlocked",
      "A closed period needs approved reopening or a qualified prior-period policy before posting.",
    );
  }

  if (basis.knownRepairKeys.includes(basis.repairKey)) {
    return fail(
      "AlreadyApplied",
      "This repair key was already applied; the same aggregate receipt answers.",
    );
  }

  const ordered = [...basis.events].sort((a, b) =>
    a.accountingOn < b.accountingOn ? -1 : a.accountingOn > b.accountingOn ? 1 : 0,
  );

  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];

    if (current === undefined || next === undefined) {
      return fail("IncompleteClosure", "The event closure is missing a member.");
    }

    if (current.accountingOn === next.accountingOn && current.eventId === next.eventId) {
      return fail("ChronologyAmbiguous", "Duplicate event identities block repair.");
    }
  }

  let foreignRemaining = BigInt(basis.anchorForeignMinor);
  let carrying = BigInt(basis.anchorCarryingMinor);
  const desired: Array<AttributedLine> = [];

  for (const event of ordered) {
    if (event.kind === "valuation") {
      const converted = roundRational(
        BigInt(event.remainingForeignMinor) * BigInt(event.rateNumerator),
        BigInt(event.rateDenominator),
        "half_up",
      );

      if (Result.isFailure(converted)) {
        return fail("IncompleteClosure", converted.failure.message);
      }

      const adjustment = converted.success - carrying;

      desired.push({
        accountingOn: event.accountingOn,
        role: "ar_movement",
        amountMinor: amount(adjustment),
      });

      desired.push({
        accountingOn: event.accountingOn,
        role: "pnl",
        amountMinor: amount(adjustment),
      });

      carrying = converted.success;
    } else if (event.kind === "settlement") {
      const release = BigInt(event.pairedReleaseMinor);
      const consideration = BigInt(event.cashConsiderationMinor);

      const gain =
        event.direction === "receivable" ? consideration - release : release - consideration;

      desired.push({
        accountingOn: event.accountingOn,
        role: "ar_movement",
        amountMinor: amount(-release),
      });

      desired.push({
        accountingOn: event.accountingOn,
        role: "pnl",
        amountMinor: amount(gain),
      });

      foreignRemaining -= BigInt(event.originalUnitsMinor);
      carrying -= release;
    } else if (event.handlerId === null) {
      return fail(
        "UnhandledEvent",
        `Event ${event.eventId} has no supported replay handler; it is a blocker, never skipped.`,
      );
    }
  }

  // The replay never touches cash, fees or foreign quantities: the walk
  // above only moves carrying attribution and gain recognition.
  const settledForeign = sumMinor(
    basis.events
      .filter((event) => event.kind === "settlement")
      .map((event) => (event.kind === "settlement" ? event.originalUnitsMinor : "0")),
  );

  if (foreignRemaining !== BigInt(basis.anchorForeignMinor) - settledForeign) {
    return fail("IncompleteClosure", "The foreign-quantity walk did not conserve.");
  }

  if (carrying !== BigInt(basis.plannedCurrentCarryingMinor)) {
    return fail(
      "FinalCarryingMismatch",
      "The reconstructed final carrying does not equal the planned current balance.",
    );
  }

  const seen = new Set<string>();
  const deltas: Array<AttributedLine> = [];

  for (const line of desired) {
    const key = `${line.accountingOn}${line.role}`;

    if (seen.has(key)) continue;

    seen.add(key);

    const want = sumMinor(
      desired
        .filter((entry) => entry.accountingOn === line.accountingOn && entry.role === line.role)
        .map((entry) => entry.amountMinor),
    );

    deltas.push({
      accountingOn: line.accountingOn,
      role: line.role,
      amountMinor: amount(want - oldAmount(basis.oldEffective, line.accountingOn, line.role)),
    });
  }

  const arDelta = sumMinor(
    deltas.filter((line) => line.role === "ar_movement").map((line) => line.amountMinor),
  );

  const oldAr = sumMinor(
    basis.oldEffective
      .filter((line) => line.role === "ar_movement")
      .map((line) => line.amountMinor),
  );

  const desiredAr = sumMinor(
    desired.filter((line) => line.role === "ar_movement").map((line) => line.amountMinor),
  );

  if (arDelta !== desiredAr - oldAr) {
    return fail("UnbalancedRepair", "The grouped carrying delta does not conserve the replay.");
  }

  return Result.succeed({
    itemId: basis.itemId,
    repairKey: basis.repairKey,
    activeChainRevision: basis.activeChainRevision,
    deltas,
    cashDeltaMinor: "0",
    foreignDeltaMinor: "0",
    endingCarryingDeltaMinor: amount(arDelta),
  });
}

export const RepairCurrent = Schema.Struct({
  activeChainRevision: ChainBasis.fields.activeChainRevision,
  eventCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  repairKey: ChainBasis.fields.repairKey,
  knownRepairKeys: ChainBasis.fields.knownRepairKeys,
});

export type RepairCurrent = typeof RepairCurrent.Type;

// A settlement occurring after review makes the whole repair stale: no
// partial delta is posted. A new key over an already applied input change
// is an AlreadyApplied no-effect determination.
export function assertRepairCurrent(
  plan: ChainRepair,
  basis: ChainBasis,
  current: RepairCurrent,
): Checked<ChainRepair> {
  if (current.activeChainRevision !== plan.activeChainRevision) {
    return fail(
      "StaleRepair",
      "An intervening settlement, rate change or consumer moved the chain after review.",
    );
  }

  if (current.eventCount !== basis.events.length) {
    return fail("StaleRepair", "The event closure changed after the repair was sealed.");
  }

  if (current.knownRepairKeys.includes(plan.repairKey)) {
    return fail("AlreadyApplied", "The repair key is already applied; reuse the aggregate receipt.");
  }

  return Result.succeed(plan);
}
