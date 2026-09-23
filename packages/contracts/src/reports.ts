import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors as errors } from "./accounting-errors";

export const PrepareReport = Schema.Struct({
  kind: Schema.Literal("trial_balance_v1"),
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});
export const ReportSnapshot = Schema.Struct({
  ...PrepareReport.fields,
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
export const ReportExplanation = Schema.Struct({
  report: ReportSnapshot,
  line: ReportLine,
  formula: Schema.Literal("closing = opening + debits - credits"),
  totalContributions: Schema.Int,
  items: Schema.Array(Contribution),
  next: Schema.NullOr(Schema.String),
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
  after: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9]+:[0-9]+$/))),
});
export const ExplanationPath = Schema.Struct({
  ...Accounting.ChangePath.fields,
  lineId: Accounting.Identifier,
});
export const ReportComparisonCursor = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$/),
);
export const ReportComparisonQuery = Schema.Struct({ after: Schema.optional(ReportComparisonCursor) });
export const ReportComparisonPath = Schema.Struct({ ...Accounting.ChangePath.fields, otherId: Accounting.Identifier });
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
const ComparisonLine = Schema.Struct({ ...ReportLine.fields, movementMinor: Accounting.SignedMinorUnits });
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
  totals: Schema.Struct({ left: ComparisonAmounts, right: ComparisonAmounts, difference: Schema.NullOr(ComparisonAmounts) }),
  items: Schema.Array(Schema.Struct({
    accountId: Accounting.Identifier,
    presence: Schema.Literals(["both", "left_only", "right_only"]),
    left: Schema.NullOr(ComparisonLine),
    right: Schema.NullOr(ComparisonLine),
    labelsChanged: Schema.NullOr(Schema.Boolean),
    difference: Schema.NullOr(ComparisonAmounts),
  })).check(Schema.isMaxLength(100)),
  next: Schema.NullOr(ReportComparisonCursor),
  interpretation: Schema.Literal("saved_snapshot_arithmetic_only"),
  coverage: Schema.Literal("not_established"),
  reviewedOpening: Schema.Literal(false),
  statutoryComparability: Schema.Literal(false),
  financialCloseReady: Schema.Literal(false),
  warnings: Schema.Array(Schema.String),
});
// Kept local to report ownership; root composes this read-only capability into the registry.
export const ReportComparisonCapabilities = {
  reports_compare: {
    input: Schema.Struct({ scope: Accounting.Scope, leftReportId: Accounting.Identifier, rightReportId: Accounting.Identifier, ...ReportComparisonQuery.fields }),
    output: ReportComparisonPage,
    readOnly: true,
    description: "Compare two immutable saved synthetic report snapshots with exact right-minus-left signed differences, frozen account labels and explicit missing sides. Stable paged union with full-source totals; never reviewed opening, statutory comparability or financial close readiness.",
  },
};
const scoped = { params: Accounting.Scope, error: errors };
const identified = { params: Accounting.ChangePath, error: errors };
export const ReportApi = HttpApiGroup.make("reports").add(
  HttpApiEndpoint.get("compareReports", "/v1/entities/:entityId/books/:bookId/report-snapshots/:id/compare/:otherId", {
    params: ReportComparisonPath,
    error: errors,
    query: ReportComparisonQuery,
    success: ReportComparisonPage,
  }),
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
