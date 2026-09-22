import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors as errors } from "./accounting-errors";

const SourceKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const SignedAmount = Schema.String.check(Schema.isPattern(/^(0|-?[1-9][0-9]{0,37})$/));
export const RowOrdinal = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 }));
export const BankRow = Schema.Struct({
  rowOrdinal: RowOrdinal,
  providerId: Schema.NullOr(SourceKey),
  date: Accounting.AccountingDate,
  description: Accounting.Description,
  amountMinor: SignedAmount,
});
export const ExistingBankMatch = Schema.Struct({
  rowOrdinal: RowOrdinal,
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
});
export const StatementSource = Schema.Struct({
  kind: Schema.Literal("synthetic_bank_statement_v1"),
  statementIdentifier: SourceKey,
  sourceBankAccountId: SourceKey,
  accountId: Accounting.Identifier,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  openingMinor: SignedAmount,
  closingMinor: SignedAmount,
  completeness: Schema.Struct({ declaredComplete: Schema.Boolean, basis: Accounting.Description }),
  rows: Schema.Array(BankRow).check(Schema.isMaxLength(10000)),
});
export const ImportBankStatement = Schema.Struct({
  ...StatementSource.fields,
  evidenceId: Accounting.Identifier,
  existingMatches: Schema.Array(ExistingBankMatch).check(Schema.isMaxLength(10000)),
});
export const BankMatchInput = Schema.Struct({
  statementId: Accounting.Identifier,
  ...ExistingBankMatch.fields,
});
export const BankMatch = Schema.Struct({
  ...BankMatchInput.fields,
  origin: Schema.Literals(["imported", "explicit"]),
  actorId: Accounting.Identifier,
});
export const Checkpoint = Schema.Struct({
  sequence: Accounting.MinorUnits,
  sourceRevision: Accounting.MinorUnits,
});
export const CommandReceipt = Schema.Struct({
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  operation: Schema.String,
  actorId: Accounting.Identifier,
});
export const BankStatement = Schema.Struct({
  ...StatementSource.fields,
  id: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  evidenceSha256: Schema.String,
});
export const StatementImportReceipt = Schema.Struct({
  statement: BankStatement,
  matches: Schema.Array(BankMatch),
  checkpoint: Checkpoint,
  receipt: CommandReceipt,
});
export const BankStatementView = Schema.Struct({
  statement: BankStatement,
  matches: Schema.Array(BankMatch),
  checkpoint: Checkpoint,
});
export const BankMatchReceipt = Schema.Struct({
  match: BankMatch,
  checkpoint: Checkpoint,
  receipt: CommandReceipt,
});
export const ReconcileBank = Schema.Struct({
  accountId: Accounting.Identifier,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});
export const SourceObservation = Schema.Struct({
  statementId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  evidenceSha256: Schema.String,
  ...BankRow.fields,
});
export const BankLedgerLine = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  date: Accounting.AccountingDate,
  sequence: Accounting.MinorUnits,
  description: Accounting.Description,
  amountMinor: Accounting.SignedMinorUnits,
});
export const BankReconciliation = Schema.Struct({
  ...ReconcileBank.fields,
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  currency: Schema.String,
  status: Schema.Literals(["complete", "balanced_but_incomplete", "differences"]),
  checkpoint: Checkpoint,
  accountLedgerSequence: Accounting.MinorUnits,
  ledgerOpeningMinor: Accounting.SignedMinorUnits,
  ledgerClosingMinor: Accounting.SignedMinorUnits,
  bankOpeningMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  bankClosingMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  openingDifferenceMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  closingDifferenceMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  sourceCoverageComplete: Schema.Boolean,
  statements: Schema.Array(BankStatement),
  sourceRows: Schema.Array(SourceObservation),
  ledgerLines: Schema.Array(BankLedgerLine),
  matches: Schema.Array(BankMatch),
  unmatchedSource: Schema.Array(SourceObservation),
  unmatchedLedger: Schema.Array(BankLedgerLine),
  differences: Schema.Array(Schema.String),
  coverageGaps: Schema.Array(Schema.String),
  receipt: CommandReceipt,
  createdAt: Schema.String,
});
export const BankReconciliationView = Schema.Struct({
  report: BankReconciliation,
  fresh: Schema.Boolean,
  currentSourceRevision: Accounting.MinorUnits,
  currentAccountLedgerSequence: Accounting.MinorUnits,
});

const bookPath = "/v1/entities/:entityId/books/:bookId";
const scoped = { params: Accounting.Scope, error: errors };
const identified = { params: Accounting.ChangePath, error: errors };
const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };
export const ReconciliationApi = HttpApiGroup.make("reconciliation").add(
  HttpApiEndpoint.post("importBankStatement", `${bookPath}/bank-statements`, {
    ...mutation,
    payload: ImportBankStatement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: StatementImportReceipt,
  }),
  HttpApiEndpoint.get("getBankStatement", `${bookPath}/bank-statements/:id`, {
    ...identified,
    success: BankStatementView,
  }),
  HttpApiEndpoint.post("matchBankObservation", `${bookPath}/bank-matches`, {
    ...mutation,
    payload: BankMatchInput.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankMatchReceipt,
  }),
  HttpApiEndpoint.post("reconcileBank", `${bookPath}/bank-reconciliations`, {
    ...mutation,
    payload: ReconcileBank.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankReconciliation,
  }),
  HttpApiEndpoint.get("getBankReconciliation", `${bookPath}/bank-reconciliations/:id`, {
    ...identified,
    success: BankReconciliationView,
  }),
);
