import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const customerCreditTables = [
  "customer_credit_reviews",
  "customer_credit_approvals",
  "customer_credit_notes",
  "customer_credit_line_credits",
  "customer_credit_documents",
  "customer_credit_tax_corrections",
  "ar_legal_issues",
  "ar_legal_issue_reviews",
  "ar_legal_issue_approvals",
  "ar_legal_issue_counters",
  "ar_legal_policies",
  "ar_legal_accounting_profiles",
  "commerce_invoices",
  "commerce_invoice_revisions",
  "commerce_allocation_legs",
  "commerce_allocation_reversals",
  "commerce_control_accounts",
  "invoice_cancellations",
  "journal_lines",
  "vouchers",
  "execution_receipts",
  "change_sets",
  "command_receipts",
  "events",
  "evidence",
  "periods",
  "accounts",
  "bank_sources",
  "books",
] as const;

export type ReviewRow = { readonly body: JsonObject };

export type ApprovalRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export type CreditRow = { readonly body: JsonObject };

export type LineCreditRow = {
  readonly originalLineId: string;
  readonly netMinor: string;
  readonly taxMinor: string;
};

export type RecognitionRow = {
  readonly voucherId: string;
  readonly controlLineId: string;
  readonly eventId: string;
  readonly postingDate: string;
  readonly periodId: string;
  readonly controlAccountId: string;
  readonly debitMinor: string;
  readonly recognitionPosted: boolean;
  readonly recognitionCorrected: boolean;
};

export type TaxPeriodRow = {
  readonly id: string;
  readonly fiscalYearId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly locked: boolean;
};

export function readTaxPeriod(tx: Transaction, bookId: string, periodId: string) {
  return tx.execute<TaxPeriodRow>(
    sql`
      select p.id, p.fiscal_year_id as "fiscalYearId", p.starts_on::text as "startsOn",
        p.ends_on::text as "endsOn", p.locked
      from openerp.periods p
      where p.book_id = ${bookId} and p.id = ${periodId}
    `,
    "objects",
  );
}

export function readRecognition(
  tx: Transaction,
  bookId: string,
  voucherId: string,
  controlLineId: string,
) {
  return tx.execute<RecognitionRow>(
    sql`
      select v.id as "voucherId", l.id as "controlLineId", v.event_id as "eventId",
        v.posting_date::text as "postingDate", v.period_id as "periodId",
        l.account_id as "controlAccountId", l.debit_minor::text as "debitMinor",
        v.corrects_voucher_id is null and v.posting_purpose <> 'reversal' as "recognitionPosted",
        exists (
          select from openerp.vouchers r
          where r.book_id = v.book_id and r.corrects_voucher_id = v.id
            and r.posting_purpose = 'reversal'
        ) as "recognitionCorrected"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and l.voucher_id = ${voucherId} and l.id = ${controlLineId}
    `,
    "objects",
  );
}

// The consumed original-line capacity. Loading every distinct line once and
// aggregating separately is what keeps a repeated request leg from multiplying usage.
export function readLineCreditTotals(tx: Transaction, bookId: string, originalIssueId: string) {
  return tx.execute<LineCreditRow>(
    sql`
      select l.original_line_id as "originalLineId",
        coalesce(sum(l.net_minor), 0)::text as "netMinor",
        coalesce(sum(l.tax_minor), 0)::text as "taxMinor"
      from openerp.customer_credit_line_credits l
      join openerp.customer_credit_notes n
        on (n.book_id, n.id) = (l.book_id, l.credit_id)
      where l.book_id = ${bookId} and n.original_legal_issue_id = ${originalIssueId}
      group by l.original_line_id
      order by l.original_line_id collate "C"
    `,
    "objects",
  );
}

export function countReviews(tx: Transaction, bookId: string, originalIssueId: string) {
  return tx.execute<{ readonly total: number }>(
    sql`
      select count(*)::integer as total from openerp.customer_credit_reviews
      where book_id = ${bookId} and original_legal_issue_id = ${originalIssueId}
    `,
    "objects",
  );
}

export function readReview(tx: Transaction, bookId: string, id: string) {
  return tx.execute<ReviewRow>(
    sql`select body from openerp.customer_credit_reviews where book_id = ${bookId} and id = ${id}`,
    "objects",
  );
}

export function insertReview(
  tx: Transaction,
  book: string,
  result: typeof import("@open-erp/contracts/customer-credit-notes").CustomerCreditReview.Type,
  row: {
    readonly changeSetId: string;
    readonly eventId: string;
    readonly evidenceId: string;
  },
) {
  return tx.execute(
    sql`
      insert into openerp.customer_credit_reviews (
        book_id, id, original_legal_issue_id, register_invoice_id, accounting_profile_id,
        change_set_id, event_id, evidence_id, ordinal, credit_date, net_minor, tax_minor,
        gross_minor, unpaid_before_minor, unpaid_after_minor, body)
      values (${book}, ${result.id}, ${result.input.originalLegalIssueId},
        ${result.capacity.unpaidCapacity.registerInvoiceId},
        ${result.originalSnapshot.accountingProfileId}, ${row.changeSetId}, ${row.eventId},
        ${row.evidenceId}, ${result.ordinal}, ${result.input.creditDate}, ${result.totals.netMinor},
        ${result.totals.taxMinor}, ${result.totals.grossMinor}, ${result.unpaidBeforeMinor},
        ${result.unpaidAfterMinor}, ${JSON.stringify(result)}::jsonb)
    `,
    "objects",
  );
}

export function readApprovals(tx: Transaction, book: string, review: string) {
  return tx.execute<ApprovalRow>(
    sql`
      select id, body
      from openerp.customer_credit_approvals
      where book_id = ${book} and review_id = ${review}
      order by ordinal
    `,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  result: typeof import("@open-erp/contracts/customer-credit-notes").CustomerCreditApproval.Type,
) {
  return tx.execute(
    sql`
      insert into openerp.customer_credit_approvals (book_id, id, review_id, ordinal, actor_id, digest, expires_at, body)
      values (${book}, ${result.id}, ${result.reviewId}, ${result.ordinal}, ${result.actorId},
        ${result.digest}, ${result.expiresAt}::timestamptz, ${JSON.stringify(result)}::jsonb)
    `,
    "objects",
  );
}

export function readCreditByReview(tx: Transaction, book: string, review: string) {
  return tx.execute<CreditRow>(
    sql`
      select body
      from openerp.customer_credit_notes
      where book_id = ${book} and review_id = ${review}
    `,
    "objects",
  );
}

export function readCredit(tx: Transaction, book: string, id: string) {
  return tx.execute<CreditRow>(
    sql`
      select body
      from openerp.customer_credit_notes
      where book_id = ${book} and id = ${id}
    `,
    "objects",
  );
}

export function readCreditByOriginalIssue(
  tx: Transaction,
  book: string,
  originalIssueId: string,
  bound: number,
) {
  return tx.execute<CreditRow>(
    sql`
      select body
      from openerp.customer_credit_notes
      where book_id = ${book} and original_legal_issue_id = ${originalIssueId}
      order by credit_number
      limit ${bound + 1}
    `,
    "objects",
  );
}

// The retained credit evidence is the economic decision identity. A new request key
// that reuses a decision already carried by an issued credit is the same credit, and
// the unique index on the issued credit is the structural backstop for that refusal.
export function readCreditByEvidence(tx: Transaction, book: string, evidenceId: string) {
  return tx.execute<{ readonly id: string }>(
    sql`
      select id from openerp.customer_credit_notes
      where book_id = ${book} and evidence_id = ${evidenceId}
    `,
    "objects",
  );
}

export function insertCredit(
  tx: Transaction,
  book: string,
  result: typeof import("@open-erp/contracts/customer-credit-notes").CustomerCreditReceipt.Type,
  row: {
    readonly creditNumber: string;
    readonly periodId: string;
    readonly voucherId: string;
    readonly controlLineId: string;
  },
) {
  return tx.execute(
    sql`
      insert into openerp.customer_credit_notes (
        book_id, id, review_id, approval_id, original_legal_issue_id, register_invoice_id,
        credit_series, credit_number, credit_date, period_id, voucher_id, control_line_id,
        document_id, counterparty_id, evidence_id, net_minor, tax_minor, gross_minor,
        unpaid_after_minor, body)
      values (${book}, ${result.id}, ${result.reviewId}, ${result.approvalId},
        ${result.originalLegalIssueId}, ${result.registerInvoiceId}, ${result.creditSeries},
        ${row.creditNumber}::bigint, ${result.issuedOn}, ${row.periodId}, ${row.voucherId},
        ${row.controlLineId}, ${result.semanticDocument.documentId},
        ${result.semanticDocument.counterpartyId}, ${result.creditEvidence.evidenceId},
        ${result.totals.netMinor}, ${result.totals.taxMinor}, ${result.totals.grossMinor},
        ${result.unpaidAfterMinor}, ${JSON.stringify(result)}::jsonb)
    `,
    "objects",
  );
}

export function insertLineCredit(
  tx: Transaction,
  book: string,
  creditId: string,
  ordinal: number,
  originalLineId: string,
  netMinor: string,
  taxMinor: string,
  grossMinor: string,
  body: JsonObject,
) {
  return tx.execute(
    sql`
      insert into openerp.customer_credit_line_credits (
        book_id, credit_id, ordinal, original_line_id, net_minor, tax_minor, gross_minor, body)
      values (${book}, ${creditId}, ${ordinal}, ${originalLineId}, ${netMinor}, ${taxMinor},
        ${grossMinor}, ${JSON.stringify(body)}::jsonb)
    `,
    "objects",
  );
}

export function insertDocument(
  tx: Transaction,
  book: string,
  documentId: string,
  creditId: string,
  revision: string,
  documentDigest: string,
  body: JsonObject,
) {
  return tx.execute(
    sql`
      insert into openerp.customer_credit_documents (book_id, id, credit_id, revision, digest, body)
      values (${book}, ${documentId}, ${creditId}, ${revision}::bigint, ${documentDigest}, ${JSON.stringify(body)}::jsonb)
    `,
    "objects",
  );
}

export function insertTaxCorrection(
  tx: Transaction,
  book: string,
  correction: typeof import("@open-erp/contracts/customer-credit-notes").CustomerCreditTaxCorrection.Type,
  row: {
    readonly creditId: string;
    readonly creditVoucherId: string;
    readonly originalVoucherId: string;
    readonly originalControlLineId: string;
    readonly originalPostingDate: string;
    readonly originalEvidenceId: string;
    readonly controlLineId: string;
  },
) {
  return tx.execute(
    sql`
      insert into openerp.customer_credit_tax_corrections (
        book_id, id, credit_id, ordinal, original_line_id, original_voucher_id,
        original_control_line_id, original_posting_date, original_evidence_id, tax_period_id,
        qualified_on, base_minor, output_tax_minor, credit_voucher_id, revenue_line_id,
        output_vat_line_id, control_line_id, body)
      values (${book}, ${correction.id}, ${row.creditId}, ${correction.ordinal},
        ${correction.originalLineId}, ${row.originalVoucherId}, ${row.originalControlLineId},
        ${row.originalPostingDate}, ${row.originalEvidenceId},
        ${correction.qualifiedTaxPeriod.accountingPeriodId},
        ${correction.qualifiedTaxPeriod.qualifiedOn}, ${correction.baseMinor},
        ${correction.outputTaxMinor}, ${row.creditVoucherId}, ${correction.revenueLineId},
        ${correction.outputVatLineId}, ${row.controlLineId}, ${JSON.stringify(correction)}::jsonb)
    `,
    "objects",
  );
}
