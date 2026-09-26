import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors } from "./accounting-errors";
import { SalesQuery, SalesPage } from "./sales-register";

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const Note = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000));

export const DraftIdentity = Schema.Struct({
  legalName: Name,
  registrationId: Schema.NullOr(Name),
  taxId: Schema.NullOr(Name),
  address: Schema.NullOr(Note),
  countryCode: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/))),
  evidenceId: Accounting.Identifier,
});

export const DraftLine = Schema.Struct({
  id: Accounting.Identifier,
  description: Name,
  quantity: Schema.String.check(
    Schema.isPattern(/^(?:[1-9][0-9]{0,11}|(?:0|[1-9][0-9]{0,11})\.[0-9]{0,5}[1-9])$/),
  ),
  unitPriceMinor: Schema.NullOr(Accounting.MinorUnits),
  baseMinor: Accounting.MinorUnits,
  discountMinor: Accounting.MinorUnits,
  chargeMinor: Accounting.MinorUnits,
  taxMinor: Schema.NullOr(Accounting.MinorUnits),
  taxDescription: Schema.NullOr(Name),
  taxEvidenceId: Schema.NullOr(Accounting.Identifier),
  sourceGrossMinor: Schema.NullOr(Accounting.MinorUnits),
  catalogSelection: Schema.optional(
    Schema.Struct({
      code: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)),
      revision: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100000 })),
      unit: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
    }),
  ),
});

export const DraftContent = Schema.Struct({
  title: Name,
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Commerce.Version,
  seller: DraftIdentity,
  customer: DraftIdentity,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  plannedIssueDate: Schema.NullOr(Accounting.AccountingDate),
  supplyDate: Schema.NullOr(Accounting.AccountingDate),
  dueDate: Schema.NullOr(Accounting.AccountingDate),
  paymentTerms: Schema.NullOr(Note),
  sourceTotalMinor: Schema.NullOr(Accounting.MinorUnits),
  lines: Schema.Array(DraftLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

export const CreateInvoiceDraft = Schema.Struct({
  draftKey: Accounting.Identifier,
  content: DraftContent,
});

export const ReviseInvoiceDraft = Schema.Struct({
  expectedRevision: Commerce.Version,
  expectedDigest: Accounting.Digest,
  reason: Accounting.Description,
  content: DraftContent,
});

export const DraftTotals = Schema.Struct({
  baseMinor: Accounting.AggregateMinorUnits,
  discountMinor: Accounting.AggregateMinorUnits,
  chargeMinor: Accounting.AggregateMinorUnits,
  netMinor: Accounting.AggregateMinorUnits,
  taxMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  grossMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  sourceTotalMatches: Schema.NullOr(Schema.Boolean),
});

export const CalculatedDraftLine = Schema.Struct({
  id: Accounting.Identifier,
  calculatedBaseMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  netMinor: Accounting.AggregateMinorUnits,
  grossMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  sourceGrossMatches: Schema.NullOr(Schema.Boolean),
  taxEvidence: Schema.NullOr(Commerce.EvidenceReference),
});

export const DraftBlocker = Schema.Struct({
  code: Schema.String,
  lineId: Schema.NullOr(Accounting.Identifier),
});

export const InvoiceDraftRevision = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  draftKey: Accounting.Identifier,
  revision: Commerce.Version,
  status: Schema.Literal("draft"),
  issued: Schema.Literal(false),
  recognized: Schema.Literal(false),
  delivered: Schema.Literal(false),
  calculationBasis: Schema.Literal("explicit_line_amounts_v1"),
  content: DraftContent,
  counterparty: Commerce.CounterpartyRevision,
  sellerEvidence: Commerce.EvidenceReference,
  customerEvidence: Commerce.EvidenceReference,
  totals: DraftTotals,
  calculatedLines: Schema.Array(CalculatedDraftLine),
  blockers: Schema.Array(DraftBlocker),
  reason: Accounting.Description,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const InvoiceDraftView = Schema.Struct({
  record: InvoiceDraftRevision,
  currentRevision: Commerce.Version,
  currentDigest: Accounting.Digest,
});

export const InvoiceDraftSummary = Schema.Struct({
  id: Accounting.Identifier,
  draftKey: Accounting.Identifier,
  revision: Commerce.Version,
  title: Name,
  customerName: Name,
  currency: Schema.String,
  currencyScale: Schema.Int,
  grossMinor: Schema.NullOr(Accounting.AggregateMinorUnits),
  blockerCount: Schema.Int,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});

export const InvoiceDraftList = Schema.Struct({
  scope: Accounting.Scope,
  complete: Schema.Literal(true),
  count: Schema.Int,
  capturedAt: Schema.String,
  digest: Accounting.Digest,
  items: Schema.Array(InvoiceDraftSummary).check(Schema.isMaxLength(200)),
});

export const InvoiceDraftHistory = Schema.Struct({
  ...InvoiceDraftList.fields,
  id: Accounting.Identifier,
  currentRevision: Commerce.Version,
  items: Schema.Array(InvoiceDraftSummary).check(Schema.isMaxLength(50)),
});

export const DraftRevisionQuery = Schema.Struct({ revision: Schema.optional(Commerce.Version) });

const path = "/v1/entities/:entityId/books/:bookId/commerce/invoice-drafts";

export const InvoiceDraftsApi = HttpApiGroup.make("invoiceDrafts").add(
  HttpApiEndpoint.get(
    "salesRegister",
    "/v1/entities/:entityId/books/:bookId/commerce/sales-register",
    {
      params: Accounting.Scope,
      query: SalesQuery,
      success: SalesPage,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.post("createInvoiceDraft", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: CreateInvoiceDraft.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceDraftRevision,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("reviseInvoiceDraft", `${path}/:id/revisions`, {
    params: Accounting.ChangePath,
    headers: Accounting.IdempotencyHeaders,
    payload: ReviseInvoiceDraft.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceDraftRevision,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getInvoiceDraft", `${path}/:id`, {
    params: Accounting.ChangePath,
    query: DraftRevisionQuery,
    success: InvoiceDraftView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("listInvoiceDrafts", path, {
    params: Accounting.Scope,
    success: InvoiceDraftList,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("invoiceDraftHistory", `${path}/:id/revisions`, {
    params: Accounting.ChangePath,
    success: InvoiceDraftHistory,
    error: accountingErrors,
  }),
);

// Draft mutations require operator authority and are deliberately absent from ordinary MCP tools.
export const InvoiceDraftCapabilities = {
  commerce_sales_register: {
    description:
      "Read the scoped customer invoice lifecycle register, with search, status counts and pagination. An issued draft is represented by its registered invoice, never an editable duplicate.",
    input: Schema.Struct({ scope: Accounting.Scope, ...SalesQuery.fields }),
    output: SalesPage,
    readOnly: true,
  },
  commerce_get_invoice_draft: {
    description:
      "Read an unissued customer-invoice draft or its retained revision. Current head and immutable facts are distinct; no posting or delivery.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      ...DraftRevisionQuery.fields,
    }),
    output: InvoiceDraftView,
    readOnly: true,
  },
  commerce_list_invoice_drafts: {
    description:
      "Read the complete bounded current commercial-draft list. Not the issued or posted invoice register.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: InvoiceDraftList,
    readOnly: true,
  },
  commerce_invoice_draft_history: {
    description:
      "Read the complete bounded immutable revision-summary history of one unissued commercial draft.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceDraftHistory,
    readOnly: true,
  },
};
