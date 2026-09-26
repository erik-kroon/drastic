import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const invoiceDeliveryTables = [
  "invoice_delivery_requests",
  "invoice_delivery_approvals",
  "invoice_delivery_attempts",
  "invoice_delivery_resolutions",
  "invoice_pdf_captures",
  "invoice_pdf_artifacts",
] as const;

export type PdfCaptureIdentityRow = {
  readonly id: string;
  readonly issueId: string;
  readonly body: JsonObject;
};

export type PdfArtifactIdentityRow = {
  readonly descriptor: JsonObject;
  readonly sha256: string;
  readonly byteLength: number;
};

export type DeliveryRequestRow = {
  readonly id: string;
  readonly captureId: string;
  readonly actorId: string;
  readonly channel: string;
  readonly body: JsonObject;
};

export type DeliveryApprovalRow = {
  readonly id: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type DeliveryAttemptRow = {
  readonly id: string;
  readonly requestId: string;
  readonly ordinal: number;
  readonly body: JsonObject;
};

export type DeliveryAttemptViewRow = {
  readonly id: string;
  readonly requestId: string;
  readonly ordinal: number;
  readonly body: JsonObject;
  readonly resolution: JsonObject | null;
};

export type DeliveryRequestCountRow = { readonly count: number };

export type DeliveryRequestIdRow = { readonly id: string };

export type DeliveryDuplicateRow = { readonly present: boolean };

export type DeliveryAttemptCountRow = {
  readonly maxOrdinal: number;
  readonly unresolved: boolean;
};

export type DeliveryResolutionRow = { readonly present: boolean };

export function readPdfCaptureIdentity(
  transaction: Transaction,
  bookId: string,
  id: string,
  lock: "share" | "update",
) {
  const lockClause = lock === "update" ? sql`for update` : sql`for share`;
  return transaction.execute<PdfCaptureIdentityRow>(
    sql`
      select c.id, c.issue_id as "issueId", c.body
      from openerp.invoice_pdf_captures c
      where c.book_id = ${bookId} and c.id = ${id}
      ${lockClause}
    `,
    "objects",
  );
}

export function readPdfArtifactIdentity(
  transaction: Transaction,
  bookId: string,
  captureId: string,
) {
  return transaction.execute<PdfArtifactIdentityRow>(
    sql`
      select a.descriptor, encode(sha256(a.content), 'hex') as sha256,
        octet_length(a.content) as "byteLength"
      from openerp.invoice_pdf_artifacts a
      where a.book_id = ${bookId} and a.capture_id = ${captureId}
    `,
    "objects",
  );
}

export function readDeliveryDuplicate(
  transaction: Transaction,
  bookId: string,
  captureId: string,
  channel: string,
  destination: string,
) {
  return transaction.execute<DeliveryDuplicateRow>(
    sql`
      select exists (
        select from openerp.invoice_delivery_requests r
        where r.book_id = ${bookId} and r.capture_id = ${captureId} and r.channel = ${channel}
          and r.body->'input'->>'destination' = ${destination}
      ) as present
    `,
    "objects",
  );
}

export function readDeliveryRequestCount(transaction: Transaction, bookId: string) {
  return transaction.execute<DeliveryRequestCountRow>(
    sql`
      select count(*)::integer as count from openerp.invoice_delivery_requests r
      where r.book_id = ${bookId}
    `,
    "objects",
  );
}

export function insertDeliveryRequest(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    captureId: string;
    actorId: string;
    channel: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_delivery_requests
        (book_id, id, capture_id, actor_id, channel, body)
      values (${row.bookId}, ${row.id}, ${row.captureId}, ${row.actorId}, ${row.channel},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readDeliveryRequest(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<DeliveryRequestRow>(
    sql`
      select r.id, r.capture_id as "captureId", r.actor_id as "actorId", r.channel, r.body
      from openerp.invoice_delivery_requests r
      where r.book_id = ${bookId} and r.id = ${id}
    `,
    "objects",
  );
}

export function readDeliveryApprovalForRequest(
  transaction: Transaction,
  bookId: string,
  requestId: string,
) {
  return transaction.execute<DeliveryApprovalRow>(
    sql`
      select a.id, a.actor_id as "actorId", a.body
      from openerp.invoice_delivery_approvals a
      where a.book_id = ${bookId} and a.request_id = ${requestId}
    `,
    "objects",
  );
}

export function insertDeliveryApproval(
  transaction: Transaction,
  row: { bookId: string; id: string; requestId: string; actorId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_delivery_approvals (book_id, id, request_id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.requestId}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readDeliveryAttempts(transaction: Transaction, bookId: string, requestId: string) {
  return transaction.execute<DeliveryAttemptViewRow>(
    sql`
      select a.id, a.request_id as "requestId", a.ordinal, a.body,
        (select r.body from openerp.invoice_delivery_resolutions r
          where r.book_id = a.book_id and r.attempt_id = a.id) as resolution
      from openerp.invoice_delivery_attempts a
      where a.book_id = ${bookId} and a.request_id = ${requestId}
      order by a.ordinal
    `,
    "objects",
  );
}

export function readAttemptProgress(transaction: Transaction, bookId: string, requestId: string) {
  return transaction.execute<DeliveryAttemptCountRow>(
    sql`
      select coalesce(max(a.ordinal), 0)::integer as "maxOrdinal",
        exists (
          select from openerp.invoice_delivery_attempts a
          where a.book_id = ${bookId} and a.request_id = ${requestId}
            and not exists (
              select from openerp.invoice_delivery_resolutions r
              where r.book_id = a.book_id and r.attempt_id = a.id
            )
        ) as unresolved
      from openerp.invoice_delivery_attempts a
      where a.book_id = ${bookId} and a.request_id = ${requestId}
    `,
    "objects",
  );
}

export function insertDeliveryAttempt(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    requestId: string;
    approvalId: string;
    ordinal: number;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_delivery_attempts
        (book_id, id, request_id, approval_id, ordinal, body)
      values (${row.bookId}, ${row.id}, ${row.requestId}, ${row.approvalId}, ${row.ordinal},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readDeliveryAttempt(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<DeliveryAttemptRow>(
    sql`
      select a.id, a.request_id as "requestId", a.ordinal, a.body
      from openerp.invoice_delivery_attempts a
      where a.book_id = ${bookId} and a.id = ${id}
    `,
    "objects",
  );
}

export function readDeliveryResolution(
  transaction: Transaction,
  bookId: string,
  attemptId: string,
) {
  return transaction.execute<DeliveryResolutionRow>(
    sql`
      select exists (
        select from openerp.invoice_delivery_resolutions r
        where r.book_id = ${bookId} and r.attempt_id = ${attemptId}
      ) as present
    `,
    "objects",
  );
}

export function insertDeliveryResolution(
  transaction: Transaction,
  row: { bookId: string; id: string; attemptId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_delivery_resolutions (book_id, id, attempt_id, body)
      values (${row.bookId}, ${row.id}, ${row.attemptId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readDeliveryRequestIdsForCapture(
  transaction: Transaction,
  bookId: string,
  captureId: string,
) {
  return transaction.execute<DeliveryRequestIdRow>(
    sql`
      select r.id from openerp.invoice_delivery_requests r
      where r.book_id = ${bookId} and r.capture_id = ${captureId}
      order by r.id
    `,
    "objects",
  );
}
