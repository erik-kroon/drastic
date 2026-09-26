import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";

import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type ExtractionRequestRow = {
  readonly id: string;
  readonly occurrenceId: string;
  readonly generation: number;
  readonly originalHash: string;
  readonly originalBytes: string;
  readonly engineRelease: string;
  readonly attemptIdentity: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly body: JsonObject;
};

export type ExtractionStateRow = {
  readonly requestId: string;
  readonly state: string;
  readonly cancelVersion: number;
  readonly attemptsMade: number;
};

export type ExtractionClaimRow = {
  readonly bookId: string;
  readonly requestId: string;
  readonly occurrenceId: string;
  readonly engineRelease: string;
  readonly entityId: string;
};

export type FieldDecisionRow = {
  readonly id: string;
  readonly draftRevision: string;
  readonly lineOrdinal: number;
  readonly fieldKey: string;
  readonly decisionKind: string;
  readonly body: JsonObject;
};

export function readExtractionRequestForUpdate(
  transaction: Transaction,
  bookId: string,
  requestId: string,
) {
  return transaction.execute<ExtractionRequestRow>(
    sql`
      select id, occurrence_id as "occurrenceId", generation,
        original_hash as "originalHash", original_bytes::text as "originalBytes",
        engine_release as "engineRelease", attempt_identity as "attemptIdentity",
        requested_by as "requestedBy", requested_at as "requestedAt", body
      from openerp.supplier_extraction_requests
      where book_id = ${bookId} and id = ${requestId}
      for update
    `,
    "objects",
  );
}

export function readExtractionRequestGeneration(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return transaction.execute<{ readonly total: number }>(
    sql`
      select count(*)::integer as total
      from (select 1 from openerp.supplier_extraction_requests
        where book_id = ${bookId} and occurrence_id = ${occurrenceId} limit 1001) bounded
    `,
    "objects",
  );
}

// A newer admitted request of the same occurrence retires every older ready one,
// so only the newest generation is still dispatchable.
export function supersedeReadyRequests(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  generation: number,
) {
  return transaction.execute<{ readonly requestId: string }>(
    sql`
      update openerp.supplier_extraction_request_states s
      set state = 'superseded', updated_at = clock_timestamp()
      from openerp.supplier_extraction_requests r
      where s.book_id = ${bookId} and s.state = 'ready'
        and r.book_id = s.book_id and r.id = s.request_id
        and r.occurrence_id = ${occurrenceId} and r.generation < ${generation}
      returning s.request_id as "requestId"
    `,
    "objects",
  );
}

// The newest requests with their lifecycle state in one consistent read.
export function readExtractionRequests(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return transaction.execute<
    ExtractionRequestRow & ExtractionStateRow & { readonly state_request_id: string }
  >(
    sql`
      select r.id, r.occurrence_id as "occurrenceId", r.generation,
        r.original_hash as "originalHash", r.original_bytes::text as "originalBytes",
        r.engine_release as "engineRelease", r.attempt_identity as "attemptIdentity",
        r.requested_by as "requestedBy", r.requested_at as "requestedAt", r.body,
        s.request_id, s.state, s.cancel_version as "cancelVersion",
        s.attempts_made as "attemptsMade"
      from openerp.supplier_extraction_requests r
      join openerp.supplier_extraction_request_states s
        on s.book_id = r.book_id and s.request_id = r.id
      where r.book_id = ${bookId} and r.occurrence_id = ${occurrenceId}
      order by r.generation desc
      limit 20
    `,
    "objects",
  );
}

export function readLatestExtractionRequest(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return transaction.execute<ExtractionRequestRow>(
    sql`
      select r.id, r.occurrence_id as "occurrenceId", r.generation,
        r.original_hash as "originalHash", r.original_bytes::text as "originalBytes",
        r.engine_release as "engineRelease", r.attempt_identity as "attemptIdentity",
        r.requested_by as "requestedBy", r.requested_at as "requestedAt", r.body
      from openerp.supplier_extraction_requests r
      where r.book_id = ${bookId} and r.occurrence_id = ${occurrenceId}
      order by r.generation desc
      limit 1
    `,
    "objects",
  );
}

export function readExtractionState(transaction: Transaction, bookId: string, requestId: string) {
  return transaction.execute<ExtractionStateRow>(
    sql`
      select request_id as "requestId", state,
        cancel_version as "cancelVersion", attempts_made as "attemptsMade"
      from openerp.supplier_extraction_request_states
      where book_id = ${bookId} and request_id = ${requestId}
      for update
    `,
    "objects",
  );
}

export function insertExtractionRequest(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly occurrenceId: string;
    readonly generation: number;
    readonly originalHash: string;
    readonly originalBytes: string;
    readonly engineRelease: string;
    readonly attemptIdentity: string;
    readonly requestedBy: string;
    readonly requestedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_extraction_requests (
        book_id, id, occurrence_id, generation, original_hash, original_bytes,
        engine_release, attempt_identity, requested_by, requested_at, digest, body)
      values (${row.bookId}, ${row.id}, ${row.occurrenceId}, ${row.generation},
        ${row.originalHash}, ${row.originalBytes}::bigint, ${row.engineRelease},
        ${row.attemptIdentity}, ${row.requestedBy}, ${row.requestedAt},
        ${row.digest}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertExtractionState(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly requestId: string;
    readonly state: string;
    readonly cancelVersion: number;
    readonly attemptsMade: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_extraction_request_states (
        book_id, request_id, state, cancel_version, attempts_made, updated_at)
      values (${row.bookId}, ${row.requestId}, ${row.state},
        ${row.cancelVersion}, ${row.attemptsMade}, clock_timestamp())
    `,
    "objects",
  );
}

export function cancelExtractionRequest(
  transaction: Transaction,
  bookId: string,
  requestId: string,
) {
  return transaction.execute<{ readonly cancelVersion: number; readonly state: string }>(
    sql`
      update openerp.supplier_extraction_request_states
      set state = 'cancelled', cancel_version = cancel_version + 1,
        updated_at = clock_timestamp()
      where book_id = ${bookId} and request_id = ${requestId} and state = 'ready'
      returning cancel_version as "cancelVersion", state
    `,
    "objects",
  );
}

export function readAttemptForRequest(transaction: Transaction, bookId: string, requestId: string) {
  return transaction.execute<{
    readonly id: string;
    readonly ordinal: number;
    readonly body: JsonObject;
  }>(
    sql`
      select id, ordinal, body
      from openerp.supplier_extraction_attempts
      where book_id = ${bookId} and body ->> 'requestId' = ${requestId}
      order by ordinal
    `,
    "objects",
  );
}

// Bounded durable dispatch. SKIP LOCKED is dispatch work only: it never skips a
// contended financial record, and a row it skips stays ready for the next poll.
export function claimReadyExtractionRequests(transaction: Transaction) {
  return transaction.execute<ExtractionClaimRow>(
    sql`
      with selected as (
        select s.book_id, s.request_id from openerp.supplier_extraction_request_states s
        where s.state = 'ready'
        order by s.book_id, s.request_id
        limit 20
        for update of s skip locked
      ), claimed as (
        update openerp.supplier_extraction_request_states s
        set attempts_made = s.attempts_made + 1, updated_at = clock_timestamp()
        from selected x where s.book_id = x.book_id and s.request_id = x.request_id
        returning s.book_id, s.request_id
      )
      select c.book_id as "bookId", c.request_id as "requestId",
        r.occurrence_id as "occurrenceId",
        r.engine_release as "engineRelease", b.entity_id as "entityId"
      from claimed c
      join openerp.supplier_extraction_requests r
        on r.book_id = c.book_id and r.id = c.request_id
      join openerp.books b on b.id = c.book_id
      order by c.book_id, c.request_id
    `,
    "objects",
  );
}

export function completeExtractionRequest(
  transaction: Transaction,
  bookId: string,
  requestId: string,
  state: string,
) {
  return transaction.execute<{ readonly state: string }>(
    sql`
      update openerp.supplier_extraction_request_states
      set state = ${state}, updated_at = clock_timestamp()
      where book_id = ${bookId} and request_id = ${requestId} and state = 'ready'
      returning state
    `,
    "objects",
  );
}

export function readFieldDecisionsForDraft(
  transaction: Transaction,
  bookId: string,
  draftId: string,
) {
  return transaction.execute<FieldDecisionRow>(
    sql`
      select id, draft_revision::text as "draftRevision", line_ordinal as "lineOrdinal",
        field_key as "fieldKey", decision_kind as "decisionKind", body
      from openerp.supplier_field_decisions
      where book_id = ${bookId} and draft_id = ${draftId}
      order by draft_revision, line_ordinal, field_key
    `,
    "objects",
  );
}

export function insertFieldDecision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly occurrenceId: string;
    readonly requestId: string;
    readonly attemptId: string;
    readonly draftId: string;
    readonly draftRevision: string;
    readonly lineOrdinal: number;
    readonly fieldKey: string;
    readonly decisionKind: string;
    readonly reviewer: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.supplier_field_decisions (
        book_id, id, occurrence_id, request_id, attempt_id, draft_id, draft_revision,
        line_ordinal, field_key, decision_kind, reviewer, recorded_at, digest, body)
      values (${row.bookId}, ${row.id}, ${row.occurrenceId}, ${row.requestId}, ${row.attemptId},
        ${row.draftId}, ${row.draftRevision}::bigint, ${row.lineOrdinal}, ${row.fieldKey},
        ${row.decisionKind}, ${row.reviewer}, clock_timestamp(), ${row.digest},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}
