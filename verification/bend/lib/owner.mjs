import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readArchivedSource } from "./archived-source.mjs";

export const FLOOR_BEFORE = ': mode === "floor"\n        ? negative\n';

export const FLOOR_AFTER = ': mode === "floor"\n        ? negative && remainder !== 0n\n';

export async function loadVatOwner({ repoRoot, patchInMemory = false } = {}) {
  const sourceHashes = {};
  const ownerPath = repoRoot && resolve(repoRoot, "jurisdictions/se/src/vat/actual.ts");

  let source = ownerPath
    ? await readFile(ownerPath, "utf8")
    : await readArchivedSource(
        new URL("../upstream/vat-monetary-slice.ts.gz", import.meta.url),
        "fe7399e88b1fe15f6bbed135f29ce37f1c1b99961395430716fe636ff3c78f6f",
      );

  if (patchInMemory) {
    if (repoRoot || !source.includes(FLOOR_BEFORE))
      throw new Error("Only the pinned historical excerpt may be patched in memory.");

    source = source.replace(FLOOR_BEFORE, FLOOR_AFTER);
  }

  if (repoRoot) {
    sourceHashes[relative(repoRoot, ownerPath)] = createHash("sha256").update(source).digest("hex");
    source += "\nexport {round, taxed, reportedIn, boxRows};\n";
  }

  let js = stripTypeScriptTypes(source, { mode: "strip" });
  const reviewedImport = 'import { roundRational } from "@open-erp/domain/purchasing";';

  if (repoRoot) {
    if (!js.includes(reviewedImport))
      throw new Error("Expected the reviewed shared VAT rounding import.");

    js = js.replace(reviewedImport, "");
  }

  if (/^\s*import\s/m.test(js)) throw new Error("Unreviewed runtime import in VAT owner.");

  if (!repoRoot) return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

  const domainUrl = pathToFileURL(resolve(repoRoot, "packages/domain/src/") + "/").href;

  js = `import { roundRational } from ${JSON.stringify(new URL("purchasing.ts", domainUrl).href)};\n${js}`;

  // Node needs explicit .ts extensions for the domain's existing Bun/bundler imports.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const localImport =
        context.parentURL?.startsWith(domainUrl) &&
        specifier.startsWith(".") &&
        extname(specifier) === "";

      const result = nextResolve(localImport ? specifier + ".ts" : specifier, context);

      if (result.url.startsWith(domainUrl)) {
        const file = fileURLToPath(result.url);

        sourceHashes[relative(repoRoot, file)] = createHash("sha256")
          .update(readFileSync(file))
          .digest("hex");
      }

      return result;
    },
  });

  try {
    const owner = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

    sourceHashes["bun.lock"] = createHash("sha256")
      .update(await readFile(resolve(repoRoot, "bun.lock")))
      .digest("hex");

    return { ...owner, sourceHashes };
  } finally {
    hooks.deregister();
  }
}
