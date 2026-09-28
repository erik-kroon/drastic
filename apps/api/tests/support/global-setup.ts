import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { createTestHarness } from "wrangler";
import type { TestProject } from "vitest/node";
import type { E2EEnvironment } from "./environment";

const run = promisify(execFile);

const root = resolve(import.meta.dirname, "../../../..");

const sourceRoots = [
  "apps/api",
  "apps/web",
  "packages/contracts",
  "packages/domain",
  "jurisdictions/se",
  "packages/config",
  "config",
  "package.json",
  "bun.lock",
  "vite.config.ts",
  "tsconfig.json",
];

type SourceFile = {
  readonly path: string;
  readonly sha256: string | null;
  readonly tracked: boolean;
};

function missingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function sourceInventory(): Promise<ReadonlyArray<SourceFile>> {
  const tracked = await run("git", ["ls-files", "-z", "--cached", "--", ...sourceRoots], {
    cwd: root,
  });

  const untracked = await run(
    "git",
    ["ls-files", "-z", "--others", "--exclude-standard", "--", ...sourceRoots],
    { cwd: root },
  );

  const trackedPaths = new Set(tracked.stdout.split("\0").filter(Boolean));

  const paths = [
    ...new Set([...trackedPaths, ...untracked.stdout.split("\0").filter(Boolean)]),
  ].sort();

  const files: SourceFile[] = [];

  for (const path of paths) {
    try {
      const absolute = join(root, path);
      const stat = await lstat(absolute);

      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`Source input is not a regular file: ${path}`);

      files.push({
        path,
        sha256: createHash("sha256")
          .update(await readFile(absolute))
          .digest("hex"),
        tracked: trackedPaths.has(path),
      });
    } catch (error) {
      if (!missingFile(error) || !trackedPaths.has(path)) throw error;

      files.push({ path, sha256: null, tracked: true });
    }
  }

  return files;
}

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePort);
  });
  const address = server.address();

  if (address === null || typeof address === "string") throw new Error("No TCP address allocated");
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );

  return address.port;
}

export default async function setup(project: TestProject) {
  const artifacts = join(root, "test-results/e2e");
  const history = join(root, "test-results/e2e-history");
  await mkdir(history, { recursive: true, mode: 0o700 });

  try {
    await rename(
      artifacts,
      join(
        history,
        `${new Date().toISOString().replaceAll(":", "-")}-${randomBytes(4).toString("hex")}`,
      ),
    );
  } catch (error) {
    if (!missingFile(error)) throw error;
  }

  await mkdir(artifacts, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "openerp-e2e-"));
  const pgBin = process.env.PG_BINDIR ?? (await run("pg_config", ["--bindir"])).stdout.trim();
  const data = join(scratch, "pgdata");
  const password = randomBytes(32).toString("hex");
  const passwordFile = join(scratch, "password");
  await writeFile(passwordFile, password, { mode: 0o600 });
  const port = await unusedPort();
  const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const runtimeUrl = `postgresql://e2e_runtime:${password}@127.0.0.1:${port}/postgres`;

  const server = createTestHarness({
    root: join(root, "apps/api"),
    workers: [{ configPath: "wrangler.jsonc", env: "e2e", secrets: { DATABASE_URL: runtimeUrl } }],
  });

  let started = false;
  let sourceFiles: ReadonlyArray<SourceFile> | undefined;

  async function cleanup() {
    try {
      await writeFile(join(artifacts, "worker.json"), JSON.stringify(server.getLogs(), null, 2));

      if (sourceFiles !== undefined) {
        const finalSources = await sourceInventory();
        const stable = JSON.stringify(finalSources) === JSON.stringify(sourceFiles);
        const initialByPath = new Map(sourceFiles.map((file) => [file.path, file]));
        const finalByPath = new Map(finalSources.map((file) => [file.path, file]));

        const changedPaths = [...new Set([...initialByPath.keys(), ...finalByPath.keys()])].filter(
          (path) =>
            JSON.stringify(initialByPath.get(path)) !== JSON.stringify(finalByPath.get(path)),
        );

        await writeFile(
          join(artifacts, "source-integrity.json"),
          JSON.stringify(
            {
              status: stable ? "stable" : "changed_during_run",
              changedPaths,
              sourceInventorySha256: createHash("sha256")
                .update(JSON.stringify(sourceFiles))
                .digest("hex"),
              finalSourceInventorySha256: createHash("sha256")
                .update(JSON.stringify(finalSources))
                .digest("hex"),
              checkedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        );

        if (!stable) {
          // Vitest reports teardown errors separately from test assertions.
          process.exitCode = 1;
          throw new Error(
            `Source inputs changed during the E2E run: ${changedPaths.join(", ")}. Its results are not fixed-revision evidence.`,
          );
        }
      }
    } finally {
      try {
        await server.close();
      } finally {
        if (started)
          await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
        await rm(scratch, { recursive: true, force: true });
      }
    }
  }

  try {
    sourceFiles = await sourceInventory();

    await run(join(pgBin, "initdb"), [
      "-D",
      data,
      "-U",
      "postgres",
      "--auth-host=scram-sha-256",
      "--auth-local=trust",
      `--pwfile=${passwordFile}`,
      "--encoding=UTF8",
      "--no-locale",
    ]);
    await run(join(pgBin, "pg_ctl"), [
      "-D",
      data,
      "-l",
      join(artifacts, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -k ${scratch} -c shared_preload_libraries=pg_stat_statements`,
      "-w",
      "start",
    ]);
    started = true;

    const migration = await run("bun", ["scripts/migrate.ts"], {
      cwd: join(root, "apps/api"),
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
    });

    await writeFile(join(artifacts, "migrations.log"), migration.stdout);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();

    try {
      await admin.query("CREATE EXTENSION pg_stat_statements");
      await admin.query(
        `CREATE ROLE e2e_runtime LOGIN PASSWORD '${password}' IN ROLE openerp_runtime`,
      );
    } finally {
      await admin.end();
    }

    const listening = await server.listen();

    const environment: E2EEnvironment = {
      baseUrl: listening.url.origin,
      adminUrl,
      runtimeUrl,
      artifacts,
      scratch,
    };

    project.provide("e2e", environment);

    const names = (await readdir(join(root, "apps/api/migrations")))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    const migrations = await Promise.all(
      names.map(async (name) => ({
        name,
        sha256: createHash("sha256")
          .update(await readFile(join(root, "apps/api/migrations", name)))
          .digest("hex"),
      })),
    );

    const git = await run("git", ["rev-parse", "HEAD"], { cwd: root });

    const diff = await run("git", ["diff", "--binary", "HEAD"], {
      cwd: root,
      maxBuffer: 20 * 1024 * 1024,
    });

    await writeFile(
      join(artifacts, "manifest.json"),
      JSON.stringify(
        {
          startedAt: new Date().toISOString(),
          revision: git.stdout.trim(),
          worktreeDiffSha256: createHash("sha256").update(diff.stdout).digest("hex"),
          lockSha256: createHash("sha256")
            .update(await readFile(join(root, "bun.lock")))
            .digest("hex"),
          node: process.version,
          postgres: (await run(join(pgBin, "postgres"), ["--version"])).stdout.trim(),
          runner: "Vitest 4.1.10",
          runtime: "local workerd; real PostgreSQL; restricted runtime role",
          sourceRoots,
          sourceFiles,
          sourceInventorySha256: createHash("sha256")
            .update(JSON.stringify(sourceFiles))
            .digest("hex"),
          migrations,
        },
        null,
        2,
      ),
    );

    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
