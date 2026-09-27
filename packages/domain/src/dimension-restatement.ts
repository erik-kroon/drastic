import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { SignedMinorUnits } from "./money";
import {
  DimensionCode,
  DimensionPolicy,
  DimensionRevision,
  DimensionValueCode,
  OriginalDimensionAssignment,
  OriginalDimensionStatus,
} from "./dimensions";

// Pure reviewed dimension restatement over original assignments. NEXT-43
// leaf: an immutable classification overlay with fixed report bases. It
// changes no financial amount, no original tag and no old export.
//
// A revision describes the COMPLETE reviewed assignment set for a line at
// its scope. Explicit removal becomes `unassigned`, never an omission that
// accidentally inherits today's default. Unknown original history and an
// evidenced exemption stay distinct. Undoing a classification appends
// another revision; history is never deleted.

export const RestatementFailureCode = Schema.Literals([
  "IncompleteSelection",
  "FinancialChangeRejected",
  "UnknownOriginalHistory",
  "IncompleteAssignmentSet",
  "PolicyViolation",
  "TotalsChanged",
  "HeadMismatch",
]);

export type RestatementFailureCode = typeof RestatementFailureCode.Type;

export const RestatementFailure = Schema.Struct({
  code: RestatementFailureCode,
  message: Description,
});

export type RestatementFailure = typeof RestatementFailure.Type;

export type Checked<A> = Result.Result<A, RestatementFailure>;

function fail(code: RestatementFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

// One reviewed value: a null value code is explicit `unassigned`, not a
// missing entry.
export const ReviewedAssignment = Schema.Struct({
  dimensionCode: DimensionCode,
  valueCode: Schema.NullOr(DimensionValueCode),
  valueRevision: Schema.NullOr(DimensionRevision),
});

export type ReviewedAssignment = typeof ReviewedAssignment.Type;

export const RestatementLine = Schema.Struct({
  lineId: Identifier,
  // Digest of the retained original financial line. The request carries no
  // amounts, accounts, currencies, tax points or owners, so any drift
  // between this digest and the retained one refuses as a financial
  // correction smuggled into a retagging.
  financialDigest: Digest,
  retainedFinancialDigest: Digest,
  signedMinor: SignedMinorUnits,
  originalAssignments: Schema.Array(OriginalDimensionAssignment),
  currentHeadRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type RestatementLine = typeof RestatementLine.Type;

export const RequestedChange = Schema.Struct({
  lineId: Identifier,
  expectedHeadRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  desiredAssignments: Schema.Array(ReviewedAssignment).check(Schema.isMaxLength(64)),
  reason: Description,
});

export type RequestedChange = typeof RequestedChange.Type;

export const RestatementInput = Schema.Struct({
  analyticalScope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  policy: DimensionPolicy,
  lines: Schema.Array(RestatementLine).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  changes: Schema.Array(RequestedChange).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});

export type RestatementInput = typeof RestatementInput.Type;

export const ValueTotal = Schema.Struct({
  dimensionCode: DimensionCode,
  valueCode: Schema.NullOr(DimensionValueCode),
  totalMinor: SignedMinorUnits,
});

export type ValueTotal = typeof ValueTotal.Type;

export const RestatementPlan = Schema.Struct({
  analyticalScope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  assignments: Schema.Array(
    Schema.Struct({
      lineId: Identifier,
      expectedHeadRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      desiredAssignments: Schema.Array(ReviewedAssignment),
      reason: Description,
    }),
  ),
  totalsBefore: Schema.Array(ValueTotal),
  totalsAfter: Schema.Array(ValueTotal),
});

export type RestatementPlan = typeof RestatementPlan.Type;

function amount(value: bigint) {
  return value.toString();
}

function originalValueKey(
  dimensionCode: string,
  assignment: OriginalDimensionAssignment,
): string | null {
  if (assignment.status === "explicit_unassigned") return `${dimensionCode}:unassigned`;

  if (assignment.status === "explicit" && assignment.valueCode !== null) {
    return `${dimensionCode}:${assignment.valueCode}`;
  }

  return null;
}

function accumulate(
  totals: Map<string, { dimensionCode: string; valueCode: string | null; total: bigint }>,
  dimensionCode: string,
  valueCode: string | null,
  signed: bigint,
) {
  const key = `${dimensionCode}:${valueCode ?? "unassigned"}`;
  const entry = totals.get(key);

  if (entry === undefined) {
    totals.set(key, { dimensionCode, valueCode, total: signed });
  } else {
    entry.total += signed;
  }
}

// The bulk-review preview: sealed selection, full assignments, reasons and
// policy witnesses. A scope change invalidates the preview instead of
// keeping approval for a different selection.
export function prepareRestatement(input: RestatementInput): Checked<RestatementPlan> {
  if (input.changes.length !== input.lines.length) {
    return fail("IncompleteSelection", "Every selected line needs exactly one requested change.");
  }

  const lines = new Map(input.lines.map((line) => [line.lineId, line]));
  const policyCodes = new Set(input.policy.map((entry) => entry.dimensionCode));

  const before = new Map<
    string,
    { dimensionCode: string; valueCode: string | null; total: bigint }
  >();

  const after = new Map<
    string,
    { dimensionCode: string; valueCode: string | null; total: bigint }
  >();

  const assignments: Array<{
    lineId: string;
    expectedHeadRevision: number;
    desiredAssignments: Array<ReviewedAssignment>;
    reason: string;
  }> = [];

  for (const change of input.changes) {
    const line = lines.get(change.lineId);

    if (line === undefined) {
      return fail("IncompleteSelection", `${change.lineId} is not a selected line.`);
    }

    if (line.financialDigest !== line.retainedFinancialDigest) {
      return fail(
        "FinancialChangeRejected",
        `Line ${line.lineId} changed financially and needs a correction, not a retagging.`,
      );
    }

    if (change.expectedHeadRevision !== line.currentHeadRevision) {
      return fail("HeadMismatch", `Line ${line.lineId} moved under review; the preview is stale.`);
    }

    const unknown = line.originalAssignments.find(
      (assignment) =>
        assignment.status === "not_recorded_in_source" ||
        assignment.status === "historical_exemption",
    );

    if (unknown !== undefined) {
      return fail(
        "UnknownOriginalHistory",
        `Line ${line.lineId} has ${unknown.status} for ${unknown.dimensionCode}, distinct from unassigned.`,
      );
    }

    const desiredCodes = new Set(change.desiredAssignments.map((entry) => entry.dimensionCode));

    for (const code of policyCodes) {
      if (!desiredCodes.has(code)) {
        return fail(
          "IncompleteAssignmentSet",
          `Line ${line.lineId} omits ${code}; removal must be explicit unassigned.`,
        );
      }
    }

    for (const desired of change.desiredAssignments) {
      const entry = input.policy.find(
        (candidate) => candidate.dimensionCode === desired.dimensionCode,
      );

      if (entry !== undefined && entry.requirement === "fixed") {
        if (desired.valueCode !== entry.fixedValueCode) {
          return fail(
            "PolicyViolation",
            `Line ${line.lineId} breaks the fixed value of ${desired.dimensionCode}.`,
          );
        }
      }

      if (entry !== undefined && entry.requirement === "required" && desired.valueCode === null) {
        return fail(
          "PolicyViolation",
          `Line ${line.lineId} leaves required ${desired.dimensionCode} unassigned.`,
        );
      }
    }

    const signed = BigInt(line.signedMinor);

    for (const assignment of line.originalAssignments) {
      const key = originalValueKey(assignment.dimensionCode, assignment);

      if (key === null) {
        return fail(
          "UnknownOriginalHistory",
          `Line ${line.lineId} carries an unclassifiable original state.`,
        );
      }

      const separator = key.indexOf(":");
      const value = key.slice(separator + 1);

      accumulate(before, assignment.dimensionCode, value === "unassigned" ? null : value, signed);
    }

    for (const desired of change.desiredAssignments) {
      if (policyCodes.has(desired.dimensionCode)) {
        accumulate(after, desired.dimensionCode, desired.valueCode, signed);
      }
    }

    assignments.push({
      lineId: change.lineId,
      expectedHeadRevision: change.expectedHeadRevision,
      desiredAssignments: [...change.desiredAssignments].sort((left, right) =>
        left.dimensionCode < right.dimensionCode ? -1 : 1,
      ),
      reason: change.reason,
    });
  }

  const sum = (totals: typeof before) =>
    [...totals.values()].reduce((total, entry) => total + entry.total, 0n);

  // Retagging moves money between buckets; the unfiltered signed total of
  // the selection cannot change.
  if (sum(before) !== sum(after)) {
    return fail("TotalsChanged", "The restatement changed the selection total.");
  }

  const toTotals = (totals: typeof before): Array<ValueTotal> =>
    [...totals.values()]
      .sort((left, right) =>
        `${left.dimensionCode}:${left.valueCode ?? ""}` <
        `${right.dimensionCode}:${right.valueCode ?? ""}`
          ? -1
          : 1,
      )
      .map((entry) => ({
        dimensionCode: entry.dimensionCode,
        valueCode: entry.valueCode,
        totalMinor: amount(entry.total),
      }));

  return Result.succeed({
    analyticalScope: input.analyticalScope,
    assignments,
    totalsBefore: toTotals(before),
    totalsAfter: toTotals(after),
  });
}

export const ClassificationRevisionRecord = Schema.Struct({
  revisionId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  recordedAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  assignments: Schema.Array(ReviewedAssignment),
});

export type ClassificationRevisionRecord = typeof ClassificationRevisionRecord.Type;

export const ClassificationMode = Schema.Literals(["original", "reviewed"]);

export type ClassificationMode = typeof ClassificationMode.Type;

// Report-time resolution: original assignments, or the latest approved
// revision recorded at or before the classification cutoff. Old saved
// reports keep their old cutoffs and never move.
export function classificationAt(
  original: ReadonlyArray<OriginalDimensionAssignment>,
  revisions: ReadonlyArray<ClassificationRevisionRecord>,
  mode: ClassificationMode,
  classificationCutoff: string,
): ReadonlyArray<ReviewedAssignment> | ReadonlyArray<OriginalDimensionAssignment> {
  if (mode === "original") return original;

  let current: ReadonlyArray<ReviewedAssignment> | null = null;

  for (const revision of revisions) {
    if (revision.recordedAt <= classificationCutoff) {
      current = revision.assignments;
    }
  }

  return current ?? originalFallback(original);
}

function originalFallback(
  original: ReadonlyArray<OriginalDimensionAssignment>,
): ReadonlyArray<ReviewedAssignment> {
  return original.map((assignment) => ({
    dimensionCode: assignment.dimensionCode,
    valueCode:
      assignment.status === "explicit" && assignment.valueCode !== null
        ? assignment.valueCode
        : null,
    valueRevision:
      assignment.status === "explicit" && assignment.valueRevision !== null
        ? assignment.valueRevision
        : null,
  }));
}

export const ClassificationHead = Schema.Struct({
  lineId: Identifier,
  revisionId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type ClassificationHead = typeof ClassificationHead.Type;

// Appending a revision advances the head. Replaying the identical desired
// set returns the same receipt without a new version; a concurrent changed
// head refuses as stale instead of merging silently.
export function appendRevision(
  head: ClassificationHead,
  expectedRevisionId: number,
  desiredAssignments: ReadonlyArray<ReviewedAssignment>,
  currentAssignments: ReadonlyArray<ReviewedAssignment>,
  recordedAt: string,
): Checked<
  | {
      readonly outcome: "appended";
      readonly head: ClassificationHead;
      readonly revision: ClassificationRevisionRecord;
    }
  | { readonly outcome: "replayed"; readonly head: ClassificationHead }
> {
  if (head.revisionId !== expectedRevisionId) {
    return fail(
      "HeadMismatch",
      `Line ${head.lineId} changed concurrently; recompute instead of merging.`,
    );
  }

  const same =
    desiredAssignments.length === currentAssignments.length &&
    [...desiredAssignments]
      .sort((left, right) => (left.dimensionCode < right.dimensionCode ? -1 : 1))
      .every((desired, index) => {
        const current = [...currentAssignments].sort((left, right) =>
          left.dimensionCode < right.dimensionCode ? -1 : 1,
        )[index];

        return (
          current !== undefined &&
          current.dimensionCode === desired.dimensionCode &&
          current.valueCode === desired.valueCode
        );
      });

  if (same) {
    return Result.succeed({ outcome: "replayed", head });
  }

  const revisionId = head.revisionId + 1;

  return Result.succeed({
    outcome: "appended",
    head: { lineId: head.lineId, revisionId, version: head.version + 1 },
    revision: {
      revisionId,
      recordedAt,
      assignments: [...desiredAssignments],
    },
  });
}

export { OriginalDimensionStatus };
