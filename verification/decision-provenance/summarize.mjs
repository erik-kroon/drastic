import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "test-results/dra219-provenance");

const files = [
  "decision-provenance-bank.json",
  "decision-provenance-supplier.json",
  "decision-provenance-partial-hints.json",
  "supplier-extraction-journey.json",
  "period-batch-aggregate-mixed-recovery.json",
  "sie-all-or-none.json",
];

const rows = [];

for (const file of files) {
  const artifact = JSON.parse(await readFile(resolve(directory, file), "utf8"));

  rows.push(
    ...(artifact.rows ??
      artifact.provenance ??
      artifact.journeys?.flatMap((journey) => journey.rows) ??
      []),
  );
}

const decisions = [
  ...new Map(
    rows.map((row) => [`${row.bookId}:${row.decision_kind}:${row.decision_id}`, row]),
  ).values(),
];

const counts = Object.fromEntries(
  [
    "independent",
    "accepted_unchanged",
    "corrected",
    "batch_approved",
    "unknown_exposure",
    "historical_import",
  ].map((classification) => [
    classification,
    decisions.filter((row) => row.classification === classification).length,
  ]),
);

const results = JSON.parse(await readFile(resolve(directory, "results.json"), "utf8"));

const integrity = JSON.parse(await readFile(resolve(directory, "source-integrity.json"), "utf8"));

if (!results.success || integrity.status !== "stable" || decisions.length === 0)
  throw new Error("Passing tests, stable sources and observed decisions are required.");

await writeFile(
  resolve(directory, "decision-provenance-summary.json"),
  JSON.stringify(
    {
      syntheticOnly: true,
      command: `node verification/decision-provenance/summarize.mjs ${directory}`,
      sourceInventorySha256: integrity.sourceInventorySha256,
      counts,
      decisions,
    },
    null,
    2,
  ),
);

process.stdout.write(`${JSON.stringify(counts)}\n`);
