import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

const requirements = join(root, "verification/peppol/requirements.txt");

// One install per user and requirements revision, shared by every checkout and
// worktree, so a fresh worktree never starts without the validator.
export function validatorDirectory() {
  const revision = createHash("sha256")
    .update(readFileSync(requirements))
    .digest("hex")
    .slice(0, 16);

  const cache = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");

  return join(cache, "drastic", `peppol-validator-${revision}`);
}

export function validatorPython() {
  return process.env.PEPPOL_VALIDATOR_PYTHON ?? join(validatorDirectory(), "bin/python");
}

async function exists(path) {
  try {
    await access(path);

    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function run(executable, args) {
  const child = spawn(executable, args, { cwd: root, stdio: "inherit" });
  const [status] = await once(child, "exit");

  if (status !== 0) throw new Error(`Pinned Peppol validator setup failed: ${executable}`);
}

const verifyEngine = [
  "-c",
  "from saxonche import PySaxonProcessor; p=PySaxonProcessor(license=False); assert p.version == 'SaxonC-HE 12.9 from Saxonica'",
];

/**
 * Installs the pinned validator once. The install happens in a private
 * directory that is renamed into place only after the engine check passes, so
 * an interrupted or concurrent setup never leaves a half-built validator.
 */
export async function ensureValidator() {
  if (process.env.PEPPOL_VALIDATOR_PYTHON) return process.env.PEPPOL_VALIDATOR_PYTHON;

  const directory = validatorDirectory();
  const python = join(directory, "bin/python");

  if (await exists(join(directory, "installed"))) return python;

  const staging = `${directory}.staging-${process.pid}`;
  const stagedPython = join(staging, "bin/python");

  await mkdir(resolve(directory, ".."), { recursive: true, mode: 0o700 });
  await rm(staging, { recursive: true, force: true });

  try {
    await run("python3", ["-m", "venv", staging]);
    await run(stagedPython, ["-m", "pip", "install", "--require-hashes", "-r", requirements]);
    await run(stagedPython, verifyEngine);
    await writeFile(join(staging, "installed"), new Date().toISOString() + "\n");

    if (await exists(join(directory, "installed"))) {
      await rm(staging, { recursive: true, force: true });

      return python;
    }

    await rm(directory, { recursive: true, force: true });
    await rename(staging, directory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });

    // Another checkout finished first; its complete install is equally valid.
    if (await exists(join(directory, "installed"))) return python;
    throw error;
  }

  await run(python, verifyEngine);

  return python;
}
