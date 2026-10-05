import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Contracts from "@open-erp/contracts/historical-adoptions";
import type { Transaction } from "../transaction";

type BodyRow = { readonly body: Schema.JsonObject };

export function readSettlements(tx: Transaction, book: string, adoption: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.commerce_historical_settlements where book_id=${book} and adoption_id=${adoption} order by id`,
    "objects",
  );
}

export function readPlan(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.commerce_historical_settlement_plans where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function insertPlan(
  tx: Transaction,
  book: string,
  plan: typeof Contracts.SettlementPlan.Type,
) {
  return tx.execute(
    sql`insert into openerp.commerce_historical_settlement_plans(book_id,id,adoption_id,digest,body) values(${book},${plan.id},${plan.input.adoptionId},${plan.digest},${JSON.stringify(plan)}::jsonb)`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  approval: typeof Contracts.Approval.Type,
) {
  return tx.execute(
    sql`insert into openerp.commerce_historical_settlement_approvals(book_id,id,plan_id,actor_id,expires_at,body) values(${book},${approval.id},${approval.planId},${approval.actorId},${approval.expiresAt}::timestamptz,${JSON.stringify(approval)}::jsonb)`,
    "objects",
  );
}

export function readApproval(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select a.body from openerp.commerce_historical_settlement_approvals a join openerp.memberships m on m.book_id=a.book_id and m.actor_id=a.actor_id left join openerp.identity_admissions i on i.actor_id=a.actor_id where a.book_id=${book} and a.id=${id} and a.expires_at>clock_timestamp() and m.role='operator' and coalesce(i.enabled,true) and not exists(select from openerp.commerce_historical_settlements x where x.book_id=a.book_id and x.approval_id=a.id)`,
    "objects",
  );
}

export function readSettlementForPlan(tx: Transaction, book: string, plan: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.commerce_historical_settlements where book_id=${book} and plan_id=${plan}`,
    "objects",
  );
}

export function insertSettlement(
  tx: Transaction,
  book: string,
  settlement: typeof Contracts.Settlement.Type,
) {
  return tx.execute(
    sql`insert into openerp.commerce_historical_settlements(book_id,id,plan_id,adoption_id,approval_id,payment_voucher_id,payment_line_id,amount_minor,body) values(${book},${settlement.id},${settlement.planId},${settlement.adoptionId},${settlement.approvalId},${settlement.paymentVoucherId},${settlement.paymentLineId},${settlement.amountMinor}::bigint,${JSON.stringify(settlement)}::jsonb)`,
    "objects",
  );
}
