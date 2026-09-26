import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";

export type AssessmentFenceRow = {
  readonly profile: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly withdrawn: boolean;
  readonly duplicate: boolean;
  readonly ambiguous: boolean;
};

export function readAssessmentFences(
  transaction: Transaction,
  bookId: string,
  sourceId: string,
  evidenceSha256: string,
  sourceLocator: string,
  voucherId: string | null,
) {
  return transaction.execute<AssessmentFenceRow>(
    sql`
      select b.profile, b.currency, b.currency_scale as "currencyScale",
        exists (
          select 1 from openerp.expense_tax_source_withdrawals w
          where w.book_id = ${bookId} and w.source_id = ${sourceId}
        ) as withdrawn,
        exists (
          select 1 from openerp.expense_tax_sources s
          join lateral (
            select x.body from openerp.expense_tax_source_revisions x
            where x.book_id = ${bookId} and x.source_id = s.id
            order by x.revision desc limit 1
          ) latest on true
          where s.book_id = ${bookId} and s.id <> ${sourceId}
            and not exists (
              select 1 from openerp.expense_tax_source_withdrawals w
              where w.book_id = ${bookId} and w.source_id = s.id
            )
            and latest.body->>'evidenceSha256' = ${evidenceSha256}
            and latest.body->'facts'->>'sourceLocator' = ${sourceLocator}
        ) as duplicate,
        exists (
          select 1 from openerp.expense_tax_sources s
          join lateral (
            select x.voucher_id from openerp.expense_tax_source_revisions x
            where x.book_id = ${bookId} and x.source_id = s.id
            order by x.revision desc limit 1
          ) latest on true
          where s.book_id = ${bookId} and s.id <> ${sourceId}
            and latest.voucher_id = ${voucherId}::text
            and not exists (
              select 1 from openerp.expense_tax_source_withdrawals w
              where w.book_id = ${bookId} and w.source_id = s.id
            )
        ) as ambiguous
      from openerp.books b
      where b.id = ${bookId}
    `,
    "objects",
  );
}
