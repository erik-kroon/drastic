import * as Schema from "effect/Schema";
import { Identifier, AccountingDate, Description, Digest, Scope } from "./values";
import { MinorUnits, SignedMinorUnits, AggregateMinorUnits } from "./money";
import { DimensionPolicy, OriginalDimensionAssignment } from "./dimensions";

export const JournalLine = Schema.Struct({
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

// NEXT-14. The original dimension assignment of a new posting line. It is
// optional so a proposal sealed before this owner keeps exactly the JSON it was
// sealed with and its digest is unchanged; a line that carries none is a line
// whose source recorded no dimension evidence, which the owner records as an
// explicit state rather than inferring one later.
const PostingLineFields = {
  ...JournalLine.fields,
  lineId: Identifier,
  originalDimensions: Schema.optional(
    Schema.Array(OriginalDimensionAssignment).check(Schema.isMaxLength(64)),
  ),
};

export const Evidence = Schema.Struct({
  id: Identifier,
  title: Description,
  sha256: Schema.String,
  mediaType: Schema.String,
  origin: Schema.String,
  createdAt: Schema.String,
});

export const EvidenceContent = Schema.Struct({ ...Evidence.fields, content: Schema.String });

export const Dependency = Schema.Struct({
  kind: Schema.Literals(["profile", "account", "period", "writer_epoch"]),
  resourceId: Identifier,
  version: Schema.String,
  reason: Schema.String,
});

export const DependencyVersion = Schema.Struct({
  dimension: Schema.Literals(["content", "posting_eligibility"]),
  kind: Schema.String,
  resourceId: Identifier,
  version: Schema.String,
});

export const PostingAction = Schema.Struct({
  kind: Schema.Literal("post_voucher"),
  correctsVoucherId: Schema.NullOr(Identifier),
  eventId: Identifier,
  postingPurpose: Schema.Literals(["adjustment", "reversal", "vat_control_reclassification_v1"]),
  occurrenceKey: Schema.String,
  fiscalYearId: Identifier,
  accountingPeriodId: Identifier,
  postingDate: AccountingDate,
  series: Schema.String,
  currency: Schema.String,
  description: Description,
  rationale: Description,
  taxAssessment: Schema.Literal("not_applicable"),
  // NEXT-14. The reviewed requirement for each dimension effective at the
  // posting date. It is sealed into the plan so approval covers it, and the
  // resolved original assignments travel with each line. A dimension the policy
  // does not mention is a refusal, not an unclassified pass.
  dimensionPolicy: Schema.optional(DimensionPolicy),
  vatReclassification: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        reviewId: Identifier,
        obligationId: Identifier,
        draftId: Identifier,
      }),
    ),
  ),
  lines: Schema.Array(Schema.Struct(PostingLineFields)),
  evidenceRefs: Schema.Array(
    Schema.Struct({ evidenceId: Identifier, sha256: Schema.String, locator: Schema.String }),
  ),
});

// Read-only legal AR variant. Generic manual journal admission remains PostingAction and
// the SQL inspect_action restriction remains synthetic-only.
export const LegalArPostingAction = Schema.Struct({
  ...PostingAction.fields,
  correctsVoucherId: Schema.Null,
  postingPurpose: Schema.Literal("legal_ar_recognition"),
  occurrenceKey: Schema.String.check(Schema.isPattern(/^legal_ar_invoice_draft_[a-f0-9]{32}$/)),
  currency: Schema.Literal("SEK"),
  taxAssessment: Schema.Literal("se-domestic-standard-25-v1"),
  lines: Schema.Array(Schema.Struct(PostingLineFields)).check(
    Schema.isMinLength(3),
    Schema.isMaxLength(3),
  ),
  legalIssue: Schema.Struct({
    profile: Schema.Literal("se-domestic-b2b-sek-25-accrual-v1"),
    number: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9-]{0,11}-[1-9][0-9]{0,17}$/)),
    policyId: Identifier,
    reviewId: Identifier,
    reviewDigest: Digest,
    netMinor: MinorUnits,
    taxMinor: MinorUnits,
  }),
});

// Read-only legal customer credit variant. It reverses already recognized
// revenue and output VAT against the same receivable control and never opens a
// second AR recognition, so it is not an adjustment and not a reversal.
export const LegalCustomerCreditPostingAction = Schema.Struct({
  ...PostingAction.fields,
  correctsVoucherId: Schema.Null,
  postingPurpose: Schema.Literal("legal_customer_credit_v1"),
  occurrenceKey: Schema.String.check(Schema.isPattern(/^legal_credit_review_[a-f0-9]{32}$/)),
  currency: Schema.Literal("SEK"),
  taxAssessment: Schema.Literal("se-domestic-standard-25-v1"),
  lines: Schema.Array(Schema.Struct({ ...JournalLine.fields, lineId: Identifier })).check(
    Schema.isMinLength(3),
    Schema.isMaxLength(101),
  ),
  legalCredit: Schema.Struct({
    profile: Schema.Literal("se-domestic-b2b-sek-25-accrual-credit-v1"),
    // The legal credit number is a document identity, not a journal field: it is
    // allocated from the reviewed policy's own counter inside the issuing transaction
    // and is never part of a plan digest that must be fixed before approval.
    policyId: Identifier,
    reviewId: Identifier,
    originalIssueId: Identifier,
    originalDocumentNumber: Schema.String.check(
      Schema.isPattern(/^[A-Z][A-Z0-9-]{0,11}-[1-9][0-9]{0,17}$/),
    ),
    creditedLineCount: Schema.Int,
    netMinor: MinorUnits,
    taxMinor: MinorUnits,
  }),
});

const SyntheticVoucherAction = Schema.Struct({
  ...PostingAction.fields,
  legalIssue: Schema.optional(Schema.Null),
  legalCredit: Schema.optional(Schema.Null),
});

export const VoucherPostingAction = Schema.Union([
  SyntheticVoucherAction,
  LegalArPostingAction,
  LegalCustomerCreditPostingAction,
]);

export const ChangeSet = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  canonicalization: Schema.Literal("openerp-c14n-v1"),
  id: Identifier,
  version: Schema.Literal(1),
  scope: Scope,
  createdAt: Schema.String,
  dependencies: Schema.Array(Dependency),
  groups: Schema.Array(
    Schema.Struct({
      id: Identifier,
      dependsOnGroupIds: Schema.Array(Identifier),
      actions: Schema.Array(VoucherPostingAction),
    }),
  ),
  planDigest: Digest,
});

export const Approval = Schema.Struct({
  id: Identifier,
  changeSetId: Identifier,
  planDigest: Digest,
  actorId: Identifier,
  expiresAt: Schema.String,
});

export const ExecutionReceipt = Schema.Struct({
  id: Identifier,
  changeSetId: Identifier,
  voucherId: Identifier,
  planDigest: Digest,
  sequence: MinorUnits,
  voucherNumber: MinorUnits,
  committedAt: Schema.String,
});

export const GroupReceipt = Schema.Struct({
  id: Identifier,
  changeSetId: Identifier,
  groupId: Identifier,
  planDigest: Digest,
  executionReceipts: Schema.Array(ExecutionReceipt).check(Schema.isMinLength(1)),
  committedAt: Schema.String,
});

export const ApprovalConsumption = Schema.Struct({
  id: Identifier,
  approvalId: Identifier,
  changeSetId: Identifier,
  groupId: Identifier,
  planDigest: Digest,
  receiptId: Identifier,
  approverId: Identifier,
  consumedById: Identifier,
  consumedAt: Schema.String,
});

export const Voucher = Schema.Struct({
  id: Identifier,
  number: MinorUnits,
  sequence: MinorUnits,
  recordedAt: Schema.String,
  action: VoucherPostingAction,
});

export const LedgerSnapshot = Schema.Struct({
  sequence: MinorUnits,
  accounts: Schema.Array(
    Schema.Struct({
      accountId: Identifier,
      code: Schema.String,
      name: Schema.String,
      debitMinor: AggregateMinorUnits,
      creditMinor: AggregateMinorUnits,
      balanceMinor: SignedMinorUnits,
    }),
  ),
});

export const ValidationReport = Schema.Struct({
  changeSetId: Identifier,
  planDigest: Digest,
  status: Schema.Literal("valid"),
  checkedAt: Schema.String,
});
