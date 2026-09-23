import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import * as Bank from "./reconciliation";
import * as Settlement from "./settlements";

export const BankMatchReversalTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("allocation"), allocationPlanId: Accounting.Identifier }),
  Schema.Struct({
    kind: Schema.Literal("exact_match"),
    statementId: Accounting.Identifier,
    rowOrdinal: Bank.RowOrdinal,
  }),
]);
export const PrepareBankMatchReversal = Schema.Struct({
  target: BankMatchReversalTarget,
  reason: Accounting.Description,
});
export const ReleasedCapacity = Schema.Struct({
  leg: Settlement.AllocationLeg,
  evidenceId: Accounting.Identifier,
  evidenceSha256: Schema.String,
  observedOn: Accounting.AccountingDate,
  postedOn: Accounting.AccountingDate,
  sourceAmountMinor: Accounting.SignedMinorUnits,
  sourceAllocatedMinor: Accounting.SignedMinorUnits,
  lineAmountMinor: Accounting.SignedMinorUnits,
  lineAllocatedMinor: Accounting.SignedMinorUnits,
});
export const BankMatchReversalPlan = Schema.Struct({
  id: Accounting.Identifier,
  version: Schema.Literal(1),
  scope: Accounting.Scope,
  input: PrepareBankMatchReversal,
  snapshot: Schema.Struct({
    accountId: Accounting.Identifier,
    original: Schema.Union([Bank.BankMatch, Settlement.BankAllocationExecution]),
    legs: Schema.Array(Settlement.AllocationLeg),
    periods: Schema.Array(Schema.Struct({ id: Accounting.Identifier, version: Accounting.MinorUnits })),
    versions: Settlement.AllocationVersions,
    capacities: Schema.Array(ReleasedCapacity),
  }),
  currency: Schema.String,
  currencyScale: Schema.Int,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
  receipt: Bank.CommandReceipt,
});
export const ApproveBankMatchReversal = Settlement.ApproveBankAllocation;
export const BankMatchReversalApproval = Settlement.BankAllocationApproval;
export const ExecuteBankMatchReversal = Settlement.ExecuteBankAllocation;
export const BankMatchReversalExecution = Schema.Struct({
  ...ExecuteBankMatchReversal.fields,
  planId: Accounting.Identifier,
  scope: Accounting.Scope,
  target: BankMatchReversalTarget,
  reason: Accounting.Description,
  accountId: Accounting.Identifier,
  releasedLegs: Schema.Array(Settlement.AllocationLeg),
  sourceRevision: Accounting.MinorUnits,
  executedAt: Schema.String,
  receipt: Bank.CommandReceipt,
});
export const RevokeBankMatchReversalApproval = Schema.Struct({ reason: Accounting.Description });
export const BankMatchReversalRevocation = Schema.Struct({
  approvalId: Accounting.Identifier,
  reason: Accounting.Description,
  actorId: Accounting.Identifier,
  revokedAt: Schema.String,
  receipt: Bank.CommandReceipt,
});
export const BankMatchReversalView = Schema.Struct({
  plan: BankMatchReversalPlan,
  approval: Schema.NullOr(BankMatchReversalApproval),
  execution: Schema.NullOr(BankMatchReversalExecution),
  dependenciesCurrent: Schema.Boolean,
});
export const BankMatchReversalList = Schema.Struct({
  items: Schema.Array(Schema.Struct({
    id: Accounting.Identifier,
    target: BankMatchReversalTarget,
    reason: Accounting.Description,
    createdAt: Schema.String,
    execution: Schema.NullOr(BankMatchReversalExecution),
  })),
  next: Schema.NullOr(Accounting.Identifier),
});

const path = "/v1/entities/:entityId/books/:bookId";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };
const identifiedMutation = { ...identified, headers: Accounting.IdempotencyHeaders };
export const BankMatchReversalsApi = HttpApiGroup.make("bankMatchReversals").add(
  HttpApiEndpoint.post("prepareBankMatchReversal", `${path}/bank-match-reversal-plans`, {
    ...mutation,
    payload: PrepareBankMatchReversal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankMatchReversalPlan,
  }),
  HttpApiEndpoint.get("listBankMatchReversals", `${path}/bank-match-reversal-plans`, {
    ...scoped,
    query: Schema.Struct({ after: Schema.optionalKey(Accounting.Identifier) }),
    success: BankMatchReversalList,
  }),
  HttpApiEndpoint.get("getBankMatchReversal", `${path}/bank-match-reversal-plans/:id`, {
    ...identified,
    success: BankMatchReversalView,
  }),
  HttpApiEndpoint.post("approveBankMatchReversal", `${path}/bank-match-reversal-plans/:id/approve`, {
    ...identifiedMutation,
    payload: ApproveBankMatchReversal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankMatchReversalApproval,
  }),
  HttpApiEndpoint.post("executeBankMatchReversal", `${path}/bank-match-reversal-plans/:id/execute`, {
    ...identifiedMutation,
    payload: ExecuteBankMatchReversal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankMatchReversalExecution,
  }),
  HttpApiEndpoint.post("revokeBankMatchReversalApproval", `${path}/bank-match-reversal-approvals/:id/revoke`, {
    ...identifiedMutation,
    payload: RevokeBankMatchReversalApproval.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankMatchReversalRevocation,
  }),
);
const capabilityScope = { scope: Accounting.Scope };
const capabilityMutation = {
  ...capabilityScope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};
// Human approval and revocation are intentionally absent from ordinary MCP.
export const BankMatchReversalCapabilities = {
  bank_prepare_match_reversal: {
    description: "Prepare an immutable whole-allocation or exact unmatch for human review. No ledger or invoice change.",
    input: Schema.Struct({ ...capabilityMutation, input: PrepareBankMatchReversal }),
    output: BankMatchReversalPlan,
    readOnly: false,
  },
  bank_get_match_reversal: {
    description: "Read a saved unmatch plan, current authority and its durable reversal receipt.",
    input: Schema.Struct({ ...capabilityScope, planId: Accounting.Identifier }),
    output: BankMatchReversalView,
    readOnly: true,
  },
  bank_list_match_reversals: {
    description: "Discover retained unmatch plans and receipts in this book. Live identifier pages are not a complete source inventory.",
    input: Schema.Struct({ ...capabilityScope, after: Schema.optionalKey(Accounting.Identifier) }),
    output: BankMatchReversalList,
    readOnly: true,
  },
  bank_execute_match_reversal: {
    description: "Execute an exactly human-approved unmatch once. Releases matching capacity while preserving every original relationship.",
    input: Schema.Struct({ ...capabilityMutation, planId: Accounting.Identifier, input: ExecuteBankMatchReversal }),
    output: BankMatchReversalExecution,
    readOnly: false,
  },
};
