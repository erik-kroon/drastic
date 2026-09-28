import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// The resolution owner's retained inputs. It extends the supplier
// payment-batch/export owner, so it reads that owner's tables and writes
// receipts into the shared command_receipts table only. It never posts,
// allocates, or moves money, and it creates no new table.
export const resolutionTables = [
  "books",
  "evidence",
  "command_receipts",
  "supplier_payment_batch_previews",
  "supplier_payment_batch_exports",
  "supplier_payment_batch_items",
  "supplier_payment_outcomes",
] as const;

export const resolutionInserts = ["command_receipts"] as const;

export type JsonBodyRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export type OutcomeBodyRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly status: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export type ReceiptSearchRow = {
  readonly key: string;
  readonly operation: string;
  readonly body: JsonObject;
};

export function readResolutionBook(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly currency: string }>(
    sql`
      select currency from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readInstructionExport(transaction: Transaction, bookId: string, exportId: string) {
  return transaction.execute<JsonBodyRow>(
    sql`
      select id, body
      from openerp.supplier_payment_batch_exports
      where book_id = ${bookId} and id = ${exportId}
    `,
    "objects",
  );
}

export function readInstructionPreview(
  transaction: Transaction,
  bookId: string,
  previewId: string,
) {
  return transaction.execute<JsonBodyRow>(
    sql`
      select id, body
      from openerp.supplier_payment_batch_previews
      where book_id = ${bookId} and id = ${previewId}
    `,
    "objects",
  );
}

export function readInstructionOutcomes(
  transaction: Transaction,
  bookId: string,
  exportId: string,
) {
  return transaction.execute<OutcomeBodyRow>(
    sql`
      select id, ordinal, status, evidence_id as "evidenceId", body
      from openerp.supplier_payment_outcomes
      where book_id = ${bookId} and export_id = ${exportId}
      order by ordinal
    `,
    "objects",
  );
}

// A resolution receipt is found by what it resolved, not by the caller's key.
// That is what makes a different key over the same proof a duplicate economic
// effect that must refuse, rather than a new resolution to record.
export function readResolutionReceipts(
  transaction: Transaction,
  bookId: string,
  operation: string,
  exportId: string,
  invoiceId: string,
) {
  return transaction.execute<ReceiptSearchRow>(
    sql`
      select key, operation, result as body
      from openerp.command_receipts
      where book_id = ${bookId} and operation = ${operation}
        and result ->> 'exportId' = ${exportId}
        and result ->> 'invoiceId' = ${invoiceId}
    `,
    "objects",
  );
}

// A resolution is refound by its own command key, never by trusting a caller's
// description of it. The proof digest is recomputed from retained outcomes,
// not read from the saved value.
export function readResolutionByKey(transaction: Transaction, bookId: string, key: string) {
  return transaction.execute<ReceiptSearchRow>(
    sql`
      select key, operation, result as body
      from openerp.command_receipts
      where book_id = ${bookId}
        and operation in ('resolve_payment_instruction', 'prepare_payment_replacement')
        and key = ${key}
    `,
    "objects",
  );
}
