import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Bank from "./reconciliation";
import * as Profiles from "./company-profiles";
import * as AllocationReversal from "./commerce-allocation-reversals";
import * as MatchReversal from "./bank-match-reversals";
import * as Corrections from "./corrections";
import { accountingErrors } from "./accounting-errors";

export const PrepareSupplierSettlement = Schema.Struct({
  invoiceId: Accounting.Identifier,
  statementId: Accounting.Identifier,
  rowOrdinal: Bank.RowOrdinal,
  rationale: Accounting.Description,
  evidence: Commerce.EvidenceReference,
});

export const ApproveSupplierSettlement = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const RevokeSupplierSettlementApproval = Schema.Struct({ reason: Accounting.Description });

export const SupplierSettlementBasis = Schema.Struct({
  invoice: Commerce.Invoice,
  source: Bank.StatementSource,
  statementId: Accounting.Identifier,
  sourceEvidence: Commerce.EvidenceReference,
  observation: Bank.BankRow,
  sourceRevision: Accounting.MinorUnits,
  profileWitness: Profiles.ProfileWitness,
  profileVersion: Accounting.MinorUnits,
  writerEpoch: Accounting.MinorUnits,
  periodId: Accounting.Identifier,
  periodVersion: Accounting.MinorUnits,
  fiscalYearId: Accounting.Identifier,
  series: Schema.String,
  accounts: Schema.Array(
    Schema.Struct({ id: Accounting.Identifier, version: Accounting.MinorUnits }),
  ),
});

const retained = {
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
};

export const SupplierSettlementPlan = Schema.Struct({
  ...retained,
  profile: Schema.Literal("synthetic-supplier-settlement-accrual-v1"),
  input: PrepareSupplierSettlement,
  basis: SupplierSettlementBasis,
  amountMinor: Accounting.MinorUnits,
  paymentPlan: Accounting.ChangeSet,
  actionDigest: Accounting.Digest,
  reservedVoucherId: Accounting.Identifier,
  controlLineId: Accounting.Identifier,
  bankLineId: Accounting.Identifier,
  pendingAllocation: Commerce.AllocationPlan,
});

export const SupplierSettlementApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  planId: Accounting.Identifier,
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  paymentApprovalId: Accounting.Identifier,
  allocationApprovalId: Accounting.Identifier,
  receipt: Commerce.CommandReceipt,
});

export const SupplierSettlementApprovalRevocation = Schema.Struct({
  approvalId: Accounting.Identifier,
  actorId: Accounting.Identifier,
  reason: Accounting.Description,
  revokedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const SupplierSettlementView = Schema.Struct({
  plan: SupplierSettlementPlan,
  approval: Schema.NullOr(SupplierSettlementApproval),
  pendingBasisCurrent: Schema.Boolean,
  approvalUsable: Schema.Boolean,
  paymentPosted: Schema.Boolean,
  executionAvailable: Schema.Boolean,
});

export const ExecuteSupplierSettlement = Schema.Struct({
  ...ApproveSupplierSettlement.fields,
  approvalId: Accounting.Identifier,
});

export const SupplierSettlementReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  planId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  digest: Accounting.Digest,
  amountMinor: Accounting.MinorUnits,
  outstandingAfterMinor: Accounting.MinorUnits,
  postingReceipt: Accounting.ExecutionReceipt,
  allocationReceipt: Commerce.AllocationReceipt,
  match: Bank.BankMatch,
  committedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const PrepareSupplierSettlementCancellation = Schema.Struct({
  settlementReceiptId: Accounting.Identifier,
  reason: Accounting.Description,
  evidence: Commerce.EvidenceReference,
});

export const SupplierSettlementCancellationPlan = Schema.Struct({
  ...retained,
  input: PrepareSupplierSettlementCancellation,
  original: SupplierSettlementReceipt,
  originalPlan: SupplierSettlementPlan,
  invoice: Commerce.Invoice,
  profileWitness: Profiles.ProfileWitness,
  paymentPlan: Accounting.ChangeSet,
  allocationReversal: AllocationReversal.CommerceAllocationReversalPlan,
  matchReversal: MatchReversal.BankMatchReversalPlan,
  impactResources: Schema.optionalKey(Schema.Array(Corrections.CorrectionImpactResource)),
});

export const SupplierSettlementCancellationApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  planId: Accounting.Identifier,
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  paymentApprovalId: Accounting.Identifier,
  allocationApprovalId: Accounting.Identifier,
  matchApprovalId: Accounting.Identifier,
  receipt: Commerce.CommandReceipt,
});

export const SupplierSettlementCancellationReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  planId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  digest: Accounting.Digest,
  settlementReceiptId: Accounting.Identifier,
  postingReceipt: Accounting.ExecutionReceipt,
  allocationReversal: AllocationReversal.CommerceAllocationReversalExecution,
  matchReversal: MatchReversal.BankMatchReversalExecution,
  outstandingAfterMinor: Accounting.MinorUnits,
  committedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const SupplierSettlementReceiptView = Schema.Struct({
  receipt: SupplierSettlementReceipt,
  state: Schema.Literals(["settled", "cancelled_unresolved_original_movement"]),
  sourceReusable: Schema.Literal(false),
  cancellation: Schema.NullOr(SupplierSettlementCancellationReceipt),
});

export const SupplierSettlementDiscovery = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      kind: Schema.Literals(["settlement", "cancellation"]),
      receiptId: Schema.NullOr(Accounting.Identifier),
    }),
  ),
  next: Schema.NullOr(Accounting.Identifier),
});

export const SupplierSettlementCancellationView = Schema.Struct({
  plan: SupplierSettlementCancellationPlan,
  receipt: Schema.NullOr(SupplierSettlementCancellationReceipt),
});

const path = "/v1/entities/:entityId/books/:bookId/purchases";

const identified = { params: Accounting.ChangePath, error: accountingErrors };

const mutation = {
  params: Accounting.Scope,
  error: accountingErrors,
  headers: Accounting.IdempotencyHeaders,
};

const identifiedMutation = { ...identified, headers: Accounting.IdempotencyHeaders };

const strict = { parseOptions: { onExcessProperty: "error" as const } };

export const SupplierSettlementsApi = HttpApiGroup.make("supplierSettlements")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.get("listSupplierSettlements", `${path}/supplier-settlements`, {
      params: Accounting.Scope,
      error: accountingErrors,
      query: Schema.Struct({ after: Schema.optionalKey(Accounting.Identifier) }),
      success: SupplierSettlementDiscovery,
    }),
    HttpApiEndpoint.get(
      "getSupplierSettlementCancellation",
      `${path}/supplier-settlement-cancellation-plans/:id`,
      { ...identified, success: SupplierSettlementCancellationView },
    ),
    HttpApiEndpoint.post("prepareSupplierSettlement", `${path}/supplier-settlement-plans`, {
      ...mutation,
      payload: PrepareSupplierSettlement.annotate(strict),
      success: SupplierSettlementPlan,
    }),
    HttpApiEndpoint.get("getSupplierSettlement", `${path}/supplier-settlement-plans/:id`, {
      ...identified,
      success: SupplierSettlementView,
    }),
    HttpApiEndpoint.post(
      "approveSupplierSettlement",
      `${path}/supplier-settlement-plans/:id/approvals`,
      {
        ...identifiedMutation,
        payload: ApproveSupplierSettlement.annotate(strict),
        success: SupplierSettlementApproval,
      },
    ),
    HttpApiEndpoint.post(
      "revokeSupplierSettlementApproval",
      `${path}/supplier-settlement-approvals/:id/revoke`,
      {
        ...identifiedMutation,
        payload: RevokeSupplierSettlementApproval.annotate(strict),
        success: SupplierSettlementApprovalRevocation,
      },
    ),
    HttpApiEndpoint.post(
      "executeSupplierSettlement",
      `${path}/supplier-settlement-plans/:id/execute`,
      {
        ...identifiedMutation,
        payload: ExecuteSupplierSettlement,
        success: SupplierSettlementReceipt,
      },
    ),
    HttpApiEndpoint.get(
      "getSupplierSettlementReceipt",
      `${path}/supplier-settlement-receipts/:id`,
      {
        ...identified,
        success: SupplierSettlementReceiptView,
      },
    ),
    HttpApiEndpoint.post(
      "prepareSupplierSettlementCancellation",
      `${path}/supplier-settlement-cancellation-plans`,
      {
        ...mutation,
        payload: PrepareSupplierSettlementCancellation,
        success: SupplierSettlementCancellationPlan,
      },
    ),
    HttpApiEndpoint.post(
      "approveSupplierSettlementCancellation",
      `${path}/supplier-settlement-cancellation-plans/:id/approvals`,
      {
        ...identifiedMutation,
        payload: ApproveSupplierSettlement,
        success: SupplierSettlementCancellationApproval,
      },
    ),
    HttpApiEndpoint.post(
      "executeSupplierSettlementCancellation",
      `${path}/supplier-settlement-cancellation-plans/:id/execute`,
      {
        ...identifiedMutation,
        payload: ExecuteSupplierSettlement,
        success: SupplierSettlementCancellationReceipt,
      },
    ),
    HttpApiEndpoint.post(
      "revokeSupplierSettlementCancellationApproval",
      `${path}/supplier-settlement-cancellation-approvals/:id/revoke`,
      {
        ...identifiedMutation,
        payload: RevokeSupplierSettlementApproval.annotate(strict),
        success: SupplierSettlementApprovalRevocation,
      },
    ),
  );

export const SupplierSettlementCapabilities = {
  purchases_list_supplier_settlements: {
    description:
      "Discover retained settlement and cancellation plans with scoped live ID pagination. This is not a frozen inventory or execution permission.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      after: Schema.optionalKey(Accounting.Identifier),
    }),
    output: SupplierSettlementDiscovery,
    readOnly: true,
  },
  purchases_get_supplier_settlement_cancellation: {
    description:
      "Recover a retained cancellation plan and its exact committed receipt without executing it.",
    input: Schema.Struct({ scope: Accounting.Scope, planId: Accounting.Identifier }),
    output: SupplierSettlementCancellationView,
    readOnly: true,
  },
  purchases_prepare_supplier_settlement: {
    description:
      "Prepare a prospective accrued supplier payment from retained invoice and whole bank debit. Independent approval is required before execution.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareSupplierSettlement,
    }),
    output: SupplierSettlementPlan,
    readOnly: false,
  },
  purchases_get_supplier_settlement: {
    description:
      "Read prospective supplier payment basis and approval. The view distinguishes pending approval from posted payment.",
    input: Schema.Struct({ scope: Accounting.Scope, planId: Accounting.Identifier }),
    output: SupplierSettlementView,
    readOnly: true,
  },
  purchases_execute_supplier_settlement: {
    description:
      "Execute an independently approved accrued payment atomically with matching and allocation.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      planId: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ExecuteSupplierSettlement,
    }),
    output: SupplierSettlementReceipt,
    readOnly: false,
  },

  purchases_get_supplier_settlement_receipt: {
    description:
      "Read settlement and full cancellation state while preserving original source lineage.",
    input: Schema.Struct({ scope: Accounting.Scope, receiptId: Accounting.Identifier }),
    output: SupplierSettlementReceiptView,
    readOnly: true,
  },

  purchases_prepare_supplier_settlement_cancellation: {
    description:
      "Prepare latest same-open-period full cancellation of an observed accrued payment.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareSupplierSettlementCancellation,
    }),
    output: SupplierSettlementCancellationPlan,
    readOnly: false,
  },

  purchases_execute_supplier_settlement_cancellation: {
    description: "Execute independently approved allocation, match and journal inverses together.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      planId: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ExecuteSupplierSettlement,
    }),
    output: SupplierSettlementCancellationReceipt,
    readOnly: false,
  },
};
