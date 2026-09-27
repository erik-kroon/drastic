import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

const args = process.argv.slice(2);

const typeAware = args.includes("--type-aware");

const baseRef = args.find((arg) => arg !== "--type-aware") ?? "HEAD";

const binDirectory = path.join(repoRoot, "node_modules", ".bin");

const temporaryConfigName = "tsconfig.changed.json";

const toolThreads = "2";

const timeoutSeconds = Number(process.env.CHECK_CHANGED_TIMEOUT_SECONDS ?? "60");

if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 2_147_483) {
  throw new Error("CHECK_CHANGED_TIMEOUT_SECONDS must be a positive integer below 2147484.");
}

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

const processGroups = new Set<number>();

const temporaryConfigs = new Set<string>();

const killProcessGroup = (pid: number) => {
  try {
    // Kill the launcher and native descendants, including tools that ignore SIGTERM.
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
};

process.once("SIGINT", () => process.exit(130));

process.once("SIGTERM", () => process.exit(143));

process.once("exit", () => {
  for (const pid of processGroups) {
    killProcessGroup(pid);
  }

  for (const config of temporaryConfigs) {
    rmSync(config, { force: true });
  }
});

const run = async (label: string, tool: string, args: Array<string>) => {
  const started = performance.now();

  console.log(`\n${label}`);

  const child = Bun.spawn([process.execPath, path.join(binDirectory, tool), ...args], {
    cwd: repoRoot,
    env: { ...process.env, GOMAXPROCS: toolThreads },
    detached: true,
    stdout: "inherit",
    stderr: "inherit",
  });

  processGroups.add(child.pid);

  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    console.error(
      `\n${label} timed out after ${timeoutSeconds}s; stopping process group ${child.pid}.`,
    );
    killProcessGroup(child.pid);
  }, timeoutSeconds * 1000);

  try {
    const exitCode = await child.exited;

    if (timedOut || exitCode !== 0) {
      failures.push(label);
    }
  } finally {
    clearTimeout(timeout);
    killProcessGroup(child.pid);
    processGroups.delete(child.pid);
  }

  console.log(`${label}: ${((performance.now() - started) / 1000).toFixed(2)}s`);
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
  temporaryConfigs.add(temporaryConfig);

  try {
    await run(`tsc --noEmit (${projectConfig})`, "tsc", [
      "--noEmit",
      "--checkers",
      toolThreads,
      "--incremental",
      "--tsBuildInfoFile",
      path.join(projectDirectory, "tsconfig.changed.tsbuildinfo"),
      "--project",
      temporaryConfig,
    ]);
  } finally {
    rmSync(temporaryConfig, { force: true });
    temporaryConfigs.delete(temporaryConfig);
  }
};

// Bound both tool overlap and native worker pools so agents can share the machine.
await run("oxfmt --write", "oxfmt", ["--threads", toolThreads, "--write", ...toolFiles]);

await run(typeAware ? "oxlint (type-aware)" : "oxlint", "oxlint", [
  "--threads",
  toolThreads,
  "--config",
  typeAware ? ".oxlintrc.type-aware.json" : ".oxlintrc.json",
  ...toolFiles,
]);

for (const [projectConfig, files] of typeCheckGroups) {
  await typeCheckProject(projectConfig, files);
}

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
