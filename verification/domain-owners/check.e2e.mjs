import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");

const sourcePath = resolve(root, process.argv[2] ?? "scripts/check-owners.ts");

const source = await readFile(sourcePath);

const output = resolve(
  root,
  process.env.DOMAIN_OWNER_CHECK_ARTIFACTS ?? "test-results/domain-owner-check",
);

const wired = { leaf: "amounts", status: "wired", consumers: ["apps/api/src/owner.ts"] };

const importCode =
  'import { amount } from "@open-erp/domain/amounts"; export const observed = amount;';

const cases = [
  { name: "wired-owner", leaves: [wired], code: importCode, expected: 0 },
  {
    name: "empty-consumer-name",
    leaves: [{ ...wired, consumers: [""] }],
    code: importCode,
    expected: 1,
  },
  {
    name: "ancestor-consumer",
    leaves: [{ ...wired, consumers: ["."] }],
    code: importCode,
    expected: 1,
  },
  {
    name: "test-sidecar-refused",
    leaves: [{ ...wired, consumers: ["apps/api/tests/owner.e2e.test.ts"] }],
    code: importCode,
    testSidecar: true,
    expected: 1,
  },
  {
    name: "deferral-refused",
    leaves: [
      {
        leaf: "amounts",
        status: "deferred",
        reason: "No application owner",
        unblockedBy: "Implement an application owner",
      },
    ],
    code: "",
    expected: 1,
  },
  { name: "undeclared-leaf", leaves: [], code: importCode, expected: 1 },
  { name: "duplicate-declaration", leaves: [wired, wired], code: importCode, expected: 1 },
  {
    name: "missing-consumer",
    leaves: [{ ...wired, consumers: ["apps/api/src/missing.ts"] }],
    code: importCode,
    expected: 1,
  },
  {
    name: "missing-consumer-names",
    leaves: [{ leaf: "amounts", status: "wired" }],
    code: importCode,
    expected: 1,
  },
  { name: "comment-refused", leaves: [wired], code: `// ${importCode}`, expected: 1 },
  {
    name: "type-only-refused",
    leaves: [wired],
    code: 'import type { Amount } from "@open-erp/domain/amounts"; export type Retained = Amount;',
    expected: 1,
  },
  {
    name: "test-only-refused",
    leaves: [{ ...wired, consumers: ["apps/api/tests/owner.e2e.test.ts"] }],
    code: importCode,
    testOnly: true,
    expected: 1,
  },
];

await mkdir(output, { recursive: true });

const results = [];

for (const fixture of cases) {
  const directory = await mkdtemp(join(tmpdir(), "openerp-owner-check-"));

  try {
    for (const path of [
      "scripts",
      "docs/plans",
      "packages/domain/src",
      "apps/api/src",
      "apps/api/tests",
    ])
      await mkdir(join(directory, path), { recursive: true });
    await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    await writeFile(join(directory, "scripts/check-owners.ts"), source);
    await writeFile(
      join(directory, "packages/domain/src/amounts.ts"),
      "export const amount = 1;\n",
    );
    await writeFile(
      join(directory, "docs/plans/domain-leaf-integration.json"),
      JSON.stringify({ leaves: fixture.leaves }),
    );
    await writeFile(
      join(
        directory,
        fixture.testOnly ? "apps/api/tests/owner.e2e.test.ts" : "apps/api/src/owner.ts",
      ),
      fixture.code,
    );

    if (fixture.testSidecar)
      await writeFile(join(directory, "apps/api/tests/owner.e2e.test.ts"), fixture.code);

    const run = spawnSync("bun", ["scripts/check-owners.ts"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 30000,
    });

    results.push({
      name: fixture.name,
      expected: fixture.expected,
      observed: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      error: run.error?.message,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const receipt = {
  publicSurface: "ownership CLI",
  sourcePath: sourcePath.slice(root.length + 1),
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  results,
};

await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");

for (const result of results) assert.equal(result.observed, result.expected, result.name);

console.info(`${results.length} public ownership CLI cases passed`);
