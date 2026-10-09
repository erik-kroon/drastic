import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

export function nativeApi(root, env) {
  const child = spawn("bun", ["apps/api/scripts/native-browser-api.ts"], {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const lines = createInterface({ input: child.stdout });

  child.once("close", () => lines.close());
  child.once("error", () => lines.close());

  let startupTimeout;

  const ready = new Promise((resolve, reject) => {
    startupTimeout = setTimeout(
      () => reject(new Error("Native browser API startup timed out")),
      30000,
    );
    child.once("error", reject);
    child.once("exit", () => reject(new Error("Native browser API exited before readiness")));
    lines.on("line", (line) => {
      if (!line.startsWith('{"nativeApi":true,')) return;
      const value = JSON.parse(line);
      const url = new URL(value.url);

      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
        reject(new Error("Native browser API announced an invalid origin"));

        return;
      }

      resolve({ url });
    });
  }).finally(() => {
    clearTimeout(startupTimeout);
  });

  return {
    listen: () => ready,
    getLogs: () => [{ runtime: "native-bun", output }],
    fetch: async (path, options) => fetch(new URL(path, (await ready).url), options),
    exited: new Promise((resolve) => child.once("close", resolve)),
    close: async () => {
      if (!child.pid) return;

      const group = -child.pid;

      const signal = (name) => {
        try {
          process.kill(group, name);

          return true;
        } catch (error) {
          if (error.code === "ESRCH") return false;

          throw error;
        }
      };

      if (!signal("SIGTERM")) return;
      const deadline = Date.now() + 5000;

      while (signal(0) && Date.now() < deadline) await delay(50);

      if (!signal(0)) return;
      signal("SIGKILL");
      const killDeadline = Date.now() + 5000;

      while (signal(0) && Date.now() < killDeadline) await delay(50);

      if (signal(0)) throw new Error("Native browser API process group did not stop");
    },
  };
}
