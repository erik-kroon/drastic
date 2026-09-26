import { textArray } from "../sql-values";
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "../transaction";

export type Json = import("effect/Schema").Json;
export type JsonObject = import("effect/Schema").JsonObject;

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type ColumnAccess = {
  readonly columnName: string;
  readonly canSelect: boolean;
};

export type ColumnUpdateAccess = {
  readonly columnName: string;
  readonly canUpdate: boolean;
};

export type BookStateRow = {
  readonly id: string;
  readonly entityId: string;
  readonly profile: string;
  readonly profileVersion: string;
  readonly writerEpoch: string;
  readonly authority: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly committedSequence: string;
};

export type DigestRow = { readonly digest: string | null };

export type AccountRow = {
  readonly id: string;
  readonly active: boolean;
};

export type EvidenceRow = {
  readonly id: string;
  readonly content: string;
  readonly mediaType: string;
  readonly sha256: string;
};

export const coverageTables = [
  "books",
  "accounts",
  "periods",
  "closing_inventories",
  "bank_sources",
  "bank_statements",
  "bank_observations",
  "bank_matches",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "bank_allocation_legs",
  "bank_allocation_plans",
  "bank_allocation_approvals",
  "bank_allocation_executions",
  "bank_capacity_reconciliations",
  "bank_source_coverage_reports",
  "bank_signoff_plans",
  "bank_reconciliation_signoffs",
  "bank_inventory_signoff_plans",
  "bank_inventory_signoffs",
  "bank_connector_consents",
  "bank_connector_batches",
  "bank_connector_records",
  "bank_match_reversal_plans",
  "bank_match_reversal_approvals",
  "bank_match_reversal_revocations",
  "bank_match_reversals",
  "bank_reconciliations",
  "tax_account_match_capacity",
  "memberships",
  "vouchers",
  "journal_lines",
  "evidence",
  "command_receipts",
  "intake_contents",
  "intake_occurrences",
] as const;

export function readTableAccess(transaction: Transaction) {
  return transaction.execute<TableAccess>(
    sql`
      select
        access.table_name as "tableName",
        case when to_regclass('openerp.' || access.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || access.table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || access.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || access.table_name, 'insert') end as "canInsert"
      from unnest(${textArray(coverageTables)}) as access(table_name)
    `,
    "objects",
  );
}

function tableOf(name: string) {
  return name.slice(0, name.indexOf("."));
}

function columnOf(name: string) {
  return name.slice(name.indexOf(".") + 1);
}

export function readColumnAccess(transaction: Transaction, names: ReadonlyArray<string>) {
  return transaction.execute<ColumnAccess>(
    sql`
      select
        access.table_name || '.' || access.column_name as "columnName",
        has_column_privilege(
          current_user,
          'openerp.' || access.table_name,
          access.column_name,
          'select'
        ) as "canSelect"
      from unnest(
        ${textArray(names.map(tableOf))},
        ${textArray(names.map(columnOf))}
      ) as access(table_name, column_name)
    `,
    "objects",
  );
}

export function readColumnUpdateAccess(transaction: Transaction, names: ReadonlyArray<string>) {
  return transaction.execute<ColumnUpdateAccess>(
    sql`
      select
        access.table_name || '.' || access.column_name as "columnName",
        has_column_privilege(
          current_user,
          'openerp.' || access.table_name,
          access.column_name,
          'update'
        ) as "canUpdate"
      from unnest(
        ${textArray(names.map(tableOf))},
        ${textArray(names.map(columnOf))}
      ) as access(table_name, column_name)
    `,
    "objects",
  );
}

export function lockBook(transaction: Transaction, bookId: string, mode: "share" | "update") {
  return transaction.execute<BookStateRow>(
    mode === "update"
      ? sql`
          select id, entity_id as "entityId", profile, profile_version::text as "profileVersion",
            writer_epoch::text as "writerEpoch", authority, currency,
            currency_scale as "currencyScale", committed_sequence::text as "committedSequence"
          from openerp.books
          where id = ${bookId}
          for update
        `
      : sql`
          select id, entity_id as "entityId", profile, profile_version::text as "profileVersion",
            writer_epoch::text as "writerEpoch", authority, currency,
            currency_scale as "currencyScale", committed_sequence::text as "committedSequence"
          from openerp.books
          where id = ${bookId}
          for share
        `,
    "objects",
  );
}

export function readAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<AccountRow>(
    sql`
      select id, active
      from openerp.accounts
      where book_id = ${bookId} and id = ${accountId}
    `,
    "objects",
  );
}

export function readAccounts(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
) {
  return transaction.execute<AccountRow>(
    sql`
      select id, active
      from openerp.accounts
      where book_id = ${bookId} and id = any(${textArray(accountIds)})
    `,
    "objects",
  );
}

// Effective matching capacity always reads the active projections, so a reversed
// match or allocation releases its source and posted-line capacity immediately.
export function allocatedSourceSql(bookId: SQL, statement: SQL, ordinal: SQL) {
  return sql`
    coalesce((
      select o.amount_minor
      from openerp.bank_active_matches m
      join openerp.bank_observations o
        on (o.book_id, o.statement_id, o.row_ordinal) = (m.book_id, m.statement_id, m.row_ordinal)
      where m.book_id = ${bookId} and m.statement_id = ${statement} and m.row_ordinal = ${ordinal}
    ), 0) + coalesce((
      select sum(a.amount_minor) from openerp.bank_active_allocation_legs a
      where a.book_id = ${bookId} and a.statement_id = ${statement} and a.row_ordinal = ${ordinal}
    ), 0)`;
}

export function allocatedLineSql(bookId: SQL, voucher: SQL, line: SQL) {
  return sql`
    coalesce((
      select l.debit_minor - l.credit_minor
      from openerp.bank_active_matches m
      join openerp.journal_lines l on (l.book_id, l.voucher_id, l.id) = (m.book_id, m.voucher_id, m.line_id)
      where m.book_id = ${bookId} and m.voucher_id = ${voucher} and m.line_id = ${line}
    ), 0) + coalesce((
      select sum(a.amount_minor) from openerp.bank_active_allocation_legs a
      where a.book_id = ${bookId} and a.voucher_id = ${voucher} and a.line_id = ${line}
    ), 0)`;
}

export function readMappedAccountIds(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select account_id as id
      from openerp.bank_sources
      where book_id = ${bookId}
      order by account_id collate "C"
      limit 101
    `,
    "objects",
  );
}

export function lockSourceRevision(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly revision: string }>(
    sql`
      select revision::text as revision
      from openerp.bank_sources
      where book_id = ${bookId} and account_id = ${accountId}
      for update
    `,
    "objects",
  );
}

export function bumpSourceRevision(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly revision: string }>(
    sql`
      update openerp.bank_sources set revision = revision + 1
      where book_id = ${bookId} and account_id = ${accountId}
      returning revision::text as revision
    `,
    "objects",
  );
}

export function readCheckpoint(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{
    readonly sequence: string;
    readonly sourceRevision: string;
  }>(
    sql`
      select b.committed_sequence::text as sequence,
        coalesce((
          select revision::text from openerp.bank_sources
          where book_id = ${bookId} and account_id = ${accountId}
        ), '0') as "sourceRevision"
      from openerp.books b
      where b.id = ${bookId}
    `,
    "objects",
  );
}

export function readEvidence(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<EvidenceRow>(
    sql`
      select id, content, media_type as "mediaType", sha256
      from openerp.evidence
      where book_id = ${bookId} and id = ${evidenceId}
      for share
    `,
    "objects",
  );
}

export function readCommandReceipt(
  transaction: Transaction,
  bookId: string,
  key: string,
  operation: string,
  actorId: string,
) {
  return transaction.execute<{ readonly result: JsonObject }>(
    sql`
      select result
      from openerp.command_receipts
      where book_id = ${bookId} and key = ${key} and operation = ${operation} and actor_id = ${actorId}
    `,
    "objects",
  );
}

export function readCoverageDependencyDigest(
  transaction: Transaction,
  bookId: string,
  inventoryId: string,
) {
  return transaction.execute<DigestRow>(
    sql`
      with inventory as (
        select i.book_id, i.id, i.period_id, i.ordinal, i.body
        from openerp.closing_inventories i
        where i.book_id = ${bookId} and i.id = ${inventoryId}
      ), period as (
        select p.id, p.version, p.starts_on, p.ends_on, p.locked
        from openerp.periods p
        join inventory i on i.book_id = p.book_id and i.period_id = p.id
      ), account_ids as (
        select coalesce(array_agg(selected.account_id order by selected.account_id collate "C"), '{}'::text[])
            as ids
        from (
          select jsonb_array_elements_text(inventory.body->'bankAccountIds') as account_id from inventory
          union
          select s.account_id from openerp.bank_sources s where s.book_id = ${bookId} limit 101
        ) selected
      ), bounded as (
        select
          (select count(*) > 100 from account_ids) as too_many_accounts,
          exists (
            select 1 from unnest((select ids from account_ids)) wanted(account_id)
            where not exists (
              select 1 from openerp.accounts a
              where a.book_id = ${bookId} and a.id = wanted.account_id
            )
          ) as unknown_account,
          (select count(*) > 200 from (
            select 1 from openerp.bank_statements s, account_ids c
            where s.book_id = ${bookId} and s.account_id = any(c.ids)
              and s.starts_on <= (select ends_on from period)
              and s.ends_on >= (select starts_on from period)
            limit 201
          ) bounded_statements) as too_many_statements,
          coalesce((select sum(jsonb_array_length(s.source->'rows')) from openerp.bank_statements s, account_ids c
            where s.book_id = ${bookId} and s.account_id = any(c.ids)
              and s.starts_on <= (select ends_on from period)
              and s.ends_on >= (select starts_on from period)), 0) > 10000 as too_many_rows,
          (select count(*) > 10000 from (
            select 1 from openerp.bank_observations o
            join openerp.bank_statements s on (s.book_id, s.id) = (o.book_id, o.statement_id), account_ids c
            where s.book_id = ${bookId} and s.account_id = any(c.ids)
              and s.starts_on <= (select ends_on from period)
              and s.ends_on >= (select starts_on from period)
            limit 10001
          ) bounded_observations) as too_many_observations
      ), accounts as (
        select coalesce(jsonb_agg(jsonb_build_object(
            'accountId', a.id, 'code', a.code, 'name', a.name, 'active', a.active,
            'version', a.version::text, 'sourceBankAccountId', s.source_bank_account_id,
            'sourceRevision', s.revision::text) order by a.id collate "C"), '[]'::jsonb) as value
        from openerp.accounts a
        left join openerp.bank_sources s on (s.book_id, s.account_id) = (a.book_id, a.id)
        cross join account_ids c
        where a.book_id = ${bookId} and a.id = any(c.ids)
      ), statements as (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id, 'accountId', s.account_id, 'startsOn', s.starts_on::text,
            'endsOn', s.ends_on::text, 'evidenceId', s.evidence_id, 'evidenceSha256', e.sha256)
            order by s.id collate "C"), '[]'::jsonb) as value
        from openerp.bank_statements s
        join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
        cross join account_ids c
        where s.book_id = ${bookId} and s.account_id = any(c.ids)
          and s.starts_on <= (select ends_on from period)
          and s.ends_on >= (select starts_on from period)
      ), latest as (
        select i.body
        from openerp.closing_inventories i, inventory current_inventory
        where i.book_id = current_inventory.book_id and i.period_id = current_inventory.period_id
        order by i.ordinal desc
        limit 1
      )
      select case
        when not exists (select 1 from inventory)
          or not exists (select 1 from period)
          or (select too_many_accounts from bounded)
          or (select unknown_account from bounded)
          or (select too_many_statements from bounded)
          or (select too_many_rows from bounded)
          or (select too_many_observations from bounded)
          then null
        else openerp.digest(jsonb_build_object(
          'inventory', (select body from inventory),
          'latestInventory', (select body from latest),
          'period', (select jsonb_build_object('id', id, 'version', version::text,
            'startsOn', starts_on::text, 'endsOn', ends_on::text, 'locked', locked) from period),
          'book', (select jsonb_build_object('id', b.id, 'entityId', b.entity_id, 'profile', b.profile,
            'profileVersion', b.profile_version::text, 'writerEpoch', b.writer_epoch::text,
            'authority', b.authority, 'currency', b.currency, 'currencyScale', b.currency_scale,
            'committedSequence', b.committed_sequence::text) from openerp.books b where b.id = ${bookId}),
          'accounts', (select value from accounts),
          'statements', (select value from statements)))
      end as digest
    `,
    "objects",
  );
}

export function readVersions(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly versions: JsonObject }>(
    sql`
      select jsonb_build_object(
        'profileVersion', b.profile_version::text,
        'writerEpoch', b.writer_epoch::text,
        'accountVersion', a.version::text,
        'sourceRevision', coalesce(s.revision, 0)::text,
        'accountLedgerSequence', coalesce((
          select max(v.sequence) from openerp.journal_lines l
          join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
          where l.book_id = ${bookId} and l.account_id = ${accountId}
        ), 0)::text) as versions
      from openerp.books b
      join openerp.accounts a on a.book_id = b.id and a.id = ${accountId}
      left join openerp.bank_sources s on s.book_id = b.id and s.account_id = ${accountId}
      where b.id = ${bookId}
    `,
    "objects",
  );
}
