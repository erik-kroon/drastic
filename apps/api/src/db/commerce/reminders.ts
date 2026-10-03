import { and, asc, eq, sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import {
  reminderMessages,
  reminderApprovals,
  reminderAttempts,
  reminderOutbox,
  reminderObservations,
} from "../schema";

export const reminderTables = [
  "reminder_messages",
  "reminder_approvals",
  "reminder_attempts",
  "reminder_outbox",
  "reminder_observations",
] as const;

export type OutboxState = typeof reminderOutbox.$inferSelect.state;

export type MessageRow = typeof reminderMessages.$inferSelect;

export type ApprovalRow = typeof reminderApprovals.$inferSelect;

export type AttemptRow = typeof reminderAttempts.$inferSelect;

export function readMessage(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(reminderMessages)
    .where(and(eq(reminderMessages.bookId, bookId), eq(reminderMessages.id, id)));
}

export function readPreparedCommand(tx: Transaction, bookId: string, key: string) {
  return tx
    .select()
    .from(reminderMessages)
    .where(and(eq(reminderMessages.bookId, bookId), eq(reminderMessages.prepareKey, key)));
}

export function readApproval(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(reminderApprovals)
    .where(and(eq(reminderApprovals.bookId, bookId), eq(reminderApprovals.messageId, id)));
}

export function readAttempt(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(reminderAttempts)
    .where(and(eq(reminderAttempts.bookId, bookId), eq(reminderAttempts.messageId, id)));
}

export function readOutbox(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(reminderOutbox)
    .where(and(eq(reminderOutbox.bookId, bookId), eq(reminderOutbox.messageId, id)));
}

export function readObservations(tx: Transaction, bookId: string, attemptId: string) {
  return tx
    .select({ body: reminderObservations.body })
    .from(reminderObservations)
    .where(
      and(eq(reminderObservations.bookId, bookId), eq(reminderObservations.attemptId, attemptId)),
    )
    .orderBy(asc(reminderObservations.recordedAt), asc(reminderObservations.observationId))
    .limit(1001);
}

export function insertMessage(tx: Transaction, row: typeof reminderMessages.$inferInsert) {
  return tx.insert(reminderMessages).values(row);
}

export function insertApproval(tx: Transaction, row: typeof reminderApprovals.$inferInsert) {
  return tx.insert(reminderApprovals).values(row);
}

export function insertAttempt(tx: Transaction, row: typeof reminderAttempts.$inferInsert) {
  return tx.insert(reminderAttempts).values(row);
}

export function insertOutbox(
  tx: Transaction,
  bookId: string,
  messageId: string,
  checkedAt: string,
) {
  return tx
    .insert(reminderOutbox)
    .values({ bookId, messageId, state: "approved", checkpoint: 0, cancelVersion: 0, checkedAt });
}

export function advanceOutbox(
  tx: Transaction,
  bookId: string,
  messageId: string,
  state: OutboxState,
  reason: string | null,
  checkedAt: string,
  checkpoint: number,
  cancelVersion: number,
) {
  return tx
    .update(reminderOutbox)
    .set({ state, reason, checkedAt, checkpoint, cancelVersion })
    .where(and(eq(reminderOutbox.bookId, bookId), eq(reminderOutbox.messageId, messageId)));
}

export function insertObservation(tx: Transaction, row: typeof reminderObservations.$inferInsert) {
  return tx.insert(reminderObservations).values(row).onConflictDoNothing();
}

export function readPending(tx: Transaction, actorId: string) {
  return tx.execute<{
    readonly entityId: string;
    readonly bookId: string;
    readonly messageId: string;
    readonly checkpoint: number;
  }>(
    sql`
    select b.entity_id as "entityId", o.book_id as "bookId", o.message_id as "messageId", o.checkpoint
    from openerp.reminder_outbox o join openerp.books b on b.id = o.book_id
    join openerp.memberships m on m.book_id = o.book_id and m.actor_id = ${actorId}
    where o.state in ('approved','admitted','reconciling')
    order by o.checked_at, o.book_id, o.message_id limit 20
  `,
    "objects",
  );
}
