import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors as errors } from "./accounting-errors";
import { ReportRole } from "./reports";

// NEXT-45 owner contract: a direct cash-flow statement with a full
// reconciliation bridge to actual closing cash.
//
// The reviewed inputs are the account role bindings and the two sets this
// module requires a reviewer to declare: the cash perimeter and the
// exchange-effect accounts. Nothing is inferred from an account name and no
// role is guessed. A cash row whose counterpart cannot be resolved from the
// reviewed basis stays unclassified, and the report is then not complete.

export const CashFlowMapping = Schema.Struct({
  version: Schema.Literal("cash_flow_mapping_v1"),
  reviewed: Schema.Literal(true),
  perimeterAccountIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
    Schema.isUnique(),
  ),
  accountRoleRules: Schema.Array(
    Schema.Struct({ accountId: Accounting.Identifier, role: ReportRole }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  exchangeEffectAccountIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMaxLength(100),
    Schema.isUnique(),
  ),
});

export type CashFlowMapping = typeof CashFlowMapping.Type;

// Opening and actual closing cash are deliberately absent from this payload.
// The owner derives both from retained postings inside its own transaction, so
// a client cannot state an amount. Supplying them here would make the
// reconciliation bridge agree with whatever the caller asked for.
export const PrepareCashFlowStatement = Schema.Struct({
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  mapping: CashFlowMapping,
});

export type PrepareCashFlowStatement = typeof PrepareCashFlowStatement.Type;

export const CashFlowRowKind = Schema.Literals([
  "external",
  "internal_transfer",
  "valuation_effect",
  "perimeter_change",
]);

export type CashFlowRowKind = typeof CashFlowRowKind.Type;

export const CashFlowActivity = Schema.Literals(["operating", "investing", "financing"]);

export type CashFlowActivity = typeof CashFlowActivity.Type;

// One retained cash component with the exact evidence used to classify it. A
// row is exposed whether it classified cleanly or not, so a reviewer can reach
// the original journal line and the reason it stayed unresolved.
export const CashFlowLine = Schema.Struct({
  rowId: Accounting.Identifier,
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  accountId: Accounting.Identifier,
  signedCashMinor: Accounting.SignedMinorUnits,
  kind: CashFlowRowKind,
  activity: Schema.NullOr(CashFlowActivity),
  originRef: Schema.NullOr(Accounting.Identifier),
  transferId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  witnessRef: Schema.NullOr(Accounting.Identifier),
  reason: Schema.NullOr(Schema.String),
});

export type CashFlowLine = typeof CashFlowLine.Type;

export const CashFlowTotals = Schema.Struct({
  operatingNetMinor: Accounting.SignedMinorUnits,
  investingNetMinor: Accounting.SignedMinorUnits,
  financingNetMinor: Accounting.SignedMinorUnits,
  exchangeEffectsMinor: Accounting.SignedMinorUnits,
  perimeterChangesMinor: Accounting.SignedMinorUnits,
  expectedClosingMinor: Accounting.SignedMinorUnits,
  actualClosingMinor: Accounting.SignedMinorUnits,
  reconciliationDifferenceMinor: Accounting.SignedMinorUnits,
});

export type CashFlowTotals = typeof CashFlowTotals.Type;

export const CashFlowStatementReport = Schema.Struct({
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  openingCashMinor: Accounting.SignedMinorUnits,
  totals: CashFlowTotals,
  lines: Schema.Array(CashFlowLine).check(Schema.isMaxLength(5000)),
  unclassifiedRowIds: Schema.Array(Accounting.Identifier),
  complete: Schema.Boolean,
  sourceControlsComplete: Schema.Boolean,
  // Ledger-only scope, stated explicitly: periodCoverageComplete proves the
  // retained periods tile the interval, not that bank sources were imported
  // or confirmed. independentSourceControlsComplete stays false until a
  // bank-source attestation owner exists; complete means ledger arithmetic
  // classified and reconciled over that tiled population, not independently
  // reconciled cash. recordedCutoff is the real database instant the owner
  // read, never a fixed sentinel.
  periodCoverageComplete: Schema.Boolean,
  independentSourceControlsComplete: Schema.Boolean,
  recordedCutoff: Schema.String,
  basisDigest: Accounting.Digest,
  ledgerBoundary: Accounting.MinorUnits,
});

export type CashFlowStatementReport = typeof CashFlowStatementReport.Type;

const bookPath = "/v1/entities/:entityId/books/:bookId";

const scoped = { params: Accounting.Scope, error: errors } as const;

export const CashFlowApi = HttpApiGroup.make("cashFlow").add(
  HttpApiEndpoint.post("prepareCashFlowStatement", `${bookPath}/cash-flow`, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareCashFlowStatement,
    success: CashFlowStatementReport,
    error: errors,
  }),
);

// Agent surface. Read-only and deliberately narrow: an agent may ask what the
// retained cash movements classify as, and may reach every line and its
// evidence, but it may not name an account as cash, supply an amount, or assert
// that the statement is complete. The report's own completeness flag is the
// authority on that, and it is derived from retained data.
export const CashFlowCapabilities = {
  reports_cash_flow_statement: {
    description:
      "Classify retained posted cash movements into operating, investing and financing under one reviewed cash perimeter, and reconcile opening cash plus those flows plus exchange and perimeter bridges to actual closing cash. This is a ledger-only report: complete means the tiled ledger population classified and reconciled, while independentSourceControlsComplete stays false until a bank-source attestation owner exists. Opening and closing cash are derived from retained postings, never supplied. A row that cannot be resolved from the reviewed basis stays unclassified and makes complete false; read that flag rather than inferring completeness. Presentation and statutory applicability are not established by this result.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      input: PrepareCashFlowStatement,
    }),
    output: CashFlowStatementReport,
    readOnly: true,
  },
};
