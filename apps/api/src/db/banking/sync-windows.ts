import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type Json = Schema.Json;

// Per-consent stream state. The only mutable row in the window model: it is a
// pointer to the published cursor, the current fence and the lease, never a
// financial fact.
export type StreamRow = {
  readonly id: string;
  readonly consentId: string;
  readonly publishedCursor: string;
  readonly publicationVersion: string;
  readonly currentGenerationId: string | null;
  readonly fence: string;
  readonly leaseUntil: string | null;
};

export type GenerationRow = {
  readonly id: string;
  readonly streamId: string;
  readonly baseCursor: string;
  readonly basePublicationVersion: string;
  readonly attemptNumber: string;
  readonly fence: string;
};

export type PageRow = {
  readonly generationId: string;
  readonly ordinal: number;
  readonly requestCursor: string;
  readonly nextCursor: string;
  readonly hasMore: boolean;
  readonly rawDigest: string;
  readonly rawByteLength: number;
  readonly normalizedChangesDigest: string;
  readonly recordCount: number;
  readonly chainedDigest: string;
  readonly retainedAt: string;
};

export type CandidateInsert = {
  readonly kind: string;
  readonly sourceId: string;
  readonly rawLocator: string;
};

export type CandidateRow = {
  readonly pageOrdinal: number;
  readonly kind: string;
  readonly sourceId: string;
  readonly rawLocator: string;
};

export type PublicationRow = {
  readonly id: string;
  readonly generationId: string;
  readonly streamId: string;
  readonly fromVersion: string;
  readonly baseCursor: string;
  readonly finalCursor: string;
  readonly pageCount: number;
  readonly changeCount: number;
  readonly manifestDigest: string;
  readonly coversHistory: boolean;
  readonly commandKey: string;
  readonly publishedAt: string;
};

export type WindowStateRow = {
  readonly streamId: string;
  readonly publishedCursor: string;
  readonly publicationVersion: string;
  readonly fence: string;
  readonly currentGenerationId: string | null;
  readonly leaseUntil: string | null;
  readonly generationId: string | null;
  readonly baseCursor: string | null;
  readonly attemptNumber: string | null;
  readonly retainedPageCount: number;
  readonly pages: Json;
  readonly published: Json;
};

export function readStream(transaction: Transaction, bookId: string, consentId: string) {
  return transaction.execute<StreamRow>(
    sql`
      select id, consent_id as "consentId", published_cursor as "publishedCursor",
        publication_version::text as "publicationVersion",
        current_generation_id as "currentGenerationId", fence::text as fence,
        lease_until::text as "leaseUntil"
      from openerp.bank_sync_streams
      where book_id = ${bookId} and consent_id = ${consentId}
    `,
    "objects",
  );
}

// The claim and page paths both lock the stream, so the row is taken with
// `for update` in stream order after the book, never before it.
export function lockStream(transaction: Transaction, bookId: string, consentId: string) {
  return transaction.execute<StreamRow>(
    sql`
      select id, consent_id as "consentId", published_cursor as "publishedCursor",
        publication_version::text as "publicationVersion",
        current_generation_id as "currentGenerationId", fence::text as fence,
        lease_until::text as "leaseUntil"
      from openerp.bank_sync_streams
      where book_id = ${bookId} and consent_id = ${consentId}
      for update
    `,
    "objects",
  );
}

// The page and publication paths arrive holding a generation, not a consent.
// The stream is resolved from the generation and locked by its own id, so the
// lock order stays book then stream in every path.
export function lockStreamByGeneration(transaction: Transaction, bookId: string, streamId: string) {
  return transaction.execute<StreamRow>(
    sql`
      select id, consent_id as "consentId", published_cursor as "publishedCursor",
        publication_version::text as "publicationVersion",
        current_generation_id as "currentGenerationId", fence::text as fence,
        lease_until::text as "leaseUntil"
      from openerp.bank_sync_streams
      where book_id = ${bookId} and id = ${streamId}
      for update
    `,
    "objects",
  );
}

export function insertStream(
  transaction: Transaction,
  row: { readonly bookId: string; readonly id: string; readonly consentId: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_sync_streams (book_id, id, consent_id)
      values (${row.bookId}, ${row.id}, ${row.consentId})
      on conflict (book_id, consent_id) do nothing
    `,
    "objects",
  );
}

export function claimStream(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly streamId: string;
    readonly fence: string;
    readonly leaseUntil: string;
  },
) {
  return transaction.execute(
    sql`
      update openerp.bank_sync_streams
      set fence = ${row.fence}::bigint, lease_until = ${row.leaseUntil}::timestamptz
      where book_id = ${row.bookId} and id = ${row.streamId}
        and fence = (${row.fence}::bigint - 1)
    `,
    "objects",
  );
}

export function setCurrentGeneration(
  transaction: Transaction,
  row: { readonly bookId: string; readonly streamId: string; readonly generationId: string },
) {
  return transaction.execute(
    sql`
      update openerp.bank_sync_streams
      set current_generation_id = ${row.generationId}
      where book_id = ${row.bookId} and id = ${row.streamId}
    `,
    "objects",
  );
}

export function publishStream(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly streamId: string;
    readonly expectedVersion: string;
    readonly expectedFence: string;
    readonly publicationVersion: string;
    readonly publishedCursor: string;
    readonly generationId: string;
  },
) {
  // The published cursor moves only from the exact base this generation began
  // at, only from the expected publication version, and only under the fence
  // the caller proved. A concurrent claim or an intervening publication makes
  // this match nothing, so the cursor cannot move underneath a late worker.
  return transaction.execute(
    sql`
      update openerp.bank_sync_streams
      set published_cursor = ${row.publishedCursor},
        publication_version = ${row.publicationVersion}::bigint,
        current_generation_id = null
      where book_id = ${row.bookId} and id = ${row.streamId}
        and publication_version = ${row.expectedVersion}::bigint
        and fence = ${row.expectedFence}::bigint
        and published_cursor = (select base_cursor from openerp.bank_sync_generations
          where book_id = ${row.bookId} and id = ${row.generationId})
      returning 1::text as moved
    `,
    "objects",
  );
}

export function readGeneration(transaction: Transaction, bookId: string, generationId: string) {
  return transaction.execute<GenerationRow>(
    sql`
      select id, stream_id as "streamId", base_cursor as "baseCursor",
        base_publication_version::text as "basePublicationVersion",
        attempt_number::text as "attemptNumber", fence::text as fence
      from openerp.bank_sync_generations
      where book_id = ${bookId} and id = ${generationId}
    `,
    "objects",
  );
}

// The newest generation for a stream that has no publication marker. This is
// what a claim resumes: its base cursor and staged pages are kept, never
// discarded and never re-based on the failed page cursor.
export function readIncompleteGeneration(
  transaction: Transaction,
  bookId: string,
  streamId: string,
) {
  return transaction.execute<GenerationRow>(
    sql`
      select g.id, g.stream_id as "streamId", g.base_cursor as "baseCursor",
        g.base_publication_version::text as "basePublicationVersion",
        g.attempt_number::text as "attemptNumber", g.fence::text as fence
      from openerp.bank_sync_generations g
      where g.book_id = ${bookId} and g.stream_id = ${streamId}
        and not exists (
          select 1 from openerp.bank_sync_publications p
          where p.book_id = g.book_id and p.generation_id = g.id
        )
      order by g.created_at desc, g.id desc
      limit 1
    `,
    "objects",
  );
}

export function insertGeneration(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly streamId: string;
    readonly baseCursor: string;
    readonly basePublicationVersion: string;
    readonly attemptNumber: string;
    readonly fence: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_sync_generations
        (book_id, id, stream_id, base_cursor, base_publication_version, attempt_number, fence)
      values (${row.bookId}, ${row.id}, ${row.streamId}, ${row.baseCursor},
        ${row.basePublicationVersion}::bigint, ${row.attemptNumber}::bigint, ${row.fence}::bigint)
    `,
    "objects",
  );
}

// The exact provider response, retained as content. The page row indexes
// evidence that already exists; it holds no copy of the bytes, so two pages
// with the same body share one content row and neither can be rewritten.
export function insertContent(
  transaction: Transaction,
  row: { readonly bookId: string; readonly sha256: string; readonly bytes: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.intake_contents (book_id, sha256, bytes)
      values (${row.bookId}, ${row.sha256}, convert_to(${row.bytes}, 'UTF8'))
      on conflict do nothing
    `,
    "objects",
  );
}

export function readPages(transaction: Transaction, bookId: string, generationId: string) {
  return transaction.execute<PageRow>(
    sql`
      select generation_id as "generationId", ordinal, request_cursor as "requestCursor",
        next_cursor as "nextCursor", has_more as "hasMore", raw_digest as "rawDigest",
        raw_byte_length as "rawByteLength",
        normalized_changes_digest as "normalizedChangesDigest",
        record_count as "recordCount", chained_digest as "chainedDigest",
        retained_at::text as "retainedAt"
      from openerp.bank_sync_pages
      where book_id = ${bookId} and generation_id = ${generationId}
      order by ordinal
    `,
    "objects",
  );
}

// The staged candidate rows grouped by page ordinal. Publication recomputes
// each page's change digest from these rows rather than trusting the page row,
// which is what makes the manifest agreement a check instead of a tautology.
export function readCandidatesByPage(
  transaction: Transaction,
  bookId: string,
  generationId: string,
) {
  return transaction.execute<{
    readonly pageOrdinal: number;
    readonly kind: string;
    readonly sourceId: string;
    readonly rawLocator: string;
  }>(
    sql`
      select page_ordinal as "pageOrdinal", kind, source_id as "sourceId",
        raw_locator as "rawLocator"
      from openerp.bank_sync_candidates
      where book_id = ${bookId} and generation_id = ${generationId}
      order by page_ordinal, record_ordinal
    `,
    "objects",
  );
}

export function insertPage(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly generationId: string;
    readonly ordinal: number;
    readonly requestCursor: string;
    readonly nextCursor: string;
    readonly hasMore: boolean;
    readonly rawDigest: string;
    readonly rawByteLength: number;
    readonly normalizedChangesDigest: string;
    readonly recordCount: number;
    readonly chainedDigest: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_sync_pages
        (book_id, generation_id, ordinal, request_cursor, next_cursor, has_more, raw_digest,
          raw_byte_length, normalized_changes_digest, record_count, chained_digest)
      values (${row.bookId}, ${row.generationId}, ${row.ordinal}, ${row.requestCursor},
        ${row.nextCursor}, ${row.hasMore}, ${row.rawDigest}, ${row.rawByteLength},
        ${row.normalizedChangesDigest}, ${row.recordCount}, ${row.chainedDigest})
    `,
    "objects",
  );
}

export function insertCandidates(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly generationId: string;
    readonly pageOrdinal: number;
    readonly candidates: ReadonlyArray<CandidateInsert>;
  },
) {
  // The recordset column names are the table's own, so the encoded keys match
  // them exactly. A key that did not match would insert a NULL ordinal
  // instead of the page it belongs to.
  const encoded = row.candidates.map((candidate, index) => ({
    page_ordinal: row.pageOrdinal,
    record_ordinal: index,
    kind: candidate.kind,
    source_id: candidate.sourceId,
    raw_locator: candidate.rawLocator,
  }));

  return transaction.execute(
    sql`
      insert into openerp.bank_sync_candidates
        (book_id, generation_id, page_ordinal, record_ordinal, kind, source_id, raw_locator)
      select ${row.bookId}, ${row.generationId}, c.page_ordinal, c.record_ordinal,
        c.kind, c.source_id, c.raw_locator
      from jsonb_to_recordset(${JSON.stringify(encoded)}::jsonb) as c(
        page_ordinal integer, record_ordinal integer, kind text, source_id text, raw_locator text)
    `,
    "objects",
  );
}

export function readCandidateCount(transaction: Transaction, bookId: string, generationId: string) {
  return transaction.execute<{ readonly count: string }>(
    sql`
      select count(*)::text as count
      from openerp.bank_sync_candidates
      where book_id = ${bookId} and generation_id = ${generationId}
    `,
    "objects",
  );
}

export function readPublicationByGeneration(
  transaction: Transaction,
  bookId: string,
  generationId: string,
) {
  return transaction.execute<PublicationRow>(
    sql`
      select id, generation_id as "generationId", stream_id as "streamId",
        from_version::text as "fromVersion", base_cursor as "baseCursor",
        final_cursor as "finalCursor", page_count as "pageCount",
        change_count as "changeCount", manifest_digest as "manifestDigest",
        covers_history as "coversHistory", command_key as "commandKey",
        published_at::text as "publishedAt"
      from openerp.bank_sync_publications
      where book_id = ${bookId} and generation_id = ${generationId}
    `,
    "objects",
  );
}

export function insertPublication(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly generationId: string;
    readonly streamId: string;
    readonly fromVersion: string;
    readonly baseCursor: string;
    readonly finalCursor: string;
    readonly pageCount: number;
    readonly changeCount: number;
    readonly manifestDigest: string;
    readonly coversHistory: boolean;
    readonly commandKey: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_sync_publications
        (book_id, id, generation_id, stream_id, from_version, base_cursor, final_cursor,
          page_count, change_count, manifest_digest, covers_history, command_key)
      values (${row.bookId}, ${row.id}, ${row.generationId}, ${row.streamId},
        ${row.fromVersion}::bigint, ${row.baseCursor}, ${row.finalCursor}, ${row.pageCount},
        ${row.changeCount}, ${row.manifestDigest}, ${row.coversHistory}, ${row.commandKey})
    `,
    "objects",
  );
}

// The read model. Candidate rows are deliberately absent: they are staged
// until the publication marker exists, so no reader of this query can present
// an unpublished generation as a bank observation.
export function readWindowState(transaction: Transaction, bookId: string, consentId: string) {
  return transaction.execute<WindowStateRow>(
    sql`
      with stream as (
        select s.* from openerp.bank_sync_streams s
        where s.book_id = ${bookId} and s.consent_id = ${consentId}
      ), generation as (
        select g.id, g.stream_id, g.base_cursor, g.attempt_number, g.fence
        from openerp.bank_sync_generations g
        join stream s on s.book_id = g.book_id and s.id = g.stream_id
        where g.id = s.current_generation_id
      )
      select s.id as "streamId", s.published_cursor as "publishedCursor",
        s.publication_version::text as "publicationVersion", s.fence::text as fence,
        s.current_generation_id as "currentGenerationId", s.lease_until::text as "leaseUntil",
        g.id as "generationId", g.base_cursor as "baseCursor",
        g.attempt_number::text as "attemptNumber",
        (select count(*)::integer from openerp.bank_sync_pages p
          where p.book_id = s.book_id and p.generation_id = g.id) as "retainedPageCount",
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'ordinal', p.ordinal, 'requestCursor', p.request_cursor, 'nextCursor', p.next_cursor,
            'hasMore', p.has_more, 'recordCount', p.record_count, 'rawDigest', p.raw_digest,
            'rawByteLength', p.raw_byte_length, 'chainedDigest', p.chained_digest
          ) order by p.ordinal)
          from openerp.bank_sync_pages p
          where p.book_id = s.book_id and p.generation_id = g.id
        ), '[]'::jsonb) as pages,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'publicationId', p.id, 'generationId', p.generation_id,
            'fromVersion', p.from_version::text, 'finalCursor', p.final_cursor,
            'pageCount', p.page_count, 'changeCount', p.change_count,
            'coversHistory', p.covers_history, 'publishedAt', p.published_at
          ) order by p.from_version desc)
          from (select * from openerp.bank_sync_publications
            where book_id = s.book_id and stream_id = s.id
            order by from_version desc limit 20) p
        ), '[]'::jsonb) as published
      from stream s
      left join generation g on g.id = s.current_generation_id
    `,
    "objects",
  );
}
