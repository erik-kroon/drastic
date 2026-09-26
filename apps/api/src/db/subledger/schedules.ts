import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type TableAccessRow = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type RevisionRow = {
  readonly revision: number;
  readonly body: JsonObject;
};

export type ScheduleRow = {
  readonly id: string;
  readonly sourceKey: string;
  readonly revision: number;
  readonly body: JsonObject;
};

export type PreparationRow = {
  readonly attempt: number;
  readonly changeSetId: string;
  readonly plan: JsonObject;
  readonly planDigest: string | null;
};

export type OccurrenceStateRow = {
  readonly ordinal: number;
  readonly changeSetId: string | null;
  readonly planDigest: string | null;
  readonly voucherChangeSetId: string | null;
  readonly voucherId: string | null;
  readonly reversalVoucherId: string | null;
  readonly linked: boolean;
};

export type BasisRow = {
  readonly voucherId: string;
  readonly body: JsonObject;
};

export type BasisLineRow = {
  readonly voucherId: string;
  readonly lineId: string;
};

export type TaxMatchRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly matchId: string;
  readonly eventId: string;
  readonly matchDigest: string;
};

export type TaxMatchCapacityRow = { readonly matchId: string };

export type DisposalRow = { readonly body: JsonObject };

export type ImpairmentRow = {
  readonly ordinal: number;
  readonly impairmentMinor: string;
  readonly body: JsonObject;
};

export type CorrectionRow = { readonly originalVoucherId: string };

export type ReversalRow = { readonly id: string };

export type VoucherPurposeRow = { readonly postingPurpose: string };

export const scheduleTables = [
  "subledger_schedules",
  "subledger_schedule_revisions",
  "subledger_preparations",
  "subledger_bases",
  "subledger_disposals",
  "subledger_impairments",
  "subledger_basis_lines",
] as const;

const tableAccess = sql`
  select
    requested.table_name as "tableName",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
  from unnest(array[${sql.join(
    scheduleTables.map((name) => sql`${name}`),
    sql`, `,
  )}]::text[]) as requested(table_name)
`;

export function readScheduleAccess(transaction: Transaction) {
  return transaction.execute<TableAccessRow>(tableAccess, "objects");
}

export function readScheduleBySourceKey(
  transaction: Transaction,
  bookId: string,
  sourceKey: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select s.id
      from openerp.subledger_schedules s
      where s.book_id = ${bookId} and s.source_key = ${sourceKey}
    `,
    "objects",
  );
}

export function readCurrentRevision(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<RevisionRow>(
    sql`
      select r.revision, r.body
      from openerp.subledger_schedule_revisions r
      where r.book_id = ${bookId} and r.schedule_id = ${scheduleId}
      order by r.revision desc
      limit 1
    `,
    "objects",
  );
}

export function readRevisions(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<RevisionRow>(
    sql`
      select r.revision, r.body
      from openerp.subledger_schedule_revisions r
      where r.book_id = ${bookId} and r.schedule_id = ${scheduleId}
      order by r.revision
    `,
    "objects",
  );
}

export function readSchedulePage(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<ScheduleRow>(
    sql`
      select s.id, s.source_key as "sourceKey", r.revision, r.body
      from openerp.subledger_schedules s
      join lateral (
        select y.revision, y.body
        from openerp.subledger_schedule_revisions y
        where y.book_id = s.book_id and y.schedule_id = s.id
        order by y.revision desc
        limit 1
      ) r on true
      where s.book_id = ${bookId} and s.id collate "C" > ${after} collate "C"
      order by s.id collate "C"
      limit ${limit}
    `,
    "objects",
  );
}

export function readScheduleIdsAfter(transaction: Transaction, bookId: string, after: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select s.id
      from openerp.subledger_schedules s
      where s.book_id = ${bookId} and s.id collate "C" > ${after} collate "C"
      order by s.id collate "C"
    `,
    "objects",
  );
}

export function insertSchedule(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly sourceKey: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.subledger_schedules (book_id, id, source_key)
      values (${row.bookId}, ${row.id}, ${row.sourceKey})
    `,
    "objects",
  );
}

export function insertRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly scheduleId: string;
    readonly revision: number;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.subledger_schedule_revisions (book_id, schedule_id, revision, evidence_id, body)
      values (${row.bookId}, ${row.scheduleId}, ${row.revision}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function countPreparations(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::int as total
      from openerp.subledger_preparations p
      where p.book_id = ${bookId} and p.schedule_id = ${scheduleId}
    `,
    "objects",
  );
}

export function readPeriods(
  transaction: Transaction,
  bookId: string,
  periodIds: ReadonlyArray<string>,
) {
  if (periodIds.length === 0) return Effect.succeed([]);
  return transaction.execute<{
    readonly id: string;
    readonly fiscalYearId: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly locked: boolean;
  }>(
    sql`
      select p.id, p.fiscal_year_id as "fiscalYearId", p.starts_on::text as "startsOn",
        p.ends_on::text as "endsOn", p.locked
      from openerp.periods p
      where p.book_id = ${bookId} and p.id in ${periodIds}
      order by p.id
    `,
    "objects",
  );
}

export function readLatestPreparation(
  transaction: Transaction,
  bookId: string,
  scheduleId: string,
  ordinal: number,
) {
  return transaction.execute<PreparationRow>(
    sql`
      select p.attempt, p.change_set_id as "changeSetId", c.plan, c.digest as "planDigest"
      from openerp.subledger_preparations p
      join openerp.change_sets c on c.book_id = p.book_id and c.id = p.change_set_id
      where p.book_id = ${bookId} and p.schedule_id = ${scheduleId} and p.ordinal = ${ordinal}
      order by p.attempt desc
      limit 1
    `,
    "objects",
  );
}

export function insertPreparation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly scheduleId: string;
    readonly revision: number;
    readonly ordinal: number;
    readonly attempt: number;
    readonly changeSetId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.subledger_preparations
        (book_id, schedule_id, revision, ordinal, attempt, change_set_id)
      values (${row.bookId}, ${row.scheduleId}, ${row.revision}, ${row.ordinal}, ${row.attempt}, ${row.changeSetId})
    `,
    "objects",
  );
}

export function readOccurrenceStates(
  transaction: Transaction,
  bookId: string,
  scheduleId: string,
  evidenceId: string,
  occurrences: ReadonlyArray<JsonObject>,
  through: string,
) {
  return transaction.execute<OccurrenceStateRow>(
    sql`
      with occurrence as (
        select
          (value->>'ordinal')::integer as ordinal,
          value->>'eventKey' as event_key,
          (value->>'postingDate')::date as posting_date
        from jsonb_array_elements(${JSON.stringify(occurrences)}::jsonb) value
      )
      select
        o.ordinal as ordinal,
        prep.change_set_id as "changeSetId",
        c.digest as "planDigest",
        v.change_set_id as "voucherChangeSetId",
        v.id as "voucherId",
        rv.id as "reversalVoucherId",
        exists (
          select 1 from openerp.subledger_preparations linked
          where linked.book_id = ${bookId} and linked.schedule_id = ${scheduleId}
            and linked.ordinal = o.ordinal and linked.change_set_id = v.change_set_id
        ) as linked
      from occurrence o
      left join lateral (
        select p.change_set_id
        from openerp.subledger_preparations p
        where p.book_id = ${bookId} and p.schedule_id = ${scheduleId} and p.ordinal = o.ordinal
        order by p.attempt desc
        limit 1
      ) prep on true
      left join openerp.change_sets c on c.book_id = ${bookId} and c.id = prep.change_set_id
      left join openerp.events e
        on e.book_id = ${bookId} and e.evidence_id = ${evidenceId} and e.event_key = o.event_key
      left join openerp.vouchers v
        on v.book_id = ${bookId} and v.event_id = e.id and v.posting_purpose = 'adjustment'
        and v.occurrence_key = 'manual_journal' and v.posting_date <= ${through}::date
      left join openerp.vouchers rv
        on rv.book_id = ${bookId} and rv.corrects_voucher_id = v.id and rv.posting_date <= ${through}::date
      where o.posting_date <= ${through}::date
      order by o.ordinal
    `,
    "objects",
  );
}

export function readBasis(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<BasisRow>(
    sql`
      select b.voucher_id as "voucherId", b.body
      from openerp.subledger_bases b
      where b.book_id = ${bookId} and b.schedule_id = ${scheduleId}
    `,
    "objects",
  );
}

export function readDisposal(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<DisposalRow>(
    sql`
      select d.body
      from openerp.subledger_disposals d
      where d.book_id = ${bookId} and d.schedule_id = ${scheduleId}
    `,
    "objects",
  );
}

export function readImpairments(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<ImpairmentRow>(
    sql`
      select e.ordinal, e.impairment_minor as "impairmentMinor", e.body
      from openerp.subledger_impairments e
      where e.book_id = ${bookId} and e.schedule_id = ${scheduleId}
      order by e.ordinal
    `,
    "objects",
  );
}

export function readBasisLineCount(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::int as total
      from (select 1 from openerp.subledger_basis_lines l
        where l.book_id = ${bookId} and l.schedule_id = ${scheduleId} limit 21) bounded
    `,
    "objects",
  );
}

export function readBasisTaxMatches(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<TaxMatchRow>(
    sql`
      select l.voucher_id as "voucherId", l.line_id as "lineId", m.id as "matchId",
        m.event_id as "eventId", m.body->>'digest' as "matchDigest"
      from openerp.subledger_basis_lines l
      join openerp.tax_account_match_capacity c
        on c.book_id = l.book_id and c.voucher_id = l.voucher_id and c.line_id = l.line_id
      join openerp.tax_account_matches m
        on m.book_id = c.book_id and m.id = c.match_id and m.event_id = c.event_id
        and m.voucher_id = c.voucher_id and m.line_id = c.line_id
      where l.book_id = ${bookId} and l.schedule_id = ${scheduleId}
      order by l.voucher_id collate "C", l.line_id collate "C", m.id collate "C"
    `,
    "objects",
  );
}

export function readReversalForVoucher(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction.execute<ReversalRow>(
    sql`
      select v.id
      from openerp.vouchers v
      where v.book_id = ${bookId} and v.corrects_voucher_id = ${voucherId}
      order by v.id
      limit 1
    `,
    "objects",
  );
}

export function readVoucherPurpose(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<VoucherPurposeRow>(
    sql`
      select v.posting_purpose as "postingPurpose"
      from openerp.vouchers v
      where v.book_id = ${bookId} and v.id = ${voucherId}
    `,
    "objects",
  );
}

export function readCorrectionForVoucher(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction.execute<CorrectionRow>(
    sql`
      select c.original_voucher_id as "originalVoucherId"
      from openerp.correction_bundles c
      where c.book_id = ${bookId} and c.original_voucher_id = ${voucherId}
    `,
    "objects",
  );
}

export function readEventIdsForKeys(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
  eventKeys: ReadonlyArray<string>,
) {
  if (eventKeys.length === 0)
    return transaction.execute<{ readonly id: string }>(
      sql`select ''::text as id where false`,
      "objects",
    );
  return transaction.execute<{ readonly id: string }>(
    sql`
      select e.id
      from openerp.events e
      where e.book_id = ${bookId} and e.evidence_id = ${evidenceId}
        and e.event_key in ${eventKeys}
    `,
    "objects",
  );
}

export function readPostedOccurrenceVouchers(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
  eventKey: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select v.id
      from openerp.events e
      join openerp.vouchers v on v.book_id = e.book_id and v.event_id = e.id
      where e.book_id = ${bookId} and e.evidence_id = ${evidenceId} and e.event_key = ${eventKey}
        and v.posting_purpose = 'adjustment' and v.occurrence_key = 'manual_journal'
    `,
    "objects",
  );
}

export type ScheduleInventoryRow = { readonly id: string };

export type BookBasisRow = {
  readonly scheduleId: string;
  readonly voucherId: string;
  readonly body: JsonObject;
};

export type BookDisposalRow = {
  readonly scheduleId: string;
  readonly reviewId: string;
  readonly postingDate: string;
  readonly postingReceiptId: string;
  readonly body: JsonObject;
};

export type BookImpairmentRow = {
  readonly scheduleId: string;
  readonly ordinal: number;
  readonly postingDate: string;
  readonly impairmentMinor: string;
  readonly accumulatedImpairmentAccountId: string;
  readonly postingReceiptId: string;
  readonly body: JsonObject;
};

export type BookPreparationRow = {
  readonly scheduleId: string;
  readonly ordinal: number;
  readonly attempt: number;
  readonly changeSetId: string;
};

export type LedgerContributionRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly ordinal: number;
  readonly sequence: string;
  readonly postingDate: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
  readonly correctsVoucherId: string | null;
  readonly evidenceRefs: JsonObject;
};

export type ControlSnapshotRow = {
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export type BoundaryRow = { readonly total: number };

export function readScheduleInventory(transaction: Transaction, bookId: string) {
  return transaction.execute<ScheduleInventoryRow>(
    sql`
      select s.id
      from openerp.subledger_schedules s
      where s.book_id = ${bookId}
      order by s.id collate "C"
    `,
    "objects",
  );
}

export function readRevisionAt(
  transaction: Transaction,
  bookId: string,
  scheduleId: string,
  asOfDate: string,
) {
  return transaction.execute<RevisionRow>(
    sql`
      with candidates as (
        select r.revision
        from openerp.subledger_schedule_revisions r
        where r.book_id = ${bookId} and r.schedule_id = ${scheduleId}
          and (r.body->>'createdAt')::date <= ${asOfDate}::date
        union
        select i.schedule_revision
        from openerp.subledger_impairments i
        where i.book_id = ${bookId} and i.schedule_id = ${scheduleId}
          and i.posting_date <= ${asOfDate}::date
        union
        select r.revision
        from openerp.subledger_disposals d
        join openerp.subledger_schedule_revisions r
          on r.book_id = d.book_id and r.schedule_id = d.schedule_id
          and r.body->>'digest' = d.body->>'scheduleDigest'
        where d.book_id = ${bookId} and d.schedule_id = ${scheduleId}
          and d.posting_date <= ${asOfDate}::date
      )
      select r.revision, r.body
      from openerp.subledger_schedule_revisions r
      where r.book_id = ${bookId} and r.schedule_id = ${scheduleId}
        and r.revision = (select max(revision) from candidates)
    `,
    "objects",
  );
}

export function listBookBases(transaction: Transaction, bookId: string) {
  return transaction.execute<BookBasisRow>(
    sql`
      select b.schedule_id as "scheduleId", b.voucher_id as "voucherId", b.body
      from openerp.subledger_bases b
      where b.book_id = ${bookId}
      order by b.schedule_id collate "C"
    `,
    "objects",
  );
}

export function listBookDisposals(transaction: Transaction, bookId: string) {
  return transaction.execute<BookDisposalRow>(
    sql`
      select d.schedule_id as "scheduleId", d.review_id as "reviewId",
        d.posting_date::text as "postingDate", d.posting_receipt_id as "postingReceiptId", d.body
      from openerp.subledger_disposals d
      where d.book_id = ${bookId}
      order by d.schedule_id collate "C"
    `,
    "objects",
  );
}

export function listBookImpairments(transaction: Transaction, bookId: string) {
  return transaction.execute<BookImpairmentRow>(
    sql`
      select i.schedule_id as "scheduleId", i.ordinal, i.posting_date::text as "postingDate",
        i.impairment_minor::text as "impairmentMinor",
        i.accumulated_impairment_account_id as "accumulatedImpairmentAccountId",
        i.posting_receipt_id as "postingReceiptId", i.body
      from openerp.subledger_impairments i
      where i.book_id = ${bookId}
      order by i.schedule_id collate "C", i.ordinal
    `,
    "objects",
  );
}

export function listBookPreparations(transaction: Transaction, bookId: string) {
  return transaction.execute<BookPreparationRow>(
    sql`
      select p.schedule_id as "scheduleId", p.ordinal, p.attempt, p.change_set_id as "changeSetId"
      from openerp.subledger_preparations p
      where p.book_id = ${bookId}
      order by p.schedule_id collate "C", p.ordinal, p.attempt
    `,
    "objects",
  );
}

export function countPreparationReviews(transaction: Transaction, bookId: string) {
  return transaction.execute<BoundaryRow>(
    sql`
      select count(*)::int as total
      from (select 1 from openerp.subledger_impairment_reviews r
        where r.book_id = ${bookId} limit 4001) bounded
    `,
    "objects",
  );
}

export function readDisposalReviewBody(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select r.body
      from openerp.subledger_disposal_reviews r
      where r.book_id = ${bookId} and r.id = ${reviewId}
    `,
    "objects",
  );
}

export function readReceiptVoucher(transaction: Transaction, bookId: string, receiptId: string) {
  return transaction.execute<{ readonly voucherId: string }>(
    sql`
      select e.voucher_id as "voucherId"
      from openerp.execution_receipts e
      where e.book_id = ${bookId} and e.id = ${receiptId}
    `,
    "objects",
  );
}

export function readLedgerContributions(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
  asOfDate: string,
  sequence: string,
  limit: number,
) {
  if (accountIds.length === 0) return Effect.succeed([]);
  return transaction.execute<LedgerContributionRow>(
    sql`
      select v.id as "voucherId", l.id as "lineId", l.ordinal, v.sequence::text as sequence,
        v.posting_date::text as "postingDate", l.account_id as "accountId",
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        l.description, v.corrects_voucher_id as "correctsVoucherId",
        coalesce(v.action->'evidenceRefs', '[]'::jsonb) as "evidenceRefs"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and l.account_id in ${accountIds}
        and v.posting_date <= ${asOfDate}::date and v.sequence <= ${sequence}::bigint
      order by v.sequence, l.ordinal
      limit ${limit}
    `,
    "objects",
  );
}

export function countControlSnapshots(transaction: Transaction, bookId: string) {
  return transaction.execute<BoundaryRow>(
    sql`
      select count(*)::int as total
      from openerp.subledger_control_snapshots c
      where c.book_id = ${bookId}
    `,
    "objects",
  );
}

export function insertControlSnapshot(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly body: JsonObject;
    readonly content: string;
    readonly sha256: string;
    readonly byteLength: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.subledger_control_snapshots (book_id, id, body, content, sha256, byte_length)
      values (${row.bookId}, ${row.id}, ${JSON.stringify(row.body)}::jsonb, ${row.content}, ${row.sha256}, ${row.byteLength})
    `,
    "objects",
  );
}

export function readControlSnapshot(transaction: Transaction, bookId: string, controlId: string) {
  return transaction.execute<ControlSnapshotRow>(
    sql`
      select c.body, c.content, c.sha256, c.byte_length as "byteLength"
      from openerp.subledger_control_snapshots c
      where c.book_id = ${bookId} and c.id = ${controlId}
    `,
    "objects",
  );
}

export function readReversalBefore(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  asOfDate: string,
  sequence: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select rv.id
      from openerp.vouchers rv
      where rv.book_id = ${bookId} and rv.corrects_voucher_id = ${voucherId}
        and rv.posting_date <= ${asOfDate}::date and rv.sequence <= ${sequence}::bigint
    `,
    "objects",
  );
}
