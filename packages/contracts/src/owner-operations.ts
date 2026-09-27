import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { FundingLegalForm, OwnerClassification } from "@open-erp/domain/owner-funding";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Profiles from "./company-profiles";
import * as Recognition from "./supplier-recognition";
import { accountingErrors } from "./accounting-errors";

// Owner-paid expenses, reimbursement and funding. The pure purchase calculation
// stays with the source-line purchase owner; this file is the wire shape of the
// five owner operation modes and the exact group each one posts.

export { FundingLegalForm, OwnerClassification };

// A reviewed per-source-line treatment of an owner-paid purchase. It is the same
// reviewed treatment the supplier-paid path uses, so the tax decision is the same
// decision whoever funded the purchase.
export const OwnerPurchaseLine = Schema.Struct({
  lineId: Accounting.Identifier,
  expenseAccountId: Accounting.Identifier,
  netMinor: Accounting.MinorUnits,
  sourceTaxMinor: Accounting.MinorUnits,
  treatment: Recognition.ReviewedTreatment,
});

// The reviewed source document facts an owner-paid purchase needs. Net and
// asserted tax are the document's own exact amounts; this operation never
// rewrites them, and a missing one is an explicit refusal rather than a default.
export const OwnerPurchaseSource = Schema.Struct({
  sourceEvidenceId: Accounting.Identifier,
  counterpartyId: Accounting.Identifier,
  supplierDocumentNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  documentDate: Accounting.AccountingDate,
  taxPoint: Recognition.DraftTaxPoint,
  lines: Schema.Array(OwnerPurchaseLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

const OwnerPaidEvidence = Schema.Struct({
  paidEvidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

const OwnerPayableEvidence = Schema.Struct({
  payableId: Accounting.Identifier,
  paidEvidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

const ReimbursementEvidence = Schema.Struct({
  cashEvidenceId: Accounting.Identifier,
  reason: Accounting.Description,
  allocations: Schema.Array(
    Schema.Struct({ claimId: Accounting.Identifier, amountMinor: Accounting.MinorUnits }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

const FundingEvidence = Schema.Struct({
  fundingEvidenceId: Accounting.Identifier,
  legalForm: FundingLegalForm,
  reason: Accounting.Description,
});

const commonFields = {
  ownerId: Accounting.Identifier,
  controlAccountId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
};

// The five owner operation modes. Every account is reviewed: the owner control
// account, the company cash account and the supplier payable are named here, and
// no account is inferred from a bank description, an owner identity or a document
// total. The input VAT account is not an input at all: it is the account the
// source-line purchase owner resolves for this book.
export const PrepareOwnerOperation = Schema.Union([
  Schema.Struct({
    ...commonFields,
    mode: Schema.Literal("owner_paid_purchase"),
    purchase: OwnerPurchaseSource,
    evidence: OwnerPaidEvidence,
  }),
  Schema.Struct({
    ...commonFields,
    mode: Schema.Literal("owner_pays_payable"),
    amountMinor: Accounting.MinorUnits,
    evidence: OwnerPayableEvidence,
  }),
  Schema.Struct({
    ...commonFields,
    mode: Schema.Literal("reimburse_owner"),
    cashAccountId: Accounting.Identifier,
    evidence: ReimbursementEvidence,
  }),
  Schema.Struct({
    ...commonFields,
    mode: Schema.Literal("owner_loan"),
    cashAccountId: Accounting.Identifier,
    amountMinor: Accounting.MinorUnits,
    evidence: FundingEvidence,
  }),
  Schema.Struct({
    ...commonFields,
    mode: Schema.Literal("owner_contribution"),
    cashAccountId: Accounting.Identifier,
    amountMinor: Accounting.MinorUnits,
    evidence: FundingEvidence,
  }),
]);

export type PrepareOwnerOperation = typeof PrepareOwnerOperation.Type;

export const OwnerOperationMode = Schema.Literals([
  "owner_paid_purchase",
  "owner_pays_payable",
  "reimburse_owner",
  "owner_loan",
  "owner_contribution",
]);

// The owner leg this operation will record: the control account, the exact signed
// side and the classification that decides what the company may later do with it.
// A contribution is never recorded as a reimbursable owner claim.
export const OwnerEffectIntent = Schema.Struct({
  accountId: Accounting.Identifier,
  side: Schema.Literals(["debit", "credit"]),
  classification: OwnerClassification,
  amountMinor: Accounting.MinorUnits,
});

export const OwnerOperationReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  mode: OwnerOperationMode,
  ownerId: Accounting.Identifier,
  ordinal: Schema.Int,
  input: PrepareOwnerOperation,
  postingPlan: Accounting.ChangeSet,
  controlLine: Schema.Struct({
    lineId: Accounting.Identifier,
    accountId: Accounting.Identifier,
    side: Schema.Literals(["debit", "credit"]),
  }),
  ownerEffect: OwnerEffectIntent,
  // Only the owner-paid purchase publishes tax components; the other four modes
  // move a liability or a funding leg and never create a tax fact.
  recognition: Schema.NullOr(
    Schema.Struct({
      economicKey: Recognition.EconomicDocumentKey,
      counterpartyId: Accounting.Identifier,
      supplierDocumentNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
      recognitionDate: Accounting.AccountingDate,
      taxPoint: Recognition.DraftTaxPoint,
      grossMinor: Accounting.MinorUnits,
      plan: Recognition.RecognitionPlan,
      ruleReleaseId: Schema.NullOr(Accounting.Identifier),
    }),
  ),
  reimburses: Schema.Array(
    Schema.Struct({ claimId: Accounting.Identifier, amountMinor: Accounting.MinorUnits }),
  ),
  discharges: Schema.NullOr(
    Schema.Struct({
      invoiceId: Accounting.Identifier,
      amountMinor: Accounting.MinorUnits,
      outstandingAfterMinor: Accounting.MinorUnits,
    }),
  ),
  evidence: Commerce.EvidenceReference,
  profileWitness: Schema.NullOr(Profiles.ProfileWitness),
  profileGaps: Schema.Array(Profiles.ProfileGap).check(Schema.isMaxLength(40)),
  changeSetId: Accounting.Identifier,
  eventId: Accounting.Identifier,
  digest: Accounting.Digest,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const ApproveOwnerOperation = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const OwnerOperationApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const ExecuteOwnerOperation = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  approvalId: Accounting.Identifier,
});

export const OwnerOperationReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  mode: OwnerOperationMode,
  ownerId: Accounting.Identifier,
  ownerRecordId: Accounting.Identifier,
  ownerEffectId: Accounting.Identifier,
  ownerClaimMinor: Accounting.MinorUnits,
  postingReceipt: Accounting.ExecutionReceipt,
  recognitionId: Schema.NullOr(Accounting.Identifier),
  taxFactIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(50)),
  reimburses: Schema.Array(
    Schema.Struct({ claimId: Accounting.Identifier, amountMinor: Accounting.MinorUnits }),
  ),
  dischargedInvoiceId: Schema.NullOr(Accounting.Identifier),
  committedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const OwnerOperationView = Schema.Struct({
  review: OwnerOperationReview,
  approval: Schema.NullOr(OwnerOperationApproval),
  result: Schema.NullOr(OwnerOperationReceipt),
  blockers: Schema.Array(Schema.String),
  dependenciesCurrent: Schema.Boolean,
  approvalUsable: Schema.Boolean,
});

export const OwnerPurchaseRecognition = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  eventOwner: Schema.Literal("owner_paid_purchase"),
  economicKey: Recognition.EconomicDocumentKey,
  ownerId: Accounting.Identifier,
  ownerRecordId: Accounting.Identifier,
  ownerEffectId: Accounting.Identifier,
  counterpartyId: Accounting.Identifier,
  supplierDocumentNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  currency: Schema.String,
  currencyScale: Schema.Int,
  recognitionDate: Accounting.AccountingDate,
  taxPoint: Recognition.DraftTaxPoint,
  grossMinor: Accounting.MinorUnits,
  deductibleTaxMinor: Accounting.MinorUnits,
  plan: Recognition.RecognitionPlan,
  voucherId: Accounting.Identifier,
  changeSetId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  profileWitness: Schema.NullOr(Profiles.ProfileWitness),
  recordedBy: Accounting.Identifier,
  recordedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const OwnerPurchaseRecognitionView = Schema.Struct({
  recognition: OwnerPurchaseRecognition,
  taxFacts: Schema.Array(Recognition.RecordedTaxFact).check(Schema.isMaxLength(50)),
});

const path = "/v1/entities/:entityId/books/:bookId/owner-operations";

export const OwnerOperationsApi = HttpApiGroup.make("ownerOperations").add(
  HttpApiEndpoint.post("ownersPrepareOperation", `${path}/reviews`, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: OwnerOperationReview,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareOwnerOperation.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.get("ownersGetOperation", `${path}/reviews/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: OwnerOperationView,
  }),
  HttpApiEndpoint.post("ownersApproveOperation", `${path}/reviews/:id/approvals`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: OwnerOperationApproval,
    headers: Accounting.IdempotencyHeaders,
    payload: ApproveOwnerOperation.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.post("ownersExecuteOperation", `${path}/reviews/:id/execute`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: OwnerOperationReceipt,
    headers: Accounting.IdempotencyHeaders,
    payload: ExecuteOwnerOperation.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.get("ownersGetPaidPurchase", `${path}/purchase-recognitions/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: OwnerPurchaseRecognitionView,
  }),
);

// The approval is an operator-only HTTP command: it is deliberately absent from
// this catalogue so no MCP or agent credential can mint an approval.
export const OwnerOperationCapabilities = {
  owners_prepare_operation: {
    description:
      "Seal one owner-paid expense, owner payment of an existing supplier payable, reimbursement, shareholder loan or capital contribution as a single exact financial group with its owner effect. Every amount, account, classification and evidence reference is a reviewed input; a missing one is a refusal, never a default. An owner-paid purchase of a document that already has a supplier recognition is compiled as the payable transfer instead of a second purchase, and an unresolved funding classification produces no financial plan. The owner-paid purchase reuses the qualified source-line purchase compiler, so the tax decision does not depend on who paid.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareOwnerOperation,
    }),
    output: OwnerOperationReview,
    readOnly: false,
  },
  owners_get_operation: {
    description:
      "Read the exact sealed owner group, its approval, its immutable receipt and the current blockers. A missing approval or an executed receipt is stated, not assumed.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: OwnerOperationView,
    readOnly: true,
  },
  owners_execute_operation: {
    description:
      "Commit one approved owner group: the journal, the owner effect, any reimbursement allocation, any supplier payable discharge and the owner-funded purchase recognition all commit together. A committed group is changed only by its own owner correction.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ExecuteOwnerOperation,
    }),
    output: OwnerOperationReceipt,
    readOnly: false,
  },
  owners_get_paid_purchase: {
    description:
      "Read one owner-funded purchase recognition with its exact signed input tax components. This is a purchase-owner record, not a VAT return, an assessment or a filing.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: OwnerPurchaseRecognitionView,
    readOnly: true,
  },
};
