import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as P from "@open-erp/contracts/payroll-calculations";
import {
  bandsAreContiguous,
  exactTieredTotal,
  roundRationalToQuantumMinor,
} from "../../../src/application/payroll/calculation-basis";

const bands: ReadonlyArray<typeof P.ContributionBand.Type> = [
  { lowerMinor: "0", upperMinor: "100000", rate: { numerator: "1", denominator: "10" } },
  { lowerMinor: "100000", upperMinor: null, rate: { numerator: "1", denominator: "5" } },
];

function independentRound(n: bigint, d: bigint, mode: typeof P.RoundingMode.Type) {
  // Compare the two neighboring integer candidates directly; do not import production rounding.
  const q = n / d,
    r = n % d;

  if (r === 0n) return q;

  const lower = n < 0n ? q - 1n : q,
    upper = lower + 1n;

  if (mode === "floor") return lower;

  if (mode === "toward_zero") return q;

  const dl = n - lower * d,
    du = upper * d - n;

  if (dl < du) return lower;

  if (du < dl) return upper;

  return mode === "half_even" ? (lower % 2n === 0n ? lower : upper) : n < 0n ? lower : upper;
}

test("[EXC-PAYROLL-QUANTA] signed rational rounding preserves minor units and recorded residuals", () => {
  for (const scale of [0, 2, 3, 6])
    for (const mode of ["half_up", "half_even", "floor", "toward_zero"] as const)
      for (const n of [
        -300000051n,
        -1000000n,
        -51n,
        -50n,
        -1n,
        0n,
        1n,
        50n,
        51n,
        1000000n,
        300000051n,
        900719925474099312345n,
      ])
        for (const d of [1n, 2n, 3n, 100n]) {
          const Q = 10n ** BigInt(scale),
            expected = independentRound(n, d * Q, mode) * Q;

          const actual = roundRationalToQuantumMinor({ n, d }, { mode, scale });
          expect(actual.rounded).toBe(expected);
          expect(actual.residual).toBe(n - expected * d);
        }
});

test("[EXC-PAYROLL-BANDS] numeric thresholds and cumulative tiers use exact bounded inputs", () => {
  expect(bandsAreContiguous(bands)).toBe(true);

  const invalid: ReadonlyArray<ReadonlyArray<typeof P.ContributionBand.Type>> = [
    [],
    [bands[0]!],
    [{ ...bands[0]!, lowerMinor: "1" }, bands[1]!],
    [bands[1]!, bands[1]!],
    [{ ...bands[0]!, upperMinor: null }, bands[1]!],
  ];

  for (const brokenBands of invalid) expect(bandsAreContiguous(brokenBands)).toBe(false);

  for (const b of [0n, 1n, 99999n, 100000n, 100001n, 200000n, 9007199254740993n]) {
    const expectedNumerator = (b < 100000n ? b : 100000n) + 2n * (b > 100000n ? b - 100000n : 0n);
    const actual = exactTieredTotal(bands, b);
    expect(actual.n * 10n).toBe(expectedNumerator * actual.d);
  }

  const valid = {
    lowerMinor: "900",
    upperMinor: "1000",
    rate: { numerator: "1", denominator: "5" },
  };

  expect(Schema.decodeSync(P.ContributionBand)(valid)).toEqual(valid);
  expect(() =>
    Schema.decodeSync(P.ContributionBand)({ ...valid, lowerMinor: "1000", upperMinor: "900" }),
  ).toThrow();
});
