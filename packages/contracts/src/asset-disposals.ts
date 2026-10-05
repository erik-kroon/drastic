import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Domain from "@open-erp/domain/asset-disposals";
import * as Accounting from "./accounting";
import * as Controls from "./subledger-controls";
import * as Subledgers from "./subledgers";
import * as Ar from "./ar-legal-issue";
import * as Bank from "./reconciliation";
import * as Settlement from "./settlements";
import * as Reversal from "./bank-match-reversals";
import * as Vat from "./vat-returns";
import { EvidenceReference, CommandReceipt } from "./commerce";
import { accountingErrors } from "./accounting-errors";

const financialInput = {
  profile: Schema.Literal("synthetic_asset_proceeds_v1"),
  postingDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  evidenceId: Accounting.Identifier,
  reviewEvidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
  acknowledgeSyntheticOnly: Schema.Literal(true),
};

export const ProceedsSelection = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("unposted_cash_sale"),
    statementId: Accounting.Identifier,
    rowOrdinal: Bank.RowOrdinal,
    outputVatAccountId: Accounting.Identifier,
    taxProfile: Schema.Literal("synthetic_domestic_standard_25_v1"),
    taxEvidenceId: Accounting.Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("existing_legal_invoice"),
    issueId: Accounting.Identifier,
    lineId: Accounting.Identifier,
    acknowledgeRevenueReclassification: Schema.Literal(true),
  }),
]);

export const PrepareDisposal = Schema.Struct({
  kind: Schema.Literal("disposal"),
  scheduleId: Accounting.Identifier,
  expectedDigest: Accounting.Digest,
  expectedBasisDigest: Accounting.Digest,
  gainAccountId: Accounting.Identifier,
  lossAccountId: Accounting.Identifier,
  proceeds: ProceedsSelection,
  ...financialInput,
});

export const PrepareCorrection = Schema.Struct({
  kind: Schema.Literal("error_correction"),
  disposalId: Accounting.Identifier,
  expectedDigest: Accounting.Digest,
  ...financialInput,
});

export const Prepare = Schema.Union([PrepareDisposal, PrepareCorrection]);

export const CashWitness = Schema.Struct({
  kind: Schema.Literal("unposted_cash_sale"),
  statementId: Accounting.Identifier,
  rowOrdinal: Bank.RowOrdinal,
  accountId: Accounting.Identifier,
  observedOn: Accounting.AccountingDate,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  grossMinor: Accounting.MinorUnits,
  netMinor: Accounting.MinorUnits,
  vatMinor: Accounting.MinorUnits,
  outputVatAccountId: Accounting.Identifier,
  sourceRevision: Accounting.MinorUnits,
  sourceHeadsDigest: Accounting.Digest,
  evidence: EvidenceReference,
  taxEvidence: EvidenceReference,
  proceedsIdentity: Domain.ProceedsIdentity,
});

export const InvoiceWitness = Schema.Struct({
  kind: Schema.Literal("existing_legal_invoice"),
  issue: Ar.ArLegalIssueReceipt,
  lineId: Accounting.Identifier,
  netMinor: Accounting.MinorUnits,
  vatMinor: Accounting.MinorUnits,
  grossMinor: Accounting.MinorUnits,
  revenueAccountId: Accounting.Identifier,
  proceedsIdentity: Domain.ProceedsIdentity,
});

export const ProceedsWitness = Schema.Union([CashWitness, InvoiceWitness]);

export const Review = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: Prepare,
  assetBasis: Controls.AssetDisposalBasis,
  proceeds: ProceedsWitness,
  domainPlan: Domain.DisposalPlan,
  correctionOf: Schema.NullOr(Accounting.Identifier),
  originalEffectDigest: Schema.NullOr(Accounting.Digest),
  bankReversal: Schema.NullOr(Reversal.BankMatchReversalPlan),
  evidence: Accounting.Evidence,
  postingPlan: Accounting.ChangeSet,
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
  legalPolicyApproved: Schema.Literal(false),
});

export const Approve = Controls.ApproveAssetDisposal;

export const Execute = Controls.ExecuteAssetDisposal;

export const Approval = Schema.Struct({
  ...Controls.AssetDisposalApproval.fields,
  bankReversalApproval: Schema.NullOr(Reversal.BankMatchReversalApproval),
  postingApproval: Accounting.Approval,
});

const effectFields = {
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  scheduleId: Accounting.Identifier,
  proceeds: ProceedsWitness,
  domainPlan: Domain.DisposalPlan,
  carryingMinor: Accounting.MinorUnits,
  futureRecognitionBlocked: Schema.Boolean,
  postingReceipt: Accounting.ExecutionReceipt,
  bankAllocation: Schema.NullOr(Settlement.BankAllocationExecution),
  bankReversal: Schema.NullOr(Reversal.BankMatchReversalExecution),
  vatFact: Schema.NullOr(Vat.VatFact),
  vatWithdrawal: Schema.NullOr(Vat.VatFactWithdrawal),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
  legalPolicyApproved: Schema.Literal(false),
};

export const DisposalEffect = Schema.Union([
  Schema.Struct({
    ...effectFields,
    kind: Schema.Literal("disposal"),
    correctionOf: Schema.Null,
    asset: Subledgers.AssetDisposal,
  }),
  Schema.Struct({
    ...effectFields,
    kind: Schema.Literal("error_correction"),
    correctionOf: Accounting.Identifier,
    asset: Schema.Null,
  }),
]);

export const View = Schema.Struct({
  review: Review,
  approvals: Schema.Array(Approval),
  effect: Schema.NullOr(DisposalEffect),
});

export const InvoiceSource = Schema.Struct({
  scope: Accounting.Scope,
  issue: Ar.ArLegalIssueReceipt,
  blocked: Schema.Boolean,
  claims: Schema.Array(
    Schema.Struct({
      lineId: Accounting.Identifier,
      effectId: Accounting.Identifier,
      reviewId: Accounting.Identifier,
      scheduleId: Accounting.Identifier,
      assetName: Accounting.Description,
      series: Schema.String,
      postingReceipt: Accounting.ExecutionReceipt,
    }),
  ),
});

export const ReviewPage = Schema.Struct({
  scope: Accounting.Scope,
  scheduleId: Accounting.Identifier,
  items: Schema.Array(Review),
  next: Schema.NullOr(Accounting.Identifier),
});

const path = "/v1/entities/:entityId/books/:bookId/asset-disposals";

const scoped = { params: Accounting.Scope, error: accountingErrors };

const identified = { params: Accounting.ChangePath, error: accountingErrors };

export const AssetDisposalsApi = HttpApiGroup.make("assetDisposals")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.get("listAssetProceedsDisposals", `${path}/for-schedule/:id`, {
      ...identified,
      query: Schema.Struct({ after: Schema.optional(Accounting.Identifier) }),
      success: ReviewPage,
    }),
    HttpApiEndpoint.get("getAssetDisposalInvoiceSource", `${path}/invoice-sources/:id`, {
      ...identified,
      success: InvoiceSource,
    }),
    HttpApiEndpoint.post("prepareAssetProceedsDisposal", `${path}/prepare`, {
      ...scoped,
      headers: Accounting.IdempotencyHeaders,
      payload: Prepare,
      success: Review,
    }),
    HttpApiEndpoint.post("approveAssetProceedsDisposal", `${path}/:id/approve`, {
      ...identified,
      headers: Accounting.IdempotencyHeaders,
      payload: Approve,
      success: Approval,
    }),
    HttpApiEndpoint.post("executeAssetProceedsDisposal", `${path}/:id/execute`, {
      ...identified,
      headers: Accounting.IdempotencyHeaders,
      payload: Execute,
      success: DisposalEffect,
    }),
    HttpApiEndpoint.get("getAssetProceedsDisposal", `${path}/:id`, {
      ...identified,
      success: View,
    }),
  );

const capabilityScope = { scope: Accounting.Scope };

const mutation = {
  ...capabilityScope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

export const AssetDisposalsCapabilities = {
  asset_disposals_prepare: {
    description:
      "Prepare exact synthetic asset disposal or immediate correction from retained source proceeds.",
    input: Schema.Struct({ ...mutation, input: Prepare }),
    output: Review,
    readOnly: false,
  },
  asset_disposals_execute: {
    description:
      "Execute an exact browser-approved disposal with atomic retirement, VAT and source rights.",
    input: Schema.Struct({ ...mutation, id: Accounting.Identifier, input: Execute }),
    output: DisposalEffect,
    readOnly: false,
  },
  asset_disposals_get: {
    description: "Read an exact synthetic asset disposal review, approvals and retained effect.",
    input: Schema.Struct({ ...capabilityScope, id: Accounting.Identifier }),
    output: View,
    readOnly: true,
  },
};
