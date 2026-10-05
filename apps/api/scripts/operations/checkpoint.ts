import { constants } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { Digest, Identifier } from "@open-erp/domain/values";
import {
  BuildLedgerInput,
  AcceptanceRow,
  AcceptanceLedger,
  buildAcceptanceLedger,
  type Checked,
} from "@open-erp/domain/rehearsal-verification";
import {
  DatabaseInventory,
  LocalPreflight,
  ReleaseManifest,
  TableFingerprint,
  QueueSequence,
} from "@open-erp/contracts/operations";
import { recoveryReadTables } from "../../src/application/rehearsal-recovery-read";
import { captureRelease, inspectRelease, verifySourceRelease } from "./artifacts";
import {
  connect,
  fingerprint,
  newDirectory,
  privatePath,
  readTarget,
  refuse,
  writePrivate,
} from "./safety";
import { readApplicationSequences } from "./application-sequences";
import { readQueueSequences } from "./queue";
import { databaseInventory } from "./inventory";
import { readPreflight, tableFingerprints } from "./snapshot";

const FileEvidence = Schema.Struct({
  id: Identifier,
  path: Schema.String,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

const Handoff = Schema.Struct({
  packet: Schema.String,
  sourceDigest: Digest,
  observedAssertions: Schema.Array(Schema.String),
  evidence: Schema.Array(FileEvidence),
});

const CheckpointInput = Schema.Struct({
  version: Schema.Literal(1),
  targetPath: Schema.String,
  sourceRoot: Schema.String,
  bookId: Schema.String,
  requiredPackets: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  rows: Schema.Array(AcceptanceRow).check(Schema.isMinLength(1)),
  handoffs: Schema.Array(Handoff),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export const Checkpoint = Schema.Struct({
  version: Schema.Literal(1),
  checkpointId: Schema.String,
  repositoryCommit: Schema.String,
  dirtyDiffDigest: Schema.String,
  sourceDigest: Schema.String,
  capturedAt: Schema.String,
  bookId: Schema.String,
  runtime: Schema.Struct({ bun: Schema.String, node: Schema.String, postgres: Schema.String }),
  release: ReleaseManifest,
  database: LocalPreflight,
  inventory: DatabaseInventory,
  tables: Schema.Array(TableFingerprint),
  queueSequences: Schema.Array(QueueSequence),
  acceptanceLedger: AcceptanceLedger,
  evidenceFiles: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      path: Schema.String,
      sha256: Schema.String,
      bytes: Schema.String,
    }),
  ),
  application: Schema.Struct({
    bookId: Schema.String,
    tables: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  }),
});

export const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export const sourceDigest = (release: typeof ReleaseManifest.Type) =>
  `sha256:${digest(JSON.stringify(release.files))}`;

export function checked<A>(result: Checked<A>): A {
  if (Result.isFailure(result)) refuse(`${result.failure.code}: ${result.failure.message}`);

  return result.success;
}

async function git(root: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });

  const [exit, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exit !== 0) refuse("StaleEvidence: Repository identity could not be observed.");

  return stdout;
}

export async function applicationSnapshot(client: Client, bookId: string) {
  const tables: Record<string, ReadonlyArray<string>> = {};

  for (const table of recoveryReadTables) {
    const key = table === "books" ? "id" : "book_id";

    const rows = await client.query<{ body: string[] }>(
      `select coalesce(jsonb_agg(to_jsonb(t)::text order by to_jsonb(t)::text collate "C"),'[]'::jsonb) as body from openerp.${client.escapeIdentifier(table)} t where ${key}=$1`,
      [bookId],
    );

    const row = rows.rows[0];

    if (!row) refuse("ControlDifference: Application source inventory could not be observed.");
    tables[table] = row.body;
  }

  return { bookId, tables };
}

export async function captureCheckpoint(configPath: string, destination: string) {
  await privatePath(configPath, false);

  const input = Schema.decodeUnknownSync(CheckpointInput)(
    JSON.parse(await readFile(configPath, "utf8")),
  );

  const target = await readTarget(input.targetPath);

  if (!/^openerp_ops_source_[a-z0-9_]+$/.test(target.database))
    refuse("Checkpoint requires an explicitly synthetic source database.");
  await newDirectory(destination);
  const releaseDirectory = join(destination, "release");
  const commit = (await git(input.sourceRoot, ["rev-parse", "HEAD"])).trim();
  const dirtyDiff = await git(input.sourceRoot, ["diff", "HEAD", "--binary"]);
  await captureRelease(input.sourceRoot, releaseDirectory);
  const release = await inspectRelease(releaseDirectory);
  const capturedDigest = sourceDigest(release);
  const checkpointId = `checkpoint_${randomUUID()}`;
  const evidenceFiles: Array<(typeof Checkpoint.Type)["evidenceFiles"][number]> = [];
  const seen = new Set<string>();

  for (const handoff of input.handoffs) {
    for (const evidence of handoff.evidence) {
      if (seen.has(evidence.id)) refuse("StaleEvidence: Duplicate evidence identity.");
      seen.add(evidence.id);
      const actual = await fingerprint(evidence.path);

      if (actual.sha256 !== evidence.sha256)
        refuse("StaleEvidence: Owner evidence bytes differ from their declared hash.");
      const path = `${evidenceFiles.length + 1}.evidence`;
      await copyFile(evidence.path, join(destination, path), constants.COPYFILE_EXCL);
      const copied = await fingerprint(join(destination, path));

      if (copied.sha256 !== actual.sha256 || copied.bytes !== actual.bytes)
        refuse("StaleEvidence: Evidence changed while retained.");
      evidenceFiles.push({ id: evidence.id, path, ...actual });
    }
  }

  for (const row of input.rows) {
    if (row.observedEvidence !== null && !seen.has(row.observedEvidence))
      refuse("StaleEvidence: Acceptance row has no hash-verified evidence.");
  }

  const ledger = checked(
    buildAcceptanceLedger(
      Schema.decodeSync(BuildLedgerInput)({
        checkpointId,
        repositoryCommit: `commit_${commit}`,
        sourceDigest: capturedDigest,
        rows: input.rows,
        requiredPackets: input.requiredPackets,
        handoffs: input.handoffs.map((handoff) => ({
          ...handoff,
          evidenceRefs: handoff.evidence.map((evidence) => evidence.id),
        })),
      }),
    ),
  );

  const client = await connect(target);

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const database = await readPreflight(client, target);

    if (database.books.length !== 1 || database.books[0]?.id !== input.bookId)
      refuse("FenceViolation: Checkpoint must contain exactly the selected synthetic book.");
    const queueSequences = await readQueueSequences(client);
    const tables = await tableFingerprints(client);
    const inventory = await databaseInventory(client, release);
    const application = await applicationSnapshot(client, input.bookId);

    const syntheticBook = Schema.decodeSync(
      Schema.Array(
        Schema.fromJsonString(Schema.Struct({ profile: Schema.Literal("synthetic-core-v1") })),
      ),
    )(application.tables.books ?? []);

    if (syntheticBook.length !== 1)
      refuse("FenceViolation: Checkpoint book has no actual synthetic profile.");

    if (
      !isDeepStrictEqual(queueSequences, await readQueueSequences(client)) ||
      !isDeepStrictEqual(inventory.applicationSequences, await readApplicationSequences(client))
    )
      refuse("StaleEvidence: Non-MVCC sequence state moved during checkpoint capture.");
    await client.query("ROLLBACK");

    await verifySourceRelease(input.sourceRoot, release);

    if (
      (await git(input.sourceRoot, ["rev-parse", "HEAD"])).trim() !== commit ||
      (await git(input.sourceRoot, ["diff", "HEAD", "--binary"])) !== dirtyDiff
    )
      refuse("StaleEvidence: Repository changed during checkpoint capture.");

    const checkpoint = Schema.decodeSync(Checkpoint)({
      version: 1,
      checkpointId,
      repositoryCommit: commit,
      dirtyDiffDigest: `sha256:${digest(dirtyDiff)}`,
      sourceDigest: capturedDigest,
      capturedAt: new Date().toISOString(),
      bookId: input.bookId,
      runtime: { bun: Bun.version, node: process.version, postgres: database.serverVersion },
      release,
      database,
      inventory,
      tables,
      queueSequences,
      acceptanceLedger: ledger,
      evidenceFiles,
      application,
    });

    await writePrivate(
      join(destination, "checkpoint.json"),
      JSON.stringify(checkpoint, null, 2) + "\n",
    );
    await writePrivate(
      join(destination, "checkpoint.sha256"),
      (await fingerprint(join(destination, "checkpoint.json"))).sha256 + "\n",
    );
  } finally {
    await client.end();
  }
}

export async function readCheckpoint(path: string, expectedDigest: string) {
  const actual = await fingerprint(path);

  if (actual.sha256 !== expectedDigest)
    refuse("StaleEvidence: Checkpoint bytes differ from the operator reference.");
  const checkpoint = Schema.decodeUnknownSync(Checkpoint)(JSON.parse(await readFile(path, "utf8")));

  for (const evidence of checkpoint.evidenceFiles) {
    if (!/^\d+\.evidence$/.test(evidence.path))
      refuse("StaleEvidence: Invalid retained owner evidence path.");

    const actualEvidence = await fingerprint(
      join(path.slice(0, path.lastIndexOf("/")), evidence.path),
    );

    if (actualEvidence.sha256 !== evidence.sha256 || actualEvidence.bytes !== evidence.bytes)
      refuse("StaleEvidence: Retained owner evidence bytes changed.");
  }

  if (
    sourceDigest(checkpoint.release) !== checkpoint.sourceDigest ||
    checkpoint.acceptanceLedger.sourceDigest !== checkpoint.sourceDigest
  )
    refuse("StaleEvidence: Checkpoint source inventory disagrees with its ledger.");

  if (checkpoint.acceptanceLedger.waitingHandoffs.length !== 0)
    refuse("MissingHandoff: Connected rehearsal still has waiting owner handoffs.");

  for (const row of checkpoint.acceptanceLedger.rows) {
    if (
      row.blockers.length !== 0 ||
      row.observedEvidence === null ||
      (row.applicability === "yes" && row.implementedRevision === null)
    )
      refuse(
        "MissingHandoff: An acceptance row is blocked or lacks actual revision/evidence ownership.",
      );
  }

  return checkpoint;
}
