import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Drafts from "./invoice-drafts";
import * as Policy from "./legal-sales-policy";
import { accountingErrors } from "./accounting-errors";

const profile = Schema.Literal("se-domestic-b2b-sek-25-accrual-v1");
const EvidenceRef = Commerce.EvidenceReference;
export const ActivateArLegalAccountingProfile = Schema.Struct({
  policyId: Accounting.Identifier,
  policyDigest: Accounting.Digest,
  profile,
  accountingMethod: Schema.Literal("accrual"),
  ruleVersion: Schema.Literal("se-domestic-standard-25-2023-200-v1"),
  effectiveFrom: Accounting.AccountingDate,
  controlAccountId: Accounting.Identifier,
  revenueAccountId: Accounting.Identifier,
  outputVatAccountId: Accounting.Identifier,
  accountRoleEvidence: EvidenceRef,
  reason: Accounting.Description,
  acceptLegalAccounting: Schema.Literal(true),
});
export const ArLegalAccountingProfile = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  policyId: Accounting.Identifier,
  policyDigest: Accounting.Digest,
  input: ActivateArLegalAccountingProfile,
  status: Schema.Literal("active"),
  activatedBy: Accounting.Identifier,
  activatedAt: Schema.String,
  digest: Accounting.Digest,
});
const totals = Schema.Struct({
  netMinor: Accounting.AggregateMinorUnits,
  taxMinor: Accounting.AggregateMinorUnits,
  grossMinor: Accounting.AggregateMinorUnits,
});
const line = Schema.Struct({
  id: Accounting.Identifier,
  description: Schema.String,
  quantity: Drafts.DraftLine.fields.quantity,
  unitPriceMinor: Accounting.MinorUnits,
  baseMinor: Accounting.MinorUnits,
  discountMinor: Accounting.MinorUnits,
  chargeMinor: Accounting.MinorUnits,
  netMinor: Accounting.MinorUnits,
  taxMinor: Accounting.MinorUnits,
  grossMinor: Accounting.MinorUnits,
  vatTreatment: Schema.Literal("se-domestic-standard-25-v1"),
});
export const PrepareArLegalIssue = Schema.Struct({
  profile,
  draftId: Accounting.Identifier,
  expectedRevision: Commerce.Version,
  expectedDigest: Accounting.Digest,
  policyId: Accounting.Identifier,
  policyDigest: Accounting.Digest,
  accountingProfileId: Accounting.Identifier,
  accountingProfileDigest: Accounting.Digest,
  controlAccountId: Accounting.Identifier,
  revenueAccountId: Accounting.Identifier,
  outputVatAccountId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  voucherSeries: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  acknowledgeLimitedProfile: Schema.Literal(true),
});
export const ApproveArLegalIssue = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  acknowledgeLimitedProfile: Schema.Literal(true),
});
export const ExecuteArLegalIssue = Schema.Struct({
  ...ApproveArLegalIssue.fields,
  approvalId: Accounting.Identifier,
});
export const ArLegalIssueReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  profile,
  ordinal: Schema.Int,
  input: PrepareArLegalIssue,
  draftSnapshot: Drafts.InvoiceDraftRevision,
  policySnapshot: Policy.LegalSalesPolicy,
  accountingProfileSnapshot: ArLegalAccountingProfile,
  lines: Schema.Array(line).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  totals,
  fiscalYearId: Accounting.Identifier,
  sourceEvidence: Commerce.EvidenceReference,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const ArLegalIssueApproval = Schema.Struct({
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
export const ArLegalIssueReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  profile,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  draftId: Accounting.Identifier,
  draftRevision: Commerce.Version,
  draftDigest: Accounting.Digest,
  draftSnapshot: Drafts.InvoiceDraftRevision,
  policyId: Accounting.Identifier,
  policyDigest: Accounting.Digest,
  policySnapshot: Policy.LegalSalesPolicy,
  accountingProfileId: Accounting.Identifier,
  accountingProfileDigest: Accounting.Digest,
  accountingProfileSnapshot: ArLegalAccountingProfile,
  legalDocumentNumber: Schema.String.check(
    Schema.isPattern(/^[A-Z][A-Z0-9-]{0,11}-[1-9][0-9]{0,17}$/),
  ),
  issuedOn: Accounting.AccountingDate,
  issuedAt: Schema.String,
  issued: Schema.Literal(true),
  legalInvoice: Schema.Literal(true),
  recognized: Schema.Literal(true),
  delivered: Schema.Literal(false),
  totals,
  lines: Schema.Array(line).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  postingReceipt: Accounting.ExecutionReceipt,
  registerInvoiceId: Accounting.Identifier,
  sourceEvidence: Commerce.EvidenceReference,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const ArLegalIssueView = Schema.Struct({
  review: ArLegalIssueReview,
  approval: Schema.NullOr(ArLegalIssueApproval),
  issue: Schema.NullOr(ArLegalIssueReceipt),
  blockers: Schema.Array(Schema.String),
  approvalUsable: Schema.Boolean,
});
export const ArLegalIssueHistory = Schema.Struct({
  scope: Accounting.Scope,
  draftId: Accounting.Identifier,
  complete: Schema.Literal(true),
  count: Schema.Int,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      ordinal: Schema.Int,
      digest: Accounting.Digest,
      draftRevision: Commerce.Version,
      createdAt: Schema.String,
      issueId: Schema.NullOr(Accounting.Identifier),
      legalDocumentNumber: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(50)),
});
const path = "/v1/entities/:entityId/books/:bookId/commerce";
const mutation = {
  params: Accounting.ChangePath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};
export const ArLegalIssueApi = HttpApiGroup.make("arLegalIssue").add(
  HttpApiEndpoint.post("activateArLegalAccountingProfile", `${path}/ar-legal-accounting-profiles`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: ActivateArLegalAccountingProfile.annotate({
      parseOptions: { onExcessProperty: "error" },
    }),
    success: ArLegalAccountingProfile,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getArLegalAccountingProfile", `${path}/ar-legal-accounting-profiles/:id`, {
    params: Accounting.ChangePath,
    success: ArLegalAccountingProfile,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("prepareArLegalIssue", `${path}/ar-legal-issue-reviews`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareArLegalIssue.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ArLegalIssueReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveArLegalIssue", `${path}/ar-legal-issue-reviews/:id/approvals`, {
    ...mutation,
    payload: ApproveArLegalIssue.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ArLegalIssueApproval,
  }),
  HttpApiEndpoint.post("executeArLegalIssue", `${path}/ar-legal-issue-reviews/:id/execute`, {
    ...mutation,
    payload: ExecuteArLegalIssue.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ArLegalIssueReceipt,
  }),
  HttpApiEndpoint.get("getArLegalIssueReview", `${path}/ar-legal-issue-reviews/:id`, {
    params: Accounting.ChangePath,
    success: ArLegalIssueView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getArLegalIssue", `${path}/ar-legal-issues/:id`, {
    params: Accounting.ChangePath,
    success: ArLegalIssueReceipt,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("arLegalIssueHistory", `${path}/invoice-drafts/:id/ar-legal-issue-reviews`, {
    params: Accounting.ChangePath,
    success: ArLegalIssueHistory,
    error: accountingErrors,
  }),
);
export const ArLegalIssueCapabilities = {
  commerce_get_ar_legal_accounting_profile: {
    description:
      "Read the separately activated domestic accrual method and reviewed account roles for one legal policy.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: ArLegalAccountingProfile,
    readOnly: true,
  },
  commerce_get_ar_legal_issue_review: {
    description:
      "Read reviewed domestic B2B legal issue and exact accrual posting, approval and committed result.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: ArLegalIssueView,
    readOnly: true,
  },
  commerce_get_ar_legal_issue: {
    description:
      "Read a legally numbered issued domestic B2B invoice with exact receipt and undelivered status.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: ArLegalIssueReceipt,
    readOnly: true,
  },
  commerce_ar_legal_issue_history: {
    description:
      "Read complete bounded legal issue review history for a customer draft and recover its legal number.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: ArLegalIssueHistory,
    readOnly: true,
  },
};
