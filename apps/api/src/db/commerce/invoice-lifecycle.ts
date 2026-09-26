import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const invoiceDraftTables = [
  "invoice_drafts",
  "invoice_draft_revisions",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "evidence",
  "books",
] as const;

export const invoiceIssueTables = [
  "invoice_issue_reviews",
  "invoice_issue_approvals",
  "invoice_issue_counters",
  "invoice_issues",
  "books",
  "series_counters",
] as const;

export const invoiceIssueRegisterTables = [
  "commerce_invoices",
  "commerce_invoice_revisions",
  "commerce_active_allocation_legs",
  "commerce_allocation_reversals",
  "invoice_cancellations",
  "vouchers",
  "execution_receipts",
] as const;

export const counterpartyTables = [
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "evidence",
  "books",
  "memberships",
] as const;

export const invoiceRegisterTables = [
  "commerce_invoices",
  "commerce_invoice_revisions",
  "commerce_allocation_legs",
  "commerce_allocation_receipts",
  "commerce_allocation_reversals",
  "commerce_control_accounts",
  "journal_lines",
  "vouchers",
  "events",
  "periods",
  "accounts",
  "bank_sources",
  "evidence",
  "books",
  "memberships",
  "invoice_cancellations",
  "execution_receipts",
] as const;

export type BookCurrencyRow = {
  readonly authority: string;
  readonly currency: string;
  readonly currencyScale: number;
};

export type CounterpartyRow = {
  readonly id: string;
  readonly role: string;
  readonly currentRevision: string;
  readonly revision: JsonObject;
};

export type DraftRow = {
  readonly id: string;
  readonly draftKey: string;
  readonly currentRevision: string;
};

export type DraftBodyRow = {
  readonly body: JsonObject;
  readonly total: number;
  readonly hasMore: boolean;
};

export type DraftCountRow = { readonly count: number };

export type DraftOrdinalRow = { readonly ordinal: number };

export type CounterRow = { readonly nextNumber: string };

export type BookProfileRow = {
  readonly authority: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly profile: string;
};

export function readBookCurrency(transaction: Transaction, bookId: string) {
  return transaction.execute<BookCurrencyRow>(
    sql`
      select b.authority, b.currency, b.currency_scale as "currencyScale"
      from openerp.books b
      where b.id = ${bookId}
    `,
    "objects",
  );
}

export function readBookProfile(transaction: Transaction, bookId: string) {
  return transaction.execute<BookProfileRow>(
    sql`
      select b.authority, b.currency, b.currency_scale as "currencyScale", b.profile
      from openerp.books b
      where b.id = ${bookId}
    `,
    "objects",
  );
}

export function readCustomerCounterparty(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
) {
  return transaction.execute<CounterpartyRow>(
    sql`
      select c.id, c.role, c.current_revision as "currentRevision", r.body as revision
      from openerp.commerce_counterparties c
      join openerp.commerce_counterparty_revisions r
        on r.book_id = c.book_id and r.counterparty_id = c.id and r.revision = c.current_revision
      where c.book_id = ${bookId} and c.id = ${counterpartyId}
    `,
    "objects",
  );
}

export function readDraftByKey(transaction: Transaction, bookId: string, draftKey: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select from openerp.invoice_drafts d where d.book_id = ${bookId} and d.draft_key = ${draftKey}
      ) as present
    `,
    "objects",
  );
}

export function readDraftCount(transaction: Transaction, bookId: string, bound: number) {
  return transaction.execute<DraftCountRow>(
    sql`
      select count(*)::integer as count from (
        select 1 from openerp.invoice_drafts d where d.book_id = ${bookId} limit ${bound + 1}
      ) bounded
    `,
    "objects",
  );
}

export function readDraft(transaction: Transaction, bookId: string, id: string, lock: boolean) {
  return transaction.execute<DraftRow>(
    sql`
      select d.id, d.draft_key as "draftKey", d.current_revision as "currentRevision"
      from openerp.invoice_drafts d
      where d.book_id = ${bookId} and d.id = ${id}
      ${lock ? sql`for update of d` : sql``}
    `,
    "objects",
  );
}

export function readDraftHead(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<DraftBodyRow>(
    sql`
      select r.body, false as "hasMore"
      from openerp.invoice_drafts d
      join openerp.invoice_draft_revisions r
        on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
      where d.book_id = ${bookId} and d.id = ${id}
    `,
    "objects",
  );
}

export function readDraftRevision(
  transaction: Transaction,
  bookId: string,
  id: string,
  revision: string,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select r.body from openerp.invoice_draft_revisions r
      where r.book_id = ${bookId} and r.draft_id = ${id} and r.revision = ${revision}::bigint
    `,
    "objects",
  );
}

export function readDraftHistory(
  transaction: Transaction,
  bookId: string,
  id: string,
  bound: number,
) {
  return transaction.execute<DraftBodyRow>(
    sql`
      select r.body, count(*) over () > ${bound} as "hasMore"
      from openerp.invoice_draft_revisions r
      where r.book_id = ${bookId} and r.draft_id = ${id}
      order by r.revision
      limit ${bound + 1}
    `,
    "objects",
  );
}

export function insertDraft(
  transaction: Transaction,
  row: { bookId: string; id: string; draftKey: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_drafts (book_id, id, draft_key, current_revision)
      values (${row.bookId}, ${row.id}, ${row.draftKey}, 1)
    `,
    "objects",
  );
}

export function insertDraftRevision(
  transaction: Transaction,
  row: { bookId: string; draftId: string; revision: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_draft_revisions (book_id, draft_id, revision, body)
      values (${row.bookId}, ${row.draftId}, ${row.revision}::bigint, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function advanceDraftRevision(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute(
    sql`
      update openerp.invoice_drafts set current_revision = current_revision + 1
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readDraftSummaries(
  transaction: Transaction,
  bookId: string,
  draftId: string | null,
  bound: number,
) {
  return transaction.execute<DraftBodyRow>(
    sql`
      select summary.body, count(*) over () as total, count(*) over () > ${bound} as "hasMore"
      from (
        select r.body, d.draft_key
        from openerp.invoice_drafts d
        join openerp.invoice_draft_revisions r
          on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
        where d.book_id = ${bookId} and (${draftId}::text is null or d.id = ${draftId})
      ) source
      cross join lateral (
        select jsonb_build_object(
          'id', source.body->>'id',
          'draftKey', source.body->>'draftKey',
          'revision', source.body->>'revision',
          'title', source.body->'content'->>'title',
          'customerName', source.body->'content'->'customer'->>'legalName',
          'currency', source.body->'content'->>'currency',
          'currencyScale', source.body->'content'->'currencyScale',
          'grossMinor', source.body->'totals'->'grossMinor',
          'blockerCount', jsonb_array_length(source.body->'blockers'),
          'createdAt', source.body->>'createdAt',
          'digest', source.body->>'digest'
        ) as body
      ) summary
      order by source.draft_key collate "C", source.body->>'revision' collate "C"
    `,
    "objects",
  );
}

export function readIssueOrdinal(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<DraftOrdinalRow>(
    sql`
      select coalesce(max(r.ordinal), 0) + 1 as ordinal
      from openerp.invoice_issue_reviews r
      where r.book_id = ${bookId} and r.draft_id = ${draftId}
    `,
    "objects",
  );
}

export type IssueReviewRow = {
  readonly id: string;
  readonly draftId: string;
  readonly draftRevision: string;
  readonly ordinal: number;
  readonly changeSetId: string;
  readonly eventId: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export type IssueApprovalRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly ordinal: number;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export type IssueRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly draftId: string;
  readonly internalNumber: string;
  readonly body: JsonObject;
};

export type RegisterLineRow = {
  readonly id: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly voucherId: string;
  readonly eventId: string;
  readonly postingDate: string;
  readonly periodLocked: boolean;
  readonly evidenceRefs: JsonObject;
};

export type ControlAccountRow = { readonly present: boolean };

export type DuplicateRow = { readonly present: boolean };

export function readIssueReview(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<IssueReviewRow>(
    sql`
      select r.id, r.draft_id as "draftId", r.draft_revision as "draftRevision", r.ordinal,
        r.change_set_id as "changeSetId", r.event_id as "eventId", r.evidence_id as "evidenceId", r.body
      from openerp.invoice_issue_reviews r
      where r.book_id = ${bookId} and r.id = ${id}
    `,
    "objects",
  );
}

export function insertIssueReview(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    draftId: string;
    draftRevision: string;
    ordinal: number;
    changeSetId: string;
    eventId: string;
    evidenceId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_issue_reviews
        (book_id, id, draft_id, draft_revision, ordinal, change_set_id, event_id, evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.draftId}, ${row.draftRevision}::bigint, ${row.ordinal},
        ${row.changeSetId}, ${row.eventId}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readIssueApprovalCount(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<{ readonly count: number }>(
    sql`
      select count(*)::integer as count from openerp.invoice_issue_approvals
      where book_id = ${bookId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export function insertIssueApproval(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    reviewId: string;
    ordinal: number;
    actorId: string;
    digest: string;
    expiresAt: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_issue_approvals
        (book_id, id, review_id, ordinal, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.ordinal}, ${row.actorId}, ${row.digest},
        ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readIssueApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  approvalId: string,
) {
  return transaction.execute<IssueApprovalRow>(
    sql`
      select a.id, a.review_id as "reviewId", a.ordinal, a.actor_id as "actorId", a.digest,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt", a.body
      from openerp.invoice_issue_approvals a
      where a.book_id = ${bookId} and a.review_id = ${reviewId} and a.id = ${approvalId}
    `,
    "objects",
  );
}

export function readLatestIssueApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<IssueApprovalRow & { readonly operator: boolean }>(
    sql`
      select a.id, a.review_id as "reviewId", a.ordinal, a.actor_id as "actorId", a.digest,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt", a.body,
        exists (
          select from openerp.memberships m
          where m.book_id = a.book_id and m.actor_id = a.actor_id and m.role = 'operator'
        ) as operator
      from openerp.invoice_issue_approvals a
      where a.book_id = ${bookId} and a.review_id = ${reviewId}
      order by a.ordinal desc
      limit 1
    `,
    "objects",
  );
}

export function readIssueForDraft(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select from openerp.invoice_issues i where i.book_id = ${bookId} and i.draft_id = ${draftId}
      ) as present
    `,
    "objects",
  );
}

export function readIssueForReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<IssueRow>(
    sql`
      select i.id, i.review_id as "reviewId", i.approval_id as "approvalId", i.draft_id as "draftId",
        i.internal_number as "internalNumber", i.body
      from openerp.invoice_issues i
      where i.book_id = ${bookId} and i.review_id = ${reviewId}
    `,
    "objects",
  );
}

export function readIssueForApproval(transaction: Transaction, bookId: string, approvalId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select from openerp.invoice_issues i where i.book_id = ${bookId} and i.approval_id = ${approvalId}
      ) as present
    `,
    "objects",
  );
}

export function readCounterExhausted(transaction: Transaction, bookId: string, ceiling: bigint) {
  return transaction.execute<{ readonly exhausted: boolean }>(
    sql`
      select exists (
        select from openerp.invoice_issue_counters c
        where c.book_id = ${bookId} and c.last_number >= ${ceiling}::bigint
      ) as exhausted
    `,
    "objects",
  );
}

export function allocateInternalNumber(transaction: Transaction, bookId: string) {
  return transaction.execute<CounterRow>(
    sql`
      insert into openerp.invoice_issue_counters (book_id, last_number)
      values (${bookId}, 1)
      on conflict (book_id) do update
        set last_number = openerp.invoice_issue_counters.last_number + 1
      returning last_number::text as "nextNumber"
    `,
    "objects",
  );
}

export function insertIssue(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    reviewId: string;
    approvalId: string;
    draftId: string;
    draftRevision: string;
    internalNumber: string;
    postingReceiptId: string;
    registerInvoiceId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_issues
        (book_id, id, review_id, approval_id, draft_id, draft_revision, internal_number,
          posting_receipt_id, register_invoice_id, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.approvalId}, ${row.draftId},
        ${row.draftRevision}::bigint, ${row.internalNumber}::bigint, ${row.postingReceiptId},
        ${row.registerInvoiceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readPostedEvidenceHistory(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select from openerp.vouchers v
        join openerp.events e on e.book_id = v.book_id and e.id = v.event_id
        where v.book_id = ${bookId} and (
          e.evidence_id = ${evidenceId}
          or exists (
            select from jsonb_array_elements(v.action->'evidenceRefs') ref
            where ref->>'evidenceId' = ${evidenceId}
          )
        )
      ) as present
    `,
    "objects",
  );
}

export function readExecutedChangeSet(
  transaction: Transaction,
  bookId: string,
  changeSetId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select from openerp.execution_receipts e where e.book_id = ${bookId} and e.change_set_id = ${changeSetId}
      ) as present
    `,
    "objects",
  );
}

export function readControlAccountConflict(
  transaction: Transaction,
  bookId: string,
  controlAccountId: string,
  creditAccountId: string,
) {
  return transaction.execute<{ readonly conflict: boolean }>(
    sql`
      select (
        exists (
          select from openerp.bank_sources s
          where s.book_id = ${bookId} and s.account_id in (${controlAccountId}, ${creditAccountId})
        )
        or exists (
          select from openerp.commerce_control_accounts c
          where c.book_id = ${bookId} and (
            c.account_id = ${creditAccountId}
            or (c.account_id = ${controlAccountId} and c.direction <> 'customer')
          )
        )
      ) as conflict
    `,
    "objects",
  );
}

export function claimControlAccount(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  direction: string,
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_control_accounts (book_id, account_id, direction)
      values (${bookId}, ${accountId}, ${direction})
      on conflict do nothing
    `,
    "objects",
  );
}

export function readControlAccount(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  direction: string,
) {
  return transaction.execute<ControlAccountRow>(
    sql`
      select exists (
        select from openerp.commerce_control_accounts c
        where c.book_id = ${bookId} and c.account_id = ${accountId} and c.direction = ${direction}
      ) as present
    `,
    "objects",
  );
}

export function readRecognitionLine(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<RegisterLineRow>(
    sql`
      select l.id, l.account_id as "accountId", l.debit_minor::text as "debitMinor",
        l.credit_minor::text as "creditMinor", v.id as "voucherId", v.event_id as "eventId",
        v.posting_date::text as "postingDate",
        coalesce(p.locked, false) as "periodLocked", v.action->'evidenceRefs' as "evidenceRefs"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      left join openerp.periods p on p.book_id = v.book_id and p.id = v.period_id
      where l.book_id = ${bookId} and l.voucher_id = ${voucherId} and l.id = ${lineId}
    `,
    "objects",
  );
}

export function readVoucherCurrent(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<{ readonly current: boolean }>(
    sql`
      select exists (
        select from openerp.vouchers v
        where v.book_id = ${bookId} and v.id = ${voucherId}
          and v.corrects_voucher_id is null and v.posting_purpose <> 'reversal'
          and not exists (
            select from openerp.vouchers r where r.book_id = v.book_id and r.corrects_voucher_id = v.id
          )
      ) as current
    `,
    "objects",
  );
}

export function readRegisterIdentity(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
  documentNumber: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<DuplicateRow>(
    sql`
      select exists (
        select from openerp.commerce_invoices i
        where i.book_id = ${bookId} and (
          (i.direction = 'customer' and i.counterparty_id = ${counterpartyId}
            and i.document_number = ${documentNumber})
          or (i.recognition_voucher_id = ${voucherId} and i.recognition_line_id = ${lineId})
        )
      ) or exists (
        select from openerp.commerce_allocation_legs l
        where l.book_id = ${bookId} and l.payment_voucher_id = ${voucherId} and l.payment_line_id = ${lineId}
      ) as present
    `,
    "objects",
  );
}

export function insertRegisteredInvoice(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    direction: string;
    counterpartyId: string;
    counterpartyRevision: string;
    documentNumber: string;
    issuedOn: string;
    amountMinor: string;
    controlAccountId: string;
    recognitionVoucherId: string;
    recognitionLineId: string;
    evidenceId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_invoices
        (book_id, id, direction, counterparty_id, counterparty_revision, document_number, issued_on,
          amount_minor, control_account_id, recognition_voucher_id, recognition_line_id, evidence_id,
          current_revision, body)
      values (${row.bookId}, ${row.id}, ${row.direction}, ${row.counterpartyId},
        ${row.counterpartyRevision}::bigint, ${row.documentNumber}, ${row.issuedOn}::date,
        ${row.amountMinor}::openerp.minor_units, ${row.controlAccountId}, ${row.recognitionVoucherId},
        ${row.recognitionLineId}, ${row.evidenceId}, 1, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertInvoiceRevision(
  transaction: Transaction,
  row: {
    bookId: string;
    invoiceId: string;
    revision: string;
    evidenceId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_invoice_revisions
        (book_id, invoice_id, revision, evidence_id, body)
      values (${row.bookId}, ${row.invoiceId}, ${row.revision}::bigint, ${row.evidenceId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export type CounterpartyHeadRow = {
  readonly id: string;
  readonly externalKey: string;
  readonly role: string;
  readonly currentRevision: string;
  readonly revision: JsonObject;
};

export type CounterpartyPageRow = { readonly id: string; readonly body: JsonObject };

export type InvoiceHeadRow = {
  readonly id: string;
  readonly direction: string;
  readonly counterpartyId: string;
  readonly currentRevision: string;
  readonly issuedOn: string;
};

export type InvoiceRevisionPageRow = {
  readonly revision: string;
  readonly body: JsonObject;
};

export type IssueHistoryRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly draftRevision: string;
  readonly digest: string | null;
  readonly createdAt: string | null;
  readonly issueId: string | null;
  readonly internalDocumentNumber: string | null;
};

export type SalesDraftRow = { readonly id: string; readonly body: JsonObject };

export type UtcDateRow = { readonly today: string };

export function readCounterpartyByExternalKey(
  transaction: Transaction,
  bookId: string,
  externalKey: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select from openerp.commerce_counterparties c
        where c.book_id = ${bookId} and c.external_key = ${externalKey}
      ) as present
    `,
    "objects",
  );
}

export function readCounterpartyHead(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<CounterpartyHeadRow>(
    sql`
      select c.id, c.external_key as "externalKey", c.role,
        c.current_revision as "currentRevision", r.body as revision
      from openerp.commerce_counterparties c
      join openerp.commerce_counterparty_revisions r
        on r.book_id = c.book_id and r.counterparty_id = c.id and r.revision = c.current_revision
      where c.book_id = ${bookId} and c.id = ${id}
    `,
    "objects",
  );
}

export function readCounterpartyHeadForUpdate(
  transaction: Transaction,
  bookId: string,
  id: string,
) {
  return transaction.execute<CounterpartyHeadRow>(
    sql`
      select c.id, c.external_key as "externalKey", c.role,
        c.current_revision as "currentRevision", r.body as revision
      from openerp.commerce_counterparties c
      join openerp.commerce_counterparty_revisions r
        on r.book_id = c.book_id and r.counterparty_id = c.id and r.revision = c.current_revision
      where c.book_id = ${bookId} and c.id = ${id}
      for update of c
    `,
    "objects",
  );
}

export function readCounterpartyRevision(
  transaction: Transaction,
  bookId: string,
  id: string,
  revision: string,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select r.body from openerp.commerce_counterparty_revisions r
      where r.book_id = ${bookId} and r.counterparty_id = ${id} and r.revision = ${revision}::bigint
    `,
    "objects",
  );
}

export function insertCounterparty(
  transaction: Transaction,
  row: { bookId: string; id: string; externalKey: string; role: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_counterparties (book_id, id, external_key, role, current_revision)
      values (${row.bookId}, ${row.id}, ${row.externalKey}, ${row.role}, 1)
    `,
    "objects",
  );
}

export function insertCounterpartyRevision(
  transaction: Transaction,
  row: {
    bookId: string;
    counterpartyId: string;
    revision: string;
    evidenceId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_counterparty_revisions
        (book_id, counterparty_id, revision, evidence_id, body)
      values (${row.bookId}, ${row.counterpartyId}, ${row.revision}::bigint, ${row.evidenceId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function advanceCounterpartyRevision(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute(
    sql`
      update openerp.commerce_counterparties set current_revision = current_revision + 1
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readCounterpartyPage(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<CounterpartyPageRow>(
    sql`
      select page.id, page.body from (
        select c.id, r.body from openerp.commerce_counterparties c
        join openerp.commerce_counterparty_revisions r
          on r.book_id = c.book_id and r.counterparty_id = c.id and r.revision = c.current_revision
        where c.book_id = ${bookId} and c.id collate "C" > ${after} collate "C"
        order by c.id collate "C"
        limit ${limit}
      ) page
      order by page.id collate "C"
    `,
    "objects",
  );
}

export function readSupplierCounterparty(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select from openerp.commerce_counterparties c
        where c.book_id = ${bookId} and c.id = ${counterpartyId}
          and c.role in ('supplier', 'both')
      ) as present
    `,
    "objects",
  );
}

export type SupplierDuplicateRow = {
  readonly id: string;
  readonly sameNumber: boolean;
  readonly sameContent: boolean;
};

export function readSupplierDuplicatePage(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
  documentNumber: string,
  sha256: string,
  after: string,
  limit: number,
) {
  return transaction.execute<SupplierDuplicateRow>(
    sql`
      select page.id, page."sameNumber", page."sameContent" from (
        select i.id,
          i.document_number = ${documentNumber} collate "C" as "sameNumber",
          e.sha256 = ${sha256} as "sameContent"
        from openerp.commerce_invoices i
        join openerp.evidence e on e.book_id = i.book_id and e.id = i.evidence_id
        where i.book_id = ${bookId} and i.direction = 'supplier'
          and i.counterparty_id = ${counterpartyId}
          and i.id collate "C" > ${after} collate "C"
          and (i.document_number = ${documentNumber} collate "C" or e.sha256 = ${sha256})
        order by i.id collate "C"
        limit ${limit}
      ) page
      order by page.id collate "C"
    `,
    "objects",
  );
}

export function readInvoiceHead(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<InvoiceHeadRow>(
    sql`
      select i.id, i.direction, i.counterparty_id as "counterpartyId",
        i.current_revision as "currentRevision", i.issued_on::text as "issuedOn"
      from openerp.commerce_invoices i
      where i.book_id = ${bookId} and i.id = ${id}
    `,
    "objects",
  );
}

export function readInvoiceHeadForUpdate(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<InvoiceHeadRow>(
    sql`
      select i.id, i.direction, i.counterparty_id as "counterpartyId",
        i.current_revision as "currentRevision", i.issued_on::text as "issuedOn"
      from openerp.commerce_invoices i
      where i.book_id = ${bookId} and i.id = ${id}
      for update of i
    `,
    "objects",
  );
}

export function advanceInvoiceRevision(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute(
    sql`
      update openerp.commerce_invoices set current_revision = current_revision + 1
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readInvoiceRevisionPage(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
  afterRevision: number,
  limit: number,
) {
  return transaction.execute<InvoiceRevisionPageRow>(
    sql`
      select page.revision::text, page.body from (
        select r.revision, r.body from openerp.commerce_invoice_revisions r
        where r.book_id = ${bookId} and r.invoice_id = ${invoiceId}
          and r.revision > ${afterRevision}
        order by r.revision
        limit ${limit}
      ) page
      order by page.revision
    `,
    "objects",
  );
}

export function readBankSourceAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select from openerp.bank_sources s
        where s.book_id = ${bookId} and s.account_id = ${accountId}
      ) as present
    `,
    "objects",
  );
}

export function readIssueHistoryForDraft(
  transaction: Transaction,
  bookId: string,
  draftId: string,
) {
  return transaction.execute<IssueHistoryRow>(
    sql`
      select r.id, r.ordinal, r.draft_revision::text as "draftRevision",
        r.body->>'digest' as digest, r.body->>'createdAt' as "createdAt",
        i.id as "issueId", i.body->>'internalDocumentNumber' as "internalDocumentNumber"
      from openerp.invoice_issue_reviews r
      left join openerp.invoice_issues i on i.book_id = r.book_id and i.review_id = r.id
      where r.book_id = ${bookId} and r.draft_id = ${draftId}
      order by r.ordinal
    `,
    "objects",
  );
}

export function readSalesDraftRows(transaction: Transaction, bookId: string) {
  return transaction.execute<SalesDraftRow>(
    sql`
      select d.id, r.body from openerp.invoice_drafts d
      join openerp.invoice_draft_revisions r
        on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
      where d.book_id = ${bookId}
        and not exists (
          select from openerp.invoice_issues i where i.book_id = d.book_id and i.draft_id = d.id
        )
      order by d.id collate "C"
    `,
    "objects",
  );
}

export function readUtcDate(transaction: Transaction) {
  return transaction.execute<UtcDateRow>(
    sql`select (statement_timestamp() at time zone 'UTC')::date::text as today`,
    "objects",
  );
}
