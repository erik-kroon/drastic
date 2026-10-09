import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "../..");

const output = `test-results/mcpjam/${randomUUID()}`;

const ci = process.argv.includes("--ci");

let proxy;

let runner;

let interrupted = false;

await mkdir(resolve(root, output), { recursive: true });

console.log(`MCPJam evidence: ${output}`);

async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  process.kill(-child.pid, "SIGTERM");

  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGKILL");
  }, 30_000);

  await exited;
  clearTimeout(timer);
}

function interrupt() {
  interrupted = true;

  if (runner?.pid) process.kill(-runner.pid, "SIGTERM");

  if (proxy?.pid) process.kill(-proxy.pid, "SIGTERM");
}

process.once("SIGINT", interrupt);

process.once("SIGTERM", interrupt);

try {
  let baseUrl = "https://api.openai.com/v1";
  let apiKey = process.env.MCPJAM_OPENAI_API_KEY;

  if (ci && !apiKey) throw new Error("Enabled MCPJam CI eval requires MCPJAM_OPENAI_API_KEY");

  if (!ci) {
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const address = socket.address();

    if (!address || typeof address === "string") throw new Error("No proxy port allocated");
    await new Promise((done, reject) => socket.close((error) => (error ? reject(error) : done())));
    const origin = `http://127.0.0.1:${address.port}`;
    baseUrl = `${origin}/v1`;
    apiKey = "local-codex-proxy";
    proxy = spawn(
      "uvx",
      [
        "--from",
        "openai-api-server-via-codex==0.2.1",
        "openai-api-server-via-codex",
        "--host",
        "127.0.0.1",
        "--port",
        String(address.port),
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    await new Promise((ready, reject) => {
      const lines = [
        createInterface({ input: proxy.stdout }),
        createInterface({ input: proxy.stderr }),
      ];

      const timer = setTimeout(() => finish(new Error("Codex proxy startup timed out")), 120_000);

      function finish(error) {
        clearTimeout(timer);

        for (const line of lines) line.close();
        proxy.off("error", onError);
        proxy.off("exit", onExit);

        if (error) reject(error);
        else ready();
      }

      function onError() {
        finish(new Error("Cannot start pinned Codex proxy; check uvx and Codex authentication"));
      }

      function onExit() {
        finish(new Error("Pinned Codex proxy exited before becoming ready"));
      }

      proxy.once("error", onError);
      proxy.once("exit", onExit);

      for (const line of lines)
        line.on("line", (text) => {
          if (text.includes(`listening on ${origin}`)) finish();
        });
    });
    proxy.stdout.resume();
    proxy.stderr.resume();
  }

  if (interrupted) throw new Error("MCPJam run interrupted");
  runner = spawn(
    "bun",
    ["x", "--no-install", "vp", "test", "run", "--config", "mcpjam.config.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        MCPJAM_MODEL_URL: baseUrl,
        MCPJAM_MODEL_API_KEY: apiKey,
        MCPJAM_TELEMETRY_DISABLED: "1",
        OPENERP_E2E_ARTIFACTS: output,
      },
      stdio: "inherit",
      detached: true,
    },
  );
  const [code] = await once(runner, "exit");
  process.exitCode = interrupted ? 130 : (code ?? 1);
} catch (error) {
  process.exitCode = interrupted ? 130 : 1;
  console.error(error instanceof Error ? error.message : "MCPJam runtime failed");
} finally {
  try {
    await stop(runner);
    await stop(proxy);
  } catch {
    process.exitCode = 1;
    console.error("Owned MCPJam process cleanup failed");
  }

  await writeFile(
    resolve(root, output, "run.json"),
    JSON.stringify(
      {
        model: "gpt-6-luna",
        provider: ci ? "openai" : "pinned-codex-proxy",
        exitCode: process.exitCode ?? 1,
        interrupted,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
