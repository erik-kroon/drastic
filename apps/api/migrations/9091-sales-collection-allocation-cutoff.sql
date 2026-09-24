-- SALES-3 forward repair: use committed allocation and executed reversal timestamps at statement cutoff.
CREATE OR REPLACE FUNCTION openerp.capture_collection_statement(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_body jsonb; v_items jsonb; v_asof date; v_cutoff timestamptz:=statement_timestamp();
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'capture_collection_statement',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['customerId','asOf']);
 IF coalesce(p_input->>'asOf','') !~ '^\d{4}-\d{2}-\d{2}$' THEN PERFORM openerp.fail('InvalidJournal','Supply an as-of date.'); END IF;
 BEGIN v_asof:=(p_input->>'asOf')::date; EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  PERFORM openerp.fail('InvalidJournal','Supply a valid as-of date.'); END;
 IF v_asof>(v_cutoff AT TIME ZONE 'UTC')::date THEN PERFORM openerp.fail('InvalidJournal','Future statements are unsupported.'); END IF;
 IF NOT EXISTS(SELECT FROM openerp.commerce_counterparties WHERE book_id=p_scope->>'bookId' AND id=p_input->>'customerId' AND role IN ('customer','both')) THEN
  PERFORM openerp.fail('NotFound','Customer was not found in this book.'); END IF;
 IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId' AND i.counterparty_id=p_input->>'customerId' AND i.direction='customer' AND i.issued_on<=v_asof AND openerp.commerce_invoice_body(i.book_id,i.id)->>'status'='blocked') THEN
  PERFORM openerp.fail('StaleDependency','Resolve blocked invoice accounting before capturing a statement.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('invoiceId',i.id,'number',i.document_number,'issuedOn',i.issued_on,
  'currency',i.body->>'currency','currencyScale',(i.body->>'currencyScale')::integer,
  'amountMinor',i.amount_minor::text,'allocatedMinor',a.allocated::text,'outstandingMinor',(i.amount_minor-a.allocated)::text,
  'status',v.body->>'status','disputed',EXISTS(SELECT FROM openerp.collection_disputes d WHERE d.book_id=i.book_id AND d.invoice_id=i.id
    AND NOT EXISTS(SELECT FROM openerp.collection_events e WHERE e.book_id=d.book_id AND e.dispute_id=d.id AND e.kind='dispute_resolved')))
  ORDER BY i.issued_on,i.id),'[]') INTO v_items
 FROM openerp.commerce_invoices i
 CROSS JOIN LATERAL (SELECT openerp.commerce_invoice_body(i.book_id,i.id) body) v
 CROSS JOIN LATERAL (SELECT coalesce(sum(l.amount_minor),0) allocated FROM openerp.commerce_allocation_legs l
  JOIN openerp.commerce_allocation_receipts r ON (r.book_id,r.id)=(l.book_id,l.receipt_id)
  JOIN openerp.vouchers payment ON (payment.book_id,payment.id)=(l.book_id,l.payment_voucher_id)
  WHERE l.book_id=i.book_id AND l.invoice_id=i.id AND payment.posting_date<=v_asof
   AND (r.body->>'committedAt')::timestamptz<=v_cutoff AND NOT EXISTS(
    SELECT FROM openerp.commerce_allocation_reversals rev WHERE (rev.book_id,rev.receipt_id)=(r.book_id,r.id)
     AND (rev.body->>'executedAt')::timestamptz<=v_cutoff)) a
 WHERE i.book_id=p_scope->>'bookId' AND i.counterparty_id=p_input->>'customerId' AND i.direction='customer'
  AND i.issued_on<=v_asof;
 v_body:=jsonb_build_object('id',openerp.new_id('collection_statement'),'scope',p_scope,'customerId',p_input->>'customerId',
  'asOf',v_asof,'cutoffAt',to_char(v_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'items',v_items,'createdBy',v_actor,'createdAt',to_char(v_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.collection_statements VALUES(p_scope->>'bookId',v_body->>'id',p_input->>'customerId',v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'capture_collection_statement',p_input,v_body);
END $$;

