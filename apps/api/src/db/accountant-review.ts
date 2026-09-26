import { textArray } from "./sql-values";
import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

export type PackRow = {
  readonly bookId: string;
  readonly id: string;
  readonly ordinal: string;
  readonly reportId: string;
  readonly body: JsonObject;
};

export type PackSummaryRow = {
  readonly id: string;
  readonly ordinal: string;
  readonly digest: string;
  readonly reportId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly sequence: string;
  readonly createdAt: string;
};

export type BookStateRow = {
  readonly committedSequence: string;
  readonly currency: string;
};

export type EvidencePresenceRow = {
  readonly id: string;
};

export type BalanceTotalRow = {
  readonly accountId: string;
  readonly openingMinor: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly closingMinor: string;
};

export type ArtifactRow = {
  readonly format: string;
  readonly descriptor: JsonObject;
  readonly content: string;
};

export type StoredRow = {
  readonly ordinal: string;
  readonly body: JsonObject;
};

export type ReportRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly sequence: string;
  readonly body: JsonObject;
  readonly invalidated: boolean;
};

export type AccountRow = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
};

export type CaptureRows = {
  readonly balances: Json;
  readonly journal: Json;
  readonly evidence: Json;
  readonly owner_sources: Json;
  readonly owner_controls: Json;
  readonly expense_tax: Json;
};

export type CaptureProviderRows = {
  readonly ownerControls: ReadonlyArray<JsonObject>;
  readonly expenseTax: ReadonlyArray<JsonObject>;
};

export type BasisDependencies = {
  readonly owners: JsonObject;
  readonly expenseTax: JsonObject;
  readonly vatReturns: JsonObject | null;
  readonly subledgerControls: JsonObject;
  readonly bank: JsonObject;
  readonly commerce: JsonObject;
  readonly schedules: JsonObject;
};

export type CaptureSummary = {
  readonly voucherCount: string;
  readonly journalLineCount: string;
  readonly accountCount: string;
  readonly evidenceCount: string;
  readonly evidenceBytes: string;
  readonly earlierVoucherCount: string;
  readonly excludedVoucherCount: string;
};

export type BasisRow = {
  readonly basis: JsonObject;
};

export type BoundsRow = {
  readonly bounded: boolean;
};

export function readPack(transaction: Transaction, bookId: string, packId: string) {
  return transaction.execute<PackRow>(
    sql`
      select book_id as "bookId", id, ordinal::text as ordinal, report_id as "reportId", body
      from openerp.accountant_review_packs
      where book_id = ${bookId} and id = ${packId}
      for share
    `,
    "objects",
  );
}

export function readPackSummaries(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<PackSummaryRow>(
    sql`
      select id, ordinal::text as ordinal, body->>'digest' as digest, report_id as "reportId",
        body->'report'->>'startsOn' as "startsOn", body->'report'->>'endsOn' as "endsOn",
        body->'report'->>'sequence' as sequence, body->>'createdAt' as "createdAt"
      from openerp.accountant_review_packs
      where book_id = ${bookId} and ordinal > ${after}::bigint
      order by ordinal
      limit ${limit}
      for share
    `,
    "objects",
  );
}

export function readStoredRows(
  transaction: Transaction,
  bookId: string,
  packId: string,
  section: string,
  after: string,
  limit: number,
) {
  return transaction.execute<StoredRow>(
    sql`
      select ordinal::text as ordinal, body
      from openerp.accountant_review_rows
      where book_id = ${bookId} and pack_id = ${packId} and section = ${section}
        and ordinal > ${after}::bigint
      order by ordinal
      limit ${limit}
      for share
    `,
    "objects",
  );
}

export function readRowAnchor(
  transaction: Transaction,
  bookId: string,
  packId: string,
  section: string,
  ordinal: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.accountant_review_rows
        where book_id = ${bookId} and pack_id = ${packId} and section = ${section}
          and ordinal = ${ordinal}::bigint
      ) as present
    `,
    "objects",
  );
}

export function readArtifactDescriptors(transaction: Transaction, bookId: string, packId: string) {
  return transaction.execute<{ readonly format: string; readonly descriptor: JsonObject }>(
    sql`
      select format, descriptor
      from openerp.accountant_review_artifacts
      where book_id = ${bookId} and pack_id = ${packId}
      order by format collate "C"
      for share
    `,
    "objects",
  );
}

export function readArtifact(
  transaction: Transaction,
  bookId: string,
  packId: string,
  format: string,
) {
  return transaction.execute<ArtifactRow>(
    sql`
      select format, descriptor, content
      from openerp.accountant_review_artifacts
      where book_id = ${bookId} and pack_id = ${packId} and format = ${format}
      for share
    `,
    "objects",
  );
}

export function readBookState(transaction: Transaction, bookId: string) {
  return transaction.execute<BookStateRow>(
    sql`
      select committed_sequence::text as "committedSequence", currency
      from openerp.books
      where id = ${bookId}
    `,
    "objects",
  );
}

export function readEvidencePresence(
  transaction: Transaction,
  bookId: string,
  evidenceIds: ReadonlyArray<string>,
) {
  return transaction.execute<EvidencePresenceRow>(
    sql`
      select id
      from openerp.evidence
      where book_id = ${bookId} and id = any(${textArray(evidenceIds)})
    `,
    "objects",
  );
}

export function readBalanceTotals(transaction: Transaction, bookId: string, report: ReportRow) {
  return transaction.execute<BalanceTotalRow>(
    sql`
      select a.id as "accountId",
        coalesce(sum(l.debit_minor - l.credit_minor)
          filter (where v.posting_date < ${report.startsOn}::date), 0)::text as "openingMinor",
        coalesce(sum(l.debit_minor)
          filter (where v.posting_date >= ${report.startsOn}::date), 0)::text as "debitMinor",
        coalesce(sum(l.credit_minor)
          filter (where v.posting_date >= ${report.startsOn}::date), 0)::text as "creditMinor",
        (coalesce(sum(l.debit_minor - l.credit_minor)
          filter (where v.posting_date < ${report.startsOn}::date), 0)
          + coalesce(sum(l.debit_minor) filter (where v.posting_date >= ${report.startsOn}::date), 0)
          - coalesce(sum(l.credit_minor) filter (where v.posting_date >= ${report.startsOn}::date), 0))::text
          as "closingMinor"
      from openerp.accounts a
      left join openerp.journal_lines l on l.book_id = a.book_id and l.account_id = a.id
      left join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
        and v.sequence <= ${report.sequence}::bigint and v.posting_date <= ${report.endsOn}::date
      where a.book_id = ${bookId}
      group by a.id
      order by a.id collate "C"
    `,
    "objects",
  );
}

export function readReport(transaction: Transaction, bookId: string, reportId: string) {
  return transaction.execute<ReportRow>(
    sql`
      select r.id, r.starts_on::text as "startsOn", r.ends_on::text as "endsOn",
        r.sequence::text as sequence, r.body,
        exists (
          select 1 from openerp.closing_invalidations i
          where i.book_id = r.book_id and i.kind = 'report' and i.artifact_id = r.id
        ) as invalidated
      from openerp.report_snapshots r
      where r.book_id = ${bookId} and r.id = ${reportId}
      for share
    `,
    "objects",
  );
}

export function readAccounts(transaction: Transaction, bookId: string) {
  return transaction.execute<AccountRow>(
    sql`
      select id, code, name
      from openerp.accounts
      where book_id = ${bookId}
      order by id collate "C"
      for share
    `,
    "objects",
  );
}

export function readProviderBounds(transaction: Transaction, bookId: string) {
  return transaction.execute<BoundsRow>(
    sql`
      select not (
        (select count(*) from (select 1 from openerp.owner_parties where book_id = ${bookId} limit 101) owners) > 100
        or (select count(*) from (select 1 from openerp.owner_records where book_id = ${bookId} limit 1001) sources) > 1000
        or (select count(*) from (select 1 from openerp.owner_effects where book_id = ${bookId} limit 1001) effects) > 1000
        or (select count(*) from (select 1 from openerp.owner_allocation_legs where book_id = ${bookId} limit 5001) legs) > 5000
        or (select count(*) from (select 1 from openerp.expense_tax_sources where book_id = ${bookId} limit 201) sources) > 200
        or (select count(*) from (select 1 from openerp.vat_return_drafts where book_id = ${bookId} limit 501) drafts) > 500
        or (select count(*) from (select 1 from openerp.subledger_schedules where book_id = ${bookId} limit 201) schedules) > 200
        or (select count(*) from (select 1 from openerp.subledger_bases where book_id = ${bookId} limit 201) bases) > 200
        or (select count(*) from (select 1 from openerp.subledger_control_snapshots where book_id = ${bookId} limit 201) snapshots) > 200
        or (select count(*) from (select 1 from openerp.subledger_preparations where book_id = ${bookId} limit 10001) preparations) > 10000
        or (select count(*) from (select 1 from openerp.accounts where book_id = ${bookId} limit 1001) accounts) > 1000
        or (select count(*) from (select 1 from openerp.periods where book_id = ${bookId} limit 1001) periods) > 1000
      ) as bounded
    `,
    "objects",
  );
}

export function readCaptureSummary(transaction: Transaction, bookId: string, report: ReportRow) {
  return transaction.execute<CaptureSummary>(
    sql`
      select
        (select count(*) from openerp.vouchers where book_id = ${bookId})::text as "voucherCount",
        (select count(*) from openerp.journal_lines l join openerp.vouchers v
          on v.book_id = l.book_id and v.id = l.voucher_id
          where v.book_id = ${bookId} and v.sequence <= ${report.sequence}::bigint)::text as "journalLineCount",
        (select count(*) from openerp.accounts where book_id = ${bookId})::text as "accountCount",
        (select count(*) from openerp.evidence where book_id = ${bookId})::text as "evidenceCount",
        (select coalesce(sum(octet_length(e.content)), 0) from openerp.evidence e
          where e.book_id = ${bookId})::text as "evidenceBytes",
        (select count(*) from openerp.vouchers where book_id = ${bookId}
          and sequence <= ${report.sequence}::bigint and posting_date < ${report.startsOn}::date)::text
          as "earlierVoucherCount",
        (select count(*) from openerp.vouchers where book_id = ${bookId}
          and sequence <= ${report.sequence}::bigint and posting_date > ${report.endsOn}::date)::text
          as "excludedVoucherCount"
    `,
    "objects",
  );
}

export function readCaptureRows(
  transaction: Transaction,
  bookId: string,
  report: ReportRow,
  openingEvidenceIds: ReadonlyArray<string>,
  providerRows: CaptureProviderRows,
) {
  return transaction.execute<CaptureRows>(
    sql`
      select
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'section', 'balances', 'accountId', r.account_id, 'code', r.body->>'code',
            'name', r.body->>'name', 'recordedOpeningMinor', r.body->>'openingMinor',
            'movementDebitMinor', r.body->>'debitMinor', 'movementCreditMinor', r.body->>'creditMinor',
            'recordedClosingMinor', r.body->>'closingMinor') order by r.account_id collate "C")
          from openerp.report_lines r
          where r.book_id = ${bookId} and r.report_id = ${report.id}
        ), '[]'::jsonb) as balances,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'section', 'journal',
            'part', case when v.posting_date < ${report.startsOn}::date then 'opening'
              when v.posting_date <= ${report.endsOn}::date then 'movement' else 'excluded_after_end' end,
            'voucherId', v.id, 'lineId', l.id, 'ordinal', l.ordinal, 'sequence', v.sequence::text,
            'postingDate', v.posting_date::text, 'fiscalYearId', v.fiscal_year_id, 'periodId', v.period_id,
            'series', v.series, 'voucherNumber', v.number::text, 'accountId', l.account_id,
            'accountCode', a.code, 'description', l.description, 'debitMinor', l.debit_minor::text,
            'creditMinor', l.credit_minor::text, 'eventId', v.event_id, 'postingPurpose', v.posting_purpose,
            'correctsVoucherId', v.corrects_voucher_id, 'changeSetId', v.change_set_id,
            'planDigest', r.body->>'planDigest', 'receiptId', r.id, 'approvalId', r.approval_id,
            'approvedBy', ap.actor_id, 'committedAt', r.body->>'committedAt',
            'evidenceRefs', coalesce(v.action->'evidenceRefs', '[]'::jsonb))
            order by v.sequence, l.ordinal)
          from openerp.vouchers v
          join openerp.journal_lines l on l.book_id = v.book_id and l.voucher_id = v.id
          join openerp.accounts a on a.book_id = l.book_id and a.id = l.account_id
          join openerp.execution_receipts r on r.book_id = v.book_id and r.voucher_id = v.id
          join openerp.approvals ap on ap.book_id = r.book_id and ap.id = r.approval_id
          where v.book_id = ${bookId} and v.sequence <= ${report.sequence}::bigint
        ), '[]'::jsonb) as journal,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'section', 'evidence', 'id', e.id, 'title', e.title, 'origin', e.origin,
            'mediaType', e.media_type, 'sha256', e.sha256, 'content', e.content,
            'createdAt', to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'usedForOpeningExplanation', ${JSON.stringify(openingEvidenceIds)}::jsonb ? e.id,
            'includedVoucherIds', uses.included, 'excludedVoucherIds', uses.excluded,
            'disposition', case when jsonb_array_length(uses.included) > 0 then 'included_in_ledger_basis'
              when ${JSON.stringify(openingEvidenceIds)}::jsonb ? e.id then 'opening_explanation_only'
              when jsonb_array_length(uses.excluded) > 0 then 'excluded_later_posting' else 'no_included_posting' end)
            order by e.id collate "C")
          from openerp.evidence e
          cross join lateral (
            select coalesce(jsonb_agg(v.id order by v.sequence)
              filter (where v.posting_date <= ${report.endsOn}::date), '[]'::jsonb) as included,
              coalesce(jsonb_agg(v.id order by v.sequence)
              filter (where v.posting_date > ${report.endsOn}::date), '[]'::jsonb) as excluded
            from openerp.vouchers v
            where v.book_id = ${bookId} and v.sequence <= ${report.sequence}::bigint
              and exists (
                select 1 from jsonb_array_elements(coalesce(v.action->'evidenceRefs', '[]'::jsonb)) ref
                where ref->>'evidenceId' = e.id
              )
          ) uses
          where e.book_id = ${bookId}
        ), '[]'::jsonb) as evidence,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'section', 'owner_sources', 'source', r.body, 'revision', v.body, 'review', w.body,
            'disposition', case when r.occurred_on <= ${report.endsOn}::date then 'through_period_end'
              else 'excluded_after_end' end) order by r.id collate "C")
          from openerp.owner_records r
          join openerp.owner_revisions v on v.book_id = r.book_id and v.record_id = r.id
            and v.revision = r.current_revision
          left join openerp.owner_reviews w on w.book_id = r.book_id and w.record_id = r.id
            and w.revision = r.current_revision
          where r.book_id = ${bookId}
        ), '[]'::jsonb) as owner_sources,
        ${JSON.stringify(providerRows.ownerControls)}::jsonb as owner_controls,
        ${JSON.stringify(providerRows.expenseTax)}::jsonb as expense_tax
    `,
    "objects",
  );
}

export function readBasis(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
  dependencies: BasisDependencies,
) {
  return transaction.execute<BasisRow>(
    sql`
      select jsonb_build_object(
        'sequence', b.committed_sequence::text, 'profile', b.profile,
        'profileVersion', b.profile_version::text, 'writerAuthority', b.authority,
        'writerEpoch', b.writer_epoch::text, 'currency', b.currency, 'currencyScale', b.currency_scale,
        'configurationDigest', openerp.digest(jsonb_build_object(
          'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.id collate "C")
            from openerp.accounts a where a.book_id = ${bookId}), '[]'::jsonb),
          'years', coalesce((select jsonb_agg(to_jsonb(y) order by y.id collate "C")
            from openerp.fiscal_years y where y.book_id = ${bookId}), '[]'::jsonb),
          'periods', coalesce((select jsonb_agg(to_jsonb(p) order by p.id collate "C")
            from openerp.periods p where p.book_id = ${bookId}), '[]'::jsonb))),
        'evidenceInventoryDigest', openerp.digest(coalesce((select jsonb_agg(
          jsonb_build_object('id', e.id, 'sha256', e.sha256) order by e.id collate "C")
          from openerp.evidence e where e.book_id = ${bookId}), '[]'::jsonb)),
        'closingStateDigest', openerp.digest(coalesce((select jsonb_agg(
          jsonb_build_object('id', t.id, 'periodId', t.period_id, 'version', t.period_version::text,
            'action', t.body->>'action') order by t.period_id collate "C", t.period_version)
          from openerp.closing_transitions t
          join openerp.periods p on p.book_id = t.book_id and p.id = t.period_id
          where t.book_id = ${bookId} and p.starts_on <= ${endsOn}::date), '[]'::jsonb)),
        'declaredBankInventories', coalesce((select jsonb_agg(jsonb_build_object(
          'periodId', p.id, 'inventoryId', i.body->>'id', 'evidenceId', i.body->>'evidenceId',
          'expectedAccountIds', i.body->'bankAccountIds') order by p.id collate "C")
          from openerp.periods p
          left join lateral (
            select ci.body from openerp.closing_inventories ci
            where ci.book_id = ${bookId} and ci.period_id = p.id order by ci.ordinal desc limit 1
          ) i on true
          where p.book_id = ${bookId} and p.starts_on <= ${endsOn}::date and p.ends_on >= ${startsOn}::date), '[]'::jsonb),
        'owners', ${JSON.stringify(dependencies.owners)}::jsonb,
        'expenseTax', ${JSON.stringify(dependencies.expenseTax)}::jsonb,
        'vatReturns', ${JSON.stringify(dependencies.vatReturns)}::jsonb,
        'subledgerControls', ${JSON.stringify(dependencies.subledgerControls)}::jsonb,
        'ownerInventoryDigest', openerp.digest(jsonb_build_object(
          'owners', coalesce((select jsonb_agg(p.body order by p.id collate "C")
            from openerp.owner_parties p where p.book_id = ${bookId}), '[]'::jsonb),
          'sources', coalesce((select jsonb_agg(jsonb_build_object('source', r.body, 'revision', v.body,
            'review', w.body) order by r.id collate "C")
            from openerp.owner_records r
            join openerp.owner_revisions v on v.book_id = r.book_id and v.record_id = r.id
              and v.revision = r.current_revision
            left join openerp.owner_reviews w on w.book_id = r.book_id and w.record_id = r.id
              and w.revision = r.current_revision
            where r.book_id = ${bookId}), '[]'::jsonb))),
        'bank', ${JSON.stringify(dependencies.bank)}::jsonb,
        'commerce', ${JSON.stringify(dependencies.commerce)}::jsonb,
        'schedules', ${JSON.stringify(dependencies.schedules)}::jsonb
      ) as basis
      from openerp.books b where b.id = ${bookId}
    `,
    "objects",
  );
}

export function readNextPackOrdinal(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly ordinal: string }>(
    sql`
      select (coalesce(max(ordinal), 0) + 1)::text as ordinal
      from openerp.accountant_review_packs
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function insertPack(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ordinal: string;
    readonly reportId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.accountant_review_packs (book_id, id, ordinal, report_id, body)
      values (${row.bookId}, ${row.id}, ${row.ordinal}::bigint, ${row.reportId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertRows(
  transaction: Transaction,
  bookId: string,
  packId: string,
  rows: ReadonlyArray<JsonObject>,
) {
  if (rows.length === 0) return transaction.execute(sql`select 1`, "objects");

  return transaction.execute(
    sql`
      insert into openerp.accountant_review_rows (book_id, pack_id, section, ordinal, body)
      select ${bookId}, ${packId}, row->>'section', (row->>'ordinal')::bigint, row->'body'
      from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) row
    `,
    "objects",
  );
}

export function insertArtifacts(
  transaction: Transaction,
  bookId: string,
  packId: string,
  artifacts: ReadonlyArray<JsonObject>,
) {
  return transaction.execute(
    sql`
      insert into openerp.accountant_review_artifacts (book_id, pack_id, format, descriptor, content)
      select ${bookId}, ${packId}, row->>'format', row->'descriptor', row->>'content'
      from jsonb_array_elements(${JSON.stringify(artifacts)}::jsonb) row
    `,
    "objects",
  );
}
