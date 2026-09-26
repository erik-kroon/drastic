import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const deadlineReadTables = [
  "deadline_obligations",
  "deadline_revisions",
  "deadline_feeds",
  "deadline_activity_history",
  "periods",
  "memberships",
  "books",
  "command_receipts",
] as const;

export const deadlineInsertTables = [
  "deadline_obligations",
  "deadline_revisions",
  "deadline_feeds",
  "deadline_activity_history",
  "command_receipts",
] as const;

export const deadlineUpdateColumns = [
  { tableName: "deadline_obligations", column: "title" },
  { tableName: "deadline_obligations", column: "period_id" },
  { tableName: "deadline_obligations", column: "responsible_actor_id" },
  { tableName: "deadline_obligations", column: "due_at" },
  { tableName: "deadline_obligations", column: "time_zone" },
  { tableName: "deadline_obligations", column: "source_reference" },
  { tableName: "deadline_obligations", column: "source_revision" },
  { tableName: "deadline_obligations", column: "override_reason" },
  { tableName: "deadline_obligations", column: "outcome_kind" },
  { tableName: "deadline_obligations", column: "outcome_reference" },
  { tableName: "deadline_obligations", column: "outcome_at" },
  { tableName: "deadline_obligations", column: "reminder_dismissed_at" },
  { tableName: "deadline_obligations", column: "revision" },
  { tableName: "deadline_obligations", column: "updated_at" },
  { tableName: "deadline_feeds", column: "revoked_at" },
] as const;

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type ColumnAccessRow = {
  readonly tableName: string;
  readonly columnName: string;
  readonly canUpdate: boolean;
};

export type BodyRow = { readonly body: JsonObject };

export type ObligationRow = {
  readonly id: string;
  readonly revision: string;
  readonly dueAt: string;
  readonly sourceReference: string;
  readonly sourceRevision: string;
  readonly outcomeKind: string;
};

export type ExistsRow = { readonly present: boolean };

const projection = sql`
  to_jsonb(o) || jsonb_build_object(
    'current_outcome', case when o.outcome_reference is not null then jsonb_build_object(
      'kind', o.outcome_kind, 'reference', o.outcome_reference, 'recordedAt', o.outcome_at)
    end,
    'activity_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'reference', a.reference, 'outcomeKind', a.outcome_kind,
        'actorId', a.recorded_by, 'recordedAt', a.recorded_at)
        order by a.recorded_at, a.id)
      from openerp.deadline_activity_history a
      where a.book_id = o.book_id and a.obligation_id = o.id
    ), '[]'::jsonb)
  )
`;

export function readDeadlineAccess(transaction: Transaction) {
  return transaction.execute<TableAccess>(
    sql`
      select
        requested.table_name as "tableName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
        case when requested.table_name = any(array[${sql.join(
          deadlineInsertTables.map((name) => sql`${name}`),
          sql`, `,
        )}]::text[]) then false
          when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
      from unnest(array[${sql.join(
        deadlineReadTables.map((name) => sql`${name}`),
        sql`, `,
      )}]::text[]) as requested(table_name)
    `,
    "objects",
  );
}

// The runtime role is granted UPDATE per column and never at table level, and
// has_table_privilege reports false for a column grant, so the declared write
// columns are probed directly.
export function readDeadlineColumnAccess(transaction: Transaction) {
  return transaction.execute<ColumnAccessRow>(
    sql`
      select requested.table_name as "tableName", requested.column_name as "columnName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          when not exists (
            select 1 from pg_catalog.pg_attribute
            where attrelid = to_regclass('openerp.' || requested.table_name)
              and attname = requested.column_name
          ) then false
          else has_column_privilege(current_user, 'openerp.' || requested.table_name,
            requested.column_name, 'update') end as "canUpdate"
      from unnest(
        array[${sql.join(
          deadlineUpdateColumns.map((entry) => sql`${entry.tableName}`),
          sql`, `,
        )}],
        array[${sql.join(
          deadlineUpdateColumns.map((entry) => sql`${entry.column}`),
          sql`, `,
        )}]
      ) as requested(table_name, column_name)
    `,
    "objects",
  );
}

export function listObligations(transaction: Transaction, bookId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select ${projection} || jsonb_build_object('status', case
        when o.outcome_reference is not null then o.outcome_kind
        when o.due_at < now() then 'overdue' else 'upcoming' end) as body
      from openerp.deadline_obligations o
      where o.book_id = ${bookId}
      order by o.due_at, o.id
    `,
    "objects",
  );
}

export function readObligation(
  transaction: Transaction,
  bookId: string,
  id: string,
  lock: boolean,
) {
  return transaction.execute<ObligationRow>(
    sql`
      select id, revision::text as revision, due_at::text as "dueAt",
        source_reference as "sourceReference", source_revision as "sourceRevision",
        outcome_kind as "outcomeKind"
      from openerp.deadline_obligations
      where book_id = ${bookId} and id = ${id}
      ${lock ? sql`for update` : sql`for share`}
    `,
    "objects",
  );
}

export function readProjection(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<BodyRow>(
    sql`
      select ${projection} as body
      from openerp.deadline_obligations o
      where o.book_id = ${bookId} and o.id = ${id}
    `,
    "objects",
  );
}

export function sourceChanged(
  transaction: Transaction,
  bookId: string,
  id: string,
  dueAt: string,
  sourceReference: string,
  sourceRevision: string,
) {
  return transaction.execute<{ readonly changed: boolean }>(
    sql`
      select (due_at, source_reference, source_revision) is distinct from
        (${dueAt}::timestamptz, ${sourceReference}, ${sourceRevision}) as changed
      from openerp.deadline_obligations
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function insertObligation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly title: string;
    readonly periodId: string;
    readonly responsibleActorId: string;
    readonly dueAt: string;
    readonly timeZone: string;
    readonly sourceReference: string;
    readonly sourceRevision: string;
    readonly overrideReason: string | null;
    readonly outcomeKind: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.deadline_obligations
        (book_id, id, title, period_id, responsible_actor_id, due_at, time_zone,
          source_reference, source_revision, override_reason, outcome_kind)
      values (${row.bookId}, ${row.id}, ${row.title}, ${row.periodId}, ${row.responsibleActorId},
        ${row.dueAt}::timestamptz, ${row.timeZone}, ${row.sourceReference}, ${row.sourceRevision},
        ${row.overrideReason}, ${row.outcomeKind})
    `,
    "objects",
  );
}

export function insertRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly obligationId: string;
    readonly revision: string;
    readonly changedBy: string;
    readonly priorDueAt: string;
    readonly priorSourceReference: string;
    readonly priorSourceRevision: string;
    readonly reason: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.deadline_revisions
        (book_id, obligation_id, revision, changed_by, prior_due_at, prior_source_reference,
          prior_source_revision, reason)
      values (${row.bookId}, ${row.obligationId}, ${row.revision}::bigint, ${row.changedBy},
        ${row.priorDueAt}::timestamptz, ${row.priorSourceReference}, ${row.priorSourceRevision},
        ${row.reason})
    `,
    "objects",
  );
}

export function updateObligation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly title: string;
    readonly periodId: string;
    readonly responsibleActorId: string;
    readonly dueAt: string;
    readonly timeZone: string;
    readonly sourceReference: string;
    readonly sourceRevision: string;
    readonly overrideReason: string | null;
    readonly outcomeKind: string;
  },
) {
  return transaction.execute(
    sql`
      update openerp.deadline_obligations
      set title = ${row.title}, period_id = ${row.periodId},
        responsible_actor_id = ${row.responsibleActorId}, due_at = ${row.dueAt}::timestamptz,
        time_zone = ${row.timeZone}, source_reference = ${row.sourceReference},
        source_revision = ${row.sourceRevision}, override_reason = ${row.overrideReason},
        outcome_kind = ${row.outcomeKind}, revision = revision + 1, updated_at = now()
      where book_id = ${row.bookId} and id = ${row.id}
    `,
    "objects",
  );
}

export function insertActivity(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly obligationId: string;
    readonly id: string;
    readonly action: string;
    readonly reference: string | null;
    readonly outcomeKind: string | null;
    readonly recordedBy: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.deadline_activity_history
        (book_id, obligation_id, id, action, reference, outcome_kind, recorded_by, recorded_at)
      values (${row.bookId}, ${row.obligationId}, ${row.id}, ${row.action}, ${row.reference},
        ${row.outcomeKind}, ${row.recordedBy}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function dismissReminder(transaction: Transaction, bookId: string, id: string, at: string) {
  return transaction.execute(
    sql`
      update openerp.deadline_obligations set reminder_dismissed_at = ${at}::timestamptz
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function recordOutcome(
  transaction: Transaction,
  bookId: string,
  id: string,
  reference: string,
  at: string,
) {
  return transaction.execute(
    sql`
      update openerp.deadline_obligations
      set outcome_reference = ${reference}, outcome_at = ${at}::timestamptz
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function knownTimeZone(transaction: Transaction, timeZone: string) {
  return transaction.execute<ExistsRow>(
    sql`select exists (select 1 from pg_catalog.pg_timezone_names where name = ${timeZone}) as present`,
    "objects",
  );
}

export function responsibleMember(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<ExistsRow>(
    sql`
      select exists (
        select 1 from openerp.memberships where book_id = ${bookId} and actor_id = ${actorId}
      ) as present
    `,
    "objects",
  );
}

export function insertFeed(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly tokenHash: string;
    readonly createdBy: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.deadline_feeds (book_id, id, token_hash, created_by)
      values (${row.bookId}, ${row.id}, ${row.tokenHash}, ${row.createdBy})
    `,
    "objects",
  );
}

export function revokeFeed(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<{ readonly revoked: string }>(
    sql`
      update openerp.deadline_feeds set revoked_at = now()
      where book_id = ${bookId} and id = ${id} and revoked_at is null
      returning 1::text as revoked
    `,
    "objects",
  );
}
