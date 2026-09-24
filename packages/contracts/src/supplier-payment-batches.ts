import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors } from "./accounting-errors";

const Iban = Schema.String.check(Schema.isPattern(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/));
const Bic = Schema.String.check(Schema.isPattern(/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/));
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(70));
export const SupplierPaymentItemInput = Schema.Struct({
  invoiceId: Accounting.Identifier,
  expectedOutstandingMinor: Accounting.MinorUnits,
  expectedAllocationVersion: Accounting.MinorUnits,
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  creditorName: Name,
  creditorIban: Iban,
  creditorBic: Bic,
  payeeEvidenceId: Accounting.Identifier,
  payeeVerificationId: Schema.optional(Accounting.Identifier),
});
export const PrepareSupplierPaymentBatch = Schema.Struct({
  profile: Schema.Literal("synthetic-offline-pain001-v1"),
  executionDate: Accounting.AccountingDate,
  debtorName: Name,
  debtorIban: Iban,
  debtorBic: Bic,
  items: Schema.Array(SupplierPaymentItemInput).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  reason: Accounting.Description,
  acknowledgeOfflineOnly: Schema.Literal(true),
});
export const ExportSupplierPaymentBatch = Schema.Struct({
  digest: Accounting.Digest,
  acknowledgeOfflineOnly: Schema.Literal(true),
});
const SupplierPaymentSelectionItem = Schema.Struct({
  invoiceId: Accounting.Identifier,
  supplierDocumentNumber: Schema.String,
  amountMinor: Commerce.CreateInvoice.fields.amountMinor,
  outstandingMinor: Accounting.MinorUnits,
  allocationVersion: Accounting.MinorUnits,
  creditorName: Name,
  creditorIban: Iban,
  creditorBic: Bic,
  payeeVerificationId: Schema.optional(Accounting.Identifier),
  counterpartyRevision: Schema.optional(Accounting.MinorUnits),
  payeeEvidence: Commerce.EvidenceReference,
});
export const SupplierPaymentSelection = Schema.Struct({
  items: Schema.Array(SupplierPaymentSelectionItem).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  totalMinor: Commerce.CreateInvoice.fields.amountMinor,
  count: Schema.Int,
});
export const SupplierPaymentPreview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: PrepareSupplierPaymentBatch,
  selection: SupplierPaymentSelection,
  format: Schema.Literal("pain.001.001.03"),
  status: Schema.Literal("preview"),
  bankCompatible: Schema.Literal(false),
  bankAccepted: Schema.Literal(false),
  paid: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const SupplierPaymentExport = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  previewId: Accounting.Identifier,
  previewDigest: Accounting.Digest,
  format: Schema.Literal("pain.001.001.03"),
  mediaType: Schema.Literal("application/xml"),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  base64: Schema.String,
  status: Schema.Literal("exported"),
  bankCompatible: Schema.Literal(false),
  bankAccepted: Schema.Literal(false),
  paid: Schema.Literal(false),
  selection: SupplierPaymentSelection,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const PayeeProposalInput = Schema.Struct({
  counterpartyId: Accounting.Identifier,
  expectedRevision: Accounting.MinorUnits,
  creditorName: Name,
  creditorIban: Iban,
  creditorBic: Bic,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});
export const PayeeProposal = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Schema.optional(Accounting.MinorUnits),
  creditorName: Name,
  creditorIban: Iban,
  creditorBic: Bic,
  evidence: Commerce.EvidenceReference,
  reason: Accounting.Description,
  status: Schema.Literal("pending"),
  bankVerified: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const VerifyPayeeInput = Schema.Struct({
  digest: Accounting.Digest,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
  confirmIndependentCheck: Schema.Literal(true),
});
export const PayeeVerification = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  proposalId: Accounting.Identifier,
  proposalDigest: Accounting.Digest,
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Schema.optional(Accounting.MinorUnits),
  creditorName: Name,
  creditorIban: Iban,
  creditorBic: Bic,
  evidence: Commerce.EvidenceReference,
  reason: Accounting.Description,
  status: Schema.Literal("independently_checked"),
  bankVerified: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const PayeeReview = Schema.Struct({
  proposal: PayeeProposal,
  verification: Schema.NullOr(PayeeVerification),
  current: Schema.Boolean,
});
export const PaymentEligibility = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(
    Schema.Struct({
      invoiceId: Accounting.Identifier,
      supplierDocumentNumber: Schema.String,
      counterpartyId: Accounting.Identifier,
      currentCounterpartyRevision: Accounting.MinorUnits,
      payeeVerification: Schema.NullOr(PayeeVerification),
      outstandingMinor: Schema.NullOr(Accounting.MinorUnits),
      allocationVersion: Accounting.MinorUnits,
      invoiceBlockers: Schema.Array(Schema.String),
      eligible: Schema.Boolean,
      reasons: Schema.Array(Schema.String),
    }),
  ),
  next: Schema.NullOr(Accounting.Identifier),
  pageSize: Schema.Literal(25),
  coverage: Schema.Literal("registered_supplier_invoices_live"),
});
export const OutcomeInput = Schema.Struct({
  exportSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  status: Schema.Literals([
    "unknown",
    "reported_accepted",
    "reported_settled",
    "reported_rejected",
  ]),
  evidenceId: Accounting.Identifier,
  externalReference: Accounting.Description,
  reason: Accounting.Description,
  acknowledgeNoAccountingEffect: Schema.Literal(true),
});
export const PaymentOutcome = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  exportId: Accounting.Identifier,
  exportSha256: OutcomeInput.fields.exportSha256,
  status: OutcomeInput.fields.status,
  ordinal: Schema.Int,
  evidence: Commerce.EvidenceReference,
  externalReference: Accounting.Description,
  reason: Accounting.Description,
  bankVerified: Schema.Literal(false),
  paid: Schema.Literal(false),
  allocationCreated: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const SupplierPaymentBatchView = Schema.Struct({
  preview: SupplierPaymentPreview,
  export: Schema.NullOr(SupplierPaymentExport),
  outcomes: Schema.Array(PaymentOutcome),
  payeeStillCurrent: Schema.Boolean,
  externalStatus: Schema.Literals([
    "not_exported",
    "exported",
    "unknown",
    "reported_accepted",
    "reported_settled",
    "reported_rejected",
  ]),
  bankVerified: Schema.Literal(false),
  allocationCreated: Schema.Literal(false),
  recovery: Schema.String,
});
const path = "/v1/entities/:entityId/books/:bookId/commerce/supplier-payment-batches";
export const SupplierPaymentBatchesApi = HttpApiGroup.make("supplierPaymentBatches").add(
  HttpApiEndpoint.post("prepareSupplierPaymentBatch", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareSupplierPaymentBatch.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierPaymentPreview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("exportSupplierPaymentBatch", `${path}/:id/export`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: ExportSupplierPaymentBatch.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierPaymentExport,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("listSupplierPaymentEligibility", `${path}/eligibility`, {
    params: Accounting.Scope,
    query: Schema.Struct({ after: Schema.optional(Accounting.Identifier) }),
    success: PaymentEligibility,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("proposeSupplierPayee", `${path}/payees`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PayeeProposalInput,
    success: PayeeProposal,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getSupplierPayee", `${path}/payees/:id`, {
    params: Accounting.ChangePath,
    success: PayeeReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("verifySupplierPayee", `${path}/payees/:id/verify`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: VerifyPayeeInput,
    success: PayeeVerification,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getSupplierPaymentBatch", `${path}/:id`, {
    params: Accounting.ChangePath,
    success: SupplierPaymentBatchView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("reportSupplierPaymentOutcome", `${path}/:id/outcomes`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: OutcomeInput,
    success: PaymentOutcome,
    error: accountingErrors,
  }),
);
export const SupplierPaymentBatchCapabilities = {
  commerce_list_supplier_payment_eligibility: {
    description:
      "List every registered supplier invoice by book and cursor, with live payment exclusion reasons. No bank instruction is submitted.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      after: Schema.optional(Accounting.Identifier),
    }),
    output: PaymentEligibility,
    readOnly: true,
  },
  commerce_get_supplier_payee: {
    description:
      "Read the retained payee proposal, independent check and currentness. It does not verify account ownership with a bank.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: PayeeReview,
    readOnly: true,
  },
  commerce_get_supplier_payment_batch: {
    description:
      "Read a synthetic offline payment preview and immutable exported bytes. Export is neither bank acceptance nor evidence of payment.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierPaymentBatchView,
    readOnly: true,
  },
};
