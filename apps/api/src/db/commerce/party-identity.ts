import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// The party-identity owner's retained inputs, extending the party directory
// (crm-master) owner. It reads retained counterparty heads, live open
// obligations, payment reservations and unissued drafts, and writes its
// receipts into the shared command_receipts table only. It never merges a
// balance, never rewrites a payee fact and never combines settlement
// capacity. No new table.
export const partyIdentityTables = [
  "books",
  "evidence",
  "command_receipts",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "commerce_invoices",
  "commerce_invoice_revisions",
  "supplier_payment_batch_items",
  "supplier_payment_batch_exports",
  "invoice_drafts",
  "invoice_draft_revisions",
  "invoice_issues",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "supplier_acceptances",
] as const;

export const partyIdentityInserts = ["command_receipts"] as const;

export type CounterpartyHeadRow = {
  readonly id: string;
  readonly role: string;
  readonly currentRevision: string;
  readonly revision: JsonObject;
};

export function readCounterpartyHeads(
  transaction: Transaction,
  bookId: string,
  partyIds: ReadonlyArray<string>,
) {
  return transaction.execute<CounterpartyHeadRow>(
    sql`
      select c.id, c.role, c.current_revision as "currentRevision", r.body as revision
      from openerp.commerce_counterparties c
      join openerp.commerce_counterparty_revisions r
        on r.book_id = c.book_id and r.counterparty_id = c.id and r.revision = c.current_revision
      where c.book_id = ${bookId} and c.id = any(array[${sql.join(
        partyIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])
    `,
    "objects",
  );
}

// Open obligations start from invoice identities by counterparty. Their live
// outstanding, status, currency and control account always come from the
// invoice owner's own live view, never from a second computation here: a
// duplicated outstanding formula is how two readers come to disagree about
// the same invoice.
export function readInvoiceIdsByCounterparty(
  transaction: Transaction,
  bookId: string,
  partyIds: ReadonlyArray<string>,
  limit: number,
) {
  return transaction.execute<{
    readonly id: string;
    readonly counterpartyId: string;
    readonly direction: string;
    readonly controlAccountId: string;
  }>(
    sql`
      select i.id, i.counterparty_id as "counterpartyId", i.direction,
        i.control_account_id as "controlAccountId"
      from openerp.commerce_invoices i
      where i.book_id = ${bookId} and i.counterparty_id = any(array[${sql.join(
        partyIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])
      order by i.id collate "C"
      limit ${limit + 1}
    `,
    "objects",
  );
}

// A payment reservation is a retained batch item pointing at the invoice. The
// owner reads them so a resolution records what must be rechecked, not so it
// can release or move anything.
export function readReservationItems(
  transaction: Transaction,
  bookId: string,
  invoiceIds: ReadonlyArray<string>,
  limit: number,
) {
  return transaction.execute<{ readonly exportId: string; readonly invoiceId: string }>(
    sql`
      select export_id as "exportId", invoice_id as "invoiceId"
      from openerp.supplier_payment_batch_items
      where book_id = ${bookId} and invoice_id = any(array[${sql.join(
        invoiceIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])
      order by export_id collate "C", invoice_id collate "C"
      limit ${limit + 1}
    `,
    "objects",
  );
}

export function readPartyResolutionByKey(transaction: Transaction, bookId: string, key: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select result as body
      from openerp.command_receipts
      where book_id = ${bookId}
        and operation = 'prepare_party_resolution'
        and key = ${key}
    `,
    "objects",
  );
}

// Unissued dependent drafts are working papers, not obligations: a draft in
// either family whose current revision names the counterparty and which has
// no acceptance or issue record. An accepted draft already produced its
// invoice, and that invoice appears in the obligation list instead, so the
// two lists never double-count the same economic event.
export function readUnissuedDrafts(
  transaction: Transaction,
  bookId: string,
  partyIds: ReadonlyArray<string>,
  limit: number,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from (
        select d.id
        from openerp.invoice_drafts d
        join openerp.invoice_draft_revisions r
          on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
        left join openerp.invoice_issues i
          on i.book_id = d.book_id and i.draft_id = d.id
        where d.book_id = ${bookId}
          and r.body ->> 'counterpartyId' = any(array[${sql.join(
            partyIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::text[])
          and i.id is null
        union
        select d.id
        from openerp.supplier_invoice_drafts d
        join openerp.supplier_invoice_draft_revisions r
          on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
        left join openerp.supplier_acceptances a
          on a.book_id = d.book_id and a.draft_id = d.id
        where d.book_id = ${bookId}
          and r.body ->> 'counterpartyId' = any(array[${sql.join(
            partyIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::text[])
          and a.id is null
      ) drafts
      order by id collate "C"
      limit ${limit + 1}
    `,
    "objects",
  );
}

// Reviewed evidence must exist before it can be cited. The owner checks
// presence, never content: what the evidence establishes is the reviewer's
// decision, recorded outside this system.
export function readEvidencePresent(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.evidence where book_id = ${bookId} and id = ${evidenceId}
      ) as present
    `,
    "objects",
  );
}
