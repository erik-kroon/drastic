import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { platform, arch } from "node:os";
import { resolve } from "node:path";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";

const repo = resolve(process.env.OPENERP_REPO || resolve(ROOT, "../.."));

async function inputHashes(directory = "") {
  const hashes = {};

  for (const entry of (await readdir(resolve(ROOT, directory), { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (
      entry.name.startsWith(".") ||
      entry.name === "evidence" ||
      entry.name === "node_modules" ||
      entry.name.endsWith(".tsbuildinfo") ||
      entry.name === "tsconfig.changed.json"
    )
      continue;

    const name = directory ? `${directory}/${entry.name}` : entry.name;

    if (entry.isDirectory()) Object.assign(hashes, await inputHashes(name));
    else
      hashes[name] = createHash("sha256")
        .update(await readFile(resolve(ROOT, name)))
        .digest("hex");
  }

  return hashes;
}

const sourceHashes = await inputHashes();

const reportFile = resolve(ROOT, "evidence/local-verification.json");

const runs = [];

await writeFile(reportFile, JSON.stringify({ status: "running", releaseVerified: false }) + "\n");

for (const { script, args, artifact } of [
  { script: "tests/run.mjs", args: [], artifact: "test-output.txt" },
  { script: "scripts/check-proofs.mjs", args: [], artifact: "proof-output.json" },
  { script: "scripts/verify-owner.mjs", args: [], artifact: "owner-output.json" },
  { script: "scripts/demo.mjs", args: [], artifact: "demo-output.json" },
  {
    script: "scripts/solve.mjs",
    args: ["fixtures/cover-ambiguous.json"],
    artifact: "solver-example-output.json",
  },
]) {
  const command = ["--experimental-strip-types", script, ...args];

  const result = spawnSync(process.execPath, command, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, OPENERP_REPO: repo },
  });

  runs.push({
    command: ["node", ...command],
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stderr: result.stderr,
    artifact,
  });
  await writeFile(resolve(ROOT, "evidence", artifact), result.stdout || "");
  console.log(`${script}: ${result.status === 0 && !result.error ? "PASS" : "FAIL"}`);

  if (result.status !== 0 || result.error) console.error(result.stderr || result.error);
}

const sourceStable = JSON.stringify(sourceHashes) === JSON.stringify(await inputHashes());

const passed = sourceStable && runs.every((run) => run.status === 0 && !run.error);

const revision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
  timeout: 10_000,
});

const owner = JSON.parse(await readFile(resolve(ROOT, "evidence/owner-verification.json"), "utf8"));

const tests = JSON.parse(await readFile(resolve(ROOT, "evidence/test-report.json"), "utf8"));

await writeFile(
  reportFile,
  JSON.stringify(
    {
      status: passed ? "passed-local-verification" : "failed",
      capturedAt: new Date().toISOString(),
      node: process.version,
      platform: platform(),
      arch: arch(),
      repositoryRevision: revision.status === 0 ? revision.stdout.trim() : null,
      sourceHashes,
      sourceStable,
      ownerSourceHashes: owner.sourceHashes,
      assertions: tests.assertions,
      ownerComparisons: owner.comparisons,
      checker: tests.checker,
      bendSourceCommit: BEND_PIN,
      releaseVerified: false,
      productionReady: false,
      runs,
    },
    null,
    2,
  ) + "\n",
);

console.log(`Evidence: ${reportFile}`);

process.exitCode = passed ? 0 : 1;
