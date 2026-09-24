import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

export const CaptureCollectionStatement = Schema.Struct({
  customerId: Accounting.Identifier,
  asOf: Accounting.AccountingDate,
});
export const CollectionStatementItem = Schema.Struct({
  invoiceId: Accounting.Identifier,
  number: Schema.String,
  issuedOn: Accounting.AccountingDate,
  currency: Schema.optional(Schema.String),
  currencyScale: Schema.optional(Schema.Int),
  amountMinor: Accounting.AggregateMinorUnits,
  allocatedMinor: Accounting.AggregateMinorUnits,
  outstandingMinor: Accounting.AggregateMinorUnits,
  status: Schema.String,
  disputed: Schema.Boolean,
});
export const CollectionStatement = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  customerId: Accounting.Identifier,
  asOf: Accounting.AccountingDate,
  cutoffAt: Schema.String,
  items: Schema.Array(CollectionStatementItem),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});
export const OpenCollectionDispute = Schema.Struct({
  invoiceId: Accounting.Identifier,
  reason: Accounting.Description,
  evidenceId: Accounting.Identifier,
  ownerId: Accounting.Identifier,
  holdReminders: Schema.Boolean,
});
export const CollectionDispute = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  invoiceId: Accounting.Identifier,
  customerId: Accounting.Identifier,
  reason: Accounting.Description,
  evidenceId: Accounting.Identifier,
  ownerId: Accounting.Identifier,
  holdReminders: Schema.Boolean,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});
export const RecordCollectionAction = Schema.Struct({
  invoiceId: Accounting.Identifier,
  kind: Schema.Literals(["contact", "follow_up", "dispute_resolved", "reminder_prepared"]),
  note: Accounting.Description,
  ownerId: Accounting.Identifier,
  disputeId: Schema.NullOr(Accounting.Identifier),
});
export const CollectionAction = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  customerId: Accounting.Identifier,
  invoiceId: Accounting.Identifier,
  disputeId: Schema.NullOr(Accounting.Identifier),
  kind: RecordCollectionAction.fields.kind,
  note: Accounting.Description,
  ownerId: Accounting.Identifier,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  outstandingMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  sendAuthorized: Schema.Literal(false),
  digest: Accounting.Digest,
});
export const CollectionHistory = Schema.Struct({
  scope: Accounting.Scope,
  customerId: Accounting.Identifier,
  complete: Schema.Literal(true),
  statements: Schema.Array(CollectionStatement),
  disputes: Schema.Array(CollectionDispute),
  events: Schema.Array(CollectionAction),
});
export const CollectionHistoryPage = Schema.Struct({
  scope: Accounting.Scope,
  customerId: Accounting.Identifier,
  statements: Schema.Array(CollectionStatement),
  disputes: Schema.Array(CollectionDispute),
  events: Schema.Array(CollectionAction),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
});
const historyQuery = Schema.Struct({
  after: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
});
const base = "/v1/entities/:entityId/books/:bookId/commerce/collections";
const mutation = {
  params: Accounting.Scope,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};
export const CollectionsApi = HttpApiGroup.make("collections")
  .add(
    HttpApiEndpoint.post("captureCollectionStatement", `${base}/statements`, {
      ...mutation,
      payload: CaptureCollectionStatement,
      success: CollectionStatement,
    }),
  )
  .add(
    HttpApiEndpoint.post("openCollectionDispute", `${base}/disputes`, {
      ...mutation,
      payload: OpenCollectionDispute,
      success: CollectionDispute,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordCollectionAction", `${base}/actions`, {
      ...mutation,
      payload: RecordCollectionAction,
      success: CollectionAction,
    }),
  )
  .add(
    HttpApiEndpoint.get("collectionHistory", `${base}/customers/:id`, {
      params: Accounting.ChangePath,
      success: CollectionHistory,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("collectionHistoryPage", `${base}/customers/:id/history`, {
      params: Accounting.ChangePath,
      query: historyQuery,
      success: CollectionHistoryPage,
      error: accountingErrors,
    }),
  );
