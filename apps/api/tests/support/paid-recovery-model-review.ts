import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Page } from "playwright";
import { apiDirectory, environment, run } from "./fixtures";

// Refuse foreign origins, absent authentication and unavailable Luna; always
// remove session material and stop the owned proxy, including on failed review.
export async function reviewPaidRecoveryWithLuna(
  page: Page,
  workspace: string,
  recoveryId: string,
) {
  if (process.env.OPENERP_PAYROLL_MODEL_REVIEW !== "1") return;
  const origin = new URL(workspace);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    new URL(page.url()).origin !== origin.origin
  )
    throw new Error("Model review requires the owned loopback browser");
  const cookies = (await page.context().cookies()).map(({ name, value }) => ({ name, value }));

  if (!cookies.length) throw new Error("Real public sign-in must precede model review");
  const directory = await mkdtemp(join(tmpdir(), "openerp-payroll-review-"));
  const session = join(directory, "model-session.json");
  const socket = createServer();

  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No model review port allocated");
  const port = address.port;

  await new Promise<void>((done, reject) =>
    socket.close((error) => (error ? reject(error) : done())),
  );
  const proxyUrl = `http://127.0.0.1:${port}`;

  const proxy = spawn(
    "uvx",
    [
      "--from",
      "openai-api-server-via-codex==0.2.1",
      "openai-api-server-via-codex",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { stdio: "ignore", detached: true },
  );

  let proxyError: Error | undefined;

  proxy.on("error", (error) => {
    proxyError = error;
  });

  try {
    await writeFile(session, JSON.stringify({ workspace, recoveryId, cookies }), { mode: 0o600 });
    const deadline = Date.now() + 45000;
    let ready = false;

    while (!ready && Date.now() < deadline) {
      if (proxyError) throw proxyError;

      if (proxy.exitCode !== null) throw new Error("Owned Codex proxy exited before review");

      ready = await fetch(`${proxyUrl}/v1/models`, { signal: AbortSignal.timeout(1000) }).then(
        (response) => response.ok,
        () => false,
      );

      if (!ready) await setTimeout(250);
    }

    if (!ready) throw new Error("Luna proxy unavailable; browser model proof remains unverified");

    const result = await run(
      "npx",
      [
        "--no-install",
        "e2e",
        "run",
        "tests/browser/paid-recovery-model-review.e2e.ts",
        "--ai-trace",
      ],
      {
        cwd: resolve(apiDirectory, "../.."),
        env: {
          ...process.env,
          OPENERP_E2E_APP_URL: origin.origin,
          OPENERP_E2E_PROXY_URL: `${proxyUrl}/v1`,
          OPENERP_E2E_OUTPUT: join(environment().artifacts, "paid-recovery-model-review"),
          OPENERP_PAYROLL_REVIEW_SESSION: session,
          E2E_TELEMETRY_DISABLED: "1",
        },
        timeout: 120000,
      },
    );

    await writeFile(join(environment().artifacts, "paid-recovery-model-review.txt"), result.stdout);
  } finally {
    if (proxy.pid && proxy.exitCode === null) {
      const exited = once(proxy, "exit");

      process.kill(-proxy.pid, "SIGTERM");

      const killTimer = globalThis.setTimeout(() => {
        if (proxy.pid && proxy.exitCode === null) process.kill(-proxy.pid, "SIGKILL");
      }, 30000);

      await exited;
      globalThis.clearTimeout(killTimer);
    }

    await rm(directory, { recursive: true, force: true });
  }
}
