import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";

// NEXT-30. The retained customer-credit origin and effect.
//
// A receipt origin records the unallocated remainder of one adopted customer
// cash receipt as a liability. An effect records one application, refund or
// owned correction against it. Both are immutable; a correction appends a
// reversing effect rather than editing. This module selects and persists; it
// never compiles a receipt, never applies credit and never posts.

export const receiptTables = [
  "customer_credit_origins",
  "customer_credit_effects",
  "command_receipts",
] as const;

export type OriginRow = {
  readonly id: string;
  readonly customerId: string;
  readonly currency: string;
  readonly originalMinor: string;
  readonly sourceKind: string;
  readonly sourceRef: string;
  readonly creditLiabilityAccountId: string;
  readonly receivableControlAccountId: string;
  readonly receiptId: string;
  readonly digest: string;
};

export type EffectRow = {
  readonly id: string;
  readonly originId: string;
  readonly kind: string;
  readonly signedConsumedMinor: string;
  readonly destinationIdentity: string;
  readonly receiptId: string;
  readonly digest: string;
};

export function readOrigin(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<OriginRow>(
    sql`
      select id, customer_id as "customerId", currency, original_minor as "originalMinor",
        source_kind as "sourceKind", source_ref as "sourceRef",
        credit_liability_account_id as "creditLiabilityAccountId",
        receivable_control_account_id as "receivableControlAccountId",
        receipt_id as "receiptId", digest
      from openerp.customer_credit_origins
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readOriginByReceipt(transaction: Transaction, bookId: string, receiptId: string) {
  return transaction.execute<OriginRow>(
    sql`
      select id, customer_id as "customerId", currency, original_minor as "originalMinor",
        source_kind as "sourceKind", source_ref as "sourceRef",
        credit_liability_account_id as "creditLiabilityAccountId",
        receivable_control_account_id as "receivableControlAccountId",
        receipt_id as "receiptId", digest
      from openerp.customer_credit_origins
      where book_id = ${bookId} and receipt_id = ${receiptId}
    `,
    "objects",
  );
}

export function insertOrigin(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly customerId: string;
    readonly currency: string;
    readonly originalMinor: string;
    readonly sourceKind: string;
    readonly sourceRef: string;
    readonly creditLiabilityAccountId: string;
    readonly receivableControlAccountId: string;
    readonly receiptId: string;
    readonly digest: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.customer_credit_origins
        (book_id, id, customer_id, currency, original_minor, source_kind, source_ref,
         credit_liability_account_id, receivable_control_account_id, receipt_id, digest)
      values (${row.bookId}, ${row.id}, ${row.customerId}, ${row.currency}, ${row.originalMinor},
        ${row.sourceKind}, ${row.sourceRef}, ${row.creditLiabilityAccountId},
        ${row.receivableControlAccountId}, ${row.receiptId}, ${row.digest})
    `,
    "objects",
  );
}

export function readEffectsForOrigin(transaction: Transaction, bookId: string, originId: string) {
  return transaction.execute<EffectRow>(
    sql`
      select id, origin_id as "originId", kind, signed_consumed_minor as "signedConsumedMinor",
        destination_identity as "destinationIdentity", receipt_id as "receiptId", digest
      from openerp.customer_credit_effects
      where book_id = ${bookId} and origin_id = ${originId}
      order by created_at, id collate "C"
    `,
    "objects",
  );
}

export function insertEffect(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly originId: string;
    readonly kind: string;
    readonly signedConsumedMinor: string;
    readonly destinationIdentity: string;
    readonly receiptId: string;
    readonly digest: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.customer_credit_effects
        (book_id, id, origin_id, kind, signed_consumed_minor, destination_identity, receipt_id, digest)
      values (${row.bookId}, ${row.id}, ${row.originId}, ${row.kind}, ${row.signedConsumedMinor},
        ${row.destinationIdentity}, ${row.receiptId}, ${row.digest})
    `,
    "objects",
  );
}

// One invoice's retained identity for a receipt leg: who it belongs to, what
// currency it is in, and what remains outstanding. A leg naming an unknown
// invoice, another customer's invoice, another currency or more than remains
// refuses at the owner rather than entering the compiler on asserted numbers.

// Who an invoice belongs to and what currency it is in. These are static
// retained facts, so a direct read is exact. The outstanding itself always
// comes from the live projection, never from here.
export function readInvoiceIdentity(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<{ readonly customerId: string; readonly currency: string }>(
    sql`
      select counterparty_id as "customerId", body->>'currency' as currency
      from openerp.commerce_invoices
      where book_id = ${bookId} and id = ${invoiceId} and direction = 'customer'
    `,
    "objects",
  );
}
