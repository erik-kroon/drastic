import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import * as Schema from "effect/Schema";
import {
  BackupManifest,
  OperationDiagnostic,
  RestoreReceipt,
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
import { captureObjects, objectReferences, verifyObjects } from "./objects";

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
    const tables = await tableFingerprints(client);
    const release = await inspectRelease(plan.releaseDirectory);
    stage = "inventory-and-closure";
    const inventory = await databaseInventory(client, release);
    const objects = await objectReferences(client, tables);
    await captureObjects(bundle, objects);
    const controls = await recoveryControls(client, tables, true);
    await diagnostic(
      diagnostics,
      stage,
      "passed",
      "Snapshot table, migration, role, evidence, receipt and historical report controls passed.",
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
  return manifest;
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
  let stage = "destination-preflight";
  let verifiedControls: typeof manifest.controls | undefined;
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
      const actual = await tableFingerprints(restored);
      if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
        refuse("Restored table fingerprints differ.");
      if (
        JSON.stringify(await databaseInventory(restored, manifest.release, true)) !==
        JSON.stringify(manifest.inventory)
      )
        refuse("Restored schema/migration/environment inventory differs.");
      const objects = await objectReferences(restored, actual);
      await verifyObjects(bundle, objects);
      verifiedControls = await recoveryControls(
        restored,
        actual,
        manifest.controls.externalObjects === "retained-originals-matched",
      );
      if (JSON.stringify(verifiedControls) !== JSON.stringify(manifest.controls))
        refuse("Restored evidence/receipt/report controls differ.");
      await restored.query("ROLLBACK");
    } finally {
      await restored.end();
    }
    stage = "recovered-files";
    await copyArtifacts(join(bundle, "supplementary"), join(receiptDirectory, "supplementary"));
    await copyArtifacts(join(bundle, "release"), join(receiptDirectory, "release"));
    if (manifest.files.some((file) => file.path.startsWith("objects/")))
      await copyArtifacts(join(bundle, "objects"), join(receiptDirectory, "objects"));
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
          await diagnostic(
            diagnostics,
            "quarantine",
            "passed",
            "Database connections are disabled and connection limit remains zero.",
          );
        } catch {
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
      await admin.end();
    }
  }
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
