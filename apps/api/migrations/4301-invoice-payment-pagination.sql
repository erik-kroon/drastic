-- Keep payment pagination distinct from journal-line ordering and read the unallocation key.
CREATE OR REPLACE FUNCTION openerp.commerce_invoice_payments(p_token text,p_scope jsonb,p_id text,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ip_invoice jsonb; ip_page integer; ip_history_page integer; ip_result jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 ip_invoice:=openerp.commerce_invoice_body(p_scope->>'bookId',p_id);
 IF coalesce(p_query->>'page','1') !~ '^[1-9][0-9]{0,5}$'
  OR coalesce(p_query->>'historyPage','1') !~ '^[1-9][0-9]{0,5}$' THEN
  PERFORM openerp.fail('InvalidJournal','Choose a supported payment or history page.');
 END IF;
 ip_page:=coalesce(p_query->>'page','1')::integer;
 ip_history_page:=coalesce(p_query->>'historyPage','1')::integer;
 WITH eligible AS MATERIALIZED (
  SELECT l.*,v.posting_date,v.series||' '||v.number::text voucher_label,e.evidence_id
  FROM openerp.journal_lines l
  JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.voucher_id)
  JOIN openerp.events e ON (e.book_id,e.id)=(v.book_id,v.event_id)
  JOIN openerp.periods p ON (p.book_id,p.id)=(v.book_id,v.period_id)
  JOIN openerp.accounts a ON (a.book_id,a.id)=(l.book_id,l.account_id)
  WHERE l.book_id=p_scope->>'bookId' AND l.account_id=ip_invoice->>'controlAccountId'
   AND ip_invoice->>'status' IN ('open','partially_allocated')
   AND a.active AND NOT p.locked
   AND ((ip_invoice->>'direction'='customer' AND l.credit_minor>0)
    OR (ip_invoice->>'direction'='supplier' AND l.debit_minor>0))
   AND v.event_id<>ip_invoice->'recognition'->>'eventId'
   AND v.posting_date>=(ip_invoice->'recognition'->>'postingDate')::date
   AND openerp.commerce_voucher_current(l.book_id,l.voucher_id)
   AND NOT EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=l.book_id
    AND (i.recognition_voucher_id,i.recognition_line_id)=(l.voucher_id,l.id))
 ), capacities AS MATERIALIZED (
  SELECT e.*,openerp.commerce_payment_body(e.book_id,e.voucher_id,e.id) payment FROM eligible e
 ), candidates AS MATERIALIZED (
  SELECT c.*,row_number() OVER(ORDER BY c.posting_date DESC,c.voucher_id COLLATE "C",c.id COLLATE "C") page_ordinal
  FROM capacities c WHERE (c.payment->>'remainingMinor')::numeric>0
 ), history AS MATERIALIZED (
  SELECT p.id,p.body,leg.value leg,r.id receipt_id,
   CASE WHEN reversed.plan_id IS NOT NULL THEN 'released' WHEN r.id IS NOT NULL THEN 'matched' ELSE 'review' END status,
   v.series||' '||v.number::text voucher_label,
   row_number() OVER(ORDER BY p.body->>'createdAt' DESC,p.id COLLATE "C") ordinal
  FROM openerp.commerce_allocation_plans p
  CROSS JOIN LATERAL jsonb_array_elements(p.body->'legs') leg(value)
  JOIN openerp.vouchers v ON v.book_id=p.book_id AND v.id=p.body->'payment'->>'voucherId'
  LEFT JOIN openerp.commerce_allocation_receipts r ON (r.book_id,r.plan_id)=(p.book_id,p.id)
  LEFT JOIN openerp.commerce_allocation_reversals reversed ON (reversed.book_id,reversed.receipt_id)=(r.book_id,r.id)
  WHERE p.book_id=p_scope->>'bookId' AND leg.value->>'invoiceId'=p_id
 )
 SELECT jsonb_build_object('scope',p_scope,'invoiceId',p_id,'page',ip_page,'historyPage',ip_history_page,'pageSize',25,
  'total',(SELECT count(*) FROM candidates),'historyTotal',(SELECT count(*) FROM history),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('payment',c.payment,'voucherLabel',c.voucher_label,
   'description',c.description,'evidence',openerp.commerce_evidence(c.book_id,c.evidence_id),
   'sourceTitle',e.title) ORDER BY c.page_ordinal)
   FROM candidates c JOIN openerp.evidence e ON (e.book_id,e.id)=(c.book_id,c.evidence_id)
   WHERE c.page_ordinal>(ip_page-1)*25 AND c.page_ordinal<=ip_page*25),'[]'::jsonb),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('planId',h.id,'createdAt',h.body->>'createdAt',
   'postingDate',h.body->'payment'->>'postingDate','voucherLabel',h.voucher_label,
   'amountMinor',h.leg->>'amountMinor','status',h.status,'receiptId',h.receipt_id) ORDER BY h.ordinal)
   FROM history h WHERE h.ordinal>(ip_history_page-1)*25 AND h.ordinal<=ip_history_page*25),'[]'::jsonb)) INTO ip_result;
 RETURN ip_result;
END $$;
REVOKE ALL ON FUNCTION openerp.commerce_invoice_payments(text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.commerce_invoice_payments(text,jsonb,text,jsonb) TO openerp_runtime;
