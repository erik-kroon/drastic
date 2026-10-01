import { and, desc, eq, sql } from "drizzle-orm";
import { agentContextCaptures, agentContextProgress } from "./schema";
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

export function readCapture(tx: Transaction, bookId: string, actorId: string, id: string) {
  return tx
    .select()
    .from(agentContextCaptures)
    .where(
      and(
        eq(agentContextCaptures.bookId, bookId),
        eq(agentContextCaptures.actorId, actorId),
        eq(agentContextCaptures.id, id),
      ),
    );
}

export function insertCapture(tx: Transaction, input: typeof agentContextCaptures.$inferInsert) {
  return tx.insert(agentContextCaptures).values(input);
}

export function readProgress(tx: Transaction, bookId: string, actorId: string, captureId: string) {
  return tx
    .select()
    .from(agentContextProgress)
    .where(
      and(
        eq(agentContextProgress.bookId, bookId),
        eq(agentContextProgress.actorId, actorId),
        eq(agentContextProgress.captureId, captureId),
      ),
    )
    .orderBy(desc(agentContextProgress.revision))
    .limit(1);
}

export function insertProgress(tx: Transaction, input: typeof agentContextProgress.$inferInsert) {
  return tx.insert(agentContextProgress).values(input);
}
