import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { digestBytes, digest, array, text, fail } from "../src/contracts.mjs";

/** Load only an explicitly configured, trusted local integration module.
 * No function-body extraction, runtime import deletion or source rewriting.
 */
export async function loadOwnerAdapter() {
  if (!process.env.OPENERP_REPO || !process.env.OPENERP_OWNER_ADAPTER)
    fail(
      "OwnerNotBound",
      "Set OPENERP_REPO and OPENERP_OWNER_ADAPTER to the current worktree integration module",
    );
  const repo = await realpath(process.env.OPENERP_REPO);
  const path = await realpath(resolve(repo, process.env.OPENERP_OWNER_ADAPTER));

  function within(actual) {
    const rel = relative(repo, actual);

    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
      fail("InvalidOwnerAdapter", "Owner source escapes the worktree");

    return rel.replaceAll("\\", "/");
  }

  within(path);

  const adapterBytes = await readFile(path),
    adapter = await import(pathToFileURL(path));

  if (
    adapter.kind !== "openerp-current-owner/v1" ||
    adapter.synthetic === true ||
    typeof adapter.calculate !== "function"
  )
    fail("InvalidOwnerAdapter", "Not a real current-owner adapter");
  array(adapter.sourceFiles, "sourceFiles", 1000, 1);
  const paths = [path];

  for (const name of adapter.sourceFiles) {
    text(name, "source file", 500);

    const actual = await realpath(resolve(repo, name)),
      rel = within(actual);

    if (
      !/^(packages|jurisdictions|apps)\//u.test(rel) ||
      !/\.(ts|mts|js|mjs)$/u.test(rel) ||
      /(?:^|\/)(tests?|fixtures|upstream|archives)(?:\/|$)/u.test(rel)
    )
      fail(
        "InvalidOwnerAdapter",
        "List actual application source files, not archived excerpts or test oracles",
      );
    paths.push(actual);
  }

  if (new Set(paths).size !== paths.length) fail("InvalidOwnerAdapter", "Duplicate source path");

  const hashes = async () => {
    const files = {};

    for (const file of paths.toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0)))
      files[within(file)] = await digestBytes(await readFile(file));

    return { files, ownerTreeDigest: await digest(files) };
  };

  const before = await hashes();

  if (before.files[within(path)] !== (await digestBytes(adapterBytes)))
    fail("OwnerChangedDuringCheck", "Adapter changed while loading");

  return {
    adapter,
    before,
    assertUnchanged: async () => {
      if ((await hashes()).ownerTreeDigest !== before.ownerTreeDigest)
        fail("OwnerChangedDuringCheck", "Owner files changed during verification");
    },
  };
}
