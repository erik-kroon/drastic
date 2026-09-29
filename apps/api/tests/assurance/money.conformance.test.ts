import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import { MinorUnits, SignedMinorUnits, AggregateMinorUnits } from "@open-erp/domain/money";
import {
  roundRational,
  cumulativeRelease,
  RoundingMode,
  assertBalancedJournal,
  type PurchaseJournalLine,
} from "@open-erp/domain/purchasing";
import { failedWith, succeeded } from "./pure-support";

const RoundVector = Schema.Struct({
  id: Schema.String,
  n: Schema.String,
  d: Schema.String,
  mode: RoundingMode,
  expected: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String),
});

const rounds = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      provenance: Schema.String,
      cases: Schema.Array(RoundVector),
    }),
  ),
)(
  readFileSync(
    new URL("../../../../verification/assurance/corpus/rounding.json", import.meta.url),
    "utf8",
  ),
);

test.each(rounds.cases)("[ASR-ROUND] $id $mode $n / $d", (vector) => {
  const result = roundRational(BigInt(vector.n), BigInt(vector.d), vector.mode);

  if (vector.expected === null) failedWith(result, vector.failure ?? "MissingExpectedFailure");
  else expect(succeeded(result).toString()).toBe(vector.expected);
});

const ReleaseVector = Schema.Struct({
  id: Schema.String,
  capacity: Schema.String,
  basis: Schema.String,
  consumed: Schema.String,
  consume: Schema.String,
  mode: RoundingMode,
  expected: Schema.String,
});

const releases = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      provenance: Schema.String,
      cases: Schema.Array(ReleaseVector),
    }),
  ),
)(
  readFileSync(
    new URL("../../../../verification/assurance/corpus/release.json", import.meta.url),
    "utf8",
  ),
);

test.each(releases.cases)("[ASR-RELEASE] $id releases the exact cumulative difference", (v) => {
  expect(
    succeeded(
      cumulativeRelease(
        BigInt(v.capacity),
        BigInt(v.basis),
        BigInt(v.consumed),
        BigInt(v.consume),
        v.mode,
      ),
    ).toString(),
  ).toBe(v.expected);
});

test.each(["-0", "01", "+1", "1e3", "1.00", " 1", "1 ", "", "9".repeat(39), -1, 1, null])(
  "[ASR-MONEY-LEX] line money refuses %j",
  (value) => {
    const raw = JSON.stringify(value);

    if (raw === undefined) throw new Error("Fixture must have a JSON representation");
    expect(() => Schema.decodeSync(Schema.fromJsonString(MinorUnits))(raw)).toThrow();
  },
);

test("[ASR-MONEY-BOUNDS] line and aggregate bounds are intentionally distinct", () => {
  expect(Schema.decodeSync(MinorUnits)("9".repeat(38))).toBe("9".repeat(38));
  expect(Schema.decodeSync(MinorUnits)("9007199254740993")).toBe("9007199254740993");
  expect(Schema.decodeSync(AggregateMinorUnits)("1" + "0".repeat(39))).toBe("1" + "0".repeat(39));
  expect(Schema.decodeSync(SignedMinorUnits)("-" + "9".repeat(40))).toBe("-" + "9".repeat(40));
  expect(() => Schema.decodeSync(SignedMinorUnits)("-0")).toThrow();
});

test.each([0n, -1n])("[ASR-ROUND-DENOM] denominator %s is refused", (denominator) => {
  failedWith(roundRational(10n, denominator, "half_up"), "UnsupportedRounding");
});

test.each([
  [-1n, 10n, 0n, 1n],
  [10n, -1n, 0n, 0n],
  [10n, 10n, -1n, 1n],
  [10n, 10n, 9n, 2n],
  [10n, 10n, 0n, -1n],
])("[ASR-RELEASE-REFUSE] invalid capacity %s %s %s %s", (capacity, basis, consumed, requested) => {
  failedWith(
    cumulativeRelease(capacity, basis, consumed, requested, "half_up"),
    "InsufficientDeductionRelease",
  );
});

test("[ASR-LINE-SHAPE] a net-balanced journal cannot conceal malformed sides", () => {
  const lines: Array<PurchaseJournalLine> = [
    {
      sourceLineId: null,
      accountId: "account_a",
      debitMinor: "100",
      creditMinor: "50",
      description: "bad both positive",
    },
    {
      sourceLineId: null,
      accountId: "account_b",
      debitMinor: "0",
      creditMinor: "50",
      description: "offset",
    },
  ];

  failedWith(assertBalancedJournal(lines, 2), "UnbalancedJournal");
  const first = lines[0];

  if (first === undefined) throw new Error("Fixture line missing");
  failedWith(
    assertBalancedJournal([{ ...first, debitMinor: "0", creditMinor: "0" }], 1),
    "UnbalancedJournal",
  );
});
