import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { ROOT, BEND_PIN } from "../lib/engine.mjs";
import { digest, digestBytes } from "../src/contracts.mjs";

export const PINS = Object.freeze({
  "bend2/bend.ts": "c38e9e203530568b500dfc34785372d427706a6c",
  "bend2/comp.ts": "12ffbef1837a184fb7c5a255c4847397b2eec75a",
  "bend2/base.bend": "06fe1e8c4741987ae04b171ac785b2258371ddc3",
  "bend2/safe.ts": "c9cfdc11bb5b8339fd076827e7d5ba08458990d3",
  "bend2/bendtt.lean": "3ea970dfbb204740d094d1e3504c91ecdb6901f2",
  "bend2/main.ts": "0d5be3fdda74d076c4ebdd53b60d73fd155506ef",
});

export const roots = Object.freeze([
  "BigNat.normalize",
  "BigNat.add",
  "BigNat.multiply",
  "BigNat.monus",
  "BigNat.subtract",
  "BigNat.divmod",
  "BigNat.compare",
  "BigNat.gcd",
  "BigNat.gcdLoop",
  "BigInt.make",
  "BigInt.add",
  "BigInt.subtract",
  "BigInt.multiply",
  "BigInt.compare",
  "BigInt.divmod",
  "Rational.make",
  "Rational.add",
  "Rational.multiply",
  "Rational.divide",
  "Rational.round",
  "Decimal.fromDigits",
  "Decimal.toDigits",
  "Ledger.validate",
  "Ledger.debits",
  "Ledger.credits",
  "Ledger.reverse",
  "Allocation.allocate",
  "Allocation.restore",
  "Vat.calculate",
  "Cover.solve",
  "Schedule.equal",
  "Fx.convert",
]);

export async function verifyUpstream() {
  const sourceRoot = process.env.BEND_SOURCE_ROOT;

  if (!sourceRoot)
    throw new Error(
      "BEND_SOURCE_ROOT is required. No reconstructed checker may emit an official artifact.",
    );

  for (const [name, expected] of Object.entries(PINS)) {
    const bytes = await readFile(resolve(sourceRoot, name));
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

    if (blob !== expected) throw new Error(`Pinned upstream file mismatch: ${name}: ${blob}`);
  }

  return resolve(sourceRoot);
}

export async function sourceIdentity() {
  const files = {};

  async function walk(dir) {
    for (const f of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = resolve(dir, f.name);

      if (f.isDirectory()) await walk(p);
      else if (/\.(bend|mjs|mts|ts)$/u.test(f.name))
        files[relative(ROOT, p).replaceAll("\\", "/")] = await digestBytes(await readFile(p));
    }
  }

  // Build and verification logic is bound alongside the kernel and boundary code.
  for (const dir of ["bend", "src", "lib", "scripts", "tests"]) await walk(resolve(ROOT, dir));

  for (const name of [
    "package.json",
    "tsconfig.json",
    "tsconfig.types.json",
    "vite.host.config.mts",
    "../lib/engine.mjs",
    "../lib/archived-source.mjs",
    "../lib/owner.mjs",
    "../tooling/dev-checker.ts.gz",
    "../tooling/base.bend",
    "../upstream/vat-monetary-slice.ts.gz",
  ]) {
    files[name] = await digestBytes(await readFile(resolve(ROOT, name)));
  }

  return { digest: await digest(files), files };
}

export async function buildOfficial() {
  const upstream = await verifyUpstream();
  const B = await import(pathToFileURL(resolve(upstream, "bend2/bend.ts")));
  const C = await import(pathToFileURL(resolve(upstream, "bend2/comp.ts")));
  const checks = [];
  let runtime;

  for (const entry of ["Kernel.bend", "Runtime.bend"]) {
    const book = B.book_nil();

    try {
      await B.book_load(book, resolve(ROOT, "bend", entry), "", new Map());
      B.book_valid(book);
    } catch (error) {
      throw new Error(error?.$ === "Err" ? B.err_show(error) : String(error));
    }

    const excluded = Object.entries(book.tlds).filter(
      ([, t]) => t.u || t.i || (t.$ === "Def" && t.v === null),
    );

    if (book.hols || excluded.length) throw new Error(`Open/unsafe/foreign code in ${entry}`);
    checks.push({ entry, definitions: Object.keys(book.tlds).length, openObligations: book.hols });

    if (entry === "Runtime.bend") runtime = book;
  }

  const constructors = Object.fromEntries(
    Object.entries(runtime.ctrs).map(([name, c]) => [
      name,
      B.tele_unbind(runtime, c.T)
        .doms.slice(-c.n || Infinity)
        .map(([, k]) => k),
    ]),
  );

  const identity = await sourceIdentity();

  const artifact =
    C.js_lib(runtime, [...roots], [...roots]) +
    '\nexport const artifactFormat = "openerp-bend-js/v1";\n' +
    `export const constructors = ${JSON.stringify(constructors)};\n` +
    `export const buildInfo = ${JSON.stringify({ compilerCommit: BEND_PIN, sourceTreeDigest: identity.digest, definitions: Object.keys(runtime.tlds).length })};\n`;

  const dir = resolve(ROOT, "dist");
  await mkdir(dir, { recursive: true });
  const artifactDigest = await digestBytes(new TextEncoder().encode(artifact));
  await writeFile(resolve(dir, "kernel.mjs"), artifact);

  const build = {
    schema: "openerp-bend-build/v1",
    status: "compiled-not-promoted",
    compilerCommit: BEND_PIN,
    artifactDigest,
    sourceTreeDigest: identity.digest,
    checks,
    sourceFiles: identity.files,
  };

  await writeFile(resolve(dir, "build.json"), JSON.stringify(build, null, 2) + "\n");
  await writeFile(
    resolve(dir, "source-check.json"),
    JSON.stringify(
      {
        schema: "openerp-bend-receipt/v1",
        status: "passed",
        official: true,
        compilerCommit: BEND_PIN,
        artifactDigest,
        sourceTreeDigest: identity.digest,
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Built official JS artifact ${artifactDigest}. It is NOT yet approved for authoritative use.`,
  );

  return build;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, "scripts/build-official.mjs"))
  await buildOfficial();
