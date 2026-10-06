import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Mileage from "@open-erp/contracts/mileage-corrections";
import type { Transaction } from "../transaction";

export const mileageRecordTables = [
  "payroll_mileage_correction_proposals",
  "payroll_mileage_correction_review_links",
  "payroll_mileage_correction_submissions",
  "payroll_mileage_correction_cancellations",
] as const;

export const mileageTables = [
  ...mileageRecordTables,
  "payroll_mileage_correction_successors",
] as const;

type RecordTable = (typeof mileageRecordTables)[number];

type BodyRow = { readonly body: Schema.JsonObject };

export function record(tx: Transaction, bookId: string, table: RecordTable, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.identifier(table)} where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function related(
  tx: Transaction,
  bookId: string,
  table: Exclude<RecordTable, "payroll_mileage_correction_proposals">,
  proposalId: string,
) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.identifier(table)} where book_id=${bookId} and proposal_id=${proposalId} order by id collate "C" limit 51`,
    "objects",
  );
}

export function insert(
  tx: Transaction,
  table: RecordTable,
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

export function list(
  tx: Transaction,
  bookId: string,
  input: typeof Mileage.ListMileageCorrections.Type,
) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_mileage_correction_proposals where book_id=${bookId} and (${input.employeeId ?? null}::text is null or employee_id=${input.employeeId ?? null}) and (${input.originalInputId ?? null}::text is null or original_input_id=${input.originalInputId ?? null}) and id collate "C">${input.cursor ?? ""} collate "C" order by id collate "C" limit ${(input.limit ?? 20) + 1}`,
    "objects",
  );
}

export function successors(tx: Transaction, bookId: string, inputId: string) {
  return tx.execute<{
    readonly executionId: string;
    readonly previousExecutionId: string | null;
    readonly proposalId: string;
  }>(
    sql`select execution_id as "executionId",previous_execution_id as "previousExecutionId",proposal_id as "proposalId" from openerp.payroll_mileage_correction_successors where book_id=${bookId} and original_input_id=${inputId} order by execution_id collate "C" limit 101`,
    "objects",
  );
}

export function insertSuccessor(
  tx: Transaction,
  bookId: string,
  inputId: string,
  previousExecutionId: string | null,
  executionId: string,
  proposalId: string,
) {
  return tx.execute(
    sql`insert into openerp.payroll_mileage_correction_successors(book_id,original_input_id,previous_execution_id,execution_id,proposal_id) values(${bookId},${inputId},${previousExecutionId},${executionId},${proposalId})`,
  );
}

export function paidClaims(tx: Transaction, bookId: string, paidEventId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_recovery_claims where book_id=${bookId} and paid_event_id=${paidEventId} order by id collate "C" limit 101`,
    "objects",
  );
}

export function paidInstructions(tx: Transaction, bookId: string, paidEventId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_adjustment_instructions where book_id=${bookId} and paid_event_id=${paidEventId} order by id collate "C" limit 101`,
    "objects",
  );
}

export function paidCorrections(tx: Transaction, bookId: string, paidEventId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_reporting_corrections where book_id=${bookId} and paid_event_id=${paidEventId} order by id collate "C" limit 101`,
    "objects",
  );
}

export function originalPayslips(
  tx: Transaction,
  bookId: string,
  runId: string,
  employeeId: string,
) {
  return tx.execute<{
    readonly body: Schema.JsonObject;
    readonly artifact: Schema.JsonObject | null;
  }>(
    sql`select d.body,a.descriptor as artifact from openerp.payroll_payslip_documents d left join openerp.payroll_payslip_artifacts a on a.book_id=d.book_id and a.document_id=d.id where d.book_id=${bookId} and d.run_id=${runId} and d.employee_id=${employeeId} order by d.id collate "C" limit 51`,
    "objects",
  );
}

export function periodHistory(tx: Transaction, bookId: string, period: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_period_revisions where book_id=${bookId} and body->>'reportingPeriod'=${period} order by id collate "C" limit 51`,
    "objects",
  );
}
