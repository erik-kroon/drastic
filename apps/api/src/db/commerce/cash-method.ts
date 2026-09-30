import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";

// Financial writes are deferred until the commerce owner has a native
// cash-method source and a retained final payment allocation. Previously
// recorded line prefixes remain readable without reopening that writer.
export const cashMethodTables = ["cash_method_lines", "cash_method_recognitions"] as const;

export type CashMethodLineRow = {
  readonly id: string;
  readonly invoiceId: string;
  readonly sourceLineId: string;
  readonly direction: string;
  readonly currency: string;
  readonly originalGrossMinor: string;
  readonly creditedGrossMinor: string;
  readonly paidGrossMinor: string;
  readonly recognizedGrossMinor: string;
  readonly profileWitness: string;
};

export function readLine(transaction: Transaction, bookId: string, lineId: string) {
  return transaction.execute<CashMethodLineRow>(
    sql`
      select id, invoice_id as "invoiceId", source_line_id as "sourceLineId", direction, currency,
        original_gross_minor as "originalGrossMinor", credited_gross_minor as "creditedGrossMinor",
        paid_gross_minor as "paidGrossMinor", recognized_gross_minor as "recognizedGrossMinor",
        profile_witness as "profileWitness"
      from openerp.cash_method_lines
      where book_id = ${bookId} and id = ${lineId}
    `,
    "objects",
  );
}

export function readYearEndForLine(transaction: Transaction, bookId: string, lineId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`select exists (
      select 1 from openerp.cash_method_recognitions
      where book_id = ${bookId} and line_id = ${lineId}
        and trigger_kind = 'year_end_unpaid'
    ) as present`,
    "objects",
  );
}
