import { sql } from "drizzle-orm";
import { readTableAccess, type JsonObject } from "./commerce/access";
import type { Transaction } from "./transaction";

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type OccurrenceKeyRow = {
  readonly id: string;
  readonly sha256: string;
  readonly body: JsonObject;
};

export type ContentRow = {
  readonly sha256: string;
  readonly objectKey: string | null;
  readonly byteLength: number;
  readonly content: Uint8Array | null;
};

export type UploadRow = {
  readonly input: JsonObject;
  readonly createdBy: string;
};

export type StorageRow = {
  readonly id: string;
  readonly sha256: string;
  readonly body: JsonObject;
  readonly latestPreviewId: string | null;
  readonly admissionBody: JsonObject | null;
  readonly objectKey: string | null;
  readonly objectSha256: string | null;
  readonly objectByteLength: number | null;
  readonly inlineContent: Uint8Array | null;
  readonly previewIds: ReadonlyArray<string>;
};

export type OccurrenceWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly sha256: string;
  readonly sourceSystem: string;
  readonly sourceAccountId: string;
  readonly occurrenceKey: string;
  readonly sourceRevision: string;
  readonly body: JsonObject;
};

export type ArchiveFilters = {
  readonly cursor: string | null;
  readonly sourceSystem: string | null;
  readonly filename: string | null;
  readonly retainedFrom: string | null;
  readonly retainedTo: string | null;
};

export const retentionTables = [
  "intake_occurrences",
  "intake_contents",
  "intake_previews",
  "intake_admissions",
  "source_uploads",
  "command_receipts",
] as const;

export function readRetentionAccess(transaction: Transaction) {
  return readTableAccess(transaction, retentionTables);
}

export function readOccurrenceByKey(
  transaction: Transaction,
  bookId: string,
  key: {
    readonly sourceSystem: string;
    readonly sourceAccountId: string;
    readonly occurrenceKey: string;
    readonly sourceRevision: string;
  },
) {
  return transaction.execute<OccurrenceKeyRow>(
    sql`
      select id, sha256, body
      from openerp.intake_occurrences
      where book_id = ${bookId}
        and source_system = ${key.sourceSystem}
        and source_account_id = ${key.sourceAccountId}
        and occurrence_key = ${key.occurrenceKey}
        and source_revision = ${key.sourceRevision}
      for update
    `,
    "objects",
  );
}

export function readExternalContent(transaction: Transaction, bookId: string, sha256: string) {
  return transaction.execute<ContentRow>(
    sql`
      select sha256, object_key as "objectKey",
        coalesce(byte_length, octet_length(bytes)) as "byteLength", bytes as content
      from openerp.intake_contents
      where book_id = ${bookId} and sha256 = ${sha256}
    `,
    "objects",
  );
}

export function insertInlineContent(
  transaction: Transaction,
  bookId: string,
  sha256: string,
  content: Uint8Array,
) {
  return transaction.execute(
    sql`
      insert into openerp.intake_contents (book_id, sha256, bytes)
      values (${bookId}, ${sha256}, ${content}::bytea)
      on conflict (book_id, sha256) do nothing
    `,
    "objects",
  );
}

export function insertExternalContent(
  transaction: Transaction,
  bookId: string,
  sha256: string,
  objectKey: string,
  byteLength: number,
) {
  return transaction.execute(
    sql`
      insert into openerp.intake_contents (book_id, sha256, object_key, byte_length)
      values (${bookId}, ${sha256}, ${objectKey}, ${byteLength})
      on conflict (book_id, sha256) do nothing
    `,
    "objects",
  );
}

export function insertOccurrence(transaction: Transaction, row: OccurrenceWrite) {
  return transaction.execute(
    sql`
      insert into openerp.intake_occurrences
        (book_id, id, sha256, source_system, source_account_id, occurrence_key, source_revision, body)
      values (${row.bookId}, ${row.id}, ${row.sha256}, ${row.sourceSystem}, ${row.sourceAccountId},
        ${row.occurrenceKey}, ${row.sourceRevision}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertSourceUpload(
  transaction: Transaction,
  bookId: string,
  key: string,
  input: JsonObject,
  createdBy: string,
) {
  return transaction.execute(
    sql`
      insert into openerp.source_uploads (book_id, key, input, created_by)
      values (${bookId}, ${key}, ${JSON.stringify(input)}::jsonb, ${createdBy})
      on conflict (book_id, key) do nothing
    `,
    "objects",
  );
}

export function readSourceUpload(transaction: Transaction, bookId: string, key: string) {
  return transaction.execute<UploadRow>(
    sql`
      select input, created_by as "createdBy"
      from openerp.source_uploads
      where book_id = ${bookId} and key = ${key}
      for update
    `,
    "objects",
  );
}

export function readOccurrenceStorage(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<StorageRow>(
    sql`
      select o.id, o.sha256, o.body,
        latest.id as "latestPreviewId",
        a.body as "admissionBody",
        c.object_key as "objectKey", c.sha256 as "objectSha256",
        c.byte_length as "objectByteLength", c.bytes as "inlineContent",
        coalesce((
          select jsonb_agg(p.id order by p.ordinal desc)
          from openerp.intake_previews p
          where p.book_id = o.book_id and p.occurrence_id = o.id
        ), '[]'::jsonb) as "previewIds"
      from openerp.intake_occurrences o
      join openerp.intake_contents c on c.book_id = o.book_id and c.sha256 = o.sha256
      left join lateral (
        select p.id from openerp.intake_previews p
        where p.book_id = o.book_id and p.occurrence_id = o.id
        order by p.ordinal desc limit 1
      ) latest on true
      left join openerp.intake_admissions a on a.book_id = o.book_id and a.occurrence_id = o.id
      where o.book_id = ${bookId} and o.id = ${id}
      for share of o
    `,
    "objects",
  );
}

export function listArchive(transaction: Transaction, bookId: string, filters: ArchiveFilters) {
  return transaction.execute<{ readonly id: string; readonly body: JsonObject }>(
    sql`
      select o.id, o.body
      from openerp.intake_occurrences o
      where o.book_id = ${bookId}
        and o.id > coalesce(${filters.cursor}::text, '')
        and (${filters.sourceSystem}::text is null or o.source_system = ${filters.sourceSystem})
        and (${filters.filename}::text is null or o.body->>'filename' = ${filters.filename})
        and (${filters.retainedFrom}::text is null
          or left(o.body->>'retainedAt', 10) >= ${filters.retainedFrom})
        and (${filters.retainedTo}::text is null
          or left(o.body->>'retainedAt', 10) <= ${filters.retainedTo})
      order by o.id
      limit 11
      for share of o
    `,
    "objects",
  );
}
