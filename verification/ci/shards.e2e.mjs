import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const out = resolve(root, "test-results/ci/shards.json");

rmSync(out, { force: true });

const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const command = manifest.scripts["test:domain-owners"].split(" ");

assert.deepEqual(command.slice(0, 3), ["vp", "test", "run"]);

const filters = command.slice(3);

const selections = [];

const sources = [];

for (const shard of [1, 2]) {
  const directory = resolve(root, `test-results/domain-owners-${shard}`);
  const results = JSON.parse(readFileSync(resolve(directory, "results.json"), "utf8"));
  const integrity = JSON.parse(readFileSync(resolve(directory, "source-integrity.json"), "utf8"));

  const run = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));

  assert.equal(results.success, true, `Shard ${shard} failed`);
  assert.equal(results.numFailedTests, 0);
  assert.equal(results.numPendingTests, 0, `Shard ${shard} skipped tests`);

  assert.equal(results.numTodoTests, 0, `Shard ${shard} has unfinished tests`);

  assert.equal(integrity.status, "stable", `Shard ${shard} changed source during its run`);

  const source = {};

  for (const key of ["revision", "lockSha256", "sourceInventorySha256"]) {
    assert.equal(typeof run[key], "string", `Shard ${shard} has no ${key}`);

    source[key] = run[key];
  }

  assert.equal(integrity.sourceInventorySha256, run.sourceInventorySha256);

  assert.equal(integrity.finalSourceInventorySha256, run.sourceInventorySha256);

  sources.push(source);

  const files = results.testResults
    .map((entry) => {
      assert.equal(entry.status, "passed", `Failed suite ${entry.name}`);

      const marker = "apps/api/tests/";
      const offset = entry.name.lastIndexOf(marker);

      assert.ok(offset >= 0, `Unexpected suite path ${entry.name}`);

      return entry.name.slice(offset);
    })
    .sort((left, right) => left.localeCompare(right));

  assert.ok(files.length > 0, `Empty shard ${shard}`);
  selections.push({ shard, files });
}

const partition = selections
  .flatMap((selection) => selection.files)
  .sort((left, right) => left.localeCompare(right));

assert.equal(new Set(partition).size, partition.length, "Shards overlap");

assert.deepEqual(
  partition,
  [...filters].sort((left, right) => left.localeCompare(right)),
  "Shards omit or add declared workflows",
);

assert.deepEqual(sources[0], sources[1], "Shards ran different source inputs");

mkdirSync(dirname(out), { recursive: true });

writeFileSync(
  out,
  JSON.stringify({ status: "passed", source: sources[0], selections }, null, 2) + "\n",
);

console.info(`Verified domain-owner partitions. Evidence at ${out}`);
