import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, ".cache/peppol-validator");
const python = resolve(directory, "bin/python");

async function run(executable, args) {
  const child = spawn(executable, args, { cwd: root, stdio: "inherit" });
  const [status] = await once(child, "exit");

  if (status !== 0) throw new Error("Pinned local validator setup failed");
}

let installed = false;

try {
  await access(python);
  installed = true;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (!installed) {
  await mkdir(resolve(root, ".cache"), { recursive: true, mode: 0o700 });
  await run("python3", ["-m", "venv", directory]);
  await run(python, [
    "-m",
    "pip",
    "install",
    "--require-hashes",
    "-r",
    "verification/peppol/requirements.txt",
  ]);
}

await run(python, [
  "-c",
  "from saxonche import PySaxonProcessor; p=PySaxonProcessor(license=False); assert p.version == 'SaxonC-HE 12.9 from Saxonica'",
]);
console.info(python);
