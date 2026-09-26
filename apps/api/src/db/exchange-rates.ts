import { sql } from "drizzle-orm";
import type { JsonObject } from "./commerce/access";
import { readTableAccess } from "./commerce/access";
import type { Transaction } from "./transaction";

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type ObservationRow = {
  readonly id: string;
  readonly sourceKey: string;
};

export type RevisionRow = {
  readonly revision: number;
  readonly evidenceId: string;
  readonly reviewEvidenceId: string;
  readonly body: JsonObject;
};

export type WithdrawalRow = { readonly body: JsonObject };

export type EvidenceRow = { readonly id: string; readonly sha256: string };

export type BoundRow = { readonly total: number };

export type ConversionRow = {
  readonly id: string;
  readonly observationId: string;
  readonly revision: number;
  readonly evidenceId: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export type BookBasisRow = {
  readonly currency: string;
  readonly currencyScale: number;
  readonly profile: string;
  readonly profileVersion: string;
  readonly writerAuthority: string;
  readonly writerEpoch: string;
};

export type RevisionWrite = {
  readonly bookId: string;
  readonly observationId: string;
  readonly revision: number;
  readonly evidenceId: string;
  readonly reviewEvidenceId: string;
  readonly body: JsonObject;
};

export type ConversionWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly observationId: string;
  readonly revision: number;
  readonly evidenceId: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export type WithdrawalWrite = {
  readonly bookId: string;
  readonly observationId: string;
  readonly id: string;
  readonly revision: number;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export const rateTables = [
  "exchange_rate_observations",
  "exchange_rate_revisions",
  "exchange_rate_withdrawals",
  "exchange_conversion_reviews",
  "evidence",
  "command_receipts",
] as const;

export function readRateAccess(transaction: Transaction) {
  return readTableAccess(transaction, rateTables);
}

export function readObservations(transaction: Transaction, bookId: string) {
  return transaction.execute<ObservationRow>(
    sql`
      select id, source_key as "sourceKey"
      from openerp.exchange_rate_observations
      where book_id = ${bookId}
      order by source_key collate "C"
    `,
    "objects",
  );
}

export function readObservationBySourceKey(
  transaction: Transaction,
  bookId: string,
  sourceKey: string,
) {
  return transaction.execute<ObservationRow>(
    sql`
      select id, source_key as "sourceKey"
      from openerp.exchange_rate_observations
      where book_id = ${bookId} and source_key = ${sourceKey}
      for share
    `,
    "objects",
  );
}

export function countObservations(transaction: Transaction, bookId: string) {
  return transaction.execute<BoundRow>(
    sql`select count(*)::integer as total from openerp.exchange_rate_observations where book_id = ${bookId}`,
    "objects",
  );
}

export function readRevisions(transaction: Transaction, bookId: string, observationId: string) {
  return transaction.execute<RevisionRow>(
    sql`
      select revision, evidence_id as "evidenceId", review_evidence_id as "reviewEvidenceId", body
      from openerp.exchange_rate_revisions
      where book_id = ${bookId} and observation_id = ${observationId}
      order by revision
    `,
    "objects",
  );
}

export function readWithdrawal(transaction: Transaction, bookId: string, observationId: string) {
  return transaction.execute<WithdrawalRow>(
    sql`
      select body from openerp.exchange_rate_withdrawals
      where book_id = ${bookId} and observation_id = ${observationId}
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

export function readBookBasis(transaction: Transaction, bookId: string) {
  return transaction.execute<BookBasisRow>(
    sql`
      select currency, currency_scale as "currencyScale", profile,
        profile_version::text as "profileVersion", authority as "writerAuthority",
        writer_epoch::text as "writerEpoch"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function insertObservation(
  transaction: Transaction,
  row: { readonly bookId: string; readonly id: string; readonly sourceKey: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.exchange_rate_observations (book_id, id, source_key)
      values (${row.bookId}, ${row.id}, ${row.sourceKey})
    `,
    "objects",
  );
}

export function insertRevision(transaction: Transaction, row: RevisionWrite) {
  return transaction.execute(
    sql`
      insert into openerp.exchange_rate_revisions
        (book_id, observation_id, revision, evidence_id, review_evidence_id, body)
      values (${row.bookId}, ${row.observationId}, ${row.revision}, ${row.evidenceId},
        ${row.reviewEvidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertWithdrawal(transaction: Transaction, row: WithdrawalWrite) {
  return transaction.execute(
    sql`
      insert into openerp.exchange_rate_withdrawals
        (book_id, observation_id, id, revision, evidence_id, body)
      values (${row.bookId}, ${row.observationId}, ${row.id}, ${row.revision}, ${row.evidenceId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function countConversions(transaction: Transaction, bookId: string) {
  return transaction.execute<BoundRow>(
    sql`select count(*)::integer as total from openerp.exchange_conversion_reviews where book_id = ${bookId}`,
    "objects",
  );
}

export function readConversion(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<ConversionRow>(
    sql`
      select id, observation_id as "observationId", revision, evidence_id as "evidenceId",
        body, content, sha256, byte_length as "byteLength"
      from openerp.exchange_conversion_reviews
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function listConversions(transaction: Transaction, bookId: string) {
  return transaction.execute<ConversionRow>(
    sql`
      select id, observation_id as "observationId", revision, evidence_id as "evidenceId",
        body, content, sha256, byte_length as "byteLength"
      from openerp.exchange_conversion_reviews
      where book_id = ${bookId}
      order by id collate "C"
    `,
    "objects",
  );
}

export function insertConversion(transaction: Transaction, row: ConversionWrite) {
  return transaction.execute(
    sql`
      insert into openerp.exchange_conversion_reviews
        (book_id, id, observation_id, revision, evidence_id, body, content, sha256, byte_length)
      values (${row.bookId}, ${row.id}, ${row.observationId}, ${row.revision}, ${row.evidenceId},
        ${JSON.stringify(row.body)}::jsonb, ${row.content}, ${row.sha256}, ${row.byteLength})
    `,
    "objects",
  );
}
