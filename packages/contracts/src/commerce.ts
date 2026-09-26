import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

export const Version = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,17}$/));

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const PositiveMinor = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/));

const Currency = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

export const Direction = Schema.Literals(["customer", "supplier"]);

export const EvidenceReference = Schema.Struct({
  evidenceId: Accounting.Identifier,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export const CommandReceipt = Schema.Struct({
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  operation: Schema.String,
  actorId: Accounting.Identifier,
});

export const CreateCounterparty = Schema.Struct({
  kind: Schema.Literal("synthetic_counterparty_v1"),
  externalKey: Name,
  role: Schema.Literals(["customer", "supplier", "both"]),
  displayName: Name,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const ReviseCounterparty = Schema.Struct({
  expectedRevision: Version,
  displayName: Name,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const CounterpartyRevision = Schema.Struct({
  ...CreateCounterparty.fields,
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  revision: Version,
  evidence: EvidenceReference,
  legalIdentityVerified: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const CounterpartyPage = Schema.Struct({
  items: Schema.Array(CounterpartyRevision),
  next: Schema.NullOr(Accounting.Identifier),
});

export const CreateInvoice = Schema.Struct({
  kind: Schema.Literal("synthetic_invoice_v1"),
  direction: Direction,
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Version,
  documentNumber: Name,
  issuedOn: Accounting.AccountingDate,
  dueOn: Accounting.AccountingDate,
  currency: Currency,
  amountMinor: PositiveMinor,
  controlAccountId: Accounting.Identifier,
  recognitionVoucherId: Accounting.Identifier,
  recognitionLineId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  description: Accounting.Description,
});

export const ReviseInvoice = Schema.Struct({
  expectedRevision: Version,
  dueOn: Accounting.AccountingDate,
  description: Accounting.Description,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const Recognition = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  eventId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
});

export const InvoiceRevision = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  revision: Version,
  dueOn: Accounting.AccountingDate,
  description: Accounting.Description,
  evidence: EvidenceReference,
  reason: Accounting.Description,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const InvoiceCancellationSummary = Schema.Struct({
  id: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  issueId: Accounting.Identifier,
  originalVoucherId: Accounting.Identifier,
  reversalVoucherId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  committedAt: Schema.String,
});

export const Invoice = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  kind: Schema.Literals(["synthetic_invoice_v1", "legal_customer_invoice_v1"]),
  legalIssueId: Schema.optional(Accounting.Identifier),
  policyId: Schema.optional(Accounting.Identifier),
  direction: Direction,
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Version,
  counterpartyName: Name,
  documentNumber: Name,
  issuedOn: Accounting.AccountingDate,
  currency: Currency,
  currencyScale: Schema.Int,
  amountMinor: PositiveMinor,
  controlAccountId: Accounting.Identifier,
  evidence: EvidenceReference,
  recognition: Recognition,
  supplierAcceptanceDigest: Schema.optional(Accounting.Digest),
  supplierAcceptanceProfile: Schema.optional(
    Schema.Literals([
      "synthetic-manual-supplier-v1",
      "synthetic-gross-cost-supplier-v1",
      "swedish-purchase-v1",
    ]),
  ),
  currentRevision: InvoiceRevision,
  allocationVersion: Accounting.MinorUnits,
  recordedAllocatedMinor: Accounting.MinorUnits,
  outstandingMinor: Schema.NullOr(Accounting.MinorUnits),
  status: Schema.Literals([
    "open",
    "partially_allocated",
    "allocated",
    "blocked",
    "cancelled",
    "partially_credited",
    "credited",
  ]),
  creditedMinor: Schema.optional(Accounting.MinorUnits),
  creditCount: Schema.optional(Accounting.MinorUnits),
  cancelledMinor: Schema.optional(Accounting.MinorUnits),
  effectiveAmountMinor: Schema.optional(Accounting.MinorUnits),
  cancellation: Schema.optional(Schema.NullOr(InvoiceCancellationSummary)),
  blockers: Schema.Array(Schema.String),
  issueOrigin: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        issueId: Accounting.Identifier,
        reviewId: Accounting.Identifier,
        draftId: Accounting.Identifier,
      }),
    ),
  ),
});

export const InvoicePage = Schema.Struct({
  items: Schema.Array(Invoice),
  next: Schema.NullOr(Accounting.Identifier),
});

export const SupplierInvoiceDuplicateQuery = Schema.Struct({
  counterpartyId: Accounting.Identifier,
  documentNumber: CreateInvoice.fields.documentNumber,
  evidenceId: Accounting.Identifier,
  after: Schema.optional(Accounting.Identifier),
});

export const SupplierInvoiceDuplicates = Schema.Struct({
  scope: Accounting.Scope,
  counterpartyId: Accounting.Identifier,
  documentNumber: CreateInvoice.fields.documentNumber,
  evidence: EvidenceReference,
  coverage: Schema.Literal("registered_supplier_invoices_only"),
  items: Schema.Array(
    Schema.Struct({
      invoice: Invoice,
      reasons: Schema.Array(
        Schema.Literals(["same_document_number", "same_original_evidence_content"]),
      ).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
    }),
  ).check(Schema.isMaxLength(50)),
  next: Schema.NullOr(Accounting.Identifier),
});

export const InvoiceHistory = Schema.Struct({
  items: Schema.Array(InvoiceRevision),
  next: Schema.NullOr(Version),
});

export const PaymentReference = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
});

export const PaymentCapacity = Schema.Struct({
  ...PaymentReference.fields,
  scope: Accounting.Scope,
  direction: Direction,
  accountId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  currency: Currency,
  currencyScale: Schema.Int,
  amountMinor: PositiveMinor,
  allocatedMinor: Accounting.MinorUnits,
  remainingMinor: Accounting.MinorUnits,
  capacityVersion: Accounting.MinorUnits,
});

export const PrepareAllocation = Schema.Struct({
  ...PaymentReference.fields,
  evidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
  allocations: Schema.Array(
    Schema.Struct({ invoiceId: Accounting.Identifier, amountMinor: PositiveMinor }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

export const AllocationLeg = Schema.Struct({
  invoiceId: Accounting.Identifier,
  revision: Version,
  allocationVersion: Accounting.MinorUnits,
  documentNumber: Name,
  counterpartyId: Accounting.Identifier,
  counterpartyName: Name,
  recognition: Recognition,
  evidence: EvidenceReference,
  outstandingBeforeMinor: Accounting.MinorUnits,
  amountMinor: PositiveMinor,
  outstandingAfterMinor: Accounting.MinorUnits,
});

export const AllocationPlan = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  profileVersion: Version,
  writerEpoch: Version,
  accountVersion: Version,
  paymentPeriodVersion: Version,
  payment: PaymentCapacity,
  evidence: EvidenceReference,
  rationale: Accounting.Description,
  legs: Schema.Array(AllocationLeg),
  totalMinor: PositiveMinor,
  paymentRemainingAfterMinor: Accounting.MinorUnits,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const ApproveAllocation = Schema.Struct({
  version: Schema.Literal(1),
  planDigest: Accounting.Digest,
});

export const ApplyAllocation = Schema.Struct({
  ...ApproveAllocation.fields,
  approvalId: Accounting.Identifier,
});

export const AllocationApproval = Schema.Struct({
  id: Accounting.Identifier,
  planId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  receipt: CommandReceipt,
});

export const AllocationReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  planId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  totalMinor: PositiveMinor,
  paymentRemainingMinor: Accounting.MinorUnits,
  committedAt: Schema.String,
  receipt: CommandReceipt,
});

export const AllocationView = Schema.Struct({
  plan: AllocationPlan,
  dependenciesCurrent: Schema.Boolean,
  approval: Schema.NullOr(AllocationApproval),
  application: Schema.NullOr(AllocationReceipt),
});

const PaymentPageNumber = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/));

export const InvoicePaymentsQuery = Schema.Struct({
  page: Schema.optional(PaymentPageNumber),
  historyPage: Schema.optional(PaymentPageNumber),
});

export const InvoicePaymentCandidate = Schema.Struct({
  payment: PaymentCapacity,
  voucherLabel: Schema.String,
  description: Schema.String,
  evidence: EvidenceReference,
  sourceTitle: Schema.String,
});

export const InvoicePayments = Schema.Struct({
  scope: Accounting.Scope,
  invoiceId: Accounting.Identifier,
  page: Schema.Int,
  historyPage: Schema.Int,
  pageSize: Schema.Literal(25),
  total: Schema.Int,
  historyTotal: Schema.Int,
  items: Schema.Array(InvoicePaymentCandidate),
  history: Schema.Array(
    Schema.Struct({
      planId: Accounting.Identifier,
      createdAt: Schema.String,
      postingDate: Accounting.AccountingDate,
      voucherLabel: Schema.String,
      amountMinor: PositiveMinor,
      status: Schema.Literals(["review", "matched", "released"]),
      receiptId: Schema.NullOr(Accounting.Identifier),
    }),
  ),
});

export const AfterQuery = Schema.Struct({ after: Schema.optional(Accounting.Identifier) });

export const RevisionQuery = Schema.Struct({ revision: Schema.optional(Version) });

export const HistoryQuery = Schema.Struct({ after: Schema.optional(Version) });

const path = "/v1/entities/:entityId/books/:bookId/commerce";

const scoped = { params: Accounting.Scope, error: accountingErrors };

const identified = { params: Accounting.ChangePath, error: accountingErrors };

const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };

const identifiedMutation = { ...identified, headers: Accounting.IdempotencyHeaders };

export const PaymentPath = Schema.Struct({
  ...Accounting.Scope.fields,
  ...PaymentReference.fields,
});

export const CommerceApi = HttpApiGroup.make("commerce").add(
  HttpApiEndpoint.post("commerceCreateCounterparty", `${path}/counterparties`, {
    ...mutation,
    payload: CreateCounterparty.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CounterpartyRevision,
  }),
  HttpApiEndpoint.post("commerceReviseCounterparty", `${path}/counterparties/:id/revisions`, {
    ...identifiedMutation,
    payload: ReviseCounterparty.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CounterpartyRevision,
  }),
  HttpApiEndpoint.get("commerceGetCounterparty", `${path}/counterparties/:id`, {
    ...identified,
    query: RevisionQuery,
    success: CounterpartyRevision,
  }),
  HttpApiEndpoint.get("commerceListCounterparties", `${path}/counterparties`, {
    ...scoped,
    query: AfterQuery,
    success: CounterpartyPage,
  }),
  HttpApiEndpoint.get("commerceSupplierInvoiceDuplicates", `${path}/supplier-invoice-duplicates`, {
    ...scoped,
    query: SupplierInvoiceDuplicateQuery.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierInvoiceDuplicates,
  }),
  HttpApiEndpoint.post("commerceCreateInvoice", `${path}/invoices`, {
    ...mutation,
    payload: CreateInvoice.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: Invoice,
  }),
  HttpApiEndpoint.post("commerceReviseInvoice", `${path}/invoices/:id/revisions`, {
    ...identifiedMutation,
    payload: ReviseInvoice.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: Invoice,
  }),
  HttpApiEndpoint.get("commerceGetInvoice", `${path}/invoices/:id`, {
    ...identified,
    success: Invoice,
  }),
  HttpApiEndpoint.get("commerceInvoiceHistory", `${path}/invoices/:id/revisions`, {
    ...identified,
    query: HistoryQuery,
    success: InvoiceHistory,
  }),
  HttpApiEndpoint.get("commerceInvoicePayments", `${path}/invoices/:id/payments`, {
    ...identified,
    query: InvoicePaymentsQuery,
    success: InvoicePayments,
  }),
  HttpApiEndpoint.get("commerceListInvoices", `${path}/invoices`, {
    ...scoped,
    query: AfterQuery,
    success: InvoicePage,
  }),
  HttpApiEndpoint.get(
    "commerceGetPaymentCapacity",
    `${path}/payments/:voucherId/lines/:lineId/capacity`,
    { params: PaymentPath, error: accountingErrors, success: PaymentCapacity },
  ),
  HttpApiEndpoint.post("commercePrepareAllocation", `${path}/allocation-plans`, {
    ...mutation,
    payload: PrepareAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AllocationPlan,
  }),
  HttpApiEndpoint.get("commerceGetAllocation", `${path}/allocation-plans/:id`, {
    ...identified,
    success: AllocationView,
  }),
  HttpApiEndpoint.post("commerceApproveAllocation", `${path}/allocation-plans/:id/approvals`, {
    ...identifiedMutation,
    payload: ApproveAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AllocationApproval,
  }),
  HttpApiEndpoint.post("commerceApplyAllocation", `${path}/allocation-plans/:id/apply`, {
    ...identifiedMutation,
    payload: ApplyAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AllocationReceipt,
  }),
);

const capabilityScope = { scope: Accounting.Scope };

const capabilityMutation = {
  ...capabilityScope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

const capabilityIdentified = { ...capabilityScope, id: Accounting.Identifier };

const capabilityIdentifiedMutation = { ...capabilityMutation, id: Accounting.Identifier };

export const CommerceCapabilities = {
  commerce_create_counterparty: {
    description:
      "Retain an evidence-backed synthetic counterpart identity. Does not verify legal identity.",
    input: Schema.Struct({ ...capabilityMutation, input: CreateCounterparty }),
    output: CounterpartyRevision,
    readOnly: false,
  },
  commerce_revise_counterparty: {
    description:
      "Append a counterpart name/evidence revision with exact prior version. Stable identity and role cannot change.",
    input: Schema.Struct({ ...capabilityIdentifiedMutation, input: ReviseCounterparty }),
    output: CounterpartyRevision,
    readOnly: false,
  },
  commerce_get_counterparty: {
    description: "Read a scoped counterpart revision; omit revision for the current head.",
    input: Schema.Struct({ ...capabilityIdentified, ...RevisionQuery.fields }),
    output: CounterpartyRevision,
    readOnly: true,
  },
  commerce_list_counterparties: {
    description: "Page through registered synthetic counterparties. Follow next until null.",
    input: Schema.Struct({ ...capabilityScope, ...AfterQuery.fields }),
    output: CounterpartyPage,
    readOnly: true,
  },
  commerce_supplier_invoice_duplicates: {
    description:
      "Inspect registered supplier invoices in this book with the same supplier and exact document number or original evidence content. Follow next until null with unchanged criteria. Candidates are diagnostics, not proof of duplication or permission to register; never merges, posts or checks unregistered sources.",
    input: Schema.Struct({ ...capabilityScope, ...SupplierInvoiceDuplicateQuery.fields }),
    output: SupplierInvoiceDuplicates,
    readOnly: true,
  },
  commerce_create_invoice: {
    description:
      "Register a synthetic invoice against one existing exact posted control line and retained original evidence. Never posts recognition again; no VAT determination.",
    input: Schema.Struct({ ...capabilityMutation, input: CreateInvoice }),
    output: Invoice,
    readOnly: false,
  },
  commerce_revise_invoice: {
    description:
      "Append invoice due-date, description and supporting-evidence revision. Economic identity, amount and recognition remain immutable.",
    input: Schema.Struct({ ...capabilityIdentifiedMutation, input: ReviseInvoice }),
    output: Invoice,
    readOnly: false,
  },
  commerce_get_invoice: {
    description:
      "Read an invoice and live conserved outstanding capacity. A blocked reference yields no authoritative outstanding amount.",
    input: Schema.Struct(capabilityIdentified),
    output: Invoice,
    readOnly: true,
  },
  commerce_invoice_history: {
    description: "Page through immutable invoice revisions. Follow next until null.",
    input: Schema.Struct({ ...capabilityIdentified, ...HistoryQuery.fields }),
    output: InvoiceHistory,
    readOnly: true,
  },
  commerce_invoice_payments: {
    description:
      "Page current posted payment candidates and matching history for one scoped invoice. Candidates do not establish payer identity or authorize allocation.",
    input: Schema.Struct({ ...capabilityIdentified, ...InvoicePaymentsQuery.fields }),
    output: InvoicePayments,
    readOnly: true,
  },
  commerce_list_invoices: {
    description:
      "Page registered invoices and open items, not a complete source inventory or control-account reconciliation.",
    input: Schema.Struct({ ...capabilityScope, ...AfterQuery.fields }),
    output: InvoicePage,
    readOnly: true,
  },
  commerce_get_payment_capacity: {
    description:
      "Inspect a posted control line eligible for allocation. It is not a bank observation or payment instruction.",
    input: Schema.Struct({ ...capabilityScope, ...PaymentReference.fields }),
    output: PaymentCapacity,
    readOnly: true,
  },
  commerce_prepare_allocation: {
    description:
      "Freeze a proposed partial/split payment-control-line allocation to invoice open items. Requires separate operator approval; never posts or initiates payment.",
    input: Schema.Struct({ ...capabilityMutation, input: PrepareAllocation }),
    output: AllocationPlan,
    readOnly: false,
  },
  commerce_get_allocation: {
    description:
      "Read a sealed allocation proposal, current freshness, operator approval and immutable application receipt.",
    input: Schema.Struct(capabilityIdentified),
    output: AllocationView,
    readOnly: true,
  },
  commerce_apply_allocation: {
    description:
      "Apply an exact operator-approved allocation atomically under current invoice and payment capacities. No ledger write or payment initiation.",
    input: Schema.Struct({ ...capabilityIdentifiedMutation, input: ApplyAllocation }),
    output: AllocationReceipt,
    readOnly: false,
  },
};
