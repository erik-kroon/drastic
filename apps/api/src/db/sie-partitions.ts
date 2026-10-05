import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Contracts from "@open-erp/contracts/sie-partitions";
import type { Transaction } from "./transaction";

type BodyRow = { readonly body: Schema.JsonObject };

export function readPartition(tx: Transaction, bookId: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.sie_source_year_partitions where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readForPreview(tx: Transaction, bookId: string, previewId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.sie_source_year_partitions where book_id=${bookId} and preview_id=${previewId}`,
    "objects",
  );
}

export function insertPartition(
  tx: Transaction,
  bookId: string,
  partition: typeof Contracts.Partition.Type,
) {
  return tx.execute(
    sql`insert into openerp.sie_source_year_partitions(book_id,id,preview_id,source_plan_id,digest,body) values(${bookId},${partition.id},${partition.input.previewId},${partition.input.sourcePlanId},${partition.digest},${JSON.stringify(partition)}::jsonb)`,
    "objects",
  );
}

export function readYearComparisons(tx: Transaction, bookId: string, runId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.sie_financial_year_comparisons where book_id=${bookId} and run_id=${runId} order by year_ordinal`,
    "objects",
  );
}

export function insertYearComparison(
  tx: Transaction,
  bookId: string,
  runId: string,
  yearOrdinal: number,
  yearId: string,
  sequence: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.sie_financial_year_comparisons(book_id,run_id,year_ordinal,fiscal_year_id,book_sequence,body) values(${bookId},${runId},${yearOrdinal},${yearId},${sequence}::bigint,${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function readObjectBalances(tx: Transaction, bookId: string, asOf: string) {
  return tx.execute<{
    readonly accountId: string;
    readonly dimensionCode: string;
    readonly valueCode: string;
    readonly amount: string;
  }>(
    sql`
    select l.account_id as "accountId", d.dimension_code as "dimensionCode", d.value_code as "valueCode", sum(l.debit_minor-l.credit_minor)::text as amount
    from openerp.journal_lines l join openerp.vouchers v on v.book_id=l.book_id and v.id=l.voucher_id
    join openerp.journal_line_dimensions d on d.book_id=l.book_id and d.voucher_id=l.voucher_id and d.line_id=l.id
    where l.book_id=${bookId} and v.posting_date<=${asOf}::date and d.status='explicit'
    group by l.account_id,d.dimension_code,d.value_code`,
    "objects",
  );
}
