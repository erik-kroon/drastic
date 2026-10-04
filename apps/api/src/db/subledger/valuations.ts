import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Controls from "@open-erp/contracts/subledger-controls";
import type * as Subledgers from "@open-erp/contracts/subledgers";
import type { Transaction } from "../transaction";

type BodyRow = { readonly body: Schema.JsonObject };

export function readReview(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.subledger_valuation_reviews where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function reviews(tx: Transaction, book: string, schedule: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.subledger_valuation_reviews where book_id=${book} and schedule_id=${schedule} order by ordinal limit 21`,
    "objects",
  );
}

export function decision(tx: Transaction, book: string, decisionKey: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.subledger_valuation_reviews where book_id=${book} and decision_key=${decisionKey} union all select id from openerp.subledger_impairment_reviews where book_id=${book} and decision_key=${decisionKey}`,
    "objects",
  );
}

export function events(tx: Transaction, book: string, schedule: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.subledger_valuations where book_id=${book} and schedule_id=${schedule} order by schedule_revision`,
    "objects",
  );
}

export function approvals(tx: Transaction, book: string, review: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.subledger_valuation_approvals where book_id=${book} and review_id=${review} order by ordinal limit 21`,
    "objects",
  );
}

export function insertReview(
  tx: Transaction,
  book: string,
  review: typeof Controls.AssetValuationReview.Type,
) {
  return tx.execute(
    sql`insert into openerp.subledger_valuation_reviews(book_id,id,schedule_id,ordinal,decision_key,change_set_id,evidence_id,body)values(${book},${review.id},${review.input.scheduleId},${review.ordinal},${review.input.decisionKey},${review.postingPlan.id},${review.evidence.id},${JSON.stringify(review)}::jsonb)`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  approval: typeof Controls.AssetValuationApproval.Type,
  ordinal: number,
) {
  return tx.execute(
    sql`insert into openerp.subledger_valuation_approvals(book_id,id,review_id,ordinal,actor_id,expires_at,body)values(${book},${approval.id},${approval.reviewId},${ordinal},${approval.actorId},${approval.expiresAt}::timestamptz,${JSON.stringify(approval)}::jsonb)`,
    "objects",
  );
}

export function insertEvent(
  tx: Transaction,
  book: string,
  event: typeof Subledgers.AssetValuationEvent.Type,
  eventId: string,
  contraLine: string,
  resultLine: string,
) {
  return tx.execute(
    sql`insert into openerp.subledger_valuations(book_id,id,schedule_id,review_id,approval_id,decision_key,kind,direction,correction_of,magnitude_minor,schedule_revision,posting_date,accumulated_impairment_account_id,income_or_loss_account_id,posting_receipt_id,event_id,voucher_id,contra_line_id,result_line_id,body)values(${book},${event.id},${event.scheduleId},${event.reviewId},${event.approvalId},${event.decisionKey},${event.kind},${event.direction},${event.correctionOf},${event.magnitudeMinor}::numeric,${event.scheduleRevision},${event.postingDate}::date,${event.accumulatedImpairmentAccountId},${event.incomeOrLossAccountId},${event.postingReceipt.id},${eventId},${event.postingReceipt.voucherId},${contraLine},${resultLine},${JSON.stringify(event)}::jsonb)`,
    "objects",
  );
}

export function retire(
  tx: Transaction,
  book: string,
  schedule: string,
  key: string,
  event: string,
) {
  return tx.execute(
    sql`insert into openerp.subledger_retired_occurrences(book_id,schedule_id,event_key,valuation_id)values(${book},${schedule},${key},${event}) on conflict do nothing`,
    "objects",
  );
}
