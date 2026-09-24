import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Drafts from "./invoice-drafts";
import { accountingErrors } from "./accounting-errors";

export const SupplierDraftContent = Schema.Struct({
  title: Drafts.DraftContent.fields.title,
  counterpartyId: Drafts.DraftContent.fields.counterpartyId,
  counterpartyRevision: Drafts.DraftContent.fields.counterpartyRevision,
  supplier: Drafts.DraftIdentity,
  buyer: Drafts.DraftIdentity,
  sourceEvidenceId: Accounting.Identifier,
  supplierDocumentNumber: Schema.NullOr(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  ),
  currency: Drafts.DraftContent.fields.currency,
  currencyScale: Drafts.DraftContent.fields.currencyScale,
  documentDate: Drafts.DraftContent.fields.plannedIssueDate,
  supplyDate: Drafts.DraftContent.fields.supplyDate,
  dueDate: Drafts.DraftContent.fields.dueDate,
  paymentTerms: Drafts.DraftContent.fields.paymentTerms,
  sourceTotalMinor: Drafts.DraftContent.fields.sourceTotalMinor,
  lines: Schema.Array(Drafts.DraftLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});
export const CreateSupplierInvoiceDraft = Schema.Struct({
  draftKey: Drafts.CreateInvoiceDraft.fields.draftKey,
  content: SupplierDraftContent,
});
export const ReviseSupplierInvoiceDraft = Schema.Struct({
  ...Drafts.ReviseInvoiceDraft.fields,
  content: SupplierDraftContent,
});
export const SupplierInvoiceDraftRevision = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  draftKey: Accounting.Identifier,
  revision: Commerce.Version,
  status: Schema.Literal("draft"),
  acceptanceSupported: Schema.Literal(false),
  recognitionSupported: Schema.Literal(false),
  recognitionAssessment: Schema.Literal("not_assessed"),
  calculationBasis: Drafts.InvoiceDraftRevision.fields.calculationBasis,
  content: SupplierDraftContent,
  counterparty: Commerce.CounterpartyRevision,
  supplierEvidence: Commerce.EvidenceReference,
  buyerEvidence: Commerce.EvidenceReference,
  sourceEvidence: Commerce.EvidenceReference,
  totals: Drafts.DraftTotals,
  calculatedLines: Schema.Array(Drafts.CalculatedDraftLine),
  blockers: Schema.Array(Drafts.DraftBlocker),
  reason: Accounting.Description,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const SupplierInvoiceDraftView = Schema.Struct({
  record: SupplierInvoiceDraftRevision,
  currentRevision: Commerce.Version,
  currentDigest: Accounting.Digest,
});
export const SupplierInvoiceDraftSummary = Schema.Struct({
  id: Accounting.Identifier,
  draftKey: Accounting.Identifier,
  revision: Commerce.Version,
  title: Drafts.InvoiceDraftSummary.fields.title,
  supplierName: Drafts.InvoiceDraftSummary.fields.customerName,
  supplierDocumentNumber: SupplierDraftContent.fields.supplierDocumentNumber,
  counterpartyId: Accounting.Identifier,
  sourceEvidence: Commerce.EvidenceReference,
  currency: Drafts.InvoiceDraftSummary.fields.currency,
  currencyScale: Drafts.InvoiceDraftSummary.fields.currencyScale,
  grossMinor: Drafts.InvoiceDraftSummary.fields.grossMinor,
  blockerCount: Schema.Int,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});
export const SupplierInvoiceDraftList = Schema.Struct({
  ...Drafts.InvoiceDraftList.fields,
  items: Schema.Array(SupplierInvoiceDraftSummary).check(Schema.isMaxLength(200)),
});
export const SupplierInvoiceDraftHistory = Schema.Struct({
  ...SupplierInvoiceDraftList.fields,
  id: Accounting.Identifier,
  currentRevision: Commerce.Version,
  items: Schema.Array(SupplierInvoiceDraftSummary).check(Schema.isMaxLength(50)),
});

export const SupplierAccountSuggestions = Schema.Struct({
  scope: Accounting.Scope,
  counterpartyId: Accounting.Identifier,
  items: Schema.Array(
    Schema.Struct({
      expenseAccountId: Accounting.Identifier,
      vatRatePercent: Schema.Literals([0, 6, 12, 25]),
      sourceInvoiceId: Accounting.Identifier,
    }),
  ).check(Schema.isMaxLength(5)),
});

export const SupplierInvoiceDraftDuplicateCursor = Schema.String.check(
  Schema.isMaxLength(203),
  Schema.isPattern(
    /^sid1:[a-f0-9]{64}:(?:d:[a-z][a-z0-9_-]{2,127}:(?:[1-9]|[1-4][0-9]|50)|r:[a-z][a-z0-9_-]{2,127}:0)$/,
  ),
);
export const SupplierInvoiceDraftDuplicateQuery = Schema.Struct({
  after: Schema.optional(SupplierInvoiceDraftDuplicateCursor),
});
const SupplierDraftDuplicateReasons =
  Commerce.SupplierInvoiceDuplicates.fields.items.value.fields.reasons;
export const SupplierInvoiceDraftDuplicates = Schema.Struct({
  scope: Accounting.Scope,
  source: SupplierInvoiceDraftSummary,
  coverage: Schema.Literal("current_supplier_drafts_and_registered_supplier_invoices"),
  consistency: Schema.Literal("live_candidates"),
  items: Schema.Array(
    Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("draft"),
        draft: SupplierInvoiceDraftSummary,
        reasons: SupplierDraftDuplicateReasons,
      }),
      Schema.Struct({
        kind: Schema.Literal("registered"),
        invoice: Commerce.Invoice,
        reasons: SupplierDraftDuplicateReasons,
      }),
    ]),
  ).check(Schema.isMaxLength(50)),
  next: Schema.NullOr(SupplierInvoiceDraftDuplicateCursor),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce/supplier-invoice-drafts";
export const SupplierInvoiceDraftsApi = HttpApiGroup.make("supplierInvoiceDrafts").add(
  HttpApiEndpoint.get(
    "supplierAccountSuggestions",
    "/v1/entities/:entityId/books/:bookId/commerce/supplier-account-suggestions/:counterpartyId",
    {
      params: Schema.Struct({ ...Accounting.Scope.fields, counterpartyId: Accounting.Identifier }),
      success: SupplierAccountSuggestions,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.get("supplierInvoiceDraftDuplicates", `${path}/:id/duplicates`, {
    params: Accounting.ChangePath,
    query: SupplierInvoiceDraftDuplicateQuery.annotate({
      parseOptions: { onExcessProperty: "error" },
    }),
    success: SupplierInvoiceDraftDuplicates,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("createSupplierInvoiceDraft", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: CreateSupplierInvoiceDraft.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierInvoiceDraftRevision,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("reviseSupplierInvoiceDraft", `${path}/:id/revisions`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: ReviseSupplierInvoiceDraft.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierInvoiceDraftRevision,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getSupplierInvoiceDraft", `${path}/:id`, {
    params: Accounting.ChangePath,
    query: Drafts.DraftRevisionQuery,
    success: SupplierInvoiceDraftView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("listSupplierInvoiceDrafts", path, {
    params: Accounting.Scope,
    success: SupplierInvoiceDraftList,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("supplierInvoiceDraftHistory", `${path}/:id/revisions`, {
    params: Accounting.ChangePath,
    success: SupplierInvoiceDraftHistory,
    error: accountingErrors,
  }),
);

// Draft mutations require operator authority and are not ordinary MCP tools.
export const SupplierInvoiceDraftCapabilities = {
  commerce_supplier_invoice_draft_duplicates: {
    description:
      "Read live exact-match reasons among current supplier drafts and registered supplier invoices for this draft's captured counterpart. Matches are reasons to inspect, not proof of duplication. Follow next; restart if the source changes or to include new or edited candidates. No completeness claim or financial authority.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      ...SupplierInvoiceDraftDuplicateQuery.fields,
    }),
    output: SupplierInvoiceDraftDuplicates,
    readOnly: true,
  },
  commerce_get_supplier_invoice_draft: {
    description:
      "Read an unaccepted supplier-document draft or retained revision, with separate current head. Recognition elsewhere is not assessed. No acceptance, posting or payment authority.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      ...Drafts.DraftRevisionQuery.fields,
    }),
    output: SupplierInvoiceDraftView,
    readOnly: true,
  },
  commerce_list_supplier_invoice_drafts: {
    description:
      "Read the complete bounded current supplier-document draft list and source evidence references. Not an accepted or recognized supplier-invoice register.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: SupplierInvoiceDraftList,
    readOnly: true,
  },
  commerce_supplier_invoice_draft_history: {
    description:
      "Read the complete bounded immutable revision-summary history of one supplier-document draft. Source identity is asserted; recognition elsewhere is not assessed.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierInvoiceDraftHistory,
    readOnly: true,
  },
};
