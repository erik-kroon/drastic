import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { CurrencyCode, CurrencyScale, ExchangeRateTerms, ConversionPolicy, ConversionAmounts } from "@open-erp/domain/exchange-rates";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./reconciliation";

export { CurrencyCode, CurrencyScale, ExchangeRateTerms, ConversionPolicy, ConversionAmounts };
export const CreateExchangeRate = Schema.Struct({
  sourceKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  terms: ExchangeRateTerms,
});
export const ReviseExchangeRate = Schema.Struct({ expectedDigest: Accounting.Digest, terms: ExchangeRateTerms });
export const ExchangeRateRevision = Schema.Struct({
  observationId: Accounting.Identifier,
  sourceKey: CreateExchangeRate.fields.sourceKey,
  revision: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  scope: Accounting.Scope,
  terms: ExchangeRateTerms,
  direction: Schema.Literal("target_major_units_per_source_major_unit"),
  sourceSha256: Schema.String,
  reviewSha256: Schema.String,
  previousDigest: Schema.NullOr(Accounting.Digest),
  legalPolicyApproved: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
export const WithdrawExchangeRate = Schema.Struct({
  expectedDigest: Accounting.Digest,
  evidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
});
export const ExchangeRateWithdrawal = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  observationId: Accounting.Identifier,
  revision: ExchangeRateRevision.fields.revision,
  revisionDigest: Accounting.Digest,
  input: WithdrawExchangeRate,
  evidenceSha256: Schema.String,
  permanent: Schema.Literal(true),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
export const ExchangeRateUsability = Schema.Union([
  Schema.Struct({ state: Schema.Literal("active"), withdrawal: Schema.Null }),
  Schema.Struct({ state: Schema.Literal("withdrawn"), withdrawal: ExchangeRateWithdrawal }),
]);
export const ExchangeRateView = Schema.Struct({
  usability: Schema.optional(ExchangeRateUsability),
  current: ExchangeRateRevision,
  revisions: Schema.Array(ExchangeRateRevision).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});
export const ExchangeRateList = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(ExchangeRateRevision).check(Schema.isMaxLength(200)),
  statuses: Schema.optional(Schema.Array(Schema.Struct({
    observationId: Accounting.Identifier,
    usability: ExchangeRateUsability,
  })).check(Schema.isMaxLength(200))),
});
export const CaptureConversionReview = Schema.Struct({
  observationId: Accounting.Identifier,
  revisionDigest: Accounting.Digest,
  conversionDate: Accounting.AccountingDate,
  fromCurrency: CurrencyCode,
  sourceScale: CurrencyScale,
  originalMinor: Accounting.MinorUnits,
  roundingPolicy: ConversionPolicy,
  evidenceId: Accounting.Identifier,
  sourceLocator: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  rationale: Accounting.Description,
});
export const ConversionBookBasis = Schema.Struct({
  currency: CurrencyCode,
  currencyScale: CurrencyScale,
  profile: Schema.String,
  profileVersion: Accounting.MinorUnits,
  writerAuthority: Schema.String,
  writerEpoch: Accounting.MinorUnits,
});
export const ConversionReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  kind: Schema.Literal("synthetic_exchange_conversion_v1"),
  input: CaptureConversionReview,
  sourceSha256: Schema.String,
  rate: ExchangeRateRevision,
  bookBasis: ConversionBookBasis,
  calculation: ConversionAmounts,
  formula: Schema.Literal("N = originalMinor * rateNumerator * 10^bookScale; D = rateDenominator * 10^sourceScale; rounded = div(N,D) + (2*mod(N,D) >= D ? 1 : 0); residualNumerator = N - rounded*D; residualDenominator = D"),
  legalPolicyApproved: Schema.Literal(false),
  postingSupported: Schema.Literal(false),
  financialCloseReady: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
export const ConversionReviewView = Schema.Struct({
  review: ConversionReview,
  rateUsability: Schema.optional(ExchangeRateUsability),
  dependenciesCurrent: Schema.Boolean,
  artifact: Schema.Struct({
    content: Schema.String,
    sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1048576 })),
    mediaType: Schema.Literal("application/json"),
  }),
});
export const ConversionReviewList = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(Schema.Struct({
    id: Accounting.Identifier,
    observationId: Accounting.Identifier,
    revisionDigest: Accounting.Digest,
    conversionDate: Accounting.AccountingDate,
    fromCurrency: CurrencyCode,
    originalMinor: Accounting.MinorUnits,
    sourceScale: CurrencyScale,
    roundedMinor: Accounting.MinorUnits,
    bookCurrency: CurrencyCode,
    bookScale: CurrencyScale,
    createdAt: Schema.String,
    digest: Accounting.Digest,
  })).check(Schema.isMaxLength(200)),
});
const path = "/v1/entities/:entityId/books/:bookId/exchange-rates";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
export const ExchangeRatesApi = HttpApiGroup.make("exchangeRates").add(
  HttpApiEndpoint.post("withdrawExchangeRate", `${path}/:id/withdrawals`, {
    ...identified, headers: Accounting.IdempotencyHeaders,
    payload: WithdrawExchangeRate.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ExchangeRateWithdrawal,
  }),
  HttpApiEndpoint.post("createExchangeRate", path, { ...scoped, headers: Accounting.IdempotencyHeaders, payload: CreateExchangeRate.annotate({ parseOptions: { onExcessProperty: "error" } }), success: ExchangeRateRevision }),
  HttpApiEndpoint.post("reviseExchangeRate", `${path}/:id/revisions`, { ...identified, headers: Accounting.IdempotencyHeaders, payload: ReviseExchangeRate.annotate({ parseOptions: { onExcessProperty: "error" } }), success: ExchangeRateRevision }),
  HttpApiEndpoint.get("getExchangeRate", `${path}/:id`, { ...identified, success: ExchangeRateView }),
  HttpApiEndpoint.get("listExchangeRates", path, { ...scoped, success: ExchangeRateList }),
  HttpApiEndpoint.post("captureConversionReview", `${path}/reviews`, { ...scoped, headers: Accounting.IdempotencyHeaders, payload: CaptureConversionReview.annotate({ parseOptions: { onExcessProperty: "error" } }), success: ConversionReview }),
  HttpApiEndpoint.get("getConversionReview", `${path}/reviews/:id`, { ...identified, success: ConversionReviewView }),
  HttpApiEndpoint.get("listConversionReviews", `${path}/reviews`, { ...scoped, success: ConversionReviewList }),
);
// Operator rate decisions stay outside ordinary automation capabilities.
export const ExchangeRateCapabilities = {
  fx_list_rates: { description: "Discover bounded operator-reviewed manual rates and separate live withdrawal statuses. Historical facts are not legal or posting authority.", input: Schema.Struct({ scope: Accounting.Scope }), output: ExchangeRateList, readOnly: true },
  fx_get_rate: { description: "Read a directional manual rate, immutable revisions and permanent withdrawal history. Never invert or substitute a missing or withdrawn rate.", input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }), output: ExchangeRateView, readOnly: true },
  fx_capture_conversion: { description: "Retain an exact nonnegative synthetic conversion review using the exact current rate revision and matching effective date. No posting or human approval is minted.", input: Schema.Struct({ scope: Accounting.Scope, idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"], input: CaptureConversionReview }), output: ConversionReview, readOnly: false },
  fx_get_conversion: { description: "Recover exact immutable conversion JSON bytes and separate live revision/book/withdrawal currentness. No FX posting is supported.", input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }), output: ConversionReviewView, readOnly: true },
  fx_list_conversions: { description: "Discover all bounded retained manual conversion reviews for recovery.", input: Schema.Struct({ scope: Accounting.Scope }), output: ConversionReviewList, readOnly: true },
};
