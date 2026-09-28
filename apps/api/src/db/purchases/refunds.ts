import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// Tx-passing reads and DML for supplier paid credits and cash refunds
// (NEXT-07). Paid credit reviews, approvals and credit rows reuse the
// existing supplier_credit_reviews, supplier_credit_approvals and
// supplier_credits tables so the legacy credited total keeps counting every
// credit; the payable/refund-receivable split lives in
// supplier_refund_principal_increases. Refund receipts own their tables.

export const refundTables = [
  "books",
  "accounts",
  "periods",
  "evidence",
  "events",
  "vouchers",
  "journal_lines",
  "change_sets",
  "execution_receipts",
  "command_receipts",
  "commerce_invoices",
  "commerce_invoice_revisions",
  "commerce_allocation_legs",
  "commerce_allocation_reversals",
  "owner_operation_receipts",
  "supplier_acceptances",
  "supplier_acceptance_reviews",
  "supplier_credit_reviews",
  "supplier_credit_approvals",
  "supplier_credits",
  "supplier_payment_batch_items",
  "supplier_refund_principal_increases",
  "supplier_refund_reviews",
  "supplier_refund_approvals",
  "supplier_refunds",
  "supplier_refund_allocations",
  "supplier_refund_source_usages",
  "purchase_recognitions",
  "purchase_tax_facts",
  "purchase_line_capacities",
  "bank_sources",
  "commerce_control_accounts",
  "owner_control_accounts",
  "vat_control_account_roles",
  "tax_account_sources",
] as const;

export const refundInserts = [
  "supplier_credit_reviews",
  "supplier_credit_approvals",
  "supplier_credits",
  "supplier_refund_principal_increases",
  "supplier_refund_reviews",
  "supplier_refund_approvals",
  "supplier_refunds",
  "supplier_refund_allocations",
  "supplier_refund_source_usages",
  "change_sets",
  "events",
  "command_receipts",
  "purchase_recognitions",
  "purchase_tax_facts",
] as const;

export type PositionRow = {
  readonly invoiceId: string;
  readonly grossMinor: string;
  readonly creditedMinor: string;
  readonly allocatedLegsMinor: string;
  readonly ownerDischargeMinor: string;
  readonly refundedMinor: string;
  readonly increaseCount: number;
  readonly refundAccountId: string | null;
  readonly accountCount: number;
};

export function readPaidPosition(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<PositionRow>(
    sql`
      select ${invoiceId} as "invoiceId",
        i.amount_minor::text as "grossMinor",
        (select coalesce(sum(c.amount_minor), 0)::text from openerp.supplier_credits c
          where c.book_id = ${bookId} and c.invoice_id = ${invoiceId}) as "creditedMinor",
        (select coalesce(sum(l.amount_minor), 0)::text from openerp.commerce_allocation_legs l
          where l.book_id = ${bookId} and l.invoice_id = ${invoiceId}
            and not exists (
              select 1 from openerp.commerce_allocation_reversals rev
              where rev.book_id = l.book_id and rev.receipt_id = l.receipt_id)) as "allocatedLegsMinor",
        (select coalesce(sum(r.amount_minor), 0)::text from openerp.owner_operation_receipts r
          where r.book_id = ${bookId} and r.invoice_id = ${invoiceId}) as "ownerDischargeMinor",
        (select coalesce(sum(f.amount_minor), 0)::text from openerp.supplier_refunds f
          where f.book_id = ${bookId} and f.invoice_id = ${invoiceId}) as "refundedMinor",
        (select count(*)::int from openerp.supplier_refund_principal_increases p
          where p.book_id = ${bookId} and p.invoice_id = ${invoiceId}) as "increaseCount",
        (select max(p.refund_receivable_account_id) from openerp.supplier_refund_principal_increases p
          where p.book_id = ${bookId} and p.invoice_id = ${invoiceId}) as "refundAccountId",
        (select count(distinct p.refund_receivable_account_id)::int
          from openerp.supplier_refund_principal_increases p
          where p.book_id = ${bookId} and p.invoice_id = ${invoiceId}) as "accountCount"
      from openerp.commerce_invoices i
      where i.book_id = ${bookId} and i.id = ${invoiceId} and i.direction = 'supplier'
    `,
    "objects",
  );
}

export type IncreaseRow = {
  readonly id: string;
  readonly creditId: string;
  readonly apReleaseMinor: string;
  readonly refundIncreaseMinor: string;
  readonly refundReceivableAccountId: string;
  readonly body: JsonObject;
};

export function readIncreases(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<IncreaseRow>(
    sql`
      select id, credit_id as "creditId", ap_release_minor::text as "apReleaseMinor",
        refund_increase_minor::text as "refundIncreaseMinor",
        refund_receivable_account_id as "refundReceivableAccountId", body
      from openerp.supplier_refund_principal_increases
      where book_id = ${bookId} and invoice_id = ${invoiceId}
      order by recorded_at, id collate "C"
    `,
    "objects",
  );
}

export type PaidReviewRow = {
  readonly id: string;
  readonly invoiceId: string;
  readonly body: JsonObject;
};

export function readPaidReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<PaidReviewRow>(
    sql`
      select id, invoice_id as "invoiceId", body
      from openerp.supplier_credit_reviews
      where book_id = ${bookId} and id = ${reviewId}
    `,
    "objects",
  );
}

export function readPaidReviewCount(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::int as total from openerp.supplier_credit_reviews
      where book_id = ${bookId} and invoice_id = ${invoiceId}
    `,
    "objects",
  );
}

export function insertPaidReview(
  transaction: Transaction,
  bookId: string,
  body: JsonObject,
  id: string,
  invoiceId: string,
  changeSetId: string,
  eventId: string,
  evidenceId: string,
) {
  return transaction.execute(
    sql`insert into openerp.supplier_credit_reviews(book_id,id,invoice_id,change_set_id,event_id,evidence_id,body)
    values(${bookId},${id},${invoiceId},${changeSetId},${eventId},${evidenceId},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export type PaidApprovalRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export function readPaidApprovals(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<PaidApprovalRow>(
    sql`select id,body from openerp.supplier_credit_approvals where book_id=${bookId} and review_id=${reviewId} order by id limit 51`,
    "objects",
  );
}

export function insertPaidApproval(
  transaction: Transaction,
  bookId: string,
  body: JsonObject,
  id: string,
  reviewId: string,
  actorId: string,
  digest: string,
  expiresAt: string,
) {
  return transaction.execute(
    sql`insert into openerp.supplier_credit_approvals(book_id,id,review_id,actor_id,digest,expires_at,body)
    values(${bookId},${id},${reviewId},${actorId},${digest},${expiresAt}::timestamptz,${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function insertPrincipalIncrease(
  transaction: Transaction,
  bookId: string,
  id: string,
  creditId: string,
  invoiceId: string,
  apReleaseMinor: string,
  refundIncreaseMinor: string,
  refundReceivableAccountId: string,
  body: JsonObject,
  digest: string,
  recordedAt: string,
) {
  return transaction.execute(
    sql`insert into openerp.supplier_refund_principal_increases(book_id,id,credit_id,invoice_id,ap_release_minor,refund_increase_minor,refund_receivable_account_id,body,digest,recorded_at)
    values(${bookId},${id},${creditId},${invoiceId},${apReleaseMinor}::numeric,${refundIncreaseMinor}::numeric,${refundReceivableAccountId},${JSON.stringify(body)}::jsonb,${digest},${recordedAt}::timestamptz)`,
    "objects",
  );
}

export type RefundReviewRow = {
  readonly id: string;
  readonly invoiceId: string;
  readonly body: JsonObject;
};

export function readRefundReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<RefundReviewRow>(
    sql`
      select id, invoice_id as "invoiceId", body
      from openerp.supplier_refund_reviews
      where book_id = ${bookId} and id = ${reviewId}
    `,
    "objects",
  );
}

export function readRefundReviewCount(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::int as total from openerp.supplier_refund_reviews
      where book_id = ${bookId} and invoice_id = ${invoiceId}
    `,
    "objects",
  );
}

export function insertRefundReview(
  transaction: Transaction,
  bookId: string,
  body: JsonObject,
  id: string,
  invoiceId: string,
  changeSetId: string | null,
  eventId: string | null,
  evidenceId: string,
) {
  return transaction.execute(
    sql`insert into openerp.supplier_refund_reviews(book_id,id,invoice_id,change_set_id,event_id,evidence_id,body)
    values(${bookId},${id},${invoiceId},${changeSetId},${eventId},${evidenceId},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function readRefundApprovals(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<PaidApprovalRow>(
    sql`select id,body from openerp.supplier_refund_approvals where book_id=${bookId} and review_id=${reviewId} order by id limit 51`,
    "objects",
  );
}

export function insertRefundApproval(
  transaction: Transaction,
  bookId: string,
  body: JsonObject,
  id: string,
  reviewId: string,
  actorId: string,
  digest: string,
  expiresAt: string,
) {
  return transaction.execute(
    sql`insert into openerp.supplier_refund_approvals(book_id,id,review_id,actor_id,digest,expires_at,body)
    values(${bookId},${id},${reviewId},${actorId},${digest},${expiresAt}::timestamptz,${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export type RefundRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export function readRefundByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<RefundRow>(
    sql`
      select id, body from openerp.supplier_refunds
      where book_id = ${bookId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export function listRefunds(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<RefundRow>(
    sql`
      select id, body from openerp.supplier_refunds
      where book_id = ${bookId} and invoice_id = ${invoiceId}
      order by refund_date, id collate "C"
    `,
    "objects",
  );
}

export function insertRefund(
  transaction: Transaction,
  bookId: string,
  body: JsonObject,
  id: string,
  reviewId: string,
  approvalId: string,
  invoiceId: string,
  amountMinor: string,
  refundDate: string,
  voucherId: string | null,
  adoptedRef: string | null,
  sourceKind: string,
  evidenceId: string,
  digest: string,
  recordedAt: string,
) {
  return transaction.execute(
    sql`insert into openerp.supplier_refunds(book_id,id,review_id,approval_id,invoice_id,amount_minor,refund_date,voucher_id,adopted_ref,source_kind,evidence_id,body,digest,recorded_at)
    values(${bookId},${id},${reviewId},${approvalId},${invoiceId},${amountMinor}::numeric,${refundDate}::date,${voucherId},${adoptedRef},${sourceKind},${evidenceId},${JSON.stringify(body)}::jsonb,${digest},${recordedAt}::timestamptz)`,
    "objects",
  );
}

export function insertRefundAllocation(
  transaction: Transaction,
  bookId: string,
  refundId: string,
  ordinal: number,
  allocationId: string,
  amountMinor: string,
) {
  return transaction.execute(
    sql`insert into openerp.supplier_refund_allocations(book_id,refund_id,ordinal,allocation_id,amount_minor)
    values(${bookId},${refundId},${ordinal},${allocationId},${amountMinor}::numeric)`,
    "objects",
  );
}

export function insertSourceUsage(
  transaction: Transaction,
  bookId: string,
  refundId: string,
  sourceKind: string,
  bankAccountId: string | null,
  evidenceId: string | null,
  adoptedRef: string | null,
  amountMinor: string,
) {
  return transaction.execute(
    sql`insert into openerp.supplier_refund_source_usages(book_id,refund_id,source_kind,bank_account_id,evidence_id,adopted_ref,amount_minor)
    values(${bookId},${refundId},${sourceKind},${bankAccountId},${evidenceId},${adoptedRef},${amountMinor}::numeric)`,
    "objects",
  );
}

export function readAdoptedSum(transaction: Transaction, bookId: string, adoptedRef: string) {
  return transaction.execute<{ readonly total: string }>(
    sql`
      select coalesce(sum(amount_minor), 0)::text as total
      from openerp.supplier_refund_source_usages
      where book_id = ${bookId} and adopted_ref = ${adoptedRef}
    `,
    "objects",
  );
}

export type PostedLineRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly current: boolean;
};

export function readPostedRefundLine(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<PostedLineRow>(
    sql`
      select v.id as "voucherId", l.id as "lineId", l.account_id as "accountId",
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        (v.corrects_voucher_id is null and v.posting_purpose <> 'reversal'
          and not exists (
            select 1 from openerp.vouchers r
            where r.book_id = v.book_id and r.corrects_voucher_id = v.id)) as current
      from openerp.vouchers v
      join openerp.journal_lines l on (l.book_id, l.voucher_id) = (v.book_id, v.id)
      where v.book_id = ${bookId} and v.id = ${voucherId} and l.id = ${lineId}
    `,
    "objects",
  );
}

export function readActiveAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly id: string; readonly active: boolean }>(
    sql`select id, active from openerp.accounts where book_id = ${bookId} and id = ${accountId}`,
    "objects",
  );
}

export function readReservedAccounts(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`select account_id as id from openerp.bank_sources where book_id=${bookId} union select account_id from openerp.commerce_control_accounts where book_id=${bookId} union select account_id from openerp.owner_control_accounts where book_id=${bookId} union select account_id from openerp.tax_account_sources where book_id=${bookId} union select account_id from openerp.vat_control_account_roles where book_id=${bookId}`,
    "objects",
  );
}

export type PaymentLegRow = {
  readonly receiptId: string;
  readonly ordinal: number;
  readonly amountMinor: string;
  readonly postingOn: string;
  readonly recordedAt: string;
};

export function listPaymentLegs(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<PaymentLegRow>(
    sql`
      select l.receipt_id as "receiptId", l.ordinal, l.amount_minor::text as "amountMinor",
        v.posting_date::text as "postingOn", r.body ->> 'createdAt' as "recordedAt"
      from openerp.commerce_allocation_legs l
      join openerp.commerce_allocation_receipts r
        on (r.book_id, r.id) = (l.book_id, l.receipt_id)
      join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.payment_voucher_id)
      where l.book_id = ${bookId} and l.invoice_id = ${invoiceId}
        and not exists (
          select 1 from openerp.commerce_allocation_reversals rev
          where rev.book_id = l.book_id and rev.receipt_id = l.receipt_id)
      order by v.posting_date, l.receipt_id collate "C", l.ordinal
    `,
    "objects",
  );
}

export type OwnerDischargeRow = {
  readonly id: string;
  readonly amountMinor: string;
  readonly postingOn: string;
  readonly recordedAt: string;
};

export function listOwnerDischarges(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<OwnerDischargeRow>(
    sql`
      select r.id, r.amount_minor::text as "amountMinor",
        v.posting_date::text as "postingOn", r.committed_at::text as "recordedAt"
      from openerp.owner_operation_receipts r
      join openerp.vouchers v on (v.book_id, v.id) = (r.book_id, r.voucher_id)
      where r.book_id = ${bookId} and r.invoice_id = ${invoiceId}
        and r.mode = 'owner_pays_payable'
      order by v.posting_date, r.id collate "C"
    `,
    "objects",
  );
}

// A payment allocation leg reversed after a refund receivable or cash refund
// consumed its payment must refuse: the reversal would orphan the posted
// refund. This is the execution-time fence the packet requires.
export function readRefundExposure(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<{
    readonly principalMinor: string;
    readonly refundedMinor: string;
  }>(
    sql`
      select
        (select coalesce(sum(p.refund_increase_minor), 0)::text
          from openerp.supplier_refund_principal_increases p
          where p.book_id = ${bookId} and p.invoice_id = ${invoiceId}) as "principalMinor",
        (select coalesce(sum(f.amount_minor), 0)::text
          from openerp.supplier_refunds f
          where f.book_id = ${bookId} and f.invoice_id = ${invoiceId}) as "refundedMinor"
    `,
    "objects",
  );
}
