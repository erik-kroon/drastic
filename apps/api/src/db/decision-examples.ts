import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

export type InventoryRow = {
  owner: string;
  id: string;
  classification: string | null;
  body: Schema.JsonObject | null;
};

export function snapshot(transaction: Transaction, bookId: string) {
  return transaction.execute<{ body: Schema.JsonObject }>(
    sql`
    with recursive personal_changes as (
      select change_set_id,event_id from openerp.payroll_input_reviews where book_id=${bookId}
      union select change_set_id,event_id from openerp.payroll_runs where book_id=${bookId}
      union select change_set_id,event_id from openerp.employee_claim_reviews where book_id=${bookId}
      union select change_set_id,event_id from openerp.employee_claim_settlement_reviews where book_id=${bookId}
      union select change_set_id,event_id from openerp.payroll_settlement_reviews where book_id=${bookId}
    ), refs as (
      select case when decision_kind='bank_match' and exists(select 1 from openerp.vouchers v join personal_changes p on p.change_set_id=v.change_set_id or p.event_id=v.event_id where v.book_id=${bookId} and v.id=decision_provenance.body->'selected'->>'voucherId') then 'personal_bank' when decision_kind='batch_member' and (body->'subject'->>'owner' like '%payroll%' or body->'subject'->>'owner' like '%employee%') then 'personal_batch' else decision_kind end as owner,decision_id as id,classification,
        case when decision_kind in ('supplier_approval','extraction_field') or (decision_kind='bank_match' and not exists(select 1 from openerp.vouchers v join personal_changes p on p.change_set_id=v.change_set_id or p.event_id=v.event_id where v.book_id=${bookId} and v.id=decision_provenance.body->'selected'->>'voucherId'))
          then body else null end as body
      from openerp.decision_provenance where book_id=${bookId}
      union all select 'employee_claim',id,null,null from openerp.employee_claim_reviews where book_id=${bookId}
      union all select 'payroll',id,null,null from openerp.payroll_input_reviews where book_id=${bookId}
    ), roots as (
      select x.voucher_id as id,true as payload_allowed from openerp.supplier_acceptances a
      join openerp.execution_receipts x on x.book_id=a.book_id and x.id=a.posting_receipt_id
      join refs r on r.owner='supplier_approval' and r.id=a.approval_id where a.book_id=${bookId}
      union select body->'selected'->>'voucherId',false from refs where owner='bank_match'
    ), edges as (
      select v.id,v.corrects_voucher_id as original,null::text as bundle_id,null::text as bundle_digest
      from openerp.vouchers v where v.book_id=${bookId} and v.corrects_voucher_id is not null
      union all select x.voucher_id,r.original_voucher_id,r.bundle_id,r.body->>'bundleDigest'
      from openerp.correction_bundle_receipts r join openerp.execution_receipts x on x.book_id=r.book_id and x.id=r.replacement_receipt_id where r.book_id=${bookId}
    ), chain as (
      select v.id,r.payload_allowed from openerp.vouchers v join roots r on r.id=v.id where v.book_id=${bookId}
      union select e.id,c.payload_allowed from edges e join chain c on c.id=e.original
    ), chain_safe as (select id,bool_or(payload_allowed) as payload_allowed from chain group by id)
    select jsonb_build_object(
      'cutoff',(select committed_sequence::text from openerp.books where id=${bookId}),
      'inventory',coalesce((select jsonb_agg(to_jsonb(r) order by owner,id) from refs r),'[]'::jsonb),
      'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'body',r.body,'evidenceId',e.id,'mediaType',e.media_type,'content',e.content,'sourceDigest',e.sha256,'voucherId',x.voucher_id,'sourceInvoiceId',a.register_invoice_id,'receiptSequence',x.body->>'sequence','acceptedApprovalId',a.approval_id) order by r.id)
        from openerp.supplier_acceptance_reviews r
        join refs p on p.owner='supplier_approval' and p.body->'selected'->>'reviewId'=r.id
        left join openerp.evidence e on e.book_id=r.book_id and e.id=r.body->'draftSnapshot'->'content'->>'sourceEvidenceId'
        left join openerp.supplier_acceptances a on a.book_id=r.book_id and a.review_id=r.id
        left join openerp.execution_receipts x on x.book_id=a.book_id and x.id=a.posting_receipt_id
        where r.book_id=${bookId}),'[]'::jsonb),
      'suggestions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'body',s.body) order by s.id) from openerp.suggestion_records s
        where s.book_id=${bookId} and exists(select 1 from refs r where r.body->'presentedSuggestionIds' ? s.id)),'[]'::jsonb),
      'bankReversals',coalesce((select jsonb_agg(jsonb_build_object('id',b.plan_id,'statementId',b.statement_id,'rowOrdinal',b.row_ordinal,'digest',openerp.digest(b.body)) order by b.plan_id) from openerp.bank_match_reversals b where b.book_id=${bookId} and exists(select 1 from refs r where r.owner='bank_match' and r.body->'subject'->>'statementId'=b.statement_id and (r.body->'subject'->>'rowOrdinal')::integer=b.row_ordinal)),'[]'::jsonb),
      'attempts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'body',a.body) order by a.id) from openerp.supplier_extraction_attempts a where a.book_id=${bookId} and exists(select 1 from refs r where r.owner='extraction_field' and r.body->'subject'->>'attemptId'=a.id)),'[]'::jsonb),
      'vouchers',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'sequence',v.sequence::text,'purpose',v.posting_purpose,'original',(select original from edges where id=v.id limit 1),'bundleId',(select bundle_id from edges where id=v.id and bundle_id is not null limit 1),'bundleDigest',(select bundle_digest from edges where id=v.id and bundle_id is not null limit 1),'receiptId',(select x.id from openerp.execution_receipts x where x.book_id=v.book_id and x.voucher_id=v.id),
        'personal',exists(select 1 from personal_changes p where p.change_set_id=v.change_set_id or p.event_id=v.event_id),
        'body',case when not c.payload_allowed or exists(select 1 from personal_changes p where p.change_set_id=v.change_set_id or p.event_id=v.event_id) then null else v.action end) order by v.sequence)
        from openerp.vouchers v join chain_safe c on c.id=v.id where v.book_id=${bookId}),'[]'::jsonb)
    ) as body`,
    "objects",
  );
}

export function retain(
  transaction: Transaction,
  bookId: string,
  id: string,
  body: Schema.JsonObject,
  digest: string,
) {
  return transaction.execute(
    sql`insert into openerp.decision_example_exports(book_id,id,body,digest) values(${bookId},${id},${JSON.stringify(body)}::jsonb,${digest})`,
  );
}

export function read(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.decision_example_exports where book_id=${bookId} and id=${id}`,
    "objects",
  );
}
