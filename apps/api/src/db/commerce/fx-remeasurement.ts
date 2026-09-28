import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// NEXT-18. The retained remeasurement review and approval.
//
// A review seals one valuation plan; an approval authorizes exactly that
// sealed digest. The items, rates, carryings and settlements all stay with
// their owners. This module selects and persists the review; it never values,
// never posts and never approves.

export const remeasurementTables = [
  "commerce_fx_remeasurement_reviews",
  "commerce_fx_remeasurement_approvals",
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
      from openerp.commerce_fx_remeasurement_reviews
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readReviewByDigest(transaction: Transaction, bookId: string, digest: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select id, actor_id as "actorId", body
      from openerp.commerce_fx_remeasurement_reviews
      where book_id = ${bookId} and body->>'digest' = ${digest}
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
      insert into openerp.commerce_fx_remeasurement_reviews (book_id, id, actor_id, body)
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
      from openerp.commerce_fx_remeasurement_approvals
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
      insert into openerp.commerce_fx_remeasurement_approvals
        (book_id, id, review_id, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.actorId},
        ${row.digest}, ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

// The posting dates of every voucher that settled one item. A consumption dated
// after the valuation cutoff needs a full correction chain, so the owner reads
// these dates rather than trusting the request.
export function readSettlementVoucherDates(
  transaction: Transaction,
  bookId: string,
  itemId: string,
) {
  return transaction.execute<{ readonly postingDate: string }>(
    sql`
      select v.posting_date::text as "postingDate"
      from openerp.commerce_fx_settlements s
      join openerp.vouchers v on v.book_id = s.book_id and v.id = s.voucher_id
      where s.book_id = ${bookId} and s.item_id = ${itemId}
    `,
    "objects",
  );
}

// Every FX item id in the book, bounded. The owner computes each item's
// retained remaining and keeps only those with something left to value, so the
// named population is proved complete rather than assumed.
export function listFxItemIds(transaction: Transaction, bookId: string, limit: number) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id
      from openerp.commerce_fx_items
      where book_id = ${bookId}
      order by id collate "C"
      limit ${limit + 1}
    `,
    "objects",
  );
}
