import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  await rm(artifacts, { recursive: true, force: true });
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
    workers: [{ configPath: "wrangler.jsonc", secrets: { DATABASE_URL: runtimeUrl } }],
  });
  let started = false;
  async function cleanup() {
    try {
      await writeFile(join(artifacts, "worker.json"), JSON.stringify(server.getLogs(), null, 2));
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
      `-h 127.0.0.1 -p ${port} -k ${scratch}`,
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
