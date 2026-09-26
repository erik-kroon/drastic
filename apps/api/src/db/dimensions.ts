import { sql } from "drizzle-orm";
import { readTableAccess } from "./commerce/access";
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
