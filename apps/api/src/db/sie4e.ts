import { and, asc, eq, sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import { sieBookExportRows, sieBookExports } from "./schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

// The frozen opening representation itself is read through the released NEXT-13
// statement owner, so a statement snapshot and a complete-book export can never
// disagree about which opening basis a fiscal year has.
export const sieBookTables = [
  "sie_book_exports",
  "sie_book_export_rows",
  "sie_book_export_artifacts",
  "books",
  "fiscal_years",
  "accounts",
  "vouchers",
  "journal_lines",
  "historical_bases",
  "dimensions",
  "evidence",
  "command_receipts",
] as const;

export const sieBookWriteTables = [
  "sie_book_exports",
  "sie_book_export_rows",
  "sie_book_export_artifacts",
  "command_receipts",
] as const;

export const sieBookRowPageSize = 100;

export const sieBookListPageSize = 25;

export const maximumSieBookAccounts = 500;

export const maximumSieBookLines = 20000;

export type SieBookRow = { readonly ordinal: string; readonly body: JsonObject };

export type SieBookExportRow = {
  readonly id: string;
  readonly ordinal: string;
  readonly evidenceId: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type SieBookArtifactRow = {
  readonly descriptor: JsonObject;
  readonly content: Uint8Array;
};

export type SieBookListRow = {
  readonly id: string;
  readonly ordinal: string;
  readonly body: JsonObject;
  readonly artifactAttached: boolean;
};

export type SieBookFiscalYearRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
};

export type SieBookOrdinalRow = { readonly ordinal: string | null };

export type SieBookTotalRow = { readonly total: number };

export type SieBookDimensionRow = { readonly code: string };

export type SieBookPriorVoucherRow = { readonly present: boolean };

export function readSieBookBook(transaction: Transaction, bookId: string) {
  return transaction.execute<{
    readonly entityId: string;
    readonly currency: string;
    readonly currencyScale: number;
    readonly profile: string;
    readonly authority: string;
    readonly committedSequence: string;
  }>(
    sql`
      select entity_id as "entityId", currency, currency_scale as "currencyScale", profile,
        authority, committed_sequence::text as "committedSequence"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readSieBookFiscalYear(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
) {
  return transaction.execute<SieBookFiscalYearRow>(
    sql`
      select id, starts_on::text as "startsOn", ends_on::text as "endsOn"
      from openerp.fiscal_years
      where book_id = ${bookId} and id = ${fiscalYearId}
    `,
    "objects",
  );
}

// The complete declared account set, including inactive accounts that selected
// history still uses. The export never drops an account to make a file smaller.
export function readSieBookAccounts(transaction: Transaction, bookId: string, limit: number) {
  return transaction.execute<{
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly active: boolean;
    readonly version: string;
  }>(
    sql`
      select id, code, name, active, version::text as version
      from openerp.accounts
      where book_id = ${bookId}
      order by id collate "C"
      limit ${limit + 1}
    `,
    "objects",
  );
}

// A book that already carries committed vouchers before the fiscal year start has
// a real prior native balance. A book whose first year starts empty does not, and
// a first-year zero opening is never inferred from that absence.
export function readSieBookPriorVoucher(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  sequence: string,
) {
  return transaction.execute<SieBookPriorVoucherRow>(
    sql`
      select exists (
        select 1 from openerp.vouchers
        where book_id = ${bookId} and sequence <= ${sequence}::bigint
          and posting_date < ${startsOn}::date
      ) as present
    `,
    "objects",
  );
}

// The complete selected-year membership at the captured ledger boundary. The
// scope is the date window, so a voucher dated inside the window but labelled
// with another fiscal year is returned and refused by the application rather
// than silently dropped.
export function readSieBookLines(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  asOf: string,
  sequence: string,
  openingVoucherId: string | null,
  limit: number,
) {
  return transaction.execute<{
    readonly voucherId: string;
    readonly lineId: string;
    readonly ordinal: number;
    readonly sequence: string;
    readonly fiscalYearId: string;
    readonly series: string;
    readonly number: string;
    readonly postingDate: string;
    readonly eventId: string;
    readonly changeSetId: string;
    readonly correctsVoucherId: string | null;
    readonly accountId: string;
    readonly accountCode: string;
    readonly debitMinor: string;
    readonly creditMinor: string;
    readonly description: string;
  }>(
    sql`
      select v.id as "voucherId", l.id as "lineId", l.ordinal,
        v.sequence::text as sequence, v.fiscal_year_id as "fiscalYearId", v.series,
        v.number::text as number, v.posting_date::text as "postingDate", v.event_id as "eventId",
        v.change_set_id as "changeSetId", v.corrects_voucher_id as "correctsVoucherId",
        l.account_id as "accountId", a.code as "accountCode",
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        l.description
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      join openerp.accounts a on a.book_id = l.book_id and a.id = l.account_id
      where l.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date between ${startsOn}::date and ${asOf}::date
        and (v.id is distinct from ${openingVoucherId === null ? sql`null::text` : sql`${openingVoucherId}::text`})
      order by v.sequence, l.ordinal
      limit ${limit + 1}
    `,
    "objects",
  );
}

// A dimension declaration is enough to block the export. This release has no
// reviewed dimension-assignment owner, so no object mapping can be emitted and
// an empty object group is not a substitute.
export function readSieBookDimensions(transaction: Transaction, bookId: string, asOf: string) {
  return transaction.execute<SieBookDimensionRow>(
    sql`
      select code from openerp.dimensions
      where book_id = ${bookId} and effective_from <= ${asOf}::date
        and (effective_to is null or effective_to >= ${asOf}::date)
      order by code collate "C"
      limit 501
    `,
    "objects",
  );
}

export function readSieBookHighestOrdinal(transaction: Transaction, bookId: string) {
  return transaction.execute<SieBookOrdinalRow>(
    sql`
      select max(ordinal)::text as ordinal from openerp.sie_book_exports
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function insertSieBookExport(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ordinal: bigint;
    readonly fiscalYearId: string;
    readonly asOf: string;
    readonly sequence: bigint;
    readonly evidenceId: string;
    readonly actorId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(sieBookExports).values(row);
}

export function insertSieBookExportRows(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly exportId: string;
    readonly ordinal: number;
    readonly rowId: string;
    readonly body: JsonObject;
  }>,
) {
  return transaction.insert(sieBookExportRows).values([...rows]);
}

export function insertSieBookExportArtifact(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly exportId: string;
    readonly descriptor: JsonObject;
    readonly content: Uint8Array;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.sie_book_export_artifacts (book_id, export_id, descriptor, content)
      values (${row.bookId}, ${row.exportId}, ${JSON.stringify(row.descriptor)}::jsonb,
        ${row.content}::bytea)
    `,
    "objects",
  );
}

export function readSieBookExport(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({
      id: sieBookExports.id,
      ordinal: sieBookExports.ordinal,
      evidenceId: sieBookExports.evidenceId,
      actorId: sieBookExports.actorId,
      body: sieBookExports.body,
    })
    .from(sieBookExports)
    .where(and(eq(sieBookExports.bookId, bookId), eq(sieBookExports.id, id)));
}

export function readSieBookArtifact(transaction: Transaction, bookId: string, exportId: string) {
  return transaction.execute<SieBookArtifactRow>(
    sql`
      select descriptor, content from openerp.sie_book_export_artifacts
      where book_id = ${bookId} and export_id = ${exportId}
    `,
    "objects",
  );
}

// The whole frozen membership, used to render and to re-check retained bytes.
export function readSieBookAllRows(transaction: Transaction, bookId: string, exportId: string) {
  return transaction
    .select({ ordinal: sieBookExportRows.ordinal, body: sieBookExportRows.body })
    .from(sieBookExportRows)
    .where(and(eq(sieBookExportRows.bookId, bookId), eq(sieBookExportRows.exportId, exportId)))
    .orderBy(asc(sieBookExportRows.ordinal))
    .limit(maximumSieBookLines * 2 + 1);
}

export function countSieBookRows(transaction: Transaction, bookId: string, exportId: string) {
  return transaction.execute<SieBookTotalRow>(
    sql`
      select count(*)::integer as total from openerp.sie_book_export_rows
      where book_id = ${bookId} and export_id = ${exportId}
    `,
    "objects",
  );
}

// The scan window is the retained membership, so a page always advances while
// unscanned members remain.
export function readSieBookRowPage(
  transaction: Transaction,
  bookId: string,
  exportId: string,
  afterOrdinal: number,
  limit: number,
) {
  return transaction.execute<{
    readonly items: JsonObject;
    readonly nextOrdinal: string | null;
  }>(
    sql`
      with members as materialized (
        select ordinal, body from openerp.sie_book_export_rows
        where book_id = ${bookId} and export_id = ${exportId} and ordinal > ${afterOrdinal}
        order by ordinal
        limit ${limit + 1}
      ), scanned as (
        select ordinal, body from members order by ordinal limit ${limit}
      )
      select
        coalesce((select jsonb_agg(scanned.body order by scanned.ordinal) from scanned),
          '[]'::jsonb) as items,
        (case when (select count(*) from members) > ${limit}
          then (select ordinal::text from scanned order by ordinal desc limit 1)
        end) as "nextOrdinal"
    `,
    "objects",
  );
}

// The page anchor must name a row this export really retained, so one cursor can
// never continue inside another export.
export function readSieBookRowAnchor(
  transaction: Transaction,
  bookId: string,
  exportId: string,
  ordinal: number,
) {
  return transaction
    .select({ ordinal: sieBookExportRows.ordinal })
    .from(sieBookExportRows)
    .where(
      and(
        eq(sieBookExportRows.bookId, bookId),
        eq(sieBookExportRows.exportId, exportId),
        eq(sieBookExportRows.ordinal, ordinal),
      ),
    )
    .limit(1);
}

export function countSieBookExports(transaction: Transaction, bookId: string, cutoff: bigint) {
  return transaction.execute<SieBookTotalRow>(
    sql`
      select count(*)::integer as total from openerp.sie_book_exports
      where book_id = ${bookId} and ordinal <= ${cutoff.toString()}::bigint
    `,
    "objects",
  );
}

export function listSieBookExports(
  transaction: Transaction,
  bookId: string,
  after: bigint,
  cutoff: bigint,
  limit: number,
) {
  return transaction.execute<SieBookListRow>(
    sql`
      select e.id, e.ordinal::text as ordinal, e.body,
        exists (select 1 from openerp.sie_book_export_artifacts a
          where a.book_id = e.book_id and a.export_id = e.id) as "artifactAttached"
      from openerp.sie_book_exports e
      where e.book_id = ${bookId} and e.ordinal > ${after.toString()}::bigint
        and e.ordinal <= ${cutoff.toString()}::bigint
      order by e.ordinal
      limit ${limit + 1}
    `,
    "objects",
  );
}
