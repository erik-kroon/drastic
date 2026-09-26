import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";

import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type DraftRow = {
  readonly id: string;
  readonly draftKey: string;
  readonly currentRevision: string;
};

export type DraftRevisionRow = {
  readonly revision: string;
  readonly body: JsonObject;
};

export type CounterpartyRow = {
  readonly id: string;
  readonly role: string;
  readonly currentRevision: string;
  readonly body: JsonObject | null;
};

export type CountRow = { readonly total: number };

export type DuplicateCandidateRow = {
  readonly kind: string;
  readonly id: string;
  readonly revision: string;
  readonly sameNumber: boolean;
  readonly sameContent: boolean;
};

export type SuggestionRow = {
  readonly expenseAccountId: string;
  readonly vatRatePercent: number;
  readonly sourceInvoiceId: string;
};

export function readDraft(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<DraftRow>(
    sql`
      select id, draft_key as "draftKey", current_revision::text as "currentRevision"
      from openerp.supplier_invoice_drafts
      where book_id = ${bookId} and id = ${draftId}
    `,
    "objects",
  );
}

export function readDraftByKey(transaction: Transaction, bookId: string, draftKey: string) {
  return transaction.execute<DraftRow>(
    sql`
      select id, draft_key as "draftKey", current_revision::text as "currentRevision"
      from openerp.supplier_invoice_drafts
      where book_id = ${bookId} and draft_key = ${draftKey}
    `,
    "objects",
  );
}

export function readDraftCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from (select 1 from openerp.supplier_invoice_drafts where book_id = ${bookId} limit 201) bounded
    `,
    "objects",
  );
}

export function readHeadRevision(
  transaction: Transaction,
  bookId: string,
  draftId: string,
  revision: string,
) {
  return transaction.execute<DraftRevisionRow>(
    sql`
      select revision::text as revision, body
      from openerp.supplier_invoice_draft_revisions
      where book_id = ${bookId} and draft_id = ${draftId} and revision = ${revision}::bigint
    `,
    "objects",
  );
}

export function readRevision(
  transaction: Transaction,
  bookId: string,
  draftId: string,
  revision: string,
) {
  return transaction.execute<DraftRevisionRow>(
    sql`
      select revision::text as revision, body
      from openerp.supplier_invoice_draft_revisions
      where book_id = ${bookId} and draft_id = ${draftId} and revision = ${revision}::bigint
    `,
    "objects",
  );
}

export function readDraftRevisionCount(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.supplier_invoice_draft_revisions
      where book_id = ${bookId} and draft_id = ${draftId}
    `,
    "objects",
  );
}

export function listDraftHeads(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly body: JsonObject; readonly draftKey: string }>(
    sql`
      select r.body, d.draft_key as "draftKey"
      from openerp.supplier_invoice_drafts d
      join openerp.supplier_invoice_draft_revisions r
        on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
      where d.book_id = ${bookId}
      order by d.draft_key collate "C"
    `,
    "objects",
  );
}

export function listDraftHistory(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select body
      from openerp.supplier_invoice_draft_revisions
      where book_id = ${bookId} and draft_id = ${draftId}
      order by revision
    `,
    "objects",
  );
}

export function insertDraft(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly draftKey: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_invoice_drafts (book_id, id, draft_key, current_revision)
      values (${row.bookId}, ${row.id}, ${row.draftKey}, 1)
    `,
    "objects",
  );
}

export function insertDraftRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly draftId: string;
    readonly revision: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_invoice_draft_revisions (book_id, draft_id, revision, body)
      values (${row.bookId}, ${row.draftId}, ${row.revision}::bigint, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function advanceDraftRevision(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute(
    sql`
      update openerp.supplier_invoice_drafts
      set current_revision = current_revision + 1
      where book_id = ${bookId} and id = ${draftId}
    `,
    "objects",
  );
}

export function readCounterparty(transaction: Transaction, bookId: string, counterpartyId: string) {
  return transaction.execute<CounterpartyRow>(
    sql`
      select c.id, c.role, c.current_revision::text as "currentRevision", r.body
      from openerp.commerce_counterparties c
      left join openerp.commerce_counterparty_revisions r
        on r.book_id = c.book_id and r.counterparty_id = c.id and r.revision = c.current_revision
      where c.book_id = ${bookId} and c.id = ${counterpartyId}
    `,
    "objects",
  );
}

export function readDuplicateCandidates(
  transaction: Transaction,
  bookId: string,
  draftId: string,
  counterpartyId: string,
  documentNumber: string | null,
  evidenceSha256: string | null,
  afterKind: string,
  afterId: string,
) {
  return transaction.execute<DuplicateCandidateRow>(
    sql`
      select candidate.kind, candidate.id, candidate.revision,
        candidate.same_number as "sameNumber", candidate.same_content as "sameContent"
      from (
        select 'd'::text as kind, d.id, r.revision,
          (${documentNumber}::text is not null
            and r.body->'content'->>'supplierDocumentNumber' = ${documentNumber}::text collate "C")
            as same_number,
          (r.body->'sourceEvidence'->>'sha256' = ${evidenceSha256}::text) as same_content
        from openerp.supplier_invoice_drafts d
        join openerp.supplier_invoice_draft_revisions r
          on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
        where d.book_id = ${bookId} and d.id <> ${draftId}
          and r.body->'content'->>'counterpartyId' = ${counterpartyId}
          and (
            (${documentNumber}::text is not null
              and r.body->'content'->>'supplierDocumentNumber' = ${documentNumber}::text collate "C")
            or r.body->'sourceEvidence'->>'sha256' = ${evidenceSha256}::text
          )
        union all
        select 'r'::text as kind, i.id, 0::bigint as revision,
          (${documentNumber}::text is not null and i.document_number = ${documentNumber}::text collate "C")
            as same_number,
          (e.sha256 = ${evidenceSha256}::text) as same_content
        from openerp.commerce_invoices i
        join openerp.evidence e on e.book_id = i.book_id and e.id = i.evidence_id
        where i.book_id = ${bookId} and i.direction = 'supplier' and i.counterparty_id = ${counterpartyId}
          and (
            (${documentNumber}::text is not null and i.document_number = ${documentNumber}::text collate "C")
            or e.sha256 = ${evidenceSha256}::text
          )
      ) candidate
      where (candidate.kind collate "C", candidate.id collate "C")
        > (${afterKind}::text collate "C", ${afterId}::text collate "C")
      order by candidate.kind collate "C", candidate.id collate "C"
      limit 51
    `,
    "objects",
  );
}

export function readDuplicateAnchorDraftRevision(
  transaction: Transaction,
  bookId: string,
  draftId: string,
  revision: string,
  counterpartyId: string,
  documentNumber: string | null,
  evidenceSha256: string | null,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.supplier_invoice_draft_revisions r
        where r.book_id = ${bookId} and r.draft_id = ${draftId} and r.revision = ${revision}::bigint
          and r.body->'content'->>'counterpartyId' = ${counterpartyId}
          and (
            (${documentNumber}::text is not null
              and r.body->'content'->>'supplierDocumentNumber' = ${documentNumber}::text collate "C")
            or r.body->'sourceEvidence'->>'sha256' = ${evidenceSha256}::text
          )
      ) as present
    `,
    "objects",
  );
}

export function readDuplicateAnchorInvoice(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
  counterpartyId: string,
  documentNumber: string | null,
  evidenceSha256: string | null,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.commerce_invoices i
        join openerp.evidence e on e.book_id = i.book_id and e.id = i.evidence_id
        where i.book_id = ${bookId} and i.id = ${invoiceId} and i.direction = 'supplier'
          and i.counterparty_id = ${counterpartyId}
          and (
            (${documentNumber}::text is not null and i.document_number = ${documentNumber}::text collate "C")
            or e.sha256 = ${evidenceSha256}::text
          )
      ) as present
    `,
    "objects",
  );
}

export function readRegisteredInvoiceBody(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select body from openerp.commerce_invoices where book_id = ${bookId} and id = ${invoiceId}
    `,
    "objects",
  );
}

export function readSupplierAccountSuggestions(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
) {
  return transaction.execute<SuggestionRow>(
    sql`
      select expense_account_id as "expenseAccountId", vat_rate_percent as "vatRatePercent",
        invoice_id as "sourceInvoiceId"
      from (
        select * from (
          select distinct on (x.value->>'expenseAccountId', x.value->>'vatRatePercent')
            x.value->>'expenseAccountId' as expense_account_id,
            (x.value->>'vatRatePercent')::integer as vat_rate_percent,
            a.register_invoice_id as invoice_id, a.body->>'createdAt' as accepted_at
          from openerp.supplier_acceptances a
          join openerp.supplier_acceptance_reviews r on r.book_id = a.book_id and r.id = a.review_id
          cross join lateral jsonb_array_elements(r.body->'originalLines') x(value)
          where a.book_id = ${bookId} and a.body->>'profile' = 'swedish-purchase-v1'
            and r.body->'draftSnapshot'->'content'->>'counterpartyId' = ${counterpartyId}
          order by x.value->>'expenseAccountId', x.value->>'vatRatePercent',
            a.body->>'createdAt' desc, a.register_invoice_id desc
        ) latest
        order by accepted_at desc, invoice_id desc
        limit 5
      ) s
    `,
    "objects",
  );
}

export function readSupplierCounterpartyExists(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.commerce_counterparties
        where book_id = ${bookId} and id = ${counterpartyId} and role in ('supplier', 'both')
      ) as present
    `,
    "objects",
  );
}
