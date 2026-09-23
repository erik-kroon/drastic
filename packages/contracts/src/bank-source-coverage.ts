import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { BankStatement, CommandReceipt } from "./reconciliation";
import { ClosingInventory } from "./closing";

export const CreateBankSourceCoverage = Schema.Struct({
  inventoryId: Accounting.Identifier,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});
export const BankSourceCoverageDiagnostic = Schema.Literals([
  "no_declared_accounts", "mapped_account_not_declared", "source_mapping_missing", "statements_missing",
  "statement_declared_incomplete", "statement_crosses_boundary", "source_identity_or_currency_mismatch",
  "statement_balance_difference", "statement_row_count_difference",
  "opening_checkpoint_unavailable", "closing_checkpoint_unavailable",
]);
const interval = { startsOn: Accounting.AccountingDate, endsOn: Accounting.AccountingDate };
export const BankCoverageStatement = Schema.Struct({
  statement: BankStatement,
  movementMinor: Accounting.SignedMinorUnits,
  movementDifferenceMinor: Accounting.SignedMinorUnits,
  observedRowCount: Schema.Int,
  cutsRequestedBoundary: Schema.Boolean,
  diagnostics: Schema.Array(BankSourceCoverageDiagnostic),
});
export const BankCoverageAccount = Schema.Struct({
  accountId: Accounting.Identifier,
  code: Schema.String,
  name: Schema.String,
  active: Schema.Boolean,
  accountVersion: Accounting.MinorUnits,
  declared: Schema.Boolean,
  sourceBankAccountId: Schema.NullOr(Schema.String),
  sourceRevision: Schema.NullOr(Accounting.MinorUnits),
  statements: Schema.Array(BankCoverageStatement),
  gaps: Schema.Array(Schema.Struct(interval)),
  overlaps: Schema.Array(Schema.Struct({
    leftStatementId: Accounting.Identifier, rightStatementId: Accounting.Identifier, ...interval,
  })),
  adjacentBalances: Schema.Array(Schema.Struct({
    leftStatementId: Accounting.Identifier,
    rightStatementId: Accounting.Identifier,
    leftClosingMinor: Accounting.SignedMinorUnits,
    rightOpeningMinor: Accounting.SignedMinorUnits,
    differenceMinor: Accounting.SignedMinorUnits,
  })),
  openingMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  closingMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  diagnostics: Schema.Array(BankSourceCoverageDiagnostic),
  hasReviewGaps: Schema.Boolean,
});
export const BankSourceCoverageReport = Schema.Struct({
  id: Accounting.Identifier,
  kind: Schema.Literal("synthetic_bank_source_coverage_v1"),
  scope: Accounting.Scope,
  input: CreateBankSourceCoverage,
  inventory: ClosingInventory,
  period: Schema.Struct({
    id: Accounting.Identifier, version: Accounting.MinorUnits, ...interval, locked: Schema.Boolean,
  }),
  currency: Schema.String,
  currencyScale: Schema.Int,
  sequence: Accounting.MinorUnits,
  dependencyDigest: Accounting.Digest,
  accounts: Schema.Array(BankCoverageAccount).check(Schema.isMaxLength(100)),
  diagnostics: Schema.Array(BankSourceCoverageDiagnostic),
  hasReviewGaps: Schema.Boolean,
  coverage: Schema.Literal("not_established"),
  financialCloseReady: Schema.Literal(false),
  knowledgeBasis: Schema.Literal("current_known_facts_at_capture"),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
export const BankSourceCoverageView = Schema.Struct({
  report: BankSourceCoverageReport,
  dependenciesCurrent: Schema.Boolean,
  artifact: Schema.Struct({
    content: Schema.String,
    sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8388608 })),
    mediaType: Schema.Literal("application/json"),
  }),
});
export const BankSourceCoverageList = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(Schema.Struct({
    id: Accounting.Identifier,
    inventoryId: Accounting.Identifier,
    ...interval,
    createdAt: Schema.String,
    sequence: Accounting.MinorUnits,
    hasReviewGaps: Schema.Boolean,
    digest: Accounting.Digest,
  })).check(Schema.isMaxLength(200)),
  coverage: Schema.Literal("not_established"),
});
const path = "/v1/entities/:entityId/books/:bookId/bank-source-coverage";
export const BankSourceCoverageApi = HttpApiGroup.make("bankSourceCoverage").add(
  HttpApiEndpoint.post("createBankSourceCoverage", path, {
    params: Accounting.Scope, headers: Accounting.IdempotencyHeaders,
    payload: CreateBankSourceCoverage.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankSourceCoverageReport, error: accountingErrors,
  }),
  HttpApiEndpoint.get("listBankSourceCoverage", path, {
    params: Accounting.Scope, success: BankSourceCoverageList, error: accountingErrors,
  }),
  HttpApiEndpoint.get("getBankSourceCoverage", `${path}/:id`, {
    params: Accounting.ChangePath, success: BankSourceCoverageView, error: accountingErrors,
  }),
);
export const BankSourceCoverageCapabilities = {
  bank_create_source_coverage: {
    description: "Capture retained statement interval coverage for an existing reviewed closing inventory. Preserve gaps, overlaps, unavailable boundaries and independent balance diagnostics. Does not certify full-company coverage or close readiness.",
    input: Schema.Struct({ scope: Accounting.Scope, idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"], input: CreateBankSourceCoverage }),
    output: BankSourceCoverageReport,
    readOnly: false,
  },
  bank_get_source_coverage: {
    description: "Read immutable source coverage JSON bytes and separate currentness. Never recompute a historical report or treat unknown sources as zero.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: BankSourceCoverageView,
    readOnly: true,
  },
  bank_list_source_coverage: {
    description: "Discover all bounded saved source coverage reports in this book. This is report history, not a complete provider source inventory.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: BankSourceCoverageList,
    readOnly: true,
  },
};
