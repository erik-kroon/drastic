import { sql } from "drizzle-orm";
import { textArray } from "../sql-values";
import type { Transaction } from "../transaction";
import { statementBodyColumns } from "./statements";
import type { JsonObject } from "./shared";

export type CoverageAccountRow = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  readonly version: string;
  readonly sourceBankAccountId: string | null;
  readonly sourceRevision: string | null;
};

export type CoverageStatementRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly body: JsonObject;
  readonly movementMinor: string;
  readonly observedRowCount: number;
  readonly declaredRowCount: number;
};

export type CoverageReportRow = {
  readonly id: string;
  readonly inventoryId: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export function readCoverageAccountScope(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
) {
  return transaction.execute<CoverageAccountRow>(
    sql`
      select a.id, a.code, a.name, a.active, a.version::text as version,
        s.source_bank_account_id as "sourceBankAccountId", s.revision::text as "sourceRevision"
      from openerp.accounts a
      left join openerp.bank_sources s on (s.book_id, s.account_id) = (a.book_id, a.id)
      where a.book_id = ${bookId} and a.id = any(${textArray(accountIds)})
      order by a.id collate "C"
    `,
    "objects",
  );
}

export function readCoverageStatements(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<CoverageStatementRow>(
    sql`
      select s.id, s.starts_on::text as "startsOn", s.ends_on::text as "endsOn",
        ${statementBodyColumns()} as body,
        coalesce((
          select sum(o.amount_minor)::text from openerp.bank_observations o
          where o.book_id = ${bookId} and o.statement_id = s.id
        ), '0') as "movementMinor",
        (select count(*) from openerp.bank_observations o
          where o.book_id = ${bookId} and o.statement_id = s.id)::integer as "observedRowCount",
        jsonb_array_length(s.source->'rows')::integer as "declaredRowCount"
      from openerp.bank_statements s
      join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
      where s.book_id = ${bookId} and s.account_id = ${accountId}
        and s.starts_on <= ${endsOn}::date and s.ends_on >= ${startsOn}::date
      order by s.starts_on, s.ends_on, s.id collate "C"
    `,
    "objects",
  );
}

export function insertCoverageReport(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly inventoryId: string;
    readonly body: JsonObject;
    readonly content: string;
    readonly sha256: string;
    readonly byteLength: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_source_coverage_reports
        (book_id, id, inventory_id, body, content, sha256, byte_length)
      values (${row.bookId}, ${row.id}, ${row.inventoryId}, ${JSON.stringify(row.body)}::jsonb,
        ${row.content}, ${row.sha256}, ${row.byteLength})
    `,
    "objects",
  );
}

export function readCoverageReport(transaction: Transaction, bookId: string, reportId: string) {
  return transaction.execute<CoverageReportRow>(
    sql`
      select id, inventory_id as "inventoryId", body, content, sha256,
        byte_length as "byteLength"
      from openerp.bank_source_coverage_reports
      where book_id = ${bookId} and id = ${reportId}
    `,
    "objects",
  );
}

export function listCoverageReports(transaction: Transaction, bookId: string) {
  return transaction.execute<{
    readonly id: string;
    readonly inventoryId: string;
    readonly body: JsonObject;
  }>(
    sql`
      select id, inventory_id as "inventoryId", body
      from openerp.bank_source_coverage_reports
      where book_id = ${bookId}
      order by body->>'createdAt' desc, id collate "C"
    `,
    "objects",
  );
}

export function readCoverageReportCount(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::integer as total
      from openerp.bank_source_coverage_reports
      where book_id = ${bookId}
    `,
    "objects",
  );
}
