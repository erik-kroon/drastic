import { textArray } from "../sql-values";
import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";
import type * as Acceptance from "@open-erp/contracts/supplier-acceptance";

export function insertAcceptance(
  tx: Transaction,
  book: string,
  result: typeof Acceptance.SupplierAcceptanceReceipt.Type,
) {
  return tx.execute(
    sql`insert into openerp.supplier_acceptances
    (book_id,id,review_id,approval_id,draft_id,draft_revision,posting_receipt_id,register_invoice_id,body)
    values(${book},${result.id},${result.reviewId},${result.approvalId},${result.draftId},${result.draftRevision}::bigint,
      ${result.postingReceipt.id},${result.registerInvoiceId},${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}

type JsonObject = Schema.JsonObject;

export type ReviewRow = {
  readonly id: string;
  readonly draftId: string;
  readonly draftRevision: string;
  readonly ordinal: number;
  readonly changeSetId: string;
  readonly eventId: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export type ApprovalRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly ordinal: number;
  readonly body: JsonObject;
};

export type AcceptanceRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly draftId: string;
  readonly body: JsonObject;
};

export type DraftHeadRow = {
  readonly currentRevision: string;
  readonly body: JsonObject;
};

export type AccountCodeRow = { readonly id: string | null };

export type AccountRow = { readonly id: string; readonly code: string; readonly active: boolean };

export type CountRow = { readonly total: number };

export type HistoryRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly draftRevision: string;
  readonly digest: string;
  readonly createdAt: string;
  readonly acceptanceId: string | null;
  readonly supplierDocumentNumber: string | null;
};

export function readDraftHead(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<DraftHeadRow>(
    sql`
      select d.current_revision::text as "currentRevision", r.body
      from openerp.supplier_invoice_drafts d
      join openerp.supplier_invoice_draft_revisions r
        on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
      where d.book_id = ${bookId} and d.id = ${draftId}
    `,
    "objects",
  );
}

export function readDraftExists(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.supplier_invoice_drafts where book_id = ${bookId} and id = ${draftId}
      ) as present
    `,
    "objects",
  );
}

export function readAcceptanceForDraft(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.supplier_acceptances
        where book_id = ${bookId} and draft_id = ${draftId}
      ) as present
    `,
    "objects",
  );
}

export function readReviewCount(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.supplier_acceptance_reviews
      where book_id = ${bookId} and draft_id = ${draftId}
    `,
    "objects",
  );
}

export function readReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select id, draft_id as "draftId", draft_revision::text as "draftRevision", ordinal,
        change_set_id as "changeSetId", event_id as "eventId", evidence_id as "evidenceId", body
      from openerp.supplier_acceptance_reviews
      where book_id = ${bookId} and id = ${reviewId}
    `,
    "objects",
  );
}

export function readReviewByChangeSet(
  transaction: Transaction,
  bookId: string,
  changeSetId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.execution_receipts
        where book_id = ${bookId} and change_set_id = ${changeSetId}
      ) as present
    `,
    "objects",
  );
}

export function insertReview(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly draftId: string;
    readonly draftRevision: string;
    readonly ordinal: number;
    readonly changeSetId: string;
    readonly eventId: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_acceptance_reviews
        (book_id, id, draft_id, draft_revision, ordinal, change_set_id, event_id, evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.draftId}, ${row.draftRevision}::bigint, ${row.ordinal},
        ${row.changeSetId}, ${row.eventId}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readApprovalCount(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.supplier_acceptance_approvals
      where book_id = ${bookId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export function readApproval(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, review_id as "reviewId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.supplier_acceptance_approvals
      where book_id = ${bookId} and review_id = ${reviewId}
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
  reviewId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, review_id as "reviewId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.supplier_acceptance_approvals
      where book_id = ${bookId} and id = ${approvalId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export function insertApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly reviewId: string;
    readonly ordinal: number;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_acceptance_approvals
        (book_id, id, review_id, ordinal, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.ordinal}, ${row.actorId},
        ${row.digest}, ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readAcceptanceByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<AcceptanceRow>(
    sql`
      select id, review_id as "reviewId", approval_id as "approvalId", draft_id as "draftId", body
      from openerp.supplier_acceptances
      where book_id = ${bookId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export function readAcceptanceByApproval(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.supplier_acceptances
        where book_id = ${bookId} and approval_id = ${approvalId}
      ) as present
    `,
    "objects",
  );
}

export function readBasAccount(transaction: Transaction, bookId: string, code: string) {
  return transaction.execute<AccountCodeRow>(
    sql`
      select id
      from openerp.accounts
      where book_id = ${bookId} and code = ${code} and active
    `,
    "objects",
  );
}

export function readExpenseAccount(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  excluded: ReadonlyArray<string>,
) {
  return transaction.execute<AccountRow>(
    sql`
      select id, code, active
      from openerp.accounts
      where book_id = ${bookId} and id = ${accountId} and active
        and code ~ '^[4-8][0-9]{3}$'
        and not (id = any(${textArray(excluded)}))
      for share
    `,
    "objects",
  );
}

export function readBankSourceConflict(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_sources
        where book_id = ${bookId} and account_id = any(${textArray(accountIds)})
      ) as present
    `,
    "objects",
  );
}

export function readControlAccountConflict(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
  direction: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.commerce_control_accounts
        where book_id = ${bookId} and account_id = any(${textArray(accountIds)})
          and direction <> ${direction}
      ) as present
    `,
    "objects",
  );
}

export function readAcceptanceHistory(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<HistoryRow>(
    sql`
      select r.id, r.ordinal, r.draft_revision::text as "draftRevision", r.body->>'digest' as digest,
        r.body->>'createdAt' as "createdAt", i.id as "acceptanceId",
        i.body->>'supplierDocumentNumber' as "supplierDocumentNumber"
      from openerp.supplier_acceptance_reviews r
      left join openerp.supplier_acceptances i on i.book_id = r.book_id and i.review_id = r.id
      where r.book_id = ${bookId} and r.draft_id = ${draftId}
      order by r.ordinal
    `,
    "objects",
  );
}

export function readDatabaseTime(transaction: Transaction) {
  return transaction.execute<{ readonly now: string }>(
    sql`select clock_timestamp()::text as now`,
    "objects",
  );
}
