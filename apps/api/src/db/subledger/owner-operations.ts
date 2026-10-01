import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export const operationTables = [
  "owner_operation_reviews",
  "owner_operation_approvals",
  "owner_operation_receipts",
  "owner_operation_allocations",
  "owner_purchase_recognitions",
  "owner_purchase_tax_facts",
] as const;

export type ReviewRow = {
  readonly id: string;
  readonly mode: string;
  readonly ownerId: string;
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
  readonly reviewDigest: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export type ReceiptRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly invoiceId: string | null;
  readonly body: JsonObject;
};

export type RecognitionRow = {
  readonly id: string;
  readonly economicKey: string;
  readonly body: JsonObject;
};

export type TaxFactRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export function readAccess(transaction: Transaction) {
  return transaction.execute<{
    readonly tableName: string;
    readonly canSelect: boolean;
    readonly canInsert: boolean;
  }>(
    sql`
      select
        requested.table_name as "tableName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
      from unnest(array[${sql.join(
        operationTables.map((name) => sql`${name}`),
        sql`, `,
      )}]::text[]) as requested(table_name)
    `,
    "objects",
  );
}

export function readReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select r.id, r.mode, r.owner_id as "ownerId", r.change_set_id as "changeSetId",
        r.event_id as "eventId", r.evidence_id as "evidenceId", r.body
      from openerp.owner_operation_reviews r
      where r.book_id = ${bookId} and r.id = ${reviewId}
    `,
    "objects",
  );
}

export function readReviewByEvent(transaction: Transaction, bookId: string, eventId: string) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.owner_operation_reviews
        where book_id = ${bookId} and event_id = ${eventId}
      ) as present
    `,
    "objects",
  );
}

export function countReviews(transaction: Transaction, bookId: string, eventId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::int as total from openerp.owner_operation_reviews
      where book_id = ${bookId} and event_id = ${eventId}
    `,
    "objects",
  );
}

export function insertReview(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly mode: string;
    readonly ownerId: string;
    readonly ordinal: number;
    readonly changeSetId: string;
    readonly eventId: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly createdAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_operation_reviews
        (book_id, id, mode, owner_id, ordinal, change_set_id, event_id, evidence_id, body, digest, created_at)
      values (${row.bookId}, ${row.id}, ${row.mode}, ${row.ownerId}, ${row.ordinal}, ${row.changeSetId},
        ${row.eventId}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb, ${row.digest},
        ${row.createdAt}::timestamptz)
    `,
    "objects",
  );
}

export function readApproval(transaction: Transaction, bookId: string, approvalId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select a.id, a.review_id as "reviewId", a.actor_id as "actorId", a.digest,
        a.review_digest as "reviewDigest",
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        a.body
      from openerp.owner_operation_approvals a
      where a.book_id = ${bookId} and a.id = ${approvalId}
    `,
    "objects",
  );
}

export function lockApproval(transaction: Transaction, bookId: string, approvalId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select a.id, a.review_id as "reviewId", a.actor_id as "actorId", a.digest,
        a.review_digest as "reviewDigest",
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        a.body
      from openerp.owner_operation_approvals a
      where a.book_id = ${bookId} and a.id = ${approvalId}
      for update
    `,
    "objects",
  );
}

export function readApprovalByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select a.id, a.review_id as "reviewId", a.actor_id as "actorId", a.digest,
        a.review_digest as "reviewDigest",
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        a.body
      from openerp.owner_operation_approvals a
      where a.book_id = ${bookId} and a.review_id = ${reviewId}
      order by a.expires_at desc, a.id collate "C" desc
      limit 1
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
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
    readonly createdAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_operation_approvals
        (book_id, id, review_id, actor_id, digest, expires_at, body, created_at)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.actorId}, ${row.digest},
        ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb, ${row.createdAt}::timestamptz)
    `,
    "objects",
  );
}

export function readReceiptForReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<ReceiptRow>(
    sql`
      select r.id, r.review_id as "reviewId", r.approval_id as "approvalId", r.invoice_id as "invoiceId", r.body
      from openerp.owner_operation_receipts r
      where r.book_id = ${bookId} and r.review_id = ${reviewId}
    `,
    "objects",
  );
}

export function insertReceipt(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly reviewId: string;
    readonly approvalId: string;
    readonly mode: string;
    readonly ownerId: string;
    readonly ownerRecordId: string;
    readonly ownerEffectId: string;
    readonly voucherId: string;
    readonly controlLineId: string;
    readonly recognitionId: string | null;
    readonly invoiceId: string | null;
    readonly amountMinor: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly committedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_operation_receipts
        (book_id, id, review_id, approval_id, mode, owner_id, owner_record_id, owner_effect_id, voucher_id,
          control_line_id, recognition_id, invoice_id, amount_minor, body, digest, committed_at)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.approvalId}, ${row.mode}, ${row.ownerId},
        ${row.ownerRecordId}, ${row.ownerEffectId}, ${row.voucherId}, ${row.controlLineId}, ${row.recognitionId},
        ${row.invoiceId}, ${row.amountMinor}::openerp.minor_units, ${JSON.stringify(row.body)}::jsonb,
        ${row.digest}, ${row.committedAt}::timestamptz)
    `,
    "objects",
  );
}

export function insertAllocations(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly receiptId: string;
    readonly ordinal: number;
    readonly claimId: string;
    readonly amountMinor: string;
  }>,
) {
  if (rows.length === 0) return Effect.void;

  return transaction.execute(
    sql`
      insert into openerp.owner_operation_allocations
        (book_id, receipt_id, ordinal, claim_id, amount_minor)
      values ${sql.join(
        rows.map(
          (row) =>
            sql`(${row.bookId}, ${row.receiptId}, ${row.ordinal}, ${row.claimId}, ${row.amountMinor}::openerp.minor_units)`,
        ),
        sql`, `,
      )}
    `,
    "objects",
  );
}

export function readRecognition(transaction: Transaction, bookId: string, recognitionId: string) {
  return transaction.execute<RecognitionRow>(
    sql`
      select p.id, p.economic_key as "economicKey", p.body
      from openerp.owner_purchase_recognitions p
      where p.book_id = ${bookId} and p.id = ${recognitionId}
    `,
    "objects",
  );
}

// A claim's remaining capacity is owned by the owner register, which reads both
// retained allocation authorities. This module only needs to recognise one.
export function readRecognitionByEconomicKey(
  transaction: Transaction,
  bookId: string,
  economicKey: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.owner_purchase_recognitions
        where book_id = ${bookId} and economic_key = ${economicKey}
      ) as present
    `,
    "objects",
  );
}

export function readPaidPurchaseByDocument(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
  documentNumber: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.owner_purchase_recognitions
        where book_id = ${bookId} and counterparty_id = ${counterpartyId}
          and document_number = ${documentNumber}
      ) as present
    `,
    "objects",
  );
}

export function insertRecognition(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly economicKey: string;
    readonly ownerId: string;
    readonly ownerRecordId: string;
    readonly ownerEffectId: string;
    readonly counterpartyId: string;
    readonly documentNumber: string;
    readonly voucherId: string;
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
  return transaction.execute(
    sql`
      insert into openerp.owner_purchase_recognitions
        (book_id, id, economic_key, owner_id, owner_record_id, owner_effect_id, counterparty_id,
          document_number, voucher_id, change_set_id, approval_id, recognition_date, tax_point_on,
          gross_minor, deductible_tax_minor, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.economicKey}, ${row.ownerId}, ${row.ownerRecordId},
        ${row.ownerEffectId}, ${row.counterpartyId}, ${row.documentNumber}, ${row.voucherId},
        ${row.changeSetId}, ${row.approvalId}, ${row.recognitionDate}::date, ${row.taxPointOn}::date,
        ${row.grossMinor}::openerp.minor_units, ${row.deductibleTaxMinor}::openerp.minor_units,
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readTaxFacts(transaction: Transaction, bookId: string, recognitionId: string) {
  return transaction.execute<TaxFactRow>(
    sql`
      select t.id, t.body
      from openerp.owner_purchase_tax_facts t
      where t.book_id = ${bookId} and t.recognition_id = ${recognitionId}
      order by t.id collate "C"
    `,
    "objects",
  );
}

export function insertTaxFact(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly recognitionId: string;
    readonly sourceLineId: string;
    readonly componentRole: string;
    readonly taxComponentId: string;
    readonly voucherId: string;
    readonly signedBaseMinor: string;
    readonly signedOutputTaxMinor: string;
    readonly signedDeductibleTaxMinor: string;
    readonly sourceTaxMinor: string;
    readonly nonDeductibleTaxMinor: string;
    readonly taxPointOn: string;
    readonly adjustsTaxFactId: string | null;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_purchase_tax_facts
        (book_id, id, recognition_id, source_line_id, component_role, tax_component_id, voucher_id,
          signed_base_minor, signed_output_tax_minor, signed_deductible_tax_minor, source_tax_minor,
          non_deductible_tax_minor, tax_point_on, adjusts_tax_fact_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.recognitionId}, ${row.sourceLineId}, ${row.componentRole},
        ${row.taxComponentId}, ${row.voucherId}, ${row.signedBaseMinor}::numeric,
        ${row.signedOutputTaxMinor}::numeric, ${row.signedDeductibleTaxMinor}::numeric,
        ${row.sourceTaxMinor}::openerp.minor_units, ${row.nonDeductibleTaxMinor}::openerp.minor_units,
        ${row.taxPointOn}::date, ${row.adjustsTaxFactId}, ${JSON.stringify(row.body)}::jsonb, ${row.digest},
        ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readFundingSourceUsage(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
  evidenceId: string,
) {
  return transaction.execute<{ readonly used: boolean }>(
    sql`
    select exists(select 1 from openerp.bank_matches where book_id=${bookId}
      and statement_id=${statementId} and row_ordinal=${rowOrdinal})
    or exists(select 1 from openerp.bank_active_allocation_legs where book_id=${bookId}
       and statement_id=${statementId} and row_ordinal=${rowOrdinal})
    or exists (
      select 1 from openerp.vouchers v
      join openerp.events e on e.book_id=v.book_id and e.id=v.event_id
      where v.book_id=${bookId} and (
        e.evidence_id=${evidenceId} or exists (
          select 1 from jsonb_array_elements(coalesce(v.action->'evidenceRefs','[]'::jsonb)) ref
          where ref->>'evidenceId'=${evidenceId}
        )
      ) and not exists (
        select 1 from openerp.owner_operation_receipts o
        join openerp.bank_matches m on m.book_id=o.book_id and m.voucher_id=o.voucher_id
        join openerp.bank_statements s on s.book_id=m.book_id and s.id=m.statement_id
        where o.book_id=v.book_id and o.voucher_id=v.id and s.evidence_id=${evidenceId}
          and o.mode in ('owner_loan','owner_contribution','repay_owner_loan')
      )
    ) as used`,
    "objects",
  );
}
