import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  safeInside,
  requireNoSymlinkParents,
  runBounded,
  childEnvironment,
} from "../scripts/runtime.mjs";

test("paths cannot escape source/evidence scope", () => {
  assert.throws(() => safeInside("/tmp/root", "../secret"));
  assert.throws(() => safeInside("/tmp/root", "/absolute"));
  assert.equal(safeInside("/tmp/root", "a/b.json"), "/tmp/root/a/b.json");
});

test("symlink parents cannot redirect writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "assurance-symlink-"));

  try {
    await symlink(tmpdir(), join(root, "link"));
    await assert.rejects(requireNoSymlinkParents(root, join(root, "link", "output")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("child environment does not carry database/provider tokens", () => {
  const old = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://secret";

  try {
    assert.equal(childEnvironment().DATABASE_URL, undefined);
    assert.equal(childEnvironment().CI, "true");
  } finally {
    if (old === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = old;
  }
});

test("nonzero child is not disguised as a successful stage", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "assurance-process-"));

  try {
    const r = await runBounded(
      process.execPath,
      ["-e", 'console.log("known output");process.exitCode=7'],
      { cwd: tmp, env: childEnvironment(), timeoutMs: 5000, logPath: join(tmp, "run.log") },
    );

    assert.equal(r.exitCode, 7);
    assert.match(await readFile(join(tmp, "run.log"), "utf8"), /known output/);
    assert.equal(r.timedOut, false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("timeout is explicit and cannot qualify a stage", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "assurance-timeout-"));

  try {
    const r = await runBounded(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      cwd: tmp,
      env: childEnvironment(),
      timeoutMs: 100,
      logPath: join(tmp, "run.log"),
    });

    assert.equal(r.timedOut, true);
    assert.notEqual(r.exitCode, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
