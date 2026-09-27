import { readFile, readdir, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runProcess } from "./authority/scripts/process.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

export const kind = "openerp-current-owner/v1";

// Direct imports of public owners; Node needs extensions for bundler-style TS imports.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local =
      context.parentURL?.startsWith(new URL("../../", import.meta.url).href) &&
      !context.parentURL.includes("/node_modules/") &&
      specifier.startsWith(".") &&
      extname(specifier) === "";

    return nextResolve(local ? specifier + ".ts" : specifier, context);
  },
});

let monetary;

try {
  monetary = (await import("../../jurisdictions/se/src/vat/actual.ts")).actualVatMonetary;
} finally {
  hooks.deregister();
}

export const sourceFiles = [];

for (const directory of [
  "jurisdictions/se/src",
  "packages/domain/src",
  "packages/contracts/src",
  "apps/api/src",
]) {
  for (const name of await readdir(resolve(root, directory), { recursive: true })) {
    if (name.endsWith(".ts")) sourceFiles.push(`${directory}/${name}`);
  }
}

sourceFiles.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function calculate(operation, input) {
  if (operation === "money.round.v1") {
    const numerator = BigInt(input.numerator);
    const denominator = BigInt(input.denominator);
    const rounded = monetary.round(numerator, denominator, input.rounding);

    if (rounded === null) throw new Error("The current rounding owner refused this input");

    return {
      roundedMinor: String(rounded),
      residualNumerator: String(numerator - rounded * denominator),
      denominator: input.denominator,
    };
  }

  if (operation === "vat.project.v1") return { rows: monetary.project(input) };

  throw new Error(`Owner comparison does not cover ${operation}`);
}

export async function verifyHost(options) {
  const harnessFiles = [
    "apps/api/tests/bend-vat.qualification.test.ts",
    "apps/api/tests/support/bend-vat-host.mjs",
    "apps/api/tests/support/global-setup.ts",
    "apps/api/tests/support/fixtures.ts",
    "verification/bend/authority/vite.host.config.mts",
    "bun.lock",
  ];

  const harnessSourceHashes = {};

  for (const file of harnessFiles) {
    harnessSourceHashes[file] = createHash("sha256")
      .update(await readFile(resolve(root, file)))
      .digest("hex");
  }

  const result = await runProcess(
    "bun",
    ["run", "test:e2e", "--config", "verification/bend/authority/vite.host.config.mts"],
    {
      cwd: root,
      timeoutMs: 150000,
      env: {
        ...process.env,
        OPENERP_BEND_ARTIFACT: resolve(root, "verification/bend/authority/dist/kernel.mjs"),
        OPENERP_BEND_ARTIFACT_DIGEST: options.artifactDigest,
        OPENERP_BEND_SOURCE_DIGEST: options.sourceTreeDigest,
      },
    },
  );

  await writeFile(
    resolve(root, "verification/bend/authority/evidence/current/host-process.json"),
    JSON.stringify(result, null, 2) + "\n",
  );

  if (!result.passed)
    throw new Error(`Real host qualification failed: ${result.stderr}\n${result.stdout}`);

  const report = JSON.parse(
    await readFile(resolve(root, "test-results/e2e/bend-host.json"), "utf8"),
  );

  if (
    report.artifactDigest !== options.artifactDigest ||
    report.sourceTreeDigest !== options.sourceTreeDigest
  )
    throw new Error("Host tested a different artifact");

  report.e2eManifest = JSON.parse(
    await readFile(resolve(root, "test-results/e2e/manifest.json"), "utf8"),
  );

  for (const file of harnessFiles) {
    const after = createHash("sha256")
      .update(await readFile(resolve(root, file)))
      .digest("hex");

    if (after !== harnessSourceHashes[file]) throw new Error(`Host harness changed: ${file}`);
  }

  report.harnessSourceHashes = harnessSourceHashes;

  return report;
}
