/** No locale parsing or Number coercion is permitted for monetary inputs. */
export function minor(value, { signed = false, maxDigits = 38 } = {}) {
  if (
    typeof value !== "string" ||
    !(signed ? /^(0|-?[1-9][0-9]*)$/ : /^(0|[1-9][0-9]*)$/).test(value)
  )
    throw new TypeError("Expected a canonical integer minor-unit string");

  if (value.replace("-", "").length > maxDigits)
    throw new RangeError(`Maximum ${maxDigits} digits exceeded`);

  return BigInt(value);
}

export const modes = Object.freeze({
  exact: "Exact",
  toward_zero: "TowardZero",
  floor: "Floor",
  ceiling: "Ceiling",
  half_even: "HalfEven",
  half_away: "HalfAway",
  half_up: "HalfAway",
});

export function mode(engine, value) {
  if (!Object.hasOwn(modes, value)) throw new TypeError(`Unknown rounding mode: ${String(value)}`);

  return engine.c(`Rational.${modes[value]}`);
}

/** Independent JS BigInt oracle. Not used to implement the Bend operations. */
export function roundReference(n, d, mode) {
  if (d <= 0n) throw new RangeError("Positive denominator required");

  const negative = n < 0n,
    a = negative ? -n : n,
    q = a / d,
    r = a % d;

  let increment = false;

  switch (mode) {
    case "exact":
      if (r !== 0n) return null;
      break;
    case "toward_zero":
      break;
    case "floor":
      increment = negative && r !== 0n;
      break;
    case "ceiling":
      increment = !negative && r !== 0n;
      break;
    case "half_even":
      increment = r * 2n > d || (r * 2n === d && q % 2n === 1n);
      break;
    case "half_up":
    case "half_away":
      increment = r * 2n >= d;
      break;
    default:
      throw new TypeError("Unknown rounding mode");
  }

  const value = (negative ? -1n : 1n) * (q + (increment ? 1n : 0n));

  return { value, residual: n - value * d, denominator: d };
}
