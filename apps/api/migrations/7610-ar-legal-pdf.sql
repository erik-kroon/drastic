-- Legal PDF capture is distinct from immutable synthetic PDF captures and never rewrites SYN bytes.
-- ar_legal_issues is created in forward 8100+; its FK is added there after table creation.
CREATE TABLE openerp.ar_legal_pdf_captures (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, issue_id text NOT NULL,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=524288),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,issue_id),
 CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'issueId'=issue_id
  AND body->>'sourceDigest'=openerp.digest(body->'source') AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.ar_legal_pdf_artifacts (
 book_id text NOT NULL, capture_id text NOT NULL, descriptor jsonb NOT NULL,
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 2097152),
 PRIMARY KEY(book_id,capture_id), FOREIGN KEY(book_id,capture_id) REFERENCES openerp.ar_legal_pdf_captures,
 CHECK(descriptor->>'captureId'=capture_id AND descriptor->>'sha256'=encode(sha256(content),'hex')
  AND (descriptor->>'byteLength')::integer=octet_length(content))
);
CREATE TRIGGER immutable_ar_legal_pdf_capture BEFORE UPDATE OR DELETE ON openerp.ar_legal_pdf_captures
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_pdf_artifact BEFORE UPDATE OR DELETE ON openerp.ar_legal_pdf_artifacts
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.ar_legal_pdf_captures,openerp.ar_legal_pdf_artifacts FROM PUBLIC,openerp_runtime;
CREATE FUNCTION openerp.capture_ar_legal_pdf(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_issue jsonb; v_source jsonb; v_body jsonb; v_existing jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'capture_ar_legal_pdf',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['issueId','issueDigest','rendererVersion']);
 IF p_input->>'rendererVersion' IS DISTINCT FROM 'openerp-se-invoice-takumi-v1' THEN
  PERFORM openerp.fail('UnsupportedProfile','Select the pinned Takumi legal invoice renderer.'); END IF;
 SELECT body INTO v_issue FROM openerp.ar_legal_issues WHERE book_id=p_scope->>'bookId' AND id=p_input->>'issueId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal issue was not found in this book.'); END IF;
 IF v_issue->>'digest' IS DISTINCT FROM p_input->>'issueDigest'
  OR v_issue->>'digest' IS DISTINCT FROM openerp.digest(v_issue-'digest')
  OR v_issue->'scope' IS DISTINCT FROM p_scope
  OR v_issue->'issued' IS DISTINCT FROM 'true'::jsonb
  OR v_issue->'legalInvoice' IS DISTINCT FROM 'true'::jsonb
  OR v_issue->'recognized' IS DISTINCT FROM 'true'::jsonb
  OR v_issue->'delivered' IS DISTINCT FROM 'false'::jsonb
  OR v_issue->'policySnapshot'->>'digest' IS DISTINCT FROM v_issue->>'policyDigest'
  OR v_issue->'draftSnapshot'->>'digest' IS DISTINCT FROM openerp.digest(v_issue->'draftSnapshot'-'digest')
  OR v_issue->>'legalDocumentNumber' LIKE 'SYN-%'
  OR NOT EXISTS(SELECT FROM openerp.ar_legal_policies p WHERE p.book_id=p_scope->>'bookId'
   AND p.id=v_issue->>'policyId' AND p.body=v_issue->'policySnapshot')
  OR NOT EXISTS(SELECT FROM openerp.execution_receipts e WHERE e.book_id=p_scope->>'bookId'
   AND e.id=v_issue->'postingReceipt'->>'id' AND e.body=v_issue->'postingReceipt')
  OR NOT EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId'
   AND i.id=v_issue->>'registerInvoiceId' AND i.document_number=v_issue->>'legalDocumentNumber'
   AND i.recognition_voucher_id=v_issue->'postingReceipt'->>'voucherId') THEN
  PERFORM openerp.fail('StaleDependency','Only the exact approved legal issue, policy, posted receipt and register can be captured.'); END IF;
 SELECT body INTO v_existing FROM openerp.ar_legal_pdf_captures WHERE book_id=p_scope->>'bookId' AND issue_id=p_input->>'issueId';
 IF FOUND THEN
  IF v_existing->'input' IS DISTINCT FROM p_input THEN
   PERFORM openerp.fail('IdempotencyConflict','This issue already has an immutable different PDF capture.'); END IF;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'capture_ar_legal_pdf',p_input,v_existing);
 END IF;
 v_source:=jsonb_build_object('issue',v_issue);
 v_body:=jsonb_build_object('id',openerp.new_id('ar_pdf'),'scope',p_scope,'issueId',v_issue->>'id',
  'input',p_input,'source',v_source,'sourceDigest',openerp.digest(v_source),
  'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 IF octet_length(v_body::text)>524288 THEN PERFORM openerp.fail('UnsupportedProfile','Complete legal PDF source exceeds 512 KiB.'); END IF;
 INSERT INTO openerp.ar_legal_pdf_captures VALUES(p_scope->>'bookId',v_body->>'id',v_issue->>'id',v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'capture_ar_legal_pdf',p_input,v_body);
END $$;
CREATE FUNCTION openerp.get_ar_legal_pdf(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_capture jsonb; v_artifact jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT body INTO v_capture FROM openerp.ar_legal_pdf_captures WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal PDF capture was not found in this book.'); END IF;
 SELECT descriptor||jsonb_build_object('contentBase64',replace(encode(content,'base64'),E'\n','')) INTO v_artifact
 FROM openerp.ar_legal_pdf_artifacts WHERE book_id=p_scope->>'bookId' AND capture_id=p_id;
 RETURN jsonb_build_object('capture',v_capture,'artifact',v_artifact);
END $$;
CREATE FUNCTION openerp.seal_ar_legal_pdf(p_token text,p_scope jsonb,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_capture openerp.ar_legal_pdf_captures; v_bytes bytea; v_existing bytea; v_descriptor jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 SELECT * INTO v_capture FROM openerp.ar_legal_pdf_captures WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal PDF capture was not found in this book.'); END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['captureDigest','sourceDigest','contentBase64','sha256','byteLength']);
 IF p_input->>'captureDigest' IS DISTINCT FROM v_capture.body->>'digest'
  OR p_input->>'sourceDigest' IS DISTINCT FROM v_capture.body->>'sourceDigest'
  OR v_capture.body->>'sourceDigest' IS DISTINCT FROM openerp.digest(v_capture.body->'source')
  OR NOT EXISTS(SELECT FROM openerp.ar_legal_issues i WHERE i.book_id=v_capture.book_id
   AND i.id=v_capture.issue_id AND i.body=v_capture.body->'source'->'issue') THEN
  PERFORM openerp.fail('StaleDependency','Render only the captured immutable legal issue facts.'); END IF;
 IF jsonb_typeof(p_input->'contentBase64') IS DISTINCT FROM 'string'
  OR length(p_input->>'contentBase64') NOT BETWEEN 4 AND 2796204
  OR (p_input->>'contentBase64') !~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
  OR coalesce(p_input->>'byteLength','') !~ '^[1-9][0-9]{0,6}$'
  OR coalesce(p_input->>'sha256','') !~ '^[a-f0-9]{64}$' THEN
  PERFORM openerp.fail('InvalidJournal','Supply bounded canonical PDF bytes, SHA256 and exact length.'); END IF;
 v_bytes:=decode(p_input->>'contentBase64','base64');
 IF octet_length(v_bytes) NOT BETWEEN 1 AND 2097152
  OR replace(encode(v_bytes,'base64'),E'\n','') IS DISTINCT FROM p_input->>'contentBase64'
  OR octet_length(v_bytes)<>(p_input->>'byteLength')::integer
  OR encode(sha256(v_bytes),'hex') IS DISTINCT FROM p_input->>'sha256'
  OR substring(v_bytes FROM 1 FOR 5) IS DISTINCT FROM convert_to('%PDF-','UTF8') THEN
  PERFORM openerp.fail('InvalidJournal','The legal PDF signature, bytes, hash or length did not match.'); END IF;
 SELECT content INTO v_existing FROM openerp.ar_legal_pdf_artifacts WHERE book_id=v_capture.book_id AND capture_id=p_id;
 IF FOUND THEN
  IF v_existing IS DISTINCT FROM v_bytes THEN PERFORM openerp.fail('IdempotencyConflict','Different bytes cannot replace this legal PDF.'); END IF;
  RETURN openerp.get_ar_legal_pdf(p_token,p_scope,p_id);
 END IF;
 v_descriptor:=jsonb_build_object('captureId',p_id,'captureDigest',v_capture.body->>'digest',
  'filename',v_capture.body->'source'->'issue'->>'legalDocumentNumber'||'.pdf','mediaType','application/pdf',
  'byteLength',octet_length(v_bytes),'sha256',encode(sha256(v_bytes),'hex'),
  'sealedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'legalInvoice',true,'delivered',false,'rendererVersion','openerp-se-invoice-takumi-v1');
 INSERT INTO openerp.ar_legal_pdf_artifacts VALUES(v_capture.book_id,p_id,v_descriptor,v_bytes);
 RETURN openerp.get_ar_legal_pdf(p_token,p_scope,p_id);
END $$;
CREATE FUNCTION openerp.ar_legal_pdf_history(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 IF NOT EXISTS(SELECT FROM openerp.ar_legal_issues WHERE book_id=p_scope->>'bookId' AND id=p_id) THEN
  PERFORM openerp.fail('NotFound','Legal issue was not found in this book.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'digest',c.body->>'digest',
  'sealed',a.capture_id IS NOT NULL,'sha256',a.descriptor->>'sha256')),'[]') INTO v_items
 FROM openerp.ar_legal_pdf_captures c LEFT JOIN openerp.ar_legal_pdf_artifacts a
 ON (a.book_id,a.capture_id)=(c.book_id,c.id) WHERE c.book_id=p_scope->>'bookId' AND c.issue_id=p_id;
 RETURN jsonb_build_object('scope',p_scope,'issueId',p_id,'complete',true,'items',v_items);
END $$;
REVOKE ALL ON FUNCTION openerp.capture_ar_legal_pdf(text,jsonb,text,jsonb),openerp.get_ar_legal_pdf(text,jsonb,text),
 openerp.seal_ar_legal_pdf(text,jsonb,text,jsonb),openerp.ar_legal_pdf_history(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.capture_ar_legal_pdf(text,jsonb,text,jsonb),openerp.get_ar_legal_pdf(text,jsonb,text),
 openerp.seal_ar_legal_pdf(text,jsonb,text,jsonb),openerp.ar_legal_pdf_history(text,jsonb,text) TO openerp_runtime;
