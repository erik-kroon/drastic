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
export const SupplierPaymentBatchView = Schema.Struct({
  preview: SupplierPaymentPreview,
  export: Schema.NullOr(SupplierPaymentExport),
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
  HttpApiEndpoint.get("getSupplierPaymentBatch", `${path}/:id`, {
    params: Accounting.ChangePath,
    success: SupplierPaymentBatchView,
    error: accountingErrors,
  }),
);
export const SupplierPaymentBatchCapabilities = {
  commerce_get_supplier_payment_batch: {
    description:
      "Read a synthetic offline payment preview and immutable exported bytes. Export is neither bank acceptance nor evidence of payment.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierPaymentBatchView,
    readOnly: true,
  },
};
