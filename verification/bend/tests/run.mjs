import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, cp, copyFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir, platform, arch } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { loadEngine, ROOT, BEND_PIN } from "../lib/engine.mjs";
import { modes, mode, minor, roundReference } from "../lib/money.mjs";
import { calculateVat } from "../lib/vat.mjs";
import { loadVatOwner } from "../lib/owner.mjs";
import { solveCover } from "../lib/cover.mjs";
import { validateVoucher, allocate } from "../lib/accounting.mjs";

const started = performance.now();

let checks = 0;

const groups = {};

const reportFile = resolve(ROOT, "evidence/test-report.json");

writeFileSync(reportFile, JSON.stringify({ status: "running", releaseVerified: false }) + "\n");

process.once("uncaughtExceptionMonitor", (error) => {
  writeFileSync(
    reportFile,
    JSON.stringify(
      {
        status: "failed",
        releaseVerified: false,
        assertions: checks,
        groups,
        error: String(error),
      },
      null,
      2,
    ) + "\n",
  );
});

const e = await loadEngine();

const eq = (a, b, message) => {
  assert.deepStrictEqual(a, b, message);
  checks++;
};

const ok = (a, message) => {
  assert.ok(a, message);
  checks++;
};

const rejects = (fn) => {
  assert.throws(fn);
  checks++;
};

const group = async (name, fn) => {
  const c = checks,
    t = performance.now();

  await fn();
  groups[name] = { assertions: checks - c, ms: Math.round(performance.now() - t) };
  console.log(`${name}: ${checks - c} assertions`);
};

let seed = 0x5eeda11;

const rand = (max) => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;

  return (seed >>> 0) % max;
};

const gcd = (a, b) => {
  while (b) {
    [a, b] = [b, a % b];
  }

  return a;
};

const natCall = (f, a, b) => e.fromNat(e.call(`BigNat.${f}`, e.nat(a), e.nat(b)));

const intCall = (f, a, b) => e.fromInteger(e.call(`BigInt.${f}`, e.integer(a), e.integer(b)));

const large = 10n ** 38n - 1n;

await group("BigNat arithmetic and bounds", () => {
  for (let a = 0n; a < 18n; a++)
    for (let b = 0n; b < 18n; b++) {
      eq(natCall("add", a, b), a + b);
      eq(natCall("multiply", a, b), a * b);
      eq(natCall("monus", a, b), a > b ? a - b : 0n);
      const s = e.call("BigNat.subtract", e.nat(a), e.nat(b));
      eq(s.k, a < b ? "BigNat.Underflow" : "BigNat.Difference");

      if (a >= b) eq(e.fromNat(s.x[0]), a - b);
      const d = e.call("BigNat.divmod", e.nat(a), e.nat(b));
      eq(d.k, b === 0n ? "BigNat.DivisionByZero" : "BigNat.Divided");

      if (b !== 0n) {
        eq(e.fromNat(d.x[0]), a / b);
        eq(e.fromNat(d.x[1]), a % b);
      }

      eq(
        e.call("BigNat.compare", e.nat(a), e.nat(b)).k,
        a < b ? "Foundation.Less" : a > b ? "Foundation.More" : "Foundation.Same",
      );
    }

  for (let i = 0; i < 18; i++) {
    const a =
      i === 0
        ? large
        : (BigInt(rand(2 ** 32)) << 96n) |
          (BigInt(rand(2 ** 32)) << 64n) |
          (BigInt(rand(2 ** 32)) << 32n) |
          BigInt(rand(2 ** 32));

    const b = i === 0 ? large : BigInt(rand(1_000_000) + 1);
    eq(natCall("add", a, b), a + b);
    eq(natCall("multiply", a, b), a * b);
    const d = e.call("BigNat.divmod", e.nat(a), e.nat(b));
    eq(e.fromNat(d.x[0]), a / b);
    eq(e.fromNat(d.x[1]), a % b);
    const g = e.call("BigNat.gcd", e.nat(a), e.nat(b));
    eq(g.k, "BigNat.GcdValue");
    eq(e.fromNat(g.x[0]), gcd(a, b));
  }

  const redundant = e.c("BigNat.Even", e.c("BigNat.Even", e.c("BigNat.Zero")));
  eq(e.call("BigNat.normalize", redundant).k, "BigNat.Zero");
  eq(e.fromNat(e.call("BigNat.add", redundant, e.nat(123n))), 123n);
  eq(e.call("BigNat.gcdLoop", e.count(0), e.nat(4n), e.nat(2n)).k, "BigNat.GcdExhausted");

  for (const v of [
    "-0",
    "00",
    "01",
    "+1",
    "1e2",
    "1.0",
    " 1",
    "1 ",
    "1,000",
    "9".repeat(39),
    1,
    1n,
    null,
  ])
    rejects(() => minor(v, { signed: true }));
  eq(minor("9".repeat(38)), large);
});

await group("BigInt sign and division", () => {
  for (let a = -12n; a <= 12n; a++)
    for (let b = -12n; b <= 12n; b++) {
      eq(intCall("add", a, b), a + b);
      eq(intCall("subtract", a, b), a - b);
      eq(intCall("multiply", a, b), a * b);
      eq(
        e.call("BigInt.compare", e.integer(a), e.integer(b)).k,
        a < b ? "Foundation.Less" : a > b ? "Foundation.More" : "Foundation.Same",
      );
      const d = e.call("BigInt.divmod", e.integer(a), e.integer(b));
      eq(d.k, b === 0n ? "BigInt.SignedDivisionByZero" : "BigInt.SignedDivided");

      if (b) {
        eq(e.fromInteger(d.x[0]), a / b);
        eq(e.fromInteger(d.x[1]), a % b);
      }
    }

  eq(intCall("multiply", -large, large), -large * large);
  eq(e.force(e.call("BigInt.make", e.flag(true), e.nat(0n)).x[0]).k, "Foundation.No");
});

await group("Reduced rationals and rounding", () => {
  for (let i = 0; i < 45; i++) {
    const n = BigInt(rand(10001) - 5000),
      d = BigInt(rand(99) + 1),
      g = gcd(n < 0n ? -n : n, d);

    const r = e.call("Rational.make", e.integer(n), e.nat(d));
    eq(r.k, "Rational.RationalValue");
    const frac = e.force(r.x[0]);
    eq(e.fromInteger(frac.x[0]), n / g);
    eq(e.fromNat(frac.x[1]), d / g);
    const b = e.c("Rational.Fraction", e.integer(3n), e.nat(7n));
    const sum = e.call("Rational.add", frac, b);
    eq(sum.k, "Rational.RationalValue");

    const added = e.force(sum.x[0]),
      an = e.fromInteger(added.x[0]),
      ad = e.fromNat(added.x[1]);

    eq(an * d * 7n, (n * 7n + 3n * d) * ad);

    const product = e.call("Rational.multiply", frac, b),
      pv = e.force(product.x[0]);

    eq(e.fromInteger(pv.x[0]) * d * 7n, n * 3n * e.fromNat(pv.x[1]));

    const quotient = e.call("Rational.divide", frac, b),
      qv = e.force(quotient.x[0]);

    eq(e.fromInteger(qv.x[0]) * d * 3n, n * 7n * e.fromNat(qv.x[1]));
  }

  eq(e.call("Rational.make", e.integer(0n), e.nat(0n)).k, "Rational.ZeroDenominator");
  const zeroFrac = e.c("Rational.Fraction", e.integer(0n), e.nat(1n));
  eq(e.call("Rational.divide", zeroFrac, zeroFrac).k, "Rational.ZeroDenominator");

  for (const rounding of Object.keys(modes))
    for (const d of [1n, 2n, 3n, 10n, 100n])
      for (const n of [
        -301n,
        -300n,
        -251n,
        -250n,
        -200n,
        -199n,
        -150n,
        -100n,
        -1n,
        0n,
        1n,
        100n,
        150n,
        250n,
        301n,
      ]) {
        const result = e.call("Rational.round", e.integer(n), e.nat(d), mode(e, rounding)),
          ref = roundReference(n, d, rounding);

        eq(result.k, ref === null ? "Rational.Inexact" : "Rational.Rounded");

        if (ref) {
          eq(e.fromInteger(result.x[0]), ref.value);
          eq(e.fromInteger(result.x[1]), ref.residual);
          eq(e.fromInteger(result.x[0]) * d + e.fromInteger(result.x[1]), n);
        }
      }

  eq(
    e.call("Rational.round", e.integer(1n), e.nat(0n), mode(e, "floor")).k,
    "Rational.RoundingZeroDenominator",
  );
});

await group("Decimal conversion", () => {
  for (const value of [
    ...Array.from({ length: 55 }, (_, i) => BigInt(i)),
    large,
    large + 1n,
    large * large,
    123456789012345678901234567890n,
  ]) {
    let ds = e.c("Decimal.EndDigits");

    for (const c of value.toString().split("").reverse())
      ds = e.c("Decimal.Digit", e.c(`Decimal.D${c}`), ds);
    eq(e.fromNat(e.call("Decimal.fromDigits", ds)), value);
    const out = e.call("Decimal.toDigits", e.nat(value));
    eq(out.k, "Decimal.Converted");

    let t = out.x[0],
      s = "";

    for (;;) {
      const d = e.force(t);

      if (d.k === "Decimal.EndDigits") break;
      s += e.force(d.x[0]).k.slice(-1);
      t = d.x[1];
    }

    eq(s, value.toString());
  }
});

await group("Ledger and allocation invariants", () => {
  for (let i = 0; i < 70; i++) {
    const n = i === 0 ? large : BigInt(rand(1_000_000) + 1);

    const valid = [
      { debitMinor: n.toString(), creditMinor: "0" },
      { debitMinor: "0", creditMinor: n.toString() },
    ];

    eq(validateVoucher(e, valid).accepted, true);
    eq(
      validateVoucher(
        e,
        valid.toReversed().map((x) => ({ debitMinor: x.creditMinor, creditMinor: x.debitMinor })),
      ).accepted,
      true,
    );
    eq(
      validateVoucher(e, [valid[0], { debitMinor: "0", creditMinor: (n - 1n).toString() }])
        .accepted,
      false,
    );
  }

  eq(validateVoucher(e, []).accepted, false);
  eq(validateVoucher(e, [{ debitMinor: "0", creditMinor: "0" }]).accepted, false);
  eq(
    validateVoucher(e, [
      { debitMinor: "1", creditMinor: "1" },
      { debitMinor: "1", creditMinor: "1" },
    ]).accepted,
    false,
  );

  for (let i = 0; i < 100; i++) {
    const amount = BigInt(rand(100)),
      source = BigInt(rand(120)),
      target = BigInt(rand(120));

    const r = allocate(e, {
      amountMinor: String(amount),
      sourceRemainingMinor: String(source),
      targetRemainingMinor: String(target),
    });

    if (amount === 0n) eq(r.status, "ZeroAmount");
    else if (amount > source || amount > target) eq(r.status, "CapacityExceeded");
    else {
      eq(r.status, "allocated-arithmetic");
      eq(BigInt(r.sourceAfterMinor) + amount, source);
      eq(BigInt(r.targetAfterMinor) + amount, target);
      eq(r.restoredSourceMinor, String(source));
      eq(r.restoredTargetMinor, String(target));
    }
  }
});

const owner = await loadVatOwner(),
  fixedOwner = await loadVatOwner({ patchInMemory: true });

const regressions = [];

await group("Historical VAT excerpt differential checks", () => {
  for (const rounding of ["half_up", "half_even", "toward_zero", "floor"])
    for (const d of [1n, 2n, 10n, 100n])
      for (const n of [-300n, -250n, -200n, -199n, -150n, -100n, -1n, 0n, 1n, 150n, 250n]) {
        const expected = roundReference(n, d, rounding).value,
          original = owner.round(n, d, rounding);

        eq(fixedOwner.round(n, d, rounding), expected);

        if (original !== expected) {
          ok(rounding === "floor" && n < 0n && n % d === 0n);
          regressions.push({
            numerator: String(n),
            denominator: String(d),
            mode: rounding,
            observed: String(original),
            expected: String(expected),
          });
        } else eq(original, expected);
      }

  ok(regressions.length > 0);
  eq(owner.round(-100n, 100n, "floor"), -2n);
  eq(fixedOwner.round(-100n, 100n, "floor"), -1n);

  for (let i = 0; i < 80; i++) {
    const rounding = ["half_up", "half_even", "toward_zero", "floor"][i % 4],
      filingUnitScale = i % 4;

    const contributions = Array.from({ length: rand(12) }, () => ({
      box: ["05", "10", "11", "12", "48"][rand(5)],
      signedMinor: String(rand(10001) - 5000),
      included: rand(4) !== 0,
    }));

    const declareNet = rand(2) === 1,
      request = {
        contributions,
        currencyScale: filingUnitScale,
        filingUnitScale: 0,
        rounding,
        declareNet,
      };

    const result = calculateVat(e, request);
    eq(
      result,
      fixedOwner.boxRows(
        { filingUnitScale, rounding },
        contributions.filter((x) => x.included),
        declareNet,
      ),
    );

    for (const row of result)
      eq(
        BigInt(row.reportedMinor) * 10n ** BigInt(filingUnitScale) + BigInt(row.residualMinor),
        BigInt(row.exactMinor),
      );
  }

  const fixture = {
    contributions: [
      { box: "10", signedMinor: "199", included: true },
      { box: "48", signedMinor: "101", included: true },
    ],
    currencyScale: 2,
    filingUnitScale: 0,
    rounding: "toward_zero",
    declareNet: true,
  };

  eq(calculateVat(e, fixture).at(-1).reportedMinor, "0");
  eq(
    calculateVat(e, {
      ...fixture,
      contributions: [{ box: "10", signedMinor: "999", included: false }],
    }).at(-1).exactMinor,
    "0",
  );
});

await group("VAT filing-unit scale contract", () => {
  const input = {
    contributions: [
      { box: "10", signedMinor: "199", included: true },
      { box: "48", signedMinor: "101", included: true },
    ],
    currencyScale: 2,
    filingUnitScale: 0,
    rounding: "toward_zero",
    declareNet: true,
  };

  eq(calculateVat(e, input), [
    { box: "10", kind: "primitive", exactMinor: "199", reportedMinor: "1", residualMinor: "99" },
    { box: "48", kind: "primitive", exactMinor: "101", reportedMinor: "1", residualMinor: "1" },
    { box: "49", kind: "net", exactMinor: "98", reportedMinor: "0", residualMinor: "98" },
  ]);
  eq(calculateVat(e, { ...input, filingUnitScale: 2 }).at(-1), {
    box: "49",
    kind: "net",
    exactMinor: "98",
    reportedMinor: "98",
    residualMinor: "0",
  });

  for (const scale of [undefined, -1, 0.5, 7, "2", null]) {
    rejects(() => calculateVat(e, { ...input, currencyScale: scale }));
    rejects(() => calculateVat(e, { ...input, filingUnitScale: scale }));
  }

  rejects(() => calculateVat(e, { ...input, filingUnitScale: 3 }));

  for (let currencyScale = 0; currencyScale <= 6; currencyScale++)
    for (let filingUnitScale = 0; filingUnitScale <= currencyScale; filingUnitScale++) {
      const rows = calculateVat(e, {
        ...input,
        currencyScale,
        filingUnitScale,
        contributions: [{ box: "10", signedMinor: "-199", included: true }],
      });

      const divisor = 10n ** BigInt(currencyScale - filingUnitScale);
      eq(rows[0].reportedMinor, String(-199n / divisor));
      eq(rows[0].residualMinor, String(-199n % divisor));
    }
});

const baseScope = { entityId: "entity-a", bookId: "book-a", snapshotId: "snapshot-1" };

function request(values, target, opts = {}) {
  return {
    scope: baseScope,
    currency: "SEK",
    scale: 2,
    direction: "inflow",
    targetMinor: String(target),
    poolComplete: true,
    candidates: values.map((n, i) => ({
      id: `candidate-${i}`,
      revision: "1",
      scope: baseScope,
      currency: "SEK",
      scale: 2,
      direction: "inflow",
      remainingMinor: String(n),
    })),
    limits: { maxCardinality: values.length, nodeBudget: 10_000 },
    ...opts,
  };
}

function brute(values, target, slots) {
  const result = [];

  for (let mask = 1; mask < 2 ** values.length; mask++) {
    let total = 0n,
      n = 0;

    for (let i = 0; i < values.length; i++)
      if (mask & (1 << i)) {
        total += BigInt(values[i]);
        n++;
      }

    if (n <= slots && total === BigInt(target)) result.push(mask);
  }

  return result;
}

await group("PRY-33 exhaustive differential and scope", () => {
  for (let i = 0; i < 95; i++) {
    const values = Array.from({ length: rand(8) }, () => rand(30) + 1),
      target = rand(80) + 1,
      slots = rand(values.length + 1),
      expected = brute(values, target, slots);

    const input = request(values, target, {
        limits: { maxCardinality: slots, nodeBudget: 10_000 },
      }),
      result = solveCover(e, input);

    eq(
      result.status,
      expected.length === 0
        ? "no-match-within-scope"
        : expected.length === 1
          ? "unique-within-scope"
          : "ambiguous",
    );
    ok(result.coverage.visitedNodes <= input.limits.nodeBudget);
    eq(
      solveCover(e, { ...input, candidates: input.candidates.toReversed() }).inputFingerprint,
      result.inputFingerprint,
    );
  }

  eq(solveCover(e, request([40, 60, 100], 100)).status, "ambiguous");
  eq(solveCover(e, request([50, 50], 50)).status, "ambiguous");
  eq(solveCover(e, request([large, 1n], large)).status, "unique-within-scope");

  for (const budget of [0, 1, 2, 3, 4, 5, 8, 12]) {
    const input = request([4, 7, 11, 15], 22, {
        limits: { maxCardinality: 4, nodeBudget: budget },
      }),
      r = solveCover(e, input);

    ok(r.coverage.visitedNodes <= budget);

    if (!r.coverage.searchExhausted && r.witnesses.length < 2) eq(r.status, "incomplete");
  }

  eq(solveCover(e, request([], 1, { poolComplete: false })).status, "incomplete");
  eq(solveCover(e, request([1], 1, { poolComplete: false })).status, "incomplete");
  eq(solveCover(e, request([1, 1], 1, { poolComplete: false })).status, "ambiguous");
  eq(solveCover(null, request([1], 1)).status, "unavailable");
  const invalid = request([1], 1);

  for (const change of [
    { currency: "EUR" },
    { direction: "outflow" },
    { scale: 3 },
    { remainingMinor: "0" },
    { remainingMinor: "-1" },
    { scope: { ...baseScope, snapshotId: "old" } },
    { scope: { ...baseScope, bookId: "other" } },
  ])
    rejects(() =>
      solveCover(e, { ...invalid, candidates: [{ ...invalid.candidates[0], ...change }] }),
    );
  rejects(() =>
    solveCover(e, { ...invalid, candidates: [invalid.candidates[0], invalid.candidates[0]] }),
  );
  rejects(() => solveCover(e, { ...invalid, targetMinor: "0" }));
  rejects(() => solveCover(e, { ...invalid, targetMinor: "9".repeat(39) }));
  rejects(() => solveCover(e, { ...invalid, poolComplete: undefined }));
});

await group("Negative proof and checker controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bend controls.with spaces-"));

  try {
    await copyFile(resolve(ROOT, "bend/Foundation.bend"), join(directory, "Foundation.bend"));
    const prefix = "import ./Foundation.bend as F\n";
    const positive = join(directory, "positive.bend");
    await writeFile(
      positive,
      prefix + "law valid_claim:\n  {F.Yes{} == F.Yes{} : F.Flag}\ndef valid_claim():\n  {==}\n",
    );
    ok((await loadEngine(positive)).definitions > 0);

    const cases = [
      "law false_claim:\n  {F.Yes{} == F.No{} : F.Flag}\ndef false_claim():\n  {==}\n",
      "law open_claim:\n  {F.Yes{} == F.Yes{} : F.Flag}\n",
      "law hole_claim:\n  {F.Yes{} == F.No{} : F.Flag}\ndef hole_claim():\n  ?TODO\n",
      "@unsafe def unsafe_term() -> F.Flag:\n  F.Yes{}\n",
      "def loop(x: F.Flag) -> F.Flag:\n  loop(x)\n",
      "def affine(x: F.Flag) -> F.Flag:\n  F.and(x, x)\n",
    ];

    for (let i = 0; i < cases.length; i++) {
      const file = join(directory, `negative${i}.bend`);
      await writeFile(file, prefix + cases[i]);
      let failed = false;

      try {
        await loadEngine(file);
      } catch {
        failed = true;
      }

      ok(failed, `Negative checker control ${i} must fail`);
    }

    const mutant = join(directory, "mutant");
    await cp(resolve(ROOT, "bend"), mutant, { recursive: true });
    const reversalFile = join(mutant, "Ledger.bend");
    const reversalSource = await readFile(reversalFile, "utf8");
    await writeFile(
      reversalFile,
      reversalSource.replace("Line{c, d, reverse(rest)}", "Line{d, c, reverse(rest)}"),
    );
    let rejected = false;

    try {
      await loadEngine(join(mutant, "Kernel.bend"));
    } catch (error) {
      rejected = /reversal_debits|reversal_credits/.test(error.message);
    }

    ok(rejected, "Non-swapping reversal must fail its proof");
    await writeFile(reversalFile, reversalSource);
    const roundingFile = join(mutant, "Rational.bend");
    const roundingSource = await readFile(roundingFile, "utf8");
    await writeFile(
      roundingFile,
      roundingSource.replace("F.and(negative, F.not(N.isZero(r)))", "negative"),
    );
    rejected = false;

    try {
      await loadEngine(join(mutant, "Kernel.bend"));
    } catch (error) {
      rejected = /floor_exact_no_increment/.test(error.message);
    }

    ok(rejected, "Exact negative-floor regression must fail its law");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const laws =
  (await readFile(resolve(ROOT, "bend/LAWS.bend"), "utf8")).match(/^law /gm)?.length ?? 0;

const report = {
  status: "passed-source-checks",
  releaseVerified: false,
  checker: e.authority,
  bendCommit: BEND_PIN,
  historicalOpenERPCommit: "0eaad6402241ff3853fdc1af015e13f343873641",
  node: process.version,
  platform: platform(),
  arch: arch(),
  lawProofPairs: laws,
  definitions: e.definitions,
  assertions: checks,
  groups,
  elapsedMs: Math.round(performance.now() - started),
  upstreamRoundingRegressions: regressions,
  unverified: [
    "official Bend binary",
    "Bend --safe kernel",
    "native C/Metal/CUDA backends",
    "full OpenERP runtime and PostgreSQL transactions",
    "statutory VAT applicability",
  ],
};

await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");

console.log(
  `PASS: ${checks} assertions; ${laws} law/proof pairs under ${e.authority}. Official release gate NOT run.`,
);
