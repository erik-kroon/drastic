import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

export function readDeltaCandidate(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ body: Schema.JsonObject; sourceSystem: string; sourceAccountId: string }>(
    sql`
    select p.body,o.source_system as "sourceSystem",o.source_account_id as "sourceAccountId"
    from openerp.sie_source_previews p join openerp.intake_occurrences o
      on(o.book_id,o.id)=(p.book_id,p.occurrence_id)
    where p.book_id=${bookId} and p.id=${id}
  `,
    "objects",
  );
}

export function effectiveDeltaSources(bookId: string, excludedDeltaId?: string) {
  return sql`
    select distinct on ("sourceSystem","sourceAccountId","sourceReference","sourceYear") * from (
      select o.source_system as "sourceSystem",o.source_account_id as "sourceAccountId",
        p.source_reference as "sourceReference",v.body,p.voucher_id as "voucherId",p.source_digest as "sourceDigest",
        substring(v.body->>'date',1,4) as "sourceYear",(p.receipt->>'sequence')::numeric as sequence,
        coalesce((select record->'fields'->>3 from jsonb_array_elements(preview.body->'records') record where record->>'ordinal'=v.body->>'recordOrdinal' and record->>'tag'='VER'),'') as description
      from openerp.sie_financial_postings p
      join openerp.sie_financial_runs f on(f.book_id,f.id)=(p.book_id,p.run_id)
      join openerp.sie_source_runs r on(r.book_id,r.id)=(f.book_id,f.source_run_id)
      join openerp.sie_source_plans plan on(plan.book_id,plan.id)=(r.book_id,r.plan_id)
      join openerp.sie_source_previews preview on(preview.book_id,preview.id)=(plan.book_id,plan.preview_id)
      join openerp.intake_occurrences o on(o.book_id,o.id)=(preview.book_id,preview.occurrence_id)
      join openerp.sie_source_vouchers v on(v.book_id,v.run_id,v.ordinal)=(r.book_id,r.id,p.ordinal)
      where p.book_id=${bookId}
      union all
      select e.body->>'sourceSystem',e.body->>'sourceAccountId',e.source_reference,
        e.body->'candidate',e.body->>'effectiveVoucherId',e.body->>'sourceDigest',e.body->>'sourceYear',e.executed_sequence,
        coalesce((select record->'fields'->>3 from jsonb_array_elements(candidate.body->'records') record where record->>'ordinal'=e.body->'candidate'->>'recordOrdinal' and record->>'tag'='VER'),'')
      from openerp.onboarding_delta_effects e
      join openerp.onboarding_source_deltas delta on(delta.book_id,delta.id)=(e.book_id,e.delta_id)
      join openerp.sie_source_previews candidate on(candidate.book_id,candidate.id)=(delta.book_id,delta.candidate_preview_id)
      where e.book_id=${bookId} and (${excludedDeltaId ?? null}::text is null or e.delta_id<>${excludedDeltaId ?? null})
    ) versions order by "sourceSystem","sourceAccountId","sourceReference","sourceYear",sequence desc
  `;
}

export function readDeltaBaseline(
  tx: Transaction,
  bookId: string,
  sourceSystem: string,
  sourceAccountId: string,
  excludedDeltaId?: string,
) {
  return tx.execute<{
    sourceReference: string;
    body: Schema.JsonObject;
    voucherId: string;
    sourceDigest: string;
    description: string;
  }>(
    sql`
    select "sourceReference",body,"voucherId","sourceDigest",description from (${effectiveDeltaSources(bookId, excludedDeltaId)}) effective
    where "sourceSystem"=${sourceSystem} and "sourceAccountId"=${sourceAccountId} and body<>'null'::jsonb
    order by "sourceReference" limit 10001
  `,
    "objects",
  );
}

export function readBaselineMappings(
  tx: Transaction,
  bookId: string,
  sourceSystem: string,
  sourceAccountId: string,
) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`
    select distinct plan.body from openerp.sie_financial_runs f
    join openerp.sie_source_runs r on(r.book_id,r.id)=(f.book_id,f.source_run_id)
    join openerp.sie_source_plans plan on(plan.book_id,plan.id)=(r.book_id,r.plan_id)
    join openerp.sie_source_previews preview on(preview.book_id,preview.id)=(plan.book_id,plan.preview_id)
    join openerp.intake_occurrences o on(o.book_id,o.id)=(preview.book_id,preview.occurrence_id)
    where f.book_id=${bookId} and f.status='posted' and o.source_system=${sourceSystem} and o.source_account_id=${sourceAccountId}
    limit 101
  `,
    "objects",
  );
}

export function readDelta(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.onboarding_source_deltas where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readDeltaDecisions(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.onboarding_source_delta_decisions where book_id=${bookId} and delta_id=${id} order by body->>'decidedAt',id limit 10001`,
    "objects",
  );
}

export function insertDelta(
  tx: Transaction,
  bookId: string,
  id: string,
  previewId: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.onboarding_source_deltas(book_id,id,candidate_preview_id,body) values(${bookId},${id},${previewId},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function insertDeltaDecision(
  tx: Transaction,
  bookId: string,
  id: string,
  deltaId: string,
  actorId: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.onboarding_source_delta_decisions(book_id,id,delta_id,actor_id,body) values(${bookId},${id},${deltaId},${actorId},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function listDeltas(tx: Transaction, bookId: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.onboarding_source_deltas where book_id=${bookId} order by body->>'comparedAt' desc,id desc limit 51`,
    "objects",
  );
}

export function readDeltaProposals(tx: Transaction, bookId: string, deltaId: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.onboarding_delta_proposals where book_id=${bookId} and delta_id=${deltaId} order by body->>'preparedAt',id limit 10001`,
    "objects",
  );
}

export function readDeltaProposal(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.onboarding_delta_proposals where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readDeltaEffects(tx: Transaction, bookId: string, deltaId: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.onboarding_delta_effects where book_id=${bookId} and delta_id=${deltaId} order by executed_sequence limit 10001`,
    "objects",
  );
}

export function insertDeltaProposal(
  tx: Transaction,
  bookId: string,
  id: string,
  deltaId: string,
  sourceReference: string,
  decisionId: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.onboarding_delta_proposals(book_id,id,delta_id,source_reference,decision_id,body) values(${bookId},${id},${deltaId},${sourceReference},${decisionId},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function insertDeltaEffect(
  tx: Transaction,
  bookId: string,
  id: string,
  deltaId: string,
  proposalId: string,
  sourceReference: string,
  executedSequence: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.onboarding_delta_effects(book_id,id,delta_id,proposal_id,source_reference,executed_sequence,body) values(${bookId},${id},${deltaId},${proposalId},${sourceReference},${executedSequence}::numeric,${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function readDeltaPeriod(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{
    fiscalYearId: string;
    startsOn: string;
    endsOn: string;
    basisMode: string | null;
  }>(
    sql`
    select p.fiscal_year_id as "fiscalYearId",p.starts_on::text as "startsOn",p.ends_on::text as "endsOn",h.mode as "basisMode"
    from openerp.periods p left join openerp.historical_bases h on(h.book_id,h.fiscal_year_id)=(p.book_id,p.fiscal_year_id)
    where p.book_id=${bookId} and p.id=${id}`,
    "objects",
  );
}

export function readDeltaPostingReservation(tx: Transaction, bookId: string, changeId: string) {
  return tx.execute<{ id: string; deltaId: string; posted: boolean }>(
    sql`
    select p.id,p.delta_id as "deltaId",exists(select from openerp.onboarding_delta_effects e where e.book_id=p.book_id and e.proposal_id=p.id) as posted
    from openerp.onboarding_delta_proposals p
    where p.book_id=${bookId} and exists(select from jsonb_array_elements(p.body->'changes') c where c->>'id'=${changeId})`,
    "objects",
  );
}
