import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export function readInvoiceForVoucher(tx: Transaction, bookId: string, voucherId: string) {
  return tx.execute<{ readonly invoiceId: string }>(
    sql`
    select i.id as "invoiceId" from openerp.commerce_invoices i
    where i.book_id=${bookId} and (i.recognition_voucher_id=${voucherId}
      or exists(select from openerp.invoice_recognition_replacements t
        where t.book_id=i.book_id and t.invoice_id=i.id and t.replacement_voucher_id=${voucherId}))
    order by i.id limit 2`,
    "objects",
  );
}

export function effectiveRecognition(invoice: SQL, asOf: string | null, sequence: string | null) {
  return sql`coalesce((select jsonb_build_object('voucherId',v.id,'lineId',t.replacement_line_id,
    'eventId',v.event_id,'postingDate',v.posting_date::text)
    from openerp.invoice_recognition_replacements t
    join openerp.vouchers v on(v.book_id,v.id)=(t.book_id,t.replacement_voucher_id)
    where t.book_id=${invoice}.book_id and t.invoice_id=${invoice}.id
      and (${asOf}::date is null or v.posting_date<=${asOf}::date)
      and (${sequence}::bigint is null or v.sequence<=${sequence}::bigint)
    order by v.sequence desc limit 1),${invoice}.body->'recognition')`;
}

export function recognitionHistory(invoice: SQL, asOf: string | null, sequence: string | null) {
  return sql`coalesce((select jsonb_agg(jsonb_build_object('bundleId',t.bundle_id,
    'predecessorVoucherId',t.predecessor_voucher_id,'reversalVoucherId',t.reversal_voucher_id,
    'replacementVoucherId',t.replacement_voucher_id,'postingDate',v.posting_date::text)
    order by v.sequence)
    from openerp.invoice_recognition_replacements t
    join openerp.vouchers v on(v.book_id,v.id)=(t.book_id,t.replacement_voucher_id)
    where t.book_id=${invoice}.book_id and t.invoice_id=${invoice}.id
      and (${asOf}::date is null or v.posting_date<=${asOf}::date)
      and (${sequence}::bigint is null or v.sequence<=${sequence}::bigint)), '[]'::jsonb)`;
}

export function ownedRecognition(
  invoice: SQL,
  voucher: SQL,
  asOf: string | null,
  sequence: string | null,
) {
  return sql`exists(select from openerp.vouchers current
    where current.book_id=${invoice}.book_id and current.id=${effectiveRecognition(invoice, asOf, sequence)}->>'voucherId'
      and current.corrects_voucher_id is null and current.posting_purpose<>'reversal'
      and not exists(select from openerp.vouchers r where r.book_id=current.book_id and r.corrects_voucher_id=current.id
        and (${asOf}::date is null or r.posting_date<=${asOf}::date)
        and (${sequence}::bigint is null or r.sequence<=${sequence}::bigint))
      and ${voucher}=${invoice}.recognition_voucher_id)`;
}

export function readOwner(tx: Transaction, bookId: string, bundleId: string) {
  return tx.execute<{
    readonly body: JsonObject;
    readonly reversalPlan: JsonObject;
    readonly replacementPlan: JsonObject;
  }>(
    sql`
    select o.body,c.body->'reversal' as "reversalPlan",c.body->'replacement' as "replacementPlan"
    from openerp.invoice_recognition_replacement_owners o
    join openerp.correction_bundles c on(c.book_id,c.id)=(o.book_id,o.bundle_id)
    where o.book_id=${bookId} and o.bundle_id=${bundleId}`,
    "objects",
  );
}

export function insertOwner(
  tx: Transaction,
  bookId: string,
  bundleId: string,
  invoiceId: string,
  predecessor: string,
  body: JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.invoice_recognition_replacement_owners(book_id,bundle_id,invoice_id,predecessor_voucher_id,body)
    values(${bookId},${bundleId},${invoiceId},${predecessor},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function insertTransition(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly bundleId: string;
    readonly invoiceId: string;
    readonly predecessor: string;
    readonly reversal: string;
    readonly replacement: string;
    readonly reversalLine: string;
    readonly replacementLine: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.invoice_recognition_replacements
    (book_id,bundle_id,invoice_id,predecessor_voucher_id,reversal_voucher_id,replacement_voucher_id,reversal_line_id,replacement_line_id)
    values(${row.bookId},${row.bundleId},${row.invoiceId},${row.predecessor},${row.reversal},${row.replacement},${row.reversalLine},${row.replacementLine})`,
    "objects",
  );
}

export function readAcceptedSource(
  tx: Transaction,
  bookId: string,
  invoiceId: string,
  reviewId: string,
) {
  return tx.execute<{ readonly present: boolean }>(
    sql`select exists(select from openerp.supplier_acceptances
    where book_id=${bookId} and register_invoice_id=${invoiceId} and review_id=${reviewId}) as present`,
    "objects",
  );
}
