import * as Schema from "effect/Schema";
import { Identifier, AccountingDate, CalendarDate, Description, Digest, Scope } from "./values";
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

export const ManualCompanyAdmission = Schema.Struct({
  witness: Schema.Struct({
    family: Schema.Literal("posting_eligibility"),
    recordClass: Schema.Literal("actual_company"),
    dates: Schema.Struct({
      postingOn: CalendarDate,
      taxPointOn: Schema.Null,
      paymentOn: Schema.Null,
      reportOn: Schema.Null,
      taxPeriodOn: Schema.Null,
    }),
    selectorDate: CalendarDate,
    jurisdiction: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
    ruleReleaseId: Identifier,
    ruleReleaseChecksum: Digest,
    factRevisionIds: Schema.Array(Identifier).check(Schema.isMaxLength(40)),
    factReviewIds: Schema.Array(Identifier).check(Schema.isMaxLength(40)),
    roleBindingIds: Schema.Array(Identifier).check(Schema.isMaxLength(20)),
    activationId: Identifier,
  }),
  membershipEpoch: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
}).check(
  Schema.makeFilter(
    (admission) =>
      admission.witness.selectorDate === admission.witness.dates.postingOn ||
      "Manual admission must select the posting date.",
  ),
);

const PostingActionSchema = Schema.Struct({
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
  manualCompanyAdmission: Schema.optional(ManualCompanyAdmission),
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

function manualAdmissionMatches(action: typeof PostingActionSchema.Type) {
  return (
    action.manualCompanyAdmission === undefined ||
    (action.postingPurpose === "adjustment" &&
      action.correctsVoucherId === null &&
      action.occurrenceKey === "manual_journal" &&
      action.vatReclassification === undefined &&
      action.manualCompanyAdmission.witness.selectorDate === action.postingDate)
  );
}

export const PostingAction = PostingActionSchema.check(
  Schema.makeFilter(
    (action) =>
      manualAdmissionMatches(action) ||
      "Company manual admission cannot authorize another posting action.",
  ),
);

function ownedAdmissionAbsent(action: {
  readonly manualCompanyAdmission?: typeof ManualCompanyAdmission.Type;
}) {
  return (
    action.manualCompanyAdmission === undefined ||
    "Company manual admission cannot authorize an owned posting action."
  );
}

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
}).check(Schema.makeFilter(ownedAdmissionAbsent));

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
  // NEXT-14 integration. A legal credit note is a posting action, so its lines
  // carry the optional original dimension assignment exactly as PrepareJournal's
  // assignable line does. The field is optional so a credit prepared before this
  // owner keeps exactly the shape it had; a line that carries none is a line whose
  // source recorded no dimension evidence, and the assignment owner records that
  // as an explicit state rather than inferring one later. A book with a dimension
  // effective on the posting date and no reviewed requirement for it still refuses
  // incomplete_policy.
  // Zero-tax credits need only revenue and receivable lines, not a fabricated
  // zero-value VAT line.
  lines: Schema.Array(
    Schema.Struct({
      ...JournalLine.fields,
      lineId: Identifier,
      originalDimensions: Schema.optional(
        Schema.Array(OriginalDimensionAssignment).check(Schema.isMaxLength(64)),
      ),
    }),
  ).check(Schema.isMinLength(2), Schema.isMaxLength(101)),
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
}).check(Schema.makeFilter(ownedAdmissionAbsent));

const SyntheticVoucherAction = Schema.Struct({
  ...PostingAction.fields,
  legalIssue: Schema.optional(Schema.Null),
  legalCredit: Schema.optional(Schema.Null),
}).check(
  Schema.makeFilter(
    (action) =>
      manualAdmissionMatches(action) ||
      "Company manual admission cannot authorize another posting action.",
  ),
);

// Financial-close result-transfer variant (NEXT-23). It moves exactly the
// sealed transfer delta from the nominal result-transfer role to the
// year-result equity role and never opens another recognition, so it is not
// an adjustment and not a reversal. Only the financial-close owner may
// present this purpose; the statement owner recognizes its vouchers as owned
// transfers through the retained purpose.
export const ResultTransferPostingAction = Schema.Struct({
  ...PostingAction.fields,
  correctsVoucherId: Schema.Null,
  postingPurpose: Schema.Literal("result_transfer_v1"),
  occurrenceKey: Schema.String.check(Schema.isPattern(/^result_transfer_[a-f0-9]{32}$/)),
  lines: Schema.Array(
    Schema.Struct({
      ...JournalLine.fields,
      lineId: Identifier,
      originalDimensions: Schema.optional(
        Schema.Array(OriginalDimensionAssignment).check(Schema.isMaxLength(64)),
      ),
    }),
  ).check(Schema.isMinLength(2), Schema.isMaxLength(2)),
  resultTransfer: Schema.Struct({
    proposalId: Identifier,
    fiscalYearId: Identifier,
    deltaMinor: SignedMinorUnits,
  }),
}).check(Schema.makeFilter(ownedAdmissionAbsent));

export const AssetProceedsPostingAction = Schema.Struct({
  ...PostingAction.fields,
  correctsVoucherId: Schema.Null,
  postingPurpose: Schema.Literal("asset_proceeds_disposal_v1"),
  taxAssessment: Schema.Literals(["synthetic_asset_proceeds_25_v1", "not_applicable"]),
  assetProceeds: Schema.Struct({
    reviewId: Identifier,
    mode: Schema.Literals(["unposted_cash_sale", "existing_legal_invoice"]),
    netMinor: MinorUnits,
    vatMinor: MinorUnits,
    correctionOf: Schema.Null,
  }),
}).check(Schema.makeFilter(ownedAdmissionAbsent));

export const VoucherPostingAction = Schema.Union([
  SyntheticVoucherAction,
  LegalArPostingAction,
  LegalCustomerCreditPostingAction,
  ResultTransferPostingAction,
  AssetProceedsPostingAction,
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
