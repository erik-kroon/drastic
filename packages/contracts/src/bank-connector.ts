import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import * as Bank from "./reconciliation";
import { accountingErrors } from "./accounting-errors";

const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const Cursor = Schema.String.check(Schema.isMaxLength(256));

export const SaveConnectorConsent = Schema.Struct({
  providerId: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{1,63}$/)),
  externalAccountId: Label,
  sourceAccountId: A.Identifier,
  accountId: A.Identifier,
  consentReference: Label,
  rationale: Label,
});

export const ConnectorConsent = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  ...SaveConnectorConsent.fields,
  consentAuthority: Schema.Literal("operator_attested_not_provider_verified"),
  providerConfigured: Schema.Literal(false),
  createdBy: A.Identifier,
  createdAt: Schema.String,
  receipt: Bank.CommandReceipt,
});

export const ConnectorConsentState = Schema.Struct({
  ...ConnectorConsent.fields,
  cursor: Cursor,
  revoked: Schema.Boolean,
});

export const ConnectorRecordInput = Schema.Struct({
  externalId: Label,
  revision: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  raw: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65536)),
});

export const IngestConnectorBatch = Schema.Struct({
  providerOutcome: Schema.Literals(["delivered", "uncertain", "failed"]),
  previousCursor: Cursor,
  nextCursor: Cursor,
  sourceRevision: Label,
  sourceOccurrenceId: Schema.optional(A.Identifier),
  records: Schema.Array(ConnectorRecordInput).check(Schema.isMaxLength(20)),
});

export const ConnectorBatch = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  consentId: A.Identifier,
  providerOutcome: IngestConnectorBatch.fields.providerOutcome,
  previousCursor: Cursor,
  nextCursor: Cursor,
  sourceRevision: Label,
  sourceOccurrenceId: Schema.optional(A.Identifier),
  recordCount: Schema.Int,
  overlapCount: Schema.Int,
  items: Schema.Array(
    Schema.Struct({
      externalId: Label,
      revision: Label,
      occurrenceId: A.Identifier,
      status: Schema.Literals(["new", "overlap", "revision"]),
    }),
  ),
  recognition: Schema.Literal("not_admitted"),
  providerVerification: Schema.Literal("not_established"),
  receivedAt: Schema.String,
  receivedBy: A.Identifier,
  receipt: Bank.CommandReceipt,
});

export const RevokeConnectorConsent = Schema.Struct({ reason: A.Description });

export const ConnectorRevocation = Schema.Struct({
  consentId: A.Identifier,
  revokedAt: Schema.String,
  revokedBy: A.Identifier,
  reason: A.Description,
  receipt: Bank.CommandReceipt,
});

export const ConnectorInventory = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(ConnectorConsentState),
  nextCursor: Schema.NullOr(A.Identifier),
});

export const ConnectorBatchInventory = Schema.Struct({
  scope: A.Scope,
  consentId: A.Identifier,
  items: Schema.Array(ConnectorBatch),
  nextCursor: Schema.NullOr(A.Identifier),
});

export const ConnectorPageSource = Schema.Struct({
  occurrenceId: A.Identifier,
  occurrenceKey: Label,
  sha256: A.Digest,
  byteLength: Schema.Int,
  mediaType: Label,
  originalAvailability: Schema.Literal("not_checked"),
});

export const ConnectorPageEvidence = Schema.Struct({
  id: A.Identifier,
  requestKey: A.IdempotencyHeaders.fields["idempotency-key"],
  providerOutcome: IngestConnectorBatch.fields.providerOutcome,
  previousCursor: Cursor,
  nextCursor: Cursor,
  sourceRevision: Label,
  recordCount: Schema.Int,
  overlapCount: Schema.Int,
  source: Schema.NullOr(ConnectorPageSource),
  recognition: Schema.Literal("not_admitted"),
  providerVerification: Schema.Literal("not_established"),
  receivedAt: Schema.String,
  receivedBy: A.Identifier,
});

export const ConnectorCursorSnapshot = Schema.Struct({
  cursor: Cursor,
  retainedPageCount: Schema.Int,
  retainedPageStartCursor: Schema.NullOr(Cursor),
  lastPageId: Schema.NullOr(A.Identifier),
  lastPageAt: Schema.NullOr(Schema.String),
});

export const ConnectorRecoveryBlocker = Schema.Struct({
  code: Schema.Literals([
    "PAGINATION_START_NOT_RETAINED",
    "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
  ]),
  state: Schema.Literals(["structural_limit", "not_observed_in_retained_evidence"]),
  message: Schema.String,
  operatorAction: Schema.Literal("inspect_retained_pages_and_reconcile_a_fresh_provider_snapshot"),
});

export const ConnectorFeed = Schema.Struct({
  scope: A.Scope,
  consent: ConnectorConsentState,
  account: Schema.Struct({
    externalAccountId: Label,
    sourceAccountId: A.Identifier,
    accountId: A.Identifier,
    active: Schema.Boolean,
  }),
  readAt: Schema.String,
  cursorSnapshot: ConnectorCursorSnapshot,
  pages: Schema.Array(ConnectorPageEvidence).check(Schema.isMaxLength(20)),
  pageEvidenceTruncated: Schema.Boolean,
  providerAcceptance: Schema.Literal("not_established"),
  accountCoverage: Schema.Literal("not_established"),
  automaticRecovery: Schema.Literal(false),
  recoveryBlockers: Schema.Array(ConnectorRecoveryBlocker).check(Schema.isMaxLength(2)),
});

export const ConnectorFeedInventory = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(ConnectorFeed).check(Schema.isMaxLength(20)),
  nextCursor: Schema.NullOr(A.Identifier),
});

const inventoryQuery = Schema.Struct({ cursor: Schema.optional(A.Identifier) });

const feedInventoryQuery = Schema.Struct({
  cursor: Schema.optional(A.Identifier),
  consentId: Schema.optional(A.Identifier),
});

const base = "/v1/entities/:entityId/books/:bookId";

const scoped = { params: A.Scope, error: accountingErrors };

const identified = { params: A.ChangePath, error: accountingErrors };

const mutation = { ...scoped, headers: A.IdempotencyHeaders };

const identifiedMutation = { ...identified, headers: A.IdempotencyHeaders };

export const BankConnectorApi = HttpApiGroup.make("bankConnector")
  .add(
    HttpApiEndpoint.get("listConnectorFeeds", `${base}/bank-connector-feeds`, {
      ...scoped,
      query: feedInventoryQuery,
      success: ConnectorFeedInventory,
    }),
  )
  .add(
    HttpApiEndpoint.get("listConnectorConsents", `${base}/bank-connector-consents`, {
      ...scoped,
      query: inventoryQuery,
      success: ConnectorInventory,
    }),
  )
  .add(
    HttpApiEndpoint.get("listConnectorBatches", `${base}/bank-connector-consents/:id/batches`, {
      ...identified,
      query: inventoryQuery,
      success: ConnectorBatchInventory,
    }),
  )
  .add(
    HttpApiEndpoint.get("recoverConnectorBatch", `${base}/bank-connector-batch-requests/:key`, {
      params: Schema.Struct({
        ...A.Scope.fields,
        key: A.IdempotencyHeaders.fields["idempotency-key"],
      }),
      error: accountingErrors,
      success: ConnectorBatch,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveConnectorConsent", `${base}/bank-connector-consents`, {
      ...mutation,
      payload: SaveConnectorConsent.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: ConnectorConsent,
    }),
  )
  .add(
    HttpApiEndpoint.get("getConnectorConsent", `${base}/bank-connector-consents/:id`, {
      ...identified,
      success: ConnectorConsentState,
    }),
  )
  .add(
    HttpApiEndpoint.post("revokeConnectorConsent", `${base}/bank-connector-consents/:id/revoke`, {
      ...identifiedMutation,
      payload: RevokeConnectorConsent.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: ConnectorRevocation,
    }),
  )
  .add(
    HttpApiEndpoint.post("ingestConnectorBatch", `${base}/bank-connector-consents/:id/batches`, {
      ...identifiedMutation,
      payload: IngestConnectorBatch.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: ConnectorBatch,
    }),
  )
  .add(
    HttpApiEndpoint.get("getConnectorBatch", `${base}/bank-connector-batches/:id`, {
      ...identified,
      success: ConnectorBatch,
    }),
  );
