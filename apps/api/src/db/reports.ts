import { textArray } from "./sql-values";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const reportTables = [
  "report_snapshots",
  "report_lines",
  "accounts",
  "vouchers",
  "journal_lines",
  "books",
  "command_receipts",
] as const;

export type ReportBookRow = {
  readonly entityId: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly profile: string;
  readonly committedSequence: string;
};

export type ReportTotalsRow = {
  readonly accountCount: string;
  readonly voucherCount: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
};

export type SnapshotRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly sequence: string;
  readonly body: JsonObject;
};

export type LineRow = { readonly body: JsonObject };

export type ContributionRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly sequence: string;
  readonly ordinal: number;
  readonly postingDate: string;
  readonly part: string;
  readonly series: string | null;
  readonly voucherNumber: string | null;
  readonly postingPurpose: string | null;
  readonly correctsVoucherId: string | null;
  readonly description: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly evidenceRefs: JsonObject;
  readonly runningBalanceMinor: string | null;
};

export type FamilyLineRow = {
  readonly id: string;
  readonly label: string;
  readonly accountIds: JsonObject;
  readonly openingMinor: string;
  readonly movementMinor: string;
  readonly closingMinor: string;
  readonly amountMinor: string;
};

export type FamilyRow = {
  readonly lines: ReadonlyArray<FamilyLineRow>;
  readonly totals: JsonObject;
};

export type ComparisonTotalsRow = {
  readonly count: string;
  readonly openingMinor: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly movementMinor: string;
  readonly closingMinor: string;
  readonly digest: string;
};

export type ComparisonItemRow = {
  readonly accountId: string;
  readonly presence: string;
  readonly left: JsonObject | null;
  readonly right: JsonObject | null;
  readonly labelsChanged: boolean | null;
  readonly difference: JsonObject | null;
};

export type ComparisonPageRow = {
  readonly totalAccounts: string;
  readonly bothPresentCount: string;
  readonly leftOnlyCount: string;
  readonly rightOnlyCount: string;
  readonly items: ReadonlyArray<ComparisonItemRow>;
  readonly next: string | null;
};

export const familyRoles = [
  { role: "revenue", label: "Revenue", ordinal: 10, side: "credit" },
  { role: "other_income", label: "Other income", ordinal: 20, side: "credit" },
  { role: "cost_of_sales", label: "Cost of sales", ordinal: 30, side: "debit" },
  { role: "operating_expense", label: "Operating expenses", ordinal: 40, side: "debit" },
  { role: "other_expense", label: "Other expenses", ordinal: 50, side: "debit" },
  { role: "income_tax", label: "Income tax", ordinal: 60, side: "debit" },
  {
    role: "cash_and_cash_equivalents",
    label: "Cash and cash equivalents",
    ordinal: 10,
    side: "debit",
  },
  { role: "accounts_receivable", label: "Accounts receivable", ordinal: 20, side: "debit" },
  { role: "inventory", label: "Inventory", ordinal: 30, side: "debit" },
  { role: "other_current_assets", label: "Other current assets", ordinal: 40, side: "debit" },
  {
    role: "property_plant_and_equipment",
    label: "Property, plant and equipment",
    ordinal: 50,
    side: "debit",
  },
  {
    role: "other_non_current_assets",
    label: "Other non-current assets",
    ordinal: 60,
    side: "debit",
  },
  { role: "accounts_payable", label: "Accounts payable", ordinal: 70, side: "credit" },
  { role: "accrued_liabilities", label: "Accrued liabilities", ordinal: 80, side: "credit" },
  { role: "tax_liabilities", label: "Tax liabilities", ordinal: 90, side: "credit" },
  {
    role: "other_current_liabilities",
    label: "Other current liabilities",
    ordinal: 100,
    side: "credit",
  },
  { role: "long_term_debt", label: "Long-term debt", ordinal: 110, side: "credit" },
  {
    role: "other_non_current_liabilities",
    label: "Other non-current liabilities",
    ordinal: 120,
    side: "credit",
  },
  { role: "equity", label: "Equity", ordinal: 130, side: "credit" },
  { role: "operating_cash_inflow", label: "Operating cash inflow", ordinal: 10, side: "credit" },
  { role: "operating_cash_outflow", label: "Operating cash outflow", ordinal: 20, side: "debit" },
  { role: "investing_cash_inflow", label: "Investing cash inflow", ordinal: 30, side: "credit" },
  { role: "investing_cash_outflow", label: "Investing cash outflow", ordinal: 40, side: "debit" },
  { role: "financing_cash_inflow", label: "Financing cash inflow", ordinal: 50, side: "credit" },
  { role: "financing_cash_outflow", label: "Financing cash outflow", ordinal: 60, side: "debit" },
] as const;

export type Family = "profit_and_loss" | "balance_sheet" | "cash_flow";

const familyRolesFor = {
  profit_and_loss: [
    "revenue",
    "other_income",
    "cost_of_sales",
    "operating_expense",
    "other_expense",
    "income_tax",
  ],
  balance_sheet: [
    "cash_and_cash_equivalents",
    "accounts_receivable",
    "inventory",
    "other_current_assets",
    "property_plant_and_equipment",
    "other_non_current_assets",
    "accounts_payable",
    "accrued_liabilities",
    "tax_liabilities",
    "other_current_liabilities",
    "long_term_debt",
    "other_non_current_liabilities",
    "equity",
  ],
  cash_flow: [
    "operating_cash_inflow",
    "operating_cash_outflow",
    "investing_cash_inflow",
    "investing_cash_outflow",
    "financing_cash_inflow",
    "financing_cash_outflow",
  ],
} satisfies Record<Family, ReadonlyArray<string>>;

export function rolesFor(family: Family) {
  return familyRolesFor[family];
}

export function readReportBook(transaction: Transaction, bookId: string) {
  return transaction.execute<ReportBookRow>(
    sql`
      select entity_id as "entityId", currency, currency_scale as "currencyScale", profile,
        committed_sequence::text as "committedSequence"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readReportTotals(
  transaction: Transaction,
  bookId: string,
  sequence: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<ReportTotalsRow>(
    sql`
      select
        (select count(*)::bigint from openerp.accounts a where a.book_id = ${bookId})::text
          as "accountCount",
        (select count(*)::bigint from openerp.vouchers v
          where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
            and v.posting_date between ${startsOn}::date and ${endsOn}::date)::text as "voucherCount",
        coalesce((select sum(l.debit_minor) from openerp.journal_lines l
          join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
          where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
            and v.posting_date between ${startsOn}::date and ${endsOn}::date), 0)::text as "debitMinor",
        coalesce((select sum(l.credit_minor) from openerp.journal_lines l
          join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
          where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
            and v.posting_date between ${startsOn}::date and ${endsOn}::date), 0)::text as "creditMinor"
    `,
    "objects",
  );
}

export function insertSnapshot(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly sequence: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.report_snapshots (book_id, id, starts_on, ends_on, sequence, body)
      values (${row.bookId}, ${row.id}, ${row.startsOn}::date, ${row.endsOn}::date,
        ${row.sequence}::bigint, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertTrialBalanceLines(
  transaction: Transaction,
  bookId: string,
  reportId: string,
  sequence: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute(
    sql`
      insert into openerp.report_lines (book_id, report_id, account_id, body)
      select ${bookId}, ${reportId}, a.id,
        jsonb_build_object(
          'accountId', a.id, 'code', a.code, 'name', a.name,
          'openingMinor', coalesce(t.opening, 0)::text,
          'debitMinor', coalesce(t.debit, 0)::text,
          'creditMinor', coalesce(t.credit, 0)::text,
          'closingMinor', (coalesce(t.opening, 0) + coalesce(t.debit, 0)
            - coalesce(t.credit, 0))::text)
      from openerp.accounts a
      left join (
        select l.account_id,
          sum(l.debit_minor - l.credit_minor) filter (
            where v.posting_date < ${startsOn}::date) as opening,
          sum(l.debit_minor) filter (
            where v.posting_date >= ${startsOn}::date) as debit,
          sum(l.credit_minor) filter (
            where v.posting_date >= ${startsOn}::date) as credit
        from openerp.journal_lines l
        join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
        where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
          and v.posting_date <= ${endsOn}::date
        group by l.account_id
      ) t on t.account_id = a.id
      where a.book_id = ${bookId}
    `,
    "objects",
  );
}

export function copyReportLines(
  transaction: Transaction,
  bookId: string,
  from: string,
  to: string,
) {
  return transaction.execute(
    sql`
      insert into openerp.report_lines (book_id, report_id, account_id, body)
      select ${bookId}, ${to}, account_id, body
      from openerp.report_lines
      where book_id = ${bookId} and report_id = ${from}
    `,
    "objects",
  );
}

export function readSnapshot(transaction: Transaction, bookId: string, reportId: string) {
  return transaction.execute<SnapshotRow>(
    sql`
      select id, starts_on::text as "startsOn", ends_on::text as "endsOn",
        sequence::text as sequence, body
      from openerp.report_snapshots
      where book_id = ${bookId} and id = ${reportId}
    `,
    "objects",
  );
}

export function listSnapshots(
  transaction: Transaction,
  bookId: string,
  kind: string | null,
  after: string,
) {
  return transaction.execute<SnapshotBodyRow>(
    sql`
      select id, body from openerp.report_snapshots
      where book_id = ${bookId}
        and (${kind}::text is null or body->>'kind' = ${kind})
        and id collate "C" > ${after} collate "C"
      order by id collate "C"
      limit 51
    `,
    "objects",
  );
}

export type SnapshotBodyRow = { readonly id: string; readonly body: JsonObject };

export function listLines(
  transaction: Transaction,
  bookId: string,
  reportId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<LineRow>(
    sql`
      select body from openerp.report_lines
      where book_id = ${bookId} and report_id = ${reportId}
        and account_id > ${after}
      order by account_id
      limit ${limit}
    `,
    "objects",
  );
}

export function readLine(
  transaction: Transaction,
  bookId: string,
  reportId: string,
  accountId: string,
) {
  return transaction.execute<LineRow>(
    sql`
      select body from openerp.report_lines
      where book_id = ${bookId} and report_id = ${reportId} and account_id = ${accountId}
    `,
    "objects",
  );
}

export function countContributions(
  transaction: Transaction,
  bookId: string,
  sequence: string,
  endsOn: string,
  accountId: string,
) {
  return transaction.execute<{ readonly total: string }>(
    sql`
      select count(*)::text as total
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date <= ${endsOn}::date and l.account_id = ${accountId}
    `,
    "objects",
  );
}

export function countIntervalContributions(
  transaction: Transaction,
  bookId: string,
  sequence: string,
  startsOn: string,
  endsOn: string,
  accountId: string,
) {
  return transaction.execute<{ readonly total: string }>(
    sql`
      select count(*)::text as total
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date between ${startsOn}::date and ${endsOn}::date
        and l.account_id = ${accountId}
    `,
    "objects",
  );
}

export function existsIntervalContribution(
  transaction: Transaction,
  bookId: string,
  sequence: string,
  startsOn: string,
  endsOn: string,
  accountId: string,
  atSequence: string,
  atOrdinal: number,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.journal_lines l
        join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
        where v.book_id = ${bookId} and v.sequence = ${atSequence}::bigint
          and v.sequence <= ${sequence}::bigint
          and v.posting_date between ${startsOn}::date and ${endsOn}::date
          and l.account_id = ${accountId} and l.ordinal = ${atOrdinal}
      ) as present
    `,
    "objects",
  );
}

export function listContributions(
  transaction: Transaction,
  bookId: string,
  sequence: string,
  endsOn: string,
  accountId: string,
  afterSequence: string,
  afterOrdinal: number,
  startsOn: string,
  limit: number,
) {
  return transaction.execute<ContributionRow>(
    sql`
      select v.id as "voucherId", l.id as "lineId", v.sequence::text as sequence, l.ordinal,
        v.posting_date::text as "postingDate",
        case when v.posting_date < ${startsOn}::date then 'opening' else 'movement' end as part,
        null::text as series, null::text as "voucherNumber", null::text as "postingPurpose",
        null::text as "correctsVoucherId",
        l.description, l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        v.action->'evidenceRefs' as "evidenceRefs", null::text as "runningBalanceMinor"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date <= ${endsOn}::date
        and l.account_id = ${accountId}
        and (v.sequence, l.ordinal) > (${afterSequence}::bigint, ${afterOrdinal})
      order by v.sequence, l.ordinal
      limit ${limit}
    `,
    "objects",
  );
}

export function listIntervalContributions(
  transaction: Transaction,
  bookId: string,
  sequence: string,
  startsOn: string,
  endsOn: string,
  accountId: string,
  afterSequence: string,
  afterOrdinal: number,
  limit: number,
) {
  return transaction.execute<ContributionRow>(
    sql`
      select v.id as "voucherId", l.id as "lineId", v.sequence::text as sequence, l.ordinal,
        v.posting_date::text as "postingDate", 'movement' as part, v.series,
        v.number::text as "voucherNumber", v.posting_purpose as "postingPurpose",
        v.corrects_voucher_id as "correctsVoucherId", l.description,
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        v.action->'evidenceRefs' as "evidenceRefs", null::text as "runningBalanceMinor"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date between ${startsOn}::date and ${endsOn}::date
        and l.account_id = ${accountId}
        and (v.sequence, l.ordinal) > (${afterSequence}::bigint, ${afterOrdinal})
      order by v.sequence, l.ordinal
      limit ${limit}
    `,
    "objects",
  );
}

export function pageOpeningBalance(
  transaction: Transaction,
  bookId: string,
  sequence: string,
  startsOn: string,
  endsOn: string,
  accountId: string,
  openingMinor: string,
  afterSequence: string,
  afterOrdinal: number,
) {
  return transaction.execute<{ readonly pageOpening: string }>(
    sql`
      select (${openingMinor}::numeric + coalesce(sum(l.debit_minor - l.credit_minor)
          filter (where (v.sequence, l.ordinal) <= (${afterSequence}::bigint, ${afterOrdinal})), 0)
        )::text as "pageOpening"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where v.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date between ${startsOn}::date and ${endsOn}::date
        and l.account_id = ${accountId}
    `,
    "objects",
  );
}

export function readFamilyLines(
  transaction: Transaction,
  bookId: string,
  reportId: string,
  family: Family,
  mapping: JsonObject,
) {
  const allowed = rolesFor(family);
  const catalog = familyRoles.filter((entry) => allowed.find((role) => role === entry.role));
  return transaction.execute<FamilyRow>(
    sql`
      with role_map as (
        select m->>'accountId' as account_id, m->>'role' as role_name
        from jsonb_array_elements(${JSON.stringify(mapping)}::jsonb->'roles') m
      ), grouped as (
        select catalog.role_name, catalog.label, catalog.ordinal, catalog.side,
          coalesce(jsonb_agg(l.account_id order by l.account_id collate "C")
            filter (where l.account_id is not null), '[]'::jsonb) as account_ids,
          coalesce(sum((l.body->>'openingMinor')::numeric), 0) as opening_minor,
          coalesce(sum((l.body->>'debitMinor')::numeric - (l.body->>'creditMinor')::numeric), 0)
            as movement_minor,
          coalesce(sum((l.body->>'closingMinor')::numeric), 0) as closing_minor
        from (select * from jsonb_array_elements(${JSON.stringify(catalog)}::jsonb)) catalog
        left join role_map m on m.role_name = catalog.role_name
        left join openerp.report_lines l
          on l.book_id = ${bookId} and l.report_id = ${reportId} and l.account_id = m.account_id
        group by catalog.role_name, catalog.label, catalog.ordinal, catalog.side
      ), calculated as (
        select g.*, case
          when ${family} = 'profit_and_loss' and g.side = 'credit' then -g.movement_minor
          when ${family} in ('profit_and_loss', 'cash_flow') and g.side = 'debit' then g.movement_minor
          when ${family} = 'balance_sheet' and g.side = 'credit' then -g.closing_minor
          else g.closing_minor
        end as amount_minor
        from grouped g
      )
      select
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', c.role_name, 'label', c.label, 'accountIds', c.account_ids,
            'openingMinor', c.opening_minor::text, 'movementMinor', c.movement_minor::text,
            'closingMinor', c.closing_minor::text, 'amountMinor', c.amount_minor::text)
            order by c.ordinal) from calculated c), '[]'::jsonb) as lines,
        (select jsonb_build_object(
          'openingMinor', coalesce(sum(c.opening_minor), 0)::text,
          'movementMinor', coalesce(sum(c.movement_minor), 0)::text,
          'closingMinor', coalesce(sum(c.closing_minor), 0)::text,
          'amountMinor', coalesce(sum(c.amount_minor), 0)::text) from calculated c) as totals
    `,
    "objects",
  );
}

export function countReportLines(
  transaction: Transaction,
  bookId: string,
  reportId: string,
  limit: number,
) {
  return transaction.execute<{ readonly count: string; readonly inconsistent: boolean }>(
    sql`
      select count(*)::text as count,
        coalesce(bool_or(
          body->>'accountId' is distinct from account_id
          or (body->>'closingMinor')::numeric is distinct from
            (body->>'openingMinor')::numeric + (body->>'debitMinor')::numeric
            - (body->>'creditMinor')::numeric
        ), false) as inconsistent
      from (select account_id, body from openerp.report_lines
        where book_id = ${bookId} and report_id = ${reportId}
        limit ${limit + 1}) bounded
    `,
    "objects",
  );
}

export function readComparisonTotals(transaction: Transaction, bookId: string, reportId: string) {
  return transaction.execute<ComparisonTotalsRow>(
    sql`
      select count(*)::text as count,
        coalesce(sum((body->>'openingMinor')::numeric), 0)::text as "openingMinor",
        coalesce(sum((body->>'debitMinor')::numeric), 0)::text as "debitMinor",
        coalesce(sum((body->>'creditMinor')::numeric), 0)::text as "creditMinor",
        coalesce(sum((body->>'debitMinor')::numeric - (body->>'creditMinor')::numeric), 0)::text
          as "movementMinor",
        coalesce(sum((body->>'closingMinor')::numeric), 0)::text as "closingMinor",
        openerp.digest(jsonb_build_object(
          'lines', coalesce(jsonb_agg(jsonb_build_object('accountId', account_id,
            'digest', openerp.digest(body)) order by account_id collate "C"), '[]'::jsonb)
        )) as digest
      from openerp.report_lines
      where book_id = ${bookId} and report_id = ${reportId}
    `,
    "objects",
  );
}

export function digestHeaderWithLines(
  transaction: Transaction,
  bookId: string,
  reportId: string,
  header: JsonObject,
) {
  return transaction.execute<{ readonly digest: string }>(
    sql`
      select openerp.digest(jsonb_build_object('header', ${JSON.stringify(header)}::jsonb,
        'lines', coalesce(jsonb_agg(jsonb_build_object('accountId', account_id,
          'digest', openerp.digest(body)) order by account_id collate "C"), '[]'::jsonb)
      )) as digest
      from openerp.report_lines
      where book_id = ${bookId} and report_id = ${reportId}
    `,
    "objects",
  );
}

export function comparisonCursorExists(
  transaction: Transaction,
  bookId: string,
  leftId: string,
  rightId: string,
  accountId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.report_lines
        where book_id = ${bookId} and report_id in (${leftId}, ${rightId})
          and account_id = ${accountId}
      ) as present
    `,
    "objects",
  );
}

export function readComparisonPage(
  transaction: Transaction,
  bookId: string,
  leftId: string,
  rightId: string,
  anchor: string,
  limit: number,
) {
  return transaction.execute<ComparisonPageRow>(
    sql`
      with all_accounts as materialized (
        select coalesce(l.account_id, r.account_id) as account_id,
          l.body as left_body, r.body as right_body
        from (
          select account_id, body from openerp.report_lines
          where book_id = ${bookId} and report_id = ${leftId}
        ) l
        full join (
          select account_id, body from openerp.report_lines
          where book_id = ${bookId} and report_id = ${rightId}
        ) r using (account_id)
      ), page as materialized (
        select * from all_accounts
        where account_id collate "C" > ${anchor} collate "C"
        order by account_id collate "C"
        limit ${limit + 1}
      ), shown as (
        select * from page order by account_id collate "C" limit ${limit}
      )
      select
        (select count(*)::text from all_accounts) as "totalAccounts",
        (select count(*)::text from all_accounts
          where left_body is not null and right_body is not null) as "bothPresentCount",
        (select count(*)::text from all_accounts where right_body is null) as "leftOnlyCount",
        (select count(*)::text from all_accounts where left_body is null) as "rightOnlyCount",
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'accountId', s.account_id,
            'presence', case when s.left_body is null then 'right_only'
              when s.right_body is null then 'left_only' else 'both' end,
            'left', case when s.left_body is null then null else
              s.left_body || jsonb_build_object('movementMinor',
                ((s.left_body->>'debitMinor')::numeric - (s.left_body->>'creditMinor')::numeric)::text) end,
            'right', case when s.right_body is null then null else
              s.right_body || jsonb_build_object('movementMinor',
                ((s.right_body->>'debitMinor')::numeric - (s.right_body->>'creditMinor')::numeric)::text) end,
            'labelsChanged', case when s.left_body is null or s.right_body is null then null else
              (s.left_body->>'code', s.left_body->>'name')
                is distinct from (s.right_body->>'code', s.right_body->>'name') end,
            'difference', case when s.left_body is null or s.right_body is null then null else
              jsonb_build_object(
                'openingMinor', ((s.right_body->>'openingMinor')::numeric
                  - (s.left_body->>'openingMinor')::numeric)::text,
                'debitMinor', ((s.right_body->>'debitMinor')::numeric
                  - (s.left_body->>'debitMinor')::numeric)::text,
                'creditMinor', ((s.right_body->>'creditMinor')::numeric
                  - (s.left_body->>'creditMinor')::numeric)::text,
                'movementMinor', ((s.right_body->>'debitMinor')::numeric
                  - (s.right_body->>'creditMinor')::numeric
                  - (s.left_body->>'debitMinor')::numeric
                  + (s.left_body->>'creditMinor')::numeric)::text,
                'closingMinor', ((s.right_body->>'closingMinor')::numeric
                  - (s.left_body->>'closingMinor')::numeric)::text) end
          ) order by s.account_id collate "C") from shown s), '[]'::jsonb) as items,
        (case when (select count(*) from page) > ${limit}
          then (select account_id from shown order by account_id collate "C" desc limit 1)
          end) as next
    `,
    "objects",
  );
}

export function listComparisonAccountIds(
  transaction: Transaction,
  bookId: string,
  leftId: string,
  rightId: string,
  limit: number,
) {
  return transaction.execute<{ readonly accountId: string }>(
    sql`
      select distinct account_id as "accountId"
      from openerp.report_lines
      where book_id = ${bookId} and report_id = any(${textArray([leftId, rightId])})
      limit ${limit + 1}
    `,
    "objects",
  );
}

export function readComparisonMappingRows(
  transaction: Transaction,
  bookId: string,
  reportId: string,
  mapping: JsonObject,
) {
  return transaction.execute<{ readonly unmapped: string; readonly unused: string }>(
    sql`
      select
        (select count(*) from openerp.report_lines l
          where l.book_id = ${bookId} and l.report_id = ${reportId}
            and not exists (
              select 1 from jsonb_array_elements(${JSON.stringify(mapping)}::jsonb->'roles') m
              where m->>'accountId' = l.account_id))::text as unmapped,
        (select count(*) from jsonb_array_elements(${JSON.stringify(mapping)}::jsonb->'roles') m
          where not exists (
            select 1 from openerp.report_lines l
            where l.book_id = ${bookId} and l.report_id = ${reportId}
              and l.account_id = m->>'accountId'))::text as unused
    `,
    "objects",
  );
}

export function digestJson(transaction: Transaction, value: JsonObject) {
  return Effect.map(
    transaction.execute<{ readonly digest: string }>(
      sql`select openerp.digest(${JSON.stringify(value)}::jsonb) as digest`,
      "objects",
    ),
    (rows) => rows[0]?.digest,
  );
}
