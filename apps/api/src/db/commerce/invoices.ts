import { inArray, sql, type SQL } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const commerceInvoiceTables = [
  "commerce_invoices",
  "commerce_invoice_revisions",
  "commerce_allocation_legs",
  "commerce_allocation_receipts",
  "commerce_allocation_reversals",
  "owner_operation_receipts",
  "invoice_cancellations",
  "vouchers",
  "execution_receipts",
  "collection_disputes",
  "collection_events",
] as const;

export type LiveInvoiceRow = {
  readonly id: string;
  readonly body: JsonObject;
  readonly status: string;
  readonly outstandingMinor: string | null;
  readonly allocatedMinor: string;
  readonly effectiveAmountMinor: string;
};

export type OutstandingRow = {
  readonly status: string;
  readonly outstandingMinor: string | null;
  readonly blocked: boolean;
};

export type PresentRow = { readonly present: boolean };

export type StatementItemRow = { readonly body: JsonObject };

export type WorklistRow = {
  readonly body: JsonObject;
  readonly total: number;
  readonly ordinal: number;
};

function voucherCurrent(voucher: SQL) {
  return sql`exists (
    select from openerp.vouchers v
    where v.book_id = i.book_id and v.id = ${voucher}
      and v.corrects_voucher_id is null and v.posting_purpose <> 'reversal'
      and not exists (
        select from openerp.vouchers r where r.book_id = v.book_id and r.corrects_voucher_id = v.id
      )
  )`;
}

function recognitionAccounted(voucher: SQL) {
  return sql`(${voucherCurrent(voucher)} or exists (
    select from openerp.invoice_cancellations c
      join openerp.vouchers v on v.book_id = c.book_id and v.id = c.reversal_voucher_id
      join openerp.execution_receipts e on e.book_id = c.book_id and e.id = c.posting_receipt_id
    where c.book_id = i.book_id and c.original_voucher_id = ${voucher}
      and v.corrects_voucher_id = ${voucher} and v.posting_purpose = 'reversal'
      and e.voucher_id = v.id
  ))`;
}

function activeLegs() {
  return sql`
    openerp.commerce_allocation_legs l
    where l.book_id = i.book_id and l.invoice_id = i.id
      and not exists (
        select from openerp.commerce_allocation_reversals rev
        where rev.book_id = l.book_id and rev.receipt_id = l.receipt_id
      )
  `;
}

function activeLegTotal() {
  return sql`(select coalesce(sum(l.amount_minor), 0) from ${activeLegs()})`;
}

// Both the live register and fixed-cutoff reports use this receipt authority.
// The surrounding query supplies invoice alias i; invalid postings block rather
// than silently releasing capacity after an unsupported correction.
export function ownerDischargeSummary(asOf: string | null, sequence: string | null) {
  return sql`
    select coalesce(sum(r.amount_minor), 0) as total, count(*) as total_count,
      coalesce(bool_or(i.direction <> 'supplier' or r.mode <> 'owner_pays_payable'
        or not (${voucherCurrent(sql`r.voucher_id`)})
        or payable.line_count <> 1 or payable.debit_minor <> r.amount_minor
        or payable.credit_minor <> 0), false) as invalid
    from openerp.owner_operation_receipts r
    join openerp.vouchers discharge on discharge.book_id = r.book_id and discharge.id = r.voucher_id
    cross join lateral (
      select count(*) as line_count, coalesce(sum(l.debit_minor), 0) as debit_minor,
        coalesce(sum(l.credit_minor), 0) as credit_minor
      from openerp.journal_lines l
      where l.book_id = r.book_id and l.voucher_id = r.voucher_id
        and l.account_id = i.control_account_id
    ) payable
    where r.book_id = i.book_id and r.invoice_id = i.id
      and (${asOf}::date is null or discharge.posting_date <= ${asOf}::date)
      and (${sequence}::bigint is null or discharge.sequence <= ${sequence}::bigint)
  `;
}

function cancellationBody() {
  return sql`(select c.body from openerp.invoice_cancellations c
    where c.book_id = i.book_id and c.register_invoice_id = i.id)`;
}

function openDispute() {
  return sql`exists (
    select from openerp.collection_disputes d
    where d.book_id = i.book_id and d.invoice_id = i.id
      and not exists (
        select from openerp.collection_events e
        where e.book_id = d.book_id and e.dispute_id = d.id and e.kind = 'dispute_resolved'
      )
  )`;
}

function openReminderHold() {
  return sql`exists (
    select from openerp.collection_disputes d
    where d.book_id = i.book_id and d.invoice_id = i.id
      and d.body->'holdReminders' = 'true'::jsonb
      and not exists (
        select from openerp.collection_events e
        where e.book_id = d.book_id and e.dispute_id = d.id and e.kind = 'dispute_resolved'
      )
  )`;
}

/**
 * The application-owned live invoice projection: immutable register facts plus the
 * current revision, active allocation, cancellation and blocker state. An absent
 * identity predicate projects every invoice selected by the surrounding query.
 */
function liveInvoice(bookId: string, identity: SQL | undefined) {
  return sql`
    select live.body->>'id' as "id", live.body, live.body->>'status' as "status",
      live.body->>'outstandingMinor' as "outstandingMinor",
      live.body->>'recordedAllocatedMinor' as "allocatedMinor",
      live.body->>'effectiveAmountMinor' as "effectiveAmountMinor"
    from (
      select base.body || jsonb_build_object(
          'currentRevision', base.revision,
          'allocationVersion', (base.allocation_count + base.credit_count)::text,
          'creditedMinor', base.credited::text, 'creditCount', base.credit_count::text,
          'cancelledMinor', base.cancelled::text,
          'effectiveAmountMinor', base.effective::text,
          'cancellation', case when base.cancellation is null then null else jsonb_build_object(
            'id', base.cancellation->>'id',
            'reviewId', base.cancellation->>'reviewId',
            'issueId', base.cancellation->>'issueId',
            'originalVoucherId', base.cancellation->>'originalVoucherId',
            'reversalVoucherId', base.cancellation->>'reversalVoucherId',
            'postingDate', base.cancellation->>'postingDate',
            'committedAt', base.cancellation->>'committedAt'
          ) end,
          'recordedAllocatedMinor', base.allocated::text,
          'outstandingMinor', case when base.blockers = '[]'::jsonb
            then to_jsonb(greatest(base.effective - base.allocated, 0)::text) else 'null'::jsonb end,
          'status', case
            when base.blockers <> '[]'::jsonb then 'blocked'
            when base.cancellation is not null then 'cancelled'
            when base.credited > 0 and base.allocated = base.effective then 'credited'
            when base.credited > 0 then 'partially_credited'
            when base.allocated = 0 then 'open'
            when base.allocated = base.effective then 'allocated'
            else 'partially_allocated' end,
          'blockers', base.blockers
        ) as body
      from (
        select i.body, i.amount_minor, i.recognition_voucher_id,
          (select r.body from openerp.commerce_invoice_revisions r
            where r.book_id = i.book_id and r.invoice_id = i.id and r.revision = i.current_revision
          ) as revision,
           ${activeLegTotal()} + owner_discharges.total as allocated,
          (select count(*) from openerp.commerce_allocation_legs l
            where l.book_id = i.book_id and l.invoice_id = i.id
          ) + (select count(*) from openerp.commerce_allocation_legs l
            join openerp.commerce_allocation_reversals rev
              on rev.book_id = l.book_id and rev.receipt_id = l.receipt_id
            where l.book_id = i.book_id and l.invoice_id = i.id
           ) + owner_discharges.total_count
             + case when ${cancellationBody()} is null then 0 else 1 end as allocation_count,
          ${cancellationBody()} as cancellation,
          case when ${cancellationBody()} is null then 0 else i.amount_minor end as cancelled,
          (case when ${cancellationBody()} is null then i.amount_minor else 0 end
            - credits.total - customer_credits.total) as effective,
          credits.total + customer_credits.total as credited,
          credits.total_count + customer_credits.total_count as credit_count,
          coalesce((
            select jsonb_agg(remaining.value order by remaining.ordinal)
            from unnest(array_remove(array[
              case when not (${recognitionAccounted(sql`i.recognition_voucher_id`)})
                then 'The retained recognition voucher was corrected.'::text end,
              case when exists (
                select from ${activeLegs()}
                and not (${voucherCurrent(sql`l.payment_voucher_id`)})
              ) then 'A retained allocation payment voucher was corrected.'::text end,
              case when credits.invalid then 'A supplier credit posting or payable line is invalid.'::text end,
               case when customer_credits.invalid then 'A customer credit posting or receivable line is invalid.'::text end,
              case when owner_discharges.invalid then 'An owner-paid supplier discharge posting or payable line is invalid.'::text end,
              case when credits.total + customer_credits.total + ${activeLegTotal()} + owner_discharges.total > case when ${cancellationBody()} is null
                then i.amount_minor else 0 end
                and not refundcover.has_paid
                then 'Recorded allocations exceed the invoice amount.'::text end
            ], null)) with ordinality as remaining(value, ordinal)
          ), '[]'::jsonb) as blockers
        from openerp.commerce_invoices i
        cross join lateral (
          select coalesce(sum(c.amount_minor),0) as total, count(*) as total_count,
            coalesce(bool_or(not (${voucherCurrent(sql`c.voucher_id`)})
              or case when p.credit_id is null
                then (l.account_id<>i.control_account_id
                  or l.debit_minor<>c.amount_minor or l.credit_minor<>0)
                else ((p.ap_release_minor > 0
                  and (l.account_id<>i.control_account_id
                    or l.debit_minor<>p.ap_release_minor or l.credit_minor<>0))
                or (p.ap_release_minor = 0
                  and (l.account_id<>p.refund_receivable_account_id
                    or l.debit_minor<>p.refund_increase_minor or l.credit_minor<>0))
                or (p.refund_increase_minor > 0 and not exists (
                  select 1 from openerp.journal_lines r
                  where (r.book_id, r.voucher_id) = (c.book_id, c.voucher_id)
                    and r.account_id = p.refund_receivable_account_id
                    and r.debit_minor = p.refund_increase_minor and r.credit_minor = 0)))
              end),false) as invalid
          from openerp.supplier_credits c join openerp.journal_lines l
            on (l.book_id,l.voucher_id,l.id)=(c.book_id,c.voucher_id,c.control_line_id)
          left join openerp.supplier_refund_principal_increases p
            on (p.book_id, p.credit_id) = (c.book_id, c.id)
          where c.book_id=i.book_id and c.invoice_id=i.id
        ) credits
        -- An issued legal customer credit reduces the same receivable control, so the
        -- live outstanding amount, ageing, statement and collection reads all see it.
        cross join lateral (
          select coalesce(sum(c.gross_minor),0) as total, count(*) as total_count,
            coalesce(bool_or(not (${voucherCurrent(sql`c.voucher_id`)}) or l.account_id<>i.control_account_id
              or l.credit_minor<>c.gross_minor or l.debit_minor<>0),false) as invalid
          from openerp.customer_credit_notes c join openerp.journal_lines l
            on (l.book_id,l.voucher_id,l.id)=(c.book_id,c.voucher_id,c.control_line_id)
          where c.book_id=i.book_id and c.register_invoice_id=i.id
         ) customer_credits
          -- A paid supplier credit converts the over-allocated excess into an
          -- explicit refund receivable (NEXT-07): with a sealed principal
          -- increase on the invoice the excess is refund principal, not an
          -- inconsistency, so the legacy over-allocation blocker stays silent
          -- and the unpaid residual clamps at zero instead of going negative.
          cross join lateral (
            select exists (
              select 1 from openerp.supplier_refund_principal_increases p
              where p.book_id = i.book_id and p.invoice_id = i.id
            ) as has_paid
          ) refundcover
          cross join lateral (${ownerDischargeSummary(null, null)}) owner_discharges
        where i.book_id = ${bookId} and ${identity === undefined ? sql`true` : identity}
      ) base
    ) live
  `;
}

export function readLiveInvoice(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<LiveInvoiceRow>(
    liveInvoice(bookId, sql`i.id = ${invoiceId}`),
    "objects",
  );
}

export function readLiveInvoicePage(
  transaction: Transaction,
  bookId: string,
  invoiceIds: ReadonlyArray<string>,
) {
  return transaction.execute<LiveInvoiceRow>(
    liveInvoice(bookId, inArray(sql`i.id`, [...invoiceIds])),
    "objects",
  );
}

export type SalesInvoiceRow = {
  readonly id: string;
  readonly body: JsonObject;
  readonly draftId: string | null;
  readonly reviewId: string | null;
};

export function readSalesInvoiceRows(transaction: Transaction, bookId: string) {
  return transaction.execute<SalesInvoiceRow>(
    sql`
      select i.id, live.body, issued.draft_id as "draftId", issued.review_id as "reviewId"
      from openerp.commerce_invoices i
      join lateral (${liveInvoice(bookId, sql`i.direction = 'customer'`)}) live on live.id = i.id
      left join openerp.invoice_issues issued
        on issued.book_id = i.book_id and issued.register_invoice_id = i.id
      where i.book_id = ${bookId} and i.direction = 'customer'
    `,
    "objects",
  );
}

export function readInvoiceIdentityPage(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select page.id from (
        select i.id from openerp.commerce_invoices i
        where i.book_id = ${bookId} and i.id collate "C" > ${after} collate "C"
        order by i.id collate "C"
        limit ${limit}
      ) page
      order by page.id collate "C"
    `,
    "objects",
  );
}

export function readInvoiceOutstanding(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
) {
  return transaction.execute<OutstandingRow>(
    sql`
      select live."status", live."outstandingMinor", live."status" = 'blocked' as blocked
      from (${liveInvoice(bookId, sql`i.id = ${invoiceId}`)}) live
    `,
    "objects",
  );
}

export function readBlockedCustomerInvoices(
  transaction: Transaction,
  bookId: string,
  customerId: string,
  asOf: string,
) {
  return transaction.execute<PresentRow>(
    sql`
      select exists (
        select from openerp.commerce_invoices i
        join lateral (${liveInvoice(bookId, undefined)}) live on live.id = i.id
        where i.book_id = ${bookId} and i.counterparty_id = ${customerId} and i.direction = 'customer'
          and i.issued_on <= ${asOf}::date
          and live."status" = 'blocked'
      ) as present
    `,
    "objects",
  );
}

export function readCustomerWorklistPage(
  transaction: Transaction,
  bookId: string,
  asOf: string,
  page: number,
  pageSize: number,
) {
  return transaction.execute<WorklistRow>(
    sql`
      select entry.row as body, entry.total, entry.ordinal
      from (
        select ordered.row, ordered.total, ordered.ordinal
        from (
          select live.body || jsonb_build_object(
              'invoiceId', i.id,
              'invoiceNumber', i.document_number,
              'customerId', i.counterparty_id,
              'customerName', i.body->>'counterpartyName',
              'dueOn', live.body->'currentRevision'->>'dueOn',
              'currency', i.body->>'currency',
              'currencyScale', (i.body->>'currencyScale')::integer,
              'residualMinor', live.body->'outstandingMinor',
              'status', live."status",
              'disputed', ${openDispute()},
              'holdReminders', ${openReminderHold()},
              'nextAction', case
                when ${openReminderHold()} then 'review_hold'
                when ${openDispute()} then 'review_dispute'
                when live."status" = 'blocked' then 'review_blocked_invoice'
                when (live.body->'currentRevision'->>'dueOn')::date < ${asOf}::date
                  then 'follow_up_overdue'
                else 'follow_up' end
            ) as row,
            count(*) over () as total,
            row_number() over (order by (live.body->'currentRevision'->>'dueOn')::date,
              lower(i.body->>'counterpartyName') collate "C", i.id collate "C") as ordinal
          from openerp.commerce_invoices i
          join lateral (${liveInvoice(bookId, undefined)}) live on live.id = i.id
          where i.book_id = ${bookId} and i.direction = 'customer'
            and live."status" in ('open', 'partially_allocated', 'blocked')
        ) ordered
        where ordered.ordinal > ${(page - 1) * pageSize}
          and ordered.ordinal <= ${page * pageSize}
      ) entry
    `,
    "objects",
  );
}

export function readCustomerStatementItems(
  transaction: Transaction,
  bookId: string,
  customerId: string,
  asOf: string,
  cutoffAt: string,
) {
  return transaction.execute<StatementItemRow>(
    sql`
      select coalesce(jsonb_agg(item.row order by item."issuedOn", item."invoiceId"), '[]'::jsonb) as body
      from (
        select i.id as "invoiceId", i.issued_on as "issuedOn", jsonb_build_object(
            'invoiceId', i.id,
            'number', i.document_number,
            'issuedOn', i.issued_on,
            'currency', i.body->>'currency',
            'currencyScale', (i.body->>'currencyScale')::integer,
            'amountMinor', i.amount_minor::text,
            'allocatedMinor', allocated.total::text,
            'outstandingMinor', (i.amount_minor - allocated.total)::text,
            'status', live."status",
            'disputed', ${openDispute()}
          ) as row
        from openerp.commerce_invoices i
        join lateral (${liveInvoice(bookId, undefined)}) live on live.id = i.id
        cross join lateral (
          select coalesce(sum(l.amount_minor), 0) as total
          from openerp.commerce_allocation_legs l
          join openerp.commerce_allocation_receipts r on r.book_id = l.book_id and r.id = l.receipt_id
          join openerp.vouchers payment
            on payment.book_id = l.book_id and payment.id = l.payment_voucher_id
          where l.book_id = i.book_id and l.invoice_id = i.id
            and payment.posting_date <= ${asOf}::date
            and (r.body->>'committedAt')::timestamptz <= ${cutoffAt}::timestamptz
            and not exists (
              select from openerp.commerce_allocation_reversals rev
              where rev.book_id = r.book_id and rev.receipt_id = r.id
                and (rev.body->>'executedAt')::timestamptz <= ${cutoffAt}::timestamptz
            )
        ) allocated
        where i.book_id = ${bookId} and i.counterparty_id = ${customerId} and i.direction = 'customer'
          and i.issued_on <= ${asOf}::date
      ) item
    `,
    "objects",
  );
}
