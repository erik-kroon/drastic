-- SALES-3: immutable snapshots and collection action history. No reminder is sent here.
CREATE TABLE openerp.collection_statements (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, customer_id text NOT NULL,
 body jsonb NOT NULL CHECK (octet_length(body::text)<=262144),
 PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,customer_id) REFERENCES openerp.commerce_counterparties(book_id,id)
);
CREATE TABLE openerp.collection_disputes (
 book_id text NOT NULL REFERENCES openerp.books,id text NOT NULL,invoice_id text NOT NULL,
 customer_id text NOT NULL,body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
 PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices(book_id,id),
 FOREIGN KEY(book_id,customer_id) REFERENCES openerp.commerce_counterparties(book_id,id)
);
CREATE TABLE openerp.collection_events (
 book_id text NOT NULL REFERENCES openerp.books,id text NOT NULL,customer_id text NOT NULL,
 invoice_id text, dispute_id text,kind text NOT NULL CHECK(kind IN ('contact','follow_up','dispute_resolved','reminder_prepared')),
 body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
 PRIMARY KEY(book_id,id),FOREIGN KEY(book_id,customer_id) REFERENCES openerp.commerce_counterparties(book_id,id),
 FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices(book_id,id),
 FOREIGN KEY(book_id,dispute_id) REFERENCES openerp.collection_disputes(book_id,id)
);
CREATE INDEX collection_dispute_invoice ON openerp.collection_disputes(book_id,invoice_id);
CREATE INDEX collection_event_customer ON openerp.collection_events(book_id,customer_id);
CREATE TRIGGER immutable_collection_statement BEFORE UPDATE OR DELETE ON openerp.collection_statements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_collection_dispute BEFORE UPDATE OR DELETE ON openerp.collection_disputes FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_collection_event BEFORE UPDATE OR DELETE ON openerp.collection_events FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.collection_statements,openerp.collection_disputes,openerp.collection_events FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.collection_history(p_token text,p_scope jsonb,p_customer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_result jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 IF NOT EXISTS(SELECT FROM openerp.commerce_counterparties WHERE book_id=p_scope->>'bookId' AND id=p_customer AND role IN ('customer','both')) THEN
  PERFORM openerp.fail('NotFound','Customer was not found in this book.'); END IF;
 SELECT jsonb_build_object('scope',p_scope,'customerId',p_customer,'complete',true,
  'statements',(SELECT coalesce(jsonb_agg(body ORDER BY body->>'createdAt',id),'[]') FROM openerp.collection_statements WHERE book_id=p_scope->>'bookId' AND customer_id=p_customer),
  'disputes',(SELECT coalesce(jsonb_agg(body ORDER BY body->>'createdAt',id),'[]') FROM openerp.collection_disputes WHERE book_id=p_scope->>'bookId' AND customer_id=p_customer),
  'events',(SELECT coalesce(jsonb_agg(body ORDER BY body->>'createdAt',id),'[]') FROM openerp.collection_events WHERE book_id=p_scope->>'bookId' AND customer_id=p_customer)) INTO v_result;
 RETURN v_result;
END $$;

CREATE FUNCTION openerp.capture_collection_statement(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
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
   AND (r.body->>'createdAt')::timestamptz<=v_cutoff AND NOT EXISTS(
    SELECT FROM openerp.commerce_allocation_reversals rev WHERE (rev.book_id,rev.receipt_id)=(r.book_id,r.id)
     AND (rev.body->>'createdAt')::timestamptz<=v_cutoff)) a
 WHERE i.book_id=p_scope->>'bookId' AND i.counterparty_id=p_input->>'customerId' AND i.direction='customer'
  AND i.issued_on<=v_asof;
 v_body:=jsonb_build_object('id',openerp.new_id('collection_statement'),'scope',p_scope,'customerId',p_input->>'customerId',
  'asOf',v_asof,'cutoffAt',to_char(v_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'items',v_items,'createdBy',v_actor,'createdAt',to_char(v_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.collection_statements VALUES(p_scope->>'bookId',v_body->>'id',p_input->>'customerId',v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'capture_collection_statement',p_input,v_body);
END $$;

CREATE FUNCTION openerp.open_collection_dispute(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_invoice openerp.commerce_invoices; v_body jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'open_collection_dispute',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['invoiceId','reason','evidenceId','ownerId','holdReminders']);
 IF length(btrim(coalesce(p_input->>'reason',''))) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_input->'holdReminders')<>'boolean'
  OR length(coalesce(p_input->>'ownerId','')) NOT BETWEEN 3 AND 128 THEN
  PERFORM openerp.fail('InvalidJournal','Supply a reason, owner and explicit reminder hold.'); END IF;
 PERFORM openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId');
 IF NOT EXISTS(SELECT FROM openerp.actors WHERE id=p_input->>'ownerId') THEN PERFORM openerp.fail('NotFound','The assigned owner was not found.'); END IF;
 SELECT * INTO v_invoice FROM openerp.commerce_invoices WHERE book_id=p_scope->>'bookId' AND id=p_input->>'invoiceId' AND direction='customer';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Customer invoice was not found in this book.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('collection_dispute'),'scope',p_scope,'invoiceId',v_invoice.id,
  'customerId',v_invoice.counterparty_id,'reason',p_input->>'reason','evidenceId',p_input->>'evidenceId',
  'ownerId',p_input->>'ownerId','holdReminders',p_input->'holdReminders','createdBy',v_actor,
  'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.collection_disputes VALUES(p_scope->>'bookId',v_body->>'id',v_invoice.id,v_invoice.counterparty_id,v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'open_collection_dispute',p_input,v_body);
END $$;

CREATE FUNCTION openerp.record_collection_action(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_invoice openerp.commerce_invoices; v_dispute openerp.collection_disputes;
 v_body jsonb; v_status jsonb; v_kind text:=p_input->>'kind';
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'record_collection_action',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['invoiceId','kind','note','ownerId','disputeId']);
 IF v_kind NOT IN ('contact','follow_up','dispute_resolved','reminder_prepared')
  OR length(btrim(coalesce(p_input->>'note',''))) NOT BETWEEN 1 AND 2000
  OR NOT EXISTS(SELECT FROM openerp.actors WHERE id=p_input->>'ownerId') THEN
  PERFORM openerp.fail('InvalidJournal','Supply an action, note and assigned owner.'); END IF;
 SELECT * INTO v_invoice FROM openerp.commerce_invoices WHERE book_id=p_scope->>'bookId' AND id=p_input->>'invoiceId' AND direction='customer';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Customer invoice was not found in this book.'); END IF;
 IF v_kind='dispute_resolved' THEN
  SELECT * INTO v_dispute FROM openerp.collection_disputes WHERE book_id=v_invoice.book_id AND id=p_input->>'disputeId' AND invoice_id=v_invoice.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Dispute was not found for this invoice.'); END IF;
  IF EXISTS(SELECT FROM openerp.collection_events WHERE book_id=v_dispute.book_id AND dispute_id=v_dispute.id AND kind='dispute_resolved') THEN
   PERFORM openerp.fail('Conflict','The dispute was already resolved.'); END IF;
 ELSIF p_input->'disputeId'<>'null'::jsonb THEN
  PERFORM openerp.fail('InvalidJournal','Only dispute resolution can name a dispute.'); END IF;
 IF v_kind='reminder_prepared' THEN
  v_status:=openerp.commerce_invoice_body(v_invoice.book_id,v_invoice.id);
  IF v_status->>'status' NOT IN ('open','partially_allocated') OR coalesce((v_status->>'outstandingMinor')::numeric,0)<=0
   OR EXISTS(SELECT FROM openerp.collection_disputes d WHERE d.book_id=v_invoice.book_id AND d.invoice_id=v_invoice.id
    AND d.body->'holdReminders'='true'::jsonb AND NOT EXISTS(SELECT FROM openerp.collection_events e
     WHERE e.book_id=d.book_id AND e.dispute_id=d.id AND e.kind='dispute_resolved')) THEN
   PERFORM openerp.fail('StaleDependency','A settled, blocked or held invoice cannot be prepared for reminder.'); END IF;
 END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('collection_action'),'scope',p_scope,'customerId',v_invoice.counterparty_id,
  'invoiceId',v_invoice.id,'disputeId',p_input->'disputeId','kind',v_kind,'note',p_input->>'note',
  'ownerId',p_input->>'ownerId','createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'outstandingMinor',CASE WHEN v_kind='reminder_prepared' THEN v_status->'outstandingMinor' ELSE 'null'::jsonb END,
  'sendAuthorized',false);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.collection_events VALUES(v_invoice.book_id,v_body->>'id',v_invoice.counterparty_id,v_invoice.id,
  CASE WHEN v_kind='dispute_resolved' THEN v_dispute.id ELSE NULL END,v_kind,v_body);
 RETURN openerp.save_command(v_invoice.book_id,p_key,v_actor,'record_collection_action',p_input,v_body);
END $$;
REVOKE ALL ON FUNCTION openerp.collection_history(text,jsonb,text),openerp.capture_collection_statement(text,jsonb,text,jsonb),
 openerp.open_collection_dispute(text,jsonb,text,jsonb),openerp.record_collection_action(text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.collection_history(text,jsonb,text),openerp.capture_collection_statement(text,jsonb,text,jsonb),
 openerp.open_collection_dispute(text,jsonb,text,jsonb),openerp.record_collection_action(text,jsonb,text,jsonb) TO openerp_runtime;
