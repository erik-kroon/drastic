import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors as errors } from "./accounting-errors";

export const ReportFamily = Schema.Literals(["profit_and_loss", "balance_sheet", "cash_flow"]);
export const ReportRole = Schema.Literals([
  "excluded",
  "revenue",
  "other_income",
  "cost_of_sales",
  "operating_expense",
  "other_expense",
  "income_tax",
  "cash_and_cash_equivalents",
  "accounts_receivable",
  "inventory",
  "other_current_assets",
  "property_plant_and_equipment",
  "other_non_current_assets",
  "accounts_payable",
  "accrued_liabilities",
  "tax_liabilities",
  "other_current_liabilities",
  "long_term_debt",
  "other_non_current_liabilities",
  "equity",
  "operating_cash_inflow",
  "operating_cash_outflow",
  "investing_cash_inflow",
  "investing_cash_outflow",
  "financing_cash_inflow",
  "financing_cash_outflow",
  "excluded",
]);
export const ReportMapping = Schema.Struct({
  version: Schema.Literal("synthetic_report_mapping_v1"),
  reviewed: Schema.Literal(true),
  roles: Schema.Array(
    Schema.Struct({
      accountId: Accounting.Identifier,
      role: ReportRole,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});
export const PrepareReport = Schema.Struct({
  kind: Schema.Literal("trial_balance_v1"),
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});
export const PrepareReportFamily = Schema.Struct({
  kind: ReportFamily,
  sourceReportId: Accounting.Identifier,
  mapping: ReportMapping,
});
export const ReportKind = Schema.Literals([
  "trial_balance_v1",
  "profit_and_loss",
  "balance_sheet",
  "cash_flow",
]);
export const ReportCutoff = Schema.Struct({
  sequence: Accounting.MinorUnits,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});
export const ReportSnapshot = Schema.Struct({
  kind: ReportKind,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  sequence: Accounting.MinorUnits,
  currency: Schema.String,
  // Only new snapshots retain scale; old headers and exact-key replays remain readable.
  currencyScale: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }))),
  createdAt: Schema.String,
  accountCount: Schema.Int,
  voucherCount: Schema.Int,
  debitMinor: Accounting.AggregateMinorUnits,
  creditMinor: Accounting.AggregateMinorUnits,
  balanced: Schema.Boolean,
  coverage: Schema.Literal("not_established"),
  warnings: Schema.Array(Schema.String),
  sourceReportId: Schema.optional(Accounting.Identifier),
  family: Schema.optional(ReportFamily),
  mapping: Schema.optional(ReportMapping),
  mappingDigest: Schema.optional(Accounting.Digest),
  reviewedOpening: Schema.optional(Schema.Literal(false)),
  statutory: Schema.optional(Schema.Literal(false)),
  financialClose: Schema.optional(Schema.Literal(false)),
});
export const ReportFamilyLine = Schema.Struct({
  id: Accounting.Identifier,
  label: Schema.String,
  accountIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(500)),
  openingMinor: Accounting.SignedMinorUnits,
  movementMinor: Accounting.SignedMinorUnits,
  closingMinor: Accounting.SignedMinorUnits,
  amountMinor: Accounting.SignedMinorUnits,
});
export const ReportFamilyTotals = Schema.Struct({
  openingMinor: Accounting.SignedMinorUnits,
  movementMinor: Accounting.SignedMinorUnits,
  closingMinor: Accounting.SignedMinorUnits,
  amountMinor: Accounting.SignedMinorUnits,
});
export const ReportFamilySnapshot = Schema.Struct({
  report: ReportSnapshot,
  family: ReportFamily,
  sourceReportId: Accounting.Identifier,
  cutoff: ReportCutoff,
  mapping: ReportMapping,
  mappingDigest: Accounting.Digest,
  lines: Schema.Array(ReportFamilyLine).check(Schema.isMaxLength(100)),
  totals: ReportFamilyTotals,
  interpretation: Schema.Literal("synthetic_reviewed_mapping_only"),
  coverage: Schema.Literal("not_established"),
  reviewedOpening: Schema.Literal(false),
  statutory: Schema.Literal(false),
  financialClose: Schema.Literal(false),
  warnings: Schema.Array(Schema.String),
});
export const ReportSnapshotPage = Schema.Struct({
  items: Schema.Array(ReportSnapshot).check(Schema.isMaxLength(50)),
  next: Schema.NullOr(Accounting.Identifier),
});
export const ReportLine = Schema.Struct({
  accountId: Accounting.Identifier,
  code: Schema.String,
  name: Schema.String,
  openingMinor: Accounting.SignedMinorUnits,
  debitMinor: Accounting.AggregateMinorUnits,
  creditMinor: Accounting.AggregateMinorUnits,
  closingMinor: Accounting.SignedMinorUnits,
});
export const ReportLines = Schema.Struct({
  reportId: Accounting.Identifier,
  total: Schema.Int,
  items: Schema.Array(ReportLine),
  next: Schema.NullOr(Accounting.Identifier),
});
export const Contribution = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  sequence: Accounting.MinorUnits,
  ordinal: Schema.Int,
  postingDate: Accounting.AccountingDate,
  part: Schema.Literals(["opening", "movement"]),
  description: Schema.String,
  debitMinor: Accounting.MinorUnits,
  creditMinor: Accounting.MinorUnits,
  evidenceRefs: Accounting.PostingAction.fields.evidenceRefs,
});
export const ExplanationCursor = Schema.String.check(
  Schema.isPattern(
    /^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,18}:[1-9][0-9]{0,9}$/,
    {
      message:
        "Use the contribution cursor returned for this report and account. Omit after to restart the explanation.",
    },
  ),
);
export const ReportExplanation = Schema.Struct({
  report: ReportSnapshot,
  line: ReportLine,
  formula: Schema.Literal("closing = opening + debits - credits"),
  totalContributions: Schema.Int,
  items: Schema.Array(Contribution),
  next: Schema.NullOr(ExplanationCursor),
});
export const GeneralLedgerCursor = Schema.String.check(
  Schema.isPattern(
    /^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,18}:[1-9][0-9]{0,9}$/,
  ),
);
export const GeneralLedgerQuery = Schema.Struct({ after: Schema.optional(GeneralLedgerCursor) });
export const GeneralLedgerEntry = Schema.Struct({
  ...Contribution.fields,
  part: Schema.Literal("movement"),
  series: Schema.String,
  voucherNumber: Accounting.MinorUnits,
  postingPurpose: Schema.String,
  correctsVoucherId: Schema.NullOr(Accounting.Identifier),
  runningBalanceMinor: Accounting.SignedMinorUnits,
});
export const GeneralLedgerPage = Schema.Struct({
  report: ReportSnapshot,
  line: ReportLine,
  order: Schema.Literal("committed_sequence_then_line_ordinal"),
  formula: Schema.Literal("balance = opening + debits - credits"),
  totalMovements: Schema.Int,
  pageOpeningMinor: Accounting.SignedMinorUnits,
  pageClosingMinor: Accounting.SignedMinorUnits,
  items: Schema.Array(GeneralLedgerEntry).check(Schema.isMaxLength(100)),
  next: Schema.NullOr(GeneralLedgerCursor),
});
export const LinesQuery = Schema.Struct({ after: Schema.optional(Accounting.Identifier) });
export const ExplanationQuery = Schema.Struct({
  after: Schema.optional(ExplanationCursor),
});
export const ExplanationPath = Schema.Struct({
  ...Accounting.ChangePath.fields,
  lineId: Accounting.Identifier,
});
export const ReportComparisonCursor = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$/),
);
export const ReportComparisonQuery = Schema.Struct({
  after: Schema.optional(ReportComparisonCursor),
});
export const ReportComparisonPath = Schema.Struct({
  ...Accounting.ChangePath.fields,
  otherId: Accounting.Identifier,
});
const ComparisonAmounts = Schema.Struct({
  openingMinor: Accounting.SignedMinorUnits,
  debitMinor: Accounting.SignedMinorUnits,
  creditMinor: Accounting.SignedMinorUnits,
  movementMinor: Accounting.SignedMinorUnits,
  closingMinor: Accounting.SignedMinorUnits,
});
const ComparisonSource = Schema.Struct({
  report: ReportSnapshot,
  digest: Accounting.Digest,
  digestScope: Schema.Literal("saved_header_and_account_lines"),
});
const ComparisonLine = Schema.Struct({
  ...ReportLine.fields,
  movementMinor: Accounting.SignedMinorUnits,
});
export const ReportComparisonPage = Schema.Struct({
  left: ComparisonSource,
  right: ComparisonSource,
  currency: Schema.String,
  currencyScale: Schema.Int,
  order: Schema.Literal("account_identity"),
  differenceFormula: Schema.Literal("difference = right - left"),
  movementFormula: Schema.Literal("movement = debits - credits"),
  closingFormula: Schema.Literal("closing = opening + debits - credits"),
  sameInterval: Schema.Boolean,
  sameCutoff: Schema.Boolean,
  totalAccounts: Schema.Int,
  bothPresentCount: Schema.Int,
  leftOnlyCount: Schema.Int,
  rightOnlyCount: Schema.Int,
  totals: Schema.Struct({
    left: ComparisonAmounts,
    right: ComparisonAmounts,
    difference: Schema.NullOr(ComparisonAmounts),
  }),
  items: Schema.Array(
    Schema.Struct({
      accountId: Accounting.Identifier,
      presence: Schema.Literals(["both", "left_only", "right_only"]),
      left: Schema.NullOr(ComparisonLine),
      right: Schema.NullOr(ComparisonLine),
      labelsChanged: Schema.NullOr(Schema.Boolean),
      difference: Schema.NullOr(ComparisonAmounts),
    }),
  ).check(Schema.isMaxLength(100)),
  next: Schema.NullOr(ReportComparisonCursor),
  interpretation: Schema.Literal("saved_snapshot_arithmetic_only"),
  coverage: Schema.Literal("not_established"),
  reviewedOpening: Schema.Literal(false),
  statutoryComparability: Schema.Literal(false),
  financialCloseReady: Schema.Literal(false),
  warnings: Schema.Array(Schema.String),
});
export const ReportFamilyCapabilities = {
  reports_prepare_family: {
    description:
      "Prepare an immutable synthetic profit-and-loss, balance-sheet or cash-flow family from one saved trial-balance snapshot and an explicit reviewed account-role mapping. The saved cutoff, currency and scale are inherited; no account role is inferred.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareReportFamily,
    }),
    output: ReportFamilySnapshot,
    readOnly: false,
  },
  reports_get_family: {
    description:
      "Read one immutable synthetic report-family snapshot with its saved cutoff, reviewed mapping, fixed report lines and full mapped totals. It never claims reviewed opening, statutory status or financial-close readiness.",
    input: Schema.Struct({ scope: Accounting.Scope, reportId: Accounting.Identifier }),
    output: ReportFamilySnapshot,
    readOnly: true,
  },
};
// Kept local to report ownership; root composes this read-only capability into the registry.
export const ReportComparisonCapabilities = {
  reports_compare: {
    input: Schema.Struct({
      scope: Accounting.Scope,
      leftReportId: Accounting.Identifier,
      rightReportId: Accounting.Identifier,
      ...ReportComparisonQuery.fields,
    }),
    output: ReportComparisonPage,
    readOnly: true,
    description:
      "Compare two immutable saved synthetic report snapshots with exact right-minus-left signed differences, frozen account labels and explicit missing sides. Stable paged union with full-source totals; never reviewed opening, statutory comparability or financial close readiness.",
  },
};
const scoped = { params: Accounting.Scope, error: errors };
const identified = { params: Accounting.ChangePath, error: errors };
const familyPath = "/v1/entities/:entityId/books/:bookId/report-family-snapshots";
export const ReportApi = HttpApiGroup.make("reports").add(
  HttpApiEndpoint.post("prepareReportFamily", familyPath, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareReportFamily.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ReportFamilySnapshot,
  }),
  HttpApiEndpoint.get("getReportFamily", `${familyPath}/:id`, {
    ...identified,
    success: ReportFamilySnapshot,
  }),
  HttpApiEndpoint.get(
    "compareReports",
    "/v1/entities/:entityId/books/:bookId/report-snapshots/:id/compare/:otherId",
    {
      params: ReportComparisonPath,
      error: errors,
      query: ReportComparisonQuery,
      success: ReportComparisonPage,
    },
  ),
  HttpApiEndpoint.get("listReports", "/v1/entities/:entityId/books/:bookId/report-snapshots", {
    ...scoped,
    query: LinesQuery,
    success: ReportSnapshotPage,
  }),
  HttpApiEndpoint.post("prepareReport", "/v1/entities/:entityId/books/:bookId/report-snapshots", {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareReport.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ReportSnapshot,
  }),
  HttpApiEndpoint.get("getReport", "/v1/entities/:entityId/books/:bookId/report-snapshots/:id", {
    ...identified,
    success: ReportSnapshot,
  }),
  HttpApiEndpoint.get(
    "reportLines",
    "/v1/entities/:entityId/books/:bookId/report-snapshots/:id/lines",
    {
      ...identified,
      query: LinesQuery,
      success: ReportLines,
    },
  ),
  HttpApiEndpoint.get(
    "reportGeneralLedger",
    "/v1/entities/:entityId/books/:bookId/report-snapshots/:id/lines/:lineId/general-ledger",
    {
      params: ExplanationPath,
      error: errors,
      query: GeneralLedgerQuery,
      success: GeneralLedgerPage,
    },
  ),
  HttpApiEndpoint.get(
    "reportExplanation",
    "/v1/entities/:entityId/books/:bookId/report-snapshots/:id/lines/:lineId/explanation",
    {
      params: ExplanationPath,
      error: errors,
      query: ExplanationQuery,
      success: ReportExplanation,
    },
  ),
);
