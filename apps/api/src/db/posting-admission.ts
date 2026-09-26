import { sql } from "drizzle-orm";
import type { Transaction } from "./transaction";
import type { JsonObject } from "./commerce/access";

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
      union all select 'asset_disposal',id,change_set_id,evidence_id,body from openerp.subledger_disposal_reviews where book_id=${book}
      union all select 'asset_impairment',id,change_set_id,evidence_id,body from openerp.subledger_impairment_reviews where book_id=${book}
      union all select 'legal_issue',id,null,body->'sourceEvidence'->>'evidenceId',body from openerp.ar_legal_issue_reviews where book_id=${book}
    ) select kind,id,change_id as "changeId",body from reviews where change_id in(select change_id from origins) or evidence_id in(select id from evidence)
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
      coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'leaseUntil',r.lease_until)) from openerp.sie_financial_runs r where book_id=${book} and status='running'),'[]') as runs,
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
    select 'owner' as kind from openerp.owner_effects where book_id=${book} and voucher_id=${voucher}
    union all select 'tax_account' from openerp.tax_account_match_capacity where book_id=${book} and voucher_id=${voucher}
    union all select 'supplier_credit' from openerp.supplier_credits where book_id=${book} and voucher_id=${voucher}
    union all select 'vat_reclassification' from openerp.vat_control_reclassification_effects where book_id=${book} and voucher_id=${voucher}
    union all select 'vat_contribution' from openerp.vat_control_reclassification_contributions where book_id=${book} and voucher_id=${voucher}
    union all select 'fx' from openerp.commerce_fx_items where book_id=${book} and voucher_id=${voucher}
    union all select 'fx_settlement' from openerp.commerce_fx_settlements where book_id=${book} and voucher_id=${voucher}
    union all select 'fx_correction' from openerp.commerce_fx_settlement_corrections c join openerp.execution_receipts e on(e.book_id,e.id)=(c.book_id,c.posting_receipt_id) where c.book_id=${book} and e.voucher_id=${voucher}
    union all select 'asset_impairment' from openerp.subledger_impairments where book_id=${book} and voucher_id=${voucher}
    union all select 'asset_basis' from openerp.subledger_bases b where b.book_id=${book} and b.voucher_id=${voucher} and (
      exists(select from openerp.subledger_impairments i where(i.book_id,i.schedule_id)=(b.book_id,b.schedule_id)) or
      exists(select from openerp.subledger_disposals d where(d.book_id,d.schedule_id)=(b.book_id,b.schedule_id)))
    union all select 'asset_history' from openerp.subledger_disposal_reviews r join openerp.subledger_disposals d on(d.book_id,d.review_id)=(r.book_id,r.id)
      where r.book_id=${book} and (r.body->'basis'->'carryingBasis'->'input'->>'voucherId'=${voucher} or exists(select from jsonb_array_elements(r.body->'basis'->'occurrences') o where ${voucher} in(o->>'voucherId',o->>'reversalVoucherId')))
    union all select 'impaired_schedule_history' from openerp.subledger_schedule_revisions r join openerp.events e on e.book_id=r.book_id and e.evidence_id=r.evidence_id
      join openerp.vouchers v on v.book_id=e.book_id and v.event_id=e.id and v.id=${voucher}
      where r.book_id=${book} and exists(select from jsonb_array_elements(r.body->'occurrences') o where o->>'eventKey'=e.event_key)
        and exists(select from openerp.subledger_impairments i where(i.book_id,i.schedule_id)=(r.book_id,r.schedule_id))
    limit 1001`,
    "objects",
  );
}

export function readAccountRoles(tx: Transaction, book: string, account: string) {
  return tx.execute<{ readonly role: string }>(
    sql`
    select 'bank' as role from openerp.bank_sources where book_id=${book} and account_id=${account}
    union all select 'commerce' from openerp.commerce_control_accounts where book_id=${book} and account_id=${account}
    union all select 'owner' from openerp.owner_control_accounts where book_id=${book} and account_id=${account}
    union all select 'vat' from openerp.vat_control_account_roles where book_id=${book} and account_id=${account}
    union all select 'tax' from openerp.tax_account_sources where book_id=${book} and account_id=${account}`,
    "objects",
  );
}

export function readLineOwners(tx: Transaction, book: string, voucher: string, line: string) {
  return tx.execute<{ readonly owner: string }>(
    sql`
    select 'owner' as owner from openerp.owner_effects where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'commerce' from openerp.commerce_invoices where book_id=${book} and recognition_voucher_id=${voucher} and recognition_line_id=${line}
    union all select 'commerce' from openerp.commerce_active_allocation_legs where book_id=${book} and payment_voucher_id=${voucher} and payment_line_id=${line}
    union all select 'bank' from openerp.bank_active_matches where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'bank' from openerp.bank_active_allocation_legs where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'tax' from openerp.tax_account_match_capacity where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'fx' from openerp.commerce_fx_items where book_id=${book} and voucher_id=${voucher} and line_id=${line}
    union all select 'fx' from openerp.commerce_fx_settlements where book_id=${book} and voucher_id=${voucher} and ${line} in(cash_line_id,control_line_id,realized_line_id)`,
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
    readonly refused: boolean;
  }>(
    sql`
    select r.actor_id as "actorId",r.command,exists(select from openerp.posting_request_outcomes o where(o.book_id,o.key)=(r.book_id,r.key) and o.state='refused') as refused
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
    kind === "supplier"
      ? sql`select id from openerp.supplier_acceptances where book_id=${book} and draft_id=${id}`
      : kind === "register"
        ? sql`select id from openerp.ar_legal_issues where book_id=${book} and register_invoice_id=${id}`
        : sql`select id from openerp.invoice_issues where book_id=${book} and draft_id=${id} union all select id from openerp.ar_legal_issues where book_id=${book} and draft_id=${id}`,
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
