import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

const args = process.argv.slice(2);

const typeAware = args.includes("--type-aware");

const baseRef = args.find((arg) => arg !== "--type-aware") ?? "HEAD";

const binDirectory = path.join(repoRoot, "node_modules", ".bin");

const temporaryConfigName = "tsconfig.changed.json";

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

const toolExtensions = new Set([...sourceExtensions, ".js", ".jsx", ".mjs", ".cjs"]);

const gitLines = (...args: Array<string>) =>
  Bun.spawnSync(["git", ...args], { cwd: repoRoot })
    .stdout.toString()
    .split("\n");

const isIgnoredPath = (relativePath: string) =>
  relativePath.split("/").some((segment) => segment.startsWith(".") || segment === "node_modules");

const nearestProjectConfig = (relativePath: string) => {
  const segments = path.dirname(relativePath).split("/");

  for (let depth = segments.length; depth > 0; depth -= 1) {
    const candidate = path.join(...segments.slice(0, depth), "tsconfig.json");

    if (existsSync(path.join(repoRoot, candidate))) {
      return candidate;
    }
  }

  return null;
};

const changedFiles = [
  ...gitLines("diff", "--name-only", "--diff-filter=d", baseRef),
  ...gitLines("ls-files", "--others", "--exclude-standard"),
];

const toolFiles = changedFiles
  .map((line) => line.trim())
  .filter((file) => file !== "")
  .filter((file) => !isIgnoredPath(file) && existsSync(path.join(repoRoot, file)))
  .filter((file) => toolExtensions.has(path.extname(file)));

if (toolFiles.length === 0) {
  console.log(`No changed source files against ${baseRef}. Nothing to check.`);
  process.exit(0);
}

const typeCheckGroups = new Map<string, Array<string>>();

const filesWithoutProject: Array<string> = [];

for (const file of toolFiles) {
  if (!sourceExtensions.has(path.extname(file))) {
    continue;
  }

  const projectConfig = nearestProjectConfig(file);

  if (projectConfig === null) {
    filesWithoutProject.push(file);

    continue;
  }

  const group = typeCheckGroups.get(projectConfig) ?? [];

  group.push(file);
  typeCheckGroups.set(projectConfig, group);
}

console.log(`Checking ${toolFiles.length} changed file(s) against ${baseRef}:`);

for (const file of [...toolFiles].sort()) {
  console.log(`  ${file}`);
}

const failures: Array<string> = [];

const run = async (label: string, tool: string, args: Array<string>) => {
  const started = performance.now();

  console.log(`\n${label}`);

  const exitCode = await Bun.spawn([process.execPath, path.join(binDirectory, tool), ...args], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  }).exited;

  console.log(`${label}: ${((performance.now() - started) / 1000).toFixed(2)}s`);

  if (exitCode !== 0) {
    failures.push(label);
  }
};

const typeCheckProject = async (projectConfig: string, files: Array<string>) => {
  const projectDirectory = path.dirname(projectConfig);
  const temporaryConfig = path.join(projectDirectory, temporaryConfigName);

  const scopedConfig = {
    extends: `./${path.relative(projectDirectory, projectConfig)}`,
    include: [],
    files: files.map((file) => path.relative(projectDirectory, file)),
  };

  writeFileSync(temporaryConfig, `${JSON.stringify(scopedConfig, undefined, 2)}\n`);

  try {
    await run(`tsc --noEmit (${projectConfig})`, "tsc", [
      "--noEmit",
      "--incremental",
      "--tsBuildInfoFile",
      path.join(projectDirectory, "tsconfig.changed.tsbuildinfo"),
      "--project",
      temporaryConfig,
    ]);
  } finally {
    rmSync(temporaryConfig, { force: true });
  }
};

// Finish writes before readers start, then run the independent checks together.
await run("oxfmt --write", "oxfmt", ["--write", ...toolFiles]);

await Promise.all([
  run(typeAware ? "oxlint (type-aware)" : "oxlint", "oxlint", [
    "--config",
    typeAware ? ".oxlintrc.type-aware.json" : ".oxlintrc.json",
    ...toolFiles,
  ]),
  ...[...typeCheckGroups].map(([projectConfig, files]) => typeCheckProject(projectConfig, files)),
]);

if (filesWithoutProject.length > 0) {
  console.log(
    `\nNo tsconfig.json covers ${filesWithoutProject.join(", ")}. Linted and formatted only.`,
  );
}

if (failures.length > 0) {
  console.error(`\ncheck:changed failed: ${failures.join("; ")}`);
  process.exit(1);
}

console.log("\ncheck:changed passed.");
