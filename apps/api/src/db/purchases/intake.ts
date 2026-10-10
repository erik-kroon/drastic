import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";

export function bindEnvelope(
  transaction: Transaction,
  bookId: string,
  account: string,
  envelope: string,
  manifest: string,
) {
  return transaction.execute(sql`
    INSERT INTO openerp.supplier_intake_envelopes (book_id, source_account_id, envelope_id, manifest_sha256)
    VALUES (${bookId}, ${account}, ${envelope}, ${manifest})
    ON CONFLICT DO NOTHING
  `);
}

export function readEnvelope(
  transaction: Transaction,
  bookId: string,
  account: string,
  envelope: string,
) {
  return transaction.execute<{ readonly manifest: string }>(
    sql`
    SELECT manifest_sha256 AS manifest FROM openerp.supplier_intake_envelopes
    WHERE book_id = ${bookId} AND source_account_id = ${account} AND envelope_id = ${envelope}
  `,
    "objects",
  );
}

export function reserveBatch(
  transaction: Transaction,
  bookId: string,
  key: string,
  actorId: string,
  operation: string,
  digest: string,
) {
  return transaction.execute(sql`
    INSERT INTO openerp.supplier_intake_batches (book_id, idempotency_key, actor_id, operation, request_sha256)
    VALUES (${bookId}, ${key}, ${actorId}, ${operation}, ${digest})
    ON CONFLICT DO NOTHING
  `);
}

export function readBatch(transaction: Transaction, bookId: string, key: string) {
  return transaction.execute<{
    readonly actorId: string;
    readonly operation: string;
    readonly digest: string;
    readonly body: unknown;
  }>(
    sql`
    SELECT b.actor_id AS "actorId", b.operation, b.request_sha256 AS digest, r.body
    FROM openerp.supplier_intake_batches b
    LEFT JOIN openerp.supplier_intake_batch_results r USING (book_id, idempotency_key)
    WHERE b.book_id = ${bookId} AND b.idempotency_key = ${key}
  `,
    "objects",
  );
}

export function saveBatch(
  transaction: Transaction,
  bookId: string,
  key: string,
  result: typeof import("@open-erp/contracts/supplier-inbox").IntakeBatchResult.Type,
) {
  return transaction.execute(sql`
    INSERT INTO openerp.supplier_intake_batch_results (book_id, idempotency_key, body)
    VALUES (${bookId}, ${key}, ${JSON.stringify(result)}::jsonb)
    ON CONFLICT DO NOTHING
  `);
}

export function readConnection(
  transaction: Transaction,
  bookId: string,
  provider: string,
  account: string,
  folder: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
    SELECT true AS present FROM openerp.supplier_intake_connections
    WHERE book_id = ${bookId} AND provider = ${provider} AND source_account_id = ${account} AND folder_id = ${folder}
  `,
    "objects",
  );
}

export type IntakeProvenance = {
  readonly channel: "email" | "bulk" | "drive" | "dropbox";
  readonly sourceAccountId: string;
  readonly envelopeId: string | null;
  readonly folderId: string | null;
  readonly fileId: string;
  readonly revision: string;
};

export function bindProvenance(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  source: IntakeProvenance,
) {
  return transaction.execute(sql`
    INSERT INTO openerp.supplier_intake_provenance
      (book_id, occurrence_id, channel, source_account_id, envelope_id, folder_id, file_id, source_revision)
    VALUES (${bookId}, ${occurrenceId}, ${source.channel}, ${source.sourceAccountId}, ${source.envelopeId}, ${source.folderId}, ${source.fileId}, ${source.revision})
    ON CONFLICT DO NOTHING
  `);
}

export function readProvenance(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<IntakeProvenance>(
    sql`
    SELECT channel, source_account_id AS "sourceAccountId", envelope_id AS "envelopeId", folder_id AS "folderId", file_id AS "fileId", source_revision AS revision
    FROM openerp.supplier_intake_provenance
    WHERE book_id = ${bookId} AND occurrence_id = ${occurrenceId}
  `,
    "objects",
  );
}
