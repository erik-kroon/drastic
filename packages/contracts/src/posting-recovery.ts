import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

export const PostingStatus = Schema.Literals([
  "posted",
  "posted_by_other_proposal",
  "unposted_at_check",
]);
export const PostingOperation = Schema.Literals([
  "prepare_journal",
  "prepare_correction",
  "validate_change",
  "approve_change",
  "execute_change",
]);
export const RecoverySummary = Schema.Struct({
  changeSetId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  description: Schema.String,
  postingStatus: PostingStatus,
  executionReceipt: Schema.NullOr(Accounting.ExecutionReceipt),
});
const observation = {
  scope: Accounting.Scope,
  actorId: Accounting.Identifier,
  checkedAt: Schema.String,
  sequence: Accounting.AggregateMinorUnits,
};
export const RecoveryList = Schema.Struct({
  ...observation,
  items: Schema.Array(RecoverySummary),
  next: Schema.NullOr(Accounting.Identifier),
});
export const RecoveryRequest = Schema.Struct({
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  operation: PostingOperation,
  actorId: Accounting.Identifier,
  requestDigest: Accounting.Digest,
  recordedAt: Schema.String,
  resultId: Schema.NullOr(Accounting.Identifier),
  planDigest: Schema.NullOr(Accounting.Digest),
  approvalState: Schema.NullOr(
    Schema.Literals(["consumed", "expired", "authority_lost", "unconsumed_at_check"]),
  ),
});
export const PostingRecovery = Schema.Struct({
  ...observation,
  summary: RecoverySummary,
  plan: Accounting.ChangeSet,
  validation: Schema.Struct({
    status: Schema.Literals(["current", "blocked"]),
    blocker: Schema.NullOr(Schema.Struct({ code: Accounting.FailureCode, message: Schema.String })),
  }),
  availableApproval: Schema.NullOr(Accounting.Approval),
  requests: Schema.Array(RecoveryRequest),
  nextRequest: Schema.NullOr(Accounting.IdempotencyHeaders.fields["idempotency-key"]),
});
const requestObservation = {
  scope: Accounting.Scope,
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  checkedAt: Schema.String,
};
export const RecoveredPostingRequest = Schema.Union([
  Schema.Struct({
    ...requestObservation,
    state: Schema.Literal("committed"),
    operation: PostingOperation,
    actorId: Accounting.Identifier,
    requestDigest: Accounting.Digest,
    result: Schema.Union([
      Accounting.ChangeSet,
      Accounting.Approval,
      Accounting.ValidationReport,
      Accounting.ExecutionReceipt,
    ]),
    recordedAt: Schema.String,
    sameActor: Schema.Boolean,
  }),
  Schema.Struct({
    ...requestObservation,
    state: Schema.Literal("not_observed"),
    operation: Schema.Null,
    actorId: Schema.Null,
    requestDigest: Schema.Null,
    result: Schema.Null,
    recordedAt: Schema.Null,
    sameActor: Schema.Null,
  }),
]);
export const RecoveryListQuery = Schema.Struct({ after: Schema.optional(Accounting.Identifier) });
export const RecoveryDetailQuery = Schema.Struct({
  after: Schema.optional(Accounting.IdempotencyHeaders.fields["idempotency-key"]),
});
export const PostingRecoveryCapabilities = {
  posting_list_recovery: {
    description:
      "Discover retained single-action proposals after reload. Status is observed at checkedAt, not a promise about an in-flight request. Does not post.",
    input: Schema.Struct({ scope: Accounting.Scope, ...RecoveryListQuery.fields }),
    output: RecoveryList,
    readOnly: true,
  },
  posting_get_recovery: {
    description:
      "Read a retained proposal, current approval diagnostics, exact or equivalent posting receipt and paged immutable successful request history. Does not retry or grant authority.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      changeSetId: Accounting.Identifier,
      ...RecoveryDetailQuery.fields,
    }),
    output: PostingRecovery,
    readOnly: true,
  },
  posting_recover_request: {
    description:
      "Recover a committed posting-lifecycle command by its original key. not_observed means no committed receipt was found at this check; never proof that a late request cannot commit. Replaying remains actor-bound.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    }),
    output: RecoveredPostingRequest,
    readOnly: true,
  },
};
const path = "/v1/entities/:entityId/books/:bookId";
export const PostingRecoveryApi = HttpApiGroup.make("postingRecovery").add(
  HttpApiEndpoint.get("listPostingRecovery", `${path}/posting-recovery`, {
    params: Accounting.Scope,
    query: RecoveryListQuery,
    success: RecoveryList,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getPostingRecovery", `${path}/posting-recovery/:id`, {
    params: Accounting.ChangePath,
    query: RecoveryDetailQuery,
    success: PostingRecovery,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("recoverPostingRequest", `${path}/posting-requests/:key`, {
    params: Schema.Struct({
      ...Accounting.Scope.fields,
      key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    }),
    success: RecoveredPostingRequest,
    error: accountingErrors,
  }),
);
