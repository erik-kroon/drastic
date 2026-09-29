// Integration declaration for every `packages/domain` leaf.
//
// A pure calculation leaf with no application consumer is dead code. That is
// sometimes legitimate: a packet's prerequisite owner may not exist yet, or the
// wiring may need authority this repository does not have. It is never
// legitimate to leave it unsaid, because an undeclared leaf reads as delivered
// work while nothing can reach it.
//
// This script is the ratchet. It fails when:
//
//   - a leaf has no declared entry here (the failure this file exists to stop);
//   - an entry claims a consumer that does not exist in this repository;
//   - a declared consumer holds no value import of that exact leaf;
//   - an entry claims an unwired leaf but a consumer appeared (stale claim);
//   - a deferral gives no reason, or a placeholder instead of a reason.
//
// Consumer detection parses real module specifiers with the installed
// TypeScript parser rather than matching substrings, so a comment, a
// similarly prefixed package, an unrelated relative module, a type-only
// import or a test file cannot certify a wire. Tests never count: a
// conformance test proves a contract but no application owner composes it.
//
// A green run is declaration/import consistency, not a verified workflow. An
// import proves source composition only; a separately observed journey is a
// stronger claim and belongs in the test/CI record, not here.
//
// It passes for a leaf that is wired, or deferred with a real reason. Wiring a
// leaf is the goal; this only makes the gap visible and attributed.
//
// Run: `bun run check:integration`

import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

const domainDirectory = join(repositoryRoot, "packages/domain/src");

const declarationPath = join(repositoryRoot, "docs/plans/domain-leaf-integration.json");

// The search roots that can legitimately consume a leaf. A leaf wired only by
// another leaf is still unwired: nothing outside the calculation layer can
// reach it, so the product cannot.
const consumerRoots = [
  "apps",
  "packages/contracts",
  "packages/ui",
  "packages/web",
  "jurisdictions",
];

const placeholderReasons = new Set([
  "tbd",
  "todo",
  "later",
  "n/a",
  "none",
  "unknown",
  "pending",
  "wip",
  "-",
  "?",
]);

type LeafStatus = "wired" | "deferred";

// Built up a property at a time while parsing, then frozen.
type LeafEntry = {
  readonly leaf: string;
  readonly status: LeafStatus;
  // A wired leaf names the modules that consume it. A deferred leaf must not.
  readonly consumers?: ReadonlyArray<string>;
  // A deferred leaf states why it cannot be wired yet and what would change
  // that. An empty or placeholder reason is a failure.
  readonly reason?: string;
  readonly unblockedBy?: string;
};

type Declaration = {
  readonly leaves: ReadonlyArray<LeafEntry>;
};

type CheckProblem = {
  readonly leaf: string;
  readonly problem: string;
};

type MutableLeafEntry = {
  leaf: string;
  status: LeafStatus;
  consumers?: ReadonlyArray<string>;
  reason?: string;
  unblockedBy?: string;
};

// The JSON declaration is external input, so it is parsed with a schema at
// this boundary rather than narrowed by hand. A malformed entry is dropped
// here and reported as a problem by the caller, never trusted.
const RawLeafEntry = Schema.Struct({
  leaf: Schema.String,
  status: Schema.Literals(["wired", "deferred"]),
  consumers: Schema.optional(Schema.Array(Schema.String)),
  reason: Schema.optional(Schema.String),
  unblockedBy: Schema.optional(Schema.String),
});

// `$comment` documents the file for readers; it is not part of the contract.
const DeclarationSchema = Schema.Struct({
  $comment: Schema.optional(Schema.String),
  leaves: Schema.Array(RawLeafEntry),
});

function readDeclaration(): Result.Result<Declaration, string> {
  if (!existsSync(declarationPath)) {
    return Result.fail(`Missing ${relative(repositoryRoot, declarationPath)}.`);
  }

  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(declarationPath, "utf8"));
  } catch (error) {
    return Result.fail(
      `${relative(repositoryRoot, declarationPath)} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const decoded = Schema.decodeUnknownResult(DeclarationSchema)(raw);

  if (Result.isFailure(decoded)) {
    return Result.fail(
      `${relative(repositoryRoot, declarationPath)} is not a valid declaration: ${decoded.failure.message}`,
    );
  }

  const entries: Array<LeafEntry> = [];

  for (const leaf of decoded.success.leaves) {
    const entry: MutableLeafEntry = { leaf: leaf.leaf, status: leaf.status };

    if (leaf.consumers !== undefined) {
      entry.consumers = leaf.consumers;
    }

    if (leaf.reason !== undefined) {
      entry.reason = leaf.reason;
    }

    if (leaf.unblockedBy !== undefined) {
      entry.unblockedBy = leaf.unblockedBy;
    }

    entries.push(entry);
  }

  return Result.succeed({ leaves: entries });
}

function listLeaves(): ReadonlyArray<string> {
  return readdirSync(domainDirectory)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.slice(0, -3))
    .sort();
}

function listSourceFiles(directory: string): ReadonlyArray<string> {
  const found: Array<string> = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listSourceFiles(path));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }

  return found;
}

function consumerSourceFiles(): ReadonlyArray<string> {
  return consumerRoots
    .map((root) => join(repositoryRoot, root))
    .filter((path) => existsSync(path) && statSync(path).isDirectory())
    .flatMap((path) => listSourceFiles(path))
    .filter((path) => !isTestOwned(path));
}

// Conformance and journey tests prove a leaf's contract but do not deliver its
// packet: no application owner composes the leaf. Counting them as consumers
// would mark an unwired leaf wired to make this check pass.
function isTestOwned(path: string): boolean {
  return path.includes("/tests/") || path.endsWith(".test.ts") || path.endsWith(".test.tsx");
}

// Exact module-specifier scanning, done with Bun's own parser. It replaces the
// old substring search, so a comment, a similarly prefixed package, an
// unrelated relative `./leaf` module, a type-only import or a test file can
// no longer certify a wire. `import type` and an all-type named import are
// dropped by the parser, so a schema or type consumer is never counted as
// runtime composition. A sibling leaf's relative import is internal
// composition only and never counts here, because those files are outside the
// consumer roots. Even a real import is source composition, not proof of a
// successful workflow; an observed journey is a separate, stronger claim.
// One scanner per loader, so a `.tsx` module parses as TSX rather than TS.
const scanners = new Map<string, Bun.Transpiler>();

function scannerFor(path: string): Bun.Transpiler {
  const loader = path.endsWith(".tsx") ? "tsx" : "ts";
  const existing = scanners.get(loader);

  if (existing !== undefined) return existing;

  const created = new Bun.Transpiler({ loader });

  scanners.set(loader, created);

  return created;
}

function contentsImportLeaf(contents: string, path: string, leaf: string): boolean {
  const target = `@open-erp/domain/${leaf}`;

  try {
    return scannerFor(path)
      .scanImports(contents)
      .some((entry) => entry.path === target && entry.kind !== "require-call");
  } catch {
    // An unparseable module cannot certify a wire either way.
    return false;
  }
}

function fileValueImportsLeaf(path: string, leaf: string): boolean {
  let contents: string;

  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return false;
  }

  return contentsImportLeaf(contents, path, leaf);
}

function findConsumers(leaf: string, files: ReadonlyArray<string>): ReadonlyArray<string> {
  return files.filter((path) => fileValueImportsLeaf(path, leaf));
}

// A declared consumer names a real path in this repository. A single module
// must hold a runtime import of that exact leaf. A directory claim is broader
// and weaker, so it only holds when at least one real consumer found by the
// exact scan actually lives under it: naming `apps/api` cannot stand in for
// naming the owner, so it proves reachability, not ownership.
function declaredConsumerHolds(
  consumer: string,
  leaf: string,
  found: ReadonlyArray<string>,
): "ok" | "missing" | "no_import" {
  const direct = [
    join(repositoryRoot, consumer),
    join(repositoryRoot, `${consumer}.ts`),
    join(repositoryRoot, `${consumer}.tsx`),
    join(repositoryRoot, consumer, "index.ts"),
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());

  if (direct !== undefined) {
    return fileValueImportsLeaf(direct, leaf) ? "ok" : "no_import";
  }

  const root = join(repositoryRoot, consumer);

  if (!existsSync(root) || !statSync(root).isDirectory()) return "missing";

  return found.some((path) => path === root || path.startsWith(`${root}/`)) ? "ok" : "no_import";
}

// Self-check for the scanning rules, so a future substring regression is caught
// by this ratchet rather than by a future review. These are in-memory fixtures:
// they read no leaf, declare nothing, and cannot make a deferred leaf look
// wired. Each case is one thing a substring search could have got wrong.
const leafUnderTest = "cash-flow-statement";

const selfCheck: ReadonlyArray<SelfCheckCase> = [
  {
    name: "comment only",
    path: "apps/api/src/application/comment-only.ts",
    contents: `// composes @open-erp/domain/${leafUnderTest} for the statement\nexport const value = 1;\n`,
    consumer: false,
  },
  {
    name: "test only",
    path: "apps/api/tests/assurance/cash-flow.conformance.test.ts",
    contents: `import { calculateCashFlow } from "@open-erp/domain/${leafUnderTest}";\nvoid calculateCashFlow;\n`,
    consumer: false,
  },
  {
    name: "type-only import",
    path: "packages/contracts/src/type-only.ts",
    contents: `import type { CashFlowStatement } from "@open-erp/domain/${leafUnderTest}";\nexport type { CashFlowStatement };\n`,
    consumer: false,
  },
  {
    name: "all-type named import",
    path: "packages/contracts/src/named-type-only.ts",
    contents: `import { type CashFlowStatement } from "@open-erp/domain/${leafUnderTest}";\nexport type { CashFlowStatement };\n`,
    consumer: false,
  },
  {
    name: "same-prefix package",
    path: "apps/api/src/application/prefixed.ts",
    contents: `import { calculateCashFlow } from "@open-erp/domain/${leafUnderTest}-extra";\nvoid calculateCashFlow;\n`,
    consumer: false,
  },
  {
    name: "unrelated relative module",
    path: "packages/contracts/src/relative.ts",
    contents: `import { calculateCashFlow } from "./${leafUnderTest}";\nvoid calculateCashFlow;\n`,
    consumer: false,
  },
  {
    name: "valid named owner composition",
    path: "apps/api/src/application/reports/cash-flow-statement.ts",
    contents: `import { calculateCashFlow } from "@open-erp/domain/${leafUnderTest}";\nvoid calculateCashFlow;\n`,
    consumer: true,
  },
];

type SelfCheckCase = {
  readonly name: string;
  readonly path: string;
  readonly contents: string;
  readonly consumer: boolean;
};

function runSelfCheck(selfCheck: ReadonlyArray<SelfCheckCase>): ReadonlyArray<string> {
  const failures: Array<string> = [];

  for (const fixture of selfCheck) {
    const imported = contentsImportLeaf(fixture.contents, fixture.path, leafUnderTest);
    // A test-owned path is excluded from consumers regardless of its import,
    // which is what lets a deferred leaf gain conformance tests honestly.
    const counts = imported && !isTestOwned(fixture.path);

    if (counts !== fixture.consumer) {
      failures.push(
        `${fixture.name}: expected ${fixture.consumer ? "a" : "no"} runtime consumer, got ${counts ? "one" : "none"}`,
      );
    }
  }

  return failures;
}

function check(): number {
  const selfFailures = runSelfCheck(selfCheck);

  if (selfFailures.length > 0) {
    console.error(`Integration checker self-check failed with ${selfFailures.length} case(s):`);

    for (const failure of selfFailures) console.error(`  ${failure}`);

    return 1;
  }

  const declaration = readDeclaration();

  if (Result.isFailure(declaration)) {
    console.error(declaration.failure);

    return 1;
  }

  const leaves = listLeaves();
  const consumers = consumerSourceFiles();
  const declared = new Map<string, LeafEntry>();
  const problems: Array<CheckProblem> = [];

  for (const entry of declaration.success.leaves) {
    if (declared.has(entry.leaf)) {
      problems.push({ leaf: entry.leaf, problem: "declared more than once" });
      continue;
    }

    declared.set(entry.leaf, entry);
  }

  for (const leaf of leaves) {
    const entry = declared.get(leaf);

    if (entry === undefined) {
      problems.push({
        leaf,
        problem:
          "no integration declaration. Wire it to an application owner, or declare it deferred with a real reason and what would unblock it.",
      });
      continue;
    }

    const consumersFound = findConsumers(leaf, consumers);

    if (entry.status === "wired") {
      if (consumersFound.length === 0) {
        problems.push({
          leaf,
          problem: "declared wired, but nothing outside packages/domain value-imports it",
        });
      }

      for (const consumer of entry.consumers ?? []) {
        const verdict = declaredConsumerHolds(consumer, leaf, consumersFound);

        if (verdict === "ok") continue;

        problems.push({
          leaf,
          problem:
            verdict === "missing"
              ? `declared consumer "${consumer}" does not exist in this repository`
              : `declared consumer "${consumer}" holds no runtime import of @open-erp/domain/${leaf}`,
        });
      }

      continue;
    }

    if (consumersFound.length > 0) {
      problems.push({
        leaf,
        problem: `declared deferred, but ${consumersFound.length} consumer(s) exist: ${consumersFound
          .map((path) => relative(repositoryRoot, path))
          .join(", ")}. Wire it and switch the entry to wired.`,
      });
    }

    const reason = entry.reason?.trim() ?? "";

    if (reason.length === 0) {
      problems.push({ leaf, problem: "deferred without a reason" });
    } else if (placeholderReasons.has(reason.toLowerCase())) {
      problems.push({ leaf, problem: `deferred with the placeholder reason "${reason}"` });
    }

    if ((entry.unblockedBy?.trim().length ?? 0) === 0) {
      problems.push({
        leaf,
        problem: "deferred without `unblockedBy` naming what would allow wiring",
      });
    }
  }

  for (const leaf of declared.keys()) {
    if (!leaves.includes(leaf)) {
      problems.push({ leaf, problem: "declared, but no such file in packages/domain/src" });
    }
  }

  const deferred = [...declared.values()].filter((entry) => entry.status === "deferred");
  const wired = [...declared.values()].filter((entry) => entry.status === "wired");

  if (problems.length > 0) {
    console.error(`Integration declaration failed with ${problems.length} problem(s):`);

    for (const problem of problems) {
      console.error(`  ${problem.leaf}: ${problem.problem}`);
    }

    console.error(
      `\nWire the leaf, or record the deferral in ${relative(
        repositoryRoot,
        declarationPath,
      )} with a real reason and what would unblock it.`,
    );

    return 1;
  }

  console.log(
    `Integration declaration passed: ${wired.length} wired, ${deferred.length} declared deferred, ${leaves.length} leaves total.`,
  );

  for (const entry of deferred) {
    console.log(`  deferred: ${entry.leaf} — ${entry.reason}`);
  }

  return 0;
}

process.exitCode = check();
