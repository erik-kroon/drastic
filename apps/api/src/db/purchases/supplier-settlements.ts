import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Settlement from "@open-erp/contracts/supplier-settlements";
import {
  supplierSettlementPlans,
  supplierSettlementApprovals,
  supplierSettlementRevocations,
} from "../schema";
import type { Transaction } from "../transaction";

export function insertPlan(tx: Transaction, plan: typeof Settlement.SupplierSettlementPlan.Type) {
  return tx.insert(supplierSettlementPlans).values({
    bookId: plan.scope.bookId,
    id: plan.id,
    invoiceId: plan.input.invoiceId,
    statementId: plan.input.statementId,
    rowOrdinal: plan.input.rowOrdinal,
    paymentChangeSetId: plan.paymentPlan.id,
    allocationPlanId: plan.pendingAllocation.id,
    reservedVoucherId: plan.reservedVoucherId,
    controlLineId: plan.controlLineId,
    bankLineId: plan.bankLineId,
    body: plan,
  });
}

export function readPlan(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementPlans)
    .where(and(eq(supplierSettlementPlans.bookId, bookId), eq(supplierSettlementPlans.id, id)));
}

export function readPostingChild(tx: Transaction, bookId: string, changeId: string) {
  return tx
    .select()
    .from(supplierSettlementPlans)
    .where(
      and(
        eq(supplierSettlementPlans.bookId, bookId),
        eq(supplierSettlementPlans.paymentChangeSetId, changeId),
      ),
    );
}

export function readAllocationChild(tx: Transaction, bookId: string, allocationId: string) {
  return tx
    .select()
    .from(supplierSettlementPlans)
    .where(
      and(
        eq(supplierSettlementPlans.bookId, bookId),
        eq(supplierSettlementPlans.allocationPlanId, allocationId),
      ),
    );
}

export function readReservation(tx: Transaction, bookId: string, voucherId: string) {
  return tx
    .select()
    .from(supplierSettlementPlans)
    .where(
      and(
        eq(supplierSettlementPlans.bookId, bookId),
        eq(supplierSettlementPlans.reservedVoucherId, voucherId),
      ),
    );
}

export function insertApproval(
  tx: Transaction,
  approval: typeof Settlement.SupplierSettlementApproval.Type,
) {
  return tx.insert(supplierSettlementApprovals).values({
    bookId: approval.scope.bookId,
    id: approval.id,
    planId: approval.planId,
    actorId: approval.actorId,
    paymentApprovalId: approval.paymentApprovalId,
    allocationApprovalId: approval.allocationApprovalId,
    body: approval,
  });
}

export function readApproval(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementApprovals)
    .where(
      and(eq(supplierSettlementApprovals.bookId, bookId), eq(supplierSettlementApprovals.id, id)),
    );
}

export function readApprovals(tx: Transaction, bookId: string, planId: string) {
  return tx
    .select()
    .from(supplierSettlementApprovals)
    .where(
      and(
        eq(supplierSettlementApprovals.bookId, bookId),
        eq(supplierSettlementApprovals.planId, planId),
      ),
    )
    .orderBy(supplierSettlementApprovals.createdAt, supplierSettlementApprovals.id);
}

export function readRevocation(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementRevocations)
    .where(
      and(
        eq(supplierSettlementRevocations.bookId, bookId),
        eq(supplierSettlementRevocations.approvalId, id),
      ),
    );
}

export function insertRevocation(
  tx: Transaction,
  bookId: string,
  body: typeof Settlement.SupplierSettlementApprovalRevocation.Type,
) {
  return tx
    .insert(supplierSettlementRevocations)
    .values({ bookId, approvalId: body.approvalId, body });
}

export function readSourceState(
  tx: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return tx.execute<{ ambiguous: boolean; occupied: boolean; sourceRevision: string }>(
    sql`
    select exists(select from openerp.bank_statements x where x.book_id=s.book_id and x.id<>s.id
      and x.account_id=s.account_id and x.starts_on<=s.ends_on and x.ends_on>=s.starts_on) or
      (select count(*) from openerp.bank_sources x where x.book_id=s.book_id and
       (x.account_id=s.account_id or x.source_bank_account_id=s.source_bank_account_id))<>1 as ambiguous,
      exists(select from openerp.bank_matches m where m.book_id=s.book_id and m.statement_id=s.id and m.row_ordinal=${rowOrdinal}) or
      exists(select from openerp.bank_active_allocation_legs a where a.book_id=s.book_id and a.statement_id=s.id and a.row_ordinal=${rowOrdinal}) as occupied,
      b.revision::text as "sourceRevision"
    from openerp.bank_statements s join openerp.bank_sources b on b.book_id=s.book_id and b.account_id=s.account_id
      and b.source_bank_account_id=s.source_bank_account_id
    where s.book_id=${bookId} and s.id=${statementId}`,
    "objects",
  );
}

export function readApprovalActors(tx: Transaction, bookId: string, planId: string) {
  return tx.execute<{ actorId: string }>(
    sql`select distinct actor_id as "actorId" from (
    select a.actor_id from openerp.supplier_settlement_approvals a where a.book_id=${bookId} and a.plan_id=${planId}
    union select p.actor_id from openerp.approvals p join openerp.supplier_settlement_approvals a
      on a.book_id=p.book_id and a.payment_approval_id=p.id where a.book_id=${bookId} and a.plan_id=${planId}
    union select p.actor_id from openerp.commerce_allocation_approvals p join openerp.supplier_settlement_approvals a
      on a.book_id=p.book_id and a.allocation_approval_id=p.id where a.book_id=${bookId} and a.plan_id=${planId}
    ) reviewers order by actor_id`,
    "objects",
  );
}

export type JsonObject = Schema.JsonObject;
