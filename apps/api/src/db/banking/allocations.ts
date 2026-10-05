import type * as Settlement from "@open-erp/contracts/settlements";
import { sql, type SQL } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";
import { allocatedLineSql, allocatedSourceSql } from "./shared";

type JsonObject = Schema.JsonObject;

export type AllocationPlanRow = {
  readonly id: string;
  readonly accountId: string;
  readonly input: JsonObject;
  readonly body: JsonObject;
};

export type DatabaseTimeRow = { readonly now: string };

export type ApprovalRow = {
  readonly id: string;
  readonly planId: string;
  readonly actorId: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export type CountRow = { readonly total: number };

export function readAllocationPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<AllocationPlanRow>(
    sql`
      select id, account_id as "accountId", input, body
      from openerp.bank_allocation_plans
      where book_id = ${bookId} and id = ${planId}
    `,
    "objects",
  );
}

export function insertAllocationPlan(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accountId: string;
    readonly input: JsonObject;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_allocation_plans (book_id, id, account_id, input, body)
      values (${row.bookId}, ${row.id}, ${row.accountId}, ${JSON.stringify(row.input)}::jsonb,
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertAllocationApproval(
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
      insert into openerp.bank_allocation_approvals
        (book_id, id, plan_id, actor_id, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.planId}, ${row.actorId}, ${row.expiresAt}::timestamptz,
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readCurrentApproval(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select a.id, a.plan_id as "planId", a.actor_id as "actorId",
        a.expires_at::text as "expiresAt", a.body
      from openerp.bank_allocation_approvals a
      join openerp.memberships m
        on m.book_id = a.book_id and m.actor_id = a.actor_id and m.role = 'operator'
      where a.book_id = ${bookId} and a.plan_id = ${planId}
        and a.expires_at > clock_timestamp()
      order by a.expires_at desc, a.id desc
      limit 1
    `,
    "objects",
  );
}

export function readApprovalForExecution(
  transaction: Transaction,
  bookId: string,
  planId: string,
  approvalId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, plan_id as "planId", actor_id as "actorId", expires_at::text as "expiresAt", body
      from openerp.bank_allocation_approvals
      where book_id = ${bookId} and id = ${approvalId} and plan_id = ${planId}
      for update
    `,
    "objects",
  );
}

export function readOperatorMembership(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.memberships
        where book_id = ${bookId} and actor_id = ${actorId} and role = 'operator'
      ) as present
    `,
    "objects",
  );
}

export function readAllocationExecution(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select body
      from openerp.bank_allocation_executions
      where book_id = ${bookId} and plan_id = ${planId}
    `,
    "objects",
  );
}

export function insertAllocationExecution(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly planId: string;
    readonly approvalId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_allocation_executions (book_id, plan_id, approval_id, body)
      values (${row.bookId}, ${row.planId}, ${row.approvalId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertAllocationLegs(
  transaction: Transaction,
  bookId: string,
  planId: string,
  legs: ReadonlyArray<JsonObject>,
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_allocation_legs
        (book_id, plan_id, ordinal, statement_id, row_ordinal, voucher_id, line_id, amount_minor)
      select ${bookId}, ${planId}, leg."ordinal"::integer, leg."statementId",
        leg."rowOrdinal"::integer, leg."voucherId", leg."lineId", leg."amountMinor"::numeric
      from jsonb_to_recordset(${JSON.stringify(legs)}::jsonb) as leg(
        "ordinal" integer, "statementId" text, "rowOrdinal" integer, "voucherId" text,
        "lineId" text, "amountMinor" text)
    `,
    "objects",
  );
}

export function readAllocatedSource(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<{ readonly allocated: string }>(
    sql`
      select (${allocatedSourceSql(sql`${bookId}`, sql`${statementId}`, sql`${rowOrdinal}`)})::text as allocated
    `,
    "objects",
  );
}

export function readAllocatedLine(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<{ readonly allocated: string }>(
    sql`
      select (${allocatedLineSql(sql`${bookId}`, sql`${voucherId}`, sql`${lineId}`)})::text as allocated
    `,
    "objects",
  );
}

export function readCandidateCount(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
  sign: number,
) {
  const book: SQL = sql`${bookId}`;

  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total from (
        select 1
        from openerp.journal_lines l
        join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
        where l.book_id = ${bookId} and l.account_id = ${accountId}
          and v.posting_date between ${startsOn}::date and ${endsOn}::date
          and sign(l.debit_minor - l.credit_minor) = ${sign}
          and abs(l.debit_minor - l.credit_minor)
            > abs(${allocatedLineSql(book, sql`l.voucher_id`, sql`l.id`)})
        limit 1001
      ) bounded
    `,
    "objects",
  );
}

export function readReversedAllocation(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<{
    readonly planId: string;
    readonly executedAt: string;
    readonly reason: string;
  }>(
    sql`
      select r.plan_id as "planId", r.body->>'executedAt' as "executedAt",
        r.body->>'reason' as reason
      from openerp.bank_match_reversals r
      join openerp.bank_match_reversal_plans p on (p.book_id, p.id) = (r.book_id, r.plan_id)
      where r.book_id = ${bookId} and r.allocation_plan_id = ${planId}
    `,
    "objects",
  );
}

export function readDatabaseTime(transaction: Transaction) {
  return transaction.execute<DatabaseTimeRow>(
    sql`select clock_timestamp()::text as now`,
    "objects",
  );
}

export function readAssetApprovalAuthority(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  approvalId: string,
) {
  return transaction.execute<{
    readonly authorized: boolean;
    readonly review: JsonObject;
    readonly approval: JsonObject;
  }>(
    sql`select r.body as review,a.body as approval,(a.expires_at>clock_timestamp() and exists(select from openerp.approvals p where p.book_id=a.book_id and p.id=a.body->'postingApproval'->>'id' and p.change_set_id=r.change_set_id and p.digest=r.body->'postingPlan'->>'planDigest' and p.actor_id=a.actor_id and p.expires_at>clock_timestamp() and p.consumed_at is not null and not exists(select from openerp.posting_approval_revocations revoked where revoked.book_id=p.book_id and revoked.approval_id=p.id)) and exists(select from openerp.memberships m where m.book_id=a.book_id and m.actor_id=a.actor_id and m.role='operator') and exists(select from openerp.identity_admissions i where i.actor_id=a.actor_id and i.enabled)) as authorized from openerp.asset_proceeds_approvals a join openerp.asset_proceeds_reviews r on(r.book_id,r.id)=(a.book_id,a.review_id) where a.book_id=${bookId} and a.id=${approvalId} and a.review_id=${reviewId}`,
    "objects",
  );
}

export function insertOwnedAllocationApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly ownerReviewId: string;
    readonly ownerApprovalId: string;
    readonly approval: typeof Settlement.BankAllocationApproval.Type;
  },
) {
  const a = row.approval;

  return transaction.execute(
    sql`insert into openerp.bank_allocation_approvals(book_id,id,plan_id,actor_id,expires_at,owner_kind,owner_review_id,owner_approval_id,body) values(${row.bookId},${a.id},${a.planId},${a.actorId},${a.expiresAt}::timestamptz,'asset_proceeds_disposal',${row.ownerReviewId},${row.ownerApprovalId},${JSON.stringify({ ...a, delegatedOwner: { kind: "asset_proceeds_disposal", reviewId: row.ownerReviewId, approvalId: row.ownerApprovalId } })}::jsonb)`,
    "objects",
  );
}

export function readOwnedAllocationPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`select exists(select from openerp.bank_allocation_approvals where book_id=${bookId} and plan_id=${planId} and owner_kind is not null) as present`,
    "objects",
  );
}
