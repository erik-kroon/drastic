import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname, isAbsolute, relative } from "node:path";
import { redactLog } from "./gates.mjs";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function safeInside(root, child) {
  if (
    typeof child !== "string" ||
    !child ||
    isAbsolute(child) ||
    child.split(/[\\/]/).includes("..")
  )
    throw new Error("Invalid relative path");
  const target = resolve(root, child);
  const rel = relative(resolve(root), target);

  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes scope");

  return target;
}

export async function requireNoSymlinkParents(root, target) {
  const rel = relative(resolve(root), resolve(target));

  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Outside root");
  let at = resolve(root);

  for (const part of ["", ...rel.split(/[\\/]/)]) {
    if (part) at = join(at, part);

    try {
      if ((await lstat(at)).isSymbolicLink()) throw new Error(`Symlink refused: ${at}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export function childEnvironment(extra = {}) {
  // Do not relay ambient company/provider/database secrets to disposable tests.
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "BUN_INSTALL",
    "XDG_CACHE_HOME",
    "PG_BINDIR",
    "CI",
  ];

  const env = {};

  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];

  return { ...env, CI: "true", ...extra };
}

export async function runBounded(command, args, { cwd, env, timeoutMs, logPath }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("Finite positive timeout required");
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
  const startedAt = Date.now();
  const buffers = [];

  let bytes = 0,
    overflow = false,
    timedOut = false,
    spawnError = null;

  const MAX_LOG = 16 * 1024 * 1024;

  const child = spawn(command, args, {
    cwd,
    env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const keep = (chunk) => {
    bytes += chunk.length;

    if (bytes <= MAX_LOG) buffers.push(Buffer.from(chunk));
    else overflow = true;
  };

  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const killOwned = (signal) => {
    if (!child.pid) return;

    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };

  let hard;

  const expire = () => {
    timedOut = true;
    killOwned("SIGTERM");
    hard = setTimeout(() => killOwned("SIGKILL"), 3_000);
    hard.unref();
  };

  const timer = setTimeout(expire, timeoutMs);
  timer.unref();
  const forwardSignal = () => expire();
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);
  let status;

  try {
    status = await new Promise((res) => {
      child.once("error", (error) => {
        spawnError = error.message;
      });
      child.once("close", (code, signal) => res({ code, signal }));
    });
  } finally {
    clearTimeout(timer);

    if (hard) clearTimeout(hard);
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);
  }

  const text = redactLog(Buffer.concat(buffers).toString("utf8"));
  await writeFile(logPath, text + (overflow ? "\n[LOG LIMIT EXCEEDED]\n" : ""), { mode: 0o600 });

  return {
    command,
    args,
    startedAt,
    finishedAt: Date.now(),
    exitCode: status.code,
    signal: status.signal,
    timedOut,
    spawnError,
    logOverflow: overflow,
    logPath,
    logSha256: sha256(await readFile(logPath)),
  };
}

export function tool(command, args = ["--version"], options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  }).trim();
}

export async function findTests(root, relativeDir, suffix) {
  const out = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Test symlink refused: ${join(dir, entry.name)}`);

      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith(suffix))
        out.push(relative(root, join(dir, entry.name)).replaceAll("\\", "/"));
    }
  }

  await walk(join(root, relativeDir));

  return out.sort();
}

export async function captureSources(repo) {
  const roots = [
    "apps/api",
    "apps/web",
    "packages",
    "jurisdictions",
    "config",
    "scripts",
    "verification/bend",
    "verification/assurance",
    "package.json",
    "bun.lock",
    "vite.config.ts",
    "tsconfig.json",
    ".github/workflows",
  ];

  const options = { cwd: repo, encoding: "utf8", maxBuffer: 40 * 1024 * 1024 };

  const tracked = new Set(
    tool("git", ["ls-files", "-z", "--cached", "--", ...roots], options)
      .split("\0")
      .filter(Boolean),
  );

  const others = tool(
    "git",
    ["ls-files", "-z", "--others", "--exclude-standard", "--", ...roots],
    options,
  )
    .split("\0")
    .filter(Boolean);

  const generated = (path) =>
    /(^|\/)(node_modules|dist|\.wrangler|test-results)(\/|$)/.test(path) ||
    path.endsWith(".tsbuildinfo") ||
    /(^|\/)tsconfig\.changed\.json$/.test(path) ||
    /^verification\/bend\/(?:authority\/)?evidence\//.test(path);

  const files = [];

  for (const path of [...new Set([...tracked, ...others])].filter((p) => !generated(p)).sort()) {
    const full = safeInside(repo, path);
    await requireNoSymlinkParents(repo, full);

    try {
      if (!(await lstat(full)).isFile()) throw new Error("Not regular source " + path);
      files.push({ path, sha256: sha256(await readFile(full)), tracked: tracked.has(path) });
    } catch (error) {
      if (error?.code === "ENOENT" && tracked.has(path))
        files.push({ path, sha256: null, tracked: true });
      else throw error;
    }
  }

  return {
    roots,
    exclusions:
      "generated evidence/build/cache outputs; .gitignored untracked files are not source inputs",
    files,
    digest: sha256(JSON.stringify(files)),
  };
}
