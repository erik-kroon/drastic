import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";
import { statementBodyColumns } from "./banking/statements";

export function readProjectionMaterial(
  tx: Transaction,
  scope: { entityId: string; bookId: string },
) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`
    select jsonb_build_object(
      'companyName',e.name,
      'people',(select coalesce(jsonb_agg(x.body),'[]') from (
        select jsonb_build_object('id',a.id,'name',a.name,'role',m.role,'enabled',coalesce(i.enabled,true)) as body
        from openerp.memberships m join openerp.actors a on a.id=m.actor_id
        left join openerp.identity_admissions i on i.actor_id=a.id
        where m.book_id=b.id order by a.id limit 1001) x),
      'accounts',(select coalesce(jsonb_agg(x.body),'[]') from (
        select jsonb_build_object('id',a.id,'code',a.code,'name',a.name) as body
        from openerp.accounts a where a.book_id=b.id order by a.code limit 1001) x),
      'companyFacts',(select coalesce(jsonb_agg(x.body),'[]') from (
        select jsonb_build_object('revision',f.body,'review',r.body) as body
        from openerp.company_fact_revisions f left join openerp.company_fact_reviews r
          on r.entity_id=f.entity_id and r.fact_revision_id=f.id
        where f.entity_id=e.id order by f.id limit 1001) x),
      'activations',(select coalesce(jsonb_agg(x.body),'[]') from (
        select a.body from openerp.company_activations a where a.book_id=b.id order by a.id limit 1001) x),
      'ruleReleases',(select coalesce(jsonb_agg(x.body),'[]') from (
        select r.body from openerp.rule_releases r where exists (
          select from openerp.company_activations a where a.book_id=b.id and a.rule_release_id=r.id)
        order by r.id limit 1001) x),
      'sources',(select coalesce(jsonb_agg(x.body),'[]') from (
        select s.body from openerp.onboarding_sources s where s.book_id=b.id order by s.id limit 1001) x),
      'importPreviews',(select coalesce(jsonb_agg(x.body),'[]') from (
        select p.body from openerp.sie_source_previews p where p.book_id=b.id
          and exists(select from openerp.onboarding_sources s where s.book_id=b.id and s.occurrence_id=p.occurrence_id)
        order by p.id limit 1001) x),
      'importPlans',(select coalesce(jsonb_agg(x.body),'[]') from (
        select p.body from openerp.sie_source_plans p join openerp.sie_source_previews v
          on v.book_id=p.book_id and v.id=p.preview_id
        where p.book_id=b.id and exists(select from openerp.onboarding_sources s
          where s.book_id=b.id and s.occurrence_id=v.occurrence_id)
        order by p.id limit 1001) x),
      'bankStatements',(select coalesce(jsonb_agg(x.body),'[]') from (
        select ${statementBodyColumns()} as body from openerp.bank_statements s
        join openerp.evidence e on(e.book_id,e.id)=(s.book_id,s.evidence_id)
        where s.book_id=b.id order by s.id limit 1001) x),
      'counts',jsonb_build_object(
        'retainedVouchers',(select count(*)::int from openerp.vouchers v where v.book_id=b.id),
        'importedVouchers',(select count(*)::int from openerp.sie_financial_postings p where p.book_id=b.id),
        'customerInvoices',(select count(*)::int from openerp.commerce_invoices i where i.book_id=b.id and i.direction='customer'),
        'supplierInvoices',(select count(*)::int from openerp.commerce_invoices i where i.book_id=b.id and i.direction='supplier'),
        'bankObservations',(select count(*)::int from openerp.bank_observations o where o.book_id=b.id),
        'retainedOriginals',(select count(distinct o.sha256)::int from openerp.intake_occurrences o where o.book_id=b.id),
        'assets',null)
    ) as body from openerp.books b join openerp.entities e on e.id=b.entity_id
    where b.id=${scope.bookId} and e.id=${scope.entityId}
  `,
    "objects",
  );
}

export function readBankTimingLines(
  tx: Transaction,
  bookId: string,
  asOf: string,
  identities: readonly string[],
) {
  return tx.execute<{
    identity: string;
    accountId: string;
    remainingMinor: string;
    evidenceIds: string[];
  }>(
    sql`
    select v.id||':'||l.id as identity,l.account_id as "accountId",
      (case when exists(select from openerp.bank_active_matches m
        join openerp.bank_observations o on(o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal)
        where (m.book_id,m.voucher_id,m.line_id)=(l.book_id,l.voucher_id,l.id) and o.observed_on<=${asOf}::date)
      then 0 else l.debit_minor-l.credit_minor-coalesce((select sum(a.amount_minor)
        from openerp.bank_active_allocation_legs a join openerp.bank_observations o
          on(o.book_id,o.statement_id,o.row_ordinal)=(a.book_id,a.statement_id,a.row_ordinal)
        where (a.book_id,a.voucher_id,a.line_id)=(l.book_id,l.voucher_id,l.id) and o.observed_on<=${asOf}::date),0) end)::text as "remainingMinor",
      array(select ev.evidence_id from openerp.events ev where ev.book_id=v.book_id and ev.id=v.event_id) as "evidenceIds"
    from openerp.journal_lines l join openerp.vouchers v on(v.book_id,v.id)=(l.book_id,l.voucher_id)
    where l.book_id=${bookId} and v.id||':'||l.id=any(${[...identities]}::text[])
      and v.posting_date<=${asOf}::date and v.corrects_voucher_id is null and v.posting_purpose<>'reversal'
      and not exists(select from openerp.vouchers r where r.book_id=v.book_id and r.corrects_voucher_id=v.id)
    order by v.id,l.id
  `,
    "objects",
  );
}
