import { sql } from "drizzle-orm";
import type * as Intake from "@open-erp/contracts/source-intake";
import { readTableAccess, type JsonObject } from "./commerce/access";
import type { Transaction } from "./transaction";

export const archiveTables = [
  "evidence",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "supplier_acceptances",
  "commerce_invoices",
  "commerce_counterparty_revisions",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "expense_tax_source_withdrawals",
  "supplier_extraction_attempts",
  "vouchers",
] as const;

export function readArchiveAccess(transaction: Transaction) {
  return readTableAccess(transaction, archiveTables);
}

export type ArchiveSelection = {
  readonly filters: typeof Intake.ArchiveFilters.Type;
  readonly cutoff: string;
  readonly after: string | null;
};

function occurrencePredicates(bookId: string, selection: ArchiveSelection) {
  const filters = selection.filters;

  return sql`o.book_id = ${bookId}
    and (${filters.occurrenceId ?? null}::text is null or o.id = ${filters.occurrenceId ?? null})
    and (o.body->>'retainedAt')::timestamptz <= ${selection.cutoff}::timestamptz
    and (${filters.sourceSystem ?? null}::text is null or o.source_system = ${filters.sourceSystem ?? null})
    and (${filters.filename ?? null}::text is null or o.body->>'filename' = ${filters.filename ?? null})
    and (${filters.retainedFrom ?? null}::text is null or left(o.body->>'retainedAt', 10) >= ${filters.retainedFrom ?? null})
    and (${filters.retainedTo ?? null}::text is null or left(o.body->>'retainedAt', 10) <= ${filters.retainedTo ?? null})`;
}

export function readArchiveAnchor(
  transaction: Transaction,
  bookId: string,
  selection: ArchiveSelection,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
    select o.id from openerp.intake_occurrences o
    where ${occurrencePredicates(bookId, selection)} and o.id = ${selection.after}
    for share of o
  `,
    "objects",
  );
}

export function listArchive(transaction: Transaction, bookId: string, selection: ArchiveSelection) {
  const filters = selection.filters;

  const hasFactFilters = [
    filters.supplierId,
    filters.documentFrom,
    filters.documentTo,
    filters.currency,
    filters.currencyScale,
    filters.amountMinor,
    filters.invoiceId,
    filters.voucherId,
  ].some((value) => value !== undefined);

  const requiresOwnerSearch = hasFactFilters || filters.q !== undefined;

  return transaction.execute<{
    readonly id: string;
    readonly body: JsonObject;
    readonly facts: ReadonlyArray<JsonObject>;
    readonly suggestions: ReadonlyArray<JsonObject>;
  }>(
    sql`
    with candidates as materialized (
      select o.id, o.body, o.sha256 from openerp.intake_occurrences o
      where ${occurrencePredicates(bookId, selection)}
        and o.id > coalesce(${selection.after}::text, '')
      order by o.id ${requiresOwnerSearch ? sql`` : sql`limit 11`}
    ), parsed_references as materialized (
      select e.id, case when pg_input_is_valid(e.content, 'jsonb') then e.content::jsonb else null end as reference
      from openerp.evidence e where e.book_id = ${bookId}
    ), source_references as materialized (
      select id, reference->>'kind' as kind,
        case when jsonb_typeof(reference->'source'->'occurrenceId') = 'string'
          then reference->'source'->>'occurrenceId' else null end as occurrence_id,
        case when jsonb_typeof(reference->'source'->'sha256') = 'string'
          then reference->'source'->>'sha256' else null end as source_hash
      from parsed_references where jsonb_typeof(reference) = 'object'
    ), qualified as materialized (
      select e.id as evidence_id, o.id as occurrence_id
      from source_references e join candidates o
        on e.occurrence_id = o.id and e.source_hash = o.sha256
      where e.kind in ('expense_entry_v1', 'supplier_invoice_source_v1')
    ), supplier_facts as (
      select q.occurrence_id, jsonb_build_object(
        'ownerKind', 'supplier_draft', 'ownerId', r.draft_id, 'revision', r.revision::text,
        'digest', r.body->>'digest', 'sourceEvidenceId', q.evidence_id,
        'recordedAt', r.body->>'createdAt', 'currentSource', r.revision = d.current_revision,
        'withdrawn', false, 'reviewId', null, 'reviewRevision', null, 'reviewDigest', null, 'reviewedAt', null,
        'basis', case when i.id is null then 'entered_draft' else 'registered_invoice' end,
        'supplierId', coalesce(i.counterparty_id, r.body->'content'->>'counterpartyId'),
        'supplierName', coalesce(cp.body->>'displayName', r.body->'counterparty'->>'displayName'),
        'documentDate', case when i.id is null then r.body->'content'->>'documentDate' else i.issued_on::text end,
        'currency', case when i.id is null then r.body->'content'->>'currency' else i.body->>'currency' end,
        'currencyScale', case when i.id is null then r.body->'content'->'currencyScale' else i.body->'currencyScale' end,
        'grossMinor', case when i.id is null then r.body->'totals'->>'grossMinor' else i.amount_minor::text end,
        'invoiceId', i.id, 'voucherId', i.recognition_voucher_id
      ) as fact
      from openerp.supplier_invoice_draft_revisions r
      join qualified q on q.evidence_id = r.body->'content'->>'sourceEvidenceId'
      join openerp.supplier_invoice_drafts d on d.book_id = r.book_id and d.id = r.draft_id
      left join openerp.supplier_acceptances a on a.book_id = r.book_id
        and a.draft_id = r.draft_id and a.draft_revision = r.revision
      left join openerp.commerce_invoices cash on cash.book_id = r.book_id
        and cash.cash_method_source_draft_id = r.draft_id
        and cash.body->'cashMethod'->>'draftRevision' = r.revision::text
        and cash.body->'cashMethod'->>'draftDigest' = r.body->>'digest'
      left join openerp.commerce_invoices i on i.book_id = r.book_id
        and i.id = coalesce(a.register_invoice_id, cash.id)
      left join openerp.commerce_counterparty_revisions cp on cp.book_id = i.book_id
        and cp.counterparty_id = i.counterparty_id and cp.revision = i.counterparty_revision
      where r.book_id = ${bookId}
    ), expense_facts as (
      select q.occurrence_id, jsonb_build_object(
        'ownerKind', 'expense_source', 'ownerId', r.source_id, 'revision', r.revision::text,
        'digest', r.body->>'digest', 'sourceEvidenceId', q.evidence_id,
        'recordedAt', r.body->>'recordedAt', 'currentSource', not exists (
          select 1 from openerp.expense_tax_source_revisions newer
          where newer.book_id = r.book_id and newer.source_id = r.source_id and newer.revision > r.revision),
        'withdrawn', exists (select 1 from openerp.expense_tax_source_withdrawals w
          where w.book_id = r.book_id and w.source_id = r.source_id),
        'basis', 'entered_expense', 'reviewId', null, 'reviewRevision', null, 'reviewDigest', null, 'reviewedAt', null,
        'supplierId', null, 'supplierName', null,
        'documentDate', r.body->'facts'->>'issuedOn', 'currency', r.body->'facts'->>'currency',
        'currencyScale', r.body->'facts'->'currencyScale',
        'grossMinor', r.body->'facts'->'amounts'->>'grossMinor', 'invoiceId', null,
        'voucherId', v.id
      ) as fact, r.body->>'digest' as source_digest
      from openerp.expense_tax_source_revisions r join qualified q on q.evidence_id = r.evidence_id
      left join openerp.vouchers v on v.book_id = r.book_id and v.id = r.voucher_id
      where r.book_id = ${bookId}
    ), facts as materialized (
      select occurrence_id, fact from supplier_facts
      union all select occurrence_id, fact from expense_facts
      union all select f.occurrence_id, f.fact || jsonb_build_object(
        'basis', 'reviewed_expense', 'reviewId', review.id, 'reviewRevision', review.revision::text,
        'reviewDigest', review.body->>'digest', 'reviewedAt', review.body->>'recordedAt',
        'grossMinor', review.body->'facts'->'amounts'->>'grossMinor'
      ) from expense_facts f
      join openerp.expense_tax_reviews review on review.book_id = ${bookId}
        and review.source_id = f.fact->>'ownerId' and review.body->>'sourceDigest' = f.source_digest
      where not exists (select 1 from openerp.expense_tax_reviews newer
        where newer.book_id = review.book_id and newer.source_id = review.source_id and newer.revision > review.revision)
    ), selected as (
      select o.id, o.body from candidates o
      join openerp.intake_occurrences original on original.book_id = ${bookId} and original.id = o.id
      where ((not ${hasFactFilters} and (${filters.q ?? null}::text is null
          or strpos(lower(o.body->>'filename'), lower(${filters.q ?? null})) > 0))
          or exists (select 1 from facts f where f.occurrence_id = o.id
            and (f.fact->>'currentSource')::boolean
            and (${filters.q ?? null}::text is null or strpos(lower(o.body->>'filename'), lower(${filters.q ?? null})) > 0
              or strpos(lower(f.fact->>'supplierName'), lower(${filters.q ?? null})) > 0)
            and (${filters.supplierId ?? null}::text is null or f.fact->>'supplierId' = ${filters.supplierId ?? null})
            and (${filters.documentFrom ?? null}::text is null or f.fact->>'documentDate' >= ${filters.documentFrom ?? null})
            and (${filters.documentTo ?? null}::text is null or f.fact->>'documentDate' <= ${filters.documentTo ?? null})
            and (${filters.currency ?? null}::text is null or f.fact->>'currency' = ${filters.currency ?? null})
            and (${filters.currencyScale ?? null}::text is null or f.fact->>'currencyScale' = ${filters.currencyScale ?? null})
            and (${filters.amountMinor ?? null}::text is null or f.fact->>'grossMinor' = ${filters.amountMinor ?? null})
            and (${filters.invoiceId ?? null}::text is null or f.fact->>'invoiceId' = ${filters.invoiceId ?? null})
            and (${filters.voucherId ?? null}::text is null or f.fact->>'voucherId' = ${filters.voucherId ?? null})))
      order by o.id limit 11 for share of original
    )
    select selected.id, selected.body,
      coalesce((select jsonb_agg(f.fact order by f.fact->>'ownerKind', f.fact->>'ownerId',
        (f.fact->>'revision')::integer, f.fact->>'basis') from (
          select fact from facts where occurrence_id = selected.id
          order by fact->>'ownerKind', fact->>'ownerId', (fact->>'revision')::integer, fact->>'basis'
          limit 1001
        ) f), '[]'::jsonb) as facts,
      coalesce((select jsonb_agg(jsonb_build_object(
        'basis', 'unreviewed_extraction', 'attemptId', a.id, 'sourceHash', a.body->>'sourceHash',
        'createdAt', a.body->>'createdAt', 'revision', a.ordinal::text,
        'engineRelease', a.body->>'engineRelease', 'result', a.body->>'status',
        'retainedOutputHash', a.body->>'retainedOutputHash', 'fields', coalesce((select jsonb_agg(jsonb_build_object(
          'fieldKey', field->>'fieldKey', 'proposedValue', field->>'proposedValue', 'lineOrdinal', field->'lineOrdinal'))
          from jsonb_array_elements(coalesce(a.body->'extraction'->'fields', '[]'::jsonb)) field
          where field->>'fieldKey' in ('title', 'supplierDocumentNumber', 'documentDate', 'sourceTotalMinor')), '[]'::jsonb))
      order by a.ordinal) from openerp.supplier_extraction_attempts a
        where a.book_id = ${bookId} and a.occurrence_id = selected.id
          and a.body->>'sourceHash' = selected.body->>'sha256'), '[]'::jsonb) as suggestions
    from selected order by selected.id
  `,
    "objects",
  );
}
