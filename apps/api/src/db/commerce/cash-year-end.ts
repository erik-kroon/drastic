import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";
import type * as CashMethod from "@open-erp/contracts/cash-method";

export function bumpPopulation(tx: Transaction, book: string) {
  return tx.execute(sql`insert into openerp.cash_method_population_epochs(book_id,version) values(${book},1)
    on conflict(book_id) do update set version=openerp.cash_method_population_epochs.version+1`);
}

export function readFiscal(tx: Transaction, book: string, year: string) {
  return tx.execute<{ id: string; startsOn: string; endsOn: string }>(
    sql`
    select id,starts_on::text as "startsOn",ends_on::text as "endsOn" from openerp.fiscal_years where book_id=${book} and id=${year}`,
    "objects",
  );
}

export function readPeriod(tx: Transaction, book: string, date: string, year: string) {
  return tx.execute<{ id: string; version: string; locked: boolean }>(
    sql`
    select id,version::text,locked from openerp.periods where book_id=${book} and fiscal_year_id=${year}
      and starts_on<=${date}::date and ends_on>=${date}::date order by id for share`,
    "objects",
  );
}

export function readPopulation(tx: Transaction, book: string, cutoff: string) {
  return tx.execute<{
    id: string;
    futurePayment: boolean;
    futureCredit: boolean;
    futureRecognition: boolean;
  }>(
    sql`
    select i.id,exists(select from openerp.commerce_allocation_legs l join openerp.vouchers v
      on(v.book_id,v.id)=(l.book_id,l.payment_voucher_id) where l.book_id=i.book_id and l.invoice_id=i.id
      and v.posting_date>${cutoff}::date and not exists(select from openerp.commerce_allocation_reversals r
        where(r.book_id,r.receipt_id)=(l.book_id,l.receipt_id))) as "futurePayment",
      exists(select from openerp.cash_method_credits c
        where c.book_id=i.book_id and c.invoice_id=i.id and c.credit_date>${cutoff}::date) as "futureCredit",
      exists(select from openerp.cash_method_lines l
        join openerp.cash_method_recognitions r on (r.book_id,r.line_id)=(l.book_id,l.id)
        left join openerp.vouchers v on (v.book_id,v.id)=(r.book_id,r.voucher_id)
        left join openerp.cash_method_year_end_runs y on y.book_id=r.book_id
          and y.id=r.trigger_ref and r.trigger_kind='year_end_unpaid'
        where l.book_id=i.book_id and l.invoice_id=i.id and r.recognized_gross_minor::numeric>0
          and (v.posting_date>${cutoff}::date or y.cutoff_on>${cutoff}::date)) as "futureRecognition"
    from openerp.commerce_invoices i where book_id=${book} and issued_on<=${cutoff}::date order by id collate "C"`,
    "objects",
  );
}

export function readEpoch(tx: Transaction, book: string) {
  return tx.execute<{ version: string }>(
    sql`select version::text from openerp.cash_method_population_epochs where book_id=${book}`,
    "objects",
  );
}

export function readBlockingRun(tx: Transaction, book: string, date: string) {
  return tx.execute<{ id: string }>(
    sql`select id from openerp.cash_method_year_end_runs where book_id=${book} and cutoff_on>=${date}::date order by cutoff_on limit 1`,
    "objects",
  );
}

export function readRun(tx: Transaction, book: string, year: string) {
  return tx.execute<{ id: string; body: JsonObject | null }>(
    sql`select id,body from openerp.cash_method_year_end_runs where book_id=${book} and fiscal_year_id=${year}`,
    "objects",
  );
}

export function readPlan(tx: Transaction, book: string, id: string) {
  return tx.execute<{ body: JsonObject }>(
    sql`select body from openerp.cash_method_year_end_plans where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function insertPlan(
  tx: Transaction,
  book: string,
  plan: typeof CashMethod.CashYearEndPlan.Type,
) {
  return tx.execute(sql`insert into openerp.cash_method_year_end_plans(book_id,id,fiscal_year_id,change_set_id,evidence_id,body)
    values(${book},${plan.id},${plan.selection.fiscalYear.id},${plan.postingPlan?.id ?? null},${plan.selection.reviewEvidence.evidenceId},${JSON.stringify(plan)}::jsonb)`);
}

export function readApproval(tx: Transaction, book: string, id: string) {
  return tx.execute<{ body: JsonObject; consumed: boolean }>(
    sql`select body,consumed_at is not null as consumed from openerp.cash_method_year_end_approvals where book_id=${book} and id=${id} for update`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  approval: typeof CashMethod.CashYearEndApproval.Type,
) {
  return tx.execute(sql`insert into openerp.cash_method_year_end_approvals(book_id,id,plan_id,actor_id,body)
    values(${book},${approval.id},${approval.planId},${approval.actorId},${JSON.stringify(approval)}::jsonb)`);
}

export function consumeApproval(tx: Transaction, book: string, id: string) {
  return tx.execute<{ id: string }>(
    sql`update openerp.cash_method_year_end_approvals set consumed_at=now() where book_id=${book} and id=${id} and consumed_at is null returning id`,
    "objects",
  );
}

export function insertRun(
  tx: Transaction,
  book: string,
  plan: typeof CashMethod.CashYearEndPlan.Type,
  receipt: typeof CashMethod.CashYearEndReceipt.Type,
  actor: string,
) {
  return tx.execute(sql`insert into openerp.cash_method_year_end_runs(book_id,id,accounting_period_id,cutoff_on,rationale,evidence_id,
    recognized_line_count,recognized_gross_minor,run_key,created_by,fiscal_year_id,plan_id,approval_id,body)
    values(${book},${receipt.id},${plan.selection.period.id},${receipt.cutoffOn}::date,${plan.selection.input.rationale},${plan.selection.reviewEvidence.evidenceId},
      ${receipt.recognizedLineCount},${receipt.recognizedGrossMinor},${plan.id},${actor},${receipt.fiscalYearId},${plan.id},${receipt.approvalId},${JSON.stringify(receipt)}::jsonb)`);
}

export function insertMember(
  tx: Transaction,
  book: string,
  run: string,
  member: (typeof CashMethod.CashYearEndReceipt.Type)["members"][number],
) {
  return tx.execute(
    sql`insert into openerp.cash_method_year_end_members(book_id,run_id,invoice_id,body) values(${book},${run},${member.invoiceId},${JSON.stringify(member)}::jsonb)`,
  );
}

export function insertRecognition(
  tx: Transaction,
  book: string,
  input: {
    id: string;
    runId: string;
    lineId: string;
    line: (typeof CashMethod.CashYearEndReceipt.Type)["members"][number]["lines"][number];
    evidenceId: string;
    changeSetId: string;
    voucherId: string;
    factId: string | null;
  },
) {
  return tx.execute(sql`insert into openerp.cash_method_recognitions(book_id,id,line_id,trigger_kind,trigger_ref,recognized_gross_minor,
    recognized_gross_after_minor,paid_gross_after_minor,net_minor,tax_minor,deductible_minor,evidence_id,change_set_id,voucher_id,vat_fact_id)
    values(${book},${input.id},${input.lineId},'year_end_unpaid',${input.runId},${input.line.newGrossMinor},${input.line.after.recognizedGrossMinor},${input.line.after.paidGrossMinor},
      ${input.line.netMinor},${input.line.taxMinor},${input.line.deductibleMinor},${input.evidenceId},${input.changeSetId},${input.voucherId},${input.factId})`);
}
