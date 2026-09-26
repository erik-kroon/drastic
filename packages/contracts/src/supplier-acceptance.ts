import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Drafts from "./supplier-invoice-drafts";
import { accountingErrors } from "./accounting-errors";

const SharedSupplierAcceptanceFields = {
  draftId: Accounting.Identifier,
  expectedRevision: Commerce.Version,
  expectedDigest: Accounting.Digest,
  controlAccountId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  acknowledgeSyntheticOnly: Schema.Literal(true),
};

export const SupplierLineAssignment = Schema.Struct({
  lineId: Accounting.Identifier,
  expenseAccountId: Accounting.Identifier,
  vatRatePercent: Schema.Literals([0, 6, 12, 25]),
});

export const PrepareSyntheticSupplierAcceptance = Schema.Struct({
  profile: Schema.Literals(["synthetic-manual-supplier-v1", "synthetic-gross-cost-supplier-v1"]),
  ...SharedSupplierAcceptanceFields,
  debitAccountId: Accounting.Identifier,
});

export const PrepareSwedishSupplierAcceptance = Schema.Struct({
  profile: Schema.Literal("swedish-purchase-v1"),
  ...SharedSupplierAcceptanceFields,
  lineAssignments: Schema.Array(SupplierLineAssignment).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
});

export const PrepareSupplierAcceptance = Schema.Union([
  PrepareSyntheticSupplierAcceptance,
  PrepareSwedishSupplierAcceptance,
]);

export const ApproveSupplierAcceptance = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const ExecuteSupplierAcceptance = Schema.Struct({
  ...ApproveSupplierAcceptance.fields,
  approvalId: Accounting.Identifier,
});

export const SupplierAcceptanceReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  profile: Schema.Literals([
    "synthetic-manual-supplier-v1",
    "synthetic-gross-cost-supplier-v1",
    "swedish-purchase-v1",
  ]),
  ordinal: Schema.Int,
  input: PrepareSupplierAcceptance,
  draftSnapshot: Drafts.SupplierInvoiceDraftRevision,
  postingPlan: Accounting.ChangeSet,
  evidence: Commerce.EvidenceReference,
  originalLines: Schema.optional(
    Schema.Array(
      Schema.Struct({
        lineId: Accounting.Identifier,
        expenseAccountId: Accounting.Identifier,
        netMinor: Accounting.MinorUnits,
        taxMinor: Accounting.MinorUnits,
        vatRatePercent: Schema.Literals([0, 6, 12, 25]),
      }),
    ),
  ),
  inputVatAccountId: Schema.optional(Accounting.Identifier),
  legalBlockers: Schema.Array(Schema.String),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const SupplierAcceptanceApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  ordinal: Schema.Int,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const SupplierAcceptanceReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  profile: Schema.Literals([
    "synthetic-manual-supplier-v1",
    "synthetic-gross-cost-supplier-v1",
    "swedish-purchase-v1",
  ]),
  draftId: Accounting.Identifier,
  draftRevision: Commerce.Version,
  draftDigest: Accounting.Digest,
  supplierDocumentNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  accepted: Schema.Literal(true),
  recognized: Schema.Literal(true),
  paid: Schema.Literal(false),
  postingReceipt: Accounting.ExecutionReceipt,
  registerInvoiceId: Accounting.Identifier,
  legalBlockers: Schema.Array(Schema.String),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const SupplierAcceptanceView = Schema.Struct({
  plan: SupplierAcceptanceReview,
  approval: Schema.NullOr(SupplierAcceptanceApproval),
  acceptance: Schema.NullOr(SupplierAcceptanceReceipt),
  blockers: Schema.Array(Schema.String),
  dependenciesCurrent: Schema.Boolean,
  approvalUsable: Schema.Boolean,
});

export const SupplierAcceptanceHistory = Schema.Struct({
  scope: Accounting.Scope,
  draftId: Accounting.Identifier,
  complete: Schema.Literal(true),
  count: Schema.Int,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      ordinal: Schema.Int,
      draftRevision: Commerce.Version,
      digest: Accounting.Digest,
      createdAt: Schema.String,
      acceptanceId: Schema.NullOr(Accounting.Identifier),
      supplierDocumentNumber: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(50)),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce";

const mutation = {
  params: Accounting.ChangePath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

export const SupplierAcceptanceApi = HttpApiGroup.make("supplierAcceptance").add(
  HttpApiEndpoint.post("prepareSupplierAcceptance", `${path}/supplier-acceptance-reviews`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareSupplierAcceptance.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SupplierAcceptanceReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post(
    "approveSupplierAcceptance",
    `${path}/supplier-acceptance-reviews/:id/approvals`,
    {
      ...mutation,
      payload: ApproveSupplierAcceptance.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: SupplierAcceptanceApproval,
    },
  ),
  HttpApiEndpoint.post(
    "executeSupplierAcceptance",
    `${path}/supplier-acceptance-reviews/:id/execute`,
    {
      ...mutation,
      payload: ExecuteSupplierAcceptance.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: SupplierAcceptanceReceipt,
    },
  ),
  HttpApiEndpoint.get("getSupplierAcceptanceReview", `${path}/supplier-acceptance-reviews/:id`, {
    params: Accounting.ChangePath,
    success: SupplierAcceptanceView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get(
    "supplierAcceptanceHistory",
    `${path}/supplier-invoice-drafts/:id/acceptance-reviews`,
    {
      params: Accounting.ChangePath,
      success: SupplierAcceptanceHistory,
      error: accountingErrors,
    },
  ),
);

// All issue/recognition mutations are operator-only. Ordinary MCP exposes recovery reads only.
export const SupplierAcceptanceCapabilities = {
  commerce_get_supplier_acceptance_review: {
    description:
      "Read a sealed synthetic invoice issue and exact posting review, its current blockers, human approval and committed aggregate receipt. Not legal invoice or delivery authority.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierAcceptanceView,
    readOnly: true,
  },
  commerce_supplier_acceptance_history: {
    description:
      "Read the complete bounded issue-review history for one customer draft, including saved synthetic issue identities for recovery after reload.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SupplierAcceptanceHistory,
    readOnly: true,
  },
};
