import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Ar from "./ar-legal-issue";
import { accountingErrors } from "./accounting-errors";
import { CustomerJournalLines } from "@open-erp/domain/customer-credits";

const profile = Schema.Literal("se-domestic-b2b-sek-25-accrual-credit-v1");

const taxTreatment = Schema.Literal("se-domestic-standard-25-v1");

const legalNumber = Schema.String.check(
  Schema.isPattern(/^[A-Z][A-Z0-9-]{0,11}-[1-9][0-9]{0,17}$/),
);

const Totals = Schema.Struct({
  netMinor: Accounting.MinorUnits,
  taxMinor: Accounting.MinorUnits,
  grossMinor: Accounting.MinorUnits,
});

export const customerCreditRendererVersion = "openerp-se-credit-note-pdfcn-v1";

export const customerCreditRenderEvent = "customer_credit.render_requested.v1";

export const SelectedCreditLine = Schema.Struct({
  originalLineId: Accounting.Identifier,
  creditedNetMinor: Accounting.MinorUnits,
  creditedTaxMinor: Accounting.MinorUnits,
});

// The retained credit evidence is the economic decision identity of one legal credit.
// Two different request keys over the same retained decision are one credit, not two.
export const CustomerCreditDecisionIdentity = Schema.Struct({
  basis: Schema.Literal("retained_credit_evidence_v1"),
  evidenceId: Accounting.Identifier,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export const PrepareCustomerCredit = Schema.Struct({
  profile,
  originalLegalIssueId: Accounting.Identifier,
  originalIssueDigest: Accounting.Digest,
  accountingProfileId: Accounting.Identifier,
  accountingProfileDigest: Accounting.Digest,
  accountingPeriodId: Accounting.Identifier,
  voucherSeries: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  creditEvidenceId: Accounting.Identifier,
  creditDate: Accounting.AccountingDate,
  reason: Accounting.Description,
  selectedLines: Schema.Array(SelectedCreditLine).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  acknowledgeNoRefundOrCreditBalance: Schema.Literal(true),
  acknowledgeVatReturnConsequenceUnobserved: Schema.Literal(true),
});

export const ApproveCustomerCredit = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  acknowledgeLimitedProfile: Schema.Literal(true),
});

export const ExecuteCustomerCredit = Schema.Struct({
  ...ApproveCustomerCredit.fields,
  approvalId: Accounting.Identifier,
});

// One original recognition line's exact remaining credit capacity. Every amount is a
// canonical integer string and every remaining amount is a retained exact residual,
// never a recomputed approximation of what is left.
export const OriginalLineCreditCapacity = Schema.Struct({
  originalLineId: Accounting.Identifier,
  description: Schema.String,
  quantity: Schema.String,
  vatTreatment: taxTreatment,
  netMinor: Accounting.MinorUnits,
  taxMinor: Accounting.MinorUnits,
  grossMinor: Accounting.MinorUnits,
  priorCreditedNetMinor: Accounting.MinorUnits,
  priorCreditedTaxMinor: Accounting.MinorUnits,
  remainingNetMinor: Accounting.MinorUnits,
  remainingTaxMinor: Accounting.MinorUnits,
  remainingGrossMinor: Accounting.MinorUnits,
  // The qualified original rate and rounding contract re-applied to the remaining net.
  qualifiedTaxMinor: Accounting.MinorUnits,
  exhausted: Schema.Boolean,
});

export const CustomerCreditTotals = Schema.Struct({
  netMinor: Accounting.MinorUnits,
  taxMinor: Accounting.MinorUnits,
  grossMinor: Accounting.MinorUnits,
  priorCreditedNetMinor: Accounting.MinorUnits,
  priorCreditedTaxMinor: Accounting.MinorUnits,
  remainingNetMinor: Accounting.MinorUnits,
  remainingTaxMinor: Accounting.MinorUnits,
  remainingGrossMinor: Accounting.MinorUnits,
});

// The bounded path refuses paid-principal excess. It never invents a customer
// credit balance, so the unpaid capacity is exactly what the live receivable holds.
export const CustomerCreditUnpaidCapacity = Schema.Struct({
  registerInvoiceId: Accounting.Identifier,
  currency: Schema.String,
  currencyScale: Schema.Int,
  amountMinor: Accounting.MinorUnits,
  recordedAllocatedMinor: Accounting.MinorUnits,
  outstandingMinor: Accounting.MinorUnits,
  blocked: Schema.Boolean,
  status: Schema.String,
});

export const CustomerCreditTaxPeriod = Schema.Struct({
  accountingPeriodId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  qualifiedOn: Accounting.AccountingDate,
});

export const CustomerCreditRecognition = Schema.Struct({
  voucherId: Accounting.Identifier,
  controlLineId: Accounting.Identifier,
  eventId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  controlAccountId: Accounting.Identifier,
  revenueAccountId: Accounting.Identifier,
  outputVatAccountId: Accounting.Identifier,
  posted: Schema.Boolean,
});

export const CustomerCreditTaxWitness = Schema.Struct({
  treatment: taxTreatment,
  roundingMethod: Schema.Literal("line-tax-half-up-minor-v1"),
  ratePercent: Schema.Literals([25]),
  originalVoucherId: Accounting.Identifier,
  originalControlLineId: Accounting.Identifier,
  originalPostingDate: Accounting.AccountingDate,
  originalTaxPeriod: CustomerCreditTaxPeriod,
  // This credit workflow has not yet published or verified its VAT-return consequence.
  vatReturnOwner: Schema.Literal("not_released"),
  vatReturnConsequence: Schema.Literal("unobserved_pending_next_04"),
});

// The original-line credit capacity. This is the single reusable export a consumer
// needs to know how much of an issued legal invoice may still be credited.
export const CustomerCreditCapacity = Schema.Struct({
  scope: Accounting.Scope,
  originalLegalIssueId: Accounting.Identifier,
  originalIssueDigest: Accounting.Digest,
  originalDocumentNumber: legalNumber,
  originalIssuedOn: Accounting.AccountingDate,
  originalDocumentHash: Accounting.Digest,
  originalPolicyId: Accounting.Identifier,
  originalPolicyDigest: Accounting.Digest,
  accountingProfileId: Accounting.Identifier,
  accountingProfileDigest: Accounting.Digest,
  profile,
  lines: Schema.Array(OriginalLineCreditCapacity).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  totals: CustomerCreditTotals,
  unpaidCapacity: CustomerCreditUnpaidCapacity,
  taxPeriod: CustomerCreditTaxPeriod,
  recognition: CustomerCreditRecognition,
  taxWitness: CustomerCreditTaxWitness,
  creditCount: Schema.Int,
  completelyExhausted: Schema.Boolean,
  digest: Accounting.Digest,
});

export const CustomerCreditLine = Schema.Struct({
  originalLineId: Accounting.Identifier,
  description: Schema.String,
  quantity: Schema.String,
  vatTreatment: taxTreatment,
  remainingNetMinor: Accounting.MinorUnits,
  remainingTaxMinor: Accounting.MinorUnits,
  creditedNetMinor: Accounting.MinorUnits,
  creditedTaxMinor: Accounting.MinorUnits,
  creditedGrossMinor: Accounting.MinorUnits,
  // A credit that exhausts the line's remaining net carries the line's exact
  // remaining tax rather than a freshly recomputed one.
  finalLineCredit: Schema.Boolean,
  revenueLineId: Accounting.Identifier,
  outputVatLineId: Schema.NullOr(Accounting.Identifier),
});

// The negative tax effect of the credit. It is an owned, exact correction bound to
// the original recognition component; it is not a return and asserts no filing effect.
export const CustomerCreditTaxCorrection = Schema.Struct({
  id: Accounting.Identifier,
  ordinal: Schema.Int,
  originalLineId: Accounting.Identifier,
  originalVoucherId: Accounting.Identifier,
  originalControlLineId: Accounting.Identifier,
  originalPostingDate: Accounting.AccountingDate,
  originalEvidenceId: Accounting.Identifier,
  qualifiedTaxPeriod: CustomerCreditTaxPeriod,
  treatment: taxTreatment,
  baseMinor: Accounting.SignedMinorUnits,
  outputTaxMinor: Accounting.SignedMinorUnits,
  // Null while the credit is only reviewed: the issued voucher identity is bound when
  // the credit is committed inside the same transaction as this correction.
  creditVoucherId: Schema.NullOr(Accounting.Identifier),
  revenueLineId: Accounting.Identifier,
  outputVatLineId: Schema.NullOr(Accounting.Identifier),
  controlLineId: Schema.NullOr(Accounting.Identifier),
  vatReturnOwner: Schema.Literal("not_released"),
  vatReturnConsequence: Schema.Literal("unobserved_pending_next_04"),
});

export const CustomerCreditParty = Schema.Struct({
  legalName: Schema.String,
  registrationId: Schema.NullOr(Schema.String),
  taxId: Schema.NullOr(Schema.String),
  address: Schema.NullOr(Schema.String),
  countryCode: Schema.NullOr(Schema.String),
  evidenceId: Accounting.Identifier,
});

// The frozen legal document identity of the credit. Rendering reads this revision and
// never recalculates a total, a tax component or a reference from newer customer data.
export const CustomerCreditSemanticDocument = Schema.Struct({
  revision: Commerce.Version,
  kind: Schema.Literal("legal_customer_credit_note_v1"),
  profile,
  documentId: Accounting.Identifier,
  documentNumber: legalNumber,
  documentSeries: Schema.String,
  creditDate: Accounting.AccountingDate,
  creditId: Accounting.Identifier,
  originalLegalIssueId: Accounting.Identifier,
  originalDocumentNumber: legalNumber,
  originalDocumentHash: Accounting.Digest,
  originalIssuedOn: Accounting.AccountingDate,
  originalCreditNoteReference: Schema.NullOr(legalNumber),
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Commerce.Version,
  counterpartyName: Schema.String,
  currency: Schema.String,
  currencyScale: Schema.Int,
  reason: Accounting.Description,
  evidence: Commerce.EvidenceReference,
  seller: CustomerCreditParty,
  customer: CustomerCreditParty,
  lines: Schema.Array(CustomerCreditLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  totals: Totals,
  taxWitness: CustomerCreditTaxWitness,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});

export const RenderCustomerCreditArtifact = Schema.Struct({
  expectedDocumentDigest: Accounting.Digest,
  rendererVersion: Schema.Literal(customerCreditRendererVersion),
});

export const CustomerCreditArtifactDescriptor = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  creditId: Accounting.Identifier,
  documentId: Accounting.Identifier,
  documentRevision: Commerce.Version,
  documentDigest: Accounting.Digest,
  rendererVersion: Schema.Literal(customerCreditRendererVersion),
  mediaType: Schema.Literal("application/pdf"),
  filename: Schema.String,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 8, maximum: 2097152 })),
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  delivered: Schema.Literal(false),
});

export const CustomerCreditArtifact = Schema.Struct({
  ...CustomerCreditArtifactDescriptor.fields,
  contentBase64: Schema.String.check(Schema.isMaxLength(2796204)),
});

export const CustomerCreditRenderFailure = Schema.Struct({
  ordinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  code: Schema.Literals(["UnsupportedProfile", "Unavailable", "InternalError"]),
  failedAt: Schema.String,
});

export const CustomerCreditArtifactView = Schema.Struct({
  scope: Accounting.Scope,
  creditId: Accounting.Identifier,
  document: CustomerCreditSemanticDocument,
  state: Schema.Literals(["pending", "rendering_failed", "available"]),
  artifact: Schema.NullOr(CustomerCreditArtifactDescriptor),
  lastFailure: Schema.NullOr(CustomerCreditRenderFailure),
});

export const CustomerCreditReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  profile,
  ordinal: Schema.Int,
  input: PrepareCustomerCredit,
  originalSnapshot: Ar.ArLegalIssueReceipt,
  capacity: CustomerCreditCapacity,
  controlLineId: Accounting.Identifier,
  lines: Schema.Array(CustomerCreditLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  totals: Totals,
  creditSeries: Schema.String,
  creditEvidence: CustomerCreditDecisionIdentity,
  unpaidBeforeMinor: Accounting.MinorUnits,
  unpaidAfterMinor: Accounting.MinorUnits,
  taxCorrections: Schema.Array(CustomerCreditTaxCorrection).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  taxConsequenceObserved: Schema.Literal(false),
  postingPlan: Accounting.ChangeSet,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const CustomerCreditApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  ordinal: Schema.Int,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const CustomerCreditReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  profile,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  creditSeries: Schema.String,
  legalDocumentNumber: legalNumber,
  issuedOn: Accounting.AccountingDate,
  issuedAt: Schema.String,
  issued: Schema.Literal(true),
  legalCredit: Schema.Literal(true),
  recognized: Schema.Literal(true),
  originalLegalIssueId: Accounting.Identifier,
  originalIssueDigest: Accounting.Digest,
  originalDocumentNumber: legalNumber,
  originalDocumentHash: Accounting.Digest,
  originalIssuedOn: Accounting.AccountingDate,
  registerInvoiceId: Accounting.Identifier,
  lines: Schema.Array(CustomerCreditLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  totals: Totals,
  creditEvidence: CustomerCreditDecisionIdentity,
  unpaidBeforeMinor: Accounting.MinorUnits,
  unpaidAfterMinor: Accounting.MinorUnits,
  taxCorrections: Schema.Array(CustomerCreditTaxCorrection).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  taxConsequenceObserved: Schema.Literal(false),
  semanticDocument: CustomerCreditSemanticDocument,
  postingReceipt: Accounting.ExecutionReceipt,
  // Bytes are rendered afterwards from the retained semantic revision. Issuance never
  // repeats and never allocates a second number.
  artifactState: Schema.Literal("issued_artifact_pending"),
  refundState: Schema.Literal("not_refunded"),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const CustomerCreditView = Schema.Struct({
  review: CustomerCreditReview,
  approval: Schema.NullOr(CustomerCreditApproval),
  credit: Schema.NullOr(CustomerCreditReceipt),
  dependenciesCurrent: Schema.Boolean,
});

export const CustomerCreditHistoryItem = Schema.Struct({
  id: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  legalDocumentNumber: legalNumber,
  creditDate: Accounting.AccountingDate,
  totals: Totals,
  postedAt: Schema.String,
  voucherId: Accounting.Identifier,
  semanticDocumentDigest: Accounting.Digest,
  artifactState: Schema.Literal("issued_artifact_pending"),
  taxConsequenceObserved: Schema.Literal(false),
});

export const CustomerCreditHistory = Schema.Struct({
  scope: Accounting.Scope,
  originalLegalIssueId: Accounting.Identifier,
  originalDocumentNumber: legalNumber,
  complete: Schema.Literal(true),
  count: Schema.Int,
  items: Schema.Array(CustomerCreditHistoryItem).check(Schema.isMaxLength(50)),
});

// The credit's qualified tax period is a qualified input, so the capacity read names
// the accounting period and the credit date instead of choosing one.
export const CustomerCreditCapacityQuery = Schema.Struct({
  accountingProfileId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  creditDate: Accounting.AccountingDate,
});

const path = "/v1/entities/:entityId/books/:bookId/commerce";

const mutation = {
  params: Accounting.ChangePath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

// NEXT-30. A customer cash receipt names the customer, the cash amount and the
// explicit invoice legs; it states no remaining balances. The owner reads every
// leg's retained remaining, and the unallocated remainder becomes a
// customer-credit liability only with a qualified classification.
export const ReceiptLegInput = Schema.Struct({
  invoiceId: Accounting.Identifier,
  amountMinor: Accounting.SignedMinorUnits,
});

export const PrepareCustomerReceipt = Schema.Struct({
  customerId: Accounting.Identifier,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  cashMinor: Accounting.SignedMinorUnits,
  legs: Schema.Array(ReceiptLegInput).check(Schema.isMaxLength(50)),
  surplusClassification: Schema.NullOr(
    Schema.Literals(["refundable_overpayment", "unapplied_cash"]),
  ),
  bankAccountId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  receivableControlAccountId: Accounting.Identifier,
  creditLiabilityAccountId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  reason: Accounting.Description,
});

// Executing a prepared receipt re-derives the plan from retained rows and
// requires it to match the prepared digest, so a changed invoice remaining
// between preview and execution refuses rather than posting a stale split.
export const ExecuteCustomerReceipt = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  prepare: PrepareCustomerReceipt,
});

export const CustomerReceiptView = Schema.Struct({
  scope: Accounting.Scope,
  id: Accounting.Identifier,
  originId: Schema.NullOr(Accounting.Identifier),
  digest: Accounting.Digest,
  allocatedMinor: Accounting.SignedMinorUnits,
  creditOriginMinor: Accounting.SignedMinorUnits,
  journal: CustomerJournalLines,
  createdAt: Schema.String,
});

// Apply retained credit to a retained invoice, or refund it in cash. The
// origin, the remaining capacity and the destination are all read inside the
// transaction; the caller names them but states no amount.
export const ApplyCustomerCredit = Schema.Struct({
  originId: Accounting.Identifier,
  invoiceId: Accounting.Identifier,
  amountMinor: Accounting.SignedMinorUnits,
  evidenceId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  reason: Accounting.Description,
});

export const RefundCustomerCredit = Schema.Struct({
  originId: Accounting.Identifier,
  amountMinor: Accounting.SignedMinorUnits,
  cashAccountId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  reason: Accounting.Description,
});

export const CustomerCreditEffectView = Schema.Struct({
  scope: Accounting.Scope,
  id: Accounting.Identifier,
  originId: Accounting.Identifier,
  digest: Accounting.Digest,
  consumedMinor: Accounting.SignedMinorUnits,
  journal: CustomerJournalLines,
  createdAt: Schema.String,
});

export const CustomerCreditNotesApi = HttpApiGroup.make("customerCreditNotes").add(
  HttpApiEndpoint.get(
    "getCustomerCreditArtifactState",
    `${path}/customer-credit-notes/:id/artifact`,
    {
      params: Accounting.ChangePath,
      success: CustomerCreditArtifactView,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.post(
    "renderCustomerCreditArtifact",
    `${path}/customer-credit-notes/:id/artifact`,
    {
      ...mutation,
      payload: RenderCustomerCreditArtifact.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: CustomerCreditArtifactDescriptor,
    },
  ),
  HttpApiEndpoint.get("getCustomerCreditArtifact", `${path}/customer-credit-artifacts/:id`, {
    params: Accounting.ChangePath,
    success: CustomerCreditArtifact,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("prepareCustomerCredit", `${path}/customer-credit-reviews`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareCustomerCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CustomerCreditReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveCustomerCredit", `${path}/customer-credit-reviews/:id/approvals`, {
    ...mutation,
    payload: ApproveCustomerCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CustomerCreditApproval,
  }),
  HttpApiEndpoint.post("prepareCustomerReceipt", `${path}/customer-receipts`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareCustomerReceipt.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CustomerReceiptView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("executeCustomerReceipt", `${path}/customer-receipts/execute`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: ExecuteCustomerReceipt.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CustomerReceiptView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("applyCustomerCredit", `${path}/customer-credit-origins/:id/apply`, {
    params: Schema.Struct({
      entityId: Accounting.Identifier,
      bookId: Accounting.Identifier,
      id: Accounting.Identifier,
    }),
    headers: Accounting.IdempotencyHeaders,
    payload: ApplyCustomerCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CustomerCreditEffectView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("refundCustomerCredit", `${path}/customer-credit-origins/:id/refund`, {
    params: Schema.Struct({
      entityId: Accounting.Identifier,
      bookId: Accounting.Identifier,
      id: Accounting.Identifier,
    }),
    headers: Accounting.IdempotencyHeaders,
    payload: RefundCustomerCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CustomerCreditEffectView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getCustomerCreditOrigin", `${path}/customer-credit-origins/:id`, {
    params: Schema.Struct({
      entityId: Accounting.Identifier,
      bookId: Accounting.Identifier,
      id: Accounting.Identifier,
    }),
    success: CustomerReceiptView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("executeCustomerCredit", `${path}/customer-credit-reviews/:id/execute`, {
    ...mutation,
    payload: ExecuteCustomerCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CustomerCreditReceipt,
  }),
  HttpApiEndpoint.get("getCustomerCreditReview", `${path}/customer-credit-reviews/:id`, {
    params: Accounting.ChangePath,
    success: CustomerCreditView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getCustomerCreditCapacity", `${path}/ar-legal-issues/:id/credit-capacity`, {
    params: Accounting.ChangePath,
    query: CustomerCreditCapacityQuery,
    success: CustomerCreditCapacity,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("customerCreditHistory", `${path}/ar-legal-issues/:id/customer-credits`, {
    params: Accounting.ChangePath,
    success: CustomerCreditHistory,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getCustomerCreditDocument", `${path}/customer-credit-notes/:id`, {
    params: Accounting.ChangePath,
    success: CustomerCreditReceipt,
    error: accountingErrors,
  }),
);

export const CustomerCreditCapabilities = {
  commerce_get_customer_credit_artifact_state: {
    description:
      "Read the frozen credit document and current render state separately from its immutable financial receipt. No delivery, refund or VAT-return claim.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: CustomerCreditArtifactView,
    readOnly: true,
  },
  commerce_render_customer_credit_artifact: {
    description:
      "Render the exact retained credit revision and recover its immutable PDF artifact. Does not issue, number, post, refund or deliver a credit.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: RenderCustomerCreditArtifact,
    }),
    output: CustomerCreditArtifactDescriptor,
    readOnly: false,
  },
  commerce_get_customer_credit_artifact: {
    description:
      "Read scoped retained credit PDF bytes with their document revision, renderer version and content hash.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: CustomerCreditArtifact,
    readOnly: true,
  },
  commerce_get_customer_credit_capacity: {
    description:
      "Read the exact remaining per-line credit capacity of one issued legal customer invoice, its current unpaid receivable and its bound original recognition component.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      ...CustomerCreditCapacityQuery.fields,
    }),
    output: CustomerCreditCapacity,
    readOnly: true,
  },
  commerce_get_customer_credit_review: {
    description:
      "Read one reviewed legal customer credit, its approval and the exact issued credit with retained legal document identity and negative tax effects.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: CustomerCreditView,
    readOnly: true,
  },
  commerce_get_customer_credit: {
    description:
      "Read one issued legal customer credit note by its own identity, including the frozen semantic document revision and its exact negative tax corrections.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: CustomerCreditReceipt,
    readOnly: true,
  },
  commerce_customer_credit_history: {
    description:
      "Read the complete bounded legal credit history for one issued legal customer invoice together with its refreshed credit capacity.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: CustomerCreditHistory,
    readOnly: true,
  },
};
