import { strict as assert } from "node:assert";
import {
  mkdtemp,
  readFile,
  writeFile,
  realpath,
  mkdir,
  cp,
  unlink,
  access,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Database, databaseLayer } from "../../src/db/connection";
import {
  createEvidence,
  prepareJournal,
  approveChange,
  executeChange,
} from "../../src/application/posting";
import { createHash } from "node:crypto";
import { prepareReport } from "../../src/application/reports";
import { fileObjectStore } from "../file-object-store";
import { prepareSie4E } from "../../src/application/sie4e";

process.umask(0o077);

const scratch = await realpath(await mkdtemp(join(tmpdir(), "openerp-rehearsal-ops-")));

const pgBin = await realpath(process.env["PG_BINDIR"] ?? "/opt/homebrew/opt/postgresql@17/bin");

const port = 56000 + Math.floor(Math.random() * 4000);

const password = randomBytes(24).toString("hex");

const command = async (args: string[], env: Record<string, string | undefined> = process.env) => {
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });

  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { status, stdout, stderr };
};

const run = async (args: string[], env: Record<string, string | undefined> = process.env) => {
  const result = await command(args, env);

  if (result.status !== 0)
    await writeFile(
      join(scratch, "command-failure.json"),
      JSON.stringify({ executable: args[0], stage: args[2], ...result }),
      { mode: 0o600 },
    );

  assert.equal(result.status, 0, `Command failed (${args[0]}). Private diagnostics retained.`);

  return result;
};

const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const cli = (...args: string[]) => command(["bun", "apps/api/scripts/operations/cli.ts", ...args]);

const expectRefusal = async (args: string[], code: string) => {
  const result = await cli(...args);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(code), `Expected ${code}; private refusal output retained.`);

  return { code, exitCode: result.status, diagnostic: result.stderr.trim() };
};

const save = async (name: string, value: unknown) => {
  const path = join(scratch, name);
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });

  return path;
};

type PublicArtifactRecord = { name: string; source: string; sha256: string; bytes: string };

let completedRecords: ReadonlyArray<PublicArtifactRecord> | undefined;

const exportPublicArtifacts = async (
  configuredDirectory: string,
  records: ReadonlyArray<PublicArtifactRecord>,
) => {
  assert.ok(configuredDirectory.trim().length > 0, "Configured artifact output must have a path.");
  const directory = resolve(configuredDirectory);
  assert.ok(
    directory !== scratch && !directory.startsWith(scratch + "/"),
    "Public export must be separate from private scratch.",
  );
  assert.equal(
    await access(directory).then(
      () => true,
      () => false,
    ),
    false,
    "Public artifact output must be new.",
  );
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  assert.equal(
    await realpath(dirname(directory)),
    dirname(directory),
    "Public artifact parent must not contain symlinks.",
  );
  const staging = join(dirname(directory), `.${basename(directory)}-${randomUUID()}.pending`);
  await mkdir(staging, { mode: 0o700 });
  const files: Array<{ path: string; sha256: string; bytes: string }> = [];

  for (const record of records) {
    const before = await readFile(record.source);
    assert.equal(hash(before), record.sha256, "Qualified private record changed before export.");
    assert.equal(String(before.length), record.bytes);
    const text = before.toString("utf8");
    assert.ok(
      !text.includes(password) && !text.includes(tokenForArtifactGuard),
      "Public artifact contains a known private credential.",
    );
    assert.ok(
      !/(?:postgres(?:ql)?|https?|wss?):\/\//i.test(text),
      "Public artifact contains a runtime URL.",
    );
    const value = JSON.parse(text);

    if (record.name === "application-restore-certificate.json") {
      assert.equal(value.restoreCertified, true);
      assert.equal(value.quarantineConfirmed, true);
      assert.equal(value.temporaryIdentityRemoved, true);
      assert.equal(value.inspectionSchemaRemoved, true);
    }

    if (record.name === "source-integrity.json") {
      assert.equal(value.matched, true);
      assert.equal(value.initialDigest, value.finalDigest);
    }

    if (record.name === "quarantine-observation.json") {
      assert.equal(value.connectionsAllowed, false);
      assert.equal(value.connectionLimit, 0);
    }

    const destination = join(staging, record.name);
    await writeFile(destination, before, { mode: 0o600, flag: "wx" });
    const copied = await readFile(destination);
    const after = await readFile(record.source);
    assert.equal(
      hash(copied),
      hash(before),
      "Exported record differs from its actual private bytes.",
    );
    assert.equal(hash(after), hash(before), "Actual private record changed during export.");
    assert.equal(copied.length, before.length);
    files.push({ path: record.name, sha256: hash(copied), bytes: String(copied.length) });
  }

  await writeFile(
    join(staging, "receipt.json"),
    JSON.stringify(
      {
        version: 1,
        kind: "openerp-public-local-rehearsal",
        status: "passed",
        recordedAt: new Date().toISOString(),
        syntheticOnly: true,
        files,
        providerOutcomes: "unobserved",
        productionAction: "disabled",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  assert.equal(
    await access(directory).then(
      () => true,
      () => false,
    ),
    false,
    "Public artifact output appeared during export.",
  );
  await rename(staging, directory);
  console.info(`Verified public rehearsal artifacts: ${directory}`);
};

let tokenForArtifactGuard = "";

await writeFile(join(scratch, "password"), password, { mode: 0o600 });

await run([
  join(pgBin, "initdb"),
  "-D",
  join(scratch, "cluster"),
  "-U",
  "postgres",
  "--auth-host=scram-sha-256",
  "--auth-local=trust",
  `--pwfile=${join(scratch, "password")}`,
  "--encoding=UTF8",
  "--no-locale",
]);

await run([
  join(pgBin, "pg_ctl"),
  "-D",
  join(scratch, "cluster"),
  "-l",
  join(scratch, "postgres.log"),
  "-o",
  `-h 127.0.0.1 -p ${port} -k ${scratch}`,
  "-w",
  "start",
]);

const admin = new Client({
  host: "127.0.0.1",
  port,
  user: "postgres",
  password,
  database: "postgres",
});

await admin.connect();

try {
  const identity = (
    await admin.query<{ id: string }>(
      "select system_identifier::text as id from pg_control_system()",
    )
  ).rows[0];

  assert.ok(identity);
  await admin.query("create database openerp_ops_source_rehearsal");
  await run(["bun", "apps/api/scripts/migrate.ts"], {
    ...process.env,
    DATABASE_ADMIN_URL: `postgres://postgres:${password}@127.0.0.1:${port}/openerp_ops_source_rehearsal`,
  });

  const token = randomBytes(32).toString("hex");
  tokenForArtifactGuard = token;

  const provision = await save("provision.json", {
    entity: { id: "ops-entity", name: "Synthetic local" },
    book: {
      id: "ops-book",
      name: "Synthetic local",
      currency: "SEK",
      profile: "synthetic-core-v1",
    },
    actor: {
      id: "ops-actor",
      name: "Synthetic operator",
      role: "operator",
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    fiscalYear: { id: "fy_2026", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    periods: [{ id: "period_2026", startsOn: "2026-01-01", endsOn: "2026-12-31" }],
    accounts: [
      { id: "account_bank", code: "1930", name: "Bank" },
      { id: "account_clearing", code: "2999", name: "Clearing" },
    ],
  });

  const sourceUrl = `postgres://postgres:${password}@127.0.0.1:${port}/openerp_ops_source_rehearsal`;
  await run(["bun", "apps/api/scripts/provision.ts", provision], {
    ...process.env,
    DATABASE_ADMIN_URL: sourceUrl,
    OPENERP_ACCESS_TOKEN: token,
  });
  const scope = { entityId: "ops-entity", bookId: "ops-book" };

  const invoke = <A, E>(effect: Effect.Effect<A, E, Database>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(
          databaseLayer({
            connectionString: Redacted.make(sourceUrl),
            applicationName: "onboarding-e2e",
            connectTimeoutMs: 3000,
            statementTimeoutMs: 10000,
          }),
        ),
      ),
    );

  const evidence = await invoke(
    createEvidence(token, {
      scope,
      idempotencyKey: randomUUID(),
      input: {
        title: "Synthetic independent transfer",
        content: "Literal12500minor synthetic transfer",
        mediaType: "text/plain",
        origin: "Disposable operations E2E",
      },
    }),
  );

  const plan = await invoke(
    prepareJournal(token, {
      scope,
      idempotencyKey: randomUUID(),
      input: {
        kind: "manual_journal",
        evidenceId: evidence.id,
        eventKey: randomUUID(),
        accountingPeriodId: "period_2026",
        postingDate: "2026-09-22",
        series: "A",
        description: "Synthetic transfer",
        rationale: "Exercise retained posted effects",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "account_bank",
            debitMinor: "12500",
            creditMinor: "0",
            description: "Bank debit",
          },
          {
            accountId: "account_clearing",
            debitMinor: "0",
            creditMinor: "12500",
            description: "Clearing credit",
          },
        ],
      },
    }),
  );

  const approval = await invoke(
    approveChange(token, {
      scope,
      changeSetId: plan.id,
      idempotencyKey: randomUUID(),
      input: { planDigest: plan.planDigest, version: plan.version },
    }),
  );

  const posted = await invoke(
    executeChange(token, {
      scope,
      changeSetId: plan.id,
      idempotencyKey: randomUUID(),
      input: { planDigest: plan.planDigest, version: plan.version, approvalId: approval.id },
    }),
  );

  assert.ok(posted.voucherId);
  const source = new Client({ connectionString: sourceUrl });
  await source.connect();
  await source.query(
    "insert into openerp.intake_contents(book_id,sha256,bytes) select 'ops-book','sha256:'||encode(sha256(convert_to('original synthetic statement','UTF8')),'hex'),convert_to('original synthetic statement','UTF8')",
  );

  const originalBytes = new TextEncoder().encode("Retained synthetic object actual bytes");
  const originalSha256 = hash(originalBytes);
  const objectKey = `v1/ops-book/${originalSha256}`;
  const objectDirectory = join(scratch, "original-objects");
  const originals = await fileObjectStore(objectDirectory);
  await originals.put(objectKey, originalBytes);
  process.env.OPENERP_OBJECT_DIRECTORY = objectDirectory;
  await source.query(
    "INSERT INTO openerp.intake_contents(book_id,sha256,bytes,object_key,byte_length) VALUES('ops-book',$1,NULL,$2,$3)",
    [`sha256:${originalSha256}`, objectKey, originalBytes.length],
  );

  const balances = await source.query<{ account: string; amount: string }>(
    "select account_id as account,sum(debit_minor-credit_minor)::text as amount from openerp.journal_lines where book_id='ops-book' group by account_id order by account_id",
  );

  assert.deepEqual(balances.rows, [
    { account: "account_bank", amount: "12500" },
    { account: "account_clearing", amount: "-12500" },
  ]);
  assert.equal(
    (
      await source.query<{ count: string }>(
        "select count(*)::text as count from openerp.outbox where kind='voucher.posted.v1'",
      )
    ).rows[0]?.count,
    "1",
  );
  await source.query(
    "insert into openerp.fiscal_years(book_id,id,starts_on,ends_on) values('ops-book','fy_2025','2025-01-01','2025-12-31')",
  );
  await source.query(
    "insert into openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) values('ops-book','period_2025','fy_2025','2025-01-01','2025-12-31')",
  );

  const priorPlan = await invoke(
    prepareJournal(token, {
      scope,
      idempotencyKey: randomUUID(),
      input: {
        kind: "manual_journal",
        evidenceId: evidence.id,
        eventKey: randomUUID(),
        accountingPeriodId: "period_2025",
        postingDate: "2025-12-31",
        series: "A",
        description: "Prior synthetic transfer",
        rationale: "Establish actual prior balance",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "account_bank",
            debitMinor: "12500",
            creditMinor: "0",
            description: "Prior bank",
          },
          {
            accountId: "account_clearing",
            debitMinor: "0",
            creditMinor: "12500",
            description: "Prior clearing",
          },
        ],
      },
    }),
  );

  const priorApproval = await invoke(
    approveChange(token, {
      scope,
      changeSetId: priorPlan.id,
      idempotencyKey: randomUUID(),
      input: { planDigest: priorPlan.planDigest, version: priorPlan.version },
    }),
  );

  await invoke(
    executeChange(token, {
      scope,
      changeSetId: priorPlan.id,
      idempotencyKey: randomUUID(),
      input: {
        planDigest: priorPlan.planDigest,
        version: priorPlan.version,
        approvalId: priorApproval.id,
      },
    }),
  );
  await source.end();

  const report = await invoke(
    prepareReport(token, {
      scope,
      idempotencyKey: randomUUID(),
      input: { kind: "trial_balance_v1", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    }),
  );

  const artifact = await invoke(
    prepareSie4E(token, {
      scope,
      idempotencyKey: randomUUID(),
      input: {
        fiscalYearId: "fy_2026",
        asOf: "2026-12-31",
        legalName: "Synthetic Rehearsal AB",
        organizationNumber: "555555-5555",
        legalNameEvidenceId: evidence.id,
        accountClassifications: [
          { accountId: "account_bank", accountClass: "balance_sheet" },
          { accountId: "account_clearing", accountClass: "balance_sheet" },
        ],
      },
    }),
  );

  assert.ok(artifact.artifact);

  const financialEvidence = await save("financial-source.json", {
    sequence: "2",
    balances: { account_bank: "25000", account_clearing: "-25000" },
    evidenceId: evidence.id,
    evidenceSha256: hash("Literal12500minor synthetic transfer"),
    receiptId: posted.id,
    reportId: report.id,
    artifactSha256: artifact.artifact.sha256,
  });

  const target = {
    version: 1,
    dataClass: "synthetic-local-only",
    host: "127.0.0.1",
    port,
    database: "openerp_ops_source_rehearsal",
    user: "postgres",
    password,
    expectedSystemIdentifier: identity.id,
    pgBinDirectory: pgBin,
  };

  const targetPath = await save("target.json", target),
    adminPath = await save("admin.json", { ...target, database: "postgres" });

  const release = join(scratch, "release");
  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    "capture-release",
    resolve("."),
    release,
  ]);
  const captured = JSON.parse(await readFile(join(release, "release.json"), "utf8"));
  const sourceDigest = `sha256:${hash(JSON.stringify(captured.files))}`;
  const commit = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();

  const checkpointConfig = {
    version: 1,
    targetPath,
    sourceRoot: resolve("."),
    bookId: "ops-book",
    requiredPackets: ["NEXT-25"],
    rows: [
      {
        scope: "synthetic-local-recovery",
        requiredBehavior: "Recover exact posted effects and native retained bytes",
        applicability: "yes",
        implementedRevision: `commit_${commit}`,
        observedEvidence: "financial-source",
        blockers: [],
        responsibleOwner: "operations-owner",
      },
    ],
    handoffs: [
      {
        packet: "NEXT-25",
        sourceDigest,
        observedAssertions: ["Posted ledger25000 and native artifact retained"],
        evidence: [
          {
            id: "financial-source",
            path: financialEvidence,
            sha256: hash(await readFile(financialEvidence)),
          },
        ],
      },
    ],
  };

  const staleConfig = await save("stale-checkpoint.json", {
    ...checkpointConfig,
    handoffs: [{ ...checkpointConfig.handoffs[0], sourceDigest: `sha256:${"0".repeat(64)}` }],
  });

  const stale = await expectRefusal(
    ["rehearsal-checkpoint", staleConfig, join(scratch, "stale")],
    "StaleEvidence",
  );

  const config = await save("checkpoint-input.json", checkpointConfig);
  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    "rehearsal-checkpoint",
    config,
    join(scratch, "checkpoint"),
  ]);
  const checkpointPath = join(scratch, "checkpoint", "checkpoint.json");
  const checkpointDigest = hash(await readFile(checkpointPath));
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  assert.equal(checkpoint.sourceDigest, sourceDigest);
  assert.deepEqual(checkpoint.acceptanceLedger.waitingHandoffs, []);
  const supplementary = join(scratch, "supplementary");
  await mkdir(supplementary, { mode: 0o700 });
  const custody = "Synthetic configuration recovery procedure. No actual secret.";
  await writeFile(join(supplementary, "custody.txt"), custody, { mode: 0o600 });

  const recoveryPlan = await save("recovery-plan.json", {
    version: 1,
    operatorId: "operations-owner",
    releaseDirectory: join(scratch, "checkpoint", "release"),
    supplementaryDirectory: supplementary,
    artifacts: [
      {
        path: "custody.txt",
        bytes: String(Buffer.byteLength(custody)),
        sha256: hash(custody),
        kind: "configuration",
        referenceId: "synthetic-custody",
      },
    ],
    configuration: ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"].map((name) => ({
      name,
      custodyReference: "synthetic-custody",
      procedurePath: "custody.txt",
    })),
  });

  const bundle = join(scratch, "bundle");
  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    "backup",
    targetPath,
    bundle,
    recoveryPlan,
    "--confirm-local-backup",
  ]);
  const manifestDigest = (await readFile(join(bundle, "manifest.sha256"), "utf8")).trim();
  const verifyArgs = ["rehearsal-verify", bundle, manifestDigest, checkpointPath, checkpointDigest];
  const missing = join(scratch, "missing-member");
  await cp(bundle, missing, { recursive: true, force: false });
  await unlink(join(missing, "objects", objectKey));

  const missingMember = await expectRefusal(
    [
      "rehearsal-verify",
      missing,
      manifestDigest,
      checkpointPath,
      checkpointDigest,
      join(scratch, "missing-certificate.json"),
    ],
    "BackupIncomplete",
  );

  const unhandled = join(scratch, "unhandled-family");
  await cp(bundle, unhandled, { recursive: true, force: false });
  const unsupportedManifest = JSON.parse(await readFile(join(unhandled, "manifest.json"), "utf8"));
  await writeFile(join(unhandled, "unexpected.bin"), "Unhandled synthetic family", { mode: 0o600 });
  unsupportedManifest.files.push({
    path: "unexpected.bin",
    bytes: "26",
    sha256: hash("Unhandled synthetic family"),
  });
  await writeFile(join(unhandled, "manifest.json"), JSON.stringify(unsupportedManifest), {
    mode: 0o600,
  });

  const unhandledFamily = await expectRefusal(
    [
      "rehearsal-verify",
      unhandled,
      hash(await readFile(join(unhandled, "manifest.json"))),
      checkpointPath,
      checkpointDigest,
      join(scratch, "unhandled-certificate.json"),
    ],
    "UnhandledFamily",
  );

  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    ...verifyArgs,
    join(scratch, "backup-certificate.json"),
  ]);
  const recovered = join(scratch, "recovered");
  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    "rehearsal-restore",
    adminPath,
    bundle,
    manifestDigest,
    checkpointPath,
    checkpointDigest,
    "openerp_restore_rehearsal_e2e",
    recovered,
    "--confirm-fresh-local-restore",
  ]);

  const restored = JSON.parse(
    await readFile(join(recovered, "application-restore-certificate.json"), "utf8"),
  );

  assert.equal(restored.restoreCertified, true);
  assert.equal(JSON.parse(restored.application.tables.books[0]).committed_sequence, 2);
  assert.equal(restored.application.tables.execution_receipts.length, 2);
  assert.equal(restored.application.tables.sie_book_export_artifacts.length, 1);
  const recoveredBalances: Record<string, bigint> = {};

  for (const body of restored.application.tables.journal_lines) {
    const line = JSON.parse(body);
    recoveredBalances[line.account_id] =
      (recoveredBalances[line.account_id] ?? 0n) +
      BigInt(String(line.debit_minor)) -
      BigInt(String(line.credit_minor));
  }

  assert.deepEqual(recoveredBalances, { account_bank: 25000n, account_clearing: -25000n });
  const recoveredArtifact = JSON.parse(restored.application.tables.sie_book_export_artifacts[0]);
  assert.equal(
    hash(Buffer.from(recoveredArtifact.content.slice(2), "hex")),
    artifact.artifact.sha256,
  );
  assert.equal(
    recoveredArtifact.descriptor.byteLength,
    Buffer.from(recoveredArtifact.content.slice(2), "hex").length,
  );
  assert.ok(
    restored.application.tables.intake_contents.some(
      (body: string) => JSON.parse(body).sha256 === `sha256:${originalSha256}`,
    ),
  );
  assert.equal(
    JSON.parse(restored.application.tables.evidence[0]).sha256,
    hash("Literal12500minor synthetic transfer"),
  );
  assert.deepEqual(restored.fences, {
    crossBook: "denied",
    write: "denied",
    credentials: "denied",
    post: "local_admission_fence",
    approve: "local_admission_fence",
    dispatch: "local_admission_fence",
  });

  const quarantine = (
    await admin.query<{ connectionsAllowed: boolean; connectionLimit: number }>(
      'SELECT datallowconn AS "connectionsAllowed", datconnlimit AS "connectionLimit" FROM pg_database WHERE datname=$1',
      ["openerp_restore_rehearsal_e2e"],
    )
  ).rows[0];

  assert.ok(quarantine);
  assert.equal(quarantine.connectionsAllowed, false);
  assert.equal(quarantine.connectionLimit, 0);
  await save("quarantine-observation.json", {
    database: "openerp_restore_rehearsal_e2e",
    ...quarantine,
    observedAt: new Date().toISOString(),
  });

  const staleCheckpoint = await expectRefusal(
    [
      "rehearsal-restore",
      adminPath,
      bundle,
      manifestDigest,
      checkpointPath,
      "0".repeat(64),
      "openerp_restore_stale_e2e",
      join(scratch, "stale-restored"),
      "--confirm-fresh-local-restore",
    ],
    "StaleEvidence",
  );

  assert.equal(
    (await admin.query("select 1 from pg_database where datname='openerp_restore_stale_e2e'"))
      .rowCount,
    0,
  );

  const missingHandoffConfig = await save("missing-handoff-input.json", {
    ...checkpointConfig,
    handoffs: [],
    rows: [{ ...checkpointConfig.rows[0], observedEvidence: null }],
  });

  const waitingDirectory = join(scratch, "waiting-checkpoint");
  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    "rehearsal-checkpoint",
    missingHandoffConfig,
    waitingDirectory,
  ]);
  const waitingPath = join(waitingDirectory, "checkpoint.json");

  const missingHandoff = await expectRefusal(
    [
      "rehearsal-verify",
      bundle,
      manifestDigest,
      waitingPath,
      hash(await readFile(waitingPath)),
      join(scratch, "waiting-certificate.json"),
    ],
    "MissingHandoff",
  );

  await admin.query("CREATE DATABASE openerp_ops_source_unavailable");

  const unavailableUrl = sourceUrl.replace(
    "openerp_ops_source_rehearsal",
    "openerp_ops_source_unavailable",
  );

  await run(["bun", "apps/api/scripts/migrate.ts"], {
    ...process.env,
    DATABASE_ADMIN_URL: unavailableUrl,
  });
  await run(["bun", "apps/api/scripts/provision.ts", provision], {
    ...process.env,
    DATABASE_ADMIN_URL: unavailableUrl,
    OPENERP_ACCESS_TOKEN: token,
  });

  const unavailableTarget = await save("unavailable-target.json", {
    ...target,
    database: "openerp_ops_source_unavailable",
  });

  const unavailableEvidence = await save("unavailable-source.json", {
    sequence: "0",
    receipts: [],
    artifacts: [],
    financialObservation: "unavailable",
  });

  const unavailableInput = await save("unavailable-checkpoint-input.json", {
    ...checkpointConfig,
    targetPath: unavailableTarget,
    handoffs: [
      {
        ...checkpointConfig.handoffs[0],
        observedAssertions: [
          "Actual empty source has unavailable financial and artifact observations",
        ],
        evidence: [
          {
            id: "financial-source",
            path: unavailableEvidence,
            sha256: hash(await readFile(unavailableEvidence)),
          },
        ],
      },
    ],
  });

  const unavailableCheckpointDirectory = join(scratch, "unavailable-checkpoint");
  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    "rehearsal-checkpoint",
    unavailableInput,
    unavailableCheckpointDirectory,
  ]);
  const unavailableCheckpoint = join(unavailableCheckpointDirectory, "checkpoint.json");

  const unavailablePlan = await save("unavailable-plan.json", {
    ...JSON.parse(await readFile(recoveryPlan, "utf8")),
    releaseDirectory: join(unavailableCheckpointDirectory, "release"),
  });

  const unavailableBundle = join(scratch, "unavailable-bundle");
  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    "backup",
    unavailableTarget,
    unavailableBundle,
    unavailablePlan,
    "--confirm-local-backup",
  ]);

  const unavailableBundleHash = (
    await readFile(join(unavailableBundle, "manifest.sha256"), "utf8")
  ).trim();

  const unavailableDirectory = join(scratch, "unavailable-restored");

  const unavailable = await expectRefusal(
    [
      "rehearsal-restore",
      adminPath,
      unavailableBundle,
      unavailableBundleHash,
      unavailableCheckpoint,
      hash(await readFile(unavailableCheckpoint)),
      "openerp_restore_unavailable_e2e",
      unavailableDirectory,
      "--confirm-fresh-local-restore",
    ],
    "StaleEvidence",
  );

  const unavailableObservations = JSON.parse(
    await readFile(join(unavailableDirectory, "application-restore-observations.json"), "utf8"),
  );

  assert.equal(unavailableObservations.comparison.artifactBytesMatch, "unavailable");
  assert.equal(unavailableObservations.comparison.receiptsMatch, "unavailable");
  assert.equal(unavailableObservations.quarantineConfirmed, true);
  assert.equal(unavailableObservations.temporaryIdentityRemoved, true);
  assert.equal(unavailableObservations.inspectionSchemaRemoved, true);
  assert.equal(
    await access(join(unavailableDirectory, "application-restore-certificate.json")).then(
      () => true,
      () => false,
    ),
    false,
  );
  const unavailableSource = new Client({ connectionString: unavailableUrl });
  await unavailableSource.connect();
  await unavailableSource.query("CREATE SEQUENCE openerp.unhandled_fixture");
  await unavailableSource.end();

  const unknownSequence = await expectRefusal(
    ["rehearsal-checkpoint", unavailableInput, join(scratch, "unknown-sequence-checkpoint")],
    "UnhandledFamily",
  );

  const finalRelease = join(scratch, "final-release");
  await run([
    "bun",
    "apps/api/scripts/operations/cli.ts",
    "capture-release",
    resolve("."),
    finalRelease,
  ]);
  const finalInventory = JSON.parse(await readFile(join(finalRelease, "release.json"), "utf8"));
  const finalSourceDigest = `sha256:${hash(JSON.stringify(finalInventory.files))}`;
  assert.equal(finalSourceDigest, sourceDigest);

  const sourceIntegrity = {
    initialDigest: sourceDigest,
    finalDigest: finalSourceDigest,
    matched: true,
    fileCount: captured.files.length,
  };

  await save("source-integrity.json", sourceIntegrity);
  await writeFile(
    join(scratch, "journey.json"),
    JSON.stringify(
      {
        status: "restricted-local-restore-passed",
        stale,
        missingMember,
        unhandledFamily,
        staleCheckpoint,
        missingHandoff,
        unavailable,
        unavailableObservations,
        unknownSequence,
        originalSha256,
        sourceIntegrity,
        checkpointDigest,
        checkpoint,
        restored,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  const publicRecords = [
    { name: "journey.json", source: join(scratch, "journey.json") },
    { name: "checkpoint.json", source: checkpointPath },
    { name: "backup-verification.json", source: join(scratch, "backup-certificate.json") },
    {
      name: "application-restore-certificate.json",
      source: join(recovered, "application-restore-certificate.json"),
    },
    {
      name: "application-restore-observations.json",
      source: join(recovered, "application-restore-observations.json"),
    },
    { name: "quarantine-observation.json", source: join(scratch, "quarantine-observation.json") },
    { name: "source-integrity.json", source: join(scratch, "source-integrity.json") },
  ];

  completedRecords = await Promise.all(
    publicRecords.map(async (record) => {
      const bytes = await readFile(record.source);

      return { ...record, sha256: hash(bytes), bytes: String(bytes.length) };
    }),
  );
} finally {
  try {
    await admin.end();
  } finally {
    await run([join(pgBin, "pg_ctl"), "-D", join(scratch, "cluster"), "-m", "fast", "-w", "stop"]);
  }
}

assert.ok(completedRecords, "No complete actual rehearsal record exists.");

const publicArtifacts = process.env.OPENERP_REHEARSAL_ARTIFACTS;

if (publicArtifacts !== undefined) await exportPublicArtifacts(publicArtifacts, completedRecords);

console.info(`Repeatable synthetic rehearsal artifact: ${join(scratch, "journey.json")}`);
