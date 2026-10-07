import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { captureSources, sha256, tool } from "../assurance/scripts/runtime.mjs";

const root = resolve(import.meta.dirname, "../..");

const output = join(root, "test-results/demo", randomUUID());

const inputs = [
  "verification/testerarmy/demo.mjs",
  "verification/testerarmy/run.mjs",
  "verification/paper/start.mjs",
  "apps/web/tests/vite.config.ts",
  "tests/browser/document-question-posting.e2e.ts",
  "tests/browser/synthetic-session.ts",
  "tests/browser/original-fixture.ts",
  "e2e.config.ts",
  "examples/synthetic-book.json",
  "bun.lock",
];

const expectedAccounts = [
  { accountId: "account_bank", debitMinor: "125000", creditMinor: "0", balanceMinor: "125000" },
  {
    accountId: "account_clearing",
    debitMinor: "0",
    creditMinor: "125000",
    balanceMinor: "-125000",
  },
];

const manifest = {
  syntheticOnly: true,
  verdict: "NOT VERIFIED",
  revision: null,
  command: "node verification/testerarmy/demo.mjs",
  runtime: { node: process.version },
  expected: {
    resetSequence: "0",
    postingSequence: "1",
    accounts: expectedAccounts,
    allocatedMinor: "125000",
  },
  sourceBefore: null,
  sourceAfter: null,
  runs: [],
};

let active;

let interrupted;

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = signal;
    active?.kill(signal);
  });

async function sources() {
  tool("git", ["ls-files", "--error-unmatch", "--", ...inputs], { cwd: root });
  const fixtures = [];

  for (const path of inputs)
    fixtures.push({ path, sha256: sha256(await readFile(join(root, path))) });

  return { application: await captureSources(root), fixtures };
}

await mkdir(output, { recursive: true });

console.log(`Demo manifest: ${join(output, "manifest.json")}`);

try {
  manifest.revision = tool("git", ["rev-parse", "HEAD"], { cwd: root }).trim();
  manifest.runtime.bun = tool("bun").trim();
  manifest.runtime.postgres = tool("pg_config").trim();
  manifest.sourceBefore = await sources();

  for (let reset = 1; reset <= 2; reset++) {
    assert.equal(interrupted, undefined, "An interrupted demo must not start another reset");

    const observation = {
      reset,
      startedAt: new Date().toISOString(),
      directory: null,
      exitCode: null,
    };

    manifest.runs.push(observation);

    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("PAPER_") && !key.startsWith("OPENERP_E2E_"),
      ),
    );

    active = spawn(
      process.execPath,
      [
        "verification/testerarmy/run.mjs",
        "tests/browser/document-question-posting.e2e.ts",
        "--ai-trace",
      ],
      {
        cwd: root,
        env: { ...environment, OPENERP_DEMO_FIXTURE: "1" },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    const completion = once(active, "exit");
    const lines = createInterface({ input: active.stdout });

    lines.on("line", (line) => {
      console.log(line);
      const match = /^Reports and startup logs: (test-results\/testerarmy\/[a-f0-9-]+)$/.exec(line);

      if (match) observation.directory = match[1];
    });
    const [code] = await completion;

    active = undefined;
    lines.close();
    observation.exitCode = code;
    observation.finishedAt = new Date().toISOString();
    assert.equal(code, 0, `Reset ${reset} must complete the real browser journey`);
    assert.ok(observation.directory, "The wrapper must retain its result directory");

    const journey = JSON.parse(
      await readFile(join(root, observation.directory, "document-question-posting.json"), "utf8"),
    );

    const startup = (await readFile(join(root, observation.directory, "app.log"), "utf8"))
      .split("\n")
      .filter((line) => line.startsWith('{"starting":true,') || line.startsWith('{"ready":true,'))
      .map((line) => JSON.parse(line));

    assert.equal(
      startup.filter((item) => item.ready).length,
      1,
      "The real runtime must announce readiness",
    );
    assert.equal(journey.before.sequence, "0");
    assert.ok(
      journey.before.accounts.every(
        (account) =>
          account.debitMinor === "0" && account.creditMinor === "0" && account.balanceMinor === "0",
      ),
    );
    assert.equal(journey.afterPosting.sequence, "1");
    assert.deepEqual(
      journey.afterPosting.accounts.map(({ accountId, debitMinor, creditMinor, balanceMinor }) => ({
        accountId,
        debitMinor,
        creditMinor,
        balanceMinor,
      })),
      expectedAccounts,
    );
    assert.deepEqual(journey.afterMatching, journey.afterPosting);
    assert.deepEqual(journey.recovery.committed, journey.receipt);
    assert.deepEqual(journey.recovery.afterLostResponse, journey.afterPosting);
    assert.equal(journey.recovery.reloaded, true);
    assert.equal(journey.matched.legs.length, 1);
    assert.equal(journey.matched.legs[0].amountMinor, "125000");
    observation.startup = startup.map(({ ready, starting, url }) => ({ ready, starting, url }));
    observation.journey = `${observation.directory}/document-question-posting.json`;
    observation.inputHashes = {
      original: journey.occurrence.sha256,
      bank: journey.retainedStatementEvidence.sha256,
    };
    observation.screenshots = journey.screenshots;
    observation.verdict = "VERIFIED";
    manifest.sourceAfter = await sources();
    assert.deepEqual(
      manifest.sourceAfter,
      manifest.sourceBefore,
      "Source must stay fixed across resets",
    );
  }

  assert.deepEqual(
    manifest.runs[0].inputHashes,
    manifest.runs[1].inputHashes,
    "Reset must restore identical document and bank inputs",
  );
  assert.equal(interrupted, undefined, "An interrupted demo cannot pass");
  manifest.verdict = "VERIFIED";
} catch (error) {
  manifest.failure = error instanceof Error ? error.message : "Demo verification failed";
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
  console.log(`Demo result: ${manifest.verdict}`);
}
