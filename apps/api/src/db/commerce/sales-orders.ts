import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const salesOrderTables = [
  "sales_documents",
  "sales_document_revisions",
  "sales_order_conversions",
] as const;

export type SalesDocumentRow = {
  readonly id: string;
  readonly kind: string;
  readonly currentRevision: bigint;
  readonly body: JsonObject;
};

export type SalesConversionRow = {
  readonly draftId: string;
  readonly orderRevision: string;
  readonly portions: JsonObject;
};

export function readSalesDocument(
  transaction: Transaction,
  bookId: string,
  id: string,
  lock: "share" | "update",
) {
  const lockClause = lock === "update" ? sql`for update` : sql`for share`;
  return transaction.execute<SalesDocumentRow>(
    sql`
      select d.id, d.kind, d.current_revision as "currentRevision", r.body
      from openerp.sales_documents d
      join openerp.sales_document_revisions r
        on r.book_id = d.book_id and r.document_id = d.id and r.revision = d.current_revision
      where d.book_id = ${bookId} and d.id = ${id}
      ${lockClause}
    `,
    "objects",
  );
}

export function readSalesDocumentList(transaction: Transaction, bookId: string) {
  return transaction.execute<SalesDocumentRow>(
    sql`
      select d.id, d.kind, d.current_revision as "currentRevision", r.body
      from openerp.sales_documents d
      join openerp.sales_document_revisions r
        on r.book_id = d.book_id and r.document_id = d.id and r.revision = d.current_revision
      where d.book_id = ${bookId}
      order by d.id
    `,
    "objects",
  );
}

export function readSalesConversions(transaction: Transaction, bookId: string, orderId: string) {
  return transaction.execute<SalesConversionRow>(
    sql`
      select c.draft_id as "draftId", c.order_revision::text as "orderRevision", c.portions
      from openerp.sales_order_conversions c
      where c.book_id = ${bookId} and c.order_id = ${orderId}
      order by c.draft_id
    `,
    "objects",
  );
}
