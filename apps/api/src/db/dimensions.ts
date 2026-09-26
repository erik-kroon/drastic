import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Dimensions from "@open-erp/domain/dimensions";
import { readTableAccess } from "./commerce/access";
import { journalLineDimensions, vouchers } from "./schema";
import type { Transaction } from "./transaction";

export type DimensionRow = {
  readonly code: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly archived: boolean;
  readonly revision: number;
};

export type DimensionValueRow = {
  readonly dimensionCode: string;
  readonly code: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly archived: boolean;
  readonly revision: number;
};

export type DimensionRevisionRow = {
  readonly code: string;
  readonly revision: number;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly archived: boolean;
};

export type DimensionValueRevisionRow = DimensionRevisionRow & {
  readonly dimensionCode: string;
};

export type DimensionHeadRow = {
  readonly currentRevision: number;
};

export type CatalogueFilters = {
  readonly code: string;
  readonly dimensionCode: string;
  readonly valueCode: string;
};

export const dimensionTables = [
  "dimensions",
  "dimension_values",
  "dimension_revisions",
  "dimension_value_revisions",
  "command_receipts",
] as const;

// The assignment store is separate from the catalogue: the catalogue is edited
// by its own reviewed operation, and an original assignment is only ever
// appended by the posting transaction that writes the line.
export const assignmentTables = ["journal_line_dimensions"] as const;

// A selection that would exceed this bound is refused rather than truncated, so
// a projection can never report a partition of partial money.
export const maximumAssignmentRows = 20000;

export type AssignmentRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly dimensionCode: string;
  readonly dimensionRevision: number;
  readonly status: Dimensions.OriginalDimensionStatus;
  readonly valueCode: string | null;
  readonly valueRevision: number | null;
  readonly capturedLabel: string;
  readonly exemptionEvidenceId: string | null;
  readonly sourceValueCode: string | null;
  readonly inheritedFromVoucherId: string | null;
  readonly inheritedFromLineId: string | null;
};

const assignmentColumns = {
  voucherId: journalLineDimensions.voucherId,
  lineId: journalLineDimensions.lineId,
  dimensionCode: journalLineDimensions.dimensionCode,
  dimensionRevision: journalLineDimensions.dimensionRevision,
  status: journalLineDimensions.status,
  valueCode: journalLineDimensions.valueCode,
  valueRevision: journalLineDimensions.valueRevision,
  capturedLabel: journalLineDimensions.capturedLabel,
  exemptionEvidenceId: journalLineDimensions.exemptionEvidenceId,
  sourceValueCode: journalLineDimensions.sourceValueCode,
  inheritedFromVoucherId: journalLineDimensions.inheritedFromVoucherId,
  inheritedFromLineId: journalLineDimensions.inheritedFromLineId,
};

function chunk<V>(values: ReadonlyArray<V>, size: number) {
  const chunks: Array<Array<V>> = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

export function readCatalogueAccess(transaction: Transaction) {
  return readTableAccess(transaction, dimensionTables);
}

export function readDimensions(transaction: Transaction, bookId: string) {
  return transaction.execute<DimensionRow>(
    sql`
      select code, name, effective_from as "effectiveFrom", effective_to as "effectiveTo",
        archived_at is not null as archived, current_revision as revision
      from openerp.dimensions
      where book_id = ${bookId}
      order by code collate "C"
    `,
    "objects",
  );
}

export function readDimensionValues(transaction: Transaction, bookId: string) {
  return transaction.execute<DimensionValueRow>(
    sql`
      select dimension_code as "dimensionCode", code, name,
        effective_from as "effectiveFrom", effective_to as "effectiveTo",
        archived_at is not null as archived, current_revision as revision
      from openerp.dimension_values
      where book_id = ${bookId}
      order by dimension_code collate "C", code collate "C"
    `,
    "objects",
  );
}

export function readDimensionRevisions(transaction: Transaction, bookId: string) {
  return transaction.execute<DimensionRevisionRow>(
    sql`
      select code, revision, name, effective_from as "effectiveFrom",
        effective_to as "effectiveTo", archived_at is not null as archived
      from openerp.dimension_revisions
      where book_id = ${bookId}
      order by code collate "C", revision
    `,
    "objects",
  );
}

export function readDimensionValueRevisions(transaction: Transaction, bookId: string) {
  return transaction.execute<DimensionValueRevisionRow>(
    sql`
      select dimension_code as "dimensionCode", code, revision, name,
        effective_from as "effectiveFrom", effective_to as "effectiveTo",
        archived_at is not null as archived
      from openerp.dimension_value_revisions
      where book_id = ${bookId}
      order by dimension_code collate "C", code collate "C", revision
    `,
    "objects",
  );
}

export function lockDimensionRevision(
  transaction: Transaction,
  bookId: string,
  filter: CatalogueFilters,
) {
  return transaction.execute<DimensionHeadRow>(
    sql`
      select current_revision as "currentRevision"
      from openerp.dimensions
      where book_id = ${bookId} and code = ${filter.code}
      for update
    `,
    "objects",
  );
}

export function lockDimensionValueRevision(
  transaction: Transaction,
  bookId: string,
  filter: CatalogueFilters,
) {
  return transaction.execute<DimensionHeadRow>(
    sql`
      select current_revision as "currentRevision"
      from openerp.dimension_values
      where book_id = ${bookId} and dimension_code = ${filter.dimensionCode}
        and code = ${filter.valueCode}
      for update
    `,
    "objects",
  );
}

export function readDimensionHead(
  transaction: Transaction,
  bookId: string,
  filter: CatalogueFilters,
) {
  return transaction.execute<{ readonly code: string }>(
    sql`
      select code from openerp.dimensions
      where book_id = ${bookId} and code = ${filter.code}
      for share
    `,
    "objects",
  );
}

export type RevisionWrite = {
  readonly bookId: string;
  readonly code: string;
  readonly revision: number;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly archived: boolean;
};

export type ValueRevisionWrite = Omit<RevisionWrite, "code"> & {
  readonly dimensionCode: string;
  readonly code: string;
};

export function insertDimension(transaction: Transaction, row: RevisionWrite) {
  return transaction.execute(
    sql`
      insert into openerp.dimensions
        (book_id, code, name, effective_from, effective_to, archived_at, current_revision)
      values (${row.bookId}, ${row.code}, ${row.name}, ${row.effectiveFrom}::date,
        ${row.effectiveTo}::date, case when ${row.archived} then statement_timestamp() end,
        ${row.revision})
    `,
    "objects",
  );
}

export function updateDimension(transaction: Transaction, row: RevisionWrite) {
  return transaction.execute(
    sql`
      update openerp.dimensions
      set name = ${row.name}, effective_from = ${row.effectiveFrom}::date,
        effective_to = ${row.effectiveTo}::date,
        archived_at = case when ${row.archived} then coalesce(archived_at, statement_timestamp()) end,
        current_revision = ${row.revision}
      where book_id = ${row.bookId} and code = ${row.code}
    `,
    "objects",
  );
}

export function insertDimensionRevision(transaction: Transaction, row: RevisionWrite) {
  return transaction.execute(
    sql`
      insert into openerp.dimension_revisions
        (book_id, code, revision, name, effective_from, effective_to, archived_at)
      values (${row.bookId}, ${row.code}, ${row.revision}, ${row.name},
        ${row.effectiveFrom}::date, ${row.effectiveTo}::date,
        case when ${row.archived} then statement_timestamp() end)
    `,
    "objects",
  );
}

export function insertDimensionValue(transaction: Transaction, row: ValueRevisionWrite) {
  return transaction.execute(
    sql`
      insert into openerp.dimension_values
        (book_id, dimension_code, code, name, effective_from, effective_to, archived_at, current_revision)
      values (${row.bookId}, ${row.dimensionCode}, ${row.code}, ${row.name},
        ${row.effectiveFrom}::date, ${row.effectiveTo}::date,
        case when ${row.archived} then statement_timestamp() end, ${row.revision})
    `,
    "objects",
  );
}

export function updateDimensionValue(transaction: Transaction, row: ValueRevisionWrite) {
  return transaction.execute(
    sql`
      update openerp.dimension_values
      set name = ${row.name}, effective_from = ${row.effectiveFrom}::date,
        effective_to = ${row.effectiveTo}::date,
        archived_at = case when ${row.archived} then coalesce(archived_at, statement_timestamp()) end,
        current_revision = ${row.revision}
      where book_id = ${row.bookId} and dimension_code = ${row.dimensionCode} and code = ${row.code}
    `,
    "objects",
  );
}

export function insertDimensionValueRevision(transaction: Transaction, row: ValueRevisionWrite) {
  return transaction.execute(
    sql`
      insert into openerp.dimension_value_revisions
        (book_id, dimension_code, code, revision, name, effective_from, effective_to, archived_at)
      values (${row.bookId}, ${row.dimensionCode}, ${row.code}, ${row.revision}, ${row.name},
        ${row.effectiveFrom}::date, ${row.effectiveTo}::date,
        case when ${row.archived} then statement_timestamp() end)
    `,
    "objects",
  );
}

function effectiveWindow(onDate: string) {
  return sql`effective_from <= ${onDate}::date and (effective_to is null or effective_to >= ${onDate}::date)`;
}

// The catalogue as it stands on one posting date. Both reads take a share lock
// so a catalogue revision cannot be archived between the preparation capture and
// the execution check inside the same financial transaction.
export function readEffectiveDimensions(transaction: Transaction, bookId: string, onDate: string) {
  return transaction.execute<Dimensions.CatalogueDimension>(
    sql`
      select code, current_revision as revision, name, effective_from as "effectiveFrom",
        effective_to as "effectiveTo", archived_at is not null as archived
      from openerp.dimensions
      where book_id = ${bookId} and ${effectiveWindow(onDate)}
      order by code collate "C"
      for share
    `,
    "objects",
  );
}

export function readEffectiveDimensionValues(
  transaction: Transaction,
  bookId: string,
  onDate: string,
) {
  return transaction.execute<Dimensions.CatalogueValue>(
    sql`
      select dimension_code as "dimensionCode", code, current_revision as revision, name,
        effective_from as "effectiveFrom", effective_to as "effectiveTo",
        archived_at is not null as archived
      from openerp.dimension_values
      where book_id = ${bookId} and ${effectiveWindow(onDate)}
      order by dimension_code collate "C", code collate "C"
      for share
    `,
    "objects",
  );
}

export function readOriginalAssignments(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction
    .select(assignmentColumns)
    .from(journalLineDimensions)
    .where(
      and(eq(journalLineDimensions.bookId, bookId), eq(journalLineDimensions.voucherId, voucherId)),
    )
    .orderBy(asc(journalLineDimensions.lineId), asc(journalLineDimensions.dimensionCode));
}

const retainedAssignmentColumns = {
  voucherId: journalLineDimensions.voucherId,
  lineId: journalLineDimensions.lineId,
  dimensionCode: journalLineDimensions.dimensionCode,
  dimensionRevision: journalLineDimensions.dimensionRevision,
  status: journalLineDimensions.status,
  valueCode: journalLineDimensions.valueCode,
  valueRevision: journalLineDimensions.valueRevision,
  capturedLabel: journalLineDimensions.capturedLabel,
  exemptionEvidenceId: journalLineDimensions.exemptionEvidenceId,
  sourceValueCode: journalLineDimensions.sourceValueCode,
};

function windowJoin() {
  return and(
    eq(journalLineDimensions.bookId, vouchers.bookId),
    eq(journalLineDimensions.voucherId, vouchers.id),
  );
}

function windowFilter(bookId: string, from: string, to: string) {
  return and(
    eq(journalLineDimensions.bookId, bookId),
    gte(vouchers.postingDate, from),
    lte(vouchers.postingDate, to),
  );
}

// The retained assignments of every posted line dated inside one window, plus
// the exact signed amount each line contributes. Both reads are bounded: a
// selection that would exceed the bound is refused by the caller rather than
// truncated, because a partition of partial money is not a partition.
export function readOriginalAssignmentsInWindow(
  transaction: Transaction,
  bookId: string,
  from: string,
  to: string,
  limit: number,
) {
  return transaction
    .select(retainedAssignmentColumns)
    .from(journalLineDimensions)
    .innerJoin(vouchers, windowJoin())
    .where(windowFilter(bookId, from, to))
    .orderBy(
      asc(vouchers.sequence),
      asc(journalLineDimensions.lineId),
      asc(journalLineDimensions.dimensionCode),
    )
    .limit(limit);
}

export type ContributionRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly signedMinor: string;
};

export function readAssignmentContributions(
  transaction: Transaction,
  bookId: string,
  from: string,
  to: string,
  limit: number,
) {
  return transaction.execute<ContributionRow>(
    sql`
      select l.voucher_id as "voucherId", l.id as "lineId",
        (l.debit_minor - l.credit_minor)::text as "signedMinor"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId}
        and v.posting_date between ${from}::date and ${to}::date
      order by v.sequence, l.ordinal
      limit ${limit + 1}
    `,
    "objects",
  );
}

export type AssignmentWrite = {
  readonly bookId: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly dimensionCode: string;
  readonly dimensionRevision: number;
  readonly status: Dimensions.OriginalDimensionStatus;
  readonly valueCode: string | null;
  readonly valueRevision: number | null;
  readonly capturedLabel: string;
  readonly exemptionEvidenceId: string | null;
  readonly sourceValueCode: string | null;
  readonly inheritedFromVoucherId: string | null;
  readonly inheritedFromLineId: string | null;
};

export function insertOriginalAssignmentsBatch(
  transaction: Transaction,
  rows: ReadonlyArray<AssignmentWrite>,
) {
  return Effect.forEach(chunk(rows, 500), (batch) =>
    transaction.insert(journalLineDimensions).values(batch),
  );
}
