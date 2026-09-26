import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";
import { textArray } from "../sql-values";

type JsonObject = Schema.JsonObject;

export type BasisLineRow = {
  readonly accountId: string;
  readonly lineId: string;
  readonly ordinal: number;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly assigned: boolean;
};

export type TableGrantRow = {
  readonly tableName: string;
  readonly allowed: boolean;
};

export type BasisRow = {
  readonly body: JsonObject;
};

export type ControlItemRow = {
  readonly item: JsonObject;
};

const basisReadGrants = sql`
  select
    requirement.table_name as "tableName",
    coalesce(
      bool_and(has_table_privilege(current_user, 'openerp.' || requirement.table_name, requirement.privilege)),
      false
    ) as allowed
  from (values
    ('subledger_bases', 'select')
  ) as requirement(table_name, privilege)
  group by requirement.table_name
`;

const controlReadGrants = sql`
  select
    requirement.table_name as "tableName",
    coalesce(
      bool_and(has_table_privilege(current_user, 'openerp.' || requirement.table_name, requirement.privilege)),
      false
    ) as allowed
  from (values
    ('subledger_control_snapshots', 'select')
  ) as requirement(table_name, privilege)
  group by requirement.table_name
`;

export function readBasisGrants(transaction: Transaction) {
  return transaction.execute<TableGrantRow>(basisReadGrants, "objects");
}

export function readControlGrants(transaction: Transaction) {
  return transaction.execute<TableGrantRow>(controlReadGrants, "objects");
}

export function readBasis(transaction: Transaction, bookId: string, scheduleId: string) {
  return transaction.execute<BasisRow>(
    sql`
      select body
      from openerp.subledger_bases
      where book_id = ${bookId} and schedule_id = ${scheduleId}
    `,
    "objects",
  );
}

export function listBases(transaction: Transaction, bookId: string) {
  return transaction.execute<BasisRow>(
    sql`
      select body
      from openerp.subledger_bases
      where book_id = ${bookId}
      order by schedule_id collate "C"
      limit 201
    `,
    "objects",
  );
}

export function listControlItems(transaction: Transaction, bookId: string) {
  return transaction.execute<ControlItemRow>(
    sql`
      select jsonb_build_object(
        'id', snapshot.id,
        'createdAt', snapshot.body->>'createdAt',
        'asOfDate', snapshot.body->'input'->>'asOfDate',
        'digest', snapshot.body->>'digest',
        'sequence', snapshot.body->>'sequence',
        'hasReviewGaps', snapshot.body->'hasReviewGaps'
      ) as item
      from openerp.subledger_control_snapshots snapshot
      where snapshot.book_id = ${bookId}
      order by snapshot.body->>'createdAt' desc, snapshot.id collate "C"
      limit 201
    `,
    "objects",
  );
}

export function readBasisConflicts(
  transaction: Transaction,
  bookId: string,
  scheduleId: string,
  evidenceId: string,
  locator: string,
) {
  return transaction.execute<{ readonly scheduleId: string }>(
    sql`
    select schedule_id as "scheduleId" from openerp.subledger_bases
    where book_id = ${bookId} and (schedule_id = ${scheduleId}
      or (evidence_id = ${evidenceId} and source_locator = ${locator}))
  `,
    "objects",
  );
}

export function readBasisVoucherLinks(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<{ readonly prepared: boolean; readonly occurrence: boolean }>(
    sql`
    select exists(select 1 from openerp.subledger_preparations p
      where p.book_id = v.book_id and p.change_set_id = v.change_set_id) as prepared,
      exists(select 1 from openerp.subledger_schedules s
        join lateral (select r.body from openerp.subledger_schedule_revisions r
          where r.book_id = s.book_id and r.schedule_id = s.id order by r.revision desc limit 1) r on true
        cross join lateral jsonb_array_elements(r.body->'occurrences') o
        join openerp.events e on e.book_id = s.book_id and e.id = v.event_id
          and e.event_key = o->>'eventKey'
        where s.book_id = v.book_id) as occurrence
    from openerp.vouchers v where v.book_id = ${bookId} and v.id = ${voucherId}
  `,
    "objects",
  );
}

export function readBasisLines(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineIds: ReadonlyArray<string>,
) {
  return transaction.execute<BasisLineRow>(
    sql`
    select l.account_id as "accountId", l.id as "lineId", l.ordinal,
      l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
      exists(select 1 from openerp.subledger_basis_lines b where b.book_id = l.book_id
        and b.voucher_id = l.voucher_id and b.line_id = l.id) as assigned
    from openerp.journal_lines l where l.book_id = ${bookId} and l.voucher_id = ${voucherId}
      and l.id = any(${textArray(lineIds)}) order by l.ordinal
  `,
    "objects",
  );
}

export function insertBasis(
  transaction: Transaction,
  bookId: string,
  scheduleId: string,
  evidenceId: string,
  locator: string,
  voucherId: string,
  body: JsonObject,
) {
  return transaction.execute(
    sql`
    insert into openerp.subledger_bases(book_id,schedule_id,evidence_id,source_locator,voucher_id,body)
    values (${bookId},${scheduleId},${evidenceId},${locator},${voucherId},${JSON.stringify(body)}::jsonb)
  `,
    "objects",
  );
}

export function insertBasisLines(
  transaction: Transaction,
  bookId: string,
  scheduleId: string,
  voucherId: string,
  lineIds: ReadonlyArray<string>,
) {
  return transaction.execute(
    sql`
    insert into openerp.subledger_basis_lines(book_id,schedule_id,voucher_id,line_id)
    select ${bookId},${scheduleId},${voucherId},line_id from unnest(${textArray(lineIds)}) line_id
  `,
    "objects",
  );
}
