import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import { deadlineFulfillments } from "./schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const fulfillmentReadTables = [
  "deadline_fulfillments",
  "deadline_obligations",
  "deadline_activity_history",
  "accountant_review_artifacts",
  "accountant_review_packs",
  "report_snapshots",
  "sie_transaction_artifacts",
  "sie_transaction_captures",
  "ar_legal_delivery_attempts",
  "ar_legal_delivery_requests",
  "ar_legal_delivery_reconciliations",
  "ar_legal_pdf_artifacts",
  "ar_legal_pdf_captures",
  "ar_legal_issues",
  "execution_receipts",
  "vouchers",
] as const;

export const fulfillmentInsertTables = [
  "deadline_fulfillments",
  "deadline_activity_history",
] as const;

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type BodyRow = { readonly body: JsonObject };

// A prepared artifact owner that reaches a report snapshot can attest the exact
// reporting period the deliverable covers, and its descriptor digest is already
// enforced against the stored bytes by the baseline.
export type ArtifactOwnerRow = {
  readonly artifactId: string;
  readonly digest: string | null;
  readonly periodId: string;
  readonly periodStartsOn: string;
  readonly periodEndsOn: string;
  readonly revision: string;
};

// A dispatch attempt reaches the accounting period of the voucher behind the
// issued legal document, so the period is a retained fact and not an assertion.
export type DeliveryAttemptRow = {
  readonly attemptId: string;
  readonly digest: string | null;
  readonly periodId: string;
  readonly revision: string;
  readonly body: JsonObject;
  readonly reconciliationOutcome: string | null;
  readonly reconciliationBody: JsonObject | null;
};

export function readFulfillmentAccess(transaction: Transaction) {
  return transaction.execute<TableAccess>(
    sql`
      select
        requested.table_name as "tableName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
        case when requested.table_name = any(array[${sql.join(
          fulfillmentInsertTables.map((name) => sql`${name}`),
          sql`, `,
        )}]::text[]) then false
          when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
      from unnest(array[${sql.join(
        fulfillmentReadTables.map((name) => sql`${name}`),
        sql`, `,
      )}]::text[]) as requested(table_name)
    `,
    "objects",
  );
}

// The reference owners are append-only or sealed, so verification reads them
// without a row lock; the surrounding book transaction already serializes writes.
export function readReviewArtifact(transaction: Transaction, bookId: string, packId: string) {
  return transaction.execute<ArtifactOwnerRow>(
    sql`
      select a.pack_id as "artifactId",
        a.descriptor ->> 'sha256'::text as digest,
        r.id as "periodId", r.starts_on::text as "periodStartsOn",
        r.ends_on::text as "periodEndsOn", r.sequence::text as revision
      from openerp.accountant_review_artifacts a
      join openerp.accountant_review_packs p on p.book_id = a.book_id and p.id = a.pack_id
      join openerp.report_snapshots r on r.book_id = p.book_id and r.id = p.report_id
      where a.book_id = ${bookId} and a.pack_id = ${packId}
    `,
    "objects",
  );
}

export function readSieArtifact(transaction: Transaction, bookId: string, captureId: string) {
  return transaction.execute<ArtifactOwnerRow>(
    sql`
      select t.capture_id as "artifactId",
        t.descriptor ->> 'sha256'::text as digest,
        r.id as "periodId", r.starts_on::text as "periodStartsOn",
        r.ends_on::text as "periodEndsOn", r.sequence::text as revision
      from openerp.sie_transaction_artifacts t
      join openerp.sie_transaction_captures c on c.book_id = t.book_id and c.id = t.capture_id
      join openerp.accountant_review_packs p on p.book_id = c.book_id and p.id = c.pack_id
      join openerp.report_snapshots r on r.book_id = p.book_id and r.id = p.report_id
      where t.book_id = ${bookId} and t.capture_id = ${captureId}
    `,
    "objects",
  );
}

export function readDeliveryAttempt(transaction: Transaction, bookId: string, attemptId: string) {
  return transaction.execute<DeliveryAttemptRow>(
    sql`
      select d.id as "attemptId",
        pdf.descriptor ->> 'sha256'::text as digest,
        v.period_id as "periodId", d.ordinal::text as revision,
        d.body as body, n.body ->> 'outcome'::text as "reconciliationOutcome",
        n.body as "reconciliationBody"
      from openerp.ar_legal_delivery_attempts d
      join openerp.ar_legal_delivery_requests q on q.book_id = d.book_id and q.id = d.request_id
      join openerp.ar_legal_pdf_artifacts pdf
        on pdf.book_id = q.book_id and pdf.capture_id = q.capture_id
      join openerp.ar_legal_pdf_captures c on c.book_id = pdf.book_id and c.id = pdf.capture_id
      join openerp.ar_legal_issues i on i.book_id = c.book_id and i.id = c.issue_id
      join openerp.execution_receipts e on e.book_id = i.book_id and e.id = i.posting_receipt_id
      join openerp.vouchers v on v.book_id = e.book_id and v.id = e.voucher_id
      left join openerp.ar_legal_delivery_reconciliations n
        on n.book_id = d.book_id and n.attempt_id = d.id
      where d.book_id = ${bookId} and d.id = ${attemptId}
    `,
    "objects",
  );
}

export function readFulfillmentByReference(
  transaction: Transaction,
  bookId: string,
  obligationId: string,
  referenceDigest: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.deadline_fulfillments
      where book_id = ${bookId} and obligation_id = ${obligationId}
        and reference_digest = ${referenceDigest}
      for share
    `,
    "objects",
  );
}

export function listFulfillments(transaction: Transaction, bookId: string, obligationId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.deadline_fulfillments
      where book_id = ${bookId} and obligation_id = ${obligationId}
      order by recorded_at, id
      for share
    `,
    "objects",
  );
}

export function insertFulfillment(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly obligationId: string;
    readonly obligationRevision: string;
    readonly referenceDigest: string;
    readonly outcomeKind: string;
    readonly referenceKind: string;
    readonly reference: JsonObject;
    readonly environment: string;
    readonly verification: string;
    readonly reason: string;
    readonly witness: JsonObject;
    readonly recordedBy: string;
    readonly recordedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(deadlineFulfillments).values([
    {
      bookId: row.bookId,
      id: row.id,
      obligationId: row.obligationId,
      obligationRevision: BigInt(row.obligationRevision),
      referenceDigest: row.referenceDigest,
      outcomeKind: row.outcomeKind,
      referenceKind: row.referenceKind,
      reference: row.reference,
      environment: row.environment,
      verification: row.verification,
      reason: row.reason,
      witness: row.witness,
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
      digest: row.digest,
      body: row.body,
    },
  ]);
}
