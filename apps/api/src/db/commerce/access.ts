import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

export type JsonObject = Schema.JsonObject;

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
  readonly canUpdate: boolean;
};

export type InstantRow = { readonly instant: string };

export type EvidenceRow = {
  readonly id: string;
  readonly sha256: string;
};

export function readEvidence(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<EvidenceRow>(
    sql`
      select e.id, e.sha256 from openerp.evidence e
      where e.book_id = ${bookId} and e.id = ${evidenceId}
    `,
    "objects",
  );
}

export function readTableAccess(transaction: Transaction, tableNames: ReadonlyArray<string>) {
  return transaction.execute<TableAccess>(
    sql`
      select
        requested.table_name as "tableName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'update') end as "canUpdate"
      from unnest(array[${sql.join(
        tableNames.map((name) => sql`${name}`),
        sql`, `,
      )}]::text[]) as requested(table_name)
    `,
    "objects",
  );
}

export function readInstant(transaction: Transaction) {
  return transaction.execute<InstantRow>(
    sql`select to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as instant`,
    "objects",
  );
}

export function readApprovalExpiry(transaction: Transaction) {
  return transaction.execute<InstantRow>(
    sql`select to_char((statement_timestamp() + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as instant`,
    "objects",
  );
}
