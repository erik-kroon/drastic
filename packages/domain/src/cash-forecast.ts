import * as Schema from "effect/Schema";
import { AggregateMinorUnits, MinorUnits, SignedMinorUnits } from "./money";
import { AccountingDate, CalendarDate, Identifier, isCalendarDate } from "./values";

export const ForecastHorizon = Schema.Literals([30, 90, 91]);

export const ForecastEvent = Schema.Struct({
  invoiceId: Identifier,
  direction: Schema.Literals(["customer", "supplier"]),
  amountMinor: Schema.NullOr(MinorUnits),
  inclusion: Schema.Literals(["included", "excluded", "blocked"]),
  reason: Schema.String,
  dueOn: AccountingDate,
  expectedOn: Schema.NullOr(AccountingDate),
});

export const ForecastCalculationInput = Schema.Struct({
  asOf: CalendarDate,
  horizonDays: ForecastHorizon,
  bufferMinor: MinorUnits,
  openingMinor: Schema.NullOr(SignedMinorUnits),
  events: Schema.Array(ForecastEvent).check(Schema.isMaxLength(10000)),
});

export const ForecastContribution = Schema.Struct({
  invoiceId: Identifier,
  direction: ForecastEvent.fields.direction,
  amountMinor: ForecastEvent.fields.amountMinor,
  dueOn: AccountingDate,
  expectedOn: ForecastEvent.fields.expectedOn,
  scheduledOn: Schema.NullOr(CalendarDate),
  dateOrigin: Schema.NullOr(Schema.Literals(["contract_due_date", "reviewed_expected_date"])),
  disposition: Schema.Literals(["dated", "outside_horizon", "undated", "excluded", "blocked"]),
  reason: Schema.String,
});

export const ForecastDay = Schema.Struct({
  on: CalendarDate,
  inflowMinor: AggregateMinorUnits,
  outflowMinor: AggregateMinorUnits,
  closingMinor: SignedMinorUnits,
  conservativeLowMinor: SignedMinorUnits,
});

export const ForecastMinimum = Schema.Struct({ amountMinor: SignedMinorUnits, on: CalendarDate });

export const ForecastCurve = Schema.Struct({
  minimum: ForecastMinimum,
  headroomMinor: SignedMinorUnits,
});

export const ForecastResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    openingMinor: SignedMinorUnits,
    closingMinor: SignedMinorUnits,
    baseline: ForecastCurve,
    conservative: ForecastCurve,
    days: Schema.Array(ForecastDay).check(Schema.isMaxLength(91)),
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    openingMinor: Schema.Null,
    closingMinor: Schema.Null,
    baseline: Schema.Null,
    conservative: Schema.Null,
    days: Schema.Array(ForecastDay).check(Schema.isMaxLength(0)),
  }),
]);

export function forecastCalendarOffset(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

function contribution(
  event: typeof ForecastEvent.Type,
  asOf: string,
  endsOn: string,
): typeof ForecastContribution.Type {
  const retained = {
    invoiceId: event.invoiceId,
    direction: event.direction,
    amountMinor: event.amountMinor,
    dueOn: event.dueOn,
    expectedOn: event.expectedOn,
  };

  if (event.inclusion !== "included" || event.amountMinor === null)
    return {
      ...retained,
      scheduledOn: null,
      dateOrigin: null,
      disposition: event.inclusion === "excluded" ? "excluded" : "blocked",
      reason: event.reason,
    };

  if (
    !isCalendarDate(event.dueOn) ||
    (event.expectedOn !== null && !isCalendarDate(event.expectedOn))
  )
    return {
      ...retained,
      scheduledOn: null,
      dateOrigin: null,
      disposition: "blocked",
      reason: "invalid_source_date",
    };

  const on = event.expectedOn ?? event.dueOn;
  const dateOrigin = event.expectedOn === null ? "contract_due_date" : "reviewed_expected_date";

  if (on < asOf)
    return {
      ...retained,
      scheduledOn: null,
      dateOrigin,
      disposition: "undated",
      reason:
        event.expectedOn === null ? "overdue_without_reviewed_date" : "reviewed_date_before_as_of",
    };

  return {
    ...retained,
    scheduledOn: on,
    dateOrigin,
    disposition: on > endsOn ? "outside_horizon" : "dated",
    reason: on > endsOn ? "after_forecast_horizon" : event.reason,
  };
}

export type ForecastCalculation = {
  readonly result: typeof ForecastResult.Type;
  readonly contributions: ReadonlyArray<typeof ForecastContribution.Type>;
};

export function calculateCashForecast(
  input: typeof ForecastCalculationInput.Type,
): ForecastCalculation {
  const endsOn = forecastCalendarOffset(input.asOf, input.horizonDays - 1);
  const contributions = input.events.map((event) => contribution(event, input.asOf, endsOn));

  if (input.openingMinor === null)
    return {
      result: {
        status: "unavailable",
        openingMinor: null,
        closingMinor: null,
        baseline: null,
        conservative: null,
        days: [],
      },
      contributions,
    };

  const totals = new Map<string, { inflow: bigint; outflow: bigint }>();

  for (const event of contributions) {
    if (event.disposition !== "dated" || event.scheduledOn === null || event.amountMinor === null)
      continue;
    const current = totals.get(event.scheduledOn) ?? { inflow: 0n, outflow: 0n };
    const amount = BigInt(event.amountMinor);

    if (event.direction === "customer") current.inflow += amount;
    else current.outflow += amount;
    totals.set(event.scheduledOn, current);
  }

  let closing = BigInt(input.openingMinor);
  let baseline = { amount: closing, on: input.asOf };
  let conservative = { amount: closing, on: input.asOf };
  const days: Array<typeof ForecastDay.Type> = [];

  for (let ordinal = 0; ordinal < input.horizonDays; ordinal++) {
    const on = forecastCalendarOffset(input.asOf, ordinal);
    const total = totals.get(on) ?? { inflow: 0n, outflow: 0n };
    const low = closing - total.outflow;
    closing = low + total.inflow;

    if (closing < baseline.amount) baseline = { amount: closing, on };

    if (low < conservative.amount) conservative = { amount: low, on };
    days.push({
      on,
      inflowMinor: total.inflow.toString(),
      outflowMinor: total.outflow.toString(),
      closingMinor: closing.toString(),
      conservativeLowMinor: low.toString(),
    });
  }

  const buffer = BigInt(input.bufferMinor);

  return {
    result: {
      status: "available",
      openingMinor: input.openingMinor,
      closingMinor: closing.toString(),
      days,
      baseline: {
        minimum: { amountMinor: baseline.amount.toString(), on: baseline.on },
        headroomMinor: (baseline.amount - buffer).toString(),
      },
      conservative: {
        minimum: { amountMinor: conservative.amount.toString(), on: conservative.on },
        headroomMinor: (conservative.amount - buffer).toString(),
      },
    },
    contributions,
  };
}
