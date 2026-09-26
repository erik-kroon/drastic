import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type CreditReviewRow = {
  readonly id: string;
  readonly invoiceId: string;
  readonly body: JsonObject;
};

export type CreditApprovalRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export type CreditRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export function readCreditReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<CreditReviewRow>(
    sql`
      select id, invoice_id as "invoiceId", body
      from openerp.supplier_credit_reviews
      where book_id = ${bookId} and id = ${reviewId}
    `,
    "objects",
  );
}

export function readLatestCreditApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<CreditApprovalRow>(
    sql`
      select id, body
      from openerp.supplier_credit_approvals
      where book_id = ${bookId} and review_id = ${reviewId}
      order by expires_at desc, id collate "C" desc
      limit 1
    `,
    "objects",
  );
}

export function readCreditByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<CreditRow>(
    sql`
      select id, body
      from openerp.supplier_credits
      where book_id = ${bookId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export function readSupplierInvoiceExists(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.commerce_invoices
        where book_id = ${bookId} and id = ${invoiceId} and direction = 'supplier'
      ) as present
    `,
    "objects",
  );
}

export function listCredits(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<CreditRow>(
    sql`
      select id, body
      from openerp.supplier_credits
      where book_id = ${bookId} and invoice_id = ${invoiceId}
      order by credit_date, id collate "C"
    `,
    "objects",
  );
}
