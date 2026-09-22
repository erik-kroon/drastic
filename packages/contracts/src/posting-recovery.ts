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
    Schema.Literals(["consumed", "revoked", "expired", "authority_lost", "unconsumed_at_check"]),
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

export const SavedRequestKey = Accounting.IdempotencyHeaders.fields["idempotency-key"];
export const PostingCommand = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("create_evidence"), input: Accounting.CreateEvidence }),
  Schema.Struct({ operation: Schema.Literal("prepare_journal"), input: Accounting.PrepareJournal }),
  Schema.Struct({
    operation: Schema.Literal("execute_change"),
    id: Accounting.Identifier,
    input: Accounting.ExecuteChange,
  }),
]);
export const PostingAuthorityCommand = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("approve_change"),
    id: Accounting.Identifier,
    input: Accounting.ApproveChange,
  }),
  Schema.Struct({
    operation: Schema.Literal("revoke_approval"),
    id: Accounting.Identifier,
    input: Schema.Struct({ reason: Accounting.Description }),
  }),
]);
export const SavedPostingCommand = Schema.Union([PostingCommand, PostingAuthorityCommand]);
export const ApprovalRevocation = Schema.Struct({
  approvalId: Accounting.Identifier,
  changeSetId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  reason: Accounting.Description,
  revokedAt: Schema.String,
});
export const SavedPostingOutcome = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("committed"),
    result: Schema.Union([
      Accounting.Evidence,
      Accounting.ChangeSet,
      Accounting.Approval,
      Accounting.ExecutionReceipt,
      ApprovalRevocation,
    ]),
    refusal: Schema.Null,
    recordedAt: Schema.String,
  }),
  Schema.Struct({
    state: Schema.Literal("refused"),
    result: Schema.Null,
    refusal: Schema.Struct({ code: Accounting.FailureCode, message: Schema.String }),
    recordedAt: Schema.String,
  }),
]);
export const SavedPostingSummary = Schema.Struct({
  key: SavedRequestKey,
  actorId: Accounting.Identifier,
  operation: Schema.Literals([
    "create_evidence",
    "prepare_journal",
    "approve_change",
    "execute_change",
    "revoke_approval",
  ]),
  requestDigest: Accounting.Digest,
  commandKey: SavedRequestKey,
  savedAt: Schema.String,
  state: Schema.Literals(["unknown", "committed", "refused"]),
});
export const SavedPostingRequest = Schema.Struct({
  scope: Accounting.Scope,
  checkedAt: Schema.String,
  request: SavedPostingSummary,
  command: SavedPostingCommand,
  sameActor: Schema.Boolean,
  outcome: Schema.NullOr(SavedPostingOutcome),
});
export const SavedPostingRequests = Schema.Struct({
  scope: Accounting.Scope,
  actorId: Accounting.Identifier,
  checkedAt: Schema.String,
  items: Schema.Array(SavedPostingSummary),
  next: Schema.NullOr(SavedRequestKey),
});
export const SavedPostingQuery = Schema.Struct({ after: Schema.optional(SavedRequestKey) });
const savedPath = Schema.Struct({ ...Accounting.Scope.fields, key: SavedRequestKey });

export const PostingRecoveryCapabilities = {
  posting_save_request: {
    description:
      "Save an immutable actor-bound evidence, preparation or execution request without running it. No approval grants. Run explicitly by the saved key after review.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: SavedRequestKey,
      command: PostingCommand,
    }),
    output: SavedPostingRequest,
    readOnly: false,
  },
  posting_run_request: {
    description:
      "Deliberately run the original actor's saved request using its retained body and kernel key. Returns the same terminal outcome on replay. Unknown is not refusal. Cannot grant or revoke human approval.",
    input: Schema.Struct({ scope: Accounting.Scope, key: SavedRequestKey }),
    output: SavedPostingRequest,
    readOnly: false,
  },
  posting_get_saved_request: {
    description:
      "Read the exact saved request and durable committed/refused outcome. No outcome means unknown at checkedAt, not failed or cancelled. Does not run work.",
    input: Schema.Struct({ scope: Accounting.Scope, key: SavedRequestKey }),
    output: SavedPostingRequest,
    readOnly: true,
  },
  posting_list_saved_requests: {
    description:
      "Discover saved requests in this book after reload, including unknown and refused requests. Live pages are not complete source coverage. Does not run work.",
    input: Schema.Struct({ scope: Accounting.Scope, ...SavedPostingQuery.fields }),
    output: SavedPostingRequests,
    readOnly: true,
  },
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
  HttpApiEndpoint.post("savePostingRequest", `${path}/saved-posting-requests`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PostingCommand.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SavedPostingRequest,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("savePostingAuthorityRequest", `${path}/saved-posting-authority-requests`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PostingAuthorityCommand.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SavedPostingRequest,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("runPostingRequest", `${path}/saved-posting-requests/:key/run`, {
    params: savedPath,
    success: SavedPostingRequest,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post(
    "runPostingAuthorityRequest",
    `${path}/saved-posting-authority-requests/:key/run`,
    {
      params: savedPath,
      success: SavedPostingRequest,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.get("getSavedPostingRequest", `${path}/saved-posting-requests/:key`, {
    params: savedPath,
    success: SavedPostingRequest,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("listSavedPostingRequests", `${path}/saved-posting-requests`, {
    params: Accounting.Scope,
    query: SavedPostingQuery,
    success: SavedPostingRequests,
    error: accountingErrors,
  }),
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
