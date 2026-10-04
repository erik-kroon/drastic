import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import * as Schema from "effect/Schema";
import * as Match from "effect/Match";
import {
  BackupManifest,
  BookBoundary,
  RecoveryWorkInventory,
  RecoveryWorkInventoryV3,
  RecoveryWorkInventoryV4,
  ReminderWorkSummary,
  RecurringWorkSummary,
  RecoveryWorkSummary,
  TableFingerprint,
} from "../../../../packages/contracts/src/operations";
import { artifactPath, fingerprint, refuse } from "./safety";
import { queueTables, readQueueSequences } from "./queue";
import { requireFencedBackupBoundary } from "./snapshot";

export const workInventoryPath = "durable-work-v4.json";

export const workInventoryPaths = [
  "durable-work-v2.json",
  "durable-work-v3.json",
  workInventoryPath,
];

const inventoryByteLimit = 8388608;

const legacyWorkTables = [
  "outbox",
  "preparation_runs",
  "preparation_jobs",
  "posting_saved_requests",
];

const recurringWorkTables = [
  "recurring_invoice_draft_schedules",
  "recurring_invoice_draft_schedule_events",
  "recurring_invoice_draft_jobs",
];

const reminderWorkTables = [
  "reminder_messages",
  "reminder_approvals",
  "reminder_attempts",
  "reminder_outbox",
  "reminder_observations",
];

const workTables = [...legacyWorkTables, ...recurringWorkTables, ...reminderWorkTables];

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

function recurringSummary(
  inventory: Pick<
    typeof RecoveryWorkInventoryV3.Type,
    | "outbox"
    | "runs"
    | "jobs"
    | "savedRequests"
    | "recurringSchedules"
    | "recurringEvents"
    | "recurringJobs"
  >,
) {
  return Schema.decodeSync(RecurringWorkSummary)({
    ...workSummary(inventory),
    recurringSchedules: String(inventory.recurringSchedules.length),
    enabledRecurringSchedules: String(
      inventory.recurringSchedules.filter((row) => row.enabled).length,
    ),
    recurringEvents: String(inventory.recurringEvents.length),
    recurringJobs: String(inventory.recurringJobs.length),
    readyRecurringJobs: String(
      inventory.recurringJobs.filter((row) => row.state === "ready").length,
    ),
    failedRecurringJobs: String(
      inventory.recurringJobs.filter((row) => row.state === "failed").length,
    ),
  });
}

function reminderSummary(
  inventory: Omit<
    typeof RecoveryWorkInventoryV4.Type,
    | "summary"
    | "version"
    | "queue"
    | "kind"
    | "snapshot"
    | "books"
    | "providerAttemptHistory"
    | "remoteWorkflowState"
    | "resumptionAuthority"
  >,
) {
  return Schema.decodeSync(ReminderWorkSummary)({
    ...recurringSummary(inventory),
    reminderMessages: String(inventory.reminderMessages.length),
    reminderApprovals: String(inventory.reminderApprovals.length),
    reminderAttempts: String(inventory.reminderAttempts.length),
    reminderOutbox: String(inventory.reminderOutbox.length),
    reminderObservations: String(inventory.reminderObservations.length),
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
  const summary = Match.value(inventory).pipe(
    Match.when({ version: 4 }, reminderSummary),
    Match.when({ version: 3 }, recurringSummary),
    Match.orElse(workSummary),
  );

  if (!isDeepStrictEqual(summary, inventory.summary))
    refuse("Durable work summary differs from its complete retained inventory.");

  const queue = tables.filter(
    (table) => table.schema === "public" && queueTables.includes(table.table),
  );

  if (queue.length !== queueTables.length || !isDeepStrictEqual(queue, inventory.queue.tables))
    refuse("Queue work inventory differs from the complete snapshot table fingerprints.");

  const expectedSequences = [
    { name: "effect_mq_flow_outbox_id_seq", table: "effect_mq_flow_outbox", column: "id" },
    { name: "effect_mq_jobs_seq_seq", table: "effect_mq_jobs", column: "seq" },
  ];

  if (
    !isDeepStrictEqual(
      inventory.queue.sequences.map(({ name, table, column }) => ({ name, table, column })),
      expectedSequences,
    )
  )
    refuse("Queue work inventory has missing or unexpected sequence identities.");

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
      (item) => item.schema === "openerp" && item.table === legacyWorkTables[index],
    );

    if (!table || BigInt(table.rows) !== BigInt(family.length))
      refuse("Durable work inventory differs from snapshot table counts.");
    uniqueScopedIds(family);

    if (family.some((item) => !bookIds.has(item.bookId)))
      refuse("Durable work belongs to an unrepresented book.");
  }

  if (inventory.version !== 2) {
    const recurringFamilies = [
      inventory.recurringSchedules.map((row) => ({ bookId: row.bookId, id: row.agreementId })),
      inventory.recurringEvents.map((row) => ({
        bookId: row.bookId,
        id: JSON.stringify([row.agreementId, row.generation]),
      })),
      inventory.recurringJobs,
    ];

    for (const [index, family] of recurringFamilies.entries()) {
      const table = tables.find(
        (item) => item.schema === "openerp" && item.table === recurringWorkTables[index],
      );

      if (!table || BigInt(table.rows) !== BigInt(family.length))
        refuse("Recurring business progress differs from snapshot table counts.");
      uniqueScopedIds(family);

      if (family.some((row) => !bookIds.has(row.bookId)))
        refuse("Recurring work belongs to an unrepresented book.");
    }

    const schedules = new Map(
      inventory.recurringSchedules.map((row) => [
        JSON.stringify([row.bookId, row.agreementId]),
        row,
      ]),
    );

    for (const row of [...inventory.recurringJobs, ...inventory.recurringEvents]) {
      const schedule = schedules.get(JSON.stringify([row.bookId, row.agreementId]));

      if (!schedule || BigInt(row.generation) < 1n)
        refuse("Recurring progress has no scoped enrollment or positive generation.");
    }

    for (const schedule of inventory.recurringSchedules) {
      const events = inventory.recurringEvents.filter(
        (row) => row.bookId === schedule.bookId && row.agreementId === schedule.agreementId,
      );

      if (
        BigInt(schedule.firstAutomaticCycle) > BigInt(schedule.nextCycleOrdinal) ||
        BigInt(schedule.generation) !== BigInt(events.length) ||
        events.some((row, index) => BigInt(row.generation) !== BigInt(index + 1))
      )
        refuse(
          "Recurring examined cursor or complete enrollment event generation boundary is invalid.",
        );
    }
  }

  if (inventory.version === 4) {
    const families = [
      inventory.reminderMessages,
      inventory.reminderApprovals.map((row) => ({ bookId: row.bookId, id: row.messageId })),
      inventory.reminderAttempts,
      inventory.reminderOutbox.map((row) => ({ bookId: row.bookId, id: row.messageId })),
      inventory.reminderObservations.map((row) => ({
        bookId: row.bookId,
        id: JSON.stringify([row.attemptId, row.observationId]),
      })),
    ];

    for (const [index, family] of families.entries()) {
      const table = tables.find(
        (row) => row.schema === "openerp" && row.table === reminderWorkTables[index],
      );

      if (!table || BigInt(table.rows) !== BigInt(family.length))
        refuse("Reminder inventory differs from complete snapshot table counts.");
      uniqueScopedIds(family);

      if (family.some((row) => !bookIds.has(row.bookId)))
        refuse("Reminder work belongs to an unrepresented book.");
    }

    const messages = new Set(
      inventory.reminderMessages.map((row) => JSON.stringify([row.bookId, row.id])),
    );

    const approvals = new Set(
      inventory.reminderApprovals.map((row) => JSON.stringify([row.bookId, row.messageId])),
    );

    const attempts = new Set(
      inventory.reminderAttempts.map((row) => JSON.stringify([row.bookId, row.id])),
    );

    if (
      inventory.reminderApprovals.some(
        (row) => !messages.has(JSON.stringify([row.bookId, row.messageId])),
      )
    )
      refuse("Reminder approval has no scoped retained message.");

    if (
      [...inventory.reminderAttempts, ...inventory.reminderOutbox].some(
        (row) => !approvals.has(JSON.stringify([row.bookId, row.messageId])),
      )
    )
      refuse("Reminder progress has no scoped retained approval.");

    if (
      inventory.reminderObservations.some(
        (row) => !attempts.has(JSON.stringify([row.bookId, row.attemptId])),
      )
    )
      refuse("Reminder observation has no scoped admitted attempt.");
    uniqueScopedIds(
      inventory.reminderAttempts.map((row) => ({ bookId: row.bookId, id: row.messageId })),
    );

    if (
      new Set(inventory.reminderAttempts.map((row) => row.externalIdentity)).size !==
      inventory.reminderAttempts.length
    )
      refuse("Reminder attempts contain duplicate external identities.");
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

  await requireFencedBackupBoundary(client);

  const books = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'id',id,'authority',authority,'writerEpoch',writer_epoch::text,'committedSequence',committed_sequence::text) AS body
    FROM openerp.books ORDER BY id COLLATE "C"`);

  const recurringSchedules = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'agreementId',agreement_id,'enabled',enabled,'generation',generation::text,
    'firstAutomaticCycle',first_automatic_cycle::text,'nextCycleOrdinal',next_cycle_ordinal::text,
    'requestedBy',requested_by,'timeZone',time_zone,'duePolicy',due_policy) AS body
    FROM openerp.recurring_invoice_draft_schedules ORDER BY book_id COLLATE "C",agreement_id COLLATE "C"`);

  const recurringEvents = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'agreementId',agreement_id,'generation',generation::text,
    'bodySha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) AS body
    FROM openerp.recurring_invoice_draft_schedule_events ORDER BY book_id COLLATE "C",agreement_id COLLATE "C",generation`);

  const recurringJobs = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'id',id,'agreementId',agreement_id,'cycleOrdinal',cycle_ordinal::text,
    'generation',generation::text,'scheduleGeneration',schedule_generation::text,'requestedBy',requested_by,'executorId',executor_id,
    'admittedSha256',encode(sha256(convert_to(admitted::text,'UTF8')),'hex'),'state',state,'reason',reason,'draftId',draft_id,
    'dispatchedAt',to_char(dispatched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'settledAt',to_char(settled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS body
    FROM openerp.recurring_invoice_draft_jobs ORDER BY book_id COLLATE "C",id COLLATE "C"`);

  const reminderMessages = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'id',id,'bodySha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) AS body
    FROM openerp.reminder_messages ORDER BY book_id COLLATE "C",id COLLATE "C"`);

  const reminderApprovals = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'messageId',message_id,'bodySha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) AS body
    FROM openerp.reminder_approvals ORDER BY book_id COLLATE "C",message_id COLLATE "C"`);

  const reminderAttempts = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'id',id,'messageId',message_id,'externalIdentity',external_identity,'bodySha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) AS body
    FROM openerp.reminder_attempts ORDER BY book_id COLLATE "C",id COLLATE "C"`);

  const reminderOutbox = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'messageId',message_id,'state',state,'checkpoint',checkpoint,'cancelVersion',cancel_version,'reason',reason,
    'checkedAt',to_char(checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS body
    FROM openerp.reminder_outbox ORDER BY book_id COLLATE "C",message_id COLLATE "C"`);

  const reminderObservations = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'bookId',book_id,'attemptId',attempt_id,'observationId',observation_id,'bodySha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) AS body
    FROM openerp.reminder_observations ORDER BY book_id COLLATE "C",attempt_id COLLATE "C",observation_id COLLATE "C"`);

  const families = {
    reminderMessages: Schema.decodeUnknownSync(RecoveryWorkInventoryV4.fields.reminderMessages)(
      reminderMessages.rows.map((row) => row.body),
    ),
    reminderApprovals: Schema.decodeUnknownSync(RecoveryWorkInventoryV4.fields.reminderApprovals)(
      reminderApprovals.rows.map((row) => row.body),
    ),
    reminderAttempts: Schema.decodeUnknownSync(RecoveryWorkInventoryV4.fields.reminderAttempts)(
      reminderAttempts.rows.map((row) => row.body),
    ),
    reminderOutbox: Schema.decodeUnknownSync(RecoveryWorkInventoryV4.fields.reminderOutbox)(
      reminderOutbox.rows.map((row) => row.body),
    ),
    reminderObservations: Schema.decodeUnknownSync(
      RecoveryWorkInventoryV4.fields.reminderObservations,
    )(reminderObservations.rows.map((row) => row.body)),
    recurringSchedules: Schema.decodeUnknownSync(RecoveryWorkInventoryV3.fields.recurringSchedules)(
      recurringSchedules.rows.map((row) => row.body),
    ),
    recurringEvents: Schema.decodeUnknownSync(RecoveryWorkInventoryV3.fields.recurringEvents)(
      recurringEvents.rows.map((row) => row.body),
    ),
    recurringJobs: Schema.decodeUnknownSync(RecoveryWorkInventoryV3.fields.recurringJobs)(
      recurringJobs.rows.map((row) => row.body),
    ),
    outbox: Schema.decodeUnknownSync(RecoveryWorkInventoryV3.fields.outbox)(
      outbox.rows.map((row) => row.body),
    ),
    runs: Schema.decodeUnknownSync(RecoveryWorkInventoryV3.fields.runs)(
      runs.rows.map((row) => row.body),
    ),
    jobs: Schema.decodeUnknownSync(RecoveryWorkInventoryV3.fields.jobs)(
      jobs.rows.map((row) => row.body),
    ),
    savedRequests: Schema.decodeUnknownSync(RecoveryWorkInventoryV3.fields.savedRequests)(
      requests.rows.map((row) => row.body),
    ),
  };

  const inventory = Schema.decodeSync(RecoveryWorkInventoryV4)({
    version: 4,
    queue: {
      tables: tables.filter(
        (table) => table.schema === "public" && queueTables.includes(table.table),
      ),
      sequences: await readQueueSequences(client),
    },
    kind: "openerp-durable-work-inventory",
    snapshot,
    books: books.rows.map((row) => Schema.decodeUnknownSync(BookBoundary)(row.body)),
    ...families,
    summary: reminderSummary(families),
    providerAttemptHistory: "payment-reminder-attempts-retained",
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
    if (manifest.files.some((file) => workInventoryPaths.includes(file.path)))
      refuse("A durable work file has no manifest descriptor.");

    return undefined;
  }

  if (
    !workInventoryPaths.includes(retained.file.path) ||
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

  const inventory = Schema.decodeUnknownSync(RecoveryWorkInventory, { onExcessProperty: "error" })(
    JSON.parse(await readFile(path, "utf8")),
  );

  if (retained.file.path !== `durable-work-v${inventory.version}.json`)
    refuse("Durable work version differs from its qualified artifact path.");

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
