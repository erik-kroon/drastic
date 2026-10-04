import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile, mkdir, realpath, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Database, databaseLayer } from "../../src/db/connection";
import { recordCompanyFact } from "../../src/application/company-profiles";
import {
  createEvidence,
  prepareJournal,
  approveChange,
  executeChange,
} from "../../src/application/posting";
import { observeOnboardingOperations, activateOnboardingLocally } from "./onboarding";

process.umask(0o077);

const scratch = await realpath(await mkdtemp(join(tmpdir(), "openerp-onboarding-ops-")));

const pgBin = await realpath(process.env["PG_BINDIR"] ?? "/opt/homebrew/opt/postgresql@17/bin");

const port = 56000 + Math.floor(Math.random() * 4000);

const password = randomBytes(24).toString("hex");

const run = async (args: string[], env: Record<string, string | undefined> = process.env) => {
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
  const status = await child.exited;
  assert.equal(status, 0, `Command failed (${args[0]}). Private diagnostics retained.`);
};

const save = async (name: string, value: unknown) => {
  const path = join(scratch, name);
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });

  return path;
};

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
  await admin.query("create database openerp_ops_source_onboarding");
  await admin.query("create database openerp_ops_prior_onboarding");
  await run(["bun", "apps/api/scripts/migrate.ts"], {
    ...process.env,
    DATABASE_ADMIN_URL: `postgres://postgres:${password}@127.0.0.1:${port}/openerp_ops_source_onboarding`,
  });

  const token = randomBytes(32).toString("hex");

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

  const sourceUrl = `postgres://postgres:${password}@127.0.0.1:${port}/openerp_ops_source_onboarding`;
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
  await source.end();
  await invoke(
    recordCompanyFact(token, {
      scope,
      idempotencyKey: randomUUID(),
      input: {
        factKind: "account_chart",
        value: { state: "known", value: "Independent synthetic chart" },
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        evidence: [{ evidenceId: evidence.id, sha256: evidence.sha256 }],
        note: "Entity-owned fact evidence must survive scoped recovery closure",
      },
    }),
  );

  const pgEnv = {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    PGUSER: "postgres",
    PGPASSWORD: password,
  };

  await run(
    [
      join(pgBin, "pg_dump"),
      "--format=custom",
      "--file",
      join(scratch, "prior.dump"),
      "openerp_ops_source_onboarding",
    ],
    pgEnv,
  );
  await run(
    [
      join(pgBin, "pg_restore"),
      "--exit-on-error",
      "--dbname",
      "openerp_ops_prior_onboarding",
      join(scratch, "prior.dump"),
    ],
    pgEnv,
  );

  const prior = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: "openerp_ops_prior_onboarding",
  });

  await prior.connect();
  await prior.query(
    `create role onboarding_prior_writer login password ${prior.escapeLiteral(password)}; grant openerp_runtime to onboarding_prior_writer; grant connect on database openerp_ops_prior_onboarding to onboarding_prior_writer`,
  );
  await prior.end();

  const target = {
    version: 1,
    dataClass: "synthetic-local-only",
    host: "127.0.0.1",
    port,
    database: "openerp_ops_source_onboarding",
    user: "postgres",
    password,
    expectedSystemIdentifier: identity.id,
    pgBinDirectory: pgBin,
  };

  const targetPath = await save("target.json", target);
  const credentialPath = await save("writer.json", { role: "onboarding_prior_writer", password });
  const supplementary = join(scratch, "supplementary");
  await mkdir(supplementary, { mode: 0o700 });

  const configuration = {
    kind: "synthetic-onboarding-configuration-v1",
    secret: randomBytes(32).toString("hex"),
    origin: "http://127.0.0.1:3000",
  };

  await writeFile(
    join(supplementary, "synthetic-configuration.json"),
    JSON.stringify(configuration),
    { mode: 0o600 },
  );

  const configPath = await save("operation.json", {
    version: 1,
    targetPath,
    priorDatabase: "openerp_ops_prior_onboarding",
    writerCredentialPaths: [credentialPath],
    operationId: "operations-e2e",
    bookId: "ops-book",
    snapshotId: "synthetic-unregistered",
    outputDirectory: join(scratch, "observation"),
    releaseRoot: resolve("."),
    supplementaryDirectory: supplementary,
    configurationPath: "synthetic-configuration.json",
    restoreDatabase: "openerp_restore_onboarding_e2e",
  });

  const interrupted = Bun.spawn(
    ["bun", "apps/api/scripts/operations/onboarding-cli.ts", "observe", configPath],
    { stdout: "pipe", stderr: "pipe" },
  );

  const deadline = Date.now() + 20000;
  let fencedStage = false;

  while (Date.now() < deadline) {
    const names = await readdir(join(scratch, "observation")).catch(() => []);

    if (names.some((name) => name.endsWith("-fenced.json"))) {
      fencedStage = true;
      break;
    }

    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
  }

  interrupted.kill("SIGKILL");
  await interrupted.exited;
  assert.equal(
    fencedStage,
    true,
    "The operation must retain its actual physical fence before interruption.",
  );
  assert.equal(
    (
      await admin.query<{ closed: boolean }>(
        "select not datallowconn and datconnlimit=0 as closed from pg_database where datname='openerp_ops_prior_onboarding'",
      )
    ).rows[0]?.closed,
    true,
  );
  const proof = await observeOnboardingOperations(configPath);
  assert.equal(proof.kind, "synthetic_local_writer_fence_restore_v1");
  assert.equal(proof.priorWriterFence.reconnectRefused, true);
  assert.equal(proof.priorWriterFence.writeRefused, true);
  assert.equal(proof.applicationRecovery.writeRefused, true);
  assert.equal(proof.configurationRecovery, "synthetic-bytes-recovered-and-exercised");
  assert.equal(proof.productionAction, "disabled");
  const replay = await observeOnboardingOperations(configPath);
  assert.deepEqual(replay, proof);

  const quarantined = (
    await admin.query<{ closed: boolean }>(
      "select not datallowconn and datconnlimit=0 as closed from pg_database where datname=$1",
      [proof.recoveredDatabase],
    )
  ).rows[0];

  assert.equal(quarantined?.closed, true);

  const role = (
    await admin.query<{ login: boolean }>(
      "select rolcanlogin as login from pg_roles where rolname='onboarding_prior_writer'",
    )
  ).rows[0];

  assert.equal(role?.login, false);
  await assert.rejects(activateOnboardingLocally(configPath, "unregistered-intent"));
  const runtimeProbe = new Client({ connectionString: sourceUrl });
  await runtimeProbe.connect();
  await runtimeProbe.query("set role openerp_runtime");
  await assert.rejects(
    runtimeProbe.query(
      "update openerp.books set authority='onboarding_fenced' where id='ops-book'",
    ),
    (cause: Error & { code?: string }) => cause.code === "42501",
  );

  const proofPrivilege = (
    await runtimeProbe.query<{ allowed: boolean }>(
      "select has_table_privilege(current_user,'openerp.onboarding_operational_proofs','INSERT') as allowed",
    )
  ).rows[0];

  assert.equal(proofPrivilege?.allowed, false);
  await runtimeProbe.end();
  const observationPath = join(scratch, "observation", "observation.json");
  const retainedObservation = await readFile(observationPath, "utf8");
  await writeFile(
    observationPath,
    retainedObservation.replace(proof.backupManifestDigest, "0".repeat(64)),
    { mode: 0o600 },
  );
  await assert.rejects(observeOnboardingOperations(configPath));
  await writeFile(observationPath, retainedObservation, { mode: 0o600 });
  await admin.query("alter role onboarding_prior_writer login");
  await assert.rejects(observeOnboardingOperations(configPath));
  await admin.query("alter role onboarding_prior_writer nologin");

  await writeFile(
    join(scratch, "journey.json"),
    JSON.stringify(
      {
        status: "passed",
        proof,
        independentlyExpectedBalances: { account_bank: "12500", account_clearing: "-12500" },
        postedVoucherId: posted.voucherId,
        vectors: [
          "old-session-write-refused",
          "old-credential-reconnect-refused",
          "restricted-write-refused",
          "restored-plain-application-reads",
          "synthetic-config-exercised",
          "exact-replay",
          "quarantine-retained",
          "actual-process-crash-after-fence-and-resume",
          "unregistered-proof-activation-refused",
          "runtime-authority-update-refused",
          "runtime-proof-insertion-privilege-refused",
          "tampered-proof-artifact-refused",
          "physical-fence-drift-refused",
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  assert.ok(await readFile(join(scratch, "journey.json")));
  const artifactDirectory = resolve("test-results/onboarding-operations");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    join(artifactDirectory, "journey.json"),
    await readFile(join(scratch, "journey.json")),
    { mode: 0o600 },
  );
  await writeFile(
    join(artifactDirectory, "README.md"),
    "Run `bun apps/api/scripts/operations/onboarding-e2e.ts` from the repository root. PostgreSQL17 binaries are required; set PG_BINDIR if needed. The command owns a fresh disposable loopback cluster and retains sanitized journey.json here. Private backup/configuration/originals remain outside the repository. This is synthetic operational proof, not company or statutory acceptance.\n",
    { mode: 0o600 },
  );
  console.info(`Repeatable synthetic operation artifact: ${join(scratch, "journey.json")}`);
} finally {
  await admin.end();
  await run([join(pgBin, "pg_ctl"), "-D", join(scratch, "cluster"), "-m", "fast", "-w", "stop"]);
}
