import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type * as Schema from "effect/Schema";
import type { JsonObject } from "./access";

type Json = Schema.Json;

export const allocationTables = [
  "commerce_allocation_plans",
  "commerce_allocation_approvals",
  "commerce_allocation_receipts",
  "commerce_allocation_legs",
  "commerce_allocation_reversal_plans",
  "commerce_allocation_reversal_approvals",
  "commerce_allocation_reversal_revocations",
  "commerce_allocation_reversals",
  "commerce_control_accounts",
  "commerce_invoices",
  "journal_lines",
  "vouchers",
  "periods",
  "accounts",
  "books",
  "memberships",
] as const;

export type BookAuthorityRow = {
  readonly entityId: string;
  readonly authority: string;
  readonly profile: string;
  readonly profileVersion: string;
  readonly writerEpoch: string;
  readonly currency: string;
  readonly currencyScale: number;
};

export type AllocationReceiptRow = {
  readonly id: string;
  readonly planId: string;
  readonly approvalId: string;
  readonly body: JsonObject;
  readonly plan: JsonObject;
};

export type AllocationApprovalRow = {
  readonly id: string;
  readonly planId: string;
  readonly digest: string;
  readonly actorId: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export type AllocationLegRow = {
  readonly ordinal: number;
  readonly invoiceId: string;
  readonly paymentVoucherId: string;
  readonly paymentLineId: string;
  readonly amountMinor: string;
};

export type PaymentRow = {
  readonly lineId: string;
  readonly voucherId: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly postingDate: string;
  readonly direction: string | null;
  readonly current: boolean;
  readonly recognition: boolean;
  readonly reserved: boolean;
  readonly allocatedMinor: string;
  readonly capacityVersion: string;
};

export type PaymentVoucherRow = {
  readonly eventId: string;
  readonly periodId: string;
  readonly periodVersion: string;
  readonly periodLocked: boolean;
};

export type PeriodRow = {
  readonly id: string;
  readonly version: string;
  readonly locked: boolean;
};

export type AccountRow = {
  readonly id: string;
  readonly version: string;
  readonly active: boolean;
};

export type ReversalPlanRow = {
  readonly id: string;
  readonly receiptId: string;
  readonly body: JsonObject;
};

export type ReversalApprovalRow = {
  readonly id: string;
  readonly planId: string;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
  readonly operator: boolean;
  readonly revoked: boolean;
};

export type ReversalExecutionRow = {
  readonly id: string;
  readonly planId: string;
  readonly approvalId: string;
  readonly body: JsonObject;
};

export type CountRow = { readonly count: number };

export type PresentRow = { readonly present: boolean };

export type ReversalPageRow = {
  readonly id: string;
  readonly receiptId: string;
  readonly body: JsonObject;
  readonly execution: JsonObject | null;
};

export function readBookAuthority(transaction: Transaction, bookId: string) {
  return transaction.execute<BookAuthorityRow>(
    sql`
      select b.entity_id as "entityId", b.authority, b.profile, b.profile_version as "profileVersion",
        b.writer_epoch as "writerEpoch", b.currency, b.currency_scale as "currencyScale"
      from openerp.books b
      where b.id = ${bookId}
    `,
    "objects",
  );
}

export function readAllocationReceipt(transaction: Transaction, bookId: string, receiptId: string) {
  return transaction.execute<AllocationReceiptRow>(
    sql`
      select r.id, r.plan_id as "planId", r.approval_id as "approvalId", r.body, p.body as plan
      from openerp.commerce_allocation_receipts r
      join openerp.commerce_allocation_plans p on p.book_id = r.book_id and p.id = r.plan_id
      where r.book_id = ${bookId} and r.id = ${receiptId}
    `,
    "objects",
  );
}

export function readAllocationApproval(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
) {
  return transaction.execute<AllocationApprovalRow>(
    sql`
      select a.id, a.plan_id as "planId", a.digest, a.actor_id as "actorId", a.body,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"
      from openerp.commerce_allocation_approvals a
      where a.book_id = ${bookId} and a.id = ${approvalId}
    `,
    "objects",
  );
}

export function readAllocationLegs(transaction: Transaction, bookId: string, receiptId: string) {
  return transaction.execute<AllocationLegRow>(
    sql`
      select l.ordinal, l.invoice_id as "invoiceId", l.payment_voucher_id as "paymentVoucherId",
        l.payment_line_id as "paymentLineId", l.amount_minor::text as "amountMinor"
      from openerp.commerce_allocation_legs l
      where l.book_id = ${bookId} and l.receipt_id = ${receiptId}
      order by l.ordinal
    `,
    "objects",
  );
}

export function readPaymentCapacity(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<PaymentRow>(
    sql`
      select l.id as "lineId", v.id as "voucherId", l.account_id as "accountId",
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        v.posting_date::text as "postingDate", c.direction,
        exists (
          select from openerp.vouchers x
          where x.book_id = v.book_id and x.id = v.id
            and x.corrects_voucher_id is null and x.posting_purpose <> 'reversal'
            and not exists (
              select from openerp.vouchers r where r.book_id = x.book_id and r.corrects_voucher_id = x.id
            )
        ) as current,
        exists (
          select from openerp.commerce_invoices i
          where i.book_id = l.book_id and i.recognition_voucher_id = v.id and i.recognition_line_id = l.id
        ) as recognition,
        exists (
          select from openerp.tax_account_match_capacity c
          where c.book_id = l.book_id and c.voucher_id = v.id and c.line_id = l.id
        ) as reserved,
        coalesce((
          select sum(legs.amount_minor) from openerp.commerce_allocation_legs legs
          where legs.book_id = l.book_id and legs.payment_voucher_id = v.id and legs.payment_line_id = l.id
        ), 0)::text as "allocatedMinor",
        (
          select count(*) from openerp.commerce_allocation_legs legs
          where legs.book_id = l.book_id and legs.payment_voucher_id = v.id and legs.payment_line_id = l.id
        )::text as "capacityVersion"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      left join openerp.commerce_control_accounts c
        on c.book_id = l.book_id and c.account_id = l.account_id
      where l.book_id = ${bookId} and v.id = ${voucherId} and l.id = ${lineId}
    `,
    "objects",
  );
}

export function readAffectedPeriods(
  transaction: Transaction,
  bookId: string,
  receiptId: string,
  paymentVoucherId: string,
) {
  return transaction.execute<PeriodRow>(
    sql`
      select p.id, p.version::text, p.locked
      from openerp.periods p
      where p.book_id = ${bookId} and p.id in (
        select v.period_id from openerp.vouchers v
        where v.book_id = ${bookId} and (
          v.id = ${paymentVoucherId}
          or v.id in (
            select i.recognition_voucher_id
            from openerp.commerce_invoices i
            join openerp.commerce_allocation_legs l
              on l.book_id = i.book_id and l.invoice_id = i.id
            where l.book_id = ${bookId} and l.receipt_id = ${receiptId}
          )
        )
      )
      order by p.id collate "C"
    `,
    "objects",
  );
}

export function readAccountAuthority(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<AccountRow>(
    sql`
      select a.id, a.version::text, a.active
      from openerp.accounts a
      where a.book_id = ${bookId} and a.id = ${accountId}
    `,
    "objects",
  );
}

export function readOverAllocatedInvoice(
  transaction: Transaction,
  bookId: string,
  invoiceIds: string[],
) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.commerce_invoices i
        where i.book_id = ${bookId} and i.id in (${sql.join(
          invoiceIds.map((id) => sql`${id}`),
          sql`, `,
        )})
          and (
            select coalesce(sum(l.amount_minor), 0) from openerp.commerce_allocation_legs l
            where l.book_id = i.book_id and l.invoice_id = i.id
          ) > i.amount_minor
      ) as present
    `,
    "objects",
  );
}

export function readReversedReceipt(transaction: Transaction, bookId: string, receiptId: string) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.commerce_allocation_reversals r
        where r.book_id = ${bookId} and r.receipt_id = ${receiptId}
      ) as present
    `,
    "objects",
  );
}

export function readReversalPlanCount(transaction: Transaction, bookId: string, receiptId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as count from openerp.commerce_allocation_reversal_plans
      where book_id = ${bookId} and receipt_id = ${receiptId}
    `,
    "objects",
  );
}

export function insertReversalPlan(
  transaction: Transaction,
  row: { bookId: string; id: string; receiptId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_allocation_reversal_plans (book_id, id, receipt_id, body)
      values (${row.bookId}, ${row.id}, ${row.receiptId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readReversalPlan(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<ReversalPlanRow>(
    sql`
      select p.id, p.receipt_id as "receiptId", p.body
      from openerp.commerce_allocation_reversal_plans p
      where p.book_id = ${bookId} and p.id = ${id}
    `,
    "objects",
  );
}

export function readReversalApprovalCount(
  transaction: Transaction,
  bookId: string,
  planId: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as count from openerp.commerce_allocation_reversal_approvals
      where book_id = ${bookId} and plan_id = ${planId}
    `,
    "objects",
  );
}

export function insertReversalApproval(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    planId: string;
    actorId: string;
    expiresAt: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_allocation_reversal_approvals
        (book_id, id, plan_id, actor_id, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.planId}, ${row.actorId}, ${row.expiresAt}::timestamptz,
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readReversalApprovals(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<ReversalApprovalRow>(
    sql`
      select a.id, a.plan_id as "planId", a.actor_id as "actorId", a.digest, a.body,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        exists (
          select from openerp.memberships m
          where m.book_id = a.book_id and m.actor_id = a.actor_id and m.role = 'operator'
        ) as operator,
        exists (
          select from openerp.commerce_allocation_reversal_revocations r
          where r.book_id = a.book_id and r.approval_id = a.id
        ) as revoked
      from openerp.commerce_allocation_reversal_approvals a
      where a.book_id = ${bookId} and a.plan_id = ${planId}
      order by a.id collate "C"
    `,
    "objects",
  );
}

export function readUsableReversalApproval(
  transaction: Transaction,
  bookId: string,
  planId: string,
  approvalId: string,
) {
  return transaction.execute<ReversalApprovalRow>(
    sql`
      select a.id, a.plan_id as "planId", a.actor_id as "actorId", a.digest, a.body,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        exists (
          select from openerp.memberships m
          where m.book_id = a.book_id and m.actor_id = a.actor_id and m.role = 'operator'
        ) as operator,
        exists (
          select from openerp.commerce_allocation_reversal_revocations r
          where r.book_id = a.book_id and r.approval_id = a.id
        ) as revoked
      from openerp.commerce_allocation_reversal_approvals a
      where a.book_id = ${bookId} and a.plan_id = ${planId} and a.id = ${approvalId}
      for update of a
    `,
    "objects",
  );
}

export function readRevocation(transaction: Transaction, bookId: string, approvalId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select r.body from openerp.commerce_allocation_reversal_revocations r
      where r.book_id = ${bookId} and r.approval_id = ${approvalId}
    `,
    "objects",
  );
}

export function insertRevocation(
  transaction: Transaction,
  row: { bookId: string; approvalId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_allocation_reversal_revocations (book_id, approval_id, body)
      values (${row.bookId}, ${row.approvalId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readExecutionForPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<ReversalExecutionRow>(
    sql`
      select r.id, r.plan_id as "planId", r.approval_id as "approvalId", r.body
      from openerp.commerce_allocation_reversals r
      where r.book_id = ${bookId} and r.plan_id = ${planId}
    `,
    "objects",
  );
}

export function readExecutionForReceipt(
  transaction: Transaction,
  bookId: string,
  receiptId: string,
) {
  return transaction.execute<ReversalExecutionRow>(
    sql`
      select r.id, r.plan_id as "planId", r.approval_id as "approvalId", r.body
      from openerp.commerce_allocation_reversals r
      where r.book_id = ${bookId} and r.receipt_id = ${receiptId}
    `,
    "objects",
  );
}

export function insertExecution(
  transaction: Transaction,
  row: {
    bookId: string;
    planId: string;
    approvalId: string;
    receiptId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_allocation_reversals
        (book_id, plan_id, approval_id, receipt_id, body)
      values (${row.bookId}, ${row.planId}, ${row.approvalId}, ${row.receiptId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readReversalPage(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<ReversalPageRow>(
    sql`
      select page.id, page."receiptId", page.body, executed.body as execution
      from (
        select p.id, p.receipt_id as "receiptId", p.body
        from openerp.commerce_allocation_reversal_plans p
        where p.book_id = ${bookId} and p.id collate "C" > ${after} collate "C"
        order by p.id collate "C"
        limit ${limit}
      ) page
      left join openerp.commerce_allocation_reversals executed
        on executed.book_id = ${bookId} and executed.plan_id = page.id
      order by page.id collate "C"
    `,
    "objects",
  );
}

export function readReversalPlanSummaries(
  transaction: Transaction,
  bookId: string,
  receiptId: string,
) {
  return transaction.execute<{ readonly id: string; readonly body: JsonObject }>(
    sql`
      select p.id, p.body
      from openerp.commerce_allocation_reversal_plans p
      where p.book_id = ${bookId} and p.receipt_id = ${receiptId}
      order by p.id collate "C"
    `,
    "objects",
  );
}

export function readReversalApprovalById(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
) {
  return transaction.execute<ReversalApprovalRow>(
    sql`
      select a.id, a.plan_id as "planId", a.actor_id as "actorId", a.digest, a.body,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        exists (
          select from openerp.memberships m
          where m.book_id = a.book_id and m.actor_id = a.actor_id and m.role = 'operator'
        ) as operator,
        exists (
          select from openerp.commerce_allocation_reversal_revocations r
          where r.book_id = a.book_id and r.approval_id = a.id
        ) as revoked
      from openerp.commerce_allocation_reversal_approvals a
      where a.book_id = ${bookId} and a.id = ${approvalId}
    `,
    "objects",
  );
}

export function readExecutionForApproval(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.commerce_allocation_reversals r
        where r.book_id = ${bookId} and r.approval_id = ${approvalId}
      ) as present
    `,
    "objects",
  );
}

export type RegisterRow = {
  readonly body: JsonObject;
  readonly historyVersion: string | null;
};

export type RegisterAgreementRow = { readonly current: boolean };

export function readRegisterSnapshot(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<RegisterRow>(
    sql`
      select r.body, d.history_version::text as "historyVersion"
      from openerp.commerce_register_snapshots r
      left join openerp.commerce_register_allocation_dependencies d
        on d.book_id = r.book_id and d.report_id = r.id
      where r.book_id = ${bookId} and r.id = ${id}
    `,
    "objects",
  );
}

export function readAllocationHistoryVersion(
  transaction: Transaction,
  bookId: string,
  asOf: string,
) {
  return transaction.execute<{ readonly version: string }>(
    sql`
      select (count(*)::numeric + count(r.plan_id)::numeric)::text as version
      from openerp.commerce_allocation_legs l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.payment_voucher_id
      left join openerp.commerce_allocation_reversals r
        on r.book_id = l.book_id and r.receipt_id = l.receipt_id
      where l.book_id = ${bookId} and v.posting_date <= ${asOf}::date
    `,
    "objects",
  );
}

export function readRegisterAllocationAgreement(
  transaction: Transaction,
  bookId: string,
  asOf: string,
  captured: ReadonlyArray<Json>,
) {
  return transaction.execute<RegisterAgreementRow>(
    sql`
      select not exists (
        select from (
          (
            select l.receipt_id, l.ordinal, l.amount_minor
            from openerp.commerce_allocation_legs l
            join openerp.vouchers v on v.book_id = l.book_id and v.id = l.payment_voucher_id
            where l.book_id = ${bookId} and v.posting_date <= ${asOf}::date
              and not exists (
                select from openerp.commerce_allocation_reversals r
                where r.book_id = l.book_id and r.receipt_id = l.receipt_id
              )
            except
            select a->>'receiptId', (a->>'ordinal')::integer, (a->>'amountMinor')::numeric
            from jsonb_array_elements(${JSON.stringify(captured)}::jsonb) a
          )
          union all
          (
            select a->>'receiptId', (a->>'ordinal')::integer, (a->>'amountMinor')::numeric
            from jsonb_array_elements(${JSON.stringify(captured)}::jsonb) a
            except
            select l.receipt_id, l.ordinal, l.amount_minor
            from openerp.commerce_allocation_legs l
            join openerp.vouchers v on v.book_id = l.book_id and v.id = l.payment_voucher_id
            where l.book_id = ${bookId} and v.posting_date <= ${asOf}::date
              and not exists (
                select from openerp.commerce_allocation_reversals r
                where r.book_id = l.book_id and r.receipt_id = l.receipt_id
              )
          )
        ) changed
      ) as current
    `,
    "objects",
  );
}

export function readPreCaptureReversalAgreement(
  transaction: Transaction,
  bookId: string,
  asOf: string,
) {
  return transaction.execute<{ readonly untouched: boolean }>(
    sql`
      select not exists (
        select from openerp.commerce_allocation_reversals r
        join openerp.commerce_allocation_legs l on l.book_id = r.book_id and l.receipt_id = r.receipt_id
        join openerp.vouchers v on v.book_id = l.book_id and v.id = l.payment_voucher_id
        where r.book_id = ${bookId} and v.posting_date <= ${asOf}::date
      ) as untouched
    `,
    "objects",
  );
}

export function readPlanForReceipt(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select p.body from openerp.commerce_allocation_plans p
      where p.book_id = ${bookId} and p.id = ${planId}
    `,
    "objects",
  );
}

export function insertAllocationApproval(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    planId: string;
    actorId: string;
    digest: string;
    expiresAt: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_allocation_approvals
        (book_id, id, plan_id, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.planId}, ${row.actorId}, ${row.digest},
        ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readAllocationApplication(
  transaction: Transaction,
  bookId: string,
  planId: string,
) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.commerce_allocation_receipts r
        where r.book_id = ${bookId} and r.plan_id = ${planId}
      ) as present
    `,
    "objects",
  );
}

export function readLatestAllocationApproval(
  transaction: Transaction,
  bookId: string,
  planId: string,
) {
  return transaction.execute<AllocationApprovalRow>(
    sql`
      select a.id, a.plan_id as "planId", a.digest, a.actor_id as "actorId", a.body,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt"
      from openerp.commerce_allocation_approvals a
      where a.book_id = ${bookId} and a.plan_id = ${planId}
      order by a.expires_at desc, a.id collate "C" desc
      limit 1
    `,
    "objects",
  );
}

export function readPaymentVoucher(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<PaymentVoucherRow>(
    sql`
      select v.event_id as "eventId", v.period_id as "periodId",
        p.version::text as "periodVersion", coalesce(p.locked, true) as "periodLocked"
      from openerp.vouchers v
      left join openerp.periods p on p.book_id = v.book_id and p.id = v.period_id
      where v.book_id = ${bookId} and v.id = ${voucherId}
    `,
    "objects",
  );
}

export function insertAllocationPlan(transaction: Transaction, row: { bookId: string; id: string; body: JsonObject }) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_allocation_plans (book_id, id, body)
      values (${row.bookId}, ${row.id}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readAllocationReceiptForPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select r.body from openerp.commerce_allocation_receipts r
      where r.book_id = ${bookId} and r.plan_id = ${planId}
    `,
    "objects",
  );
}

export function readAllocationReceiptForApproval(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.commerce_allocation_receipts r
        where r.book_id = ${bookId} and r.approval_id = ${approvalId}
      ) as present
    `,
    "objects",
  );
}

export function readOperatorMembership(
  transaction: Transaction,
  bookId: string,
  actorId: string,
) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.memberships m
        where m.book_id = ${bookId} and m.actor_id = ${actorId} and m.role = 'operator'
      ) as present
    `,
    "objects",
  );
}

export function insertAllocationReceipt(
  transaction: Transaction,
  row: { bookId: string; id: string; planId: string; approvalId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_allocation_receipts (book_id, id, plan_id, approval_id, body)
      values (${row.bookId}, ${row.id}, ${row.planId}, ${row.approvalId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertAllocationLeg(
  transaction: Transaction,
  row: {
    bookId: string;
    receiptId: string;
    ordinal: number;
    invoiceId: string;
    paymentVoucherId: string;
    paymentLineId: string;
    amountMinor: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_allocation_legs
        (book_id, receipt_id, ordinal, invoice_id, payment_voucher_id, payment_line_id, amount_minor)
      values (${row.bookId}, ${row.receiptId}, ${row.ordinal}, ${row.invoiceId},
        ${row.paymentVoucherId}, ${row.paymentLineId}, ${row.amountMinor}::openerp.minor_units)
    `,
    "objects",
  );
}

export type PagedRow<Row> = Row & { readonly total: number };

export type PaymentCandidateRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly postingDate: string;
  readonly direction: string;
  readonly allocatedMinor: string;
  readonly capacityVersion: string;
  readonly voucherLabel: string;
  readonly description: string;
  readonly evidenceId: string;
  readonly sourceTitle: string;
};

function eligiblePaymentCandidate(
  bookId: string,
  accountId: string,
  direction: string,
  recognitionEventId: string,
  recognitionPostingDate: string,
) {
  return sql`
    select v.id as "voucherId", l.id as "lineId", l.account_id as "accountId",
      l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
      v.posting_date::text as "postingDate", c.direction,
      coalesce((
        select sum(legs.amount_minor) from openerp.commerce_active_allocation_legs legs
        where legs.book_id = l.book_id and legs.payment_voucher_id = v.id
          and legs.payment_line_id = l.id
      ), 0)::text as "allocatedMinor",
      (
        select count(*) from openerp.commerce_allocation_legs legs
        where legs.book_id = l.book_id and legs.payment_voucher_id = v.id
          and legs.payment_line_id = l.id
      )::text as "capacityVersion",
      v.series || ' ' || v.number::text as "voucherLabel", l.description,
      e.evidence_id as "evidenceId", e.title as "sourceTitle",
      (l.debit_minor + l.credit_minor) - coalesce((
        select sum(legs.amount_minor) from openerp.commerce_active_allocation_legs legs
        where legs.book_id = l.book_id and legs.payment_voucher_id = v.id
          and legs.payment_line_id = l.id
      ), 0) as remaining
    from openerp.journal_lines l
    join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
    join openerp.events e on e.book_id = v.book_id and e.id = v.event_id
    join openerp.periods p on p.book_id = v.book_id and p.id = v.period_id
    join openerp.accounts a on a.book_id = l.book_id and a.id = l.account_id
    join openerp.commerce_control_accounts c
      on c.book_id = l.book_id and c.account_id = l.account_id and c.direction = ${direction}
    where l.book_id = ${bookId} and l.account_id = ${accountId}
      and a.active and not p.locked
      and ((${direction} = 'customer' and l.credit_minor > 0)
        or (${direction} = 'supplier' and l.debit_minor > 0))
      and v.event_id <> ${recognitionEventId}
      and v.posting_date >= ${recognitionPostingDate}::date
      and exists (
        select from openerp.vouchers x
        where x.book_id = v.book_id and x.id = v.id
          and x.corrects_voucher_id is null and x.posting_purpose <> 'reversal'
          and not exists (
            select from openerp.vouchers r where r.book_id = x.book_id
              and r.corrects_voucher_id = x.id
          )
      )
      and not exists (
        select from openerp.commerce_invoices i where i.book_id = l.book_id
          and i.recognition_voucher_id = v.id and i.recognition_line_id = l.id
      )
      and not exists (
        select from openerp.tax_account_match_capacity t
        where t.book_id = l.book_id and t.voucher_id = v.id and t.line_id = l.id
      )
  `;
}

export function readPaymentCandidatePage(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  direction: string,
  recognitionEventId: string,
  recognitionPostingDate: string,
  offset: number,
  limit: number,
) {
  const eligible = eligiblePaymentCandidate(
    bookId,
    accountId,
    direction,
    recognitionEventId,
    recognitionPostingDate,
  );
  return transaction.execute<PagedRow<PaymentCandidateRow>>(
    sql`
      select paged.* from (
        select ranked.*, count(*) over () as total from (
          select eligible.*, row_number() over (order by eligible."postingDate" desc,
            eligible."voucherId" collate "C", eligible."lineId" collate "C") as ordinal
          from (${eligible}) eligible
          where eligible.remaining > 0
        ) ranked
      ) paged
      where paged.ordinal > ${offset} and paged.ordinal <= ${offset + limit}
      order by paged.ordinal
    `,
    "objects",
  );
}

export function countPaymentCandidates(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  direction: string,
  recognitionEventId: string,
  recognitionPostingDate: string,
) {
  const eligible = eligiblePaymentCandidate(
    bookId,
    accountId,
    direction,
    recognitionEventId,
    recognitionPostingDate,
  );
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as count from (
        select eligible."voucherId" from (${eligible}) eligible where eligible.remaining > 0
      ) remaining
    `,
    "objects",
  );
}

export type AllocationHistoryRow = {
  readonly planId: string;
  readonly createdAt: string | null;
  readonly postingDate: string | null;
  readonly voucherLabel: string;
  readonly amountMinor: string | null;
  readonly status: string;
  readonly receiptId: string | null;
};

function invoiceAllocationHistoryEntry(bookId: string, invoiceId: string) {
  return sql`
    select p.id as "planId", p.body->>'createdAt' as "createdAt",
      p.body->'payment'->>'postingDate' as "postingDate",
      v.series || ' ' || v.number::text as "voucherLabel",
      leg.value->>'amountMinor' as "amountMinor",
      case when reversed.plan_id is not null then 'released'
        when applied.id is not null then 'matched' else 'review' end as status,
      applied.id as "receiptId",
      row_number() over (order by p.body->>'createdAt' desc, p.id collate "C") as ordinal
    from openerp.commerce_allocation_plans p
    cross join lateral jsonb_array_elements(p.body->'legs') leg(value)
    join openerp.vouchers v on v.book_id = p.book_id and v.id = p.body->'payment'->>'voucherId'
    left join openerp.commerce_allocation_receipts applied
      on applied.book_id = p.book_id and applied.plan_id = p.id
    left join openerp.commerce_allocation_reversals reversed
      on reversed.book_id = applied.book_id and reversed.receipt_id = applied.id
    where p.book_id = ${bookId} and leg.value->>'invoiceId' = ${invoiceId}
  `;
}

export function readInvoiceAllocationHistory(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
  offset: number,
  limit: number,
) {
  const history = invoiceAllocationHistoryEntry(bookId, invoiceId);
  return transaction.execute<PagedRow<AllocationHistoryRow>>(
    sql`
      select paged.* from (
        select ranked.*, count(*) over () as total from (${history}) ranked
      ) paged
      where paged.ordinal > ${offset} and paged.ordinal <= ${offset + limit}
      order by paged.ordinal
    `,
    "objects",
  );
}

export function countInvoiceAllocationHistory(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
) {
  const history = invoiceAllocationHistoryEntry(bookId, invoiceId);
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as count from (${history}) counted`,
    "objects",
  );
}
