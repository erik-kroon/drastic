import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import {
  reportStatementContributions,
  reportStatementRows,
  reportStatementSnapshots,
} from "./schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const statementTables = [
  "report_statement_snapshots",
  "report_statement_rows",
  "report_statement_contributions",
  "books",
  "fiscal_years",
  "periods",
  "accounts",
  "vouchers",
  "journal_lines",
  "historical_bases",
  "closing_transitions",
  "command_receipts",
] as const;

export const statementWriteTables = [
  "report_statement_snapshots",
  "report_statement_rows",
  "report_statement_contributions",
  "command_receipts",
] as const;

export const statementSnapshotPageSize = 100;

export const statementContributionPageSize = 100;

export const statementSnapshotListPageSize = 50;

export const maximumStatementAccounts = 500;

export const maximumStatementComponents = 20000;

export const maximumStatementRows = 400;

// NEXT-13 does not post. A result transfer can only be excluded from ordinary
// profit and loss when an owned transfer receipt exists, and this release
// implements no result-transfer posting operation, so no retained voucher
// currently carries one. An unexplained entry on a transfer role therefore stays
// in the profit and loss and raises a diagnostic instead of erasing activity.
const ownedResultTransferPurposes: ReadonlyArray<string> = [];

export type StatementBookRow = {
  readonly entityId: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly profile: string;
  readonly profileVersion: string;
  readonly committedSequence: string;
};

export type StatementFiscalYearRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
};

export type StatementAccountRow = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly version: string;
};

export type StatementOpeningBaseRow = {
  readonly mode: string;
  readonly sourcePlanId: string;
  readonly openingVoucherId: string | null;
};

export type StatementAmountRow = { readonly accountId: string; readonly minor: string };

export type StatementComponentRow = {
  readonly componentId: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly sequence: string;
  readonly ordinal: number;
  readonly postingDate: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
  readonly ownedTransfer: boolean;
};

export type StatementDigestRow = { readonly digest: string };

export type StatementRowPageRow = {
  readonly scannedCount: string;
  readonly items: JsonObject;
  readonly nextOrdinal: string | null;
};

export type StatementLiveStatusRow = {
  readonly committedSequence: string;
  readonly postingsAfterCutoff: string;
  readonly reopenedAfterCapture: boolean;
};

export type StatementComparisonTotalsRow = {
  readonly amountMinor: string;
  readonly closingMinor: string;
  readonly rightOnlyRows: string;
  readonly leftOnlyRows: string;
};

export type StatementComparisonPageRow = {
  readonly total: string;
  readonly items: JsonObject;
  readonly nextRowId: string | null;
};

export type StatementRowIdentityRow = { readonly rowId: string };

export type StatementSnapshotSummaryRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export function readStatementBook(transaction: Transaction, bookId: string) {
  return transaction.execute<StatementBookRow>(
    sql`
      select entity_id as "entityId", currency, currency_scale as "currencyScale", profile,
        profile_version::text as "profileVersion",
        committed_sequence::text as "committedSequence"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readStatementFiscalYear(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
) {
  return transaction.execute<StatementFiscalYearRow>(
    sql`
      select id, starts_on::text as "startsOn", ends_on::text as "endsOn"
      from openerp.fiscal_years
      where book_id = ${bookId} and id = ${fiscalYearId}
    `,
    "objects",
  );
}

export function readStatementAccounts(transaction: Transaction, bookId: string, limit: number) {
  return transaction.execute<StatementAccountRow>(
    sql`
      select id, code, name, version::text as version
      from openerp.accounts
      where book_id = ${bookId}
      order by id collate "C"
      limit ${limit + 1}
    `,
    "objects",
  );
}

export function readStatementAccountsDigest(transaction: Transaction, bookId: string) {
  return transaction.execute<StatementDigestRow>(
    sql`
      select openerp.digest(coalesce(jsonb_agg(jsonb_build_object('id', a.id,
        'version', a.version::text) order by a.id collate "C"), '[]'::jsonb)) as digest
      from openerp.accounts a where a.book_id = ${bookId}
    `,
    "objects",
  );
}

// An opening_set historical base names the voucher that already represents the
// opening set. It becomes the opening provenance and is excluded from the year's
// movements, so it is never counted twice.
export function readStatementOpeningBase(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
) {
  return transaction.execute<StatementOpeningBaseRow>(
    sql`
      select mode, source_plan_id as "sourcePlanId",
        opening_voucher_id as "openingVoucherId"
      from openerp.historical_bases
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
    `,
    "objects",
  );
}

function excludedVoucher(voucherId: string | null) {
  return voucherId === null ? sql`null::text` : sql`${voucherId}::text`;
}

export function readStatementOpeningLines(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  sequence: string,
  openingVoucherId: string | null,
  limit: number,
) {
  return transaction.execute<StatementAmountRow>(
    sql`
      select l.account_id as "accountId",
        coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as minor
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date < ${startsOn}::date
        and (v.id is distinct from ${excludedVoucher(openingVoucherId)})
      group by l.account_id
      order by l.account_id collate "C"
      limit ${limit + 1}
    `,
    "objects",
  );
}

export function readStatementComponents(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  asOf: string,
  sequence: string,
  openingVoucherId: string | null,
  limit: number,
) {
  return transaction.execute<StatementComponentRow>(
    sql`
      select v.id || '_' || l.ordinal as "componentId", v.id as "voucherId", l.id as "lineId",
        v.sequence::text as sequence, l.ordinal, v.posting_date::text as "postingDate",
        l.account_id as "accountId", l.debit_minor::text as "debitMinor",
        l.credit_minor::text as "creditMinor", l.description,
        v.posting_purpose = any(${ownedResultTransferPurposes}::text[]) as "ownedTransfer"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date between ${startsOn}::date and ${asOf}::date
        and (v.id is distinct from ${excludedVoucher(openingVoucherId)})
      order by v.sequence, l.ordinal
      limit ${limit + 1}
    `,
    "objects",
  );
}

export function insertStatementSnapshot(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly fiscalYearId: string;
    readonly asOf: string;
    readonly sequence: bigint;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(reportStatementSnapshots).values(row);
}

export function insertStatementRows(
  transaction: Transaction,
  rows: Array<{
    bookId: string;
    snapshotId: string;
    ordinal: number;
    rowId: string;
    body: JsonObject;
  }>,
) {
  return transaction.insert(reportStatementRows).values(rows);
}

export function insertStatementContributions(
  transaction: Transaction,
  rows: Array<{
    bookId: string;
    snapshotId: string;
    ordinal: number;
    rowId: string;
    componentId: string;
    body: JsonObject;
  }>,
) {
  return transaction.insert(reportStatementContributions).values(rows);
}

export function readStatementSnapshot(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
) {
  return transaction
    .select({
      id: reportStatementSnapshots.id,
      fiscalYearId: reportStatementSnapshots.fiscalYearId,
      asOf: reportStatementSnapshots.asOf,
      sequence: reportStatementSnapshots.sequence,
      body: reportStatementSnapshots.body,
      createdAt: reportStatementSnapshots.createdAt,
    })
    .from(reportStatementSnapshots)
    .where(
      and(eq(reportStatementSnapshots.bookId, bookId), eq(reportStatementSnapshots.id, snapshotId)),
    );
}

export function listStatementSnapshots(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction
    .select({ id: reportStatementSnapshots.id, body: reportStatementSnapshots.body })
    .from(reportStatementSnapshots)
    .where(
      and(
        eq(reportStatementSnapshots.bookId, bookId),
        sql`${reportStatementSnapshots.id} collate "C" > ${after} collate "C"`,
      ),
    )
    .orderBy(sql`${reportStatementSnapshots.id} collate "C"`)
    .limit(limit);
}

// The scan window is taken from the retained membership before any statement
// filter is applied, so a page that filters every row out still advances while
// unscanned members remain.
export function readStatementRowPage(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  statement: string | null,
  afterOrdinal: number,
  limit: number,
) {
  return transaction.execute<StatementRowPageRow>(
    sql`
      with members as materialized (
        select ordinal, row_id, body
        from openerp.report_statement_rows
        where book_id = ${bookId} and snapshot_id = ${snapshotId}
          and ordinal > ${afterOrdinal}
        order by ordinal
        limit ${limit + 1}
      ), scanned as (
        select ordinal, body from members order by ordinal limit ${limit}
      )
      select
        (select count(*)::text from members) as "scannedCount",
        coalesce((
          select jsonb_agg(scanned.body order by scanned.ordinal)
          from scanned
          where ${statement}::text is null or scanned.body->>'statement' = ${statement}
        ), '[]'::jsonb) as items,
        (case when (select count(*) from members) > ${limit}
          then (select ordinal::text from scanned order by ordinal desc limit 1)
        end) as "nextOrdinal"
    `,
    "objects",
  );
}

export function readStatementRowAnchor(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  ordinal: number,
) {
  return transaction
    .select({ ordinal: reportStatementRows.ordinal })
    .from(reportStatementRows)
    .where(
      and(
        eq(reportStatementRows.bookId, bookId),
        eq(reportStatementRows.snapshotId, snapshotId),
        eq(reportStatementRows.ordinal, ordinal),
      ),
    )
    .limit(1);
}

export function readStatementRow(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  rowId: string,
) {
  return transaction
    .select({ ordinal: reportStatementRows.ordinal, body: reportStatementRows.body })
    .from(reportStatementRows)
    .where(
      and(
        eq(reportStatementRows.bookId, bookId),
        eq(reportStatementRows.snapshotId, snapshotId),
        eq(reportStatementRows.rowId, rowId),
      ),
    )
    .limit(1);
}

export function countStatementContributions(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  rowId: string,
) {
  return transaction.execute<{ readonly total: string }>(
    sql`
      select count(*)::text as total
      from openerp.report_statement_contributions
      where book_id = ${bookId} and snapshot_id = ${snapshotId} and row_id = ${rowId}
    `,
    "objects",
  );
}

export function readStatementContributionPage(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  rowId: string,
  afterOrdinal: number,
  limit: number,
) {
  return transaction
    .select({
      ordinal: reportStatementContributions.ordinal,
      body: reportStatementContributions.body,
    })
    .from(reportStatementContributions)
    .where(
      and(
        eq(reportStatementContributions.bookId, bookId),
        eq(reportStatementContributions.snapshotId, snapshotId),
        eq(reportStatementContributions.rowId, rowId),
        gt(reportStatementContributions.ordinal, afterOrdinal),
      ),
    )
    .orderBy(asc(reportStatementContributions.ordinal))
    .limit(limit);
}

// The contribution anchor must name a contribution that this row really retained,
// so one row's cursor can never continue inside another row.
export function readStatementContributionAnchor(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  rowId: string,
  ordinal: number,
) {
  return transaction
    .select({ ordinal: reportStatementContributions.ordinal })
    .from(reportStatementContributions)
    .where(
      and(
        eq(reportStatementContributions.bookId, bookId),
        eq(reportStatementContributions.snapshotId, snapshotId),
        eq(reportStatementContributions.rowId, rowId),
        eq(reportStatementContributions.ordinal, ordinal),
      ),
    )
    .limit(1);
}

// A comparison anchor must be a row identity that one of the two snapshots
// really retained, so a later backdated posting cannot invent a comparison page.
export function readStatementRowIdentity(
  transaction: Transaction,
  bookId: string,
  leftId: string,
  rightId: string,
  rowId: string,
) {
  return transaction
    .select({ rowId: reportStatementRows.rowId })
    .from(reportStatementRows)
    .where(
      and(
        eq(reportStatementRows.bookId, bookId),
        inArray(reportStatementRows.snapshotId, [leftId, rightId]),
        eq(reportStatementRows.rowId, rowId),
      ),
    )
    .limit(1);
}

// The computed virtual result has no journal contribution. Its explanation points
// at the retained profit-and-loss rows that produced it.
export function listStatementRowIds(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  statement: string,
  limit: number,
) {
  return transaction
    .select({ rowId: reportStatementRows.rowId })
    .from(reportStatementRows)
    .where(
      and(
        eq(reportStatementRows.bookId, bookId),
        eq(reportStatementRows.snapshotId, snapshotId),
        sql`${reportStatementRows.body}->>'statement' = ${statement}`,
      ),
    )
    .orderBy(asc(reportStatementRows.ordinal))
    .limit(limit);
}

export function readStatementLiveStatus(
  transaction: Transaction,
  bookId: string,
  sequence: string,
  asOf: string,
  createdAt: string,
) {
  return transaction.execute<StatementLiveStatusRow>(
    sql`
      select
        (select committed_sequence::text from openerp.books where id = ${bookId})
          as "committedSequence",
        (select count(*)::text from openerp.vouchers
          where book_id = ${bookId} and sequence > ${sequence}::bigint) as "postingsAfterCutoff",
        exists (
          select 1 from openerp.closing_transitions t
          join openerp.periods p on p.book_id = t.book_id and p.id = t.period_id
          where t.book_id = ${bookId} and t.body->>'action' = 'reopen'
            and t.committed_at > ${createdAt}::timestamptz and p.ends_on >= ${asOf}::date
        ) as "reopenedAfterCapture"
    `,
    "objects",
  );
}

export function readStatementComparisonPage(
  transaction: Transaction,
  bookId: string,
  leftId: string,
  rightId: string,
  afterRowId: string,
  limit: number,
) {
  return transaction.execute<StatementComparisonPageRow>(
    sql`
      with members as materialized (
        select row_id,
          (select l.body from openerp.report_statement_rows l
            where l.book_id = ${bookId} and l.snapshot_id = ${leftId}
              and l.row_id = r.row_id) as left_body,
          (select r2.body from openerp.report_statement_rows r2
            where r2.book_id = ${bookId} and r2.snapshot_id = ${rightId}
              and r2.row_id = r.row_id) as right_body
        from openerp.report_statement_rows r
        where r.book_id = ${bookId} and r.snapshot_id in (${leftId}, ${rightId})
        order by r.row_id collate "C"
      ), window as (
        select * from members where row_id collate "C" > ${afterRowId} collate "C"
        order by row_id collate "C" limit ${limit + 1}
      ), scanned as (
        select * from window order by row_id collate "C" limit ${limit}
      )
      select
        (select count(*)::text from members) as total,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'rowId', s.row_id,
            'presence', case when s.left_body is null then 'right_only'
              when s.right_body is null then 'left_only' else 'both' end,
            'left', s.left_body,
            'right', s.right_body
          ) order by s.row_id collate "C") from scanned s
        ), '[]'::jsonb) as items,
        (case when (select count(*) from window) > ${limit}
          then (select row_id from scanned order by row_id collate "C" desc limit 1)
        end) as "nextRowId"
    `,
    "objects",
  );
}

// Full retained-set totals, never page totals. A difference is only meaningful when
// both snapshots retained exactly the same row identities.
export function readStatementComparisonTotals(
  transaction: Transaction,
  bookId: string,
  leftId: string,
  rightId: string,
) {
  return transaction.execute<StatementComparisonTotalsRow>(
    sql`
      with members as (
        select row_id,
          (select l.body->>'amountMinor' from openerp.report_statement_rows l
            where l.book_id = ${bookId} and l.snapshot_id = ${leftId}
              and l.row_id = r.row_id) as left_amount,
          (select l.body->>'amountMinor' from openerp.report_statement_rows l
            where l.book_id = ${bookId} and l.snapshot_id = ${leftId}
              and l.row_id = r.row_id) as left_closing,
          (select r2.body->>'amountMinor' from openerp.report_statement_rows r2
            where r2.book_id = ${bookId} and r2.snapshot_id = ${rightId}
              and r2.row_id = r.row_id) as right_amount,
          (select r2.body->>'amountMinor' from openerp.report_statement_rows r2
            where r2.book_id = ${bookId} and r2.snapshot_id = ${rightId}
              and r2.row_id = r.row_id) as right_closing
        from openerp.report_statement_rows r
        where r.book_id = ${bookId} and r.snapshot_id in (${leftId}, ${rightId})
      )
      select
        coalesce(sum(coalesce(left_amount, '0')::numeric), 0)::text as "amountMinor",
        coalesce(sum(coalesce(left_closing, '0')::numeric), 0)::text as "closingMinor",
        count(*) filter (where left_amount is null)::text as "rightOnlyRows",
        count(*) filter (where right_amount is null)::text as "leftOnlyRows"
      from members
    `,
    "objects",
  );
}

export function digestStatementSnapshot(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
) {
  return transaction.execute<StatementDigestRow>(
    sql`
      select openerp.digest(jsonb_build_object(
        'header', (select body from openerp.report_statement_snapshots
          where book_id = ${bookId} and id = ${snapshotId}),
        'rows', coalesce((select jsonb_agg(jsonb_build_object('ordinal', r.ordinal,
          'digest', openerp.digest(r.body)) order by r.ordinal)
          from openerp.report_statement_rows r
          where r.book_id = ${bookId} and r.snapshot_id = ${snapshotId}), '[]'::jsonb),
        'contributions', coalesce((select jsonb_agg(jsonb_build_object('ordinal', c.ordinal,
          'digest', openerp.digest(c.body)) order by c.ordinal)
          from openerp.report_statement_contributions c
          where c.book_id = ${bookId} and c.snapshot_id = ${snapshotId}), '[]'::jsonb)
      )) as digest
    `,
    "objects",
  );
}
