import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors as errors } from "./accounting-errors";
import {
  StatementBalance,
  StatementCalculationNode,
  StatementContribution,
  StatementCoverage,
  StatementDiagnostic,
  StatementFiscalYear,
  StatementInterval,
  StatementMapping,
  StatementModelRow,
  StatementOpeningBasis,
  StatementFactRevisions,
  SealedStatementMapping,
} from "@open-erp/domain/statements";

export {
  StatementBalance,
  StatementContribution,
  StatementCoverage,
  StatementDiagnostic,
  StatementFiscalYear,
  StatementInterval,
  StatementKind,
  StatementMapping,
  StatementModelRow,
  StatementOpeningBasis,
  StatementRole,
  StatementSubtotal,
  StatementSubtotalMember,
  SealedStatementMapping,
  StatementAccount,
  StatementComponent,
  StatementOpeningLine,
  StatementOutcome,
  StatementFactRevisions,
  VirtualResultRowId,
} from "@open-erp/domain/statements";

export const StatementComparisonMode = Schema.Literal(
  "own_mapping_with_classification_change_display",
);

export const PrepareStatementSnapshot = Schema.Struct({
  fiscalYearId: Accounting.Identifier,
  asOf: Accounting.AccountingDate,
  plStartsOn: Accounting.AccountingDate,
  plEndsOn: Accounting.AccountingDate,
  mapping: StatementMapping,
});

// A statement snapshot is a read-only artifact. It carries its own receipt and
// never a journal, voucher number or approval use, so a genuinely zero result
// is recorded as a no-effect receipt rather than a fabricated entry.
export const StatementReceipt = Schema.Struct({
  key: Schema.String,
  operation: Schema.Literal("prepare_statement_snapshot"),
  actorId: Schema.String,
});

export const StatementSnapshot = Schema.Struct({
  kind: Schema.Literal("semantic_statement_v1"),
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  fiscalYear: StatementFiscalYear,
  asOf: Accounting.AccountingDate,
  plInterval: StatementInterval,
  ledgerBoundary: Accounting.MinorUnits,
  recordedCutoff: Schema.String,
  currency: Schema.String,
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  openingBasis: StatementOpeningBasis,
  factRevisions: StatementFactRevisions,
  mappingRelease: SealedStatementMapping,
  balance: StatementBalance,
  coverage: StatementCoverage,
  diagnostics: Schema.Array(StatementDiagnostic).check(Schema.isMaxLength(1000)),
  calculationNodes: Schema.Array(StatementCalculationNode).check(Schema.isMaxLength(200)),
  rowCount: Schema.Int,
  contributionCount: Schema.Int,
  noFinancialEffect: Schema.Boolean,
  createdAt: Schema.String,
  receipt: StatementReceipt,
});

export const StatementRowCursor = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,9}$/, {
    message: "Use the row cursor returned for this snapshot. Omit after to restart the rows.",
  }),
);

export const StatementLiveStatus = Schema.Struct({
  checkedAt: Schema.String,
  bookSequence: Accounting.MinorUnits,
  postingsAfterCutoff: Schema.Int,
  invalidatedByReopen: Schema.Boolean,
  currentForCurrentBooks: Schema.Boolean,
});

export const StatementSnapshotPage = Schema.Struct({
  snapshot: StatementSnapshot,
  live: StatementLiveStatus,
  order: Schema.Literal("retained_row_ordinal"),
  statementFilter: Schema.NullOr(StatementModelRow.fields.statement),
  total: Schema.Int,
  items: Schema.Array(StatementModelRow).check(Schema.isMaxLength(100)),
  next: Schema.NullOr(StatementRowCursor),
});

export const StatementRowPath = Schema.Struct({
  ...Accounting.ChangePath.fields,
  rowId: Accounting.Identifier,
});

export const StatementContributionCursor = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,9}$/, {
    message: "Use the contribution cursor returned for this snapshot and row.",
  }),
);

export const StatementRowExplanation = Schema.Struct({
  snapshotId: Accounting.Identifier,
  row: StatementModelRow,
  kind: Schema.Literals(["frozen_contributions", "calculated_children"]),
  movementFormula: Schema.Literal("signed = debits - credits"),
  amountFormula: Schema.Literal("amount = closing * presentation sign"),
  totalContributions: Schema.Int,
  items: Schema.Array(StatementContribution).check(Schema.isMaxLength(100)),
  childRowIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(200)),
  next: Schema.NullOr(StatementContributionCursor),
});

export const StatementComparisonPath = Schema.Struct({
  ...Accounting.ChangePath.fields,
  otherId: Accounting.Identifier,
});

export const StatementComparisonCursor = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$/, {
    message: "Use the row cursor returned for this comparison.",
  }),
);

export const StatementComparisonQuery = Schema.Struct({
  after: Schema.optional(StatementComparisonCursor),
});

const StatementAmounts = Schema.Struct({
  amountMinor: Accounting.SignedMinorUnits,
  closingMinor: Accounting.SignedMinorUnits,
});

const StatementComparisonTotals = Schema.Struct({
  amountMinor: Accounting.SignedMinorUnits,
  closingMinor: Accounting.SignedMinorUnits,
});

export const StatementComparison = Schema.Struct({
  left: Schema.Struct({ snapshot: StatementSnapshot, digest: Accounting.Digest }),
  right: Schema.Struct({ snapshot: StatementSnapshot, digest: Accounting.Digest }),
  mode: StatementComparisonMode,
  order: Schema.Literal("row_identity"),
  differenceFormula: Schema.Literal("difference = right - left"),
  sameCurrencyUnit: Schema.Boolean,
  sameMapping: Schema.Boolean,
  total: Schema.Int,
  totals: Schema.Struct({
    left: StatementComparisonTotals,
    right: StatementComparisonTotals,
    difference: Schema.NullOr(StatementComparisonTotals),
  }),
  items: Schema.Array(
    Schema.Struct({
      rowId: Accounting.Identifier,
      presence: Schema.Literals(["both", "left_only", "right_only"]),
      left: Schema.NullOr(StatementModelRow),
      right: Schema.NullOr(StatementModelRow),
      classificationChanged: Schema.NullOr(Schema.Boolean),
      difference: Schema.NullOr(StatementAmounts),
    }),
  ).check(Schema.isMaxLength(100)),
  next: Schema.NullOr(StatementComparisonCursor),
  warnings: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
});

export const StatementSnapshotList = Schema.Struct({
  items: Schema.Array(StatementSnapshot).check(Schema.isMaxLength(50)),
  next: Schema.NullOr(Accounting.Identifier),
});

export const StatementCapabilities = {
  reports_prepare_statement: {
    description:
      "Capture retained ledger facts under one reviewed statement mapping and seal an immutable semantic profit-and-loss and balance-sheet snapshot. The result is arithmetic and coverage only; the company profile, reviewed opening and external completeness are not established.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareStatementSnapshot,
    }),
    output: StatementSnapshot,
    readOnly: false,
  },
  reports_get_statement: {
    description:
      "Read one frozen statement snapshot, its retained rows, full-scope totals, diagnostics and basis, plus separately computed live status. A later backdated posting cannot change the saved model.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      snapshotId: Accounting.Identifier,
      statement: Schema.optional(StatementModelRow.fields.statement),
      after: Schema.optional(StatementRowCursor),
    }),
    output: StatementSnapshotPage,
    readOnly: true,
  },
  reports_explain_statement_row: {
    description:
      "Explain one frozen statement row through its retained contribution identities, or through its calculated child rows when the row is computed. Follow next until null.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      snapshotId: Accounting.Identifier,
      rowId: Accounting.Identifier,
      after: Schema.optional(StatementContributionCursor),
    }),
    output: StatementRowExplanation,
    readOnly: true,
  },
  reports_compare_statements: {
    description:
      "Compare two frozen statement snapshots in one currency unit with exact right-minus-left changes. Each side keeps its own mapping; a changed classification is displayed, never edited away. Follow next until null.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      snapshotId: Accounting.Identifier,
      otherId: Accounting.Identifier,
      ...StatementComparisonQuery.fields,
    }),
    output: StatementComparison,
    readOnly: true,
  },
  reports_list_statements: {
    description:
      "Rediscover retained statement snapshots in this book. Follow next until null. This is a live inventory, not a completeness claim.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      after: Schema.optional(Accounting.Identifier),
    }),
    output: StatementSnapshotList,
    readOnly: true,
  },
};

const scoped = { params: Accounting.Scope, error: errors };

const identified = { params: Accounting.ChangePath, error: errors };

const base = "/v1/entities/:entityId/books/:bookId/statement-snapshots";

export const StatementApi = HttpApiGroup.make("reportStatements").add(
  HttpApiEndpoint.post("prepareStatementSnapshot", base, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareStatementSnapshot.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: StatementSnapshot,
  }),
  HttpApiEndpoint.get("listStatementSnapshots", base, {
    ...scoped,
    query: Schema.Struct({ after: Schema.optional(Accounting.Identifier) }),
    success: StatementSnapshotList,
  }),
  HttpApiEndpoint.get("getStatementSnapshot", `${base}/:id`, {
    ...identified,
    query: Schema.Struct({
      statement: Schema.optional(StatementModelRow.fields.statement),
      after: Schema.optional(StatementRowCursor),
    }),
    success: StatementSnapshotPage,
  }),
  HttpApiEndpoint.get("explainStatementRow", `${base}/:id/rows/:rowId`, {
    params: StatementRowPath,
    error: errors,
    query: Schema.Struct({ after: Schema.optional(StatementContributionCursor) }),
    success: StatementRowExplanation,
  }),
  HttpApiEndpoint.get("compareStatementSnapshots", `${base}/:id/compare/:otherId`, {
    params: StatementComparisonPath,
    error: errors,
    query: StatementComparisonQuery,
    success: StatementComparison,
  }),
);
