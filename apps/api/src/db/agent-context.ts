import { sql } from "drizzle-orm";
import type { Transaction } from "./transaction";

// NEXT-50. The agent book context is a read of retained unresolved work. It
// owns no table: its reads reuse the workspace store (`change_sets`,
// `invoice_drafts`, `invoice_issues`, the review tables and their assignments),
// so access is the workspace table list. The only query owned here is the
// ledger boundary, because no other owner reads the latest voucher sequence as
// a context snapshot input.

export function readLedgerBoundary(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly boundary: string | null }>(
    sql`
      select max(sequence)::text as boundary
      from openerp.vouchers
      where book_id = ${bookId}
    `,
    "objects",
  );
}
