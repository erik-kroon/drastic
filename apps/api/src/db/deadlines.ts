import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const deadlineReadTables = [
  "deadline_obligations",
  "deadline_revisions",
  "deadline_feeds",
  "deadline_activity_history",
  "deadline_fulfillments",
  "rule_releases",
  "rule_change_notices",
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
  "deadline_fulfillments",
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
  { tableName: "deadline_obligations", column: "jurisdiction" },
  { tableName: "deadline_obligations", column: "statutory_basis" },
  { tableName: "deadline_obligations", column: "required_environment" },
  { tableName: "deadline_obligations", column: "amends_obligation_id" },
  { tableName: "deadline_obligations", column: "amendment_notice_id" },
  { tableName: "deadline_obligations", column: "amended_outcome_kind" },
  { tableName: "deadline_obligations", column: "amended_outcome_reference" },
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
  readonly requiredEnvironment: string | null;
  readonly amendsObligationId: string | null;
  readonly amendmentNoticeId: string | null;
};

export type ExistsRow = { readonly present: boolean };

// The derived current outcome advances only through a satisfied typed link. A
// pre-existing operator string stays a reported note and is never upgraded.

const derivedOutcome = sql`
  case when o.outcome_reference is not null and exists (
      select 1 from openerp.deadline_fulfillments f
      where f.book_id = o.book_id and f.obligation_id = o.id and f.verification = 'satisfied'
    ) then o.outcome_reference end
`;

const latestFulfillment = sql`
  (
    select jsonb_build_object(
      'id', f.id, 'outcomeKind', f.outcome_kind, 'referenceKind', f.reference_kind,
      'environment', f.environment, 'verification', f.verification, 'reason', f.reason,
      'recordedAt', f.recorded_at, 'recordedBy', f.recorded_by)
    from openerp.deadline_fulfillments f
    where f.book_id = o.book_id and f.obligation_id = o.id
    order by f.recorded_at desc, f.id desc
    limit 1
  )
`;

const projection = sql`
  to_jsonb(o) || jsonb_build_object(
    'current_outcome', case when ${derivedOutcome} is not null then jsonb_build_object(
      'kind', o.outcome_kind, 'reference', o.outcome_reference, 'recordedAt', o.outcome_at)
    end,
    'fulfillment', ${latestFulfillment},
    'reported_reference', case when ${derivedOutcome} is null and o.outcome_reference is not null
      then o.outcome_reference end,
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
        when ${derivedOutcome} is not null then o.outcome_kind
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
        outcome_kind as "outcomeKind", required_environment as "requiredEnvironment",
        amends_obligation_id as "amendsObligationId", amendment_notice_id as "amendmentNoticeId"
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

export type BasisRow = {
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
  readonly jurisdiction: string;
  readonly statutoryBasis: JsonObject;
  readonly requiredEnvironment: string;
};

export function insertObligation(transaction: Transaction, row: BasisRow) {
  return transaction.execute(
    sql`
      insert into openerp.deadline_obligations
        (book_id, id, title, period_id, responsible_actor_id, due_at, time_zone,
          source_reference, source_revision, override_reason, outcome_kind,
          jurisdiction, statutory_basis, required_environment)
      values (${row.bookId}, ${row.id}, ${row.title}, ${row.periodId}, ${row.responsibleActorId},
        ${row.dueAt}::timestamptz, ${row.timeZone}, ${row.sourceReference}, ${row.sourceRevision},
        ${row.overrideReason}, ${row.outcomeKind}, ${row.jurisdiction}, ${row.statutoryBasis},
        ${row.requiredEnvironment})
    `,
    "objects",
  );
}

export function updateBasis(transaction: Transaction, row: BasisRow) {
  return transaction.execute(
    sql`
      update openerp.deadline_obligations
      set title = ${row.title}, period_id = ${row.periodId},
        responsible_actor_id = ${row.responsibleActorId}, due_at = ${row.dueAt}::timestamptz,
        time_zone = ${row.timeZone}, source_reference = ${row.sourceReference},
        source_revision = ${row.sourceRevision}, override_reason = ${row.overrideReason},
        outcome_kind = ${row.outcomeKind}, jurisdiction = ${row.jurisdiction},
        statutory_basis = ${row.statutoryBasis}, required_environment = ${row.requiredEnvironment},
        revision = revision + 1, updated_at = now()
      where book_id = ${row.bookId} and id = ${row.id}
    `,
    "objects",
  );
}

// The supersession relation is set once. A later edit cannot silently repoint an
// amendment obligation at a different original.
export function setAmendment(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly amendsObligationId: string;
    readonly amendmentNoticeId: string;
    readonly amendedOutcomeKind: string | null;
    readonly amendedOutcomeReference: string | null;
  },
) {
  return transaction.execute(
    sql`
      update openerp.deadline_obligations
      set amends_obligation_id = ${row.amendsObligationId},
        amendment_notice_id = ${row.amendmentNoticeId},
        amended_outcome_kind = ${row.amendedOutcomeKind},
        amended_outcome_reference = ${row.amendedOutcomeReference}
      where book_id = ${row.bookId} and id = ${row.id}
        and amends_obligation_id is null
      returning 1
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

// The derived current outcome. Only a satisfied typed fulfillment link reaches
// this statement, so the stored reference is a resolved identity, never an
// operator-typed claim.
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
