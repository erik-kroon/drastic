import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Historical from "@open-erp/contracts/historical-migration";
import type { Transaction } from "./transaction";

type BodyRow = { readonly body: Schema.JsonObject };

export type BasisRow = BodyRow & { readonly voucherId: string | null };

export type RunRow = typeof Historical.RunStart.Type & { readonly leaseUntil: string };

export function readBasis(tx: Transaction, book: string, year: string) {
  return tx.execute<BasisRow>(
    sql`select body,opening_voucher_id as "voucherId" from openerp.historical_bases where book_id=${book} and fiscal_year_id=${year}`,
    "objects",
  );
}

export function insertBasis(tx: Transaction, book: string, basis: typeof Historical.Basis.Type) {
  return tx.execute(
    sql`insert into openerp.historical_bases(book_id,fiscal_year_id,mode,cutover_on,source_plan_id,source_digest,change_set_id,control,body) values(${book},${basis.fiscalYearId},${basis.mode},${basis.cutoverOn}::date,${basis.sourcePlanId},${basis.sourceDigest},${basis.changeSetId},${JSON.stringify(basis.controls)}::jsonb,${JSON.stringify(basis)}::jsonb)`,
    "objects",
  );
}

export function replaceOpening(
  tx: Transaction,
  book: string,
  previous: string,
  basis: typeof Historical.Basis.Type,
) {
  return tx.execute(
    sql`with superseded as (insert into openerp.superseded_historical_openings(book_id,change_set_id,replacement_id) values(${book},${previous},${basis.changeSetId})) update openerp.historical_bases set change_set_id=${basis.changeSetId},body=${JSON.stringify(basis)}::jsonb where book_id=${book} and fiscal_year_id=${basis.fiscalYearId}`,
    "objects",
  );
}

export function recordOpening(tx: Transaction, book: string, year: string, voucher: string) {
  return tx.execute(
    sql`update openerp.historical_bases set opening_voucher_id=${voucher} where book_id=${book} and fiscal_year_id=${year}`,
    "objects",
  );
}

export function readPostedDates(tx: Transaction, book: string) {
  return tx.execute<{ readonly postingDate: string; readonly fiscalYearId: string }>(
    sql`select posting_date::text as "postingDate",fiscal_year_id as "fiscalYearId" from openerp.vouchers where book_id=${book} order by posting_date,id`,
    "objects",
  );
}

export function readStagedSource(tx: Transaction, book: string, plan: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.sie_source_runs where book_id=${book} and plan_id=${plan} and status='staged'`,
    "objects",
  );
}

export function readSourceVouchers(tx: Transaction, book: string, run: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.sie_source_vouchers where book_id=${book} and run_id=${run} order by ordinal`,
    "objects",
  );
}

export function readBalances(tx: Transaction, book: string, through: string, inclusive: boolean) {
  return tx.execute<{ readonly accountId: string; readonly amount: string }>(
    sql`select l.account_id as "accountId",sum(l.debit_minor-l.credit_minor)::text as amount from openerp.journal_lines l join openerp.vouchers v on v.book_id=l.book_id and v.id=l.voucher_id where l.book_id=${book} and (v.posting_date < ${through}::date or (${inclusive} and v.posting_date=${through}::date)) group by l.account_id`,
    "objects",
  );
}

export function readRun(tx: Transaction, book: string, id: string) {
  return tx.execute<RunRow>(
    sql`select id,source_run_id as "sourceRunId",fiscal_year_id as "fiscalYearId",source_plan_digest as "planDigest",next_ordinal as "nextOrdinal",fence::text,status,lease_until::text as "leaseUntil" from openerp.sie_financial_runs where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function readRunForSource(tx: Transaction, book: string, source: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.sie_financial_runs where book_id=${book} and source_run_id=${source}`,
    "objects",
  );
}

export function insertRun(tx: Transaction, book: string, run: RunRow) {
  return tx.execute(
    sql`insert into openerp.sie_financial_runs(book_id,id,source_run_id,fiscal_year_id,source_plan_digest,next_ordinal,fence,status,lease_until) values(${book},${run.id},${run.sourceRunId},${run.fiscalYearId},${run.planDigest},${run.nextOrdinal},${run.fence}::bigint,${run.status},${run.leaseUntil}::timestamptz)`,
    "objects",
  );
}

export function updateRun(tx: Transaction, book: string, run: RunRow) {
  return tx.execute(
    sql`update openerp.sie_financial_runs set next_ordinal=${run.nextOrdinal},fence=${run.fence}::bigint,status=${run.status},lease_until=${run.leaseUntil}::timestamptz where book_id=${book} and id=${run.id}`,
    "objects",
  );
}

export function readPostings(tx: Transaction, book: string, run: string) {
  return tx.execute<{
    readonly ordinal: number;
    readonly sourceReference: string;
    readonly sourceDigest: string;
    readonly ledgerReceipt: Schema.JsonObject;
  }>(
    sql`select ordinal,source_reference as "sourceReference",source_digest as "sourceDigest",receipt as "ledgerReceipt" from openerp.sie_financial_postings where book_id=${book} and run_id=${run} order by ordinal`,
    "objects",
  );
}

export function insertPosting(
  tx: Transaction,
  book: string,
  run: string,
  item: (typeof Historical.Run.Type.items)[number],
  change: string,
) {
  return tx.execute(
    sql`insert into openerp.sie_financial_postings(book_id,run_id,ordinal,source_reference,source_digest,change_set_id,voucher_id,receipt) values(${book},${run},${item.ordinal},${item.sourceReference},${item.sourceDigest},${change},${item.ledgerReceipt.voucherId},${JSON.stringify(item.ledgerReceipt)}::jsonb)`,
    "objects",
  );
}

export function insertProposal(
  tx: Transaction,
  book: string,
  run: string,
  ordinal: number,
  change: string,
) {
  return tx.execute(
    sql`insert into openerp.sie_financial_proposals(book_id,run_id,ordinal,change_set_id) values(${book},${run},${ordinal},${change})`,
    "objects",
  );
}

export function readProposal(tx: Transaction, book: string, run: string, ordinal: number) {
  return tx.execute<{ readonly plan: Schema.JsonObject }>(
    sql`select c.plan from openerp.sie_financial_proposals p join openerp.change_sets c on c.book_id=p.book_id and c.id=p.change_set_id where p.book_id=${book} and p.run_id=${run} and p.ordinal=${ordinal} order by p.created_at desc,p.change_set_id desc limit 1`,
    "objects",
  );
}

export function readItems(tx: Transaction, book: string, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_item_admissions where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function readPlanItems(tx: Transaction, book: string, plan: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.historical_item_admissions where book_id=${book} and source_plan_id=${plan}`,
    "objects",
  );
}

export function insertItems(
  tx: Transaction,
  book: string,
  admission: typeof Historical.ItemAdmission.Type,
) {
  const body = JSON.stringify(admission);

  return tx.execute(
    sql`with admission as (insert into openerp.historical_item_admissions(book_id,id,source_plan_id,body) values(${book},${admission.id},${admission.sourcePlanId},${body}::jsonb)), items as (insert into openerp.historical_items(book_id,admission_id,source_identity,body) select ${book},${admission.id},i->>'sourceIdentity',i from jsonb_array_elements(${body}::jsonb->'openItems') i), payments as (insert into openerp.historical_payments(book_id,admission_id,source_identity,body) select ${book},${admission.id},p->>'sourceIdentity',p from jsonb_array_elements(${body}::jsonb->'payments') p) insert into openerp.historical_matches(book_id,admission_id,source_identity,body) select ${book},${admission.id},m->>'sourceIdentity',m from jsonb_array_elements(${body}::jsonb->'matches') m`,
    "objects",
  );
}
