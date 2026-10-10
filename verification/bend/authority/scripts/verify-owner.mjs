import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { loadTestEngine } from "../tests/test-engine.mjs";
import { runOperation } from "../src/operations.mjs";
import { snapshot, canonical } from "../src/contracts.mjs";
import { coverCases, ownerCases, voucherCases } from "../tests/owner-cases.mjs";
import { validateVoucher } from "../lib/accounting.mjs";
import { solveCover } from "../lib/cover.mjs";
import { loadOwnerAdapter } from "./owner-adapter.mjs";

await mkdir(resolve(ROOT, "evidence/current"), { recursive: true });

const report = {
  kind: "owner-parity",
  status: "failed",
  currentWorktree: true,
  compilerCommit: BEND_PIN,
  assertions: 0,
  operations: [
    "money.round.v1",
    "vat.project.v1",
    "fx.convert.v1",
    "schedule.equal.v1",
    "ledger.reverse.v1",
    "ledger.validate",
    "cover.search",
  ],
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

  // Voucher admission: the posting owner accepts exactly what the model accepts.
  for (const lines of voucherCases()) {
    const actual = await adapter.calculate("ledger.validate", { lines }),
      bend = { accepted: validateVoucher(engine, lines).accepted };

    report.assertions++;

    if (actual.accepted !== bend.accepted)
      report.differences.push({
        operation: "ledger.validate",
        input: { lines },
        currentOwner: actual,
        bend,
      });
  }

  // Bank cover search: neither side may miss or invent a cover, and verdicts must agree.
  for (const input of coverCases()) {
    const actual = await adapter.calculate("cover.search", input),
      bend = solveCover(engine, coverRequest(input)),
      problem = coverDisagreement(input, actual, bend);

    report.assertions++;

    if (problem)
      report.differences.push({
        operation: "cover.search",
        input,
        problem,
        currentOwner: actual,
        bend: { status: bend.status, witnesses: bend.witnesses?.map((w) => w.map((x) => x.id)) },
      });
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

function coverRequest({ targetMinor, amounts, maxSetSize }) {
  const scope = { entityId: "entity", bookId: "book", snapshotId: "snapshot" };

  return {
    scope,
    currency: "SEK",
    scale: 2,
    direction: "inflow",
    targetMinor,
    poolComplete: true,
    candidates: amounts.map((remainingMinor, index) => ({
      id: `c${String(index).padStart(2, "0")}`,
      remainingMinor,
      revision: "1",
      scope,
      currency: "SEK",
      scale: 2,
      direction: "inflow",
    })),
    limits: { maxCardinality: maxSetSize, nodeBudget: 100000 },
  };
}

/** The owner returns the smallest-size covers; the model reports up to two covers of any size. */
function coverDisagreement(input, actual, bend) {
  const amount = (id) => BigInt(input.amounts[Number(id.slice(1))]);

  for (const cover of actual.covers)
    if (cover.reduce((sum, id) => sum + amount(id), 0n) !== BigInt(input.targetMinor))
      return "owner cover does not sum to the target";

  if (actual.status === "incomplete_search" || bend.status === "incomplete")
    return "a search was incomplete on a small complete pool";

  if (bend.status === "no-match-within-scope")
    return actual.status === "no_match_within_declared_pool"
      ? null
      : "owner found a cover the model did not";

  if (actual.status === "no_match_within_declared_pool") return "owner missed a cover";

  if (bend.status === "unique-within-scope") {
    const only = bend.witnesses[0].map((x) => x.id).join(",");

    return actual.status === "unique_within_declared_pool" && actual.covers[0].join(",") === only
      ? null
      : "model has exactly one cover; owner disagrees";
  }

  // The model is ambiguous. The owner may still be unique when only one cover has
  // the smallest size, but it may never be smaller than the model's smallest witness.
  if (actual.status === "ambiguous") return null;

  const smallest = Math.min(...bend.witnesses.map((w) => w.length));

  return actual.covers[0].length <= smallest ? null : "owner kept a larger cover than the model's";
}
