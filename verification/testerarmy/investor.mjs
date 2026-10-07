import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { sha256, tool } from "../assurance/scripts/runtime.mjs";

const root = resolve(import.meta.dirname, "../..");

const output = join(root, "test-results/investor", randomUUID());

const chapters = ["document-question-posting", "bank-evidence-review"];

const manifest = {
  syntheticOnly: true,
  verdict: "NOT VERIFIED",
  revision: null,
  command: "node verification/testerarmy/investor.mjs",
  scope: "Two separate synthetic chapters, twice; not a continuous investor recording",
  runs: [],
};

let active;

let interrupted;

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = signal;
    active?.kill(signal);
  });

async function receipt(directory, filename) {
  return JSON.parse(await readFile(join(root, directory, filename), "utf8"));
}

async function qualifyDocument(directory) {
  const journey = await receipt(directory, "document-question-posting.json");

  assert.equal(journey.before.sequence, "0");
  assert.ok(journey.before.accounts.every((account) => account.balanceMinor === "0"));
  assert.equal(journey.afterPosting.sequence, "1");
  assert.deepEqual(
    journey.afterPosting.accounts.map(({ accountId, debitMinor, creditMinor, balanceMinor }) => ({
      accountId,
      debitMinor,
      creditMinor,
      balanceMinor,
    })),
    [
      { accountId: "account_bank", debitMinor: "125000", creditMinor: "0", balanceMinor: "125000" },
      {
        accountId: "account_clearing",
        debitMinor: "0",
        creditMinor: "125000",
        balanceMinor: "-125000",
      },
    ],
  );
  assert.deepEqual(journey.afterMatching, journey.afterPosting);
  assert.deepEqual(journey.recovery.committed, journey.receipt);
  assert.deepEqual(journey.recovery.afterLostResponse, journey.afterPosting);
  assert.equal(journey.recovery.reloaded, true);
  assert.equal(journey.matched.legs.length, 1);
  assert.equal(journey.matched.legs[0].amountMinor, "125000");

  return {
    inputHashes: [journey.occurrence.sha256, journey.retainedStatementEvidence.sha256],
    screenshots: journey.screenshots,
  };
}

async function qualifyBank(directory) {
  const preparation = await receipt(directory, "bank-review-preparation.json");
  const checksum = await receipt(directory, "bank-review-checksum.json");
  const capacity = await receipt(directory, "bank-review-capacity.json");
  const access = await receipt(directory, "bank-review-access.json");

  for (const result of [preparation, checksum, capacity, access])
    assert.equal(result.syntheticOnly, true);
  assert.equal(preparation.view.approval, null);
  assert.equal(preparation.view.execution, null);
  assert.equal(preparation.refreshed.source.remainingMinor, "-125000");
  assert.equal(preparation.plan.input.legs[0].amountMinor, "-125000");
  assert.equal(preparation.originalHash, checksum.expectedHash);
  assert.equal(preparation.originalHash, access.originalHash);

  return {
    inputHashes: [preparation.originalHash, preparation.refreshed.source.evidenceSha256],
    screenshots: [
      ...preparation.screenshots,
      checksum.screenshot,
      capacity.screenshot,
      access.screenshot,
    ],
  };
}

await mkdir(output, { recursive: true });

console.log(`Investor manifest: ${join(output, "manifest.json")}`);

try {
  manifest.revision = tool("git", ["rev-parse", "HEAD"], { cwd: root }).trim();

  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("PAPER_") &&
        !key.startsWith("OPENERP_E2E_") &&
        key !== "OPENERP_DEMO_FIXTURE",
    ),
  );

  for (let rehearsal = 1; rehearsal <= 2; rehearsal++) {
    for (const chapter of chapters) {
      assert.equal(interrupted, undefined, "Interrupted rehearsals cannot start another chapter");
      const run = { rehearsal, chapter, startedAt: new Date().toISOString(), directory: null };

      manifest.runs.push(run);
      const chapterEnvironment = { ...environment, OPENERP_E2E_WEB_MODE: "built" };

      if (chapter === "document-question-posting") chapterEnvironment.OPENERP_DEMO_FIXTURE = "1";

      active = spawn(
        process.execPath,
        ["verification/testerarmy/run.mjs", `tests/browser/${chapter}.e2e.ts`, "--ai-trace"],
        {
          cwd: root,
          env: chapterEnvironment,
          stdio: ["ignore", "pipe", "inherit"],
        },
      );
      const completion = once(active, "exit");
      const lines = createInterface({ input: active.stdout });

      lines.on("line", (line) => {
        console.log(line);

        const match = /^Reports and startup logs: (test-results\/testerarmy\/[a-f0-9-]+)$/.exec(
          line,
        );

        if (match) run.directory = match[1];
      });
      const [code] = await completion;

      active = undefined;
      lines.close();
      run.exitCode = code;
      run.finishedAt = new Date().toISOString();
      assert.equal(interrupted, undefined, "An interrupted chapter cannot pass");
      assert.equal(code, 0, `${chapter} must complete`);
      assert.ok(run.directory, "The runtime must retain its result directory");
      const source = await receipt(run.directory, "source-integrity.json");

      assert.equal(source.status, "stable");
      assert.equal(source.exitCode, 0);
      assert.equal(source.revision, manifest.revision);
      assert.equal(source.before.digest, source.after.digest);
      run.sourceDigest = source.before.digest;

      const qualification =
        chapter === "document-question-posting"
          ? await qualifyDocument(run.directory)
          : await qualifyBank(run.directory);

      Object.assign(run, qualification);
      assert.ok(run.screenshots.length > 0, "Each chapter must retain application screenshots");

      const artifacts = await readdir(join(root, run.directory, "artifacts"), { recursive: true });

      run.screenshotArtifacts = [];

      for (const screenshot of run.screenshots) {
        assert.equal(typeof screenshot, "string");
        const matches = artifacts.filter((path) => path.endsWith(`/${screenshot}`));

        assert.equal(
          matches.length,
          1,
          "Each selected screenshot must identify one retained artifact",
        );
        const bytes = await readFile(join(root, run.directory, "artifacts", matches[0]));

        assert.ok(bytes.length > 0, "Screenshot files must exist");
        run.screenshotArtifacts.push({
          path: `${run.directory}/artifacts/${matches[0]}`,
          sha256: sha256(bytes),
        });
      }

      assert.equal(
        run.sourceDigest,
        manifest.runs[0].sourceDigest,
        "Sources must stay fixed across chapters",
      );

      if (rehearsal === 2) {
        const previous = manifest.runs.find(
          (candidate) => candidate.rehearsal === 1 && candidate.chapter === chapter,
        );

        assert.deepEqual(
          run.inputHashes,
          previous.inputHashes,
          "Fresh resets must restore identical chapter inputs",
        );
      }

      run.verdict = "VERIFIED";
    }
  }

  assert.equal(interrupted, undefined);
  manifest.verdict = "VERIFIED";
} catch (error) {
  manifest.failure = error instanceof Error ? error.message : "Investor rehearsal failed";
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
  });

  if (interrupted && manifest.verdict === "VERIFIED") {
    manifest.verdict = "NOT VERIFIED";
    manifest.failure = `Interrupted by ${String(interrupted)} during manifest write`;
    process.exitCode = 1;
    await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
      mode: 0o600,
    });
  }

  console.log(`Investor rehearsal result: ${manifest.verdict}`);
}
