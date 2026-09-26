import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";

export const BankWorkspaceQuery = Schema.Struct({
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  accountId: Schema.optional(Accounting.Identifier),
  view: Schema.optional(Schema.Literals(["unmatched", "all", "matched", "ledger"])),
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  page: Schema.optional(Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/))),
});

export const BankWorkspaceAccount = Schema.Struct({
  id: Accounting.Identifier,
  code: Schema.String,
  name: Schema.String,
  active: Schema.Boolean,
  sourceName: Schema.String,
  statementId: Schema.NullOr(Accounting.Identifier),
  statementDate: Schema.NullOr(Accounting.AccountingDate),
  statementBalanceMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  ledgerBalanceMinor: Accounting.SignedMinorUnits,
  differenceMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  statementCount: Schema.Int,
  unmatchedCount: Schema.Int,
  unmatchedLedgerCount: Schema.Int,
});

export const BankWorkspaceRow = Schema.Struct({
  id: Schema.String,
  date: Accounting.AccountingDate,
  description: Schema.String,
  amountMinor: Accounting.SignedMinorUnits,
  allocatedMinor: Accounting.SignedMinorUnits,
  remainingMinor: Accounting.SignedMinorUnits,
  statementId: Schema.NullOr(Accounting.Identifier),
  rowOrdinal: Schema.NullOr(Schema.Int),
  voucherId: Schema.NullOr(Accounting.Identifier),
  lineId: Schema.NullOr(Accounting.Identifier),
});

export const BankWorkspace = Schema.Struct({
  scope: Accounting.Scope,
  currency: Schema.String,
  currencyScale: Schema.Int,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  checkedAt: Schema.String,
  accounts: Schema.Array(BankWorkspaceAccount),
  total: Schema.Int,
  page: Schema.Int,
  pageSize: Schema.Literal(50),
  counts: Schema.Struct({
    all: Schema.Int,
    unmatched: Schema.Int,
    matched: Schema.Int,
    ledger: Schema.Int,
  }),
  rows: Schema.Array(BankWorkspaceRow),
  reviews: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      reason: Schema.String,
      createdAt: Schema.String,
      completed: Schema.Boolean,
    }),
  ),
});
