import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdir, realpath } from "node:fs/promises";
import { apiDirectory, environment } from "./fixtures";

async function unusedPort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No local port");
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );

  return address.port;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);

  try {
    const [, signal] = await exited;

    if (signal === "SIGKILL") throw new Error("Runtime did not stop gracefully.");
  } finally {
    clearTimeout(deadline);
  }
}

export async function documentSelfHost(endpoint: string, token: string, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const objectDirectory = await realpath(directory);
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;

  const env = {
    ...process.env,
    DATABASE_URL: environment().runtimeUrl,
    BETTER_AUTH_SECRET: "synthetic-document-browser-proof-only-secret",
    OPENERP_PUBLIC_URL: origin,
    OPENERP_BIND_ADDRESS: "127.0.0.1",
    PORT: String(port),
    OPENERP_PREPARATION_TOKEN: token,
    OPENERP_OBJECT_DIRECTORY: objectDirectory,
    OPENERP_DOCUMENT_READER: "local-azure-fixture",
    OPENERP_DOCUMENT_READER_ENDPOINT: endpoint,
    OPENERP_DOCUMENT_READER_KEY: "",
  };

  let output = "";

  const start = (script: string) => {
    const child = spawn("bun", [script], {
      cwd: apiDirectory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    return child;
  };

  const server = start("scripts/self-host.ts");
  let worker: ChildProcess | undefined;

  try {
    const deadline = Date.now() + 15000;
    let ready = false;

    while (Date.now() < deadline && server.exitCode === null) {
      ready = await fetch(origin, { headers: { accept: "text/html" } }).then(
        (response) => response.ok,
        () => false,
      );

      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!ready) throw new Error(`Self-host startup failed: ${output}`);

    return {
      origin,
      startWorker: () => {
        worker = start("scripts/preparation-runner.ts");
      },
      close: async () => {
        if (worker) await stop(worker);
        await stop(server);
      },
    };
  } catch (error) {
    await stop(server);
    throw error;
  }
}
