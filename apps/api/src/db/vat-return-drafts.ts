import { sql } from "drizzle-orm";
import { readTableAccess, type JsonObject } from "./commerce/access";
import type { Transaction } from "./transaction";

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type BookStateRow = {
  readonly committedSequence: string;
  readonly profile: string;
  readonly profileVersion: string;
  readonly currency: string;
  readonly currencyScale: number;
};

export type FactCountRow = { readonly total: number };

export type FactsRow = { readonly facts: ReadonlyArray<JsonObject> };

export type EvidenceRow = { readonly sha256: string };

export type DraftCountRow = { readonly ordinal: number };

export type DraftWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly ordinal: number;
  readonly body: JsonObject;
};

export const draftTables = [
  "vat_return_drafts",
  "vat_fact_components",
  "vat_fact_revisions",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "expense_tax_source_withdrawals",
  "vat_fact_withdrawals",
  "vouchers",
  "journal_lines",
  "books",
  "evidence",
  "command_receipts",
] as const;

export function readDraftWriteAccess(transaction: Transaction) {
  return readTableAccess(transaction, draftTables);
}

export function readBookState(transaction: Transaction, bookId: string) {
  return transaction.execute<BookStateRow>(
    sql`
      select committed_sequence::text as "committedSequence", profile,
        profile_version::text as "profileVersion", currency,
        currency_scale as "currencyScale"
      from openerp.books
      where id = ${bookId}
    `,
    "objects",
  );
}

export function countFactComponents(transaction: Transaction, bookId: string) {
  return transaction.execute<FactCountRow>(
    sql`
      select count(*)::integer as total from openerp.vat_fact_components
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function readBasisFacts(transaction: Transaction, bookId: string) {
  return transaction.execute<FactsRow>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
        'fact', r.body,
        'withdrawal', withdrawal.body,
        'expenseSourceWithdrawn', expense_withdrawal.source_id is not null,
        'expenseLinkCurrent', case
          when r.body->'input'->'expenseLink' = 'null'::jsonb then true
          else expense_withdrawal.source_id is null
            and coalesce(source.digest, '') = r.body->>'expenseSourceDigest'
            and coalesce(review.digest, '') = r.body->>'expenseReviewDigest' end,
        'voucherReversed', coalesce(v.posting_purpose = 'reversal', false)
          or exists (
            select 1 from openerp.vouchers x
            where x.book_id = ${bookId} and x.corrects_voucher_id = r.voucher_id
              and x.posting_purpose = 'reversal'
          ),
        'voucherPostingDate', v.posting_date::text,
        'taxLines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'accountId', l.account_id, 'debitMinor', l.debit_minor::text,
            'creditMinor', l.credit_minor::text) order by l.ordinal)
          from openerp.journal_lines l
          where l.book_id = ${bookId} and l.voucher_id = r.voucher_id
            and r.body->'input'->'taxLineIds' ? l.id
        ), '[]'::jsonb)
      ) order by c.id collate "C"), '[]'::jsonb) as facts
      from openerp.vat_fact_components c
      join lateral (
        select x.* from openerp.vat_fact_revisions x
        where x.book_id = ${bookId} and x.fact_id = c.id
        order by x.revision desc limit 1
      ) r on true
      left join openerp.vouchers v on v.book_id = ${bookId} and v.id = r.voucher_id
      left join lateral (
        select s.body->>'digest' as digest from openerp.expense_tax_source_revisions s
        where s.book_id = ${bookId}
          and s.source_id = r.body->'input'->'expenseLink'->>'sourceId'
        order by s.revision desc limit 1
      ) source on true
      left join lateral (
        select s.body->>'digest' as digest from openerp.expense_tax_reviews s
        where s.book_id = ${bookId}
          and s.source_id = r.body->'input'->'expenseLink'->>'sourceId'
        order by s.revision desc limit 1
      ) review on true
      left join openerp.vat_fact_withdrawals withdrawal
        on withdrawal.book_id = ${bookId} and withdrawal.fact_id = c.id
      left join openerp.expense_tax_source_withdrawals expense_withdrawal
        on expense_withdrawal.book_id = ${bookId}
          and expense_withdrawal.source_id = r.body->'input'->'expenseLink'->>'sourceId'
      where c.book_id = ${bookId}
    `,
    "objects",
  );
}

export function readEvidenceDigest(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<EvidenceRow>(
    sql`
      select sha256 from openerp.evidence
      where book_id = ${bookId} and id = ${evidenceId}
      for share
    `,
    "objects",
  );
}

export function readNextDraftOrdinal(transaction: Transaction, bookId: string) {
  return transaction.execute<DraftCountRow>(
    sql`
      select (count(*)::integer + 1) as ordinal from openerp.vat_return_drafts
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function insertDraft(transaction: Transaction, row: DraftWrite) {
  return transaction.execute(
    sql`
      insert into openerp.vat_return_drafts (book_id, id, ordinal, body)
      values (${row.bookId}, ${row.id}, ${row.ordinal}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readDraft(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`select body from openerp.vat_return_drafts where book_id = ${bookId} and id = ${id}`,
    "objects",
  );
}
