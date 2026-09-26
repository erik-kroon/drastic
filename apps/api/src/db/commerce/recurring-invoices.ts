import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import { readTableAccess } from "./access";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type AgreementRow = {
  readonly id: string;
  readonly revision: string;
  readonly customerId: string;
  readonly body: JsonObject;
};

export type RevisionBoundaryRow = {
  readonly id: string;
  readonly revision: string;
  readonly effectiveFromCycle: string;
  readonly body: JsonObject;
};

export type RevisionNumberRow = { readonly revision: string };

export type EventRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly kind: string;
  readonly effectiveCycle: string;
  readonly body: JsonObject;
};

export type EventCountRow = { readonly count: number };

export type OccurrenceRow = {
  readonly id: string;
  readonly agreementId: string;
  readonly cycleOrdinal: string;
  readonly cycleDate: string;
  readonly serviceStartsOn: string;
  readonly serviceEndsOn: string;
  readonly selectedTemplateRevision: string;
  readonly selectedTemplateDigest: string;
  readonly draftId: string;
  readonly body: JsonObject;
};

export type OccurrenceIssueRow = {
  readonly id: string;
  readonly occurrenceId: string;
  readonly agreementId: string;
  readonly cycleOrdinal: string;
  readonly draftId: string;
  readonly invoiceIssueId: string;
  readonly registerInvoiceId: string;
  readonly documentNumber: string;
  readonly body: JsonObject;
};

export type OccurrenceSummaryRow = OccurrenceRow & { readonly documentNumber: string | null };

export type CountRow = { readonly count: number };

export type MaterialisedRow = { readonly cycleOrdinal: string };

export type CoverageRow = {
  readonly cycleOrdinal: string;
  readonly serviceStartsOn: string;
  readonly serviceEndsOn: string;
};

// The agreement, its template revisions, its events, its occurrences, the
// coverage they consumed and the customer draft they produced are all read
// here. Only the four recurrence tables below are ever inserted into, so a write
// check that did not ask for INSERT on exactly that set would deny the tables
// this owner writes.
export const recurringAgreementTables = [
  "recurring_invoice_agreements",
  "recurring_invoice_template_revisions",
  "recurring_invoice_agreement_events",
  "recurring_invoice_occurrences",
  "recurring_invoice_occurrence_issues",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "invoice_drafts",
  "invoice_draft_revisions",
  "invoice_issues",
  "commerce_invoices",
  "evidence",
  "books",
] as const;

export const recurringAgreementWriteTables = [
  "recurring_invoice_agreements",
  "recurring_invoice_template_revisions",
  "recurring_invoice_agreement_events",
  "recurring_invoice_occurrences",
] as const;

export const occurrenceIssueTables = [
  "recurring_invoice_occurrence_issues",
  "recurring_invoice_occurrences",
] as const;

export function readAccess(transaction: Transaction) {
  return readTableAccess(transaction, recurringAgreementTables);
}

export function readAgreement(transaction: Transaction, bookId: string, agreementId: string) {
  return transaction.execute<AgreementRow>(
    sql`
      select id, revision::text as revision, customer_id as "customerId", body
      from openerp.recurring_invoice_agreements
      where book_id = ${bookId} and id = ${agreementId}
      for share
    `,
    "objects",
  );
}

export function readTemplateRevisions(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
) {
  return transaction.execute<RevisionBoundaryRow>(
    sql`
      select id, revision::text as revision, effective_from_cycle::text as "effectiveFromCycle", body
      from openerp.recurring_invoice_template_revisions
      where book_id = ${bookId} and agreement_id = ${agreementId}
      order by effective_from_cycle, revision
      for share
    `,
    "objects",
  );
}

export function readRevisionNumber(transaction: Transaction, bookId: string, agreementId: string) {
  return transaction.execute<RevisionNumberRow>(
    sql`
      select coalesce(max(revision), 0)::text as revision
      from openerp.recurring_invoice_template_revisions
      where book_id = ${bookId} and agreement_id = ${agreementId}
    `,
    "objects",
  );
}

export function readEvents(transaction: Transaction, bookId: string, agreementId: string) {
  return transaction.execute<EventRow>(
    sql`
      select id, ordinal, kind, effective_cycle::text as "effectiveCycle", body
      from openerp.recurring_invoice_agreement_events
      where book_id = ${bookId} and agreement_id = ${agreementId}
      order by ordinal
      for share
    `,
    "objects",
  );
}

export function readEventCount(transaction: Transaction, bookId: string, agreementId: string) {
  return transaction.execute<EventCountRow>(
    sql`
      select count(*)::int as count
      from openerp.recurring_invoice_agreement_events
      where book_id = ${bookId} and agreement_id = ${agreementId}
    `,
    "objects",
  );
}

const occurrenceColumns = sql`
  id, agreement_id as "agreementId", cycle_ordinal::text as "cycleOrdinal",
  cycle_date::text as "cycleDate", service_starts_on::text as "serviceStartsOn",
  service_ends_on::text as "serviceEndsOn",
  selected_template_revision::text as "selectedTemplateRevision",
  selected_template_digest as "selectedTemplateDigest", draft_id as "draftId", body
`;

export function readOccurrence(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
  cycleOrdinal: string,
) {
  return transaction.execute<OccurrenceRow>(
    sql`
      select ${occurrenceColumns}
      from openerp.recurring_invoice_occurrences
      where book_id = ${bookId} and agreement_id = ${agreementId} and cycle_ordinal = ${cycleOrdinal}::bigint
      for share
    `,
    "objects",
  );
}

// The invoice issue owner resolves the occurrence a draft came from, so a copied
// or edited draft of an issued occurrence is still refused at issuance.
export function readOccurrenceByDraft(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<OccurrenceRow>(
    sql`
      select ${occurrenceColumns}
      from openerp.recurring_invoice_occurrences
      where book_id = ${bookId} and draft_id = ${draftId}
    `,
    "objects",
  );
}

export function readOccurrenceIssue(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
  cycleOrdinal: string,
) {
  return transaction.execute<OccurrenceIssueRow>(
    sql`
      select id, occurrence_id as "occurrenceId", agreement_id as "agreementId",
        cycle_ordinal::text as "cycleOrdinal", draft_id as "draftId",
        invoice_issue_id as "invoiceIssueId", register_invoice_id as "registerInvoiceId",
        document_number as "documentNumber", body
      from openerp.recurring_invoice_occurrence_issues
      where book_id = ${bookId} and agreement_id = ${agreementId} and cycle_ordinal = ${cycleOrdinal}::bigint
    `,
    "objects",
  );
}

// The service coverage an agreement has already billed. A later cadence or
// anchor change is refused against this set instead of billing it twice.
export function readBilledCoverage(transaction: Transaction, bookId: string, agreementId: string) {
  return transaction.execute<CoverageRow>(
    sql`
      select o.cycle_ordinal::text as "cycleOrdinal", o.service_starts_on::text as "serviceStartsOn",
        o.service_ends_on::text as "serviceEndsOn"
      from openerp.recurring_invoice_occurrences o
      where o.book_id = ${bookId} and o.agreement_id = ${agreementId}
        and exists (
          select 1 from openerp.recurring_invoice_occurrence_issues i
          where i.book_id = o.book_id and i.occurrence_id = o.id)
      order by o.cycle_ordinal
    `,
    "objects",
  );
}

export function readMaterialisedThrough(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
) {
  return transaction.execute<MaterialisedRow>(
    sql`
      select coalesce(max(cycle_ordinal), -1)::text as "cycleOrdinal"
      from openerp.recurring_invoice_occurrences
      where book_id = ${bookId} and agreement_id = ${agreementId}
    `,
    "objects",
  );
}

export function readOccurrencePage(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
  after: string | null,
) {
  return transaction.execute<OccurrenceSummaryRow>(
    sql`
      select ${occurrenceColumns}, i.document_number as "documentNumber"
      from openerp.recurring_invoice_occurrences o
      left join openerp.recurring_invoice_occurrence_issues i
        on i.book_id = o.book_id and i.occurrence_id = o.id
      where o.book_id = ${bookId} and o.agreement_id = ${agreementId}
        and (${after}::text::bigint is null or o.cycle_ordinal > ${after}::text::bigint)
      order by o.cycle_ordinal
      limit 201
    `,
    "objects",
  );
}

export function readOccurrenceCount(transaction: Transaction, bookId: string, agreementId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::int as count
      from openerp.recurring_invoice_occurrences
      where book_id = ${bookId} and agreement_id = ${agreementId}
    `,
    "objects",
  );
}

export function insertAgreement(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly customerId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly createdAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_invoice_agreements
        (book_id, id, revision, customer_id, body, digest, created_at)
      values (${row.bookId}, ${row.id}, 1, ${row.customerId},
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.createdAt})
    `,
    "objects",
  );
}

export function insertTemplateRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly agreementId: string;
    readonly revision: string;
    readonly effectiveFromCycle: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly createdAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_invoice_template_revisions
        (book_id, id, agreement_id, revision, effective_from_cycle, body, digest, created_at)
      values (${row.bookId}, ${row.id}, ${row.agreementId}, ${row.revision}::bigint,
        ${row.effectiveFromCycle}::bigint, ${JSON.stringify(row.body)}::jsonb,
        ${row.digest}, ${row.createdAt})
    `,
    "objects",
  );
}

export function insertEvent(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly agreementId: string;
    readonly ordinal: number;
    readonly kind: string;
    readonly effectiveCycle: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly createdAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_invoice_agreement_events
        (book_id, id, agreement_id, ordinal, kind, effective_cycle, body, digest, created_at)
      values (${row.bookId}, ${row.id}, ${row.agreementId}, ${row.ordinal}, ${row.kind},
        ${row.effectiveCycle}::bigint, ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.createdAt})
    `,
    "objects",
  );
}

export function insertOccurrence(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly agreementId: string;
    readonly cycleOrdinal: string;
    readonly cycleDate: string;
    readonly serviceStartsOn: string;
    readonly serviceEndsOn: string;
    readonly selectedTemplateRevision: string;
    readonly selectedTemplateDigest: string;
    readonly draftId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly createdAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_invoice_occurrences
        (book_id, id, agreement_id, cycle_ordinal, cycle_date, service_starts_on, service_ends_on,
          selected_template_revision, selected_template_digest, draft_id, body, digest, created_at)
      values (${row.bookId}, ${row.id}, ${row.agreementId}, ${row.cycleOrdinal}::bigint,
        ${row.cycleDate}::date, ${row.serviceStartsOn}::date, ${row.serviceEndsOn}::date,
        ${row.selectedTemplateRevision}::bigint, ${row.selectedTemplateDigest}, ${row.draftId},
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.createdAt})
    `,
    "objects",
  );
}

// The invoice issue owner writes the coverage consumption inside the same
// financial transaction that issues the invoice.
export function insertOccurrenceIssue(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly occurrenceId: string;
    readonly agreementId: string;
    readonly cycleOrdinal: string;
    readonly draftId: string;
    readonly invoiceIssueId: string;
    readonly registerInvoiceId: string;
    readonly documentNumber: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly createdAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_invoice_occurrence_issues
        (book_id, id, occurrence_id, agreement_id, cycle_ordinal, draft_id, invoice_issue_id,
          register_invoice_id, document_number, body, digest, created_at)
      values (${row.bookId}, ${row.id}, ${row.occurrenceId}, ${row.agreementId},
        ${row.cycleOrdinal}::bigint, ${row.draftId}, ${row.invoiceIssueId}, ${row.registerInvoiceId},
        ${row.documentNumber}, ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.createdAt})
    `,
    "objects",
  );
}
