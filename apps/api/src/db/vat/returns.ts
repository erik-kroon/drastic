import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { readTableAccess, type JsonObject } from "../commerce/access";
import type { Transaction } from "../transaction";

export type { JsonObject };

type Json = Schema.Json;

type Lock = "share" | "update";

function textList(values: ReadonlyArray<string>) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

export type TableGrantRow = {
  readonly tableName: string;
  readonly allowed: boolean;
};

export type VatDraftItemRow = {
  readonly item: JsonObject;
};

export type VatDraftCountRow = {
  readonly drafts: number;
};

export type AmendmentCountRow = {
  readonly amendments: number;
};

const draftReadGrants = sql`
  select
    requirement.table_name as "tableName",
    coalesce(
      bool_and(has_table_privilege(current_user, 'openerp.' || requirement.table_name, requirement.privilege)),
      false
    ) as allowed
  from (values
    ('vat_return_drafts', 'select')
  ) as requirement(table_name, privilege)
  group by requirement.table_name
`;

export function readDraftGrants(transaction: Transaction) {
  return transaction.execute<TableGrantRow>(draftReadGrants, "objects");
}

export function countDrafts(transaction: Transaction, bookId: string) {
  return transaction.execute<VatDraftCountRow>(
    sql`select count(*)::integer as drafts from openerp.vat_return_drafts where book_id = ${bookId}`,
    "objects",
  );
}

export function countAmendments(transaction: Transaction, bookId: string) {
  return transaction.execute<AmendmentCountRow>(
    sql`select count(*)::integer as amendments from openerp.vat_draft_amendments where book_id = ${bookId}`,
    "objects",
  );
}

export function listDraftItems(transaction: Transaction, bookId: string) {
  return transaction.execute<VatDraftItemRow>(
    sql`
      select jsonb_build_object(
        'id', draft.id,
        'digest', draft.body->>'digest',
        'input', draft.body->'input',
        'recordedAt', draft.body->>'recordedAt'
      ) as item
      from openerp.vat_return_drafts draft
      where draft.book_id = ${bookId}
      order by draft.ordinal desc
      limit 501
    `,
    "objects",
  );
}

export type FactComponentRow = {
  readonly id: string;
  readonly recordClass: string;
};

export type FactRevisionRow = {
  readonly id: string;
  readonly revision: number;
  readonly body: JsonObject;
};

export type EvidenceDigestRow = {
  readonly id: string;
  readonly sha256: string;
};

export type VoucherRow = {
  readonly evidenceRefs: Json;
};

export type LineIdRow = { readonly id: string };

export type WithdrawnRow = { readonly body: JsonObject | null };

export type LineageRow = {
  readonly drafts: JsonObject;
  readonly amendments: JsonObject;
  readonly rejected: boolean;
};

export type SizeRow = { readonly bytes: number };

export const factReadTables = [
  "vat_fact_components",
  "vat_fact_revisions",
  "vat_return_drafts",
  "vat_draft_amendments",
  "vat_fact_withdrawals",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "expense_tax_source_withdrawals",
  "vouchers",
  "journal_lines",
  "evidence",
  "books",
  "command_receipts",
] as const;

export const reclassificationTables = [
  "vat_control_profiles",
  "vat_control_account_roles",
  "vat_reporting_obligations",
  "vat_control_reclassification_reviews",
  "vat_control_reclassification_approvals",
  "vat_control_reclassification_effects",
  "vat_control_reclassification_contributions",
  "vat_fact_components",
  "vat_fact_revisions",
  "vat_fact_withdrawals",
  "vat_return_drafts",
  "vat_draft_amendments",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "expense_tax_source_withdrawals",
  "accounts",
  "periods",
  "fiscal_years",
  "vouchers",
  "journal_lines",
  "change_sets",
  "approvals",
  "events",
  "evidence",
  "books",
  "command_receipts",
  "bank_sources",
  "commerce_control_accounts",
  "owner_control_accounts",
  "tax_account_sources",
  "subledger_schedules",
  "subledger_schedule_revisions",
  "tax_account_match_capacity",
  "subledger_basis_lines",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "owner_effects",
  "commerce_invoices",
  "commerce_active_allocation_legs",
] as const;

export function readFactAccess(transaction: Transaction) {
  return readTableAccess(transaction, factReadTables);
}

export function readReclassificationAccess(transaction: Transaction) {
  return readTableAccess(transaction, reclassificationTables);
}

export function readFactComponent(transaction: Transaction, bookId: string, sourceKey: string) {
  return transaction.execute<FactComponentRow>(
    sql`
      select id, record_class as "recordClass"
      from openerp.vat_fact_components
      where book_id = ${bookId} and source_key = ${sourceKey}
      for share
    `,
    "objects",
  );
}

export function insertFactComponent(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly sourceKey: string;
    readonly recordClass: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_fact_components (book_id, id, source_key, record_class)
      values (${row.bookId}, ${row.id}, ${row.sourceKey}, ${row.recordClass})
    `,
    "objects",
  );
}

export function readCurrentFactRevision(
  transaction: Transaction,
  bookId: string,
  factId: string,
  lock: Lock = "share",
) {
  return transaction.execute<FactRevisionRow>(
    sql`
      select id, revision, body
      from openerp.vat_fact_revisions
      where book_id = ${bookId} and fact_id = ${factId}
      order by revision desc
      limit 1
      ${lock === "update" ? sql`for update` : sql`for share`}
    `,
    "objects",
  );
}

export function readFactHistory(transaction: Transaction, bookId: string, factId: string) {
  return transaction.execute<FactRevisionRow>(
    sql`
      select id, revision, body
      from openerp.vat_fact_revisions
      where book_id = ${bookId} and fact_id = ${factId}
      order by revision
    `,
    "objects",
  );
}

export function insertFactRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly factId: string;
    readonly revision: number;
    readonly id: string;
    readonly evidenceId: string;
    readonly reviewEvidenceId: string;
    readonly voucherId: string | null;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_fact_revisions
        (book_id, fact_id, revision, id, evidence_id, review_evidence_id, voucher_id, body)
      values (${row.bookId}, ${row.factId}, ${row.revision}, ${row.id}, ${row.evidenceId},
        ${row.reviewEvidenceId}, ${row.voucherId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readEvidenceDigests(
  transaction: Transaction,
  bookId: string,
  evidenceIds: ReadonlyArray<string>,
) {
  if (evidenceIds.length === 0) return Effect.succeed<ReadonlyArray<EvidenceDigestRow>>([]);

  return transaction.execute<EvidenceDigestRow>(
    sql`
      select id, sha256 from openerp.evidence
      where book_id = ${bookId} and id = any(${textList(evidenceIds)})
    `,
    "objects",
  );
}

// Posted vouchers are immutable, so their content is read from the ordinary statement
// snapshot. A row lock would require an UPDATE grant the runtime deliberately lacks.
export function readVoucherEvidenceRefs(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction.execute<VoucherRow>(
    sql`
      select body->'evidenceRefs' as "evidenceRefs" from openerp.vouchers
      where book_id = ${bookId} and id = ${voucherId}
    `,
    "objects",
  );
}

export function readVoucherLineIds(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineIds: ReadonlyArray<string>,
) {
  if (lineIds.length === 0) return Effect.succeed<ReadonlyArray<LineIdRow>>([]);

  return transaction.execute<LineIdRow>(
    sql`
      select id from openerp.journal_lines
      where book_id = ${bookId} and voucher_id = ${voucherId} and id = any(${textList(lineIds)})
    `,
    "objects",
  );
}

export type ExpenseRow = {
  readonly sourceDigest: string | null;
  readonly reviewDigest: string | null;
  readonly found: boolean;
  readonly digestsCurrent: boolean;
  readonly compatible: boolean;
};

export function readExpenseLink(
  transaction: Transaction,
  bookId: string,
  sourceId: string,
  link: JsonObject,
  input: JsonObject,
) {
  return transaction.execute<ExpenseRow>(
    sql`
      with source as (
        select body from openerp.expense_tax_source_revisions
        where book_id = ${bookId} and source_id = ${sourceId}
        order by revision desc limit 1
      ), review as (
        select body from openerp.expense_tax_reviews
        where book_id = ${bookId} and source_id = ${sourceId}
        order by revision desc limit 1
      )
      select
        (select body->>'digest' from source) as "sourceDigest",
        (select body->>'digest' from review) as "reviewDigest",
        (select body from source) is not null as found,
        (
          ${link.sourceDigest}::text is distinct from (select body->>'digest' from source)
          or ${link.reviewDigest}::text is distinct from (select body->>'digest' from review)
          or (select body->>'sourceDigest' from review)
            is distinct from (select body->>'digest' from source)
        ) is not true as "digestsCurrent",
        (
          (select body->'facts'->>'recordClass' from source)
            is distinct from ${JSON.stringify(input)}::jsonb->>'recordClass'
          or (select body->'facts'->>'evidenceId' from source)
            is distinct from ${JSON.stringify(input)}::jsonb->>'evidenceId'
          or (select body->'facts'->>'voucherId' from source)
            is distinct from ${JSON.stringify(input)}::jsonb->>'voucherId'
          or (select body->'facts'->>'currency' from source)
            is distinct from ${JSON.stringify(input)}::jsonb->>'currency'
          or (select body->'facts'->'currencyScale' from source) is distinct from '2'::jsonb
          or (select body->'facts'->>'sourceLocator' from source)
            is distinct from ${JSON.stringify(input)}::jsonb->>'sourceLocator'
          or (select body->'facts'->>'issuedOn' from source)
            is distinct from ${JSON.stringify(input)}::jsonb->>'issuedOn'
          or (select body->'facts'->>'receivedOn' from source)
            is distinct from ${JSON.stringify(input)}::jsonb->>'receivedOn'
          or (select body->'facts'->>'suppliedOn' from review)
            is distinct from ${JSON.stringify(input)}::jsonb->>'suppliedOn'
          or (
            ${JSON.stringify(input)}::jsonb->>'domesticEligibility' = 'confirmed'
            and (
              (select body->'facts'->>'supplierJurisdiction' from source) is distinct from 'SE'
              or (select body->'facts'->>'supplyJurisdiction' from source) is distinct from 'SE'
              or (select body->'facts'->>'bookJurisdiction' from review) is distinct from 'SE'
            )
          )
          or (
            ${JSON.stringify(input)}::jsonb->>'fullDeduction' = 'confirmed'
            and (
              (select body->'facts'->'deductionDenominator' from review) is null
              or (select body->'facts'->>'deductionNumerator' from review)
                is distinct from (select body->'facts'->'deductionDenominator' from review)
            )
          )
          or (select body->'facts'->'amounts' from source) is distinct from jsonb_build_object(
            'netMinor', ${JSON.stringify(input)}::jsonb->'netMinor', 'vatMinor', ${JSON.stringify(input)}::jsonb->'vatMinor',
            'grossMinor', ${JSON.stringify(input)}::jsonb->'grossMinor')
          or (select body->'facts'->'amounts' from review)
            is distinct from (select body->'facts'->'amounts' from source)
          or (select body->'facts'->>'treatment' from review) is distinct from 'domestic_purchase'
          or (select body->'facts'->>'registration' from review)
            is distinct from ${JSON.stringify(input)}::jsonb->>'registration'
          or (select body->'facts'->>'method' from review) is distinct from ${JSON.stringify(input)}::jsonb->>'method'
          or (select body->'facts'->>'taxPointOn' from review)
            is distinct from ${JSON.stringify(input)}::jsonb->>'taxPointOn'
        ) is not true as compatible
    `,
    "objects",
  );
}

export type WithdrawalWrite = {
  readonly bookId: string;
  readonly factId: string;
  readonly revision: number;
  readonly id: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export function readFactWithdrawal(transaction: Transaction, bookId: string, factId: string) {
  return transaction.execute<WithdrawnRow>(
    sql`
      select body from openerp.vat_fact_withdrawals
      where book_id = ${bookId} and fact_id = ${factId}
    `,
    "objects",
  );
}

export function insertFactWithdrawal(transaction: Transaction, row: WithdrawalWrite) {
  return transaction.execute(
    sql`
      insert into openerp.vat_fact_withdrawals (book_id, fact_id, revision, id, evidence_id, body)
      values (${row.bookId}, ${row.factId}, ${row.revision}, ${row.id}, ${row.evidenceId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

const lineageAssessment = (value: string) => sql`
  jsonb_build_object('factId', ${sql.raw(value)}->'factId',
    'sourceDigest', ${sql.raw(value)}->'sourceDigest',
    'state', ${sql.raw(value)}->'state', 'blockers', ${sql.raw(value)}->'blockers',
    'sourceDifferenceMinor', ${sql.raw(value)}->'sourceDifferenceMinor',
    'rateDifferenceNumerator', ${sql.raw(value)}->'rateDifferenceNumerator',
    'ledgerTaxMinor', ${sql.raw(value)}->'ledgerTaxMinor',
    'ledgerDifferenceMinor', ${sql.raw(value)}->'ledgerDifferenceMinor',
    'contribution', case when ${sql.raw(value)}->'contribution' = 'null'::jsonb then null
      else jsonb_build_object(
        'box05Minor', ${sql.raw(value)}->'contribution'->'box05Minor',
        'box10Minor', ${sql.raw(value)}->'contribution'->'box10Minor',
        'box48Minor', ${sql.raw(value)}->'contribution'->'box48Minor') end)
`;

export function readFactLineage(transaction: Transaction, bookId: string, factId: string) {
  return transaction.execute<LineageRow>(
    sql`
      with matched_drafts as (
        select d.id, d.ordinal, d.body,
          d.body->'calculation'->'assessments'->((f.ordinality - 1)::integer) as assessment,
          f.body as fact
        from openerp.vat_return_drafts d
        cross join lateral jsonb_array_elements(d.body->'basis'->'facts')
          with ordinality f(body, ordinality)
        where d.book_id = ${bookId} and f.body->'fact'->>'factId' = ${factId}
      ), matched_amendments as (
        select a.id, a.ordinal, a.original_draft_id, a.replacement_draft_id, a.body, f.body as fact
        from openerp.vat_draft_amendments a
        cross join lateral jsonb_array_elements(a.body->'impact'->'facts') f(body)
        where a.book_id = ${bookId} and f.body->>'factId' = ${factId}
      ), flagged_drafts as (
        select matched.*, count(*) over (partition by matched.id) as occurrences
        from matched_drafts matched
      ), flagged_amendments as (
        select matched.*, count(*) over (partition by matched.id) as occurrences
        from matched_amendments matched
      )
      select
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'draftId', matched.id, 'draftDigest', matched.body->>'digest',
            'engine', matched.body->'calculation'->'engine',
            'startsOn', matched.body->'input'->>'startsOn',
            'endsOn', matched.body->'input'->>'endsOn',
            'recordedAt', matched.body->>'recordedAt',
            'revisionId', matched.fact->'id', 'revision', matched.fact->'revision',
            'sourceDigest', matched.fact->'digest',
            'assessment', ${lineageAssessment("matched.assessment")})
            order by matched.ordinal desc)
          from matched_drafts matched
        ), '[]'::jsonb) as drafts,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'amendmentId', matched.id, 'amendmentDigest', matched.body->>'digest',
            'recordedAt', matched.body->>'recordedAt',
            'originalDraftId', matched.original_draft_id,
            'originalDraftDigest', matched.body->'impact'->'original'->'digest',
            'replacementDraftId', matched.replacement_draft_id,
            'replacementDraftDigest', matched.body->'impact'->'replacement'->'digest',
            'impactDigest', matched.body->'impact'->'digest',
            'factImpact', jsonb_build_object('factId', matched.fact->'factId',
              'original', case when matched.fact->'original' = 'null'::jsonb then null
                else jsonb_build_object('revisionId', matched.fact->'original'->'revisionId',
                  'revision', matched.fact->'original'->'revision',
                  'assessment', ${lineageAssessment("matched.fact->'original'->'assessment'")})
                end,
              'replacement', case when matched.fact->'replacement' = 'null'::jsonb then null
                else jsonb_build_object('revisionId', matched.fact->'replacement'->'revisionId',
                  'revision', matched.fact->'replacement'->'revision',
                  'assessment', ${lineageAssessment("matched.fact->'replacement'->'assessment'")})
                end,
              'sourceChanged', matched.fact->'sourceChanged',
              'assessmentChanged', matched.fact->'assessmentChanged',
              'contributionDelta', jsonb_build_object(
                'box05Minor', matched.fact->'contributionDelta'->'box05Minor',
                'box10Minor', matched.fact->'contributionDelta'->'box10Minor',
                'box48Minor', matched.fact->'contributionDelta'->'box48Minor')))
            order by matched.ordinal desc)
          from matched_amendments matched
        ), '[]'::jsonb) as amendments,
        coalesce((
          select bool_or(
            matched.occurrences <> 1
            or matched.assessment is null
            or matched.assessment->>'factId' is distinct from ${factId}
            or matched.assessment->>'sourceDigest' is distinct from matched.fact->>'digest'
            or coalesce(matched.body->'calculation'->>'engine', '')
              not in ('vat-return-draft-v1', 'vat-return-draft-v2', 'vat-return-draft-v3'))
          from flagged_drafts matched
        ), false)
        or coalesce((
          select bool_or(
            matched.occurrences <> 1
            or matched.body->'impact'->>'version' is distinct from 'vat-draft-impact-v1')
          from flagged_amendments matched
        ), false) as rejected
    `,
    "objects",
  );
}

export function readCanonicalSize(transaction: Transaction, value: JsonObject) {
  return transaction.execute<SizeRow>(
    sql`
      select octet_length(convert_to(openerp.canonical(${JSON.stringify(value)}::jsonb), 'UTF8')) as bytes
    `,
    "objects",
  );
}

export type RetainedDraftRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly body: JsonObject;
};

export function readRetainedDraft(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<RetainedDraftRow>(
    sql`
      select id, ordinal, body from openerp.vat_return_drafts
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export type AmendmentItemRow = { readonly item: JsonObject };

export type AmendmentRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly originalDraftId: string;
  readonly replacementDraftId: string;
  readonly reviewEvidenceId: string;
  readonly body: JsonObject;
};

export function listAmendmentItems(transaction: Transaction, bookId: string) {
  return transaction.execute<AmendmentItemRow>(
    sql`
      select jsonb_build_object(
        'id', a.id,
        'digest', a.body->>'digest',
        'originalDraftId', a.original_draft_id,
        'replacementDraftId', a.replacement_draft_id,
        'recordedAt', a.body->>'recordedAt'
      ) as item
      from openerp.vat_draft_amendments a
      where a.book_id = ${bookId}
      order by a.ordinal desc
      limit 501
    `,
    "objects",
  );
}

export function readAmendment(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<AmendmentRow>(
    sql`
      select id, ordinal, original_draft_id as "originalDraftId",
        replacement_draft_id as "replacementDraftId",
        review_evidence_id as "reviewEvidenceId", body
      from openerp.vat_draft_amendments
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readAmendmentPair(
  transaction: Transaction,
  bookId: string,
  originalDraftId: string,
  replacementDraftId: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.vat_draft_amendments
      where book_id = ${bookId} and original_draft_id = ${originalDraftId}
        and replacement_draft_id = ${replacementDraftId}
    `,
    "objects",
  );
}

export function readNextAmendmentOrdinal(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly ordinal: number }>(
    sql`
      select (count(*)::integer + 1) as ordinal from openerp.vat_draft_amendments
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function insertAmendment(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ordinal: number;
    readonly originalDraftId: string;
    readonly replacementDraftId: string;
    readonly reviewEvidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_draft_amendments
        (book_id, id, ordinal, original_draft_id, replacement_draft_id, review_evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.ordinal}, ${row.originalDraftId},
        ${row.replacementDraftId}, ${row.reviewEvidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export type ControlBookRow = {
  readonly id: string;
  readonly profile: string;
  readonly profileVersion: string;
  readonly writerEpoch: string;
  readonly authority: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly committedSequence: string;
};

export function readControlBook(transaction: Transaction, bookId: string) {
  return transaction.execute<ControlBookRow>(
    sql`
      select id, profile, profile_version::text as "profileVersion",
        writer_epoch::text as "writerEpoch", authority, currency,
        currency_scale as "currencyScale", committed_sequence::text as "committedSequence"
      from openerp.books
      where id = ${bookId}
    `,
    "objects",
  );
}

export type CountRow = { readonly total: number };

export function countRows(transaction: Transaction, table: string, bookId: string) {
  if (
    ![
      "vat_control_profiles",
      "vat_reporting_obligations",
      "vat_control_reclassification_reviews",
      "vat_control_reclassification_approvals",
      "vat_control_reclassification_contributions",
      "vat_draft_amendments",
    ].includes(table)
  ) {
    return Effect.succeed<ReadonlyArray<CountRow>>([]);
  }

  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.${sql.identifier(table)} where book_id = ${bookId}`,
    "objects",
  );
}

export type IdentityRow = { readonly id: string; readonly body: JsonObject };

export function readControlProfile(transaction: Transaction, bookId: string, identityKey: string) {
  return transaction.execute<IdentityRow>(
    sql`
      select id, body from openerp.vat_control_profiles
      where book_id = ${bookId} and identity_key = ${identityKey}
    `,
    "objects",
  );
}

export function insertControlProfile(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly identityKey: string;
    readonly roleEvidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_control_profiles (book_id, id, identity_key, role_evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.identityKey}, ${row.roleEvidenceId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export type AccountRoleRow = {
  readonly role: string;
  readonly accountId: string;
  readonly accountVersion: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
};

export function readControlAccountRoles(
  transaction: Transaction,
  bookId: string,
  profileId: string,
) {
  return transaction.execute<AccountRoleRow>(
    sql`
      select role, account_id as "accountId", account_version::text as "accountVersion",
        code, name, active
      from openerp.vat_control_account_roles
      where book_id = ${bookId} and profile_id = ${profileId}
      order by case role
        when 'output_vat_control' then 1 when 'input_vat_control' then 2 else 3 end
    `,
    "objects",
  );
}

export function insertControlAccountRoles(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly profileId: string;
    readonly role: string;
    readonly accountId: string;
    readonly accountVersion: string;
    readonly code: string;
    readonly name: string;
    readonly active: boolean;
  }>,
) {
  if (rows.length === 0) return Effect.succeed([]);

  return transaction.execute(
    sql`
      insert into openerp.vat_control_account_roles
        (book_id, profile_id, role, account_id, account_version, code, name, active)
      values ${sql.join(
        rows.map(
          (row) =>
            sql`(${row.bookId}, ${row.profileId}, ${row.role}, ${row.accountId}, ${row.accountVersion},
            ${row.code}, ${row.name}, ${row.active})`,
        ),
        sql`, `,
      )}
    `,
    "objects",
  );
}

export type ObligationRow = {
  readonly id: string;
  readonly periodEvidenceSha256: string | null;
  readonly body: JsonObject;
};

export function readReportingObligation(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<ObligationRow>(
    sql`
      select id, period_evidence_sha256 as "periodEvidenceSha256", body
      from openerp.vat_reporting_obligations
      where book_id = ${bookId} and registration_namespace = 'synthetic'
        and registration_id = 'synthetic_registration' and jurisdiction = 'SE'
        and scheme = 'synthetic_output_input_v1'
        and starts_on = ${startsOn} and ends_on = ${endsOn}
    `,
    "objects",
  );
}

export function insertReportingObligation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly periodEvidenceId: string | null;
    readonly periodEvidenceSha256: string | null;
    readonly body: JsonObject;
    readonly digest: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_reporting_obligations
        (book_id, id, registration_namespace, registration_id, jurisdiction, scheme, starts_on, ends_on,
          period_evidence_id, period_evidence_sha256, body, digest)
      values (${row.bookId}, ${row.id}, 'synthetic', 'synthetic_registration', 'SE',
        'synthetic_output_input_v1', ${row.startsOn}, ${row.endsOn}, ${row.periodEvidenceId},
        ${row.periodEvidenceSha256}, ${JSON.stringify(row.body)}::jsonb, ${row.digest})
    `,
    "objects",
  );
}

export type ReviewRow = {
  readonly id: string;
  readonly obligationId: string;
  readonly profileId: string;
  readonly draftId: string;
  readonly actorId: string;
  readonly ordinal: number;
  readonly changeSetId: string | null;
  readonly body: JsonObject;
};

export function readReview(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select id, obligation_id as "obligationId", profile_id as "profileId",
        draft_id as "draftId", actor_id as "actorId", ordinal,
        change_set_id as "changeSetId", body
      from openerp.vat_control_reclassification_reviews
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function countReviewsForObligation(
  transaction: Transaction,
  bookId: string,
  obligationId: string,
) {
  return transaction.execute<{ readonly ordinal: number }>(
    sql`
      select (count(*)::integer + 1) as ordinal
      from openerp.vat_control_reclassification_reviews
      where book_id = ${bookId} and obligation_id = ${obligationId}
    `,
    "objects",
  );
}

export function insertReview(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly obligationId: string;
    readonly profileId: string;
    readonly draftId: string;
    readonly actorId: string;
    readonly ordinal: number;
    readonly changeSetId: string | null;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_control_reclassification_reviews
        (book_id, id, obligation_id, profile_id, draft_id, actor_id, ordinal, change_set_id, body)
      values (${row.bookId}, ${row.id}, ${row.obligationId}, ${row.profileId}, ${row.draftId},
        ${row.actorId}, ${row.ordinal}, ${row.changeSetId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export type ApprovalWrite = {
  readonly id: string;
  readonly reviewId: string;
  readonly actorId: string;
  readonly reviewDigest: string;
  readonly kernelApprovalId: string | null;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export type DomainApprovalRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly actorId: string;
  readonly reviewDigest: string;
  readonly kernelApprovalId: string | null;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export function readApprovals(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<DomainApprovalRow>(
    sql`
      select id, review_id as "reviewId", actor_id as "actorId",
        review_digest as "reviewDigest", kernel_approval_id as "kernelApprovalId",
        expires_at as "expiresAt", body
      from openerp.vat_control_reclassification_approvals
      where book_id = ${bookId} and review_id = ${reviewId}
      order by body->>'createdAt', id collate "C"
    `,
    "objects",
  );
}

export function readApproval(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<DomainApprovalRow>(
    sql`
      select id, review_id as "reviewId", actor_id as "actorId",
        review_digest as "reviewDigest", kernel_approval_id as "kernelApprovalId",
        expires_at as "expiresAt", body
      from openerp.vat_control_reclassification_approvals
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function countApprovalsForReview(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total from openerp.vat_control_reclassification_approvals
      where book_id = ${bookId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export function insertDomainApproval(transaction: Transaction, bookId: string, row: ApprovalWrite) {
  return transaction.execute(
    sql`
      insert into openerp.vat_control_reclassification_approvals
        (book_id, id, review_id, actor_id, review_digest, kernel_approval_id, expires_at, body)
      values (${bookId}, ${row.id}, ${row.reviewId}, ${row.actorId}, ${row.reviewDigest},
        ${row.kernelApprovalId}, ${row.expiresAt}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export type EffectRow = {
  readonly id: string;
  readonly reviewId: string;
  readonly outcome: string;
  readonly body: JsonObject;
};

export function readEffectByObligation(
  transaction: Transaction,
  bookId: string,
  obligationId: string,
) {
  return transaction.execute<EffectRow>(
    sql`
      select id, review_id as "reviewId", outcome, body
      from openerp.vat_control_reclassification_effects
      where book_id = ${bookId} and obligation_id = ${obligationId}
    `,
    "objects",
  );
}

export function readEffectByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<EffectRow>(
    sql`
      select id, review_id as "reviewId", outcome, body
      from openerp.vat_control_reclassification_effects
      where book_id = ${bookId} and review_id = ${reviewId}
    `,
    "objects",
  );
}

export type EffectWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly obligationId: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly draftId: string;
  readonly outcome: string;
  readonly changeSetId: string | null;
  readonly voucherId: string | null;
  readonly postingReceiptId: string | null;
  readonly postingDate: string;
  readonly body: JsonObject;
};

export function insertEffect(transaction: Transaction, row: EffectWrite) {
  return transaction.execute(
    sql`
      insert into openerp.vat_control_reclassification_effects
        (book_id, id, obligation_id, review_id, approval_id, draft_id, outcome, change_set_id,
          voucher_id, posting_receipt_id, posting_date, body)
      values (${row.bookId}, ${row.id}, ${row.obligationId}, ${row.reviewId}, ${row.approvalId},
        ${row.draftId}, ${row.outcome}, ${row.changeSetId}, ${row.voucherId}, ${row.postingReceiptId},
        ${row.postingDate}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertContributions(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly id: string;
    readonly effectId: string;
    readonly ordinal: number;
    readonly factId: string;
    readonly factRevisionId: string;
    readonly voucherId: string;
    readonly lineId: string;
    readonly body: JsonObject;
  }>,
) {
  if (rows.length === 0) return Effect.succeed([]);

  return transaction.execute(
    sql`
      insert into openerp.vat_control_reclassification_contributions
        (book_id, id, effect_id, ordinal, fact_id, fact_revision_id, voucher_id, line_id, body)
      values ${sql.join(
        rows.map(
          (row) =>
            sql`(${row.bookId}, ${row.id}, ${row.effectId}, ${row.ordinal}, ${row.factId},
            ${row.factRevisionId}, ${row.voucherId}, ${row.lineId}, ${JSON.stringify(row.body)}::jsonb)`,
        ),
        sql`, `,
      )}
    `,
    "objects",
  );
}

export type ReclassificationItemRow = { readonly item: JsonObject };

export function listReviewItems(transaction: Transaction, bookId: string) {
  return transaction.execute<ReclassificationItemRow>(
    sql`
      select jsonb_build_object(
        'reviewId', r.id,
        'reviewDigest', r.body->>'digest',
        'obligationId', r.obligation_id,
        'draftId', r.draft_id,
        'startsOn', r.body->'basis'->'obligation'->>'startsOn',
        'endsOn', r.body->'basis'->'obligation'->>'endsOn',
        'accountingNetMinor', r.body->'basis'->'amounts'->>'accountingNetMinor',
        'state', case when e.id is not null then e.outcome when a.id is not null then 'approved' else 'prepared' end,
        'reclassificationId', e.id,
        'recordedAt', r.body->>'createdAt'
      ) as item
      from openerp.vat_control_reclassification_reviews r
      left join openerp.vat_control_reclassification_effects e
        on e.book_id = r.book_id and e.review_id = r.id
      left join lateral (
        select approval.id from openerp.vat_control_reclassification_approvals approval
        where approval.book_id = r.book_id and approval.review_id = r.id
        order by approval.body->>'createdAt' desc, approval.id collate "C" desc limit 1
      ) a on true
      where r.book_id = ${bookId}
      order by r.body->>'createdAt' desc, r.id collate "C" desc
      limit 501
    `,
    "objects",
  );
}

export function countReviewItems(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from (select 1 from openerp.vat_control_reclassification_reviews where book_id = ${bookId} limit 501) bounded
    `,
    "objects",
  );
}
