import { sql } from "drizzle-orm";
import type * as Inputs from "@open-erp/contracts/payroll-inputs";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

export const inputTables = [
  "payroll_inputs",
  "payroll_input_reviews",
  "payroll_input_executions",
  "payroll_input_components",
  "payroll_input_allocations",
  "payroll_input_reservations",
  "payroll_input_consumptions",
  "payroll_run_approval_reservations",
  "payroll_run_reservation_releases",
] as const;

type BodyRow = { readonly body: Schema.JsonObject };

export function readPurchaseConflict(tx: Transaction, bookId: string, economicKey: string) {
  return tx.execute<{ readonly present: boolean }>(
    sql`select exists(select from openerp.purchase_recognitions where book_id=${bookId} and economic_key=${economicKey}) or exists(select from openerp.owner_purchase_recognitions where book_id=${bookId} and economic_key=${economicKey}) as present`,
    "objects",
  );
}

export function readExpiredReservations(tx: Transaction, bookId: string) {
  return tx.execute<{ readonly approvalId: string; readonly runId: string }>(
    sql`select distinct r.approval_id as "approvalId",r.run_id as "runId" from openerp.payroll_run_approval_reservations r join openerp.approvals a on a.book_id=r.book_id and a.id=r.approval_id where r.book_id=${bookId} and (a.expires_at<=clock_timestamp() or exists(select from openerp.posting_approval_revocations v where v.book_id=a.book_id and v.approval_id=a.id)) and not exists(select from openerp.payroll_run_executions e where e.book_id=r.book_id and e.run_id=r.run_id) and not exists(select from openerp.payroll_run_reservation_releases x where x.book_id=r.book_id and x.approval_id=r.approval_id)`,
    "objects",
  );
}

export function insertReservationRelease(
  tx: Transaction,
  bookId: string,
  approvalId: string,
  runId: string,
) {
  return tx.execute(
    sql`insert into openerp.payroll_run_reservation_releases(book_id,approval_id,run_id,reason) values(${bookId},${approvalId},${runId},'approval_expired_or_revoked')`,
  );
}

export function readReservedApprovalMonth(
  tx: Transaction,
  bookId: string,
  employeeId: string,
  month: string,
) {
  return tx.execute<{ readonly runId: string }>(
    sql`select distinct r.run_id as "runId" from openerp.payroll_run_approval_reservations r where r.book_id=${bookId} and r.employee_id=${employeeId} and r.month=${month} and not exists(select from openerp.payroll_run_reservation_releases x where x.book_id=r.book_id and x.approval_id=r.approval_id)`,
    "objects",
  );
}

export function insertApprovalMonth(
  tx: Transaction,
  bookId: string,
  runId: string,
  approvalId: string,
  employeeId: string,
  month: string,
) {
  return tx.execute(
    sql`insert into openerp.payroll_run_approval_reservations(book_id,employee_id,month,run_id,approval_id) values(${bookId},${employeeId},${month},${runId},${approvalId})`,
  );
}

export function readInput(tx: Transaction, bookId: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_inputs where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readEconomicKey(tx: Transaction, bookId: string, key: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.payroll_inputs where book_id=${bookId} and economic_key=${key}`,
    "objects",
  );
}

export function readReview(tx: Transaction, bookId: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_input_reviews where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readReviewByPlan(
  tx: Transaction,
  bookId: string,
  planId: string,
  eventId?: string,
) {
  return tx.execute<{ readonly id: string; readonly body: Schema.JsonObject }>(
    sql`select id,body from openerp.payroll_input_reviews where book_id=${bookId} and (change_set_id=${planId} or event_id=${eventId ?? null})`,
    "objects",
  );
}

export function readReviews(tx: Transaction, bookId: string, inputId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_input_reviews where book_id=${bookId} and input_id=${inputId} order by id collate "C"`,
    "objects",
  );
}

export function readExecutions(tx: Transaction, bookId: string, inputId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_input_executions where book_id=${bookId} and input_id=${inputId} order by id collate "C"`,
    "objects",
  );
}

export function readReviewExecution(tx: Transaction, bookId: string, reviewId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_input_executions where book_id=${bookId} and review_id=${reviewId}`,
    "objects",
  );
}

export function readComponents(tx: Transaction, bookId: string, keys: ReadonlyArray<string>) {
  return tx.execute<{ readonly key: string }>(
    sql`select component_key as key from openerp.payroll_input_components where book_id=${bookId} and component_key in (${sql.join(
      keys.map((key) => sql`${key}`),
      sql`,`,
    )})`,
    "objects",
  );
}

export function readAllocations(tx: Transaction, bookId: string, inputId: string) {
  return tx.execute<{ readonly id: string; readonly amount: string }>(
    sql`select execution_id as id,amount_minor::text as amount from openerp.payroll_input_allocations where book_id=${bookId} and input_id=${inputId} order by execution_id collate "C"`,
    "objects",
  );
}

export function readReservation(tx: Transaction, bookId: string, inputId: string) {
  return tx.execute<{ readonly runId: string; readonly snapshot: Schema.JsonObject }>(
    sql`select r.run_id as "runId",r.snapshot from openerp.payroll_input_reservations r where r.book_id=${bookId} and r.input_id=${inputId} and not exists(select from openerp.payroll_run_reservation_releases x where x.book_id=r.book_id and x.approval_id=r.approval_id) order by r.approval_id collate "C"`,
    "objects",
  );
}

export function readConsumption(tx: Transaction, bookId: string, inputId: string) {
  return tx.execute<{ readonly runId: string }>(
    sql`select run_id as "runId" from openerp.payroll_input_consumptions where book_id=${bookId} and input_id=${inputId}`,
    "objects",
  );
}

export function readCreditBalance(tx: Transaction, bookId: string, accountId: string) {
  return tx.execute<{ readonly minor: string }>(
    sql`select coalesce(sum(credit_minor::numeric-debit_minor::numeric),0)::text as minor from openerp.journal_lines where book_id=${bookId} and account_id=${accountId}`,
    "objects",
  );
}

export function insertInput(tx: Transaction, row: typeof Inputs.PayrollInput.Type) {
  return tx.execute(
    sql`insert into openerp.payroll_inputs(book_id,id,employee_id,month,economic_key,digest,body) values(${row.scope.bookId},${row.id},${row.input.employeeId},${row.input.month},${row.input.economicKey},${row.digest},${JSON.stringify(row)}::jsonb)`,
  );
}

export function insertReview(
  tx: Transaction,
  row: typeof Inputs.PayrollInputReview.Type,
  eventId: string,
) {
  return tx.execute(
    sql`insert into openerp.payroll_input_reviews(book_id,id,input_id,kind,change_set_id,event_id,digest,body) values(${row.scope.bookId},${row.id},${row.inputId},${row.kind},${row.postingPlan.id},${eventId},${row.digest},${JSON.stringify(row)}::jsonb)`,
  );
}

export function insertExecution(tx: Transaction, row: typeof Inputs.PayrollInputExecution.Type) {
  return tx.execute(
    sql`insert into openerp.payroll_input_executions(book_id,id,input_id,review_id,kind,voucher_id,body) values(${row.scope.bookId},${row.id},${row.inputId},${row.reviewId},${row.kind},${row.postingReceipt.voucherId},${JSON.stringify(row)}::jsonb)`,
  );
}

export function insertComponent(tx: Transaction, bookId: string, inputId: string, key: string) {
  return tx.execute(
    sql`insert into openerp.payroll_input_components(book_id,input_id,component_key) values(${bookId},${inputId},${key})`,
  );
}

export function insertAllocation(
  tx: Transaction,
  bookId: string,
  inputId: string,
  executionId: string,
  amount: string,
) {
  return tx.execute(
    sql`insert into openerp.payroll_input_allocations(book_id,input_id,execution_id,amount_minor) values(${bookId},${inputId},${executionId},${amount})`,
  );
}

export function insertReservation(
  tx: Transaction,
  bookId: string,
  runId: string,
  row: typeof Inputs.PayrollInputSnapshot.Type,
  approvalId: string,
) {
  return tx.execute(
    sql`insert into openerp.payroll_input_reservations(book_id,input_id,run_id,approval_id,snapshot) values(${bookId},${row.inputId},${runId},${approvalId},${JSON.stringify(row)}::jsonb)`,
  );
}

export function insertConsumption(
  tx: Transaction,
  bookId: string,
  runId: string,
  row: typeof Inputs.PayrollInputSnapshot.Type,
) {
  return tx.execute(
    sql`insert into openerp.payroll_input_consumptions(book_id,input_id,run_id,employee_id,reimbursement_minor,gross_minor) values(${bookId},${row.inputId},${runId},${row.employeeId},${row.reimbursementMinor},${row.grossMinor})`,
  );
}
