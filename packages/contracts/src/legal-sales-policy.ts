import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Policy from "./invoice-policy";
import { accountingErrors } from "./accounting-errors";

const EvidenceRef = Schema.Struct({
  evidenceId: Accounting.Identifier,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
export const ActivateLegalSalesPolicy = Schema.Struct({
  candidateId: Accounting.Identifier,
  candidateDigest: Accounting.Digest,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  series: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9-]{0,11}$/)),
  ruleVersion: Schema.Literal("se-domestic-standard-25-2023-200-v1"),
  sourceEvidence: EvidenceRef,
  activationEvidence: EvidenceRef,
  reason: Accounting.Description,
  acceptReviewedPolicy: Schema.Literal(true),
  acknowledgeIssueBlocked: Schema.Literal(true),
});
export const LegalSalesPolicy = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  candidate: Policy.InvoicePolicyCandidate,
  review: Policy.InvoicePolicyReview,
  input: ActivateLegalSalesPolicy,
  activatedBy: Accounting.Identifier,
  activatedAt: Schema.String,
  status: Schema.Literal("active"),
  legalInvoiceEnabled: Schema.Literal(false),
  creditEnabled: Schema.Literal(false),
  deliveryEnabled: Schema.Literal(false),
  digest: Accounting.Digest,
});
export const LegalSalesPolicyHistory = Schema.Struct({
  scope: Accounting.Scope,
  complete: Schema.Literal(true),
  items: Schema.Array(LegalSalesPolicy).check(Schema.isMaxLength(50)),
});
const path = "/v1/entities/:entityId/books/:bookId/commerce/legal-sales-policies";
export const LegalSalesPolicyApi = HttpApiGroup.make("legalSalesPolicies").add(
  HttpApiEndpoint.post("activateLegalSalesPolicy", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: ActivateLegalSalesPolicy.annotate({ parseOptions: { onExcessProperty: "error" } }),
    error: accountingErrors,
    success: LegalSalesPolicy,
  }),
  HttpApiEndpoint.get("legalSalesPolicyHistory", path, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: LegalSalesPolicyHistory,
  }),
  HttpApiEndpoint.get("getLegalSalesPolicy", `${path}/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: LegalSalesPolicy,
  }),
);
export const LegalSalesPolicyCapabilities = {
  commerce_legal_sales_policy_history: {
    description: "Read complete bounded legal seller policy activation history, with issuance and delivery blocked.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: LegalSalesPolicyHistory,
    readOnly: true,
  },
  commerce_get_legal_sales_policy: {
    description: "Read a reviewed seller, numbering and domestic standard-rate policy. Issuance, credit and external delivery remain blocked.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: LegalSalesPolicy,
    readOnly: true,
  },
};
