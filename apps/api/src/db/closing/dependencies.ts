import { sql, type SQL } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import { readTableAccess } from "../commerce/access";
import type { Transaction } from "../transaction";

type Json = Schema.Json;
type JsonObject = Schema.JsonObject;

export type BankSourceRow = {
  readonly accountId: string;
  readonly sourceId: string;
  readonly revision: string;
  readonly reconciliationId: string | null;
  readonly reconciliationKind: string | null;
  readonly reconciliationCreatedAt: string | null;
};

export type BookRow = {
  readonly entityId: string;
  readonly currency: string;
  readonly currencyScale: number;
};

export type CountRow = { readonly total: number };

export type BodyRow = { readonly body: JsonObject };

export type BodyWithFlagRow = {
  readonly body: JsonObject;
  readonly invalid: boolean;
};

export type CommerceInvoiceRow = {
  readonly body: JsonObject;
  readonly invalid: boolean;
};

export type CommerceLegRow = {
  readonly receiptId: string;
  readonly ordinal: number;
  readonly invoiceId: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly postingDate: string;
  readonly amountMinor: string;
  readonly planDigest: string | null;
  readonly invalid: boolean;
};

export type ExpenseSourceRow = {
  readonly id: string;
  readonly currentBody: JsonObject | null;
  readonly reviewBody: JsonObject | null;
  readonly withdrawn: boolean;
};

export type ExpenseBasisRow = {
  readonly id: string;
  readonly sourceDigest: string | null;
  readonly reviewDigest: string | null;
  readonly withdrawalDigest: string | null;
};

export type OwnerSourceRow = {
  readonly source: JsonObject;
  readonly revision: JsonObject;
  readonly reviewId: string | null;
  readonly review: JsonObject | null;
  readonly linked: boolean;
};

export type OwnerLegRow = { readonly leg: JsonObject };

export type ScheduleRevisionRow = {
  readonly id: string;
  readonly body: JsonObject;
  readonly disposal: JsonObject | null;
};

export type OccurrenceStateRow = {
  readonly scheduleId: string;
  readonly states: Json;
};

export type ImpairmentDigestRow = {
  readonly scheduleId: string;
  readonly digests: Json;
};

export type ScheduleDigestRow = {
  readonly id: string;
  readonly digest: string | null;
};

export type SubledgerBookRow = {
  readonly committedSequence: string;
  readonly profile: string;
  readonly profileVersion: string;
  readonly authority: string;
  readonly writerEpoch: string;
  readonly currency: string;
  readonly currencyScale: number;
};

export type PeriodDigestRow = {
  readonly id: string;
  readonly version: string;
  readonly locked: boolean;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly fiscalYearId: string;
};

export type AccountDigestRow = {
  readonly id: string;
  readonly version: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
};

export type PreparationDigestRow = { readonly preparation: Json };

export type ControlCoverageRow = {
  readonly snapshotCount: number;
  readonly missingBasisCount: number;
};

export type VatBoundRow = {
  readonly factCount: number;
  readonly draftCount: number;
  readonly amendmentCount: number;
  readonly profileCount: number;
  readonly obligationCount: number;
  readonly reviewCount: number;
  readonly approvalCount: number;
  readonly effectCount: number;
  readonly contributionCount: number;
};

export type VatParentBoundRow = { readonly exceeded: boolean };

export type VatInventoryRow = {
  readonly profiles: Json;
  readonly obligations: Json;
  readonly reviews: Json;
  readonly approvals: Json;
  readonly effects: Json;
  readonly contributions: Json;
  readonly amendments: Json;
};

export type TaxAccountBoundRow = {
  readonly statementCount: number;
  readonly controlCount: number;
  readonly matchCount: number;
  readonly unmatchCount: number;
  readonly classificationCount: number;
};

export type TaxAccountStatementRow = {
  readonly id: string;
  readonly digest: string | null;
};

export type TaxAccountControlRow = {
  readonly id: string;
  readonly digest: string | null;
  readonly sha256: string;
  readonly byteLength: number;
};

export type TaxAccountMatchRow = {
  readonly id: string;
  readonly digest: string | null;
};

export type TaxAccountUnmatchRow = {
  readonly id: string;
  readonly matchId: string;
  readonly digest: string | null;
};

export type TaxAccountActiveRow = {
  readonly id: string;
  readonly active: boolean;
  readonly usable: boolean;
  readonly corrections: Json;
};

export type TaxAccountClassificationRow = {
  readonly id: string;
  readonly digest: string | null;
};

export const closingDependencyTables = [
  "books",
  "accounts",
  "periods",
  "vouchers",
  "journal_lines",
  "change_sets",
  "events",
  "execution_receipts",
  "bank_sources",
  "bank_reconciliations",
  "bank_capacity_reconciliations",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "commerce_invoices",
  "commerce_allocation_legs",
  "commerce_allocation_receipts",
  "commerce_allocation_reversals",
  "commerce_active_allocation_legs",
  "invoice_cancellations",
  "supplier_credits",
  "commerce_fx_items",
  "commerce_fx_settlements",
  "expense_tax_sources",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "expense_tax_source_withdrawals",
  "owner_records",
  "owner_revisions",
  "owner_reviews",
  "owner_effects",
  "owner_allocation_legs",
  "subledger_schedules",
  "subledger_schedule_revisions",
  "subledger_preparations",
  "subledger_bases",
  "subledger_disposals",
  "subledger_impairments",
  "subledger_impairment_reviews",
  "subledger_control_snapshots",
  "vat_fact_components",
  "vat_fact_revisions",
  "vat_fact_withdrawals",
  "vat_return_drafts",
  "vat_draft_amendments",
  "vat_control_profiles",
  "vat_reporting_obligations",
  "vat_control_reclassification_reviews",
  "vat_control_reclassification_approvals",
  "vat_control_reclassification_effects",
  "vat_control_reclassification_contributions",
  "tax_account_statements",
  "tax_account_controls",
  "tax_account_events",
  "tax_account_matches",
  "tax_account_unmatches",
  "tax_account_match_capacity",
  "tax_account_classification_resolutions",
] as const;

export function readDependencyAccess(transaction: Transaction) {
  return readTableAccess(transaction, [...closingDependencyTables]);
}

function voucherCurrent(bookId: string, voucher: SQL) {
  return sql`exists (
    select 1 from openerp.vouchers current_v
    where current_v.book_id = ${bookId} and current_v.id = ${voucher}
      and current_v.corrects_voucher_id is null
      and current_v.posting_purpose <> 'reversal'
      and not exists (
        select 1 from openerp.vouchers reversal_v
        where reversal_v.book_id = current_v.book_id
          and reversal_v.corrects_voucher_id = current_v.id)
  )`;
}

function recognitionAccounted(bookId: string, voucher: SQL) {
  return sql`(${voucherCurrent(bookId, voucher)} or exists (
    select 1 from openerp.invoice_cancellations cancellation
    join openerp.vouchers reversal_v
      on (reversal_v.book_id, reversal_v.id) = (cancellation.book_id, cancellation.reversal_voucher_id)
    join openerp.execution_receipts receipt
      on (receipt.book_id, receipt.id) = (cancellation.book_id, cancellation.posting_receipt_id)
    where cancellation.book_id = ${bookId}
      and cancellation.original_voucher_id = ${voucher}
      and reversal_v.corrects_voucher_id = ${voucher}
      and reversal_v.posting_purpose = 'reversal'
      and receipt.voucher_id = reversal_v.id))`;
}

function scheduleRevisionAt(bookId: string, schedule: SQL, endsOn: string) {
  return sql`(select revision_v.body from openerp.subledger_schedule_revisions revision_v
    where revision_v.book_id = ${bookId} and revision_v.schedule_id = ${schedule}
      and revision_v.revision = (
        select max(candidate.revision) from (
          select dated.revision from openerp.subledger_schedule_revisions dated
            where dated.book_id = ${bookId} and dated.schedule_id = ${schedule}
              and (dated.body->>'createdAt')::date <= ${endsOn}::date
          union
          select impairment.schedule_revision from openerp.subledger_impairments impairment
            where impairment.book_id = ${bookId} and impairment.schedule_id = ${schedule}
              and impairment.posting_date <= ${endsOn}::date
          union
          select disposed.revision from openerp.subledger_disposals disposal
            join openerp.subledger_schedule_revisions disposed
              on disposed.book_id = disposal.book_id
              and disposed.schedule_id = disposal.schedule_id
              and disposed.body->>'digest' = disposal.body->>'scheduleDigest'
            where disposal.book_id = ${bookId} and disposal.schedule_id = ${schedule}
              and disposal.posting_date <= ${endsOn}::date
        ) candidate))`;
}

export function readBankCloseSources(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<BankSourceRow>(
    sql`
      select s.account_id as "accountId",
        s.source_bank_account_id as "sourceId", s.revision::text as revision,
        chosen.id as "reconciliationId", chosen.kind as "reconciliationKind",
        chosen.body->>'createdAt' as "reconciliationCreatedAt"
      from openerp.bank_sources s
      left join lateral (
        select candidate.id, candidate.body, candidate.kind from (
          select reconciliation.id, reconciliation.body, 'bank-v1'::text kind
          from openerp.bank_reconciliations reconciliation
          where reconciliation.book_id = ${bookId} and reconciliation.account_id = s.account_id
          union all
          select capacity.id, capacity.body, 'bank-capacity-v2'::text kind
          from openerp.bank_capacity_reconciliations capacity
          where capacity.book_id = ${bookId} and capacity.account_id = s.account_id
        ) candidate
        where candidate.body->>'startsOn' = ${startsOn}
          and candidate.body->>'endsOn' = ${endsOn}
          and candidate.body->>'status' = 'complete'
          and (candidate.body->'checkpoint'->>'sourceRevision')::bigint = s.revision
          and (candidate.body->>'accountLedgerSequence')::bigint = (
            select coalesce(max(line_voucher.sequence), 0)
            from openerp.journal_lines line_v
            join openerp.vouchers line_voucher
              on (line_voucher.book_id, line_voucher.id) = (line_v.book_id, line_v.voucher_id)
            where line_v.book_id = ${bookId} and line_v.account_id = s.account_id
              and line_voucher.posting_date <= ${endsOn}::date)
        order by candidate.body->>'createdAt' desc, candidate.id desc
        limit 1
      ) chosen on true
      where s.book_id = ${bookId}
      order by s.account_id
    `,
    "objects",
  );
}

export function readCommerceBook(transaction: Transaction, bookId: string) {
  return transaction.execute<BookRow>(
    sql`
      select entity_id as "entityId", currency, currency_scale as "currencyScale"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readCommerceInvoices(transaction: Transaction, bookId: string, endsOn: string) {
  return transaction.execute<CommerceInvoiceRow>(
    sql`
      select i.body,
        (not ${recognitionAccounted(bookId, sql`i.recognition_voucher_id`)}
          or j.account_id <> i.control_account_id
          or (i.direction = 'customer' and j.debit_minor <> i.amount_minor)
          or (i.direction = 'supplier' and j.credit_minor <> i.amount_minor)) as invalid
      from openerp.commerce_invoices i
      join openerp.vouchers v
        on v.book_id = i.book_id and v.id = i.recognition_voucher_id
      join openerp.journal_lines j
        on j.book_id = i.book_id and j.voucher_id = i.recognition_voucher_id
        and j.id = i.recognition_line_id
      where i.book_id = ${bookId} and v.posting_date <= ${endsOn}::date
      order by i.id collate "C"
    `,
    "objects",
  );
}

export function readCommerceLegs(transaction: Transaction, bookId: string, endsOn: string) {
  return transaction.execute<CommerceLegRow>(
    sql`
      select l.receipt_id as "receiptId", l.ordinal, l.invoice_id as "invoiceId",
        l.payment_voucher_id as "voucherId", l.payment_line_id as "lineId",
        v.posting_date::text as "postingDate", l.amount_minor::text as "amountMinor",
        r.body->>'planDigest' as "planDigest",
        (not ${voucherCurrent(bookId, sql`v.id`)}
          or j.account_id <> i.control_account_id
          or (i.direction = 'customer' and j.credit_minor = 0)
          or (i.direction = 'supplier' and j.debit_minor = 0)
          or v.event_id = recognition.event_id
          or v.posting_date < recognition.posting_date) as invalid
      from openerp.commerce_active_allocation_legs l
      join openerp.commerce_allocation_receipts r
        on r.book_id = l.book_id and r.id = l.receipt_id
      join openerp.commerce_invoices i
        on i.book_id = l.book_id and i.id = l.invoice_id
      join openerp.vouchers recognition
        on recognition.book_id = i.book_id and recognition.id = i.recognition_voucher_id
      join openerp.vouchers v
        on v.book_id = l.book_id and v.id = l.payment_voucher_id
      join openerp.journal_lines j
        on j.book_id = l.book_id and j.voucher_id = l.payment_voucher_id
        and j.id = l.payment_line_id
      where l.book_id = ${bookId} and v.posting_date <= ${endsOn}::date
      order by l.receipt_id collate "C", l.ordinal
    `,
    "objects",
  );
}

export function countCommerceAllocationCapacityFailures(
  transaction: Transaction,
  bookId: string,
  endsOn: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total from (
        select i.id from openerp.commerce_invoices i
          join openerp.commerce_active_allocation_legs l
            on l.book_id = i.book_id and l.invoice_id = i.id
          join openerp.vouchers v
            on v.book_id = l.book_id and v.id = l.payment_voucher_id
          where i.book_id = ${bookId} and v.posting_date <= ${endsOn}::date
          group by i.id, i.amount_minor having sum(l.amount_minor) > i.amount_minor
        union all
        select j.id from openerp.journal_lines j
          join openerp.commerce_active_allocation_legs l
            on l.book_id = j.book_id and l.payment_voucher_id = j.voucher_id
            and l.payment_line_id = j.id
          join openerp.vouchers v
            on v.book_id = j.book_id and v.id = j.voucher_id
          where j.book_id = ${bookId} and v.posting_date <= ${endsOn}::date
          group by j.voucher_id, j.id, j.debit_minor, j.credit_minor
          having sum(l.amount_minor) > j.debit_minor + j.credit_minor
      ) invalid
    `,
    "objects",
  );
}

export function countCommerceCreditCapacityFailures(
  transaction: Transaction,
  bookId: string,
  endsOn: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.commerce_invoices i
      where i.book_id = ${bookId}
        and exists (
          select 1 from openerp.supplier_credits c
          join openerp.vouchers v on (v.book_id, v.id) = (c.book_id, c.voucher_id)
          where c.book_id = i.book_id and c.invoice_id = i.id
            and v.posting_date <= ${endsOn}::date)
        and (select coalesce(sum(c.amount_minor), 0) from openerp.supplier_credits c
          join openerp.vouchers v on (v.book_id, v.id) = (c.book_id, c.voucher_id)
          where c.book_id = i.book_id and c.invoice_id = i.id
            and v.posting_date <= ${endsOn}::date)
          + (select coalesce(sum(l.amount_minor), 0)
            from openerp.commerce_active_allocation_legs l
            join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.payment_voucher_id)
            where l.book_id = i.book_id and l.invoice_id = i.id
              and v.posting_date <= ${endsOn}::date) > i.amount_minor
    `,
    "objects",
  );
}

export function readCommerceReversals(transaction: Transaction, bookId: string, endsOn: string) {
  return transaction.execute<BodyRow>(
    sql`
      select r.body
      from openerp.commerce_allocation_reversals r
      where r.book_id = ${bookId}
        and exists (
          select 1 from openerp.commerce_allocation_legs l
          join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.payment_voucher_id)
          where l.book_id = r.book_id and l.receipt_id = r.receipt_id
            and v.posting_date <= ${endsOn}::date)
      order by r.plan_id collate "C"
    `,
    "objects",
  );
}

export function readCommerceCancellations(
  transaction: Transaction,
  bookId: string,
  endsOn: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select c.body
      from openerp.invoice_cancellations c
      join openerp.vouchers original
        on (original.book_id, original.id) = (c.book_id, c.original_voucher_id)
      where c.book_id = ${bookId} and original.posting_date <= ${endsOn}::date
      order by c.id collate "C"
    `,
    "objects",
  );
}

export function readCommerceSupplierCredits(
  transaction: Transaction,
  bookId: string,
  endsOn: string,
) {
  return transaction.execute<BodyWithFlagRow>(
    sql`
      select c.body,
        (not ${voucherCurrent(bookId, sql`v.id`)}
          or j.account_id <> i.control_account_id
          or j.debit_minor <> c.amount_minor
          or j.credit_minor <> 0
          or c.credit_date < i.issued_on
          or v.posting_date < c.credit_date) as invalid
      from openerp.supplier_credits c
      join openerp.commerce_invoices i on (i.book_id, i.id) = (c.book_id, c.invoice_id)
      join openerp.vouchers v on (v.book_id, v.id) = (c.book_id, c.voucher_id)
      join openerp.journal_lines j
        on (j.book_id, j.voucher_id, j.id) = (c.book_id, c.voucher_id, c.control_line_id)
      where c.book_id = ${bookId} and v.posting_date <= ${endsOn}::date
      order by c.id collate "C"
    `,
    "objects",
  );
}

export function readExpenseTaxBook(transaction: Transaction, bookId: string) {
  return transaction.execute<{
    readonly currency: string;
    readonly currencyScale: number;
    readonly profile: string;
    readonly profileVersion: string;
  }>(
    sql`
      select currency, currency_scale as "currencyScale", profile,
        profile_version::text as "profileVersion"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readExpenseTaxBasisSources(transaction: Transaction, bookId: string) {
  return transaction.execute<ExpenseBasisRow>(
    sql`
      select s.id, current.body->>'digest' as "sourceDigest",
        review.body->>'digest' as "reviewDigest",
        withdrawal.body->>'digest' as "withdrawalDigest"
      from openerp.expense_tax_sources s
      join lateral (
        select x.body from openerp.expense_tax_source_revisions x
        where x.book_id = ${bookId} and x.source_id = s.id
        order by x.revision desc limit 1
      ) current on true
      left join lateral (
        select x.body from openerp.expense_tax_reviews x
        where x.book_id = ${bookId} and x.source_id = s.id
        order by x.revision desc limit 1
      ) review on true
      left join openerp.expense_tax_source_withdrawals withdrawal
        on withdrawal.book_id = ${bookId} and withdrawal.source_id = s.id
      where s.book_id = ${bookId}
      order by s.id collate "C"
    `,
    "objects",
  );
}

export function readExpenseTaxDependencySources(transaction: Transaction, bookId: string) {
  return transaction.execute<ExpenseSourceRow>(
    sql`
      select s.id, current.body as "currentBody", review.body as "reviewBody",
        (withdrawal.source_id is not null) as withdrawn
      from openerp.expense_tax_sources s
      left join lateral (
        select x.body from openerp.expense_tax_source_revisions x
        where x.book_id = ${bookId} and x.source_id = s.id
        order by x.revision desc limit 1
      ) current on true
      left join lateral (
        select x.body from openerp.expense_tax_reviews x
        where x.book_id = ${bookId} and x.source_id = s.id
        order by x.revision desc limit 1
      ) review on true
      left join openerp.expense_tax_source_withdrawals withdrawal
        on withdrawal.book_id = ${bookId} and withdrawal.source_id = s.id
      where s.book_id = ${bookId}
    `,
    "objects",
  );
}

export function readOwnerPeriodSources(transaction: Transaction, bookId: string, endsOn: string) {
  return transaction.execute<OwnerSourceRow>(
    sql`
      select r.body as source, v.body as revision, w.id as "reviewId", w.body as review,
        exists (
          select 1 from openerp.owner_effects e
          where e.book_id = ${bookId} and e.record_id = r.id
            and e.posting_date <= ${endsOn}::date) as linked
      from openerp.owner_records r
      join openerp.owner_revisions v
        on v.book_id = r.book_id and v.record_id = r.id and v.revision = r.current_revision
      left join openerp.owner_reviews w
        on w.book_id = r.book_id and w.record_id = r.id and w.revision = r.current_revision
      where r.book_id = ${bookId} and r.occurred_on <= ${endsOn}::date
      order by r.id
    `,
    "objects",
  );
}

export function readOwnerPeriodEffects(transaction: Transaction, bookId: string, endsOn: string) {
  return transaction.execute<BodyRow>(
    sql`
      select e.body from openerp.owner_effects e
      where e.book_id = ${bookId} and e.posting_date <= ${endsOn}::date
      order by e.id
    `,
    "objects",
  );
}

export function readOwnerPeriodLegs(transaction: Transaction, bookId: string, endsOn: string) {
  return transaction.execute<OwnerLegRow>(
    sql`
      select to_jsonb(l) as leg
      from openerp.owner_allocation_legs l
      join openerp.owner_effects e
        on e.book_id = l.book_id and e.id = l.settlement_id
      where e.book_id = ${bookId} and e.posting_date <= ${endsOn}::date
      order by l.receipt_id, l.ordinal
    `,
    "objects",
  );
}

export function readSubledgerScheduleRevisions(
  transaction: Transaction,
  bookId: string,
  endsOn: string,
) {
  return transaction.execute<ScheduleRevisionRow>(
    sql`
      select s.id, revision.body, disposal.body as disposal
      from openerp.subledger_schedules s
      cross join lateral (
        select ${scheduleRevisionAt(bookId, sql`s.id`, endsOn)} as body
      ) revision
      left join openerp.subledger_disposals disposal
        on disposal.book_id = s.book_id and disposal.schedule_id = s.id
      where s.book_id = ${bookId} and revision.body is not null
      order by s.id collate "C"
    `,
    "objects",
  );
}

export function readSubledgerOccurrenceStates(
  transaction: Transaction,
  bookId: string,
  endsOn: string,
  schedules: ReadonlyArray<JsonObject>,
) {
  return transaction.execute<OccurrenceStateRow>(
    sql`
      select states."scheduleId", states.states from (
        select entry.value->'body'->>'scheduleId' as "scheduleId",
          coalesce(jsonb_agg(occurrence.value || jsonb_build_object(
          'changeSetId', coalesce(posted_plan.id, prepared.id),
          'planDigest', coalesce(posted_plan.digest, prepared.digest),
          'voucherId', posted.id,
          'reversalVoucherId', reversal.id,
          'state', case
            when posted.id is not null and not exists (
              select 1 from openerp.subledger_preparations linked
              where linked.book_id = ${bookId}
                and linked.schedule_id = entry.value->'body'->>'scheduleId'
                and linked.ordinal = (occurrence.value->>'ordinal')::integer
                and linked.change_set_id = posted.change_set_id) then 'conflicted'
            when reversal.id is not null then 'reversed'
            when posted.id is not null then 'posted'
            when prepared.id is not null then 'prepared'
            else 'unprepared' end)
          order by (occurrence.value->>'ordinal')::integer), '[]'::jsonb) as states
      from jsonb_array_elements(${JSON.stringify(schedules)}::jsonb) entry(value)
      cross join lateral jsonb_array_elements(entry.value->'body'->'occurrences') occurrence(value)
      left join lateral (
        select p.change_set_id from openerp.subledger_preparations p
        join openerp.subledger_schedule_revisions r
          on r.book_id = p.book_id and r.schedule_id = p.schedule_id and r.revision = p.revision
        where p.book_id = ${bookId}
          and p.schedule_id = entry.value->'body'->>'scheduleId'
          and p.ordinal = (occurrence.value->>'ordinal')::integer
          and r.evidence_id = entry.value->'body'->'terms'->>'evidenceId'
          and r.body->'occurrences'->(p.ordinal - 1)->>'ordinal' = occurrence.value->>'ordinal'
          and r.body->'occurrences'->(p.ordinal - 1)->>'eventKey' = occurrence.value->>'eventKey'
        order by p.attempt desc limit 1
      ) prep on true
      left join openerp.change_sets prepared
        on prepared.book_id = ${bookId} and prepared.id = prep.change_set_id
      left join openerp.events occurrence_event
        on occurrence_event.book_id = ${bookId}
        and occurrence_event.evidence_id = entry.value->'body'->'terms'->>'evidenceId'
        and occurrence_event.event_key = occurrence.value->>'eventKey'
      left join openerp.vouchers posted
        on posted.book_id = ${bookId} and posted.event_id = occurrence_event.id
        and posted.posting_purpose = 'adjustment'
        and posted.occurrence_key = 'manual_journal'
        and posted.posting_date <= ${endsOn}::date
      left join openerp.change_sets posted_plan
        on posted_plan.book_id = ${bookId} and posted_plan.id = posted.change_set_id
      left join openerp.vouchers reversal
        on reversal.book_id = ${bookId} and reversal.corrects_voucher_id = posted.id
        and reversal.posting_date <= ${endsOn}::date
      where (occurrence.value->>'postingDate')::date <= ${endsOn}::date
        group by entry.value->'body'->>'scheduleId'
      ) states
      order by states."scheduleId" collate "C"
    `,
    "objects",
  );
}

export function readSubledgerImpairmentDigests(
  transaction: Transaction,
  bookId: string,
  endsOn: string,
) {
  return transaction.execute<ImpairmentDigestRow>(
    sql`
      select i.schedule_id as "scheduleId",
        coalesce(jsonb_agg(i.body->>'digest' order by i.ordinal), '[]'::jsonb) as digests
      from openerp.subledger_impairments i
      where i.book_id = ${bookId} and i.posting_date <= ${endsOn}::date
      group by i.schedule_id
    `,
    "objects",
  );
}

export function countSubledgerImpairments(
  transaction: Transaction,
  bookId: string,
  endsOn: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total from openerp.subledger_impairments
      where book_id = ${bookId} and posting_date <= ${endsOn}::date
    `,
    "objects",
  );
}

export function readSubledgerControlBook(transaction: Transaction, bookId: string) {
  return transaction.execute<SubledgerBookRow>(
    sql`
      select committed_sequence::text as "committedSequence", profile,
        profile_version::text as "profileVersion", authority,
        writer_epoch::text as "writerEpoch", currency, currency_scale as "currencyScale"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readSubledgerControlPeriods(transaction: Transaction, bookId: string) {
  return transaction.execute<PeriodDigestRow>(
    sql`
      select p.id, p.version::text as version, p.locked,
        p.starts_on::text as "startsOn", p.ends_on::text as "endsOn",
        p.fiscal_year_id as "fiscalYearId"
      from openerp.periods p where p.book_id = ${bookId}
      order by p.id collate "C"
      limit 1001
    `,
    "objects",
  );
}

export function readSubledgerControlAccounts(transaction: Transaction, bookId: string) {
  return transaction.execute<AccountDigestRow>(
    sql`
      select a.id, a.version::text as version, a.code, a.name, a.active
      from openerp.accounts a where a.book_id = ${bookId}
      order by a.id collate "C"
      limit 1001
    `,
    "objects",
  );
}

export function readSubledgerControlScheduleDigests(transaction: Transaction, bookId: string) {
  return transaction.execute<ScheduleDigestRow>(
    sql`
      select s.id, current.body->>'digest' as digest
      from openerp.subledger_schedules s
      left join lateral (
        select x.body from openerp.subledger_schedule_revisions x
        where x.book_id = ${bookId} and x.schedule_id = s.id
        order by x.revision desc limit 1
      ) current on true
      where s.book_id = ${bookId}
      order by s.id collate "C"
      limit 201
    `,
    "objects",
  );
}

export function readSubledgerControlBasisDigests(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly digest: string | null }>(
    sql`
      select b.body->>'digest' as digest
      from openerp.subledger_bases b where b.book_id = ${bookId}
      order by b.schedule_id collate "C"
    `,
    "objects",
  );
}

export function readSubledgerControlPreparations(transaction: Transaction, bookId: string) {
  return transaction.execute<PreparationDigestRow>(
    sql`
      select jsonb_build_array(p.schedule_id, p.ordinal, p.attempt, p.change_set_id) as preparation
      from openerp.subledger_preparations p where p.book_id = ${bookId}
      order by p.schedule_id collate "C", p.ordinal, p.attempt
      limit 10001
    `,
    "objects",
  );
}

export function readSubledgerControlDisposalDigests(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly digest: string | null }>(
    sql`
      select d.body->>'digest' as digest
      from openerp.subledger_disposals d where d.book_id = ${bookId}
      order by d.schedule_id collate "C"
    `,
    "objects",
  );
}

export function readSubledgerControlImpairmentDigests(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly digest: string | null }>(
    sql`
      select i.body->>'digest' as digest
      from openerp.subledger_impairments i where i.book_id = ${bookId}
      order by i.schedule_id collate "C", i.ordinal
      limit 4001
    `,
    "objects",
  );
}

export function countSubledgerControlImpairmentReviews(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from (select 1 from openerp.subledger_impairment_reviews r
        where r.book_id = ${bookId} limit 4001) bounded
    `,
    "objects",
  );
}

export function readSubledgerControlCoverage(transaction: Transaction, bookId: string) {
  return transaction.execute<ControlCoverageRow>(
    sql`
      select
        (select count(*)::integer from openerp.subledger_control_snapshots c
          where c.book_id = ${bookId}) as "snapshotCount",
        (select count(*)::integer from openerp.subledger_schedules s
          where s.book_id = ${bookId} and not exists (
            select 1 from openerp.subledger_bases b
            where b.book_id = s.book_id and b.schedule_id = s.id)) as "missingBasisCount"
    `,
    "objects",
  );
}

export function readVatReturnBounds(transaction: Transaction, bookId: string) {
  return transaction.execute<VatBoundRow>(
    sql`
      select
        (select count(*)::integer from (select 1 from openerp.vat_fact_components f
          where f.book_id = ${bookId} limit 201) bounded) as "factCount",
        (select count(*)::integer from (select 1 from openerp.vat_return_drafts d
          where d.book_id = ${bookId} limit 501) bounded) as "draftCount",
        (select count(*)::integer from (select 1 from openerp.vat_draft_amendments a
          where a.book_id = ${bookId} limit 501) bounded) as "amendmentCount",
        (select count(*)::integer from (select 1 from openerp.vat_control_profiles p
          where p.book_id = ${bookId} limit 21) bounded) as "profileCount",
        (select count(*)::integer from (select 1 from openerp.vat_reporting_obligations o
          where o.book_id = ${bookId} limit 201) bounded) as "obligationCount",
        (select count(*)::integer from (select 1
          from openerp.vat_control_reclassification_reviews r
          where r.book_id = ${bookId} limit 501) bounded) as "reviewCount",
        (select count(*)::integer from (select 1
          from openerp.vat_control_reclassification_approvals a
          where a.book_id = ${bookId} limit 10001) bounded) as "approvalCount",
        (select count(*)::integer from (select 1
          from openerp.vat_control_reclassification_effects e
          where e.book_id = ${bookId} limit 501) bounded) as "effectCount",
        (select count(*)::integer from (select 1
          from openerp.vat_control_reclassification_contributions c
          where c.book_id = ${bookId} limit 5001) bounded) as "contributionCount"
    `,
    "objects",
  );
}

export function readVatReturnParentBounds(transaction: Transaction, bookId: string) {
  return transaction.execute<VatParentBoundRow>(
    sql`
      select (
        exists (select 1 from openerp.vat_control_reclassification_reviews r
          where r.book_id = ${bookId}
          group by r.obligation_id having count(*) > 20)
        or exists (select 1 from openerp.vat_control_reclassification_approvals a
          where a.book_id = ${bookId}
          group by a.review_id having count(*) > 20)
      ) as exceeded
    `,
    "objects",
  );
}

export function readVatReturnInventories(transaction: Transaction, bookId: string) {
  return transaction.execute<VatInventoryRow>(
    sql`
      select
        coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'digest', p.body->>'digest')
          order by p.id collate "C") from openerp.vat_control_profiles p
          where p.book_id = ${bookId}), '[]'::jsonb) as profiles,
        coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'digest', o.digest,
          'startsOn', o.starts_on::text, 'endsOn', o.ends_on::text)
          order by o.starts_on, o.ends_on, o.id collate "C")
          from openerp.vat_reporting_obligations o where o.book_id = ${bookId}), '[]'::jsonb)
          as obligations,
        coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'obligationId', r.obligation_id,
          'digest', r.body->>'digest')
          order by r.obligation_id collate "C", r.ordinal, r.id collate "C")
          from openerp.vat_control_reclassification_reviews r where r.book_id = ${bookId}), '[]'::jsonb)
          as reviews,
        coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'reviewId', a.review_id,
          'digest', a.body->>'digest')
          order by a.review_id collate "C", a.body->>'createdAt', a.id collate "C")
          from openerp.vat_control_reclassification_approvals a where a.book_id = ${bookId}), '[]'::jsonb)
          as approvals,
        coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'obligationId', e.obligation_id,
          'reviewId', e.review_id, 'digest', e.body->>'digest', 'outcome', e.outcome)
          order by e.obligation_id collate "C", e.id collate "C")
          from openerp.vat_control_reclassification_effects e where e.book_id = ${bookId}), '[]'::jsonb)
          as effects,
        coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'effectId', c.effect_id,
          'ordinal', c.ordinal, 'factId', c.fact_id, 'voucherId', c.voucher_id, 'lineId', c.line_id,
          'digest', openerp.digest(c.body))
          order by c.effect_id collate "C", c.ordinal, c.id collate "C")
          from openerp.vat_control_reclassification_contributions c where c.book_id = ${bookId}),
          '[]'::jsonb) as contributions,
        coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'digest', a.body->>'digest')
          order by a.id collate "C") from openerp.vat_draft_amendments a
          where a.book_id = ${bookId}), '[]'::jsonb) as amendments
    `,
    "objects",
  );
}

export function readTaxAccountBounds(transaction: Transaction, bookId: string) {
  return transaction.execute<TaxAccountBoundRow>(
    sql`
      select
        (select count(*)::integer from (select 1 from openerp.tax_account_statements s
          where s.book_id = ${bookId} limit 201) bounded) as "statementCount",
        (select count(*)::integer from (select 1 from openerp.tax_account_controls c
          where c.book_id = ${bookId} limit 201) bounded) as "controlCount",
        (select count(*)::integer from (select 1 from openerp.tax_account_matches m
          where m.book_id = ${bookId} limit 1001) bounded) as "matchCount",
        (select count(*)::integer from (select 1 from openerp.tax_account_unmatches u
          where u.book_id = ${bookId} limit 1001) bounded) as "unmatchCount",
        (select count(*)::integer from (select 1
          from openerp.tax_account_classification_resolutions r
          where r.book_id = ${bookId} limit 1001) bounded) as "classificationCount"
    `,
    "objects",
  );
}

export function readTaxAccountStatements(transaction: Transaction, bookId: string) {
  return transaction.execute<TaxAccountStatementRow>(
    sql`
      select s.id, s.body->>'digest' as digest
      from openerp.tax_account_statements s where s.book_id = ${bookId}
      order by s.id collate "C"
    `,
    "objects",
  );
}

export function readTaxAccountControls(transaction: Transaction, bookId: string) {
  return transaction.execute<TaxAccountControlRow>(
    sql`
      select c.id, c.body->>'digest' as digest, c.sha256, c.byte_length as "byteLength"
      from openerp.tax_account_controls c where c.book_id = ${bookId}
      order by c.id collate "C"
    `,
    "objects",
  );
}

export function readTaxAccountMatches(transaction: Transaction, bookId: string) {
  return transaction.execute<TaxAccountMatchRow>(
    sql`
      select m.id, m.body->>'digest' as digest
      from openerp.tax_account_matches m where m.book_id = ${bookId}
      order by m.id collate "C"
    `,
    "objects",
  );
}

export function readTaxAccountUnmatches(transaction: Transaction, bookId: string) {
  return transaction.execute<TaxAccountUnmatchRow>(
    sql`
      select u.id, u.match_id as "matchId", u.body->>'digest' as digest
      from openerp.tax_account_unmatches u where u.book_id = ${bookId}
      order by u.id collate "C"
    `,
    "objects",
  );
}

export function readTaxAccountActiveState(transaction: Transaction, bookId: string) {
  return transaction.execute<TaxAccountActiveRow>(
    sql`
      select m.id, (capacity.match_id is not null) as active,
        (capacity.match_id is not null and a.active
          and a.version::text = m.body->'basis'->>'accountVersion'
          and b.profile = 'synthetic-core-v1' and b.authority = 'native'
          and b.profile_version::text = m.body->'basis'->>'profileVersion'
          and b.writer_epoch::text = m.body->'basis'->>'writerEpoch'
          and b.currency = m.body->'basis'->>'currency'
          and to_jsonb(b.currency_scale) = m.body->'basis'->'currencyScale'
          and v.sequence <= b.committed_sequence
          and v.posting_purpose <> 'reversal'
          and not exists (
            select 1 from openerp.vouchers r
            where r.book_id = ${bookId} and r.corrects_voucher_id = v.id)
          and not (
            exists (select 1 from openerp.bank_active_matches am
              where am.book_id = ${bookId} and am.voucher_id = m.voucher_id
                and am.line_id = m.line_id)
            or exists (select 1 from openerp.bank_active_allocation_legs al
              where al.book_id = ${bookId} and al.voucher_id = m.voucher_id
                and al.line_id = m.line_id)
            or exists (select 1 from openerp.owner_effects oe
              where oe.book_id = ${bookId} and oe.voucher_id = m.voucher_id
                and oe.line_id = m.line_id)
            or exists (select 1 from openerp.commerce_invoices ci
              where ci.book_id = ${bookId} and ci.recognition_voucher_id = m.voucher_id
                and ci.recognition_line_id = m.line_id)
            or exists (select 1 from openerp.commerce_active_allocation_legs cl
              where cl.book_id = ${bookId} and cl.payment_voucher_id = m.voucher_id
                and cl.payment_line_id = m.line_id)
            or exists (select 1 from openerp.vouchers cv
              where cv.book_id = ${bookId} and cv.id = m.voucher_id
                and cv.posting_purpose = 'vat_control_reclassification_v1')
            or exists (select 1
              from openerp.vat_control_reclassification_contributions cc
              where cc.book_id = ${bookId} and cc.voucher_id = m.voucher_id
                and cc.line_id = m.line_id)
            or exists (select 1 from openerp.commerce_fx_items fi
              where fi.book_id = ${bookId} and fi.voucher_id = m.voucher_id
                and fi.line_id = m.line_id)
            or exists (select 1 from openerp.commerce_fx_settlements fs
              where fs.book_id = ${bookId} and fs.voucher_id = m.voucher_id
                and m.line_id in (fs.cash_line_id, fs.control_line_id, fs.realized_line_id)))) as usable,
        coalesce((select jsonb_agg(r.id order by r.id collate "C")
          from openerp.vouchers r
          where r.book_id = ${bookId} and r.corrects_voucher_id = m.voucher_id), '[]'::jsonb)
          as corrections
      from openerp.tax_account_matches m
      join openerp.books b on b.id = m.book_id
      join openerp.vouchers v on v.book_id = m.book_id and v.id = m.voucher_id
      join openerp.accounts a on a.book_id = m.book_id and a.id = m.body->'basis'->>'accountId'
      left join openerp.tax_account_match_capacity capacity
        on capacity.book_id = m.book_id and capacity.match_id = m.id
      where m.book_id = ${bookId}
      order by m.id collate "C"
    `,
    "objects",
  );
}

export function readTaxAccountClassifications(transaction: Transaction, bookId: string) {
  return transaction.execute<TaxAccountClassificationRow>(
    sql`
      select r.id, r.body->>'digest' as digest
      from openerp.tax_account_classification_resolutions r
      join openerp.tax_account_events e
        on e.book_id = r.book_id and e.id = r.event_id
      join openerp.tax_account_statements s
        on s.book_id = e.book_id and s.id = e.statement_id
      where r.book_id = ${bookId}
      order by r.id collate "C"
    `,
    "objects",
  );
}

export function digestJson(transaction: Transaction, value: Json) {
  return transaction.execute<{ readonly digest: string }>(
    sql`select openerp.digest(${JSON.stringify(value)}::jsonb) as digest`,
    "objects",
  );
}
