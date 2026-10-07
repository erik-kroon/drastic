import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

const run = promisify(execFile);

const root = resolve(import.meta.dirname, "../..");

const runDirectory = `test-results/testerarmy/${randomUUID()}`;

const output = resolve(root, runDirectory);

async function unusedLoopbackPort() {
  const socket = createServer();

  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");

  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No loopback port allocated");

  await new Promise((done, reject) => socket.close((error) => (error ? reject(error) : done())));

  return address.port;
}

const webPort = await unusedLoopbackPort();

const proxyPort = await unusedLoopbackPort();

const appUrl = `http://127.0.0.1:${webPort}`;

const proxyUrl = `http://127.0.0.1:${proxyPort}`;

const children = [];

const logs = [];

const groups = new Set();

let stopping;

let sessionDirectory;

await mkdir(output, { recursive: true });

console.log(`Reports and startup logs: ${runDirectory}`);

async function start(executable, args, name, ready) {
  const log = createWriteStream(resolve(output, `${name}.log`), { flags: "w", mode: 0o600 });

  logs.push(log);

  const child = spawn(executable, args, {
    cwd: root,
    env: {
      ...process.env,
      PAPER_PORT: String(webPort),
      PAPER_ARTIFACTS: resolve(output, "runtime"),
      PAPER_PAYROLL: "0",
      PAPER_ONBOARDING: "0",
      E2E_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.push(child);

  child.stdout.pipe(log, { end: false });

  child.stderr.pipe(log, { end: false });

  return await new Promise((resolveReady, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`${name} startup timed out; see ${name}.log`)),
      120_000,
    );

    const lines = [
      createInterface({ input: child.stdout }),
      createInterface({ input: child.stderr }),
    ];

    function finish(error, result) {
      clearTimeout(timer);

      for (const line of lines) line.close();

      child.off("error", onError);

      child.off("exit", onExit);

      if (error) reject(error);
      else resolveReady(result);
    }

    function onError(error) {
      finish(error);
    }

    function onExit(code) {
      finish(new Error(`${name} exited ${code}; see ${name}.log`));
    }

    child.once("error", onError);

    child.once("exit", onExit);

    for (const line of lines)
      line.on("line", (text) => {
        const result = ready(text);

        if (result) finish(undefined, result);
      });
  });
}

async function stop() {
  stopping ??= (async () => {
    for (const child of children.toReversed()) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;

      const exited = once(child, "exit");

      if (groups.has(child)) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");

      const timer = setTimeout(() => {
        if (groups.has(child)) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      }, 30_000);

      await exited;
      clearTimeout(timer);
    }

    for (const log of logs) {
      log.end();
      await once(log, "finish");
    }

    if (sessionDirectory && existsSync(sessionDirectory)) {
      if (existsSync(resolve(sessionDirectory, "pgdata/postmaster.pid"))) {
        const pgBin = process.env.PG_BINDIR ?? (await run("pg_config", ["--bindir"])).stdout.trim();

        await run(
          resolve(pgBin, "pg_ctl"),
          ["-D", resolve(sessionDirectory, "pgdata"), "-m", "fast", "-w", "stop"],
          { timeout: 30_000 },
        );
      }

      await rm(sessionDirectory, { recursive: true });
    }
  })();

  await stopping;
}

process.once("SIGINT", () => {
  void stop().then(() => process.exit(130));
});

process.once("SIGTERM", () => {
  void stop().then(() => process.exit(130));
});

try {
  await start(
    "uvx",
    [
      "--from",
      "openai-api-server-via-codex==0.2.1",
      "openai-api-server-via-codex",
      "--host",
      "127.0.0.1",
      "--port",
      String(proxyPort),
    ],
    "proxy",
    (line) => line.includes(`listening on ${proxyUrl}`),
  );

  const session = await start("node", ["verification/paper/start.mjs"], "app", (line) => {
    if (line.startsWith('{"starting":true,')) {
      sessionDirectory = JSON.parse(line).scratch;

      return;
    }

    if (!line.startsWith('{"ready":true,')) return;

    return JSON.parse(line);
  });

  sessionDirectory = dirname(session.sessionFile);

  console.log(`Running Luna against disposable PostgreSQL/API/web at ${appUrl}`);

  console.log(`Reports and startup logs: ${runDirectory}`);

  const runner = spawn("npx", ["--no-install", "e2e", "run", ...process.argv.slice(2)], {
    cwd: root,
    env: {
      ...process.env,
      PAPER_PORT: String(webPort),
      OPENERP_E2E_SESSION: session.sessionFile,
      OPENERP_E2E_APP_URL: appUrl,
      OPENERP_E2E_OUTPUT: runDirectory,
      OPENERP_E2E_PROXY_URL: `${proxyUrl}/v1`,
      E2E_TELEMETRY_DISABLED: "1",
    },
    stdio: "inherit",
    detached: true,
  });

  children.push(runner);

  groups.add(runner);

  const [code] = await once(runner, "exit");
  process.exitCode = code ?? 1;
} finally {
  await stop();
}
