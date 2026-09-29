import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

// The exact retained provider bytes for one page. The interpretation is a
// function of these, so the owner reads them rather than trusting a digest a
// client states.
export type PageContentRow = {
  readonly rawDigest: string;
  readonly bytes: string;
};

export type RevisionRow = {
  readonly id: string;
  readonly consentId: string;
  readonly providerTransactionId: string;
  readonly changeKind: string;
  readonly publicationVersion: string;
  readonly normalized: Json;
  readonly rawContentSha256: string;
  readonly rawLocator: string;
  readonly parserVersion: string;
  readonly recordedAt: string;
};

export type HeadRow = {
  readonly consentId: string;
  readonly providerTransactionId: string;
  readonly latestRevisionId: string;
  readonly eligibilityVersion: string;
  readonly admittedStatementId: string | null;
  readonly admittedRowOrdinal: number | null;
  readonly matched: boolean;
  readonly accountingComplete: boolean;
  readonly version: string;
};

export type CandidateRow = {
  readonly pageOrdinal: number;
  readonly recordOrdinal: number;
  readonly kind: string;
  readonly sourceId: string;
  readonly rawLocator: string;
};

export type CaseRow = {
  readonly id: string;
  readonly caseKind: string;
  readonly body: JsonObject;
  readonly recordedAt: string;
};

export type AdmissionRow = {
  readonly id: string;
  readonly revisionId: string;
  readonly statementId: string;
  readonly rowOrdinal: number;
  readonly relation: string;
  readonly commandKey: string;
  readonly reviewer: string;
  readonly reviewDigest: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
  readonly recordedAt: string;
};

export type PublicationRow = {
  readonly generationId: string;
  readonly streamId: string;
  readonly finalCursor: string;
  readonly changeCount: number;
  // The stream's publication version this marker produced. The change count
  // is not a version: two windows can carry the same number of changes and
  // are still different publications.
  readonly publicationVersion: string;
};

export type ObservationRow = {
  readonly statementId: string;
  readonly rowOrdinal: number;
  readonly sourceBankAccountId: string;
  readonly observedOn: string;
  readonly description: string;
  readonly amountMinor: string;
  readonly providerId: string | null;
  readonly matched: boolean;
};

export function readPageContent(
  transaction: Transaction,
  bookId: string,
  generationId: string,
  pageOrdinal: number,
) {
  return transaction.execute<PageContentRow>(
    sql`
      select p.raw_digest as "rawDigest", convert_from(c.bytes, 'UTF8') as bytes
      from openerp.bank_sync_pages p
      join openerp.intake_contents c on c.book_id = p.book_id and c.sha256 = p.raw_digest
      where p.book_id = ${bookId} and p.generation_id = ${generationId}
        and p.ordinal = ${pageOrdinal}
    `,
    "objects",
  );
}

export function readCandidates(transaction: Transaction, bookId: string, generationId: string) {
  return transaction.execute<CandidateRow>(
    sql`
      select page_ordinal as "pageOrdinal", record_ordinal as "recordOrdinal", kind,
        source_id as "sourceId", raw_locator as "rawLocator"
      from openerp.bank_sync_candidates
      where book_id = ${bookId} and generation_id = ${generationId}
      order by page_ordinal, record_ordinal
    `,
    "objects",
  );
}

// A generation is only interpretable once its publication marker exists. Raw
// provider delivery is not a reviewed observation, and a staged generation is
// not a published one.
export function readPublication(transaction: Transaction, bookId: string, generationId: string) {
  return transaction.execute<PublicationRow>(
    sql`
      select p.generation_id as "generationId", p.stream_id as "streamId",
        p.final_cursor as "finalCursor", p.change_count as "changeCount",
        s.publication_version::text as "publicationVersion"
      from openerp.bank_sync_publications p
      join openerp.bank_sync_streams s on s.book_id = p.book_id and s.id = p.stream_id
      where p.book_id = ${bookId} and p.generation_id = ${generationId}
    `,
    "objects",
  );
}

export function readStreamGeneration(
  transaction: Transaction,
  bookId: string,
  generationId: string,
) {
  return transaction.execute<{ readonly streamId: string; readonly consentId: string }>(
    sql`
      select g.stream_id as "streamId", s.consent_id as "consentId"
      from openerp.bank_sync_generations g
      join openerp.bank_sync_streams s on s.book_id = g.book_id and s.id = g.stream_id
      where g.book_id = ${bookId} and g.id = ${generationId}
    `,
    "objects",
  );
}

// The consent row the provider identity belongs to. A shared read: this owner
// never mutates a consent, the connector owner does.
export function readConsent(transaction: Transaction, bookId: string, consentId: string) {
  return transaction.execute<{
    readonly id: string;
    readonly providerId: string;
    readonly sourceAccountId: string;
    readonly accountId: string;
    readonly revokedAt: string | null;
  }>(
    sql`
      select id, provider_id as "providerId", source_account_id as "sourceAccountId",
        account_id as "accountId", revoked_at::text as "revokedAt"
      from openerp.bank_connector_consents
      where book_id = ${bookId} and id = ${consentId}
    `,
    "objects",
  );
}

export function readRevisionById(transaction: Transaction, bookId: string, revisionId: string) {
  return transaction.execute<RevisionRow>(
    sql`
      select id, consent_id as "consentId",
        provider_transaction_id as "providerTransactionId", change_kind as "changeKind",
        publication_version as "publicationVersion", normalized,
        raw_content_sha256 as "rawContentSha256", raw_locator as "rawLocator",
        parser_version as "parserVersion", recorded_at::text as "recordedAt"
      from openerp.bank_source_revisions
      where book_id = ${bookId} and id = ${revisionId}
    `,
    "objects",
  );
}

// How many retained observations this provider identity resolves to. An
// admission is only ever one, so a count above one would be a duplicated
// cash capacity and is reported rather than assumed away.
export function readAdmittedCount(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  providerTransactionId: string,
) {
  return transaction.execute<{ readonly count: string }>(
    sql`
      select count(distinct (admitted_statement_id, admitted_row_ordinal))::text as count
      from openerp.bank_observation_heads
      where book_id = ${bookId} and consent_id = ${consentId}
        and provider_transaction_id = ${providerTransactionId}
        and admitted_statement_id is not null
    `,
    "objects",
  );
}

export function readRevision(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  providerTransactionId: string,
) {
  return transaction.execute<RevisionRow>(
    sql`
      select id, consent_id as "consentId",
        provider_transaction_id as "providerTransactionId", change_kind as "changeKind",
        publication_version as "publicationVersion", normalized,
        raw_content_sha256 as "rawContentSha256", raw_locator as "rawLocator",
        parser_version as "parserVersion", recorded_at::text as "recordedAt"
      from openerp.bank_source_revisions
      where book_id = ${bookId} and consent_id = ${consentId}
        and provider_transaction_id = ${providerTransactionId}
      order by publication_version desc
      limit 1
    `,
    "objects",
  );
}

export function readRetainedRevision(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  providerTransactionId: string,
  publicationVersion: string,
) {
  return transaction.execute<RevisionRow>(
    sql`
      select id, consent_id as "consentId",
        provider_transaction_id as "providerTransactionId", change_kind as "changeKind",
        publication_version as "publicationVersion", normalized,
        raw_content_sha256 as "rawContentSha256", raw_locator as "rawLocator",
        parser_version as "parserVersion", recorded_at::text as "recordedAt"
      from openerp.bank_source_revisions
      where book_id = ${bookId} and consent_id = ${consentId}
        and provider_transaction_id = ${providerTransactionId}
        and publication_version = ${publicationVersion}
    `,
    "objects",
  );
}

export function insertRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly consentId: string;
    readonly generationId: string;
    readonly pageOrdinal: number;
    readonly recordOrdinal: number;
    readonly providerTransactionId: string;
    readonly changeKind: string;
    readonly publicationVersion: string;
    readonly rawContentSha256: string;
    readonly rawLocator: string;
    readonly normalized: JsonObject | null;
    readonly parserVersion: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_source_revisions
        (book_id, id, consent_id, generation_id, page_ordinal, record_ordinal,
          provider_transaction_id, change_kind, publication_version, raw_content_sha256,
          raw_locator, normalized, parser_version)
      values (${row.bookId}, ${row.id}, ${row.consentId}, ${row.generationId},
        ${row.pageOrdinal}, ${row.recordOrdinal}, ${row.providerTransactionId}, ${row.changeKind},
        ${row.publicationVersion}, ${row.rawContentSha256}, ${row.rawLocator},
        ${row.normalized === null ? null : JSON.stringify(row.normalized)}::jsonb, ${row.parserVersion})
    `,
    "objects",
  );
}

export function readHead(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  providerTransactionId: string,
) {
  return transaction.execute<HeadRow>(
    sql`
      select consent_id as "consentId",
        provider_transaction_id as "providerTransactionId",
        latest_revision_id as "latestRevisionId",
        eligibility_version::text as "eligibilityVersion",
        admitted_statement_id as "admittedStatementId",
        admitted_row_ordinal as "admittedRowOrdinal", matched,
        accounting_complete as "accountingComplete", version::text as version
      from openerp.bank_observation_heads
      where book_id = ${bookId} and consent_id = ${consentId}
        and provider_transaction_id = ${providerTransactionId}
    `,
    "objects",
  );
}

export function lockHead(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  providerTransactionId: string,
) {
  return transaction.execute<HeadRow>(
    sql`
      select consent_id as "consentId",
        provider_transaction_id as "providerTransactionId",
        latest_revision_id as "latestRevisionId",
        eligibility_version::text as "eligibilityVersion",
        admitted_statement_id as "admittedStatementId",
        admitted_row_ordinal as "admittedRowOrdinal", matched,
        accounting_complete as "accountingComplete", version::text as version
      from openerp.bank_observation_heads
      where book_id = ${bookId} and consent_id = ${consentId}
        and provider_transaction_id = ${providerTransactionId}
      for update
    `,
    "objects",
  );
}

export function insertHead(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly consentId: string;
    readonly providerTransactionId: string;
    readonly revisionId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_observation_heads
        (book_id, consent_id, provider_transaction_id, latest_revision_id)
      values (${row.bookId}, ${row.consentId}, ${row.providerTransactionId}, ${row.revisionId})
    `,
    "objects",
  );
}

// The head advances one version per revision, and only under the version the
// writer observed. A concurrent revision for the same identity updates nothing
// and the caller refuses.
export function advanceHead(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly consentId: string;
    readonly providerTransactionId: string;
    readonly expectedVersion: string;
    readonly version: string;
    readonly latestRevisionId: string;
    readonly eligibilityVersion: string;
  },
) {
  return transaction.execute(
    sql`
      update openerp.bank_observation_heads
      set latest_revision_id = ${row.latestRevisionId},
        eligibility_version = ${row.eligibilityVersion}::bigint,
        version = ${row.version}::bigint
      where book_id = ${row.bookId} and consent_id = ${row.consentId}
        and provider_transaction_id = ${row.providerTransactionId}
        and version = ${row.expectedVersion}::bigint
      returning 1::text as moved
    `,
    "objects",
  );
}

export function admitHead(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly consentId: string;
    readonly providerTransactionId: string;
    readonly expectedVersion: string;
    readonly version: string;
    readonly statementId: string;
    readonly rowOrdinal: number;
  },
) {
  return transaction.execute(
    sql`
      update openerp.bank_observation_heads
      set admitted_statement_id = ${row.statementId},
        admitted_row_ordinal = ${row.rowOrdinal},
        version = ${row.version}::bigint
      where book_id = ${row.bookId} and consent_id = ${row.consentId}
        and provider_transaction_id = ${row.providerTransactionId}
        and version = ${row.expectedVersion}::bigint
        and admitted_statement_id is null
      returning 1::text as moved
    `,
    "objects",
  );
}

export function readObservation(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<ObservationRow>(
    sql`
      select o.statement_id as "statementId", o.row_ordinal as "rowOrdinal",
        o.source_bank_account_id as "sourceBankAccountId",
        to_char(o.observed_on, 'YYYY-MM-DD') as "observedOn",
        o.description, o.amount_minor::text as "amountMinor", o.provider_id as "providerId",
        exists (select 1 from openerp.bank_active_matches m
          where m.book_id = o.book_id and m.statement_id = o.statement_id
            and m.row_ordinal = o.row_ordinal) as matched
      from openerp.bank_observations o
      where o.book_id = ${bookId} and o.statement_id = ${statementId}
        and o.row_ordinal = ${rowOrdinal}
    `,
    "objects",
  );
}

export function readLookalikes(
  transaction: Transaction,
  bookId: string,
  sourceBankAccountId: string,
  observedOn: string,
  amountMinor: string,
) {
  return transaction.execute<{ readonly statementId: string; readonly rowOrdinal: number }>(
    sql`
      select statement_id as "statementId", row_ordinal as "rowOrdinal"
      from openerp.bank_observations
      where book_id = ${bookId} and source_bank_account_id = ${sourceBankAccountId}
        and to_char(observed_on, 'YYYY-MM-DD') = ${observedOn}
        and amount_minor = ${amountMinor}::numeric
      order by statement_id, row_ordinal
      limit 20
    `,
    "objects",
  );
}

export function insertCase(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly consentId: string;
    readonly providerTransactionId: string;
    readonly caseKind: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_source_cases
        (book_id, id, consent_id, provider_transaction_id, case_kind, body)
      values (${row.bookId}, ${row.id}, ${row.consentId}, ${row.providerTransactionId},
        ${row.caseKind}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readCases(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  providerTransactionId: string,
) {
  return transaction.execute<CaseRow>(
    sql`
      select id, case_kind as "caseKind", body, recorded_at::text as "recordedAt"
      from openerp.bank_source_cases
      where book_id = ${bookId} and consent_id = ${consentId}
        and provider_transaction_id = ${providerTransactionId}
      order by recorded_at desc, id desc
      limit 50
    `,
    "objects",
  );
}

export function readAdmissionByRevision(
  transaction: Transaction,
  bookId: string,
  revisionId: string,
) {
  return transaction.execute<AdmissionRow>(
    sql`
      select id, revision_id as "revisionId", statement_id as "statementId",
        row_ordinal as "rowOrdinal", relation, command_key as "commandKey",
        reviewer, review_digest as "reviewDigest",
        evidence_id as "evidenceId", body, recorded_at::text as "recordedAt"
      from openerp.bank_source_admissions
      where book_id = ${bookId} and revision_id = ${revisionId}
    `,
    "objects",
  );
}

export function insertAdmission(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly consentId: string;
    readonly providerTransactionId: string;
    readonly revisionId: string;
    readonly statementId: string;
    readonly rowOrdinal: number;
    readonly relation: string;
    readonly commandKey: string;
    readonly reviewer: string;
    readonly reviewDigest: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_source_admissions
        (book_id, id, consent_id, provider_transaction_id, revision_id, statement_id,
          row_ordinal, relation, command_key, reviewer, review_digest, evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.consentId}, ${row.providerTransactionId},
        ${row.revisionId}, ${row.statementId}, ${row.rowOrdinal}, ${row.relation},
        ${row.commandKey}, ${row.reviewer}, ${row.reviewDigest}, ${row.evidenceId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

// The read model. It never returns candidate rows and never asserts coverage:
// a provider identity is exactly what its admitted observation and open cases
// say it is.
export function readObservationState(
  transaction: Transaction,
  bookId: string,
  consentId: string,
  providerTransactionId: string,
) {
  return transaction.execute<{
    readonly revisions: Json;
    readonly head: Json;
    readonly admitted: Json;
    readonly openCases: Json;
  }>(
    sql`
      select coalesce((
        select jsonb_agg(jsonb_build_object(
          'revisionId', r.id, 'changeKind', r.change_kind,
          'publicationVersion', r.publication_version,
          'cashMovementMinor', r.normalized->>'cashMovementMinor',
          'rawContentSha256', r.raw_content_sha256,
          'recordedAt', r.recorded_at
        ) order by r.publication_version)
        from (select * from openerp.bank_source_revisions
          where book_id = ${bookId} and consent_id = ${consentId}
            and provider_transaction_id = ${providerTransactionId}
          order by publication_version limit 50) r
      ), '[]'::jsonb) as revisions,
      (select jsonb_build_object(
        'matched', h.matched, 'accountingComplete', h.accounting_complete,
        'eligibilityVersion', h.eligibility_version::text,
        'admittedStatementId', h.admitted_statement_id,
        'admittedRowOrdinal', h.admitted_row_ordinal
      ) from openerp.bank_observation_heads h
        where h.book_id = ${bookId} and h.consent_id = ${consentId}
          and h.provider_transaction_id = ${providerTransactionId}) as head,
      (select jsonb_build_object(
        'admissionId', a.id, 'statementId', a.statement_id, 'rowOrdinal', a.row_ordinal,
        'relation', a.relation, 'reviewDigest', a.review_digest, 'evidenceId', a.evidence_id
      ) from openerp.bank_source_admissions a
        where a.book_id = ${bookId} and a.consent_id = ${consentId}
          and a.provider_transaction_id = ${providerTransactionId}
        order by a.recorded_at desc limit 1) as admitted,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'caseId', c.id, 'caseKind', c.case_kind,
          'bookedBefore', coalesce((c.body->>'bookedBefore')::boolean, false),
          'recordedAt', c.recorded_at
        ) order by c.recorded_at desc, c.id desc)
        from openerp.bank_source_cases c
        where c.book_id = ${bookId} and c.consent_id = ${consentId}
          and c.provider_transaction_id = ${providerTransactionId}
      ), '[]'::jsonb) as "openCases"
    `,
    "objects",
  );
}
