import * as Schema from "effect/Schema";
import { Identifier, AccountingDate, Description, Digest } from "@open-erp/domain/values";
import { MinorUnits } from "@open-erp/domain/money";
import { JournalLine, Voucher } from "@open-erp/domain/ledger";

export { Identifier, AccountingDate, Description, Digest, Scope } from "@open-erp/domain/values";
export { MinorUnits, SignedMinorUnits, AggregateMinorUnits } from "@open-erp/domain/money";
export { FailureCode, AccountingError } from "@open-erp/domain/errors";
export {
  JournalLine,
  Evidence,
  EvidenceContent,
  Dependency,
  PostingAction,
  ChangeSet,
  Approval,
  ExecutionReceipt,
  Voucher,
  LedgerSnapshot,
  ValidationReport,
} from "@open-erp/domain/ledger";
export { Book, BookSetup, BookStatus } from "@open-erp/domain/books";

export const ChangePath = Schema.Struct({
  entityId: Identifier,
  bookId: Identifier,
  id: Identifier,
});

export const IdempotencyHeaders = Schema.Struct({
  "idempotency-key": Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{8,128}$/)),
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

export const ApproveChange = Schema.Struct({ planDigest: Digest, version: Schema.Literal(1) });

export const ExecuteChange = Schema.Struct({
  ...ApproveChange.fields,
  approvalId: Identifier,
});

export const PrepareCorrection = Schema.Struct({
  accountingPeriodId: Identifier,
  postingDate: AccountingDate,
  rationale: Description,
});

export const PageQuery = Schema.Struct({ after: Schema.optional(MinorUnits) });

export const VoucherPage = Schema.Struct({
  items: Schema.Array(Voucher),
  next: Schema.NullOr(MinorUnits),
});
