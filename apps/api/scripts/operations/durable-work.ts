import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import * as Schema from "effect/Schema";
import {
  BackupManifest,
  BookBoundary,
  RecoveryWorkInventory,
  RecoveryWorkSummary,
  TableFingerprint,
} from "../../../../packages/contracts/src/operations";
import { artifactPath, fingerprint, refuse } from "./safety";

export const workInventoryPath = "durable-work-v1.json";

const inventoryByteLimit = 8388608;

const workTables = ["outbox", "preparation_runs", "preparation_jobs", "posting_saved_requests"];

function workSummary(
  inventory: Pick<typeof RecoveryWorkInventory.Type, "outbox" | "runs" | "jobs" | "savedRequests">,
) {
  return Schema.decodeSync(RecoveryWorkSummary)({
    outboxRows: String(inventory.outbox.length),
    undeliveredOutbox: String(inventory.outbox.filter((item) => item.deliveredAt === null).length),
    undeliveredWithAttempts: String(
      inventory.outbox.filter((item) => item.deliveredAt === null && BigInt(item.attempts) > 0n)
        .length,
    ),
    outboxAttemptCount: inventory.outbox
      .reduce((sum, item) => sum + BigInt(item.attempts), 0n)
      .toString(),
    preparationRuns: String(inventory.runs.length),
    unfinishedRuns: String(inventory.runs.filter((item) => item.state !== "completed").length),
    preparationJobs: String(inventory.jobs.length),
    readyJobs: String(inventory.jobs.filter((item) => item.state === "ready").length),
    blockedOrStoppedJobs: String(
      inventory.jobs.filter((item) => item.state === "blocked" || item.state === "stopped").length,
    ),
    savedRequests: String(inventory.savedRequests.length),
    requestsWithoutOutcome: String(
      inventory.savedRequests.filter((item) => item.outcome === null).length,
    ),
  });
}

function uniqueScopedIds(items: ReadonlyArray<{ bookId: string; id: string }>) {
  if (new Set(items.map((item) => JSON.stringify([item.bookId, item.id]))).size !== items.length)
    refuse("Durable work inventory contains duplicate scoped identities.");
}

function validateInventory(
  inventory: typeof RecoveryWorkInventory.Type,
  tables: ReadonlyArray<typeof TableFingerprint.Type>,
) {
  if (!isDeepStrictEqual(workSummary(inventory), inventory.summary))
    refuse("Durable work summary differs from its complete retained inventory.");
  const bookIds = new Set(inventory.books.map((book) => book.id));

  if (bookIds.size !== inventory.books.length)
    refuse("Durable work inventory contains duplicate books.");

  const families = [
    inventory.outbox,
    inventory.runs,
    inventory.jobs,
    inventory.savedRequests.map((item) => ({ bookId: item.bookId, id: item.key })),
  ];

  for (const [index, family] of families.entries()) {
    const table = tables.find(
      (item) => item.schema === "openerp" && item.table === workTables[index],
    );

    if (!table || BigInt(table.rows) !== BigInt(family.length))
      refuse("Durable work inventory differs from snapshot table counts.");
    uniqueScopedIds(family);

    if (family.some((item) => !bookIds.has(item.bookId)))
      refuse("Durable work belongs to an unrepresented book.");
  }

  const runIds = new Set(inventory.runs.map((run) => JSON.stringify([run.bookId, run.id])));

  if (inventory.jobs.some((job) => !runIds.has(JSON.stringify([job.bookId, job.runId]))))
    refuse("A durable preparation job has no scoped retained run.");

  if (inventory.runs.some((run) => BigInt(run.cursor) > BigInt(run.selectedRows)))
    refuse("A preparation cursor exceeds its retained input selection.");
}

// The caller owns the same repeatable-read snapshot as the dump and table fingerprints.
export async function captureWorkInventory(
  client: Client,
  tables: ReadonlyArray<typeof TableFingerprint.Type>,
  snapshot: string,
) {
  for (const name of [
    ...workTables,
    "preparation_run_audit",
    "posting_request_outcomes",
    "command_receipts",
  ]) {
    const table = tables.find((item) => item.schema === "openerp" && item.table === name);

    if (!table || (workTables.includes(name) && BigInt(table.rows) > 10000n))
      refuse(
        "Durable work capture requires the owned job/request tables and at most10000 rows per inventory family.",
      );
  }

  const outbox = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'id',id,'receiptId',receipt_id,'kind',kind,'attempts',attempts::text,
    'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deliveredAt',to_char(delivered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'payloadSha256',encode(sha256(convert_to(payload::text,'UTF8')),'hex')) AS body
    FROM openerp.outbox ORDER BY book_id COLLATE "C",id COLLATE "C"`);

  const runs = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',r.book_id,'id',r.id,'state',r.state,'cursor',r.cursor::text,
    'selectedRows',jsonb_array_length(r.selection->'rows')::text,
    'auditOrdinal',coalesce((SELECT max(a.ordinal) FROM openerp.preparation_run_audit a
      WHERE a.book_id=r.book_id AND a.run_id=r.id),0)::text) AS body
    FROM openerp.preparation_runs r ORDER BY r.book_id COLLATE "C",r.id COLLATE "C"`);

  const jobs = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'id',id,'runId',run_id,'requestedBy',requested_by,'executorId',executor_id,
    'state',state,'checkpoint',checkpoint,'expectedAudit',expected_audit::text,
    'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'checkedAt',to_char(checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS body
    FROM openerp.preparation_jobs ORDER BY book_id COLLATE "C",id COLLATE "C"`);

  const requests = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',r.book_id,'key',r.key,'actorId',r.actor_id,'operation',r.command->>'operation',
    'requestDigest',r.digest,'commandKey',r.command_key,
    'savedAt',to_char(r.saved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'outcome',o.state,'commandReceiptPresent',EXISTS(SELECT FROM openerp.command_receipts c
      WHERE c.book_id=r.book_id AND c.key=r.command_key)) AS body
    FROM openerp.posting_saved_requests r LEFT JOIN openerp.posting_request_outcomes o
      ON o.book_id=r.book_id AND o.key=r.key ORDER BY r.book_id COLLATE "C",r.key COLLATE "C"`);

  const books = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'id',id,'authority',authority,'writerEpoch',writer_epoch::text,'committedSequence',committed_sequence::text) AS body
    FROM openerp.books ORDER BY id COLLATE "C"`);

  const families = {
    outbox: Schema.decodeUnknownSync(RecoveryWorkInventory.fields.outbox)(
      outbox.rows.map((row) => row.body),
    ),
    runs: Schema.decodeUnknownSync(RecoveryWorkInventory.fields.runs)(
      runs.rows.map((row) => row.body),
    ),
    jobs: Schema.decodeUnknownSync(RecoveryWorkInventory.fields.jobs)(
      jobs.rows.map((row) => row.body),
    ),
    savedRequests: Schema.decodeUnknownSync(RecoveryWorkInventory.fields.savedRequests)(
      requests.rows.map((row) => row.body),
    ),
  };

  const inventory = Schema.decodeSync(RecoveryWorkInventory)({
    version: 1,
    kind: "openerp-durable-work-inventory",
    snapshot,
    books: books.rows.map((row) => Schema.decodeUnknownSync(BookBoundary)(row.body)),
    ...families,
    summary: workSummary(families),
    providerAttemptHistory: "not-recorded-by-current-schema",
    remoteWorkflowState: "not-inspected",
    resumptionAuthority: "not-granted",
  });

  validateInventory(inventory, tables);

  if (Buffer.byteLength(JSON.stringify(inventory, null, 2) + "\n", "utf8") > inventoryByteLimit)
    refuse(
      "Durable work inventory exceeds its8MiB artifact bound; no partial inventory is accepted.",
    );

  return inventory;
}

export async function inspectWorkInventory(bundle: string, manifest: typeof BackupManifest.Type) {
  const retained = manifest.durableWork;

  if (!retained) {
    if (manifest.files.some((file) => file.path === workInventoryPath))
      refuse("A durable work file has no manifest descriptor.");

    return undefined;
  }

  if (
    retained.file.path !== workInventoryPath ||
    BigInt(retained.file.bytes) > BigInt(inventoryByteLimit) ||
    !manifest.files.some(
      (file) =>
        file.path === retained.file.path &&
        file.bytes === retained.file.bytes &&
        file.sha256 === retained.file.sha256,
    )
  )
    refuse("Durable work artifact is missing from the exact bundle file inventory.");
  const path = artifactPath(bundle, retained.file.path);
  const actual = await fingerprint(path);

  if (actual.bytes !== retained.file.bytes || actual.sha256 !== retained.file.sha256)
    refuse("Durable work artifact failed checksum validation.");

  const inventory = Schema.decodeUnknownSync(RecoveryWorkInventory)(
    JSON.parse(await readFile(path, "utf8")),
  );

  validateInventory(inventory, manifest.tables);

  if (
    inventory.snapshot !== manifest.snapshot ||
    !isDeepStrictEqual(inventory.books, manifest.source.books) ||
    !isDeepStrictEqual(inventory.summary, retained.summary) ||
    inventory.summary.undeliveredOutbox !== manifest.source.pendingOutbox
  )
    refuse("Durable work inventory differs from its snapshot/preflight manifest boundary.");

  if (
    retained.recoveryProcedurePath !== null &&
    !manifest.artifacts.some(
      (file) =>
        file.path === retained.recoveryProcedurePath &&
        ["configuration", "key-recovery"].includes(file.kind),
    )
  )
    refuse("Durable work recovery procedure is not a declared retained artifact.");

  return inventory;
}
