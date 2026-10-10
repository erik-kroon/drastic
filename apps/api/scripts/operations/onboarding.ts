import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import { databaseLayer } from "../../src/db/connection";
import * as O from "@open-erp/contracts/onboarding";
import {
  fenceOnboardingTarget,
  retainProofAndActivate,
  retainOperationalProof,
} from "../../src/application/onboarding/index";
import { readOnboardingRecovery } from "../../src/application/onboarding/index";
import { captureRelease } from "./artifacts";
import { backup, restore } from "./workflows";
import {
  connect,
  fingerprint,
  newDirectory,
  privatePath,
  readTarget,
  refuse,
  writePrivate,
} from "./safety";

const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,62}$/));

const Config = Schema.Struct({
  version: Schema.Literal(1),
  targetPath: Schema.String,
  priorDatabase: Name,
  targetWriterRoles: Schema.optional(Schema.Array(Name)),
  writerCredentialPaths: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  operationId: Schema.String.check(Schema.isPattern(/^[a-z0-9_-]{1,100}$/)),
  bookId: Schema.String,
  snapshotId: Schema.String,
  outputDirectory: Schema.String,
  releaseRoot: Schema.String,
  supplementaryDirectory: Schema.String,
  configurationPath: Schema.Literal("synthetic-configuration.json"),
  restoreDatabase: Name,
}).annotate({ parseOptions: { onExcessProperty: "error" } });

const Credential = Schema.Struct({
  role: Name,
  password: Schema.String.check(Schema.isMinLength(1)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

const SyntheticConfiguration = Schema.Struct({
  kind: Schema.Literal("synthetic-onboarding-configuration-v1"),
  secret: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  origin: Schema.Literal("http://127.0.0.1:3000"),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

const Observation = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  bookId: Schema.String,
  snapshotId: Schema.String,
  snapshotDigest: Schema.NullOr(Schema.String),
  entityId: Schema.String,
  kind: Schema.Literal("synthetic_local_writer_fence_restore_v1"),
  sourceSystemIdentifier: Schema.String,
  sourceDatabase: Schema.String,
  targetDatabase: Schema.String,
  recoveredDatabase: Schema.String,
  priorWriterRoles: Schema.Array(Name),
  observedAt: Schema.String,
  priorWriterFence: Schema.Struct({
    reconnectRefused: Schema.Literal(true),
    writeRefused: Schema.Literal(true),
    watermarkDigest: Schema.String,
  }),
  applicationRecovery: Schema.Struct({
    readDigest: Schema.String,
    writeRefused: Schema.Literal(true),
  }),
  configurationRecovery: Schema.Literal("synthetic-bytes-recovered-and-exercised"),
  backupManifestDigest: Schema.String,
  recoveryElapsedMs: Schema.Int,
  productionAction: Schema.Literal("disabled"),
});

type Target = Awaited<ReturnType<typeof readTarget>>;

type Writer = typeof Credential.Type;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function recoveryRead(target: Target, database: string, bookId: string, credential?: Writer) {
  const user = credential?.role ?? target.user;
  const password = credential?.password ?? target.password;
  const url = new URL(`postgres://${target.host}:${target.port}/${database}`);
  url.username = user;
  url.password = password;

  return Effect.runPromise(
    readOnboardingRecovery(bookId).pipe(
      Effect.provide(
        databaseLayer({
          connectionString: Redacted.make(url.toString()),
          applicationName: "openerp-onboarding-recovery-read",
          connectTimeoutMs: 3000,
          statementTimeoutMs: 10000,
        }),
      ),
    ),
  );
}

async function credentialClient(target: Target, database: string, writer: Writer) {
  const client = new Client({
    host: target.host,
    port: target.port,
    database,
    user: writer.role,
    password: writer.password,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    application_name: "openerp-onboarding-recovery",
  });

  client.on("error", () => undefined);
  await client.connect();

  return client;
}

async function absentProviders(client: Client) {
  const result = await client.query<{ safe: boolean }>(`
    select not exists(select from openerp.bank_connector_consents)
      and not exists(select from openerp.outbox where kind <> 'voucher.posted.v1')
      and not exists(select from openerp.preparation_jobs)
      and not exists(select from public.effect_mq_jobs)
      and not exists(select from openerp_auth.account where access_token is not null or refresh_token is not null or id_token is not null)
      and not exists(select from openerp.books where profile <> 'synthetic-core-v1') as safe`);

  if (result.rows[0]?.safe !== true)
    refuse("Unknown providers, durable work or actual-company data are unsupported.");
}

async function observedFence(admin: Client, database: string, roles: readonly string[]) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await admin.query<{ safe: boolean }>(
      `
    select not datallowconn and datconnlimit=0
      and not exists(select from pg_stat_activity where datname=$1 and pid<>pg_backend_pid())
      and not exists(select from pg_roles where rolname=any($2::text[]) and (rolcanlogin or rolinherit or rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls))
      and not exists(select from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=any($2::text[])) as safe
    from pg_database where datname=$1`,
      [database, roles],
    );

    if (result.rows[0]?.safe === true) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  refuse("The prior writer fence is not physically current.");
}

export async function observeOnboardingOperations(configPath: string) {
  await privatePath(configPath, false);
  const configBytes = await readFile(configPath, "utf8");
  const config = Schema.decodeUnknownSync(Config)(JSON.parse(configBytes));

  if (!/^openerp_ops_prior_[a-z0-9_]+$/.test(config.priorDatabase))
    refuse("Prior database must be dedicated synthetic local inventory.");
  const target = await readTarget(config.targetPath);

  if (
    !/^openerp_ops_source_[a-z0-9_]+$/.test(target.database) ||
    target.database === config.priorDatabase
  )
    refuse("Target and prior databases must be distinct dedicated synthetic databases.");

  const writers = await Promise.all(
    config.writerCredentialPaths.map(async (path) => {
      await privatePath(path, false);

      return Schema.decodeUnknownSync(Credential)(JSON.parse(await readFile(path, "utf8")));
    }),
  );

  const roles = writers.map((writer) => writer.role);

  const commandDigest = hash(
    configBytes + hash(JSON.stringify(target)) + hash(JSON.stringify(writers)),
  );

  if (new Set(roles).size !== roles.length) refuse("Writer roles must be unique.");
  const admin = await connect(target, "postgres");
  const source = await connect(target);

  const stage = async (name: string, body: Schema.JsonObject) => {
    const id = `${Date.now()}-${randomUUID()}-${name}`;
    await writePrivate(join(config.outputDirectory, `${id}.json`), JSON.stringify(body, null, 2));
    await source.query(
      "insert into openerp.onboarding_operation_stages(book_id,operation_id,id,body) values($1,$2,$3,$4::jsonb)",
      [config.bookId, config.operationId, id, JSON.stringify(body)],
    );
  };

  try {
    await source.query(
      "insert into openerp.onboarding_operation_runs(book_id,id,configuration_digest,body) values($1,$2,$3,$4::jsonb) on conflict do nothing",
      [
        config.bookId,
        config.operationId,
        commandDigest,
        JSON.stringify({
          id: config.operationId,
          bookId: config.bookId,
          snapshotId: config.snapshotId,
          configurationDigest: commandDigest,
          productionAction: "disabled",
        }),
      ],
    );

    const run = (
      await source.query<{ digest: string }>(
        "select configuration_digest as digest from openerp.onboarding_operation_runs where book_id=$1 and id=$2",
        [config.bookId, config.operationId],
      )
    ).rows[0];

    if (run?.digest !== commandDigest)
      refuse("An operational key cannot be reused with changed private inputs.");

    const book = (
      await source.query<{ entity: string; authority: string }>(
        "select entity_id as entity,authority from openerp.books where id=$1",
        [config.bookId],
      )
    ).rows[0];

    if (!book) refuse("The configured book does not exist.");

    const snapshotRow = (
      await source.query<{ body: unknown }>(
        "select body from openerp.onboarding_snapshots where book_id=$1 and id=$2",
        [config.bookId, config.snapshotId],
      )
    ).rows[0];

    const snapshot = snapshotRow
      ? Schema.decodeUnknownSync(O.OnboardingSnapshot)(snapshotRow.body)
      : null;

    if (
      snapshot !== null &&
      (snapshot.purpose !== "activation" || book.authority !== "onboarding_fenced")
    )
      refuse("Activation proof requires an activation snapshot captured after target fencing.");
    let resumed = false;
    let recoveryDirectory = config.outputDirectory;
    let restoreDatabase = config.restoreDatabase;
    const existing = await lstat(config.outputDirectory).catch(() => undefined);

    if (existing) {
      await privatePath(config.outputDirectory, true);

      const intent = JSON.parse(
        await readFile(join(config.outputDirectory, "intent.json"), "utf8"),
      );

      if (intent.configDigest !== commandDigest)
        refuse("An operation key cannot be reused with changed configuration.");
      await observedFence(admin, config.priorDatabase, roles);

      const saved = await readFile(join(config.outputDirectory, "observation.json"), "utf8").catch(
        () => undefined,
      );

      if (saved) {
        const observation = Schema.decodeUnknownSync(Observation)(JSON.parse(saved));

        const retained = await source.query(
          "select 1 from openerp.onboarding_operation_stages where book_id=$1 and operation_id=$2 and body->>'observationDigest'=$3",
          [config.bookId, config.operationId, hash(JSON.stringify(observation))],
        );

        if (retained.rowCount !== 1 || observation.snapshotDigest !== (snapshot?.digest ?? null))
          refuse("The retained observation differs from its durable stage or activation snapshot.");
        await absentProviders(source);
        const current = await recoveryRead(target, target.database, config.bookId);

        if (hash(JSON.stringify(current)) !== observation.applicationRecovery.readDigest)
          refuse("The retained operational proof has stale accounting effects.");

        return observation;
      }

      resumed = true;
      recoveryDirectory = join(config.outputDirectory, `recovery-${randomUUID()}`);
      restoreDatabase = `openerp_restore_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      await newDirectory(recoveryDirectory);
      await stage("resume-intent", {
        priorDatabase: config.priorDatabase,
        roles,
        restoreDatabase,
        automaticUnfence: false,
      });
    }

    if (!resumed) {
      await newDirectory(config.outputDirectory);
      await writePrivate(
        join(config.outputDirectory, "intent.json"),
        JSON.stringify({
          operationId: config.operationId,
          configDigest: commandDigest,
          productionAction: "disabled",
          createdAt: new Date().toISOString(),
        }),
      );
    }

    if (!resumed) {
      const priorState = (
        await admin.query<{ closed: boolean }>(
          "select not datallowconn and datconnlimit=0 as closed from pg_database where datname=$1",
          [config.priorDatabase],
        )
      ).rows[0];

      if (priorState?.closed === true) {
        await observedFence(admin, config.priorDatabase, roles);
        resumed = true;
        await stage("already-fenced-recovery-intent", {
          priorDatabase: config.priorDatabase,
          roles,
          automaticUnfence: false,
        });
      }
    }

    const privilege = await admin.query<{ safe: boolean }>(
      `
      select not exists(select from pg_roles where rolsuper and rolname<>current_user)
        and not exists(select from pg_roles where rolname=any($1::text[]) and (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls))
        and not exists(select from pg_database d join pg_roles r on r.oid=d.datdba where d.datname=$2 and r.rolname=any($1::text[])) as safe`,
      [roles, config.priorDatabase],
    );

    if (privilege.rows[0]?.safe !== true)
      refuse("Owners, privileged writers or additional maintenance identities are unsupported.");
    let priorRead: Effect.Success<ReturnType<typeof readOnboardingRecovery>>;

    if (resumed) {
      const priorId = admin.escapeIdentifier(config.priorDatabase);

      try {
        await admin.query(`alter database ${priorId} allow_connections true`);
        const privilegeProbe = await connect(target, config.priorDatabase);

        try {
          for (const role of roles) {
            await privilegeProbe.query("begin");
            await privilegeProbe.query(`set local role ${admin.escapeIdentifier(role)}`);
            let denied = false;

            try {
              await privilegeProbe.query("update openerp.books set name=name where id=$1", [
                config.bookId,
              ]);
            } catch (cause) {
              denied = cause instanceof Error && "code" in cause && String(cause.code) === "42501";
            }

            await privilegeProbe.query("rollback");

            if (!denied) refuse("A resumed prior writer retained write grants.");
          }
        } finally {
          await privilegeProbe.end();
        }

        priorRead = await recoveryRead(target, config.priorDatabase, config.bookId);
      } finally {
        await admin.query(`alter database ${priorId} allow_connections false connection limit 0`);
      }
    } else {
      const prior = await connect(target, config.priorDatabase);
      const oldClients: Client[] = [];

      try {
        await absentProviders(prior);

        const uncontrolled = await prior.query<{ safe: boolean }>(
          `
        select not exists(select from pg_roles r where r.rolname<>current_user and not r.rolname=any($1::text[])
          and r.rolcanlogin and (has_database_privilege(r.oid,current_database(),'CREATE')
            or exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind='r'
                and has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))))
          and not exists(select from pg_class c join pg_roles r on r.oid=c.relowner where r.rolname=any($1::text[])) as safe`,
          [roles],
        );

        if (uncontrolled.rows[0]?.safe !== true)
          refuse("Uncontrolled prior writers or object-owning writer roles are unsupported.");

        for (const writer of writers) {
          const client = await credentialClient(target, config.priorDatabase, writer);
          oldClients.push(client);
          await client.query("begin");
          await client.query("update openerp.books set name=name where id=$1", [config.bookId]);
          await client.query("rollback");
        }

        await stage("fence-intent", { priorDatabase: config.priorDatabase, roles });

        for (const role of roles) {
          const identifier = admin.escapeIdentifier(role);
          await admin.query(`alter role ${identifier} nologin noinherit`);

          const memberships = await admin.query<{ name: string }>(
            "select g.rolname as name from pg_auth_members m join pg_roles r on r.oid=m.member join pg_roles g on g.oid=m.roleid where r.rolname=$1",
            [role],
          );

          for (const group of memberships.rows)
            await admin.query(`revoke ${admin.escapeIdentifier(group.name)} from ${identifier}`);
          await prior.query(
            `revoke all privileges on all tables in schema openerp,openerp_auth,public from ${identifier}`,
          );
          await prior.query(
            `revoke all privileges on all sequences in schema openerp,openerp_auth,public from ${identifier}`,
          );
        }

        const db = admin.escapeIdentifier(config.priorDatabase);

        const sessions = await admin.query<{ pid: number; user: string }>(
          "select pid,usename as user from pg_stat_activity where datname=$1 and pid<>$2",
          [
            config.priorDatabase,
            (await prior.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid,
          ],
        );

        if (sessions.rows.some((session) => !roles.includes(session.user)))
          refuse("An uncontrolled prior session is present. Database remains fenced.");

        for (const client of oldClients) {
          let denied = false;

          try {
            await client.query("update openerp.books set name=name where id=$1", [config.bookId]);
          } catch (cause) {
            denied = cause instanceof Error && "code" in cause && String(cause.code) === "42501";
          }

          if (!denied)
            refuse("The old writer did not receive a PostgreSQL write privilege refusal.");
        }

        for (const session of sessions.rows) {
          const stopped = await admin.query<{ stopped: boolean }>(
            "select pg_terminate_backend($1) as stopped",
            [session.pid],
          );

          if (stopped.rows[0]?.stopped !== true)
            refuse("An exact owned prior session could not be terminated.");
        }

        priorRead = await recoveryRead(target, config.priorDatabase, config.bookId);
        await admin.query(`alter database ${db} allow_connections false connection limit 0`);

        for (const writer of writers) {
          let denied = false;

          try {
            const unexpected = await credentialClient(target, config.priorDatabase, writer);
            await unexpected.end();
          } catch (cause) {
            denied =
              cause instanceof Error &&
              "code" in cause &&
              ["28000", "55000", "53300"].includes(String(cause.code));
          }

          if (!denied)
            refuse("Old credential rejection was not observed as a PostgreSQL admission refusal.");
        }

        await stage("fenced", {
          roles,
          watermarkDigest: hash(JSON.stringify(priorRead)),
          reconnectRefused: true,
          oldSessionWriteRefused: true,
          priorDatabase: config.priorDatabase,
        });
      } finally {
        for (const client of oldClients) await client.end();
        await prior.end();
      }
    }

    await observedFence(admin, config.priorDatabase, roles);

    if (resumed) {
      for (const writer of writers) {
        let denied = false;

        try {
          const unexpected = await credentialClient(target, config.priorDatabase, writer);
          await unexpected.end();
        } catch (cause) {
          denied =
            cause instanceof Error &&
            "code" in cause &&
            ["28000", "55000", "53300"].includes(String(cause.code));
        }

        if (!denied)
          refuse("A resumed old credential lacked a verified PostgreSQL admission refusal.");
      }
    }

    const targetRoles = config.targetWriterRoles ?? [];

    const targetWriters = await source.query<{ safe: boolean }>(
      `
      select not exists(select from pg_roles r where r.rolcanlogin and r.rolname<>current_user
        and not r.rolname=any($1::text[]) and exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind='r' and has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')))
        and not exists(select from pg_roles r where r.rolname=any($1::text[]) and (r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls))
        and not exists(select from pg_class c join pg_roles r on r.oid=c.relowner where r.rolname=any($1::text[]))
        and not exists(select from pg_database d join pg_roles r on r.oid=d.datdba where d.datname=current_database() and r.rolname=any($1::text[])) as safe`,
      [targetRoles],
    );

    if (targetWriters.rows[0]?.safe !== true)
      refuse("Unknown or privileged target writers are unsupported.");

    if (resumed)
      await stage("fenced", {
        priorDatabase: config.priorDatabase,
        roles,
        reconnectRefused: true,
        oldSessionWriteRefused: true,
        watermarkDigest: hash(JSON.stringify(priorRead)),
      });
    await absentProviders(source);
    const targetRead = await recoveryRead(target, target.database, config.bookId);

    if (!isDeepStrictEqual(targetRead, priorRead))
      refuse("Acknowledged prior effects differ from the target. Final delta remains blocked.");

    const other = await source.query<{ count: number }>(
      "select count(*)::int as count from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()",
    );

    if (other.rows[0]?.count !== 0)
      refuse("Target application and queue processes must be stopped during capture.");
    const release = join(recoveryDirectory, "release");
    await captureRelease(config.releaseRoot, release);
    const configOriginal = join(config.supplementaryDirectory, config.configurationPath);
    await privatePath(configOriginal, false);
    const configOriginalBytes = await readFile(configOriginal, "utf8");

    const recoveredConfig = Schema.decodeUnknownSync(SyntheticConfiguration)(
      JSON.parse(configOriginalBytes),
    );

    const configFingerprint = await fingerprint(configOriginal);
    const planPath = join(recoveryDirectory, "recovery-plan.json");
    await writePrivate(
      planPath,
      JSON.stringify({
        version: 1,
        operatorId: target.user,
        releaseDirectory: release,
        supplementaryDirectory: config.supplementaryDirectory,
        artifacts: [
          {
            path: config.configurationPath,
            ...configFingerprint,
            kind: "configuration",
            referenceId: "synthetic-config",
          },
        ],
        configuration: ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"].map((name) => ({
          name,
          custodyReference: "synthetic-local-fixture",
          procedurePath: config.configurationPath,
        })),
      }),
    );
    const probeRole = `onboarding_probe_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const probePassword = randomUUID() + randomUUID();
    await admin.query(
      `create role ${admin.escapeIdentifier(probeRole)} nologin password ${admin.escapeLiteral(probePassword)}`,
    );
    const bundle = join(recoveryDirectory, "bundle");
    const started = performance.now();
    await backup(config.targetPath, bundle, planPath);
    const digest = (await readFile(join(bundle, "manifest.sha256"), "utf8")).trim();
    const adminPath = join(recoveryDirectory, "restore-target.json");
    await writePrivate(adminPath, JSON.stringify({ ...target, database: "postgres" }));
    const receiptDirectory = join(recoveryDirectory, "restore");
    await restore(adminPath, bundle, digest, restoreDatabase, receiptDirectory);

    const recoveredBytes = await readFile(
      join(receiptDirectory, "supplementary", config.configurationPath),
      "utf8",
    );

    if (recoveredBytes !== configOriginalBytes)
      refuse("Recovered synthetic configuration differs.");
    const exercised = Schema.decodeUnknownSync(SyntheticConfiguration)(JSON.parse(recoveredBytes));

    if (
      createHmac("sha256", exercised.secret)
        .update("synthetic-session-recovery-challenge")
        .digest("hex") !==
        createHmac("sha256", recoveredConfig.secret)
          .update("synthetic-session-recovery-challenge")
          .digest("hex") ||
      new URL(exercised.origin).hostname !== "127.0.0.1"
    )
      refuse("Recovered synthetic configuration could not be exercised.");
    const restored = await connect(target, restoreDatabase).catch(() => undefined);

    if (restored) {
      await restored.end();
      refuse("Quarantine unexpectedly admitted a maintenance connection.");
    }

    const restoreId = admin.escapeIdentifier(restoreDatabase);
    let reader: Client | undefined;
    let readDigest: string | undefined;

    try {
      await admin.query(`alter database ${restoreId} allow_connections true`);
      const setup = await connect(target, restoreDatabase);

      try {
        await setup.query("set default_transaction_read_only=off");
        await setup.query(`revoke all on database ${restoreId} from public`);

        const otherRoles = await setup.query<{ name: string }>(
          "select rolname as name from pg_roles where not rolsuper and rolname<>$1",
          [probeRole],
        );

        for (const role of otherRoles.rows)
          await setup.query(
            `revoke all on database ${restoreId} from ${admin.escapeIdentifier(role.name)}`,
          );
        await setup.query(
          `grant connect on database ${restoreId} to ${admin.escapeIdentifier(probeRole)}`,
        );
        await setup.query(`grant usage on schema openerp to ${admin.escapeIdentifier(probeRole)}`);
        await setup.query(
          `grant select on openerp.books,openerp.vouchers,openerp.journal_lines,openerp.execution_receipts,openerp.intake_contents,openerp.outbox to ${admin.escapeIdentifier(probeRole)}`,
        );
      } finally {
        await setup.end();
      }

      await admin.query(`alter role ${admin.escapeIdentifier(probeRole)} login`);
      await admin.query(`alter database ${restoreId} connection limit 1`);

      const recovered = await recoveryRead(target, restoreDatabase, config.bookId, {
        role: probeRole,
        password: probePassword,
      });

      if (!isDeepStrictEqual(targetRead, recovered))
        refuse("Restricted application recovery differs from the captured accounting state.");
      readDigest = hash(JSON.stringify(recovered));
      reader = await credentialClient(target, restoreDatabase, {
        role: probeRole,
        password: probePassword,
      });
      let denied = false;

      try {
        await reader.query("update openerp.books set name=name where id=$1", [config.bookId]);
      } catch (cause) {
        denied =
          cause instanceof Error &&
          "code" in cause &&
          ["42501", "25006"].includes(String(cause.code));
      }

      if (!denied) refuse("The restricted recovery role did not refuse a write.");
    } finally {
      if (reader) await reader.end();
      await admin.query(`alter role ${admin.escapeIdentifier(probeRole)} nologin`);
      await admin.query(`alter database ${restoreId} allow_connections false connection limit 0`);
    }

    if (!readDigest) refuse("No restricted application read proof was retained.");
    await observedFence(admin, config.priorDatabase, roles);

    const observation = Schema.decodeSync(Observation)({
      version: 1,
      id: config.operationId,
      bookId: config.bookId,
      snapshotId: config.snapshotId,
      snapshotDigest: snapshot?.digest ?? null,
      entityId: book.entity,
      kind: "synthetic_local_writer_fence_restore_v1",
      sourceSystemIdentifier: target.expectedSystemIdentifier,
      sourceDatabase: config.priorDatabase,
      targetDatabase: target.database,
      recoveredDatabase: restoreDatabase,
      priorWriterRoles: roles,
      observedAt: new Date().toISOString(),
      priorWriterFence: {
        reconnectRefused: true,
        writeRefused: true,
        watermarkDigest: hash(JSON.stringify(priorRead)),
      },
      applicationRecovery: { readDigest, writeRefused: true },
      configurationRecovery: "synthetic-bytes-recovered-and-exercised",
      backupManifestDigest: digest,
      recoveryElapsedMs: Math.ceil(performance.now() - started),
      productionAction: "disabled",
    });

    await stage("qualified-observation", { observationDigest: hash(JSON.stringify(observation)) });
    await writePrivate(
      join(config.outputDirectory, "observation.json"),
      JSON.stringify(observation, null, 2),
    );

    return observation;
  } catch (cause) {
    await stage("refused", {
      outcome: "blocked",
      productionAction: "disabled",
      automaticUnfence: false,
    }).catch(() => undefined);
    throw cause;
  } finally {
    await source.end();
    await admin.end();
  }
}

export async function prepareOnboardingTargetFence(configPath: string) {
  await privatePath(configPath, false);
  const config = Schema.decodeUnknownSync(Config)(JSON.parse(await readFile(configPath, "utf8")));
  const target = await readTarget(config.targetPath);
  const url = new URL(`postgres://${target.host}:${target.port}/${target.database}`);
  url.username = target.user;
  url.password = target.password;

  return Effect.runPromise(
    fenceOnboardingTarget(config.bookId).pipe(
      Effect.provide(
        databaseLayer({
          connectionString: Redacted.make(url.toString()),
          applicationName: "openerp-onboarding-target-fence",
          connectTimeoutMs: 3000,
          statementTimeoutMs: 10000,
        }),
      ),
    ),
  );
}

async function retainObservedOnboarding(configPath: string, intentId?: string) {
  const observation = await observeOnboardingOperations(configPath);

  if (observation.snapshotDigest === null)
    refuse("An unregistered exercise observation cannot authorize activation.");
  const config = Schema.decodeUnknownSync(Config)(JSON.parse(await readFile(configPath, "utf8")));
  const target = await readTarget(config.targetPath);
  const admin = await connect(target, "postgres");

  try {
    await observedFence(admin, config.priorDatabase, observation.priorWriterRoles);
    const artifact = await fingerprint(join(config.outputDirectory, "observation.json"));

    const proof = Schema.decodeSync(O.OnboardingOperationalProof)({
      id: `operationalproof_${config.operationId}`,
      scope: { entityId: observation.entityId, bookId: observation.bookId },
      snapshotId: observation.snapshotId,
      snapshotDigest: observation.snapshotDigest,
      kind: "synthetic_local_writer_fence_restore_v1",
      topologyId: `postgres-local-${target.expectedSystemIdentifier}`,
      sourceSystemIdentifier: target.expectedSystemIdentifier,
      sourceDatabase: config.priorDatabase,
      targetSystemIdentifier: target.expectedSystemIdentifier,
      targetDatabase: target.database,
      observedAt: observation.observedAt,
      expiresAt: new Date(Date.parse(observation.observedAt) + 15 * 60 * 1000).toISOString(),
      artifactDigest: `sha256:${artifact.sha256}`,
      writerExclusion: "old_credentials_denied",
      acknowledgedEffects: "reconciled",
      applicationRecovery: "restricted_reads_verified",
      restrictedWrites: "denied",
      configurationRecovery: "exercised",
      originalClosure: "verified",
      externalProviders: "absent",
      recoveryElapsedMs: observation.recoveryElapsedMs,
    });

    const url = new URL(`postgres://${target.host}:${target.port}/${target.database}`);
    url.username = target.user;
    url.password = target.password;

    return await Effect.runPromise(
      Effect.gen(function* () {
        if (intentId === undefined)
          return yield* retainOperationalProof(
            proof,
            config.priorDatabase,
            observation.priorWriterRoles,
          );

        return yield* retainProofAndActivate(
          proof,
          intentId,
          config.priorDatabase,
          observation.priorWriterRoles,
        );
      }).pipe(
        Effect.provide(
          databaseLayer({
            connectionString: Redacted.make(url.toString()),
            applicationName: "openerp-onboarding-activation",
            connectTimeoutMs: 3000,
            statementTimeoutMs: 10000,
          }),
        ),
      ),
    );
  } finally {
    await admin.end();
  }
}

export function retainOnboardingObservation(configPath: string) {
  return retainObservedOnboarding(configPath);
}

export function activateOnboardingLocally(configPath: string, intentId: string) {
  return retainObservedOnboarding(configPath, intentId);
}
