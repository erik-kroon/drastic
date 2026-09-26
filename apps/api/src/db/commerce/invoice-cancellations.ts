import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const invoiceCancellationTables = [
  "invoice_cancellation_reviews",
  "invoice_cancellation_approvals",
  "invoice_cancellation_revocations",
  "invoice_cancellations",
  "invoice_issues",
  "invoice_issue_reviews",
  "commerce_invoices",
  "commerce_active_allocation_legs",
  "vouchers",
  "periods",
  "bank_sources",
  "subledger_bases",
] as const;

export type CancellationReviewRow = {
  readonly issueId: string;
  readonly body: JsonObject;
};

export type CancellationApprovalRow = {
  readonly actorId: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
  readonly revoked: boolean;
};

export type CancellationRevocationRow = {
  readonly body: JsonObject;
};

export type CancellationReceiptRow = { readonly body: JsonObject };

export type CancellationSummaryRow = {
  readonly id: string;
  readonly digest: string;
  readonly createdAt: string;
  readonly reason: string;
};

export type PresentRow = { readonly present: boolean };

export type BankSourceRow = { readonly present: boolean };

export function readInvoiceCancellationReview(
  transaction: Transaction,
  bookId: string,
  id: string,
) {
  return transaction.execute<CancellationReviewRow>(
    sql`
      select r.issue_id as "issueId", r.body
      from openerp.invoice_cancellation_reviews r
      where r.book_id = ${bookId} and r.id = ${id}
    `,
    "objects",
  );
}

export function readInvoiceCancellationReceiptForReview(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<CancellationReceiptRow>(
    sql`
      select c.body
      from openerp.invoice_cancellations c
      where c.book_id = ${bookId} and c.review_id = ${reviewId}
    `,
    "objects",
  );
}

export function readInvoiceCancellationReceiptForIssue(
  transaction: Transaction,
  bookId: string,
  issueId: string,
) {
  return transaction.execute<CancellationReceiptRow>(
    sql`
      select c.body
      from openerp.invoice_cancellations c
      where c.book_id = ${bookId} and c.issue_id = ${issueId}
    `,
    "objects",
  );
}

export function readInvoiceCancellationApprovals(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<{
    readonly actorId: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
    readonly revocation: JsonObject | null;
  }>(
    sql`
      select a.actor_id as "actorId",
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        a.body, v.body as revocation
      from openerp.invoice_cancellation_approvals a
      left join openerp.invoice_cancellation_revocations v
        on (v.book_id, v.approval_id) = (a.book_id, a.id)
      where a.book_id = ${bookId} and a.review_id = ${reviewId}
      order by a.ordinal
    `,
    "objects",
  );
}

export function readLatestInvoiceCancellationApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<CancellationApprovalRow>(
    sql`
      select a.actor_id as "actorId",
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        a.body, v.approval_id is not null as revoked
      from openerp.invoice_cancellation_approvals a
      left join openerp.invoice_cancellation_revocations v
        on (v.book_id, v.approval_id) = (a.book_id, a.id)
      where a.book_id = ${bookId} and a.review_id = ${reviewId}
      order by a.ordinal desc
      limit 1
    `,
    "objects",
  );
}

export function readInvoiceCancellationReviewSummaries(
  transaction: Transaction,
  bookId: string,
  issueId: string,
  bound: number,
) {
  return transaction.execute<CancellationSummaryRow>(
    sql`
      select r.id, r.body->>'digest' as digest, r.body->>'createdAt' as "createdAt",
        r.body->'input'->>'reason' as reason
      from openerp.invoice_cancellation_reviews r
      where r.book_id = ${bookId} and r.issue_id = ${issueId}
      order by r.ordinal desc
      limit ${bound}
    `,
    "objects",
  );
}

export function readActiveAllocationLegs(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.commerce_active_allocation_legs l
        where l.book_id = ${bookId} and l.invoice_id = ${invoiceId}
      ) as present
    `,
    "objects",
  );
}

export function readBankSourceAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<BankSourceRow>(
    sql`
      select exists (
        select from openerp.bank_sources s
        where s.book_id = ${bookId} and s.account_id = ${accountId}
      ) as present
    `,
    "objects",
  );
}

export function readSubledgerBasisForVoucher(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.subledger_bases b
        where b.book_id = ${bookId} and b.voucher_id = ${voucherId}
      ) as present
    `,
    "objects",
  );
}

export function readRecognitionSourcePeriod(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction.execute<{
    readonly id: string;
    readonly version: string;
    readonly locked: boolean;
  }>(
    sql`
      select p.id, p.version::text as version, p.locked
      from openerp.vouchers v
      join openerp.periods p on p.book_id = v.book_id and p.id = v.period_id
      where v.book_id = ${bookId} and v.id = ${voucherId}
    `,
    "objects",
  );
}

export function readApprovalForRevocation(tx: Transaction, book: string, id: string) {
  return tx.execute<{
    readonly body: JsonObject;
    readonly revoked: JsonObject | null;
    readonly used: boolean;
  }>(
    sql`
    select a.body,r.body as revoked,exists(select from openerp.invoice_cancellations c where c.book_id=a.book_id and c.approval_id=a.id) as used
    from openerp.invoice_cancellation_approvals a left join openerp.invoice_cancellation_revocations r on r.book_id=a.book_id and r.approval_id=a.id
    where a.book_id=${book} and a.id=${id}`,
    "objects",
  );
}

export function insertReview(
  tx: Transaction,
  book: string,
  review: typeof import("@open-erp/contracts/invoice-cancellations").InvoiceCancellationReview.Type,
  ordinal: number,
) {
  return tx.execute(
    sql`insert into openerp.invoice_cancellation_reviews(book_id,id,issue_id,ordinal,change_set_id,body)
    values(${book},${review.id},${review.input.issueId},${ordinal},${review.postingPlan.id},${JSON.stringify(review)}::jsonb)`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  approval: typeof import("@open-erp/contracts/invoice-cancellations").InvoiceCancellationApproval.Type,
  ordinal: number,
) {
  return tx.execute(
    sql`insert into openerp.invoice_cancellation_approvals(book_id,id,review_id,ordinal,actor_id,digest,expires_at,body)
    values(${book},${approval.id},${approval.reviewId},${ordinal},${approval.actorId},${approval.digest},${approval.expiresAt}::timestamptz,${JSON.stringify(approval)}::jsonb)`,
    "objects",
  );
}

export function insertRevocation(
  tx: Transaction,
  book: string,
  result: typeof import("@open-erp/contracts/invoice-cancellations").InvoiceCancellationRevocation.Type,
) {
  return tx.execute(
    sql`insert into openerp.invoice_cancellation_revocations(book_id,approval_id,body)values(${book},${result.approvalId},${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}

export function insertExecution(tx: Transaction, book: string, review: string, approval: string) {
  return tx.execute(
    sql`insert into openerp.invoice_cancellation_executions(book_id,review_id,approval_id)values(${book},${review},${approval})`,
    "objects",
  );
}

export function insertCancellation(
  tx: Transaction,
  book: string,
  result: typeof import("@open-erp/contracts/invoice-cancellations").InvoiceCancellationReceipt.Type,
) {
  return tx.execute(
    sql`insert into openerp.invoice_cancellations(book_id,id,review_id,approval_id,issue_id,register_invoice_id,original_voucher_id,reversal_voucher_id,posting_receipt_id,posting_date,body)
    values(${book},${result.id},${result.reviewId},${result.approvalId},${result.issueId},${result.registerInvoiceId},${result.originalVoucherId},${result.reversalVoucherId},${result.postingReceipt.id},${result.postingDate}::date,${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}
