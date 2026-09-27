import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { readArchivedSource } from "./archived-source.mjs";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export const BEND_PIN = "af569d4826913b2ce3557e9829ccad31fcf86f94";

export const CHECKER_BLOB = "c38e9e203530568b500dfc34785372d427706a6c";

export async function loadEngine(entry = resolve(ROOT, "bend/Kernel.bend")) {
  const external = process.env.BEND_SOURCE_ROOT;
  const directory = external ? null : await mkdtemp(resolve(tmpdir(), "bend-checker-"));

  const file = external ? resolve(external, "bend2/bend.ts") : resolve(directory, "dev-checker.ts");

  try {
    if (external) {
      const bytes = await readFile(file);
      const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

      if (blob !== CHECKER_BLOB)
        throw new Error(`Bend checker pin mismatch: ${blob}. Expected ${CHECKER_BLOB}.`);
    } else {
      const source = await readArchivedSource(
        new URL("../tooling/dev-checker.ts.gz", import.meta.url),
        "fb8d4f6981ea88631dfe3f67f0ae166fb232e56fbe66060b325f1fe13e9a296f",
      );

      await writeFile(file, source);
      await writeFile(
        resolve(directory, "base.bend"),
        await readFile(resolve(ROOT, "tooling/base.bend")),
      );
    }

    const B = await import(pathToFileURL(file));
    const book = B.book_nil();

    try {
      await B.book_load(book, entry, "", new Map());
      B.book_valid(book);

      if (book.hols !== 0) throw new Error(`Open proof obligations: ${book.hols}`);

      const unsafe = Object.entries(book.tlds).filter(
        ([, d]) => d.u || d.i || (d.$ === "Def" && d.v === null),
      );

      if (unsafe.length)
        throw new Error(`Unsupported proof assumptions: ${unsafe.map(([n]) => n).join(", ")}`);
    } catch (e) {
      throw new Error(e?.$ === "Err" ? B.err_show(e) : String(e));
    }

    const force = (value) => B.term_wnf(book, value);
    const call = (name, ...args) => force(args.reduce((f, a) => B.App(f, a), B.Ref(name)));
    const c = (name, ...fields) => B.Ctr(name, fields);

    const nat = (n) => {
      if (typeof n !== "bigint" || n < 0n) throw new TypeError("nat requires nonnegative bigint");
      const bits = [];

      for (let x = n; x > 0n; x >>= 1n) bits.push(x & 1n);
      let t = c("BigNat.Zero");

      for (let i = bits.length - 1; i >= 0; i--) t = c(bits[i] ? "BigNat.Odd" : "BigNat.Even", t);

      return t;
    };

    const fromNat = (term) => {
      let t = term,
        value = 0n,
        shift = 0n;

      for (;;) {
        const x = force(t);

        if (x.k === "BigNat.Zero") return value;

        if (x.k !== "BigNat.Even" && x.k !== "BigNat.Odd") throw new Error(`Not BigNat: ${x.k}`);

        if (x.k === "BigNat.Odd") value |= 1n << shift;
        shift++;
        t = x.x[0];

        if (shift > 16384n) throw new Error("Decoded integer exceeds safety bound");
      }
    };

    const flag = (b) => c(b ? "Foundation.Yes" : "Foundation.No");
    const integer = (n) => c("BigInt.Integer", flag(n < 0n), nat(n < 0n ? -n : n));

    const fromInteger = (term) => {
      const x = force(term);

      if (x.k !== "BigInt.Integer") throw new Error(`Not BigInt: ${x.k}`);

      return (force(x.x[0]).k === "Foundation.Yes" ? -1n : 1n) * fromNat(x.x[1]);
    };

    const count = (n) => {
      if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000) throw new RangeError("Invalid count");
      let x = c("Foundation.Stop");

      for (let i = 0; i < n; i++) x = c("Foundation.Tick", x);

      return x;
    };

    const fromCount = (term) => {
      let n = 0,
        t = term;

      for (;;) {
        const x = force(t);

        if (x.k === "Foundation.Stop") return n;

        if (x.k !== "Foundation.Tick" || n++ >= 1_000_000) throw new Error("Invalid count");
        t = x.x[0];
      }
    };

    return {
      B,
      book,
      force,
      call,
      c,
      nat,
      fromNat,
      flag,
      integer,
      fromInteger,
      count,
      fromCount,
      authority: external ? "pinned-upstream-source" : "development-adaptation",
      definitions: Object.keys(book.tlds).length,
    };
  } finally {
    if (directory !== null) await rm(directory, { recursive: true, force: true });
  }
}
