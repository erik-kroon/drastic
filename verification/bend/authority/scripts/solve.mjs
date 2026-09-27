import { readFile, stat } from "node:fs/promises";
import { loadEngine, solveCover } from "../lib/index.mjs";

const file = process.argv[2];

if (!file || process.argv.length !== 3)
  throw new Error("Usage: npm run solve -- path/to/request.json");

if ((await stat(file)).size > 1024 * 1024) throw new Error("Input exceeds 1 MiB");

const request = JSON.parse(await readFile(file, "utf8"));

const result = solveCover(await loadEngine(), request);

console.log(JSON.stringify(result, null, 2));

if (result.status === "unavailable") process.exitCode = 1;
