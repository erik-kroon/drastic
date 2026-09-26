import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import * as Commerce from "./commerce";

export const PrepareCommerceAllocationReversal = Schema.Struct({
  receiptId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const ReleasedCommerceLeg = Schema.Struct({
  ordinal: Schema.Int,
  invoiceId: Accounting.Identifier,
  paymentVoucherId: Accounting.Identifier,
  paymentLineId: Accounting.Identifier,
  amountMinor: Accounting.MinorUnits,
});

export const CommerceAllocationReversalPlan = Schema.Struct({
  id: Accounting.Identifier,
  version: Schema.Literal(1),
  scope: Accounting.Scope,
  input: PrepareCommerceAllocationReversal,
  snapshot: Schema.Struct({
    original: Commerce.AllocationReceipt,
    originalPlan: Commerce.AllocationPlan,
    legs: Schema.Array(ReleasedCommerceLeg),
    invoices: Schema.Array(
      Schema.Struct({
        invoice: Commerce.Invoice,
        releasedMinor: Accounting.MinorUnits,
        outstandingAfterMinor: Accounting.MinorUnits,
      }),
    ),
    payment: Commerce.PaymentCapacity,
    paymentRemainingAfterMinor: Accounting.MinorUnits,
    periods: Schema.Array(
      Schema.Struct({
        id: Accounting.Identifier,
        version: Accounting.MinorUnits,
        locked: Schema.Literal(false),
      }),
    ),
    account: Schema.Struct({ id: Accounting.Identifier, version: Accounting.MinorUnits }),
    profileVersion: Accounting.MinorUnits,
    writerEpoch: Accounting.MinorUnits,
  }),
  currency: Schema.String,
  currencyScale: Schema.Int,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
  receipt: Commerce.CommandReceipt,
});

export const ApproveCommerceAllocationReversal = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const CommerceAllocationReversalApproval = Schema.Struct({
  ...ApproveCommerceAllocationReversal.fields,
  id: Accounting.Identifier,
  planId: Accounting.Identifier,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const ExecuteCommerceAllocationReversal = Schema.Struct({
  ...ApproveCommerceAllocationReversal.fields,
  approvalId: Accounting.Identifier,
});

export const CommerceAllocationReversalExecution = Schema.Struct({
  ...ExecuteCommerceAllocationReversal.fields,
  planId: Accounting.Identifier,
  scope: Accounting.Scope,
  receiptId: Accounting.Identifier,
  reason: Accounting.Description,
  releasedLegs: Schema.Array(ReleasedCommerceLeg),
  totalMinor: Accounting.MinorUnits,
  ledgerChanged: Schema.Literal(false),
  paymentInitiated: Schema.Literal(false),
  executedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const RevokeCommerceAllocationReversalApproval = Schema.Struct({
  reason: Accounting.Description,
});

export const CommerceAllocationReversalRevocation = Schema.Struct({
  approvalId: Accounting.Identifier,
  reason: Accounting.Description,
  actorId: Accounting.Identifier,
  revokedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const CommerceAllocationReversalView = Schema.Struct({
  plan: CommerceAllocationReversalPlan,
  approval: Schema.NullOr(CommerceAllocationReversalApproval),
  execution: Schema.NullOr(CommerceAllocationReversalExecution),
  dependenciesCurrent: Schema.Boolean,
  approvals: Schema.Array(
    Schema.Struct({
      approval: CommerceAllocationReversalApproval,
      revocation: Schema.NullOr(CommerceAllocationReversalRevocation),
    }),
  ),
});

export const CommerceAllocationReversalList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      receiptId: Accounting.Identifier,
      reason: Accounting.Description,
      createdAt: Schema.String,
      execution: Schema.NullOr(CommerceAllocationReversalExecution),
    }),
  ),
  next: Schema.NullOr(Accounting.Identifier),
});

export const CommerceAllocationStatus = Schema.Struct({
  original: Commerce.AllocationReceipt,
  active: Schema.Boolean,
  reversal: Schema.NullOr(CommerceAllocationReversalExecution),
  plans: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      createdAt: Schema.String,
      reason: Accounting.Description,
    }),
  ),
});

export const CommerceRegisterAllocationStatus = Schema.Struct({
  reportId: Accounting.Identifier,
  allocationDependenciesCurrent: Schema.Boolean,
  historicalSnapshotUnchanged: Schema.Literal(true),
  otherDependenciesChecked: Schema.Literal(false),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce";

const scoped = { params: Accounting.Scope, error: accountingErrors };

const identified = { params: Accounting.ChangePath, error: accountingErrors };

const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };

const identifiedMutation = { ...identified, headers: Accounting.IdempotencyHeaders };

export const CommerceAllocationReversalsApi = HttpApiGroup.make("commerceAllocationReversals").add(
  HttpApiEndpoint.post("prepareCommerceAllocationReversal", `${path}/allocation-reversal-plans`, {
    ...mutation,
    payload: PrepareCommerceAllocationReversal.annotate({
      parseOptions: { onExcessProperty: "error" },
    }),
    success: CommerceAllocationReversalPlan,
  }),
  HttpApiEndpoint.get("listCommerceAllocationReversals", `${path}/allocation-reversal-plans`, {
    ...scoped,
    query: Schema.Struct({ after: Schema.optionalKey(Accounting.Identifier) }),
    success: CommerceAllocationReversalList,
  }),
  HttpApiEndpoint.get("getCommerceAllocationReversal", `${path}/allocation-reversal-plans/:id`, {
    ...identified,
    success: CommerceAllocationReversalView,
  }),
  HttpApiEndpoint.get("getCommerceAllocationStatus", `${path}/allocation-receipts/:id/status`, {
    ...identified,
    success: CommerceAllocationStatus,
  }),
  HttpApiEndpoint.get(
    "getCommerceRegisterAllocationStatus",
    `${path}/register-reports/:id/allocation-status`,
    {
      ...identified,
      success: CommerceRegisterAllocationStatus,
    },
  ),
  HttpApiEndpoint.post(
    "approveCommerceAllocationReversal",
    `${path}/allocation-reversal-plans/:id/approve`,
    {
      ...identifiedMutation,
      payload: ApproveCommerceAllocationReversal.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: CommerceAllocationReversalApproval,
    },
  ),
  HttpApiEndpoint.post(
    "executeCommerceAllocationReversal",
    `${path}/allocation-reversal-plans/:id/execute`,
    {
      ...identifiedMutation,
      payload: ExecuteCommerceAllocationReversal.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: CommerceAllocationReversalExecution,
    },
  ),
  HttpApiEndpoint.post(
    "revokeCommerceAllocationReversalApproval",
    `${path}/allocation-reversal-approvals/:id/revoke`,
    {
      ...identifiedMutation,
      payload: RevokeCommerceAllocationReversalApproval.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: CommerceAllocationReversalRevocation,
    },
  ),
);

const capabilityScope = { scope: Accounting.Scope };

const capabilityMutation = {
  ...capabilityScope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

// Approval/revocation require a human operator through REST and are absent from MCP.
export const CommerceAllocationReversalCapabilities = {
  commerce_prepare_allocation_reversal: {
    description:
      "Prepare a whole applied-payment-allocation release for human review. No ledger correction, credit or refund.",
    input: Schema.Struct({ ...capabilityMutation, input: PrepareCommerceAllocationReversal }),
    output: CommerceAllocationReversalPlan,
    readOnly: false,
  },
  commerce_get_allocation_reversal: {
    description:
      "Read a sealed unallocation review, current approval, revocation history and immutable execution receipt.",
    input: Schema.Struct({ ...capabilityScope, id: Accounting.Identifier }),
    output: CommerceAllocationReversalView,
    readOnly: true,
  },
  commerce_list_allocation_reversals: {
    description:
      "Discover retained unallocation plans and receipts. Live identifier pages are not a complete inventory snapshot.",
    input: Schema.Struct({ ...capabilityScope, after: Schema.optionalKey(Accounting.Identifier) }),
    output: CommerceAllocationReversalList,
    readOnly: true,
  },
  commerce_get_allocation_status: {
    description:
      "Read the current active/released state of a historical allocation receipt and every retained unallocation review.",
    input: Schema.Struct({ ...capabilityScope, id: Accounting.Identifier }),
    output: CommerceAllocationStatus,
    readOnly: true,
  },
  commerce_get_register_allocation_status: {
    description:
      "Check only allocation freshness of an immutable register snapshot. Does not certify other dependencies or completeness.",
    input: Schema.Struct({ ...capabilityScope, id: Accounting.Identifier }),
    output: CommerceRegisterAllocationStatus,
    readOnly: true,
  },
  commerce_execute_allocation_reversal: {
    description:
      "Release the whole exactly human-approved allocation once. Preserve original legs and receipts; do not post or initiate payment.",
    input: Schema.Struct({
      ...capabilityMutation,
      id: Accounting.Identifier,
      input: ExecuteCommerceAllocationReversal,
    }),
    output: CommerceAllocationReversalExecution,
    readOnly: false,
  },
};
