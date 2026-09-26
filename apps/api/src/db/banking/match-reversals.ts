import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";
import { allocatedLineSql, allocatedSourceSql } from "./shared";

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

export type ReversalPlanRow = {
  readonly id: string;
  readonly targetKey: string;
  readonly body: JsonObject;
};

export type ReversalTargetRow = {
  readonly accountId: string | null;
  readonly original: JsonObject | null;
  readonly legs: Json;
  readonly legCount: number;
};

export type ReversalSnapshotRow = {
  readonly periods: Json;
  readonly capacities: Json;
  readonly dates: Json;
};

export type ReversalApprovalRow = { readonly id: string };

export type ApprovalRow = {
  readonly id: string;
  readonly planId: string;
  readonly actorId: string;
  readonly expiresAt: string;
};

export type ApprovalStateRow = { readonly state: "consumed" | "revoked" | null };

export function readReversalPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<ReversalPlanRow>(
    sql`
      select id, target_key as "targetKey", body
      from openerp.bank_match_reversal_plans
      where book_id = ${bookId} and id = ${planId}
    `,
    "objects",
  );
}

export function readAllocationTarget(
  transaction: Transaction,
  bookId: string,
  allocationPlanId: string,
) {
  return transaction.execute<ReversalTargetRow>(
    sql`
      select p.account_id as "accountId", e.body as original,
        coalesce((
          select jsonb_agg(jsonb_build_object('statementId', a.statement_id, 'rowOrdinal', a.row_ordinal,
            'voucherId', a.voucher_id, 'lineId', a.line_id, 'amountMinor', a.amount_minor::text)
            order by a.ordinal) from openerp.bank_allocation_legs a
          where a.book_id = ${bookId} and a.plan_id = ${allocationPlanId}
        ), '[]'::jsonb) as legs,
        (select count(*) from openerp.bank_allocation_legs a
          where a.book_id = ${bookId} and a.plan_id = ${allocationPlanId}) as "legCount"
      from openerp.bank_allocation_executions e
      join openerp.bank_allocation_plans p on (p.book_id, p.id) = (e.book_id, e.plan_id)
      where e.book_id = ${bookId} and e.plan_id = ${allocationPlanId}
    `,
    "objects",
  );
}

export function readExactMatchTarget(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<ReversalTargetRow>(
    sql`
      select s.account_id as "accountId", jsonb_build_object(
          'statementId', m.statement_id, 'rowOrdinal', m.row_ordinal, 'voucherId', m.voucher_id,
          'lineId', m.line_id, 'origin', m.origin, 'actorId', m.actor_id) as original,
        jsonb_build_array(jsonb_build_object('statementId', m.statement_id, 'rowOrdinal', m.row_ordinal,
          'voucherId', m.voucher_id, 'lineId', m.line_id, 'amountMinor', o.amount_minor::text)) as legs,
        1 as "legCount"
      from openerp.bank_matches m
      join openerp.bank_observations o
        on (o.book_id, o.statement_id, o.row_ordinal) = (m.book_id, m.statement_id, m.row_ordinal)
      join openerp.bank_statements s on (s.book_id, s.id) = (m.book_id, m.statement_id)
      where m.book_id = ${bookId} and m.statement_id = ${statementId} and m.row_ordinal = ${rowOrdinal}
    `,
    "objects",
  );
}

export function readReversedTarget(transaction: Transaction, bookId: string, targetKey: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_match_reversals
        where book_id = ${bookId} and target_key = ${targetKey}
      ) as present
    `,
    "objects",
  );
}

export function readReversedVoucherPresence(transaction: Transaction, bookId: string, legs: Json) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1
        from jsonb_array_elements(${JSON.stringify(legs)}::jsonb) leg
        join openerp.vouchers v on v.book_id = ${bookId} and v.id = leg->>'voucherId'
        where v.posting_purpose = 'reversal'
          or exists (
            select 1 from openerp.vouchers r
            where r.book_id = ${bookId} and r.corrects_voucher_id = v.id
          )
      ) as present
    `,
    "objects",
  );
}

export function readReversalDates(transaction: Transaction, bookId: string, legs: Json) {
  return transaction.execute<ReversalSnapshotRow>(
    sql`
      with target as (
        select (leg->>'statementId')::text as statement_id, (leg->>'rowOrdinal')::integer as row_ordinal,
          (leg->>'voucherId')::text as voucher_id
        from jsonb_array_elements(${JSON.stringify(legs)}::jsonb) leg
      ), dates as (
        select o.observed_on as date
        from target t
        join openerp.bank_observations o
          on o.book_id = ${bookId} and o.statement_id = t.statement_id and o.row_ordinal = t.row_ordinal
        union
        select v.posting_date
        from target t
        join openerp.vouchers v on v.book_id = ${bookId} and v.id = t.voucher_id
      )
      select
        coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version::text) order by p.id)
          from openerp.periods p
          where p.book_id = ${bookId} and exists (
            select 1 from target t
            join openerp.bank_observations o
              on o.book_id = ${bookId} and o.statement_id = t.statement_id and o.row_ordinal = t.row_ordinal
            join openerp.vouchers v on v.book_id = ${bookId} and v.id = t.voucher_id
            where o.observed_on between p.starts_on and p.ends_on
              or v.posting_date between p.starts_on and p.ends_on
          )
        ), '[]'::jsonb) as periods,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'leg', leg, 'evidenceId', s.evidence_id, 'evidenceSha256', e.sha256,
            'observedOn', o.observed_on::text, 'postedOn', v.posting_date::text,
            'sourceAmountMinor', o.amount_minor::text,
            'sourceAllocatedMinor', (${allocatedSourceSql(
              sql`${bookId}`,
              sql`leg->>'statementId'`,
              sql`(leg->>'rowOrdinal')::integer`,
            )})::text,
            'lineAmountMinor', (l.debit_minor - l.credit_minor)::text,
            'lineAllocatedMinor', (${allocatedLineSql(
              sql`${bookId}`,
              sql`leg->>'voucherId'`,
              sql`leg->>'lineId'`,
            )})::text
          ) order by ord)
          from jsonb_array_elements(${JSON.stringify(legs)}::jsonb) with ordinality item(leg, ord)
          join openerp.bank_observations o on o.book_id = ${bookId}
            and o.statement_id = leg->>'statementId' and o.row_ordinal = (leg->>'rowOrdinal')::integer
          join openerp.bank_statements s on (s.book_id, s.id) = (o.book_id, o.statement_id)
          join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
          join openerp.journal_lines l on l.book_id = ${bookId}
            and l.voucher_id = leg->>'voucherId' and l.id = leg->>'lineId'
          join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
        ), '[]'::jsonb) as capacities,
        coalesce((
          select jsonb_agg(jsonb_build_object('date', d.date::text,
            'periodCount', (select count(*) from openerp.periods p
              where p.book_id = ${bookId} and d.date between p.starts_on and p.ends_on),
            'locked', coalesce((select bool_or(p.locked) from openerp.periods p
              where p.book_id = ${bookId} and d.date between p.starts_on and p.ends_on), false))
            order by d.date)
          from dates d
        ), '[]'::jsonb) as dates
    `,
    "objects",
  );
}

export function insertReversalApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly planId: string;
    readonly actorId: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_match_reversal_approvals
        (book_id, id, plan_id, actor_id, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.planId}, ${row.actorId}, ${row.expiresAt}::timestamptz,
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertReversalPlan(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly targetKey: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_match_reversal_plans (book_id, id, target_key, body)
      values (${row.bookId}, ${row.id}, ${row.targetKey}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readReversalExecution(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select body
      from openerp.bank_match_reversals
      where book_id = ${bookId} and plan_id = ${planId}
    `,
    "objects",
  );
}

export function readCurrentReversalApproval(
  transaction: Transaction,
  bookId: string,
  planId: string,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select a.body
      from openerp.bank_match_reversal_approvals a
      join openerp.memberships m
        on m.book_id = a.book_id and m.actor_id = a.actor_id and m.role = 'operator'
      where a.book_id = ${bookId} and a.plan_id = ${planId}
        and a.expires_at > clock_timestamp()
        and not exists (
          select 1 from openerp.bank_match_reversal_revocations r
          where r.book_id = a.book_id and r.approval_id = a.id
        )
      order by a.expires_at desc, a.id desc
      limit 1
    `,
    "objects",
  );
}

export function readReversalApprovalForExecution(
  transaction: Transaction,
  bookId: string,
  planId: string,
  approvalId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, plan_id as "planId", actor_id as "actorId", expires_at::text as "expiresAt"
      from openerp.bank_match_reversal_approvals
      where book_id = ${bookId} and id = ${approvalId} and plan_id = ${planId}
      for update
    `,
    "objects",
  );
}

export function insertReversal(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly planId: string;
    readonly approvalId: string;
    readonly targetKey: string;
    readonly allocationPlanId: string | null;
    readonly statementId: string | null;
    readonly rowOrdinal: number | null;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_match_reversals
        (book_id, plan_id, approval_id, target_key, allocation_plan_id, statement_id, row_ordinal, body)
      values (${row.bookId}, ${row.planId}, ${row.approvalId}, ${row.targetKey},
        ${row.allocationPlanId}, ${row.statementId}, ${row.rowOrdinal}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function listReversalPlans(
  transaction: Transaction,
  bookId: string,
  afterId: string | null,
  limit: number,
) {
  return transaction.execute<{
    readonly id: string;
    readonly body: JsonObject;
    readonly execution: JsonObject | null;
  }>(
    sql`
      select p.id, p.body, r.body as execution
      from (
        select x.* from openerp.bank_match_reversal_plans x
        where x.book_id = ${bookId}
          and (${afterId}::text is null or x.id collate "C" > ${afterId}::text collate "C")
        order by x.id collate "C"
        limit ${limit}
      ) p
      left join openerp.bank_match_reversals r on (r.book_id, r.plan_id) = (p.book_id, p.id)
      order by p.id collate "C"
    `,
    "objects",
  );
}

export function readReversalPlanTail(transaction: Transaction, bookId: string, afterId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_match_reversal_plans
        where book_id = ${bookId} and id collate "C" > ${afterId} collate "C"
      ) as present
    `,
    "objects",
  );
}

export function readReversalApproval(transaction: Transaction, bookId: string, approvalId: string) {
  return transaction.execute<ReversalApprovalRow>(
    sql`
      select id from openerp.bank_match_reversal_approvals
      where book_id = ${bookId} and id = ${approvalId}
    `,
    "objects",
  );
}

export function readApprovalState(transaction: Transaction, bookId: string, approvalId: string) {
  return transaction.execute<ApprovalStateRow>(
    sql`
      select case
        when exists (select 1 from openerp.bank_match_reversals r
          where r.book_id = ${bookId} and r.approval_id = ${approvalId}) then 'consumed'
        when exists (select 1 from openerp.bank_match_reversal_revocations r
          where r.book_id = ${bookId} and r.approval_id = ${approvalId}) then 'revoked'
        else null end as state
    `,
    "objects",
  );
}

export function insertReversalRevocation(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
  body: JsonObject,
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_match_reversal_revocations (book_id, approval_id, body)
      values (${bookId}, ${approvalId}, ${JSON.stringify(body)}::jsonb)
    `,
    "objects",
  );
}

export function readDatabaseTime(transaction: Transaction) {
  return transaction.execute<{ readonly now: string }>(
    sql`select clock_timestamp()::text as now`,
    "objects",
  );
}
