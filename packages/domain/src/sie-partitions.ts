import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { SignedMinorUnits } from "./money";

// Pure multi-year SIE partition math for one source file. NEXT-44 leaf:
// source-year partitioning, dimension-preserving object mapping, per-year
// controls and recoverable run checkpoints. Dependencies NEXT-12
// (open-item bridge) and NEXT-14 (original assignment schema) are
// released; the APP-SLICE-READY(historical-migration) port and the
// bounded parser, staging and run owners stay with their modules. This
// leaf never parses bytes, never posts a voucher and never invents SIE5
// or exporter-specific grammar.
//
// No database and no runtime. Intervals, declarations, mappings and
// control rows arrive as reviewed exact inputs; the application owns
// reading them from the parsed source and the fiscal map. A bound failure
// is an error naming its record location, never a silent split, a moved
// date or an assumed zero.

export const PartitionFailureCode = Schema.Literals([
  "AmbiguousYear",
  "UnassignedVoucher",
  "UnsupportedCrossYearVoucher",
  "DroppedAssignment",
  "AmbiguousAssignment",
  "UnknownControl",
  "ControlMismatch",
  "BoundaryMismatch",
  "StalePartitionBasis",
]);

export type PartitionFailureCode = typeof PartitionFailureCode.Type;

export const PartitionFailure = Schema.Struct({
  code: PartitionFailureCode,
  message: Description,
});

export type PartitionFailure = typeof PartitionFailure.Type;

export type Checked<A> = Result.Result<A, PartitionFailure>;

function fail(code: PartitionFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const FiscalInterval = Schema.Struct({
  sourceYearOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  fiscalStartOn: AccountingDate,
  fiscalEndOn: AccountingDate,
});

export type FiscalInterval = typeof FiscalInterval.Type;

export const ScopedVoucherIdentity = Schema.Struct({
  fiscalYearOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  series: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  number: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
});

export type ScopedVoucherIdentity = typeof ScopedVoucherIdentity.Type;

// A native voucher identity includes book/fiscal year/series/number.
// Identical series and number in two fiscal years are two scoped
// identities, never duplicates.
export function scopeVoucherIdentity(identity: ScopedVoucherIdentity): string {
  return `${identity.fiscalYearOrdinal}/${identity.series}/${identity.number}`;
}

// Choose the unique source year containing the accounting date. No match
// or multiple matches is a blocking diagnostic with the block location.
export function partitionVoucher(
  accountingOn: string,
  intervals: ReadonlyArray<FiscalInterval>,
  blockLocation: string,
): Checked<number> {
  const matches = intervals.filter(
    (interval) => accountingOn >= interval.fiscalStartOn && accountingOn <= interval.fiscalEndOn,
  );

  if (matches.length !== 1 || matches[0] === undefined) {
    return fail(
      "AmbiguousYear",
      `Block ${blockLocation} matches ${matches.length} source years; it is refused, not split.`,
    );
  }

  return Result.succeed(matches[0].sourceYearOrdinal);
}

export const FinalTotals = Schema.Struct({
  transMinor: SignedMinorUnits,
  rtransMinor: SignedMinorUnits,
  btransMinor: SignedMinorUnits,
});

export type FinalTotals = typeof FinalTotals.Type;

// Final #TRANS lines are retained separately from #RTRANS/#BTRANS
// history: historical correction records are never added to final
// transaction totals again.
export function finalTransactionTotal(totals: FinalTotals): string {
  return totals.transMinor;
}

export const DimensionDeclaration = Schema.Struct({
  sourceDimensionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  nativeDimensionCode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

export type DimensionDeclaration = typeof DimensionDeclaration.Type;

export const ObjectMapping = Schema.Struct({
  sourceDimensionId: DimensionDeclaration.fields.sourceDimensionId,
  sourceObjectCode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  nativeValueCode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

export type ObjectMapping = typeof ObjectMapping.Type;

export const MappedAssignment = Schema.Struct({
  nativeDimensionCode: DimensionDeclaration.fields.nativeDimensionCode,
  nativeValueCode: ObjectMapping.fields.nativeValueCode,
  sourceObjectCode: ObjectMapping.fields.sourceObjectCode,
});

export type MappedAssignment = typeof MappedAssignment.Type;

// Map one source dimension/value pair through the reviewed mapping,
// preserving the original source code on the retained tag. Current
// default dimensions are never imported onto historical lines; an
// undeclared, dropped, duplicate or ambiguous pair stops financial
// admission of the affected voucher instead of becoming an empty list.
export function resolveObjectAssignment(
  sourceDimensionId: string,
  sourceObjectCode: string,
  declarations: ReadonlyArray<DimensionDeclaration>,
  mappings: ReadonlyArray<ObjectMapping>,
  lineLocation: string,
): Checked<MappedAssignment> {
  const declaration = declarations.find((entry) => entry.sourceDimensionId === sourceDimensionId);

  if (declaration === undefined) {
    return fail(
      "DroppedAssignment",
      `Line ${lineLocation} names an undeclared source dimension; the voucher waits, it is not admitted bare.`,
    );
  }

  const candidates = mappings.filter(
    (entry) =>
      entry.sourceDimensionId === sourceDimensionId && entry.sourceObjectCode === sourceObjectCode,
  );

  if (candidates.length !== 1 || candidates[0] === undefined) {
    return fail(
      "AmbiguousAssignment",
      `Line ${lineLocation} has ${candidates.length} mappings for its object code; it is refused, not guessed.`,
    );
  }

  return Result.succeed({
    nativeDimensionCode: declaration.nativeDimensionCode,
    nativeValueCode: candidates[0].nativeValueCode,
    sourceObjectCode,
  });
}

export const YearControlInput = Schema.Struct({
  sourceYearOrdinal: FiscalInterval.fields.sourceYearOrdinal,
  openingMinor: SignedMinorUnits,
  movementMinor: SignedMinorUnits,
  closingMinor: SignedMinorUnits,
  // A missing control row means zero only when the exact supported format
  // and independent source coverage establish that omission means zero.
  // Otherwise absent remains unknown and blocks admission.
  controlRowPresent: Schema.Boolean,
  omissionMeansZeroEstablished: Schema.Boolean,
});

export type YearControlInput = typeof YearControlInput.Type;

// Each year's reviewed opening plus final financial movements must equal
// its closing control. A missing row with unknown completeness is
// unknown, never zero.
export function assertYearControl(input: YearControlInput): Checked<string> {
  if (!input.controlRowPresent && !input.omissionMeansZeroEstablished) {
    return fail(
      "UnknownControl",
      `Year ${input.sourceYearOrdinal} has no control row and omission is not established as zero.`,
    );
  }

  const closing = BigInt(input.openingMinor) + BigInt(input.movementMinor);

  if (closing !== BigInt(input.closingMinor)) {
    return fail(
      "ControlMismatch",
      `Year ${input.sourceYearOrdinal} opening plus movements does not equal its closing control.`,
    );
  }

  return Result.succeed(input.closingMinor);
}

export const BoundaryLinkInput = Schema.Struct({
  priorClosingMinor: SignedMinorUnits,
  nextOpeningMinor: SignedMinorUnits,
});

export type BoundaryLinkInput = typeof BoundaryLinkInput.Type;

// The next year's balance-sheet opening relationship is authorized once:
// a matching prior closing links the basis with no extra opening
// movement. Never post an opening voucher on top of the same history.
export function linkYearBoundary(
  input: BoundaryLinkInput,
): Checked<{ readonly linkedMinor: string; readonly extraMovementMinor: string }> {
  if (BigInt(input.priorClosingMinor) !== BigInt(input.nextOpeningMinor)) {
    return fail(
      "BoundaryMismatch",
      "The next opening does not match the prior closing; an explicit migration basis is required.",
    );
  }

  return Result.succeed({ linkedMinor: input.nextOpeningMinor, extraMovementMinor: "0" });
}

export const RunCheckpoint = Schema.Struct({
  runId: Identifier,
  committedYearOrdinals: Schema.Array(FiscalInterval.fields.sourceYearOrdinal),
  nextYearOrdinal: Schema.NullOr(FiscalInterval.fields.sourceYearOrdinal),
  fence: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  paused: Schema.Boolean,
});

export type RunCheckpoint = typeof RunCheckpoint.Type;

// A failure in year2 after year1 committed is a recoverable paused run:
// committed chunks remain accounting history at the saved fence and the
// run resumes there. Rollback of the business migration needs an explicit
// supported correction, never a silent reset.
export function pauseRunAt(checkpoint: RunCheckpoint, failedYearOrdinal: number): RunCheckpoint {
  return {
    runId: checkpoint.runId,
    committedYearOrdinals: checkpoint.committedYearOrdinals,
    nextYearOrdinal: failedYearOrdinal,
    fence: checkpoint.fence,
    paused: true,
  };
}
