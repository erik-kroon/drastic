import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";

// NEXT-14: original dimension assignments.
//
// A dimension assignment recorded here is an immutable statement about what a
// source line carried, not a live classification and not a computed default.
// The four statuses are different facts and are never collapsed into each
// other: an explicitly reviewed unassigned value, a source that carried no
// dimension evidence at all, and an evidenced historical exemption each stay
// distinguishable for the life of the posting.
//
// Nothing in this module opens a transaction, reads a table or decides who may
// post. It compiles decoded values; the owning application supplies the
// captured catalogue, the reviewed policy and the retained evidence.

// The accepted code form is the form the reviewed baseline constraints
// already enforce, so a code this module accepts is a code the database stores.
export const DimensionCode = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u),
);

export const DimensionValueCode = DimensionCode;

export const DimensionRevision = Schema.Finite.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThan(100000),
);

export const OriginalDimensionStatus = Schema.Literals([
  "explicit",
  "explicit_unassigned",
  "historical_exemption",
  "not_recorded_in_source",
]);

export type OriginalDimensionStatus = typeof OriginalDimensionStatus.Type;

export const OriginalDimensionAssignment = Schema.Struct({
  dimensionCode: DimensionCode,
  dimensionRevision: DimensionRevision,
  status: OriginalDimensionStatus,
  valueCode: Schema.NullOr(DimensionValueCode),
  valueRevision: Schema.NullOr(DimensionRevision),
  capturedLabel: Description,
  exemptionEvidenceId: Schema.NullOr(Identifier),
  sourceValueCode: Schema.NullOr(DimensionValueCode),
});

export type OriginalDimensionAssignment = typeof OriginalDimensionAssignment.Type;

// A reviewed policy entry, supplied by the operation that prepares a proposal.
// There is no stored default and no implied policy: a dimension effective at the
// posting date with no entry is a refusal, not an unclassified pass.
export const DimensionRequirement = Schema.Literals(["required", "optional", "fixed"]);

export const DimensionPolicyEntry = Schema.Struct({
  dimensionCode: DimensionCode,
  requirement: DimensionRequirement,
  fixedValueCode: Schema.NullOr(DimensionValueCode),
  fixedValueRevision: Schema.NullOr(DimensionRevision),
  defaultValueCode: Schema.NullOr(DimensionValueCode),
});

export type DimensionPolicyEntry = typeof DimensionPolicyEntry.Type;

export const DimensionPolicy = Schema.Array(DimensionPolicyEntry).check(Schema.isMaxLength(64));

export type CatalogueDimension = {
  readonly code: string;
  readonly revision: number;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly archived: boolean;
};

export type CatalogueValue = {
  readonly dimensionCode: string;
  readonly code: string;
  readonly revision: number;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly archived: boolean;
};

export type AssignmentMode = "new_posting" | "exact_reversal";

export type AssignmentLineInput = {
  readonly lineId: string;
  readonly postingDate: string;
  readonly mode: AssignmentMode;
  readonly declared: ReadonlyArray<OriginalDimensionAssignment>;
  readonly policy: ReadonlyArray<DimensionPolicyEntry>;
  readonly dimensions: ReadonlyArray<CatalogueDimension>;
  readonly values: ReadonlyArray<CatalogueValue>;
  readonly original: ReadonlyArray<OriginalDimensionAssignment>;
  readonly evidenceIds: ReadonlyArray<string>;
};

export const AssignmentFailureCode = Schema.Literals([
  "unknown_dimension",
  "duplicate_dimension",
  "unordered_dimensions",
  "incomplete_policy",
  "inconsistent_status",
  "unknown_value",
  "ineligible_value",
  "not_an_explicit_value",
  "fixed_value_mismatch",
  "unbound_exemption",
  "reversal_mismatch",
  "changed_since_preparation",
]);

export type AssignmentFailureCode = typeof AssignmentFailureCode.Type;

export const AssignmentFailure = Schema.Struct({
  code: AssignmentFailureCode,
  lineId: Schema.NullOr(Schema.String),
  dimensionCode: Schema.NullOr(Schema.String),
  message: Schema.String,
});

export type AssignmentFailure = typeof AssignmentFailure.Type;

export type AssignmentResult = Result.Result<
  ReadonlyArray<OriginalDimensionAssignment>,
  AssignmentFailure
>;

// A line state resolved for projection. A stored assignment wins; a line with
// no stored assignment for a dimension resolves to the derived missing state,
// which is the same bucket an explicit `not_recorded_in_source` record lands in.
export type AssignmentState = {
  readonly state:
    | "value"
    | "explicit_unassigned"
    | "not_recorded_in_source"
    | "historical_exemption";
  readonly dimensionCode: string;
  readonly valueCode: string | null;
  readonly valueRevision: number | null;
  readonly capturedLabel: string;
};

export type DimensionContribution = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly signedMinor: string;
};

export type PartitionTotals = {
  readonly signedMinor: string;
  readonly contributionCount: number;
};

export type DimensionBucket = {
  readonly state: AssignmentState["state"];
  readonly dimensionCode: string;
  readonly valueCode: string | null;
  readonly valueRevision: number | null;
  readonly capturedLabel: string | null;
  readonly totals: PartitionTotals;
};

export type DimensionPartition = {
  readonly dimensionCode: string;
  readonly unfiltered: PartitionTotals;
  readonly buckets: ReadonlyArray<DimensionBucket>;
};

export type DimensionTuple = {
  readonly key: ReadonlyArray<AssignmentState>;
  readonly totals: PartitionTotals;
};

export type DimensionCrossTab = {
  readonly dimensionCodes: ReadonlyArray<string>;
  readonly unfiltered: PartitionTotals;
  readonly tuples: ReadonlyArray<DimensionTuple>;
};

export const ProjectionFailureCode = Schema.Literals([
  "duplicate_dimension",
  "unconserved_partition",
]);

export type ProjectionFailureCode = typeof ProjectionFailureCode.Type;

export const ProjectionFailure = Schema.Struct({
  code: ProjectionFailureCode,
  message: Schema.String,
});

export type ProjectionFailure = typeof ProjectionFailure.Type;

export type UsedAssignment = {
  readonly dimensionCode: string;
  readonly dimensionRevision: number;
  readonly valueCode: string;
  readonly valueRevision: number;
  readonly capturedLabel: string;
  readonly sourceValueCode: string | null;
};

export type RecordedStateCount = {
  readonly status: OriginalDimensionStatus;
  readonly assignmentCount: number;
};

export type ObjectMapDimension = {
  readonly objectNumber: number;
  readonly code: string;
  readonly revision: number;
  readonly name: string;
  readonly archived: boolean;
};

export type ObjectMapObject = {
  readonly dimensionObjectNumber: number;
  readonly objectNumber: number;
  readonly dimensionCode: string;
  readonly valueCode: string;
  readonly valueRevision: number;
  readonly name: string;
  readonly sourceCode: string | null;
};

export type DimensionObjectMap = {
  readonly dimensions: ReadonlyArray<ObjectMapDimension>;
  readonly objects: ReadonlyArray<ObjectMapObject>;
  readonly usedAssignmentCount: number;
  readonly recordedStates: ReadonlyArray<RecordedStateCount>;
};

export const ObjectMapFailureCode = Schema.Literals([
  "unknown_dimension",
  "unknown_value",
  "revision_not_declared",
  "too_many_dimensions",
  "too_many_objects",
  "ambiguous_source_code",
]);

export type ObjectMapFailureCode = typeof ObjectMapFailureCode.Type;

export const ObjectMapFailure = Schema.Struct({
  code: ObjectMapFailureCode,
  message: Schema.String,
});

export type ObjectMapFailure = typeof ObjectMapFailure.Type;

export type ObjectMapResult = Result.Result<DimensionObjectMap, ObjectMapFailure>;

// A SIE type-4 object group identifies a dimension and an object inside it by a
// number rather than by a code. The retained local specification this release
// cites does not qualify those records, so these are this export's own bounds
// and not a qualified statement about the format: an export that needs more is
// refused rather than renumbered into a collision.
export const maximumObjectMapDimensions = 999;

export const maximumObjectMapObjects = 999;

const emptyTotals: PartitionTotals = { signedMinor: "0", contributionCount: 0 };

const notRecordedLabel =
  "No dimension evidence for this dimension reached this posting, and no reviewed value was resolved for it.";

function refuse(
  code: AssignmentFailureCode,
  lineId: string,
  dimensionCode: string | null,
  message: string,
): AssignmentResult {
  return Result.fail({ code, lineId, dimensionCode, message });
}

function effectiveOn(from: string, to: string | null, onDate: string) {
  return from <= onDate && (to === null || to >= onDate);
}

function isCoded(status: OriginalDimensionStatus) {
  return status === "explicit";
}

function sameAssignment(left: OriginalDimensionAssignment, right: OriginalDimensionAssignment) {
  return (
    left.dimensionCode === right.dimensionCode &&
    left.dimensionRevision === right.dimensionRevision &&
    left.status === right.status &&
    left.valueCode === right.valueCode &&
    left.valueRevision === right.valueRevision &&
    left.capturedLabel === right.capturedLabel &&
    left.exemptionEvidenceId === right.exemptionEvidenceId &&
    left.sourceValueCode === right.sourceValueCode
  );
}

export function canonicalAssignments(
  assignments: ReadonlyArray<OriginalDimensionAssignment>,
): ReadonlyArray<OriginalDimensionAssignment> {
  return Object.freeze(
    [...assignments]
      .sort((left, right) => (left.dimensionCode < right.dimensionCode ? -1 : 1))
      .map((assignment) => Object.freeze({ ...assignment })),
  );
}

export function sameAssignmentSet(
  left: ReadonlyArray<OriginalDimensionAssignment>,
  right: ReadonlyArray<OriginalDimensionAssignment>,
) {
  if (left.length !== right.length) return false;

  const ordered = canonicalAssignments(right);

  return canonicalAssignments(left).every((assignment, index) => {
    const other = ordered[index];

    return other !== undefined && sameAssignment(assignment, other);
  });
}

function requireAssignmentStatus(
  assignment: OriginalDimensionAssignment,
  lineId: string,
): AssignmentResult | null {
  const coded = isCoded(assignment.status);
  const exempt = assignment.status === "historical_exemption";

  if (coded !== (assignment.valueCode !== null && assignment.valueRevision !== null))
    return refuse(
      "inconsistent_status",
      lineId,
      assignment.dimensionCode,
      `An explicit assignment on line ${lineId} must carry both a value code and a value revision, and no other status may.`,
    );

  if (exempt !== (assignment.exemptionEvidenceId !== null))
    return refuse(
      "inconsistent_status",
      lineId,
      assignment.dimensionCode,
      `Only a historical_exemption assignment on line ${lineId} may carry exemption evidence, and it must carry one.`,
    );

  return null;
}

function assigned(
  dimension: CatalogueDimension,
  status: OriginalDimensionStatus,
  value: CatalogueValue | null,
  capturedLabel: string,
  exemptionEvidenceId: string | null = null,
  sourceValueCode: string | null = null,
): OriginalDimensionAssignment {
  return {
    dimensionCode: dimension.code,
    dimensionRevision: dimension.revision,
    status,
    valueCode: value?.code ?? null,
    valueRevision: value?.revision ?? null,
    capturedLabel,
    exemptionEvidenceId,
    sourceValueCode,
  };
}

const notRecorded: AssignmentState = {
  state: "not_recorded_in_source",
  dimensionCode: "",
  valueCode: null,
  valueRevision: null,
  capturedLabel: notRecordedLabel,
};

export function readAssignmentState(
  assignments: ReadonlyArray<OriginalDimensionAssignment> | undefined,
  dimensionCode: string,
): AssignmentState {
  const stored = assignments?.find((entry) => entry.dimensionCode === dimensionCode);

  if (stored === undefined) return { ...notRecorded, dimensionCode };

  if (stored.status === "explicit")
    return {
      state: "value",
      dimensionCode,
      valueCode: stored.valueCode,
      valueRevision: stored.valueRevision,
      capturedLabel: stored.capturedLabel,
    };

  return {
    state: stored.status,
    dimensionCode,
    valueCode: null,
    valueRevision: null,
    capturedLabel: stored.capturedLabel,
  };
}

function addContribution(
  buckets: Map<string, DimensionBucket>,
  key: string,
  state: AssignmentState,
  amount: bigint,
) {
  const existing = buckets.get(key);

  buckets.set(
    key,
    existing === undefined
      ? {
          state: state.state,
          dimensionCode: state.dimensionCode,
          valueCode: state.valueCode,
          valueRevision: state.valueRevision,
          capturedLabel: state.capturedLabel,
          totals: { signedMinor: amount.toString(), contributionCount: 1 },
        }
      : {
          ...existing,
          totals: {
            signedMinor: (BigInt(existing.totals.signedMinor) + amount).toString(),
            contributionCount: existing.totals.contributionCount + 1,
          },
        },
  );
}

function sumBuckets(buckets: ReadonlyArray<DimensionBucket>) {
  const total = buckets.reduce((carry, bucket) => carry + BigInt(bucket.totals.signedMinor), 0n);
  const count = buckets.reduce((carry, bucket) => carry + bucket.totals.contributionCount, 0);

  return { signedMinor: total.toString(), contributionCount: count };
}

function unfilteredTotals(contributions: ReadonlyArray<DimensionContribution>): PartitionTotals {
  return contributions.reduce<PartitionTotals>(
    (carry, contribution) => ({
      signedMinor: (BigInt(carry.signedMinor) + BigInt(contribution.signedMinor)).toString(),
      contributionCount: carry.contributionCount + 1,
    }),
    emptyTotals,
  );
}

function bucketOrder(left: DimensionBucket, right: DimensionBucket) {
  if (left.state !== right.state) return left.state < right.state ? -1 : 1;

  return (left.valueCode ?? "") < (right.valueCode ?? "") ? -1 : 1;
}

export function projectOneDimension(
  contributions: ReadonlyArray<DimensionContribution>,
  assignments: ReadonlyMap<string, ReadonlyArray<OriginalDimensionAssignment>>,
  dimensionCode: string,
): Result.Result<DimensionPartition, ProjectionFailure> {
  const buckets = new Map<string, DimensionBucket>();

  for (const contribution of contributions) {
    const state = readAssignmentState(
      assignments.get(`${contribution.voucherId}:${contribution.lineId}`),
      dimensionCode,
    );

    addContribution(
      buckets,
      `${state.state}:${state.valueCode ?? ""}`,
      state,
      BigInt(contribution.signedMinor),
    );
  }

  const ordered = [...buckets.values()].sort(bucketOrder);
  const unfiltered = unfilteredTotals(contributions);
  const summed = sumBuckets(ordered);

  if (summed.signedMinor !== unfiltered.signedMinor)
    return Result.fail({
      code: "unconserved_partition",
      message: `Dimension ${dimensionCode} buckets total ${summed.signedMinor} against an unfiltered ${unfiltered.signedMinor}.`,
    });

  return Result.succeed({ dimensionCode, unfiltered, buckets: Object.freeze(ordered) });
}

function tupleKey(states: ReadonlyArray<AssignmentState>) {
  return states
    .map((state) => `${state.dimensionCode}=${state.state}:${state.valueCode ?? ""}`)
    .join("|");
}

export function projectCrossTab(
  contributions: ReadonlyArray<DimensionContribution>,
  assignments: ReadonlyMap<string, ReadonlyArray<OriginalDimensionAssignment>>,
  dimensionCodes: ReadonlyArray<string>,
): Result.Result<DimensionCrossTab, ProjectionFailure> {
  if (dimensionCodes.length === 0 || new Set(dimensionCodes).size !== dimensionCodes.length)
    return Result.fail({
      code: "duplicate_dimension",
      message: "A cross tab needs at least one dimension code and each code exactly once.",
    });

  const tuples = new Map<string, DimensionTuple>();

  for (const contribution of contributions) {
    const stored = assignments.get(`${contribution.voucherId}:${contribution.lineId}`);

    const key = Object.freeze(
      dimensionCodes.map((code) => Object.freeze(readAssignmentState(stored, code))),
    );

    const keyText = tupleKey(key);
    const existing = tuples.get(keyText);

    tuples.set(keyText, {
      key,
      totals:
        existing === undefined
          ? { signedMinor: contribution.signedMinor, contributionCount: 1 }
          : {
              signedMinor: (
                BigInt(existing.totals.signedMinor) + BigInt(contribution.signedMinor)
              ).toString(),
              contributionCount: existing.totals.contributionCount + 1,
            },
    });
  }

  const ordered = [...tuples.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([, tuple]) => Object.freeze(tuple));

  const unfiltered = unfilteredTotals(contributions);
  const summed = ordered.reduce((carry, tuple) => carry + BigInt(tuple.totals.signedMinor), 0n);

  if (summed.toString() !== unfiltered.signedMinor)
    return Result.fail({
      code: "unconserved_partition",
      message: `The cross tab totals ${summed.toString()} against an unfiltered ${unfiltered.signedMinor}.`,
    });

  return Result.succeed({
    dimensionCodes: Object.freeze([...dimensionCodes]),
    unfiltered,
    tuples: Object.freeze(ordered),
  });
}

// An exact reversal repeats the original line's assignment bytes, including a
// catalogue value that is archived today. The inheritance is compared, never
// recomputed, so a reversal can never silently re-classify its original.
function verifyReversal(
  input: AssignmentLineInput,
  declared: ReadonlyArray<OriginalDimensionAssignment>,
): AssignmentResult | null {
  const inherited = canonicalAssignments(input.original);

  if (declared.length !== inherited.length)
    return refuse(
      "reversal_mismatch",
      input.lineId,
      null,
      `Reversal line ${input.lineId} carries ${declared.length} dimension assignments against ${inherited.length} on the original line.`,
    );

  if (!sameAssignmentSet(declared, inherited))
    return refuse(
      "reversal_mismatch",
      input.lineId,
      null,
      `Reversal line ${input.lineId} does not repeat the original line's dimension assignment bytes.`,
    );

  return null;
}

// A new posting is checked against the catalogue as it stands on the posting
// date: an archived value, a superseded revision, a value outside its effective
// window and an unbound exemption each refuse.
function resolveDeclared(
  input: AssignmentLineInput,
  dimension: CatalogueDimension,
  declared: OriginalDimensionAssignment,
  entry: DimensionPolicyEntry,
): AssignmentResult | OriginalDimensionAssignment {
  if (declared.dimensionRevision !== dimension.revision)
    return refuse(
      "ineligible_value",
      input.lineId,
      dimension.code,
      `Line ${input.lineId} names dimension ${dimension.code} revision ${declared.dimensionRevision} against the current revision ${dimension.revision}.`,
    );

  if (declared.status === "explicit") {
    const value = input.values.find(
      (row) => row.dimensionCode === dimension.code && row.code === declared.valueCode,
    );

    if (value === undefined)
      return refuse(
        "unknown_value",
        input.lineId,
        dimension.code,
        `Line ${input.lineId} names value ${String(declared.valueCode)} in dimension ${dimension.code}, which this book does not declare.`,
      );

    if (value.revision !== declared.valueRevision)
      return refuse(
        "ineligible_value",
        input.lineId,
        dimension.code,
        `Line ${input.lineId} names value ${value.code} revision ${String(declared.valueRevision)} against the current revision ${value.revision}.`,
      );

    if (value.archived)
      return refuse(
        "ineligible_value",
        input.lineId,
        dimension.code,
        `Value ${value.code} in dimension ${dimension.code} is archived and cannot carry a new posting. An exact reversal inherits the archived value; a new posting does not.`,
      );

    if (!effectiveOn(value.effectiveFrom, value.effectiveTo, input.postingDate))
      return refuse(
        "ineligible_value",
        input.lineId,
        dimension.code,
        `Value ${value.code} in dimension ${dimension.code} is not effective on ${input.postingDate}.`,
      );
  }

  if (
    declared.status === "historical_exemption" &&
    !input.evidenceIds.includes(String(declared.exemptionEvidenceId))
  )
    return refuse(
      "unbound_exemption",
      input.lineId,
      dimension.code,
      `The historical exemption on line ${input.lineId} for ${dimension.code} is not bound to this posting's retained evidence.`,
    );

  if (entry.requirement === "required" && declared.status !== "explicit")
    return refuse(
      "not_an_explicit_value",
      input.lineId,
      dimension.code,
      `Dimension ${dimension.code} is required, so line ${input.lineId} must carry an explicit eligible value rather than ${declared.status}.`,
    );

  if (
    entry.requirement === "fixed" &&
    (declared.valueCode !== entry.fixedValueCode ||
      declared.valueRevision !== entry.fixedValueRevision)
  )
    return refuse(
      "fixed_value_mismatch",
      input.lineId,
      dimension.code,
      `Dimension ${dimension.code} is fixed to value ${String(entry.fixedValueCode)} revision ${String(entry.fixedValueRevision)} for this posting, and line ${input.lineId} names something else.`,
    );

  return declared;
}

function resolveOne(
  input: AssignmentLineInput,
  dimension: CatalogueDimension,
  entry: DimensionPolicyEntry | undefined,
): AssignmentResult | OriginalDimensionAssignment {
  if (entry === undefined)
    return refuse(
      "incomplete_policy",
      input.lineId,
      dimension.code,
      `Dimension ${dimension.code} is effective on ${input.postingDate} and this posting declares no reviewed requirement for it.`,
    );

  const declared = input.declared.find((row) => row.dimensionCode === dimension.code);

  if (declared !== undefined) return resolveDeclared(input, dimension, declared, entry);

  if (entry.requirement === "required" || entry.requirement === "fixed")
    return refuse(
      "not_an_explicit_value",
      input.lineId,
      dimension.code,
      `Dimension ${dimension.code} is ${entry.requirement}, so line ${input.lineId} must carry the value explicitly.`,
    );

  // A reviewed default is resolved here, during preparation, and then retained
  // explicitly. Today's default is never inserted silently at execution or at a
  // historical import.
  const reviewed = entry.defaultValueCode;

  if (reviewed === null)
    return assigned(dimension, "not_recorded_in_source", null, notRecordedLabel);

  const value = input.values.find(
    (row) => row.dimensionCode === dimension.code && row.code === reviewed,
  );

  if (value === undefined)
    return refuse(
      "unknown_value",
      input.lineId,
      dimension.code,
      `The reviewed default value ${reviewed} for dimension ${dimension.code} is not an effective unarchived value on ${input.postingDate}.`,
    );

  if (value.archived || !effectiveOn(value.effectiveFrom, value.effectiveTo, input.postingDate))
    return refuse(
      "ineligible_value",
      input.lineId,
      dimension.code,
      `The reviewed default value ${reviewed} for dimension ${dimension.code} is archived or not effective on ${input.postingDate}.`,
    );

  return assigned(dimension, "explicit", value, value.name);
}

// Returns exactly one immutable assignment state per dimension effective at the
// posting date, with any reviewed default already resolved and retained.
export function resolveOriginalAssignments(input: AssignmentLineInput): AssignmentResult {
  if (input.mode === "exact_reversal") {
    for (const declared of input.declared) {
      const status = requireAssignmentStatus(declared, input.lineId);

      if (status !== null) return status;
    }

    const reversal = verifyReversal(input, input.declared);

    if (reversal !== null) return reversal;

    return Result.succeed(canonicalAssignments(input.declared));
  }

  const applicable = input.dimensions
    .filter((dimension) =>
      effectiveOn(dimension.effectiveFrom, dimension.effectiveTo, input.postingDate),
    )
    .sort((left, right) => (left.code < right.code ? -1 : 1));

  const known = new Set(applicable.map((dimension) => dimension.code));

  const codes = input.declared.map((row) => row.dimensionCode);

  if (new Set(codes).size !== codes.length)
    return refuse(
      "duplicate_dimension",
      input.lineId,
      null,
      `Line ${input.lineId} names the same dimension more than once.`,
    );

  const ordered = [...codes].sort();

  if (codes.some((code, index) => code !== ordered[index]))
    return refuse(
      "unordered_dimensions",
      input.lineId,
      null,
      `Line ${input.lineId} must name its dimensions in canonical code order.`,
    );

  const unknown = codes.find((code) => !known.has(code));

  if (unknown !== undefined)
    return refuse(
      "unknown_dimension",
      input.lineId,
      unknown,
      `Line ${input.lineId} names dimension ${unknown}, which is not effective on ${input.postingDate}.`,
    );

  const policyCodes = input.policy.map((row) => row.dimensionCode);

  if (new Set(policyCodes).size !== policyCodes.length)
    return refuse(
      "duplicate_dimension",
      input.lineId,
      null,
      "A dimension policy may name each dimension once.",
    );

  const extra = policyCodes.find((code) => !known.has(code));

  if (extra !== undefined)
    return refuse(
      "unknown_dimension",
      input.lineId,
      extra,
      `The dimension policy names ${extra}, which is not effective on ${input.postingDate}.`,
    );

  const policyByCode = new Map(input.policy.map((row) => [row.dimensionCode, row]));
  const resolved: Array<OriginalDimensionAssignment> = [];

  for (const dimension of applicable) {
    const status = input.declared
      .filter((row) => row.dimensionCode === dimension.code)
      .map((row) => requireAssignmentStatus(row, input.lineId))
      .find((outcome) => outcome !== null);

    if (status !== undefined) return status;

    const outcome = resolveOne(input, dimension, policyByCode.get(dimension.code));

    if (Result.isResult(outcome)) return outcome;

    resolved.push(outcome);
  }

  return Result.succeed(canonicalAssignments(resolved));
}

// The execution-side check. A line already carries the resolved set that was
// sealed with the plan; the same inputs are re-resolved and the two must be the
// same assignment set, so a catalogue archive, an effective-date change or a new
// requirement between approval and execution refuses instead of re-classifying
// an approved posting.
export function validateAssignmentsForEveryLine(input: AssignmentLineInput): AssignmentResult {
  const resolved = resolveOriginalAssignments(input);

  if (Result.isFailure(resolved)) return resolved;

  if (!sameAssignmentSet(resolved.success, input.declared))
    return refuse(
      "changed_since_preparation",
      input.lineId,
      null,
      `Line ${input.lineId} no longer resolves to the dimension assignments sealed with the approved plan.`,
    );

  return resolved;
}

function objectMapRefusal(code: ObjectMapFailureCode, message: string): ObjectMapResult {
  return Result.fail({ code, message });
}

// Freeze the exported object map for one selection. Every assignment the
// selection uses must have a declared dimension and object, the exported
// numbers are assigned in canonical code order so a frozen file is internally
// stable, and a historical code alias is carried explicitly rather than
// renamed away. An assignment that cannot be represented refuses.
export function freezeObjectMap(input: {
  readonly dimensions: ReadonlyArray<CatalogueDimension>;
  readonly values: ReadonlyArray<CatalogueValue>;
  readonly used: ReadonlyArray<UsedAssignment>;
  readonly recordedStates: ReadonlyArray<RecordedStateCount>;
}): ObjectMapResult {
  const dimensions = [...input.dimensions].sort((left, right) => (left.code < right.code ? -1 : 1));

  if (dimensions.length > maximumObjectMapDimensions)
    return objectMapRefusal(
      "too_many_dimensions",
      `The selection declares ${dimensions.length} dimensions and this export numbers them within ${maximumObjectMapDimensions}.`,
    );

  const dimensionNumbers = new Map(
    dimensions.map((dimension, index) => [dimension.code, index + 1]),
  );

  const declaredValues = new Map(
    input.values.map((value) => [`${value.dimensionCode}:${value.code}`, value]),
  );

  const objects = new Map<string, ObjectMapObject>();
  const sourceCodes = new Map<string, string>();

  for (const used of [...input.used].sort((left, right) =>
    left.dimensionCode === right.dimensionCode
      ? left.valueCode < right.valueCode
        ? -1
        : 1
      : left.dimensionCode < right.dimensionCode
        ? -1
        : 1,
  )) {
    const dimension = dimensions.find((row) => row.code === used.dimensionCode);

    if (dimension === undefined)
      return objectMapRefusal(
        "unknown_dimension",
        `A used assignment names dimension ${used.dimensionCode}, which the selection does not declare.`,
      );

    const value = declaredValues.get(`${used.dimensionCode}:${used.valueCode}`);

    if (value === undefined)
      return objectMapRefusal(
        "unknown_value",
        `A used assignment names value ${used.valueCode} in dimension ${used.dimensionCode}, which the selection does not declare.`,
      );

    if (value.revision !== used.valueRevision || dimension.revision !== used.dimensionRevision)
      return objectMapRefusal(
        "revision_not_declared",
        `A used assignment names dimension ${used.dimensionCode} revision ${used.dimensionRevision} and value revision ${used.valueRevision}, which the frozen selection does not declare.`,
      );

    if (used.sourceValueCode !== null) {
      if (used.sourceValueCode === used.valueCode)
        return objectMapRefusal(
          "ambiguous_source_code",
          `A used assignment in dimension ${used.dimensionCode} records its native value ${used.valueCode} as a historical alias. An alias must name a code that differs.`,
        );

      const key = `${used.dimensionCode}:${used.sourceValueCode}`;
      const owner = sourceCodes.get(key);

      if (owner !== undefined && owner !== used.valueCode)
        return objectMapRefusal(
          "ambiguous_source_code",
          `Historical code ${used.sourceValueCode} in dimension ${used.dimensionCode} names both ${owner} and ${used.valueCode}.`,
        );

      sourceCodes.set(key, used.valueCode);
    }

    objects.set(`${used.dimensionCode}:${used.valueCode}`, {
      dimensionObjectNumber: dimensionNumbers.get(used.dimensionCode) ?? 0,
      objectNumber: 0,
      dimensionCode: used.dimensionCode,
      valueCode: used.valueCode,
      valueRevision: used.valueRevision,
      name: used.capturedLabel,
      sourceCode: used.sourceValueCode,
    });
  }

  const numbered = new Map<string, number>();
  const perDimension = new Map<string, number>();

  const ordered = [...objects.values()].sort((left, right) =>
    left.dimensionCode === right.dimensionCode
      ? left.valueCode < right.valueCode
        ? -1
        : 1
      : left.dimensionCode < right.dimensionCode
        ? -1
        : 1,
  );

  for (const object of ordered) {
    const next = (perDimension.get(object.dimensionCode) ?? 0) + 1;

    if (next > maximumObjectMapObjects)
      return objectMapRefusal(
        "too_many_objects",
        `Dimension ${object.dimensionCode} uses ${next} objects and this export numbers them within ${maximumObjectMapObjects}.`,
      );

    perDimension.set(object.dimensionCode, next);
    numbered.set(`${object.dimensionCode}:${object.valueCode}`, next);
  }

  return Result.succeed({
    dimensions: Object.freeze(
      dimensions.map((dimension, index) =>
        Object.freeze({
          objectNumber: index + 1,
          code: dimension.code,
          revision: dimension.revision,
          name: dimension.name,
          archived: dimension.archived,
        }),
      ),
    ),
    objects: Object.freeze(
      ordered.map((object) =>
        Object.freeze({
          ...object,
          objectNumber: numbered.get(`${object.dimensionCode}:${object.valueCode}`) ?? 0,
        }),
      ),
    ),
    usedAssignmentCount: input.used.length,
    recordedStates: Object.freeze(
      [...input.recordedStates]
        .sort((left, right) => (left.status < right.status ? -1 : 1))
        .map((state) => Object.freeze({ ...state })),
    ),
  });
}
