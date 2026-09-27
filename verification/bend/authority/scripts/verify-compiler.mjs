import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { runProcess } from "./process.mjs";
import { sourceIdentity, verifyUpstream } from "./build-official.mjs";
import { runtimeIdentity } from "../src/runtime-id.mjs";

const directory = resolve(ROOT, "evidence/current");

await mkdir(directory, { recursive: true });

const report = {
  schema: "openerp-bend-compiler-verification/v1",
  generatedAt: new Date().toISOString(),
  status: "failed",
  compilerCommit: BEND_PIN,
  runtimeId: runtimeIdentity(),
  productionReady: false,
  completedStages: [],
  runs: [],
};

try {
  await verifyUpstream();

  const before = await sourceIdentity();

  report.sourceTreeDigest = before.digest;
  report.sourceFiles = before.files;
  await rm(resolve(ROOT, "dist"), { recursive: true, force: true });

  for (const stage of [
    { name: "reproducible-build", script: "scripts/reproducible-build.mjs", compiled: false },
    { name: "compiled-tests", script: "scripts/verify-local.mjs", compiled: true },
    { name: "compiled-receipts", script: "scripts/compiled-receipts.mjs", compiled: true },
    { name: "safe-kernel", script: "scripts/safe-official.mjs", compiled: false },
  ]) {
    const env = { ...process.env, BEND_NO_TELEMETRY: "1" };

    if (stage.compiled) env.BEND_ARTIFACT = resolve(ROOT, "dist/kernel.mjs");
    else delete env.BEND_ARTIFACT;

    const result = await runProcess(
      process.execPath,
      ["--experimental-strip-types", stage.script],
      {
        cwd: ROOT,
        env,
        timeoutMs: stage.name === "safe-kernel" ? 540000 : 180000,
      },
    );

    report.runs.push({ stage: stage.name, ...result });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);

    if (!result.passed) throw Error(`Required compiler stage failed: ${stage.name}`);

    report.completedStages.push(stage.name);

    if (stage.name === "reproducible-build") {
      const build = JSON.parse(await readFile(resolve(ROOT, "dist/build.json"), "utf8"));

      report.artifactDigest = build.artifactDigest;
      report.sourceChecks = build.checks;
    }

    if (stage.name === "compiled-receipts") {
      report.compiledReceipt = JSON.parse(
        await readFile(resolve(ROOT, "dist/compiled-differentials.json"), "utf8"),
      );
    }
  }

  if ((await sourceIdentity()).digest !== before.digest)
    throw Error("Sources changed during compiler verification");

  report.status = "passed-toolchain-checks";
} catch (error) {
  report.error = String(error.message);
  process.exitCode = 1;
}

await writeFile(
  resolve(directory, "compiler-verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      completedStages: report.completedStages,
      error: report.error,
      productionReady: false,
    },
    null,
    2,
  ),
);
