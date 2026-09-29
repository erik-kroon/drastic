#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, open, rm, copyFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateVitest, evaluateBend, evaluateNodeTap } from "./gates.mjs";
import {
  captureSources,
  childEnvironment,
  findTests,
  runBounded,
  sha256,
  tool,
} from "./runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const suite = join(root, "verification/assurance");

const profile = process.argv[2] ?? "full";

const names = ["harness", "fast", "runtime", "full", "bend-local", "bend-release"];

if (!names.includes(profile) || process.argv.length > 3) {
  console.error(`Usage: node verification/assurance/scripts/run.mjs ${names.join("|")}`);
  process.exit(2);
}

const id = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;

const out = join(root, "test-results/assurance", id);

await mkdir(out, { recursive: true, mode: 0o700 });

const report = {
  schema: "openerp-assurance-run/v1",
  id,
  profile,
  startedAt: new Date().toISOString(),
  status: "blocked",
  productionReady: false,
  stages: [],
  limitations: [
    "No general statutory correctness or live-provider acceptance follows from this suite.",
    "Local Bend verification is not official compiler or production promotion evidence.",
    "Existing native browser tests run only in the native runtime lane; pure tests do not prove UI behavior.",
  ],
};

const lockPath = join(root, "test-results/assurance/ACTIVE.lock");

let lock;

let before;

const evidence = async () =>
  writeFile(join(out, "run.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });

try {
  lock = await open(lockPath, "wx", 0o600);
  await lock.writeFile(
    JSON.stringify({ pid: process.pid, id, profile, startedAt: report.startedAt }),
  );
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  if (pkg.scripts?.["test:e2e"] !== "vp test run")
    throw new Error("E2E entry point changed. Review and adapt runner rather than bypassing it.");
  report.revision = tool("git", ["rev-parse", "HEAD"], { cwd: root });
  report.node = process.version;
  before = await captureSources(root);
  report.startSourceDigest = before.digest;
  await writeFile(join(out, "sources-start.json"), JSON.stringify(before, null, 2));

  const env = childEnvironment({
    PATH: `${join(root, "node_modules/.bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
    OPENERP_REPO: root,
  });

  if (["fast", "runtime", "full"].includes(profile))
    report.bun = tool("bun", ["--version"], { cwd: root, env });

  if (["runtime", "full", "bend-release"].includes(profile)) {
    if (process.getuid?.() === 0)
      throw new Error("The disposable PostgreSQL harness must run as a non-root user.");
    const bin = process.env.PG_BINDIR || tool("pg_config", ["--bindir"], { cwd: root, env });
    report.postgres = tool(join(bin, "postgres"), ["--version"], { cwd: root, env });

    if (!/PostgreSQL\)\s+17\./.test(report.postgres))
      throw new Error(`Expected qualified PostgreSQL 17, found ${report.postgres}`);

    for (const command of ["initdb", "pg_ctl"])
      tool(join(bin, command), ["--version"], { cwd: root, env });
    env.PG_BINDIR = bin;
  }

  const required = JSON.parse(await readFile(join(suite, "required-suites.json"), "utf8"));
  const stages = [];

  if (["harness", "fast", "full"].includes(profile))
    stages.push({
      id: "harness",
      command: process.execPath,
      args: [
        "--test",
        "--test-reporter=tap",
        ...(await findTests(root, "verification/assurance/self-tests", ".test.mjs")),
      ],
      timeoutMs: 60_000,
    });

  if (["fast", "full"].includes(profile))
    stages.push({
      id: "pure",
      command: "bun",
      args: ["run", "test", "--config", "verification/assurance/vite.config.ts"],
      timeoutMs: 180_000,
      kind: "vitest-pure",
    });

  if (["runtime", "full"].includes(profile)) {
    stages.push({
      id: "test-typecheck",
      command: "bun",
      args: ["run", "check:tests"],
      timeoutMs: 180_000,
    });
    stages.push({
      id: "native",
      command: "bun",
      args: [
        "run",
        "test:e2e",
        `--outputFile.json=${join(out, "native.json")}`,
        `--outputFile.junit=${join(out, "native.xml")}`,
        "--allowOnly=false",
      ],
      timeoutMs: 1_200_000,
      kind: "vitest-native",
    });
  }

  if (["bend-local", "full"].includes(profile)) {
    stages.push({
      id: "bend-parent",
      command: "npm",
      args: ["--prefix", "verification/bend", "run", "verify:local"],
      timeoutMs: 900_000,
      kind: "bend-parent",
      reportPath: "verification/bend/evidence/local-verification.json",
    });
    stages.push({
      id: "bend-authority",
      command: "npm",
      args: ["--prefix", "verification/bend/authority", "run", "verify:local"],
      timeoutMs: 900_000,
      kind: "bend-authority",
      reportPath: "verification/bend/authority/evidence/current/local-verification.json",
    });
  }

  if (profile === "bend-release") {
    for (const name of ["BEND_SOURCE_ROOT", "OPENERP_OWNER_ADAPTER"]) {
      if (!process.env[name])
        throw new Error(
          `Missing ${name}; official release qualification cannot fall back to local checks.`,
        );
      env[name] = process.env[name];
    }

    for (const name of ["BEND_BIN", "BENDTT", "BENDTT_SHA256", "LEANC", "TSC_BIN"])
      if (process.env[name]) env[name] = process.env[name];
    stages.push({
      id: "bend-release",
      command: "npm",
      args: ["--prefix", "verification/bend/authority", "run", "verify:release"],
      timeoutMs: 1_800_000,
      kind: "bend-release",
      reportPath: "verification/bend/authority/evidence/current/release-verification.json",
    });
  }

  report.expectedStages = stages.map((x) => x.id);

  for (const selected of stages) {
    console.log(`Assurance ${selected.id}: running`);

    const stageEnv = {
      ...env,
      ASSURANCE_JSON_REPORT: join(out, "pure.json"),
      ASSURANCE_JUNIT_REPORT: join(out, "pure.xml"),
    };

    const result = await runBounded(selected.command, selected.args, {
      cwd: root,
      env: stageEnv,
      timeoutMs: selected.timeoutMs,
      logPath: join(out, selected.id + ".log"),
    });

    const stage = { id: selected.id, ...result, logPath: selected.id + ".log", status: "blocked" };
    report.stages.push(stage);

    if (result.spawnError || result.signal || result.timedOut || result.logOverflow)
      throw new Error(`${selected.id} unavailable/interrupted; inspect its private log.`);

    if (selected.kind?.startsWith("vitest")) {
      const resultPath = join(out, selected.kind === "vitest-pure" ? "pure.json" : "native.json");
      const body = JSON.parse(await readFile(resultPath, "utf8"));
      const native = selected.kind === "vitest-native";

      const files = await findTests(
        root,
        native ? "apps/api/tests" : "apps/api/tests/assurance",
        native ? ".e2e.test.ts" : ".conformance.test.ts",
      );

      // Expected files include the actually discovered current suite and the frozen required native set.
      const expected = [
        ...new Set([...files, ...(native ? required.nativeFiles : required.pureFiles)]),
      ];

      stage.gate = evaluateVitest(body, {
        requiredFiles: expected,
        expectedPrefixes: native ? required.nativePrefixes : required.purePrefixes,
        notBefore: result.startedAt,
      });
      stage.testReportHash = sha256(await readFile(resultPath));
      stage.status = stage.gate.status;

      if (native) {
        for (const name of ["manifest.json", "source-integrity.json"]) {
          const file = join(root, "test-results/e2e", name);

          if ((await stat(file)).mtimeMs < result.startedAt - 2_000)
            throw new Error(`Stale native ${name}`);
          await copyFile(file, join(out, "native-" + name));
        }

        const integrity = JSON.parse(
          await readFile(join(out, "native-source-integrity.json"), "utf8"),
        );

        if (integrity.status !== "stable")
          throw new Error("Native source-integrity gate did not pass");
      }
    } else if (selected.kind?.startsWith("bend")) {
      const file = join(root, selected.reportPath);

      if ((await stat(file)).mtimeMs < result.startedAt - 2_000)
        throw new Error("Stale Bend receipt");
      const body = JSON.parse(await readFile(file, "utf8"));

      if (selected.kind === "bend-release") {
        const names = [
          "source-check",
          "safe-kernel",
          "reproducible-build",
          "compiled-differentials",
          "runtime-probe",
          "owner-parity",
          "host-integration",
        ];

        const complete =
          body.status === "passed" &&
          body.productionReady === false &&
          body.schema === "openerp-bend-release-gate/v1" &&
          Array.isArray(body.runs) &&
          body.runs.length >= 6 &&
          body.runs.every((r) => r.passed === true);

        if (
          !complete ||
          !Number.isFinite(Date.parse(body.generatedAt)) ||
          Date.parse(body.generatedAt) < result.startedAt - 2_000
        )
          throw new Error("Official Bend release report failed or incomplete");

        for (const name of names) {
          const source = join(root, "verification/bend/authority/evidence/current", name + ".json");
          const bytes = await readFile(source);
          const claimed = body.receipts?.[name];

          if (claimed !== sha256(bytes) && claimed !== `sha256:${sha256(bytes)}`)
            throw new Error(`Bend receipt mismatch: ${name}`);
          await writeFile(join(out, "bend-release-" + name + ".json"), bytes, { mode: 0o600 });
        }

        stage.gate = {
          status: "passed",
          productionReady: false,
          meaning:
            "Existing official source/build/safe-check/owner/host gate passed; no trust entry created",
        };
      } else
        stage.gate = evaluateBend(
          body,
          selected.kind === "bend-parent" ? "parent" : "authority",
          result.startedAt,
        );
      await copyFile(file, join(out, selected.id + ".json"));
      stage.status = stage.gate.status;
    } else if (selected.id === "harness") {
      stage.gate = evaluateNodeTap(await readFile(join(out, selected.id + ".log"), "utf8"));
      stage.status = stage.gate.status;
    } else stage.status = result.exitCode === 0 ? "passed" : "failed";

    if (result.exitCode !== 0) stage.status = "failed";
    await evidence();

    if (stage.status !== "passed")
      throw new Error(`${selected.id} did not pass. No following lane is implied passed.`);
    console.log(`Assurance ${selected.id}: passed`);
  }

  const after = await captureSources(root);
  report.endSourceDigest = after.digest;
  await writeFile(join(out, "sources-end.json"), JSON.stringify(after, null, 2));

  if (before.digest !== after.digest)
    throw new Error(
      "Source inputs changed during the selected suite; results are not fixed-revision evidence",
    );
  report.status = "passed";
} catch (error) {
  report.error = String(error.message);
  report.status = report.stages.some((s) => s.status === "failed") ? "failed" : "blocked";
  console.error(report.error);
} finally {
  report.finishedAt = new Date().toISOString();
  await evidence();

  if (lock) {
    await lock.close();
    const held = JSON.parse(await readFile(lockPath, "utf8"));

    if (held.id === id) await rm(lockPath);
  }
}

console.log(`Result: ${report.status}. Evidence: ${out}`);

process.exitCode = report.status === "passed" ? 0 : report.status === "failed" ? 1 : 2;
