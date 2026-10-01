import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export function readCashInvoiceBasis(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
    select body->'cashMethod' as body from openerp.commerce_invoices
    where book_id=${bookId} and id=${invoiceId}
      and cash_method_source_draft_id is not null
      and recognition_voucher_id is null and recognition_line_id is null
  `,
    "objects",
  );
}

export function readDraftAdoption(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
    select id from openerp.commerce_invoices
    where book_id=${bookId} and cash_method_source_draft_id=${draftId}
  `,
    "objects",
  );
}

export function readSourceAdoption(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
    select id from openerp.commerce_invoices where book_id=${bookId} and evidence_id=${evidenceId}
    union all select id from openerp.cash_method_credits where book_id=${bookId} and evidence_id=${evidenceId}
  `,
    "objects",
  );
}

export function readCashOriginalAdoption(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
    select id from openerp.commerce_invoices where book_id=${bookId} and evidence_id=${evidenceId}
      and cash_method_source_draft_id is not null
    union all select id from openerp.cash_method_credits where book_id=${bookId} and evidence_id=${evidenceId}
  `,
    "objects",
  );
}

export function insertCashInvoice(
  transaction: Transaction,
  input: {
    readonly bookId: string;
    readonly id: string;
    readonly draftId: string;
    readonly counterpartyId: string;
    readonly counterpartyRevision: string;
    readonly documentNumber: string;
    readonly issuedOn: string;
    readonly amountMinor: string;
    readonly controlAccountId: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(sql`
    insert into openerp.commerce_invoices
      (book_id,id,direction,counterparty_id,counterparty_revision,document_number,issued_on,
       amount_minor,control_account_id,recognition_voucher_id,recognition_line_id,evidence_id,body,
       cash_method_source_draft_id,current_revision)
    values (${input.bookId},${input.id},'supplier',${input.counterpartyId},${input.counterpartyRevision}::bigint,
      ${input.documentNumber},${input.issuedOn}::date,${input.amountMinor}::numeric,
      ${input.controlAccountId},null,null,${input.evidenceId},${JSON.stringify(input.body)}::jsonb,${input.draftId},1)
  `);
}

export function readInvoiceIdentity(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
  documentNumber: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
    select id from openerp.commerce_invoices where book_id=${bookId}
      and direction='supplier' and counterparty_id=${counterpartyId} and document_number=${documentNumber}
  `,
    "objects",
  );
}
