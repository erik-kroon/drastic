-- Review of asserted company facts only. No active legal profile or number allocation exists.
CREATE TABLE openerp.invoice_policy_candidates (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, profile_key text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors, body jsonb NOT NULL CHECK(octet_length(body::text)<=131072),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,profile_key),
 CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'createdBy'=actor_id
  AND body->'input'->>'profileKey'=profile_key AND body->>'status'='unactivated'
  AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.invoice_policy_reviews (
 book_id text NOT NULL, id text NOT NULL, candidate_id text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors, body jsonb NOT NULL CHECK(octet_length(body::text)<=131072),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,candidate_id),
 FOREIGN KEY(book_id,candidate_id) REFERENCES openerp.invoice_policy_candidates,
 CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id
  AND body->>'candidateId'=candidate_id AND body->>'createdBy'=actor_id
  AND body->>'status'='reviewed_unactivated' AND body->'legalInvoiceEnabled'='false'::jsonb
  AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_invoice_policy_candidate BEFORE UPDATE OR DELETE ON openerp.invoice_policy_candidates
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_policy_review BEFORE UPDATE OR DELETE ON openerp.invoice_policy_reviews
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_policy_candidates,openerp.invoice_policy_reviews FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.invoice_policy_require_evidence(p_book text,p_reference jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
 PERFORM openerp.commerce_exact_object(p_reference,ARRAY['evidenceId','sha256']);
 IF coalesce(p_reference->>'evidenceId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
  OR coalesce(p_reference->>'sha256','') !~ '^[a-f0-9]{64}$'
  OR NOT EXISTS(SELECT FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_reference->>'evidenceId'
   AND e.sha256=p_reference->>'sha256') THEN
  PERFORM openerp.fail('MissingEvidence','The asserted company policy needs retained evidence in the same book.'); END IF;
END $$;
CREATE FUNCTION openerp.save_invoice_policy_candidate(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_body jsonb; v_name text;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'save_invoice_policy_candidate',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['profileKey','sellerIdentity','sellerEvidence','legalNumbering',
  'numberingEvidence','vatTreatment','vatEvidence','roundingMethod','roundingEvidence','creditNotePolicy',
  'correctionPolicy','correctionEvidence','effectiveFrom','reason','acknowledgeUnactivated']);
 IF p_input->'acknowledgeUnactivated' IS DISTINCT FROM 'true'::jsonb
  OR coalesce(p_input->>'profileKey','') !~ '^[a-z][a-z0-9_-]{2,127}$'
  OR coalesce(p_input->>'effectiveFrom','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  PERFORM openerp.fail('UnsupportedProfile','State a proposed identity, date and explicit unactivated-only acknowledgment.'); END IF;
 BEGIN PERFORM (p_input->>'effectiveFrom')::date;
 EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  PERFORM openerp.fail('InvalidJournal','Enter an actual proposed effective date.'); END;
 PERFORM openerp.commerce_exact_object(p_input->'sellerIdentity',ARRAY['legalName','registrationNumber','vatRegistrationNumber','postalAddress','countryCode']);
 IF coalesce(p_input->'sellerIdentity'->>'countryCode','') !~ '^[A-Z]{2}$' THEN
  PERFORM openerp.fail('InvalidJournal','Enter an asserted seller country code.'); END IF;
 FOREACH v_name IN ARRAY ARRAY['legalName','registrationNumber','postalAddress'] LOOP
  IF jsonb_typeof(p_input->'sellerIdentity'->v_name) IS DISTINCT FROM 'string'
   OR char_length(p_input->'sellerIdentity'->>v_name) NOT BETWEEN 1 AND 2000
   OR btrim(p_input->'sellerIdentity'->>v_name)='' THEN
   PERFORM openerp.fail('InvalidJournal','Seller legal identity fields must be explicit assertions.'); END IF;
 END LOOP;
 IF jsonb_typeof(p_input->'sellerIdentity'->'vatRegistrationNumber') NOT IN ('null','string')
  OR (jsonb_typeof(p_input->'sellerIdentity'->'vatRegistrationNumber')='string'
  AND char_length(p_input->'sellerIdentity'->>'vatRegistrationNumber') NOT BETWEEN 1 AND 2000) THEN
  PERFORM openerp.fail('InvalidJournal','VAT registration must be an assertion or explicitly null.'); END IF;
 FOREACH v_name IN ARRAY ARRAY['legalNumbering','vatTreatment','roundingMethod','creditNotePolicy','correctionPolicy','reason'] LOOP
  IF jsonb_typeof(p_input->v_name) IS DISTINCT FROM 'string'
   OR char_length(p_input->>v_name) NOT BETWEEN 1 AND 2000
   OR btrim(p_input->>v_name)='' THEN
    PERFORM openerp.fail('InvalidJournal','Every proposed seller, number, VAT, rounding, credit/correction field and reason must be explicit.'); END IF;
 END LOOP;
 FOREACH v_name IN ARRAY ARRAY['sellerEvidence','numberingEvidence','vatEvidence','roundingEvidence','correctionEvidence'] LOOP
  PERFORM openerp.invoice_policy_require_evidence(p_scope->>'bookId',p_input->v_name);
 END LOOP;
 IF EXISTS(SELECT FROM openerp.invoice_policy_candidates WHERE book_id=p_scope->>'bookId' AND profile_key=p_input->>'profileKey') THEN
  PERFORM openerp.fail('IdempotencyConflict','That proposed profile key already has immutable content. Use a new key for changed assertions.'); END IF;
 IF (SELECT count(*) FROM openerp.invoice_policy_candidates WHERE book_id=p_scope->>'bookId')>=50 THEN
  PERFORM openerp.fail('UnsupportedProfile','The bounded invoice policy candidate history is full.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('invoice_policy'),'scope',p_scope,'input',p_input,
  'status','unactivated','createdBy',v_actor,
  'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 IF octet_length(v_body::text)>131072 THEN PERFORM openerp.fail('UnsupportedProfile','The complete policy proposal is too large.'); END IF;
 INSERT INTO openerp.invoice_policy_candidates VALUES(p_scope->>'bookId',v_body->>'id',p_input->>'profileKey',v_actor,v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'save_invoice_policy_candidate',p_input,v_body);
END $$;
CREATE FUNCTION openerp.review_invoice_policy_candidate(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_candidate openerp.invoice_policy_candidates; v_body jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'review_invoice_policy_candidate',jsonb_build_object('id',p_id,'input',p_input));
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 SELECT * INTO v_candidate FROM openerp.invoice_policy_candidates WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Policy proposal was not found in this book.'); END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['candidateDigest','reviewEvidence','findings','acknowledgeNoLegalActivation']);
 IF p_input->>'candidateDigest' IS DISTINCT FROM v_candidate.body->>'digest'
  OR p_input->'acknowledgeNoLegalActivation' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('StaleDependency','Review the exact unactivated candidate and acknowledge its limit.'); END IF;
 IF v_actor=v_candidate.actor_id THEN PERFORM openerp.fail('ApprovalRequired','Another current operator must review this proposal.'); END IF;
 IF jsonb_typeof(p_input->'findings') IS DISTINCT FROM 'string'
  OR char_length(p_input->>'findings') NOT BETWEEN 1 AND 2000 OR btrim(p_input->>'findings')='' THEN
  PERFORM openerp.fail('InvalidJournal','Record specific review findings.'); END IF;
 PERFORM openerp.invoice_policy_require_evidence(p_scope->>'bookId',p_input->'reviewEvidence');
 IF EXISTS(SELECT FROM openerp.invoice_policy_reviews WHERE book_id=p_scope->>'bookId' AND candidate_id=p_id) THEN
  PERFORM openerp.fail('IdempotencyConflict','This candidate already has an immutable review. Use a new proposal for changes.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('invoice_policy_review'),'scope',p_scope,'candidateId',p_id,
  'input',p_input,'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'status','reviewed_unactivated','legalInvoiceEnabled',false);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.invoice_policy_reviews VALUES(p_scope->>'bookId',v_body->>'id',p_id,v_actor,v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'review_invoice_policy_candidate',jsonb_build_object('id',p_id,'input',p_input),v_body);
END $$;
CREATE FUNCTION openerp.get_invoice_policy_candidate(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_candidate jsonb; v_review jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
 SELECT body INTO v_candidate FROM openerp.invoice_policy_candidates WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Policy proposal was not found in this book.'); END IF;
 SELECT body INTO v_review FROM openerp.invoice_policy_reviews WHERE book_id=p_scope->>'bookId' AND candidate_id=p_id;
 RETURN jsonb_build_object('candidate',v_candidate,'review',v_review,'legalInvoiceEnabled',false);
END $$;
CREATE FUNCTION openerp.invoice_policy_history(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('candidate',c.body,'review',r.body,'legalInvoiceEnabled',false)
  ORDER BY c.id),'[]') INTO v_items FROM openerp.invoice_policy_candidates c
 LEFT JOIN openerp.invoice_policy_reviews r ON (r.book_id,r.candidate_id)=(c.book_id,c.id)
 WHERE c.book_id=p_scope->>'bookId';
 RETURN jsonb_build_object('scope',p_scope,'complete',true,'items',v_items);
END $$;
REVOKE ALL ON FUNCTION openerp.invoice_policy_require_evidence(text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.save_invoice_policy_candidate(text,jsonb,text,jsonb),
 openerp.review_invoice_policy_candidate(text,jsonb,text,text,jsonb),
 openerp.get_invoice_policy_candidate(text,jsonb,text),openerp.invoice_policy_history(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.save_invoice_policy_candidate(text,jsonb,text,jsonb),
 openerp.review_invoice_policy_candidate(text,jsonb,text,text,jsonb),
 openerp.get_invoice_policy_candidate(text,jsonb,text),openerp.invoice_policy_history(text,jsonb) TO openerp_runtime;
