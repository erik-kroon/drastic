import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyUpstream } from "./build-official.mjs";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { digestBytes } from "../src/contracts.mjs";
import { runProcess } from "./process.mjs";

const upstream = await verifyUpstream();

const build = JSON.parse(await readFile(resolve(ROOT, "dist/build.json"), "utf8"));

const B = await import(pathToFileURL(resolve(upstream, "bend2/bend.ts")));

const S = await import(pathToFileURL(resolve(upstream, "bend2/safe.ts")));

const book = B.book_nil();

await B.book_load(book, resolve(ROOT, "bend/Kernel.bend"), "", new Map());

B.book_valid(book);

if (book.hols || Object.values(book.tlds).some((t) => t.u || t.i))
  throw Error("Unsafe or open source");

const out = resolve(ROOT, "dist/Kernel.bendtt");

const [roots, excluded] = S.safe_emit(book, out);

if (!roots || excluded.length)
  throw Error(`The safe translation excluded definitions: ${excluded.join("")}`);

// Never let an old ~/.bend cache stand in for a known kernel.
const runs = [];

let scratch = null,
  binary = process.env.BENDTT;

try {
  if (binary) {
    const expected = process.env.BENDTT_SHA256;

    if (!expected || (await digestBytes(await readFile(binary))) !== expected)
      throw Error("BENDTT requires an independently pinned BENDTT_SHA256");
  } else {
    const lean = process.env.LEAN_BIN || "lean",
      leanc = process.env.LEANC_BIN || "leanc";

    let r = await runProcess(lean, ["--version"]);
    runs.push(r);

    if (!r.passed || !/version 4\.34\.0(?:\D|$)/u.test(r.stdout))
      throw Error("This upstream pin requires Lean 4.34.0");
    scratch = await mkdtemp(resolve(tmpdir(), "openerp-bendtt-"));
    await writeFile(
      resolve(scratch, "bendtt.lean"),
      await readFile(resolve(upstream, "bend2/bendtt.lean")),
    );
    r = await runProcess(lean, ["-c", "bendtt.c", "bendtt.lean"], {
      cwd: scratch,
      timeoutMs: 180000,
    });
    runs.push(r);

    if (!r.passed) throw Error("Pinned Lean source did not build");
    r = await runProcess(leanc, ["-O3", "-DNDEBUG", "bendtt.c", "-o", "bendtt"], {
      cwd: scratch,
      timeoutMs: 180000,
    });
    runs.push(r);

    if (!r.passed) throw Error("Pinned kernel did not compile");
    binary = resolve(scratch, "bendtt");
  }

  const r = await runProcess(binary, [out], { timeoutMs: 180000 });
  runs.push(r);

  if (!r.passed || !(r.stdout + r.stderr).trim())
    throw Error("The official safe kernel produced no successful verdict");

  const receipt = {
    schema: "openerp-bend-receipt/v1",
    kind: "safe-kernel",
    status: "passed",
    official: true,
    compilerCommit: BEND_PIN,
    sourceTreeDigest: build.sourceTreeDigest,
    artifactDigest: build.artifactDigest,
    translationDigest: await digestBytes(await readFile(out)),
    kernelBinaryDigest: await digestBytes(await readFile(binary)),
    rootCount: roots,
    openObligations: book.hols,
    excludedDefinitions: excluded,
    runs,
    caveat: "The upstream translation and JS code generator are not proved by this kernel check.",
  };

  await writeFile(resolve(ROOT, "dist/safe-kernel.json"), JSON.stringify(receipt, null, 2) + "\n");
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
