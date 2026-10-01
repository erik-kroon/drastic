import * as Schema from "effect/Schema";

export const Identifier = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}$/));

// Account codes are lexical identifiers. Preserve source zero prefixes; chart
// classification and a renderer's narrower profile are separate decisions.
export const AccountCode = Schema.String.check(Schema.isPattern(/^[0-9]{1,8}$/));

export const isAccountCode = Schema.is(AccountCode);

export const AccountingDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

/** Source/storage shape remains loose; interpreted dates use this refinement. */
export function isCalendarDate(value: string) {
  if (!Schema.is(AccountingDate)(value) || value < "0001-01-01" || value > "9999-12-31")
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export const CalendarDate = AccountingDate.check(
  Schema.makeFilter((value) => isCalendarDate(value) || "Enter a valid calendar date."),
);

const swedishCalendar = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  calendar: "iso8601",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Convert an instant at the Swedish business boundary; plain dates need no conversion. */
export function swedishBusinessDate(instant: Date) {
  return swedishCalendar.format(instant);
}

export const Description = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));

export const Digest = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));

export const Scope = Schema.Struct({ entityId: Identifier, bookId: Identifier });
