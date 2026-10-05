import type { Locale } from "@/paraglide/runtime";

export function loanDecimal(
  numerator: bigint,
  denominator: bigint,
  digits: number,
  locale: Locale,
) {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const scale = 10n ** BigInt(digits);
  const scaled = magnitude * scale;

  const rounded = scaled / denominator + ((scaled % denominator) * 2n >= denominator ? 1n : 0n);

  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(rounded / scale);

  if (digits === 0) return `${negative ? "−" : ""}${whole}`;

  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ",";

  return `${negative ? "−" : ""}${whole}${decimal}${(rounded % scale).toString().padStart(digits, "0")}`;
}

export function loanRate(numerator: string, denominator: string, locale: Locale) {
  return `${loanDecimal(BigInt(numerator) * 100n, BigInt(denominator), 1, locale)} %`;
}

export function loanDate(date: string, locale: Locale, year = false) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: year ? "numeric" : undefined,
    timeZone: "UTC",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replaceAll(".", "");
}

export function previousLoanDay(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

export function loanCoverageLabel(start: string, end: string, locale: Locale) {
  const first =
    start.slice(0, 7) === end.slice(0, 7)
      ? new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(
          new Date(`${start}T12:00:00Z`),
        )
      : loanDate(start, locale);

  return `${first} till ${loanDate(end, locale)}`;
}
