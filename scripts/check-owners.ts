import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

const domainDirectory = join(repositoryRoot, "packages/domain/src");

const declarationPath = join(repositoryRoot, "docs/plans/domain-leaf-integration.json");

const consumerRoots = [
  "apps",
  "packages/contracts",
  "packages/ui",
  "packages/web",
  "jurisdictions",
];

type LeafEntry = typeof RawLeafEntry.Type;

type Declaration = {
  readonly leaves: ReadonlyArray<LeafEntry>;
};

type CheckProblem = {
  readonly leaf: string;
  readonly problem: string;
};

const RawLeafEntry = Schema.Struct({
  leaf: Schema.String,
  status: Schema.Literal("wired"),
  consumers: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
});

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

  return Result.succeed({ leaves: decoded.success.leaves });
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

function isTestOwned(path: string): boolean {
  return path.includes("/tests/") || path.endsWith(".test.ts") || path.endsWith(".test.tsx");
}

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

function declaredConsumerHolds(
  consumer: string,
  found: ReadonlyArray<string>,
): "ok" | "missing" | "no_import" {
  const root = resolve(repositoryRoot, consumer);
  const local = relative(repositoryRoot, root);

  if (
    consumer.trim().length === 0 ||
    isAbsolute(consumer) ||
    !consumerRoots.some((allowed) => local === allowed || local.startsWith(`${allowed}/`))
  )
    return "no_import";

  const direct = [root, `${root}.ts`, `${root}.tsx`, join(root, "index.ts")].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );

  if (direct !== undefined) {
    return found.includes(direct) ? "ok" : "no_import";
  }

  if (!existsSync(root) || !statSync(root).isDirectory()) return "missing";

  return found.some((path) => path === root || path.startsWith(`${root}/`)) ? "ok" : "no_import";
}

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
    console.error(`Ownership checker self-check failed with ${selfFailures.length} case(s):`);

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
        problem: "no ownership declaration. Wire it to an application owner and name its consumer.",
      });
      continue;
    }

    const consumersFound = findConsumers(leaf, consumers);

    if (consumersFound.length === 0) {
      problems.push({
        leaf,
        problem: "declared wired, but nothing outside packages/domain value-imports it",
      });
    }

    for (const consumer of entry.consumers) {
      const verdict = declaredConsumerHolds(consumer, consumersFound);

      if (verdict === "ok") continue;

      problems.push({
        leaf,
        problem:
          verdict === "missing"
            ? `declared consumer "${consumer}" does not exist in this repository`
            : `declared consumer "${consumer}" holds no runtime import of @open-erp/domain/${leaf}`,
      });
    }
  }

  for (const leaf of declared.keys()) {
    if (!leaves.includes(leaf)) {
      problems.push({ leaf, problem: "declared, but no such file in packages/domain/src" });
    }
  }

  if (problems.length > 0) {
    console.error(`Ownership declaration failed with ${problems.length} problem(s):`);

    for (const problem of problems) {
      console.error(`  ${problem.leaf}: ${problem.problem}`);
    }

    console.error(
      `\nWire every leaf and retain its consumer in ${relative(repositoryRoot, declarationPath)}.`,
    );

    return 1;
  }

  console.log(
    `Ownership declaration passed: ${declared.size} wired, ${leaves.length} leaves total; deferrals are forbidden.`,
  );

  return 0;
}

process.exitCode = check();
