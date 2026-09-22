import * as Schema from "effect/Schema";

export const Identifier = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}$/));
export const MinorUnits = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,37})$/));
export const SignedMinorUnits = Schema.String.check(Schema.isPattern(/^(0|-?[1-9][0-9]*)$/));
export const AggregateMinorUnits = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/));
export const AccountingDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
export const Description = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));
export const Digest = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));
export const Scope = Schema.Struct({ entityId: Identifier, bookId: Identifier });
export const ChangePath = Schema.Struct({
  entityId: Identifier,
  bookId: Identifier,
  id: Identifier,
});
export const IdempotencyHeaders = Schema.Struct({
  "idempotency-key": Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{8,128}$/)),
});
export const JournalLine = Schema.Struct({
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});
export const PrepareJournal = Schema.Struct({
  kind: Schema.Literal("manual_journal"),
  evidenceId: Identifier,
  eventKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  accountingPeriodId: Identifier,
  postingDate: AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  description: Description,
  rationale: Description,
  taxAssessment: Schema.Literal("not_applicable"),
  lines: Schema.Array(JournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(500)),
});
export const CreateEvidence = Schema.Struct({
  title: Description,
  content: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65536)),
  mediaType: Schema.Literals(["text/plain", "application/json"]),
  origin: Description,
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
      actions: Schema.Array(PostingAction),
    }),
  ),
  planDigest: Digest,
});
export const ApproveChange = Schema.Struct({ planDigest: Digest, version: Schema.Literal(1) });
export const Approval = Schema.Struct({
  id: Identifier,
  changeSetId: Identifier,
  planDigest: Digest,
  actorId: Identifier,
  expiresAt: Schema.String,
});
export const ExecuteChange = Schema.Struct({
  ...ApproveChange.fields,
  approvalId: Identifier,
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
export const PrepareCorrection = Schema.Struct({
  accountingPeriodId: Identifier,
  postingDate: AccountingDate,
  rationale: Description,
});
export const Voucher = Schema.Struct({
  id: Identifier,
  number: MinorUnits,
  sequence: MinorUnits,
  recordedAt: Schema.String,
  action: PostingAction,
});
export const Book = Schema.Struct({
  entityId: Identifier,
  id: Identifier,
  name: Schema.String,
  currency: Schema.String,
  profile: Schema.String,
  role: Schema.Literals(["operator", "agent"]),
  sequence: MinorUnits,
});
export const BookSetup = Schema.Struct({
  accounts: Schema.Array(
    Schema.Struct({
      id: Identifier,
      code: Schema.String,
      name: Schema.String,
      active: Schema.Boolean,
    }),
  ),
  periods: Schema.Array(
    Schema.Struct({
      id: Identifier,
      startsOn: AccountingDate,
      endsOn: AccountingDate,
      locked: Schema.Boolean,
    }),
  ),
  blockers: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
});
export const PageQuery = Schema.Struct({ after: Schema.optional(MinorUnits) });
export const VoucherPage = Schema.Struct({
  items: Schema.Array(Voucher),
  next: Schema.NullOr(MinorUnits),
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
export const FailureCode = Schema.Literals([
  "Unauthorized",
  "Forbidden",
  "NotFound",
  "InvalidJournal",
  "MissingEvidence",
  "PeriodLocked",
  "StaleDependency",
  "IdempotencyConflict",
  "AlreadyPosted",
  "ApprovalRequired",
  "UnsupportedProfile",
  "Unavailable",
  "InternalError",
]);
export class AccountingError extends Schema.TaggedError<AccountingError>()("AccountingError", {
  code: FailureCode,
  message: Schema.String,
}) {}

export const BookStatus = Schema.Struct({
  scope: Scope,
  profile: Schema.String,
  writerAuthority: Schema.String,
  sequence: MinorUnits,
  productionReady: Schema.Literal(false),
  verification: Schema.Literal("not_verified"),
  features: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      installed: Schema.Boolean,
      available: Schema.Boolean,
      limitation: Schema.String,
    }),
  ),
  blockers: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      message: Schema.String,
      requiredInputs: Schema.Array(Schema.String),
    }),
  ),
});
