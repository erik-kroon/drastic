import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

const Provenance = Schema.Struct({
  evidenceId: Accounting.Identifier,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
const PolicyText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));
export const InvoicePolicyCandidateInput = Schema.Struct({
  profileKey: Accounting.Identifier,
  sellerIdentity: Schema.Struct({
    legalName: PolicyText,
    registrationNumber: PolicyText,
    vatRegistrationNumber: Schema.NullOr(PolicyText),
    postalAddress: PolicyText,
    countryCode: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
  }),
  sellerEvidence: Provenance,
  legalNumbering: PolicyText,
  numberingEvidence: Provenance,
  vatTreatment: PolicyText,
  vatEvidence: Provenance,
  roundingMethod: PolicyText,
  roundingEvidence: Provenance,
  creditNotePolicy: PolicyText,
  correctionPolicy: PolicyText,
  correctionEvidence: Provenance,
  effectiveFrom: Accounting.AccountingDate,
  reason: Accounting.Description,
  acknowledgeUnactivated: Schema.Literal(true),
});
export const InvoicePolicyCandidate = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: InvoicePolicyCandidateInput,
  status: Schema.Literal("unactivated"),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});
export const ReviewInvoicePolicy = Schema.Struct({
  candidateDigest: Accounting.Digest,
  reviewEvidence: Provenance,
  findings: PolicyText,
  acknowledgeNoLegalActivation: Schema.Literal(true),
});
export const InvoicePolicyReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  candidateId: Accounting.Identifier,
  input: ReviewInvoicePolicy,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  status: Schema.Literal("reviewed_unactivated"),
  legalInvoiceEnabled: Schema.Literal(false),
  digest: Accounting.Digest,
});
export const InvoicePolicyView = Schema.Struct({
  candidate: InvoicePolicyCandidate,
  review: Schema.NullOr(InvoicePolicyReview),
  legalInvoiceEnabled: Schema.Literal(false),
});
export const InvoicePolicyHistory = Schema.Struct({
  scope: Accounting.Scope,
  complete: Schema.Literal(true),
  items: Schema.Array(InvoicePolicyView).check(Schema.isMaxLength(50)),
});
const path = "/v1/entities/:entityId/books/:bookId/commerce/invoice-policies";
export const InvoicePolicyApi = HttpApiGroup.make("invoicePolicies").add(
  HttpApiEndpoint.post("saveInvoicePolicyCandidate", path, {
    params: Accounting.Scope,
    error: accountingErrors,
    headers: Accounting.IdempotencyHeaders,
    payload: InvoicePolicyCandidateInput.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoicePolicyCandidate,
  }),
  HttpApiEndpoint.post("reviewInvoicePolicyCandidate", `${path}/:id/review`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    headers: Accounting.IdempotencyHeaders,
    payload: ReviewInvoicePolicy.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoicePolicyReview,
  }),
  HttpApiEndpoint.get("getInvoicePolicyCandidate", `${path}/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: InvoicePolicyView,
  }),
  HttpApiEndpoint.get("invoicePolicyHistory", path, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: InvoicePolicyHistory,
  }),
);
export const InvoicePolicyCapabilities = {
  commerce_get_invoice_policy_candidate: {
    description:
      "Read source-backed proposed seller/numbering/VAT/rounding/credit policy and independent review. Never an active legal invoice profile.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoicePolicyView,
    readOnly: true,
  },
  commerce_invoice_policy_history: {
    description:
      "Read all bounded proposed invoice policies. No proposal authorizes legal issuance or delivery.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: InvoicePolicyHistory,
    readOnly: true,
  },
};
