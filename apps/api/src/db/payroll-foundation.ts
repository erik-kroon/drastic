import * as Payroll from "@open-erp/contracts/payroll-foundation";
import { and, eq, sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import { memberships } from "./schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

type RevisionKind = typeof Payroll.PayrollRevision.Type.kind;

export type PayrollGrantRow = {
  readonly tableName: string;
  readonly allowed: boolean;
};

export type PayrollAccessRow = {
  readonly bookId: string;
  readonly actorId: string;
};

export type PayrollEmployeeRow = {
  readonly id: string;
  readonly createdAt: string;
};

export type PayrollRevisionRow = {
  readonly bookId: string;
  readonly id: string;
  readonly employeeId: string;
  readonly kind: string;
  readonly effectiveOn: string;
  readonly supersedes: string | null;
  readonly evidenceId: string;
  readonly body: JsonObject;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly isCurrent: boolean;
};

export type PayrollCurrentRow = {
  readonly revisionId: string;
};

export type RevisionWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly commandKey: string;
  readonly employeeId: string;
  readonly kind: RevisionKind;
  readonly effectiveOn: string;
  readonly supersedes: string | null;
  readonly evidenceId: string;
  readonly body: JsonObject;
  readonly createdBy: string;
};

export type CurrentWrite = {
  readonly bookId: string;
  readonly employeeId: string;
  readonly kind: RevisionKind;
  readonly effectiveOn: string;
  readonly revisionId: string;
};

const readGrants = sql`
  select
    requirement.table_name as "tableName",
    coalesce(
      bool_and(has_table_privilege(current_user, 'openerp.' || requirement.table_name, requirement.privilege)),
      false
    ) as allowed
  from (values
    ('payroll_access', 'select'),
    ('payroll_employees', 'select'),
    ('payroll_revisions', 'select'),
    ('payroll_current_revisions', 'select')
  ) as requirement(table_name, privilege)
  group by requirement.table_name
`;

const writeGrants = sql`
  select
    requirement.table_name as "tableName",
    coalesce(
      bool_and(case when requirement.privilege = 'update'
        then has_column_privilege(current_user, 'openerp.' || requirement.table_name, 'revision_id', 'update')
        else has_table_privilege(current_user, 'openerp.' || requirement.table_name, requirement.privilege) end),
      false
    ) as allowed
  from (values
    ('payroll_access', 'select'),
    ('payroll_access', 'insert'),
    ('payroll_access', 'delete'),
    ('payroll_employees', 'select'),
    ('payroll_employees', 'insert'),
    ('payroll_revisions', 'select'),
    ('payroll_revisions', 'insert'),
    ('payroll_current_revisions', 'select'),
    ('payroll_current_revisions', 'insert'),
    ('payroll_current_revisions', 'update')
  ) as requirement(table_name, privilege)
  group by requirement.table_name
`;

export function readTableGrants(transaction: Transaction, write: boolean) {
  return transaction.execute<PayrollGrantRow>(write ? writeGrants : readGrants, "objects");
}

export function readPayrollAccess(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<PayrollAccessRow>(
    sql`
      select book_id as "bookId", actor_id as "actorId"
      from openerp.payroll_access
      where book_id = ${bookId} and actor_id = ${actorId}
      for share
    `,
    "objects",
  );
}

export function readBookMember(transaction: Transaction, bookId: string, actorId: string) {
  return transaction
    .select({ actorId: memberships.actorId })
    .from(memberships)
    .where(and(eq(memberships.bookId, bookId), eq(memberships.actorId, actorId)))
    .for("share");
}

export function grantPayrollAccess(
  transaction: Transaction,
  row: { readonly bookId: string; readonly actorId: string; readonly grantedBy: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.payroll_access (book_id, actor_id, granted_by)
      values (${row.bookId}, ${row.actorId}, ${row.grantedBy})
      on conflict (book_id, actor_id) do nothing
    `,
    "objects",
  );
}

export function revokePayrollAccess(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute(
    sql`
      delete from openerp.payroll_access
      where book_id = ${bookId} and actor_id = ${actorId}
    `,
    "objects",
  );
}

export function listEmployees(transaction: Transaction, bookId: string, after: string) {
  return transaction.execute<PayrollEmployeeRow>(
    sql`
      select id, to_json(created_at) as "createdAt"
      from openerp.payroll_employees
      where book_id = ${bookId} and id collate "C" > ${after} collate "C"
      order by id collate "C"
      limit 51
    `,
    "objects",
  );
}

export function insertEmployee(transaction: Transaction, bookId: string, employeeId: string) {
  return transaction.execute(
    sql`
      insert into openerp.payroll_employees (book_id, id)
      values (${bookId}, ${employeeId})
      on conflict (book_id, id) do nothing
    `,
    "objects",
  );
}

export function readCurrentRevision(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  kind: RevisionKind,
  effectiveOn: string,
) {
  return transaction.execute<PayrollCurrentRow>(
    sql`
      select revision_id as "revisionId"
      from openerp.payroll_current_revisions
      where book_id = ${bookId} and employee_id = ${employeeId} and kind = ${kind}
        and effective_on = ${effectiveOn}::date
      for update
    `,
    "objects",
  );
}

export function insertRevision(transaction: Transaction, row: RevisionWrite) {
  return transaction.execute(
    sql`
      insert into openerp.payroll_revisions
        (book_id, id, command_key, employee_id, kind, effective_on, supersedes, body, evidence_id, created_by)
      values (${row.bookId}, ${row.id}, ${row.commandKey}, ${row.employeeId}, ${row.kind},
        ${row.effectiveOn}::date, ${row.supersedes}, ${JSON.stringify(row.body)}::jsonb,
        ${row.evidenceId}, ${row.createdBy})
    `,
    "objects",
  );
}

export function insertCurrentRevision(transaction: Transaction, row: CurrentWrite) {
  return transaction.execute(
    sql`
      insert into openerp.payroll_current_revisions
        (book_id, employee_id, kind, effective_on, revision_id)
      values (${row.bookId}, ${row.employeeId}, ${row.kind}, ${row.effectiveOn}::date, ${row.revisionId})
    `,
    "objects",
  );
}

export function replaceCurrentRevision(transaction: Transaction, row: CurrentWrite) {
  return transaction.execute(
    sql`
      update openerp.payroll_current_revisions
      set revision_id = ${row.revisionId}
      where book_id = ${row.bookId} and employee_id = ${row.employeeId} and kind = ${row.kind}
        and effective_on = ${row.effectiveOn}::date
    `,
    "objects",
  );
}

export function listRevisions(transaction: Transaction, bookId: string, employeeId: string) {
  return transaction.execute<PayrollRevisionRow>(
    sql`
      select
        r.book_id as "bookId",
        r.id,
        r.employee_id as "employeeId",
        r.kind,
        r.effective_on as "effectiveOn",
        r.supersedes,
        r.evidence_id as "evidenceId",
        r.body,
        r.created_by as "createdBy",
        to_json(r.created_at) as "createdAt",
        exists (
          select 1
          from openerp.payroll_current_revisions current_revision
          where current_revision.book_id = r.book_id
            and current_revision.employee_id = r.employee_id
            and current_revision.kind = r.kind
            and current_revision.effective_on = r.effective_on
            and current_revision.revision_id = r.id
        ) as "isCurrent"
      from openerp.payroll_revisions r
      where r.book_id = ${bookId} and r.employee_id = ${employeeId}
      order by r.effective_on, r.created_at, r.id
    `,
    "objects",
  );
}
