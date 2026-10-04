import { sql } from "drizzle-orm";
import type * as Runs from "@open-erp/contracts/payroll-runs";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

export const runTables = [
  "payroll_runs",
  "payroll_run_executions",
  "payroll_run_obligations",
  "payroll_earning_reservations",
  "payroll_month_reservations",
  "payroll_payslip_documents",
  "payroll_payslip_artifacts",
  "payroll_payslip_render_failures",
] as const;

export type BodyRow = { readonly body: Schema.JsonObject };

export function readRun(tx: Transaction, bookId: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_runs where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readRunByPlan(tx: Transaction, bookId: string, planId: string, eventId?: string) {
  return tx.execute<{ readonly id: string; readonly body: Schema.JsonObject }>(
    sql`select id,body from openerp.payroll_runs where book_id=${bookId} and (change_set_id=${planId} or event_id=${eventId ?? null})`,
    "objects",
  );
}

export function readRuns(tx: Transaction, bookId: string, after: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_runs where book_id=${bookId} and id collate "C">${after} collate "C" order by id collate "C" limit 21`,
    "objects",
  );
}

export function readExecution(tx: Transaction, bookId: string, runId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_run_executions where book_id=${bookId} and run_id=${runId}`,
    "objects",
  );
}

export function readReservedMonth(
  tx: Transaction,
  bookId: string,
  employeeId: string,
  month: string,
) {
  return tx.execute<{ readonly runId: string }>(
    sql`select run_id as "runId" from openerp.payroll_month_reservations where book_id=${bookId} and employee_id=${employeeId} and month=${month}`,
    "objects",
  );
}

export function insertRun(tx: Transaction, run: typeof Runs.PayrollRun.Type, eventId: string) {
  return tx.execute(
    sql`insert into openerp.payroll_runs(book_id,id,change_set_id,event_id,digest,body) values(${run.scope.bookId},${run.id},${run.postingPlan.id},${eventId},${run.digest},${JSON.stringify(run)}::jsonb)`,
  );
}

export function insertExecution(tx: Transaction, result: typeof Runs.PayrollRunExecution.Type) {
  return tx.execute(
    sql`insert into openerp.payroll_run_executions(book_id,id,run_id,voucher_id,posting_receipt_id,body) values(${result.scope.bookId},${result.id},${result.runId},${result.postingReceipt.voucherId},${result.postingReceipt.id},${JSON.stringify(result)}::jsonb)`,
  );
}

export function insertObligation(
  tx: Transaction,
  bookId: string,
  runId: string,
  obligation: typeof Runs.PayrollEmployeeObligation.Type,
) {
  return tx.execute(
    sql`insert into openerp.payroll_run_obligations(book_id,run_id,employee_id,calculation_id,payable_minor,body) values(${bookId},${runId},${obligation.employeeId},${obligation.calculationId},${obligation.payableMinor},${JSON.stringify(obligation)}::jsonb)`,
  );
}

export function insertReservations(
  tx: Transaction,
  bookId: string,
  runId: string,
  employee: typeof Runs.PayrollRunEmployee.Type,
) {
  const row = employee.calculation;

  return tx.execute(sql`with earning as (
    insert into openerp.payroll_earning_reservations(book_id,employee_id,earnings_period_start,earnings_period_end,run_id,calculation_id)
    values(${bookId},${row.employeeId},${row.calculation.earningsPeriod.startsOn},${row.calculation.earningsPeriod.endsOn},${runId},${row.id}) returning run_id
  ) insert into openerp.payroll_month_reservations(book_id,employee_id,month,run_id,calculation_id,contribution_base_minor)
    select ${bookId},${row.employeeId},${row.calculation.earningsPeriod.startsOn.slice(0, 7)},run_id,${row.id},${row.calculation.contributionBaseMinor} from earning`);
}

export function insertDocument(tx: Transaction, document: typeof Runs.PayrollPayslipDocument.Type) {
  return tx.execute(
    sql`insert into openerp.payroll_payslip_documents(book_id,id,run_id,employee_id,digest,body) values(${document.scope.bookId},${document.id},${document.runId},${document.employeeId},${document.digest},${JSON.stringify(document)}::jsonb)`,
  );
}

export function readDocument(tx: Transaction, bookId: string, documentId: string) {
  return tx.execute<{
    readonly body: Schema.JsonObject;
    readonly outboxId: string;
    readonly attempts: number;
    readonly payload: Schema.JsonObject;
  }>(
    sql`
    select d.body,o.id as "outboxId",o.attempts,o.payload from openerp.payroll_payslip_documents d
    join openerp.outbox o on o.book_id=d.book_id and o.payload->>'documentId'=d.id and o.kind='payroll.payslip.render_requested'
    where d.book_id=${bookId} and d.id=${documentId} limit 2`,
    "objects",
  );
}

export function readArtifact(tx: Transaction, bookId: string, documentId: string) {
  return tx.execute<{ readonly descriptor: Schema.JsonObject; readonly contentBase64: string }>(
    sql`select descriptor,content_base64 as "contentBase64" from openerp.payroll_payslip_artifacts where book_id=${bookId} and document_id=${documentId}`,
    "objects",
  );
}

export function insertArtifact(
  tx: Transaction,
  artifact: typeof Runs.PayrollPayslipArtifact.Type,
  contentBase64: string,
) {
  return tx.execute(
    sql`insert into openerp.payroll_payslip_artifacts(book_id,id,document_id,descriptor,content_base64) values(${artifact.scope.bookId},${artifact.id},${artifact.documentId},${JSON.stringify(artifact)}::jsonb,${contentBase64})`,
  );
}

export function acknowledge(tx: Transaction, bookId: string, outboxId: string) {
  return tx.execute(
    sql`update openerp.outbox set delivered_at=coalesce(delivered_at,clock_timestamp()) where book_id=${bookId} and id=${outboxId} and kind='payroll.payslip.render_requested'`,
  );
}

export function recordFailure(
  tx: Transaction,
  bookId: string,
  documentId: string,
  outboxId: string,
  code: string,
) {
  return tx.execute(sql`with attempt as (
    update openerp.outbox set attempts=attempts+1 where book_id=${bookId} and id=${outboxId} and attempts<20 returning attempts
  ) insert into openerp.payroll_payslip_render_failures(book_id,document_id,ordinal,code,failed_at)
    select ${bookId},${documentId},attempts,${code},clock_timestamp() from attempt`);
}

export function readPending(tx: Transaction, actorId: string) {
  return tx.execute<{
    readonly entityId: string;
    readonly bookId: string;
    readonly documentId: string;
    readonly outboxId: string;
    readonly documentDigest: string;
  }>(
    sql`
    select b.entity_id as "entityId",d.book_id as "bookId",d.id as "documentId",o.id as "outboxId",d.digest as "documentDigest"
    from openerp.payroll_payslip_documents d join openerp.books b on b.id=d.book_id
    join openerp.memberships m on m.book_id=b.id and m.actor_id=${actorId}
    join openerp.payroll_access p on p.book_id=m.book_id and p.actor_id=m.actor_id
    join openerp.outbox o on o.book_id=d.book_id and o.payload->>'documentId'=d.id and o.kind='payroll.payslip.render_requested'
    where o.delivered_at is null and o.attempts<20 order by o.created_at,o.book_id,o.id limit 50`,
    "objects",
  );
}
