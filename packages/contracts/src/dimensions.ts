import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { OriginalDimensionStatus } from "@open-erp/domain/dimensions";
import { RestatementPlan } from "@open-erp/domain/dimension-restatement";
import { DimensionPolicy } from "@open-erp/domain/dimensions";
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

// NEXT-43. A client names the lines and the reviewed assignment set it wants,
// and nothing else: it carries no amount, account, currency, tax point or
// economic owner, and it never states a financial fact. The owner reads the
// retained original assignments and the current heads, derives the plan, and
// records the reviewed history.
export const RestatementLineSelection = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
});

export const RequestedClassification = Schema.Struct({
  lineId: Accounting.Identifier,
  expectedHeadRevision: Revision,
  desiredAssignments: Schema.Array(
    Schema.Struct({
      dimensionCode: Code,
      valueCode: Schema.NullOr(Code),
      valueRevision: Schema.NullOr(SavedRevision),
    }),
  ).check(Schema.isMaxLength(64)),
  reason: Accounting.Description,
});

export const PrepareRestatement = Schema.Struct({
  analyticalScope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  reason: Accounting.Description,
  // The reviewed analytical policy witness for this scope. It is a
  // configuration assertion, exactly as NEXT-14's posting witness is, and it is
  // sealed into the plan the reviewer approves. It is not a financial fact: no
  // amount, account, currency, tax point or economic owner is accepted here.
  dimensionPolicy: DimensionPolicy,
  lines: Schema.Array(RestatementLineSelection).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
  ),
  changes: Schema.Array(RequestedClassification).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
  ),
});

export const RestatementPlanView = Schema.Struct({
  scope: Accounting.Scope,
  planId: Accounting.Identifier,
  analyticalScope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  digest: Accounting.Digest,
  plan: RestatementPlan,
  createdAt: Schema.String,
});

// The plan id is the path, so the body carries only the approval shape: the
// exact digest the reviewer saw, and the contract version it was prepared under.
export const ApplyRestatement = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const RestatementAppliedLine = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  outcome: Schema.Literals(["appended", "replayed"]),
  revisionId: Revision,
  version: Revision,
});

export const RestatementApplied = Schema.Struct({
  scope: Accounting.Scope,
  planId: Accounting.Identifier,
  digest: Accounting.Digest,
  appendedCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  replayedCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  lines: Schema.Array(RestatementAppliedLine).check(Schema.isMaxLength(500)),
  createdAt: Schema.String,
});

// Report-time resolution. A report asks for the original view or the reviewed
// view as at its own cutoff, and a saved report keeps the view it was built
// from because the cutoff is part of the question.
export const ClassificationQuery = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  mode: Schema.Literals(["original", "reviewed"]),
  classificationCutoff: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

export const ClassificationView = Schema.Struct({
  scope: Accounting.Scope,
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  mode: Schema.Literals(["original", "reviewed"]),
  classificationCutoff: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  resolvedRevisionId: Revision,
  assignments: Schema.Array(
    Schema.Struct({
      dimensionCode: Code,
      valueCode: Schema.NullOr(Code),
      valueRevision: Schema.NullOr(SavedRevision),
    }),
  ),
  revisionCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

export const DimensionsCapabilities = {
  dimensions_list: {
    description:
      "Read the book-scoped dimension and value catalogue, including immutable revision history and archive state.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: DimensionList,
    readOnly: true,
  },
  dimensions_classification_view: {
    description:
      "Resolve one posted line's dimension classification as at a cutoff, as the original recorded tags or as the latest approved reviewed revision at or before that cutoff. A restatement never changes a journal line, an amount or an original tag.",
    input: Schema.Struct({ scope: Accounting.Scope, input: ClassificationQuery }),
    output: ClassificationView,
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
    HttpApiEndpoint.post("prepareRestatement", `${base}/restatements`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: PrepareRestatement.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: RestatementPlanView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("applyRestatement", `${base}/restatements/:id/apply`, {
      params: Schema.Struct({ ...Accounting.ChangePath.fields, id: Accounting.Identifier }),
      headers: Accounting.IdempotencyHeaders,
      payload: ApplyRestatement.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: RestatementApplied,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("classificationView", `${base}/lines/:voucherId/:lineId/classification`, {
      // This path names the voucher and the line directly, so it takes the
      // scope params rather than the change path's single `id`. The mode and
      // the cutoff are the question being asked, so they are query params.
      params: Schema.Struct({
        entityId: Accounting.Identifier,
        bookId: Accounting.Identifier,
        voucherId: Accounting.Identifier,
        lineId: Accounting.Identifier,
      }),
      query: Schema.Struct({
        mode: Schema.Literals(["original", "reviewed"]),
        classificationCutoff: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
      }),
      success: ClassificationView,
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
