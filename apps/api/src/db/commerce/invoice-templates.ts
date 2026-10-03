import { and, eq, sql } from "drizzle-orm";
import { invoiceTemplates, invoiceTemplateRevisions } from "../schema";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const templateTables = ["invoice_templates", "invoice_template_revisions"] as const;

export function readTemplate(
  transaction: Transaction,
  bookId: string,
  id: string,
  revision?: string,
) {
  return transaction.execute<{ readonly body: JsonObject; readonly currentRevision: string }>(
    sql`
    select r.body,t.current_revision::text as "currentRevision"
    from openerp.invoice_templates t join openerp.invoice_template_revisions r
      on r.book_id=t.book_id and r.template_id=t.id
      and r.revision=coalesce(${revision ?? null}::bigint,t.current_revision)
    where t.book_id=${bookId} and t.id=${id}
  `,
    "objects",
  );
}

export function readTemplates(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<{ readonly id: string; readonly body: JsonObject }>(
    sql`
    select t.id,r.body from openerp.invoice_templates t join openerp.invoice_template_revisions r
      on r.book_id=t.book_id and r.template_id=t.id and r.revision=t.current_revision
    where t.book_id=${bookId} and t.id collate "C">${after} collate "C" and r.body->>'status'='active'
    order by t.id collate "C" limit ${limit}
  `,
    "objects",
  );
}

export function countTemplates(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly count: number }>(
    sql`select count(*)::int as count from openerp.invoice_templates where book_id=${bookId}`,
    "objects",
  );
}

export function insertTemplate(transaction: Transaction, bookId: string, id: string) {
  return transaction.insert(invoiceTemplates).values({ bookId, id, currentRevision: 1n });
}

export function insertTemplateRevision(
  transaction: Transaction,
  row: { bookId: string; templateId: string; revision: bigint; body: JsonObject },
) {
  return transaction.insert(invoiceTemplateRevisions).values(row);
}

export function advanceTemplate(
  transaction: Transaction,
  bookId: string,
  id: string,
  revision: bigint,
) {
  return transaction
    .update(invoiceTemplates)
    .set({ currentRevision: revision })
    .where(and(eq(invoiceTemplates.bookId, bookId), eq(invoiceTemplates.id, id)));
}
