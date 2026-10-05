import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  refuseDriftedRestore,
  verifyRestore,
  checkDispatchFence,
} from "@open-erp/domain/rehearsal-verification";
import { fileObjectStore } from "../file-object-store";
import { databaseLayer } from "../../src/db/connection";
import {
  inspectRehearsalRecovery,
  RecoveryAdmission,
  RecoveryReadDenied,
  recoveryReadTables,
  type RecoveryReadAction,
} from "../../src/application/rehearsal-recovery-read";
import { checked, readCheckpoint, sourceDigest } from "./checkpoint";
import { inspectWorkInventory } from "./durable-work";
import { inspectBundle, restore } from "./workflows";
import { verifyActualBackup } from "./rehearsal-backup";
import {
  connect,
  fingerprint,
  OperationsFailure,
  readTarget,
  privatePath,
  refuse,
  writePrivate,
} from "./safety";
import { databaseInventory, databaseInventoryMatches, roleInventory } from "./inventory";
import { tableFingerprints } from "./snapshot";
import { readApplicationSequences } from "./application-sequences";
import { readQueueSequences } from "./queue";

async function verifiedInputs(
  bundle: string,
  manifestDigest: string,
  checkpointPath: string,
  checkpointDigest: string,
) {
  const checkpoint = await readCheckpoint(checkpointPath, checkpointDigest);
  let manifest;

  try {
    manifest = await inspectBundle(bundle, manifestDigest);
  } catch (cause) {
    if (cause instanceof OperationsFailure && cause.message.startsWith("UnhandledFamily:"))
      throw cause;
    refuse("BackupIncomplete: Actual retained bundle verification failed.");
  }

  const work = await inspectWorkInventory(bundle, manifest);

  if (!work || !isDeepStrictEqual(checkpoint.queueSequences, work.queue.sequences))
    refuse("ControlDifference: Saved durable queue sequence state differs from checkpoint.");
  checked(
    refuseDriftedRestore({
      destinationManifestDigest: sourceDigest(checkpoint.release),
      backupManifestDigest: sourceDigest(manifest.release),
    }),
  );

  if (
    !isDeepStrictEqual(checkpoint.tables, manifest.tables) ||
    !isDeepStrictEqual(checkpoint.inventory, manifest.inventory) ||
    checkpoint.bookId !== manifest.source.books[0]?.id ||
    manifest.source.books.length !== 1
  )
    refuse("ControlDifference: Backup no longer belongs to the captured selected-book checkpoint.");

  return { checkpoint, manifest };
}

export async function verifyRehearsalBackup(
  bundle: string,
  manifestDigest: string,
  checkpointPath: string,
  checkpointDigest: string,
  output: string,
) {
  const { checkpoint, manifest } = await verifiedInputs(
    bundle,
    manifestDigest,
    checkpointPath,
    checkpointDigest,
  );

  const certificate = await verifyActualBackup(bundle, manifest, manifestDigest);
  await privatePath(dirname(output), true);
  await writePrivate(
    output,
    JSON.stringify(
      {
        ...certificate,
        checkpointId: checkpoint.checkpointId,
        checkpointDigest,
        sourceDigest: checkpoint.sourceDigest,
        level: "actual_sql_files",
        applicationRecovery: "unobserved",
      },
      null,
      2,
    ) + "\n",
  );
}

const PgDenial = Schema.Struct({ code: Schema.Literals(["42501", "25006"]) });

async function deniedSql(client: Client, statement: string) {
  try {
    await client.query(statement);
  } catch (cause) {
    if (Schema.is(PgDenial)(cause)) return "denied" as const;
    throw cause;
  }

  return refuse("FenceViolation: Restricted database operation was accepted.");
}

export async function restoreRehearsal(
  targetPath: string,
  bundle: string,
  manifestDigest: string,
  checkpointPath: string,
  checkpointDigest: string,
  database: string,
  receiptDirectory: string,
) {
  const { checkpoint, manifest } = await verifiedInputs(
    bundle,
    manifestDigest,
    checkpointPath,
    checkpointDigest,
  );

  await restore(targetPath, bundle, manifestDigest, database, receiptDirectory);
  const sqlReceipt = await fingerprint(join(receiptDirectory, "restore-receipt.json"));
  const target = await readTarget(targetPath);
  const admin = await connect(target);
  const dbName = admin.escapeIdentifier(database);
  const role = `rehearsal_reader_${randomBytes(8).toString("hex")}`;
  const readerName = admin.escapeIdentifier(role);
  const readerPassword = randomBytes(32).toString("hex");
  let maintenance: Client | undefined;
  let reader: Client | undefined;
  let roleCreated = false;
  let schemaCreated = false;
  let quarantineConfirmed = false;
  let application: typeof checkpoint.application | undefined;
  let fences: Record<string, string> | undefined;
  let schemaMatched: boolean | "unavailable" = "unavailable";
  let tablesMatched: boolean | "unavailable" = "unavailable";
  let effectsMatched: boolean | "unavailable" = "unavailable";
  let failure: unknown;

  try {
    await admin.query(`ALTER DATABASE ${dbName} ALLOW_CONNECTIONS true`);
    maintenance = await connect(target, database);
    await maintenance.query("SET default_transaction_read_only = off");
    const before = await tableFingerprints(maintenance, true);
    const queueBefore = await readQueueSequences(maintenance);
    const ordinalBefore = await readApplicationSequences(maintenance);
    await admin.query(
      `CREATE ROLE ${readerName} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD ${admin.escapeLiteral(readerPassword)} VALID UNTIL ${admin.escapeLiteral(new Date(Date.now() + 900000).toISOString())}`,
    );
    roleCreated = true;
    await maintenance.query("CREATE SCHEMA openerp_rehearsal");
    schemaCreated = true;

    for (const table of recoveryReadTables) {
      const name = maintenance.escapeIdentifier(table);
      const key = table === "books" ? "id" : "book_id";
      await maintenance.query(
        `CREATE VIEW openerp_rehearsal.${name} WITH (security_barrier=true) AS SELECT * FROM openerp.${name} WHERE ${key}=${maintenance.escapeLiteral(checkpoint.bookId)}`,
      );
    }

    await maintenance.query(`GRANT USAGE ON SCHEMA openerp_rehearsal TO ${readerName}`);
    await maintenance.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA openerp_rehearsal TO ${readerName}`,
    );
    await admin.query(`REVOKE CONNECT ON DATABASE ${dbName} FROM PUBLIC`);

    for (const originalRole of manifest.inventory.roles) {
      if (originalRole.name !== target.user)
        await admin.query(
          `REVOKE CONNECT ON DATABASE ${dbName} FROM ${admin.escapeIdentifier(originalRole.name)}`,
        );
    }

    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${readerName}`);
    await admin.query(`ALTER DATABASE ${dbName} CONNECTION LIMIT 2`);
    const url = new URL(`postgresql://${target.host}:${target.port}/${database}`);
    url.username = role;
    url.password = readerPassword;

    const layer = databaseLayer({
      connectionString: Redacted.make(url.toString()),
      applicationName: "rehearsal-restricted-read",
      connectTimeoutMs: 10000,
      statementTimeoutMs: 30000,
    });

    const admission = {
      bookId: checkpoint.bookId,
      readerRole: role,
      originals: await fileObjectStore(join(receiptDirectory, "objects")),
    };

    const invoke = (book: string, action: typeof RecoveryReadAction.Type) =>
      Effect.runPromise(
        inspectRehearsalRecovery(book, action).pipe(
          Effect.provideService(RecoveryAdmission, admission),
          Effect.provide(layer),
        ),
      );

    application = await invoke(checkpoint.bookId, "inspect");

    const deny = async (book: string, action: typeof RecoveryReadAction.Type) => {
      const result = await Effect.runPromise(
        Effect.result(
          inspectRehearsalRecovery(book, action).pipe(
            Effect.provideService(RecoveryAdmission, admission),
            Effect.provide(layer),
          ),
        ),
      );

      if (
        !Result.isFailure(result) ||
        !(result.failure instanceof RecoveryReadDenied) ||
        result.failure.reason !== (action === "inspect" ? "book_scope" : "local_admission_fence")
      )
        refuse("FenceViolation: Restricted application command was accepted.");

      return action === "inspect" ? "denied" : "local_admission_fence";
    };

    const crossBook = await deny("another_synthetic_book", "inspect");
    const post = await deny(checkpoint.bookId, "post");
    const approve = await deny(checkpoint.bookId, "approve");
    const dispatch = await deny(checkpoint.bookId, "dispatch");
    checked(
      checkDispatchFence({
        dispatchAttempted: true,
        fenceDenied: dispatch === "local_admission_fence",
      }),
    );
    reader = new Client({
      connectionString: url.toString(),
      statement_timeout: 10000,
      connectionTimeoutMillis: 10000,
    });
    await reader.connect();

    const crossView = await reader.query<{ count: string }>(
      "SELECT count(*)::text as count FROM openerp_rehearsal.books WHERE id=$1",
      ["another_synthetic_book"],
    );

    if (crossView.rows[0]?.count !== "0")
      refuse("FenceViolation: Filtered database views exposed another book.");

    const write = await deniedSql(
      reader,
      "UPDATE openerp.books SET committed_sequence=committed_sequence",
    );

    const credentials = await deniedSql(reader, "SELECT token FROM openerp_auth.session");
    fences = { crossBook, write, credentials, post, approve, dispatch };
    const after = await tableFingerprints(maintenance, true);
    const queueAfter = await readQueueSequences(maintenance);
    effectsMatched =
      isDeepStrictEqual(before, after) &&
      isDeepStrictEqual(queueBefore, queueAfter) &&
      isDeepStrictEqual(ordinalBefore, await readApplicationSequences(maintenance));
    tablesMatched = isDeepStrictEqual(manifest.tables, after);
  } catch (cause) {
    failure = cause;
  } finally {
    const cleanup = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (cause) {
        failure ??= cause;
      }
    };

    await cleanup(async () => reader?.end());

    if (roleCreated) await cleanup(async () => admin.query(`ALTER ROLE ${readerName} NOLOGIN`));

    if (maintenance && schemaCreated) {
      await cleanup(async () => {
        await maintenance?.query("DROP SCHEMA openerp_rehearsal CASCADE");
        schemaCreated = false;
      });
    }

    if (roleCreated) {
      await cleanup(async () =>
        admin.query(`REVOKE CONNECT ON DATABASE ${dbName} FROM ${readerName}`),
      );
      await cleanup(async () => {
        await admin.query(`DROP ROLE ${readerName}`);
        roleCreated = false;
      });
    }

    if (maintenance) {
      await cleanup(async () => {
        if (!maintenance) return;
        schemaMatched = databaseInventoryMatches(
          await databaseInventory(maintenance, manifest.release, true),
          manifest.inventory,
        );
      });
    }

    await cleanup(async () => {
      if (!isDeepStrictEqual(await roleInventory(admin), manifest.inventory.roles))
        refuse("FenceViolation: Temporary recovery identity cleanup changed original roles.");
    });
    await cleanup(async () => maintenance?.end());
    await cleanup(async () => admin.query(`ALTER DATABASE ${dbName} CONNECTION LIMIT 0`));
    await cleanup(async () => admin.query(`ALTER DATABASE ${dbName} ALLOW_CONNECTIONS false`));
    await cleanup(async () => {
      const state = await admin.query<{ closed: boolean }>(
        "SELECT NOT datallowconn AND datconnlimit=0 AS closed FROM pg_database WHERE datname=$1",
        [database],
      );

      quarantineConfirmed = state.rows[0]?.closed === true;

      if (!quarantineConfirmed)
        refuse("FenceViolation: Final database quarantine was not confirmed.");
    });
    await cleanup(async () => admin.end());
  }

  const applicationMatched =
    application === undefined
      ? ("unavailable" as const)
      : isDeepStrictEqual(application, checkpoint.application);

  const artifactsAvailable =
    (checkpoint.application.tables.sie_book_export_artifacts?.length ?? 0) > 0;

  const evidenceAvailable = (checkpoint.application.tables.evidence?.length ?? 0) > 0;
  const receiptsAvailable = (checkpoint.application.tables.execution_receipts?.length ?? 0) > 0;
  const originalsAvailable = (checkpoint.application.tables.intake_contents?.length ?? 0) > 0;

  const comparison = {
    schemaHashesMatch: schemaMatched,
    migrationHashesMatch: schemaMatched,
    entityCountsMatch: tablesMatched,
    ledgerBoundariesMatch: applicationMatched,
    balancesMatch: applicationMatched,
    receiptsMatch: receiptsAvailable ? applicationMatched : ("unavailable" as const),
    objectHashesMatch:
      originalsAvailable && evidenceAvailable ? applicationMatched : ("unavailable" as const),
    artifactBytesMatch: artifactsAvailable ? applicationMatched : ("unavailable" as const),
    readsWithoutEffects: effectsMatched,
  };

  const observation = {
    checkpointDigest,
    manifestDigest,
    sqlReceipt,
    application: application ?? null,
    comparison,
    fences: fences ?? null,
    quarantineConfirmed,
    temporaryIdentityRemoved: !roleCreated,
    inspectionSchemaRemoved: !schemaCreated,
    providerOutcomes: "unobserved",
    writerPromotion: "not-performed",
    level: "local_restricted_application",
    applicationSequenceClosure:
      manifest.inventory.applicationSequences === undefined ? "not-captured-in-source" : "matched",
  };

  await writePrivate(
    join(receiptDirectory, "application-restore-observations.json"),
    JSON.stringify(observation, null, 2) + "\n",
  );

  if (failure) throw failure;
  const verdict = checked(verifyRestore(comparison));

  if (!verdict.restoreCertified)
    refuse(
      "StaleEvidence: Required restore assertions are unavailable; SQL/files recovery remains distinct.",
    );
  await writePrivate(
    join(receiptDirectory, "application-restore-certificate.json"),
    JSON.stringify({ ...observation, ...verdict }, null, 2) + "\n",
  );
}
