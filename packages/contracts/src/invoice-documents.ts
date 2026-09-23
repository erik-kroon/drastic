import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Issuance from "./invoice-issuance";
import { accountingErrors } from "./accounting-errors";

export const invoiceDocumentLegacyGenerator = "openerp-synthetic-invoice-html-v1";
export const invoiceDocumentGenerator = "openerp-synthetic-invoice-html-v2";
const InvoiceDocumentGenerator = Schema.Literals([
  invoiceDocumentLegacyGenerator,
  invoiceDocumentGenerator,
]);
export const invoiceDocumentMaxBytes = 1048576;
export const PrepareInvoiceDocument = Schema.Struct({
  issueId: Accounting.Identifier,
  issueDigest: Accounting.Digest,
  generatorVersion: InvoiceDocumentGenerator,
});
export const InvoiceDocumentSource = Schema.Struct({
  review: Issuance.InvoiceIssueReview,
  issue: Issuance.InvoiceIssueReceipt,
});
export const InvoiceDocumentCapture = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: PrepareInvoiceDocument,
  generatorVersion: InvoiceDocumentGenerator,
  format: Schema.Literal("synthetic-invoice-review-html"),
  language: Schema.Literal("en"),
  source: InvoiceDocumentSource,
  sourceDigest: Accounting.Digest,
  digest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  historicalOnly: Schema.Literal(true),
  legalInvoice: Schema.Literal(false),
  delivered: Schema.Literal(false),
});
export const InvoiceDocumentArtifact = Schema.Struct({
  captureId: Accounting.Identifier,
  scope: Accounting.Scope,
  captureDigest: Accounting.Digest,
  sourceDigest: Accounting.Digest,
  issueId: Accounting.Identifier,
  issueDigest: Accounting.Digest,
  generatorVersion: InvoiceDocumentGenerator,
  format: Schema.Literal("synthetic-invoice-review-html"),
  language: Schema.Literal("en"),
  encoding: Schema.Literal("UTF-8"),
  mediaType: Schema.Literal("text/html"),
  filename: Schema.String,
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: invoiceDocumentMaxBytes })),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  contentBase64: Schema.String.check(Schema.isMaxLength(1398104)),
  sealedAt: Schema.String,
  historicalOnly: Schema.Literal(true),
  legalInvoice: Schema.Literal(false),
  delivered: Schema.Literal(false),
});
export const InvoiceDocumentView = Schema.Struct({
  capture: InvoiceDocumentCapture,
  artifact: Schema.NullOr(InvoiceDocumentArtifact),
});
export const InvoiceDocumentHistory = Schema.Struct({
  scope: Accounting.Scope,
  issueId: Accounting.Identifier,
  complete: Schema.Literal(true),
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      captureDigest: Accounting.Digest,
      createdAt: Schema.String,
      generatorVersion: InvoiceDocumentGenerator,
      sealed: Schema.Boolean,
      sha256: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(2)),
});
const path = "/v1/entities/:entityId/books/:bookId/commerce";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
export const InvoiceDocumentsApi = HttpApiGroup.make("invoiceDocuments").add(
  HttpApiEndpoint.post("prepareInvoiceDocument", `${path}/invoice-documents`, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareInvoiceDocument.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceDocumentView,
  }),
  HttpApiEndpoint.get("getInvoiceDocument", `${path}/invoice-documents/:id`, {
    ...identified,
    success: InvoiceDocumentView,
  }),
  HttpApiEndpoint.post("resumeInvoiceDocument", `${path}/invoice-documents/:id/render`, {
    ...identified,
    success: InvoiceDocumentView,
  }),
  HttpApiEndpoint.get("invoiceDocumentHistory", `${path}/invoice-issues/:id/documents`, {
    ...identified,
    success: InvoiceDocumentHistory,
  }),
);
export const InvoiceDocumentCapabilities = {
  commerce_prepare_invoice_document: {
    description:
      "Capture and render a synthetic historical invoice review document from an exact immutable issued receipt. Not a legal invoice or delivery; no posting or numbering.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareInvoiceDocument,
    }),
    output: InvoiceDocumentView,
    readOnly: false,
  },
  commerce_get_invoice_document: {
    description:
      "Read immutable invoice document capture and retained HTML bytes. Verify byte length/hash before saving. Historical only, not current balances or legal delivery.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceDocumentView,
    readOnly: true,
  },
  commerce_resume_invoice_document: {
    description:
      "Resume deterministic rendering of an existing capture under current book authorization. Sealed bytes cannot be replaced. No new invoice number, posting or transmission.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceDocumentView,
    readOnly: false,
  },
  commerce_invoice_document_history: {
    description:
      "Read the complete bounded document capture history for one immutable issued synthetic invoice, including interrupted generation.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceDocumentHistory,
    readOnly: true,
  },
};
