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
  // The reviewed set currently in force for this line, resolved by the owner
  // from retained revisions. The preview derives its before-state from here,
  // never from the original tags: after A->B, the B->C preview calls B the
  // before bucket while the original comparison stays its own view.
  currentAssignments: Schema.Array(ReviewedAssignment),
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
  // Unknown original history and an evidenced exemption stay distinct from
  // deliberate unassignment in summaries; a null valueCode alone never
  // decides which of the three a bucket holds.
  state: Schema.Literals([
    "value",
    "explicit_unassigned",
    "historical_exemption",
    "not_recorded_in_source",
  ]),
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
  // The retained original view, kept as its own comparison. totalsBefore is
  // the current reviewed state the reviewer actually sees, not the original.
  totalsOriginal: Schema.Array(ValueTotal),
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

type BucketState = (typeof ValueTotal.Type)["state"];

type Bucket = {
  dimensionCode: string;
  valueCode: string | null;
  state: BucketState;
  total: bigint;
};

function accumulate(
  totals: Map<string, Bucket>,
  dimensionCode: string,
  valueCode: string | null,
  state: BucketState,
  signed: bigint,
) {
  const key = `${dimensionCode}:${state}:${valueCode ?? "unassigned"}`;
  const entry = totals.get(key);

  if (entry === undefined) {
    totals.set(key, { dimensionCode, valueCode, state, total: signed });
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

  const original = new Map<string, Bucket>();

  const before = new Map<string, Bucket>();

  const after = new Map<string, Bucket>();

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

      accumulate(
        original,
        assignment.dimensionCode,
        value === "unassigned" ? null : value,
        value === "unassigned" ? "explicit_unassigned" : "value",
        signed,
      );
    }

    for (const current of line.currentAssignments) {
      accumulate(
        before,
        current.dimensionCode,
        current.valueCode,
        current.valueCode === null ? "explicit_unassigned" : "value",
        signed,
      );
    }

    for (const desired of change.desiredAssignments) {
      if (policyCodes.has(desired.dimensionCode)) {
        accumulate(
          after,
          desired.dimensionCode,
          desired.valueCode,
          desired.valueCode === null ? "explicit_unassigned" : "value",
          signed,
        );
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
  // the selection cannot change. The current-reviewed total is the
  // comparator: the original view is preserved separately and never stands
  // in for what the reviewer sees now.
  if (sum(before) !== sum(after)) {
    return fail("TotalsChanged", "The restatement changed the selection total.");
  }

  if (sum(original) !== sum(after)) {
    return fail("TotalsChanged", "The restatement changed the original selection total.");
  }

  const toTotals = (totals: typeof before): Array<ValueTotal> =>
    [...totals.values()]
      .sort((left, right) =>
        `${left.dimensionCode}:${left.state}:${left.valueCode ?? ""}` <
        `${right.dimensionCode}:${right.state}:${right.valueCode ?? ""}`
          ? -1
          : 1,
      )
      .map((entry) => ({
        dimensionCode: entry.dimensionCode,
        valueCode: entry.valueCode,
        state: entry.state,
        totalMinor: amount(entry.total),
      }));

  return Result.succeed({
    analyticalScope: input.analyticalScope,
    assignments,
    totalsOriginal: toTotals(original),
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

  // Semantic equality includes the value revision: changing only the
  // revision is a real change that must append, never silently replay.
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
          current.valueCode === desired.valueCode &&
          current.valueRevision === desired.valueRevision
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

export const AnalyticalViewLine = Schema.Struct({
  // The full scoped identity: a line id is only unique within its voucher,
  // so two vouchers may legitimately reuse a local line id.
  voucherId: Identifier,
  lineId: Identifier,
  signedMinor: SignedMinorUnits,
  originalAssignments: Schema.Array(OriginalDimensionAssignment),
  revisions: Schema.Array(ClassificationRevisionRecord).check(Schema.isMaxLength(2000)),
});

export type AnalyticalViewLine = typeof AnalyticalViewLine.Type;

export const AnalyticalViewInput = Schema.Struct({
  lines: Schema.Array(AnalyticalViewLine).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  dimensionCodes: Schema.Array(DimensionCode).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  classificationCutoff: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

export type AnalyticalViewInput = typeof AnalyticalViewInput.Type;

export const AnalyticalViewLineResult = Schema.Struct({
  voucherId: Identifier,
  lineId: Identifier,
  signedMinor: SignedMinorUnits,
  original: Schema.Array(OriginalDimensionAssignment),
  reviewed: Schema.Array(ReviewedAssignment),
  resolvedRevisionId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type AnalyticalViewLineResult = typeof AnalyticalViewLineResult.Type;

export const AnalyticalView = Schema.Struct({
  classificationCutoff: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  dimensionCodes: Schema.Array(DimensionCode),
  lineCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  revisionCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  unfilteredTotalMinor: SignedMinorUnits,
  lines: Schema.Array(AnalyticalViewLineResult).check(Schema.isMaxLength(500)),
  originalTotals: Schema.Array(ValueTotal).check(Schema.isMaxLength(200)),
  reviewedTotals: Schema.Array(ValueTotal).check(Schema.isMaxLength(200)),
});

export type AnalyticalView = typeof AnalyticalView.Type;

// A missing assignment is a deliberate unassigned bucket. A recorded value is
// a value bucket. An evidenced exemption and an unrecorded source are states
// of their own, so a summary never presents them as a reviewer decision.
type BucketPlacement = { readonly valueCode: string | null; readonly state: BucketState };

function originalBucketOf(assignment: OriginalDimensionAssignment | undefined): BucketPlacement {
  if (assignment === undefined) {
    return { valueCode: null, state: "explicit_unassigned" };
  }

  if (assignment.status === "explicit") {
    return assignment.valueCode === null
      ? { valueCode: null, state: "explicit_unassigned" }
      : { valueCode: assignment.valueCode, state: "value" };
  }

  if (assignment.status === "explicit_unassigned") {
    return { valueCode: null, state: "explicit_unassigned" };
  }

  return { valueCode: null, state: assignment.status };
}

// The original-versus-reviewed analytical view over a selection, at one cutoff.
// It is a read: no amount, original tag or retained revision is touched.
//
// Each requested dimension partitions the SAME selection, so every bucket of a
// dimension sums to the unfiltered total in both views. A line with no
// assignment for a dimension lands in an explicit unassigned bucket rather than
// vanishing, which is what makes the partition complete. Two dimensions are
// never added together: each is independent of the others.
type DimensionValue = typeof DimensionCode.Type;

export function analyticalView(input: AnalyticalViewInput): Checked<AnalyticalView> {
  const codes = [...input.dimensionCodes].sort();

  if (new Set(codes).size !== codes.length) {
    return fail("IncompleteSelection", "A dimension is requested more than once.");
  }

  // The same scoped journal line selected twice would double its amount in
  // every partition while both conservation checks repeat the mistake.
  const identities = input.lines.map((line) => `${line.voucherId}:${line.lineId}`);

  if (new Set(identities).size !== identities.length) {
    return fail(
      "IncompleteSelection",
      "A journal line is selected more than once; it contributes once or the request refuses.",
    );
  }

  const original = new Map<DimensionValue, Map<string, Bucket>>();
  const reviewed = new Map<DimensionValue, Map<string, Bucket>>();
  const results: Array<AnalyticalViewLineResult> = [];
  let unfiltered = 0n;
  let revisions = 0;

  for (const key of codes) {
    original.set(key, new Map());
    reviewed.set(key, new Map());
  }

  for (const line of input.lines) {
    const signed = BigInt(line.signedMinor);

    const applicable = line.revisions.filter(
      (revision) => revision.recordedAt <= input.classificationCutoff,
    );

    const latest = applicable.at(-1);

    const resolved = classificationAt(
      line.originalAssignments,
      line.revisions,
      "reviewed",
      input.classificationCutoff,
    );

    const asReviewed: ReadonlyArray<ReviewedAssignment> = resolved.map((entry) =>
      "status" in entry
        ? {
            dimensionCode: entry.dimensionCode,
            valueCode: entry.status === "explicit" ? entry.valueCode : null,
            valueRevision: entry.status === "explicit" ? entry.valueRevision : null,
          }
        : entry,
    );

    unfiltered += signed;
    revisions += line.revisions.length;

    for (const code of codes) {
      // A line with no assignment for the requested dimension is unassigned,
      // not absent, so the partition still covers the whole selection. An
      // evidenced exemption and an unrecorded source stay distinct from
      // deliberate unassignment instead of collapsing into one null bucket.
      const originalAssignment = line.originalAssignments.find(
        (entry) => entry.dimensionCode === code,
      );

      const originalBucket = originalBucketOf(originalAssignment);

      addBucket(
        original.get(code) ?? new Map(),
        code,
        originalBucket.valueCode,
        originalBucket.state,
        signed,
      );

      // When no approved revision exists, the reviewed view falls back to the
      // original state including its exemption marker; it never relabels an
      // exemption or an unknown source as a deliberate unassignment.
      const reviewedEntry = asReviewed.find((entry) => entry.dimensionCode === code);
      const hasRevision = latest !== undefined;

      if (
        reviewedEntry === undefined ||
        (!hasRevision &&
          originalAssignment !== undefined &&
          originalAssignment.status !== "explicit")
      ) {
        addBucket(
          reviewed.get(code) ?? new Map(),
          code,
          originalBucket.valueCode,
          originalBucket.state,
          signed,
        );
      } else {
        addBucket(
          reviewed.get(code) ?? new Map(),
          code,
          reviewedEntry?.valueCode ?? null,
          (reviewedEntry?.valueCode ?? null) === null ? "explicit_unassigned" : "value",
          signed,
        );
      }
    }

    results.push({
      voucherId: line.voucherId,
      lineId: line.lineId,
      signedMinor: line.signedMinor,
      original: [...line.originalAssignments],
      reviewed: asReviewed,
      resolvedRevisionId: latest?.revisionId ?? 0,
    });
  }

  const originalTotals = flatten(original);
  const reviewedTotals = flatten(reviewed);

  for (const code of codes) {
    if (totalOf(originalTotals, code) !== unfiltered) {
      return fail(
        "TotalsChanged",
        `The original view of ${code} does not partition the selection.`,
      );
    }

    if (totalOf(reviewedTotals, code) !== unfiltered) {
      return fail(
        "TotalsChanged",
        `The reviewed view of ${code} does not partition the selection.`,
      );
    }
  }

  return Result.succeed({
    classificationCutoff: input.classificationCutoff,
    dimensionCodes: codes,
    lineCount: results.length,
    revisionCount: revisions,
    unfilteredTotalMinor: amount(unfiltered),
    lines: results,
    originalTotals,
    reviewedTotals,
  });
}

function addBucket(
  totals: Map<string, Bucket>,
  code: string,
  valueCode: string | null,
  state: BucketState,
  signed: bigint,
) {
  const key = `${code}:${state}:${valueCode ?? "unassigned"}`;
  const entry = totals.get(key);

  if (entry === undefined) {
    totals.set(key, { dimensionCode: code, valueCode, state, total: signed });
  } else {
    entry.total += signed;
  }
}

function flatten(totals: ReadonlyMap<DimensionValue, Map<string, Bucket>>): Array<ValueTotal> {
  return [...totals.entries()]
    .flatMap(([code, buckets]) =>
      [...buckets.values()].map((entry) => ({
        dimensionCode: code,
        valueCode: entry.valueCode,
        state: entry.state,
        totalMinor: amount(entry.total),
      })),
    )
    .sort((left, right) =>
      `${left.dimensionCode}:${left.state}:${left.valueCode ?? ""}` <
      `${right.dimensionCode}:${right.state}:${right.valueCode ?? ""}`
        ? -1
        : 1,
    );
}

function totalOf(totals: ReadonlyArray<ValueTotal>, code: DimensionValue): bigint {
  return totals
    .filter((entry) => entry.dimensionCode === code)
    .reduce((carry, entry) => carry + BigInt(entry.totalMinor), 0n);
}
