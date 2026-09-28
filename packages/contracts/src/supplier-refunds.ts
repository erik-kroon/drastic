import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Credits from "./supplier-credits";
import { accountingErrors } from "./accounting-errors";

// Owned supplier paid credits and cash refunds (NEXT-07). The pure
// calculation lives in @open-erp/domain/supplier-refunds; this file is its
// wire shape. A paid credit reuses the NEXT-03 original-line releases and
// the existing supplier credit rows; only the payable/refund-receivable
// split and the refund receipt lifecycle are new.

export const PaidSupplierCreditProfile = Schema.Literals([
  "swedish-purchase-full-credit-v1",
  "swedish-purchase-partial-credit-v1",
]);

// The reviewed paid position the operator saw: original gross, cumulative
// credits, allocated payments and allocated refunds, all exact.
export const ExpectedPaidPosition = Schema.Struct({
  originalGrossMinor: Accounting.MinorUnits,
  creditedMinor: Accounting.MinorUnits,
  paidMinor: Accounting.MinorUnits,
  refundedMinor: Accounting.MinorUnits,
});

export const PreparePaidSupplierCredit = Schema.Struct({
  profile: PaidSupplierCreditProfile,
  invoiceId: Accounting.Identifier,
  acceptanceDigest: Accounting.Digest,
  expectedInvoiceRevision: Commerce.Version,
  expectedAllocationVersion: Accounting.MinorUnits,
  expectedPosition: ExpectedPaidPosition,
  creditEvidenceId: Accounting.Identifier,
  supplierCreditNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  taxMinor: Schema.optional(Accounting.MinorUnits),
  creditLines: Schema.optional(
    Schema.Array(
      Schema.Struct({
        lineId: Accounting.Identifier,
        netMinor: Accounting.MinorUnits,
        sourceTaxMinor: Accounting.MinorUnits,
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  ),
  creditDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  refundReceivableAccountId: Accounting.Identifier,
  acknowledgePaidCredit: Schema.Literal(true),
});

export const ApprovePaidSupplierCredit = Schema.Struct({
  digest: Accounting.Digest,
  acknowledgePaidCredit: Schema.Literal(true),
});

export const ExecutePaidSupplierCredit = Schema.Struct({
  ...ApprovePaidSupplierCredit.fields,
  approvalId: Accounting.Identifier,
});

// The paid split sealed with the review: how much of the gross released the
// payable and how much raised the explicit refund receivable, with the paid
// position (G/K/P/Q) before and after plus the derived unpaid residual and
// refund principal after, for conservation checks at execution.
export const PaidCreditBreakdown = Schema.Struct({
  apReleaseMinor: Accounting.MinorUnits,
  refundPrincipalIncreaseMinor: Accounting.MinorUnits,
  refundReceivableAccountId: Accounting.Identifier,
  positionBefore: ExpectedPaidPosition,
  positionAfter: ExpectedPaidPosition,
  unpaidAfterMinor: Accounting.MinorUnits,
  refundPrincipalAfterMinor: Accounting.MinorUnits,
  refundDueAfterMinor: Accounting.MinorUnits,
});

export const PaidSupplierCreditSnapshot = Schema.Struct({
  ...Credits.SupplierCreditSnapshot.fields,
  paid: PaidCreditBreakdown,
});

export const PaidSupplierCreditReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  profile: PaidSupplierCreditProfile,
  input: PreparePaidSupplierCredit,
  snapshot: PaidSupplierCreditSnapshot,
  postingPlan: Accounting.ChangeSet,
  taxMinor: Accounting.MinorUnits,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const PaidSupplierCreditApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

// A paid receipt is stored in the shared supplier_credits row so the legacy
// credited total keeps counting every credit. It decodes as a
// SupplierCreditReceipt with paid true and the sealed split attached.
export const PaidSupplierCreditReceipt = Schema.Struct({
  ...Credits.SupplierCreditReceipt.fields,
  paid: Schema.Literal(true),
  apReleaseMinor: Accounting.MinorUnits,
  refundPrincipalIncreaseMinor: Accounting.MinorUnits,
  refundReceivableAccountId: Accounting.Identifier,
  unpaidAfterMinor: Accounting.MinorUnits,
  refundPrincipalAfterMinor: Accounting.MinorUnits,
});

export const PaidSupplierCreditView = Schema.Struct({
  review: PaidSupplierCreditReview,
  approval: Schema.NullOr(PaidSupplierCreditApproval),
  credit: Schema.NullOr(PaidSupplierCreditReceipt),
  dependenciesCurrent: Schema.Boolean,
});

const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

// An adopted posted refund-control credit, addressed as voucher and line.
// The colon form cannot satisfy the Identifier pattern, so it stays a
// bounded string and is parsed only by the owning refund operation.
export const AdoptedRefundRef = Schema.String.check(Schema.isMinLength(5), Schema.isMaxLength(261));

export const RefundAllocationRequest = Schema.Struct({
  allocationId: Accounting.Identifier,
  amountMinor: Accounting.MinorUnits,
});

export const RefundSourceRequest = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("unposted_cash"),
    bankAccountId: Accounting.Identifier,
    evidenceId: Accounting.Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("posted_credit"),
    voucherId: Accounting.Identifier,
    lineId: Accounting.Identifier,
  }),
]);

export const PrepareSupplierRefund = Schema.Struct({
  invoiceId: Accounting.Identifier,
  expectedInvoiceRevision: Commerce.Version,
  expectedAllocationVersion: Accounting.MinorUnits,
  expectedRefundDueMinor: Accounting.MinorUnits,
  expectedRefundedMinor: Accounting.MinorUnits,
  refundDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  refundReceivableAccountId: Accounting.Identifier,
  refundEvidenceId: Accounting.Identifier,
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  allocations: Schema.Array(RefundAllocationRequest).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  source: RefundSourceRequest,
});

export const ApproveSupplierRefund = Schema.Struct({
  digest: Accounting.Digest,
});

export const ExecuteSupplierRefund = Schema.Struct({
  ...ApproveSupplierRefund.fields,
  approvalId: Accounting.Identifier,
});

export const SupplierRefundSnapshot = Schema.Struct({
  invoice: Commerce.Invoice,
  refundDueMinor: Accounting.MinorUnits,
  refundedMinor: Accounting.MinorUnits,
  currency: CurrencyCode,
  refundReceivableAccountId: Accounting.Identifier,
  refundEvidence: Commerce.EvidenceReference,
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  allocations: Schema.Array(RefundAllocationRequest).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  adoptedRef: Schema.NullOr(AdoptedRefundRef),
  refundDate: Accounting.AccountingDate,
});

export const SupplierRefundReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: PrepareSupplierRefund,
  snapshot: SupplierRefundSnapshot,
  postingPlan: Schema.NullOr(Accounting.ChangeSet),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const SupplierRefundApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const SupplierRefundReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  invoiceId: Accounting.Identifier,
  refundDate: Accounting.AccountingDate,
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  sourceKind: Schema.Literals(["unposted_cash", "posted_credit"]),
  voucherId: Schema.NullOr(Accounting.Identifier),
  adoptedRef: Schema.NullOr(AdoptedRefundRef),
  postingReceipt: Schema.NullOr(Accounting.ExecutionReceipt),
  refundEvidence: Commerce.EvidenceReference,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const SupplierRefundView = Schema.Struct({
  review: SupplierRefundReview,
  approval: Schema.NullOr(SupplierRefundApproval),
  refund: Schema.NullOr(SupplierRefundReceipt),
  dependenciesCurrent: Schema.Boolean,
});

// One paid position: original invoice, credits, historical payments,
// current payable, refund principal and received refunds, each with the
// accounting date and recorded timestamp a report cutoff needs.
export const SupplierRefundPosition = Schema.Struct({
  scope: Accounting.Scope,
  invoiceId: Accounting.Identifier,
  currency: CurrencyCode,
  originalGrossMinor: Accounting.MinorUnits,
  creditedMinor: Accounting.MinorUnits,
  paidMinor: Accounting.MinorUnits,
  refundedMinor: Accounting.MinorUnits,
  unpaidMinor: Accounting.MinorUnits,
  refundPrincipalMinor: Accounting.MinorUnits,
  refundDueMinor: Accounting.MinorUnits,
  refundReceivableAccountId: Schema.NullOr(Accounting.Identifier),
  invoiceRevision: Commerce.Version,
  allocationVersion: Accounting.MinorUnits,
});

export const SupplierRefundHistoryItem = Schema.Struct({
  kind: Schema.Literals(["credit", "payment", "principal_increase", "refund"]),
  id: Accounting.Identifier,
  amountMinor: Accounting.MinorUnits,
  accountingOn: Accounting.AccountingDate,
  recordedAt: Schema.String,
  body: Schema.Json,
});

export const SupplierRefundHistory = Schema.Struct({
  scope: Accounting.Scope,
  invoiceId: Accounting.Identifier,
  position: SupplierRefundPosition,
  count: Schema.Int,
  items: Schema.Array(SupplierRefundHistoryItem).check(Schema.isMaxLength(200)),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce";

export const SupplierRefundsApi = HttpApiGroup.make("supplierRefunds").add(
  HttpApiEndpoint.post("preparePaidSupplierCredit", `${path}/paid-supplier-credit-reviews`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PreparePaidSupplierCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PaidSupplierCreditReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post(
    "approvePaidSupplierCredit",
    `${path}/paid-supplier-credit-reviews/:id/approvals`,
    {
      params: Accounting.ChangePath,
      headers: Accounting.IdempotencyHeaders,
      payload: ApprovePaidSupplierCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: PaidSupplierCreditApproval,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.post(
    "executePaidSupplierCredit",
    `${path}/paid-supplier-credit-reviews/:id/execute`,
    {
      params: Accounting.ChangePath,
      headers: Accounting.IdempotencyHeaders,
      payload: ExecutePaidSupplierCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: PaidSupplierCreditReceipt,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.get("getPaidSupplierCreditReview", `${path}/paid-supplier-credit-reviews/:id`, {
    params: Accounting.ChangePath,
    success: PaidSupplierCreditView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("prepareSupplierRefund", `${path}/supplier-refund-reviews`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareSupplierRefund.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierRefundReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveSupplierRefund", `${path}/supplier-refund-reviews/:id/approvals`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: ApproveSupplierRefund.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierRefundApproval,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("executeSupplierRefund", `${path}/supplier-refund-reviews/:id/execute`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: ExecuteSupplierRefund.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierRefundReceipt,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getSupplierRefundReview", `${path}/supplier-refund-reviews/:id`, {
    params: Accounting.ChangePath,
    success: SupplierRefundView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get(
    "getSupplierRefundPosition",
    `${path}/invoices/:id/supplier-refund-position`,
    {
      params: Accounting.ChangePath,
      success: SupplierRefundPosition,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.get("supplierRefundHistory", `${path}/invoices/:id/supplier-refunds`, {
    params: Accounting.ChangePath,
    success: SupplierRefundHistory,
    error: accountingErrors,
  }),
);

export const SupplierRefundCapabilities = {
  commerce_get_supplier_refund_position: {
    description:
      "Read one supplier payable's paid position: original gross, credits, payments, current payable, refund principal and received refunds. No posting or refund authority.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierRefundPosition,
    readOnly: true,
  },
  commerce_supplier_refund_history: {
    description:
      "Read the bounded credit, payment, principal-increase and refund history for one supplier payable with accounting and recorded dates. No posting or refund authority.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierRefundHistory,
    readOnly: true,
  },
};
