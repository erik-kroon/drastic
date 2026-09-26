import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./shared";

export type ReportRow = {
  readonly id: string;
  readonly accountId: string;
  readonly body: JsonObject;
};

function readReport(
  transaction: Transaction,
  table: "bank_reconciliations" | "bank_capacity_reconciliations",
  bookId: string,
  reconciliationId: string,
) {
  return transaction.execute<ReportRow>(
    sql`
      select id, account_id as "accountId", body
      from openerp.${sql.identifier(table)}
      where book_id = ${bookId} and id = ${reconciliationId}
    `,
    "objects",
  );
}

function insertReport(
  transaction: Transaction,
  table: "bank_reconciliations" | "bank_capacity_reconciliations",
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accountId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.${sql.identifier(table)} (book_id, id, account_id, body)
      values (${row.bookId}, ${row.id}, ${row.accountId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readReconciliation(
  transaction: Transaction,
  bookId: string,
  reconciliationId: string,
) {
  return readReport(transaction, "bank_reconciliations", bookId, reconciliationId);
}

export function insertReconciliation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accountId: string;
    readonly body: JsonObject;
  },
) {
  return insertReport(transaction, "bank_reconciliations", row);
}

export function readCapacityReconciliation(
  transaction: Transaction,
  bookId: string,
  reconciliationId: string,
) {
  return readReport(transaction, "bank_capacity_reconciliations", bookId, reconciliationId);
}

export function insertCapacityReconciliation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accountId: string;
    readonly body: JsonObject;
  },
) {
  return insertReport(transaction, "bank_capacity_reconciliations", row);
}
