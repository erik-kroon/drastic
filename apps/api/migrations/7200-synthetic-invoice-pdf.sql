-- Synthetic historical PDF only. Existing SYN issues and HTML bytes remain unchanged.
CREATE TABLE openerp.invoice_pdf_captures (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, issue_id text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors, body jsonb NOT NULL CHECK(octet_length(body::text)<=524288),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,issue_id),
 FOREIGN KEY(book_id,issue_id) REFERENCES openerp.invoice_issues(book_id,id),
 CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->'input'->>'issueId'=issue_id
   AND body->>'createdBy'=actor_id AND body->>'digest'=openerp.digest(body-'digest')
   AND body->>'sourceDigest'=openerp.digest(body->'source'))
);
CREATE TABLE openerp.invoice_pdf_artifacts (
 book_id text NOT NULL, capture_id text NOT NULL, descriptor jsonb NOT NULL, content bytea NOT NULL,
 PRIMARY KEY(book_id,capture_id), FOREIGN KEY(book_id,capture_id) REFERENCES openerp.invoice_pdf_captures,
 CHECK(octet_length(content) BETWEEN 1 AND 1048576),
 CHECK(descriptor->>'captureId'=capture_id AND descriptor->>'sha256'=encode(sha256(content),'hex')
   AND (descriptor->>'byteLength')::integer=octet_length(content))
);
CREATE TRIGGER immutable_invoice_pdf_capture BEFORE UPDATE OR DELETE ON openerp.invoice_pdf_captures
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_pdf_artifact BEFORE UPDATE OR DELETE ON openerp.invoice_pdf_artifacts
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_pdf_captures,openerp.invoice_pdf_artifacts FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.capture_invoice_pdf(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_issue jsonb; v_review jsonb; v_source jsonb; v_body jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'capture_invoice_pdf',p_input);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['issueId','issueDigest','generatorVersion']);
 IF p_input->>'generatorVersion' IS DISTINCT FROM 'openerp-synthetic-invoice-pdf-v1' THEN
  PERFORM openerp.fail('UnsupportedProfile','Only a fixed synthetic PDF review format is supported.'); END IF;
 SELECT i.body,r.body INTO v_issue,v_review FROM openerp.invoice_issues i
 JOIN openerp.invoice_issue_reviews r ON (r.book_id,r.id)=(i.book_id,i.review_id)
 WHERE i.book_id=p_scope->>'bookId' AND i.id=p_input->>'issueId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The synthetic issue was not found.'); END IF;
 IF v_issue->>'digest' IS DISTINCT FROM p_input->>'issueDigest'
  OR v_issue->>'digest' IS DISTINCT FROM openerp.digest(v_issue-'digest')
  OR v_review->>'digest' IS DISTINCT FROM openerp.digest(v_review-'digest')
  OR v_issue->>'reviewDigest' IS DISTINCT FROM v_review->>'digest'
  OR v_issue->>'draftDigest' IS DISTINCT FROM v_review->'draftSnapshot'->>'digest'
  OR v_issue->'scope' IS DISTINCT FROM p_scope OR v_review->'scope' IS DISTINCT FROM p_scope THEN
  PERFORM openerp.fail('StaleDependency','Select the exact retained issue and review.'); END IF;
 IF v_issue->>'profile' IS DISTINCT FROM 'synthetic-manual-invoice-v1'
  OR v_issue->'issued' IS DISTINCT FROM 'true'::jsonb
  OR v_issue->'legalInvoice' IS DISTINCT FROM 'false'::jsonb
  OR v_issue->'delivered' IS DISTINCT FROM 'false'::jsonb
  OR v_issue->'legalDocumentNumber' IS DISTINCT FROM 'null'::jsonb THEN
  PERFORM openerp.fail('UnsupportedProfile','Real-company invoice and delivery profiles are not active.'); END IF;
 IF NOT EXISTS(SELECT FROM openerp.execution_receipts e WHERE e.book_id=p_scope->>'bookId'
  AND e.id=v_issue->'postingReceipt'->>'id' AND e.body=v_issue->'postingReceipt'
  AND e.change_set_id=v_review->'postingPlan'->>'id')
  OR NOT EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId'
   AND i.id=v_issue->>'registerInvoiceId' AND i.recognition_voucher_id=v_issue->'postingReceipt'->>'voucherId'
   AND i.document_number=v_issue->>'internalDocumentNumber')
  OR NOT EXISTS(SELECT FROM openerp.evidence e WHERE e.book_id=p_scope->>'bookId'
   AND e.id=v_review->'evidence'->>'id' AND e.sha256=v_review->'evidence'->>'sha256') THEN
  PERFORM openerp.fail('StaleDependency','The issued posting, register and evidence must agree.'); END IF;
 SELECT c.body INTO v_body FROM openerp.invoice_pdf_captures c WHERE c.book_id=p_scope->>'bookId' AND c.issue_id=p_input->>'issueId';
 IF FOUND THEN
  IF v_body->'input' IS DISTINCT FROM p_input THEN PERFORM openerp.fail('IdempotencyConflict','A different PDF capture already exists for this issue.'); END IF;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'capture_invoice_pdf',p_input,v_body);
 END IF;
 v_source:=jsonb_build_object('review',v_review,'issue',v_issue);
 v_body:=jsonb_build_object('id',openerp.new_id('invoice_pdf'),'scope',p_scope,'input',p_input,
  'source',v_source,'sourceDigest',openerp.digest(v_source),'createdBy',v_actor,
  'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'historicalOnly',true,'legalInvoice',false,'delivered',false);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 IF octet_length(v_body::text)>524288 THEN PERFORM openerp.fail('UnsupportedProfile','The complete source exceeds the PDF capture limit.'); END IF;
 INSERT INTO openerp.invoice_pdf_captures VALUES(p_scope->>'bookId',v_body->>'id',v_issue->>'id',v_actor,v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'capture_invoice_pdf',p_input,v_body);
END $$;

CREATE FUNCTION openerp.get_invoice_pdf(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_capture jsonb; v_artifact jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
 SELECT body INTO v_capture FROM openerp.invoice_pdf_captures WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','PDF capture was not found in this book.'); END IF;
 SELECT descriptor||jsonb_build_object('contentBase64',replace(encode(content,'base64'),E'\n','')) INTO v_artifact
 FROM openerp.invoice_pdf_artifacts WHERE book_id=p_scope->>'bookId' AND capture_id=p_id;
 RETURN jsonb_build_object('capture',v_capture,'artifact',v_artifact);
END $$;

CREATE FUNCTION openerp.seal_invoice_pdf(p_token text,p_scope jsonb,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_capture openerp.invoice_pdf_captures; v_content bytea; v_existing bytea; v_descriptor jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 SELECT * INTO v_capture FROM openerp.invoice_pdf_captures WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','PDF capture was not found in this book.'); END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['captureDigest','sourceDigest','contentBase64','sha256','byteLength']);
 IF p_input->>'captureDigest' IS DISTINCT FROM v_capture.body->>'digest'
 OR p_input->>'sourceDigest' IS DISTINCT FROM v_capture.body->>'sourceDigest'
 OR v_capture.body->>'sourceDigest' IS DISTINCT FROM openerp.digest(v_capture.body->'source')
 OR NOT EXISTS(SELECT FROM openerp.invoice_issues i JOIN openerp.invoice_issue_reviews r ON (r.book_id,r.id)=(i.book_id,i.review_id)
    WHERE i.book_id=v_capture.book_id AND i.id=v_capture.issue_id
    AND i.body=v_capture.body->'source'->'issue' AND r.body=v_capture.body->'source'->'review') THEN
  PERFORM openerp.fail('StaleDependency','Only captured immutable issue facts can be sealed.'); END IF;
 IF jsonb_typeof(p_input->'contentBase64') IS DISTINCT FROM 'string'
  OR length(p_input->>'contentBase64') NOT BETWEEN 4 AND 1398104
  OR (p_input->>'contentBase64') !~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
  OR coalesce(p_input->>'byteLength','') !~ '^[1-9][0-9]{0,6}$'
  OR coalesce(p_input->>'sha256','') !~ '^[a-f0-9]{64}$' THEN
  PERFORM openerp.fail('InvalidJournal','Supply bounded canonical PDF bytes, length and SHA256.'); END IF;
 v_content:=decode(p_input->>'contentBase64','base64');
 IF octet_length(v_content) NOT BETWEEN 1 AND 1048576
  OR replace(encode(v_content,'base64'),E'\n','') IS DISTINCT FROM p_input->>'contentBase64'
  OR octet_length(v_content)<>(p_input->>'byteLength')::integer
  OR encode(sha256(v_content),'hex') IS DISTINCT FROM p_input->>'sha256'
  OR substring(v_content FROM 1 FOR 8) IS DISTINCT FROM convert_to('%PDF-1.4','UTF8') THEN
  PERFORM openerp.fail('InvalidJournal','The PDF signature, bytes, hash or length did not match.'); END IF;
 SELECT content INTO v_existing FROM openerp.invoice_pdf_artifacts WHERE book_id=v_capture.book_id AND capture_id=p_id;
 IF FOUND THEN
  IF v_existing IS DISTINCT FROM v_content THEN PERFORM openerp.fail('IdempotencyConflict','Different bytes cannot replace a sealed PDF.'); END IF;
  RETURN openerp.get_invoice_pdf(p_token,p_scope,p_id);
 END IF;
 v_descriptor:=jsonb_build_object('captureId',p_id,'captureDigest',v_capture.body->>'digest',
  'filename',p_id||'.pdf','mediaType','application/pdf','byteLength',octet_length(v_content),
  'sha256',encode(sha256(v_content),'hex'),
  'sealedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'legalInvoice',false,'delivered',false);
 INSERT INTO openerp.invoice_pdf_artifacts VALUES(v_capture.book_id,p_id,v_descriptor,v_content);
 RETURN openerp.get_invoice_pdf(p_token,p_scope,p_id);
END $$;

CREATE FUNCTION openerp.invoice_pdf_history(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
 IF NOT EXISTS(SELECT FROM openerp.invoice_issues WHERE book_id=p_scope->>'bookId' AND id=p_id) THEN
  PERFORM openerp.fail('NotFound','The issue was not found in this book.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'digest',c.body->>'digest',
  'sealed',a.capture_id IS NOT NULL,'sha256',a.descriptor->>'sha256')),'[]') INTO v_items
 FROM openerp.invoice_pdf_captures c LEFT JOIN openerp.invoice_pdf_artifacts a ON (a.book_id,a.capture_id)=(c.book_id,c.id)
 WHERE c.book_id=p_scope->>'bookId' AND c.issue_id=p_id;
 RETURN jsonb_build_object('scope',p_scope,'issueId',p_id,'complete',true,'items',v_items);
END $$;
REVOKE ALL ON FUNCTION openerp.capture_invoice_pdf(text,jsonb,text,jsonb),openerp.get_invoice_pdf(text,jsonb,text),
 openerp.seal_invoice_pdf(text,jsonb,text,jsonb),openerp.invoice_pdf_history(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.capture_invoice_pdf(text,jsonb,text,jsonb),openerp.get_invoice_pdf(text,jsonb,text),
 openerp.seal_invoice_pdf(text,jsonb,text,jsonb),openerp.invoice_pdf_history(text,jsonb,text) TO openerp_runtime;
