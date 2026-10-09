import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const { PNG } = createRequire(import.meta.resolve("e2e"))("pngjs");

const [screenId, capturePath, output] = process.argv.slice(2);

if (!screenId || !capturePath || !output)
  throw new Error(
    "Usage: node verification/paper/compare.mjs K-xx capture.json evidence-directory",
  );

const manifest = JSON.parse(readFileSync("verification/paper/kanon-manifest.json", "utf8"));

const entry = manifest.entries.find((candidate) => candidate.id === screenId);

if (!entry || entry.adoption !== "approved" || !entry.comparison?.adoptedBy)
  throw new Error("Adopt the exact state and comparison policy before measuring parity");

const policy = entry.comparison;

if (
  !Number.isInteger(policy.channelTolerance) ||
  policy.channelTolerance < 0 ||
  policy.channelTolerance > 255 ||
  !Number.isFinite(policy.maxDiffRatio) ||
  policy.maxDiffRatio < 0 ||
  policy.maxDiffRatio > 1
)
  throw new Error("Invalid adopted comparison policy");

const capture = JSON.parse(readFileSync(capturePath, "utf8"));

for (const key of [
  "actual",
  "command",
  "conditions",
  "reviewer",
  "sourceRevision",
  "sourceHashes",
]) {
  if (!capture[key]) throw new Error(`Missing capture provenance: ${key}`);
}

for (const key of [
  "browser",
  "deviceScaleFactor",
  "fonts",
  "locale",
  "theme",
  "time",
  "fixture",
  "viewport",
  "route",
]) {
  if (!capture.conditions[key]) throw new Error(`Missing rendering condition: ${key}`);
}

if (
  capture.conditions.route !== entry.route ||
  JSON.stringify(capture.conditions.viewport) !== JSON.stringify(entry.viewport)
)
  throw new Error("Capture route/viewport differs from the adopted contract");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const file of entry.files) {
  if (capture.sourceHashes[file] !== sha256(readFileSync(file)))
    throw new Error(`Implementation changed after capture: ${file}`);
}

const expectedBytes = readFileSync(entry.baseline);

if (sha256(expectedBytes) !== entry.baselineSha256) throw new Error("Baseline hash changed");

const expected = PNG.sync.read(expectedBytes);

const actualBytes = readFileSync(capture.actual);

const actual = PNG.sync.read(actualBytes);

if (actual.width !== expected.width || actual.height !== expected.height)
  throw new Error("Image dimensions differ; scaling/cropping is forbidden");

const diff = new PNG({ width: expected.width, height: expected.height });

let changed = 0;

for (let pixel = 0; pixel < expected.width * expected.height; pixel++) {
  const offset = pixel * 4;

  const mismatch = [0, 1, 2, 3].some(
    (channel) =>
      Math.abs(expected.data[offset + channel] - actual.data[offset + channel]) >
      policy.channelTolerance,
  );

  if (mismatch) changed++;

  diff.data[offset] = mismatch ? 255 : actual.data[offset];
  diff.data[offset + 1] = mismatch ? 0 : actual.data[offset + 1];
  diff.data[offset + 2] = mismatch ? 0 : actual.data[offset + 2];
  diff.data[offset + 3] = 255;
}

mkdirSync(output, { recursive: true });

copyFileSync(capture.actual, join(output, "actual.png"));

writeFileSync(join(output, "diff.png"), PNG.sync.write(diff));

const difference = changed / (expected.width * expected.height);

const result = {
  scope: entry.id,
  sourceRevision: capture.sourceRevision,
  comparatorRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  referenceSha256: entry.baselineSha256,
  actualSha256: sha256(actualBytes),
  diffSha256: sha256(readFileSync(join(output, "diff.png"))),
  sourceHashes: capture.sourceHashes,
  command: capture.command,
  comparisonCommand: process.argv.join(" "),
  conditions: capture.conditions,
  reviewer: capture.reviewer,
  difference,
  tolerance: policy.maxDiffRatio,
  channelTolerance: policy.channelTolerance,
  adoptedBy: policy.adoptedBy,
  actual: join(output, "actual.png"),
  diff: join(output, "diff.png"),
  passed: difference <= policy.maxDiffRatio,
};

writeFileSync(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

console.log(JSON.stringify(result));

if (!result.passed) process.exit(1);
