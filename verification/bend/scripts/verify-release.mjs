import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { runProcess } from "./process.mjs";
import { sourceIdentity } from "./build-official.mjs";
import { runtimeIdentity } from "../src/runtime-id.mjs";
import { digestBytes } from "../src/contracts.mjs";

const directory = resolve(ROOT, "evidence/current");

await mkdir(directory, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  schema: "openerp-bend-release-gate/v1",
  status: "failed",
  productionReady: false,
  runtimeId: runtimeIdentity(),
  compilerCommit: BEND_PIN,
  runs: [],
  limitations: [
    "No statutory or complete-ERP certification",
    "Promotion additionally requires an explicit deployment trust entry",
  ],
};

try {
  // Remove old candidate output before a fresh gate. Never reuse a stale green receipt.
  await rm(resolve(ROOT, "dist"), { recursive: true, force: true });

  if (!process.env.BEND_SOURCE_ROOT)
    throw Error("Missing BEND_SOURCE_ROOT: no development checker may pass this gate");

  if (!process.env.OPENERP_REPO || !process.env.OPENERP_OWNER_ADAPTER)
    throw Error("Missing current worktree and reviewed owner adapter");
  const before = await sourceIdentity();
  report.sourceTreeDigest = before.digest;

  const steps = [
    { script: "scripts/reproducible-build.mjs", artifact: false },
    { script: "scripts/safe-official.mjs", artifact: false },
    { script: "scripts/verify-local.mjs", artifact: true },
    { script: "scripts/compiled-receipts.mjs", artifact: true },
    { script: "scripts/verify-owner.mjs", artifact: true },
    { script: "scripts/verify-host.mjs", artifact: true },
  ];

  for (const { script, artifact } of steps) {
    const env = { ...process.env, BEND_NO_TELEMETRY: "1" };

    if (artifact) env.BEND_ARTIFACT = resolve(ROOT, "dist/kernel.mjs");
    else delete env.BEND_ARTIFACT;

    const r = await runProcess(
      process.execPath,
      process.versions.bun ? [script] : ["--experimental-strip-types", script],
      {
        cwd: ROOT,
        timeoutMs: script.endsWith("safe-official.mjs") ? 540000 : 180000,
        env,
      },
    );

    report.runs.push(r);
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);

    if (!r.passed) throw Error(`Required stage failed: ${script}: ${r.error ?? r.status}`);
  }

  if ((await sourceIdentity()).digest !== before.digest)
    throw Error("Sources changed while qualifying the release");

  const build = JSON.parse(await readFile(resolve(ROOT, "dist/build.json"), "utf8"));

  report.artifactDigest = build.artifactDigest;
  report.receipts = {};

  for (const name of [
    "source-check",
    "safe-kernel",
    "reproducible-build",
    "compiled-differentials",
    "runtime-probe",
    "owner-parity",
    "host-integration",
  ]) {
    const bytes = await readFile(resolve(ROOT, "dist", `${name}.json`));

    await writeFile(resolve(directory, `${name}.json`), bytes);
    report.receipts[name] = await digestBytes(bytes);
  }

  report.status = "passed";
  report.message =
    "Build and observed runtime/owner/host checks passed. Review and stage a per-operation release next; no trust entry was created.";
} catch (error) {
  report.error = String(error.message);
  process.exitCode = 1;
  console.error(report.error);
}

await writeFile(
  resolve(directory, "release-verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);
