import { sql, type SQL } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const workspaceTables = [
  "workspace_views",
  "workspace_assignments",
  "books",
  "memberships",
  "actors",
  "periods",
  "change_sets",
  "vouchers",
  "execution_receipts",
  "invoice_drafts",
  "invoice_draft_revisions",
  "invoice_issues",
  "expense_tax_sources",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "command_receipts",
] as const;

export type ViewRow = {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly visibility: string;
  readonly filters: JsonObject;
};

export type OwnedViewRow = { readonly id: string; readonly visibility: string };

export type AssignmentRow = {
  readonly kind: string;
  readonly recordId: string;
  readonly assigneeId: string | null;
  readonly dueOn: string | null;
  readonly note: string;
  readonly revision: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
};

export type CountRow = { readonly total: number };

export type MemberRow = { readonly id: string; readonly name: string; readonly role: string };

export type PeriodRow = { readonly startsOn: string; readonly endsOn: string };

export type WorkAnchorRow = { readonly createdAt: string; readonly id: string };

export type WorkItemRow = {
  readonly id: string;
  readonly revision: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly postingDate: string | null;
  readonly periodId: string | null;
  readonly amountMinor: string;
  readonly currency: string | null;
  readonly postingStatus: string;
  readonly receiptId: string | null;
};

export type WorkCountsRow = {
  readonly total: string;
  readonly open: string;
  readonly completed: string;
};

export type AttentionItemRow = {
  readonly key: string;
  readonly kind: string;
  readonly id: string;
  readonly revision: string;
  readonly title: string | null;
  readonly date: string | null;
  readonly updatedAt: string;
  readonly amountMinor: string | null;
  readonly currency: string | null;
  readonly currencyScale: number | null;
  readonly state: string;
  readonly reason: string;
  readonly assignmentKind: string | null;
  readonly assignmentRecordId: string | null;
  readonly assignmentAssigneeId: string | null;
  readonly assignmentDueOn: string | null;
  readonly assignmentNote: string | null;
  readonly assignmentRevision: string | null;
  readonly assignmentUpdatedAt: string | null;
  readonly assignmentUpdatedBy: string | null;
};

export type AttentionCountsRow = {
  readonly total: string;
  readonly open: string;
  readonly completed: string;
};

// The retained posting-recovery status of one standalone proposal, expressed
// without the retired provider function. A proposal posts itself, or through a
// retained economic-identity or reversal link to another proposal.
const observedProposals = (bookId: string) => sql`
  select source.*, source.plan #> '{groups,0,actions,0}' as action,
    to_char(source.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_text,
    (select r.id
       from openerp.vouchers v
       join openerp.execution_receipts r
         on r.book_id = v.book_id and r.voucher_id = v.id
      where v.book_id = ${bookId}
        and (
          v.change_set_id = source.id
          or (v.event_id = source.plan #>> '{groups,0,actions,0,eventId}'
            and v.posting_purpose = source.plan #>> '{groups,0,actions,0,postingPurpose}'
            and v.occurrence_key = source.plan #>> '{groups,0,actions,0,occurrenceKey}')
          or (source.plan #>> '{groups,0,actions,0,postingPurpose}' = 'reversal'
            and v.corrects_voucher_id = source.plan #>> '{groups,0,actions,0,correctsVoucherId}')
        )
      order by (v.change_set_id = source.id) desc, v.sequence limit 1) as receipt_id,
    (select r.change_set_id
       from openerp.vouchers v
       join openerp.execution_receipts r
         on r.book_id = v.book_id and r.voucher_id = v.id
      where v.book_id = ${bookId}
        and (
          v.change_set_id = source.id
          or (v.event_id = source.plan #>> '{groups,0,actions,0,eventId}'
            and v.posting_purpose = source.plan #>> '{groups,0,actions,0,postingPurpose}'
            and v.occurrence_key = source.plan #>> '{groups,0,actions,0,occurrenceKey}')
          or (source.plan #>> '{groups,0,actions,0,postingPurpose}' = 'reversal'
            and v.corrects_voucher_id = source.plan #>> '{groups,0,actions,0,correctsVoucherId}')
        )
      order by (v.change_set_id = source.id) desc, v.sequence limit 1) as receipt_change_set_id
  from openerp.change_sets source
  where source.book_id = ${bookId}
    and not exists (
      select 1 from openerp.correction_bundles bundle
      where bundle.book_id = source.book_id
        and source.id in (bundle.reversal_change_set_id, bundle.replacement_change_set_id)
    )
`;

function workCte(bookId: string, period: string | null, search: string) {
  return sql`
    observed as materialized (
      select source.*,
        case when source.receipt_id is null then 'unposted_at_check'
          when source.receipt_change_set_id = source.id then 'posted'
          else 'posted_by_other_proposal' end as posting_status
      from (${observedProposals(bookId)}) source
      where (${period}::text is null or source.action->>'accountingPeriodId' = ${period})
        and (${search} = ''
          or strpos(lower(source.action->>'description'), lower(${search})) > 0
          or strpos(lower(source.id), lower(${search})) > 0)
    )
  `;
}

function workFilter(status: string) {
  return sql`
    filtered as materialized (
      select * from observed
      where ${status} = 'all'
        or (${status} = 'open' and posting_status = 'unposted_at_check')
        or (${status} = 'completed' and posting_status <> 'unposted_at_check')
    )
  `;
}

function workOrder(sort: string) {
  return sql`
    order by case when ${sort} = 'newest' then created_text end desc,
      case when ${sort} = 'newest' then id end collate "C" desc,
      case when ${sort} = 'oldest' then created_text end,
      case when ${sort} = 'oldest' then id end collate "C"
  `;
}

function workCursor(
  sort: string,
  anchor: { readonly createdAt: string; readonly id: string } | null,
) {
  if (anchor === null) return sql`true`;

  return sql`
    (${sort} = 'newest'
        and (created_text, id collate "C") < (${anchor.createdAt}, ${anchor.id} collate "C"))
    or (${sort} = 'oldest'
        and (created_text, id collate "C") > (${anchor.createdAt}, ${anchor.id} collate "C"))
  `;
}

export type WorkFilters = {
  readonly period: string | null;
  readonly status: string;
  readonly sort: string;
  readonly search: string;
  readonly anchor: { readonly createdAt: string; readonly id: string } | null;
};

export function listWorkItems(transaction: Transaction, bookId: string, filters: WorkFilters) {
  return transaction.execute<WorkItemRow>(
    sql`
      with ${workCte(bookId, filters.period, filters.search)}, ${workFilter(filters.status)}
      select id, digest as revision, action->>'description' as description, created_text as "createdAt",
        created_by as "createdBy", action->>'postingDate' as "postingDate",
        action->>'accountingPeriodId' as "periodId",
        (select coalesce(sum((line->>'debitMinor')::numeric), 0)::text
          from jsonb_array_elements(action->'lines') line) as "amountMinor",
        action->>'currency' as currency, posting_status as "postingStatus",
        receipt_id as "receiptId"
      from filtered
      where ${workCursor(filters.sort, filters.anchor)}
      ${workOrder(filters.sort)}
      limit 51
    `,
    "objects",
  );
}

export function countWorkItems(transaction: Transaction, bookId: string, filters: WorkFilters) {
  return transaction.execute<WorkCountsRow>(
    sql`
      with ${workCte(bookId, filters.period, filters.search)}, ${workFilter(filters.status)}
      select (select count(*)::text from filtered) as total,
        (select count(*)::text from observed where posting_status = 'unposted_at_check') as open,
        (select count(*)::text from observed where posting_status <> 'unposted_at_check') as completed
    `,
    "objects",
  );
}

export function countBookMembers(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.memberships where book_id = ${bookId}`,
    "objects",
  );
}

export function readBookMembershipRole(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<{ readonly role: string }>(
    sql`
      select role from openerp.memberships
      where book_id = ${bookId} and actor_id = ${actorId}
    `,
    "objects",
  );
}

export function listBookMembers(transaction: Transaction, bookId: string) {
  return transaction.execute<MemberRow>(
    sql`
      select a.id, a.name, m.role
      from openerp.memberships m
      join openerp.actors a on a.id = m.actor_id
      where m.book_id = ${bookId}
      order by a.name, a.id
    `,
    "objects",
  );
}

export function listVisibleViews(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<ViewRow>(
    sql`
      select id, owner_id as "ownerId", name, visibility, filters
      from openerp.workspace_views
      where book_id = ${bookId} and (owner_id = ${actorId} or visibility = 'team')
      order by name, id
    `,
    "objects",
  );
}

export function countViews(
  transaction: Transaction,
  bookId: string,
  visibility: string,
  actorId: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.workspace_views
      where book_id = ${bookId}
        and visibility = ${visibility}
        and (${visibility} = 'team' or owner_id = ${actorId})
    `,
    "objects",
  );
}

export function readOwnedView(
  transaction: Transaction,
  bookId: string,
  actorId: string,
  id: string,
) {
  return transaction.execute<OwnedViewRow>(
    sql`
      select id, visibility from openerp.workspace_views
      where book_id = ${bookId} and id = ${id} and owner_id = ${actorId}
      for update
    `,
    "objects",
  );
}

export function insertView(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ownerId: string;
    readonly name: string;
    readonly visibility: string;
    readonly filters: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.workspace_views (book_id, id, owner_id, name, visibility, filters)
      values (${row.bookId}, ${row.id}, ${row.ownerId}, ${row.name}, ${row.visibility},
        ${JSON.stringify(row.filters)}::jsonb)
    `,
    "objects",
  );
}

export function deleteView(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute(
    sql`delete from openerp.workspace_views where book_id = ${bookId} and id = ${id}`,
    "objects",
  );
}

export function readPeriod(transaction: Transaction, bookId: string, periodId: string) {
  return transaction.execute<PeriodRow>(
    sql`
      select starts_on::text as "startsOn", ends_on::text as "endsOn"
      from openerp.periods
      where book_id = ${bookId} and id = ${periodId}
    `,
    "objects",
  );
}

export function readWorkItem(
  transaction: Transaction,
  bookId: string,
  kind: string,
  recordId: string,
) {
  const exists: SQL =
    kind === "journal"
      ? sql`select 1 from openerp.change_sets c where c.book_id = ${bookId} and c.id = ${recordId}
          and not exists (
            select 1 from openerp.correction_bundles bundle
            where bundle.book_id = c.book_id
              and c.id in (bundle.reversal_change_set_id, bundle.replacement_change_set_id))`
      : kind === "invoice"
        ? sql`select 1 from openerp.invoice_drafts d where d.book_id = ${bookId} and d.id = ${recordId}`
        : sql`select 1 from openerp.expense_tax_sources s where s.book_id = ${bookId} and s.id = ${recordId}`;

  return transaction.execute<{ readonly present: boolean }>(
    sql`select exists (${exists}) as present`,
    "objects",
  );
}

export function readAssignmentRevision(
  transaction: Transaction,
  bookId: string,
  kind: string,
  recordId: string,
) {
  return transaction.execute<{ readonly revision: string }>(
    sql`
      select coalesce(max(revision), 0)::text as revision
      from openerp.workspace_assignments
      where book_id = ${bookId} and kind = ${kind} and record_id = ${recordId}
    `,
    "objects",
  );
}

export function insertAssignment(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly kind: string;
    readonly recordId: string;
    readonly revision: string;
    readonly assigneeId: string | null;
    readonly dueOn: string | null;
    readonly note: string;
    readonly updatedBy: string;
    readonly updatedAt: string;
  },
) {
  return transaction.execute<AssignmentRow>(
    sql`
      insert into openerp.workspace_assignments
        (book_id, kind, record_id, revision, assignee_id, due_on, note, updated_at, updated_by)
      values (${row.bookId}, ${row.kind}, ${row.recordId}, ${row.revision}::integer,
        ${row.assigneeId}, ${row.dueOn}::date, ${row.note}, ${row.updatedAt}, ${row.updatedBy})
      returning kind, record_id as "recordId", assignee_id as "assigneeId",
        due_on::text as "dueOn", note, revision::text as revision,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
        updated_by as "updatedBy"
    `,
    "objects",
  );
}

export function readWorkAnchor(transaction: Transaction, bookId: string, changeSetId: string) {
  return transaction.execute<WorkAnchorRow>(
    sql`
      select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", id
      from openerp.change_sets
      where book_id = ${bookId} and id = ${changeSetId}
        and not exists (
          select 1 from openerp.correction_bundles bundle
          where bundle.book_id = ${bookId}
            and id in (bundle.reversal_change_set_id, bundle.replacement_change_set_id))
    `,
    "objects",
  );
}

export type AttentionFilters = {
  readonly kind: string;
  readonly period: string | null;
  readonly status: string;
  readonly sort: string;
  readonly search: string;
  readonly after: string | null;
};

function attentionCte(bookId: string) {
  return sql`
    observed as (
      select 'journal_' || source.id as key, 'journal' as kind, source.id as id,
        source.digest as revision, source.action->>'description' as title,
        source.action->>'postingDate' as date, source.created_text as updated,
        (select coalesce(sum((line->>'debitMinor')::numeric), 0)::text
          from jsonb_array_elements(source.action->'lines') line) as amount,
        source.action->>'currency' as currency,
        (select b.currency_scale from openerp.books b where b.id = ${bookId}) as scale,
        case when (select r.id
             from openerp.vouchers v
             join openerp.execution_receipts r
               on r.book_id = v.book_id and r.voucher_id = v.id
            where v.book_id = ${bookId}
              and (
                v.change_set_id = source.id
                or (v.event_id = source.plan #>> '{groups,0,actions,0,eventId}'
                  and v.posting_purpose = source.plan #>> '{groups,0,actions,0,postingPurpose}'
                  and v.occurrence_key = source.plan #>> '{groups,0,actions,0,occurrenceKey}')
                or (source.plan #>> '{groups,0,actions,0,postingPurpose}' = 'reversal'
                  and v.corrects_voucher_id = source.plan #>> '{groups,0,actions,0,correctsVoucherId}')
              )
            order by (v.change_set_id = source.id) desc, v.sequence limit 1) is null
          then 'open' else 'completed' end as state,
        case when (select r.id
             from openerp.vouchers v
             join openerp.execution_receipts r
               on r.book_id = v.book_id and r.voucher_id = v.id
            where v.book_id = ${bookId}
              and (
                v.change_set_id = source.id
                or (v.event_id = source.plan #>> '{groups,0,actions,0,eventId}'
                  and v.posting_purpose = source.plan #>> '{groups,0,actions,0,postingPurpose}'
                  and v.occurrence_key = source.plan #>> '{groups,0,actions,0,occurrenceKey}')
                or (source.plan #>> '{groups,0,actions,0,postingPurpose}' = 'reversal'
                  and v.corrects_voucher_id = source.plan #>> '{groups,0,actions,0,correctsVoucherId}')
              )
            order by (v.change_set_id = source.id) desc, v.sequence limit 1) is null
          then 'journal_review' else 'journal_posted' end as reason
      from (${observedProposals(bookId)}) source
      union all
      select 'invoice_' || d.id, 'invoice', d.id, r.body->>'digest',
        r.body->'content'->>'title', r.body->'content'->>'plannedIssueDate', r.body->>'createdAt',
        r.body->'totals'->>'grossMinor', r.body->'content'->>'currency',
        (r.body->'content'->>'currencyScale')::integer,
        case when i.id is null then 'open' else 'completed' end,
        case when i.id is null then 'invoice_draft' else 'invoice_issued' end
      from openerp.invoice_drafts d
      join openerp.invoice_draft_revisions r
        on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
      left join openerp.invoice_issues i on i.book_id = d.book_id and i.draft_id = d.id
      where d.book_id = ${bookId}
      union all
      select 'expense_' || e.id, 'expense', e.id, e.source->>'digest',
        e.source->'facts'->>'description', e.source->'facts'->>'issuedOn', e.source->>'recordedAt',
        e.source->'facts'->'amounts'->>'grossMinor', e.source->'facts'->>'currency',
        (e.source->'facts'->>'currencyScale')::integer,
        case when e.review->>'sourceDigest' = e.source->>'digest' then 'completed' else 'open' end,
        case when e.review->>'sourceDigest' = e.source->>'digest' then 'expense_reviewed'
          else 'expense_review' end
      from (
        select s.id,
          (select r.body from openerp.expense_tax_source_revisions r
            where r.book_id = s.book_id and r.source_id = s.id
            order by r.revision desc limit 1) as source,
          (select r.body from openerp.expense_tax_reviews r
            where r.book_id = s.book_id and r.source_id = s.id
            order by r.revision desc limit 1) as review
        from openerp.expense_tax_sources s where s.book_id = ${bookId}
      ) e
    )
  `;
}

function attentionScoped(filters: AttentionFilters, starts: string | null, ends: string | null) {
  return sql`
    scoped as materialized (
      select * from observed
      where (${filters.kind} = 'all' or kind = ${filters.kind})
        and (${filters.search} = '' or strpos(lower(title), lower(${filters.search})) > 0)
        and (${starts}::text is null or (date between ${starts} and ${ends}))
    )
  `;
}

function attentionOrder(sort: string, source: "observed" | "candidates" = "observed") {
  const updated = source === "observed" ? sql`updated::timestamptz` : sql`c.updated::timestamptz`;
  const key = source === "observed" ? sql`key` : sql`c.key`;

  return sql`
    order by case when ${sort} = 'newest' then ${updated} end desc,
      case when ${sort} = 'newest' then ${key} end collate "C" desc,
      case when ${sort} = 'oldest' then ${updated} end,
      case when ${sort} = 'oldest' then ${key} end collate "C"
  `;
}

export function listAttentionItems(
  transaction: Transaction,
  bookId: string,
  filters: AttentionFilters,
  starts: string | null,
  ends: string | null,
) {
  return transaction.execute<AttentionItemRow>(
    sql`
      with ${attentionCte(bookId)}, ${attentionScoped(filters, starts, ends)},
      filtered as materialized (
        select * from scoped where ${filters.status} = 'all' or state = ${filters.status}
      ), candidates as materialized (
        select f.* from filtered f
        where ${
          filters.after === null
            ? sql`true`
            : sql`(${filters.sort} = 'newest'
                and (f.updated::timestamptz, f.key collate "C")
                  < (select updated::timestamptz, key collate "C" from scoped where key = ${filters.after}))
              or (${filters.sort} = 'oldest'
                and (f.updated::timestamptz, f.key collate "C")
                  > (select updated::timestamptz, key collate "C" from scoped where key = ${filters.after}))`
        }
        ${attentionOrder(filters.sort)}
        limit 51
      )
      select c.key, c.kind, c.id, c.revision, c.title, c.date, c.updated as "updatedAt",
        c.amount as "amountMinor", c.currency, c.scale as "currencyScale", c.state, c.reason,
        a.kind as "assignmentKind", a.record_id as "assignmentRecordId",
        a.assignee_id as "assignmentAssigneeId", a.due_on::text as "assignmentDueOn",
        a.note as "assignmentNote", a.revision::text as "assignmentRevision",
        to_char(a.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          as "assignmentUpdatedAt",
        a.updated_by as "assignmentUpdatedBy"
      from candidates c
      left join lateral (
        select latest.* from openerp.workspace_assignments latest
        where latest.book_id = ${bookId} and latest.kind = c.kind and latest.record_id = c.id
        order by latest.revision desc limit 1
      ) a on true
      ${attentionOrder(filters.sort, "candidates")}
      limit 51
    `,
    "objects",
  );
}

export function countAttentionItems(
  transaction: Transaction,
  bookId: string,
  filters: AttentionFilters,
  starts: string | null,
  ends: string | null,
) {
  return transaction.execute<AttentionCountsRow>(
    sql`
      with ${attentionCte(bookId)}, ${attentionScoped(filters, starts, ends)}
      select (select count(*)::text from scoped where ${filters.status} = 'all'
        or state = ${filters.status}) as total,
        (select count(*)::text from scoped where state = 'open') as open,
        (select count(*)::text from scoped where state = 'completed') as completed
    `,
    "objects",
  );
}

export function readAttentionAnchor(
  transaction: Transaction,
  bookId: string,
  kind: string,
  period: string | null,
  search: string,
  starts: string | null,
  ends: string | null,
  key: string,
) {
  return transaction.execute<{ readonly key: string | null }>(
    sql`
      with ${attentionCte(bookId)}, ${attentionScoped({ kind, period, status: "all", sort: "newest", search, after: null }, starts, ends)}
      select key from scoped where key = ${key}
    `,
    "objects",
  );
}
