import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import { allocatedLineSql, allocatedSourceSql } from "./shared";

export type WorkspaceAccountsRow = { readonly accounts: unknown };

export type WorkspaceActivityRow = {
  readonly total: number;
  readonly counts: {
    readonly all: number;
    readonly unmatched: number;
    readonly matched: number;
    readonly ledger: number;
  };
  readonly rows: unknown;
};

export type WorkspaceReviewsRow = { readonly reviews: unknown };

export function readBankSourceExists(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_sources where book_id = ${bookId} and account_id = ${accountId}
      ) as present
    `,
    "objects",
  );
}

export function readWorkspaceAccounts(
  transaction: Transaction,
  bookId: string,
  committedSequence: string,
  startsOn: string,
  endsOn: string,
) {
  const book = sql`${bookId}`;

  return transaction.execute<WorkspaceAccountsRow>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'code', a.code, 'name', a.name, 'active', a.active,
        'sourceName', s.source_bank_account_id,
        'statementId', latest.id,
        'statementDate', latest.ends_on::text,
        'statementBalanceMinor', latest.source->>'closingMinor',
        'ledgerBalanceMinor', ledger.balance::text,
        'differenceMinor', case when latest.ends_on = ${endsOn}::date
          then ((latest.source->>'closingMinor')::numeric - ledger.balance)::text end,
        'statementCount', (select count(*) from openerp.bank_observations o
          join openerp.bank_statements bs on (bs.book_id, bs.id) = (o.book_id, o.statement_id)
          where o.book_id = ${bookId} and bs.account_id = a.id
            and o.observed_on between ${startsOn}::date and ${endsOn}::date),
        'unmatchedCount', (select count(*) from openerp.bank_observations o
          join openerp.bank_statements bs on (bs.book_id, bs.id) = (o.book_id, o.statement_id)
          where o.book_id = ${bookId} and bs.account_id = a.id
            and o.observed_on between ${startsOn}::date and ${endsOn}::date
            and o.amount_minor <> ${allocatedSourceSql(book, sql`bs.id`, sql`o.row_ordinal`)}),
        'unmatchedLedgerCount', (select count(*) from openerp.journal_lines jl
          join openerp.vouchers v on (v.book_id, v.id) = (jl.book_id, jl.voucher_id)
          where jl.book_id = ${bookId} and jl.account_id = a.id
            and v.posting_date between ${startsOn}::date and ${endsOn}::date
            and v.sequence <= ${committedSequence}::bigint
            and jl.debit_minor - jl.credit_minor <> ${allocatedLineSql(
              book,
              sql`jl.voucher_id`,
              sql`jl.id`,
            )})
      ) order by a.code), '[]'::jsonb) as accounts
      from openerp.bank_sources s
      join openerp.accounts a on (a.book_id, a.id) = (s.book_id, s.account_id)
      left join lateral (
        select bs.* from openerp.bank_statements bs
        where bs.book_id = ${bookId} and bs.account_id = a.id and bs.ends_on <= ${endsOn}::date
        order by bs.ends_on desc, bs.id desc
        limit 1
      ) latest on true
      cross join lateral (
        select coalesce(sum(jl.debit_minor - jl.credit_minor), 0) as balance
        from openerp.journal_lines jl
        join openerp.vouchers v on (v.book_id, v.id) = (jl.book_id, jl.voucher_id)
        where jl.book_id = ${bookId} and jl.account_id = a.id
          and v.posting_date <= ${endsOn}::date
          and v.sequence <= ${committedSequence}::bigint
      ) ledger
      where s.book_id = ${bookId}
    `,
    "objects",
  );
}

export function readWorkspaceActivity(
  transaction: Transaction,
  bookId: string,
  committedSequence: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
  view: string,
  search: string,
  page: number,
) {
  const book = sql`${bookId}`;

  return transaction.execute<WorkspaceActivityRow>(
    sql`
      with activity as materialized (
        select o.statement_id || ':' || o.row_ordinal::text as id, o.observed_on as date,
          o.description, o.amount_minor as amount,
          ${allocatedSourceSql(book, sql`o.statement_id`, sql`o.row_ordinal`)} as allocated,
          o.statement_id as statement_id, o.row_ordinal as row_ordinal,
          null::text as voucher_id, null::text as line_id, false as ledger
        from openerp.bank_observations o
        join openerp.bank_statements bs on (bs.book_id, bs.id) = (o.book_id, o.statement_id)
        where o.book_id = ${bookId} and bs.account_id = ${accountId}
          and o.observed_on between ${startsOn}::date and ${endsOn}::date
        union all
        select jl.voucher_id || ':' || jl.id, v.posting_date, jl.description,
          jl.debit_minor - jl.credit_minor,
          ${allocatedLineSql(book, sql`jl.voucher_id`, sql`jl.id`)},
          null::text, null::integer, jl.voucher_id, jl.id, true
        from openerp.journal_lines jl
        join openerp.vouchers v on (v.book_id, v.id) = (jl.book_id, jl.voucher_id)
        where jl.book_id = ${bookId} and jl.account_id = ${accountId}
          and v.posting_date between ${startsOn}::date and ${endsOn}::date
          and v.sequence <= ${committedSequence}::bigint
      ), searched as (
        select * from activity
        where ${search} = '' or position(${search} in lower(description)) > 0
      ), filtered as (
        select * from searched
        where case ${view}
          when 'ledger' then ledger
          when 'all' then not ledger
          when 'matched' then not ledger and amount = allocated
          else not ledger and amount <> allocated
        end
      ), paged as (
        select * from filtered order by date desc, id limit 50 offset (${page} - 1) * 50
      )
      select (select count(*)::integer from filtered) as total,
        jsonb_build_object(
          'all', count(*) filter (where not ledger),
          'unmatched', count(*) filter (where not ledger and amount <> allocated),
          'matched', count(*) filter (where not ledger and amount = allocated),
          'ledger', count(*) filter (where ledger)) as counts,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'date', date::text, 'description', description,
          'amountMinor', amount::text, 'allocatedMinor', allocated::text,
          'remainingMinor', (amount - allocated)::text,
          'statementId', statement_id, 'rowOrdinal', row_ordinal,
          'voucherId', voucher_id, 'lineId', line_id) order by date desc, id), '[]') from paged) as rows
      from searched
    `,
    "objects",
  );
}

export function readWorkspaceReviews(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<WorkspaceReviewsRow>(
    sql`
      select coalesce(jsonb_agg(recent.value order by recent.created desc), '[]'::jsonb) as reviews
      from (
        select p.body->>'createdAt' as created, jsonb_build_object(
          'id', p.id, 'reason', p.body->'input'->>'reason', 'createdAt', p.body->>'createdAt',
          'completed', exists (
            select 1 from openerp.bank_allocation_executions e
            where e.book_id = p.book_id and e.plan_id = p.id
          )) as value
        from openerp.bank_allocation_plans p
        where p.book_id = ${bookId} and p.account_id = ${accountId}
          and exists (
            select 1 from jsonb_array_elements(p.body->'snapshot'->'capacities') c
            where (c->>'observedOn')::date between ${startsOn}::date and ${endsOn}::date
          )
        order by p.body->>'createdAt' desc, p.id
        limit 20
      ) recent
    `,
    "objects",
  );
}

export function readDatabaseTime(transaction: Transaction) {
  return transaction.execute<{ readonly now: string }>(
    sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
    "objects",
  );
}
