import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { loadOwnerAdapter } from "./owner-adapter.mjs";
import { compiledEngine } from "../src/compiled-engine.mjs";
import { qualifiedService } from "../src/service.mjs";
import { digestBytes, integer } from "../src/contracts.mjs";
import { runtimeIdentity } from "../src/runtime-id.mjs";
import { SEMANTICS } from "../src/semantics.mjs";

// This hook MUST exercise actual application calls and transaction/recovery gates.
// It is not supplied as a fake passing test. The local unit fixtures are separate.
const build = JSON.parse(await readFile(resolve(ROOT, "dist/build.json"), "utf8"));

const bytes = await readFile(resolve(ROOT, "dist/kernel.mjs"));

if ((await digestBytes(bytes)) !== build.artifactDigest) throw Error("Artifact changed");

const { adapter, before, assertUnchanged } = await loadOwnerAdapter();

if (typeof adapter.verifyHost !== "function")
  throw Error(
    "The current-owner adapter must implement verifyHost against the real application test harness",
  );

const compiled = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);

const engine = compiledEngine(compiled.default, compiled.constructors);

// Explicit harness-only injection, never a deployable approval or an emitted trusted record.
const service = qualifiedService(engine, {
  status: "qualified-for-runtime",
  releaseId: "bend-host-test-only",
  runtimeId: runtimeIdentity(),
  sourceTreeDigest: build.sourceTreeDigest,
  artifactDigest: build.artifactDigest,
  manifestDigest: "sha256:" + "0".repeat(64),
  operations: Object.keys(SEMANTICS),
  semantics: SEMANTICS,
});

const result = await adapter.verifyHost({
  candidate: service,
  artifactDigest: build.artifactDigest,
  sourceTreeDigest: build.sourceTreeDigest,
});

integer(result.assertions, "host assertions", 1, 10_000_000);

const required = [
  "immutable-capture",
  "changed-basis-refuses",
  "approved-output-not-recomputed",
  "no-typescript-fallback",
  "current-owner-call-path",
];

if (
  result.synthetic === true ||
  !Array.isArray(result.checks) ||
  required.some((name) => !result.checks.some((c) => c.name === name && c.status === "passed"))
)
  throw Error("Host integration lacks a required real application check");

if (
  !Array.isArray(result.operations) ||
  !result.operations.length ||
  result.operations.some((op) => !Object.hasOwn(SEMANTICS, op))
)
  throw Error("No supported operation coverage");

await assertUnchanged();

const receipt = {
  ...result,
  kind: "host-integration",
  status: "passed",
  compilerCommit: BEND_PIN,
  ...before,
  runtimeId: runtimeIdentity(),
  artifactDigest: build.artifactDigest,
  sourceTreeDigest: build.sourceTreeDigest,
  currentWorktree: true,
};

await writeFile(
  resolve(ROOT, "dist/host-integration.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);

await writeFile(
  resolve(ROOT, "evidence/current/host-integration.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);

console.log("Real host integration passed. No deployment trust entry was created.");
