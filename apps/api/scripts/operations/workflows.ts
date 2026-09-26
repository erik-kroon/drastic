import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as Schema from "effect/Schema";
import {
  BackupManifest,
  BackupWorkInventory,
  BundleInspection,
  OperationDiagnostic,
  RecoveryClosure,
  RestoreReceipt,
  RestoreSuspensionReport,
} from "../../../../packages/contracts/src/operations";
import {
  artifactPath,
  connect,
  fingerprint,
  newDirectory,
  OperationsFailure,
  privatePath,
  readTarget,
  refuse,
  runPostgres,
  writePrivate,
} from "./safety";
import { readPreflight, tableFingerprints } from "./snapshot";
import { copyArtifacts, filesIn, inspectRelease, readRecoveryPlan } from "./artifacts";
import { databaseInventory, roleInventory } from "./inventory";
import { recoveryControls } from "./controls";
import { captureObjects, objectReferences, verifyObjectInventory } from "./objects";
import { captureWorkInventory, inspectWorkInventory, workInventoryPath } from "./durable-work";
import { readQueueSequences } from "./queue";

async function diagnostic(
  directory: string,
  stage: string,
  status: (typeof OperationDiagnostic.Type)["status"],
  message: string,
) {
  const body = Schema.decodeSync(OperationDiagnostic)({
    version: 1,
    stage,
    status,
    message,
    recordedAt: new Date().toISOString(),
  });

  await writePrivate(
    join(directory, `${Date.now()}-${randomUUID()}.json`),
    JSON.stringify(body, null, 2) + "\n",
  );
}

function sourceDatabase(name: string) {
  if (!/^openerp_ops_source_[a-z0-9_]+$/.test(name))
    refuse("Source database must have an explicit openerp_ops_source_ synthetic name.");
}

function disjoint(first: string, second: string) {
  if (first === second || first.startsWith(second + "/") || second.startsWith(first + "/"))
    refuse("Operational input and output directories must not overlap.");
}

export async function preflight(targetPath: string, receiptPath: string) {
  const target = await readTarget(targetPath);
  sourceDatabase(target.database);
  await privatePath(dirname(receiptPath), true);
  const client = await connect(target);

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await readPreflight(client, target);
    await client.query("ROLLBACK");
    await writePrivate(receiptPath, JSON.stringify(result, null, 2) + "\n");
  } finally {
    await client.end();
  }
}

export async function backup(targetPath: string, bundle: string, recoveryPlanPath: string) {
  const target = await readTarget(targetPath);
  sourceDatabase(target.database);
  const plan = await readRecoveryPlan(recoveryPlanPath);
  disjoint(bundle, plan.supplementaryDirectory);
  disjoint(bundle, plan.releaseDirectory);
  await newDirectory(bundle);
  const diagnostics = join(bundle, "diagnostics");
  await newDirectory(diagnostics);
  await diagnostic(
    diagnostics,
    "snapshot",
    "started",
    "Private backup started; no complete manifest exists yet.",
  );

  const client = await connect(target).catch(async () => {
    await diagnostic(
      diagnostics,
      "connection",
      "failed",
      "Source connection or identity validation failed; no content was exported.",
    );

    return refuse("Source connection or identity validation failed.");
  });

  let stage = "snapshot";

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const source = await readPreflight(client, target);

    const snapshotResult = await client.query<{ snapshot: string }>(
      "SELECT pg_export_snapshot() AS snapshot",
    );

    const snapshot = snapshotResult.rows[0]?.snapshot;

    if (!snapshot) refuse("No PostgreSQL snapshot was exported.");
    const tables = await tableFingerprints(client, true);
    const release = await inspectRelease(plan.releaseDirectory);
    stage = "inventory-and-closure";
    const inventory = await databaseInventory(client, release);
    const objects = await objectReferences(client, tables);
    await captureObjects(bundle, objects.references);
    await verifyObjectInventory(bundle, objects);
    const recovery = await recoveryControls(client, tables, true);
    const controls = recovery.controls;
    stage = "durable-work-snapshot";
    const work = await captureWorkInventory(client, tables, snapshot);
    await writePrivate(join(bundle, workInventoryPath), JSON.stringify(work, null, 2) + "\n");

    const durableWork = Schema.decodeSync(BackupWorkInventory)({
      version: 1,
      file: { path: workInventoryPath, ...(await fingerprint(join(bundle, workInventoryPath))) },
      summary: work.summary,
      recoveryProcedurePath: plan.workRecoveryProcedurePath ?? null,
    });

    const closure = Schema.decodeSync(RecoveryClosure)({
      version: 1,
      database: "matched",
      objects,
      evidence: recovery.evidence,
      receipts: recovery.receipts,
      durableWork: "matched",
    });

    await diagnostic(
      diagnostics,
      stage,
      "passed",
      "Snapshot data controls and durable work inventory captured. External worker/provider state is not verified.",
    );
    stage = "pg-dump";
    await runPostgres(
      target,
      "pg_dump",
      [
        "--format=custom",
        "--no-password",
        "--lock-wait-timeout=10000",
        `--snapshot=${snapshot}`,
        `--file=${join(bundle, "database.dump")}`,
      ],
      target.database,
    );

    // Sequence positions are not MVCC snapshots. Refuse a moving queue instead of
    // issuing a manifest whose saved positions can disagree with pg_dump's setval.
    if (!isDeepStrictEqual(await readQueueSequences(client), work.queue.sequences))
      refuse("Queue sequence state changed during backup; stop queue writers and capture again.");

    await client.query("ROLLBACK");
    stage = "supplementary-and-release-copy";
    await copyArtifacts(plan.supplementaryDirectory, join(bundle, "supplementary"));
    await copyArtifacts(plan.releaseDirectory, join(bundle, "release"));

    if (JSON.stringify(await inspectRelease(join(bundle, "release"))) !== JSON.stringify(release))
      refuse("Release changed during backup capture.");

    for (const artifact of plan.artifacts) {
      const copied = await fingerprint(artifactPath(join(bundle, "supplementary"), artifact.path));

      if (copied.sha256 !== artifact.sha256 || copied.bytes !== artifact.bytes)
        refuse("Supplementary copy differs from declared content.");
    }

    const files = [];

    for (const path of (await filesIn(bundle)).filter((path) => !path.startsWith("diagnostics/"))) {
      files.push({ path, ...(await fingerprint(artifactPath(bundle, path))) });
    }

    stage = "manifest";

    const manifest = Schema.decodeSync(BackupManifest)({
      version: 2,
      kind: "openerp-local-backup",
      dataClass: "synthetic-local-only",
      createdAt: new Date().toISOString(),
      operatorId: plan.operatorId,
      source,
      snapshot,
      tables,
      inventory,
      controls,
      release,
      configuration: plan.configuration,
      artifacts: plan.artifacts,
      files,
      closure,
      durableWork,
      evidenceAndReceipts: "all-user-tables-in-snapshot",
      archiveCompliance: "not-established",
      keyRecovery: "custody-declared-not-exercised",
      restoreStatus: "not-exercised",
      productionAction: "disabled",
    });

    await writePrivate(join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const hash = await fingerprint(join(bundle, "manifest.json"));
    await writePrivate(join(bundle, "manifest.sha256"), hash.sha256 + "\n");
    await diagnostic(
      diagnostics,
      stage,
      "passed",
      "Complete local bundle manifest written. No application or archive recovery is claimed.",
    );
  } catch (cause) {
    await diagnostic(
      diagnostics,
      stage,
      "failed",
      cause instanceof OperationsFailure
        ? cause.message
        : "The current stage failed. Raw SQL, source data and credentials were not logged.",
    );
    throw cause;
  } finally {
    await client.end();
  }
}

export async function inspectBundle(bundle: string, expectedDigest: string) {
  await privatePath(bundle, true);

  if (!/^[a-f0-9]{64}$/.test(expectedDigest))
    refuse("Supply the separately recorded manifest SHA-256.");
  const hash = await fingerprint(join(bundle, "manifest.json"));

  if (hash.sha256 !== expectedDigest)
    refuse("Manifest checksum does not match the operator reference.");

  const manifest = Schema.decodeUnknownSync(BackupManifest)(
    JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8")),
  );

  const paths = manifest.files.map((file) => file.path).sort();

  if (
    paths.filter((path) => path === "database.dump").length !== 1 ||
    new Set(paths).size !== paths.length ||
    paths.some(
      (path) =>
        path !== "database.dump" &&
        path !== workInventoryPath &&
        !path.startsWith("supplementary/") &&
        !path.startsWith("release/") &&
        !/^objects\/v1\/[a-z][a-z0-9_-]{2,127}\/[a-f0-9]{64}$/.test(path),
    )
  )
    refuse("Unexpected bundle file inventory.");

  const actualPaths = (await filesIn(bundle)).filter(
    (path) =>
      !["manifest.json", "manifest.sha256"].includes(path) && !path.startsWith("diagnostics/"),
  );

  if (JSON.stringify(paths) !== JSON.stringify(actualPaths))
    refuse("Bundle file inventory differs from its manifest.");

  for (const file of manifest.files) {
    const actual = await fingerprint(artifactPath(bundle, file.path));

    if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
      refuse("A backup file failed checksum validation.");
  }

  if (
    JSON.stringify(await inspectRelease(join(bundle, "release"))) !==
    JSON.stringify(manifest.release)
  )
    refuse("Captured release differs from the backup manifest.");
  const artifactNames = manifest.artifacts.map((file) => `supplementary/${file.path}`).sort();

  if (
    new Set(artifactNames).size !== artifactNames.length ||
    JSON.stringify(artifactNames) !==
      JSON.stringify(paths.filter((path) => path.startsWith("supplementary/")))
  )
    refuse("Supplementary reference inventory is incomplete.");

  for (const artifact of manifest.artifacts) {
    if (
      !manifest.files.some(
        (file) =>
          file.path === `supplementary/${artifact.path}` &&
          file.sha256 === artifact.sha256 &&
          file.bytes === artifact.bytes,
      )
    )
      refuse("Supplementary reference hash differs from retained content.");
  }

  const requiredConfiguration = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];

  if (
    manifest.configuration.length !== 3 ||
    requiredConfiguration.some(
      (name) => !manifest.configuration.some((item) => item.name === name),
    ) ||
    manifest.configuration.some(
      (item) =>
        !manifest.artifacts.some(
          (file) =>
            file.path === item.procedurePath &&
            ["configuration", "key-recovery"].includes(file.kind),
        ),
    )
  )
    refuse("Configuration/key custody closure is incomplete.");

  if (manifest.closure) {
    await verifyObjectInventory(bundle, manifest.closure.objects);

    const evidenceTable = manifest.tables.find(
      (table) => table.schema === "openerp" && table.table === "evidence",
    );

    if (
      !evidenceTable ||
      JSON.stringify(evidenceTable) !== JSON.stringify(manifest.closure.evidence.table)
    )
      refuse("Evidence inventory is not bound to the complete database table inventory.");
    const receiptTables = manifest.tables.filter((table) => table.table.endsWith("receipts"));

    if (JSON.stringify(receiptTables) !== JSON.stringify(manifest.closure.receipts.tables))
      refuse("Receipt inventory is not bound to the complete database table inventory.");

    if (!manifest.durableWork) refuse("Durable-work closure is missing its inventory.");
  }

  await inspectWorkInventory(bundle, manifest);

  return manifest;
}

export async function inspectBundleResult(bundle: string, expectedDigest: string) {
  const manifest = await inspectBundle(bundle, expectedDigest);

  return Schema.decodeSync(BundleInspection)({
    version: 1,
    kind: "openerp-local-bundle-inspection",
    inspectedAt: new Date().toISOString(),
    status: manifest.closure ? "complete" : "legacy",
    manifestSha256: expectedDigest,
    database: "manifest-bound",
    objects: manifest.closure ? "matched" : "not-captured-in-source",
    evidence: manifest.closure ? "manifest-bound" : "not-captured-in-source",
    receipts: manifest.closure ? "manifest-bound" : "not-captured-in-source",
    durableWork: manifest.durableWork ? "matched" : "not-captured-in-source",
    applicationRecovery: "blocked-restricted-read-admission",
    writerPromotion: "not-performed",
    providerPromotion: "not-performed",
    productionAction: "disabled",
  });
}

export async function restore(
  targetPath: string,
  bundle: string,
  digest: string,
  database: string,
  receiptDirectory: string,
) {
  const started = performance.now();

  if (!/^openerp_restore_[a-z0-9_]{1,40}$/.test(database))
    refuse("Use a fresh openerp_restore_ database name (up to 56 characters).");
  const target = await readTarget(targetPath);

  if (target.database !== "postgres")
    refuse("Restore configuration must name the postgres maintenance database.");
  disjoint(bundle, receiptDirectory);
  const manifest = await inspectBundle(bundle, digest);
  const sourceWork = await inspectWorkInventory(bundle, manifest);

  if (target.user !== manifest.inventory.owner)
    refuse("Restore maintenance role must match the captured object owner.");
  await newDirectory(receiptDirectory);
  const diagnostics = join(receiptDirectory, "diagnostics");
  await newDirectory(diagnostics);
  await diagnostic(
    diagnostics,
    "admission",
    "started",
    "Restore starts fenced. No application/provider admission is authorized.",
  );

  const admin = await connect(target).catch(async () => {
    await diagnostic(
      diagnostics,
      "connection",
      "failed",
      "Destination connection or identity validation failed; no database was created.",
    );

    return refuse("Destination connection or identity validation failed.");
  });

  const identifier = admin.escapeIdentifier(database);
  let created = false;
  let reconstructionComplete = false;
  let stage = "destination-preflight";
  let verifiedControls: typeof manifest.controls | undefined;

  let workVerification: (typeof RestoreSuspensionReport.Type)["inventoryVerification"] = sourceWork
    ? "not-run"
    : "not-captured-in-source";

  let connectionState: (typeof RestoreSuspensionReport.Type)["connections"] = "not-created";

  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);

    if (existing.rowCount !== 0)
      refuse("Destination already exists. It will not be changed or restored over.");

    if (JSON.stringify(await roleInventory(admin)) !== JSON.stringify(manifest.inventory.roles))
      refuse(
        "Destination role attributes/memberships differ from source. Provision reviewed roles separately.",
      );

    const roleSettings = await admin.query(
      "SELECT 1 FROM pg_db_role_setting WHERE setdatabase=0 LIMIT 1",
    );

    if (roleSettings.rowCount !== 0)
      refuse("Destination cluster role settings need explicit recovery review.");
    stage = "create-quarantine";
    // A lost CREATE response cannot establish that the destination was not created.
    connectionState = "not-confirmed";
    // Names/locales are escaped identifiers/literals; no caller SQL is executed.
    await admin.query(`CREATE DATABASE ${identifier} TEMPLATE template0 ALLOW_CONNECTIONS false CONNECTION LIMIT 0
      ENCODING ${admin.escapeLiteral(manifest.inventory.encoding)} LOCALE_PROVIDER libc
      LC_COLLATE ${admin.escapeLiteral(manifest.inventory.collation)} LC_CTYPE ${admin.escapeLiteral(manifest.inventory.ctype)}`);
    created = true;
    await admin.query(`REVOKE ALL ON DATABASE ${identifier} FROM PUBLIC`);
    await admin.query(`ALTER DATABASE ${identifier} SET default_transaction_read_only = on`);
    await admin.query(`ALTER DATABASE ${identifier} ALLOW_CONNECTIONS true`);
    stage = "pg-restore";
    await diagnostic(
      diagnostics,
      stage,
      "started",
      "Only superusers can connect; runtime and provider admission remain fenced.",
    );
    await runPostgres(
      target,
      "pg_restore",
      [
        "--no-password",
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--dbname=" + database,
        join(bundle, "database.dump"),
      ],
      database,
    );
    stage = "reconstruction-controls";
    const restored = await connect(target, database);

    try {
      await restored.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const actual = await tableFingerprints(restored, Boolean(manifest.closure));

      if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
        refuse("Restored table fingerprints differ.");

      if (
        JSON.stringify(await databaseInventory(restored, manifest.release, true)) !==
        JSON.stringify(manifest.inventory)
      )
        refuse("Restored schema/migration/environment inventory differs.");
      const objects = await objectReferences(restored, actual, Boolean(manifest.closure));
      await verifyObjectInventory(bundle, objects);

      if (manifest.closure && JSON.stringify(objects) !== JSON.stringify(manifest.closure.objects))
        refuse("Restored object inventory differs from the backup manifest.");

      const recovery = await recoveryControls(
        restored,
        actual,
        manifest.controls.externalObjects === "retained-originals-matched",
      );

      verifiedControls = recovery.controls;

      if (JSON.stringify(verifiedControls) !== JSON.stringify(manifest.controls))
        refuse("Restored evidence/receipt/report controls differ.");

      if (
        manifest.closure &&
        (JSON.stringify(recovery.evidence) !== JSON.stringify(manifest.closure.evidence) ||
          JSON.stringify(recovery.receipts) !== JSON.stringify(manifest.closure.receipts))
      )
        refuse("Restored evidence or receipt inventory differs from the backup manifest.");

      if (sourceWork) {
        stage = "durable-work-reconstruction";
        workVerification = "failed";
        const restoredWork = await captureWorkInventory(restored, actual, manifest.snapshot);

        if (!isDeepStrictEqual(restoredWork, sourceWork))
          refuse(
            "Restored durable jobs, attempt counters or saved outcomes differ from the source snapshot.",
          );
        workVerification = "matched";
      }

      await restored.query("ROLLBACK");
    } finally {
      await restored.end();
    }

    stage = "recovered-files";
    await copyArtifacts(join(bundle, "supplementary"), join(receiptDirectory, "supplementary"));
    await copyArtifacts(join(bundle, "release"), join(receiptDirectory, "release"));

    if (manifest.files.some((file) => file.path.startsWith("objects/")))
      await copyArtifacts(join(bundle, "objects"), join(receiptDirectory, "objects"));

    if (sourceWork)
      await writePrivate(
        join(receiptDirectory, workInventoryPath),
        await readFile(join(bundle, workInventoryPath), "utf8"),
      );

    for (const file of manifest.files.filter((file) => file.path !== "database.dump")) {
      const recovered = await fingerprint(artifactPath(receiptDirectory, file.path));

      if (recovered.sha256 !== file.sha256 || recovered.bytes !== file.bytes)
        refuse("Recovered file differs from the manifest.");
    }

    await diagnostic(
      diagnostics,
      stage,
      "passed",
      "Database and supplementary/release reconstruction controls passed; restricted application reads remain blocked.",
    );
    reconstructionComplete = true;
  } catch (cause) {
    await diagnostic(
      diagnostics,
      stage,
      "failed",
      cause instanceof OperationsFailure
        ? cause.message
        : "The current stage failed. Raw SQL, source data and credentials were not logged.",
    );
    throw cause;
  } finally {
    try {
      if (created) {
        try {
          await admin.query(`ALTER DATABASE ${identifier} ALLOW_CONNECTIONS false`);

          const quarantine = await admin.query<{ closed: boolean }>(
            `SELECT NOT datallowconn AND datconnlimit=0 AS closed FROM pg_database WHERE datname=$1`,
            [database],
          );

          if (quarantine.rows[0]?.closed !== true)
            refuse("Destination quarantine could not be confirmed.");
          connectionState = "disabled";
          await diagnostic(
            diagnostics,
            "quarantine",
            "passed",
            "Database connections are disabled and connection limit remains zero.",
          );
        } catch {
          connectionState = "not-confirmed";
          await diagnostic(
            diagnostics,
            "quarantine",
            "not-confirmed",
            "Connection loss or quarantine failure: keep all application/provider processes stopped. Operator inspection is required.",
          );
          refuse("Quarantine is not confirmed. No successful restore receipt can be issued.");
        }
      }
    } finally {
      try {
        await admin.end();
      } finally {
        const suspension = Schema.decodeSync(RestoreSuspensionReport)({
          version: 1,
          kind: "openerp-restore-suspension",
          recordedAt: new Date().toISOString(),
          manifestSha256: digest,
          destination: database,
          operatorId: target.user,
          connections: connectionState,
          inventoryVerification: workVerification,
          sourceInventory: manifest.durableWork ?? null,
          reconstructionChecks: reconstructionComplete ? "completed" : "incomplete",
          jobRows: "not-modified-by-recovery",
          externalWorkers: "not-inspected",
          providerOutcomes: "not-reconciled",
          resumeAllowed: false,
        });

        await writePrivate(
          join(receiptDirectory, "suspension-report.json"),
          JSON.stringify(suspension, null, 2) + "\n",
        );
      }
    }
  }

  if (workVerification !== "matched" && workVerification !== "not-captured-in-source")
    refuse("Durable work reconstruction is incomplete. No success receipt can be issued.");

  if (!verifiedControls) refuse("No recovery controls were completed.");

  const receipt = Schema.decodeSync(RestoreReceipt)({
    version: 2,
    kind: "openerp-local-restore",
    completedAt: new Date().toISOString(),
    durationMs: Math.ceil(performance.now() - started),
    operatorId: target.user,
    manifestSha256: digest,
    destination: database,
    systemIdentifier: target.expectedSystemIdentifier,
    controls: verifiedControls,
    tableFingerprints: "matched",
    migrationFiles: "matched",
    roleAttributesAndMemberships: "matched-before-restore",
    supplementaryFiles: "matched",
    configurationRecovery: "custody-declared-not-exercised",
    durableWork: {
      version: 1,
      inventoryVerification: workVerification,
      suspensionReport: {
        path: "suspension-report.json",
        ...(await fingerprint(join(receiptDirectory, "suspension-report.json"))),
      },
      resumeAllowed: false,
    },
    connections: "disabled",
    writerPromotion: "not-performed",
    applicationRecovery: "blocked-restricted-read-admission",
    archiveCompliance: "not-established",
    productionAction: "disabled",
  });

  await writePrivate(
    join(receiptDirectory, "restore-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
}
