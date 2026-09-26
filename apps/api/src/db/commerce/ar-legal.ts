import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const arLegalAccountingProfileTables = ["ar_legal_accounting_profiles"] as const;

export const arLegalIssueReceiptTables = ["ar_legal_issues"] as const;

export const arLegalIssueTables = [
  "ar_legal_issue_reviews",
  "ar_legal_issue_approvals",
  "ar_legal_issues",
  "ar_legal_policies",
  "ar_legal_accounting_profiles",
  "invoice_drafts",
  "invoice_draft_revisions",
  "invoice_issues",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "catalog_articles",
  "catalog_article_revisions",
  "periods",
  "accounts",
  "bank_sources",
  "commerce_control_accounts",
  "evidence",
  "vouchers",
  "events",
  "books",
] as const;

export const arLegalDeliveryTables = [
  "ar_legal_delivery_requests",
  "ar_legal_delivery_approvals",
  "ar_legal_delivery_attempts",
  "ar_legal_delivery_reconciliations",
  "ar_legal_pdf_captures",
] as const;

export type AccountingProfileRow = { readonly body: JsonObject };

export type LegalIssueReviewRow = { readonly body: JsonObject };

export type LegalIssueApprovalRow = {
  readonly actorId: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export type LegalIssueForReviewRow = {
  readonly id: string;
  readonly legalNumber: string;
  readonly body: JsonObject;
};

export type LegalIssueDraftRow = { readonly present: boolean };

export type LegalIssueHistoryRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly digest: string;
  readonly draftRevision: string;
  readonly createdAt: string;
  readonly issueId: string | null;
  readonly legalDocumentNumber: string | null;
};

export type DeliveryRequestRow = {
  readonly id: string;
  readonly captureId: string;
  readonly channel: string;
  readonly createdBy: string;
  readonly body: JsonObject;
};

export type DeliveryApprovalRow = { readonly body: JsonObject };

export type DeliveryAttemptRow = {
  readonly attempt: JsonObject;
  readonly reconciliation: JsonObject | null;
};

export function readArLegalAccountingProfile(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<AccountingProfileRow>(
    sql`
      select p.body
      from openerp.ar_legal_accounting_profiles p
      where p.book_id = ${bookId} and p.id = ${id}
    `,
    "objects",
  );
}

export function readArLegalIssueReview(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<LegalIssueReviewRow>(
    sql`
      select r.body
      from openerp.ar_legal_issue_reviews r
      where r.book_id = ${bookId} and r.id = ${id}
    `,
    "objects",
  );
}

export function readLatestArLegalIssueApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<LegalIssueApprovalRow>(
    sql`
      select a.actor_id as "actorId", to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        as "expiresAt", a.body
      from openerp.ar_legal_issue_approvals a
      where a.book_id = ${bookId} and a.review_id = ${reviewId}
      order by a.ordinal desc
      limit 1
    `,
    "objects",
  );
}

export function readArLegalIssueForReview(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<LegalIssueForReviewRow>(
    sql`
      select i.id, i.legal_number as "legalNumber", i.body
      from openerp.ar_legal_issues i
      where i.book_id = ${bookId} and i.review_id = ${reviewId}
    `,
    "objects",
  );
}

export function readArLegalIssueForDraft(
  transaction: Transaction,
  bookId: string,
  draftId: string,
) {
  return transaction.execute<LegalIssueDraftRow>(
    sql`
      select exists (
        select from openerp.ar_legal_issues i
        where i.book_id = ${bookId} and i.draft_id = ${draftId}
      ) as present
    `,
    "objects",
  );
}

export function readArLegalIssueHistory(
  transaction: Transaction,
  bookId: string,
  draftId: string,
  bound: number,
) {
  return transaction.execute<LegalIssueHistoryRow>(
    sql`
      select r.id, r.ordinal, r.body->>'digest' as digest,
        r.body->'draftSnapshot'->>'revision' as "draftRevision",
        r.body->>'createdAt' as "createdAt",
        i.id as "issueId", i.legal_number as "legalDocumentNumber"
      from openerp.ar_legal_issue_reviews r
      left join openerp.ar_legal_issues i on (i.book_id, i.review_id) = (r.book_id, r.id)
      where r.book_id = ${bookId} and r.draft_id = ${draftId}
      order by r.ordinal
      limit ${bound + 1}
    `,
    "objects",
  );
}

export function readLegalDeliveryRequest(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<DeliveryRequestRow>(
    sql`
      select r.id, r.capture_id as "captureId", r.channel, r.created_by as "createdBy", r.body
      from openerp.ar_legal_delivery_requests r
      where r.book_id = ${bookId} and r.id = ${id}
    `,
    "objects",
  );
}

export function readLegalDeliveryApproval(
  transaction: Transaction,
  bookId: string,
  requestId: string,
) {
  return transaction.execute<DeliveryApprovalRow>(
    sql`
      select a.body
      from openerp.ar_legal_delivery_approvals a
      where a.book_id = ${bookId} and a.request_id = ${requestId}
    `,
    "objects",
  );
}

export function readLegalDeliveryAttempts(
  transaction: Transaction,
  bookId: string,
  requestId: string,
  bound: number,
) {
  return transaction.execute<DeliveryAttemptRow>(
    sql`
      select a.body as attempt, r.body as reconciliation
      from openerp.ar_legal_delivery_attempts a
      left join openerp.ar_legal_delivery_reconciliations r
        on (r.book_id, r.attempt_id) = (a.book_id, a.id)
      where a.book_id = ${bookId} and a.request_id = ${requestId}
      order by a.ordinal
      limit ${bound + 1}
    `,
    "objects",
  );
}

export function readLegalDeliveryRequestsByCapture(
  transaction: Transaction,
  bookId: string,
  captureId: string,
  bound: number,
) {
  return transaction.execute<DeliveryRequestRow>(
    sql`
      select r.id, r.capture_id as "captureId", r.channel, r.created_by as "createdBy", r.body
      from openerp.ar_legal_delivery_requests r
      where r.book_id = ${bookId} and r.capture_id = ${captureId}
      order by r.id collate "C"
      limit ${bound + 1}
    `,
    "objects",
  );
}
