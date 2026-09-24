import * as Schema from "effect/Schema";
import { Identifier, AccountingDate, Description, Digest, Scope } from "./values";
import { MinorUnits, SignedMinorUnits, AggregateMinorUnits } from "./money";

export const JournalLine = Schema.Struct({
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

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

export const PostingAction = Schema.Struct({
  kind: Schema.Literal("post_voucher"),
  correctsVoucherId: Schema.NullOr(Identifier),
  eventId: Identifier,
  postingPurpose: Schema.Literals(["adjustment", "reversal"]),
  occurrenceKey: Schema.String,
  fiscalYearId: Identifier,
  accountingPeriodId: Identifier,
  postingDate: AccountingDate,
  series: Schema.String,
  currency: Schema.String,
  description: Description,
  rationale: Description,
  taxAssessment: Schema.Literal("not_applicable"),
  lines: Schema.Array(Schema.Struct({ ...JournalLine.fields, lineId: Identifier })),
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
  lines: Schema.Array(Schema.Struct({ ...JournalLine.fields, lineId: Identifier })).check(
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
const SyntheticVoucherAction = Schema.Struct({
  ...PostingAction.fields,
  legalIssue: Schema.optional(Schema.Null),
});
export const VoucherPostingAction = Schema.Union([SyntheticVoucherAction, LegalArPostingAction]);

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
