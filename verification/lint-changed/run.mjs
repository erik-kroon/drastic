import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const sandbox = mkdtempSync(path.join(tmpdir(), "openerp-lint-proof-"));

const results = [];

function command(executable, args) {
  const result = spawnSync(executable, args, { cwd: sandbox, encoding: "utf8", timeout: 60_000 });

  if (result.error) throw result.error;

  return { status: result.status, output: result.stdout + result.stderr };
}

function git(...args) {
  const result = command("git", args);

  assert.equal(result.status, 0, result.output);

  return result.output.trim();
}

function check(name, base, expected, diagnostic) {
  const before = readFileSync(path.join(sandbox, "fixture.js"), "utf8");

  const result = command("bun", ["run", "lint:changed", base]);

  results.push({
    name,
    expectedStatus: expected,
    passed: result.status === expected && (!diagnostic || result.output.includes(diagnostic)),
    ...result,
    fixtureSha256: createHash("sha256").update(before).digest("hex"),
  });
  assert.equal(result.status, expected, `${name}: ${result.output}`);

  if (diagnostic) assert.ok(result.output.includes(diagnostic), `${name}: ${result.output}`);

  assert.equal(
    readFileSync(path.join(sandbox, "fixture.js"), "utf8"),
    before,
    "Lint rewrote input",
  );
}

try {
  mkdirSync(path.join(sandbox, "scripts"));
  cpSync(
    path.join(root, "scripts/check-changed.ts"),
    path.join(sandbox, "scripts/check-changed.ts"),
  );
  cpSync(path.join(root, "config"), path.join(sandbox, "config"), { recursive: true });

  for (const filename of [
    ".oxlintrc.json",
    ".oxlintrc.changed.json",
    ".oxlintrc.type-aware.json",
    "package.json",
  ]) {
    cpSync(path.join(root, filename), path.join(sandbox, filename));
  }

  symlinkSync(path.join(root, "node_modules"), path.join(sandbox, "node_modules"));
  writeFileSync(path.join(sandbox, ".gitignore"), "node_modules\n");
  git("init", "--quiet");
  git("config", "user.email", "lint-proof@example.invalid");
  git("config", "user.name", "Synthetic lint proof");
  writeFileSync(path.join(sandbox, "fixture.js"), 'export const initial = "clean";\n');
  writeFileSync(path.join(sandbox, "legacy.js"), "export const legacy = 1 == 1;\n");

  const config = JSON.parse(readFileSync(path.join(sandbox, ".oxlintrc.json"), "utf8"));

  config.rules.eqeqeq = "warn";
  writeFileSync(path.join(sandbox, ".oxlintrc.json"), JSON.stringify(config));
  git("add", ".");
  git("commit", "--quiet", "-m", "Synthetic baseline");

  const base = git("rev-parse", "HEAD");

  writeFileSync(path.join(sandbox, "fixture.js"), 'export const initial = "changed";\n');
  writeFileSync(path.join(sandbox, "space name.js"), "export const spaced = true;\n");
  check(
    "clean change leaves legacy warnings untouched and checks spaces",
    base,
    0,
    "space name.js",
  );
  writeFileSync(
    path.join(sandbox, "legacy.js"),
    "export const legacy = 1 == 1;\n\nexport const touched = true;\n",
  );
  check("existing warning in touched file", base, 1, "eqeqeq");
  git("restore", "legacy.js");
  writeFileSync(path.join(sandbox, "fixture.js"), "export const warning = 1 == 1;\n");
  git("add", "fixture.js");
  git("commit", "--quiet", "-m", "Synthetic branch warning");
  check("committed warning compared with branch base", base, 1, "eqeqeq");
  writeFileSync(path.join(sandbox, "fixture.js"), "export const clean = true;\n");
  writeFileSync(path.join(sandbox, "untracked.js"), "export const warning = 1 == 1;\n");
  check("untracked warning", base, 1, "eqeqeq");
  rmSync(path.join(sandbox, "untracked.js"));

  const forbidden = [
    ["no-manual-tag-comparison", 'export const branch = (value) => value._tag === "Ready";\n'],
    ["no-manual-tagged-construction", 'export const value = { _tag: "Ready" };\n'],
    [
      "no-manual-effect-error-tag",
      'import { Effect } from "effect";\n\nexport const recover = Effect.catch((error) => error._tag === "Missing" ? Effect.void : Effect.fail(error));\n',
    ],
    [
      "no-service-constructor-imports",
      'import { makeService } from "./service.js";\n\nexport const service = makeService;\n',
    ],
    [
      "prefer-effect-match",
      'export const label = (kind) => kind === "a" ? "A" : kind === "b" ? "B" : "Other";\n',
    ],
  ];

  for (const [rule, source] of forbidden) {
    writeFileSync(path.join(sandbox, "fixture.js"), source);
    check(rule, base, 1, rule);
  }

  writeFileSync(
    path.join(sandbox, "fixture.js"),
    'import { Data, Effect, Match, Predicate } from "effect";\n\nexport const ready = Data.tagged("Ready")({ value: 1 });\n\nexport const isReady = Predicate.isTagged("Ready");\n\nexport const label = (value) => Match.value(value).pipe(Match.tag("Ready", () => "ready"), Match.orElse(() => "other"));\n\nexport const recover = Effect.catchTag("Missing", () => Effect.void);\n',
  );
  check("supported Effect patterns", base, 0);
  check("invalid base", "missing-base-revision", 1, "missing-base-revision");
} finally {
  const directory = path.join(root, "test-results/lint-changed");

  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "results.json"), `${JSON.stringify({ results }, null, 2)}\n`);
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(
  `Passed ${results.length} real-command lint scenarios. Evidence: test-results/lint-changed/results.json`,
);
