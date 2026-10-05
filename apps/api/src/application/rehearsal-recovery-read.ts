import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { sql } from "drizzle-orm";
import {
  readRetainedObject,
  sourceDigest,
  type RetainedObjectStore,
} from "../adapters/storage/retained-objects";
import { Database } from "../db/connection";

export const recoveryReadTables = [
  "books",
  "vouchers",
  "journal_lines",
  "evidence",
  "execution_receipts",
  "command_receipts",
  "intake_contents",
  "report_snapshots",
  "report_lines",
  "sie_book_exports",
  "sie_book_export_artifacts",
  "outbox",
] as const;

export const RecoveryReadAction = Schema.Literals(["inspect", "post", "approve", "dispatch"]);

export class RecoveryAdmission extends Context.Service<
  RecoveryAdmission,
  {
    readonly bookId: string;
    readonly readerRole: string;
    readonly originals: RetainedObjectStore;
  }
>()("open-erp/RehearsalRecoveryAdmission") {}

export class RecoveryReadDenied extends Schema.TaggedError<RecoveryReadDenied>()(
  "RecoveryReadDenied",
  { reason: Schema.Literals(["book_scope", "local_admission_fence", "identity"]) },
) {}

const ReadRows = Schema.Array(Schema.String);

const OriginalRow = Schema.Struct({
  book_id: Schema.String,
  sha256: Schema.String,
  bytes: Schema.NullOr(Schema.String),
  object_key: Schema.NullOr(Schema.String),
  byte_length: Schema.NullOr(Schema.Int),
});

const EvidenceRow = Schema.Struct({
  book_id: Schema.String,
  content: Schema.String,
  sha256: Schema.String,
});

const ArtifactRow = Schema.Struct({
  book_id: Schema.String,
  export_id: Schema.String,
  content: Schema.String,
  descriptor: Schema.Struct({
    exportId: Schema.String,
    scope: Schema.Struct({ bookId: Schema.String }),
    sha256: Schema.String,
    byteLength: Schema.Int,
  }),
});

function hexBytes(value: string) {
  if (!/^\\x(?:[a-f0-9]{2})+$/.test(value)) return null;

  return Uint8Array.from(value.slice(2).match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export const inspectRehearsalRecovery = Effect.fn("rehearsal.recovery.inspect")(function* (
  bookId: string,
  action: typeof RecoveryReadAction.Type = "inspect",
) {
  const admission = yield* RecoveryAdmission;

  if (bookId !== admission.bookId) return yield* new RecoveryReadDenied({ reason: "book_scope" });

  if (action !== "inspect")
    return yield* new RecoveryReadDenied({ reason: "local_admission_fence" });
  const database = yield* Database;

  return yield* database.transaction((transaction) =>
    Effect.gen(function* () {
      yield* transaction.execute(sql`set transaction isolation level repeatable read, read only`);
      yield* transaction.execute(sql`set local timezone = 'UTC'`);
      yield* transaction.execute(sql`set local datestyle = 'ISO,YMD'`);
      yield* transaction.execute(sql`set local extra_float_digits = 3`);

      const identity = yield* transaction.execute<{ identity: string }>(
        sql`select current_user as identity`,
        "objects",
      );

      if (identity[0]?.identity !== admission.readerRole)
        return yield* new RecoveryReadDenied({ reason: "identity" });
      const tables: Record<string, ReadonlyArray<string>> = {};

      for (const table of recoveryReadTables) {
        const rows = yield* transaction.execute<{ body: unknown }>(
          sql`select coalesce(jsonb_agg(to_jsonb(t)::text order by to_jsonb(t)::text collate "C"), '[]'::jsonb) as body from ${sql.identifier("openerp_rehearsal")}.${sql.identifier(table)} t`,
          "objects",
        );

        tables[table] = yield* Schema.decodeUnknownEffect(ReadRows)(rows[0]?.body);
      }

      for (const evidence of tables.evidence ?? []) {
        const row = yield* Schema.decodeEffect(Schema.fromJsonString(EvidenceRow))(evidence);

        if (
          row.book_id !== admission.bookId ||
          (yield* sourceDigest(new TextEncoder().encode(row.content))) !== `sha256:${row.sha256}`
        )
          return yield* new RecoveryReadDenied({ reason: "identity" });
      }

      for (const artifact of tables.sie_book_export_artifacts ?? []) {
        const row = yield* Schema.decodeEffect(Schema.fromJsonString(ArtifactRow))(artifact);
        const bytes = hexBytes(row.content);

        if (
          !bytes ||
          row.book_id !== admission.bookId ||
          row.descriptor.scope.bookId !== admission.bookId ||
          row.export_id !== row.descriptor.exportId ||
          bytes.length !== row.descriptor.byteLength ||
          (yield* sourceDigest(bytes)) !== `sha256:${row.descriptor.sha256}`
        )
          return yield* new RecoveryReadDenied({ reason: "identity" });
      }

      for (const original of tables.intake_contents ?? []) {
        const row = yield* Schema.decodeEffect(Schema.fromJsonString(OriginalRow))(original);

        if (row.book_id !== admission.bookId)
          return yield* new RecoveryReadDenied({ reason: "book_scope" });

        if (row.object_key !== null) {
          if (row.byte_length === null)
            return yield* new RecoveryReadDenied({ reason: "identity" });
          yield* readRetainedObject(admission.originals, {
            objectKey: row.object_key,
            sha256: row.sha256,
            byteLength: row.byte_length,
          });
        } else {
          if (row.bytes === null) return yield* new RecoveryReadDenied({ reason: "identity" });

          const bytes = hexBytes(row.bytes);

          if (!bytes) return yield* new RecoveryReadDenied({ reason: "identity" });

          if ((yield* sourceDigest(bytes)) !== row.sha256)
            return yield* new RecoveryReadDenied({ reason: "identity" });
        }
      }

      return { bookId: admission.bookId, tables };
    }),
  );
});
