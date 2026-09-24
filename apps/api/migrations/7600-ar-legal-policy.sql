-- Forward-only legal policy activation. Retained SYN issues stay separate and synthetic.
-- Mervärdesskattelag (2023:200), 9 kap. 2 § and 17 kap. 22–24 §§,
-- official SFS response SHA256 2253cdec0ac7b73af3213e72e7b804fa256131bb82a2b5d24154ec462c0f88e4 (2026-09-24).
-- No tax classification follows from a rate: each transaction still needs separate admission.
CREATE TABLE openerp.ar_legal_policies (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
 candidate_id text NOT NULL, review_id text NOT NULL, series text COLLATE "C" NOT NULL,
 activated_by text NOT NULL REFERENCES openerp.actors,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=131072),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,candidate_id), UNIQUE(book_id,series),
 FOREIGN KEY(book_id,candidate_id) REFERENCES openerp.invoice_policy_candidates,
 FOREIGN KEY(book_id,review_id) REFERENCES openerp.invoice_policy_reviews,
 CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'activatedBy'=activated_by
  AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_ar_legal_policy BEFORE UPDATE OR DELETE ON openerp.ar_legal_policies
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.ar_legal_policies FROM PUBLIC,openerp_runtime;
CREATE FUNCTION openerp.activate_ar_legal_policy(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_candidate openerp.invoice_policy_candidates;
 v_review openerp.invoice_policy_reviews; v_book openerp.books; v_identity jsonb; v_body jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(v_book.id,p_key,v_actor,'activate_ar_legal_policy',p_input);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['candidateId','candidateDigest','reviewId','reviewDigest',
  'series','ruleVersion','sourceEvidence','activationEvidence','reason','acceptReviewedPolicy','acknowledgeIssueBlocked']);
 IF p_input->'acceptReviewedPolicy' IS DISTINCT FROM 'true'::jsonb
  OR p_input->'acknowledgeIssueBlocked' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('ApprovalRequired','Explicitly accept the independent review and the blocked issuance, credit and delivery limits.'); END IF;
 IF v_book.authority<>'native' OR v_book.currency<>'SEK' OR v_book.currency_scale<>2 THEN
  PERFORM openerp.fail('UnsupportedProfile','This legal sales profile requires a native SEK book with two minor-unit decimals.'); END IF;
 SELECT * INTO v_candidate FROM openerp.invoice_policy_candidates WHERE book_id=v_book.id AND id=p_input->>'candidateId';
 SELECT * INTO v_review FROM openerp.invoice_policy_reviews WHERE book_id=v_book.id AND id=p_input->>'reviewId'
  AND candidate_id=p_input->>'candidateId';
 IF v_candidate.id IS NULL OR v_review.id IS NULL THEN
  PERFORM openerp.fail('NotFound','Select a reviewed policy candidate in this book.'); END IF;
 IF p_input->>'candidateDigest' IS DISTINCT FROM v_candidate.body->>'digest'
  OR p_input->>'reviewDigest' IS DISTINCT FROM v_review.body->>'digest'
  OR v_candidate.body->>'digest' IS DISTINCT FROM openerp.digest(v_candidate.body-'digest')
  OR v_review.body->>'digest' IS DISTINCT FROM openerp.digest(v_review.body-'digest')
  OR v_review.body->'input'->>'candidateDigest' IS DISTINCT FROM v_candidate.body->>'digest'
  OR v_actor IN (v_candidate.actor_id,v_review.actor_id) THEN
  PERFORM openerp.fail('ApprovalRequired','A third current operator must activate the exact reviewed policy.'); END IF;
 IF p_input->>'ruleVersion' IS DISTINCT FROM 'se-domestic-standard-25-2023-200-v1'
  OR coalesce(p_input->>'series','') !~ '^[A-Z][A-Z0-9-]{0,11}$'
  OR left(p_input->>'series',3)='SYN'
  OR v_candidate.body->'input'->>'legalNumbering' IS DISTINCT FROM 'sequential-per-series-v1'
  OR v_candidate.body->'input'->>'vatTreatment' IS DISTINCT FROM 'se-domestic-standard-25-v1'
  OR v_candidate.body->'input'->>'roundingMethod' IS DISTINCT FROM 'line-tax-half-up-minor-v1' THEN
  PERFORM openerp.fail('UnsupportedProfile','Only explicit sequential numbering and domestic standard-rate line-tax half-up rounding are supported.'); END IF;
 IF v_candidate.body->'input'->>'effectiveFrom' < current_date::text
  OR v_candidate.body->'input'->>'effectiveFrom' > '2027-12-31' THEN
  PERFORM openerp.fail('UnsupportedProfile','Activation cannot backdate a legal policy.'); END IF;
 v_identity:=v_candidate.body->'input'->'sellerIdentity';
 IF v_identity->>'countryCode'<>'SE' OR coalesce(v_identity->>'vatRegistrationNumber','') !~ '^SE[0-9]{12}$'
  OR coalesce(v_identity->>'registrationNumber','') !~ '^[0-9]{6}-?[0-9]{4}$' THEN
  PERFORM openerp.fail('UnsupportedProfile','This profile requires an asserted Swedish legal seller and VAT registration number.'); END IF;
 PERFORM openerp.invoice_policy_require_evidence(v_book.id,p_input->'sourceEvidence');
 PERFORM openerp.invoice_policy_require_evidence(v_book.id,p_input->'activationEvidence');
 IF openerp.commerce_text(p_input,'reason',2000)='' THEN PERFORM openerp.fail('InvalidJournal','Record the activation reason.'); END IF;
 IF (SELECT count(*) FROM openerp.ar_legal_policies WHERE book_id=v_book.id)>=50 THEN
  PERFORM openerp.fail('UnsupportedProfile','The bounded legal policy history is full.'); END IF;
 IF EXISTS(SELECT FROM openerp.ar_legal_policies WHERE book_id=v_book.id AND candidate_id=v_candidate.id) THEN
  PERFORM openerp.fail('IdempotencyConflict','This candidate already has an activation. Recover it by ID.'); END IF;
 IF EXISTS(SELECT FROM openerp.ar_legal_policies WHERE book_id=v_book.id AND series=p_input->>'series') THEN
  PERFORM openerp.fail('IdempotencyConflict','A legal number series cannot be reused in this book.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('ar_policy'),'scope',p_scope,'candidate',v_candidate.body,
  'review',v_review.body,'input',p_input,'activatedBy',v_actor,
  'activatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'status','active','legalInvoiceEnabled',false,'creditEnabled',false,'deliveryEnabled',false); 
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.ar_legal_policies VALUES(v_book.id,v_body->>'id',v_candidate.id,v_review.id,p_input->>'series',v_actor,v_body);
 RETURN openerp.save_command(v_book.id,p_key,v_actor,'activate_ar_legal_policy',p_input,v_body);
END $$;
CREATE FUNCTION openerp.get_ar_legal_policy(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_body jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT body INTO v_body FROM openerp.ar_legal_policies WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Active legal sales policy was not found in this book.'); END IF;
 RETURN v_body;
END $$;
CREATE FUNCTION openerp.ar_legal_policy_history(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT coalesce(jsonb_agg(body ORDER BY id),'[]') INTO v_items
 FROM openerp.ar_legal_policies WHERE book_id=p_scope->>'bookId';
 IF jsonb_array_length(v_items)>50 THEN PERFORM openerp.fail('UnsupportedProfile','Legal policy history exceeds its complete-list bound.'); END IF;
 RETURN jsonb_build_object('scope',p_scope,'complete',true,'items',v_items);
END $$;
REVOKE ALL ON FUNCTION openerp.ar_legal_policy_history(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.ar_legal_policy_history(text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.activate_ar_legal_policy(text,jsonb,text,jsonb),openerp.get_ar_legal_policy(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.activate_ar_legal_policy(text,jsonb,text,jsonb),openerp.get_ar_legal_policy(text,jsonb,text) TO openerp_runtime;
