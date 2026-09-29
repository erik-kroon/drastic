#!/usr/bin/env node
/** Three precise semantic mutants in an isolated, disposable Git worktree only. */
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment, runBounded, tool, sha256 } from "./runtime.mjs";
import { evaluateVitest, mutationOutcome } from "./gates.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

if (process.argv.length !== 2)
  throw new Error("Usage: node verification/assurance/scripts/mutate.mjs");

const status = tool("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo });

if (status)
  throw new Error(
    "Mutation requires a clean committed checkout including this suite. Never mutate the active dirty worktree.",
  );

const temp = await mkdtemp(join(tmpdir(), "openerp-assurance-mutation-"));

const worktree = join(temp, "checkout");

const out = join(
  repo,
  "test-results/assurance-mutations",
  new Date().toISOString().replaceAll(":", "-"),
);

await mkdir(out, { recursive: true, mode: 0o700 });

const report = {
  schema: "openerp-assurance-mutations/v1",
  sourceRevision: tool("git", ["rev-parse", "HEAD"], { cwd: repo }),
  mutants: [],
  status: "blocked",
  meaning:
    "Assertion failures against real workspace functions, not compile errors. No production patch retained.",
};

let added = false;

try {
  tool("git", ["worktree", "add", "--detach", worktree, report.sourceRevision], {
    cwd: repo,
    timeout: 60_000,
  });
  added = true;

  const install = await runBounded("bun", ["install", "--frozen-lockfile"], {
    cwd: worktree,
    env: childEnvironment(),
    timeoutMs: 180_000,
    logPath: join(out, "install.log"),
  });

  report.install = install;

  if (install.exitCode !== 0 || install.timedOut || install.spawnError)
    throw new Error("Frozen dependency install failed; no mutation verdict available.");

  const run = async (label) => {
    const target = join(out, label + ".json");

    const result = await runBounded(
      "bun",
      ["run", "test", "--config", "verification/assurance/vite.config.ts"],
      {
        cwd: worktree,
        env: childEnvironment({
          ASSURANCE_JSON_REPORT: target,
          ASSURANCE_JUNIT_REPORT: join(out, label + ".xml"),
        }),
        timeoutMs: 180_000,
        logPath: join(out, label + ".log"),
      },
    );

    let gate = null;

    try {
      gate = evaluateVitest(JSON.parse(await readFile(target, "utf8")), {
        notBefore: result.startedAt,
      });
    } catch (error) {
      result.reportError = error.message;
    }

    return { ...result, gate };
  };

  const baseline = await run("baseline");
  report.baseline = baseline;

  if (baseline.exitCode !== 0 || baseline.gate?.status !== "passed")
    throw new Error("Baseline is not cleanly passing; fix the real failure before mutation.");

  const recipes = [
    {
      id: "positive-floor",
      file: "packages/domain/src/purchasing.ts",
      from: "return remainder === 0n || !negative ? 0n : 1n;",
      to: "return remainder === 0n ? 0n : 1n;",
    },
    {
      id: "adjacent-cycles-overlap",
      file: "packages/domain/src/recurrence.ts",
      from: "return left.serviceStartsOn < right.serviceEndsOn && right.serviceStartsOn < left.serviceEndsOn;",
      to: "return left.serviceStartsOn <= right.serviceEndsOn && right.serviceStartsOn <= left.serviceEndsOn;",
    },
    {
      id: "refunded-credit-restored",
      file: "packages/domain/src/supplier-refunds.ts",
      from: "refundDueMinor: amount(refundPrincipal - q),",
      to: "refundDueMinor: amount(refundPrincipal),",
    },
  ];

  for (const recipe of recipes) {
    const path = join(worktree, recipe.file);
    const original = await readFile(path, "utf8");

    if (original.split(recipe.from).length !== 2) {
      report.mutants.push({ id: recipe.id, status: "inapplicable_source_changed" });
      continue;
    }

    try {
      await writeFile(path, original.replace(recipe.from, recipe.to));
      const changed = await run(recipe.id);

      const verdict = mutationOutcome({
        baseline: baseline.gate,
        mutant: changed.gate,
        exitCode: changed.exitCode,
        signal: changed.signal,
        timedOut: changed.timedOut,
      });

      report.mutants.push({
        id: recipe.id,
        file: recipe.file,
        originalSha256: sha256(original),
        status: verdict,
        run: changed,
      });
    } finally {
      await writeFile(path, original);
    }
  }

  report.status =
    report.mutants.length === recipes.length &&
    report.mutants.every((m) => m.status === "killed_by_assertion")
      ? "passed"
      : "failed_or_incomplete";
} catch (error) {
  report.error = String(error.message);
} finally {
  if (added) {
    try {
      tool("git", ["worktree", "remove", "--force", worktree], { cwd: repo, timeout: 60_000 });
    } catch (error) {
      report.cleanupError = error.message;
      report.status = "blocked";
    }
  }

  // Remove only the temporary directory this invocation created. Keep report/logs.
  if (!report.cleanupError) await rm(temp, { recursive: true, force: true });
  await writeFile(join(out, "mutations.json"), JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
}

console.log(`Mutation result ${report.status}: ${out}`);

process.exitCode = report.status === "passed" ? 0 : 1;
