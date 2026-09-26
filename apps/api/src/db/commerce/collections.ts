import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const collectionTables = [
  "collection_statements",
  "collection_statement_artifacts",
  "collection_disputes",
  "collection_events",
  "commerce_counterparties",
  "commerce_invoices",
  "memberships",
  "evidence",
] as const;

export const collectionWorklistTables = [
  ...collectionTables,
  "commerce_invoice_revisions",
  "commerce_allocation_legs",
  "commerce_allocation_receipts",
  "commerce_allocation_reversals",
  "invoice_cancellations",
  "vouchers",
  "execution_receipts",
] as const;

export type CustomerRow = { readonly counterpartyId: string };

export type CustomerInvoiceRow = {
  readonly id: string;
  readonly counterpartyId: string;
};

export type DisputeRow = {
  readonly id: string;
  readonly invoiceId: string;
  readonly body: JsonObject;
};

export type HistoryRecordRow = {
  readonly body: JsonObject;
  readonly recordId: string;
  readonly recordKind: string;
  readonly recordAt: string;
  readonly hasMore: boolean;
};

export type MembershipRow = { readonly present: boolean };

export type EvidenceRow = { readonly present: boolean };

export type ResolutionRow = { readonly present: boolean };

export type HoldRow = { readonly present: boolean };

export type StatementRow = {
  readonly customerId: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly byteLength: number;
  readonly sha256: string;
};

export type StatementIdRow = { readonly present: boolean };

export function readCustomer(transaction: Transaction, bookId: string, customerId: string) {
  return transaction.execute<CustomerRow>(
    sql`
      select c.id as "counterpartyId"
      from openerp.commerce_counterparties c
      where c.book_id = ${bookId} and c.id = ${customerId} and c.role in ('customer', 'both')
    `,
    "objects",
  );
}

export function readCustomerInvoice(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<CustomerInvoiceRow>(
    sql`
      select i.id, i.counterparty_id as "counterpartyId"
      from openerp.commerce_invoices i
      where i.book_id = ${bookId} and i.id = ${invoiceId} and i.direction = 'customer'
    `,
    "objects",
  );
}

export function readBookMembership(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<MembershipRow>(
    sql`
      select exists (
        select from openerp.memberships m where m.book_id = ${bookId} and m.actor_id = ${actorId}
      ) as present
    `,
    "objects",
  );
}

export function readEvidenceExists(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<EvidenceRow>(
    sql`
      select exists (
        select from openerp.evidence e where e.book_id = ${bookId} and e.id = ${evidenceId}
      ) as present
    `,
    "objects",
  );
}

export function readInvoiceDispute(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
  disputeId: string,
) {
  return transaction.execute<DisputeRow>(
    sql`
      select d.id, d.invoice_id as "invoiceId", d.body
      from openerp.collection_disputes d
      where d.book_id = ${bookId} and d.id = ${disputeId} and d.invoice_id = ${invoiceId}
    `,
    "objects",
  );
}

export function readDisputeResolutionExists(
  transaction: Transaction,
  bookId: string,
  disputeId: string,
) {
  return transaction.execute<ResolutionRow>(
    sql`
      select exists (
        select from openerp.collection_events e
        where e.book_id = ${bookId} and e.dispute_id = ${disputeId} and e.kind = 'dispute_resolved'
      ) as present
    `,
    "objects",
  );
}

export function readOpenReminderHold(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<HoldRow>(
    sql`
      select exists (
        select from openerp.collection_disputes d
        where d.book_id = ${bookId} and d.invoice_id = ${invoiceId}
          and d.body->'holdReminders' = 'true'::jsonb
          and not exists (
            select from openerp.collection_events e
            where e.book_id = d.book_id and e.dispute_id = d.id and e.kind = 'dispute_resolved'
          )
      ) as present
    `,
    "objects",
  );
}

export function insertDispute(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    invoiceId: string;
    customerId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.collection_disputes (book_id, id, invoice_id, customer_id, body)
      values (${row.bookId}, ${row.id}, ${row.invoiceId}, ${row.customerId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertEvent(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    customerId: string;
    invoiceId: string;
    disputeId: string | null;
    kind: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.collection_events
        (book_id, id, customer_id, invoice_id, dispute_id, kind, body)
      values (${row.bookId}, ${row.id}, ${row.customerId}, ${row.invoiceId}, ${row.disputeId}, ${row.kind},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

function historySource(bookId: string, customerId: string) {
  return sql`
    select body->>'createdAt' as "recordAt", id as "recordId", 'statement'::text as "recordKind", body
    from openerp.collection_statements
    where book_id = ${bookId} and customer_id = ${customerId}
    union all
    select body->>'createdAt', id, 'dispute'::text, body
    from openerp.collection_disputes
    where book_id = ${bookId} and customer_id = ${customerId}
    union all
    select body->>'createdAt', id, 'event'::text, body
    from openerp.collection_events
    where book_id = ${bookId} and customer_id = ${customerId}
  `;
}

export function readFullHistory(transaction: Transaction, bookId: string, customerId: string) {
  return transaction.execute<HistoryRecordRow>(
    sql`
      select history.body, history."recordId", history."recordKind", history."recordAt",
        false as "hasMore"
      from (${historySource(bookId, customerId)}) history
      order by history."recordAt" collate "C", history."recordId" collate "C"
    `,
    "objects",
  );
}

export function readHistoryPage(
  transaction: Transaction,
  bookId: string,
  customerId: string,
  afterAt: string,
  afterId: string,
  limit: number,
) {
  return transaction.execute<HistoryRecordRow>(
    sql`
      select page.body, page."recordId", page."recordKind", page."recordAt",
        page.total > ${limit} as "hasMore"
      from (
        select history.*, count(*) over () as total,
          row_number() over (
            order by history."recordAt" collate "C" desc, history."recordId" collate "C" desc
          ) as position
        from (${historySource(bookId, customerId)}) history
        where ${afterAt} = '' or (history."recordAt" collate "C", history."recordId" collate "C") <
          (${afterAt} collate "C", ${afterId} collate "C")
        order by history."recordAt" collate "C" desc, history."recordId" collate "C" desc
        limit ${limit + 1}
      ) page
      where page.position <= ${limit}
      order by page."recordAt" collate "C" desc, page."recordId" collate "C" desc
    `,
    "objects",
  );
}

export function readStatementExport(transaction: Transaction, bookId: string, statementId: string) {
  return transaction.execute<StatementRow>(
    sql`
      select s.customer_id as "customerId", s.body, a.content,
        octet_length(convert_to(a.content, 'UTF8')) as "byteLength",
        encode(sha256(convert_to(a.content, 'UTF8')), 'hex') as sha256
      from openerp.collection_statements s
      join openerp.collection_statement_artifacts a
        on a.book_id = s.book_id and a.statement_id = s.id
      where s.book_id = ${bookId} and s.id = ${statementId}
    `,
    "objects",
  );
}

export function readStatementById(transaction: Transaction, bookId: string, statementId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select s.body from openerp.collection_statements s
      where s.book_id = ${bookId} and s.id = ${statementId}
    `,
    "objects",
  );
}

export function insertStatement(
  transaction: Transaction,
  row: { bookId: string; id: string; customerId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.collection_statements (book_id, id, customer_id, body)
      values (${row.bookId}, ${row.id}, ${row.customerId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}
