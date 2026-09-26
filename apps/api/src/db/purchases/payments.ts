import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type Json = Schema.Json;
type JsonObject = Schema.JsonObject;

export type PreviewRow = {
  readonly id: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type ExportRow = {
  readonly id: string;
  readonly previewId: string;
  readonly body: JsonObject;
};

export type OutcomeRow = { readonly body: JsonObject };

export type PayeeProposalRow = {
  readonly id: string;
  readonly counterpartyId: string;
  readonly counterpartyRevision: string;
  readonly actorId: string;
  readonly evidenceId: string;
  readonly creditorName: string;
  readonly creditorIban: string;
  readonly creditorBic: string;
  readonly body: JsonObject;
};

export type PayeeVerificationRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export type LatestProposalRow = { readonly id: string | null };

export type LatestOutcomeRow = { readonly status: string | null; readonly nextOrdinal: number };

export type CountRow = { readonly total: number };

export function readPreview(transaction: Transaction, bookId: string, previewId: string) {
  return transaction.execute<PreviewRow>(
    sql`
      select id, actor_id as "actorId", body
      from openerp.supplier_payment_batch_previews
      where book_id = ${bookId} and id = ${previewId}
    `,
    "objects",
  );
}

export function readPreviewCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from (select 1 from openerp.supplier_payment_batch_previews where book_id = ${bookId} limit 201) bounded
    `,
    "objects",
  );
}

export function insertPreview(
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
      insert into openerp.supplier_payment_batch_previews (book_id, id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readExportByPreview(transaction: Transaction, bookId: string, previewId: string) {
  return transaction.execute<ExportRow>(
    sql`
      select id, preview_id as "previewId", body
      from openerp.supplier_payment_batch_exports
      where book_id = ${bookId} and preview_id = ${previewId}
    `,
    "objects",
  );
}

export function readExport(transaction: Transaction, bookId: string, exportId: string) {
  return transaction.execute<ExportRow>(
    sql`
      select id, preview_id as "previewId", body
      from openerp.supplier_payment_batch_exports
      where book_id = ${bookId} and id = ${exportId}
    `,
    "objects",
  );
}

export function insertExport(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly previewId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_payment_batch_exports (book_id, id, preview_id, body)
      values (${row.bookId}, ${row.id}, ${row.previewId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertExportItems(
  transaction: Transaction,
  bookId: string,
  exportId: string,
  invoiceIds: ReadonlyArray<string>,
) {
  if (invoiceIds.length === 0) return transaction.execute(sql`select 1`, "objects");
  return transaction.execute(
    sql`
      insert into openerp.supplier_payment_batch_items (book_id, export_id, invoice_id)
      select ${bookId}, ${exportId}, invoice_id
      from jsonb_array_elements(${JSON.stringify(invoiceIds)}::jsonb) item(invoice_id)
    `,
    "objects",
  );
}

export function readOutcomes(transaction: Transaction, bookId: string, exportId: string) {
  return transaction.execute<OutcomeRow>(
    sql`
      select body
      from openerp.supplier_payment_outcomes
      where book_id = ${bookId} and export_id = ${exportId}
      order by ordinal
    `,
    "objects",
  );
}

export function readLatestOutcome(transaction: Transaction, bookId: string, exportId: string) {
  return transaction.execute<LatestOutcomeRow>(
    sql`
      select status, (ordinal + 1)::integer as "nextOrdinal"
      from openerp.supplier_payment_outcomes
      where book_id = ${bookId} and export_id = ${exportId}
      order by ordinal desc
      limit 1
    `,
    "objects",
  );
}

export function readPriorAcceptedOutcome(
  transaction: Transaction,
  bookId: string,
  exportId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.supplier_payment_outcomes
        where book_id = ${bookId} and export_id = ${exportId} and status = 'reported_accepted'
      ) as present
    `,
    "objects",
  );
}

export function insertOutcome(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly exportId: string;
    readonly ordinal: number;
    readonly actorId: string;
    readonly evidenceId: string;
    readonly status: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_payment_outcomes
        (book_id, id, export_id, ordinal, actor_id, evidence_id, status, body)
      values (${row.bookId}, ${row.id}, ${row.exportId}, ${row.ordinal}, ${row.actorId},
        ${row.evidenceId}, ${row.status}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readPayeeProposal(transaction: Transaction, bookId: string, proposalId: string) {
  return transaction.execute<PayeeProposalRow>(
    sql`
      select id, counterparty_id as "counterpartyId",
        counterparty_revision::text as "counterpartyRevision", actor_id as "actorId",
        evidence_id as "evidenceId", creditor_name as "creditorName", creditor_iban as "creditorIban",
        creditor_bic as "creditorBic", body
      from openerp.supplier_payee_proposals
      where book_id = ${bookId} and id = ${proposalId}
    `,
    "objects",
  );
}

export function readPayeeVerificationByProposal(
  transaction: Transaction,
  bookId: string,
  proposalId: string,
) {
  return transaction.execute<PayeeVerificationRow>(
    sql`
      select id, body
      from openerp.supplier_payee_verifications
      where book_id = ${bookId} and proposal_id = ${proposalId}
    `,
    "objects",
  );
}

export function readLatestProposalForCounterparty(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
) {
  return transaction.execute<LatestProposalRow>(
    sql`
      select id
      from openerp.supplier_payee_proposals
      where book_id = ${bookId} and counterparty_id = ${counterpartyId}
      order by body->>'createdAt' desc, id collate "C" desc
      limit 1
    `,
    "objects",
  );
}

export function insertPayeeProposal(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly counterpartyId: string;
    readonly counterpartyRevision: string;
    readonly actorId: string;
    readonly evidenceId: string;
    readonly creditorName: string;
    readonly creditorIban: string;
    readonly creditorBic: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_payee_proposals
        (book_id, id, counterparty_id, counterparty_revision, actor_id, evidence_id,
          creditor_name, creditor_iban, creditor_bic, body)
      values (${row.bookId}, ${row.id}, ${row.counterpartyId}, ${row.counterpartyRevision}::bigint,
        ${row.actorId}, ${row.evidenceId}, ${row.creditorName}, ${row.creditorIban},
        ${row.creditorBic}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertPayeeVerification(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly proposalId: string;
    readonly counterpartyId: string;
    readonly counterpartyRevision: string;
    readonly evidenceId: string;
    readonly creditorName: string;
    readonly creditorIban: string;
    readonly creditorBic: string;
    readonly actorId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_payee_verifications
        (book_id, id, proposal_id, counterparty_id, counterparty_revision, evidence_id,
          creditor_name, creditor_iban, creditor_bic, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.proposalId}, ${row.counterpartyId},
        ${row.counterpartyRevision}::bigint, ${row.evidenceId}, ${row.creditorName},
        ${row.creditorIban}, ${row.creditorBic}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readPayeeStillCurrent(transaction: Transaction, bookId: string, previewId: string) {
  return transaction.execute<{ readonly current: boolean }>(
    sql`
      select coalesce(bool_and(
        c.current_revision::text = item.value->>'counterpartyRevision' and x.id is not null
      ), false) as current
      from jsonb_array_elements((
        select p.body->'selection'->'items' from openerp.supplier_payment_batch_previews p
        where p.book_id = ${bookId} and p.id = ${previewId}
      )) item(value)
      join openerp.commerce_invoices i on i.book_id = ${bookId} and i.id = item.value->>'invoiceId'
      join openerp.commerce_counterparties c on c.book_id = i.book_id and c.id = i.counterparty_id
      left join openerp.supplier_payee_verifications x
        on x.book_id = i.book_id and x.proposal_id = item.value->>'payeeVerificationId'
       and x.counterparty_id = c.id and x.counterparty_revision = c.current_revision
    `,
    "objects",
  );
}

export function readInvoiceIds(transaction: Transaction, bookId: string, exportId: string) {
  return transaction.execute<{ readonly invoiceId: string }>(
    sql`
      select invoice_id as "invoiceId"
      from openerp.supplier_payment_batch_items
      where book_id = ${bookId} and export_id = ${exportId}
      order by invoice_id
    `,
    "objects",
  );
}

export function readCounterpartyRevision(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
) {
  return transaction.execute<{ readonly currentRevision: string; readonly role: string }>(
    sql`
      select current_revision::text as "currentRevision", role
      from openerp.commerce_counterparties
      where book_id = ${bookId} and id = ${counterpartyId}
    `,
    "objects",
  );
}

export function readDatabaseDate(transaction: Transaction) {
  return transaction.execute<{ readonly today: string }>(
    sql`select (clock_timestamp() at time zone 'UTC')::date::text as today`,
    "objects",
  );
}

export type { Json as PaymentJson };
