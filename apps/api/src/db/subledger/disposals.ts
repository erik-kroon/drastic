import { sql } from "drizzle-orm";
import type * as Contracts from "@open-erp/contracts/asset-disposals";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type BodyRow = { readonly id: string; readonly body: Schema.JsonObject };

export function readReview(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select id,body from openerp.asset_proceeds_reviews where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function readReviewByPlan(tx: Transaction, book: string, plan: string, event?: string) {
  return tx.execute<BodyRow>(
    sql`select r.id,r.body from openerp.asset_proceeds_reviews r where r.book_id=${book} and (r.change_set_id=${plan} or (not exists(select from openerp.asset_proceeds_reviews exact where exact.book_id=${book} and exact.change_set_id=${plan}) and ${event ?? null}::text is not null and exists(select from jsonb_array_elements(r.body->'postingPlan'->'groups') g cross join lateral jsonb_array_elements(g->'actions') a where a->>'eventId'=${event ?? null})))`,
    "objects",
  );
}

export function approvals(tx: Transaction, book: string, review: string) {
  return tx.execute<BodyRow>(
    sql`select id,body from openerp.asset_proceeds_approvals where book_id=${book} and review_id=${review} order by id limit 21`,
    "objects",
  );
}

export function effect(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select id,body from openerp.asset_proceeds_effects where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function effectForReview(tx: Transaction, book: string, review: string) {
  return tx.execute<BodyRow>(
    sql`select id,body from openerp.asset_proceeds_effects where book_id=${book} and review_id=${review}`,
    "objects",
  );
}

export function usedProceeds(tx: Transaction, book: string, identity: string) {
  return tx.execute<BodyRow>(
    sql`select e.id,e.body from openerp.asset_proceeds_effects e where e.book_id=${book} and e.proceeds_identity=${identity} and e.kind='disposal' and not exists(select from openerp.asset_proceeds_effects c where c.book_id=e.book_id and c.correction_of=e.id)`,
    "objects",
  );
}

export function insertReview(tx: Transaction, book: string, review: typeof Contracts.Review.Type) {
  return tx.execute(
    sql`insert into openerp.asset_proceeds_reviews(book_id,id,schedule_id,change_set_id,evidence_id,body) values(${book},${review.id},${review.assetBasis.schedule.scheduleId},${review.postingPlan.id},${review.evidence.id},${JSON.stringify(review)}::jsonb)`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  approval: typeof Contracts.Approval.Type,
) {
  return tx.execute(
    sql`insert into openerp.asset_proceeds_approvals(book_id,id,review_id,actor_id,expires_at,body) values(${book},${approval.id},${approval.reviewId},${approval.actorId},${approval.expiresAt}::timestamptz,${JSON.stringify(approval)}::jsonb)`,
    "objects",
  );
}

export function insertEffect(
  tx: Transaction,
  book: string,
  value: typeof Contracts.DisposalEffect.Type,
  postingDate: string,
) {
  return tx.execute(
    sql`insert into openerp.asset_proceeds_effects(book_id,id,schedule_id,review_id,approval_id,kind,correction_of,proceeds_identity,posting_date,voucher_id,posting_receipt_id,body) values(${book},${value.id},${value.scheduleId},${value.reviewId},${value.approvalId},${value.kind},${value.correctionOf},${value.proceeds.proceedsIdentity},${postingDate}::date,${value.postingReceipt.voucherId},${value.postingReceipt.id},${JSON.stringify(value)}::jsonb)`,
    "objects",
  );
}

export function invoiceBlocked(tx: Transaction, book: string, invoice: string, voucher: string) {
  return tx.execute<{ readonly blocked: boolean }>(
    sql`select exists(select from openerp.customer_credit_notes where book_id=${book} and register_invoice_id=${invoice}) or exists(select from openerp.invoice_cancellations where book_id=${book} and register_invoice_id=${invoice}) or exists(select from openerp.vouchers where book_id=${book} and corrects_voucher_id=${voucher}) as blocked`,
    "objects",
  );
}

export function correctionBlocked(
  tx: Transaction,
  book: string,
  disposal: string,
  voucher: string,
  fact: string | null,
  schedule: string,
  createdAt: string,
) {
  return tx.execute<{ readonly blocked: boolean }>(
    sql`select exists(select from openerp.asset_proceeds_effects where book_id=${book} and correction_of=${disposal}) or exists(select from openerp.vouchers where book_id=${book} and corrects_voucher_id=${voucher}) or exists(select from openerp.subledger_schedule_revisions where book_id=${book} and schedule_id=${schedule} and (body->>'createdAt')::timestamptz>${createdAt}::timestamptz) or exists(select from openerp.vat_return_drafts d cross join lateral jsonb_array_elements(d.body->'basis'->'facts') f where d.book_id=${book} and f->'fact'->>'factId'=${fact}) or exists(select from openerp.vat_draft_amendments a cross join lateral jsonb_array_elements(a.body->'impact'->'facts') f where a.book_id=${book} and f->>'factId'=${fact}) as blocked`,
    "objects",
  );
}
