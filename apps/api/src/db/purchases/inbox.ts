import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type InboxRow = {
  readonly occurrenceId: string;
  readonly channel: string;
  readonly messageIdentity: string | null;
  readonly draftId: string | null;
  readonly reviewReason: string | null;
  readonly reviewAttemptId: string | null;
};

export type OccurrenceRow = {
  readonly id: string;
  readonly sha256: string;
  readonly body: JsonObject;
  readonly latestPreviewId: string | null;
  readonly admission: JsonObject | null;
};

export type AttemptRow = {
  readonly ordinal: number;
  readonly body: JsonObject;
};

export type AttemptCountRow = { readonly total: number };

export type IdentityConflictRow = { readonly present: boolean };

export type RegistrationRow = { readonly registered: boolean };

export type SourceReferenceRow = {
  readonly id: string;
  readonly occurrenceId: string | null;
  readonly sha256: string | null;
};

export function readInbox(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<InboxRow>(
    sql`
      select occurrence_id as "occurrenceId", channel, message_identity as "messageIdentity",
        draft_id as "draftId", review_reason as "reviewReason", review_attempt_id as "reviewAttemptId"
      from openerp.supplier_inbox
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}
    `,
    "objects",
  );
}

export function readInboxForUpdate(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<InboxRow>(
    sql`
      select occurrence_id as "occurrenceId", channel, message_identity as "messageIdentity",
        draft_id as "draftId", review_reason as "reviewReason", review_attempt_id as "reviewAttemptId"
      from openerp.supplier_inbox
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}
      for update
    `,
    "objects",
  );
}

export function readOccurrence(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<OccurrenceRow>(
    sql`
      select o.id, o.sha256, o.body,
        latest.id as "latestPreviewId", a.body as admission
      from openerp.intake_occurrences o
      left join lateral (
        select p.id from openerp.intake_previews p
        where p.book_id = o.book_id and p.occurrence_id = o.id
        order by p.ordinal desc
        limit 1
      ) latest on true
      left join openerp.intake_admissions a on a.book_id = o.book_id and a.occurrence_id = o.id
      where o.book_id = ${bookId} and o.id = ${occurrenceId}
    `,
    "objects",
  );
}

export function readOccurrencePage(
  transaction: Transaction,
  bookId: string,
  cursor: string | null,
) {
  return transaction.execute<{ readonly occurrenceId: string; readonly body: JsonObject }>(
    sql`
      select i.occurrence_id as "occurrenceId", i.body
      from openerp.supplier_inbox i
      join openerp.intake_occurrences o on o.book_id = i.book_id and o.id = i.occurrence_id
      where i.book_id = ${bookId} and (${cursor}::text is null or i.occurrence_id > ${cursor}::text)
      order by i.occurrence_id
      limit 21
    `,
    "objects",
  );
}

export function readAttempts(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<AttemptRow>(
    sql`
      select ordinal, body
      from openerp.supplier_extraction_attempts
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}
      order by ordinal
    `,
    "objects",
  );
}

export function readAttemptCount(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<AttemptCountRow>(
    sql`
      select count(*)::integer as total
      from openerp.supplier_extraction_attempts
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}
    `,
    "objects",
  );
}

export function readAttemptPresence(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  attemptId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.supplier_extraction_attempts
        where book_id = ${bookId} and occurrence_id = ${occurrenceId} and id = ${attemptId}
      ) as present
    `,
    "objects",
  );
}

export function readMessageIdentityConflict(
  transaction: Transaction,
  bookId: string,
  channel: string,
  messageIdentity: string,
  occurrenceId: string,
) {
  return transaction.execute<IdentityConflictRow>(
    sql`
      select exists (
        select 1 from openerp.supplier_inbox
        where book_id = ${bookId} and channel = ${channel}
          and message_identity = ${messageIdentity} and occurrence_id <> ${occurrenceId}
      ) as present
    `,
    "objects",
  );
}

export function readRegistration(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  channel: string,
  messageIdentity: string | null,
) {
  return transaction.execute<RegistrationRow>(
    sql`
      select exists (
        select 1 from openerp.supplier_inbox
        where book_id = ${bookId} and occurrence_id = ${occurrenceId}
          and channel = ${channel}::text
          and message_identity is not distinct from ${messageIdentity}::text
      ) as registered
    `,
    "objects",
  );
}

export function insertInbox(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly occurrenceId: string;
    readonly channel: string;
    readonly messageIdentity: string | null;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_inbox (book_id, occurrence_id, channel, message_identity)
      values (${row.bookId}, ${row.occurrenceId}, ${row.channel}, ${row.messageIdentity})
      on conflict (book_id, occurrence_id) do nothing
    `,
    "objects",
  );
}

export function bindDraft(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  draftId: string,
  reviewReason: string,
  reviewAttemptId: string | null,
) {
  return transaction.execute(
    sql`
      update openerp.supplier_inbox
      set draft_id = ${draftId}, review_reason = ${reviewReason}, review_attempt_id = ${reviewAttemptId}
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}
    `,
    "objects",
  );
}

export function insertAttempt(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly occurrenceId: string;
    readonly ordinal: number;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_extraction_attempts (book_id, id, occurrence_id, ordinal, body)
      values (${row.bookId}, ${row.id}, ${row.occurrenceId}, ${row.ordinal},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readReviewedEvidence(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<{ readonly id: string; readonly content: string }>(
    sql`
      select id, content
      from openerp.evidence
      where book_id = ${bookId} and id = ${evidenceId}
    `,
    "objects",
  );
}
