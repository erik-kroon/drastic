import { SEMANTICS } from "./semantics.mjs";
import {
  record,
  array,
  text,
  sha,
  oneOf,
  snapshot,
  digest,
  OPERATIONS,
  fail,
} from "./contracts.mjs";

export const REQUIRED_RECEIPTS = Object.freeze([
  "source-check",
  "safe-kernel",
  "reproducible-build",
  "compiled-differentials",
  "runtime-probe",
  "host-integration",
]);

/** A manifest is not its own approval. approved entries come from trusted deployment configuration. */
export async function qualifyManifest(
  manifestValue,
  trustValue,
  runtimeId,
  artifactDigest,
  readReceipt,
) {
  const manifest = snapshot(manifestValue),
    trust = snapshot(trustValue);

  record(manifest, "release", [
    "schema",
    "releaseId",
    "sourceTreeDigest",
    "artifactDigest",
    "compiler",
    "operations",
    "semantics",
    "receipts",
  ]);

  if (manifest.schema !== "openerp-bend-release/v1")
    fail("InvalidRelease", "Unsupported release schema");
  text(manifest.releaseId, "releaseId");
  sha(manifest.sourceTreeDigest, "sourceTreeDigest");
  sha(manifest.artifactDigest, "artifactDigest");
  record(manifest.compiler, "compiler", ["repository", "commit", "checkerBlob", "compilerBlob"]);

  if (
    manifest.compiler.repository !== "bendlang/bend" ||
    manifest.compiler.commit !== "af569d4826913b2ce3557e9829ccad31fcf86f94" ||
    manifest.compiler.checkerBlob !== "c38e9e203530568b500dfc34785372d427706a6c" ||
    manifest.compiler.compilerBlob !== "12ffbef1837a184fb7c5a255c4847397b2eec75a"
  )
    fail("CompilerMismatch", "This bridge supports only its inspected compiler pin");
  array(manifest.operations, "release operations", OPERATIONS.length, 1);

  for (const op of manifest.operations) oneOf(op, OPERATIONS, "operation");

  if (
    new Set(manifest.operations).size !== manifest.operations.length ||
    manifest.operations.includes("cover.suggest.v1")
  )
    fail(
      "InvalidRelease",
      "Duplicate operations or suggestion-only solver in an authority release",
    );
  record(manifest.semantics, "semantics", manifest.operations);

  for (const op of manifest.operations) {
    if (manifest.semantics[op] !== SEMANTICS[op])
      fail("SemanticsMismatch", `Unsupported semantics for ${op}`);
  }

  if (artifactDigest !== manifest.artifactDigest)
    fail("ArtifactMismatch", "Loaded artifact differs from the tested release");
  const manifestDigest = await digest(manifest);
  record(trust, "trust", ["schema", "approvedReleases"]);

  if (trust.schema !== "openerp-bend-trust/v1") fail("InvalidTrust", "Wrong trust schema");
  array(trust.approvedReleases, "approvedReleases", 100);
  text(runtimeId, "runtimeId");

  for (const entry of trust.approvedReleases) record(entry, "trusted approval");

  const approval = trust.approvedReleases.find(
    (x) => x.manifestDigest === manifestDigest && x.runtimeId === runtimeId,
  );

  if (!approval)
    fail("UnqualifiedRelease", "No out-of-band approval for this exact release and runtime");
  record(approval, "approval", [
    "manifestDigest",
    "runtimeId",
    "operations",
    "reviewer",
    "reviewedAt",
    "reason",
  ]);
  text(approval.reviewer, "reviewer");
  text(approval.reviewedAt, "reviewedAt");
  text(approval.reason, "reason", 2000);
  array(approval.operations, "approved operations", manifest.operations.length, 1);

  if (new Set(approval.operations).size !== approval.operations.length)
    fail("InvalidTrust", "Duplicate approved operation");

  for (const op of approval.operations)
    if (!manifest.operations.includes(op))
      fail("UnqualifiedOperation", "Approval exceeds release coverage");
  array(manifest.receipts, "receipts", 32);
  const loaded = new Map();

  for (const entry of manifest.receipts) {
    record(entry, "receipt reference", ["kind", "path", "digest"]);
    text(entry.kind, "kind");
    text(entry.path, "receipt path");
    sha(entry.digest, "receipt digest");

    if (loaded.has(entry.kind)) fail("InvalidRelease", "Duplicate receipt kind");
    const bytes = await readReceipt(entry.path);
    const { digestBytes } = await import("./contracts.mjs");

    if ((await digestBytes(bytes)) !== entry.digest)
      fail("ReceiptMismatch", `Changed evidence: ${entry.kind}`);
    const data = JSON.parse(new TextDecoder().decode(bytes));

    if (
      data.status !== "passed" ||
      data.sourceTreeDigest !== manifest.sourceTreeDigest ||
      data.artifactDigest !== manifest.artifactDigest ||
      data.compilerCommit !== manifest.compiler.commit ||
      data.synthetic === true
    )
      fail("UnqualifiedRelease", `Receipt ${entry.kind} does not attest this build`);

    if (entry.kind === "source-check" && data.official !== true)
      fail("UnqualifiedRelease", "Unofficial source checker");

    if (
      entry.kind === "safe-kernel" &&
      (data.excludedDefinitions?.length !== 0 ||
        data.openObligations !== 0 ||
        data.official !== true)
    )
      fail("UnqualifiedRelease", "Unsafe, open or unofficial proof checking");

    if (entry.kind === "runtime-probe" && data.runtimeId !== runtimeId)
      fail("RuntimeMismatch", "Probe was run in another runtime");

    if (
      ["compiled-differentials", "host-integration", "runtime-probe"].includes(entry.kind) &&
      !approval.operations.every((op) => data.operations?.includes(op))
    )
      fail("UnqualifiedOperation", "Runtime or integration evidence lacks a promoted operation");
    loaded.set(entry.kind, data);
  }

  const required = [...REQUIRED_RECEIPTS];

  if (approval.operations.some((op) => ["vat.project.v1", "money.round.v1"].includes(op)))
    required.push("owner-parity");

  for (const kind of required)
    if (!loaded.has(kind)) fail("UnqualifiedRelease", `Missing evidence: ${kind}`);

  if (loaded.has("owner-parity")) {
    const owner = loaded.get("owner-parity");

    for (const op of approval.operations.filter((op) =>
      ["vat.project.v1", "money.round.v1"].includes(op),
    )) {
      if (
        !owner.operations?.includes(op) ||
        !owner.ownerTreeDigest ||
        owner.currentWorktree !== true
      )
        fail("UnqualifiedOperation", "Current-owner parity does not cover this operation");
    }
  }

  return snapshot({
    status: "qualified-for-runtime",
    releaseId: manifest.releaseId,
    manifestDigest,
    artifactDigest,
    runtimeId,
    operations: approval.operations,
    semantics: manifest.semantics,
    sourceTreeDigest: manifest.sourceTreeDigest,
    reviewer: approval.reviewer,
  });
}
