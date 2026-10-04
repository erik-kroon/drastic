import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { payrollAccounts, seedPayroll } from "./seed-payroll.mjs";

const root = resolve(import.meta.dirname, "../..");

const api = join(root, "apps/api");

const requireApi = createRequire(join(api, "package.json"));

const { Client } = requireApi("pg");

const { createTestHarness } = requireApi("wrangler");

const run = promisify(execFile);

const artifacts = join(root, "test-results/paper");

await mkdir(artifacts, { recursive: true });

const pgBin = process.env.PG_BINDIR ?? (await run("pg_config", ["--bindir"])).stdout.trim();

const databaseName = process.env.PAPER_DATABASE ?? "postgres";

if (!/^(postgres|openerp_ops_source_[a-z0-9_]{1,40})$/.test(databaseName))
  throw new Error(
    "Use a dedicated synthetic operational database or the default disposable database.",
  );

const webPortText = process.env.PAPER_PORT ?? "3000";

const webPort = Number(webPortText);

const payrollHook = process.env.PAPER_PAYROLL;

const onboardingHook = process.env.PAPER_ONBOARDING;

if (onboardingHook !== undefined && onboardingHook !== "0" && onboardingHook !== "1")
  throw new Error("PAPER_ONBOARDING must be 0 or 1");

if (payrollHook !== undefined && payrollHook !== "0" && payrollHook !== "1")
  throw new Error("PAPER_PAYROLL must be 0 or 1");

if (
  !/^[0-9]+$/.test(webPortText) ||
  !Number.isInteger(webPort) ||
  webPort < 1024 ||
  webPort > 65535
)
  throw new Error("PAPER_PORT must be an integer from 1024 through 65535");

const scratch = await mkdtemp(join(tmpdir(), "openerp-paper-"));

const pgData = join(scratch, "pgdata");

const pgPassword = randomBytes(32).toString("hex");

const runtimePassword = randomBytes(32).toString("hex");

const loginPassword = randomBytes(24).toString("hex");

const accessToken = randomBytes(32).toString("hex");

const passwordFile = join(scratch, "pg-password");

const url = `http://127.0.0.1:${webPort}`;

let worker;

let webLog = "";

let postgresStarted = false;

let web;

let cleaning;

async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    try {
      if (web?.pid && web.exitCode === null) {
        const exited = once(web, "exit");
        process.kill(-web.pid, "SIGTERM");
        await exited;
      }
    } finally {
      try {
        await worker?.close();
      } finally {
        try {
          if (postgresStarted)
            await run(join(pgBin, "pg_ctl"), ["-D", pgData, "-m", "fast", "-w", "stop"]);
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      }
    }
  })();

  return cleaning;
}

process.on("SIGUSR2", () => {
  if (worker)
    void worker
      .update((options) => ({ ...options }))
      .then(
        () => console.info(JSON.stringify({ reloaded: true, url })),
        (error) => console.error(error),
      );
});

process.once("SIGINT", () => {
  void cleanup().then(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void cleanup().then(() => process.exit(0));
});

try {
  await writeFile(passwordFile, pgPassword, { mode: 0o600 });

  const socket = createServer();

  socket.listen(0, "127.0.0.1");

  await once(socket, "listening");

  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No PostgreSQL port allocated");

  const port = address.port;

  await new Promise((done, reject) => socket.close((error) => (error ? reject(error) : done())));

  const adminUrl = `postgresql://postgres:${pgPassword}@127.0.0.1:${port}/${databaseName}`;

  const runtimeUrl = `postgresql://paper_runtime:${runtimePassword}@127.0.0.1:${port}/${databaseName}`;

  await run(join(pgBin, "initdb"), [
    "-D",
    pgData,
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
    pgData,
    "-l",
    join(artifacts, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${scratch}`,
    "-w",
    "start",
  ]);
  postgresStarted = true;

  if (databaseName !== "postgres") {
    const clusterAdmin = new Client({
      connectionString: `postgresql://postgres:${pgPassword}@127.0.0.1:${port}/postgres`,
    });

    await clusterAdmin.connect();

    try {
      await clusterAdmin.query(`CREATE DATABASE ${databaseName}`);
    } finally {
      await clusterAdmin.end();
    }
  }

  const migrated = await run("bun", ["scripts/migrate.ts"], {
    cwd: api,
    env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
  });

  await writeFile(join(artifacts, "migrations.log"), migrated.stdout);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    await admin.query(
      `CREATE ROLE paper_runtime LOGIN PASSWORD '${runtimePassword}' IN ROLE openerp_runtime`,
    );
  } finally {
    await admin.end();
  }

  const fixture = JSON.parse(await readFile(join(root, "examples/synthetic-book.json"), "utf8"));
  fixture.book.name = "Fjällby Konsult AB";
  fixture.entity.name = "Synthetic Paper visual fixture";
  fixture.actor.name = "Elin Sund";
  fixture.actor.tokenExpiresAt = new Date(Date.now() + 86_400_000).toISOString();

  if (payrollHook === "1") fixture.accounts.push(...payrollAccounts);

  if (onboardingHook === "1")
    fixture.accounts.push(
      { id: "account_receivable", code: "1510", name: "Synthetic customer receivables" },
      { id: "account_payable", code: "2440", name: "Synthetic supplier payables" },
      { id: "account_vat", code: "2650", name: "Synthetic VAT control" },
    );
  const manifest = join(scratch, "book.json");
  await writeFile(manifest, JSON.stringify(fixture));
  await run("bun", ["scripts/provision.ts", manifest], {
    cwd: api,
    env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, OPENERP_ACCESS_TOKEN: accessToken },
  });
  const email = "elin@example.test";
  await run("bun", ["scripts/create-user.ts", fixture.actor.id], {
    cwd: api,
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: adminUrl,
      OPENERP_EMAIL: email,
      OPENERP_PASSWORD: loginPassword,
    },
  });
  worker = createTestHarness({
    root: api,
    workers: [
      {
        configPath: "wrangler.jsonc",
        env: "e2e",
        secrets: {
          DATABASE_URL: runtimeUrl,
          BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
          BETTER_AUTH_URL: url,
        },
      },
    ],
  });

  const listening = await worker.listen();

  if (payrollHook === "1") {
    const payroll = await seedPayroll({
      apiUrl: listening.url.origin,
      adminUrl,
      accessToken,
      fixture,
      artifacts,
    });

    console.log(JSON.stringify(payroll));
  }

  web = spawn(
    "bun",
    [
      "run",
      "dev",
      "--config",
      "tests/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: join(root, "apps/web"),
      env: { ...process.env, OPENERP_E2E_API_URL: listening.url.origin },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  web.stdout.on("data", (chunk) => {
    webLog += chunk.toString();
  });
  web.stderr.on("data", (chunk) => {
    webLog += chunk.toString();
  });
  const sessionFile = join(scratch, "session.json");
  await writeFile(
    sessionFile,
    JSON.stringify({
      url,
      email,
      password: loginPassword,
      accessToken,
      apiUrl: listening.url.origin,
      databaseName,
      workspace: `${url}/entities/${fixture.entity.id}/books/${fixture.book.id}`,
    }),
    { mode: 0o600 },
  );
  const deadline = Date.now() + 60_000;
  let ready = false;

  while (Date.now() < deadline && !ready) {
    if (web.exitCode !== null) throw new Error(webLog);

    try {
      ready = (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      await new Promise((done) => setTimeout(done, 200));
    }
  }

  if (!ready) throw new Error(`Web readiness timed out\n${webLog}`);
  console.log(JSON.stringify({ ready: true, url, sessionFile, artifacts }));
  await once(web, "exit");
} finally {
  await writeFile(join(artifacts, "web.log"), webLog);
  await cleanup();
}
