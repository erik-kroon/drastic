import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as Schema from "effect/Schema";
import * as Contract from "../../packages/contracts/src/decision-examples";
import * as Memory from "../../packages/domain/src/firm-memory";

const origin = process.env.OPENERP_API_URL;

const token = process.env.OPENERP_OPERATOR_TOKEN;

const [entityId, bookId, exportId, directory] = process.argv.slice(2);

if (!origin || !token || !entityId || !bookId || !exportId || !directory)
  throw new Error(
    "API URL, operator token and entity/book/sealed export/output directory are required.",
  );

const path = `/api/v1/entities/${encodeURIComponent(entityId)}/books/${encodeURIComponent(bookId)}/automation/decision-examples/${encodeURIComponent(exportId)}`;

const response = await fetch(`${origin.replace(/\/$/, "")}${path}`, {
  headers: { authorization: `Bearer ${token}` },
});

if (!response.ok) throw new Error(`Sealed export refused (${response.status}).`);

const exported = Schema.decodeUnknownSync(Contract.DecisionExampleExport)(await response.json());

if (exported.scope.bookId !== bookId || exported.scope.entityId !== entityId)
  throw new Error("Sealed export scope mismatch.");

const history = exported.examples.flatMap((example) =>
  example.precedent ? [example.precedent] : [],
);

function population(classification: "independent" | "corrected") {
  return {
    exampleCount: exported.examples.filter(
      (example) => example.provenance.classification === classification,
    ).length,
    representative: classification === "independent" ? "not_established" : false,
    selection: classification === "corrected" ? "observed_disagreements" : "independent_labels",
    baseline: Memory.baseline(
      history.filter((record) => record.provenance.classification === classification),
    ),
  };
}

const report = {
  ...Memory.baseline(history),
  aggregateInterpretation: "descriptive_nonrepresentative",
  populations: { independent: population("independent"), corrected: population("corrected") },
  sealedExport: { id: exported.id, digest: exported.digest, lineageCutoff: exported.lineageCutoff },
  inputCounts: {
    examples: exported.examples.length,
    capturedPrecedents: history.length,
    missingPrecedents: exported.examples.length - history.length,
    excluded: exported.exclusions.length,
  },
  inputExclusions: exported.exclusions,
};

await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
