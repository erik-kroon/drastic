import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Issuance from "./invoice-issuance";
import { CorrectionImpactResource } from "./corrections";
import { accountingErrors } from "./accounting-errors";

export const PrepareInvoiceCancellation = Schema.Struct({
  issueId: Accounting.Identifier,
  issueDigest: Accounting.Digest,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  reason: Accounting.Description,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const InvoiceCancellationReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  input: PrepareInvoiceCancellation,
  snapshot: Schema.Struct({
    issue: Issuance.InvoiceIssueReceipt,
    invoice: Commerce.Invoice,
    sourcePeriod: Schema.Struct({ id: Accounting.Identifier, version: Accounting.MinorUnits }),
    resources: Schema.Array(CorrectionImpactResource),
  }),
  postingPlan: Accounting.ChangeSet,
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  digest: Accounting.Digest,
  receipt: Commerce.CommandReceipt,
});

export const ApproveInvoiceCancellation = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const ExecuteInvoiceCancellation = Schema.Struct({
  ...ApproveInvoiceCancellation.fields,
  approvalId: Accounting.Identifier,
});

export const InvoiceCancellationApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const RevokeInvoiceCancellationApproval = Schema.Struct({ reason: Accounting.Description });

export const InvoiceCancellationRevocation = Schema.Struct({
  approvalId: Accounting.Identifier,
  actorId: Accounting.Identifier,
  reason: Accounting.Description,
  revokedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const InvoiceCancellationReceipt = Schema.Struct({
  ...Commerce.InvoiceCancellationSummary.fields,
  scope: Accounting.Scope,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  registerInvoiceId: Accounting.Identifier,
  internalDocumentNumber: Issuance.InvoiceIssueReceipt.fields.internalDocumentNumber,
  amountMinor: Accounting.MinorUnits,
  reason: Accounting.Description,
  postingReceipt: Accounting.ExecutionReceipt,
  cancelled: Schema.Literal(true),
  legalCreditIssued: Schema.Literal(false),
  refundInitiated: Schema.Literal(false),
  delivered: Schema.Literal(false),
  digest: Accounting.Digest,
  receipt: Commerce.CommandReceipt,
});

export const InvoiceCancellationView = Schema.Struct({
  review: InvoiceCancellationReview,
  approval: Schema.NullOr(InvoiceCancellationApproval),
  approvals: Schema.Array(
    Schema.Struct({
      approval: InvoiceCancellationApproval,
      revocation: Schema.NullOr(InvoiceCancellationRevocation),
    }),
  ),
  cancellation: Schema.NullOr(InvoiceCancellationReceipt),
  dependenciesCurrent: Schema.Boolean,
  approvalUsable: Schema.Boolean,
});

export const InvoiceCancellationStatus = Schema.Struct({
  scope: Accounting.Scope,
  issue: Issuance.InvoiceIssueReceipt,
  cancellation: Schema.NullOr(InvoiceCancellationReceipt),
  complete: Schema.Literal(true),
  reviews: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      digest: Accounting.Digest,
      createdAt: Schema.String,
      reason: Accounting.Description,
    }),
  ).check(Schema.isMaxLength(50)),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce";

const scoped = { params: Accounting.Scope, error: accountingErrors };

const identified = { params: Accounting.ChangePath, error: accountingErrors };

const mutation = { ...identified, headers: Accounting.IdempotencyHeaders };

export const InvoiceCancellationsApi = HttpApiGroup.make("invoiceCancellations").add(
  HttpApiEndpoint.post("prepareInvoiceCancellation", `${path}/invoice-cancellation-reviews`, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareInvoiceCancellation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceCancellationReview,
  }),
  HttpApiEndpoint.get("getInvoiceCancellation", `${path}/invoice-cancellation-reviews/:id`, {
    ...identified,
    success: InvoiceCancellationView,
  }),
  HttpApiEndpoint.get(
    "getInvoiceCancellationStatus",
    `${path}/invoice-issues/:id/cancellation-status`,
    {
      ...identified,
      success: InvoiceCancellationStatus,
    },
  ),
  HttpApiEndpoint.post(
    "approveInvoiceCancellation",
    `${path}/invoice-cancellation-reviews/:id/approve`,
    {
      ...mutation,
      payload: ApproveInvoiceCancellation.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: InvoiceCancellationApproval,
    },
  ),
  HttpApiEndpoint.post(
    "executeInvoiceCancellation",
    `${path}/invoice-cancellation-reviews/:id/execute`,
    {
      ...mutation,
      payload: ExecuteInvoiceCancellation.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: InvoiceCancellationReceipt,
    },
  ),
  HttpApiEndpoint.post(
    "revokeInvoiceCancellationApproval",
    `${path}/invoice-cancellation-approvals/:id/revoke`,
    {
      ...mutation,
      payload: RevokeInvoiceCancellationApproval.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: InvoiceCancellationRevocation,
    },
  ),
);

// Every cancellation mutation is human operator-only REST. MCP exposes historical/live reads.
export const InvoiceCancellationCapabilities = {
  commerce_get_invoice_cancellation: {
    description:
      "Read an immutable native synthetic cancellation review, live approval authority and exact committed reversal receipt. No legal credit/refund/delivery authority.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceCancellationView,
    readOnly: true,
  },
  commerce_get_invoice_cancellation_status: {
    description:
      "Read live synthetic issue cancellation status and complete bounded review history. Original issue/draft/document bytes stay historical and immutable.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceCancellationStatus,
    readOnly: true,
  },
};
