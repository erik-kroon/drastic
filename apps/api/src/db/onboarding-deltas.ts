import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

export function readDeltaCandidate(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ body: Schema.JsonObject; sourceSystem: string; sourceAccountId: string }>(sql`
    select p.body,o.source_system as "sourceSystem",o.source_account_id as "sourceAccountId"
    from openerp.sie_source_previews p join openerp.intake_occurrences o
      on(o.book_id,o.id)=(p.book_id,p.occurrence_id)
    where p.book_id=${bookId} and p.id=${id}
  `,"objects");
}

export function readDeltaBaseline(tx: Transaction, bookId: string, sourceSystem: string, sourceAccountId: string) {
  return tx.execute<{ sourceReference: string; body: Schema.JsonObject; voucherId: string; sourceDigest: string }>(sql`
    select p.source_reference as "sourceReference",v.body,p.voucher_id as "voucherId",p.source_digest as "sourceDigest"
    from openerp.sie_financial_postings p
    join openerp.sie_financial_runs f on(f.book_id,f.id)=(p.book_id,p.run_id)
    join openerp.sie_source_runs r on(r.book_id,r.id)=(f.book_id,f.source_run_id)
    join openerp.sie_source_plans plan on(plan.book_id,plan.id)=(r.book_id,r.plan_id)
    join openerp.sie_source_previews preview on(preview.book_id,preview.id)=(plan.book_id,plan.preview_id)
    join openerp.intake_occurrences o on(o.book_id,o.id)=(preview.book_id,preview.occurrence_id)
    join openerp.sie_source_vouchers v on(v.book_id,v.run_id,v.ordinal)=(r.book_id,r.id,p.ordinal)
    where p.book_id=${bookId} and o.source_system=${sourceSystem} and o.source_account_id=${sourceAccountId}
    order by p.source_reference limit 10001
  `,"objects");
}

export function readDelta(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ body: Schema.JsonObject }>(sql`select body from openerp.onboarding_source_deltas where book_id=${bookId} and id=${id}`,"objects");
}

export function readDeltaDecisions(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ body: Schema.JsonObject }>(sql`select body from openerp.onboarding_source_delta_decisions where book_id=${bookId} and delta_id=${id} order by body->>'decidedAt',id limit 10001`,"objects");
}

export function insertDelta(tx: Transaction, bookId: string, id: string, previewId: string, body: Schema.JsonObject) {
  return tx.execute(sql`insert into openerp.onboarding_source_deltas(book_id,id,candidate_preview_id,body) values(${bookId},${id},${previewId},${JSON.stringify(body)}::jsonb)`,"objects");
}

export function insertDeltaDecision(tx: Transaction, bookId: string, id: string, deltaId: string, actorId: string, body: Schema.JsonObject) {
  return tx.execute(sql`insert into openerp.onboarding_source_delta_decisions(book_id,id,delta_id,actor_id,body) values(${bookId},${id},${deltaId},${actorId},${JSON.stringify(body)}::jsonb)`,"objects");
}
