import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { readTableAccess, type JsonObject } from "../commerce/access";
import type { Transaction } from "../transaction";

export type CountRow = { readonly total: number };

export type SourceRow = {
  readonly id: string;
  readonly sourceKey: string;
  readonly recordClass: string;
};

export type RevisionRow = {
  readonly id: string;
  readonly sourceId: string;
  readonly revision: number;
  readonly evidenceId: string;
  readonly voucherId: string | null;
  readonly body: JsonObject;
};

export type ReviewRow = {
  readonly id: string;
  readonly sourceId: string;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export type WithdrawalRow = {
  readonly id: string;
  readonly sourceId: string;
  readonly revision: number;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export type SnapshotRow = {
  readonly id: string;
  readonly ordinal: string;
  readonly body: JsonObject;
};

export type ItemRow = { readonly item: JsonObject };

export type PlanRow = { readonly plan: JsonObject };

export type VoucherActionRow = { readonly action: JsonObject };

export type EvidenceRow = { readonly id: string; readonly sha256: string };

export type BookStateRow = {
  readonly id: string;
  readonly profile: string;
  readonly profileVersion: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly committedSequence: string;
};

export const expenseTaxTables = [
  "expense_tax_sources",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "expense_tax_source_withdrawals",
  "expense_tax_snapshots",
  "evidence",
  "change_sets",
  "vouchers",
  "command_receipts",
  "books",
] as const;

export function readExpenseTaxAccess(transaction: Transaction) {
  return readTableAccess(transaction, expenseTaxTables);
}

export function readBookState(transaction: Transaction, bookId: string) {
  return transaction.execute<BookStateRow>(
    sql`
      select id, profile, profile_version::text as "profileVersion", currency,
        currency_scale as "currencyScale", committed_sequence::text as "committedSequence"
      from openerp.books
      where id = ${bookId}
    `,
    "objects",
  );
}

export function readSourceByKey(transaction: Transaction, bookId: string, sourceKey: string) {
  return transaction.execute<SourceRow>(
    sql`
      select id, source_key as "sourceKey", record_class as "recordClass"
      from openerp.expense_tax_sources
      where book_id = ${bookId} and source_key = ${sourceKey}
    `,
    "objects",
  );
}

export function readSourceById(transaction: Transaction, bookId: string, sourceId: string) {
  return transaction.execute<SourceRow>(
    sql`
      select id, source_key as "sourceKey", record_class as "recordClass"
      from openerp.expense_tax_sources
      where book_id = ${bookId} and id = ${sourceId}
    `,
    "objects",
  );
}

export function readSourceCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.expense_tax_sources where book_id = ${bookId}`,
    "objects",
  );
}

export function insertSource(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly sourceKey: string;
    readonly recordClass: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.expense_tax_sources (book_id, id, source_key, record_class)
      values (${row.bookId}, ${row.id}, ${row.sourceKey}, ${row.recordClass})
    `,
    "objects",
  );
}

export function readCurrentRevision(
  transaction: Transaction,
  bookId: string,
  sourceId: string,
  lock: "share" | "update" = "share",
) {
  return transaction.execute<RevisionRow>(
    sql`
      select id, source_id as "sourceId", revision, evidence_id as "evidenceId",
        voucher_id as "voucherId", body
      from openerp.expense_tax_source_revisions
      where book_id = ${bookId} and source_id = ${sourceId}
      order by revision desc
      limit 1
      ${lock === "update" ? sql`for update` : sql`for share`}
    `,
    "objects",
  );
}

export function readRevisionHistory(transaction: Transaction, bookId: string, sourceId: string) {
  return transaction.execute<RevisionRow>(
    sql`
      select id, source_id as "sourceId", revision, evidence_id as "evidenceId",
        voucher_id as "voucherId", body
      from openerp.expense_tax_source_revisions
      where book_id = ${bookId} and source_id = ${sourceId}
      order by revision
    `,
    "objects",
  );
}

export function insertRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly sourceId: string;
    readonly revision: number;
    readonly id: string;
    readonly evidenceId: string;
    readonly changeSetId: string | null;
    readonly voucherId: string | null;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.expense_tax_source_revisions
        (book_id, source_id, revision, id, evidence_id, change_set_id, voucher_id, body)
      values (${row.bookId}, ${row.sourceId}, ${row.revision}, ${row.id}, ${row.evidenceId},
        ${row.changeSetId}, ${row.voucherId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readLatestReview(transaction: Transaction, bookId: string, sourceId: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select id, source_id as "sourceId", revision, source_revision as "sourceRevision",
        evidence_id as "evidenceId", body
      from openerp.expense_tax_reviews
      where book_id = ${bookId} and source_id = ${sourceId}
      order by revision desc
      limit 1
    `,
    "objects",
  );
}

export function readReviewHistory(transaction: Transaction, bookId: string, sourceId: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select id, source_id as "sourceId", revision, source_revision as "sourceRevision",
        evidence_id as "evidenceId", body
      from openerp.expense_tax_reviews
      where book_id = ${bookId} and source_id = ${sourceId}
      order by revision
    `,
    "objects",
  );
}

export function insertReview(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly sourceId: string;
    readonly revision: number;
    readonly sourceRevision: number;
    readonly id: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.expense_tax_reviews
        (book_id, source_id, revision, source_revision, id, evidence_id, body)
      values (${row.bookId}, ${row.sourceId}, ${row.revision}, ${row.sourceRevision}, ${row.id},
        ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readWithdrawal(transaction: Transaction, bookId: string, sourceId: string) {
  return transaction.execute<WithdrawalRow>(
    sql`
      select id, source_id as "sourceId", revision, evidence_id as "evidenceId", body
      from openerp.expense_tax_source_withdrawals
      where book_id = ${bookId} and source_id = ${sourceId}
    `,
    "objects",
  );
}

export function insertWithdrawal(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly sourceId: string;
    readonly revision: number;
    readonly id: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.expense_tax_source_withdrawals
        (book_id, source_id, revision, id, evidence_id, body)
      values (${row.bookId}, ${row.sourceId}, ${row.revision}, ${row.id}, ${row.evidenceId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readCurrentInventory(transaction: Transaction, bookId: string) {
  return transaction.execute<ItemRow>(
    sql`
      select jsonb_build_object(
        'sourceId', s.id,
        'current', current.body,
        'latestReview', review.body,
        'withdrawal', withdrawal.body
      ) as item
      from openerp.expense_tax_sources s
      join lateral (
        select x.body from openerp.expense_tax_source_revisions x
        where x.book_id = s.book_id and x.source_id = s.id
        order by x.revision desc limit 1
      ) current on true
      left join lateral (
        select x.body from openerp.expense_tax_reviews x
        where x.book_id = s.book_id and x.source_id = s.id
        order by x.revision desc limit 1
      ) review on true
      left join openerp.expense_tax_source_withdrawals withdrawal
        on withdrawal.book_id = s.book_id and withdrawal.source_id = s.id
      where s.book_id = ${bookId}
      order by s.id collate "C"
      limit 201
    `,
    "objects",
  );
}

export type BasisRow = { readonly item: JsonObject };

export function readBasisSources(transaction: Transaction, bookId: string) {
  return transaction.execute<BasisRow>(
    sql`
      select jsonb_build_object(
        'id', s.id,
        'sourceDigest', current.body->>'digest',
        'reviewDigest', review.body->>'digest',
        'withdrawalDigest', withdrawal.body->>'digest'
      ) as item
      from openerp.expense_tax_sources s
      join lateral (
        select x.body from openerp.expense_tax_source_revisions x
        where x.book_id = s.book_id and x.source_id = s.id
        order by x.revision desc limit 1
      ) current on true
      left join lateral (
        select x.body from openerp.expense_tax_reviews x
        where x.book_id = s.book_id and x.source_id = s.id
        order by x.revision desc limit 1
      ) review on true
      left join openerp.expense_tax_source_withdrawals withdrawal
        on withdrawal.book_id = s.book_id and withdrawal.source_id = s.id
      where s.book_id = ${bookId}
      order by s.id collate "C"
      limit 201
    `,
    "objects",
  );
}

export type DuplicateRow = { readonly sourceId: string | null };

// One bounded lookup answers both duplicate-component and ambiguous-voucher questions.
export function readCompetingSources(
  transaction: Transaction,
  bookId: string,
  sourceId: string,
  evidenceSha256: string,
  sourceLocator: string,
) {
  return transaction.execute<DuplicateRow>(
    sql`
      with current as (
        select s.id, s.source_key, latest.body, latest.voucher_id,
          withdrawal.source_id is not null as withdrawn
        from openerp.expense_tax_sources s
        join lateral (
          select x.body, x.voucher_id from openerp.expense_tax_source_revisions x
          where x.book_id = s.book_id and x.source_id = s.id
          order by x.revision desc limit 1
        ) latest on true
        left join openerp.expense_tax_source_withdrawals withdrawal
          on withdrawal.book_id = s.book_id and withdrawal.source_id = s.id
        where s.book_id = ${bookId} and s.id <> ${sourceId} and withdrawal.source_id is null
      )
      select (
        select c.id from current c
        where c.body->>'evidenceSha256' = ${evidenceSha256}
          and c.body->'facts'->>'sourceLocator' = ${sourceLocator}
        limit 1
      ) as "sourceId"
    `,
    "objects",
  );
}

export function readCompetingVoucherSources(
  transaction: Transaction,
  bookId: string,
  sourceId: string,
  voucherId: string,
) {
  return transaction.execute<DuplicateRow>(
    sql`
      select (
        select s.id
        from openerp.expense_tax_sources s
        join lateral (
          select x.voucher_id from openerp.expense_tax_source_revisions x
          where x.book_id = s.book_id and x.source_id = s.id
          order by x.revision desc limit 1
        ) latest on true
        left join openerp.expense_tax_source_withdrawals w
          on w.book_id = s.book_id and w.source_id = s.id
        where s.book_id = ${bookId} and s.id <> ${sourceId} and w.source_id is null
          and latest.voucher_id = ${voucherId}
        limit 1
      ) as "sourceId"
    `,
    "objects",
  );
}

export function readPlan(transaction: Transaction, bookId: string, changeSetId: string) {
  return transaction.execute<PlanRow>(
    sql`select plan from openerp.change_sets where book_id = ${bookId} and id = ${changeSetId}`,
    "objects",
  );
}

export function readVoucherAction(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  changeSetId: string | null,
) {
  return transaction.execute<VoucherActionRow>(
    sql`
      select action from openerp.vouchers
      where book_id = ${bookId} and id = ${voucherId}
        and (${changeSetId}::text is null or change_set_id = ${changeSetId})
    `,
    "objects",
  );
}

export function readEvidenceDigests(
  transaction: Transaction,
  bookId: string,
  evidenceIds: ReadonlyArray<string>,
) {
  const unique = [...new Set(evidenceIds)];
  if (unique.length === 0) return Effect.succeed<ReadonlyArray<EvidenceRow>>([]);
  return transaction.execute<EvidenceRow>(
    sql`
      select id, sha256 from openerp.evidence
      where book_id = ${bookId}
        and id = any(array[${sql.join(
          unique.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[])
      order by id collate "C"
    `,
    "objects",
  );
}

export function readSnapshot(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<SnapshotRow>(
    sql`
      select id, ordinal::text as ordinal, body from openerp.expense_tax_snapshots
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readSnapshotCeiling(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly ordinal: string }>(
    sql`
      select coalesce(max(ordinal), 0)::text as ordinal from openerp.expense_tax_snapshots
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function readSnapshotWindow(
  transaction: Transaction,
  bookId: string,
  afterOrdinal: string,
  ceilingOrdinal: string,
  limit: number,
) {
  return transaction.execute<SnapshotRow>(
    sql`
      select id, ordinal::text as ordinal, body from openerp.expense_tax_snapshots
      where book_id = ${bookId} and ordinal > ${afterOrdinal} and ordinal <= ${ceilingOrdinal}
      order by ordinal
      limit ${limit}
    `,
    "objects",
  );
}

export function readSnapshotExistsAtOrdinal(
  transaction: Transaction,
  bookId: string,
  ordinal: string,
) {
  return transaction.execute<{ readonly found: boolean }>(
    sql`
      select exists(
        select 1 from openerp.expense_tax_snapshots where book_id = ${bookId} and ordinal = ${ordinal}
      ) as found
    `,
    "objects",
  );
}

export function insertSnapshot(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ordinal: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.expense_tax_snapshots (book_id, id, ordinal, body)
      values (${row.bookId}, ${row.id}, ${row.ordinal}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readSnapshotCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.expense_tax_snapshots where book_id = ${bookId}`,
    "objects",
  );
}
