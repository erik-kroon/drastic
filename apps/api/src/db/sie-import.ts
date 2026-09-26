import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type BodyRow = { readonly body: Schema.JsonObject };
export type RunRow = {
  readonly id: string;
  readonly planId: string;
  readonly nextOrdinal: number;
  readonly fence: string;
  readonly leaseUntil: string | null;
  readonly status: "running" | "paused" | "staged";
};

export function readSource(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<{ readonly sha256: string; readonly sourceSystem: string }>(
    sql`
    select sha256,source_system as "sourceSystem" from openerp.intake_occurrences where book_id=${bookId} and id=${id}
  `,
    "objects",
  );
}

export function listPreviews(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<{
    readonly body: Schema.JsonObject;
    readonly planId: string | null;
    readonly runId: string | null;
  }>(
    sql`
    select v.body,p.id as "planId",r.id as "runId" from openerp.sie_source_previews v
    left join openerp.sie_source_plans p on p.book_id=v.book_id and p.preview_id=v.id
    left join openerp.sie_source_runs r on r.book_id=p.book_id and r.plan_id=p.id
    where v.book_id=${bookId} and v.occurrence_id=${occurrenceId} order by v.ordinal desc limit 51
  `,
    "objects",
  );
}

export function readPreview(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<BodyRow>(
    sql`select body from openerp.sie_source_previews where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function insertPreview(
  transaction: Transaction,
  bookId: string,
  id: string,
  occurrenceId: string,
  ordinal: number,
  body: Schema.JsonObject,
) {
  return transaction.execute(
    sql`insert into openerp.sie_source_previews(book_id,id,occurrence_id,ordinal,body)
    values(${bookId},${id},${occurrenceId},${ordinal},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function readPlan(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<BodyRow>(
    sql`select body from openerp.sie_source_plans where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function insertPlan(
  transaction: Transaction,
  bookId: string,
  id: string,
  previewId: string,
  body: Schema.JsonObject,
) {
  return transaction.execute(
    sql`insert into openerp.sie_source_plans(book_id,id,preview_id,body)
    values(${bookId},${id},${previewId},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function readRun(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<RunRow>(
    sql`
    select id,plan_id as "planId",next_ordinal as "nextOrdinal",fence::text,
      lease_until::text as "leaseUntil",status from openerp.sie_source_runs where book_id=${bookId} and id=${id}
  `,
    "objects",
  );
}

export function insertRun(transaction: Transaction, bookId: string, row: RunRow) {
  return transaction.execute(
    sql`
    insert into openerp.sie_source_runs(book_id,id,plan_id,next_ordinal,fence,lease_until,status)
    values(${bookId},${row.id},${row.planId},${row.nextOrdinal},${row.fence}::bigint,${row.leaseUntil}::timestamptz,${row.status})
  `,
    "objects",
  );
}

export function advanceRun(transaction: Transaction, bookId: string, row: RunRow) {
  return transaction.execute(
    sql`
    update openerp.sie_source_runs set next_ordinal=${row.nextOrdinal},fence=${row.fence}::bigint,
      lease_until=${row.leaseUntil}::timestamptz,status=${row.status} where book_id=${bookId} and id=${row.id}
  `,
    "objects",
  );
}

export function listChunks(transaction: Transaction, bookId: string, runId: string) {
  return transaction.execute<BodyRow>(
    sql`select body from openerp.sie_source_chunks where book_id=${bookId} and run_id=${runId} order by ordinal`,
    "objects",
  );
}

export function insertChunk(
  transaction: Transaction,
  bookId: string,
  runId: string,
  ordinal: number,
  body: Schema.JsonObject,
) {
  return transaction.execute(
    sql`insert into openerp.sie_source_chunks(book_id,run_id,ordinal,body)
    values(${bookId},${runId},${ordinal},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function insertVouchers(
  transaction: Transaction,
  bookId: string,
  runId: string,
  vouchers: ReadonlyArray<Schema.JsonObject>,
) {
  return transaction.execute(
    sql`
    insert into openerp.sie_source_vouchers(book_id,run_id,ordinal,source_reference,body)
    select ${bookId},${runId},(v->>'ordinal')::integer,v->>'sourceReference',v
    from jsonb_array_elements(${JSON.stringify(vouchers)}::jsonb) v
  `,
    "objects",
  );
}
