import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Bank from "./reconciliation";
import * as Profiles from "./company-profiles";
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
  paymentPosted: Schema.Literal(false),
  executionAvailable: Schema.Literal(false),
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

export const SupplierSettlementsApi = HttpApiGroup.make("supplierSettlements").add(
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
);

export const SupplierSettlementCapabilities = {
  purchases_prepare_supplier_settlement: {
    description:
      "Prepare a prospective accrued supplier payment from retained invoice and whole bank debit. This slice cannot execute it.",
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
      "Read prospective supplier payment basis and approval. No posted payment or final allocation capacity exists.",
    input: Schema.Struct({ scope: Accounting.Scope, planId: Accounting.Identifier }),
    output: SupplierSettlementView,
    readOnly: true,
  },
};
