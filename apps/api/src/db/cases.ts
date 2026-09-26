import { textArray } from "./sql-values";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const caseTables = [
  "case_context_snapshots",
  "case_context_items",
  "case_context_plans",
  "events",
  "evidence",
  "change_sets",
  "vouchers",
  "journal_lines",
  "execution_receipts",
  "command_receipts",
  "correction_bundles",
  "books",
  "memberships",
] as const;

export type CaseFactRow = {
  readonly id: string;
  readonly eventKey: string;
  readonly evidenceId: string;
  readonly evidenceSha256: string;
  readonly evidenceTitle: string;
  readonly evidenceMediaType: string;
  readonly evidenceOrigin: string;
  readonly planCount: string;
  readonly latestPlanId: string | null;
  readonly voucherCount: string;
  readonly state: string;
  readonly postedDebitMinor: string;
  readonly postedCreditMinor: string;
  readonly vouchers: JsonObject;
};

export type CaseCountRow = { readonly selected: string; readonly plans: string };

export type BookProfileRow = { readonly profile: string; readonly authority: string };

export type MembershipRow = { readonly role: string };

export type BodyRow = { readonly body: JsonObject };

export type PlanBodyRow = { readonly body: JsonObject; readonly ordinal: string };

export type ItemRow = { readonly body: JsonObject; readonly ordinal: string };

export type PlanRefRow = {
  readonly eventId: string;
  readonly ordinal: string;
  readonly changeSetId: string;
  readonly planDigest: string;
  readonly createdAt: string;
  readonly state: string;
  readonly postingPurpose: string;
  readonly postingDate: string | null;
  readonly accountingPeriodId: string | null;
  readonly fiscalYearId: string | null;
  readonly currency: string | null;
  readonly lineCount: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly voucherId: string | null;
};

export type BundleRow = {
  readonly changeSetId: string;
  readonly bundleId: string;
  readonly digest: string;
  readonly role: string;
  readonly uri: string;
  readonly consistent: boolean;
};

export type EvidenceRow = {
  readonly sourceLength: string;
  readonly excerpt: string | null;
};

// Only manual-journal proposal events are business cases. Imported bank
// observations are deliberately not selected.
function selectedCte(bookId: string, caseId: string | null) {
  return sql`
    selected as (
      select e.id, e.event_key, e.evidence_id
      from openerp.events e
      where e.book_id = ${bookId}
        and (${caseId}::text is null or e.id = ${caseId})
        and exists (
          select 1 from openerp.change_sets p
          where p.book_id = e.book_id
            and p.plan #>> '{groups,0,actions,0,eventId}' = e.id
            and p.plan #>> '{groups,0,actions,0,postingPurpose}' = 'adjustment'
            and p.plan #>> '{groups,0,actions,0,occurrenceKey}' = 'manual_journal')
    )
  `;
}

export function readCaseCapture(
  transaction: Transaction,
  bookId: string,
  caseId: string | null,
  baseUri: string,
) {
  return transaction.execute<CaseFactRow>(
    sql`
      with ${selectedCte(bookId, caseId)},
      plan_stats as (
        select p.plan #>> '{groups,0,actions,0,eventId}' as event_id, count(*) as plan_count,
          (array_agg(p.id order by p.created_at desc, p.id desc))[1] as latest_plan_id
        from openerp.change_sets p
        join selected s on s.id = p.plan #>> '{groups,0,actions,0,eventId}'
        where p.book_id = ${bookId}
        group by 1
      ), voucher_stats as (
        select v.event_id, count(*) as voucher_count,
          coalesce(bool_or(v.posting_purpose = 'reversal'), false) as has_reversal
        from openerp.vouchers v
        join selected s on s.id = v.event_id
        where v.book_id = ${bookId}
        group by 1
      ), amounts as (
        select v.event_id, coalesce(sum(l.debit_minor), 0) as debit,
          coalesce(sum(l.credit_minor), 0) as credit
        from openerp.journal_lines l
        join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
        join selected s on s.id = v.event_id
        where v.book_id = ${bookId}
        group by 1
      )
      select s.id, s.event_key as "eventKey", s.evidence_id as "evidenceId",
        src.sha256 as "evidenceSha256", src.title as "evidenceTitle",
        src.media_type as "evidenceMediaType", src.origin as "evidenceOrigin",
        ps.plan_count::text as "planCount", ps.latest_plan_id as "latestPlanId",
        coalesce(vs.voucher_count, 0)::text as "voucherCount",
        case when coalesce(vs.has_reversal, false) then 'reversed'
          when coalesce(vs.voucher_count, 0) > 0 then 'posted' else 'proposed' end as state,
        coalesce(am.debit, 0)::text as "postedDebitMinor",
        coalesce(am.credit, 0)::text as "postedCreditMinor",
        (select coalesce(jsonb_agg(jsonb_build_object(
            'voucherId', v.id, 'sequence', v.sequence::text, 'number', v.number::text,
            'postingPurpose', v.posting_purpose,
            'uri', ${baseUri} || '/vouchers/' || v.id,
            'receipt', r.body,
            'receiptUri', ${baseUri} || '/receipts/' || c.key)
            order by v.sequence), '[]'::jsonb)
          from openerp.vouchers v
          join openerp.execution_receipts r
            on r.book_id = v.book_id and r.voucher_id = v.id
          join openerp.command_receipts c
            on c.book_id = r.book_id and c.operation = 'execute_change'
              and c.result->>'id' = r.id
          where v.book_id = ${bookId} and v.event_id = s.id) as vouchers
      from selected s
      join openerp.evidence src on src.book_id = ${bookId} and src.id = s.evidence_id
      left join plan_stats ps on ps.event_id = s.id
      left join voucher_stats vs on vs.event_id = s.id
      left join amounts am on am.event_id = s.id
      order by s.id
    `,
    "objects",
  );
}

export function countCaseCapture(transaction: Transaction, bookId: string, caseId: string | null) {
  return transaction.execute<CaseCountRow>(
    sql`
      with ${selectedCte(bookId, caseId)}
      select (select count(*)::bigint from selected)::text as selected,
        (select count(*)::bigint from openerp.change_sets p
          join selected s on s.id = p.plan #>> '{groups,0,actions,0,eventId}'
          where p.book_id = ${bookId})::text as plans
    `,
    "objects",
  );
}

// The retained case_context_plans key is (book, snapshot, event), so one
// proposal reference is stored per captured case: the earliest plan for that
// event. The full proposal count stays on the case summary.
export function readCasePlanRefs(transaction: Transaction, bookId: string, caseId: string | null) {
  return transaction.execute<PlanRefRow>(
    sql`
      with ${selectedCte(bookId, caseId)}
      select distinct on (p.plan #>> '{groups,0,actions,0,eventId}')
        p.plan #>> '{groups,0,actions,0,eventId}' as "eventId",
        1::text as ordinal,
        p.id as "changeSetId", p.digest as "planDigest",
        to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        case when v.id is null then 'proposed' else 'posted' end as state,
        p.plan #>> '{groups,0,actions,0,postingPurpose}' as "postingPurpose",
        p.plan #>> '{groups,0,actions,0,postingDate}' as "postingDate",
        p.plan #>> '{groups,0,actions,0,accountingPeriodId}' as "accountingPeriodId",
        p.plan #>> '{groups,0,actions,0,fiscalYearId}' as "fiscalYearId",
        p.plan #>> '{groups,0,actions,0,currency}' as currency,
        (select count(*)::text from jsonb_array_elements(p.plan #> '{groups,0,actions,0,lines}')) as "lineCount",
        (select coalesce(sum((line->>'debitMinor')::numeric), 0)::text
          from jsonb_array_elements(p.plan #> '{groups,0,actions,0,lines}') line) as "debitMinor",
        (select coalesce(sum((line->>'creditMinor')::numeric), 0)::text
          from jsonb_array_elements(p.plan #> '{groups,0,actions,0,lines}') line) as "creditMinor",
        v.id as "voucherId"
      from openerp.change_sets p
      join selected s on s.id = p.plan #>> '{groups,0,actions,0,eventId}'
      left join openerp.vouchers v on v.book_id = p.book_id and v.change_set_id = p.id
      where p.book_id = ${bookId}
      order by p.plan #>> '{groups,0,actions,0,eventId}', p.created_at, p.id
    `,
    "objects",
  );
}

export function readPlanBundles(
  transaction: Transaction,
  bookId: string,
  changeSetIds: string[],
  baseUri: string,
) {
  if (changeSetIds.length === 0) {
    return transaction.execute<BundleRow>(sql`select ''::text where false`, "objects");
  }
  return transaction.execute<BundleRow>(
    sql`
      select p.id as "changeSetId", b.id as "bundleId", b.digest,
        case when b.reversal_change_set_id = p.id then 'reversal' else 'replacement' end as role,
        ${baseUri} || '/correction-bundles/' || b.id as uri,
        (
          jsonb_typeof(b.body) = 'object'
          and b.body->>'id' = b.id
          and b.body->'scope'->>'bookId' = ${bookId}
          and b.body->'scope'->>'entityId' =
            (select entity_id from openerp.books where id = ${bookId})
          and b.body->'originalVoucher'->>'id' = b.original_voucher_id
          and b.body->'reversal'->>'id' = b.reversal_change_set_id
          and b.body->'replacement'->>'id' = b.replacement_change_set_id
          and b.reversal_change_set_id <> b.replacement_change_set_id
          and b.body->>'bundleDigest' = b.digest
          and b.digest = openerp.digest(b.body - 'bundleDigest')
          and b.body->(case when b.reversal_change_set_id = p.id then 'reversal'
            else 'replacement' end) is not distinct from p.plan
          and (b.body->(case when b.reversal_change_set_id = p.id then 'reversal'
            else 'replacement' end))->>'planDigest' = p.digest
        ) as consistent
      from openerp.correction_bundles b
      join openerp.change_sets p
        on p.book_id = b.book_id
        and p.id in (b.reversal_change_set_id, b.replacement_change_set_id)
      where b.book_id = ${bookId} and p.id = any(${textArray(changeSetIds)})
    `,
    "objects",
  );
}

export function readBookProfile(transaction: Transaction, bookId: string) {
  return transaction.execute<BookProfileRow>(
    sql`select profile, authority from openerp.books where id = ${bookId}`,
    "objects",
  );
}

export function readMembershipRole(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<MembershipRow>(
    sql`select role from openerp.memberships where book_id = ${bookId} and actor_id = ${actorId}`,
    "objects",
  );
}

export function insertSnapshot(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.case_context_snapshots (book_id, id, body)
      values (${row.bookId}, ${row.id}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

function jsonArray(values: ReadonlyArray<Record<string, string | JsonObject>>) {
  return sql`${JSON.stringify(values)}::jsonb`;
}

export function insertItems(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly snapshotId: string;
    readonly eventId: string;
    readonly ordinal: string;
    readonly body: JsonObject;
  }>,
) {
  if (rows.length === 0) return Effect.void;
  return transaction.execute(
    sql`
      insert into openerp.case_context_items (book_id, snapshot_id, event_id, ordinal, body)
      select value->>'bookId', value->>'snapshotId', value->>'eventId',
        (value->>'ordinal')::bigint, value->'body'
      from jsonb_array_elements(${jsonArray(rows)})
    `,
    "objects",
  );
}

export function insertPlans(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly snapshotId: string;
    readonly eventId: string;
    readonly ordinal: string;
    readonly changeSetId: string;
    readonly body: JsonObject;
  }>,
) {
  if (rows.length === 0) return Effect.void;
  return transaction.execute(
    sql`
      insert into openerp.case_context_plans
        (book_id, snapshot_id, event_id, ordinal, change_set_id, body)
      select value->>'bookId', value->>'snapshotId', value->>'eventId',
        (value->>'ordinal')::bigint, value->>'changeSetId', value->'body'
      from jsonb_array_elements(${jsonArray(rows)})
    `,
    "objects",
  );
}

export function readSnapshot(transaction: Transaction, bookId: string, snapshotId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.case_context_snapshots
      where book_id = ${bookId} and id = ${snapshotId}
        and body #>> '{scope,entityId}' = (select entity_id from openerp.books where id = ${bookId})
    `,
    "objects",
  );
}

export function readTotals(transaction: Transaction, bookId: string, snapshotId: string) {
  return transaction.execute<{ readonly totals: JsonObject }>(
    sql`
      select body->'totals' as totals from openerp.case_context_snapshots
      where book_id = ${bookId} and id = ${snapshotId}
    `,
    "objects",
  );
}

export function listItems(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<ItemRow>(
    sql`
      select body, ordinal::text as ordinal
      from openerp.case_context_items
      where book_id = ${bookId} and snapshot_id = ${snapshotId} and ordinal > ${after}::bigint
      order by ordinal
      limit ${limit}
    `,
    "objects",
  );
}

export function readItem(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  caseId: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.case_context_items
      where book_id = ${bookId} and snapshot_id = ${snapshotId} and event_id = ${caseId}
    `,
    "objects",
  );
}

export function listPlans(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  caseId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<PlanBodyRow>(
    sql`
      select body, ordinal::text as ordinal from openerp.case_context_plans
      where book_id = ${bookId} and snapshot_id = ${snapshotId} and event_id = ${caseId}
        and ordinal > ${after}::bigint
      order by ordinal
      limit ${limit}
    `,
    "objects",
  );
}

export function readEvidenceExcerpt(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
  sha256: string,
  excerpt: boolean,
) {
  return transaction.execute<EvidenceRow>(
    sql`
      select length(content)::text as "sourceLength",
        ${excerpt ? sql`left(content, 4096)` : sql`null::text`} as excerpt
      from openerp.evidence
      where book_id = ${bookId} and id = ${evidenceId} and sha256 = ${sha256}
    `,
    "objects",
  );
}
