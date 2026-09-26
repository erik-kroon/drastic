import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Drafts from "./invoice-drafts";
import * as Policy from "./legal-sales-policy";
import { accountingErrors } from "./accounting-errors";

export const PrepareLegalInvoicePdf = Schema.Struct({
  issueId: Accounting.Identifier,
  issueDigest: Accounting.Digest,
  rendererVersion: Schema.Literals([
    "openerp-se-invoice-takumi-v1",
    "openerp-se-invoice-takumi-v2",
  ]),
});

export const LegalIssuePdfFacts = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  policyId: Accounting.Identifier,
  policyDigest: Accounting.Digest,
  policySnapshot: Policy.LegalSalesPolicy,
  draftSnapshot: Drafts.InvoiceDraftRevision,
  totals: Schema.Struct({
    netMinor: Accounting.AggregateMinorUnits,
    taxMinor: Accounting.AggregateMinorUnits,
    grossMinor: Accounting.AggregateMinorUnits,
  }),
  lines: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      description: Schema.String,
      quantity: Schema.String,
      unitPriceMinor: Accounting.MinorUnits,
      baseMinor: Accounting.MinorUnits,
      discountMinor: Accounting.MinorUnits,
      chargeMinor: Accounting.MinorUnits,
      netMinor: Accounting.AggregateMinorUnits,
      taxMinor: Accounting.MinorUnits,
      grossMinor: Accounting.AggregateMinorUnits,
      vatTreatment: Schema.Literal("se-domestic-standard-25-v1"),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  legalDocumentNumber: Schema.String,
  issuedOn: Accounting.AccountingDate,
  issuedAt: Schema.String,
  issued: Schema.Literal(true),
  legalInvoice: Schema.Literal(true),
  recognized: Schema.Literal(true),
  delivered: Schema.Literal(false),
  digest: Accounting.Digest,
});

export const LegalInvoicePdfCapture = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  issueId: Accounting.Identifier,
  input: PrepareLegalInvoicePdf,
  source: Schema.Struct({ issue: LegalIssuePdfFacts }),
  sourceDigest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});

export const LegalInvoicePdfArtifact = Schema.Struct({
  captureId: Accounting.Identifier,
  captureDigest: Accounting.Digest,
  filename: Schema.String,
  mediaType: Schema.Literal("application/pdf"),
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2097152 })),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  contentBase64: Schema.String.check(Schema.isMaxLength(2796204)),
  sealedAt: Schema.String,
  legalInvoice: Schema.Literal(true),
  delivered: Schema.Literal(false),
  rendererVersion: Schema.Literals([
    "openerp-se-invoice-takumi-v1",
    "openerp-se-invoice-takumi-v2",
  ]),
});

export const LegalInvoicePdfView = Schema.Struct({
  capture: LegalInvoicePdfCapture,
  artifact: Schema.NullOr(LegalInvoicePdfArtifact),
});

export const LegalInvoicePdfHistory = Schema.Struct({
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

const base = "/v1/entities/:entityId/books/:bookId/commerce";

export const LegalInvoicePdfApi = HttpApiGroup.make("legalInvoicePdfs").add(
  HttpApiEndpoint.post("prepareLegalInvoicePdf", `${base}/legal-invoice-pdfs`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareLegalInvoicePdf.annotate({ parseOptions: { onExcessProperty: "error" } }),
    error: accountingErrors,
    success: LegalInvoicePdfView,
  }),
  HttpApiEndpoint.get("getLegalInvoicePdf", `${base}/legal-invoice-pdfs/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: LegalInvoicePdfView,
  }),
  HttpApiEndpoint.post("resumeLegalInvoicePdf", `${base}/legal-invoice-pdfs/:id/render`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: LegalInvoicePdfView,
  }),
  HttpApiEndpoint.get("legalInvoicePdfHistory", `${base}/legal-invoice-issues/:id/pdfs`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: LegalInvoicePdfHistory,
  }),
);

export const LegalInvoicePdfCapabilities = {
  commerce_get_legal_invoice_pdf: {
    description:
      "Read PDF bytes sealed from one immutable legal issue and versioned renderer; download is not delivery.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: LegalInvoicePdfView,
    readOnly: true,
  },
  commerce_legal_invoice_pdf_history: {
    description: "Find the bounded immutable legal PDF capture of one issued invoice.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: LegalInvoicePdfHistory,
    readOnly: true,
  },
};
