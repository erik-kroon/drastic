import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Contracts from "@open-erp/contracts/historical-adoptions";
import type { Transaction } from "./transaction";

type BodyRow = { readonly body: Schema.JsonObject };

export function reviewerName(tx: Transaction, actor: string) {
  return tx.execute<{ readonly name: string }>(
    sql`select name from openerp.actors where id=${actor}`,
    "objects",
  );
}

export function readLatestRevision(tx: Transaction, book: string, pool: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_pool_revisions where book_id=${book} and pool_id=${pool} order by ordinal desc limit 1`,
    "objects",
  );
}

export function insertRevision(
  tx: Transaction,
  book: string,
  revision: typeof Contracts.PoolRevision.Type,
) {
  return tx.execute(
    sql`insert into openerp.historical_pool_revisions(book_id,id,pool_id,ordinal,admission_id,digest,body) values(${book},${revision.id},${revision.poolId},${revision.ordinal},${revision.input.admissionId},${revision.digest},${JSON.stringify(revision)}::jsonb)`,
    "objects",
  );
}

export function listPlans(tx: Transaction, book: string, after: string | null) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_adoption_plans where book_id=${book} and (${after}::text is null or id collate "C">${after}) order by id collate "C" limit 21`,
    "objects",
  );
}

export function readPlanApprovals(tx: Transaction, book: string, plan: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_adoption_approvals where book_id=${book} and plan_id=${plan} order by expires_at desc,id limit 21`,
    "objects",
  );
}

export function readPool(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_control_pools where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function readPoolForSource(
  tx: Transaction,
  book: string,
  admission: string,
  account: string,
) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_control_pools where book_id=${book} and admission_id=${admission} and source_account=${account}`,
    "objects",
  );
}

export function readPoolForControl(
  tx: Transaction,
  book: string,
  account: string,
  direction: string,
) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_control_pools where book_id=${book} and control_account_id=${account} and direction=${direction}`,
    "objects",
  );
}

export function insertPool(tx: Transaction, book: string, pool: typeof Contracts.Pool.Type) {
  return tx.execute(
    sql`insert into openerp.historical_control_pools(book_id,id,admission_id,source_account,control_account_id,cutover_on,direction,digest,body) values(${book},${pool.id},${pool.input.admissionId},${pool.input.sourceAccount},${pool.controlAccountId},${pool.input.cutoverOn}::date,${pool.input.direction},${pool.digest},${JSON.stringify(pool)}::jsonb)`,
    "objects",
  );
}

export function readPlan(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_adoption_plans where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function insertPlan(
  tx: Transaction,
  book: string,
  plan: typeof Contracts.AdoptionPlan.Type,
) {
  return tx.execute(
    sql`insert into openerp.historical_adoption_plans(book_id,id,pool_id,digest,body) values(${book},${plan.id},${plan.input.poolId},${plan.digest},${JSON.stringify(plan)}::jsonb)`,
    "objects",
  );
}

export function readAdoptions(tx: Transaction, book: string, pool: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_adoptions where book_id=${book} and pool_id=${pool} order by id`,
    "objects",
  );
}

export function readKnownIdentities(tx: Transaction, book: string, sourceSystem: string) {
  return tx.execute<{ readonly sourceIdentity: string }>(
    sql`select source_identity as "sourceIdentity" from openerp.historical_adoptions where book_id=${book} and source_system=${sourceSystem} order by source_identity`,
    "objects",
  );
}

export function readAdoption(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_adoptions where book_id=${book} and (id=${id} or body->>'liveObligationId'=${id})`,
    "objects",
  );
}

export function readAdoptionForPlan(tx: Transaction, book: string, plan: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_adoptions where book_id=${book} and plan_id=${plan}`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  approval: typeof Contracts.Approval.Type,
) {
  return tx.execute(
    sql`insert into openerp.historical_adoption_approvals(book_id,id,plan_id,actor_id,expires_at,body) values(${book},${approval.id},${approval.planId},${approval.actorId},${approval.expiresAt}::timestamptz,${JSON.stringify(approval)}::jsonb)`,
    "objects",
  );
}

export function readApproval(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select a.body from openerp.historical_adoption_approvals a join openerp.memberships m on m.book_id=a.book_id and m.actor_id=a.actor_id left join openerp.identity_admissions i on i.actor_id=a.actor_id where a.book_id=${book} and a.id=${id} and a.expires_at>clock_timestamp() and m.role='operator' and coalesce(i.enabled,true) and not exists(select from openerp.historical_adoptions x where x.book_id=a.book_id and x.approval_id=a.id)`,
    "objects",
  );
}

export function insertAdoption(
  tx: Transaction,
  book: string,
  sourcePlan: string,
  sourceSystem: string,
  adoption: typeof Contracts.Adoption.Type,
) {
  return tx.execute(
    sql`insert into openerp.historical_adoptions(book_id,id,plan_id,pool_id,source_plan_id,source_system,source_identity,approval_id,amount_minor,body) values(${book},${adoption.id},${adoption.planId},${adoption.poolId},${sourcePlan},${sourceSystem},${adoption.sourceIdentity},${adoption.approvalId},${adoption.openingResidualMinor}::bigint,${JSON.stringify(adoption)}::jsonb)`,
    "objects",
  );
}

export function readLiveRun(tx: Transaction, book: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.sie_financial_runs where book_id=${book} and status in('running','paused')`,
    "objects",
  );
}

export function readPostedRun(tx: Transaction, book: string, sourcePlan: string) {
  return tx.execute<{ readonly id: string; readonly partitionId: string | null }>(
    sql`select r.id,r.partition_id as "partitionId" from openerp.sie_financial_runs r join openerp.sie_source_runs s on s.book_id=r.book_id and s.id=r.source_run_id where r.book_id=${book} and s.plan_id=${sourcePlan} and r.status='posted'`,
    "objects",
  );
}

export function readNativeDuplicates(
  tx: Transaction,
  book: string,
  account: string,
  cutover: string,
) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.commerce_invoices where book_id=${book} and control_account_id=${account} and issued_on<=${cutover}::date`,
    "objects",
  );
}
