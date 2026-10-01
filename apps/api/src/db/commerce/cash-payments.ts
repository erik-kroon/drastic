import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";
import type * as Cash from "@open-erp/domain/cash-method";
import type * as Schema from "effect/Schema";

export function readFinalCashSource(tx: Transaction, book: string, voucher: string, line: string) {
  return tx.execute<{ readonly body: JsonObject }>(
    sql`
    select jsonb_build_object('eventId',v.event_id,'fiscalYearId',v.fiscal_year_id,'voucherId',v.id,'lineId',c.id,'bankLineId',b.id,
      'bankAccountId',b.account_id,'controlAccountId',c.account_id,'principalMinor',c.debit_minor::text,
      'postingDate',v.posting_date::text,'accountingPeriodId',v.period_id,'changeSetId',v.change_set_id,
      'series',v.series,'statementId',s.id,'rowOrdinal',o.row_ordinal,'evidenceId',e.id,'sha256',e.sha256) as body
    from openerp.vouchers v
    join openerp.journal_lines c on(c.book_id,c.voucher_id)=(v.book_id,v.id) and c.id=${line}
    join openerp.journal_lines b on(b.book_id,b.voucher_id)=(v.book_id,v.id) and b.id<>c.id
    join openerp.execution_receipts r on(r.book_id,r.voucher_id,r.change_set_id)=(v.book_id,v.id,v.change_set_id)
    join openerp.bank_active_matches m on(m.book_id,m.voucher_id,m.line_id)=(b.book_id,b.voucher_id,b.id)
    join openerp.bank_observations o on(o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal)
    join openerp.bank_statements s on(s.book_id,s.id,s.account_id)=(o.book_id,o.statement_id,b.account_id)
    join openerp.events ev on(ev.book_id,ev.id)=(v.book_id,v.event_id) and ev.evidence_id=s.evidence_id
    join openerp.evidence e on(e.book_id,e.id)=(s.book_id,s.evidence_id)
    where v.book_id=${book} and v.id=${voucher} and c.debit_minor>0 and c.credit_minor=0
      and b.debit_minor=0 and b.credit_minor=c.debit_minor and o.amount_minor=-b.credit_minor
      and o.observed_on=v.posting_date and o.provider_id is null
      and s.source->>'kind'='synthetic_bank_statement_v1'
      and s.source->'completeness'->'declaredComplete'='true'::jsonb
      and v.corrects_voucher_id is null and v.posting_purpose<>'reversal'
      and not exists(select from openerp.vouchers x where x.book_id=v.book_id and x.corrects_voucher_id=v.id)
      and (select count(*) from openerp.journal_lines j where j.book_id=v.book_id and j.voucher_id=v.id)=2
      and exists(select from jsonb_array_elements(v.action->'evidenceRefs') ref
        where ref->>'evidenceId'=e.id and ref->>'sha256'=e.sha256)
  `,
    "objects",
  );
}

export function readCoverage(tx: Transaction, book: string, invoice: string) {
  return tx.execute<{
    readonly id: string;
    readonly sourceLineId: string;
    readonly body: JsonObject;
  }>(
    sql`
    select id,source_line_id as "sourceLineId",jsonb_build_object('sourceLineId',source_line_id,
      'netMinor',original_net_minor,'taxMinor',original_tax_minor,'originalDeductibleMinor',original_deductible_minor,
      'creditedGrossMinor',credited_gross_minor,'paidGrossMinor',paid_gross_minor,'recognizedGrossMinor',recognized_gross_minor,
      'recognizedVersion',version::text,'componentPolicy',component_policy,'rounding',rounding,
      'releasedDeductibleMinor',released_deductible_minor) as body
    from openerp.cash_method_lines where book_id=${book} and invoice_id=${invoice}
    order by source_line_id collate "C"
  `,
    "objects",
  );
}

export function insertCoverage(
  tx: Transaction,
  book: string,
  input: { id: string; invoiceId: string; witness: string; line: typeof Cash.CashMethodLine.Type },
) {
  const line = input.line;

  return tx.execute(sql`
    insert into openerp.cash_method_lines(book_id,id,invoice_id,source_line_id,direction,currency,
      original_gross_minor,credited_gross_minor,paid_gross_minor,recognized_gross_minor,component_policy,rounding,profile_witness,
      original_net_minor,original_tax_minor,original_deductible_minor,released_deductible_minor)
    values(${book},${input.id},${input.invoiceId},${line.sourceLineId},'purchase','SEK',
      ${(BigInt(line.netMinor) + BigInt(line.taxMinor)).toString()},${line.creditedGrossMinor},${line.paidGrossMinor},${line.recognizedGrossMinor},
      ${line.componentPolicy},${line.rounding},${input.witness},${line.netMinor},${line.taxMinor},${line.originalDeductibleMinor},${line.releasedDeductibleMinor})
    on conflict(book_id,id) do nothing
  `);
}

export function advanceCoverage(
  tx: Transaction,
  book: string,
  id: string,
  before: typeof Cash.CashMethodLine.Type,
  after: typeof Cash.CashMethodLine.Type,
) {
  return tx.execute<{ readonly id: string }>(
    sql`
    update openerp.cash_method_lines set paid_gross_minor=${after.paidGrossMinor},recognized_gross_minor=${after.recognizedGrossMinor},
      released_deductible_minor=${after.releasedDeductibleMinor},version=version+1
    where book_id=${book} and id=${id} and version=${before.recognizedVersion}::bigint
      and paid_gross_minor=${before.paidGrossMinor} and recognized_gross_minor=${before.recognizedGrossMinor}
      and credited_gross_minor=${before.creditedGrossMinor} returning id
  `,
    "objects",
  );
}

export function insertEffect(
  tx: Transaction,
  book: string,
  planId: string,
  changeId: string | null,
  evidence: string,
  body: JsonObject,
) {
  return tx.execute(sql`insert into openerp.cash_method_allocation_effects(book_id,allocation_plan_id,change_set_id,evidence_id,body)
    values(${book},${planId},${changeId},${evidence},${JSON.stringify(body)}::jsonb)`);
}

export function readEffectiveLegs(tx: Transaction, book: string, receipt: string) {
  return tx.execute<{
    readonly invoiceId: string;
    readonly ordinal: number;
    readonly amountMinor: string;
    readonly voucherId: string;
    readonly lineId: string;
  }>(
    sql`
    select invoice_id as "invoiceId",ordinal,amount_minor::text as "amountMinor",payment_voucher_id as "voucherId",payment_line_id as "lineId"
    from openerp.commerce_allocation_legs l where book_id=${book} and receipt_id=${receipt}
      and not exists(select from openerp.commerce_allocation_reversals r where(r.book_id,r.receipt_id)=(l.book_id,l.receipt_id))
    order by ordinal
  `,
    "objects",
  );
}

export function insertRecognition(
  tx: Transaction,
  book: string,
  input: {
    id: string;
    lineId: string;
    receiptId: string;
    ordinal: number;
    sourceVoucherId: string;
    sourceLineId: string;
    newGrossMinor: string;
    after: typeof Cash.CashMethodLine.Type;
    netMinor: string;
    taxMinor: string;
    deductibleMinor: string;
    evidenceId: string;
    changeSetId: string;
    voucherId: string | null;
    vatFactId: string | null;
  },
) {
  return tx.execute(sql`
    insert into openerp.cash_method_recognitions(book_id,id,line_id,trigger_kind,trigger_ref,recognized_gross_minor,
      recognized_gross_after_minor,paid_gross_after_minor,net_minor,tax_minor,deductible_minor,evidence_id,change_set_id,
      allocation_receipt_id,allocation_ordinal,source_payment_voucher_id,source_payment_line_id,voucher_id,vat_fact_id)
    values(${book},${input.id},${input.lineId},'actual_payment',${input.receiptId},${input.newGrossMinor},${input.after.recognizedGrossMinor},
      ${input.after.paidGrossMinor},${input.netMinor},${input.taxMinor},${input.deductibleMinor},${input.evidenceId},${input.changeSetId},
      ${input.receiptId},${input.ordinal},${input.sourceVoucherId},${input.sourceLineId},${input.voucherId},${input.vatFactId})
  `);
}

export function readFactOwner(tx: Transaction, book: string, fact: string) {
  return tx.execute<{ readonly owned: boolean }>(
    sql`
    select cash_method_recognition_id is not null or cash_method_credit_id is not null as owned from openerp.vat_fact_components where book_id=${book} and id=${fact}
  `,
    "objects",
  );
}

export function readOwnedTaxLines(tx: Transaction, book: string, voucher: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.cash_method_recognitions where book_id=${book} and voucher_id=${voucher}
      union all select id from openerp.cash_method_credits where book_id=${book} and voucher_id=${voucher}`,
    "objects",
  );
}

export function readConsumedCashMatches(tx: Transaction, book: string, legs: Schema.Json) {
  return tx.execute<{ readonly present: boolean }>(
    sql`
    select exists(select from openerp.cash_method_recognitions r
      join jsonb_array_elements(${JSON.stringify(legs)}::jsonb) leg
        on leg->>'voucherId'=r.source_payment_voucher_id
      where r.book_id=${book}) as present
  `,
    "objects",
  );
}
