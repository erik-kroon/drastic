import { cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

await cp(resolve(root, "node_modules/e2e/skills/e2e"), resolve(root, ".agents/skills/e2e"), {
  recursive: true,
});

const install = spawn("npx", ["--no-install", "e2e-web", "install", "chromium"], {
  cwd: root,
  stdio: "inherit",
});

const [code] = await once(install, "exit");

process.exitCode = code ?? 1;
