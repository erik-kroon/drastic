import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import {
  OwnerTaxStatus,
  ClosingFamilyDeclaration,
  RetainedClosingFamily,
  ClosingFamilyReadiness,
} from "./closing-providers";

export { ClosingFamily, ClosingFamilyStatus } from "./closing-providers";

export const PeriodPath = Schema.Struct({
  ...Accounting.Scope.fields,
  periodId: Accounting.Identifier,
});
export const PrepareClosing = Schema.Struct({
  action: Schema.Literals(["close", "reopen"]),
  reason: Accounting.Description,
});
export const ClosingCheck = Schema.Struct({
  code: Schema.String,
  passed: Schema.Boolean,
  detail: Schema.String,
});
export const SubledgerControlDependencies = Schema.Struct({
  version: Schema.Literal("synthetic_subledger_controls_v1"),
  basisDigest: Accounting.Digest,
  basisCount: Schema.Int,
  snapshotCount: Schema.Int,
  missingBasisCount: Schema.Int,
  coverageEstablished: Schema.Literal(false),
  controlAccountReconciled: Schema.Literal(false),
  financialCloseReady: Schema.Literal(false),
});
export const ClosingDependencies = Schema.Struct({
  periodVersion: Accounting.MinorUnits,
  ledgerSequence: Accounting.MinorUnits,
  profileVersion: Accounting.MinorUnits,
  writerEpoch: Accounting.MinorUnits,
  periodDigest: Accounting.Digest,
  accountsDigest: Accounting.Digest,
  bankDigest: Accounting.Digest,
  scheduleDigest: Accounting.Digest,
  inventoryDigest: Accounting.Digest,
  ownerSourceDigest: Schema.optional(Accounting.Digest),
  expenseTaxBasisDigest: Schema.optional(Accounting.Digest),
  vatReturnDependencyDigest: Schema.optional(Accounting.Digest),
  subledgerControls: Schema.optional(SubledgerControlDependencies),
  familyInventoryDigest: Schema.optional(Accounting.Digest),
  reportId: Schema.NullOr(Accounting.Identifier),
});
export const DeclareClosingInventory = Schema.Struct({
  evidenceId: Accounting.Identifier,
  bankAccountIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(100)),
  families: Schema.optional(
    Schema.Array(ClosingFamilyDeclaration).check(Schema.isMinLength(10), Schema.isMaxLength(10)),
  ),
});
export const ClosingInventory = Schema.Struct({
  ...DeclareClosingInventory.fields,
  families: Schema.optional(Schema.Array(RetainedClosingFamily)),
  revision: Schema.optional(Accounting.MinorUnits),
  id: Accounting.Identifier,
  evidenceSha256: Schema.String,
  actorId: Accounting.Identifier,
  declaredAt: Schema.String,
  coverage: Schema.Literals(["synthetic_bank_sources_only", "synthetic_family_inventory_v1"]),
});
export const ClosingReadiness = Schema.Struct({
  scope: Accounting.Scope,
  periodId: Accounting.Identifier,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  locked: Schema.Boolean,
  inventory: Schema.NullOr(ClosingInventory),
  ownerTaxStatus: Schema.optional(OwnerTaxStatus),
  inventoryScope: Schema.optional(Schema.Literal("synthetic_family_inventory_v1")),
  families: Schema.optional(Schema.Array(ClosingFamilyReadiness)),
  dependencies: ClosingDependencies,
  checks: Schema.Array(ClosingCheck),
  technicalCloseAllowed: Schema.Boolean,
  statutoryReady: Schema.Literal(false),
  statutoryBlockers: Schema.Array(Schema.String),
});
export const ClosingProposal = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  periodId: Accounting.Identifier,
  action: PrepareClosing.fields.action,
  reason: Accounting.Description,
  basis: ClosingReadiness,
  digest: Accounting.Digest,
  proposedBy: Accounting.Identifier,
  createdAt: Schema.String,
});
export const ApproveClosing = Schema.Struct({ digest: Accounting.Digest });
export const ClosingApproval = Schema.Struct({
  id: Accounting.Identifier,
  proposalId: Accounting.Identifier,
  digest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
});
export const ExecuteClosing = Schema.Struct({
  digest: Accounting.Digest,
  approvalId: Accounting.Identifier,
});
export const ClosingReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  periodId: Accounting.Identifier,
  proposalId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  action: PrepareClosing.fields.action,
  locked: Schema.Boolean,
  periodVersion: Accounting.MinorUnits,
  certificateId: Schema.NullOr(Accounting.Identifier),
  invalidatedCertificates: Schema.Int,
  invalidatedReports: Schema.Int,
  approvedBy: Accounting.Identifier,
  executedBy: Accounting.Identifier,
  committedAt: Schema.String,
  statutoryReady: Schema.Literal(false),
});
export const ClosingCertificate = Schema.Struct({
  id: Accounting.Identifier,
  kind: Schema.Literal("synthetic_technical_period_lock_v1"),
  digest: Accounting.Digest,
  proposal: ClosingProposal,
  receipt: ClosingReceipt,
  effectiveDependencies: ClosingDependencies,
});
export const ClosingProposalView = Schema.Struct({
  proposal: ClosingProposal,
  dependenciesCurrent: Schema.Boolean,
  receipt: Schema.NullOr(ClosingReceipt),
});
export const ClosingCertificateView = Schema.Struct({
  certificate: ClosingCertificate,
  current: Schema.Boolean,
  invalidatedBy: Schema.NullOr(Accounting.Identifier),
});
export const ClosingHistory = Schema.Struct({
  items: Schema.Array(ClosingReceipt),
  next: Schema.NullOr(Accounting.MinorUnits),
});
export const ClosingProposalCursor = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$/),
);
export const ClosingProposalQuery = Schema.Struct({
  after: Schema.optional(ClosingProposalCursor),
});
export const ClosingProposalSummary = Schema.Struct({
  id: Accounting.Identifier,
  periodId: Accounting.Identifier,
  digest: Accounting.Digest,
  action: PrepareClosing.fields.action,
  reason: Accounting.Description,
  proposedBy: Accounting.Identifier,
  createdAt: Schema.String,
  capturedStartsOn: Accounting.AccountingDate,
  capturedEndsOn: Accounting.AccountingDate,
  capturedLedgerSequence: Accounting.MinorUnits,
  execution: Schema.NullOr(
    Schema.Struct({
      transitionId: Accounting.Identifier,
      certificateId: Schema.NullOr(Accounting.Identifier),
    }),
  ),
});
export const ClosingProposalList = Schema.Struct({
  scope: Accounting.Scope,
  periodId: Accounting.Identifier,
  items: Schema.Array(ClosingProposalSummary).check(Schema.isMaxLength(50)),
  next: Schema.NullOr(ClosingProposalCursor),
  discovery: Schema.Literal("live_saved_proposal_history"),
  liveReadinessChecked: Schema.Literal(false),
  approvalAuthority: Schema.Literal(false),
});
const period = { params: PeriodPath, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
const keyed = { ...identified, headers: Accounting.IdempotencyHeaders };
const path = "/v1/entities/:entityId/books/:bookId";
export const ClosingApi = HttpApiGroup.make("closing").add(
  HttpApiEndpoint.get("listClosingProposals", `${path}/periods/:periodId/closing-proposals`, {
    ...period,
    query: ClosingProposalQuery,
    success: ClosingProposalList,
  }),
  HttpApiEndpoint.post(
    "declareClosingInventory",
    `${path}/periods/:periodId/closing-source-inventories`,
    {
      ...period,
      headers: Accounting.IdempotencyHeaders,
      payload: DeclareClosingInventory.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: ClosingInventory,
    },
  ),
  HttpApiEndpoint.get("closingReadiness", `${path}/periods/:periodId/closing-readiness`, {
    ...period,
    success: ClosingReadiness,
  }),
  HttpApiEndpoint.post("prepareClosing", `${path}/periods/:periodId/closing-proposals`, {
    ...period,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareClosing.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ClosingProposal,
  }),
  HttpApiEndpoint.get("getClosingProposal", `${path}/closing-proposals/:id`, {
    ...identified,
    success: ClosingProposalView,
  }),
  HttpApiEndpoint.post("approveClosing", `${path}/closing-proposals/:id/approvals`, {
    ...keyed,
    payload: ApproveClosing.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ClosingApproval,
  }),
  HttpApiEndpoint.post("executeClosing", `${path}/closing-proposals/:id/executions`, {
    ...keyed,
    payload: ExecuteClosing.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ClosingReceipt,
  }),
  HttpApiEndpoint.get("closingHistory", `${path}/periods/:periodId/closing-history`, {
    ...period,
    query: Schema.Struct({ after: Schema.optional(Accounting.MinorUnits) }),
    success: ClosingHistory,
  }),
  HttpApiEndpoint.get("getClosingCertificate", `${path}/closing-certificates/:id`, {
    ...identified,
    success: ClosingCertificateView,
  }),
);

const scoped = { scope: Accounting.Scope };
const mutation = {
  ...scoped,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};
export const ClosingCapabilities = {
  periods_list_closing_proposals: {
    description:
      "Rediscover saved close/reopen proposals for one period, including those never executed. Live history paging returns immutable captured summaries and retained execution IDs only, never approval tokens or current eligibility. Restart paging for later arrivals.",
    input: Schema.Struct({
      ...scoped,
      periodId: Accounting.Identifier,
      ...ClosingProposalQuery.fields,
    }),
    output: ClosingProposalList,
    readOnly: true,
  },
  periods_closing_readiness: {
    description:
      "Inspect evidenced family decisions, unavailable controls and live synthetic technical-lock prerequisites. This is not statutory readiness.",
    input: Schema.Struct({ ...scoped, periodId: Accounting.Identifier }),
    output: ClosingReadiness,
    readOnly: true,
  },
  periods_prepare_closing: {
    description:
      "Prepare an immutable dependency-bound technical close or reopen proposal; does not lock or approve.",
    input: Schema.Struct({ ...mutation, periodId: Accounting.Identifier, input: PrepareClosing }),
    output: ClosingProposal,
    readOnly: false,
  },
  periods_get_closing_proposal: {
    description: "Read a technical close/reopen proposal, freshness and any committed receipt.",
    input: Schema.Struct({ ...scoped, proposalId: Accounting.Identifier }),
    output: ClosingProposalView,
    readOnly: true,
  },
  periods_execute_closing: {
    description:
      "Commit an exactly approved technical period lock/reopen atomically; never a statutory close or filing.",
    input: Schema.Struct({ ...mutation, proposalId: Accounting.Identifier, input: ExecuteClosing }),
    output: ClosingReceipt,
    readOnly: false,
  },
  periods_closing_history: {
    description: "Read immutable technical close/reopen receipts in period-version order.",
    input: Schema.Struct({
      ...scoped,
      periodId: Accounting.Identifier,
      after: Schema.optional(Accounting.MinorUnits),
    }),
    output: ClosingHistory,
    readOnly: true,
  },
  periods_get_closing_certificate: {
    description:
      "Read immutable technical lock evidence with current validity; not an annual report or compliance certificate.",
    input: Schema.Struct({ ...scoped, certificateId: Accounting.Identifier }),
    output: ClosingCertificateView,
    readOnly: true,
  },
};
