import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";
import type * as Service from "@open-erp/contracts/service-purchases";

type JsonObject = Schema.JsonObject;

export const serviceTables = [
  "service_purchase_recognitions",
  "service_purchase_tax_facts",
  "service_purchase_reviews",
  "service_purchase_approvals",
  "service_purchases",
] as const;

export type RecognitionRow = {
  readonly id: string;
  readonly economicKey: string;
  readonly draftId: string;
  readonly draftRevision: string;
  readonly counterpartyId: string;
  readonly documentNumber: string;
  readonly voucherId: string;
  readonly payableId: string;
  readonly changeSetId: string;
  readonly approvalId: string;
  readonly recognitionDate: string;
  readonly taxPointOn: string;
  readonly grossMinor: string;
  readonly deductibleTaxMinor: string;
  readonly body: JsonObject;
  readonly digest: string;
};

export type TaxFactRow = {
  readonly id: string;
  readonly recognitionId: string;
  readonly sourceLineId: string;
  readonly componentRole: string;
  readonly taxComponentId: string;
  readonly voucherId: string;
  readonly signedBaseMinor: string;
  readonly signedOutputTaxMinor: string;
  readonly signedDeductibleTaxMinor: string;
  readonly taxPointOn: string;
  readonly adjustsTaxFactId: string | null;
  readonly body: JsonObject;
};

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

export type ServicePurchaseRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly draftId: string;
  readonly body: JsonObject;
};

export type HistoryRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly draftRevision: string;
  readonly digest: string;
  readonly createdAt: string;
  readonly acceptanceId: string | null;
  readonly supplierDocumentNumber: string | null;
};

export function readActiveAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id
      from openerp.accounts
      where book_id = ${bookId} and id = ${accountId} and active
      for share
    `,
    "objects",
  );
}

const recognitionColumns = sql`
  id, economic_key as "economicKey", draft_id as "draftId", draft_revision::text as "draftRevision",
  counterparty_id as "counterpartyId", document_number as "documentNumber", voucher_id as "voucherId",
  payable_id as "payableId", change_set_id as "changeSetId", approval_id as "approvalId",
  recognition_date::text as "recognitionDate", tax_point_on::text as "taxPointOn",
  gross_minor::text as "grossMinor", deductible_tax_minor::text as "deductibleTaxMinor",
  body, digest
`;

const taxFactColumns = sql`
  id, recognition_id as "recognitionId", source_line_id as "sourceLineId",
  component_role as "componentRole", tax_component_id as "taxComponentId", voucher_id as "voucherId",
  signed_base_minor::text as "signedBaseMinor",
  signed_output_tax_minor::text as "signedOutputTaxMinor",
  signed_deductible_tax_minor::text as "signedDeductibleTaxMinor",
  tax_point_on::text as "taxPointOn", adjusts_tax_fact_id as "adjustsTaxFactId", body
`;

export function readRecognition(tx: Transaction, bookId: string, recognitionId: string) {
  return tx.execute<RecognitionRow>(
    sql`select ${recognitionColumns} from openerp.service_purchase_recognitions
      where book_id = ${bookId} and id = ${recognitionId}`,
    "objects",
  );
}

// One reviewed supplier identity recognizes one service purchase. A revised
// document is not automatically another purchase, so the key refuses a second
// recognition.
export function readRecognitionByEconomicKey(tx: Transaction, bookId: string, economicKey: string) {
  return tx.execute<RecognitionRow>(
    sql`select ${recognitionColumns} from openerp.service_purchase_recognitions
      where book_id = ${bookId} and economic_key = ${economicKey}`,
    "objects",
  );
}

export function readRecognitionByDraft(tx: Transaction, bookId: string, draftId: string) {
  return tx.execute<RecognitionRow>(
    sql`select ${recognitionColumns} from openerp.service_purchase_recognitions
      where book_id = ${bookId} and draft_id = ${draftId}`,
    "objects",
  );
}

export function readCounterpartyDocumentRecognition(
  tx: Transaction,
  bookId: string,
  counterpartyId: string,
  documentNumber: string,
) {
  return tx.execute<{ readonly present: boolean }>(
    sql`select exists (
        select 1 from openerp.service_purchase_recognitions
        where book_id = ${bookId} and counterparty_id = ${counterpartyId}
          and document_number = ${documentNumber}
      ) as present`,
    "objects",
  );
}

export function insertRecognition(
  tx: Transaction,
  bookId: string,
  row: {
    readonly id: string;
    readonly economicKey: string;
    readonly draftId: string;
    readonly draftRevision: string;
    readonly counterpartyId: string;
    readonly documentNumber: string;
    readonly voucherId: string;
    readonly payableId: string;
    readonly changeSetId: string;
    readonly approvalId: string;
    readonly recognitionDate: string;
    readonly taxPointOn: string;
    readonly grossMinor: string;
    readonly deductibleTaxMinor: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.service_purchase_recognitions
      (book_id,id,economic_key,event_owner,draft_id,draft_revision,
        counterparty_id,document_number,voucher_id,payable_id,change_set_id,approval_id,
        recognition_date,tax_point_on,gross_minor,deductible_tax_minor,body,digest,recorded_at)
      values(${bookId},${row.id},${row.economicKey},'service_purchase',${row.draftId},
        ${row.draftRevision}::bigint,${row.counterpartyId},${row.documentNumber},${row.voucherId},
        ${row.payableId},${row.changeSetId},${row.approvalId},${row.recognitionDate}::date,
        ${row.taxPointOn}::date,${row.grossMinor}::numeric,${row.deductibleTaxMinor}::numeric,
        ${JSON.stringify(row.body)}::jsonb,${row.digest},${row.recordedAt}::timestamptz)`,
    "objects",
  );
}

export function readTaxFacts(tx: Transaction, bookId: string, recognitionId: string) {
  return tx.execute<TaxFactRow>(
    sql`select ${taxFactColumns} from openerp.service_purchase_tax_facts
      where book_id = ${bookId} and recognition_id = ${recognitionId}
      order by tax_point_on, source_line_id, component_role`,
    "objects",
  );
}

// A service recognition already published reverse-charge components for this
// voucher. An independent tax-fact admission over the same voucher would be a
// second recognition of one economic event, so its owner reads this and
// refuses.
export function readRecognizedVoucher(tx: Transaction, bookId: string, voucherId: string) {
  return tx.execute<{ readonly present: boolean }>(
    sql`select exists (
        select 1 from openerp.service_purchase_recognitions
        where book_id = ${bookId} and voucher_id = ${voucherId}
      ) as present`,
    "objects",
  );
}

export function insertTaxFact(
  tx: Transaction,
  bookId: string,
  row: {
    readonly id: string;
    readonly recognitionId: string;
    readonly sourceLineId: string;
    readonly taxComponentId: string;
    readonly voucherId: string;
    readonly signedBaseMinor: string;
    readonly signedOutputTaxMinor: string;
    readonly signedDeductibleTaxMinor: string;
    readonly sourceTaxMinor: string;
    readonly nonDeductibleTaxMinor: string;
    readonly taxPointOn: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.service_purchase_tax_facts
      (book_id,id,recognition_id,source_line_id,component_role,tax_component_id,voucher_id,
        signed_base_minor,signed_output_tax_minor,signed_deductible_tax_minor,source_tax_minor,
        non_deductible_tax_minor,tax_point_on,adjusts_tax_fact_id,body,digest,recorded_at)
      values(${bookId},${row.id},${row.recognitionId},${row.sourceLineId},'reverse_charge',
        ${row.taxComponentId},${row.voucherId},${row.signedBaseMinor}::numeric,
        ${row.signedOutputTaxMinor}::numeric,${row.signedDeductibleTaxMinor}::numeric,
        ${row.sourceTaxMinor}::numeric,${row.nonDeductibleTaxMinor}::numeric,${row.taxPointOn}::date,
        null,${JSON.stringify(row.body)}::jsonb,${row.digest},
        ${row.recordedAt}::timestamptz)`,
    "objects",
  );
}

export function insertServicePurchase(
  tx: Transaction,
  book: string,
  result: typeof Service.ServicePurchaseReceipt.Type,
) {
  return tx.execute(
    sql`insert into openerp.service_purchases
    (book_id,id,review_id,approval_id,draft_id,draft_revision,posting_receipt_id,register_invoice_id,body)
    values(${book},${result.id},${result.reviewId},${result.approvalId},${result.draftId},${result.draftRevision}::bigint,
      ${result.postingReceipt.id},${result.registerInvoiceId},${JSON.stringify(result)}::jsonb)`,
    "objects",
  );
}

export function readAcceptanceForDraft(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.service_purchases
        where book_id = ${bookId} and draft_id = ${draftId}
      ) as present
    `,
    "objects",
  );
}

export function readReviewCount(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::integer as total
      from openerp.service_purchase_reviews
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
      from openerp.service_purchase_reviews
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
      insert into openerp.service_purchase_reviews
        (book_id, id, draft_id, draft_revision, ordinal, change_set_id, event_id, evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.draftId}, ${row.draftRevision}::bigint, ${row.ordinal},
        ${row.changeSetId}, ${row.eventId}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readApprovalCount(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::integer as total
      from openerp.service_purchase_approvals
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
      from openerp.service_purchase_approvals
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
      from openerp.service_purchase_approvals
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
      insert into openerp.service_purchase_approvals
        (book_id, id, review_id, ordinal, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.ordinal}, ${row.actorId},
        ${row.digest}, ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readAcceptanceByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<ServicePurchaseRow>(
    sql`
      select id, review_id as "reviewId", approval_id as "approvalId", draft_id as "draftId", body
      from openerp.service_purchases
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
        select 1 from openerp.service_purchases
        where book_id = ${bookId} and approval_id = ${approvalId}
      ) as present
    `,
    "objects",
  );
}

export function readHistory(transaction: Transaction, bookId: string, draftId: string) {
  return transaction.execute<HistoryRow>(
    sql`
      select r.id, r.ordinal, r.draft_revision::text as "draftRevision",
        r.body ->> 'digest' as digest, r.body ->> 'createdAt' as "createdAt",
        a.id as "acceptanceId", a.body ->> 'supplierDocumentNumber' as "supplierDocumentNumber"
      from openerp.service_purchase_reviews r
      left join openerp.service_purchases a
        on a.book_id = r.book_id and a.review_id = r.id
      where r.book_id = ${bookId} and r.draft_id = ${draftId}
      order by r.ordinal
      limit 50
    `,
    "objects",
  );
}
