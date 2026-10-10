import * as Schema from "effect/Schema";

export const MinorUnits = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,37})$/));

export const SignedMinorUnits = Schema.String.check(Schema.isPattern(/^(0|-?[1-9][0-9]*)$/));

export const AggregateMinorUnits = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/));

/** Exact rational to the nearest integer, ties away from zero. The shared half-up owner. */
export function roundHalfUp(numerator: bigint, denominator: bigint) {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const rounded = quotient + ((magnitude % denominator) * 2n >= denominator ? 1n : 0n);

  return negative ? -rounded : rounded;
}
