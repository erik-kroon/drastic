import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const registerTables = [
  "commerce_register_snapshots",
  "commerce_register_allocation_dependencies",
  "commerce_control_accounts",
  "commerce_invoices",
  "commerce_invoice_revisions",
  "commerce_active_allocation_legs",
  "commerce_allocation_receipts",
  "commerce_allocation_reversals",
  "invoice_cancellations",
  "supplier_credits",
  "invoice_drafts",
  "journal_lines",
  "vouchers",
  "accounts",
  "books",
  "command_receipts",
] as const;

export type RegisterBookRow = {
  readonly entityId: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly profile: string;
  readonly authority: string;
  readonly profileVersion: string;
  readonly committedSequence: string;
};

export type BoundsRow = {
  readonly accounts: string;
  readonly invoices: string;
  readonly allocations: string;
  readonly lines: string;
};

export type CountRow = { readonly total: number };

export type ArrayRow = { readonly value: JsonObject };

export type SnapshotRow = {
  readonly id: string;
  readonly ordinal: string;
  readonly body: JsonObject;
};

export type OrdinalRow = { readonly ordinal: string; readonly total: string };

export type CursorRow = { readonly cursor: string };

const cutoff = (bookId: string, asOf: string, sequence: string) => sql`
  v.book_id = ${bookId} and v.posting_date <= ${asOf}::date and v.sequence <= ${sequence}::bigint
`;

// The recognition voucher of a selected invoice stays accounted when it is
// either the current posting or a reversal retained by its own invoice
// cancellation. Anything else is a damaged register link.
const recognitionAccounted = (bookId: string) => sql`
  exists (
    select 1 from openerp.vouchers v
    where v.book_id = ${bookId} and v.id = recognition
      and v.corrects_voucher_id is null and v.posting_purpose <> 'reversal'
      and not exists (
        select 1 from openerp.vouchers r where r.book_id = v.book_id and r.corrects_voucher_id = v.id)
  ) or exists (
    select 1 from openerp.invoice_cancellations c
    join openerp.vouchers v on (v.book_id, v.id) = (c.book_id, c.reversal_voucher_id)
    join openerp.execution_receipts e on (e.book_id, e.id) = (c.book_id, c.posting_receipt_id)
    where c.book_id = ${bookId} and c.original_voucher_id = recognition
      and v.corrects_voucher_id = recognition and v.posting_purpose = 'reversal'
      and e.voucher_id = v.id)
`;

const voucherCurrent = (bookId: string) => sql`
  exists (
    select 1 from openerp.vouchers v
    where v.book_id = ${bookId} and v.id = payment.id
      and v.corrects_voucher_id is null and v.posting_purpose <> 'reversal'
      and not exists (
        select 1 from openerp.vouchers r where r.book_id = v.book_id and r.corrects_voucher_id = v.id))
`;

export function readRegisterBook(transaction: Transaction, bookId: string) {
  return transaction.execute<RegisterBookRow>(
    sql`
      select entity_id as "entityId", currency, currency_scale as "currencyScale", profile,
        authority, profile_version::text as "profileVersion",
        committed_sequence::text as "committedSequence"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readBounds(
  transaction: Transaction,
  bookId: string,
  asOf: string,
  sequence: string,
) {
  return transaction.execute<BoundsRow>(
    sql`
      select
        (select count(*)::text from (
           select 1 from openerp.commerce_control_accounts c where c.book_id = ${bookId}
           limit 101) bounded) as accounts,
        (select count(*)::text from (
           select 1 from openerp.commerce_invoices i
           join openerp.vouchers v on v.book_id = i.book_id and v.id = i.recognition_voucher_id
           where ${cutoff(bookId, asOf, sequence)} limit 2001) bounded) as invoices,
        (select count(*)::text from (
           select 1 from openerp.commerce_active_allocation_legs l
           join openerp.vouchers v on v.book_id = l.book_id and v.id = l.payment_voucher_id
           where ${cutoff(bookId, asOf, sequence)} limit 2001) bounded) as allocations,
        (select count(*)::text from (
           select 1 from openerp.journal_lines l
           join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
           join openerp.commerce_control_accounts c
             on c.book_id = l.book_id and c.account_id = l.account_id
           where ${cutoff(bookId, asOf, sequence)} limit 2001) bounded) as lines
    `,
    "objects",
  );
}

export function countInvalidRecognitions(
  transaction: Transaction,
  bookId: string,
  asOf: string,
  sequence: string,
  currency: string,
) {
  return transaction.execute<{ readonly invalid: string }>(
    sql`
      with selection as (
        select i.recognition_voucher_id as recognition, i.control_account_id as control,
          i.body, i.direction, i.amount_minor, j.account_id as line_account,
          j.debit_minor, j.credit_minor
        from openerp.commerce_invoices i
        join openerp.vouchers v on v.book_id = i.book_id and v.id = i.recognition_voucher_id
        join openerp.journal_lines j
          on j.book_id = i.book_id and j.voucher_id = v.id and j.id = i.recognition_line_id
        where i.book_id = ${bookId} and ${cutoff(bookId, asOf, sequence)}
      )
      select count(*)::text as invalid
      from selection
      where not (${recognitionAccounted(bookId)})
        or line_account is distinct from control
        or body->>'currency' is distinct from ${currency}
        or (direction = 'customer' and (debit_minor <> amount_minor or credit_minor <> 0))
        or (direction = 'supplier' and (credit_minor <> amount_minor or debit_minor <> 0))
    `,
    "objects",
  );
}

export function countInvalidAllocations(
  transaction: Transaction,
  bookId: string,
  asOf: string,
  sequence: string,
) {
  return transaction.execute<{ readonly invalid: string }>(
    sql`
      select count(*)::text as invalid
      from openerp.commerce_active_allocation_legs l
      join openerp.commerce_invoices i on i.book_id = l.book_id and i.id = l.invoice_id
      join openerp.vouchers recognition
        on recognition.book_id = i.book_id and recognition.id = i.recognition_voucher_id
      join openerp.vouchers payment
        on payment.book_id = l.book_id and payment.id = l.payment_voucher_id
      join openerp.journal_lines j
        on j.book_id = l.book_id and j.voucher_id = payment.id and j.id = l.payment_line_id
      where l.book_id = ${bookId}
        and payment.posting_date <= ${asOf}::date and payment.sequence <= ${sequence}::bigint
        and (not (${voucherCurrent(bookId)})
          or j.account_id <> i.control_account_id
          or recognition.posting_date > payment.posting_date
          or recognition.sequence > ${sequence}::bigint
          or recognition.event_id = payment.event_id
          or (i.direction = 'customer' and (j.credit_minor = 0 or j.debit_minor <> 0))
          or (i.direction = 'supplier' and (j.debit_minor = 0 or j.credit_minor <> 0)))
    `,
    "objects",
  );
}

export function readAllocations(
  transaction: Transaction,
  bookId: string,
  asOf: string,
  sequence: string,
) {
  return transaction.execute<ArrayRow>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
        'receiptId', l.receipt_id, 'ordinal', l.ordinal, 'invoiceId', l.invoice_id,
        'paymentVoucherId', l.payment_voucher_id, 'paymentLineId', l.payment_line_id,
        'postingDate', v.posting_date::text, 'amountMinor', l.amount_minor::text,
        'planId', r.plan_id, 'planDigest', r.body->>'planDigest', 'committedAt', r.body->>'committedAt')
        order by l.receipt_id collate "C", l.ordinal), '[]'::jsonb) as value
      from openerp.commerce_active_allocation_legs l
      join openerp.commerce_allocation_receipts r on r.book_id = l.book_id and r.id = l.receipt_id
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.payment_voucher_id
      where l.book_id = ${bookId} and ${cutoff(bookId, asOf, sequence)}
    `,
    "objects",
  );
}

export function readInvoices(
  transaction: Transaction,
  bookId: string,
  asOf: string,
  sequence: string,
  allocations: JsonObject,
) {
  return transaction.execute<ArrayRow>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'direction', i.direction, 'counterpartyId', i.counterparty_id,
        'counterpartyRevision', i.counterparty_revision::text,
        'counterpartyName', i.body->>'counterpartyName',
        'documentNumber', i.document_number, 'issuedOn', i.issued_on::text,
        'amountMinor', i.amount_minor::text, 'controlAccountId', i.control_account_id,
        'evidence', i.body->'evidence', 'recognition', i.body->'recognition',
        'revision', r.body, 'allocatedMinor', paid.amount::text,
        'cancelledMinor', case when cancel.id is null then '0' else i.amount_minor::text end,
        'creditedMinor', credit.amount::text,
        'effectiveAmountMinor', ((case when cancel.id is null then i.amount_minor else 0 end)
          - credit.amount)::text,
        'cancellation', case when cancel.body is null then null else jsonb_build_object(
          'id', cancel.body->>'id', 'reviewId', cancel.body->>'reviewId',
          'issueId', cancel.body->>'issueId', 'originalVoucherId', cancel.body->>'originalVoucherId',
          'reversalVoucherId', cancel.body->>'reversalVoucherId',
          'postingDate', cancel.body->>'postingDate', 'committedAt', cancel.body->>'committedAt') end,
        'outstandingMinor', ((case when cancel.id is null then i.amount_minor else 0 end)
          - paid.amount - credit.amount)::text,
        'daysOverdue', greatest(${asOf}::date - (r.body->>'dueOn')::date, 0),
        'ageBucket', case
          when ${asOf}::date <= (r.body->>'dueOn')::date then 'not_due'
          when ${asOf}::date - (r.body->>'dueOn')::date <= 30 then 'days_1_30'
          when ${asOf}::date - (r.body->>'dueOn')::date <= 60 then 'days_31_60'
          when ${asOf}::date - (r.body->>'dueOn')::date <= 90 then 'days_61_90'
          else 'over_90' end
      ) order by i.id collate "C"), '[]'::jsonb) as value
      from openerp.commerce_invoices i
      join openerp.commerce_invoice_revisions r
        on r.book_id = i.book_id and r.invoice_id = i.id and r.revision = i.current_revision
      left join openerp.invoice_cancellations cancel
        on cancel.book_id = i.book_id and cancel.register_invoice_id = i.id
        and cancel.posting_date <= ${asOf}::date
      cross join lateral (
        select coalesce(sum(sc.amount_minor), 0) as amount
        from openerp.supplier_credits sc
        join openerp.vouchers cv on (cv.book_id, cv.id) = (sc.book_id, sc.voucher_id)
        where sc.book_id = i.book_id and sc.invoice_id = i.id
          and cv.posting_date <= ${asOf}::date and cv.sequence <= ${sequence}::bigint
      ) credit
      join openerp.vouchers v on v.book_id = i.book_id and v.id = i.recognition_voucher_id
      cross join lateral (
        select coalesce(sum((a->>'amountMinor')::numeric), 0) as amount
        from jsonb_array_elements(${JSON.stringify(allocations)}::jsonb) a
        where a->>'invoiceId' = i.id
      ) paid
      where i.book_id = ${bookId} and ${cutoff(bookId, asOf, sequence)}
    `,
    "objects",
  );
}

export function readLines(
  transaction: Transaction,
  bookId: string,
  asOf: string,
  sequence: string,
  invoices: JsonObject,
  allocations: JsonObject,
) {
  return transaction.execute<ArrayRow>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
        'accountId', l.account_id, 'voucherId', v.id, 'lineId', l.id,
        'sequence', v.sequence::text, 'ordinal', l.ordinal,
        'postingDate', v.posting_date::text, 'debitMinor', l.debit_minor::text,
        'creditMinor', l.credit_minor::text,
        'invoiceId', coalesce(invoice.value->>'id', cancelled.value->>'id', credit.invoice_id),
        'allocatedMinor', paid.amount::text,
        'cancellationId', cancelled.value->'cancellation'->>'id', 'creditId', credit.id,
        'registerContributionKind', case
          when invoice.value is not null then 'recognition'
          when cancelled.value is not null then 'cancellation'
          when credit.id is not null then 'credit'
          when paid.amount > 0 then 'allocation' else 'unexplained' end,
        'registerEffectMinor', (coalesce((invoice.value->>'amountMinor')::numeric, 0)
          - coalesce((cancelled.value->>'cancelledMinor')::numeric, 0)
          - coalesce(credit.amount_minor, 0) - paid.amount)::text,
        'unexplainedMinor', ((case when c.direction = 'customer'
            then l.debit_minor - l.credit_minor else l.credit_minor - l.debit_minor end)
          - coalesce((invoice.value->>'amountMinor')::numeric, 0)
          + coalesce((cancelled.value->>'cancelledMinor')::numeric, 0)
          + coalesce(credit.amount_minor, 0) + paid.amount)::text
      ) order by v.sequence, l.ordinal), '[]'::jsonb) as value
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      join openerp.commerce_control_accounts c
        on c.book_id = l.book_id and c.account_id = l.account_id
      left join lateral (
        select i as value from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->'recognition'->>'voucherId' = v.id and i->'recognition'->>'lineId' = l.id
      ) invoice on true
      left join lateral (
        select i as value from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->'cancellation'->>'reversalVoucherId' = v.id and i->'recognition'->>'lineId' = l.id
      ) cancelled on true
      left join openerp.supplier_credits credit
        on (credit.book_id, credit.voucher_id, credit.control_line_id) = (l.book_id, v.id, l.id)
      cross join lateral (
        select coalesce(sum((a->>'amountMinor')::numeric), 0) as amount
        from jsonb_array_elements(${JSON.stringify(allocations)}::jsonb) a
        where a->>'paymentVoucherId' = v.id and a->>'paymentLineId' = l.id
      ) paid
      where l.book_id = ${bookId} and ${cutoff(bookId, asOf, sequence)}
    `,
    "objects",
  );
}

export function readControls(
  transaction: Transaction,
  bookId: string,
  invoices: JsonObject,
  lines: JsonObject,
) {
  return transaction.execute<ArrayRow>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
        'accountId', c.account_id, 'code', a.code, 'name', a.name,
        'version', a.version::text, 'active', a.active, 'direction', c.direction,
        'recognizedMinor', recognized.amount::text,
        'cancelledMinor', cancelled.amount::text,
        'creditedMinor', credited.amount::text,
        'allocatedMinor', allocated.amount::text,
        'outstandingMinor', outstanding.amount::text,
        'ledgerMinor', ledger.balance::text,
        'differenceMinor', (ledger.balance - outstanding.amount)::text,
        'unexplainedLineCount', ledger.unexplained,
        'ageing', jsonb_build_object('not_due', not_due.amount::text,
          'days_1_30', days_1_30.amount::text, 'days_31_60', days_31_60.amount::text,
          'days_61_90', days_61_90.amount::text, 'over_90', over_90.amount::text)
      ) order by c.account_id collate "C"), '[]'::jsonb) as value
      from openerp.commerce_control_accounts c
      join openerp.accounts a on a.book_id = c.book_id and a.id = c.account_id
      cross join lateral (
        select coalesce(sum((i->>'amountMinor')::numeric), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) recognized
      cross join lateral (
        select coalesce(sum((i->>'cancelledMinor')::numeric), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) cancelled
      cross join lateral (
        select coalesce(sum((i->>'creditedMinor')::numeric), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) credited
      cross join lateral (
        select coalesce(sum((i->>'allocatedMinor')::numeric), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) allocated
      cross join lateral (
        select coalesce(sum((i->>'outstandingMinor')::numeric), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) outstanding
      cross join lateral (
        select coalesce(sum((i->>'outstandingMinor')::numeric)
          filter (where i->>'ageBucket' = 'not_due'), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) not_due
      cross join lateral (
        select coalesce(sum((i->>'outstandingMinor')::numeric)
          filter (where i->>'ageBucket' = 'days_1_30'), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) days_1_30
      cross join lateral (
        select coalesce(sum((i->>'outstandingMinor')::numeric)
          filter (where i->>'ageBucket' = 'days_31_60'), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) days_31_60
      cross join lateral (
        select coalesce(sum((i->>'outstandingMinor')::numeric)
          filter (where i->>'ageBucket' = 'days_61_90'), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) days_61_90
      cross join lateral (
        select coalesce(sum((i->>'outstandingMinor')::numeric)
          filter (where i->>'ageBucket' = 'over_90'), 0) as amount
        from jsonb_array_elements(${JSON.stringify(invoices)}::jsonb) i
        where i->>'controlAccountId' = c.account_id
      ) over_90
      cross join lateral (
        select coalesce(sum(case when c.direction = 'customer'
            then (l->>'debitMinor')::numeric - (l->>'creditMinor')::numeric
            else (l->>'creditMinor')::numeric - (l->>'debitMinor')::numeric end), 0) as balance,
          count(*) filter (where (l->>'unexplainedMinor')::numeric <> 0) as unexplained
        from jsonb_array_elements(${JSON.stringify(lines)}::jsonb) l
        where l->>'accountId' = c.account_id
      ) ledger
      where c.book_id = ${bookId}
    `,
    "objects",
  );
}

export function readNextOrdinal(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly ordinal: string }>(
    sql`
      select (coalesce(max(ordinal), 0) + 1)::text as ordinal
      from openerp.commerce_register_snapshots
      where book_id = ${bookId}
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
      join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.payment_voucher_id)
      left join openerp.commerce_allocation_reversals r
        on (r.book_id, r.receipt_id) = (l.book_id, l.receipt_id)
      where l.book_id = ${bookId} and v.posting_date <= ${asOf}::date
    `,
    "objects",
  );
}

export function insertSnapshot(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ordinal: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_register_snapshots (book_id, id, ordinal, body)
      values (${row.bookId}, ${row.id}, ${row.ordinal}::bigint, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertAllocationDependency(
  transaction: Transaction,
  bookId: string,
  reportId: string,
  version: string,
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_register_allocation_dependencies (book_id, report_id, history_version)
      values (${bookId}, ${reportId}, ${version}::numeric)
    `,
    "objects",
  );
}

export function readSnapshot(transaction: Transaction, bookId: string, reportId: string) {
  return transaction.execute<SnapshotRow>(
    sql`
      select id, ordinal::text as ordinal, body
      from openerp.commerce_register_snapshots
      where book_id = ${bookId} and id = ${reportId}
    `,
    "objects",
  );
}

export function readOrdinalBound(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly current: string }>(
    sql`
      select coalesce(max(ordinal), 0)::text as current
      from openerp.commerce_register_snapshots
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function countInventory(transaction: Transaction, bookId: string, cutoffOrdinal: string) {
  return transaction.execute<{ readonly total: string }>(
    sql`
      select count(*)::text as total from openerp.commerce_register_snapshots
      where book_id = ${bookId} and ordinal <= ${cutoffOrdinal}::bigint
    `,
    "objects",
  );
}

export function listInventory(
  transaction: Transaction,
  bookId: string,
  after: string,
  cutoffOrdinal: string,
  limit: number,
) {
  return transaction.execute<ArrayRow>(
    sql`
      select coalesce(jsonb_agg(page.body order by page.ordinal), '[]'::jsonb) as value
      from (
        select r.ordinal, r.body - array['controls', 'invoices', 'allocations', 'ledgerLines'] as body
        from openerp.commerce_register_snapshots r
        where r.book_id = ${bookId} and r.ordinal > ${after}::bigint
          and r.ordinal <= ${cutoffOrdinal}::bigint
        order by r.ordinal limit ${limit}
      ) page
    `,
    "objects",
  );
}

export function readCursor(
  transaction: Transaction,
  scope: JsonObject,
  cutoffOrdinal: string,
  after: string,
) {
  return transaction.execute<CursorRow>(
    sql`
      select 'rr1_' || encode(convert_to(openerp.canonical(${JSON.stringify(scope)}::jsonb
        || jsonb_build_object('version', '1', 'cutoff', ${cutoffOrdinal}, 'after', ${after})), 'UTF8'), 'hex')
        as cursor
    `,
    "objects",
  );
}

export function decodeCursor(transaction: Transaction, cursor: string) {
  return transaction.execute<{ readonly value: JsonObject | null }>(
    sql`
      select convert_from(decode(substr(${cursor}, 5), 'hex'), 'UTF8')::jsonb as value
    `,
    "objects",
  );
}

export function digestJson(transaction: Transaction, value: JsonObject) {
  return Effect.map(
    transaction.execute<{ readonly digest: string }>(
      sql`select openerp.digest(${JSON.stringify(value)}::jsonb) as digest`,
      "objects",
    ),
    (rows) => rows[0]?.digest,
  );
}

export function retainedBytes(transaction: Transaction, value: JsonObject) {
  return transaction.execute<{ readonly bytes: string }>(
    sql`select octet_length(${JSON.stringify(value)}::jsonb::text)::text as bytes`,
    "objects",
  );
}

export function countRows(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.commerce_control_accounts where book_id = ${bookId}`,
    "objects",
  );
}
