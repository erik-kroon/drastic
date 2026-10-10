import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { AggregateMinorUnits, MinorUnits, SignedMinorUnits, roundHalfUp } from "./money";

export const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

export const CurrencyScale = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));

export const PositiveRatePart = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/));

export const ExchangeRateTerms = Schema.Struct({
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  effectiveOn: AccountingDate,
  retrievedOn: AccountingDate,
  rateNumerator: PositiveRatePart,
  rateDenominator: PositiveRatePart,
  evidenceId: Identifier,
  sourceLocator: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  reviewEvidenceId: Identifier,
  rationale: Description,
});

export const ConversionPolicy = Schema.Literal("synthetic_half_up_nonnegative_v1");

export const ConversionAmounts = Schema.Struct({
  exactNumerator: AggregateMinorUnits,
  exactDenominator: AggregateMinorUnits,
  quotientMinor: AggregateMinorUnits,
  remainderNumerator: AggregateMinorUnits,
  roundedMinor: MinorUnits,
  residualNumerator: SignedMinorUnits,
  residualDenominator: AggregateMinorUnits,
});

/** Exact nonnegative rational rounded half up, keeping the residual. The single FX rounding owner. */
export function exactHalfUp(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = roundHalfUp(numerator, denominator);

  return {
    numerator,
    denominator,
    quotient,
    remainder,
    rounded,
    residual: numerator - rounded * denominator,
  };
}

/** Converts minor units between currency scales at a quote-per-base major-unit rate. */
export function convertMinor(
  originalMinor: bigint,
  sourceScale: number,
  rate: { readonly rateNumerator: string; readonly rateDenominator: string },
  targetScale: number,
) {
  return exactHalfUp(
    originalMinor * BigInt(rate.rateNumerator) * 10n ** BigInt(targetScale),
    BigInt(rate.rateDenominator) * 10n ** BigInt(sourceScale),
  );
}
