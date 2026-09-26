import { textArray } from "./sql-values";
import { sql, type SQL } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

type Lock = "share" | "update";

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type ColumnAccess = {
  readonly columnName: string;
  readonly canSelect: boolean;
};

export type OccurrenceRow = {
  readonly id: string;
  readonly sha256: string;
  readonly sourceAccountId: string;
  readonly body: JsonObject;
};

export type ContentRow = {
  readonly sha256: string;
  readonly objectKey: string | null;
  readonly byteLength: number;
};

export type PreviewRow = {
  readonly id: string;
  readonly occurrenceId: string;
  readonly ordinal: number;
  readonly body: JsonObject;
};

export type RevisionRow = {
  readonly previewId: string;
  readonly ordinal: number;
  readonly digest: string;
  readonly ready: boolean;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly diagnosticCount: number;
  readonly supersededByPreviewId: string | null;
};

export type SupersessionRow = {
  readonly previousPreviewId: string;
  readonly previousOrdinal: number;
  readonly replacementPreviewId: string;
  readonly body: JsonObject;
};

export type ApprovalRow = {
  readonly id: string;
  readonly previewId: string;
  readonly actorId: string;
  readonly ordinal: number;
  readonly expiresAt: string;
  readonly rationale: string;
  readonly expiredAtCapture: boolean;
  readonly body: JsonObject;
};

export type AdmissionRow = {
  readonly previewId: string;
  readonly digest: string;
  readonly admittedAt: string;
  readonly admittedBy: string;
  readonly statementId: string;
  readonly evidenceId: string;
  readonly checkpoint: unknown;
  readonly body: JsonObject;
};

export type ReviewArtifactRow = {
  readonly id: string;
  readonly occurrenceId: string;
  readonly previewId: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly receipt: JsonObject;
};

export type DependencyRow = {
  readonly profileVersion: string;
  readonly writerEpoch: string;
  readonly accountVersion: string | null;
  readonly sourceRevision: string;
};

export type BoundRow = { readonly total: number };

export type DraftLinkRow = {
  readonly draftId: string;
  readonly evidenceContent: string;
};

export type DraftCurrentRow = {
  readonly draftId: string;
  readonly title: string;
  readonly revision: string;
  readonly currentContent: string | null;
};

export type ExpenseLinkRow = {
  readonly sourceId: string;
  readonly evidenceContent: string;
};

export type ExpenseCurrentRow = {
  readonly sourceId: string;
  readonly description: string;
  readonly digest: string;
  readonly currentContent: string | null;
  readonly reviewSourceDigest: string | null;
  readonly withdrawn: boolean;
};

export type ActivationRow = {
  readonly id: string;
  readonly ruleId: string;
  readonly simulationId: string;
  readonly body: JsonObject;
};

export type DeactivationRow = { readonly body: JsonObject };

export type FeedRow = { readonly bookId: string };

export type DeadlineRow = {
  readonly id: string;
  readonly title: string;
  readonly dueAt: string;
  readonly updatedAt: string;
  readonly timeZone: string;
  readonly revision: number;
};

export function readWorkTableAccess(transaction: Transaction) {
  return transaction.execute<TableAccess>(
    sql`
      select
        table_name as "tableName",
        case when to_regclass('openerp.' || table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || table_name, 'insert') end as "canInsert"
      from unnest(ARRAY[
        'intake_contents',
        'intake_occurrences',
        'intake_previews',
        'intake_approvals',
        'intake_admissions',
        'intake_preview_supersessions',
        'source_review_artifacts',
        'bank_sources',
        'accounts',
        'command_receipts',
        'supplier_invoice_drafts',
        'supplier_invoice_draft_revisions',
        'expense_tax_sources',
        'expense_tax_source_revisions',
        'expense_tax_reviews',
        'expense_tax_source_withdrawals',
        'evidence',
        'recurring_activations',
        'recurring_deactivations',
        'deadline_feeds',
        'deadline_obligations'
      ]::text[]) as table_name
    `,
    "objects",
  );
}

export function readWorkColumnAccess(transaction: Transaction) {
  return transaction.execute<ColumnAccess>(
    sql`
      select
        columns.table_name || '.' || columns.column_name as "columnName",
        has_column_privilege(current_user, 'openerp.' || columns.table_name, columns.column_name, 'select')
          as "canSelect"
      from unnest(
        ARRAY['books', 'books']::text[],
        ARRAY['profile_version', 'writer_epoch']::text[]
      ) as columns(table_name, column_name)
    `,
    "objects",
  );
}

function textList(values: ReadonlyArray<string>) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

function lockSql(lock: Lock) {
  return lock === "update" ? sql`for update` : sql`for share`;
}

export function readOccurrence(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  lock: Lock = "share",
) {
  return transaction.execute<OccurrenceRow>(
    sql`
      select id, sha256, source_account_id as "sourceAccountId", body
      from openerp.intake_occurrences
      where book_id = ${bookId} and id = ${occurrenceId}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function readContentManifest(transaction: Transaction, bookId: string, sha256: string) {
  return transaction.execute<ContentRow>(
    sql`
      select sha256, object_key as "objectKey", coalesce(octet_length(bytes), byte_length) as "byteLength"
      from openerp.intake_contents
      where book_id = ${bookId} and sha256 = ${sha256}
      for share
    `,
    "objects",
  );
}

export function readInlineContent(transaction: Transaction, bookId: string, sha256: string) {
  return transaction.execute<{ readonly bytes: Uint8Array | null }>(
    sql`
      select bytes from openerp.intake_contents
      where book_id = ${bookId} and sha256 = ${sha256}
      for share
    `,
    "objects",
  );
}

export type InterpretationRow = {
  readonly accountReady: boolean;
  readonly profileReady: boolean;
  readonly overlapping: boolean;
  readonly conflicting: boolean;
  readonly existingProviderIds: ReadonlyArray<string>;
};

export function readInterpretationContext(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  currency: string,
  currencyScale: number,
  sourceBankAccountId: string,
  startsOn: string,
  endsOn: string,
  providerIds: ReadonlyArray<string>,
) {
  return transaction.execute<InterpretationRow>(
    sql`
      select
        exists (
          select 1 from openerp.books b join openerp.accounts a on a.book_id = b.id
          where b.id = ${bookId} and a.id = ${accountId} and a.active
            and b.currency = ${currency} and b.currency_scale = ${currencyScale}
        ) as "accountReady",
        exists (
          select 1 from openerp.books b
          where b.id = ${bookId} and b.profile = 'synthetic-core-v1' and b.authority = 'native'
        ) as "profileReady",
        exists (
          select 1 from openerp.bank_statements s
          where s.book_id = ${bookId} and s.account_id = ${accountId}
            and s.starts_on <= ${endsOn}::date and s.ends_on >= ${startsOn}::date
        ) as overlapping,
        exists (
          select 1 from openerp.bank_sources s
          where s.book_id = ${bookId} and (
            (s.account_id = ${accountId} and s.source_bank_account_id <> ${sourceBankAccountId})
            or (s.source_bank_account_id = ${sourceBankAccountId} and s.account_id <> ${accountId})
          )
        ) as conflicting,
        coalesce((
          select array_agg(o.provider_id order by o.provider_id collate "C")
          from openerp.bank_observations o
          where o.book_id = ${bookId} and o.source_bank_account_id = ${sourceBankAccountId}
            and o.provider_id = any(${textList(providerIds)})
        ), array[]::text[]) as "existingProviderIds"
    `,
    "objects",
  );
}

export function readNextPreviewOrdinal(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return transaction.execute<{ readonly ordinal: number }>(
    sql`
      select (count(*)::integer + 1) as ordinal from openerp.intake_previews
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}
    `,
    "objects",
  );
}

export function insertPreview(
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
      insert into openerp.intake_previews (book_id, id, occurrence_id, ordinal, body)
      values (${row.bookId}, ${row.id}, ${row.occurrenceId}, ${row.ordinal},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertSupersession(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly previousPreviewId: string;
    readonly replacementPreviewId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.intake_preview_supersessions
        (book_id, previous_preview_id, replacement_preview_id, body)
      values (${row.bookId}, ${row.previousPreviewId}, ${row.replacementPreviewId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readApproval(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
  previewId: string,
  actorId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, preview_id as "previewId", actor_id as "actorId", 0 as ordinal,
        body->>'expiresAt' as "expiresAt", body->>'rationale' as rationale,
        (expires_at <= clock_timestamp()) as "expiredAtCapture", body
      from openerp.intake_approvals
      where book_id = ${bookId} and id = ${approvalId} and preview_id = ${previewId}
        and actor_id = ${actorId}
      for share
    `,
    "objects",
  );
}

export function insertAdmission(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly occurrenceId: string;
    readonly previewId: string;
    readonly approvalId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.intake_admissions (book_id, occurrence_id, preview_id, approval_id, body)
      values (${row.bookId}, ${row.occurrenceId}, ${row.previewId}, ${row.approvalId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readDependencyVersions(
  transaction: Transaction,
  bookId: string,
  accountId: string,
) {
  return transaction.execute<DependencyRow>(
    sql`
      select b.profile_version::text as "profileVersion", b.writer_epoch::text as "writerEpoch",
        a.version::text as "accountVersion", coalesce(s.revision, 0)::text as "sourceRevision"
      from openerp.books b
      left join openerp.accounts a on a.book_id = b.id and a.id = ${accountId}
      left join openerp.bank_sources s on s.book_id = b.id and s.account_id = ${accountId}
      where b.id = ${bookId}
    `,
    "objects",
  );
}

export function readConflictingSourceMappings(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  sourceAccountId: string,
) {
  return transaction.execute<{ readonly id: number }>(
    sql`
      select 1 as id
      from openerp.bank_sources
      where book_id = ${bookId}
        and ((account_id = ${accountId} and source_bank_account_id <> ${sourceAccountId})
          or (source_bank_account_id = ${sourceAccountId} and account_id <> ${accountId}))
      limit 1
    `,
    "objects",
  );
}

export function readOccurrenceInventory(
  transaction: Transaction,
  bookId: string,
  cursor: string | null,
) {
  return transaction.execute<
    OccurrenceRow & {
      readonly latestPreviewId: string | null;
      readonly admissionPreviewId: string | null;
      readonly admissionBody: JsonObject | null;
    }
  >(
    sql`
      select o.id, o.sha256, o.source_account_id as "sourceAccountId", o.body,
        latest.id as "latestPreviewId", a.preview_id as "admissionPreviewId",
        a.body as "admissionBody"
      from openerp.intake_occurrences o
      left join lateral (
        select p.id from openerp.intake_previews p
        where p.book_id = o.book_id and p.occurrence_id = o.id
        order by p.ordinal desc
        limit 1
      ) latest on true
      left join openerp.intake_admissions a on a.book_id = o.book_id and a.occurrence_id = o.id
      where o.book_id = ${bookId} and o.id > coalesce(${cursor}::text, '')
      order by o.id
      limit 21
    `,
    "objects",
  );
}

export function readPreview(
  transaction: Transaction,
  bookId: string,
  previewId: string,
  lock: Lock = "share",
) {
  return transaction.execute<PreviewRow>(
    sql`
      select id, occurrence_id as "occurrenceId", ordinal, body
      from openerp.intake_previews
      where book_id = ${bookId} and id = ${previewId}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function readSupersedingPreviewId(
  transaction: Transaction,
  bookId: string,
  previewId: string,
) {
  return transaction.execute<{ readonly replacementPreviewId: string }>(
    sql`
      select replacement_preview_id as "replacementPreviewId"
      from openerp.intake_preview_supersessions
      where book_id = ${bookId} and previous_preview_id = ${previewId}
      for share
    `,
    "objects",
  );
}

export function readCurrentOwnApproval(
  transaction: Transaction,
  bookId: string,
  previewId: string,
  actorId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, preview_id as "previewId", actor_id as "actorId", 0 as ordinal,
        body->>'expiresAt' as "expiresAt", body->>'rationale' as rationale,
        (expires_at <= clock_timestamp()) as "expiredAtCapture", body
      from openerp.intake_approvals
      where book_id = ${bookId} and preview_id = ${previewId} and actor_id = ${actorId}
        and expires_at > clock_timestamp()
      order by expires_at desc, id desc
      limit 1
      for share
    `,
    "objects",
  );
}

export function readAdmission(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<AdmissionRow>(
    sql`
      select preview_id as "previewId", body->>'digest' as digest, body->>'admittedAt' as "admittedAt",
        body->'receipt'->>'actorId' as "admittedBy",
        body->'imported'->'statement'->>'id' as "statementId",
        body->'imported'->'statement'->>'evidenceId' as "evidenceId",
        body->'imported'->'checkpoint' as checkpoint, body
      from openerp.intake_admissions
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}
      for share
    `,
    "objects",
  );
}

export function insertApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly previewId: string;
    readonly actorId: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.intake_approvals (book_id, id, preview_id, actor_id, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.previewId}, ${row.actorId}, ${row.expiresAt},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readRevisionHistory(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return transaction.execute<RevisionRow>(
    sql`
      select p.id as "previewId", p.ordinal, p.body->>'digest' as digest, p.body->'ready' as ready,
        p.body->>'createdAt' as "createdAt", p.body->>'createdBy' as "createdBy",
        jsonb_array_length(p.body->'diagnostics') as "diagnosticCount",
        s.replacement_preview_id as "supersededByPreviewId"
      from openerp.intake_previews p
      left join openerp.intake_preview_supersessions s
        on s.book_id = p.book_id and s.previous_preview_id = p.id
      where p.book_id = ${bookId} and p.occurrence_id = ${occurrenceId}
      order by p.ordinal
      for share of p
    `,
    "objects",
  );
}

export function readOccurrenceSupersessions(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return transaction.execute<SupersessionRow>(
    sql`
      select s.previous_preview_id as "previousPreviewId", p.ordinal as "previousOrdinal",
        s.replacement_preview_id as "replacementPreviewId", s.body
      from openerp.intake_previews p
      join openerp.intake_preview_supersessions s
        on s.book_id = p.book_id and s.previous_preview_id = p.id
      where p.book_id = ${bookId} and p.occurrence_id = ${occurrenceId}
      order by p.ordinal
      for share of s
    `,
    "objects",
  );
}

export function readOwnRevisionApprovals(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  actorId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select distinct on (p.id) a.id, a.preview_id as "previewId", a.actor_id as "actorId",
        p.ordinal, a.body->>'expiresAt' as "expiresAt", a.body->>'rationale' as rationale,
        (a.expires_at <= clock_timestamp()) as "expiredAtCapture", a.body
      from openerp.intake_previews p
      join openerp.intake_approvals a
        on a.book_id = p.book_id and a.preview_id = p.id and a.actor_id = ${actorId}
      where p.book_id = ${bookId} and p.occurrence_id = ${occurrenceId}
      order by p.id, a.expires_at desc, a.id desc
    `,
    "objects",
  );
}

export function readPreviewApprovalSummaries(
  transaction: Transaction,
  bookId: string,
  previewId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, preview_id as "previewId", actor_id as "actorId", 0 as ordinal,
        body->>'expiresAt' as "expiresAt", body->>'rationale' as rationale,
        (expires_at <= clock_timestamp()) as "expiredAtCapture", body
      from openerp.intake_approvals
      where book_id = ${bookId} and preview_id = ${previewId}
      order by expires_at, id collate "C"
      for share
    `,
    "objects",
  );
}

function countBounded(transaction: Transaction, statement: SQL) {
  return transaction.execute<BoundRow>(
    sql`select count(*)::integer as total from (${statement}) bounded`,
    "objects",
  );
}

export function countPreviews(transaction: Transaction, bookId: string, occurrenceId: string) {
  return countBounded(
    transaction,
    sql`select ordinal from openerp.intake_previews
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}`,
  );
}

export function countPreviewApprovals(transaction: Transaction, bookId: string, previewId: string) {
  return countBounded(
    transaction,
    sql`select id from openerp.intake_approvals
      where book_id = ${bookId} and preview_id = ${previewId}`,
  );
}

export function countOccurrenceSupersessions(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return countBounded(
    transaction,
    sql`select s.replacement_preview_id from openerp.intake_preview_supersessions s
      join openerp.intake_previews p on (p.book_id, p.id) = (s.book_id, s.previous_preview_id)
      where p.book_id = ${bookId} and p.occurrence_id = ${occurrenceId}`,
  );
}

export function countReviewArtifacts(transaction: Transaction, bookId: string) {
  return countBounded(
    transaction,
    sql`select id from openerp.source_review_artifacts where book_id = ${bookId}`,
  );
}

export function readReviewArtifact(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<ReviewArtifactRow>(
    sql`
      select id, occurrence_id as "occurrenceId", preview_id as "previewId", body, content,
        sha256, byte_length as "byteLength", receipt
      from openerp.source_review_artifacts
      where book_id = ${bookId} and id = ${id}
      for share
    `,
    "objects",
  );
}

export function listReviewArtifacts(transaction: Transaction, bookId: string) {
  return transaction.execute<ReviewArtifactRow>(
    sql`
      select id, occurrence_id as "occurrenceId", preview_id as "previewId", body, content,
        sha256, byte_length as "byteLength", receipt
      from openerp.source_review_artifacts
      where book_id = ${bookId}
      order by body->>'capturedAt' desc, id collate "C"
      limit 200
      for share
    `,
    "objects",
  );
}

export function insertReviewArtifact(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly occurrenceId: string;
    readonly previewId: string;
    readonly body: JsonObject;
    readonly content: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly receipt: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.source_review_artifacts
        (book_id, id, occurrence_id, preview_id, body, content, sha256, byte_length, receipt)
      values (${row.bookId}, ${row.id}, ${row.occurrenceId}, ${row.previewId},
        ${JSON.stringify(row.body)}::jsonb, ${row.content}, ${row.sha256}, ${row.byteLength},
        ${JSON.stringify(row.receipt)}::jsonb)
    `,
    "objects",
  );
}

export function readRetentionReceipt(
  transaction: Transaction,
  bookId: string,
  key: string,
  actorId: string,
) {
  return transaction.execute<{ readonly result: JsonObject }>(
    sql`
      select result
      from openerp.command_receipts
      where book_id = ${bookId} and key = ${key} and actor_id = ${actorId}
        and operation in ('retain_source', 'retain_source_object')
      for share
    `,
    "objects",
  );
}

export function countSupplierInvoiceDrafts(transaction: Transaction, bookId: string) {
  return transaction.execute<BoundRow>(
    sql`select count(*)::integer as total from openerp.supplier_invoice_drafts where book_id = ${bookId}`,
    "objects",
  );
}

export function countExpenseTaxSources(transaction: Transaction, bookId: string) {
  return transaction.execute<BoundRow>(
    sql`select count(*)::integer as total from openerp.expense_tax_sources where book_id = ${bookId}`,
    "objects",
  );
}

export function readLinkedDraftRevisions(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return transaction.execute<DraftLinkRow>(
    sql`
      select distinct r.draft_id as "draftId", e.content as "evidenceContent"
      from openerp.supplier_invoice_draft_revisions r
      join openerp.evidence e on e.book_id = r.book_id and e.id = r.body->'content'->>'sourceEvidenceId'
      where r.book_id = ${bookId} and strpos(e.content, ${occurrenceId}) > 0
    `,
    "objects",
  );
}

export function readDraftCurrentRevisions(
  transaction: Transaction,
  bookId: string,
  draftIds: ReadonlyArray<string>,
  occurrenceId: string,
) {
  if (draftIds.length === 0) return Effect.succeed<ReadonlyArray<DraftCurrentRow>>([]);

  return transaction.execute<DraftCurrentRow>(
    sql`
      select d.id as "draftId", r.body->'content'->>'title' as title, r.revision::text as revision,
        case when strpos(current_e.content, ${occurrenceId}) > 0 then current_e.content end
          as "currentContent"
      from unnest(${textArray(draftIds)}) as selected(draft_id)
      join openerp.supplier_invoice_drafts d
        on d.book_id = ${bookId} and d.id = selected.draft_id
      join openerp.supplier_invoice_draft_revisions r
        on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
      join openerp.evidence current_e
        on current_e.book_id = d.book_id and current_e.id = r.body->'content'->>'sourceEvidenceId'
      order by d.id collate "C"
    `,
    "objects",
  );
}

export function readLinkedExpenseRevisions(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return transaction.execute<ExpenseLinkRow>(
    sql`
      select distinct r.source_id as "sourceId", e.content as "evidenceContent"
      from openerp.expense_tax_source_revisions r
      join openerp.evidence e on e.book_id = r.book_id and e.id = r.evidence_id
      where r.book_id = ${bookId} and strpos(e.content, ${occurrenceId}) > 0
    `,
    "objects",
  );
}

export function readExpenseCurrentRevisions(
  transaction: Transaction,
  bookId: string,
  sourceIds: ReadonlyArray<string>,
  occurrenceId: string,
) {
  if (sourceIds.length === 0) return Effect.succeed<ReadonlyArray<ExpenseCurrentRow>>([]);

  return transaction.execute<ExpenseCurrentRow>(
    sql`
      with selected as (
        select r.source_id, r.body, r.evidence_id
        from unnest(${textArray(sourceIds)}) as requested(source_id)
        join lateral (
          select x.source_id, x.body, x.evidence_id
          from openerp.expense_tax_source_revisions x
          where x.book_id = ${bookId} and x.source_id = requested.source_id
          order by x.revision desc
          limit 1
        ) r on true
      )
      select selected.source_id as "sourceId", selected.body->'facts'->>'description' as description,
        selected.body->>'digest' as digest,
        case when strpos(current_e.content, ${occurrenceId}) > 0 then current_e.content end
          as "currentContent",
        review.body->>'sourceDigest' as "reviewSourceDigest",
        (withdrawn.source_id is not null) as withdrawn
      from selected
      join openerp.evidence current_e
        on current_e.book_id = ${bookId} and current_e.id = selected.evidence_id
      left join lateral (
        select x.body from openerp.expense_tax_reviews x
        where x.book_id = ${bookId} and x.source_id = selected.source_id
        order by x.revision desc
        limit 1
      ) review on true
      left join openerp.expense_tax_source_withdrawals withdrawn
        on withdrawn.book_id = ${bookId} and withdrawn.source_id = selected.source_id
      order by selected.source_id collate "C"
    `,
    "objects",
  );
}

export function readActivation(
  transaction: Transaction,
  bookId: string,
  activationId: string,
  lock: Lock = "share",
) {
  return transaction.execute<ActivationRow>(
    sql`
      select id, rule_id as "ruleId", simulation_id as "simulationId", body
      from openerp.recurring_activations
      where book_id = ${bookId} and id = ${activationId}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function readDeactivation(transaction: Transaction, bookId: string, activationId: string) {
  return transaction.execute<DeactivationRow>(
    sql`
      select body
      from openerp.recurring_deactivations
      where book_id = ${bookId} and activation_id = ${activationId}
      for share
    `,
    "objects",
  );
}

export function insertDeactivation(
  transaction: Transaction,
  row: { readonly bookId: string; readonly activationId: string; readonly body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_deactivations (book_id, activation_id, body)
      values (${row.bookId}, ${row.activationId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readFeedByTokenHash(transaction: Transaction, tokenHash: string) {
  return transaction.execute<FeedRow>(
    sql`
      select book_id as "bookId"
      from openerp.deadline_feeds
      where token_hash = ${tokenHash} and revoked_at is null
      for share
    `,
    "objects",
  );
}

export type RuleRow = { readonly body: JsonObject };

export type SelectionRow = {
  readonly selection: JsonObject;
  readonly stale: boolean;
};

export const recurringTablesForActivation = [
  "recurring_rules",
  "recurring_simulations",
  "recurring_activations",
  "recurring_deactivations",
  "bank_observations",
  "bank_statements",
  "bank_matches",
  "bank_sources",
  "periods",
  "accounts",
  "books",
  "command_receipts",
] as const;

export function readRecurringAccess(transaction: Transaction) {
  return transaction.execute<TableAccess>(
    sql`
      select
        requested.table_name as "tableName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
      from unnest(${textArray(recurringTablesForActivation)}) as requested(table_name)
    `,
    "objects",
  );
}

export function readRetainedProviderIds(
  transaction: Transaction,
  bookId: string,
  sourceBankAccountId: string,
  providerIds: ReadonlyArray<string>,
) {
  if (providerIds.length === 0) {
    return Effect.succeed<ReadonlyArray<{ readonly providerId: string }>>([]);
  }

  return transaction.execute<{ readonly providerId: string }>(
    sql`
      select distinct o.provider_id as "providerId"
      from openerp.bank_observations o
      where o.book_id = ${bookId} and o.source_bank_account_id = ${sourceBankAccountId}
        and o.provider_id = any(${textList(providerIds)})
    `,
    "objects",
  );
}

export function readRule(transaction: Transaction, bookId: string, ruleId: string) {
  return transaction.execute<RuleRow>(
    sql`
      select body from openerp.recurring_rules
      where book_id = ${bookId} and id = ${ruleId}
      for share
    `,
    "objects",
  );
}

export function readSimulation(
  transaction: Transaction,
  bookId: string,
  simulationId: string,
  ruleId: string,
) {
  return transaction.execute<RuleRow>(
    sql`
      select body from openerp.recurring_simulations
      where book_id = ${bookId} and id = ${simulationId} and rule_id = ${ruleId}
      for share
    `,
    "objects",
  );
}

export function readActiveActivation(
  transaction: Transaction,
  bookId: string,
  ruleId: string,
  lock: Lock = "share",
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select a.id from openerp.recurring_activations a
      where a.book_id = ${bookId} and a.rule_id = ${ruleId}
        and not exists (
          select 1 from openerp.recurring_deactivations d
          where d.book_id = a.book_id and d.activation_id = a.id)
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function insertActivation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ruleId: string;
    readonly simulationId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_activations (book_id, id, rule_id, simulation_id, body)
      values (${row.bookId}, ${row.id}, ${row.ruleId}, ${row.simulationId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

// Activation is the operator's authority over a reviewed preparation policy, so the
// current selection is recomputed from the granted bank projections and compared
// against the saved simulation instead of trusting the stored observation list.
export function readCurrentSelection(
  transaction: Transaction,
  bookId: string,
  rule: JsonObject,
  simulation: JsonObject,
) {
  return transaction.execute<SelectionRow>(
    sql`
      with bound as (
        select ${JSON.stringify(rule)}::jsonb as rule, ${JSON.stringify(simulation)}::jsonb as simulation
      ), configuration as (
        select
          rule, simulation,
          (rule->'input'->>'accountId')::text as account_id,
          (rule->'input'->>'description')::text as description,
          (rule->'input'->>'sign')::text as sign,
          (simulation->>'startsOn')::date as starts_on,
          (simulation->>'endsOn')::date as ends_on
        from bound
      ), dependencies as (
        select (
          rule->>'digest' is distinct from openerp.digest(rule - 'digest')
          or not exists (
            select 1 from openerp.books b
            where b.id = ${bookId} and b.profile = 'synthetic-core-v1' and b.authority = 'native')
          or exists (
            select 1 from jsonb_array_elements(coalesce(rule->'dependencies', '[]'::jsonb)) dependency
            where case dependency->>'kind'
              when 'profile' then (
                select b.profile_version::text from openerp.books b where b.id = ${bookId})
              when 'writer_epoch' then (
                select b.writer_epoch::text from openerp.books b where b.id = ${bookId})
              when 'account' then (
                select a.version::text from openerp.accounts a
                where a.book_id = ${bookId} and a.id = dependency->>'resourceId' and a.active)
              else null end
              is distinct from dependency->>'version')
          or not exists (
            select 1 from openerp.bank_sources s
            where s.book_id = ${bookId} and s.account_id = account_id
              and s.source_bank_account_id = rule->'input'->>'sourceBankAccountId')
        ) is not true as current
        from configuration
      ), eligible as (
        select o.statement_id, o.row_ordinal, o.observed_on, o.description, o.amount_minor,
          o.provider_id, s.evidence_id, p.id as period_id, p.version as period_version
        from configuration c
        join openerp.bank_observations o on o.book_id = ${bookId}
        join openerp.bank_statements s on s.book_id = o.book_id and s.id = o.statement_id
          and s.account_id = c.account_id
        left join openerp.periods p on p.book_id = o.book_id
          and o.observed_on between p.starts_on and p.ends_on
        where o.observed_on between c.starts_on and c.ends_on
          and o.description collate "C" = c.description collate "C"
          and ((c.sign = 'positive' and o.amount_minor > 0)
            or (c.sign = 'negative' and o.amount_minor < 0))
          and not exists (
            select 1 from openerp.bank_matches m
            where m.book_id = o.book_id and m.statement_id = o.statement_id
              and m.row_ordinal = o.row_ordinal)
      ), rule_overlaps as (
        select coalesce(jsonb_agg(distinct other.id order by other.id), '[]'::jsonb) as ids
        from configuration c
        join openerp.recurring_activations a on a.book_id = ${bookId}
        join openerp.recurring_rules other on other.book_id = a.book_id and other.id = a.rule_id
        where other.id <> (c.rule->>'id')::text
          and not exists (
            select 1 from openerp.recurring_deactivations d
            where d.book_id = a.book_id and d.activation_id = a.id)
          and other.body->'input'->>'accountId' = c.rule->'input'->>'accountId'
          and (other.body->'input'->>'description') collate "C"
            = (c.rule->'input'->>'description') collate "C"
          and other.body->'input'->>'sign' = c.rule->'input'->>'sign'
      ), selection as (
        select jsonb_build_object(
          'startsOn', c.starts_on::text, 'endsOn', c.ends_on::text,
          'sourceRevision', (select s.revision::text from openerp.bank_sources s
            where s.book_id = ${bookId} and s.account_id = c.account_id),
          'sequence', (select b.committed_sequence::text from openerp.books b where b.id = ${bookId}),
          'rows', coalesce((
            select jsonb_agg(jsonb_build_object(
              'statementId', e.statement_id, 'rowOrdinal', e.row_ordinal,
              'evidenceId', e.evidence_id, 'date', e.observed_on::text,
              'description', e.description, 'amountMinor', e.amount_minor::text,
              'accountingPeriodId', e.period_id,
              'periodVersion', case when e.period_id is null then null else e.period_version::text end)
              order by e.observed_on, e.statement_id, e.row_ordinal)
            from eligible e), '[]'::jsonb),
          'matchingCount', (select count(*)::bigint from eligible),
          'totalMinor', (select coalesce(sum(e.amount_minor), 0)::text from eligible e),
          'unmatchedCount', (
            select count(*) FILTER (where not exists (
              select 1 from openerp.bank_matches m
              where m.book_id = ${bookId} and m.statement_id = o.statement_id
                and m.row_ordinal = o.row_ordinal))::bigint
              - (select count(*)::bigint from eligible)
            from openerp.bank_observations o
            join openerp.bank_statements s
              on s.book_id = o.book_id and s.id = o.statement_id and s.account_id = c.account_id
            where o.observed_on between c.starts_on and c.ends_on),
          'alreadyMatchedCount', (
            select count(*) FILTER (where exists (
              select 1 from openerp.bank_matches m
              where m.book_id = ${bookId} and m.statement_id = o.statement_id
                and m.row_ordinal = o.row_ordinal))::bigint
            from openerp.bank_observations o
            join openerp.bank_statements s
              on s.book_id = o.book_id and s.id = o.statement_id and s.account_id = c.account_id
            where o.observed_on between c.starts_on and c.ends_on),
          'overlappingRuleIds', o.ids,
          'blockers', (
            select coalesce(jsonb_agg(item.message order by item.ordinal), '[]'::jsonb)
            from (
              select 1 as ordinal,
                'Some eligible observations have no accounting period.' as message
              where exists (select 1 from eligible e where e.period_id is null)
              union all
              select 2,
                'Some eligible observations belong to a locked accounting period.'
              where exists (
                select 1 from eligible e join openerp.periods p on p.book_id = ${bookId}
                  and p.id = e.period_id where p.locked)
              union all
              select 3,
                'An active recurring rule has the same bank account, exact description and sign.'
              where jsonb_array_length(o.ids) > 0
            ) item)
        ) as value
        from configuration c, rule_overlaps o, dependencies d
        where d.current
      )
      select
        coalesce((select value from selection), 'null'::jsonb) as selection,
        coalesce((
          select ((select value from selection) - 'sequence') is distinct from
            simulation - array['id', 'ruleId', 'ruleDigest', 'digest', 'createdAt',
              'receipt', 'sequence']
          from configuration
        ), true) as stale
    `,
    "objects",
  );
}

export function listFeedDeadlines(transaction: Transaction, bookId: string) {
  return transaction.execute<DeadlineRow>(
    sql`
      select id, title, due_at::text as "dueAt", updated_at::text as "updatedAt",
        time_zone as "timeZone", revision
      from openerp.deadline_obligations
      where book_id = ${bookId}
      order by due_at, id
      for share
    `,
    "objects",
  );
}
