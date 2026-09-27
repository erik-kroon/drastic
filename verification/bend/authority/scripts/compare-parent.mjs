import { readdir, readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT } from "../lib/engine.mjs";
import { digestBytes } from "../src/contracts.mjs";

// Does not copy or replace either side. Differences are an integration-review input.
const parent = resolve(process.argv[2] || resolve(ROOT, ".."));

try {
  await access(resolve(parent, "bend"));
} catch {
  throw Error("Parent bend/ directory not found; pass the integrated verification/bend path");
}

const rows = [];

for (const file of (await readdir(resolve(ROOT, "bend")))
  .filter((f) => f.endsWith(".bend"))
  .sort()) {
  let other;

  try {
    other = await readFile(resolve(parent, "bend", file));
  } catch {
    rows.push({ file, status: "new-in-authority" });
    continue;
  }

  const original = await digestBytes(other),
    candidate = await digestBytes(await readFile(resolve(ROOT, "bend", file)));

  rows.push({
    file,
    status: original === candidate ? "identical" : "different-review-required",
    parentDigest: original,
    authorityDigest: candidate,
  });
}

console.log(JSON.stringify({ parent, modified: false, rows }, null, 2));

if (rows.some((r) => r.status === "different-review-required")) process.exitCode = 1;
