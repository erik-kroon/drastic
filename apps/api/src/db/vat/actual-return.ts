import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { readTableAccess, type JsonObject } from "../commerce/access";
import { vatActualReturns } from "../schema";
import type { Transaction } from "../transaction";

// The actual domestic VAT return is a calculation artifact. Every read below
// belongs to another owner: the manual, evidence-backed VAT fact admission, the
// owned purchase recognition, the reviewed control account-role bindings and the
// released control reclassification records. This module selects and summarises;
// it never chooses a tax treatment, activates a profile or computes a report.
export const actualReturnTables = [
  "vat_actual_returns",
  "vat_actual_return_boxes",
  "vat_actual_return_contributions",
  "vat_actual_return_exclusions",
  "vat_actual_return_controls",
  "vat_actual_return_control_rows",
  "vat_actual_return_coverage",
  "vat_fact_components",
  "vat_fact_revisions",
  "vat_fact_withdrawals",
  "purchase_tax_facts",
  "vat_control_profiles",
  "vat_control_account_roles",
  "vat_control_reclassification_effects",
  "vat_draft_amendments",
  "rule_releases",
  "company_fact_revisions",
  "books",
  "accounts",
  "vouchers",
  "journal_lines",
  "evidence",
  "command_receipts",
] as const;

const writableTables = new Set([
  "vat_actual_returns",
  "vat_actual_return_boxes",
  "vat_actual_return_contributions",
  "vat_actual_return_exclusions",
  "vat_actual_return_controls",
  "vat_actual_return_control_rows",
  "vat_actual_return_coverage",
  "command_receipts",
]);

export function isActualReturnWritable(tableName: string) {
  return writableTables.has(tableName);
}

export function readActualReturnAccess(transaction: Transaction) {
  return readTableAccess(transaction, actualReturnTables);
}

export type ControlProfileRow = {
  readonly id: string;
  readonly identityKey: string;
  readonly profileDigest: string;
};

export function readControlProfiles(transaction: Transaction, bookId: string) {
  return transaction.execute<ControlProfileRow>(
    sql`
      select id, identity_key as "identityKey", body ->> 'digest'::text as "profileDigest"
      from openerp.vat_control_profiles
      where book_id = ${bookId}
      order by id collate "C"
      limit 21
    `,
    "objects",
  );
}

export type ControlRoleRow = {
  readonly role: string;
  readonly accountId: string;
  readonly accountVersion: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
};

export function readControlRoles(transaction: Transaction, bookId: string, profileId: string) {
  return transaction.execute<ControlRoleRow>(
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

export type AdmittedFactRow = {
  readonly factId: string;
  readonly revisionId: string;
  readonly digest: string;
  readonly recordClass: string;
  readonly treatment: string;
  readonly taxPointOn: string;
  readonly voucherId: string | null;
  readonly netMinor: string;
  readonly vatMinor: string;
  readonly withdrawn: boolean;
  readonly voucherSequence: string | null;
  readonly voucherReversed: boolean;
};

// The manual admission owner's own records, read once for the declared tax
// points. The record class is the component's immutable class, not a value the
// latest revision may rewrite.
export function readAdmittedFacts(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<AdmittedFactRow>(
    sql`
      select c.id as "factId", r.id as "revisionId", r.body ->> 'digest'::text as digest,
        c.record_class as "recordClass", r.body -> 'input'::jsonb ->> 'treatment'::text as treatment,
        r.body -> 'input'::jsonb ->> 'taxPointOn'::text as "taxPointOn",
        r.voucher_id as "voucherId",
        r.body -> 'input'::jsonb ->> 'netMinor'::text as "netMinor",
        r.body -> 'input'::jsonb ->> 'vatMinor'::text as "vatMinor",
        (w.book_id is not null) as withdrawn,
        v.sequence::text as "voucherSequence",
        (coalesce(v.posting_purpose = 'reversal', false) or exists (
          select 1 from openerp.vouchers x
          where x.book_id = ${bookId} and x.corrects_voucher_id = r.voucher_id
            and x.posting_purpose = 'reversal'
        )) as "voucherReversed"
      from openerp.vat_fact_components c
      join lateral (
        select x.* from openerp.vat_fact_revisions x
        where x.book_id = ${bookId} and x.fact_id = c.id
        order by x.revision desc limit 1
      ) r on true
      left join openerp.vat_fact_withdrawals w
        on w.book_id = ${bookId} and w.fact_id = c.id
      left join openerp.vouchers v on v.book_id = ${bookId} and v.id = r.voucher_id
      where c.book_id = ${bookId}
        and r.body -> 'input'::jsonb ->> 'taxPointOn'::text >= ${startsOn}
        and r.body -> 'input'::jsonb ->> 'taxPointOn'::text <= ${endsOn}
      order by c.id collate "C"
    `,
    "objects",
  );
}

export type PurchaseComponentRow = {
  readonly id: string;
  readonly recognitionId: string;
  readonly voucherId: string;
  readonly signedBaseMinor: string;
  readonly signedDeductibleTaxMinor: string;
  readonly taxPointOn: string;
  readonly adjustsTaxFactId: string | null;
  readonly digest: string;
  readonly ruleReleaseId: string | null;
  readonly basis: string;
  readonly voucherSequence: string | null;
  readonly voucherReversed: boolean;
};

// The owned purchase recognition's published signed components. The recognition
// owner decided treatment, eligibility and deduction; this module only reads the
// published result.
export function readPurchaseComponents(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<PurchaseComponentRow>(
    sql`
      select p.id, p.recognition_id as "recognitionId", p.voucher_id as "voucherId",
        p.signed_base_minor::text as "signedBaseMinor",
        p.signed_deductible_tax_minor::text as "signedDeductibleTaxMinor",
        p.tax_point_on::text as "taxPointOn", p.adjusts_tax_fact_id as "adjustsTaxFactId",
        p.digest, p.body ->> 'ruleReleaseId'::text as "ruleReleaseId",
        p.body ->> 'basis'::text as basis,
        v.sequence::text as "voucherSequence",
        (coalesce(v.posting_purpose = 'reversal', false) or exists (
          select 1 from openerp.vouchers x
          where x.book_id = ${bookId} and x.corrects_voucher_id = p.voucher_id
            and x.posting_purpose = 'reversal'
        )) as "voucherReversed"
      from openerp.purchase_tax_facts p
      left join openerp.vouchers v on v.book_id = ${bookId} and v.id = p.voucher_id
      where p.book_id = ${bookId}
        and p.tax_point_on >= ${startsOn} and p.tax_point_on <= ${endsOn}
      order by p.tax_point_on, p.id collate "C"
    `,
    "objects",
  );
}

export type PopulationRow = {
  readonly admittedFacts: number;
  readonly admittedWithoutTaxPoint: number;
  readonly purchaseComponents: number;
};

// A complete population includes the zero-count case, so both populations are
// counted over the whole book and not only inside the declared period. A fact
// whose tax point falls in another period belongs to that period's return, so it
// is not counted here; a fact with no tax point at all cannot be classified into
// any period and is.
export function readPopulation(transaction: Transaction, bookId: string) {
  return transaction.execute<PopulationRow>(
    sql`
      select
        (select count(*)::integer from openerp.vat_fact_components
          where book_id = ${bookId}) as "admittedFacts",
        (select count(*)::integer from openerp.vat_fact_components c
          join lateral (
            select x.body -> 'input'::jsonb ->> 'taxPointOn'::text as point
            from openerp.vat_fact_revisions x
            where x.book_id = ${bookId} and x.fact_id = c.id
            order by x.revision desc limit 1
          ) r on true
          where c.book_id = ${bookId} and r.point is null) as "admittedWithoutTaxPoint",
        (select count(*)::integer from openerp.purchase_tax_facts
          where book_id = ${bookId}) as "purchaseComponents"
    `,
    "objects",
  );
}

export type AmendmentRow = {
  readonly id: string;
  readonly digest: string;
};

// The released amendment owner records a review over two drafts. It commits no
// voucher and exposes no per-account vector, so the complete bounded inventory
// is what a capture can honestly read from it.
export function readAmendmentInventory(transaction: Transaction, bookId: string) {
  return transaction.execute<AmendmentRow>(
    sql`
      select id, body ->> 'digest'::text as digest
      from openerp.vat_draft_amendments
      where book_id = ${bookId}
      order by id collate "C"
      limit 501
    `,
    "objects",
  );
}

function idArray(values: ReadonlyArray<string>) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

export type ControlLineRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly postingDate: string;
};

// The exact journal lines that carry each selected voucher on the bound VAT
// control accounts. This is the link the control rollforward reconciles against.
export function readVoucherControlLines(
  transaction: Transaction,
  bookId: string,
  voucherIds: ReadonlyArray<string>,
  accountIds: ReadonlyArray<string>,
) {
  if (voucherIds.length === 0 || accountIds.length === 0) {
    return Effect.succeed<ReadonlyArray<ControlLineRow>>([]);
  }

  return transaction.execute<ControlLineRow>(
    sql`
      select l.voucher_id as "voucherId", l.id as "lineId", l.account_id as "accountId",
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        v.posting_date::text as "postingDate"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and l.voucher_id = any(${idArray(voucherIds)})
        and l.account_id = any(${idArray(accountIds)})
      order by v.posting_date, l.voucher_id collate "C", l.ordinal
    `,
    "objects",
  );
}

export type ReclassificationEffectRow = {
  readonly id: string;
  readonly obligationId: string;
  readonly voucherId: string | null;
  readonly postingDate: string;
  readonly digest: string;
};

// The released reclassification owner's committed effects, for EVERY obligation
// touching a bound control inside the interval, not only one obligation. This
// packet reads them and never executes or re-qualifies one.
export function readControlEffectsInInterval(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<ReclassificationEffectRow>(
    sql`
      select id, obligation_id as "obligationId", voucher_id as "voucherId",
        posting_date::text as "postingDate", body ->> 'digest'::text as digest
      from openerp.vat_control_reclassification_effects
      where book_id = ${bookId} and outcome = 'posted'
        and posting_date >= ${startsOn} and posting_date <= ${endsOn}
      order by posting_date, id collate "C"
    `,
    "objects",
  );
}

export type CountRow = { readonly total: number };

export function countActualReturns(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.vat_actual_returns where book_id = ${bookId}`,
    "objects",
  );
}

export function readNextOrdinal(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly ordinal: number }>(
    sql`
      select (coalesce(max(ordinal), 0) + 1)::integer as ordinal
      from openerp.vat_actual_returns where book_id = ${bookId}
    `,
    "objects",
  );
}

export type ReturnWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly ordinal: number;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly basisDigest: string;
  readonly basisEngine: string;
  readonly ruleReleaseId: string;
  readonly ruleReleaseChecksum: string;
  readonly periodFactRevisionId: string;
  readonly filingReady: boolean;
  readonly controlsReconciled: boolean;
  readonly coverageComplete: boolean;
  readonly calculationSupported: boolean;
  readonly exactNetMinor: string;
  readonly reportedNetMinor: string;
  readonly residualNetMinor: string;
  readonly ledgerBoundary: string;
  readonly digest: string;
  readonly body: JsonObject;
  readonly recordedAt: string;
};

export function insertReturn(transaction: Transaction, row: ReturnWrite) {
  return transaction.execute(
    sql`
      insert into openerp.vat_actual_returns
        (book_id, id, ordinal, starts_on, ends_on, basis_digest, basis_engine,
         rule_release_id, rule_release_checksum, period_fact_revision_id,
         filing_ready, controls_reconciled, coverage_complete, calculation_supported,
         exact_net_minor, reported_net_minor, residual_net_minor, ledger_boundary,
         digest, body, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.ordinal}, ${row.startsOn}, ${row.endsOn},
        ${row.basisDigest}, ${row.basisEngine}, ${row.ruleReleaseId}, ${row.ruleReleaseChecksum},
        ${row.periodFactRevisionId}, ${row.filingReady}, ${row.controlsReconciled},
        ${row.coverageComplete}, ${row.calculationSupported}, ${row.exactNetMinor},
        ${row.reportedNetMinor}, ${row.residualNetMinor}, ${row.ledgerBoundary}::bigint,
        ${row.digest}, ${JSON.stringify(row.body)}::jsonb, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

function insertMany(
  transaction: Transaction,
  table: string,
  columns: string,
  tuples: ReadonlyArray<SQL>,
) {
  if (tuples.length === 0) return Effect.succeed([]);

  return transaction.execute(
    sql`insert into ${sql.raw(table)} (${sql.raw(columns)}) values ${sql.join([...tuples], sql`, `)}`,
    "objects",
  );
}

export type BoxWrite = {
  readonly bookId: string;
  readonly returnId: string;
  readonly box: string;
  readonly kind: string;
  readonly exactMinor: string;
  readonly reportedMinor: string;
  readonly residualMinor: string;
};

export function insertBoxes(transaction: Transaction, rows: ReadonlyArray<BoxWrite>) {
  return insertMany(
    transaction,
    "openerp.vat_actual_return_boxes",
    "book_id, return_id, box, kind, exact_minor, reported_minor, residual_minor",
    rows.map(
      (row) =>
        sql`(${row.bookId}, ${row.returnId}, ${row.box}, ${row.kind}, ${row.exactMinor},
          ${row.reportedMinor}, ${row.residualMinor})`,
    ),
  );
}

export type ContributionWrite = {
  readonly bookId: string;
  readonly returnId: string;
  readonly ordinal: number;
  readonly factId: string;
  readonly origin: string;
  readonly mappingRuleId: string;
  readonly rateId: string;
  readonly box: string;
  readonly signedMinor: string;
  readonly basisMinor: string;
  readonly taxMinor: string;
  readonly revisionId: string;
  readonly factDigest: string;
};

export function insertContributions(
  transaction: Transaction,
  rows: ReadonlyArray<ContributionWrite>,
) {
  return insertMany(
    transaction,
    "openerp.vat_actual_return_contributions",
    "book_id, return_id, ordinal, fact_id, origin, mapping_rule_id, rate_id, box, signed_minor, basis_minor, tax_minor, revision_id, fact_digest",
    rows.map(
      (row) =>
        sql`(${row.bookId}, ${row.returnId}, ${row.ordinal}, ${row.factId}, ${row.origin},
          ${row.mappingRuleId}, ${row.rateId}, ${row.box}, ${row.signedMinor},
          ${row.basisMinor}, ${row.taxMinor}, ${row.revisionId}, ${row.factDigest})`,
    ),
  );
}

export type ExclusionWrite = {
  readonly bookId: string;
  readonly returnId: string;
  readonly ordinal: number;
  readonly factId: string;
  readonly origin: string;
  readonly revisionId: string;
  readonly reason: string;
  readonly detail: string;
};

export function insertExclusions(transaction: Transaction, rows: ReadonlyArray<ExclusionWrite>) {
  return insertMany(
    transaction,
    "openerp.vat_actual_return_exclusions",
    "book_id, return_id, ordinal, fact_id, origin, revision_id, reason, detail",
    rows.map(
      (row) =>
        sql`(${row.bookId}, ${row.returnId}, ${row.ordinal}, ${row.factId}, ${row.origin},
          ${row.revisionId}, ${row.reason}, ${row.detail})`,
    ),
  );
}

export type ControlWrite = {
  readonly bookId: string;
  readonly returnId: string;
  readonly accountId: string;
  readonly role: string;
  readonly reviewedOpeningMinor: string;
  readonly expectedClosingMinor: string;
  readonly frozenGlClosingMinor: string;
  readonly differenceMinor: string;
  readonly reconciled: boolean;
};

export function insertControls(transaction: Transaction, rows: ReadonlyArray<ControlWrite>) {
  return insertMany(
    transaction,
    "openerp.vat_actual_return_controls",
    "book_id, return_id, account_id, role, reviewed_opening_minor, expected_closing_minor, frozen_gl_closing_minor, difference_minor, reconciled",
    rows.map(
      (row) =>
        sql`(${row.bookId}, ${row.returnId}, ${row.accountId}, ${row.role},
          ${row.reviewedOpeningMinor}, ${row.expectedClosingMinor}, ${row.frozenGlClosingMinor},
          ${row.differenceMinor}, ${row.reconciled})`,
    ),
  );
}

export type ControlRowWrite = {
  readonly bookId: string;
  readonly returnId: string;
  readonly accountId: string;
  readonly ordinal: number;
  readonly state: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly postingDate: string;
  readonly signedMinor: string;
};

export function insertControlRows(transaction: Transaction, rows: ReadonlyArray<ControlRowWrite>) {
  return insertMany(
    transaction,
    "openerp.vat_actual_return_control_rows",
    "book_id, return_id, account_id, ordinal, state, voucher_id, line_id, posting_date, signed_minor",
    rows.map(
      (row) =>
        sql`(${row.bookId}, ${row.returnId}, ${row.accountId}, ${row.ordinal}, ${row.state},
          ${row.voucherId}, ${row.lineId}, ${row.postingDate}, ${row.signedMinor})`,
    ),
  );
}

export type CoverageWrite = {
  readonly bookId: string;
  readonly returnId: string;
  readonly family: string;
  readonly state: string;
  readonly evidenceId: string | null;
  readonly evidenceSha256: string | null;
};

export function insertCoverage(transaction: Transaction, rows: ReadonlyArray<CoverageWrite>) {
  return insertMany(
    transaction,
    "openerp.vat_actual_return_coverage",
    "book_id, return_id, family, state, evidence_id, evidence_sha256",
    rows.map(
      (row) =>
        sql`(${row.bookId}, ${row.returnId}, ${row.family}, ${row.state}, ${row.evidenceId},
          ${row.evidenceSha256})`,
    ),
  );
}

export type ReturnRow = { readonly id: string; readonly body: Schema.JsonObject };

export function readReturn(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({ id: vatActualReturns.id, body: vatActualReturns.body })
    .from(vatActualReturns)
    .where(and(eq(vatActualReturns.bookId, bookId), eq(vatActualReturns.id, id)));
}

export function readReturnInventory(transaction: Transaction, bookId: string) {
  return transaction
    .select({
      id: vatActualReturns.id,
      digest: vatActualReturns.digest,
      startsOn: vatActualReturns.startsOn,
      endsOn: vatActualReturns.endsOn,
      filingReady: vatActualReturns.filingReady,
      exactNetMinor: vatActualReturns.exactNetMinor,
      reportedNetMinor: vatActualReturns.reportedNetMinor,
      recordedAt: vatActualReturns.recordedAt,
    })
    .from(vatActualReturns)
    .where(eq(vatActualReturns.bookId, bookId))
    .orderBy(desc(vatActualReturns.ordinal));
}
