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

export const CollectionWorklistItem = Schema.Struct({
  invoiceId: Accounting.Identifier,
  invoiceNumber: Schema.String,
  customerId: Accounting.Identifier,
  customerName: Schema.String,
  dueOn: Accounting.AccountingDate,
  currency: Schema.String,
  currencyScale: Schema.Int,
  residualMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  status: Schema.Literals(["open", "partially_allocated", "blocked"]),
  disputed: Schema.Boolean,
  holdReminders: Schema.Boolean,
  nextAction: Schema.Literals([
    "review_hold",
    "review_dispute",
    "review_blocked_invoice",
    "follow_up_overdue",
    "follow_up",
  ]),
});

export const CollectionWorklist = Schema.Struct({
  scope: Accounting.Scope,
  checkedAt: Schema.String,
  asOf: Accounting.AccountingDate,
  page: Schema.Int,
  pageSize: Schema.Literal(50),
  total: Schema.Int,
  items: Schema.Array(CollectionWorklistItem),
});

export const CollectionStatementExport = Schema.Struct({
  scope: Accounting.Scope,
  statementId: Accounting.Identifier,
  customerId: Accounting.Identifier,
  mediaType: Schema.Literal("application/json"),
  encoding: Schema.Literal("UTF-8"),
  filename: Schema.String,
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 262144 })),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  body: Schema.String,
});

const historyQuery = Schema.Struct({
  after: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
});

const worklistQuery = Schema.Struct({
  page: Schema.optional(Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/))),
});

export const CollectionsCapabilities = {
  collections_worklist: {
    description:
      "Read a paginated live customer receivable worklist with residual, dispute, hold and next-action state. It does not prepare or deliver reminders.",
    input: Schema.Struct({ scope: Accounting.Scope, ...worklistQuery.fields }),
    output: CollectionWorklist,
    readOnly: true,
  },
  collections_statement_export: {
    description:
      "Read the exact retained UTF-8 JSON body and SHA-256 for one immutable collection statement in this book.",
    input: Schema.Struct({ scope: Accounting.Scope, statementId: Accounting.Identifier }),
    output: CollectionStatementExport,
    readOnly: true,
  },
  collections_history: {
    description:
      "Read bounded immutable collection statements, disputes and append-only actions. Reminder preparation is not delivery.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      customerId: Accounting.Identifier,
      after: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
    }),
    output: CollectionHistoryPage,
    readOnly: true,
  },
};

const base = "/v1/entities/:entityId/books/:bookId/commerce/collections";

const mutation = {
  params: Accounting.Scope,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

export const CollectionsApi = HttpApiGroup.make("collections")
  .add(
    HttpApiEndpoint.get("collectionWorklist", `${base}/worklist`, {
      params: Accounting.Scope,
      query: worklistQuery,
      success: CollectionWorklist,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("collectionStatementExport", `${base}/statements/:id/export`, {
      params: Accounting.ChangePath,
      success: CollectionStatementExport,
      error: accountingErrors,
    }),
  )
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
