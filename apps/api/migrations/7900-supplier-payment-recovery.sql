-- Forward-only PAY-1 hardening. Existing exported bytes and reservations are immutable.
-- A reported external outcome never creates a commerce allocation or a journal posting.
CREATE TABLE openerp.supplier_payee_proposals (
  book_id text NOT NULL, id text NOT NULL, counterparty_id text NOT NULL, counterparty_revision bigint NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors, evidence_id text NOT NULL,
  creditor_name text NOT NULL, creditor_iban text NOT NULL, creditor_bic text NOT NULL,
  body jsonb NOT NULL CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest')),
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,counterparty_id,counterparty_revision) REFERENCES openerp.commerce_counterparty_revisions,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.supplier_payee_verifications (
  book_id text NOT NULL, id text NOT NULL, proposal_id text NOT NULL,
  counterparty_id text NOT NULL, counterparty_revision bigint NOT NULL,
  evidence_id text NOT NULL, creditor_name text NOT NULL, creditor_iban text NOT NULL, creditor_bic text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  body jsonb NOT NULL CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest')),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,proposal_id),
  FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.supplier_payee_proposals,
  FOREIGN KEY(book_id,counterparty_id,counterparty_revision) REFERENCES openerp.commerce_counterparty_revisions,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.supplier_payment_outcomes (
  book_id text NOT NULL, id text NOT NULL, export_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 50),
  actor_id text NOT NULL REFERENCES openerp.actors, evidence_id text NOT NULL, status text NOT NULL
    CHECK (status IN ('unknown','reported_accepted','reported_settled','reported_rejected')),
  body jsonb NOT NULL CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest')),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,export_id,ordinal),
  FOREIGN KEY(book_id,export_id) REFERENCES openerp.supplier_payment_batch_exports,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TRIGGER supplier_payee_proposal_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_payee_proposals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payee_verification_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_payee_verifications
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payment_outcome_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_payment_outcomes
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.propose_supplier_payee(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_party openerp.commerce_counterparties; v_evidence jsonb;
  v_id text:=openerp.new_id('payee_proposal'); v_result jsonb;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'propose_supplier_payee',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(p_scope->>'bookId');
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['counterpartyId','expectedRevision','creditorName','creditorIban','creditorBic','evidenceId','reason']);
  SELECT * INTO v_party FROM openerp.commerce_counterparties c WHERE c.book_id=p_scope->>'bookId'
    AND c.id=openerp.commerce_text(p_input,'counterpartyId',128) AND c.role IN ('supplier','both');
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select a current supplier in this book.'); END IF;
  IF v_party.current_revision::text IS DISTINCT FROM openerp.commerce_text(p_input,'expectedRevision',18) THEN
    PERFORM openerp.fail('StaleDependency','Supplier identity changed. Review its current revision.'); END IF;
  PERFORM openerp.supplier_payment_xml(openerp.commerce_text(p_input,'creditorName',70));
  PERFORM openerp.supplier_payment_iban(openerp.commerce_text(p_input,'creditorIban',34));
  PERFORM openerp.supplier_payment_bic(openerp.commerce_text(p_input,'creditorBic',11));
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_evidence:=openerp.commerce_evidence(p_scope->>'bookId',openerp.commerce_text(p_input,'evidenceId',128));
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'counterpartyId',v_party.id,
    'counterpartyRevision',v_party.current_revision::text,'creditorName',p_input->>'creditorName',
    'creditorIban',p_input->>'creditorIban','creditorBic',p_input->>'creditorBic',
    'evidence',v_evidence,'reason',p_input->>'reason','status','pending','bankVerified',false)
    ||openerp.commerce_record_metadata(p_key,'propose_supplier_payee',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.supplier_payee_proposals VALUES(p_scope->>'bookId',v_id,v_party.id,v_party.current_revision,
    v_actor,p_input->>'evidenceId',p_input->>'creditorName',p_input->>'creditorIban',p_input->>'creditorBic',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'propose_supplier_payee',p_input,v_result);
END $$;
CREATE FUNCTION openerp.verify_supplier_payee(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_proposal openerp.supplier_payee_proposals;
  v_id text:=openerp.new_id('payee_verification'); v_result jsonb;
  v_payload jsonb:=jsonb_build_object('proposalId',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'verify_supplier_payee',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['digest','evidenceId','reason','confirmIndependentCheck']);
  SELECT * INTO v_proposal FROM openerp.supplier_payee_proposals p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Payee proposal was not found in this book.'); END IF;
  IF v_actor=v_proposal.actor_id OR p_input->'confirmIndependentCheck' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('ApprovalRequired','A different authorized operator must independently check the payee evidence.'); END IF;
  IF openerp.commerce_text(p_input,'digest',71) IS DISTINCT FROM v_proposal.body->>'digest'
    OR EXISTS(SELECT FROM openerp.supplier_payee_verifications v WHERE v.book_id=p_scope->>'bookId' AND v.proposal_id=p_id)
    OR p_id IS DISTINCT FROM (SELECT p.id FROM openerp.supplier_payee_proposals p
      WHERE p.book_id=p_scope->>'bookId' AND p.counterparty_id=v_proposal.counterparty_id
      ORDER BY p.body->>'createdAt' DESC,p.id COLLATE "C" DESC LIMIT 1)
    OR NOT EXISTS(SELECT FROM openerp.commerce_counterparties c WHERE c.book_id=p_scope->>'bookId'
      AND c.id=v_proposal.counterparty_id AND c.current_revision=v_proposal.counterparty_revision) THEN
    PERFORM openerp.fail('StaleDependency','Payee proposal was used or supplier identity changed. Prepare a new review.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  -- The independent check must cite the exact same retained payee evidence.
  IF openerp.commerce_text(p_input,'evidenceId',128) IS DISTINCT FROM v_proposal.evidence_id THEN
    PERFORM openerp.fail('MissingEvidence','Verify the exact retained account evidence cited in the proposal.'); END IF;
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'proposalId',p_id,'proposalDigest',v_proposal.body->>'digest',
    'counterpartyId',v_proposal.counterparty_id,'counterpartyRevision',v_proposal.counterparty_revision::text,
    'creditorName',v_proposal.creditor_name,'creditorIban',v_proposal.creditor_iban,'creditorBic',v_proposal.creditor_bic,
    'evidence',v_proposal.body->'evidence','status','independently_checked','bankVerified',false,
    'reason',p_input->>'reason')||openerp.commerce_record_metadata(p_key,'verify_supplier_payee',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.supplier_payee_verifications VALUES(p_scope->>'bookId',v_id,p_id,v_proposal.counterparty_id,
    v_proposal.counterparty_revision,v_proposal.evidence_id,v_proposal.creditor_name,v_proposal.creditor_iban,
    v_proposal.creditor_bic,v_actor,v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'verify_supplier_payee',v_payload,v_result);
END $$;

-- Any new account-change proposal invalidates earlier verified payee choices immediately.
CREATE FUNCTION openerp.supplier_payee_is_current(p_book text,p_id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT EXISTS(SELECT FROM openerp.supplier_payee_verifications v
    JOIN openerp.commerce_counterparties c ON c.book_id=v.book_id AND c.id=v.counterparty_id
    WHERE v.book_id=p_book AND v.id=p_id AND c.current_revision=v.counterparty_revision
      AND v.proposal_id=(SELECT p.id FROM openerp.supplier_payee_proposals p
        WHERE p.book_id=v.book_id AND p.counterparty_id=v.counterparty_id
        ORDER BY p.body->>'createdAt' DESC,p.id COLLATE "C" DESC LIMIT 1))
$$;
CREATE OR REPLACE FUNCTION openerp.supplier_payment_current(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_item jsonb; v_invoice openerp.commerce_invoices; v_body jsonb; v_evidence jsonb;
  v_verification openerp.supplier_payee_verifications; v_party openerp.commerce_counterparties;
  v_seen text[]:='{}'; v_total numeric:=0; v_items jsonb:='[]'; v_amount numeric; v_name text;
BEGIN
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','executionDate','debtorName','debtorIban','debtorBic','items','reason','acknowledgeOfflineOnly']);
  IF p_input->>'profile' IS DISTINCT FROM 'synthetic-offline-pain001-v1'
    OR p_input->'acknowledgeOfflineOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Only an explicitly acknowledged offline synthetic payment file is supported. Bank upload compatibility is not established.'); END IF;
  PERFORM openerp.commerce_require_profile(p_book);
  IF NOT EXISTS(SELECT FROM openerp.books b WHERE b.id=p_book AND b.currency='SEK' AND b.currency_scale=2) THEN
    PERFORM openerp.fail('UnsupportedProfile','This offline pain.001 profile requires exact SEK minor units at scale 2.'); END IF;
  IF openerp.bank_date(openerp.commerce_text(p_input,'executionDate',10))
    < (clock_timestamp() AT TIME ZONE 'UTC')::date THEN
    PERFORM openerp.fail('StaleDependency','The requested payment date has passed. Prepare a new preview.'); END IF;
  PERFORM openerp.supplier_payment_xml(openerp.commerce_text(p_input,'debtorName',70));
  PERFORM openerp.supplier_payment_iban(openerp.commerce_text(p_input,'debtorIban',34));
  PERFORM openerp.supplier_payment_bic(openerp.commerce_text(p_input,'debtorBic',11));
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  IF jsonb_typeof(p_input->'items') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Select a complete payment instruction array.'); END IF;
  IF jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 20 THEN
    PERFORM openerp.fail('InvalidJournal','Select one to twenty complete supplier payment instructions.'); END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
    PERFORM openerp.commerce_exact_object(v_item,ARRAY['invoiceId','expectedOutstandingMinor','expectedAllocationVersion',
      'amountMinor','creditorName','creditorIban','creditorBic','payeeEvidenceId','payeeVerificationId']);
    IF openerp.commerce_text(v_item,'invoiceId',128)=ANY(v_seen) THEN
      PERFORM openerp.fail('InvalidJournal','A supplier invoice may occur only once in a payment batch.'); END IF;
    v_seen:=array_append(v_seen,v_item->>'invoiceId');
    v_amount:=openerp.commerce_positive_minor(v_item,'amountMinor');
    IF v_amount>=1e36::numeric OR v_total+v_amount>=1e36::numeric THEN
      PERFORM openerp.fail('InvalidJournal','The batch exceeds exact minor-unit capacity.'); END IF;
    v_total:=v_total+v_amount;
    v_name:=openerp.commerce_text(v_item,'creditorName',70);
    PERFORM openerp.supplier_payment_xml(v_name);
    PERFORM openerp.supplier_payment_iban(openerp.commerce_text(v_item,'creditorIban',34));
    PERFORM openerp.supplier_payment_bic(openerp.commerce_text(v_item,'creditorBic',11));
    v_evidence:=openerp.commerce_evidence(p_book,openerp.commerce_text(v_item,'payeeEvidenceId',128));
    SELECT * INTO v_invoice FROM openerp.commerce_invoices i
      WHERE i.book_id=p_book AND i.id=v_item->>'invoiceId' AND i.direction='supplier';
    IF NOT FOUND OR NOT EXISTS(SELECT FROM openerp.supplier_acceptances a
      WHERE a.book_id=p_book AND a.register_invoice_id=v_invoice.id) THEN
      PERFORM openerp.fail('NotFound','Select an accepted synthetic supplier invoice in this book.'); END IF;
    IF EXISTS(SELECT FROM openerp.supplier_payment_batch_items x
      WHERE x.book_id=p_book AND x.invoice_id=v_invoice.id) THEN
      PERFORM openerp.fail('StaleDependency','This invoice already belongs to an exported file; resolve its outcome before another export.'); END IF;
    SELECT * INTO v_party FROM openerp.commerce_counterparties c WHERE c.book_id=p_book AND c.id=v_invoice.counterparty_id;
    SELECT * INTO v_verification FROM openerp.supplier_payee_verifications x
      WHERE x.book_id=p_book AND x.id=openerp.commerce_text(v_item,'payeeVerificationId',128)
        AND x.counterparty_id=v_invoice.counterparty_id;
    IF NOT FOUND OR NOT openerp.supplier_payee_is_current(p_book,v_verification.id)
      OR v_verification.counterparty_revision<>v_party.current_revision
      OR v_verification.evidence_id<>v_item->>'payeeEvidenceId'
      OR v_verification.creditor_name<>v_name OR v_verification.creditor_iban<>v_item->>'creditorIban'
      OR v_verification.creditor_bic<>v_item->>'creditorBic' THEN
      PERFORM openerp.fail('StaleDependency','A current, separately verified payee revision matching every account field and its evidence is required.'); END IF;
    PERFORM openerp.supplier_payment_xml(v_invoice.document_number);
    v_body:=openerp.commerce_invoice_body(p_book,v_invoice.id);
    IF v_body->'blockers'<>'[]'::jsonb OR v_body->>'outstandingMinor' IS NULL
      OR v_item->>'expectedOutstandingMinor' IS DISTINCT FROM v_body->>'outstandingMinor'
      OR v_item->>'expectedAllocationVersion' IS DISTINCT FROM v_body->>'allocationVersion'
      OR v_amount>(v_body->>'outstandingMinor')::numeric THEN
      PERFORM openerp.fail('StaleDependency','The posted supplier payable, allocations or selected outstanding amount changed. Reopen the invoice.'); END IF;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('invoiceId',v_invoice.id,'supplierDocumentNumber',v_invoice.document_number,
      'amountMinor',v_amount::text,'outstandingMinor',v_body->>'outstandingMinor',
      'allocationVersion',v_body->>'allocationVersion','creditorName',v_name,'creditorIban',v_item->>'creditorIban',
      'creditorBic',v_item->>'creditorBic','payeeVerificationId',v_verification.id,'counterpartyRevision',v_party.current_revision::text,'payeeEvidence',v_evidence));
  END LOOP;
  RETURN jsonb_build_object('items',v_items,'totalMinor',v_total::text,'count',jsonb_array_length(v_items));
END $$;


CREATE FUNCTION openerp.get_supplier_payee(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_proposal jsonb; v_verification jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT p.body INTO v_proposal FROM openerp.supplier_payee_proposals p
    WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Payee proposal was not found in this book.'); END IF;
  SELECT v.body INTO v_verification FROM openerp.supplier_payee_verifications v
    WHERE v.book_id=p_scope->>'bookId' AND v.proposal_id=p_id;
  RETURN jsonb_build_object('proposal',v_proposal,'verification',v_verification,
    'current',CASE WHEN v_verification IS NULL THEN false
      ELSE openerp.supplier_payee_is_current(p_scope->>'bookId',v_verification->>'id') END);
END $$;
CREATE FUNCTION openerp.list_supplier_payment_eligibility(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_invoice openerp.commerce_invoices; v_body jsonb; v_party openerp.commerce_counterparties;
  v_reasons jsonb; v_items jsonb:='[]'; v_next text; v_count integer:=0; v_verification jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  IF p_after IS NOT NULL AND (length(p_after)>128 OR p_after !~ '^[a-z][a-z0-9_-]{2,127}$') THEN
    PERFORM openerp.fail('InvalidJournal','Supply a valid payment eligibility cursor.'); END IF;
  FOR v_invoice IN SELECT * FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId'
    AND i.direction='supplier' AND i.id COLLATE "C">coalesce(p_after,'') COLLATE "C"
    ORDER BY i.id COLLATE "C" LIMIT 26 LOOP
    v_count:=v_count+1;
    IF v_count>25 THEN EXIT; END IF;
    v_body:=openerp.commerce_invoice_body(v_invoice.book_id,v_invoice.id);
    SELECT * INTO v_party FROM openerp.commerce_counterparties c WHERE c.book_id=v_invoice.book_id
      AND c.id=v_invoice.counterparty_id;
    SELECT x.body INTO v_verification FROM openerp.supplier_payee_verifications x
      WHERE x.book_id=v_invoice.book_id AND x.counterparty_id=v_invoice.counterparty_id
        AND x.counterparty_revision=v_party.current_revision AND openerp.supplier_payee_is_current(x.book_id,x.id)
      ORDER BY x.body->>'createdAt' DESC,x.id COLLATE "C" DESC LIMIT 1;
    v_reasons:='[]'::jsonb;
    IF NOT EXISTS(SELECT FROM openerp.supplier_acceptances a
      WHERE a.book_id=v_invoice.book_id AND a.register_invoice_id=v_invoice.id) THEN
      v_reasons:=v_reasons||jsonb_build_array('not_accepted_supplier_invoice'); END IF;
    IF v_body->'blockers'<>'[]'::jsonb THEN
      v_reasons:=v_reasons||jsonb_build_array('invoice_blocked'); END IF;
    IF v_body->>'outstandingMinor' IS NULL OR coalesce((v_body->>'outstandingMinor')::numeric,0)<=0 THEN
      v_reasons:=v_reasons||jsonb_build_array('no_positive_outstanding'); END IF;
    IF v_verification IS NULL THEN v_reasons:=v_reasons||jsonb_build_array('no_current_verified_payee'); END IF;
    IF EXISTS(SELECT FROM openerp.supplier_payment_batch_items x
      WHERE x.book_id=v_invoice.book_id AND x.invoice_id=v_invoice.id) THEN
      v_reasons:=v_reasons||jsonb_build_array('already_exported_outcome_unresolved'); END IF;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('invoiceId',v_invoice.id,
      'supplierDocumentNumber',v_invoice.document_number,'counterpartyId',v_invoice.counterparty_id,
      'currentCounterpartyRevision',v_party.current_revision::text,'payeeVerification',v_verification,
      'outstandingMinor',v_body->'outstandingMinor','allocationVersion',v_body->>'allocationVersion',
      'invoiceBlockers',v_body->'blockers','eligible',v_reasons='[]'::jsonb,'reasons',v_reasons));
    v_next:=v_invoice.id;
  END LOOP;
  RETURN jsonb_build_object('scope',p_scope,'items',v_items,'next',CASE WHEN v_count>25 THEN v_next ELSE NULL END,
    'pageSize',25,'coverage','registered_supplier_invoices_live');
END $$;

CREATE FUNCTION openerp.report_supplier_payment_outcome(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
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
    OR (v_latest='reported_accepted' AND p_input->>'status'='reported_rejected') THEN
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
CREATE OR REPLACE FUNCTION openerp.get_supplier_payment_batch(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_preview jsonb; v_export jsonb; v_outcomes jsonb; v_status text; v_current boolean:=false;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT r.body INTO v_preview FROM openerp.supplier_payment_batch_previews r
    WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The payment preview was not found in this book.'); END IF;
  SELECT e.body INTO v_export FROM openerp.supplier_payment_batch_exports e
    WHERE e.book_id=p_scope->>'bookId' AND e.preview_id=p_id;
  SELECT coalesce(jsonb_agg(o.body ORDER BY o.ordinal),'[]'::jsonb) INTO v_outcomes
    FROM openerp.supplier_payment_outcomes o WHERE o.book_id=p_scope->>'bookId' AND o.export_id=v_export->>'id';
  SELECT o.status INTO v_status FROM openerp.supplier_payment_outcomes o
    WHERE o.book_id=p_scope->>'bookId' AND o.export_id=v_export->>'id' ORDER BY o.ordinal DESC LIMIT 1;
  SELECT coalesce(bool_and(c.current_revision::text=item.value->>'counterpartyRevision'
    AND x.id IS NOT NULL),false) INTO v_current
    FROM jsonb_array_elements(v_preview->'selection'->'items') item(value)
    JOIN openerp.commerce_invoices i ON i.book_id=p_scope->>'bookId' AND i.id=item.value->>'invoiceId'
    JOIN openerp.commerce_counterparties c ON c.book_id=i.book_id AND c.id=i.counterparty_id
    LEFT JOIN openerp.supplier_payee_verifications x ON x.book_id=i.book_id AND x.id=item.value->>'payeeVerificationId'
      AND x.counterparty_id=c.id AND x.counterparty_revision=c.current_revision
      AND openerp.supplier_payee_is_current(x.book_id,x.id);
  RETURN jsonb_build_object('preview',v_preview,'export',v_export,'outcomes',v_outcomes,
    'payeeStillCurrent',v_current,'externalStatus',CASE WHEN v_export IS NULL THEN 'not_exported' ELSE coalesce(v_status,'exported') END,
    'bankVerified',false,'allocationCreated',false,
    'recovery','Retain exported bytes and reconcile bank evidence before recording payment. Never re-export an unresolved invoice.');
END $$;
REVOKE ALL ON openerp.supplier_payee_proposals,openerp.supplier_payee_verifications,openerp.supplier_payment_outcomes
  FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.supplier_payee_is_current(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.propose_supplier_payee(text,jsonb,text,jsonb),openerp.verify_supplier_payee(text,jsonb,text,text,jsonb),
  openerp.list_supplier_payment_eligibility(text,jsonb,text),openerp.get_supplier_payee(text,jsonb,text),openerp.report_supplier_payment_outcome(text,jsonb,text,text,jsonb)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.propose_supplier_payee(text,jsonb,text,jsonb),openerp.verify_supplier_payee(text,jsonb,text,text,jsonb),
  openerp.list_supplier_payment_eligibility(text,jsonb,text),openerp.get_supplier_payee(text,jsonb,text),openerp.report_supplier_payment_outcome(text,jsonb,text,text,jsonb)
  TO openerp_runtime;
