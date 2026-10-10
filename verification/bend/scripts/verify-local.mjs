import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { runProcess } from "./process.mjs";
import { sourceIdentity } from "./build-official.mjs";
import { runtimeIdentity } from "../src/runtime-id.mjs";

const out = resolve(ROOT, "evidence/current");

await mkdir(out, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  schema: "openerp-bend-local/v1",
  status: "failed",
  runtimeId: runtimeIdentity(),
  compilerCommit: BEND_PIN,
  runs: [],
  productionReady: false,
  parentModified: false,
  currentOwner: "not-established-by-local-tests",
  officialToolchain: "not-established-by-local-tests",
};

try {
  const before = await sourceIdentity();
  report.sourceTreeDigest = before.digest;
  report.sourceFiles = before.files;

  for (const script of [
    "tests/run.mjs",
    "tests/authority/run.mjs",
    "tests/extension.mjs",
    "scripts/demo.mjs",
    "scripts/solve.mjs",
  ]) {
    const args = [
      ...(process.versions.bun ? [] : ["--experimental-strip-types"]),
      script,
      ...(script.endsWith("/solve.mjs") ? ["fixtures/cover-ambiguous.json"] : []),
    ];

    const r = await runProcess(process.execPath, args, { cwd: ROOT });
    report.runs.push(r);
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);

    if (!r.passed) throw Error(`Local stage failed: ${script}`);
  }

  let syntaxFiles = 0;

  for (const name of Object.keys(before.files).filter((f) => f.endsWith(".mjs"))) {
    const r = await runProcess(process.execPath, ["--check", name], { cwd: ROOT });

    if (!r.passed) {
      report.runs.push(r);
      throw Error(`Syntax check failed: ${name}`);
    }

    syntaxFiles++;
  }

  report.syntaxFiles = syntaxFiles;

  const types = await runProcess(process.env.TSC_BIN || "tsc", ["-p", "tsconfig.types.json"], {
    cwd: ROOT,
  });

  report.typeCheck = { ...types, status: types.passed ? "passed" : "failed" };

  if (!types.passed) throw Error("Public declaration checks require a working TypeScript compiler");

  const suites = await Promise.all(
    ["arithmetic-tests", "authority-tests", "extension-tests"].map(async (n) =>
      JSON.parse(await readFile(resolve(out, n + ".json"), "utf8")),
    ),
  );

  report.assertions = suites.reduce((total, s) => total + s.assertions, 0);
  report.suites = suites.map((s) => ({
    suite: s.suite ?? "arithmetic",
    assertions: s.assertions,
    checker: s.checker,
  }));
  report.lawProofPairs = suites[0].lawProofPairs;
  report.backend = suites[0].checker;
  report.artifactDigest = suites[0].artifactDigest ?? null;

  if ((await sourceIdentity()).digest !== before.digest)
    throw Error("Source changed during local verification");
  report.status = "passed";
} catch (error) {
  report.error = String(error.message);
  process.exitCode = 1;
}

await writeFile(resolve(out, "local-verification.json"), JSON.stringify(report, null, 2) + "\n");

console.log(
  JSON.stringify(
    {
      status: report.status,
      assertions: report.assertions,
      lawProofPairs: report.lawProofPairs,
      productionReady: false,
      error: report.error,
    },
    null,
    2,
  ),
);
