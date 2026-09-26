import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Drafts from "./invoice-drafts";
import { accountingErrors } from "./accounting-errors";

export const PrepareInvoiceIssue = Schema.Struct({
  profile: Schema.Literal("synthetic-manual-invoice-v1"),
  draftId: Accounting.Identifier,
  expectedRevision: Commerce.Version,
  expectedDigest: Accounting.Digest,
  controlAccountId: Accounting.Identifier,
  creditAccountId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const ApproveInvoiceIssue = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const ExecuteInvoiceIssue = Schema.Struct({
  ...ApproveInvoiceIssue.fields,
  approvalId: Accounting.Identifier,
});

export const InvoiceIssueReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  profile: Schema.Literal("synthetic-manual-invoice-v1"),
  ordinal: Schema.Int,
  input: PrepareInvoiceIssue,
  draftSnapshot: Drafts.InvoiceDraftRevision,
  postingPlan: Accounting.ChangeSet,
  evidence: Accounting.Evidence,
  legalBlockers: Schema.Array(Schema.String),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const InvoiceIssueApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  ordinal: Schema.Int,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const InvoiceIssueReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  profile: Schema.Literal("synthetic-manual-invoice-v1"),
  draftId: Accounting.Identifier,
  draftRevision: Commerce.Version,
  draftDigest: Accounting.Digest,
  internalSequence: Commerce.Version,
  internalDocumentNumber: Schema.String.check(Schema.isPattern(/^SYN-[1-9][0-9]{0,17}$/)),
  issued: Schema.Literal(true),
  legalInvoice: Schema.Literal(false),
  legalDocumentNumber: Schema.Null,
  recognized: Schema.Literal(true),
  delivered: Schema.Literal(false),
  postingReceipt: Accounting.ExecutionReceipt,
  registerInvoiceId: Accounting.Identifier,
  legalBlockers: Schema.Array(Schema.String),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const InvoiceIssueView = Schema.Struct({
  plan: InvoiceIssueReview,
  approval: Schema.NullOr(InvoiceIssueApproval),
  issue: Schema.NullOr(InvoiceIssueReceipt),
  blockers: Schema.Array(Schema.String),
  dependenciesCurrent: Schema.Boolean,
  approvalUsable: Schema.Boolean,
});

export const InvoiceIssueHistory = Schema.Struct({
  scope: Accounting.Scope,
  draftId: Accounting.Identifier,
  complete: Schema.Literal(true),
  count: Schema.Int,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      ordinal: Schema.Int,
      draftRevision: Commerce.Version,
      digest: Accounting.Digest,
      createdAt: Schema.String,
      issueId: Schema.NullOr(Accounting.Identifier),
      internalDocumentNumber: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(50)),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce";

const mutation = {
  params: Accounting.ChangePath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

export const InvoiceIssuanceApi = HttpApiGroup.make("invoiceIssuance").add(
  HttpApiEndpoint.post("prepareInvoiceIssue", `${path}/invoice-issue-reviews`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareInvoiceIssue.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceIssueReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveInvoiceIssue", `${path}/invoice-issue-reviews/:id/approvals`, {
    ...mutation,
    payload: ApproveInvoiceIssue.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceIssueApproval,
  }),
  HttpApiEndpoint.post("executeInvoiceIssue", `${path}/invoice-issue-reviews/:id/execute`, {
    ...mutation,
    payload: ExecuteInvoiceIssue.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceIssueReceipt,
  }),
  HttpApiEndpoint.get("getInvoiceIssueReview", `${path}/invoice-issue-reviews/:id`, {
    params: Accounting.ChangePath,
    success: InvoiceIssueView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("invoiceIssueHistory", `${path}/invoice-drafts/:id/issue-reviews`, {
    params: Accounting.ChangePath,
    success: InvoiceIssueHistory,
    error: accountingErrors,
  }),
);

// All issue/recognition mutations are operator-only. Ordinary MCP exposes recovery reads only.
export const InvoiceIssuanceCapabilities = {
  commerce_get_invoice_issue_review: {
    description:
      "Read a sealed synthetic invoice issue and exact posting review, its current blockers, human approval and committed aggregate receipt. Not legal invoice or delivery authority.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceIssueView,
    readOnly: true,
  },
  commerce_invoice_issue_history: {
    description:
      "Read the complete bounded issue-review history for one customer draft, including saved synthetic issue identities for recovery after reload.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceIssueHistory,
    readOnly: true,
  },
};
