import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { OriginalDimensionStatus } from "@open-erp/domain/dimensions";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

const Code = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/));

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));

const Revision = Schema.Finite.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThan(100000),
);

const SavedRevision = Revision.check(Schema.isGreaterThanOrEqualTo(1));

const Fields = Schema.Struct({
  code: Code,
  name: Name,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  archived: Schema.Boolean,
});

const Item = Schema.Struct({ ...Fields.fields, revision: SavedRevision });

const RevisionItem = Schema.Struct({
  revision: SavedRevision,
  name: Name,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  archived: Schema.Boolean,
});

export const SaveDimension = Schema.Struct({ expectedRevision: Revision, ...Fields.fields });

export const SaveDimensionValue = Schema.Struct({
  dimensionCode: Code,
  expectedRevision: Revision,
  ...Fields.fields,
});

export const DimensionValue = Schema.Struct({
  ...Item.fields,
  revisions: Schema.Array(RevisionItem),
});

export const Dimension = Schema.Struct({
  ...Item.fields,
  values: Schema.Array(DimensionValue),
  revisions: Schema.Array(RevisionItem),
});

export const DimensionList = Schema.Struct({
  scope: Accounting.Scope,
  dimensions: Schema.Array(Dimension),
});

export const DimensionSaved = Schema.Struct({ scope: Accounting.Scope, ...Item.fields });

// Both saved responses carry the revision they created. A caller that keeps the
// returned revision as its next expectedRevision is comparing against the same
// catalogue head the application just wrote.
export const DimensionValueSaved = Schema.Struct({
  scope: Accounting.Scope,
  dimensionCode: Code,
  ...Item.fields,
});

const AssignmentStateName = Schema.Literals([
  "value",
  "explicit_unassigned",
  "not_recorded_in_source",
  "historical_exemption",
]);

const AssignmentTotals = Schema.Struct({
  signedMinor: Accounting.SignedMinorUnits,
  contributionCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

const AssignmentState = Schema.Struct({
  state: AssignmentStateName,
  dimensionCode: Code,
  valueCode: Schema.NullOr(Code),
  valueRevision: Schema.NullOr(SavedRevision),
  capturedLabel: Accounting.Description,
});

const AssignmentBucket = Schema.Struct({
  state: AssignmentStateName,
  valueCode: Schema.NullOr(Code),
  valueRevision: Schema.NullOr(SavedRevision),
  capturedLabel: Schema.NullOr(Accounting.Description),
  signedMinor: Accounting.SignedMinorUnits,
  contributionCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

const AssignmentPartition = Schema.Struct({
  dimensionCode: Code,
  unfiltered: AssignmentTotals,
  buckets: Schema.Array(AssignmentBucket),
});

const AssignmentCrossTab = Schema.Struct({
  dimensionCodes: Schema.Array(Code).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  unfiltered: AssignmentTotals,
  tuples: Schema.Array(
    Schema.Struct({
      key: Schema.Array(AssignmentState).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
      totals: AssignmentTotals,
    }),
  ),
});

const ObjectMapDimension = Schema.Struct({
  objectNumber: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  code: Code,
  revision: SavedRevision,
  name: Name,
  archived: Schema.Boolean,
});

const ObjectMapObject = Schema.Struct({
  dimensionObjectNumber: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  objectNumber: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  dimensionCode: Code,
  valueCode: Code,
  valueRevision: SavedRevision,
  name: Accounting.Description,
  sourceCode: Schema.NullOr(Code),
});

export const DimensionObjectMap = Schema.Struct({
  dimensions: Schema.Array(ObjectMapDimension),
  objects: Schema.Array(ObjectMapObject),
  usedAssignmentCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  recordedStates: Schema.Array(
    Schema.Struct({
      status: OriginalDimensionStatus,
      assignmentCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});

export const DimensionAssignmentReport = Schema.Struct({
  scope: Accounting.Scope,
  from: Accounting.AccountingDate,
  to: Accounting.AccountingDate,
  contributionCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  assignmentCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  partitions: Schema.Array(AssignmentPartition),
  crossTab: AssignmentCrossTab,
  objectMap: DimensionObjectMap,
});

export const AssignmentReportQuery = Schema.Struct({
  from: Accounting.AccountingDate,
  to: Accounting.AccountingDate,
  dimensionCodes: Schema.Array(Code).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

export const DimensionsCapabilities = {
  dimensions_list: {
    description:
      "Read the book-scoped dimension and value catalogue, including immutable revision history and archive state.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: DimensionList,
    readOnly: true,
  },
  dimensions_assignment_report: {
    description:
      "Read the immutable original dimension assignment of every posted line dated in one window. Each requested dimension partitions the same money independently; no total is summed across dimension systems and no balancing contribution is created. Refuses a window that would exceed the retained-row bound rather than reporting a partition of partial money.",
    input: Schema.Struct({ scope: Accounting.Scope, input: AssignmentReportQuery }),
    output: DimensionAssignmentReport,
    readOnly: true,
  },
};

const base = "/v1/entities/:entityId/books/:bookId/dimensions";

export const DimensionsApi = HttpApiGroup.make("dimensions")
  .add(
    HttpApiEndpoint.get("listDimensions", base, {
      params: Accounting.Scope,
      success: DimensionList,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("assignmentReport", `${base}/assignments`, {
      params: Accounting.Scope,
      payload: AssignmentReportQuery,
      success: DimensionAssignmentReport,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveDimension", base, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: SaveDimension,
      success: DimensionSaved,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveDimensionValue", `${base}/values`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: SaveDimensionValue,
      success: DimensionValueSaved,
      error: accountingErrors,
    }),
  );
