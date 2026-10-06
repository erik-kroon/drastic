import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

export const variablePayTables = [
  "payroll_input_assessments",
  "payroll_input_pending_selections",
  "payroll_input_dispositions",
] as const;

type Table = (typeof variablePayTables)[number];

type BodyRow = { readonly body: Schema.JsonObject };

export function record(tx: Transaction, bookId: string, table: Table, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.identifier(table)} where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function related(tx: Transaction, bookId: string, table: Table, inputId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.identifier(table)} where book_id=${bookId} and input_id=${inputId} order by created_at,id collate "C" limit 101`,
    "objects",
  );
}

export function insert(
  tx: Transaction,
  table: Table,
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

export function list(tx: Transaction, bookId: string, cursor: string, limit: number) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_input_assessments where book_id=${bookId} and id collate "C">${cursor} collate "C" order by id collate "C" limit ${limit + 1}`,
    "objects",
  );
}

export function submitter(tx: Transaction, actorId: string) {
  return tx.execute<{ readonly displayName: string }>(
    sql`select name as "displayName" from openerp_auth."user" where id=${actorId}`,
    "objects",
  );
}

export function account(tx: Transaction, bookId: string, accountId: string) {
  return tx.execute<{ readonly code: string }>(
    sql`select code from openerp.accounts where book_id=${bookId} and id=${accountId}`,
    "objects",
  );
}

export function priorVariableInputs(
  tx: Transaction,
  bookId: string,
  employeeId: string,
  inputId: string,
) {
  return tx.execute<{
    readonly body: Schema.JsonObject;
    readonly sourceOccurrenceId: string | null;
    readonly runId: string | null;
    readonly paid: Schema.JsonObject | null;
  }>(
    sql`select i.body,(select o.id from openerp.intake_occurrences o where o.book_id=i.book_id and o.sha256='sha256:'||(i.body->'input'->'evidence'->>'sha256') order by o.id collate "C" limit 1) as "sourceOccurrenceId",c.run_id as "runId",p.body as paid from openerp.payroll_inputs i join openerp.payroll_input_executions e on e.book_id=i.book_id and e.input_id=i.id and e.kind='recognition' left join openerp.payroll_input_consumptions c on c.book_id=i.book_id and c.input_id=i.id left join openerp.payroll_paid_events p on p.book_id=c.book_id and p.run_id=c.run_id and p.employee_id=i.employee_id where i.book_id=${bookId} and i.employee_id=${employeeId} and i.id<>${inputId} and i.body->'input'->'basis'->>'kind'='variable' order by i.id collate "C" limit 101`,
    "objects",
  );
}

export function financialReferences(tx: Transaction, bookId: string, inputId: string) {
  return tx.execute<{ readonly present: boolean }>(
    sql`select exists(select from openerp.payroll_input_executions where book_id=${bookId} and input_id=${inputId}) or exists(select from openerp.payroll_input_reservations where book_id=${bookId} and input_id=${inputId}) or exists(select from openerp.payroll_input_consumptions where book_id=${bookId} and input_id=${inputId}) or exists(select from openerp.payroll_calculations where book_id=${bookId} and body->'basis'->'payrollInputs' @> jsonb_build_array(jsonb_build_object('inputId',${inputId}::text))) as present`,
    "objects",
  );
}

export function sourceForInput(tx: Transaction, bookId: string, sha256: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.intake_occurrences where book_id=${bookId} and sha256=${`sha256:${sha256}`} order by id collate "C" limit 1`,
    "objects",
  );
}
