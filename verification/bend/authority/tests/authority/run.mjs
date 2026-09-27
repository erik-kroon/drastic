import { SEMANTICS } from "../../src/semantics.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, cp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, loadEngine, BEND_PIN } from "../../lib/engine.mjs";
import { loadTestEngine } from "../test-engine.mjs";
import { roundReference } from "../../lib/money.mjs";
import { runOperation, verifyOutput, checkRounding } from "../../src/operations.mjs";
import { canonical, digest, digestBytes, snapshot } from "../../src/contracts.mjs";
import {
  createShadowService,
  qualifiedService,
  verifyRetained,
  assertExecutionBinding,
} from "../../src/service.mjs";
import { qualifyManifest, REQUIRED_RECEIPTS } from "../../src/release.mjs";
import { compiledEngine } from "../../src/compiled-engine.mjs";
import { runIsolated } from "../../src/node-isolation.mjs";

const e = await loadTestEngine(),
  start = performance.now();

let assertions = 0;

const groups = {};

const eq = (a, b, m) => {
  assert.deepEqual(a, b, m);
  assertions++;
};

const ok = (v, m) => {
  assert.ok(v, m);
  assertions++;
};

const bad = (f, code) => {
  assert.throws(f, code ? (x) => x.code === code : undefined);
  assertions++;
};

const rejects = async (f, code) => {
  await assert.rejects(f, code ? (x) => x.code === code : undefined);
  assertions++;
};

async function group(name, f) {
  const before = assertions,
    at = performance.now();

  await f();
  groups[name] = { assertions: assertions - before, ms: Math.round(performance.now() - at) };
  console.log(name, groups[name]);
}

const h = (n) => `sha256:${String(n).repeat(64)}`;

const ctx = {
  entityId: "entity-a",
  bookId: "book-a",
  snapshotId: "snapshot-1",
  basisDigest: h(1),
  ruleReleaseId: "rule-1",
  ruleDigest: h(2),
  profileVersion: "company-1",
  dependencies: [{ resource: "source-a", revision: "3" }],
};

const vat = {
  currency: "SEK",
  scale: 2,
  contributions: [
    { id: "sale/1", box: "10", signedMinor: "199", included: true },
    { id: "purchase/1", box: "48", signedMinor: "101", included: true },
  ],
  reportingUnitMinor: "100",
  rounding: "toward_zero",
  declareNet: true,
};

const request = { operation: "vat.project.v1", context: ctx, input: vat };

const semantics = SEMANTICS;

await group("Operation kernels and boundary oracles", () => {
  for (let i = 1; i <= 40; i++) {
    const total = i === 40 ? 10n ** 38n - 1n : BigInt(i * 997 * (i % 2 ? -1 : 1));

    const input = {
      currency: "SEK",
      scale: 2,
      remainingMinor: String(total),
      periodIds: Array.from({ length: 1 + (i % 19) }, (_, j) => `period-${j}`),
      policy: "equal-magnitude-remainder-last-v1",
    };

    const r = runOperation(e, "schedule.equal.v1", input);
    eq(r.rows.length, input.periodIds.length);
    eq(
      r.rows.reduce((s, v) => s + BigInt(v.amountMinor), 0n),
      total,
    );

    for (let j = 0; j < r.rows.length; j++)
      eq(
        BigInt(r.rows[j].amountMinor),
        total / BigInt(r.rows.length) +
          (j === r.rows.length - 1 ? total % BigInt(r.rows.length) : 0n),
      );
  }

  for (let i = 0; i < 100; i++) {
    const input = {
      baseCurrency: "EUR",
      quoteCurrency: "SEK",
      fromScale: i % 5,
      toScale: i % 7,
      amountMinor: String(i * 738 - 32000),
      rateNumerator: String(i + 1),
      rateDenominator: String((i % 17) + 1),
      rounding: ["half_up", "half_even", "toward_zero", "floor", "ceiling"][i % 5],
      rateConvention: "quote-major-per-base-major-v1",
    };

    const r = runOperation(e, "fx.convert.v1", input),
      n = BigInt(input.amountMinor) * BigInt(input.rateNumerator) * 10n ** BigInt(input.toScale),
      d = BigInt(input.rateDenominator) * 10n ** BigInt(input.fromScale);

    const ref = roundReference(n, d, input.rounding);
    eq(BigInt(r.convertedMinor), ref.value);
    eq(BigInt(r.residualNumerator), ref.residual);
    eq(BigInt(r.denominator), d);
  }

  const exact = {
    baseCurrency: "EUR",
    quoteCurrency: "SEK",
    fromScale: 2,
    toScale: 2,
    amountMinor: "1",
    rateNumerator: "1",
    rateDenominator: "3",
    rounding: "exact",
    rateConvention: "quote-major-per-base-major-v1",
  };

  bad(() => runOperation(e, "fx.convert.v1", exact), "CalculationRefused");
  bad(() => runOperation(e, "fx.convert.v1", { ...exact, rateDenominator: "0" }), "InvalidMoney");
  bad(
    () =>
      runOperation(e, "fx.convert.v1", {
        ...exact,
        amountMinor: "9".repeat(38),
        rateNumerator: "9".repeat(38),
        rateDenominator: "1",
      }),
    "InvalidMoney",
  );
  const r = runOperation(e, "vat.project.v1", vat);
  eq(r.rows.at(-1).reportedMinor, "0");
  eq(r.rows.at(-1).residualMinor, "98");

  for (const rounding of ["half_up", "half_even", "toward_zero", "floor"])
    for (const n of ["-300", "-250", "0", "101", "250", "9".repeat(38)]) {
      const x = {
        ...vat,
        rounding,
        contributions: [{ id: "one", box: "10", signedMinor: n, included: true }],
      };

      const out = runOperation(e, "vat.project.v1", x);
      eq(BigInt(out.rows[0].reportedMinor), roundReference(BigInt(n), 100n, rounding).value);
    }

  const alloc = {
    currency: "SEK",
    scale: 2,
    amountMinor: "3",
    sourceRemainingMinor: "7",
    targetRemainingMinor: "10",
  };

  eq(runOperation(e, "settlement.allocate.v1", alloc), {
    sourceAfterMinor: "4",
    targetAfterMinor: "7",
  });
  bad(
    () => runOperation(e, "settlement.allocate.v1", { ...alloc, amountMinor: "11" }),
    "CalculationRefused",
  );

  const rev = {
    currency: "SEK",
    scale: 2,
    originalVoucherId: "voucher-1",
    lines: [
      {
        id: "a",
        accountId: "bank",
        dimensions: { department: "north" },
        debitMinor: "1200",
        creditMinor: "0",
      },
      {
        id: "b",
        accountId: "income",
        dimensions: { department: "north" },
        debitMinor: "0",
        creditMinor: "1200",
      },
    ],
  };

  const reversed = runOperation(e, "ledger.reverse.v1", rev);
  eq(reversed.lines[0], {
    originalLineId: "a",
    accountId: "bank",
    dimensions: { department: "north" },
    debitMinor: "0",
    creditMinor: "1200",
  });
  bad(
    () =>
      runOperation(e, "ledger.reverse.v1", {
        ...rev,
        lines: [rev.lines[0], { ...rev.lines[1], creditMinor: "1199" }],
      }),
    "InvalidInput",
  );
});

await group("Independent certificate checks reject plausible wrong results", () => {
  // Residual conservation alone would accept this incorrect rounding.
  bad(() => checkRounding(199n, 100n, 0n, 199n, "toward_zero"), "InvalidKernelOutput");
  bad(() => checkRounding(-100n, 100n, -2n, 100n, "floor"), "InvalidKernelOutput");
  bad(() => checkRounding(250n, 100n, 3n, -50n, "half_even"), "InvalidKernelOutput");
  bad(() => checkRounding(250n, 100n, 2n, 50n, "half_up"), "InvalidKernelOutput");
  checkRounding(-250n, 100n, -3n, 50n, "half_up");
  assertions++;

  for (let n = -10n; n <= 10n; n++)
    for (let d = 1n; d <= 5n; d++)
      for (const m of ["floor", "ceiling", "half_even", "half_up", "toward_zero"]) {
        const ref = roundReference(n, d, m);
        checkRounding(n, d, ref.value, ref.residual, m);
        assertions++;
        bad(
          () => checkRounding(n, d, ref.value + 2n, n - (ref.value + 2n) * d, m),
          "InvalidKernelOutput",
        );
      }

  const r = runOperation(e, "vat.project.v1", vat);
  const forged = structuredClone(r);
  forged.rows.at(-1).reportedMinor = "1";
  forged.rows.at(-1).residualMinor = "-2";
  bad(() => verifyOutput("vat.project.v1", vat, forged), "InvalidKernelOutput");
  bad(() => verifyOutput("vat.project.v1", vat, { rows: r.rows.slice(1) }), "InvalidKernelOutput");
  bad(
    () =>
      runOperation(e, "vat.project.v1", {
        ...vat,
        contributions: [vat.contributions[0], vat.contributions[0]],
      }),
    "InvalidInput",
  );
  bad(() => runOperation(e, "vat.project.v1", { ...vat, declareNet: undefined }), "InvalidInput");
  bad(
    () =>
      runOperation(e, "vat.project.v1", {
        ...vat,
        contributions: [{ ...vat.contributions[0], signedMinor: 12 }],
      }),
    "InvalidMoney",
  );
  bad(
    () =>
      runOperation(e, "schedule.equal.v1", {
        currency: "SEK",
        scale: 2,
        remainingMinor: "100",
        periodIds: ["x", "x"],
        policy: "equal-magnitude-remainder-last-v1",
      }),
    "InvalidInput",
  );
});

await group("Exact immutable envelopes and failure behavior", async () => {
  eq(canonical({ b: 1, a: "2" }), canonical({ a: "2", b: 1 }));
  bad(() => canonical({ x: undefined }), "InvalidInput");
  bad(() => canonical({ x: NaN }), "InvalidInput");
  bad(() => canonical({ x: -0 }), "InvalidInput");
  bad(() => canonical({ x: 1n }), "InvalidInput");
  bad(
    () =>
      canonical(
        Object.defineProperty({}, "x", {
          get() {
            throw Error("getter must not run");
          },
          enumerable: true,
        }),
      ),
    "InvalidInput",
  );
  const cycle = {};
  cycle.self = cycle;
  bad(() => canonical(cycle), "InvalidInput");

  const qualified = {
    status: "qualified-for-runtime",
    releaseId: "unit-test-only",
    manifestDigest: h(3),
    artifactDigest: h(4),
    runtimeId: "unit-test",
    sourceTreeDigest: h(5),
    operations: Object.keys(semantics),
    semantics,
    reviewer: "unit-test",
  };

  // Exercise development refusal even when this suite uses the compiled backend.
  bad(
    () => qualifiedService({ ...e, authority: "development-adaptation" }, qualified),
    "UnqualifiedRelease",
  );
  // Explicit test double only. No compiled/proof qualification receipt is written.
  const s = qualifiedService({ ...e, authority: "official-js-artifact" }, qualified);
  const rec = await s.prepare(request);
  eq(rec.mayExecute, false);
  eq((await verifyRetained(rec)).output, runOperation(e, request.operation, request.input));

  const binding = {
    approvedCalculationDigest: rec.calculationDigest,
    currentContext: ctx,
    allowedManifestDigests: [h(3)],
  };

  eq((await assertExecutionBinding(rec, binding)).calculationDigest, rec.calculationDigest);
  await rejects(
    () => assertExecutionBinding(rec, { ...binding, approvedCalculationDigest: h(6) }),
    "ApprovalMismatch",
  );
  await rejects(
    () =>
      assertExecutionBinding(rec, {
        ...binding,
        currentContext: { ...ctx, profileVersion: "new" },
      }),
    "StaleBasis",
  );
  await rejects(
    () => assertExecutionBinding(rec, { ...binding, allowedManifestDigests: [] }),
    "ReleaseRevoked",
  );
  await rejects(() => verifyRetained({ ...rec, output: { rows: [] } }), "DigestMismatch");
  const mutable = structuredClone(request);
  const pending = s.prepare(mutable);
  mutable.context.bookId = "other";
  const captured = await pending;
  eq(captured.context.bookId, ctx.bookId);
  await rejects(() => s.prepare({ ...request, operation: "cover.suggest.v1" }));
  const shadow = createShadowService(e, () => ({ rows: [] }));
  const diff = await shadow.compare(request);
  eq(diff.comparison, "different");
  eq(diff.authoritative, { rows: [] });
  eq(diff.mayExecute, false);
  const broken = createShadowService(null, () => ({ rows: [] }));
  eq((await broken.compare(request)).comparison, "unavailable");

  const legacyFail = createShadowService(e, () => {
    throw Error("legacy failure");
  });

  await rejects(() => legacyFail.compare(request));

  const faulty = qualifiedService(
    {
      ...e,
      authority: "official-js-artifact",
      call() {
        throw Error("backend stopped");
      },
    },
    qualified,
  );

  await rejects(() => faulty.prepare(request));
  bad(() => snapshot({ x: "\ud800" }), "InvalidInput");
});

await group("Per-operation release qualification, not self-approval", async () => {
  const store = new Map(),
    references = [];

  const artifactDigest = h(7),
    sourceTreeDigest = h(8),
    runtimeId = "unit-test";

  for (const kind of [...REQUIRED_RECEIPTS, "owner-parity"]) {
    const receipt = {
      status: "passed",
      official: true,
      compilerCommit: BEND_PIN,
      sourceTreeDigest,
      artifactDigest,
      excludedDefinitions: [],
      openObligations: 0,
      runtimeId,
      operations: ["vat.project.v1"],
      ownerTreeDigest: h(1),
      currentWorktree: true,
    };

    const bytes = new TextEncoder().encode(JSON.stringify(receipt));
    const path = `${kind}.json`;
    store.set(path, bytes);
    references.push({ kind, path, digest: await digestBytes(bytes) });
  }

  const manifest = {
    schema: "openerp-bend-release/v1",
    releaseId: "synthetic-unit-test",
    sourceTreeDigest,
    artifactDigest,
    compiler: {
      repository: "bendlang/bend",
      commit: BEND_PIN,
      checkerBlob: "c38e9e203530568b500dfc34785372d427706a6c",
      compilerBlob: "12ffbef1837a184fb7c5a255c4847397b2eec75a",
    },
    operations: ["vat.project.v1"],
    semantics: { "vat.project.v1": SEMANTICS["vat.project.v1"] },
    receipts: references,
  };

  const manifestDigest = await digest(manifest),
    trust = {
      schema: "openerp-bend-trust/v1",
      approvedReleases: [
        {
          manifestDigest,
          runtimeId,
          operations: ["vat.project.v1"],
          reviewer: "test-only",
          reviewedAt: "2026-09-27",
          reason: "Unit fixture, never deployment approval",
        },
      ],
    };

  const read = async (p) => store.get(p);
  eq(
    (await qualifyManifest(manifest, trust, runtimeId, artifactDigest, read)).status,
    "qualified-for-runtime",
  );
  await rejects(
    () =>
      qualifyManifest(
        manifest,
        { schema: "openerp-bend-trust/v1", approvedReleases: [] },
        runtimeId,
        artifactDigest,
        read,
      ),
    "UnqualifiedRelease",
  );
  await rejects(
    () => qualifyManifest(manifest, trust, "other-runtime", artifactDigest, read),
    "UnqualifiedRelease",
  );
  await rejects(() => qualifyManifest(manifest, trust, runtimeId, h(9), read), "ArtifactMismatch");
  const original = store.get("safe-kernel.json");
  store.set("safe-kernel.json", new TextEncoder().encode("{}"));
  await rejects(
    () => qualifyManifest(manifest, trust, runtimeId, artifactDigest, read),
    "ReceiptMismatch",
  );
  store.set("safe-kernel.json", original);
  const missing = { ...manifest, receipts: references.filter((x) => x.kind !== "owner-parity") };
  const missingTrust = structuredClone(trust);
  missingTrust.approvedReleases[0].manifestDigest = await digest(missing);
  await rejects(
    () => qualifyManifest(missing, missingTrust, runtimeId, artifactDigest, read),
    "UnqualifiedRelease",
  );
  const synthetic = JSON.parse(new TextDecoder().decode(original));
  synthetic.synthetic = true;
  const changed = new TextEncoder().encode(JSON.stringify(synthetic));
  store.set("safe-kernel.json", changed);
  const badManifest = structuredClone(manifest);
  badManifest.receipts.find((x) => x.kind === "safe-kernel").digest = await digestBytes(changed);
  const badTrust = structuredClone(trust);
  badTrust.approvedReleases[0].manifestDigest = await digest(badManifest);
  await rejects(
    () => qualifyManifest(badManifest, badTrust, runtimeId, artifactDigest, read),
    "UnqualifiedRelease",
  );
});

await group("Upstream ABI adapter unit controls", () => {
  const fields = {
    "BigNat.Zero": [],
    "BigNat.Even": ["high"],
    "BigNat.Odd": ["high"],
    "Foundation.Yes": [],
    "Foundation.No": [],
    "BigInt.Integer": ["negative", "magnitude"],
    "Foundation.Stop": [],
    "Foundation.Tick": ["rest"],
    "Rational.Fraction": ["numerator", "denominator"],
  };

  const mock = compiledEngine({ identity: (x) => x }, fields);

  for (const n of [0n, 1n, 2n, 9n, 10n ** 38n - 1n]) {
    eq(mock.fromNat(mock.nat(n)), n);
    eq(mock.fromInteger(mock.integer(-n)), -n);
    eq(mock.fromNat(mock.call("identity", mock.force(mock.nat(n)))), n);
  }

  const frac = mock.force(mock.c("Rational.Fraction", mock.integer(2n), mock.nat(3n)));
  eq(mock.fromInteger(mock.call("identity", frac).x[0]), 2n);
  bad(() => mock.force({ $: "unknown" }), "InvalidKernelOutput");
  const cycle = { $: "BigNat.Odd" };
  cycle.high = cycle;
  bad(() => mock.fromNat(cycle), "InvalidKernelOutput");
});

await group("Refinement proofs reject binary arithmetic mutations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bend-refinement-"));

  try {
    await cp(resolve(ROOT, "bend"), dir, { recursive: true });

    const path = join(dir, "BigNat.bend"),
      original = await readFile(path, "utf8");

    for (const [before, after] of [
      ["case Even{x}: shift(times(x, b))", "case Even{x}: times(x, b)"],
      ["case Odd{x}: plus(b, shift(times(x, b)))", "case Odd{x}: shift(times(x, b))"],
    ]) {
      ok(original.includes(before));
      await writeFile(path, original.replace(before, after));
      await rejects(() => loadEngine(join(dir, "Kernel.bend")));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await group("Bounded worker cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await rejects(
    () => runIsolated(request.operation, vat, { signal: controller.signal }),
    "Cancelled",
  );
  await rejects(() => runIsolated(request.operation, vat, { timeoutMs: 1 }), "ResourceLimit");

  const result = await runIsolated(
    "schedule.equal.v1",
    {
      currency: "SEK",
      scale: 2,
      remainingMinor: "100",
      periodIds: ["a", "b", "c"],
      policy: "equal-magnitude-remainder-last-v1",
    },
    { timeoutMs: 15000 },
  );

  eq(
    result.rows.map((x) => x.amountMinor),
    ["33", "33", "34"],
  );
});

const report = {
  status: "passed",
  suite: "authority-boundaries",
  checker: e.authority,
  compilerCommit: BEND_PIN,
  artifactDigest: e.artifactDigest ?? null,
  sourceTreeDigest: e.sourceTreeDigest ?? null,
  assertions,
  groups,
  elapsedMs: Math.round(performance.now() - start),
  operations: Object.keys(semantics),
  releaseQualified: false,
  caveats: [
    "Release policy positive tests use explicit synthetic fixtures, not genuine compiler or deployment receipts.",
    "Actual compiled artifact is only exercised when BEND_ARTIFACT is set.",
  ],
};

await writeFile(
  resolve(ROOT, "evidence/current/authority-tests.json"),
  JSON.stringify(report, null, 2) + "\n",
);

console.log(`PASS ${assertions} authority assertions under ${e.authority}`);
