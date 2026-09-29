import { expect, test } from "vitest";
import { swedishBusinessDate } from "@open-erp/domain/values";
import * as R from "@open-erp/domain/recurrence";
import { succeeded, failedWith } from "./pure-support";

const monthly: R.RecurrenceSchedule = {
  anchorLocalDate: "2026-01-31",
  timeZone: "Europe/Stockholm",
  firstCycleOrdinal: "1",
  cadence: {
    kind: "monthly",
    monthInterval: "1",
    dayInterval: null,
    monthAnchorPolicy: "anchor_day_clamped",
  },
};

test.each([
  ["2025-12-31T23:30:00Z", "2026-01-01"],
  ["2026-05-31T22:30:00Z", "2026-06-01"],
  ["2026-10-25T00:30:00Z", "2026-10-25"],
  ["2026-10-25T01:30:00Z", "2026-10-25"],
  ["2026-03-29T00:30:00Z", "2026-03-29"],
  ["2026-03-29T01:30:00Z", "2026-03-29"],
])("[ASR-BUSINESS-DATE] %s maps to Stockholm %s", (instant, expected) => {
  expect(swedishBusinessDate(new Date(instant))).toBe(expected);
});

test("[ASR-CYCLE-ANCHOR] monthly recurrence always returns to the original anchor", () => {
  expect(succeeded(R.cycleDate(monthly, "1"))).toBe("2026-02-28");
  expect(succeeded(R.cycleDate(monthly, "2"))).toBe("2026-03-31");
  expect(succeeded(R.cycleDate({ ...monthly, anchorLocalDate: "2000-01-31" }, "1"))).toBe(
    "2000-02-29",
  );
  expect(succeeded(R.cycleDate({ ...monthly, anchorLocalDate: "1900-01-31" }, "1"))).toBe(
    "1900-02-28",
  );
  failedWith(R.cycleDate({ ...monthly, anchorLocalDate: "2026-02-30" }, "1"), "InvalidAnchor");
  failedWith(R.cycleDate({ ...monthly, firstCycleOrdinal: "0" }, "0"), "InvalidServiceInterval");
});

test("[ASR-CYCLE-ADJACENCY] consecutive half-open periods do not overlap", () => {
  const one = succeeded(R.cycleIdentity(monthly, "1"));
  const two = succeeded(R.cycleIdentity(monthly, "2"));
  expect(one.serviceInterval).toEqual({
    serviceStartsOn: "2026-01-31",
    serviceEndsOn: "2026-02-28",
  });
  expect(two.serviceInterval).toEqual({
    serviceStartsOn: "2026-02-28",
    serviceEndsOn: "2026-03-31",
  });
  succeeded(R.assertNoOverlappingCoverage(two, [one]));
  failedWith(
    R.assertNoOverlappingCoverage(
      {
        cycleOrdinal: "3",
        serviceInterval: { serviceStartsOn: "2026-02-27", serviceEndsOn: "2026-03-05" },
      },
      [one],
    ),
    "OverlappingBillingCoverage",
  );
  failedWith(
    R.assertNoOverlappingCoverage(
      {
        cycleOrdinal: "4",
        serviceInterval: { serviceStartsOn: "2026-02-28", serviceEndsOn: "2026-02-28" },
      },
      [],
    ),
    "InvalidServiceInterval",
  );
});

test("[ASR-CYCLE-LIFECYCLE] pause/resume is explicit and does not silently bill gaps", () => {
  const plan = succeeded(
    R.planDueCycles({
      schedules: [{ revision: "1", effectiveFromCycle: "1", schedule: monthly }],
      revisions: [
        { revision: "1", effectiveFromCycle: "1" },
        { revision: "2", effectiveFromCycle: "4" },
      ],
      events: [
        { kind: "pause", effectiveCycle: "2" },
        { kind: "resume", effectiveCycle: "4" },
      ],
      billedCoverage: [],
      materialisedThroughOrdinal: null,
      throughOrdinal: "5",
    }),
  );

  expect(plan.due.map((x) => [x.cycleOrdinal, x.selectedTemplateRevision])).toEqual([
    ["1", "1"],
    ["4", "2"],
    ["5", "2"],
  ]);
  expect(plan.skipped).toEqual([
    { cycleOrdinal: "2", reason: "paused" },
    { cycleOrdinal: "3", reason: "paused" },
  ]);
  failedWith(
    R.eventDisposition([{ kind: "resume", effectiveCycle: "1" }], "1"),
    "IncompleteEventHistory",
  );
});
