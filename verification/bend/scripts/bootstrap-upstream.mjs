import { resolve } from "node:path";
import { mkdir, access } from "node:fs/promises";
import { runProcess } from "./process.mjs";
import { verifyUpstream } from "./build-official.mjs";
import { BEND_PIN } from "../lib/engine.mjs";

const target = resolve(process.argv[2] || ".bend-upstream");

let exists = true;

try {
  await access(target);
} catch {
  exists = false;
}

if (exists)
  throw Error("Destination already exists. This command never resets or replaces a checkout.");

await mkdir(target, { recursive: true });

for (const args of [
  ["init", target],
  ["-C", target, "remote", "add", "origin", "https://github.com/bendlang/bend.git"],
  ["-C", target, "fetch", "--depth", "1", "origin", BEND_PIN],
  ["-C", target, "checkout", "--detach", "FETCH_HEAD"],
]) {
  const r = await runProcess("git", args);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);

  if (!r.passed) throw Error(r.error || `git exited ${r.status}`);
}

process.env.BEND_SOURCE_ROOT = target;

await verifyUpstream();

console.log(`Verified pinned upstream source at ${target}. No release was promoted.`);
