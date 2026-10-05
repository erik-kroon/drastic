import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Loans from "@open-erp/contracts/treasury-loans";
import type { Transaction } from "../transaction";

type BodyRow = { readonly body: Schema.JsonObject };

export const loanTables = [
  "treasury_loans",
  "treasury_loan_account_roles",
  "treasury_loan_rates",
  "treasury_loan_reviews",
  "treasury_loan_approvals",
  "treasury_loan_events",
  "treasury_loan_allocations",
] as const;

export function readLoan(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.treasury_loans where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function readAdoption(tx: Transaction, book: string, effect: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.treasury_loans where book_id=${book} and principal_effect_id=${effect}`,
    "objects",
  );
}

export function rates(tx: Transaction, book: string, loan: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.treasury_loan_rates where book_id=${book} and loan_id=${loan} order by effective_on limit 1001`,
    "objects",
  );
}

export function events(tx: Transaction, book: string, loan: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.treasury_loan_events where book_id=${book} and loan_id=${loan} order by posting_date,id collate "C" limit 1001`,
    "objects",
  );
}

export function readReview(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.treasury_loan_reviews where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function readReviewByPlan(tx: Transaction, book: string, plan: string, event?: string) {
  return tx.execute<{ readonly id: string; readonly body: Schema.JsonObject }>(
    sql`select id,body from openerp.treasury_loan_reviews where book_id=${book} and (change_set_id=${plan} or event_id=${event ?? null})`,
    "objects",
  );
}

export function approvals(tx: Transaction, book: string, review: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.treasury_loan_approvals where book_id=${book} and review_id=${review} order by id collate "C" limit 1001`,
    "objects",
  );
}

export function principalAllocations(tx: Transaction, book: string, claim: string) {
  return tx.execute<{
    readonly receiptId: string;
    readonly settlementId: string;
    readonly postingDate: string;
    readonly effectiveOn: string;
    readonly amountMinor: string;
  }>(
    sql`
    select a.receipt_id as "receiptId",a.settlement_id as "settlementId",e.posting_date::text as "postingDate",e.body->>'occurredOn' as "effectiveOn",a.amount_minor::text as "amountMinor"
    from (
      select receipt_id,settlement_id,amount_minor from openerp.owner_allocation_legs where book_id=${book} and claim_id=${claim}
      union all
      select a.receipt_id,r.owner_effect_id,a.amount_minor from openerp.owner_operation_allocations a
      join openerp.owner_operation_receipts r on (r.book_id,r.id)=(a.book_id,a.receipt_id) where a.book_id=${book} and a.claim_id=${claim}
      union all
      select event_id,settlement_id,amount_minor from openerp.treasury_loan_allocations where book_id=${book} and claim_id=${claim}
    ) a join openerp.owner_effects e on e.book_id=${book} and e.id=a.settlement_id
    order by e.posting_date,a.receipt_id collate "C" limit 1001`,
    "objects",
  );
}

export function role(tx: Transaction, book: string, account: string) {
  return tx.execute<{ readonly role: string }>(
    sql`select role from openerp.treasury_loan_account_roles where book_id=${book} and account_id=${account}`,
    "objects",
  );
}

export function insertRole(tx: Transaction, book: string, account: string, role: string) {
  return tx.execute(
    sql`insert into openerp.treasury_loan_account_roles(book_id,account_id,role)values(${book},${account},${role}) on conflict do nothing`,
    "objects",
  );
}

export function insertLoan(tx: Transaction, book: string, loan: typeof Loans.RetainedLoan.Type) {
  return tx.execute(
    sql`insert into openerp.treasury_loans(book_id,id,principal_effect_id,evidence_id,body)values(${book},${loan.id},${loan.principal.id},${loan.evidence.evidenceId},${JSON.stringify(loan)}::jsonb)`,
    "objects",
  );
}

export function insertRate(tx: Transaction, book: string, rate: typeof Loans.LoanRate.Type) {
  return tx.execute(
    sql`insert into openerp.treasury_loan_rates(book_id,id,loan_id,effective_on,evidence_id,body)values(${book},${rate.id},${rate.loanId},${rate.input.effectiveOn}::date,${rate.evidence.evidenceId},${JSON.stringify(rate)}::jsonb)`,
    "objects",
  );
}

export function insertReview(tx: Transaction, book: string, review: typeof Loans.LoanReview.Type) {
  return tx.execute(
    sql`insert into openerp.treasury_loan_reviews(book_id,id,loan_id,kind,change_set_id,event_id,evidence_id,body)values(${book},${review.id},${review.loanId},${review.input.kind},${review.postingPlan?.id ?? null},${review.postingPlan?.groups[0]?.actions[0]?.eventId ?? null},${review.evidence.evidenceId},${JSON.stringify(review)}::jsonb)`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  approval: typeof Loans.LoanApproval.Type,
) {
  return tx.execute(
    sql`insert into openerp.treasury_loan_approvals(book_id,id,review_id,actor_id,expires_at,kernel_approval_id,body)values(${book},${approval.id},${approval.reviewId},${approval.actorId},${approval.expiresAt}::timestamptz,${approval.kernelApprovalId},${JSON.stringify(approval)}::jsonb)`,
    "objects",
  );
}

export function insertEvent(tx: Transaction, book: string, event: typeof Loans.LoanEvent.Type) {
  return tx.execute(
    sql`insert into openerp.treasury_loan_events(book_id,id,loan_id,review_id,approval_id,kind,posting_date,principal_minor,interest_minor,fee_minor,coverage_end_exclusive_on,owner_effect_id,posting_receipt_id,voucher_id,body)values(${book},${event.id},${event.loanId},${event.reviewId},${event.approvalId},${event.kind},${event.postingDate}::date,${event.principalMinor}::numeric,${event.interestMinor}::numeric,${event.feeMinor}::numeric,${event.coverageEndExclusiveOn}::date,${event.ownerEffectId},${event.postingReceipt?.id ?? null},${event.postingReceipt?.voucherId ?? null},${JSON.stringify(event)}::jsonb)`,
    "objects",
  );
}

export function insertAllocation(
  tx: Transaction,
  book: string,
  event: typeof Loans.LoanEvent.Type,
  claim: string,
  settlement: string,
) {
  return tx.execute(
    sql`insert into openerp.treasury_loan_allocations(book_id,event_id,claim_id,settlement_id,amount_minor)values(${book},${event.id},${claim},${settlement},${event.principalMinor}::numeric)`,
    "objects",
  );
}

export function loanPage(tx: Transaction, book: string, after: string | null) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.treasury_loans where book_id=${book} and (${after}::text is null or id collate "C" > ${after}) order by id collate "C" limit 21`,
    "objects",
  );
}

export function reviewPage(tx: Transaction, book: string, loan: string, after: string | null) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.treasury_loan_reviews where book_id=${book} and loan_id=${loan} and (${after}::text is null or id collate "C" > ${after}) order by id collate "C" limit 21`,
    "objects",
  );
}
