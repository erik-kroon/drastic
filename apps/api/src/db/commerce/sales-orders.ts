import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";
import type * as Sales from "@open-erp/contracts/sales-orders";

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
  readonly portions: ReadonlyArray<typeof Sales.ConvertedPortion.Type>;
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

export function insertDocument(
  transaction: Transaction,
  bookId: string,
  document: typeof Sales.SalesDocument.Type,
) {
  return transaction.execute(
    sql`insert into openerp.sales_documents
    (book_id,id,kind,source_quote_id,source_quote_revision,current_revision)
    values(${bookId},${document.id},${document.kind},${document.sourceQuoteId},${document.sourceQuoteRevision}::bigint,1)`,
    "objects",
  );
}

export function updateRevision(
  transaction: Transaction,
  bookId: string,
  id: string,
  revision: string,
) {
  return transaction.execute(
    sql`update openerp.sales_documents set current_revision=${revision}::bigint
    where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function insertRevision(
  transaction: Transaction,
  bookId: string,
  document: typeof Sales.SalesDocument.Type,
) {
  return transaction.execute(
    sql`insert into openerp.sales_document_revisions(book_id,document_id,revision,body)
    values(${bookId},${document.id},${document.revision}::bigint,${JSON.stringify(document)}::jsonb)`,
    "objects",
  );
}

export function insertConversion(
  transaction: Transaction,
  bookId: string,
  conversion: typeof Sales.OrderConversion.Type,
) {
  return transaction.execute(
    sql`insert into openerp.sales_order_conversions(book_id,order_id,draft_id,order_revision,portions)
    values(${bookId},${conversion.orderId},${conversion.draft.id},${conversion.orderRevision}::bigint,${JSON.stringify(conversion.portions)}::jsonb)`,
    "objects",
  );
}
