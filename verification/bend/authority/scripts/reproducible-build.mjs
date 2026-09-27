import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT } from "../lib/engine.mjs";
import { digestBytes } from "../src/contracts.mjs";
import { runProcess } from "./process.mjs";

const runs = [],
  hashes = [];

for (let i = 0; i < 2; i++) {
  const r = await runProcess(
    process.execPath,
    process.versions.bun
      ? ["scripts/build-official.mjs"]
      : ["--experimental-strip-types", "scripts/build-official.mjs"],
    { cwd: ROOT },
  );

  runs.push(r);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);

  if (!r.passed) throw Error(`Official build ${i + 1} failed`);
  hashes.push(await digestBytes(await readFile(resolve(ROOT, "dist/kernel.mjs"))));
}

if (hashes[0] !== hashes[1])
  throw Error("Two clean-process builds did not produce identical bytes");

const build = JSON.parse(await readFile(resolve(ROOT, "dist/build.json"), "utf8"));

await writeFile(
  resolve(ROOT, "dist/reproducible-build.json"),
  JSON.stringify(
    {
      status: "passed",
      kind: "reproducible-build",
      artifactDigest: build.artifactDigest,
      sourceTreeDigest: build.sourceTreeDigest,
      compilerCommit: build.compilerCommit,
      runs,
      hashes,
    },
    null,
    2,
  ) + "\n",
);
