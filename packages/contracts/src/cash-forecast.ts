import * as Forecast from "@open-erp/domain/cash-forecast";
import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { BankCapacityReconciliation } from "./settlements";
import { BankSourceCoverageReport } from "./bank-source-coverage";
import { Invoice, EvidenceReference } from "./commerce";
import { MonetaryItem } from "./commerce-fx";

const Review = Schema.Struct({
  evidenceId: Accounting.Identifier,
  sha256: EvidenceReference.fields.sha256,
  reason: Accounting.Description,
});

export const CashAccountSelection = Schema.Struct({
  accountId: Accounting.Identifier,
  reconciliationId: Accounting.Identifier,
  coverageReportId: Accounting.Identifier,
  review: Schema.Struct({
    ...Review.fields,
    eligibility: Schema.Literals([
      "unrestricted_entity_bank",
      "restricted",
      "private",
      "tax_account",
      "unused_credit",
      "unknown",
    ]),
    balanceType: Schema.Literals(["statement_closing", "available", "unknown"]),
  }),
});

export const CaptureCashBasis = Schema.Struct({
  asOf: Accounting.AccountingDate,
  accounts: Schema.Array(CashAccountSelection).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100),
  ),
  expectedDates: Schema.Array(
    Schema.Struct({
      invoiceId: Accounting.Identifier,
      expectedOn: Accounting.CalendarDate,
      review: Review,
    }),
  ).check(Schema.isMaxLength(10000)),
});

export const CashOpeningObservation = Schema.Struct({
  accountId: Accounting.Identifier,
  amountMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  effectiveOn: Accounting.AccountingDate,
  observedAt: Schema.Null,
  recordedAt: Schema.String,
  reconciliation: BankCapacityReconciliation,
  coverageReport: BankSourceCoverageReport,
  dependenciesCurrent: Schema.Boolean,
  blockers: Schema.Array(Schema.String),
});

export const CashOpening = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("qualified"),
    totalMinor: Accounting.SignedMinorUnits,
    observations: Schema.Array(CashOpeningObservation),
    blockers: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    totalMinor: Schema.Null,
    observations: Schema.Array(CashOpeningObservation),
    blockers: Schema.Array(Schema.String),
  }),
]);

export const CashInvoiceContribution = Schema.Struct({
  invoiceId: Accounting.Identifier,
  direction: Schema.Literals(["customer", "supplier"]),
  amountMinor: Schema.NullOr(Accounting.MinorUnits),
  inclusion: Schema.Literals(["included", "excluded", "blocked"]),
  reason: Schema.String,
  dueOn: Accounting.AccountingDate,
  expectedOn: Schema.NullOr(Accounting.AccountingDate),
  provenance: Schema.Struct({
    evidence: Invoice.fields.evidence,
    recognition: Schema.NullOr(
      Schema.Struct({
        voucherId: Accounting.Identifier,
        lineId: Accounting.Identifier,
      }),
    ),
    revision: Accounting.MinorUnits,
    revisionEvidence: Invoice.fields.currentRevision.fields.evidence,
    allocationVersion: Accounting.MinorUnits,
    originalMinor: Accounting.MinorUnits,
    allocatedMinor: Accounting.MinorUnits,
    creditedMinor: Schema.NullOr(Accounting.MinorUnits),
    cancelledMinor: Schema.NullOr(Accounting.MinorUnits),
    status: Invoice.fields.status,
    blockers: Schema.Array(Schema.String),
  }),
  paymentMembership: Schema.Array(
    Schema.Struct({
      receiptId: Accounting.Identifier,
      sourceOwner: Schema.NullOr(Schema.String),
      sourceId: Schema.NullOr(Accounting.Identifier),
      ordinal: Schema.Int,
      amountMinor: Accounting.MinorUnits,
      statementId: Schema.NullOr(Accounting.Identifier),
      rowOrdinal: Schema.NullOr(Schema.Int),
      accountId: Schema.NullOr(Accounting.Identifier),
      status: Schema.Literals(["included_in_opening", "unqualified"]),
    }),
  ),
});

export const CashBasis = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  asOf: Accounting.AccountingDate,
  recordedCutoff: Schema.String,
  captureMode: Schema.Literal("current_knowledge"),
  currency: Schema.Literal("SEK"),
  currencyScale: Schema.Literal(2),
  actorId: Accounting.Identifier,
  input: CaptureCashBasis,
  opening: CashOpening,
  contributions: Schema.Array(CashInvoiceContribution).check(Schema.isMaxLength(10000)),
  foreignObligations: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      originalCurrency: Schema.String,
      remainingOriginalMinor: Schema.NullOr(Accounting.MinorUnits),
      inclusion: Schema.Literal("blocked"),
      reason: Schema.String,
      item: MonetaryItem,
    }),
  ).check(Schema.isMaxLength(10000)),
  coverage: Schema.Array(
    Schema.Struct({
      family: Schema.Literals([
        "bank",
        "commerce",
        "tax",
        "payroll",
        "owners",
        "assets",
        "financing",
      ]),
      owner: Schema.String,
      status: Schema.Literals(["selected_scope", "unavailable", "incomplete", "unknown"]),
      reason: Schema.String,
    }),
  ),
  companyCoverage: Schema.Literal("incomplete"),
  label: Schema.Literal("known_items"),
  dependencyDigest: Accounting.Digest,
  digest: Accounting.Digest,
});

export const CashBasisView = Schema.Struct({
  basis: CashBasis,
  dependenciesCurrent: Schema.Boolean,
  dependencyStatus: Schema.Literals(["current", "changed", "unavailable"]),
  dependencyReason: Schema.NullOr(Schema.String),
  artifact: Schema.Struct({
    content: Schema.String,
    sha256: EvidenceReference.fields.sha256,
    byteLength: Schema.Int,
    mediaType: Schema.Literal("application/json"),
  }),
});

export const CaptureCashForecast = Schema.Struct({
  basisId: Accounting.Identifier,
  basisDigest: Accounting.Digest,
  horizonDays: Forecast.ForecastHorizon,
  bufferMinor: Accounting.MinorUnits,
  expectedDates: CaptureCashBasis.fields.expectedDates,
});

export const CashForecastSnapshot = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  actorId: Accounting.Identifier,
  createdAt: Schema.String,
  calculatorVersion: Schema.Literal("known_items_exact_v1"),
  basisId: Accounting.Identifier,
  basisDigest: Accounting.Digest,
  input: CaptureCashForecast,
  asOf: Accounting.CalendarDate,
  recordedCutoff: Schema.String,
  horizonDays: Forecast.ForecastHorizon,
  endsOn: Accounting.CalendarDate,
  label: Schema.Literal("known_items"),
  companyCoverage: Schema.Literal("incomplete"),
  quality: Schema.Struct({
    opening: Schema.Literals(["qualified", "unavailable"]),
    sourceCoverage: Schema.Literal("incomplete"),
    datedContributions: Schema.Literals(["qualified", "incomplete"]),
    dependenciesAtCapture: Schema.Literal("current"),
  }),
  result: Forecast.ForecastResult,
  contributions: Schema.Array(Forecast.ForecastContribution).check(Schema.isMaxLength(10000)),
  foreignObligations: CashBasis.fields.foreignObligations,
  digest: Accounting.Digest,
});

export const CashForecastView = Schema.Struct({
  forecast: CashForecastSnapshot,
  dependenciesCurrent: Schema.Boolean,
  dependencyStatus: CashBasisView.fields.dependencyStatus,
  dependencyReason: CashBasisView.fields.dependencyReason,
  artifact: CashBasisView.fields.artifact,
});

const path = "/v1/entities/:entityId/books/:bookId/cash-bases";

export const CashForecastApi = HttpApiGroup.make("cashForecast")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post(
      "captureCashForecast",
      "/v1/entities/:entityId/books/:bookId/cash-forecasts",
      {
        params: Accounting.Scope,
        headers: Accounting.IdempotencyHeaders,
        payload: CaptureCashForecast,
        success: CashForecastSnapshot,
        error: accountingErrors,
      },
    ),
    HttpApiEndpoint.get(
      "getCashForecast",
      "/v1/entities/:entityId/books/:bookId/cash-forecasts/:id",
      {
        params: Accounting.ChangePath,
        success: CashForecastView,
        error: accountingErrors,
      },
    ),
    HttpApiEndpoint.get(
      "exportCashForecast",
      "/v1/entities/:entityId/books/:bookId/cash-forecasts/:id/export",
      {
        params: Accounting.ChangePath,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "application/json" })),
        error: accountingErrors,
      },
    ),
    HttpApiEndpoint.post("captureCashBasis", path, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: CaptureCashBasis,
      success: CashBasis,
      error: accountingErrors,
    }),
    HttpApiEndpoint.get("getCashBasis", `${path}/:id`, {
      params: Accounting.ChangePath,
      success: CashBasisView,
      error: accountingErrors,
    }),
    HttpApiEndpoint.get("exportCashBasis", `${path}/:id/export`, {
      params: Accounting.ChangePath,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "application/json" })),
      error: accountingErrors,
    }),
  );

export const CashForecastCapabilities = {
  cash_capture_forecast: {
    description:
      "Save an immutable exact known-items forecast from a current retained cash basis and reviewed date assumptions. Never posts or executes payments. Coverage remains incomplete.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: CaptureCashForecast,
    }),
    output: CashForecastSnapshot,
    readOnly: false,
  },
  cash_get_forecast: {
    description:
      "Read the original immutable forecast and exact JSON artifact, with current authority and separate dependency freshness. Historical results are never recalculated.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: CashForecastView,
    readOnly: true,
  },
  cash_capture_basis: {
    description:
      "Capture immutable current known cash items from retained selected bank witnesses and canonical invoice residuals. Reviewed references contain no financial amounts. Preserves unavailable opening and company coverage gaps.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: CaptureCashBasis,
    }),
    output: CashBasis,
    readOnly: false,
  },
  cash_get_basis: {
    description:
      "Read an immutable cash basis and its exact JSON export, with current authority and separate dependency freshness. The basis is known items, never a company liquidity certificate.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: CashBasisView,
    readOnly: true,
  },
};
