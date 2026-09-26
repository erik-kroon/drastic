import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

export type ConsentRow = {
  readonly id: string;
  readonly providerId: string;
  readonly externalAccountId: string;
  readonly sourceAccountId: string;
  readonly accountId: string;
  readonly body: JsonObject;
  readonly cursor: string | null;
  readonly revokedAt: string | null;
};

export type BatchRow = {
  readonly id: string;
  readonly body: JsonObject;
  readonly receivedAt: string;
};

export type ConnectorRecordRow = {
  readonly occurrenceId: string;
  readonly sha256: string;
  readonly revision: string;
};

export type IntakeContentInsert = {
  readonly bookId: string;
  readonly sha256: string;
  readonly bytes: string;
};

export type OccurrenceConflictRow = { readonly present: boolean };

export type OccurrenceRow = {
  readonly id: string;
  readonly sourceSystem: string;
  readonly sourceAccountId: string;
  readonly occurrenceKey: string;
  readonly sourceRevision: string;
  readonly sha256: string;
  readonly body: JsonObject;
};

export type MappingConflictRow = { readonly present: boolean };

export function readConsent(transaction: Transaction, bookId: string, consentId: string) {
  return transaction.execute<ConsentRow>(
    sql`
      select id, provider_id as "providerId", external_account_id as "externalAccountId",
        source_account_id as "sourceAccountId", account_id as "accountId", body, cursor,
        revoked_at::text as "revokedAt"
      from openerp.bank_connector_consents
      where book_id = ${bookId} and id = ${consentId}
    `,
    "objects",
  );
}

export function readConsentForUpdate(transaction: Transaction, bookId: string, consentId: string) {
  return transaction.execute<ConsentRow>(
    sql`
      select id, provider_id as "providerId", external_account_id as "externalAccountId",
        source_account_id as "sourceAccountId", account_id as "accountId", body, cursor,
        revoked_at::text as "revokedAt"
      from openerp.bank_connector_consents
      where book_id = ${bookId} and id = ${consentId}
      for update
    `,
    "objects",
  );
}

export function readConsentIdentities(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly sourceAccountId: string; readonly accountId: string }>(
    sql`
      select source_account_id as "sourceAccountId", account_id as "accountId"
      from openerp.bank_connector_consents
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function readProviderAccountDuplicate(
  transaction: Transaction,
  bookId: string,
  providerId: string,
  externalAccountId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_connector_consents
        where book_id = ${bookId} and provider_id = ${providerId}
          and external_account_id = ${externalAccountId}
      ) as present
    `,
    "objects",
  );
}

export function readSourceMappingConflicts(
  transaction: Transaction,
  bookId: string,
  sourceAccountId: string,
  accountId: string,
) {
  return transaction.execute<MappingConflictRow>(
    sql`
      select exists (
        select 1 from openerp.bank_sources
        where book_id = ${bookId} and (
          (source_bank_account_id = ${sourceAccountId} and account_id <> ${accountId})
          or (account_id = ${accountId} and source_bank_account_id <> ${sourceAccountId})
        )
      ) as present
    `,
    "objects",
  );
}

export function insertConsent(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly providerId: string;
    readonly externalAccountId: string;
    readonly sourceAccountId: string;
    readonly accountId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_connector_consents
        (book_id, id, provider_id, external_account_id, source_account_id, account_id, body)
      values (${row.bookId}, ${row.id}, ${row.providerId}, ${row.externalAccountId},
        ${row.sourceAccountId}, ${row.accountId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function revokeConsent(transaction: Transaction, bookId: string, consentId: string) {
  return transaction.execute(
    sql`
      update openerp.bank_connector_consents
      set revoked_at = clock_timestamp()
      where book_id = ${bookId} and id = ${consentId}
    `,
    "objects",
  );
}

export function advanceConsentCursor(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  cursor: string,
) {
  return transaction.execute(
    sql`
      update openerp.bank_connector_consents
      set cursor = ${cursor}
      where book_id = ${bookId} and id = ${consentId}
    `,
    "objects",
  );
}

export function readBatch(transaction: Transaction, bookId: string, batchId: string) {
  return transaction.execute<BatchRow>(
    sql`
      select id, body, body->>'receivedAt' as "receivedAt"
      from openerp.bank_connector_batches
      where book_id = ${bookId} and id = ${batchId}
    `,
    "objects",
  );
}

export function readConsentInventory(transaction: Transaction, bookId: string, after: string) {
  return transaction.execute<ConsentRow>(
    sql`
      select id, provider_id as "providerId", external_account_id as "externalAccountId",
        source_account_id as "sourceAccountId", account_id as "accountId", body, cursor,
        revoked_at::text as "revokedAt"
      from openerp.bank_connector_consents
      where book_id = ${bookId} and id > ${after}
      order by id
      limit 51
    `,
    "objects",
  );
}

export function readBatchAnchor(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  id: string,
) {
  return transaction.execute<{ readonly id: string; readonly receivedAt: string }>(
    sql`
      select id, body->>'receivedAt' as "receivedAt"
      from openerp.bank_connector_batches
      where book_id = ${bookId} and consent_id = ${consentId} and id = ${id}
    `,
    "objects",
  );
}

export function readBatchPage(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  cursor: string,
  cursorTime: string,
) {
  return transaction.execute<{ readonly id: string; readonly body: JsonObject }>(
    sql`
      select id, body
      from openerp.bank_connector_batches
      where book_id = ${bookId} and consent_id = ${consentId}
        and (${cursor} = '' or (body->>'receivedAt', id) < (${cursorTime}::text, ${cursor}))
      order by body->>'receivedAt' desc, id desc
      limit 51
    `,
    "objects",
  );
}

export function readFeedInventory(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  cursor: string,
  readAt: string,
  scope: string,
) {
  return transaction.execute<{ readonly items: Json; readonly nextCursor: string | null }>(
    sql`
      with selected as (
        select c.* from openerp.bank_connector_consents c
        where c.book_id = ${bookId}
          and (${consentId} = '' or c.id = ${consentId})
          and (${cursor} = '' or c.id > ${cursor})
        order by c.id
        limit 21
      ), visible as (
        select * from selected order by id limit 20
      ), feed_rows as (
        select c.*, stats.retained_page_count, stats.retained_page_start_cursor,
          stats.last_page_id, stats.last_page_at, recent.pages
        from visible c
        cross join lateral (
          select count(*)::integer as retained_page_count,
            (array_agg(b.body->>'previousCursor' order by b.body->>'receivedAt', b.id))[1]
              as retained_page_start_cursor,
            (array_agg(b.id order by b.body->>'receivedAt' desc, b.id desc))[1] as last_page_id,
            (array_agg(b.body->>'receivedAt' order by b.body->>'receivedAt' desc, b.id desc))[1]
              as last_page_at
          from openerp.bank_connector_batches b
          where b.book_id = c.book_id and b.consent_id = c.id
        ) stats
        cross join lateral (
          select coalesce(jsonb_agg(page.body order by page.received_at desc, page.id desc), '[]'::jsonb)
            as pages
          from (
            select b.id, b.body->>'receivedAt' as received_at, jsonb_build_object(
              'id', b.id, 'requestKey', b.body#>>'{receipt,key}',
              'providerOutcome', b.body->>'providerOutcome',
              'previousCursor', b.body->>'previousCursor', 'nextCursor', b.body->>'nextCursor',
              'sourceRevision', b.body->>'sourceRevision',
              'recordCount', b.body->'recordCount', 'overlapCount', b.body->'overlapCount',
              'source', case when o.id is null then null else jsonb_build_object(
                'occurrenceId', o.id, 'occurrenceKey', o.occurrence_key, 'sha256', o.sha256,
                'byteLength', (o.body->>'byteLength')::integer, 'mediaType', o.body->>'mediaType',
                'originalAvailability', 'not_checked') end,
              'recognition', b.body->>'recognition',
              'providerVerification', b.body->>'providerVerification',
              'receivedAt', b.body->>'receivedAt', 'receivedBy', b.body->>'receivedBy') as body
            from (
              select id, body from openerp.bank_connector_batches
              where book_id = c.book_id and consent_id = c.id
              order by body->>'receivedAt' desc, id desc
              limit 20
            ) b
            left join openerp.intake_occurrences o on o.book_id = b.book_id
              and o.id = b.body->>'sourceOccurrenceId'
          ) page
        ) recent
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', ${scope}::jsonb,
        'consent', f.body || jsonb_build_object('cursor', coalesce(f.cursor, ''),
          'revoked', f.revoked_at is not null),
        'account', jsonb_build_object('externalAccountId', f.external_account_id,
          'sourceAccountId', f.source_account_id, 'accountId', f.account_id,
          'active', exists (select 1 from openerp.accounts a
            where a.book_id = f.book_id and a.id = f.account_id and a.active)),
        'readAt', ${readAt},
        'cursorSnapshot', jsonb_build_object('cursor', coalesce(f.cursor, ''),
          'retainedPageCount', f.retained_page_count,
          'retainedPageStartCursor', f.retained_page_start_cursor,
          'lastPageId', f.last_page_id, 'lastPageAt', f.last_page_at),
        'pages', f.pages, 'pageEvidenceTruncated', f.retained_page_count > 20,
        'providerAcceptance', 'not_established', 'accountCoverage', 'not_established',
        'automaticRecovery', false,
        'recoveryBlockers', case when f.provider_id = 'plaid' then jsonb_build_array(
          jsonb_build_object('code', 'PAGINATION_START_NOT_RETAINED', 'state', 'structural_limit',
            'message', 'The first cursor for the current provider pagination window is not retained, so retained pages cannot safely replay that window.',
            'operatorAction', 'inspect_retained_pages_and_reconcile_a_fresh_provider_snapshot'),
          jsonb_build_object('code', 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
            'state', 'not_observed_in_retained_evidence',
            'message', 'A provider mutation during pagination requires a fresh provider snapshot and operator review; this feed does not automatically recover.',
            'operatorAction', 'inspect_retained_pages_and_reconcile_a_fresh_provider_snapshot')
        ) else '[]'::jsonb end
      ) order by f.id), '[]'::jsonb) as items,
        case when ${consentId} = '' and (select count(*) from selected) > 20
          then (select max(id) from visible) else null end as "nextCursor"
      from feed_rows f
    `,
    "objects",
  );
}

export function readConnectorRecord(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  externalId: string,
  revision: string,
) {
  return transaction.execute<ConnectorRecordRow>(
    sql`
      select occurrence_id as "occurrenceId", sha256, revision
      from openerp.bank_connector_records
      where book_id = ${bookId} and consent_id = ${consentId}
        and external_id = ${externalId} and revision = ${revision}
    `,
    "objects",
  );
}

export function readOtherRevisions(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  externalId: string,
  revision: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_connector_records
        where book_id = ${bookId} and consent_id = ${consentId}
          and external_id = ${externalId} and revision <> ${revision}
      ) as present
    `,
    "objects",
  );
}

export function insertIntakeContent(transaction: Transaction, row: IntakeContentInsert) {
  return transaction.execute(
    sql`
      insert into openerp.intake_contents (book_id, sha256, bytes)
      values (${row.bookId}, ${row.sha256}, convert_to(${row.bytes}, 'UTF8'))
      on conflict do nothing
    `,
    "objects",
  );
}

export function readSourceIdentityConflict(
  transaction: Transaction,
  bookId: string,
  sourceSystem: string,
  sourceAccountId: string,
  occurrenceKey: string,
  sourceRevision: string,
) {
  return transaction.execute<OccurrenceConflictRow>(
    sql`
      select exists (
        select 1 from openerp.intake_occurrences
        where book_id = ${bookId} and source_system = ${sourceSystem}
          and source_account_id = ${sourceAccountId} and occurrence_key = ${occurrenceKey}
          and source_revision = ${sourceRevision}
      ) as present
    `,
    "objects",
  );
}

export function readRetainedPage(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<OccurrenceRow>(
    sql`
      select id, source_system as "sourceSystem", source_account_id as "sourceAccountId",
        occurrence_key as "occurrenceKey", source_revision as "sourceRevision", sha256, body
      from openerp.intake_occurrences
      where book_id = ${bookId} and id = ${occurrenceId}
    `,
    "objects",
  );
}

export function insertIntakeOccurrence(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly sha256: string;
    readonly sourceSystem: string;
    readonly sourceAccountId: string;
    readonly occurrenceKey: string;
    readonly sourceRevision: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.intake_occurrences
        (book_id, id, sha256, source_system, source_account_id, occurrence_key, source_revision, body)
      values (${row.bookId}, ${row.id}, ${row.sha256}, ${row.sourceSystem}, ${row.sourceAccountId},
        ${row.occurrenceKey}, ${row.sourceRevision}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertConnectorRecord(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly consentId: string;
    readonly externalId: string;
    readonly revision: string;
    readonly occurrenceId: string;
    readonly batchId: string;
    readonly sha256: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_connector_records
        (book_id, consent_id, external_id, revision, occurrence_id, batch_id, sha256)
      values (${row.bookId}, ${row.consentId}, ${row.externalId}, ${row.revision},
        ${row.occurrenceId}, ${row.batchId}, ${row.sha256})
    `,
    "objects",
  );
}

export function insertBatch(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly consentId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_connector_batches (book_id, id, consent_id, body)
      values (${row.bookId}, ${row.id}, ${row.consentId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readStatementTime(transaction: Transaction) {
  return transaction.execute<{ readonly now: string }>(
    sql`select to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
    "objects",
  );
}
