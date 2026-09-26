import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Documents from "./invoice-documents";
import { accountingErrors } from "./accounting-errors";

export const PrepareInvoicePdf = Schema.Struct({
  issueId: Accounting.Identifier,
  issueDigest: Accounting.Digest,
  generatorVersion: Schema.Literal("openerp-synthetic-invoice-pdf-v1"),
});

export const InvoicePdfCapture = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: PrepareInvoicePdf,
  source: Documents.InvoiceDocumentSource,
  sourceDigest: Accounting.Digest,
  digest: Accounting.Digest,
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  historicalOnly: Schema.Literal(true),
  legalInvoice: Schema.Literal(false),
  delivered: Schema.Literal(false),
});

export const InvoicePdfArtifact = Schema.Struct({
  captureId: Accounting.Identifier,
  captureDigest: Accounting.Digest,
  filename: Schema.String,
  mediaType: Schema.Literal("application/pdf"),
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1048576 })),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  contentBase64: Schema.String.check(Schema.isMaxLength(1398104)),
  sealedAt: Schema.String,
  legalInvoice: Schema.Literal(false),
  delivered: Schema.Literal(false),
});

export const InvoicePdfView = Schema.Struct({
  capture: InvoicePdfCapture,
  artifact: Schema.NullOr(InvoicePdfArtifact),
});

export const InvoicePdfHistory = Schema.Struct({
  scope: Accounting.Scope,
  issueId: Accounting.Identifier,
  complete: Schema.Literal(true),
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      digest: Accounting.Digest,
      sealed: Schema.Boolean,
      sha256: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(1)),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce";

const identified = { params: Accounting.ChangePath, error: accountingErrors };

export const InvoicePdfApi = HttpApiGroup.make("invoicePdfs").add(
  HttpApiEndpoint.post("prepareInvoicePdf", `${path}/invoice-pdfs`, {
    params: Accounting.Scope,
    error: accountingErrors,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareInvoicePdf.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoicePdfView,
  }),
  HttpApiEndpoint.get("getInvoicePdf", `${path}/invoice-pdfs/:id`, {
    ...identified,
    success: InvoicePdfView,
  }),
  HttpApiEndpoint.post("resumeInvoicePdf", `${path}/invoice-pdfs/:id/render`, {
    ...identified,
    success: InvoicePdfView,
  }),
  HttpApiEndpoint.get("invoicePdfHistory", `${path}/invoice-issues/:id/pdfs`, {
    ...identified,
    success: InvoicePdfHistory,
  }),
);

export const InvoicePdfCapabilities = {
  commerce_get_invoice_pdf: {
    description: "Read retained synthetic PDF bytes and digest, not a legal invoice or a delivery.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoicePdfView,
    readOnly: true,
  },
  commerce_invoice_pdf_history: {
    description: "Find the complete retained synthetic PDF capture for an issued invoice.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoicePdfHistory,
    readOnly: true,
  },
};
