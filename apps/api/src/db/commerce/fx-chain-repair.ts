import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// NEXT-41. The retained chain-repair review and approval.
//
// A review seals one replayed chain: the frozen anchor, the ordered events,
// the corrected rate and the computed per-date deltas. The valuations,
// settlements and prior effects all stay with their owners. This module
// selects and persists the review; it never replays, never posts and never
// approves.

export const chainRepairTables = [
  "commerce_fx_chain_repair_reviews",
  "commerce_fx_chain_repair_approvals",
  "command_receipts",
] as const;

export type ReviewRow = {
  readonly id: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type ApprovalRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export function readReview(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select id, actor_id as "actorId", body
      from openerp.commerce_fx_chain_repair_reviews
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readReviewByRepairKey(transaction: Transaction, bookId: string, repairKey: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select id, actor_id as "actorId", body
      from openerp.commerce_fx_chain_repair_reviews
      where book_id = ${bookId} and body->'repair'->>'repairKey' = ${repairKey}
    `,
    "objects",
  );
}

export function insertReview(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly actorId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_chain_repair_reviews (book_id, id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  approvalId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, review_id as "reviewId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", body
      from openerp.commerce_fx_chain_repair_approvals
      where book_id = ${bookId} and review_id = ${reviewId} and id = ${approvalId}
    `,
    "objects",
  );
}

export function insertApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly reviewId: string;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_chain_repair_approvals
        (book_id, id, review_id, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.actorId},
        ${row.digest}, ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

// Every retained remeasurement plan that touched one item, oldest first. The
// chain owner replays prior valuation deltas from these plans rather than
// restating them, so a correction never double-counts an earlier repair.
export function listRemeasurementPlansForItem(
  transaction: Transaction,
  bookId: string,
  itemId: string,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select body
      from openerp.commerce_fx_remeasurement_reviews
      where book_id = ${bookId}
        and exists (
          select 1 from jsonb_array_elements(body->'plan'->'effects') effect
          where effect->>'itemId' = ${itemId}
        )
      order by body->>'createdAt'
    `,
    "objects",
  );
}

// Every retained settlement of one item with the voucher date it posted on,
// the foreign units it released and the cash consideration it moved. The chain
// replays these as history: their cash and foreign quantities are preserved,
// never rewritten.
export type SettlementEventRow = {
  readonly id: string;
  readonly postingDate: string;
  readonly originalReleasedMinor: string;
  readonly carryingReleasedMinor: string;
  readonly considerationMinor: string;
  readonly direction: string;
};

export function readSettlementEvents(transaction: Transaction, bookId: string, itemId: string) {
  return transaction.execute<SettlementEventRow>(
    sql`
      select s.id,
        v.posting_date::text as "postingDate",
        s.original_released_minor as "originalReleasedMinor",
        s.carrying_released_minor as "carryingReleasedMinor",
        s.consideration_minor as "considerationMinor",
        s.direction
      from openerp.commerce_fx_settlements s
      join openerp.vouchers v on v.book_id = s.book_id and v.id = s.voucher_id
      where s.book_id = ${bookId} and s.item_id = ${itemId}
      order by v.posting_date, s.id collate "C"
    `,
    "objects",
  );
}

// Every OTHER retained repair key for one item. The review being prepared or
// executed is excluded by id, so its own key never counts as a replay of
// itself; only a different review carrying the same key does.
export function listRepairKeysForItem(
  transaction: Transaction,
  bookId: string,
  itemId: string,
  excludeReviewId: string | null,
) {
  return transaction.execute<{ readonly repairKey: string }>(
    sql`
      select body->'repair'->>'repairKey' as "repairKey"
      from openerp.commerce_fx_chain_repair_reviews
      where book_id = ${bookId} and body->'repair'->>'itemId' = ${itemId}
        and (${excludeReviewId}::text is null or id <> ${excludeReviewId})
    `,
    "objects",
  );
}

// Every retained remeasurement plan that touched one item, oldest first. The
// chain replays these prior valuation deltas as history rather than restating
// them, so a correction never double-counts an earlier repair.
