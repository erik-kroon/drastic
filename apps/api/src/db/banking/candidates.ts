import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import { allocatedLineSql, allocatedSourceSql } from "./shared";

type Json = import("effect/Schema").Json;

export type CandidateSourceRow = {
  readonly statementId: string;
  readonly rowOrdinal: number;
  readonly providerId: string | null;
  readonly sourceBankAccountId: string;
  readonly observedOn: string;
  readonly description: string;
  readonly amountMinor: string;
  readonly allocatedMinor: string;
  readonly accountId: string;
  readonly evidenceId: string;
  readonly evidenceSha256: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly currency: string | null;
  readonly accountVersion: string;
  readonly accountActive: boolean;
  readonly sourceRevision: string;
};

export type CandidatePeriodsRow = {
  readonly total: number;
  readonly periods: Json;
};

export type CandidateLinesRow = {
  readonly total: number;
  readonly lines: Json;
};

export function readCandidateSource(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<CandidateSourceRow>(
    sql`
      select s.id as "statementId", o.row_ordinal as "rowOrdinal", o.provider_id as "providerId",
        o.source_bank_account_id as "sourceBankAccountId", o.observed_on::text as "observedOn",
        o.description, o.amount_minor::text as "amountMinor",
        (${allocatedSourceSql(sql`${bookId}`, sql`o.statement_id`, sql`o.row_ordinal`)})::text
          as "allocatedMinor",
        s.account_id as "accountId", s.evidence_id as "evidenceId", e.sha256 as "evidenceSha256",
        s.starts_on::text as "startsOn", s.ends_on::text as "endsOn", s.source->>'currency' as currency,
        a.version::text as "accountVersion", a.active as "accountActive",
        coalesce((
          select revision::text from openerp.bank_sources
          where book_id = ${bookId} and account_id = s.account_id
        ), '0') as "sourceRevision"
      from openerp.bank_observations o
      join openerp.bank_statements s on (s.book_id, s.id) = (o.book_id, o.statement_id)
      join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
      join openerp.accounts a on (a.book_id, a.id) = (s.book_id, s.account_id)
      where o.book_id = ${bookId} and o.statement_id = ${statementId}
        and o.row_ordinal = ${rowOrdinal}
    `,
    "objects",
  );
}

export function readCandidateStatementExists(
  transaction: Transaction,
  bookId: string,
  statementId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_statements where book_id = ${bookId} and id = ${statementId}
      ) as present
    `,
    "objects",
  );
}

export function readCandidatePeriods(transaction: Transaction, bookId: string) {
  return transaction.execute<CandidatePeriodsRow>(
    sql`
      select
        (select count(*) from (
          select 1 from openerp.periods p where p.book_id = ${bookId} limit 1001
        ) bounded)::integer as total,
        coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version::text,
            'startsOn', p.starts_on::text, 'endsOn', p.ends_on::text, 'locked', p.locked)
            order by p.id collate "C")
          from (select 1 from openerp.periods p where p.book_id = ${bookId} order by p.id for share) p
        ), '[]'::jsonb) as periods
    `,
    "objects",
  );
}

export function readCandidateLines(
  transaction: Transaction,
  bookId: string,
  bookCurrency: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
  committedSequence: string,
  statementId: string,
  rowOrdinal: number,
) {
  const book = sql`${bookId}`;

  return transaction.execute<CandidateLinesRow>(
    sql`
      select
        (select count(*) from (
          select 1
          from openerp.journal_lines l
          join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
          where l.book_id = ${bookId} and l.account_id = ${accountId}
            and v.posting_date between ${startsOn}::date and ${endsOn}::date
            and v.sequence <= ${committedSequence}::bigint
          limit 1001
        ) bounded)::integer as total,
        coalesce((
          select jsonb_agg(jsonb_build_object(
              'voucherId', l.voucher_id, 'lineId', l.id, 'accountId', l.account_id,
              'postedOn', v.posting_date::text, 'sequence', v.sequence::text,
              'description', l.description,
              'amountMinor', (l.debit_minor - l.credit_minor)::text,
              'allocatedMinor', (${allocatedLineSql(book, sql`l.voucher_id`, sql`l.id`)})::text,
              'sameCurrency', v.action->>'currency' is not distinct from ${bookCurrency}::text,
              'postingPurpose', v.posting_purpose,
              'reversed', exists (
                select 1 from openerp.vouchers r
                where r.book_id = v.book_id and r.corrects_voucher_id = v.id
              ),
              'taxReserved', exists (
                select 1 from openerp.tax_account_match_capacity c
                where c.book_id = ${bookId} and c.voucher_id = l.voucher_id and c.line_id = l.id
              ),
              'retainedRelationship',
                exists (
                  select 1 from openerp.bank_matches m
                  where m.book_id = ${bookId} and m.statement_id = ${statementId}
                    and m.row_ordinal = ${rowOrdinal}
                    and m.voucher_id = l.voucher_id and m.line_id = l.id
                )
                or exists (
                  select 1 from openerp.bank_allocation_legs a
                  where a.book_id = ${bookId} and a.statement_id = ${statementId}
                    and a.row_ordinal = ${rowOrdinal}
                    and a.voucher_id = l.voucher_id and a.line_id = l.id
                ),
              'evidenceCited', exists (
                select 1 from jsonb_array_elements(v.action->'evidenceRefs') ref
                where ref->>'evidenceId' = (
                  select evidence_id from openerp.bank_statements
                  where book_id = ${bookId} and id = ${statementId}
                )
              )
            ) order by l.voucher_id, l.id)
          from openerp.journal_lines l
          join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
          where l.book_id = ${bookId} and l.account_id = ${accountId}
            and v.posting_date between ${startsOn}::date and ${endsOn}::date
            and v.sequence <= ${committedSequence}::bigint
        ), '[]'::jsonb) as lines
    `,
    "objects",
  );
}
