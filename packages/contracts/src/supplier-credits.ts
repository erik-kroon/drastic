import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors } from "./accounting-errors";

export const PrepareSupplierCredit = Schema.Struct({
  profile: Schema.Literal("synthetic-zero-tax-supplier-credit-v1"),
  invoiceId: Accounting.Identifier,
  acceptanceDigest: Accounting.Digest,
  expectedInvoiceRevision: Commerce.Version,
  expectedAllocationVersion: Accounting.MinorUnits,
  expectedOutstandingMinor: Accounting.MinorUnits,
  creditEvidenceId: Accounting.Identifier,
  supplierCreditNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  creditDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});
export const SupplierCreditSnapshot = Schema.Struct({
  invoice: Commerce.Invoice,
  acceptanceDigest: Accounting.Digest,
  originalVoucherId: Accounting.Identifier,
  expenseAccountId: Accounting.Identifier,
  creditEvidence: Commerce.EvidenceReference,
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  creditDate: Accounting.AccountingDate,
  supplierCreditNumber: PrepareSupplierCredit.fields.supplierCreditNumber,
});
export const SupplierCreditReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  profile: Schema.Literal("synthetic-zero-tax-supplier-credit-v1"),
  input: PrepareSupplierCredit,
  snapshot: SupplierCreditSnapshot,
  postingPlan: Accounting.ChangeSet,
  taxMinor: Schema.Literal("0"),
  vatFactsCreated: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const SupplierCreditApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});
export const SupplierCreditReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  invoiceId: Accounting.Identifier,
  supplierCreditNumber: PrepareSupplierCredit.fields.supplierCreditNumber,
  creditDate: Accounting.AccountingDate,
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  taxMinor: Schema.Literal("0"),
  vatFactsCreated: Schema.Literal(false),
  originalAllocatedMinor: Accounting.MinorUnits,
  outstandingAfterMinor: Accounting.MinorUnits,
  postingReceipt: Accounting.ExecutionReceipt,
  creditEvidence: Commerce.EvidenceReference,
  status: Schema.Literal("credited"),
  paid: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const SupplierCreditView = Schema.Struct({
  review: SupplierCreditReview,
  approval: Schema.NullOr(SupplierCreditApproval),
  credit: Schema.NullOr(SupplierCreditReceipt),
  dependenciesCurrent: Schema.Boolean,
});
export const SupplierCreditHistory = Schema.Struct({
  scope: Accounting.Scope,
  invoiceId: Accounting.Identifier,
  count: Schema.Int,
  items: Schema.Array(SupplierCreditReceipt).check(Schema.isMaxLength(50)),
});
const path = "/v1/entities/:entityId/books/:bookId/commerce";
export const SupplierCreditsApi = HttpApiGroup.make("supplierCredits").add(
  HttpApiEndpoint.post("prepareSupplierCredit", `${path}/supplier-credit-reviews`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareSupplierCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierCreditReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveSupplierCredit", `${path}/supplier-credit-reviews/:id/approvals`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: Schema.Struct({
      digest: Accounting.Digest,
      acknowledgeSyntheticOnly: Schema.Literal(true),
    }).annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierCreditApproval,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("executeSupplierCredit", `${path}/supplier-credit-reviews/:id/execute`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: Schema.Struct({
      digest: Accounting.Digest,
      approvalId: Accounting.Identifier,
      acknowledgeSyntheticOnly: Schema.Literal(true),
    }).annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierCreditReceipt,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getSupplierCreditReview", `${path}/supplier-credit-reviews/:id`, {
    params: Accounting.ChangePath,
    success: SupplierCreditView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("supplierCreditHistory", `${path}/invoices/:id/supplier-credits`, {
    params: Accounting.ChangePath,
    success: SupplierCreditHistory,
    error: accountingErrors,
  }),
);
export const SupplierCreditCapabilities = {
  commerce_get_supplier_credit_review: {
    description:
      "Read a synthetic supplier credit review, same-operator approval and exact posted credit receipt. No real VAT or refund authority.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierCreditView,
    readOnly: true,
  },
  commerce_supplier_credit_history: {
    description:
      "Read the bounded credit history for one supplier payable, preserving applied payment legs and original invoice identity.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierCreditHistory,
    readOnly: true,
  },
};
