import { copyFile, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { BackupManifest, RestoreReceipt } from "../../../../packages/contracts/src/operations";
import {
  artifactPath,
  connect,
  fingerprint,
  newDirectory,
  privatePath,
  readTarget,
  refuse,
  runPostgres,
  writePrivate,
} from "./safety";
import { readPreflight, roleNames, tableFingerprints } from "./snapshot";

async function copyArtifacts(source: string, destination: string) {
  await privatePath(source, true);
  await newDirectory(destination);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyArtifacts(from, to);
    else if (entry.isFile()) {
      const before = await fingerprint(from);
      await copyFile(from, to, constants.COPYFILE_EXCL);
      const copied = await fingerprint(to);
      const after = await fingerprint(from);
      if (
        before.sha256 !== copied.sha256 ||
        before.sha256 !== after.sha256 ||
        before.bytes !== after.bytes
      ) {
        refuse("Supplementary artifact changed while copying.");
      }
    } else
      refuse(
        "Supplementary artifacts must be private regular files or directories without symlinks.",
      );
  }
}
async function filesIn(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await privatePath(artifactPath(root, name), true);
      files.push(...(await filesIn(root, name)));
    } else if (entry.isFile()) files.push(name);
    else refuse("Bundle contains a symlink or special file.");
  }
  return files.sort();
}
function sourceDatabase(name: string) {
  if (!/^openerp_ops_source_[a-z0-9_]+$/.test(name))
    refuse("Source database must have an explicit openerp_ops_source_ synthetic name.");
}
export async function preflight(targetPath: string, receiptPath: string) {
  const target = await readTarget(targetPath);
  sourceDatabase(target.database);
  const client = await connect(target);
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await readPreflight(client, target);
    await client.query("ROLLBACK");
    await privatePath(join(receiptPath, ".."), true);
    await writePrivate(receiptPath, JSON.stringify(result, null, 2) + "\n");
  } finally {
    await client.end();
  }
}
export async function backup(targetPath: string, bundle: string, supplementary: string) {
  const target = await readTarget(targetPath);
  sourceDatabase(target.database);
  if (supplementary !== "none") {
    await privatePath(supplementary, true);
    if (
      bundle.startsWith(supplementary + "/") ||
      supplementary.startsWith(bundle + "/") ||
      bundle === supplementary
    ) {
      refuse("Bundle and supplementary directories must not overlap.");
    }
  }
  await newDirectory(bundle);
  const client = await connect(target);
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const source = await readPreflight(client, target);
    const snapshotResult = await client.query<{ snapshot: string }>(
      "SELECT pg_export_snapshot() AS snapshot",
    );
    const snapshot = snapshotResult.rows[0]?.snapshot;
    if (!snapshot) refuse("No PostgreSQL snapshot was exported.");
    const tables = await tableFingerprints(client);
    const roles = await roleNames(client);
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
    if (supplementary !== "none") await copyArtifacts(supplementary, join(bundle, "supplementary"));
    const files = [];
    for (const path of await filesIn(bundle))
      files.push({ path, ...(await fingerprint(artifactPath(bundle, path))) });
    const manifest = Schema.decodeSync(BackupManifest)({
      version: 1,
      kind: "openerp-local-backup",
      dataClass: "synthetic-local-only",
      createdAt: new Date().toISOString(),
      source,
      snapshot,
      tables,
      roles,
      files,
      supplementaryArtifacts:
        supplementary === "none" ? "operator-declared-none" : "operator-supplied-directory",
      evidenceAndReceipts: "all-user-tables-in-snapshot",
      archiveCompliance: "not-established",
      restoreStatus: "not-exercised",
      productionAction: "disabled",
    });
    await writePrivate(join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const hash = await fingerprint(join(bundle, "manifest.json"));
    await writePrivate(join(bundle, "manifest.sha256"), hash.sha256 + "\n");
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
    paths.some((path) => path !== "database.dump" && !path.startsWith("supplementary/"))
  )
    refuse("Unexpected bundle file inventory.");
  const actualPaths = (await filesIn(bundle)).filter(
    (path) => !["manifest.json", "manifest.sha256"].includes(path),
  );
  if (JSON.stringify(paths) !== JSON.stringify(actualPaths))
    refuse("Bundle file inventory differs from its manifest.");
  for (const file of manifest.files) {
    const actual = await fingerprint(artifactPath(bundle, file.path));
    if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
      refuse("A backup file failed checksum validation.");
  }
  return manifest;
}
export async function restore(
  targetPath: string,
  bundle: string,
  digest: string,
  database: string,
  receiptDirectory: string,
) {
  if (!/^openerp_restore_[a-z0-9_]{1,40}$/.test(database))
    refuse("Use a fresh openerp_restore_ database name (up to 56 characters).");
  const target = await readTarget(targetPath);
  if (target.database !== "postgres")
    refuse("Restore configuration must name the postgres maintenance database.");
  const manifest = await inspectBundle(bundle, digest);
  await newDirectory(receiptDirectory);
  const admin = await connect(target);
  const identifier = admin.escapeIdentifier(database);
  let created = false;
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
    if (existing.rowCount !== 0)
      refuse("Destination already exists. It will not be changed or restored over.");
    const roles = await roleNames(admin);
    if (manifest.roles.some((role) => !roles.includes(role)))
      refuse(
        "Restore cluster is missing source roles. Provision reviewed roles separately; credentials are not backed up.",
      );
    // CREATE fails atomically if another process creates this name. Keep admission closed until ACLs are installed.
    await admin.query(`CREATE DATABASE ${identifier} TEMPLATE template0 ALLOW_CONNECTIONS false`);
    created = true;
    await admin.query(`REVOKE ALL ON DATABASE ${identifier} FROM PUBLIC`);
    await admin.query(`ALTER DATABASE ${identifier} SET default_transaction_read_only = on`);
    await admin.query(`ALTER DATABASE ${identifier} CONNECTION LIMIT 0`);
    await admin.query(`ALTER DATABASE ${identifier} ALLOW_CONNECTIONS true`);
    // Only superusers can connect with limit zero. Restore never enables a runtime writer.
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
    const restored = await connect(target, database);
    try {
      await restored.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const actual = await tableFingerprints(restored);
      if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
        refuse("Restored table fingerprints differ. Destination remains quarantined.");
      await restored.query("ROLLBACK");
    } finally {
      await restored.end();
    }
    await admin.query(`ALTER DATABASE ${identifier} ALLOW_CONNECTIONS false`);
    if (manifest.supplementaryArtifacts === "operator-supplied-directory") {
      await copyArtifacts(join(bundle, "supplementary"), join(receiptDirectory, "supplementary"));
      for (const file of manifest.files.filter((file) => file.path.startsWith("supplementary/"))) {
        const recovered = await fingerprint(artifactPath(receiptDirectory, file.path));
        if (recovered.sha256 !== file.sha256 || recovered.bytes !== file.bytes)
          refuse("Recovered supplementary artifact differs from the manifest.");
      }
    }
    const receipt = Schema.decodeSync(RestoreReceipt)({
      version: 1,
      kind: "openerp-local-restore",
      completedAt: new Date().toISOString(),
      manifestSha256: digest,
      destination: database,
      systemIdentifier: target.expectedSystemIdentifier,
      tableFingerprints: "matched",
      connections: "disabled",
      writerPromotion: "not-performed",
      applicationRecovery: "not-verified",
      archiveCompliance: "not-established",
      productionAction: "disabled",
    });
    await writePrivate(
      join(receiptDirectory, "restore-receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
  } finally {
    try {
      if (created) await admin.query(`ALTER DATABASE ${identifier} ALLOW_CONNECTIONS false`);
    } finally {
      await admin.end();
    }
  }
}
