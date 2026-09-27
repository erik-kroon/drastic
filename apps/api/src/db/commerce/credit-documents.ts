import { and, desc, eq, sql } from "drizzle-orm";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Tables from "../schema";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export function readSource(tx: Transaction, bookId: string, creditId: string) {
  return tx.execute<{
    readonly document: JsonObject;
    readonly outboxId: string;
    readonly payload: JsonObject;
  }>(
    sql`
    select d.body as document, o.id as "outboxId", o.payload
    from openerp.customer_credit_documents d
    join openerp.outbox o on o.book_id = d.book_id
      and o.kind = ${Credits.customerCreditRenderEvent}
      and o.payload->>'documentId' = d.id
    where d.book_id = ${bookId} and d.credit_id = ${creditId}
    limit 2
  `,
    "objects",
  );
}

export function readArtifactForDocument(tx: Transaction, bookId: string, documentId: string) {
  return tx
    .select({ descriptor: Tables.customerCreditArtifacts.descriptor })
    .from(Tables.customerCreditArtifacts)
    .where(
      and(
        eq(Tables.customerCreditArtifacts.bookId, bookId),
        eq(Tables.customerCreditArtifacts.documentId, documentId),
        eq(Tables.customerCreditArtifacts.rendererVersion, Credits.customerCreditRendererVersion),
      ),
    );
}

export function readArtifact(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(Tables.customerCreditArtifacts)
    .where(
      and(
        eq(Tables.customerCreditArtifacts.bookId, bookId),
        eq(Tables.customerCreditArtifacts.id, id),
      ),
    );
}

export function readLastFailure(tx: Transaction, bookId: string, documentId: string) {
  return tx
    .select({
      ordinal: Tables.customerCreditRenderFailures.ordinal,
      code: Tables.customerCreditRenderFailures.code,
      failedAt: Tables.customerCreditRenderFailures.failedAt,
    })
    .from(Tables.customerCreditRenderFailures)
    .where(
      and(
        eq(Tables.customerCreditRenderFailures.bookId, bookId),
        eq(Tables.customerCreditRenderFailures.documentId, documentId),
        eq(
          Tables.customerCreditRenderFailures.rendererVersion,
          Credits.customerCreditRendererVersion,
        ),
      ),
    )
    .orderBy(desc(Tables.customerCreditRenderFailures.ordinal))
    .limit(1);
}

export function insertArtifact(
  tx: Transaction,
  row: typeof Tables.customerCreditArtifacts.$inferInsert,
) {
  return tx.insert(Tables.customerCreditArtifacts).values(row);
}

export function insertFailure(
  tx: Transaction,
  row: typeof Tables.customerCreditRenderFailures.$inferInsert,
) {
  return tx.insert(Tables.customerCreditRenderFailures).values(row);
}

export function acknowledge(tx: Transaction, bookId: string, outboxId: string) {
  return tx.execute(sql`
    update openerp.outbox set delivered_at = coalesce(delivered_at, clock_timestamp())
    where book_id = ${bookId} and id = ${outboxId} and kind = ${Credits.customerCreditRenderEvent}
  `);
}

export function recordAttempt(tx: Transaction, bookId: string, outboxId: string) {
  return tx.execute(sql`
    update openerp.outbox set attempts = attempts + 1
    where book_id = ${bookId} and id = ${outboxId} and kind = ${Credits.customerCreditRenderEvent}
  `);
}

export function readPending(tx: Transaction, actorId: string) {
  return tx.execute<{
    readonly entityId: string;
    readonly bookId: string;
    readonly creditId: string;
    readonly outboxId: string;
    readonly documentDigest: string;
  }>(
    sql`
    select b.entity_id as "entityId", o.book_id as "bookId", d.credit_id as "creditId",
      o.id as "outboxId", d.digest as "documentDigest"
    from openerp.outbox o
    join openerp.books b on b.id = o.book_id
    join openerp.memberships m on m.book_id = o.book_id and m.actor_id = ${actorId}
    join openerp.customer_credit_documents d on d.book_id = o.book_id and d.id = o.payload->>'documentId'
    where o.kind = ${Credits.customerCreditRenderEvent} and o.delivered_at is null and o.attempts < 20
      and b.entity_id is not null
    order by o.created_at, o.book_id, o.id limit 50
  `,
    "objects",
  );
}
