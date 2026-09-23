-- Align commerce payment admission with the existing4100 physical reservation fence.
-- No new ownership policy, capacity math, output shape, replay path or history interpretation.
CREATE OR REPLACE FUNCTION openerp.commerce_payment_body(p_book text,p_voucher text,p_line text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_line openerp.journal_lines; v_voucher openerp.vouchers; v_book openerp.books; v_direction text;
  v_amount numeric; v_allocated numeric; v_count bigint;
BEGIN
  SELECT * INTO v_line FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=p_voucher AND l.id=p_line;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select an existing posted control-account line in this book.'); END IF;
  SELECT c.direction INTO v_direction FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=v_line.account_id;
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','The line account has not been explicitly registered as a commerce control account.'); END IF;
  SELECT * INTO STRICT v_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher;
  IF NOT openerp.commerce_voucher_current(p_book,p_voucher)
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher AND i.recognition_line_id=p_line)
    OR (v_direction='customer' AND v_line.credit_minor=0) OR (v_direction='supplier' AND v_line.debit_minor=0) THEN
    PERFORM openerp.fail('InvalidJournal','Use a current opposite-side settlement line, never recognition or reversal.'); END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c
    WHERE c.book_id=p_book AND c.voucher_id=p_voucher AND c.line_id=p_line) THEN
    PERFORM openerp.fail('StaleDependency','Explicitly unmatch the tax-account review before another register consumes this whole posted line.'); END IF;
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
  v_amount:=v_line.debit_minor+v_line.credit_minor;
  SELECT coalesce(sum(l.amount_minor),0),count(*) INTO v_allocated,v_count FROM openerp.commerce_active_allocation_legs l
    WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line;
  SELECT count(*)+(SELECT count(*) FROM openerp.commerce_allocation_legs l
    JOIN openerp.commerce_allocation_reversals r ON (r.book_id,r.receipt_id)=(l.book_id,l.receipt_id)
    WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line) INTO v_count
    FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line;
  IF v_allocated>v_amount THEN PERFORM openerp.fail('StaleDependency','Payment allocations exceed the posted control-line capacity.'); END IF;
  RETURN jsonb_build_object('voucherId',p_voucher,'lineId',p_line,'scope',jsonb_build_object('bookId',p_book,'entityId',v_book.entity_id),
    'direction',v_direction,'accountId',v_line.account_id,'postingDate',v_voucher.posting_date::text,'currency',v_book.currency,
    'currencyScale',v_book.currency_scale,'amountMinor',v_amount::text,'allocatedMinor',v_allocated::text,
    'remainingMinor',(v_amount-v_allocated)::text,'capacityVersion',v_count::text);
END $$;

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
   AND NOT EXISTS(SELECT FROM openerp.tax_account_match_capacity c
    WHERE c.book_id=l.book_id AND c.voucher_id=l.voucher_id AND c.line_id=l.id)
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
REVOKE ALL ON FUNCTION openerp.commerce_payment_body(text,text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_invoice_payments(text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.commerce_invoice_payments(text,jsonb,text,jsonb) TO openerp_runtime;
