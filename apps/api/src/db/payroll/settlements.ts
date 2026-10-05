import { sql } from "drizzle-orm";
import type * as Settlement from "@open-erp/contracts/payroll-settlements";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

export const settlementTables = [
  "payroll_settlement_reviews",
  "payroll_settlement_approvals",
  "payroll_settlement_executions",
  "payroll_paid_events",
  "payroll_correction_comparisons",
  "payroll_adjustment_bases",
  "payroll_recovery_claims",
  "payroll_recovery_allocations",
  "payroll_adjustment_instructions",
  "payroll_adjustment_reservations",
  "payroll_adjustment_consumptions",
  "payroll_reporting_corrections",
  "payroll_period_revisions",
  "payroll_settlement_capacity_reservations",
] as const;

type Records = Exclude<
  (typeof settlementTables)[number],
  | "payroll_adjustment_reservations"
  | "payroll_adjustment_consumptions"
  | "payroll_settlement_capacity_reservations"
>;

type BodyRow = { readonly body: Schema.JsonObject };

export function readRecord(tx: Transaction, bookId: string, table: Records, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.identifier(table)} where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readRecords(tx: Transaction, bookId: string, table: Records) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.identifier(table)} where book_id=${bookId} order by id collate "C"`,
    "objects",
  );
}

export function insertRecord(
  tx: Transaction,
  table: Records,
  row: {
    readonly id: string;
    readonly scope: { readonly bookId: string };
    readonly digest: string;
  },
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.${sql.identifier(table)}(book_id,id,digest,body) values(${row.scope.bookId},${row.id},${row.digest},${JSON.stringify(body)}::jsonb)`,
  );
}

export function readReviewByPlan(
  tx: Transaction,
  bookId: string,
  planId: string,
  eventId?: string,
) {
  return tx.execute<{ readonly id: string; readonly body: Schema.JsonObject }>(
    sql`select id,body from openerp.payroll_settlement_reviews where book_id=${bookId} and (change_set_id=${planId} or event_id=${eventId ?? null})`,
    "objects",
  );
}

export function insertReview(
  tx: Transaction,
  row: typeof Settlement.SettlementReview.Type,
  eventId: string | null,
) {
  return tx.execute(
    sql`insert into openerp.payroll_settlement_reviews(book_id,id,digest,body,event_id) values(${row.scope.bookId},${row.id},${row.digest},${JSON.stringify(row)}::jsonb,${eventId})`,
  );
}

export function readPaidEmployee(
  tx: Transaction,
  bookId: string,
  runId: string,
  employeeId: string,
) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_paid_events where book_id=${bookId} and run_id=${runId} and employee_id=${employeeId}`,
    "objects",
  );
}

export function readEconomicExecution(tx: Transaction, bookId: string, key: string) {
  return tx.execute<BodyRow>(
    sql`select e.body from openerp.payroll_settlement_executions e join openerp.payroll_settlement_reviews r on r.book_id=e.book_id and r.id=e.review_id where e.book_id=${bookId} and r.body->>'economicKey'=${key}`,
    "objects",
  );
}

export function readReviewExecution(tx: Transaction, bookId: string, reviewId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_settlement_executions where book_id=${bookId} and review_id=${reviewId}`,
    "objects",
  );
}

export function readApprovalRows(tx: Transaction, bookId: string, reviewId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_settlement_approvals where book_id=${bookId} and review_id=${reviewId} order by id collate "C"`,
    "objects",
  );
}

export function readSourceUsage(
  tx: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return tx.execute<{ readonly used: boolean }>(
    sql`select exists(select from openerp.bank_matches where book_id=${bookId} and statement_id=${statementId} and row_ordinal=${rowOrdinal}) or exists(select from openerp.bank_active_allocation_legs where book_id=${bookId} and statement_id=${statementId} and row_ordinal=${rowOrdinal}) as used`,
    "objects",
  );
}

export function readInstructionConsumption(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ readonly runId: string }>(
    sql`select run_id as "runId" from openerp.payroll_adjustment_consumptions where book_id=${bookId} and instruction_id=${id}`,
    "objects",
  );
}

export function readInstructionReservations(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ readonly runId: string; readonly snapshot: Schema.JsonObject }>(
    sql`select r.run_id as "runId",r.snapshot from openerp.payroll_adjustment_reservations r join openerp.approvals a on a.book_id=r.book_id and a.id=r.approval_id where r.book_id=${bookId} and r.instruction_id=${id} and a.expires_at>clock_timestamp() and not exists(select from openerp.posting_approval_revocations v where v.book_id=a.book_id and v.approval_id=a.id) and not exists(select from openerp.payroll_run_reservation_releases x where x.book_id=a.book_id and x.approval_id=a.id)`,
    "objects",
  );
}

export function insertInstructionReservation(
  tx: Transaction,
  bookId: string,
  runId: string,
  approvalId: string,
  snapshot: typeof Settlement.AdjustmentSnapshot.Type,
) {
  return tx.execute(
    sql`insert into openerp.payroll_adjustment_reservations(book_id,instruction_id,run_id,approval_id,snapshot) values(${bookId},${snapshot.id},${runId},${approvalId},${JSON.stringify(snapshot)}::jsonb)`,
  );
}

export function insertInstructionConsumption(
  tx: Transaction,
  bookId: string,
  runId: string,
  snapshot: typeof Settlement.AdjustmentSnapshot.Type,
) {
  return tx.execute(
    sql`insert into openerp.payroll_adjustment_consumptions(book_id,instruction_id,run_id,employee_id,snapshot) values(${bookId},${snapshot.id},${runId},${snapshot.employeeId},${JSON.stringify(snapshot)}::jsonb)`,
  );
}

export function readPostedRuns(tx: Transaction, bookId: string) {
  return tx.execute<BodyRow>(
    sql`select r.body from openerp.payroll_runs r join openerp.payroll_run_executions e on e.book_id=r.book_id and e.run_id=r.id where r.book_id=${bookId} order by r.id collate "C"`,
    "objects",
  );
}

export function readCapacityReservations(tx: Transaction, bookId: string, key: string) {
  return tx.execute<{ readonly reviewId: string; readonly approvalId: string }>(
    sql`
    select r.review_id as "reviewId",r.approval_id as "approvalId"
    from openerp.payroll_settlement_capacity_reservations r
    join openerp.payroll_settlement_approvals a on a.book_id=r.book_id and a.id=r.approval_id
    where r.book_id=${bookId} and r.capacity_key=${key}
    and (a.body->>'expiresAt')::timestamptz>clock_timestamp()
    and (a.body->>'kernelApprovalId' is null or exists(select from openerp.approvals k where k.book_id=a.book_id and k.id=a.body->>'kernelApprovalId' and k.expires_at>clock_timestamp()))
    and not exists(select from openerp.payroll_settlement_executions e where e.book_id=r.book_id and e.review_id=r.review_id)
    and not exists(select from openerp.posting_approval_revocations v where v.book_id=r.book_id and v.approval_id=a.body->>'kernelApprovalId')
    order by r.approval_id collate "C"
  `,
    "objects",
  );
}

export function insertCapacityReservation(
  tx: Transaction,
  bookId: string,
  key: string,
  reviewId: string,
  approvalId: string,
) {
  return tx.execute(
    sql`insert into openerp.payroll_settlement_capacity_reservations(book_id,capacity_key,review_id,approval_id) values(${bookId},${key},${reviewId},${approvalId})`,
  );
}

export function readCashReservation(
  tx: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return readCapacityReservations(tx, bookId, `cash:${statementId}:${rowOrdinal}`);
}

export function readVoucherLines(tx: Transaction, bookId: string, voucherId: string) {
  return tx.execute<{
    readonly lineId: string;
    readonly accountId: string;
    readonly debitMinor: string;
    readonly creditMinor: string;
  }>(
    sql`
    select id as "lineId",account_id as "accountId",debit_minor::text as "debitMinor",credit_minor::text as "creditMinor"
    from openerp.journal_lines where book_id=${bookId} and voucher_id=${voucherId} order by id collate "C"
  `,
    "objects",
  );
}

export function readLatestPeriod(tx: Transaction, bookId: string, reportingPeriod: string) {
  return tx.execute<BodyRow>(
    sql`
    select body from openerp.payroll_period_revisions where book_id=${bookId} and body->>'reportingPeriod'=${reportingPeriod}
    order by (body->>'createdAt')::timestamptz desc,id collate "C" desc limit 1
  `,
    "objects",
  );
}
