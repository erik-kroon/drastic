import type { BackupManifest } from "@open-erp/contracts/operations";
import { verifyBackupManifest } from "@open-erp/domain/rehearsal-verification";
import { artifactPath, fingerprint, refuse } from "./safety";
import { applicationSequenceTables } from "./application-sequences";
import { workInventoryPaths } from "./durable-work";
import { checked } from "./checkpoint";

function family(path: string) {
  if (path === "database.dump") return "database";

  if (path.startsWith("release/")) return "release";

  if (path.startsWith("supplementary/")) return "supplementary";

  if (/^objects\/v1\/[a-z][a-z0-9_-]{2,127}\/[a-f0-9]{64}$/.test(path)) return "original";

  if (workInventoryPaths.includes(path)) return "durable_work";

  return "unhandled";
}

export async function verifyActualBackup(
  bundle: string,
  manifest: typeof BackupManifest.Type,
  manifestDigest: string,
) {
  if (
    manifest.inventory.applicationSequences === undefined &&
    manifest.tables.some(
      (table) => table.schema === "openerp" && applicationSequenceTables.includes(table.table),
    )
  )
    refuse("BackupIncomplete: Application identity sequences have no retained state census.");
  const members = [];

  for (const file of manifest.files) {
    const kind = family(file.path);

    if (kind === "unhandled")
      refuse("UnhandledFamily: A retained file has no actual backup owner.");
    const actual = await fingerprint(artifactPath(bundle, file.path));
    members.push({
      family: kind,
      contentHash: `sha256:${actual.sha256}`,
      byteSize: actual.bytes,
      verified: actual.sha256 === file.sha256 && actual.bytes === file.bytes,
      references:
        kind === "database"
          ? (manifest.closure?.objects.references.map((reference) => reference.sha256) ?? [])
          : [],
    });
  }

  return checked(
    verifyBackupManifest({
      manifestDigest: `sha256:${manifestDigest}`,
      members,
      familyHandlers: ["database", "release", "supplementary", "original", "durable_work"],
      sameSnapshot:
        manifest.closure?.database === "matched" &&
        /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[1-9][0-9]*$/.test(manifest.snapshot),
    }),
  );
}
