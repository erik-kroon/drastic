import { and, eq } from "drizzle-orm";
import type { Transaction } from "../transaction";
import {
  customerInvoiceDefaults,
  customerInvoiceDefaultsRevisions,
  customerRecipients,
  customerRecipientsRevisions,
} from "../schema";
import type { JsonObject } from "./access";

export type CustomerStream = "defaults" | "recipient";

export const customerDefaultsTables = [
  "crm_customer_invoice_defaults",
  "crm_customer_invoice_defaults_revisions",
  "crm_customer_recipients",
  "crm_customer_recipients_revisions",
  "commerce_counterparties",
  "evidence",
] as const;

function pointerTable(stream: CustomerStream) {
  return stream === "defaults" ? customerInvoiceDefaults : customerRecipients;
}

function revisionTable(stream: CustomerStream) {
  return stream === "defaults" ? customerInvoiceDefaultsRevisions : customerRecipientsRevisions;
}

export function readCustomerPointer(
  transaction: Transaction,
  bookId: string,
  partyId: string,
  stream: CustomerStream,
) {
  const table = pointerTable(stream);

  return transaction
    .select({ currentRevision: table.currentRevision })
    .from(table)
    .where(and(eq(table.bookId, bookId), eq(table.partyId, partyId)));
}

export function readCustomerRevision(
  transaction: Transaction,
  bookId: string,
  partyId: string,
  revision: string,
  stream: CustomerStream,
) {
  const table = revisionTable(stream);

  return transaction
    .select({ body: table.body })
    .from(table)
    .where(
      and(
        eq(table.bookId, bookId),
        eq(table.partyId, partyId),
        eq(table.revision, BigInt(revision)),
      ),
    );
}

export function insertCustomerPointer(
  transaction: Transaction,
  bookId: string,
  partyId: string,
  stream: CustomerStream,
) {
  return transaction.insert(pointerTable(stream)).values({ bookId, partyId, currentRevision: 1n });
}

export function advanceCustomerPointer(
  transaction: Transaction,
  bookId: string,
  partyId: string,
  revision: string,
  stream: CustomerStream,
) {
  const table = pointerTable(stream);

  return transaction
    .update(table)
    .set({ currentRevision: BigInt(revision) })
    .where(and(eq(table.bookId, bookId), eq(table.partyId, partyId)));
}

export function insertCustomerRevision(
  transaction: Transaction,
  row: { bookId: string; partyId: string; revision: string; body: JsonObject; recordedBy: string },
  stream: CustomerStream,
) {
  return transaction
    .insert(revisionTable(stream))
    .values({ ...row, revision: BigInt(row.revision) });
}
