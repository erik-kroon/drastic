import { sql } from "drizzle-orm";
import { readTableAccess, type JsonObject } from "./commerce/access";
import type { Transaction } from "./transaction";

export type CaptureRow = {
  readonly id: string;
  readonly ordinal: string;
  readonly packId: string;
  readonly evidenceId: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type ArtifactRow = {
  readonly descriptor: JsonObject;
  readonly content: Uint8Array;
};

export type PackRow = { readonly body: JsonObject };

export type PackRowCount = { readonly total: number };

export type StoredRow = { readonly ordinal: string; readonly body: JsonObject };

export type OrdinalRow = { readonly ordinal: string | null };

export type EvidenceRow = { readonly id: string; readonly sha256: string };

export type CaptureWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly ordinal: number;
  readonly packId: string;
  readonly evidenceId: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export const sieTables = [
  "sie_transaction_captures",
  "sie_transaction_artifacts",
  "accountant_review_packs",
  "accountant_review_rows",
  "evidence",
  "command_receipts",
] as const;

export function readSieAccess(transaction: Transaction) {
  return readTableAccess(transaction, sieTables);
}

export function readCapture(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<CaptureRow>(
    sql`
      select id, ordinal::text as ordinal, pack_id as "packId", evidence_id as "evidenceId",
        actor_id as "actorId", body
      from openerp.sie_transaction_captures
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readArtifact(transaction: Transaction, bookId: string, captureId: string) {
  return transaction.execute<ArtifactRow>(
    sql`
      select descriptor, content
      from openerp.sie_transaction_artifacts
      where book_id = ${bookId} and capture_id = ${captureId}
    `,
    "objects",
  );
}

export function insertCapture(transaction: Transaction, row: CaptureWrite) {
  return transaction.execute(
    sql`
      insert into openerp.sie_transaction_captures
        (book_id, id, ordinal, pack_id, evidence_id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.ordinal}, ${row.packId}, ${row.evidenceId},
        ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertArtifact(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly captureId: string;
    readonly descriptor: JsonObject;
    readonly content: Uint8Array;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.sie_transaction_artifacts (book_id, capture_id, descriptor, content)
      values (${row.bookId}, ${row.captureId}, ${JSON.stringify(row.descriptor)}::jsonb,
        ${row.content}::bytea)
    `,
    "objects",
  );
}

export function readPack(transaction: Transaction, bookId: string, packId: string) {
  return transaction.execute<PackRow>(
    sql`
      select body from openerp.accountant_review_packs
      where book_id = ${bookId} and id = ${packId}
      for share
    `,
    "objects",
  );
}

export function countPackRows(transaction: Transaction, bookId: string, packId: string) {
  return transaction.execute<PackRowCount>(
    sql`
      select count(*)::integer as total from openerp.accountant_review_rows
      where book_id = ${bookId} and pack_id = ${packId} and section = 'journal'
    `,
    "objects",
  );
}

export function readPackRows(
  transaction: Transaction,
  bookId: string,
  packId: string,
  section: string,
) {
  return transaction.execute<StoredRow>(
    sql`
      select ordinal::text as ordinal, body
      from openerp.accountant_review_rows
      where book_id = ${bookId} and pack_id = ${packId} and section = ${section}
      order by ordinal
      for share
    `,
    "objects",
  );
}

export function readEvidenceDigest(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<EvidenceRow>(
    sql`
      select id, sha256 from openerp.evidence
      where book_id = ${bookId} and id = ${evidenceId}
      for share
    `,
    "objects",
  );
}

export function readHighestOrdinal(transaction: Transaction, bookId: string) {
  return transaction.execute<OrdinalRow>(
    sql`
      select max(ordinal)::text as ordinal from openerp.sie_transaction_captures
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function countCaptures(transaction: Transaction, bookId: string, cutoff: bigint) {
  return transaction.execute<PackRowCount>(
    sql`
      select count(*)::integer as total from openerp.sie_transaction_captures
      where book_id = ${bookId} and ordinal <= ${cutoff.toString()}::bigint
    `,
    "objects",
  );
}

export function listCaptures(
  transaction: Transaction,
  bookId: string,
  after: bigint,
  cutoff: bigint,
) {
  return transaction.execute<CaptureRow>(
    sql`
      select id, ordinal::text as ordinal, pack_id as "packId", evidence_id as "evidenceId",
        actor_id as "actorId", body
      from openerp.sie_transaction_captures
      where book_id = ${bookId} and ordinal > ${after.toString()}::bigint
        and ordinal <= ${cutoff.toString()}::bigint
      order by ordinal
      limit 25
      for share
    `,
    "objects",
  );
}
