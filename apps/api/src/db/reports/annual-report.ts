import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// The annual-report owner's own tables plus every retained record it reads:
// the fiscal year, the NEXT-23 financial-close certificate chain, the
// NEXT-13 statement snapshots and the close evidence. This module selects and
// persists; it never chooses a framework, derives a fact or renders a byte.
export const annualReportTables = [
  "books",
  "accounts",
  "periods",
  "fiscal_years",
  "evidence",
  "events",
  "change_sets",
  "execution_receipts",
  "command_receipts",
  "report_statement_snapshots",
  "report_statement_rows",
  "financial_close_certificates",
  "financial_reopen_events",
  "annual_report_drafts",
  "annual_report_approvals",
  "annual_report_finals",
  "annual_report_presentations",
  "annual_report_artifacts",
] as const;

export const annualReportInserts = [
  "annual_report_drafts",
  "annual_report_approvals",
  "annual_report_finals",
  "annual_report_presentations",
  "annual_report_artifacts",
  "change_sets",
  "events",
  "command_receipts",
] as const;

export type BodyRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export type DraftRow = BodyRow & {
  readonly fiscalYearId: string;
};

export type ApprovalRow = {
  readonly id: string;
  readonly draftId: string;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly ordinal: number;
  readonly body: JsonObject;
};

export type CountRow = { readonly total: number };

export function readDraftsForYear(transaction: Transaction, bookId: string, fiscalYearId: string) {
  return transaction.execute<DraftRow>(
    sql`
      select id, fiscal_year_id as "fiscalYearId", body
      from openerp.annual_report_drafts
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
      order by recorded_at, id collate "C"
    `,
    "objects",
  );
}

export function readDraft(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<DraftRow>(
    sql`
      select id, fiscal_year_id as "fiscalYearId", body
      from openerp.annual_report_drafts
      where book_id = ${bookId} and id = ${draftId}
    `,
    "objects",
  );
}

export function insertDraft(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly fiscalYearId: string;
    readonly closeCertificateId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.annual_report_drafts
        (book_id, id, fiscal_year_id, close_certificate_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.fiscalYearId}, ${row.closeCertificateId},
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readApprovalCount(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.annual_report_approvals
      where book_id = ${bookId} and draft_id = ${draftId}
    `,
    "objects",
  );
}

export function readApproval(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, draft_id as "draftId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.annual_report_approvals
      where book_id = ${bookId} and draft_id = ${draftId}
      order by ordinal desc
      limit 1
    `,
    "objects",
  );
}

export function readApprovalById(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
  draftId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, draft_id as "draftId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.annual_report_approvals
      where book_id = ${bookId} and id = ${approvalId} and draft_id = ${draftId}
    `,
    "objects",
  );
}

export function insertApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly draftId: string;
    readonly ordinal: number;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.annual_report_approvals
        (book_id, id, draft_id, ordinal, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.draftId}, ${row.ordinal}, ${row.actorId},
        ${row.digest}, ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readFinalByDraft(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.annual_report_finals
      where book_id = ${bookId} and draft_id = ${draftId}
    `,
    "objects",
  );
}

export function readFinal(transaction: Transaction, bookId: string, finalId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.annual_report_finals
      where book_id = ${bookId} and id = ${finalId}
    `,
    "objects",
  );
}

export function insertFinal(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly draftId: string;
    readonly approvalId: string;
    readonly fiscalYearId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.annual_report_finals
        (book_id, id, draft_id, approval_id, fiscal_year_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.draftId}, ${row.approvalId}, ${row.fiscalYearId},
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readPresentationByFinal(transaction: Transaction, bookId: string, finalId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.annual_report_presentations
      where book_id = ${bookId} and final_id = ${finalId}
    `,
    "objects",
  );
}

export function readPresentation(transaction: Transaction, bookId: string, presentationId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.annual_report_presentations
      where book_id = ${bookId} and id = ${presentationId}
    `,
    "objects",
  );
}

export function insertPresentation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly finalId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.annual_report_presentations
        (book_id, id, final_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.finalId},
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readArtifactByPresentation(
  transaction: Transaction,
  bookId: string,
  presentationId: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.annual_report_artifacts
      where book_id = ${bookId} and presentation_id = ${presentationId}
    `,
    "objects",
  );
}

export function insertArtifact(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly presentationId: string;
    readonly finalId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.annual_report_artifacts
        (book_id, id, presentation_id, final_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.presentationId}, ${row.finalId},
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}
