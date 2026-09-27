import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { loadTestEngine } from "../tests/test-engine.mjs";
import { runOperation } from "../src/operations.mjs";
import { snapshot, canonical } from "../src/contracts.mjs";
import { ownerCases } from "../tests/owner-cases.mjs";
import { loadOwnerAdapter } from "./owner-adapter.mjs";

await mkdir(resolve(ROOT, "evidence/current"), { recursive: true });

const report = {
  kind: "owner-parity",
  status: "failed",
  currentWorktree: true,
  compilerCommit: BEND_PIN,
  assertions: 0,
  operations: ["money.round.v1", "vat.project.v1"],
  differences: [],
};

try {
  const { adapter, before, assertUnchanged } = await loadOwnerAdapter(),
    engine = await loadTestEngine();

  Object.assign(report, before, {
    checker: engine.authority,
    artifactDigest: engine.artifactDigest ?? null,
    sourceTreeDigest: engine.sourceTreeDigest ?? null,
  });

  for (const { operation, input } of ownerCases()) {
    const actual = snapshot(await adapter.calculate(operation, snapshot(input)));
    const bend = snapshot(runOperation(engine, operation, input));
    report.assertions++;

    if (canonical(actual) !== canonical(bend)) {
      report.differences.push({ operation, input, currentOwner: actual, bend });

      if (report.differences.length >= 20) break;
    }
  }

  await assertUnchanged();

  if (report.differences.length)
    throw Error(
      "Current-owner parity failed. Never preserve a known error just to obtain equality. Review the expectations and rule meanings.",
    );
  report.status = "passed";

  if (engine.authority === "official-js-artifact") {
    const build = JSON.parse(await readFile(resolve(ROOT, "dist/build.json"), "utf8"));

    if (
      build.artifactDigest !== engine.artifactDigest ||
      build.sourceTreeDigest !== engine.sourceTreeDigest
    )
      throw Error("Owner checks ran against a different build");
    await writeFile(
      resolve(ROOT, "dist/owner-parity.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }

  console.log(`PASS ${report.assertions} current-owner comparisons under ${engine.authority}`);
} catch (error) {
  report.status = "failed";
  report.error = String(error.message);
  process.exitCode = 1;
  console.error(report.error);
}

await writeFile(
  resolve(ROOT, "evidence/current/owner-parity.json"),
  JSON.stringify(report, null, 2) + "\n",
);
