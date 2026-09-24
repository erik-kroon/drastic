ALTER TABLE openerp.collection_events
  ADD CONSTRAINT collection_event_reminder_send_unauthorized
  CHECK (kind<>'reminder_prepared' OR body @> '{"sendAuthorized":false}'::jsonb) NOT VALID;

CREATE INDEX collection_statement_history
  ON openerp.collection_statements(book_id,customer_id,(body->>'createdAt') COLLATE "C",id COLLATE "C");
CREATE INDEX collection_dispute_history
  ON openerp.collection_disputes(book_id,customer_id,(body->>'createdAt') COLLATE "C",id COLLATE "C");
CREATE INDEX collection_action_history
  ON openerp.collection_events(book_id,customer_id,(body->>'createdAt') COLLATE "C",id COLLATE "C");

CREATE FUNCTION openerp.collection_history_page(p_token text,p_scope jsonb,p_customer text,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_result jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 IF NOT EXISTS(SELECT FROM openerp.commerce_counterparties WHERE book_id=p_scope->>'bookId' AND id=p_customer AND role IN ('customer','both')) THEN
  PERFORM openerp.fail('NotFound','Customer was not found in this book.'); END IF;
 IF p_after<>'' AND (length(p_after)>256
  OR split_part(p_after,'|',1) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
  OR split_part(p_after,'|',2) !~ '^[a-z][a-z0-9_]{2,127}$') THEN
  PERFORM openerp.fail('InvalidJournal','Use a returned collection history cursor.'); END IF;
 WITH history(record_at,record_id,record_kind,body) AS (
  SELECT body->>'createdAt',id,'statement',body FROM openerp.collection_statements
   WHERE book_id=p_scope->>'bookId' AND customer_id=p_customer
  UNION ALL
  SELECT body->>'createdAt',id,'dispute',body FROM openerp.collection_disputes
   WHERE book_id=p_scope->>'bookId' AND customer_id=p_customer
  UNION ALL
  SELECT body->>'createdAt',id,'event',body FROM openerp.collection_events
   WHERE book_id=p_scope->>'bookId' AND customer_id=p_customer
 ), page AS (
  SELECT * FROM history WHERE p_after='' OR
   (record_at COLLATE "C",record_id COLLATE "C")<
   (split_part(p_after,'|',1) COLLATE "C",split_part(p_after,'|',2) COLLATE "C")
   ORDER BY record_at COLLATE "C" DESC,record_id COLLATE "C" DESC LIMIT 51
 ), visible AS (
  SELECT * FROM page ORDER BY record_at COLLATE "C" DESC,record_id COLLATE "C" DESC LIMIT 50
 )
 SELECT jsonb_build_object('scope',p_scope,'customerId',p_customer,
  'statements',coalesce((SELECT jsonb_agg(body ORDER BY record_at COLLATE "C" DESC,record_id COLLATE "C" DESC)
   FROM visible WHERE record_kind='statement'),'[]'::jsonb),
  'disputes',coalesce((SELECT jsonb_agg(body ORDER BY record_at COLLATE "C" DESC,record_id COLLATE "C" DESC)
   FROM visible WHERE record_kind='dispute'),'[]'::jsonb),
  'events',coalesce((SELECT jsonb_agg(body ORDER BY record_at COLLATE "C" DESC,record_id COLLATE "C" DESC)
   FROM visible WHERE record_kind='event'),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN
   (SELECT record_at||'|'||record_id FROM visible ORDER BY record_at COLLATE "C" DESC,record_id COLLATE "C" DESC LIMIT 1)
   ELSE NULL END) INTO v_result;
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION openerp.open_collection_dispute(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
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
 PERFORM 1 FROM openerp.memberships WHERE book_id=p_scope->>'bookId' AND actor_id=p_input->>'ownerId' FOR SHARE;
 IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Choose a current member of this book as dispute owner.'); END IF;
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

CREATE OR REPLACE FUNCTION openerp.record_collection_action(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
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
  OR length(btrim(coalesce(p_input->>'note',''))) NOT BETWEEN 1 AND 2000 THEN
  PERFORM openerp.fail('InvalidJournal','Supply an action and note.'); END IF;
 PERFORM 1 FROM openerp.memberships WHERE book_id=p_scope->>'bookId' AND actor_id=p_input->>'ownerId' FOR SHARE;
 IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Choose a current member of this book as action owner.'); END IF;
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

REVOKE ALL ON FUNCTION openerp.collection_history_page(text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.collection_history_page(text,jsonb,text,text) TO openerp_runtime;
