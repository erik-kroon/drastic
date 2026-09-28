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
//   - an entry claims a consumer that does not exist;
//   - an entry claims an unwired leaf but a consumer appeared (stale claim);
//   - a deferral gives no reason, or a placeholder instead of a reason.
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
    .flatMap((path) => listSourceFiles(path));
}

// A leaf counts as consumed when something outside `packages/domain` imports
// it by its package export path, or a sibling leaf's relative import counts as
// internal composition only.
function findConsumers(leaf: string, files: ReadonlyArray<string>): ReadonlyArray<string> {
  const packageImport = `@open-erp/domain/${leaf}`;

  return files.filter((path) => {
    const contents = readFileSync(path, "utf8");

    return (
      contents.includes(packageImport) ||
      contents.includes(`from "./${leaf}"`) ||
      contents.includes(`from './${leaf}'`)
    );
  });
}

function check(): number {
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
          problem: "declared wired, but nothing outside packages/domain imports it",
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
