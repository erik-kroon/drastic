// NEXT-16: the wire contracts for evidence-aware period preparation.
//
// The domain layer in `@open-erp/domain/period-work` owns the decision shapes.
// This module is the transport view of them: what a caller may submit to freeze a
// selection, and what it may read back about a run. The transport never widens a
// bound, never drops a required acknowledgement, and never exposes a state the
// application does not already record.

import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as PeriodWorkDomain from "@open-erp/domain/period-work";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

/** The frozen selection a caller submits, cut from one consistent capture. */
export const PreparePeriodWorkManifest = Schema.Struct({
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  // When the selection was captured. It cannot precede the interval it covers.
  cutoff: Accounting.AccountingDate,
  children: Schema.Array(PeriodWorkDomain.WorkChild).check(
    Schema.isMaxLength(PeriodWorkDomain.periodWorkBoundary.maximumChildren),
  ),
  // The rules in force at the cutoff, sealed with the selection.
  rules: Schema.Array(PeriodWorkDomain.PreparationRule).check(
    Schema.isMaxLength(PeriodWorkDomain.periodWorkBoundary.maximumRules),
  ),
  // Whether the population this selection was cut from was complete. A run whose
  // children are all visited is still not a reconciled period.
  populationComplete: Schema.Boolean,
  excluded: Schema.Array(Schema.Struct({ sourceId: Schema.String, reason: Schema.String })).check(
    Schema.isMaxLength(PeriodWorkDomain.periodWorkBoundary.maximumExcluded),
  ),
  // A frozen selection is operator-sealed. An agent may propose one; it cannot
  // assert that the source population was complete.
  acknowledgeNotReconciled: Schema.Literal(true),
});

/** One child's recorded progress, including the fences a caller may compare. */
export const PeriodWorkChildProgress = Schema.Struct({
  workIdentity: Schema.String,
  state: PeriodWorkDomain.WorkChildState,
  planId: Schema.optional(Schema.String),
  receiptId: Schema.optional(Schema.String),
  // Exact missing facts, named. Absent means none were recorded, which is not
  // the same as "nothing is missing".
  missingFacts: Schema.optional(Schema.Array(Schema.String)),
  refusalReason: Schema.optional(Schema.String),
  routedOwner: Schema.optional(Schema.String),
  ownerReviewId: Schema.optional(Schema.String),
  batchId: Schema.optional(Schema.String),
  revision: Schema.String,
  cancelVersion: Schema.String,
});

/**
 * The honest progress projection. `reconciled` is always `false` from this
 * owner: a run whose children were all visited is still not a reconciled period,
 * and only the separate source and control inventory can say otherwise.
 */
export const PeriodWorkRunProgress = Schema.Struct({
  scope: Accounting.Scope,
  manifestId: Accounting.Identifier,
  digest: Accounting.Digest,
  populationComplete: Schema.Boolean,
  children: Schema.Array(PeriodWorkChildProgress),
  counts: PeriodWorkDomain.ChildStateCounts,
  reconciled: Schema.Literal(false),
});

/** The exact members a human gesture is about to cover. */
export const PreparePeriodWorkBatch = Schema.Struct({
  manifestId: Accounting.Identifier,
  workIdentities: Schema.Array(Schema.String).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PeriodWorkDomain.periodWorkBoundary.maximumMembers),
  ),
});

// The sealed batch itself. The two endpoints below return this shape, so a client
// that shows an operator what is about to be approved has to be able to read it
// back rather than trust the members it asked for.

export const ApprovalBatch = PeriodWorkDomain.ApprovalBatch;

// The boundary the owning operation enforces, restated so a client can bound a
// selection before the operation refuses it. It is the same number, not a second
// one.
export const maximumBatchMembers = PeriodWorkDomain.periodWorkBoundary.maximumMembers;

export const ApprovePeriodWorkBatch = Schema.Struct({
  // The digest the operator was shown. A batch whose digest has moved is refused
  // rather than approved on a different set than the one displayed.
  expectedDigest: Accounting.Digest,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const ExecutePeriodWorkBatch = Schema.Struct({
  expectedDigest: Accounting.Digest,
  boundedCount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
  acknowledgeSyntheticOnly: Schema.Literal(true),
  afterOrdinal: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 200 }))),
});

/** What one batch execution actually did. Never a claim beyond the receipts. */
export const PeriodWorkExecutionResult = Schema.Struct({
  batchId: Accounting.Identifier,
  manifestId: Accounting.Identifier,
  committed: Schema.Array(Schema.Struct({ workIdentity: Schema.String, receiptId: Schema.String })),
  refused: Schema.Array(Schema.Struct({ workIdentity: Schema.String, reason: Schema.String })),
  counts: PeriodWorkDomain.ChildStateCounts,
  reconciled: Schema.Literal(false),
  nextOrdinal: Schema.NullOr(Schema.Int),
});

const path = "/v1/entities/:entityId/books/:bookId/period-work";

const scoped = { params: Accounting.Scope, error: accountingErrors };

const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };

export const PeriodWorkApi = HttpApiGroup.make("periodWork").add(
  HttpApiEndpoint.post("preparePeriodWorkManifest", `${path}/manifests`, {
    ...mutation,
    payload: PreparePeriodWorkManifest.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PeriodWorkDomain.PeriodWorkManifest,
  }),
  HttpApiEndpoint.get("getPeriodWorkProgress", `${path}/manifests/:manifestId/progress`, {
    ...scoped,
    params: Schema.Struct({
      ...Accounting.Scope.fields,
      manifestId: Accounting.Identifier,
    }),
    success: PeriodWorkRunProgress,
  }),
  HttpApiEndpoint.post("advancePeriodWork", `${path}/manifests/:manifestId/advance`, {
    ...mutation,
    params: Schema.Struct({
      ...Accounting.Scope.fields,
      manifestId: Accounting.Identifier,
    }),
    payload: Schema.Struct({ boundedCount: Schema.Int }).annotate({
      parseOptions: { onExcessProperty: "error" },
    }),
    success: PeriodWorkRunProgress,
  }),
  HttpApiEndpoint.post("preparePeriodWorkBatch", `${path}/batches`, {
    ...mutation,
    payload: PreparePeriodWorkBatch.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PeriodWorkDomain.ApprovalBatch,
  }),
  HttpApiEndpoint.post("cancelPeriodWork", `${path}/manifests/:manifestId/cancel`, {
    ...mutation,
    params: Schema.Struct({ ...Accounting.Scope.fields, manifestId: Accounting.Identifier }),
    payload: Schema.Struct({ expectedDigest: Accounting.Digest }),
    success: PeriodWorkRunProgress,
  }),
  // Approval carries authority, so it stays out of the ordinary agent catalogue
  // and is reachable only by an operator.
  HttpApiEndpoint.post("approvePeriodWorkBatch", `${path}/batches/:batchId/approvals`, {
    ...mutation,
    params: Schema.Struct({ ...Accounting.Scope.fields, batchId: Accounting.Identifier }),
    payload: ApprovePeriodWorkBatch.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PeriodWorkDomain.ApprovalBatch,
  }),
  HttpApiEndpoint.post("executePeriodWorkBatch", `${path}/batches/:batchId/execute`, {
    ...mutation,
    params: Schema.Struct({ ...Accounting.Scope.fields, batchId: Accounting.Identifier }),
    payload: ExecutePeriodWorkBatch.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PeriodWorkExecutionResult,
  }),
);
