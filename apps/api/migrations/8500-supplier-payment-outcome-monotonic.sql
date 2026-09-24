-- Preserve a reported acceptance across later outcome reports. An unknown report must not erase it
-- and enable a contradictory rejection through the latest-status guard. No prior rows change.
CREATE OR REPLACE FUNCTION openerp.report_supplier_payment_outcome(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_export openerp.supplier_payment_batch_exports;
  v_latest text; v_ordinal integer; v_evidence jsonb; v_id text:=openerp.new_id('payment_outcome'); v_result jsonb;
  v_payload jsonb:=jsonb_build_object('exportId',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'report_supplier_payment_outcome',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['exportSha256','status','evidenceId','externalReference','reason','acknowledgeNoAccountingEffect']);
  IF p_input->'acknowledgeNoAccountingEffect' IS DISTINCT FROM 'true'::jsonb
    OR p_input->>'status' NOT IN ('unknown','reported_accepted','reported_settled','reported_rejected') THEN
    PERFORM openerp.fail('InvalidJournal','Report an allowed external state without creating accounting effects.'); END IF;
  SELECT * INTO v_export FROM openerp.supplier_payment_batch_exports e WHERE e.book_id=p_scope->>'bookId' AND e.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Exported payment file was not found in this book.'); END IF;
  IF openerp.commerce_text(p_input,'exportSha256',64) IS DISTINCT FROM v_export.body->>'sha256' THEN
    PERFORM openerp.fail('StaleDependency','External outcome must cite the exact immutable exported file hash.'); END IF;
  PERFORM openerp.commerce_text(p_input,'externalReference',200);
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_evidence:=openerp.commerce_evidence(p_scope->>'bookId',openerp.commerce_text(p_input,'evidenceId',128));
  SELECT o.status,o.ordinal+1 INTO v_latest,v_ordinal FROM openerp.supplier_payment_outcomes o
    WHERE o.book_id=p_scope->>'bookId' AND o.export_id=p_id ORDER BY o.ordinal DESC LIMIT 1;
  v_ordinal:=coalesce(v_ordinal,1);
  IF v_ordinal>50 OR v_latest IN ('reported_settled','reported_rejected')
    OR (p_input->>'status' IN ('unknown','reported_rejected') AND EXISTS (
      SELECT FROM openerp.supplier_payment_outcomes o
      WHERE o.book_id=p_scope->>'bookId' AND o.export_id=p_id AND o.status='reported_accepted')) THEN
    PERFORM openerp.fail('StaleDependency','Terminal or contradictory external outcome cannot be overwritten. Escalate for reconciliation.'); END IF;
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'exportId',p_id,'exportSha256',v_export.body->>'sha256',
    'status',p_input->>'status','ordinal',v_ordinal,'evidence',v_evidence,
    'externalReference',p_input->>'externalReference','reason',p_input->>'reason',
    'bankVerified',false,'paid',false,'allocationCreated',false)
    ||openerp.commerce_record_metadata(p_key,'report_supplier_payment_outcome',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.supplier_payment_outcomes VALUES(p_scope->>'bookId',v_id,p_id,v_ordinal,v_actor,
    p_input->>'evidenceId',p_input->>'status',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'report_supplier_payment_outcome',v_payload,v_result);
END $$;
