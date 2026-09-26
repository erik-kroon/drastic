import { textArray } from "../sql-values";
import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";

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
  readonly authority: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly committedSequence: string;
};

export function readTableAccess(transaction: Transaction, names: ReadonlyArray<string>) {
  return transaction.execute<TableAccess>(
    sql`
      select
        access.table_name as "tableName",
        case when to_regclass('openerp.' || access.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || access.table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || access.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || access.table_name, 'insert') end as "canInsert"
      from unnest(${textArray(names)}) as access(table_name)
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
          select id, entity_id as "entityId", profile, authority, currency,
            currency_scale as "currencyScale", committed_sequence::text as "committedSequence"
          from openerp.books
          where id = ${bookId}
          for update
        `
      : sql`
          select id, entity_id as "entityId", profile, authority, currency,
            currency_scale as "currencyScale", committed_sequence::text as "committedSequence"
          from openerp.books
          where id = ${bookId}
          for share
        `,
    "objects",
  );
}

export function readEvidence(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<{ readonly id: string; readonly sha256: string }>(
    sql`
      select id, sha256
      from openerp.evidence
      where book_id = ${bookId} and id = ${evidenceId}
    `,
    "objects",
  );
}

export function readPostedEvidencePresence(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.vouchers v
        join openerp.events e on e.book_id = v.book_id and e.id = v.event_id
        where v.book_id = ${bookId} and (
          e.evidence_id = ${evidenceId}
          or exists (
            select 1 from jsonb_array_elements(coalesce(v.action->'evidenceRefs', '[]'::jsonb)) ref
            where ref->>'evidenceId' = ${evidenceId}
          )
        )
      ) as present
    `,
    "objects",
  );
}
