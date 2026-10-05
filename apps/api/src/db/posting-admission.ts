import { sql } from "drizzle-orm";
import * as Match from "effect/Match";
import type { Transaction } from "./transaction";
import type { JsonObject } from "./commerce/access";

export function readActiveCloseCoveringDate(tx: Transaction, book: string, date: string) {
  return tx.execute<{ readonly id: string }>(
    sql`
    select c.id from openerp.financial_close_certificates c
    join openerp.fiscal_years y on(y.book_id,y.id)=(c.book_id,c.fiscal_year_id)
    where c.book_id=${book} and ${date}::date<=y.ends_on
      and not exists(select from openerp.financial_reopen_events r
        where r.book_id=c.book_id and r.certificate_id=c.id
          and r.body->'downstreamRefusals'='[]'::jsonb)
    limit 1`,
    "objects",
  );
}

export function readOwnedSources(
  tx: Transaction,
  book: string,
  change: string,
  event: string,
  evidence: ReadonlyArray<string>,
) {
  return tx.execute<{
    readonly kind: string;
    readonly id: string;
    readonly changeId: string | null;
    readonly body: JsonObject;
  }>(
    sql`
    with recursive origins(change_id) as (
      select ${change}::text union select v.change_set_id from origins o
      join openerp.correction_bundles c on c.book_id=${book} and c.replacement_change_set_id=o.change_id
      join openerp.vouchers v on (v.book_id,v.id)=(c.book_id,c.original_voucher_id)
    ), evidence(id) as (
      select jsonb_array_elements_text(${JSON.stringify(evidence)}::jsonb)
      union select evidence_id from openerp.events where book_id=${book} and id=${event}
      union select e.evidence_id from origins o join openerp.vouchers v on v.book_id=${book} and v.change_set_id=o.change_id
        join openerp.events e on (e.book_id,e.id)=(v.book_id,v.event_id)
    ), reviews as (
      select 'invoice_issue' as kind,id,change_set_id as change_id,evidence_id,body from openerp.invoice_issue_reviews where book_id=${book}
      union all select 'supplier_acceptance',id,change_set_id,evidence_id,body from openerp.supplier_acceptance_reviews where book_id=${book}
      union all select 'supplier_credit',id,change_set_id,evidence_id,body from openerp.supplier_credit_reviews where book_id=${book}
      union all select 'supplier_refund',id,change_set_id,evidence_id,body from openerp.supplier_refund_reviews where book_id=${book}
      union all select 'asset_disposal',id,change_set_id,evidence_id,body from openerp.subledger_disposal_reviews where book_id=${book}
      union all select 'asset_impairment',id,change_set_id,evidence_id,body from openerp.subledger_impairment_reviews where book_id=${book}
      union all select 'asset_valuation',id,change_set_id,evidence_id,body from openerp.subledger_valuation_reviews where book_id=${book}
      union all select 'legal_issue',id,null,body->'sourceEvidence'->>'evidenceId',body from openerp.ar_legal_issue_reviews where book_id=${book}
      union all select 'legal_credit',id,change_set_id,evidence_id,body from openerp.customer_credit_reviews where book_id=${book}
      union all select 'owner_operation',id,change_set_id,evidence_id,body from openerp.owner_operation_reviews where book_id=${book}
      union all select 'cash_allocation',allocation_plan_id,change_set_id,null,body from openerp.cash_method_allocation_effects where book_id=${book}
       union all select 'cash_year_end',id,change_set_id,evidence_id,body from openerp.cash_method_year_end_plans where book_id=${book}
       union all select 'cash_credit',id,change_set_id,evidence_id,body from openerp.cash_method_credit_plans where book_id=${book}
      union all select 'cash_invoice',id,null,evidence_id,body from openerp.commerce_invoices
        where book_id=${book} and cash_method_source_draft_id is not null
      union all select 'corporate_income_tax', b.id, b.change_set_id, null::text,
        jsonb_build_object('postingPlan', p.plan)
        from openerp.corporate_tax_bridges b
        join openerp.change_sets p on p.book_id = b.book_id and p.id = b.change_set_id
        where b.book_id = ${book}
    ) select kind,id,change_id as "changeId",body from reviews
      where change_id in(select change_id from origins) or evidence_id in(select id from evidence)
         or (kind = 'cash_allocation' and body -> 'selection' -> 'source' ->> 'eventId' = ${event})
         or (kind = 'corporate_income_tax'
          and body -> 'postingPlan' -> 'groups' -> 0 -> 'actions' -> 0 ->> 'eventId' = ${event})
    order by kind,id limit 1001`,
    "objects",
  );
}

export function readHistoricalPostingState(
  tx: Transaction,
  book: string,
  year: string,
  change: string,
) {
  return tx.execute<{
    readonly basis: JsonObject | null;
    readonly runs: ReadonlyArray<JsonObject>;
    readonly proposals: ReadonlyArray<JsonObject>;
    readonly superseded: boolean;
  }>(
    sql`
    select (select to_jsonb(b) from openerp.historical_bases b where book_id=${book} and fiscal_year_id=${year}) as basis,
      coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'leaseUntil',r.lease_until,'status',r.status)) from openerp.sie_financial_runs r where book_id=${book} and status in('running','paused')),'[]') as runs,
      coalesce((select jsonb_agg(jsonb_build_object('runId',p.run_id,'ordinal',p.ordinal,'posted',exists(select from openerp.sie_financial_postings x where (x.book_id,x.run_id,x.ordinal)=(p.book_id,p.run_id,p.ordinal)))) from openerp.sie_financial_proposals p where book_id=${book} and change_set_id=${change}),'[]') as proposals,
      exists(select from openerp.superseded_historical_openings where book_id=${book} and change_set_id=${change}) as superseded`,
    "objects",
  );
}

export function recordHistoricalOpening(
  tx: Transaction,
  book: string,
  year: string,
  change: string,
  voucher: string,
) {
  return tx.execute(
    sql`update openerp.historical_bases set opening_voucher_id=${voucher}
    where book_id=${book} and fiscal_year_id=${year} and mode='opening_set' and change_set_id=${change} and opening_voucher_id is null`,
    "objects",
  );
}

export function readRecurringCapacity(tx: Transaction, book: string, event: string) {
  return tx.execute<{ readonly amount: string }>(
    sql`
    select coalesce((select sum(o.amount_minor) from openerp.bank_active_matches m join openerp.bank_observations o
        on (o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal)
        where (m.book_id,m.statement_id,m.row_ordinal)=(p.book_id,p.statement_id,p.row_ordinal)),0)::text as amount
      from openerp.recurring_preparations p join openerp.change_sets c on(c.book_id,c.id)=(p.book_id,p.change_set_id)
      where p.book_id=${book} and c.plan->'groups'->0->'actions'->0->>'eventId'=${event}
    union all select l.amount_minor::text from openerp.recurring_preparations p join openerp.change_sets c on(c.book_id,c.id)=(p.book_id,p.change_set_id)
      join openerp.bank_active_allocation_legs l on(l.book_id,l.statement_id,l.row_ordinal)=(p.book_id,p.statement_id,p.row_ordinal)
      where p.book_id=${book} and c.plan->'groups'->0->'actions'->0->>'eventId'=${event}`,
    "objects",
  );
}

export function readSchedulePreparation(tx: Transaction, book: string, change: string) {
  return tx.execute<{
    readonly scheduleId: string;
    readonly revision: number;
    readonly ordinal: number;
    readonly basis: JsonObject | null;
  }>(
    sql`
    select schedule_id as "scheduleId",revision,ordinal,basis_dependency as basis from openerp.subledger_preparations where book_id=${book} and change_set_id=${change}`,
    "objects",
  );
}

export function readRetiredScheduleEvent(tx: Transaction, book: string, event: string) {
  return tx.execute<{ readonly scheduleId: string }>(
    sql`select r.schedule_id as "scheduleId" from openerp.subledger_retired_occurrences r
      join openerp.events e on (e.book_id,e.event_key)=(r.book_id,r.event_key)
      where r.book_id=${book} and e.id=${event} limit 1`,
    "objects",
  );
}

export function readLinkedScheduleEvents(
  tx: Transaction,
  book: string,
  change: string,
  event: string,
) {
  return tx.execute<{ readonly scheduleId: string }>(
    sql`
    with recursive origins(change_id) as (select ${change}::text union select v.change_set_id from origins o
      join openerp.correction_bundles c on c.book_id=${book} and c.replacement_change_set_id=o.change_id
      join openerp.vouchers v on(v.book_id,v.id)=(c.book_id,c.original_voucher_id)), events(id) as (
      select ${event}::text union select v.event_id from openerp.vouchers v join origins o on o.change_id=v.change_set_id where v.book_id=${book})
    select distinct b.schedule_id as "scheduleId" from openerp.subledger_bases b
      join openerp.subledger_schedule_revisions r on(r.book_id,r.schedule_id)=(b.book_id,b.schedule_id)
      join openerp.events e on e.book_id=r.book_id and e.evidence_id=r.evidence_id
      where b.book_id=${book} and e.id in(select id from events) and exists(select from jsonb_array_elements(r.body->'occurrences') o where o->>'eventKey'=e.event_key)`,
    "objects",
  );
}

export function readOwnerAttachments(tx: Transaction, book: string, change: string, event: string) {
  return tx.execute<{
    readonly recordId: string;
    readonly reviewId: string | null;
    readonly linkReviewId: string | null;
    readonly lineId: string | null;
    readonly revisionDigest: string | null;
  }>(
    sql`
    select r.id as "recordId",v.id as "reviewId",l.review_id as "linkReviewId",l.line_id as "lineId",l.body->>'revisionDigest' as "revisionDigest"
      from openerp.owner_records r join openerp.events e on e.book_id=r.book_id and e.evidence_id=r.evidence_id and e.event_key=r.locator
      left join openerp.owner_reviews v on v.book_id=r.book_id and v.record_id=r.id and v.revision=r.current_revision
      left join openerp.owner_proposal_links l on l.book_id=r.book_id and l.record_id=r.id and l.change_set_id=${change}
      where r.book_id=${book} and e.id=${event}`,
    "objects",
  );
}

export function readProtectedCorrections(tx: Transaction, book: string, voucher: string) {
  return tx.execute<{ readonly kind: string }>(
    sql`
    select 'payroll_settlement' as kind from openerp.payroll_settlement_executions where book_id=${book} and voucher_id=${voucher}
 union all select 'payroll_input' as kind from openerp.payroll_input_executions where book_id=${book} and voucher_id=${voucher}
 union all select 'foreign_cash_opening' as kind from openerp.bank_foreign_cash_opening_lines where book_id=${book} and voucher_id=${voucher}
 union all select 'foreign_cash' as kind from openerp.bank_foreign_cash_effects where book_id=${book} and voucher_id=${voucher}
 union all select 'treasury_loan' as kind from openerp.treasury_loan_events where book_id=${book} and voucher_id=${voucher}
 union all select 'payroll_run' as kind from openerp.payroll_run_executions where book_id=${book} and voucher_id=${voucher}
 union all select 'supplier_settlement' as kind from openerp.supplier_settlement_receipts where book_id=${book} and voucher_id=${voucher}
 union all select 'owner' as kind from openerp.owner_effects where book_id=${book} and voucher_id=${voucher}
     union all select 'cash_allocation' from openerp.cash_method_recognitions where book_id=${book}
       and (voucher_id=${voucher} or source_payment_voucher_id=${voucher})
     union all select 'cash_credit' from openerp.cash_method_credits where book_id=${book} and voucher_id=${voucher}
    union all select 'financial_close' from openerp.financial_close_transfers where book_id=${book} and voucher_id=${voucher}
    union all select 'tax_account' from openerp.tax_account_match_capacity where book_id=${book} and voucher_id=${voucher}
    union all select 'vat_assessment' from openerp.vat_assessment_receipts where book_id=${book} and voucher_id=${voucher}
    union all select 'vat_bridge' from openerp.vat_bridge_receipts where book_id=${book} and voucher_id=${voucher}
    union all select 'vat_assessment' from openerp.vat_assessment_receipts r join openerp.tax_account_matches m
      on (m.book_id,m.id)=(r.book_id,r.match_ref) where r.book_id=${book} and m.voucher_id=${voucher}
    union all select 'supplier_credit' from openerp.supplier_credits where book_id=${book} and voucher_id=${voucher}
    union all select 'supplier_refund' from openerp.supplier_refunds where book_id=${book} and voucher_id=${voucher}
    union all select 'vat_reclassification' from openerp.vat_control_reclassification_effects where book_id=${book} and voucher_id=${voucher}
    union all select 'vat_contribution' from openerp.vat_control_reclassification_contributions where book_id=${book} and voucher_id=${voucher}
    union all select 'fx' from openerp.commerce_fx_items where book_id=${book} and voucher_id=${voucher}
    union all select 'fx_settlement' from openerp.commerce_fx_settlements where book_id=${book} and voucher_id=${voucher}
    union all select 'fx_correction' from openerp.commerce_fx_settlement_corrections c join openerp.execution_receipts e on(e.book_id,e.id)=(c.book_id,c.posting_receipt_id) where c.book_id=${book} and e.voucher_id=${voucher}
    union all select 'asset_impairment' from openerp.subledger_impairments where book_id=${book} and voucher_id=${voucher}
    union all select 'historical_settlement' from openerp.commerce_historical_settlements where book_id=${book} and payment_voucher_id=${voucher}
    union all select 'processor' from openerp.processor_executions where book_id=${book} and voucher_id=${voucher}
    union all select 'processor_native_credit' from openerp.processor_native_credit_origins where book_id=${book} and source_voucher_id=${voucher}
    union all select 'asset_proceeds_disposal' from openerp.asset_proceeds_effects where book_id=${book} and voucher_id=${voucher}
    union all select 'asset_valuation' from openerp.subledger_valuations where book_id=${book} and voucher_id=${voucher}
    union all select 'asset_basis' from openerp.subledger_bases b where b.book_id=${book} and b.voucher_id=${voucher} and (
      exists(select from openerp.subledger_impairments i where(i.book_id,i.schedule_id)=(b.book_id,b.schedule_id)) or
      exists(select from openerp.subledger_valuations i where(i.book_id,i.schedule_id)=(b.book_id,b.schedule_id)) or
      exists(select from openerp.subledger_disposals d where(d.book_id,d.schedule_id)=(b.book_id,b.schedule_id)) or
      exists(select from openerp.asset_proceeds_effects d where(d.book_id,d.schedule_id)=(b.book_id,b.schedule_id)))
    union all select 'asset_history' from openerp.subledger_disposal_reviews r join openerp.subledger_disposals d on(d.book_id,d.review_id)=(r.book_id,r.id)
      where r.book_id=${book} and (r.body->'basis'->'carryingBasis'->'input'->>'voucherId'=${voucher} or exists(select from jsonb_array_elements(r.body->'basis'->'occurrences') o where ${voucher} in(o->>'voucherId',o->>'reversalVoucherId')))
    union all select 'impaired_schedule_history' from openerp.subledger_schedule_revisions r join openerp.events e on e.book_id=r.book_id and e.evidence_id=r.evidence_id
      join openerp.vouchers v on v.book_id=e.book_id and v.event_id=e.id and v.id=${voucher}
      where r.book_id=${book} and exists(select from jsonb_array_elements(r.body->'occurrences') o where o->>'eventKey'=e.event_key)
        and (exists(select from openerp.subledger_impairments i where(i.book_id,i.schedule_id)=(r.book_id,r.schedule_id))
          or exists(select from openerp.subledger_valuations i where(i.book_id,i.schedule_id)=(r.book_id,r.schedule_id)))
    union all select 'corporate_income_tax' from openerp.corporate_tax_effects where book_id=${book} and voucher_id=${voucher}
    limit 1001`,
    "objects",
  );
}

export function readAccountRoles(tx: Transaction, book: string, account: string) {
  return tx.execute<{ readonly role: string }>(
    sql`
    select 'payroll' as role from openerp.payroll_settlement_reviews where book_id=${book} and body->'input'->>'recoveryReceivableAccountId'=${account}
    union all select 'processor' as role from openerp.processor_accounts where book_id=${book} and (processor_control_account_id=${account} or payout_transit_account_id=${account} or body->>'disputeReceivableAccountId'=${account})
    union all select 'bank' as role from openerp.bank_sources where book_id=${book} and account_id=${account}
    union all select 'commerce' from openerp.commerce_control_accounts where book_id=${book} and account_id=${account}
    union all select 'owner' from openerp.owner_control_accounts where book_id=${book} and account_id=${account}
    union all select 'vat' from openerp.vat_control_account_roles where book_id=${book} and account_id=${account}
    union all select 'tax' from openerp.tax_account_sources where book_id=${book} and account_id=${account}
    union all select 'treasury' from openerp.treasury_loan_account_roles where book_id=${book} and account_id=${account}`,
    "objects",
  );
}

export function readVatAssessmentPosting(tx: Transaction, book: string, eventId: string) {
  return tx.execute<{
    readonly body: JsonObject;
    readonly eventKey: string;
    readonly evidenceId: string;
  }>(
    sql`
    select b.body, e.event_key as "eventKey", e.evidence_id as "evidenceId"
    from (
      select body, 'vat_bridge_' || id as event_key from openerp.vat_rounding_bridges
         where book_id=${book}
      union all select body, 'vat_assessment_' || id from openerp.vat_assessments
         where book_id=${book}
    ) b join openerp.events e on e.book_id=${book} and e.id=${eventId} and e.event_key=b.event_key`,
    "objects",
  );
}

export function readLineOwners(tx: Transaction, book: string, voucher: string, line: string) {
  return tx.execute<{ readonly owner: string }>(
    sql`
    select 'commerce' as owner from openerp.commerce_historical_settlements where book_id=${book} and payment_voucher_id=${voucher} and payment_line_id=${line}
    union all select 'owner' as owner from openerp.owner_effects where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'commerce' from openerp.commerce_invoices where book_id=${book} and recognition_voucher_id=${voucher} and recognition_line_id=${line}
    union all select 'commerce' from openerp.invoice_recognition_replacements where book_id=${book} and ((replacement_voucher_id=${voucher} and replacement_line_id=${line}) or (reversal_voucher_id=${voucher} and reversal_line_id=${line}))
    union all select 'commerce' from openerp.commerce_active_allocation_legs where book_id=${book} and payment_voucher_id=${voucher} and payment_line_id=${line}
    union all select 'bank' from openerp.bank_foreign_cash_book_consumptions where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'bank' from openerp.bank_active_matches where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'bank' from openerp.bank_active_allocation_legs where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'tax' from openerp.tax_account_match_capacity where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'fx' from openerp.commerce_fx_items where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'fx' from openerp.commerce_fx_settlements where book_id=${book} and voucher_id=${voucher} and ${line} in(cash_line_id,control_line_id,realized_line_id)
    union all select 'fx' from openerp.commerce_fx_settlement_sources s join openerp.commerce_fx_settlements t on(t.book_id,t.id)=(s.book_id,s.settlement_id) where s.book_id=${book} and t.voucher_id=${voucher} and s.journal_line_id=${line}
    union all select 'treasury' from openerp.treasury_loan_events e join openerp.journal_lines l on l.book_id=e.book_id and l.voucher_id=e.voucher_id where e.book_id=${book} and e.voucher_id=${voucher} and l.id=${line} and exists(select from openerp.treasury_loan_account_roles r where r.book_id=l.book_id and r.account_id=l.account_id)
    union all select 'asset_valuation' from openerp.subledger_valuations where book_id=${book} and voucher_id=${voucher} and ${line} in(contra_line_id,result_line_id)`,
    "objects",
  );
}

export function readBankPostingDates(
  tx: Transaction,
  book: string,
  statement: string,
  ordinal: number,
  voucher: string,
) {
  return tx.execute<{
    readonly observedOn: string;
    readonly postedOn: string;
    readonly purpose: string;
    readonly reversed: boolean;
  }>(
    sql`
    select o.observed_on::text as "observedOn",v.posting_date::text as "postedOn",v.posting_purpose as purpose,
      exists(select from openerp.vouchers r where r.book_id=v.book_id and r.corrects_voucher_id=v.id) as reversed
    from openerp.bank_observations o cross join openerp.vouchers v
    where o.book_id=${book} and o.statement_id=${statement} and o.row_ordinal=${ordinal} and v.book_id=${book} and v.id=${voucher}`,
    "objects",
  );
}

export function readPeriodsOn(tx: Transaction, book: string, date: string) {
  return tx.execute<{ readonly locked: boolean }>(
    sql`select locked from openerp.periods where book_id=${book} and ${date}::date between starts_on and ends_on order by id for share`,
    "objects",
  );
}

export function readReservedCommand(tx: Transaction, book: string, key: string) {
  return tx.execute<{
    readonly actorId: string;
    readonly command: JsonObject;
  }>(
    sql`
    select r.actor_id as "actorId", r.command
    from openerp.posting_saved_requests r where r.book_id=${book} and r.command_key=${key}`,
    "objects",
  );
}

export function readSealedDraft(
  tx: Transaction,
  book: string,
  id: string,
  kind: "customer" | "supplier" | "register",
) {
  return tx.execute<{ readonly id: string }>(
    Match.value(kind).pipe(
      Match.when(
        "supplier",
        () => sql`select id from openerp.supplier_acceptances where book_id=${book} and draft_id=${id}
          union all select id from openerp.commerce_invoices where book_id=${book} and cash_method_source_draft_id=${id}
          union all select id from openerp.cash_method_credits where book_id=${book} and draft_id=${id}`,
      ),
      Match.when(
        "register",
        () =>
          sql`select id from openerp.ar_legal_issues where book_id=${book} and register_invoice_id=${id}`,
      ),
      Match.when(
        "customer",
        () =>
          sql`select id from openerp.invoice_issues where book_id=${book} and draft_id=${id} union all select id from openerp.ar_legal_issues where book_id=${book} and draft_id=${id}`,
      ),
      Match.exhaustive,
    ),
    "objects",
  );
}

export function readExpenseSourceConflicts(
  tx: Transaction,
  book: string,
  source: string,
  sha: string,
  locator: string,
) {
  return tx.execute<{ readonly id: string }>(
    sql`
    select s.id from openerp.expense_tax_sources s join lateral(select r.body from openerp.expense_tax_source_revisions r
      where(r.book_id,r.source_id)=(s.book_id,s.id) order by revision desc limit 1) r on true
    where s.book_id=${book} and s.id<>${source} and r.body->>'evidenceSha256'=${sha} and r.body->'facts'->>'sourceLocator'=${locator}
    and not exists(select from openerp.expense_tax_source_withdrawals w where(w.book_id,w.source_id)=(s.book_id,s.id))`,
    "objects",
  );
}

export function readDisposalVoucher(tx: Transaction, book: string, voucher: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select r.id from openerp.subledger_disposal_reviews r join openerp.vouchers v on(v.book_id,v.change_set_id)=(r.book_id,r.change_set_id) where v.book_id=${book} and v.id=${voucher}`,
    "objects",
  );
}

export function readForeignCashPosting(tx: Transaction, book: string, event: string) {
  return tx.execute<{ readonly id: string; readonly body: JsonObject }>(
    sql`
    select id,body from openerp.bank_foreign_cash_reviews where book_id=${book}
      and body->'postingAction'->>'eventId'=${event}`,
    "objects",
  );
}

export function readForeignCashAccount(tx: Transaction, book: string, account: string) {
  return tx.execute<{ readonly accountId: string }>(
    sql`
    select account_id as "accountId" from openerp.bank_foreign_cash_accounts
      where book_id=${book} and account_id=${account}`,
    "objects",
  );
}

export function readForeignCashObservation(
  tx: Transaction,
  book: string,
  statement: string,
  ordinal: number,
) {
  return tx.execute<{ readonly accountId: string }>(
    sql`
    select s.account_id as "accountId" from openerp.bank_observations o
    join openerp.bank_statements s on (s.book_id,s.id)=(o.book_id,o.statement_id)
    join openerp.bank_foreign_cash_accounts a on (a.book_id,a.account_id)=(s.book_id,s.account_id)
    where o.book_id=${book} and o.statement_id=${statement} and o.row_ordinal=${ordinal}`,
    "objects",
  );
}

export function readForeignCashBookClaim(
  tx: Transaction,
  book: string,
  statement: string,
  ordinal: number,
) {
  return tx.execute<{
    readonly reviewId: string;
    readonly voucherId: string;
    readonly lineId: string;
  }>(
    sql`
    select review_id as "reviewId",voucher_id as "voucherId",line_id as "lineId"
    from openerp.bank_foreign_cash_book_consumptions where book_id=${book}
      and statement_id=${statement} and row_ordinal=${ordinal}`,
    "objects",
  );
}

export function readAssetProceedsCashClaim(
  tx: Transaction,
  book: string,
  statement: string,
  ordinal: number,
) {
  return tx.execute<{
    readonly reviewId: string;
    readonly voucherId: string;
    readonly lineId: string;
  }>(
    sql`select r.id as "reviewId", v.id as "voucherId", l.id as "lineId"
      from openerp.asset_proceeds_reviews r
      join openerp.vouchers v on(v.book_id,v.change_set_id)=(r.book_id,r.change_set_id)
      join openerp.journal_lines l on(l.book_id,l.voucher_id)=(v.book_id,v.id)
        and l.account_id=r.body->'proceeds'->>'accountId' and l.debit_minor>0
      where r.book_id=${book} and r.body->'input'->>'kind'='disposal'
        and r.body->'proceeds'->>'kind'='unposted_cash_sale'
        and r.body->'proceeds'->>'statementId'=${statement}
        and (r.body->'proceeds'->>'rowOrdinal')::integer=${ordinal}
        and not exists(select from openerp.asset_proceeds_effects original
          join openerp.asset_proceeds_effects correction on(correction.book_id,correction.correction_of)=(original.book_id,original.id)
          where original.book_id=r.book_id and original.review_id=r.id)`,
    "objects",
  );
}

export function readPayrollSettlementCashClaim(
  tx: Transaction,
  book: string,
  statement: string,
  ordinal: number,
) {
  return tx.execute<{
    readonly reviewId: string;
    readonly voucherId: string;
    readonly lineId: string;
  }>(
    sql`select r.id as "reviewId",v.id as "voucherId",l.id as "lineId"
      from openerp.payroll_settlement_reviews r
      join openerp.vouchers v on(v.book_id,v.change_set_id)=(r.book_id,r.change_set_id)
      join openerp.journal_lines l on(l.book_id,l.voucher_id)=(v.book_id,v.id)
        and l.account_id=r.body->'cash'->>'accountId'
      where r.book_id=${book} and r.body->'cash'->>'statementId'=${statement}
        and (r.body->'cash'->>'rowOrdinal')::integer=${ordinal}`,
    "objects",
  );
}
