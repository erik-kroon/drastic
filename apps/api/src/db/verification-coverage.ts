import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

export function readCapture(tx: Transaction, bookId: string, periodId: string, id?: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.close_predicate_captures where book_id=${bookId} and period_id=${periodId} ${id === undefined ? sql`` : sql`and id=${id}`} order by ordinal desc limit 1`,
    "objects",
  );
}

export function insertCapture(
  tx: Transaction,
  row: {
    bookId: string;
    id: string;
    periodId: string;
    key: string;
    actorId: string;
    digest: string;
    body: Schema.JsonObject;
  },
) {
  return tx.execute<{ id: string }>(
    sql`insert into openerp.close_predicate_captures(book_id,id,period_id,command_key,actor_id,digest,body) values(${row.bookId},${row.id},${row.periodId},${row.key},${row.actorId},${row.digest},${JSON.stringify(row.body)}::jsonb) on conflict(book_id,command_key) do nothing returning id`,
    "objects",
  );
}

export function readQuestionInventory(tx: Transaction, bookId: string) {
  return tx.execute<{
    digest: string;
    total: string;
    unresolved: string;
    incomplete: string;
    refs: Schema.Json[];
  }>(
    sql`with heads as materialized (select q.id,r.revision::text as revision,r.state,r.digest from openerp.workspace_questions q left join lateral (select revision,state,openerp.digest(jsonb_build_object('questionId',question_id,'revision',revision,'state',state,'waitingOn',waiting_on)) as digest from openerp.workspace_question_revisions r where r.book_id=q.book_id and r.question_id=q.id order by revision desc limit 1) r on true where q.book_id=${bookId}) select openerp.digest(coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'state',state,'digest',digest) order by id collate "C"),'[]'::jsonb)) as digest,count(*)::text as total,count(*) filter(where state<>'closed')::text as unresolved,count(*) filter(where revision is null or digest is null or digest !~ '^sha256:[0-9a-f]{64}$')::text as incomplete,coalesce(jsonb_agg(jsonb_build_object('owner','workspace_question','id',id,'digest',digest) order by id collate "C") filter(where digest ~ '^sha256:[0-9a-f]{64}$'),'[]'::jsonb) as refs from heads`,
    "objects",
  );
}
