import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm, mkdir, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { loadTestEngine } from "./test-engine.mjs";
import { runOperation, verifyOutput } from "../src/operations.mjs";
import { canonical, snapshot } from "../src/contracts.mjs";
import { roundReference } from "../lib/money.mjs";
import { SEMANTICS } from "../src/semantics.mjs";
import { reportingUnitFromScales, createVatMonetaryPort } from "../src/vat-port.mjs";
import { qualifiedService } from "../src/service.mjs";
import { runtimeIdentity } from "../src/runtime-id.mjs";
import { loadAuthority } from "../src/node-authority.mjs";
import { loadOwnerAdapter } from "../scripts/owner-adapter.mjs";
import { runProcess } from "../scripts/process.mjs";
import { verifyUpstream } from "../scripts/build-official.mjs";

const engine = await loadTestEngine(),
  start = performance.now();

let assertions = 0;

const eq = (a, b) => {
  assert.deepEqual(a, b);
  assertions++;
};

const bad = (f, code) => {
  assert.throws(f, code ? (e) => e.code === code : undefined);
  assertions++;
};

const rejects = async (f, code) => {
  await assert.rejects(f, code ? (e) => e.code === code : undefined);
  assertions++;
};

for (const rounding of ["exact", "floor", "ceiling", "toward_zero", "half_up", "half_even"]) {
  for (const numerator of [
    -301n,
    -300n,
    -251n,
    -250n,
    -100n,
    -1n,
    0n,
    1n,
    100n,
    150n,
    250n,
    301n,
  ]) {
    for (const denominator of [1n, 2n, 3n, 100n]) {
      const input = { numerator: String(numerator), denominator: String(denominator), rounding };
      const ref = roundReference(numerator, denominator, rounding);

      if (ref === null)
        bad(() => runOperation(engine, "money.round.v1", input), "CalculationRefused");
      else
        eq(runOperation(engine, "money.round.v1", input), {
          roundedMinor: String(ref.value),
          residualNumerator: String(ref.residual),
          denominator: String(denominator),
        });
    }
  }
}

// Large rational intermediates are supported without widening stored output.
const wide = {
  numerator: String(10n ** 120n),
  denominator: String(10n ** 100n),
  rounding: "exact",
};

eq(runOperation(engine, "money.round.v1", wide).roundedMinor, String(10n ** 20n));

bad(() => runOperation(engine, "money.round.v1", { ...wide, denominator: "1" }), "InvalidMoney");

bad(
  () => runOperation(engine, "money.round.v1", { ...wide, numerator: "9".repeat(161) }),
  "InvalidMoney",
);

bad(() => runOperation(engine, "money.round.v1", { ...wide, denominator: "0" }), "InvalidMoney");

bad(
  () =>
    verifyOutput(
      "money.round.v1",
      { numerator: "199", denominator: "100", rounding: "toward_zero" },
      { roundedMinor: "0", residualNumerator: "199", denominator: "100" },
    ),
  "InvalidKernelOutput",
);

for (let scale = 0; scale <= 6; scale++)
  for (let decimals = 0; decimals <= scale; decimals++) {
    const unit = reportingUnitFromScales(scale, decimals);
    eq(unit, String(10n ** BigInt(scale - decimals)));

    const input = {
      currency: "SEK",
      scale,
      reportingUnitMinor: unit,
      rounding: "floor",
      declareNet: true,
      contributions: [{ id: "sale", box: "10", signedMinor: "-100", included: true }],
    };

    eq(
      BigInt(runOperation(engine, "vat.project.v1", input).rows[0].reportedMinor),
      roundReference(-100n, BigInt(unit), "floor").value,
    );
  }

bad(() => reportingUnitFromScales(2, 3), "InvalidInput");

const vat = {
  currency: "SEK",
  scale: 2,
  reportingUnitMinor: "100",
  rounding: "toward_zero",
  declareNet: true,
  contributions: [
    { id: "a", box: "10", signedMinor: "199", included: true },
    { id: "b", box: "48", signedMinor: "101", included: true },
  ],
};

bad(() => runOperation(engine, "vat.project.v1", { ...vat, filingUnitScale: 2 }), "InvalidInput");

bad(
  () => runOperation(engine, "vat.project.v1", { ...vat, reportingUnitMinor: "0" }),
  "InvalidMoney",
);

bad(
  () =>
    runOperation(engine, "vat.project.v1", {
      ...vat,
      contributions: [
        { id: "a", box: "10", signedMinor: "9".repeat(38), included: true },
        { id: "b", box: "10", signedMinor: "9".repeat(38), included: true },
      ],
    }),
  "InvalidMoney",
);

eq(runOperation(engine, "vat.project.v1", vat).rows.at(-1).reportedMinor, "0");

// Advertised batch limits are exercised, not merely declared in schemas.
const maxVat = {
  ...vat,
  contributions: Array.from({ length: 2000 }, (_, i) => ({
    id: `row-${i}`,
    box: "10",
    signedMinor: "1",
    included: true,
  })),
};

eq(runOperation(engine, "vat.project.v1", maxVat).rows[0].exactMinor, "2000");

const maxSchedule = {
  currency: "SEK",
  scale: 2,
  remainingMinor: "10000000",
  periodIds: Array.from({ length: 600 }, (_, i) => `p-${i}`),
  policy: "equal-magnitude-remainder-last-v1",
};

eq(runOperation(engine, "schedule.equal.v1", maxSchedule).rows.length, 600);

const maxReverse = {
  currency: "SEK",
  scale: 2,
  originalVoucherId: "many-lines",
  lines: Array.from({ length: 2000 }, (_, i) => ({
    id: `l-${i}`,
    accountId: "account",
    dimensions: {},
    debitMinor: i % 2 ? "0" : "1",
    creditMinor: i % 2 ? "1" : "0",
  })),
};

eq(runOperation(engine, "ledger.reverse.v1", maxReverse).lines.length, 2000);

const sparse = [];

sparse.length = 2;

sparse[1] = 3;

bad(() => canonical(sparse), "ResourceLimit");

let getterCalls = 0;

const getter = [0];

Object.defineProperty(getter, "0", {
  enumerable: true,
  get() {
    getterCalls++;

    return 1;
  },
});

bad(() => canonical(getter), "InvalidInput");

eq(getterCalls, 0);

bad(() => canonical({ ["\ud800"]: 1 }), "InvalidInput");

const extra = [1];

Object.defineProperty(extra, "secret", { value: 2 });

bad(() => canonical(extra), "InvalidInput");

const symbol = [1];

symbol[Symbol("private")] = 3;

bad(() => canonical(symbol), "InvalidInput");

bad(() => snapshot({ n: Number.MAX_SAFE_INTEGER + 1 }), "InvalidInput");

// Internal test double proves port routing, not compiler qualification.
const qualification = {
  status: "qualified-for-runtime",
  releaseId: "synthetic-port-test",
  manifestDigest: "sha256:" + "1".repeat(64),
  artifactDigest: "sha256:" + "2".repeat(64),
  sourceTreeDigest: "sha256:" + "3".repeat(64),
  runtimeId: runtimeIdentity(),
  operations: Object.keys(SEMANTICS),
  semantics: SEMANTICS,
};

const port = createVatMonetaryPort(
  qualifiedService({ ...engine, authority: "official-js-artifact" }, qualification),
);

eq(port.round(-100n, 100n, "floor"), -1n);

eq(port.round(1n, 0n, "floor"), null);

eq(port.project(vat), runOperation(engine, "vat.project.v1", vat).rows);

bad(
  () =>
    createVatMonetaryPort(
      qualifiedService(
        { ...engine, authority: "official-js-artifact" },
        { ...qualification, operations: ["vat.project.v1"] },
      ),
    ),
  "UnqualifiedOperation",
);

await rejects(() => loadAuthority({ runtimeId: "invented-runtime" }), "RuntimeMismatch");

const temp = await mkdtemp(join(tmpdir(), "openerp authority integration "));

try {
  await mkdir(join(temp, "packages/domain/src"), { recursive: true });
  await writeFile(join(temp, "packages/domain/src/current.mjs"), "export const value = 1;\n");
  const file = join(temp, "owner.mjs");

  const env = {
    OPENERP_REPO: process.env.OPENERP_REPO,
    OPENERP_OWNER_ADAPTER: process.env.OPENERP_OWNER_ADAPTER,
    BEND_SOURCE_ROOT: process.env.BEND_SOURCE_ROOT,
  };

  try {
    process.env.OPENERP_REPO = temp;
    process.env.OPENERP_OWNER_ADAPTER = file;
    await writeFile(
      file,
      "export const kind='openerp-current-owner/v1';export const sourceFiles=['packages/domain/src/current.mjs'];export function calculate(){throw Error('test stub');}\n",
    );
    const bound = await loadOwnerAdapter();
    eq(Object.keys(bound.before.files).length, 2);
    await bound.assertUnchanged();
    assertions++;
    await writeFile(join(temp, "packages/domain/src/current.mjs"), "export const value = 2;\n");
    await rejects(() => bound.assertUnchanged(), "OwnerChangedDuringCheck");
    delete process.env.OPENERP_OWNER_ADAPTER;
    await rejects(() => loadOwnerAdapter(), "OwnerNotBound");
    delete process.env.BEND_SOURCE_ROOT;
    await rejects(() => verifyUpstream());
    // A pinned-source mismatch refuses before importing or executing its bytes.
    await mkdir(join(temp, "bend2"));
    await writeFile(join(temp, "bend2/bend.ts"), "throw Error('must not execute');\n");
    process.env.BEND_SOURCE_ROOT = temp;
    await rejects(() => verifyUpstream());
  } finally {
    for (const [k, v] of Object.entries(env))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }

  // Path portability: a clean copy under a directory containing spaces still loads.
  await cp(resolve(ROOT, "bend"), join(temp, "proof copy"), { recursive: true });
  const { loadEngine } = await import("../lib/engine.mjs");
  const moved = await loadEngine(join(temp, "proof copy/Kernel.bend"));
  eq(moved.book.hols, 0);
} finally {
  await rm(temp, { recursive: true, force: true });
}

const processResult = await runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
  timeoutMs: 20,
});

eq(processResult.passed, false);

eq(processResult.error, "Verification deadline exceeded");

const report = {
  status: "passed",
  suite: "authority-extension",
  assertions,
  checker: engine.authority,
  compilerCommit: BEND_PIN,
  artifactDigest: engine.artifactDigest ?? null,
  sourceTreeDigest: engine.sourceTreeDigest ?? null,
  elapsedMs: Math.round(performance.now() - start),
  operations: Object.keys(SEMANTICS),
  productionReady: false,
  actualCurrentOwnerCompared: false,
  caveats: [
    "The temporary owner adapter and qualified service are explicit test fixtures. They are not deployed or real-owner evidence.",
  ],
};

await writeFile(
  resolve(ROOT, "evidence/current/extension-tests.json"),
  JSON.stringify(report, null, 2) + "\n",
);

console.log(`PASS ${assertions} extension assertions under ${engine.authority}`);
