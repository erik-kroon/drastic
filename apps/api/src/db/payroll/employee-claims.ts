import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Claims from "@open-erp/contracts/employee-claims";
import type { Transaction } from "../transaction";

export const claimRecordTables = [
  "employee_claim_revisions",
  "employee_claim_reviews",
  "employee_claim_completion_requests",
  "employee_claim_recognitions",
  "employee_claim_instructions",
  "employee_claim_payee_proposals",
  "employee_claim_payee_verifications",
  "employee_claim_payment_previews",
  "employee_claim_payment_exports",
  "employee_claim_settlement_reviews",
  "employee_claim_settlements",
] as const;

export const claimTables = [
  "employee_claims",
  ...claimRecordTables,
  "employee_claim_payroll_reservations",
  "employee_claim_payroll_consumptions",
] as const;

type RecordTable = (typeof claimRecordTables)[number];

type BodyRow = { readonly body: Schema.JsonObject };

export function record(tx: Transaction, bookId: string, table: RecordTable, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.raw(table)} where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function records(tx: Transaction, bookId: string, table: RecordTable, claimId: string) {
  const order =
    table === "employee_claim_revisions" ? sql`revision` : sql`(body->>'createdAt')::timestamptz`;

  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.raw(table)} where book_id=${bookId} and claim_id=${claimId} order by ${order},id collate "C" limit 51`,
    "objects",
  );
}

export function insertRecord(
  tx: Transaction,
  table: RecordTable,
  bookId: string,
  id: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.${sql.raw(table)}(book_id,id,body) values(${bookId},${id},${JSON.stringify(body)}::jsonb)`,
  );
}

export function insertClaim(
  tx: Transaction,
  bookId: string,
  id: string,
  input: typeof Claims.SubmitEmployeeClaim.Type,
) {
  return tx.execute(
    sql`insert into openerp.employee_claims(book_id,id,claim_key,employee_id,month) values(${bookId},${id},${input.claimKey},${input.employeeId},${input.month})`,
  );
}

export function roots(tx: Transaction, bookId: string, after: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.employee_claims where book_id=${bookId} and id collate "C">${after} collate "C" order by id collate "C" limit 26`,
    "objects",
  );
}

export function claimKey(tx: Transaction, bookId: string, claimKey: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.employee_claims where book_id=${bookId} and claim_key=${claimKey}`,
    "objects",
  );
}

export function inputControl(tx: Transaction, bookId: string, inputId: string) {
  return tx.execute<{
    readonly id: string;
    readonly inputReviewId: string;
    readonly body: Schema.JsonObject;
  }>(
    sql`select id,input_review_id as "inputReviewId",body from openerp.employee_claim_reviews where book_id=${bookId} and input_id=${inputId}`,
    "objects",
  );
}

export function planControl(
  tx: Transaction,
  bookId: string,
  changeId: string,
  eventId: string | null = null,
) {
  return tx.execute<{
    readonly id: string;
    readonly kind: "employee_claim" | "employee_claim_settlement";
    readonly body: Schema.JsonObject;
  }>(
    sql`
    select id,'employee_claim'::text as kind,body from openerp.employee_claim_reviews where book_id=${bookId} and (change_set_id=${changeId} or event_id=${eventId})
    union all select id,'employee_claim_settlement',body from openerp.employee_claim_settlement_reviews where book_id=${bookId} and (change_set_id=${changeId} or event_id=${eventId})`,
    "objects",
  );
}

export function instructionRecords(
  tx: Transaction,
  bookId: string,
  table:
    | "employee_claim_payment_previews"
    | "employee_claim_payment_exports"
    | "employee_claim_settlement_reviews"
    | "employee_claim_settlements",
  instructionId: string,
) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.raw(table)} where book_id=${bookId} and instruction_id=${instructionId} order by (body->>'createdAt')::timestamptz,id collate "C" limit 51`,
    "objects",
  );
}

export function readReservation(tx: Transaction, bookId: string, instructionId: string) {
  return tx.execute<{ readonly runId: string; readonly snapshot: Schema.JsonObject }>(
    sql`select r.run_id as "runId",r.snapshot from openerp.employee_claim_payroll_reservations r where r.book_id=${bookId} and r.instruction_id=${instructionId} and not exists(select from openerp.payroll_run_reservation_releases x where x.book_id=r.book_id and x.approval_id=r.approval_id) order by r.approval_id collate "C"`,
    "objects",
  );
}

export function readConsumption(tx: Transaction, bookId: string, instructionId: string) {
  return tx.execute<{ readonly runId: string }>(
    sql`select run_id as "runId" from openerp.employee_claim_payroll_consumptions where book_id=${bookId} and instruction_id=${instructionId}`,
    "objects",
  );
}

export function reserve(
  tx: Transaction,
  bookId: string,
  runId: string,
  approvalId: string,
  snapshot: typeof Claims.ClaimPayrollSnapshot.Type,
) {
  return tx.execute(
    sql`insert into openerp.employee_claim_payroll_reservations(book_id,instruction_id,run_id,approval_id,snapshot) values(${bookId},${snapshot.instructionId},${runId},${approvalId},${JSON.stringify(snapshot)}::jsonb)`,
  );
}

export function consume(
  tx: Transaction,
  bookId: string,
  runId: string,
  snapshot: typeof Claims.ClaimPayrollSnapshot.Type,
) {
  return tx.execute(
    sql`insert into openerp.employee_claim_payroll_consumptions(book_id,instruction_id,run_id,employee_id,amount_minor,snapshot) values(${bookId},${snapshot.instructionId},${runId},${snapshot.employeeId},${snapshot.amountMinor}::numeric,${JSON.stringify(snapshot)}::jsonb)`,
  );
}

export function expiredReservations(tx: Transaction, bookId: string) {
  return tx.execute<{ readonly approvalId: string; readonly runId: string }>(
    sql`select distinct r.approval_id as "approvalId",r.run_id as "runId" from openerp.employee_claim_payroll_reservations r join openerp.approvals a on a.book_id=r.book_id and a.id=r.approval_id where r.book_id=${bookId} and (a.expires_at<=clock_timestamp() or exists(select from openerp.posting_approval_revocations v where v.book_id=a.book_id and v.approval_id=a.id)) and not exists(select from openerp.payroll_run_executions e where e.book_id=r.book_id and e.run_id=r.run_id) and not exists(select from openerp.payroll_run_reservation_releases x where x.book_id=r.book_id and x.approval_id=r.approval_id)`,
    "objects",
  );
}

export function sourceControl(
  tx: Transaction,
  bookId: string,
  counterpartyId: string,
  documentNumber: string,
) {
  return tx.execute<{ readonly claimId: string }>(
    sql`select distinct claim_id as "claimId" from openerp.employee_claim_revisions r cross join lateral jsonb_array_elements(r.body->'items') item where r.book_id=${bookId} and item->>'outcome'='qualified' and item->'receipt'->>'counterpartyId'=${counterpartyId} and item->'receipt'->>'supplierDocumentNumber'=${documentNumber}`,
    "objects",
  );
}

export function evidenceControl(
  tx: Transaction,
  bookId: string,
  eventId: string | null,
  evidenceIds: ReadonlyArray<string>,
) {
  return tx.execute<{ readonly present: boolean }>(
    sql`with evidence(id) as (select jsonb_array_elements_text(${JSON.stringify(evidenceIds)}::jsonb) union select evidence_id from openerp.events where book_id=${bookId} and id=${eventId}) select exists(select from openerp.employee_claim_revisions r cross join lateral jsonb_array_elements(r.body->'items') item join openerp.expense_tax_source_revisions t on t.book_id=r.book_id and t.source_id=item->'selection'->>'taxSourceId' and t.body->>'digest'=item->'selection'->>'taxSourceDigest' where r.book_id=${bookId} and item->>'outcome'='qualified' and t.evidence_id in(select id from evidence)) or exists(select from openerp.employee_claim_settlement_reviews r where r.book_id=${bookId} and r.body->'input'->>'evidenceId' in(select id from evidence)) as present`,
    "objects",
  );
}
