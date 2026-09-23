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
const scoped = { params: Accounting.Scope, error: errors };
const identified = { params: Accounting.ChangePath, error: errors };
export const ReportApi = HttpApiGroup.make("reports").add(
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
