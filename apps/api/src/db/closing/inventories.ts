import { sql, type SQL } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type BoundRow = { readonly total: number };

export type PeriodRow = {
  readonly id: string;
  readonly locked: boolean;
  readonly startsOn: string;
  readonly endsOn: string;
};

export type EvidenceRow = { readonly sha256: string };

export type AccountRow = { readonly id: string };

export type BasisRow = { readonly basis: JsonObject };

export type ClosingBasisDependencies = {
  readonly subledgerControls: JsonObject;
  readonly bank: JsonObject;
  readonly schedules: JsonObject;
  readonly commerce: JsonObject;
  readonly owners: JsonObject;
  readonly expenseTax: JsonObject;
  readonly vatReturns: JsonObject | null;
};

export type ProposalRow = {
  readonly id: string;
  readonly periodId: string;
  readonly body: JsonObject;
};

export type FamilyEvidenceRow = { readonly id: string; readonly sha256: string };

export const closingTables = [
  "books",
  "periods",
  "fiscal_years",
  "accounts",
  "evidence",
  "bank_sources",
  "report_snapshots",
  "closing_invalidations",
  "closing_transitions",
  "closing_inventories",
  "closing_proposals",
  "closing_approvals",
  "command_receipts",
  "owner_records",
  "owner_effects",
  "owner_allocation_legs",
  "expense_tax_sources",
] as const;

export function readClosingAccess(transaction: Transaction, tables: ReadonlyArray<string>) {
  return transaction.execute<TableAccess>(
    sql`
      select
        requested.table_name as "tableName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
      from unnest(${textList(tables)}) as requested(table_name)
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

export function readPeriod(
  transaction: Transaction,
  bookId: string,
  periodId: string,
  lock: "share" | "update" = "share",
) {
  return transaction.execute<PeriodRow>(
    sql`
      select id, locked, starts_on::text as "startsOn", ends_on::text as "endsOn"
      from openerp.periods
      where book_id = ${bookId} and id = ${periodId}
      ${lock === "update" ? sql`for update` : sql`for share`}
    `,
    "objects",
  );
}

export function readEvidence(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<EvidenceRow>(
    sql`
      select sha256 from openerp.evidence
      where book_id = ${bookId} and id = ${evidenceId}
      for share
    `,
    "objects",
  );
}

export function readFamilyEvidence(
  transaction: Transaction,
  bookId: string,
  evidenceIds: string[],
) {
  if (evidenceIds.length === 0) return Effect.succeed<ReadonlyArray<FamilyEvidenceRow>>([]);
  return transaction.execute<FamilyEvidenceRow>(
    sql`
      select id, sha256 from openerp.evidence
      where book_id = ${bookId} and id = any(${textList(evidenceIds)})
    `,
    "objects",
  );
}

export function readExistingAccountIds(
  transaction: Transaction,
  bookId: string,
  accountIds: string[],
) {
  if (accountIds.length === 0) return Effect.succeed<ReadonlyArray<AccountRow>>([]);
  return transaction.execute<AccountRow>(
    sql`
      select id from openerp.accounts
      where book_id = ${bookId} and id = any(${textList(accountIds)})
    `,
    "objects",
  );
}

export function readNextInventoryOrdinal(
  transaction: Transaction,
  bookId: string,
  periodId: string,
) {
  return transaction.execute<{ readonly ordinal: string }>(
    sql`
      select (coalesce(max(ordinal), 0) + 1)::text as ordinal
      from openerp.closing_inventories
      where book_id = ${bookId} and period_id = ${periodId}
    `,
    "objects",
  );
}

export function readSyntheticProfile(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly profile: string; readonly authority: string }>(
    sql`
      select profile, authority from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function insertInventory(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly periodId: string;
    readonly ordinal: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.closing_inventories (book_id, id, period_id, ordinal, body)
      values (${row.bookId}, ${row.id}, ${row.periodId}, ${row.ordinal}::bigint,
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readProposal(
  transaction: Transaction,
  bookId: string,
  proposalId: string,
  lock: "share" | "update" = "share",
) {
  return transaction.execute<ProposalRow>(
    sql`
      select id, period_id as "periodId", body
      from openerp.closing_proposals
      where book_id = ${bookId} and id = ${proposalId}
      ${lock === "update" ? sql`for update` : sql`for share`}
    `,
    "objects",
  );
}

export function insertApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly proposalId: string;
    readonly actorId: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.closing_approvals (book_id, id, proposal_id, actor_id, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.proposalId}, ${row.actorId}, ${row.expiresAt},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function sameJson(transaction: Transaction, left: JsonObject, right: JsonObject) {
  return transaction.execute<{ readonly same: boolean }>(
    sql`
      select openerp.canonical(${JSON.stringify(left)}::jsonb)
          = openerp.canonical(${JSON.stringify(right)}::jsonb) as same
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

export function countOwnerRecords(transaction: Transaction, bookId: string) {
  return countBounded(
    transaction,
    sql`select 1 from openerp.owner_records where book_id = ${bookId}`,
  );
}

export function countOwnerEffects(transaction: Transaction, bookId: string) {
  return countBounded(
    transaction,
    sql`select 1 from openerp.owner_effects where book_id = ${bookId}`,
  );
}

export function countOwnerAllocationLegs(transaction: Transaction, bookId: string) {
  return countBounded(
    transaction,
    sql`select 1 from openerp.owner_allocation_legs where book_id = ${bookId}`,
  );
}

export function countExpenseTaxSources(transaction: Transaction, bookId: string) {
  return countBounded(
    transaction,
    sql`select 1 from openerp.expense_tax_sources where book_id = ${bookId}`,
  );
}

const familyOrder = [
  "bank_sources",
  "invoices",
  "tax",
  "payroll",
  "assets_deferrals",
  "foreign_currency",
  "owner_balances",
  "other_balances",
  "external_schedules",
  "disclosures",
];

const familyProviders = [
  "bank_close_dependencies",
  "commerce_period_status_v1",
  "expense_tax_and_vat_return_dependencies_v2",
  "unavailable",
  "subledger_and_control_dependencies_v1",
  "unavailable",
  "owner_period_status_v1",
  "unavailable",
  "unavailable",
  "unavailable",
];

const familyCatalog = familyOrder.map((family, index) => [
  family,
  familyProviders[index] ?? "unavailable",
]);

function jsonArgument(value: JsonObject) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

// The current closing basis is the application's own composition of the reviewed
// provider projections. Every input below is a granted runtime table or an
// application-owned dependency port; the basis is never recomputed by a second owner.
export function readClosingBasis(
  transaction: Transaction,
  bookId: string,
  periodId: string,
  dependencies: ClosingBasisDependencies,
) {
  return Effect.gen(function* () {
    const period = (yield* readPeriod(transaction, bookId, periodId))[0];
    if (period === undefined) return yield* Effect.succeed<ReadonlyArray<BasisRow>>([]);
    return yield* transaction.execute<BasisRow>(
      sql`
      with book as (
        select entity_id, profile, authority, profile_version::text as profile_version,
          writer_epoch::text as writer_epoch, committed_sequence::text as committed_sequence
        from openerp.books where id = ${bookId}
      ), period as (
        select id, version::text as version, locked, starts_on, ends_on, fiscal_year_id
        from openerp.periods where book_id = ${bookId} and id = ${periodId}
      ), providers as (
        select
          b.entity_id, b.profile, b.authority, b.profile_version, b.writer_epoch, b.committed_sequence,
          p.id as period_id, p.version, p.locked, p.starts_on, p.ends_on, p.fiscal_year_id,
          r.id as report_id,
          ${jsonArgument(dependencies.subledgerControls)} as subledger_controls,
          ${jsonArgument(dependencies.bank)} as bank_state,
          ${jsonArgument(dependencies.schedules)} as schedules,
          ${jsonArgument(dependencies.commerce)} as commerce,
          ${jsonArgument(dependencies.owners)} as owners,
          ${jsonArgument(dependencies.expenseTax)} as expense_tax,
          ${dependencies.vatReturns === null ? sql`null::jsonb` : jsonArgument(dependencies.vatReturns)} as vat_returns
        from period p, book b
        left join lateral (
          select s.id from openerp.report_snapshots s
          where s.book_id = ${bookId} and s.starts_on = p.starts_on and s.ends_on = p.ends_on
            and s.sequence = b.committed_sequence::bigint and s.body->>'balanced' = 'true'
            and not exists (
              select 1 from openerp.closing_invalidations i
              where i.book_id = ${bookId} and i.kind = 'report' and i.artifact_id = s.id)
          order by s.body->>'createdAt' desc, s.id desc limit 1
        ) r on true
      ), state as (
        select prov.*,
          (select i.body from openerp.closing_inventories i
            where i.book_id = ${bookId} and i.period_id = prov.period_id
            order by i.ordinal desc limit 1) as inventory,
          (select max((t.body->>'committedAt')::timestamptz) from openerp.closing_transitions t
            join openerp.periods tp on tp.book_id = t.book_id and tp.id = t.period_id
            where t.book_id = ${bookId} and t.body->>'action' = 'reopen'
              and tp.starts_on <= prov.ends_on) as latest_reopen,
          (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'version', a.version::text)
            order by a.id), '[]'::jsonb) from openerp.accounts a where a.book_id = ${bookId}) as accounts,
          (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version::text,
            'locked', p.locked, 'startsOn', p.starts_on::text, 'endsOn', p.ends_on::text) order by p.id),
            '[]'::jsonb) from openerp.periods p
            where p.book_id = ${bookId} and p.starts_on <= prov.ends_on) as periods
        from providers prov
      ), resolved as (
        select state.*,
          case
            when jsonb_array_length(state.bank_state->'sources') = 0
              and state.inventory->'bankAccountIds' = '[]'::jsonb then true
            else coalesce((state.bank_state->>'allRepresentedReady')::boolean, false)
              and not exists (
                select 1 from jsonb_array_elements(state.bank_state->'sources') s
                where (s->>'reconciliationCreatedAt')::timestamptz <= state.latest_reopen)
          end as banks_ready
        from state
      ), checked as (
        select resolved.*, jsonb_build_array(
          jsonb_build_object('code', 'DeclaredBankInventory', 'passed',
            resolved.inventory is not null
              and not exists (
                select 1 from jsonb_array_elements_text(resolved.inventory->'bankAccountIds')
                  expected(account_id)
                where not exists (
                  select 1 from openerp.bank_sources s
                  where s.book_id = ${bookId} and s.account_id = expected.account_id))
              and not exists (
                select 1 from openerp.bank_sources s where s.book_id = ${bookId}
                  and not (resolved.inventory->'bankAccountIds' ? s.account_id)),
            'detail', 'An operator must explicitly declare expected synthetic bank accounts with evidence. Every expected account needs a retained source, and every observed source must be declared.'),
          jsonb_build_object('code', 'SyntheticNativeProfile', 'passed',
            resolved.profile = 'synthetic-core-v1' and resolved.authority = 'native',
            'detail', 'Only the native synthetic profile supports this technical lock.'),
          jsonb_build_object('code', 'PeriodBoundaries', 'passed',
            exists (select 1 from openerp.fiscal_years y where y.book_id = ${bookId}
              and y.id = resolved.fiscal_year_id and resolved.starts_on >= y.starts_on
              and resolved.ends_on <= y.ends_on)
              and not exists (
                select 1 from openerp.periods p where p.book_id = ${bookId} and p.id <> resolved.period_id
                  and p.starts_on <= resolved.ends_on and p.ends_on >= resolved.starts_on),
            'detail', 'The period must fit its fiscal year and must not overlap another posting period.'),
          jsonb_build_object('code', 'CurrentTrialBalance', 'passed', resolved.report_id is not null,
            'detail', 'A current balanced internal trial balance must cover this exact period. It is not an annual report.'),
          jsonb_build_object('code', 'RepresentedBankSources', 'passed', resolved.banks_ready,
            'detail', 'Every represented bank source needs a fresh complete reconciliation for this exact period; missing sources are not inferred absent.'),
          jsonb_build_object('code', 'RegisteredCommerce', 'passed',
            coalesce((resolved.commerce->>'invalidRecognitionCount')::bigint = 0
              and (resolved.commerce->>'invalidAllocationCount')::bigint = 0
              and (resolved.commerce->>'conservationFailureCount')::bigint = 0, false),
            'detail', 'Registered invoices and allocations must remain valid and conserve exact amounts. Unpaid invoices are allowed; company invoice completeness is not established.'),
          jsonb_build_object('code', 'OwnerSourceReview', 'passed',
            coalesce((resolved.owners->>'unresolvedReviewCount')::bigint = 0
              and (resolved.owners->>'unlinkedRecordCount')::bigint = 0, false),
            'detail', 'Owner sources through period end need resolved reviews and posted-reference coverage. Unpaid linked claims are allowed; this does not certify opening balances or completeness.'),
          jsonb_build_object('code', 'ExpenseReviewCurrentness', 'passed',
            coalesce((resolved.expense_tax->>'missingOrStaleReviewCount')::bigint = 0, false),
            'detail', 'Every represented expense source needs a review of its current source digest. Current review is not supported tax treatment, deduction eligibility, ledger reconciliation or company completeness.'),
          jsonb_build_object('code', 'ExpenseControlCoverage', 'passed',
            coalesce((resolved.expense_tax->>'sourceCount')::bigint = 0, false),
            'detail', 'Known expense sources lack supported posting and ledger-reconciliation coverage in this provider version, even with a digest-current review. They block technical close. No represented sources is not proof of company completeness or no tax obligations.'),
          jsonb_build_object('code', 'VatReturnControlCoverage', 'passed',
            (resolved.vat_returns->>'sourceCount')::integer = 0
              and (resolved.vat_returns->>'draftCount')::integer = 0
              and (resolved.vat_returns->'taxAccounts'->>'statementCount')::integer = 0
              and (resolved.vat_returns->'taxAccounts'->>'controlCount')::integer = 0,
            'detail', 'Represented VAT facts, saved VAT drafts, tax-account statements or saved tax-account controls require complete tax controls, which this provider does not supply. A zero tax-account balance difference is not row matching or complete coverage. Synthetic calculations and actual-review exclusions do not establish filing readiness. Empty inventories do not establish no tax obligations.'),
          jsonb_build_object('code', 'ScheduleBasisCoverage', 'passed',
            coalesce((resolved.subledger_controls->>'missingBasisCount')::bigint = 0, false),
            'detail', 'Every represented schedule needs a retained carrying basis. Missing acquisition or imported-opening evidence cannot be waived by a family declaration.'),
          jsonb_build_object('code', 'SubledgerControlCoverage', 'passed',
            coalesce((resolved.schedules->>'scheduleCount')::bigint = 0, false)
              and coalesce((resolved.subledger_controls->>'basisCount')::bigint = 0, false)
              and coalesce((resolved.subledger_controls->>'snapshotCount')::bigint = 0, false),
            'detail', 'Represented schedules, carrying bases or control snapshots require complete source and accounting controls, which this synthetic provider does not establish. A zero control difference is not complete coverage. Empty inventories do not establish no asset obligations.'),
          jsonb_build_object('code', 'RepresentedSchedules', 'passed',
            coalesce((resolved.schedules->>'dueUnpreparedCount')::bigint = 0
              and (resolved.schedules->>'dueUnpostedCount')::bigint = 0
              and (resolved.schedules->>'reversedOccurrenceCount')::bigint = 0, false),
            'detail', 'Represented due schedule occurrences must be posted and unreversed; schedule inventory and control-account completeness remain unestablished.')
        ) as base_checks
        from resolved
      ), family_catalog as (
        select catalog.value->>0 as family, catalog.value->>1 as provider,
          catalog.ordinal::integer as ordinal
        from jsonb_array_elements(${JSON.stringify(familyCatalog)}::jsonb)
          with ordinality as catalog(value, ordinal)
      ), family_inputs as (
        select checked.base_checks, checked.inventory, checked.commerce, checked.expense_tax,
          checked.vat_returns, checked.schedules, checked.subledger_controls, checked.owners,
          checked.bank_state, catalog.family, catalog.provider, catalog.ordinal
        from checked cross join family_catalog catalog
      ), family_counts as (
        select inputs.*,
          (select f.value from jsonb_array_elements(coalesce(inputs.inventory->'families', '[]'::jsonb)) f
            where f.value->>'family' = inputs.family) as decision,
          case inputs.family
            when 'bank_sources' then greatest(jsonb_array_length(inputs.bank_state->'sources'),
              coalesce(jsonb_array_length(inputs.inventory->'bankAccountIds'), 0))
            when 'invoices' then (inputs.commerce->>'registeredInvoiceCount')::bigint
            when 'tax' then (inputs.expense_tax->>'sourceCount')::bigint
              + (inputs.vat_returns->>'sourceCount')::bigint
              + (inputs.vat_returns->>'draftCount')::bigint
              + (inputs.vat_returns->'taxAccounts'->>'statementCount')::bigint
              + (inputs.vat_returns->'taxAccounts'->>'controlCount')::bigint
            when 'assets_deferrals' then (inputs.schedules->>'scheduleCount')::bigint
              + (inputs.subledger_controls->>'basisCount')::bigint
              + (inputs.subledger_controls->>'snapshotCount')::bigint
            when 'owner_balances' then (inputs.owners->>'registeredRecordCount')::bigint
            else null
          end as represented,
          case inputs.family
            when 'bank_sources' then array['DeclaredBankInventory', 'RepresentedBankSources']
            when 'invoices' then array['RegisteredCommerce']
            when 'tax' then array['ExpenseReviewCurrentness', 'ExpenseControlCoverage',
              'VatReturnControlCoverage']
            when 'assets_deferrals' then array['RepresentedSchedules', 'ScheduleBasisCoverage',
              'SubledgerControlCoverage']
            when 'owner_balances' then array['OwnerSourceReview']
            else array[]::text[]
          end as codes
        from family_inputs inputs
      ), family_checks as (
        select counts.*,
          coalesce((select jsonb_agg(jsonb_build_object('code', check_item->>'code',
            'status', case when check_item->>'passed' = 'true' then 'passed' else 'failed' end,
            'detail', check_item->>'detail') order by check_item->>'code')
            from jsonb_array_elements(counts.base_checks) check_item
            where check_item->>'code' = any(counts.codes)), '[]'::jsonb) as provider_checks
        from family_counts counts
      ), family_detail as (
        select checks.*, checks.provider_checks
          || case when checks.family = 'bank_sources' and checks.decision->>'status' = 'required'
            then jsonb_build_array(jsonb_build_object('code', 'RequiredBankSources',
              'status', case when checks.represented > 0 then 'passed' else 'failed' end,
              'detail', 'A required bank family needs declared and represented sources, not an empty inventory.'))
            else '[]'::jsonb end
          || case when checks.family <> 'bank_sources'
            then jsonb_build_array(jsonb_build_object('code', 'FullFamilyCoverage', 'status', 'unavailable',
              'detail', 'Complete source inventory and required family control coverage are not implemented. A required declaration remains blocked.'))
            else '[]'::jsonb end as gated_checks
        from family_checks checks
      ), family_passed as (
        select detail.*, case
          when detail.decision->>'status' = 'not_applicable' then coalesce(detail.represented, 0) = 0
            and not exists (
              select 1 from jsonb_array_elements(detail.gated_checks) check_item
              where check_item->>'status' = 'failed')
          when detail.decision->>'status' = 'required' then jsonb_array_length(detail.gated_checks) > 0
            and not exists (
              select 1 from jsonb_array_elements(detail.gated_checks) check_item
              where check_item->>'status' <> 'passed')
          else false
        end as passed
        from family_detail detail
      ), families as (
        select passed.*, passed.gated_checks || jsonb_build_array(jsonb_build_object(
          'code', 'ReviewedApplicability',
          'status', case when passed.passed then 'passed' else 'failed' end,
          'detail', case
            when passed.decision is null
              then 'No family decision is retained. Declare required, not applicable with evidence, unsupported or unknown.'
            when passed.decision->>'status' = 'not_applicable' and coalesce(passed.represented, 0) > 0
              then 'Represented records contradict the not-applicable declaration.'
            when passed.decision->>'status' = 'not_applicable'
              then 'Dated operator decision only. It does not establish legal applicability or company completeness.'
            when passed.decision->>'status' = 'required'
              then 'Every required provider check must be available and pass.'
            else 'Unsupported and unknown obligations block technical close.'
          end)) as family_checks
        from family_passed passed
      ), readiness as (
        select checked.entity_id, checked.profile, checked.profile_version, checked.writer_epoch,
          checked.committed_sequence, checked.period_id, checked.version, checked.locked,
          checked.starts_on, checked.ends_on, checked.fiscal_year_id, checked.report_id,
          checked.inventory, checked.accounts, checked.periods, checked.commerce,
          checked.bank_state, checked.schedules, checked.owners, checked.expense_tax,
          checked.vat_returns, checked.subledger_controls, checked.base_checks,
          (select jsonb_agg(jsonb_build_object('family', family.family,
            'declaration', family.decision, 'providerVersion', family.provider,
            'representedCount', family.represented, 'checks', family.family_checks,
            'passed', family.passed, 'coverage', 'not_established') order by family.ordinal)
            from families family) as family_inventory
        from checked
      ), final as (
        select readiness.*, readiness.base_checks
          || jsonb_build_array(jsonb_build_object('code', 'CompleteFamilyInventory', 'passed',
            coalesce(readiness.inventory->>'coverage' = 'synthetic_family_inventory_v1', false)
              and not exists (
                select 1 from jsonb_array_elements(readiness.family_inventory) family
                where family->>'passed' is distinct from 'true'),
            'detail', 'Every close family needs an evidenced decision. Required unavailable controls, unknown obligations and contradictions block this technical scope.')) as all_checks
        from readiness
      )
      select jsonb_build_object(
        'scope', jsonb_build_object('entityId', entity_id, 'bookId', ${bookId}::text),
        'periodId', period_id, 'startsOn', starts_on::text, 'endsOn', ends_on::text, 'locked', locked,
        'inventoryScope', 'synthetic_family_inventory_v1', 'families', family_inventory,
        'inventory', inventory,
        'dependencies', jsonb_build_object(
          'periodVersion', version, 'ledgerSequence', committed_sequence,
          'profileVersion', profile_version, 'writerEpoch', writer_epoch,
          'periodDigest', openerp.digest(jsonb_build_object('periods', periods,
            'fiscalYear', (select to_jsonb(y) from openerp.fiscal_years y
              where y.book_id = ${bookId} and y.id = final.fiscal_year_id))),
          'accountsDigest', openerp.digest(accounts),
          'bankDigest', openerp.digest(bank_state),
          'scheduleDigest', openerp.digest(schedules),
          'familyInventoryDigest', openerp.digest(jsonb_build_object(
            'inventory', inventory, 'families', family_inventory)),
          'inventoryDigest', openerp.digest(jsonb_build_object(
            'bankInventory', inventory, 'commerce', commerce)),
          'ownerSourceDigest', owners->>'sourceDigest',
          'expenseTaxBasisDigest', expense_tax->>'basisDigest',
          'vatReturnDependencyDigest', openerp.digest(vat_returns),
          'subledgerControls', subledger_controls,
          'reportId', report_id),
        'checks', all_checks,
        'ownerTaxStatus', jsonb_build_object('owners', owners, 'expenseTax', expense_tax,
          'vatReturns', vat_returns),
        'technicalCloseAllowed', not locked
          and not exists (
            select 1 from jsonb_array_elements(all_checks) check_item
            where check_item->>'passed' is distinct from 'true'),
        'statutoryReady', false,
        'statutoryBlockers', jsonb_build_array(
          'Actual company profile, accounting method, obligations and complete expected source inventory are not established.',
          'Tax, receivables/payables, owner balances, assets, payroll, valuation and control-account completeness are not certified.',
          'Technical locking does not perform year-end transfers, tax calculation, annual reporting, SIE or iXBRL validation.',
          'Retention, restore, reviewed statutory schemas, signing authority and filing acceptance remain unverified.')) as basis
      from final
    `,
      "objects",
    );
  });
}
