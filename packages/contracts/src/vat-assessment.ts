import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors } from "./accounting-errors";

// VAT assessment ownership and exact-to-assessed bridge (NEXT-37). One sealed
// rounding target per reporting obligation, one human approval each, one assessment
// lifecycle per signed authority movement with adoption of already-posted compatible
// effects or atomic posting and matching. The pure bridge, capture and settlement-control math lives in
// @open-erp/domain/vat-assessment; this file is its wire shape.

import {
  AssessmentMode,
  AssessmentPlan,
  RoundingBridgePlan,
} from "@open-erp/domain/vat-assessment";

export { AssessmentMode, AssessmentPlan, RoundingBridgePlan };

export const PrepareRoundingBridge = Schema.Struct({
  returnId: Accounting.Identifier,
  settlementAccountId: Accounting.Identifier,
  gainAccountId: Accounting.Identifier,
  lossAccountId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const ApproveRoundingBridge = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const ExecuteRoundingBridge = Schema.Struct({
  ...ApproveRoundingBridge.fields,
  approvalId: Accounting.Identifier,
});

export const VatRoundingBridge = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  returnId: Accounting.Identifier,
  obligationId: Accounting.Identifier,
  exactNetMinor: Accounting.SignedMinorUnits,
  reportedNetMinor: Accounting.SignedMinorUnits,
  lineageMinor: Accounting.SignedMinorUnits,
  priorMinor: Accounting.SignedMinorUnits,
  roundingReleaseId: Accounting.Identifier,
  priorReceiptDigest: Schema.optional(Accounting.Digest),
  postingDate: Schema.optional(Accounting.AccountingDate),
  plan: RoundingBridgePlan,
  settlementAccountId: Accounting.Identifier,
  gainAccountId: Accounting.Identifier,
  lossAccountId: Accounting.Identifier,
  voucherId: Schema.NullOr(Accounting.Identifier),
  approvalId: Schema.NullOr(Accounting.Identifier),
  evidence: Commerce.EvidenceReference,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const RoundingBridgeApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  bridgeId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  ordinal: Schema.Int,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

// The operator's reviewed confirmations binding one authority event to one
// obligation. Period, entity and charge relationship are attested here with
// evidence, never inferred from an amount.
export const AssessmentConfirmations = Schema.Struct({
  registeredPeriod: Schema.Literal(true),
  legalEntity: Schema.Literal(true),
  chargeRelationship: Schema.Literal(true),
  confirmationEvidenceId: Accounting.Identifier,
});

export const PrepareAssessment = Schema.Struct({
  assessmentIdentity: Accounting.Identifier,
  returnId: Accounting.Identifier,
  authorityPeriod: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  assessedMinor: Accounting.SignedMinorUnits,
  // Retained for old clients; ignored as authority. The server derives this value.
  expectedRemainingMinor: Schema.optional(Accounting.SignedMinorUnits),
  taxAccountEventId: Accounting.Identifier,
  settlementAccountId: Accounting.Identifier,
  taxAccountControlId: Accounting.Identifier,
  adoptedVoucherId: Schema.NullOr(Accounting.Identifier),
  adoptedMatchId: Schema.NullOr(Accounting.Identifier),
  confirmations: AssessmentConfirmations,
  reason: Accounting.Description,
});

export const ApproveAssessment = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const ExecuteAssessment = Schema.Struct({
  ...ApproveAssessment.fields,
  approvalId: Accounting.Identifier,
});

export const VatAssessment = Schema.Struct({
  // Preparation identity: renewal uses a fresh ID/digest and approval while
  // retaining the authority identity below. Only a successful receipt consumes it.
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  assessmentIdentity: Accounting.Identifier,
  obligationId: Accounting.Identifier,
  returnId: Accounting.Identifier,
  authorityPeriod: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  plan: AssessmentPlan,
  assessedMinor: Accounting.SignedMinorUnits,
  expectedRemainingMinor: Accounting.SignedMinorUnits,
  taxAccountEventId: Accounting.Identifier,
  settlementAccountId: Accounting.Identifier,
  taxAccountControlId: Accounting.Identifier,
  voucherId: Schema.NullOr(Accounting.Identifier),
  approvalId: Schema.NullOr(Accounting.Identifier),
  confirmations: AssessmentConfirmations,
  evidence: Commerce.EvidenceReference,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
  movementMeaning: Schema.optional(Schema.Literal("signed_statement_movement")),
  sourceDigest: Schema.optional(Accounting.Digest),
  priorReceiptDigest: Schema.optional(Accounting.Digest),
});

export const AssessmentApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  assessmentId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  ordinal: Schema.Int,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  sourceDigest: Schema.optional(Accounting.Digest),
  priorReceiptDigest: Schema.optional(Accounting.Digest),
});

export const VatAssessmentStatus = Schema.Struct({
  scope: Accounting.Scope,
  returnId: Accounting.Identifier,
  exactNetMinor: Accounting.SignedMinorUnits,
  reportedNetMinor: Accounting.SignedMinorUnits,
  residualNetMinor: Accounting.SignedMinorUnits,
  bridgeDeltaTotalMinor: Accounting.SignedMinorUnits,
  assessedTotalMinor: Accounting.SignedMinorUnits,
  expectedSettlementMinor: Accounting.SignedMinorUnits,
  // Unique captured signed movements minus this return's reported book-minor
  // target, including pending movements. It is not a sum of successive residuals.
  pendingDifferenceTotalMinor: Accounting.SignedMinorUnits,
  discrepancy: Schema.Boolean,
  bridgeIds: Schema.Array(Accounting.Identifier),
  assessmentIds: Schema.Array(Accounting.Identifier),
  blockers: Schema.Array(Schema.String),
});

export const VatAssessmentHistory = Schema.Struct({
  scope: Accounting.Scope,
  returnId: Accounting.Identifier,
  complete: Schema.Literal(true),
  count: Schema.Int,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      kind: Schema.Literals(["bridge", "assessment"]),
      digest: Accounting.Digest,
      createdAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(100)),
});

const path = "/v1/entities/:entityId/books/:bookId/vat/assessments";

const mutation = {
  params: Accounting.ChangePath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

export const VatAssessmentApi = HttpApiGroup.make("vatAssessment").add(
  HttpApiEndpoint.post("prepareRoundingBridge", `${path}/bridges`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareRoundingBridge.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatRoundingBridge,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveRoundingBridge", `${path}/bridges/:id/approvals`, {
    ...mutation,
    payload: ApproveRoundingBridge.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RoundingBridgeApproval,
  }),
  HttpApiEndpoint.post("executeRoundingBridge", `${path}/bridges/:id/execute`, {
    ...mutation,
    payload: ExecuteRoundingBridge.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatRoundingBridge,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("prepareAssessment", `${path}/records`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareAssessment.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatAssessment,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveAssessment", `${path}/records/:id/approvals`, {
    ...mutation,
    payload: ApproveAssessment.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AssessmentApproval,
  }),
  HttpApiEndpoint.post("executeAssessment", `${path}/records/:id/execute`, {
    ...mutation,
    payload: ExecuteAssessment.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatAssessment,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getVatAssessmentStatus", `${path}/returns/:id/status`, {
    params: Accounting.ChangePath,
    success: VatAssessmentStatus,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("vatAssessmentHistory", `${path}/returns/:id/history`, {
    params: Accounting.ChangePath,
    success: VatAssessmentHistory,
    error: accountingErrors,
  }),
);

// All assessment mutations are operator-only. Ordinary MCP exposes reads only.
export const VatAssessmentCapabilities = {
  vat_get_assessment_status: {
    description:
      "Read the assessment status of one actual VAT return: exact, reported and residual net, bridge and assessment totals, the expected settlement control and any visible discrepancy. Not a filing or authority acceptance.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: VatAssessmentStatus,
    readOnly: true,
  },
  vat_assessment_history: {
    description:
      "Read the complete bounded bridge and assessment history of one actual VAT return.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: VatAssessmentHistory,
    readOnly: true,
  },
};
