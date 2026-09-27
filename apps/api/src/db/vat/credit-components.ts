import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";

export type CreditComponent = {
  readonly id: string;
  readonly creditId: string;
  readonly voucherId: string;
  readonly originalVoucherId: string;
  readonly originalFactId: string | null;
  readonly originalFactCount: number;
  readonly originalTaxPointOn: string | null;
  readonly admittedNetMinor: string | null;
  readonly admittedTaxMinor: string | null;
  readonly originalNetMinor: string;
  readonly originalTaxMinor: string;
  readonly basisMinor: string;
  readonly taxMinor: string;
  readonly taxPointOn: string;
  readonly outputVatLineId: string | null;
  readonly digest: string;
  readonly voucherSequence: string;
  readonly voucherReversed: boolean;
};

export function readCreditComponents(
  tx: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return tx.execute<CreditComponent>(
    sql`
    select c.id, c.credit_id as "creditId", c.credit_voucher_id as "voucherId",
      c.original_voucher_id as "originalVoucherId",
      admitted.fact_id as "originalFactId", admitted.fact_count as "originalFactCount",
      admitted.body->'input'->>'taxPointOn' as "originalTaxPointOn",
      admitted.body->'input'->>'netMinor' as "admittedNetMinor",
      admitted.body->'input'->>'vatMinor' as "admittedTaxMinor",
      original.body->'totals'->>'netMinor' as "originalNetMinor",
      original.body->'totals'->>'taxMinor' as "originalTaxMinor",
      c.base_minor::text as "basisMinor", c.output_tax_minor::text as "taxMinor",
      c.qualified_on::text as "taxPointOn", c.output_vat_line_id as "outputVatLineId",
      openerp.digest(jsonb_build_object('credit', c.body, 'originalFact', admitted.body,
        'originalFactCount', admitted.fact_count)) as digest, v.sequence::text as "voucherSequence",
      exists (select 1 from openerp.vouchers reversed
        where reversed.book_id = c.book_id and reversed.corrects_voucher_id = c.credit_voucher_id) as "voucherReversed"
    from openerp.customer_credit_tax_corrections c
    join openerp.customer_credit_notes n on (n.book_id, n.id) = (c.book_id, c.credit_id)
    join openerp.ar_legal_issues original on (original.book_id, original.id) = (n.book_id, n.original_legal_issue_id)
    left join lateral (
      select count(*)::integer as fact_count, min(f.id) as fact_id,
        (array_agg(r.body order by f.id collate "C"))[1] as body
      from openerp.vat_fact_components f
      join lateral (
        select revision.* from openerp.vat_fact_revisions revision
        where revision.book_id = c.book_id and revision.fact_id = f.id
        order by revision.revision desc limit 1
      ) r on true
      where f.book_id = c.book_id and f.record_class = 'actual_company'
        and r.voucher_id = c.original_voucher_id
        and r.body->'input'->>'treatment' = 'domestic_sale'
        and not exists (select 1 from openerp.vat_fact_withdrawals w
          where w.book_id = c.book_id and w.fact_id = f.id)
    ) admitted on true
    join openerp.vouchers v on (v.book_id, v.id) = (c.book_id, c.credit_voucher_id)
    where c.book_id = ${bookId} and c.qualified_on >= ${startsOn}::date and c.qualified_on <= ${endsOn}::date
    order by c.qualified_on, c.id collate "C" limit 501
  `,
    "objects",
  );
}

export function readExactFiscalYear(
  tx: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return tx.execute<{ readonly present: boolean }>(
    sql`
    select exists (select 1 from openerp.fiscal_years
      where book_id = ${bookId} and starts_on::text = ${startsOn} and ends_on::text = ${endsOn}) as present
  `,
    "objects",
  );
}
