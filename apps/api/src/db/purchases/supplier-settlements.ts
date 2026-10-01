import {
  supplierSettlementReceipts,
  supplierSettlementSourceClaims,
  supplierSettlementCancellationPlans,
  supplierSettlementCancellationApprovals,
  supplierSettlementCancellationReceipts,
  supplierSettlementCancellationRevocations,
} from "../schema";
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
 select a.actor_id from openerp.supplier_settlement_cancellation_approvals a where a.book_id=${bookId} and a.plan_id=${planId}
 union all select a.actor_id from openerp.supplier_settlement_cancellation_plans p join openerp.approvals a on(a.book_id,a.change_set_id)=(p.book_id,p.payment_change_set_id) where p.book_id=${bookId} and p.id=${planId}
 union all select a.actor_id from openerp.supplier_settlement_cancellation_plans p join openerp.commerce_allocation_reversal_approvals a on(a.book_id,a.plan_id)=(p.book_id,p.allocation_reversal_id) where p.book_id=${bookId} and p.id=${planId}
 union all select a.actor_id from openerp.supplier_settlement_cancellation_plans p join openerp.bank_match_reversal_approvals a on(a.book_id,a.plan_id)=(p.book_id,p.match_reversal_id) where p.book_id=${bookId} and p.id=${planId}
 union all
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

export function readCancellationApprovalBindings(
  tx: Transaction,
  bookId: string,
  approvalId: string,
) {
  return tx.execute<{
    paymentActorId: string;
    allocationActorId: string;
    matchActorId: string;
    paymentPlanId: string;
    allocationPlanId: string;
    matchPlanId: string;
    paymentExpiresAt: string;
    allocationExpiresAt: string;
    matchExpiresAt: string;
  }>(
    sql`
    select p.actor_id as "paymentActorId", a.actor_id as "allocationActorId", m.actor_id as "matchActorId",
      p.change_set_id as "paymentPlanId", a.plan_id as "allocationPlanId", m.plan_id as "matchPlanId",
      p.expires_at::text as "paymentExpiresAt", a.expires_at::text as "allocationExpiresAt", m.expires_at::text as "matchExpiresAt"
    from openerp.supplier_settlement_cancellation_approvals parent
    join openerp.approvals p on (p.book_id,p.id)=(parent.book_id,parent.payment_approval_id)
    join openerp.commerce_allocation_reversal_approvals a on (a.book_id,a.id)=(parent.book_id,parent.allocation_approval_id)
    join openerp.bank_match_reversal_approvals m on (m.book_id,m.id)=(parent.book_id,parent.match_approval_id)
    where parent.book_id=${bookId} and parent.id=${approvalId}
  `,
    "objects",
  );
}

export function readCancellationRevocation(tx: Transaction, bookId: string, approvalId: string) {
  return tx
    .select()
    .from(supplierSettlementCancellationRevocations)
    .where(
      and(
        eq(supplierSettlementCancellationRevocations.bookId, bookId),
        eq(supplierSettlementCancellationRevocations.approvalId, approvalId),
      ),
    );
}

export function listCancellationApprovals(
  tx: Transaction,
  bookId: string,
  planId: string,
  after: string | undefined,
) {
  return tx.execute<{
    id: string;
    approval: Schema.JsonObject;
    revocation: Schema.JsonObject | null;
  }>(
    sql`
    select a.id, a.body as approval, r.body as revocation
    from openerp.supplier_settlement_cancellation_approvals a
    left join openerp.supplier_settlement_cancellation_revocations r
      on (r.book_id,r.approval_id)=(a.book_id,a.id)
    where a.book_id=${bookId} and a.plan_id=${planId} and a.id>${after ?? ""}
    order by a.id limit 26
  `,
    "objects",
  );
}

export function insertCancellationRevocation(
  tx: Transaction,
  bookId: string,
  body: typeof Settlement.SupplierSettlementApprovalRevocation.Type,
) {
  return tx.insert(supplierSettlementCancellationRevocations).values({
    bookId,
    approvalId: body.approvalId,
    body,
  });
}

export function readReceipt(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementReceipts)
    .where(
      and(eq(supplierSettlementReceipts.bookId, bookId), eq(supplierSettlementReceipts.id, id)),
    );
}

export function readReceiptByPlan(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementReceipts)
    .where(
      and(eq(supplierSettlementReceipts.bookId, bookId), eq(supplierSettlementReceipts.planId, id)),
    );
}

export function readReceiptByAllocation(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementReceipts)
    .where(
      and(
        eq(supplierSettlementReceipts.bookId, bookId),
        eq(supplierSettlementReceipts.allocationReceiptId, id),
      ),
    );
}

export function readReceiptByVoucher(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementReceipts)
    .where(
      and(
        eq(supplierSettlementReceipts.bookId, bookId),
        eq(supplierSettlementReceipts.voucherId, id),
      ),
    );
}

export function readReceiptBySource(
  tx: Transaction,
  bookId: string,
  statement: string,
  ordinal: number,
) {
  return tx
    .select()
    .from(supplierSettlementReceipts)
    .where(
      and(
        eq(supplierSettlementReceipts.bookId, bookId),
        eq(supplierSettlementReceipts.statementId, statement),
        eq(supplierSettlementReceipts.rowOrdinal, ordinal),
      ),
    );
}

export function readClaim(tx: Transaction, bookId: string, statement: string, ordinal: number) {
  return tx
    .select()
    .from(supplierSettlementSourceClaims)
    .where(
      and(
        eq(supplierSettlementSourceClaims.bookId, bookId),
        eq(supplierSettlementSourceClaims.statementId, statement),
        eq(supplierSettlementSourceClaims.rowOrdinal, ordinal),
      ),
    );
}

export function insertClaim(
  tx: Transaction,
  bookId: string,
  plan: typeof Settlement.SupplierSettlementPlan.Type,
  receiptId: string,
) {
  return tx.insert(supplierSettlementSourceClaims).values({
    bookId,
    statementId: plan.input.statementId,
    rowOrdinal: plan.input.rowOrdinal,
    planId: plan.id,
    receiptId,
  });
}

export function insertReceipt(
  tx: Transaction,
  plan: typeof Settlement.SupplierSettlementPlan.Type,
  body: typeof Settlement.SupplierSettlementReceipt.Type,
) {
  return tx.insert(supplierSettlementReceipts).values({
    bookId: plan.scope.bookId,
    id: body.id,
    planId: plan.id,
    approvalId: body.approvalId,
    statementId: plan.input.statementId,
    rowOrdinal: plan.input.rowOrdinal,
    invoiceId: plan.input.invoiceId,
    voucherId: body.postingReceipt.voucherId,
    allocationReceiptId: body.allocationReceipt.id,
    body,
  });
}

export function insertCancellationPlan(
  tx: Transaction,
  body: typeof Settlement.SupplierSettlementCancellationPlan.Type,
) {
  return tx.insert(supplierSettlementCancellationPlans).values({
    bookId: body.scope.bookId,
    id: body.id,
    settlementReceiptId: body.original.id,
    paymentChangeSetId: body.paymentPlan.id,
    allocationReversalId: body.allocationReversal.id,
    matchReversalId: body.matchReversal.id,
    body,
  });
}

export function readCancellationPlan(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementCancellationPlans)
    .where(
      and(
        eq(supplierSettlementCancellationPlans.bookId, bookId),
        eq(supplierSettlementCancellationPlans.id, id),
      ),
    );
}

export function readCancellationPostingChild(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementCancellationPlans)
    .where(
      and(
        eq(supplierSettlementCancellationPlans.bookId, bookId),
        eq(supplierSettlementCancellationPlans.paymentChangeSetId, id),
      ),
    );
}

export function readCancellationByAllocationReversal(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementCancellationPlans)
    .where(
      and(
        eq(supplierSettlementCancellationPlans.bookId, bookId),
        eq(supplierSettlementCancellationPlans.allocationReversalId, id),
      ),
    );
}

export function readCancellationByMatchReversal(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementCancellationPlans)
    .where(
      and(
        eq(supplierSettlementCancellationPlans.bookId, bookId),
        eq(supplierSettlementCancellationPlans.matchReversalId, id),
      ),
    );
}

export function insertCancellationApproval(
  tx: Transaction,
  body: typeof Settlement.SupplierSettlementCancellationApproval.Type,
) {
  return tx.insert(supplierSettlementCancellationApprovals).values({
    bookId: body.scope.bookId,
    id: body.id,
    planId: body.planId,
    actorId: body.actorId,
    paymentApprovalId: body.paymentApprovalId,
    allocationApprovalId: body.allocationApprovalId,
    matchApprovalId: body.matchApprovalId,
    body,
  });
}

export function readCancellationApproval(tx: Transaction, bookId: string, id: string) {
  return tx
    .select()
    .from(supplierSettlementCancellationApprovals)
    .where(
      and(
        eq(supplierSettlementCancellationApprovals.bookId, bookId),
        eq(supplierSettlementCancellationApprovals.id, id),
      ),
    );
}

export function readCancellationReceipt(tx: Transaction, bookId: string, receiptId: string) {
  return tx
    .select()
    .from(supplierSettlementCancellationReceipts)
    .where(
      and(
        eq(supplierSettlementCancellationReceipts.bookId, bookId),
        eq(supplierSettlementCancellationReceipts.settlementReceiptId, receiptId),
      ),
    );
}

export function insertCancellationReceipt(
  tx: Transaction,
  body: typeof Settlement.SupplierSettlementCancellationReceipt.Type,
) {
  return tx.insert(supplierSettlementCancellationReceipts).values({
    bookId: body.scope.bookId,
    id: body.id,
    planId: body.planId,
    approvalId: body.approvalId,
    settlementReceiptId: body.settlementReceiptId,
    body,
  });
}

export function readLaterSettlement(tx: Transaction, bookId: string, receiptId: string) {
  return tx.execute<{ present: boolean }>(
    sql`select exists(select from openerp.supplier_settlement_receipts r join openerp.vouchers v on(v.book_id,v.id)=(r.book_id,r.voucher_id) join openerp.supplier_settlement_receipts o on o.book_id=r.book_id and o.id=${receiptId} join openerp.vouchers ov on(ov.book_id,ov.id)=(o.book_id,o.voucher_id) where r.book_id=${bookId} and r.invoice_id=o.invoice_id and v.sequence>ov.sequence and not exists(select from openerp.supplier_settlement_cancellation_receipts c where(c.book_id,c.settlement_receipt_id)=(r.book_id,r.id))) as present`,
    "objects",
  );
}

export function readPlansByEvent(tx: Transaction, bookId: string, eventId: string) {
  return tx
    .select()
    .from(supplierSettlementPlans)
    .where(
      and(
        eq(supplierSettlementPlans.bookId, bookId),
        sql`${supplierSettlementPlans.body}->'paymentPlan'->'groups'->0->'actions'->0->>'eventId'=${eventId}`,
      ),
    );
}

export function listRetainedPlans(tx: Transaction, bookId: string, after: string | undefined) {
  return tx.execute<{ id: string; kind: "settlement" | "cancellation"; receiptId: string | null }>(
    sql`
      select p.id, 'settlement'::text as kind, r.id as "receiptId"
      from openerp.supplier_settlement_plans p
      left join openerp.supplier_settlement_receipts r on (r.book_id,r.plan_id)=(p.book_id,p.id)
      where p.book_id=${bookId} and p.id>${after ?? ""}
      union all
      select p.id, 'cancellation'::text as kind, r.id as "receiptId"
      from openerp.supplier_settlement_cancellation_plans p
      left join openerp.supplier_settlement_cancellation_receipts r on (r.book_id,r.plan_id)=(p.book_id,p.id)
      where p.book_id=${bookId} and p.id>${after ?? ""}
      order by id limit 26
    `,
    "objects",
  );
}

export function readCancellationReceiptByPlan(tx: Transaction, bookId: string, planId: string) {
  return tx
    .select()
    .from(supplierSettlementCancellationReceipts)
    .where(
      and(
        eq(supplierSettlementCancellationReceipts.bookId, bookId),
        eq(supplierSettlementCancellationReceipts.planId, planId),
      ),
    );
}
