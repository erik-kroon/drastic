import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors } from "./accounting-errors";

// Financial close and single-count carry-forward (NEXT-23). One sealed final
// proposal, one transfer delta, one certificate, one derived opening set and
// the year lock state commit in a single transaction. The pure transfer,
// proposal-sealing, opening-projection and conservation math lives in
// @open-erp/domain/financial-close; this file is its wire shape.

import {
  BalanceLine,
  FamilyControl,
  FinalProposal,
  TransferPlan,
} from "@open-erp/domain/financial-close";

export { BalanceLine, FamilyControl, FinalProposal, TransferPlan };

// Legacy supplemental evidence only. Applicability and complete current controls
// come from the closing inventory owner, never from these caller claims.
export const OtherFamilyClaim = Schema.Struct({
  familyId: Accounting.Identifier,
  applicability: Schema.Literal("not_applicable"),
  evidenceId: Accounting.Identifier,
});

export const PrepareYearClose = Schema.Struct({
  fiscalYearId: Accounting.Identifier,
  statementSnapshotId: Accounting.Identifier,
  bridgeId: Accounting.Identifier,
  nominalAccountId: Accounting.Identifier,
  equityAccountId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
  proposedAdjustmentRefs: Schema.Array(Commerce.EvidenceReference).check(Schema.isMaxLength(20)),
  adjustmentReceiptIds: Schema.optional(
    Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(20), Schema.isUnique()),
  ),
  otherFamilies: Schema.Array(OtherFamilyClaim).check(Schema.isMaxLength(20)),
});

export const AdvanceYearClose = Schema.Struct({
  version: Schema.Literal(1),
  preparationDigest: Accounting.Digest,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
});

export const ApproveFinalProposal = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const ExecuteFinalClose = Schema.Struct({
  ...ApproveFinalProposal.fields,
  approvalId: Accounting.Identifier,
});

export const ClosePreparation = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  fiscalYearId: Accounting.Identifier,
  input: PrepareYearClose,
  statementSnapshotId: Accounting.Identifier,
  statementDigest: Accounting.Digest,
  statementResultMinor: Accounting.SignedMinorUnits,
  bridgeId: Accounting.Identifier,
  bridgeDigest: Accounting.Digest,
  recognizedTaxMinor: Accounting.SignedMinorUnits,
  familyControls: Schema.Array(FamilyControl).check(Schema.isMaxLength(1000)),
  currentBasisDigest: Schema.optional(Accounting.Digest),
  taxEffectId: Schema.optional(Accounting.Identifier),
  taxReceiptId: Schema.optional(Accounting.Identifier),
  closeBasisVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  evidence: Commerce.EvidenceReference,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const FinalCloseProposal = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  preparationId: Accounting.Identifier,
  preparationDigest: Accounting.Digest,
  fiscalYearId: Accounting.Identifier,
  plan: FinalProposal,
  profitMinor: Accounting.SignedMinorUnits,
  priorTransferMinor: Accounting.SignedMinorUnits,
  transferJournal: Schema.Array(
    Schema.Struct({
      accountId: Accounting.Identifier,
      debitMinor: Accounting.MinorUnits,
      creditMinor: Accounting.MinorUnits,
      description: Accounting.Description,
    }),
  ).check(Schema.isMaxLength(2)),
  openingTarget: Schema.Array(BalanceLine).check(Schema.isMaxLength(500)),
  nominalAccountId: Accounting.Identifier,
  equityAccountId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const FinalProposalApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  proposalId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  ordinal: Schema.Int,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const FinancialCloseCertificate = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  proposalId: Accounting.Identifier,
  proposalDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  transferDeltaMinor: Accounting.SignedMinorUnits,
  transferVoucherId: Schema.NullOr(Accounting.Identifier),
  openingSetId: Accounting.Identifier,
  lockedPeriodIds: Schema.Array(Accounting.Identifier),
  evidence: Commerce.EvidenceReference,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const FinancialOpeningSet = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Int,
  fiscalYearId: Accounting.Identifier,
  certificateId: Accounting.Identifier,
  basisSnapshotId: Accounting.Identifier,
  supersedesId: Schema.NullOr(Accounting.Identifier),
  transferDeltaMinor: Accounting.SignedMinorUnits,
  rows: Schema.Array(BalanceLine).check(Schema.isMaxLength(500)),
  sourceBoundary: Schema.optional(Accounting.MinorUnits),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const FinancialTransfer = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  certificateId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  ordinal: Schema.Int,
  deltaMinor: Accounting.SignedMinorUnits,
  voucherId: Schema.NullOr(Accounting.Identifier),
  proposalId: Accounting.Identifier,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const PrepareYearReopen = Schema.Struct({
  certificateId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const ExecuteYearReopen = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  approvalId: Accounting.Identifier,
});

export const FinancialReopenProposal = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  certificateId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  reason: Accounting.Description,
  periodDigest: Accounting.Digest,
  periodIds: Schema.Array(Accounting.Identifier),
  downstreamRefusals: Schema.Array(Schema.String),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
  receipt: Commerce.CommandReceipt,
});

export const FinancialReopenEvent = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  proposalId: Schema.optional(Accounting.Identifier),
  approvalId: Schema.optional(Accounting.Identifier),
  status: Schema.optional(Schema.Literals(["executed", "refused"])),
  certificateId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  reason: Accounting.Description,
  downstreamRefusals: Schema.Array(Schema.String),
  unlockedPeriodIds: Schema.Array(Accounting.Identifier),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const FinancialYearStatus = Schema.Struct({
  scope: Accounting.Scope,
  fiscalYearId: Accounting.Identifier,
  status: Schema.Literals([
    "open",
    "preparing",
    "adjustments_pending",
    "ready_for_finalization",
    "closed",
  ]),
  preparationId: Schema.NullOr(Accounting.Identifier),
  proposalId: Schema.NullOr(Accounting.Identifier),
  certificateId: Schema.NullOr(Accounting.Identifier),
  reopened: Schema.Boolean,
  blockers: Schema.Array(Schema.String),
});

export const FinancialCloseHistory = Schema.Struct({
  scope: Accounting.Scope,
  fiscalYearId: Accounting.Identifier,
  complete: Schema.Literal(true),
  reopenings: Schema.optional(Schema.Array(FinancialReopenEvent)),
  preparations: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      digest: Accounting.Digest,
      createdAt: Schema.String,
      proposalId: Schema.NullOr(Accounting.Identifier),
      certificateId: Schema.NullOr(Accounting.Identifier),
    }),
  ),
});

const path = "/v1/entities/:entityId/books/:bookId/closing/financial-years";

const mutation = {
  params: Accounting.ChangePath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

export const FinancialCloseApi = HttpApiGroup.make("financialClose").add(
  HttpApiEndpoint.post("prepareYearClose", `${path}/preparations`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareYearClose.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ClosePreparation,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("advanceYearClose", `${path}/preparations/:id/final-proposal`, {
    ...mutation,
    payload: AdvanceYearClose.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FinalCloseProposal,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveFinalProposal", `${path}/proposals/:id/approvals`, {
    ...mutation,
    payload: ApproveFinalProposal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FinalProposalApproval,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("executeFinalClose", `${path}/proposals/:id/execute`, {
    ...mutation,
    payload: ExecuteFinalClose.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FinancialCloseCertificate,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("prepareYearReopen", `${path}/:fiscalYearId/reopen`, {
    params: Schema.Struct({
      ...Accounting.Scope.fields,
      fiscalYearId: Accounting.Identifier,
    }),
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareYearReopen.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FinancialReopenProposal,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveYearReopen", `${path}/reopen-proposals/:id/approvals`, {
    ...mutation,
    payload: ApproveFinalProposal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FinalProposalApproval,
  }),
  HttpApiEndpoint.post("executeYearReopen", `${path}/reopen-proposals/:id/execute`, {
    ...mutation,
    payload: ExecuteYearReopen.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FinancialReopenEvent,
  }),
  HttpApiEndpoint.get("getFinancialYearStatus", `${path}/:id/status`, {
    params: Accounting.ChangePath,
    success: FinancialYearStatus,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getFinancialCloseCertificate", `${path}/certificates/:id`, {
    params: Accounting.ChangePath,
    success: FinancialCloseCertificate,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getFinancialOpeningSet", `${path}/opening-sets/:id`, {
    params: Accounting.ChangePath,
    success: FinancialOpeningSet,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("financialCloseHistory", `${path}/:id/history`, {
    params: Accounting.ChangePath,
    success: FinancialCloseHistory,
    error: accountingErrors,
  }),
);

// All close mutations are operator-only. Ordinary MCP exposes reads only.
export const FinancialCloseCapabilities = {
  closing_get_financial_year_status: {
    description:
      "Read the derived financial-close status of one fiscal year with its current preparation, proposal, certificate and blockers. Not a filing or an audit opinion.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: FinancialYearStatus,
    readOnly: true,
  },
  closing_get_financial_close_certificate: {
    description:
      "Read one sealed financial-close certificate with its transfer delta, opening set and locked periods. Not a filing or an audit opinion.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: FinancialCloseCertificate,
    readOnly: true,
  },
  closing_get_financial_opening_set: {
    description:
      "Read one derived financial opening set with its retained balance-sheet rows and transfer delta. It creates no journal; old-year postings establish the balances.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: FinancialOpeningSet,
    readOnly: true,
  },
  closing_financial_close_history: {
    description:
      "Read the complete preparation history of one fiscal year, including superseded preparations and reopenings.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: FinancialCloseHistory,
    readOnly: true,
  },
};
