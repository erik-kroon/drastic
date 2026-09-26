import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Controls from "@open-erp/contracts/subledger-controls";
import type * as Subledgers from "@open-erp/contracts/subledgers";
import type { Transaction } from "../transaction";

export type Kind = "impairment" | "disposal";

type BodyRow = { readonly body: Schema.JsonObject };

const reviewTable = (kind: Kind) =>
  kind === "impairment"
    ? sql`openerp.subledger_impairment_reviews`
    : sql`openerp.subledger_disposal_reviews`;

const approvalTable = (kind: Kind) =>
  kind === "impairment"
    ? sql`openerp.subledger_impairment_approvals`
    : sql`openerp.subledger_disposal_approvals`;

const effectTable = (kind: Kind) =>
  kind === "impairment" ? sql`openerp.subledger_impairments` : sql`openerp.subledger_disposals`;

export function readReview(tx: Transaction, book: string, kind: Kind, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from ${reviewTable(kind)} where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function listReviews(tx: Transaction, book: string, kind: Kind, schedule: string) {
  return tx.execute<BodyRow>(
    sql`select body from ${reviewTable(kind)} where book_id=${book} and schedule_id=${schedule} order by ordinal limit 21`,
    "objects",
  );
}

export function listApprovals(tx: Transaction, book: string, kind: Kind, review: string) {
  return tx.execute<BodyRow>(
    sql`select body from ${approvalTable(kind)} where book_id=${book} and review_id=${review} order by ordinal limit 21`,
    "objects",
  );
}

export function listEffects(tx: Transaction, book: string, kind: Kind, schedule: string) {
  return tx.execute<BodyRow>(
    sql`select body from ${effectTable(kind)} where book_id=${book} and schedule_id=${schedule} order by id`,
    "objects",
  );
}

export function readDecision(tx: Transaction, book: string, decision: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.subledger_impairment_reviews where book_id=${book} and decision_key=${decision}`,
    "objects",
  );
}

export function insertDisposalReview(
  tx: Transaction,
  book: string,
  review: typeof Controls.AssetDisposalReview.Type,
) {
  return tx.execute(
    sql`insert into openerp.subledger_disposal_reviews(book_id,id,schedule_id,ordinal,change_set_id,evidence_id,body)values(${book},${review.id},${review.input.scheduleId},${review.ordinal},${review.postingPlan.id},${review.evidence.id},${JSON.stringify(review)}::jsonb)`,
    "objects",
  );
}

export function insertImpairmentReview(
  tx: Transaction,
  book: string,
  review: typeof Controls.AssetImpairmentReview.Type,
) {
  return tx.execute(
    sql`insert into openerp.subledger_impairment_reviews(book_id,id,schedule_id,ordinal,decision_key,change_set_id,evidence_id,body)values(${book},${review.id},${review.input.scheduleId},${review.ordinal},${review.input.decisionKey},${review.postingPlan.id},${review.evidence.id},${JSON.stringify(review)}::jsonb)`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  kind: Kind,
  approval: typeof Controls.AssetDisposalApproval.Type,
  ordinal: number,
) {
  return tx.execute(
    sql`insert into ${approvalTable(kind)}(book_id,id,review_id,ordinal,actor_id,expires_at,body)values(${book},${approval.id},${approval.reviewId},${ordinal},${approval.actorId},${approval.expiresAt}::timestamptz,${JSON.stringify(approval)}::jsonb)`,
    "objects",
  );
}

export function insertDisposal(
  tx: Transaction,
  book: string,
  result: typeof Subledgers.AssetDisposal.Type,
) {
  return tx.execute(
    sql`insert into openerp.subledger_disposals(book_id,id,schedule_id,review_id,approval_id,posting_receipt_id,posting_date,body)values(${book},${result.id},${result.scheduleId},${result.reviewId},${result.approvalId},${result.postingReceipt.id},${result.postingDate}::date,${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}

export function insertImpairment(
  tx: Transaction,
  book: string,
  result: typeof Subledgers.AssetImpairment.Type,
  event: string,
  lossLine: string,
  contraLine: string,
) {
  return tx.execute(
    sql`insert into openerp.subledger_impairments(book_id,id,schedule_id,review_id,approval_id,posting_receipt_id,event_id,voucher_id,loss_line_id,accumulated_impairment_line_id,ordinal,decision_key,schedule_revision,posting_date,impairment_minor,loss_account_id,accumulated_impairment_account_id,body)values(${book},${result.id},${result.scheduleId},${result.reviewId},${result.approvalId},${result.postingReceipt.id},${event},${result.postingReceipt.voucherId},${lossLine},${contraLine},${result.ordinal},${result.decisionKey},${result.scheduleRevision},${result.postingDate}::date,${result.impairmentMinor}::numeric,${result.lossAccountId},${result.accumulatedImpairmentAccountId},${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}

export function readReservedAccounts(tx: Transaction, book: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select account_id as id from openerp.bank_sources where book_id=${book} union select account_id from openerp.commerce_control_accounts where book_id=${book} union select account_id from openerp.owner_control_accounts where book_id=${book} union select account_id from openerp.tax_account_sources where book_id=${book} union select account_id from openerp.vat_control_account_roles where book_id=${book}`,
    "objects",
  );
}

export function readCarryingAccounts(tx: Transaction, book: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select l.account_id as id from openerp.subledger_basis_lines b join openerp.journal_lines l on l.book_id=b.book_id and l.voucher_id=b.voucher_id and l.id=b.line_id where b.book_id=${book} union select r.body->'terms'->>'creditAccountId' from openerp.subledger_schedule_revisions r where r.book_id=${book} and r.revision=(select max(n.revision) from openerp.subledger_schedule_revisions n where n.book_id=r.book_id and n.schedule_id=r.schedule_id)`,
    "objects",
  );
}
