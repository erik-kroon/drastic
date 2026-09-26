import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const invoiceDocumentTables = [
  "invoice_document_captures",
  "invoice_document_artifacts",
  "invoice_issues",
  "invoice_issue_reviews",
  "execution_receipts",
  "commerce_invoices",
  "evidence",
] as const;

export const invoicePdfTables = [
  "invoice_pdf_captures",
  "invoice_pdf_artifacts",
  "invoice_issues",
  "invoice_issue_reviews",
  "execution_receipts",
  "commerce_invoices",
  "evidence",
] as const;

export const legalInvoicePdfTables = [
  "ar_legal_pdf_captures",
  "ar_legal_pdf_artifacts",
  "ar_legal_issues",
  "ar_legal_policies",
  "execution_receipts",
  "commerce_invoices",
] as const;

export type IssueRow = {
  readonly reviewId: string;
  readonly issue: JsonObject;
  readonly review: JsonObject;
};

export type DocumentCaptureRow = {
  readonly id: string;
  readonly issueId: string;
  readonly reviewId: string;
  readonly generatorVersion: string;
  readonly body: JsonObject;
};

export type PdfCaptureRow = {
  readonly id: string;
  readonly issueId: string;
  readonly body: JsonObject;
};

export type ArtifactRow = {
  readonly descriptor: JsonObject;
  readonly contentBase64: string;
};

export type DocumentHistoryRow = {
  readonly id: string;
  readonly captureDigest: string;
  readonly createdAt: string;
  readonly generatorVersion: string;
  readonly sealed: boolean;
  readonly sha256: string | null;
};

export type PdfHistoryRow = {
  readonly id: string;
  readonly captureDigest: string;
  readonly sealed: boolean;
  readonly sha256: string | null;
};

export type SealedBytesRow = { readonly content: Uint8Array };

export type AgreementRow = { readonly agreed: boolean };

export type RegisterAgreementRow = { readonly agreed: boolean };

export function readIssueWithReview(
  transaction: Transaction,
  bookId: string,
  issueId: string,
  lock: "share" | "update",
) {
  const lockClause = lock === "update" ? sql`for update of i` : sql`for share of i`;

  return transaction.execute<IssueRow>(
    sql`
      select r.id as "reviewId", i.body as issue, r.body as review
      from openerp.invoice_issues i
      join openerp.invoice_issue_reviews r on (r.book_id, r.id) = (i.book_id, i.review_id)
      where i.book_id = ${bookId} and i.id = ${issueId}
      ${lockClause}
    `,
    "objects",
  );
}

export type IssueRegisterBinding = {
  readonly postingReceipt: JsonObject;
  readonly changeSetId: string;
  readonly registerInvoiceId: string;
  readonly voucherId: string;
  readonly documentNumber: string;
};

export function readIssueRegisterAgreement(
  transaction: Transaction,
  bookId: string,
  binding: IssueRegisterBinding,
) {
  return transaction.execute<RegisterAgreementRow>(
    sql`
      select exists (
        select 1 from openerp.execution_receipts e
        where e.book_id = ${bookId} and e.id = ${binding.postingReceipt.id}
          and e.body = ${JSON.stringify(binding.postingReceipt)}::jsonb
          and e.change_set_id = ${binding.changeSetId}
      ) and exists (
        select 1 from openerp.commerce_invoices i
        where i.book_id = ${bookId} and i.id = ${binding.registerInvoiceId}
          and i.recognition_voucher_id = ${binding.voucherId}
          and i.document_number = ${binding.documentNumber}
      ) as agreed
    `,
    "objects",
  );
}

export function readEvidenceAgreement(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
  sha256: string,
) {
  return transaction.execute<AgreementRow>(
    sql`
      select exists (
        select 1 from openerp.evidence e
        where e.book_id = ${bookId} and e.id = ${evidenceId} and e.sha256 = ${sha256}
      ) as agreed
    `,
    "objects",
  );
}

export function readDocumentCaptureByGenerator(
  transaction: Transaction,
  bookId: string,
  issueId: string,
  generatorVersion: string,
) {
  return transaction.execute<DocumentCaptureRow>(
    sql`
      select c.id, c.issue_id as "issueId", c.review_id as "reviewId",
        c.generator_version as "generatorVersion", c.body
      from openerp.invoice_document_captures c
      where c.book_id = ${bookId} and c.issue_id = ${issueId}
        and c.generator_version = ${generatorVersion}
    `,
    "objects",
  );
}

export function readDocumentCapture(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<DocumentCaptureRow>(
    sql`
      select c.id, c.issue_id as "issueId", c.review_id as "reviewId",
        c.generator_version as "generatorVersion", c.body
      from openerp.invoice_document_captures c
      where c.book_id = ${bookId} and c.id = ${id}
    `,
    "objects",
  );
}

export function insertDocumentCapture(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    issueId: string;
    reviewId: string;
    generatorVersion: string;
    actorId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_document_captures
        (book_id, id, issue_id, review_id, generator_version, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.issueId}, ${row.reviewId}, ${row.generatorVersion},
        ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readIssueReviewAgreement(
  transaction: Transaction,
  bookId: string,
  issueId: string,
  reviewId: string,
  issueBody: JsonObject,
  reviewBody: JsonObject,
) {
  return transaction.execute<AgreementRow>(
    sql`
      select exists (
        select 1
        from openerp.invoice_issues i
        join openerp.invoice_issue_reviews r on (r.book_id, r.id) = (i.book_id, i.review_id)
        where i.book_id = ${bookId} and i.id = ${issueId} and r.id = ${reviewId}
          and i.body = ${JSON.stringify(issueBody)}::jsonb
          and r.body = ${JSON.stringify(reviewBody)}::jsonb
      ) as agreed
    `,
    "objects",
  );
}

export function readDocumentArtifact(transaction: Transaction, bookId: string, captureId: string) {
  return transaction.execute<ArtifactRow>(
    sql`
      select a.descriptor, replace(encode(a.content, 'base64'), E'\n', '') as "contentBase64"
      from openerp.invoice_document_artifacts a
      where a.book_id = ${bookId} and a.capture_id = ${captureId}
    `,
    "objects",
  );
}

export function readSealedBytes(
  transaction: Transaction,
  table: "invoice_document_artifacts" | "invoice_pdf_artifacts" | "ar_legal_pdf_artifacts",
  bookId: string,
  captureId: string,
) {
  return transaction.execute<SealedBytesRow>(
    sql`
      select content from openerp.${sql.identifier(table)}
      where book_id = ${bookId} and capture_id = ${captureId}
    `,
    "objects",
  );
}

export function insertArtifact(
  transaction: Transaction,
  table: "invoice_document_artifacts" | "invoice_pdf_artifacts" | "ar_legal_pdf_artifacts",
  row: { bookId: string; captureId: string; descriptor: JsonObject; content: Uint8Array },
) {
  return transaction.execute(
    sql`
      insert into openerp.${sql.identifier(table)} (book_id, capture_id, descriptor, content)
      values (${row.bookId}, ${row.captureId}, ${JSON.stringify(row.descriptor)}::jsonb, ${row.content})
    `,
    "objects",
  );
}

export function readDocumentHistory(transaction: Transaction, bookId: string, issueId: string) {
  return transaction.execute<DocumentHistoryRow>(
    sql`
      select c.id, c.body->>'digest' as "captureDigest", c.body->>'createdAt' as "createdAt",
        c.generator_version as "generatorVersion", a.capture_id is not null as sealed,
        a.descriptor->>'sha256' as sha256
      from openerp.invoice_document_captures c
      left join openerp.invoice_document_artifacts a on (a.book_id, a.capture_id) = (c.book_id, c.id)
      where c.book_id = ${bookId} and c.issue_id = ${issueId}
      order by c.generator_version desc, c.id
    `,
    "objects",
  );
}

export function readPdfCapture(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<PdfCaptureRow>(
    sql`
      select c.id, c.issue_id as "issueId", c.body
      from openerp.invoice_pdf_captures c
      where c.book_id = ${bookId} and c.id = ${id}
    `,
    "objects",
  );
}

export function readPdfCaptureByIssue(transaction: Transaction, bookId: string, issueId: string) {
  return transaction.execute<PdfCaptureRow>(
    sql`
      select c.id, c.issue_id as "issueId", c.body
      from openerp.invoice_pdf_captures c
      where c.book_id = ${bookId} and c.issue_id = ${issueId}
    `,
    "objects",
  );
}

export function insertPdfCapture(
  transaction: Transaction,
  row: { bookId: string; id: string; issueId: string; actorId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_pdf_captures (book_id, id, issue_id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.issueId}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readPdfSourceAgreement(
  transaction: Transaction,
  bookId: string,
  issueId: string,
  issueBody: JsonObject,
  reviewBody: JsonObject,
) {
  return transaction.execute<AgreementRow>(
    sql`
      select exists (
        select 1
        from openerp.invoice_issues i
        join openerp.invoice_issue_reviews r on (r.book_id, r.id) = (i.book_id, i.review_id)
        where i.book_id = ${bookId} and i.id = ${issueId}
          and i.body = ${JSON.stringify(issueBody)}::jsonb
          and r.body = ${JSON.stringify(reviewBody)}::jsonb
      ) as agreed
    `,
    "objects",
  );
}

export function readPdfArtifact(transaction: Transaction, bookId: string, captureId: string) {
  return transaction.execute<ArtifactRow>(
    sql`
      select a.descriptor, replace(encode(a.content, 'base64'), E'\n', '') as "contentBase64"
      from openerp.invoice_pdf_artifacts a
      where a.book_id = ${bookId} and a.capture_id = ${captureId}
    `,
    "objects",
  );
}

export function readPdfHistory(transaction: Transaction, bookId: string, issueId: string) {
  return transaction.execute<PdfHistoryRow>(
    sql`
      select c.id, c.body->>'digest' as "captureDigest", a.capture_id is not null as sealed,
        a.descriptor->>'sha256' as sha256
      from openerp.invoice_pdf_captures c
      left join openerp.invoice_pdf_artifacts a on (a.book_id, a.capture_id) = (c.book_id, c.id)
      where c.book_id = ${bookId} and c.issue_id = ${issueId}
      order by c.id
    `,
    "objects",
  );
}

export function readLegalIssue(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<PdfCaptureRow>(
    sql`
      select i.id, i.id as "issueId", i.body
      from openerp.ar_legal_issues i
      where i.book_id = ${bookId} and i.id = ${id}
    `,
    "objects",
  );
}

export type LegalIssueBinding = {
  readonly policyId: string;
  readonly policySnapshot: JsonObject;
  readonly postingReceipt: JsonObject;
  readonly voucherId: string;
  readonly registerInvoiceId: string;
  readonly documentNumber: string;
};

export function readLegalIssueAgreement(
  transaction: Transaction,
  bookId: string,
  binding: LegalIssueBinding,
) {
  return transaction.execute<AgreementRow>(
    sql`
      select exists (
        select 1 from openerp.ar_legal_policies p
        where p.book_id = ${bookId} and p.id = ${binding.policyId}
          and p.body = ${JSON.stringify(binding.policySnapshot)}::jsonb
      ) and exists (
        select 1 from openerp.execution_receipts e
        where e.book_id = ${bookId} and e.id = ${binding.postingReceipt.id}
          and e.body = ${JSON.stringify(binding.postingReceipt)}::jsonb
      ) and exists (
        select 1 from openerp.commerce_invoices i
        where i.book_id = ${bookId} and i.id = ${binding.registerInvoiceId}
          and i.document_number = ${binding.documentNumber}
          and i.recognition_voucher_id = ${binding.voucherId}
      ) as agreed
    `,
    "objects",
  );
}

export function readLegalCapture(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<PdfCaptureRow>(
    sql`
      select c.id, c.issue_id as "issueId", c.body
      from openerp.ar_legal_pdf_captures c
      where c.book_id = ${bookId} and c.id = ${id}
    `,
    "objects",
  );
}

export function readLegalCaptureByIssue(transaction: Transaction, bookId: string, issueId: string) {
  return transaction.execute<PdfCaptureRow>(
    sql`
      select c.id, c.issue_id as "issueId", c.body
      from openerp.ar_legal_pdf_captures c
      where c.book_id = ${bookId} and c.issue_id = ${issueId}
    `,
    "objects",
  );
}

export function insertLegalCapture(
  transaction: Transaction,
  row: { bookId: string; id: string; issueId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.ar_legal_pdf_captures (book_id, id, issue_id, body)
      values (${row.bookId}, ${row.id}, ${row.issueId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readLegalIssueSourceAgreement(
  transaction: Transaction,
  bookId: string,
  issueId: string,
  issueBody: JsonObject,
) {
  return transaction.execute<AgreementRow>(
    sql`
      select exists (
        select 1 from openerp.ar_legal_issues i
        where i.book_id = ${bookId} and i.id = ${issueId}
          and i.body = ${JSON.stringify(issueBody)}::jsonb
      ) as agreed
    `,
    "objects",
  );
}

export function readLegalArtifact(transaction: Transaction, bookId: string, captureId: string) {
  return transaction.execute<ArtifactRow>(
    sql`
      select a.descriptor, replace(encode(a.content, 'base64'), E'\n', '') as "contentBase64"
      from openerp.ar_legal_pdf_artifacts a
      where a.book_id = ${bookId} and a.capture_id = ${captureId}
    `,
    "objects",
  );
}

export function readLegalPdfHistory(transaction: Transaction, bookId: string, issueId: string) {
  return transaction.execute<PdfHistoryRow>(
    sql`
      select c.id, c.body->>'digest' as "captureDigest", a.capture_id is not null as sealed,
        a.descriptor->>'sha256' as sha256
      from openerp.ar_legal_pdf_captures c
      left join openerp.ar_legal_pdf_artifacts a on (a.book_id, a.capture_id) = (c.book_id, c.id)
      where c.book_id = ${bookId} and c.issue_id = ${issueId}
      order by c.id
    `,
    "objects",
  );
}
