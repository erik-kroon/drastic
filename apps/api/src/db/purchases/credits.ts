import { sql } from "drizzle-orm";
import type * as Credits from "@open-erp/contracts/supplier-credits";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type CreditReviewRow = {
  readonly id: string;
  readonly invoiceId: string;
  readonly body: JsonObject;
};

export type CreditApprovalRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export type CreditRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export function readCreditReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<CreditReviewRow>(
    sql`
      select id, invoice_id as "invoiceId", body
      from openerp.supplier_credit_reviews
      where book_id = ${bookId} and id = ${reviewId}
    `,
    "objects",
  );
}

export function readLatestCreditApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<CreditApprovalRow>(
    sql`
      select id, body
      from openerp.supplier_credit_approvals
      where book_id = ${bookId} and review_id = ${reviewId}
      order by expires_at desc, id collate "C" desc
      limit 1
    `,
    "objects",
  );
}

export function readCreditByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<CreditRow>(
    sql`
      select id, body
      from openerp.supplier_credits
      where book_id = ${bookId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export function readSupplierInvoiceExists(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.commerce_invoices
        where book_id = ${bookId} and id = ${invoiceId} and direction = 'supplier'
      ) as present
    `,
    "objects",
  );
}

export function listCredits(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<CreditRow>(
    sql`
      select id, body
      from openerp.supplier_credits
      where book_id = ${bookId} and invoice_id = ${invoiceId}
      order by credit_date, id collate "C"
    `,
    "objects",
  );
}

export function readAcceptance(tx: Transaction, book: string, invoice: string) {
  return tx.execute<{ readonly acceptance: JsonObject; readonly review: JsonObject }>(
    sql`
    select a.body as acceptance,r.body as review from openerp.supplier_acceptances a
    join openerp.supplier_acceptance_reviews r on r.book_id=a.book_id and r.id=a.review_id
    where a.book_id=${book} and a.register_invoice_id=${invoice}`,
    "objects",
  );
}

export function readPriorCreditLines(tx: Transaction, book: string, invoice: string) {
  return tx.execute<{ readonly snapshot: JsonObject }>(
    sql`select r.body->'snapshot' as snapshot
    from openerp.supplier_credits c join openerp.supplier_credit_reviews r on r.book_id=c.book_id and r.id=c.review_id
    where c.book_id=${book} and c.invoice_id=${invoice}`,
    "objects",
  );
}

export function readCreditConflicts(
  tx: Transaction,
  book: string,
  invoice: string,
  party: string,
  number: string,
  evidence: string,
) {
  return tx.execute<{
    readonly exported: boolean;
    readonly numberUsed: boolean;
    readonly evidencePosted: boolean;
  }>(
    sql`select
    exists(select from openerp.supplier_payment_batch_items where book_id=${book} and invoice_id=${invoice}) as exported,
    (exists(select from openerp.supplier_credits where book_id=${book} and counterparty_id=${party} and document_number=${number})
      or exists(select from openerp.commerce_invoices where book_id=${book} and counterparty_id=${party} and direction='supplier' and document_number=${number})) as "numberUsed",
    exists(select from openerp.vouchers v join openerp.events e on e.book_id=v.book_id and e.id=v.event_id where v.book_id=${book}
      and (e.evidence_id=${evidence} or exists(select from jsonb_array_elements(v.action->'evidenceRefs') r where r->>'evidenceId'=${evidence}))) as "evidencePosted"`,
    "objects",
  );
}

export function countReviews(tx: Transaction, book: string, invoice: string) {
  return tx.execute<{ readonly total: number }>(
    sql`select count(*)::int as total from openerp.supplier_credit_reviews where book_id=${book} and invoice_id=${invoice}`,
    "objects",
  );
}

export function readApprovals(tx: Transaction, book: string, review: string) {
  return tx.execute<CreditApprovalRow>(
    sql`select id,body from openerp.supplier_credit_approvals where book_id=${book} and review_id=${review} order by id limit 51`,
    "objects",
  );
}

export function insertReview(
  tx: Transaction,
  book: string,
  result: typeof Credits.SupplierCreditReview.Type,
  event: string,
) {
  return tx.execute(
    sql`insert into openerp.supplier_credit_reviews(book_id,id,invoice_id,change_set_id,event_id,evidence_id,body)
    values(${book},${result.id},${result.input.invoiceId},${result.postingPlan.id},${event},${result.input.creditEvidenceId},${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  result: typeof Credits.SupplierCreditApproval.Type,
) {
  return tx.execute(
    sql`insert into openerp.supplier_credit_approvals(book_id,id,review_id,actor_id,digest,expires_at,body)
    values(${book},${result.id},${result.reviewId},${result.actorId},${result.digest},${result.expiresAt}::timestamptz,${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}

export function insertCredit(
  tx: Transaction,
  book: string,
  result: typeof Credits.SupplierCreditReceipt.Type,
  party: string,
  line: string,
) {
  return tx.execute(
    sql`insert into openerp.supplier_credits(book_id,id,review_id,approval_id,invoice_id,counterparty_id,document_number,credit_date,amount_minor,voucher_id,control_line_id,evidence_id,body)
    values(${book},${result.id},${result.reviewId},${result.approvalId},${result.invoiceId},${party},${result.supplierCreditNumber},${result.creditDate}::date,${result.amountMinor}::numeric,
      ${result.postingReceipt.voucherId},${line},${result.creditEvidence.evidenceId},${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}
