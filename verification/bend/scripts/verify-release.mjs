import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadEngine, ROOT, BEND_PIN } from "../lib/engine.mjs";

const binary = process.env.BEND_BIN || "bend";

const runs = [];

function run(command, args) {
  const p = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });

  const record = {
    command,
    args,
    status: p.status,
    signal: p.signal,
    stdout: p.stdout ?? "",
    stderr: p.stderr ?? "",
    error: p.error?.message,
  };

  runs.push(record);

  if (p.error || p.status !== 0)
    throw new Error(
      `Required verification failed: ${command} ${args.join(" ")}\n${record.stderr}\n${record.stdout}`,
    );
}

try {
  // Preconditions also replace stale success evidence with a failed report.
  if (!process.env.BEND_SOURCE_ROOT)
    throw new Error("BEND_SOURCE_ROOT must point to the pinned, unmodified Bend checkout.");

  if (!process.env.OPENERP_REPO)
    throw new Error("OPENERP_REPO is required for real-owner differential checks.");

  const engine = await loadEngine();

  if (engine.authority !== "pinned-upstream-source")
    throw new Error("A development adaptation cannot pass the release gate.");

  run(process.execPath, ["--experimental-strip-types", "tests/run.mjs"]);
  run(process.execPath, ["--experimental-strip-types", "scripts/verify-owner.mjs"]);
  run(binary, ["bend/Kernel.bend"]);
  run(binary, ["bend/PROOF.bend", "--safe"]);
  await writeFile(
    resolve(ROOT, "evidence/release-verification.json"),
    JSON.stringify(
      { modelVerificationComplete: true, productionReady: false, bendSourceCommit: BEND_PIN, runs },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Model verification gate passed. This is not an ERP production-readiness or statutory-compliance certificate.",
  );
} catch (error) {
  await writeFile(
    resolve(ROOT, "evidence/release-verification.json"),
    JSON.stringify(
      {
        modelVerificationComplete: false,
        productionReady: false,
        bendSourceCommit: BEND_PIN,
        runs,
        error: String(error),
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
}
