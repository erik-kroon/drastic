import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, BEND_PIN, CHECKER_BLOB } from "../lib/engine.mjs";
import { sourceIdentity } from "./build-official.mjs";
import { digestBytes, digest } from "../src/contracts.mjs";
import { SEMANTICS } from "../src/semantics.mjs";
import { qualifyManifest, REQUIRED_RECEIPTS } from "../src/release.mjs";
import { runtimeIdentity } from "../src/runtime-id.mjs";

const releaseId = process.argv[2],
  operations = process.argv.slice(3);

if (!releaseId || !operations.length || operations.some((op) => !Object.hasOwn(SEMANTICS, op)))
  throw Error("Usage: stage-release.mjs <release-id> <operation...>");

const gate = JSON.parse(
  await readFile(resolve(ROOT, "evidence/current/release-verification.json"), "utf8"),
);

const build = JSON.parse(await readFile(resolve(ROOT, "dist/build.json"), "utf8"));

if (
  gate.status !== "passed" ||
  gate.sourceTreeDigest !== build.sourceTreeDigest ||
  (await sourceIdentity()).digest !== build.sourceTreeDigest
)
  throw Error("A complete fresh release gate is required");

const kinds = [...REQUIRED_RECEIPTS];

if (operations.some((op) => ["vat.project.v1", "money.round.v1"].includes(op)))
  kinds.push("owner-parity");

const receipts = [];

for (const kind of kinds) {
  const path = `${kind}.json`,
    bytes = await readFile(resolve(ROOT, "dist", path));

  receipts.push({ kind, path, digest: await digestBytes(bytes) });
}

const manifest = {
  schema: "openerp-bend-release/v1",
  releaseId,
  sourceTreeDigest: build.sourceTreeDigest,
  artifactDigest: build.artifactDigest,
  compiler: {
    repository: "bendlang/bend",
    commit: BEND_PIN,
    checkerBlob: CHECKER_BLOB,
    compilerBlob: "12ffbef1837a184fb7c5a255c4847397b2eec75a",
  },
  operations,
  semantics: Object.fromEntries(operations.map((op) => [op, SEMANTICS[op]])),
  receipts,
};

// Validate evidence without writing a trust configuration. This local review
// context is thrown away and cannot be loaded by deployment code.
const manifestDigest = await digest(manifest);

await qualifyManifest(
  manifest,
  {
    schema: "openerp-bend-trust/v1",
    approvedReleases: [
      {
        manifestDigest,
        runtimeId: runtimeIdentity(),
        operations,
        reviewer: "staging-validation-only",
        reviewedAt: new Date().toISOString(),
        reason: "Validate the candidate shape. NOT deployment approval.",
      },
    ],
  },
  runtimeIdentity(),
  await digestBytes(await readFile(resolve(ROOT, "dist/kernel.mjs"))),
  (path) => readFile(resolve(ROOT, "dist", path)),
);

await writeFile(
  resolve(ROOT, "dist/release-candidate.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

await writeFile(
  resolve(ROOT, "evidence/current/release-candidate.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(
  JSON.stringify(
    { staged: true, manifestDigest, runtimeId: runtimeIdentity(), operations, approved: false },
    null,
    2,
  ),
);
