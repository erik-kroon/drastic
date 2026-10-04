import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import { decoded, environment, fixture, request } from "./support/fixtures";

const Manifest = Schema.Struct({
  revision: Schema.String,
  sourceInventorySha256: Schema.String,
  sourceRoots: Schema.Array(Schema.String),
  sourceFiles: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      sha256: Schema.NullOr(Schema.String),
      tracked: Schema.Boolean,
    }),
  ),
  runtime: Schema.String,
});

test("the real Worker run binds tracked and untracked source bytes in its manifest", async () => {
  const book = await fixture();
  const setup = await decoded(await request(book, "/setup"), Accounting.BookSetup);
  expect(setup.accounts.some((account) => account.id === "account_bank")).toBe(true);

  const manifest = Schema.decodeSync(Schema.fromJsonString(Manifest))(
    await readFile(join(environment().artifacts, "manifest.json"), "utf8"),
  );

  const root = resolve(import.meta.dirname, "../../..");

  for (const path of [
    "apps/api/tests/evidence-manifest.e2e.test.ts",
    "apps/api/src/transport/mcp.ts",
    "apps/api/src/application/capabilities/agent-policy.ts",
    "packages/contracts/src/reconciliation.ts",
    "bun.lock",
    "patches/effect-mq@0.7.0.patch",
  ]) {
    const retained = manifest.sourceFiles.find((file) => file.path === path);

    const hash = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");

    expect(retained?.sha256, path).toBe(hash);
  }

  expect(manifest.sourceFiles.map((file) => file.path)).toEqual(
    [...new Set(manifest.sourceFiles.map((file) => file.path))].sort(),
  );
  expect(manifest.sourceInventorySha256).toBe(
    createHash("sha256").update(JSON.stringify(manifest.sourceFiles)).digest("hex"),
  );
  expect(manifest.runtime).toContain("real PostgreSQL");
});
