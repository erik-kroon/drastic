import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.env.OPENERP_API_URL;

const token = process.env.OPENERP_OPERATOR_TOKEN;

const [entityId, bookId, exportId, directory] = process.argv.slice(2);

if (!origin || !token || !entityId || !bookId || !exportId || !directory)
  throw new Error(
    "API URL, operator token and entity/book/sealed export/output directory are required.",
  );

const path = `/v1/entities/${encodeURIComponent(entityId)}/books/${encodeURIComponent(bookId)}/automation/decision-examples/${encodeURIComponent(exportId)}`;

const response = await fetch(`${origin.replace(/\/$/, "")}${path}`, {
  headers: { authorization: `Bearer ${token}` },
});

if (!response.ok) throw new Error(`Sealed export refused (${response.status}).`);

const exported = await response.json();

await writeFile(
  resolve(directory, "examples.jsonl"),
  exported.examples.map((example) => JSON.stringify(example)).join("\n") +
    (exported.examples.length ? "\n" : ""),
);

await writeFile(
  resolve(directory, "manifest.json"),
  JSON.stringify(
    {
      id: exported.id,
      digest: exported.digest,
      scope: exported.scope,
      purpose: exported.purpose,
      lineageCutoff: exported.lineageCutoff,
      versions: exported.versions,
      ...exported.manifest,
      exclusions: exported.exclusions,
    },
    null,
    2,
  ),
);

process.stdout.write(`Sealed export ${exported.id}: ${exported.examples.length} examples.\n`);
