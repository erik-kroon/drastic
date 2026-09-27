import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { runtimeIdentity } from "../src/runtime-id.mjs";

const build = JSON.parse(await readFile(resolve(ROOT, "dist/build.json"), "utf8"));

const reports = await Promise.all(
  ["arithmetic-tests", "authority-tests", "extension-tests"].map(async (name) =>
    JSON.parse(await readFile(resolve(ROOT, `evidence/current/${name}.json`), "utf8")),
  ),
);

for (const r of reports)
  if (
    r.status !== "passed" ||
    r.checker !== "official-js-artifact" ||
    r.artifactDigest !== build.artifactDigest ||
    r.sourceTreeDigest !== build.sourceTreeDigest
  )
    throw Error("A test report is stale, unofficial or belongs to a different artifact");

const operations = [...new Set(reports.flatMap((r) => r.operations ?? []))];

const receipt = {
  schema: "openerp-bend-receipt/v1",
  status: "passed",
  compilerCommit: BEND_PIN,
  artifactDigest: build.artifactDigest,
  sourceTreeDigest: build.sourceTreeDigest,
  runtimeId: runtimeIdentity(),
  operations,
  assertions: reports.reduce((n, r) => n + r.assertions, 0),
  suites: reports.map((r) => ({
    suite: r.suite ?? "arithmetic",
    assertions: r.assertions,
    elapsedMs: r.elapsedMs,
  })),
};

await writeFile(
  resolve(ROOT, "dist/compiled-differentials.json"),
  JSON.stringify({ ...receipt, kind: "compiled-differentials" }, null, 2) + "\n",
);

await writeFile(
  resolve(ROOT, "dist/runtime-probe.json"),
  JSON.stringify(
    {
      ...receipt,
      kind: "runtime-probe",
      probe: "same generated module executed by the complete suites, not a runtime-name assertion",
    },
    null,
    2,
  ) + "\n",
);
