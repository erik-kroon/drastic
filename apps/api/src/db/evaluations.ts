import { and, eq } from "drizzle-orm";
import { evaluationContracts } from "./schema";
import type { Transaction } from "./transaction";

export function readContract(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select()
    .from(evaluationContracts)
    .where(and(eq(evaluationContracts.bookId, bookId), eq(evaluationContracts.id, id)));
}

export function readSuccessor(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({ id: evaluationContracts.id })
    .from(evaluationContracts)
    .where(and(eq(evaluationContracts.bookId, bookId), eq(evaluationContracts.predecessorId, id)));
}

export function insertContract(
  transaction: Transaction,
  row: typeof evaluationContracts.$inferInsert,
) {
  return transaction.insert(evaluationContracts).values(row);
}
