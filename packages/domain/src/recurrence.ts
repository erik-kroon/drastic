import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description } from "./values";

// Pure recurring-agreement cycle identity. A cycle is named by its ordinal
// against the original anchor, never by a template revision, so amending a
// template cannot re-identify a cycle that is already issued. Every cadence,
// calendar policy, interval rule and event is a reviewed input, and a
// combination this owner does not implement is an explicit refusal rather than
// an inferred cycle. No due instant is produced: a daylight-saving change moves
// a due instant, not a service cycle, and the invoice draft owner holds the
// reviewed issue and due dates.

export const RecurrenceFailureCode = Schema.Literals([
  "UnsupportedCadence",
  "InvalidAnchor",
  "InvalidCycleOrdinal",
  "CycleOutsideCalendar",
  "NoTemplateRevisionForCycle",
  "AmbiguousTemplateRevision",
  "IncompleteEventHistory",
  "OverlappingBillingCoverage",
  "DuplicateChargeComponent",
  "DueInstantRequiresSchedulingOwner",
  "IncompleteHorizon",
]);

export type RecurrenceFailureCode = typeof RecurrenceFailureCode.Type;

export const RecurrenceFailure = Schema.Struct({
  code: RecurrenceFailureCode,
  message: Description,
});

export type RecurrenceFailure = typeof RecurrenceFailure.Type;

export type Checked<A> = Result.Result<A, RecurrenceFailure>;

export const CycleOrdinal = Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]{0,17})$/));

export type CycleOrdinal = typeof CycleOrdinal.Type;

export const CadenceKind = Schema.Literals(["monthly", "fixed_day_interval"]);

export type CadenceKind = typeof CadenceKind.Type;

export const MonthAnchorPolicy = Schema.Literals(["anchor_day_clamped", "end_of_month"]);

export type MonthAnchorPolicy = typeof MonthAnchorPolicy.Type;

export const TimeZone = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/),
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
);

export type TimeZone = typeof TimeZone.Type;

// The cadence interval is an exact positive integer. `monthInterval` belongs to
// `monthly` and `dayInterval` to `fixed_day_interval`; a cadence carrying the
// other kind's interval is refused instead of read as a default.
export const RecurrenceCadence = Schema.Struct({
  kind: CadenceKind,
  monthInterval: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/))),
  dayInterval: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,7}$/))),
  monthAnchorPolicy: Schema.NullOr(MonthAnchorPolicy),
});

export type RecurrenceCadence = typeof RecurrenceCadence.Type;

export const RecurrenceSchedule = Schema.Struct({
  anchorLocalDate: AccountingDate,
  timeZone: TimeZone,
  cadence: RecurrenceCadence,
  firstCycleOrdinal: CycleOrdinal,
});

export type RecurrenceSchedule = typeof RecurrenceSchedule.Type;

export const ServiceInterval = Schema.Struct({
  serviceStartsOn: AccountingDate,
  serviceEndsOn: AccountingDate,
});

export type ServiceInterval = typeof ServiceInterval.Type;

export const TemplateRevisionBoundary = Schema.Struct({
  revision: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,17}$/)),
  effectiveFromCycle: CycleOrdinal,
});

export type TemplateRevisionBoundary = typeof TemplateRevisionBoundary.Type;

export const AgreementEventKind = Schema.Literals(["pause", "resume", "end"]);

export type AgreementEventKind = typeof AgreementEventKind.Type;

export const AgreementEventBoundary = Schema.Struct({
  kind: AgreementEventKind,
  effectiveCycle: CycleOrdinal,
});

export type AgreementEventBoundary = typeof AgreementEventBoundary.Type;

export const CycleIdentity = Schema.Struct({
  cycleOrdinal: CycleOrdinal,
  cycleDate: AccountingDate,
  serviceInterval: ServiceInterval,
});

export type CycleIdentity = typeof CycleIdentity.Type;

export const SkippedCycleReason = Schema.Literals(["paused", "ended", "already_materialized"]);

export type SkippedCycleReason = typeof SkippedCycleReason.Type;

export const SkippedCycle = Schema.Struct({
  cycleOrdinal: CycleOrdinal,
  reason: SkippedCycleReason,
});

export type SkippedCycle = typeof SkippedCycle.Type;

export const PlannedCycle = Schema.Struct({
  cycleOrdinal: CycleOrdinal,
  cycleDate: AccountingDate,
  serviceInterval: ServiceInterval,
  selectedTemplateRevision: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,17}$/)),
});

export type PlannedCycle = typeof PlannedCycle.Type;

export const CyclePlan = Schema.Struct({
  due: Schema.Array(PlannedCycle).check(Schema.isMaxLength(240)),
  skipped: Schema.Array(SkippedCycle).check(Schema.isMaxLength(240)),
  continuationOrdinal: CycleOrdinal,
});

export type CyclePlan = typeof CyclePlan.Type;

export const BilledCoverage = Schema.Struct({
  cycleOrdinal: CycleOrdinal,
  serviceInterval: ServiceInterval,
});

export type BilledCoverage = typeof BilledCoverage.Type;

export const CyclePlanRequest = Schema.Struct({
  schedule: RecurrenceSchedule,
  events: Schema.Array(AgreementEventBoundary).check(Schema.isMaxLength(200)),
  revisions: Schema.Array(TemplateRevisionBoundary).check(Schema.isMaxLength(50)),
  billedCoverage: Schema.Array(BilledCoverage).check(Schema.isMaxLength(2000)),
  throughOrdinal: CycleOrdinal,
  materialisedThroughOrdinal: Schema.NullOr(CycleOrdinal),
});

export type CyclePlanRequest = typeof CyclePlanRequest.Type;

type CalendarDate = { readonly year: bigint; readonly monthIndex: bigint; readonly day: bigint };

type CycleStep = (anchor: CalendarDate, cycle: bigint) => Result.Result<string, RecurrenceFailure>;

type CycleDisposition =
  | { readonly kind: "due" }
  | { readonly kind: "skipped"; readonly reason: "paused" | "ended" };

type ComputedCycle = {
  readonly cycleDate: string;
  readonly serviceInterval: ServiceInterval;
};

const maximumHorizonCycles = 240n;

const maximumMonthInterval = 1200n;

const maximumDayInterval = 36500n;

const firstCalendarYear = 1n;

const lastCalendarYear = 9999n;

const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function fail(code: RecurrenceFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function ordinal(value: string): bigint | null {
  if (!/^(?:0|[1-9][0-9]{0,17})$/u.test(value)) return null;

  return BigInt(value);
}

function isLeapYear(year: bigint) {
  return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
}

function monthLength(year: bigint, monthIndex: bigint) {
  const base = monthLengths.at(Number(monthIndex));

  if (base === undefined) return null;

  return BigInt(monthIndex === 1n && isLeapYear(year) ? base + 1 : base);
}

function localDate(year: bigint, monthIndex: bigint, day: bigint) {
  const month = (monthIndex + 1n).toString().padStart(2, "0");
  const dayOfMonth = day.toString().padStart(2, "0");

  return `${year.toString().padStart(4, "0")}-${month}-${dayOfMonth}`;
}

function parseLocalDate(value: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;

  const year = BigInt(value.slice(0, 4));
  const monthIndex = BigInt(value.slice(5, 7)) - 1n;
  const day = BigInt(value.slice(8, 10));

  if (monthIndex < 0n || monthIndex > 11n) return null;

  const lastDay = monthLength(year, monthIndex);

  if (lastDay === null || day < 1n || day > lastDay) return null;

  return { year, monthIndex, day };
}

function inCalendar(year: bigint) {
  return year >= firstCalendarYear && year <= lastCalendarYear;
}

function anchorDayOf(monthEnd: bigint, anchorDay: bigint, anchorPolicy: MonthAnchorPolicy) {
  if (anchorPolicy === "end_of_month") return monthEnd;

  return anchorDay < monthEnd ? anchorDay : monthEnd;
}

function monthStep(anchor: CalendarDate, months: bigint, anchorPolicy: MonthAnchorPolicy) {
  const position = anchor.year * 12n + anchor.monthIndex + months;
  const year = position / 12n;
  const monthIndex = position % 12n;

  if (!inCalendar(year)) {
    return fail("CycleOutsideCalendar", "The cycle falls outside the supported calendar.");
  }

  const monthEnd = monthLength(year, monthIndex);

  if (monthEnd === null) {
    return fail("CycleOutsideCalendar", "The cycle falls outside the supported calendar.");
  }

  return Result.succeed(
    localDate(year, monthIndex, anchorDayOf(monthEnd, anchor.day, anchorPolicy)),
  );
}

function daysBeforeYear(year: bigint) {
  const previous = year - 1n;

  return 365n * previous + previous / 4n - previous / 100n + previous / 400n;
}

function daysBeforeMonth(year: bigint, monthIndex: bigint) {
  let total = 0n;

  for (let index = 0n; index < monthIndex; index += 1n) {
    const length = monthLength(year, index);

    if (length === null) return null;

    total += length;
  }

  return total;
}

// A fixed day interval is counted on whole local calendar days, so the anchor is
// projected to an absolute day count and decomposed again. Accumulating months
// from a clamped anchor day instead would drift a 31st anchor into an invalid
// day.
function calendarFromAbsolute(days: bigint): Checked<CalendarDate> {
  if (days < 0n) {
    return fail("CycleOutsideCalendar", "The cycle falls outside the supported calendar.");
  }

  let year = (days * 10000n) / 3652425n + 1n;

  while (year > firstCalendarYear && daysBeforeYear(year) > days) year -= 1n;

  while (year < lastCalendarYear && daysBeforeYear(year + 1n) <= days) year += 1n;

  if (!inCalendar(year)) {
    return fail("CycleOutsideCalendar", "The cycle falls outside the supported calendar.");
  }

  let remaining = days - daysBeforeYear(year);
  let monthIndex = 0n;

  while (true) {
    const length = monthLength(year, monthIndex);

    if (length === null) {
      return fail("CycleOutsideCalendar", "The cycle falls outside the supported calendar.");
    }

    if (remaining < length) break;

    remaining -= length;
    monthIndex += 1n;
  }

  return Result.succeed({ year, monthIndex, day: remaining + 1n });
}

function dayStep(anchor: CalendarDate, days: bigint): Checked<string> {
  const beforeMonth = daysBeforeMonth(anchor.year, anchor.monthIndex);

  if (beforeMonth === null) {
    return fail("CycleOutsideCalendar", "The cycle falls outside the supported calendar.");
  }

  const absolute = daysBeforeYear(anchor.year) + beforeMonth + (anchor.day - 1n) + days;
  const calendar = calendarFromAbsolute(absolute);

  if (Result.isFailure(calendar)) return Result.fail(calendar.failure);

  return Result.succeed(
    localDate(calendar.success.year, calendar.success.monthIndex, calendar.success.day),
  );
}

function declaredInterval(
  value: string | null,
  maximum: bigint,
  other: string | null,
  unit: string,
) {
  if (value === null || other !== null) {
    return fail("UnsupportedCadence", `The cadence declares exactly one ${unit} interval.`);
  }

  const interval = BigInt(value);

  if (interval > maximum) {
    return fail("UnsupportedCadence", `The ${unit} interval exceeds its supported bound.`);
  }

  return Result.succeed(interval);
}

function stepFor(schedule: RecurrenceSchedule): Checked<CycleStep> {
  if (schedule.cadence.kind === "monthly") {
    const anchorPolicy = schedule.cadence.monthAnchorPolicy;

    if (anchorPolicy === null) {
      return fail("UnsupportedCadence", "A monthly cadence declares its month anchor policy.");
    }

    const months = declaredInterval(
      schedule.cadence.monthInterval,
      maximumMonthInterval,
      schedule.cadence.dayInterval,
      "month",
    );

    if (Result.isFailure(months)) return Result.fail(months.failure);

    const policy = anchorPolicy;

    return Result.succeed((anchor, cycle) => monthStep(anchor, months.success * cycle, policy));
  }

  const days = declaredInterval(
    schedule.cadence.dayInterval,
    maximumDayInterval,
    schedule.cadence.monthInterval,
    "day",
  );

  if (Result.isFailure(days)) return Result.fail(days.failure);

  return Result.succeed((anchor, cycle) => dayStep(anchor, days.success * cycle));
}

function checkedCycle(schedule: RecurrenceSchedule, cycle: bigint): Checked<ComputedCycle> {
  const first = ordinal(schedule.firstCycleOrdinal);

  if (first === null) {
    return fail("InvalidCycleOrdinal", "The first cycle ordinal is not an integer.");
  }

  if (cycle < first) {
    return fail("InvalidCycleOrdinal", "The cycle precedes the first cycle of the agreement.");
  }

  const step = stepFor(schedule);

  if (Result.isFailure(step)) return Result.fail(step.failure);

  const anchor = parseLocalDate(schedule.anchorLocalDate);

  if (anchor === null)
    return fail("InvalidAnchor", "The anchor local date is not a calendar date.");

  const date = step.success(anchor, cycle);

  if (Result.isFailure(date)) return Result.fail(date.failure);

  const previous =
    cycle === first ? Result.succeed(schedule.anchorLocalDate) : step.success(anchor, cycle - 1n);

  if (Result.isFailure(previous)) return Result.fail(previous.failure);

  return Result.succeed({
    cycleDate: date.success,
    serviceInterval: { serviceStartsOn: previous.success, serviceEndsOn: date.success },
  });
}

// The cycle date is always derived from the original anchor, so a January 31
// anchor yields February 28 and then March 31 again, never a drifting March 28.
export function cycleDate(schedule: RecurrenceSchedule, cycleOrdinal: string): Checked<string> {
  const cycle = ordinal(cycleOrdinal);

  if (cycle === null) return fail("InvalidCycleOrdinal", "The cycle ordinal is not an integer.");

  const computed = checkedCycle(schedule, cycle);

  return Result.isFailure(computed)
    ? Result.fail(computed.failure)
    : Result.succeed(computed.success.cycleDate);
}

export function cycleIdentity(
  schedule: RecurrenceSchedule,
  cycleOrdinal: string,
): Checked<CycleIdentity> {
  const cycle = ordinal(cycleOrdinal);

  if (cycle === null) return fail("InvalidCycleOrdinal", "The cycle ordinal is not an integer.");

  const computed = checkedCycle(schedule, cycle);

  if (Result.isFailure(computed)) return Result.fail(computed.failure);

  return Result.succeed({
    cycleOrdinal,
    cycleDate: computed.success.cycleDate,
    serviceInterval: computed.success.serviceInterval,
  });
}

function selectRevision(
  revisions: ReadonlyArray<TemplateRevisionBoundary>,
  cycle: bigint,
): Checked<string> {
  const effective = revisions.map((candidate) => ({
    revision: candidate.revision,
    from: ordinal(candidate.effectiveFromCycle),
  }));

  if (effective.some((candidate) => candidate.from === null)) {
    return fail("InvalidCycleOrdinal", "A template revision boundary is not an integer.");
  }

  const applicable = effective
    .filter((candidate) => (candidate.from ?? 0n) <= cycle)
    .sort((left, right) => Number((right.from ?? 0n) - (left.from ?? 0n)));

  const winner = applicable.at(0);
  const runnerUp = applicable.at(1);

  if (winner === undefined) {
    return fail("NoTemplateRevisionForCycle", "No template revision is effective on this cycle.");
  }

  if (runnerUp !== undefined && winner.from === runnerUp.from) {
    return fail("AmbiguousTemplateRevision", "Two template revisions start on the same cycle.");
  }

  return Result.succeed(winner.revision);
}

function orderedEvents(events: ReadonlyArray<AgreementEventBoundary>) {
  const parsed = events.map((event) => ({
    kind: event.kind,
    effective: ordinal(event.effectiveCycle),
  }));

  if (parsed.some((event) => event.effective === null)) {
    return fail("InvalidCycleOrdinal", "An agreement event cycle is not an integer.");
  }

  return Result.succeed(
    parsed.sort((left, right) => {
      const leftCycle = left.effective ?? 0n;
      const rightCycle = right.effective ?? 0n;

      if (leftCycle !== rightCycle) return leftCycle < rightCycle ? -1 : 1;

      if (left.kind === right.kind) return 0;

      return left.kind < right.kind ? -1 : 1;
    }),
  );
}

function eventState(
  events: ReadonlyArray<AgreementEventBoundary>,
  cycle: bigint,
): Checked<CycleDisposition> {
  const ordered = orderedEvents(events);

  if (Result.isFailure(ordered)) return Result.fail(ordered.failure);
  let paused = false;

  for (const event of ordered.success) {
    if ((event.effective ?? 0n) > cycle) break;

    if (event.kind === "end") return Result.succeed({ kind: "skipped", reason: "ended" });

    if (event.kind === "pause") {
      if (paused) return fail("IncompleteEventHistory", "A pause repeats without a resume.");

      paused = true;
      continue;
    }

    if (!paused) return fail("IncompleteEventHistory", "A resume has no pause before it.");

    paused = false;
  }

  return paused
    ? Result.succeed({ kind: "skipped", reason: "paused" })
    : Result.succeed({ kind: "due" });
}

function coversSameService(left: ServiceInterval, right: ServiceInterval) {
  return left.serviceStartsOn <= right.serviceEndsOn && right.serviceStartsOn <= left.serviceEndsOn;
}

// Billing coverage is its own conflict check: a cadence or anchor change whose
// new ordinal scheme would cover an already billed service interval is refused
// rather than billed a second time.
export function assertNoOverlappingCoverage(
  candidate: { readonly cycleOrdinal: string; readonly serviceInterval: ServiceInterval },
  billedCoverage: ReadonlyArray<BilledCoverage>,
) {
  const conflicting = billedCoverage.filter(
    (billed) =>
      billed.cycleOrdinal !== candidate.cycleOrdinal &&
      coversSameService(candidate.serviceInterval, billed.serviceInterval),
  );

  return conflicting.length === 0
    ? Result.void
    : fail(
        "OverlappingBillingCoverage",
        "The cycle covers service already billed by another cycle of the same agreement.",
      );
}

// A resume discloses the paused cycles as skipped; it never bills them late.
export function planDueCycles(request: CyclePlanRequest): Checked<CyclePlan> {
  const through = ordinal(request.throughOrdinal);
  const first = ordinal(request.schedule.firstCycleOrdinal);
  const materialised = ordinal(request.materialisedThroughOrdinal ?? "");

  if (through === null || first === null) {
    return fail("InvalidCycleOrdinal", "The horizon or first cycle ordinal is not an integer.");
  }

  if (request.materialisedThroughOrdinal !== null && materialised === null) {
    return fail("InvalidCycleOrdinal", "The materialised ordinal is not an integer.");
  }

  if (through < first) {
    return Result.succeed({ due: [], skipped: [], continuationOrdinal: first.toString() });
  }

  if (through - first + 1n > maximumHorizonCycles) {
    return fail("IncompleteHorizon", "The requested horizon exceeds 240 cycles.");
  }

  const due: Array<PlannedCycle> = [];
  const skipped: Array<SkippedCycle> = [];

  for (let cycle = first; cycle <= through; cycle += 1n) {
    const cycleOrdinal = cycle.toString();

    if (materialised !== null && cycle <= materialised) {
      skipped.push({ cycleOrdinal, reason: "already_materialized" });

      continue;
    }

    const disposition = eventState(request.events, cycle);

    if (Result.isFailure(disposition)) return Result.fail(disposition.failure);

    if (disposition.success.kind === "skipped") {
      skipped.push({ cycleOrdinal, reason: disposition.success.reason });

      continue;
    }

    const identity = cycleIdentity(request.schedule, cycleOrdinal);

    if (Result.isFailure(identity)) return Result.fail(identity.failure);

    const revision = selectRevision(request.revisions, cycle);

    if (Result.isFailure(revision)) return Result.fail(revision.failure);

    const coverage = assertNoOverlappingCoverage(
      { cycleOrdinal, serviceInterval: identity.success.serviceInterval },
      request.billedCoverage,
    );

    if (Result.isFailure(coverage)) return Result.fail(coverage.failure);

    due.push({
      cycleOrdinal,
      cycleDate: identity.success.cycleDate,
      serviceInterval: identity.success.serviceInterval,
      selectedTemplateRevision: revision.success,
    });
  }

  return Result.succeed({ due, skipped, continuationOrdinal: (through + 1n).toString() });
}

// A due instant belongs to the invoice draft and issue-plan owner that holds the
// reviewed issue and due dates. This owner never infers one from a local date.
export function refuseDueInstant() {
  return fail(
    "DueInstantRequiresSchedulingOwner",
    "A due instant is an issue-plan input reviewed by the invoice draft owner.",
  );
}

export function assertUniqueChargeComponents(keys: ReadonlyArray<string>) {
  return new Set(keys).size === keys.length
    ? Result.void
    : fail("DuplicateChargeComponent", "A charge component key repeats within one cycle.");
}
