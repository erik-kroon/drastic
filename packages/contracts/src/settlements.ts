import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import * as Bank from "./reconciliation";

export const AllocationLeg = Schema.Struct({
  statementId: Accounting.Identifier,
  rowOrdinal: Bank.RowOrdinal,
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  amountMinor: Schema.String.check(Schema.isPattern(/^-?[1-9][0-9]{0,37}$/)),
});
export const PrepareBankAllocation = Schema.Struct({
  accountId: Accounting.Identifier,
  reason: Accounting.Description,
  ambiguityAcknowledged: Schema.Literal(true),
  legs: Schema.Array(AllocationLeg).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
export const AllocationVersions = Schema.Struct({
  profileVersion: Accounting.MinorUnits,
  writerEpoch: Accounting.MinorUnits,
  accountVersion: Accounting.MinorUnits,
  sourceRevision: Accounting.MinorUnits,
  accountLedgerSequence: Accounting.MinorUnits,
});
export const AllocationCapacity = Schema.Struct({
  leg: AllocationLeg,
  sourceAmountMinor: Accounting.SignedMinorUnits,
  sourceAllocatedMinor: Accounting.SignedMinorUnits,
  lineAmountMinor: Accounting.SignedMinorUnits,
  lineAllocatedMinor: Accounting.SignedMinorUnits,
  evidenceId: Accounting.Identifier,
  evidenceSha256: Schema.String,
  providerId: Schema.NullOr(Schema.String),
  sourceBankAccountId: Schema.String,
  observedOn: Accounting.AccountingDate,
  postedOn: Accounting.AccountingDate,
  candidateCount: Schema.Int,
});
export const BankAllocationPlan = Schema.Struct({
  id: Accounting.Identifier,
  version: Schema.Literal(1),
  scope: Accounting.Scope,
  currency: Schema.String,
  currencyScale: Schema.Int,
  input: PrepareBankAllocation,
  snapshot: Schema.Struct({
    versions: AllocationVersions,
    capacities: Schema.Array(AllocationCapacity),
  }),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
  receipt: Bank.CommandReceipt,
});
export const ApproveBankAllocation = Schema.Struct({
  digest: Accounting.Digest,
  version: Schema.Literal(1),
});
export const BankAllocationApproval = Schema.Struct({
  ...ApproveBankAllocation.fields,
  id: Accounting.Identifier,
  planId: Accounting.Identifier,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  receipt: Bank.CommandReceipt,
});
export const ExecuteBankAllocation = Schema.Struct({
  ...ApproveBankAllocation.fields,
  approvalId: Accounting.Identifier,
});
export const AllocatedLeg = Schema.Struct({
  ...AllocationLeg.fields,
  planId: Accounting.Identifier,
  ordinal: Schema.Int,
});
export const BankAllocationExecution = Schema.Struct({
  ...ExecuteBankAllocation.fields,
  planId: Accounting.Identifier,
  scope: Accounting.Scope,
  accountId: Accounting.Identifier,
  currency: Schema.String,
  currencyScale: Schema.Int,
  legs: Schema.Array(AllocatedLeg),
  executedAt: Schema.String,
  receipt: Bank.CommandReceipt,
});
export const BankAllocationView = Schema.Struct({
  plan: BankAllocationPlan,
  approval: Schema.NullOr(BankAllocationApproval),
  execution: Schema.NullOr(BankAllocationExecution),
  dependenciesCurrent: Schema.Boolean,
  unmatch: Schema.optionalKey(Schema.NullOr(Schema.Struct({
    planId: Accounting.Identifier,
    executedAt: Schema.String,
    reason: Accounting.Description,
  }))),
});
export const SourceCapacity = Schema.Struct({
  ...Bank.SourceObservation.fields,
  allocatedMinor: Accounting.SignedMinorUnits,
  remainingMinor: Accounting.SignedMinorUnits,
});
export const LedgerCapacity = Schema.Struct({
  ...Bank.BankLedgerLine.fields,
  allocatedMinor: Accounting.SignedMinorUnits,
  remainingMinor: Accounting.SignedMinorUnits,
});
export const BankCapacityReconciliation = Schema.Struct({
  ...Bank.BankReconciliation.fields,
  schemaVersion: Schema.Literal("bank-capacity-v2"),
  currencyScale: Schema.Int,
  sourceRows: Schema.Array(SourceCapacity),
  ledgerLines: Schema.Array(LedgerCapacity),
  unmatchedSource: Schema.Array(SourceCapacity),
  unmatchedLedger: Schema.Array(LedgerCapacity),
  allocations: Schema.Array(AllocatedLeg),
});
export const BankCapacityReconciliationView = Schema.Struct({
  ...Bank.BankReconciliationView.fields,
  report: BankCapacityReconciliation,
});

const path = "/v1/entities/:entityId/books/:bookId";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };
const identifiedMutation = { ...identified, headers: Accounting.IdempotencyHeaders };
export const SettlementsApi = HttpApiGroup.make("settlements").add(
  HttpApiEndpoint.post("prepareBankAllocation", `${path}/bank-allocation-plans`, {
    ...mutation,
    payload: PrepareBankAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankAllocationPlan,
  }),
  HttpApiEndpoint.get("getBankAllocation", `${path}/bank-allocation-plans/:id`, {
    ...identified,
    success: BankAllocationView,
  }),
  HttpApiEndpoint.post("approveBankAllocation", `${path}/bank-allocation-plans/:id/approve`, {
    ...identifiedMutation,
    payload: ApproveBankAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankAllocationApproval,
  }),
  HttpApiEndpoint.post("executeBankAllocation", `${path}/bank-allocation-plans/:id/execute`, {
    ...identifiedMutation,
    payload: ExecuteBankAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankAllocationExecution,
  }),
  HttpApiEndpoint.post("reconcileBankCapacity", `${path}/bank-capacity-reconciliations`, {
    ...mutation,
    payload: Bank.ReconcileBank.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankCapacityReconciliation,
  }),
  HttpApiEndpoint.get(
    "getBankCapacityReconciliation",
    `${path}/bank-capacity-reconciliations/:id`,
    {
      ...identified,
      success: BankCapacityReconciliationView,
    },
  ),
);

const capabilityScope = { scope: Accounting.Scope };
const capabilityMutation = {
  ...capabilityScope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};
// Approval remains operator-only REST, outside the ordinary agent tool registry.
export const SettlementCapabilities = {
  bank_prepare_allocation: {
    description:
      "Prepare explicit partial or many-to-many bank matching legs with frozen capacities and ambiguity diagnostics. No posting or invoice settlement.",
    input: Schema.Struct({ ...capabilityMutation, input: PrepareBankAllocation }),
    output: BankAllocationPlan,
    readOnly: false,
  },
  bank_get_allocation: {
    description:
      "Read an exact bank allocation plan, current dependency status, operator approval and durable execution receipt.",
    input: Schema.Struct({ ...capabilityScope, planId: Accounting.Identifier }),
    output: BankAllocationView,
    readOnly: true,
  },
  bank_execute_allocation: {
    description:
      "Execute an exactly approved bank matching plan atomically, conserving source and posted-line capacities. Never posts or marks invoices paid.",
    input: Schema.Struct({
      ...capabilityMutation,
      planId: Accounting.Identifier,
      input: ExecuteBankAllocation,
    }),
    output: BankAllocationExecution,
    readOnly: false,
  },
  bank_reconcile_capacity: {
    description:
      "Save an immutable whole-statement bank reconciliation including partial allocation residuals and source coverage gaps.",
    input: Schema.Struct({ ...capabilityMutation, input: Bank.ReconcileBank }),
    output: BankCapacityReconciliation,
    readOnly: false,
  },
  bank_get_capacity_reconciliation: {
    description:
      "Read an immutable bank capacity reconciliation and compare its source and account-ledger revisions to the current book.",
    input: Schema.Struct({ ...capabilityScope, reconciliationId: Accounting.Identifier }),
    output: BankCapacityReconciliationView,
    readOnly: true,
  },
};
