import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import {
  Version,
  EvidenceReference,
  CommandReceipt,
  ApproveAllocation,
  ApplyAllocation,
  AllocationApproval,
} from "./commerce";

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const PositiveMinor = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/));

const Currency = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

export const DataNature = Schema.Literals(["company_record", "synthetic_example"]);

export const Classification = Schema.Literals([
  "unknown",
  "owner_expense",
  "owner_reimbursement",
  "shareholder_loan",
  "loan_repayment",
  "conditional_contribution",
  "unconditional_contribution",
]);

export const Origin = Schema.Literals(["unknown", "opening", "current"]);

const metadata = { createdAt: Schema.String, receipt: CommandReceipt };

const identity = { id: Accounting.Identifier, scope: Accounting.Scope };

export const CreateOwner = Schema.Struct({
  sourceKey: Name,
  displayName: Name,
  dataNature: DataNature,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const Owner = Schema.Struct({
  ...CreateOwner.fields,
  ...identity,
  ...metadata,
  evidence: EvidenceReference,
  legalIdentityVerified: Schema.Literal(false),
});

const sourceFields = {
  ownerId: Accounting.Identifier,
  dataNature: DataNature,
  sourceKey: Name,
  sourceKind: Schema.Literals(["expense", "funding", "settlement"]),
  evidenceId: Accounting.Identifier,
  locator: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  occurredOn: Accounting.AccountingDate,
  currency: Currency,
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  amountMinor: PositiveMinor,
  counterparty: Schema.NullOr(Schema.Struct({ sourceKey: Name, displayName: Name })),
};

const revisionFields = {
  description: Accounting.Description,
  classification: Classification,
  origin: Origin,
  reason: Accounting.Description,
};

export const CreateRecord = Schema.Struct({ ...sourceFields, ...revisionFields });

export const ReviseRecord = Schema.Struct({
  ...revisionFields,
  expectedRevision: Version,
  evidenceId: Accounting.Identifier,
});

export const Source = Schema.Struct({
  ...sourceFields,
  ...identity,
  ...metadata,
  ownerName: Name,
  evidence: EvidenceReference,
});

export const Revision = Schema.Struct({
  ...identity,
  ...metadata,
  ...revisionFields,
  revision: Version,
  evidence: EvidenceReference,
  digest: Accounting.Digest,
});

export const ReviewRecord = Schema.Struct({
  expectedRevision: Version,
  revisionDigest: Accounting.Digest,
  controlAccountId: Schema.NullOr(Accounting.Identifier),
  syntheticNoTaxConfirmed: Schema.Boolean,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const Review = Schema.Struct({
  ...identity,
  ...metadata,
  recordId: Accounting.Identifier,
  revision: Version,
  revisionDigest: Accounting.Digest,
  classification: Classification,
  origin: Origin,
  controlAccountId: Schema.NullOr(Accounting.Identifier),
  syntheticNoTaxConfirmed: Schema.Boolean,
  reason: Accounting.Description,
  evidence: EvidenceReference,
  accountVersion: Schema.NullOr(Version),
  profileVersion: Version,
  writerEpoch: Version,
});

export const AttachProposal = Schema.Struct({
  reviewId: Accounting.Identifier,
  changeSetId: Accounting.Identifier,
  lineId: Accounting.Identifier,
});

export const ProposalLink = Schema.Struct({
  ...AttachProposal.fields,
  ...identity,
  ...metadata,
  recordId: Accounting.Identifier,
  revision: Version,
  revisionDigest: Accounting.Digest,
  planDigest: Accounting.Digest,
});

export const AttachPostedLine = Schema.Struct({
  reviewId: Accounting.Identifier,
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
});

export const PostedEffect = Schema.Struct({
  ...AttachPostedLine.fields,
  ...identity,
  ...metadata,
  recordId: Accounting.Identifier,
  ownerId: Accounting.Identifier,
  revisionDigest: Accounting.Digest,
  accountId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  occurredOn: Accounting.AccountingDate,
  locator: sourceFields.locator,
  eventId: Accounting.Identifier,
  changeSetId: Accounting.Identifier,
  classification: Classification,
  origin: Schema.Literals(["opening", "current"]),
  side: Schema.Literals(["debit", "credit"]),
  amountMinor: PositiveMinor,
  currency: Currency,
  currencyScale: Schema.Int,
  evidence: EvidenceReference,
});

export const RecordView = Schema.Struct({
  source: Source,
  currentRevision: Revision,
  review: Schema.NullOr(Review),
  effect: Schema.NullOr(PostedEffect),
  proposals: Schema.Array(ProposalLink),
  allocatedMinor: Accounting.MinorUnits,
  remainingMinor: Schema.NullOr(Accounting.MinorUnits),
  sourceCoverage: Schema.Literal("unknown"),
  blockers: Schema.Array(Schema.String),
});

export const OwnerPage = Schema.Struct({
  items: Schema.Array(Owner),
  next: Schema.NullOr(Accounting.Identifier),
});

export const RecordPage = Schema.Struct({
  items: Schema.Array(RecordView),
  next: Schema.NullOr(Accounting.Identifier),
});

export const RecordHistory = Schema.Struct({
  items: Schema.Array(Schema.Struct({ revision: Revision, review: Schema.NullOr(Review) })),
  next: Schema.NullOr(Version),
});

export const Capacity = Schema.Struct({
  effect: PostedEffect,
  allocatedMinor: Accounting.MinorUnits,
  remainingMinor: Accounting.MinorUnits,
  capacityVersion: Accounting.MinorUnits,
});

export const PrepareAllocation = Schema.Struct({
  settlementId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
  allocations: Schema.Array(
    Schema.Struct({ claimId: Accounting.Identifier, amountMinor: PositiveMinor }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

export const AllocationPlan = Schema.Struct({
  ...identity,
  ...metadata,
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  input: PrepareAllocation,
  settlement: Capacity,
  legs: Schema.Array(
    Schema.Struct({
      claim: Capacity,
      amountMinor: PositiveMinor,
      remainingAfterMinor: Accounting.MinorUnits,
    }),
  ),
  totalMinor: PositiveMinor,
  settlementRemainingAfterMinor: Accounting.MinorUnits,
  evidence: EvidenceReference,
  profileVersion: Version,
  writerEpoch: Version,
  accountVersion: Version,
  settlementPeriodVersion: Version,
});

export { ApproveAllocation, ApplyAllocation, AllocationApproval };

export const AllocationReceipt = Schema.Struct({
  ...identity,
  planId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  totalMinor: PositiveMinor,
  settlementRemainingMinor: Accounting.MinorUnits,
  committedAt: Schema.String,
  receipt: CommandReceipt,
});

export const AllocationView = Schema.Struct({
  plan: AllocationPlan,
  dependenciesCurrent: Schema.Boolean,
  approval: Schema.NullOr(AllocationApproval),
  application: Schema.NullOr(AllocationReceipt),
});

export const PrepareControl = Schema.Struct({
  ownerId: Accounting.Identifier,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});

export const Control = Schema.Struct({
  ...identity,
  ...metadata,
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  owner: Owner,
  currency: Currency,
  currencyScale: Schema.Int,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  sourceCoverage: Schema.Literal("unknown"),
  openingBalanceMinor: Schema.Null,
  unlinkedRecordCount: Schema.Int,
  records: Schema.Array(
    Schema.Struct({ source: Source, revision: Revision, review: Schema.NullOr(Review) }),
  ),
  effects: Schema.Array(PostedEffect),
  allocations: Schema.Array(
    Schema.Struct({
      receiptId: Accounting.Identifier,
      ordinal: Schema.Int,
      claimId: Accounting.Identifier,
      settlementId: Accounting.Identifier,
      amountMinor: PositiveMinor,
    }),
  ),
  ownerBalances: Schema.Array(
    Schema.Struct({
      accountId: Accounting.Identifier,
      recordedNetCreditMinor: Accounting.SignedMinorUnits,
      openExpenseMinor: Accounting.AggregateMinorUnits,
      openLoanMinor: Accounting.AggregateMinorUnits,
      unappliedReimbursementMinor: Accounting.AggregateMinorUnits,
      unappliedLoanRepaymentMinor: Accounting.AggregateMinorUnits,
      conditionalContributionMinor: Accounting.AggregateMinorUnits,
      unconditionalContributionMinor: Accounting.AggregateMinorUnits,
    }),
  ),
  movements: Schema.Array(
    Schema.Struct({
      accountId: Accounting.Identifier,
      classification: Classification,
      registeredOpeningMinor: Accounting.SignedMinorUnits,
      priorCurrentMinor: Accounting.SignedMinorUnits,
      currentMovementMinor: Accounting.SignedMinorUnits,
      recordedClosingMinor: Accounting.SignedMinorUnits,
    }),
  ),
  accountControls: Schema.Array(
    Schema.Struct({
      accountId: Accounting.Identifier,
      allOwnersRegisteredMinor: Accounting.SignedMinorUnits,
      allOwnersEffectsDigest: Accounting.Digest,
      ledgerCreditBalanceMinor: Accounting.SignedMinorUnits,
      unexplainedMinor: Accounting.SignedMinorUnits,
      ledgerSequence: Accounting.MinorUnits,
    }),
  ),
  blockers: Schema.Array(Schema.String),
});

export const ControlView = Schema.Struct({ snapshot: Control, current: Schema.Boolean });

export const CommandRecovery = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("owners_create_owner"), result: Owner }),
  Schema.Struct({ operation: Schema.Literal("owners_create_record"), result: RecordView }),
  Schema.Struct({ operation: Schema.Literal("owners_revise_record"), result: RecordView }),
  Schema.Struct({ operation: Schema.Literal("owners_review_record"), result: Review }),
  Schema.Struct({ operation: Schema.Literal("owners_attach_proposal"), result: ProposalLink }),
  Schema.Struct({ operation: Schema.Literal("owners_attach_posted_line"), result: PostedEffect }),
  Schema.Struct({ operation: Schema.Literal("owners_prepare_allocation"), result: AllocationPlan }),
  Schema.Struct({
    operation: Schema.Literal("owners_approve_allocation"),
    result: AllocationApproval,
  }),
  Schema.Struct({
    operation: Schema.Literal("owners_apply_allocation"),
    result: AllocationReceipt,
  }),
  Schema.Struct({ operation: Schema.Literal("owners_prepare_control"), result: Control }),
]);

const AfterQuery = Schema.Struct({ after: Schema.optional(Accounting.Identifier) });

const HistoryQuery = Schema.Struct({ after: Schema.optional(Version) });

const RecoveryPath = Schema.Struct({
  ...Accounting.Scope.fields,
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
});

const path = "/v1/entities/:entityId/books/:bookId/owner-register";

export const OwnerRegisterApi = HttpApiGroup.make("ownerRegister").add(
  HttpApiEndpoint.post("ownersCreateOwner", `${path}/owners`, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: Owner,
    headers: Accounting.IdempotencyHeaders,
    payload: CreateOwner.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.get("ownersGetOwner", `${path}/owners/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: Owner,
  }),
  HttpApiEndpoint.get("ownersListOwners", `${path}/owners`, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: OwnerPage,
    query: AfterQuery,
  }),
  HttpApiEndpoint.post("ownersCreateRecord", `${path}/records`, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: RecordView,
    headers: Accounting.IdempotencyHeaders,
    payload: CreateRecord.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.post("ownersReviseRecord", `${path}/records/:id/revisions`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: RecordView,
    headers: Accounting.IdempotencyHeaders,
    payload: ReviseRecord.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.get("ownersGetRecord", `${path}/records/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: RecordView,
  }),
  HttpApiEndpoint.get("ownersListRecords", `${path}/records`, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: RecordPage,
    query: AfterQuery,
  }),
  HttpApiEndpoint.get("ownersRecordHistory", `${path}/records/:id/revisions`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: RecordHistory,
    query: HistoryQuery,
  }),
  HttpApiEndpoint.post("ownersReviewRecord", `${path}/records/:id/reviews`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: Review,
    headers: Accounting.IdempotencyHeaders,
    payload: ReviewRecord.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.post("ownersAttachProposal", `${path}/records/:id/proposals`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: ProposalLink,
    headers: Accounting.IdempotencyHeaders,
    payload: AttachProposal.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.post("ownersAttachPostedLine", `${path}/records/:id/posted-lines`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: PostedEffect,
    headers: Accounting.IdempotencyHeaders,
    payload: AttachPostedLine.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.post("ownersPrepareAllocation", `${path}/allocation-plans`, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: AllocationPlan,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.get("ownersGetAllocation", `${path}/allocation-plans/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: AllocationView,
  }),
  HttpApiEndpoint.post("ownersApproveAllocation", `${path}/allocation-plans/:id/approvals`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: AllocationApproval,
    headers: Accounting.IdempotencyHeaders,
    payload: ApproveAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.post("ownersApplyAllocation", `${path}/allocation-plans/:id/apply`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: AllocationReceipt,
    headers: Accounting.IdempotencyHeaders,
    payload: ApplyAllocation.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.post("ownersPrepareControl", `${path}/controls`, {
    params: Accounting.Scope,
    error: accountingErrors,
    success: Control,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareControl.annotate({ parseOptions: { onExcessProperty: "error" } }),
  }),
  HttpApiEndpoint.get("ownersGetControl", `${path}/controls/:id`, {
    params: Accounting.ChangePath,
    error: accountingErrors,
    success: ControlView,
  }),
  HttpApiEndpoint.get("ownersRecoverCommand", `${path}/commands/:key`, {
    params: RecoveryPath,
    error: accountingErrors,
    success: CommandRecovery,
  }),
);

export const OwnerRegisterCapabilities = {
  owners_create_owner: {
    description:
      "Retain an evidence-backed owner identity. Does not verify legal status or activate accounting.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: CreateOwner,
    }),
    output: Owner,
    readOnly: false,
  },
  owners_get_owner: {
    description: "Read a scoped retained owner identity.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: Owner,
    readOnly: true,
  },
  owners_list_owners: {
    description: "Page retained owner identities. Source coverage remains unknown.",
    input: Schema.Struct({ scope: Accounting.Scope, ...AfterQuery.fields }),
    output: OwnerPage,
    readOnly: true,
  },
  owners_create_record: {
    description:
      "Retain an owner expense, funding or settlement source with exact original facts. No accounting treatment is inferred.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: CreateRecord,
    }),
    output: RecordView,
    readOnly: false,
  },
  owners_revise_record: {
    description:
      "Append classification/description/origin assertions before posted attachment. Invalidates earlier reviews and proposal attachments.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ReviseRecord,
    }),
    output: RecordView,
    readOnly: false,
  },
  owners_get_record: {
    description:
      "Read source, current revision, exact review, proposal/posted links and conserved allocation residuals.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: RecordView,
    readOnly: true,
  },
  owners_list_records: {
    description: "Page retained owner records. This is not a complete company register.",
    input: Schema.Struct({ scope: Accounting.Scope, ...AfterQuery.fields }),
    output: RecordPage,
    readOnly: true,
  },
  owners_record_history: {
    description: "Page immutable owner source revisions and their operator reviews.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      ...HistoryQuery.fields,
    }),
    output: RecordHistory,
    readOnly: true,
  },
  owners_attach_proposal: {
    description:
      "Attach an explicitly synthetic reviewed source to an existing kernel proposal. Kernel approval and execution remain separate.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: AttachProposal,
    }),
    output: ProposalLink,
    readOnly: false,
  },
  owners_attach_posted_line: {
    description:
      "Attach a synthetic reviewed source to its exact existing posted control line without posting again.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: AttachPostedLine,
    }),
    output: PostedEffect,
    readOnly: false,
  },
  owners_prepare_allocation: {
    description:
      "Freeze reimbursement or loan repayment allocation between compatible posted owner effects. Never initiates payment.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareAllocation,
    }),
    output: AllocationPlan,
    readOnly: false,
  },
  owners_get_allocation: {
    description: "Read the exact owner allocation plan, freshness, approval and immutable receipt.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: AllocationView,
    readOnly: true,
  },
  owners_apply_allocation: {
    description:
      "Apply one exact operator-approved allocation under both capacities. Does not change the ledger or bank matching.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ApplyAllocation,
    }),
    output: AllocationReceipt,
    readOnly: false,
  },
  owners_prepare_control: {
    description:
      "Freeze an as-of owner control snapshot. Opening completeness remains unknown; contribution balances do not confer repayment rights.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareControl,
    }),
    output: Control,
    readOnly: false,
  },
  owners_get_control: {
    description:
      "Read a frozen owner control and whether its relevant as-of sources remain current.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: ControlView,
    readOnly: true,
  },
  owners_recover_command: {
    description:
      "Recover a retained owner command result using the same actor, book and exact key. Missing receipt does not prove an in-flight request failed.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    }),
    output: CommandRecovery,
    readOnly: true,
  },
};
