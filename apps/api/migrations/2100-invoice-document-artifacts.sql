-- Historical synthetic review documents only. No number, ledger, register or delivery transition.
CREATE TABLE openerp.invoice_document_captures (
 book_id text NOT NULL REFERENCES openerp.books,id text NOT NULL,issue_id text NOT NULL,review_id text NOT NULL,
 generator_version text NOT NULL CHECK(generator_version='openerp-synthetic-invoice-html-v1'),
 actor_id text NOT NULL REFERENCES openerp.actors,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=524288),
 PRIMARY KEY(book_id,id),UNIQUE(book_id,issue_id,generator_version),
 FOREIGN KEY(book_id,issue_id) REFERENCES openerp.invoice_issues(book_id,id),
 FOREIGN KEY(book_id,review_id) REFERENCES openerp.invoice_issue_reviews(book_id,id),
 CHECK(body->>'id' IS NOT DISTINCT FROM id),
 CHECK(body->'scope'->>'bookId' IS NOT DISTINCT FROM book_id),
 CHECK(body->'input'->>'issueId' IS NOT DISTINCT FROM issue_id),
 CHECK(body->'source'->'issue'->>'id' IS NOT DISTINCT FROM issue_id),
 CHECK(body->'source'->'review'->>'id' IS NOT DISTINCT FROM review_id),
 CHECK(body->>'generatorVersion' IS NOT DISTINCT FROM generator_version),
 CHECK(body->>'createdBy' IS NOT DISTINCT FROM actor_id),
 CHECK(body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest')),
 CHECK(body->>'sourceDigest' IS NOT DISTINCT FROM openerp.digest(body->'source'))
);
CREATE TABLE openerp.invoice_document_artifacts (
 book_id text NOT NULL,capture_id text NOT NULL,descriptor jsonb NOT NULL,content bytea NOT NULL,
 PRIMARY KEY(book_id,capture_id),FOREIGN KEY(book_id,capture_id) REFERENCES openerp.invoice_document_captures,
 CHECK(octet_length(content) BETWEEN 1 AND 1048576),
 CHECK(descriptor->>'captureId' IS NOT DISTINCT FROM capture_id),
 CHECK(descriptor->'scope'->>'bookId' IS NOT DISTINCT FROM book_id),
 CHECK(descriptor->>'sha256' IS NOT DISTINCT FROM encode(sha256(content),'hex')),
 CHECK((descriptor->>'byteLength')::integer IS NOT DISTINCT FROM octet_length(content))
);
CREATE TRIGGER immutable_invoice_document_capture BEFORE UPDATE OR DELETE ON openerp.invoice_document_captures
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_document_artifact BEFORE UPDATE OR DELETE ON openerp.invoice_document_artifacts
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_document_captures,openerp.invoice_document_artifacts FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.capture_invoice_document(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_actor text; d_previous jsonb; d_issue jsonb; d_review jsonb; d_source jsonb; d_body jsonb;
BEGIN
 d_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 d_previous:=openerp.replay(p_scope->>'bookId',p_key,d_actor,'capture_invoice_document',p_input);
 IF d_previous IS NOT NULL THEN RETURN d_previous; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['issueId','issueDigest','generatorVersion']);
 IF p_input->>'generatorVersion' IS DISTINCT FROM 'openerp-synthetic-invoice-html-v1' THEN
  PERFORM openerp.fail('UnsupportedProfile','Select the fixed synthetic HTML review-document generator.'); END IF;
 SELECT i.body,r.body INTO d_issue,d_review FROM openerp.invoice_issues i
 JOIN openerp.invoice_issue_reviews r ON (r.book_id,r.id)=(i.book_id,i.review_id)
 WHERE i.book_id=p_scope->>'bookId' AND i.id=p_input->>'issueId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Choose an immutable issued synthetic invoice in this book.'); END IF;
 IF p_input->>'issueDigest' IS DISTINCT FROM d_issue->>'digest'
  OR d_issue->>'digest' IS DISTINCT FROM openerp.digest(d_issue-'digest')
  OR d_review->>'digest' IS DISTINCT FROM openerp.digest(d_review-'digest')
  OR d_issue->>'reviewDigest' IS DISTINCT FROM d_review->>'digest'
  OR d_issue->>'draftDigest' IS DISTINCT FROM d_review->'draftSnapshot'->>'digest'
  OR d_issue->>'draftId' IS DISTINCT FROM d_review->'draftSnapshot'->>'id'
  OR d_issue->>'draftRevision' IS DISTINCT FROM d_review->'draftSnapshot'->>'revision'
  OR d_issue->'scope' IS DISTINCT FROM p_scope OR d_review->'scope' IS DISTINCT FROM p_scope THEN
  PERFORM openerp.fail('StaleDependency','Select the exact immutable issued receipt and its reviewed source.'); END IF;
 IF d_issue->>'profile' IS DISTINCT FROM 'synthetic-manual-invoice-v1'
  OR d_review->>'profile' IS DISTINCT FROM 'synthetic-manual-invoice-v1'
  OR d_issue->'issued' IS DISTINCT FROM 'true'::jsonb OR d_issue->'recognized' IS DISTINCT FROM 'true'::jsonb
  OR d_issue->'legalInvoice' IS DISTINCT FROM 'false'::jsonb OR d_issue->'delivered' IS DISTINCT FROM 'false'::jsonb
  OR d_issue->'legalDocumentNumber' IS DISTINCT FROM 'null'::jsonb THEN
  PERFORM openerp.fail('UnsupportedProfile','Only the retained synthetic, nonlegal, undelivered issue profile supports this review artifact.'); END IF;
 IF NOT EXISTS(SELECT FROM openerp.execution_receipts e WHERE e.book_id=p_scope->>'bookId'
  AND e.id=d_issue->'postingReceipt'->>'id' AND e.body=d_issue->'postingReceipt'
  AND e.change_set_id=d_review->'postingPlan'->>'id')
  OR NOT EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId'
   AND i.id=d_issue->>'registerInvoiceId' AND i.recognition_voucher_id=d_issue->'postingReceipt'->>'voucherId'
   AND i.document_number=d_issue->>'internalDocumentNumber') THEN
  PERFORM openerp.fail('StaleDependency','The immutable issue posting and original register identity must agree.'); END IF;
 -- Historical source selection: no current draft, party, account, period or residual reads.
 IF NOT EXISTS(SELECT FROM openerp.evidence e WHERE e.book_id=p_scope->>'bookId' AND e.id=d_review->'evidence'->>'id'
  AND e.sha256=d_review->'evidence'->>'sha256') THEN
  PERFORM openerp.fail('MissingEvidence','The issued review evidence no longer matches its retained identity.'); END IF;
 SELECT c.body INTO d_body FROM openerp.invoice_document_captures c WHERE c.book_id=p_scope->>'bookId'
  AND c.issue_id=p_input->>'issueId' AND c.generator_version=p_input->>'generatorVersion';
 IF FOUND THEN
  IF d_body->'input' IS DISTINCT FROM p_input THEN PERFORM openerp.fail('IdempotencyConflict','This issue and generator already have a different capture.'); END IF;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,d_actor,'capture_invoice_document',p_input,d_body);
 END IF;
 d_source:=jsonb_build_object('review',d_review,'issue',d_issue);
 d_body:=jsonb_build_object('id',openerp.new_id('invoice_document'),'scope',p_scope,'input',p_input,
  'generatorVersion','openerp-synthetic-invoice-html-v1','format','synthetic-invoice-review-html','language','en',
  'source',d_source,'sourceDigest',openerp.digest(d_source),'createdBy',d_actor,
  'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'historicalOnly',true,'legalInvoice',false,'delivered',false);
 d_body:=d_body||jsonb_build_object('digest',openerp.digest(d_body));
 IF octet_length(d_body::text)>524288 THEN PERFORM openerp.fail('UnsupportedProfile','The complete document capture exceeds512 KiB. No truncated source was retained.'); END IF;
 INSERT INTO openerp.invoice_document_captures VALUES(p_scope->>'bookId',d_body->>'id',d_issue->>'id',d_review->>'id',p_input->>'generatorVersion',d_actor,d_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,d_actor,'capture_invoice_document',p_input,d_body);
END $$;

CREATE FUNCTION openerp.get_invoice_document(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_capture jsonb; d_artifact jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT c.body INTO d_capture FROM openerp.invoice_document_captures c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained invoice document capture was not found in this book.'); END IF;
 SELECT a.descriptor||jsonb_build_object('contentBase64',replace(encode(a.content,'base64'),E'\n','')) INTO d_artifact
 FROM openerp.invoice_document_artifacts a WHERE a.book_id=p_scope->>'bookId' AND a.capture_id=p_id;
 RETURN jsonb_build_object('capture',d_capture,'artifact',d_artifact);
END $$;

-- Internal backend seal only: clients supply no document bytes to public HTTP/MCP operations.
CREATE FUNCTION openerp.seal_invoice_document(p_token text,p_scope jsonb,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_actor text; d_capture openerp.invoice_document_captures; d_content bytea; d_text text;
 d_descriptor jsonb; d_existing bytea;
BEGIN
 d_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 SELECT c.* INTO d_capture FROM openerp.invoice_document_captures c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The document capture was not found in this book.'); END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['captureDigest','sourceDigest','generatorVersion','contentBase64','sha256','byteLength']);
 IF p_input->>'captureDigest' IS DISTINCT FROM d_capture.body->>'digest'
  OR p_input->>'sourceDigest' IS DISTINCT FROM d_capture.body->>'sourceDigest'
  OR p_input->>'generatorVersion' IS DISTINCT FROM d_capture.generator_version
  OR NOT EXISTS(SELECT FROM openerp.invoice_issues i JOIN openerp.invoice_issue_reviews r ON (r.book_id,r.id)=(i.book_id,i.review_id)
   WHERE i.book_id=d_capture.book_id AND i.id=d_capture.issue_id AND r.id=d_capture.review_id
    AND i.body=d_capture.body->'source'->'issue' AND r.body=d_capture.body->'source'->'review')
  OR NOT EXISTS(SELECT FROM openerp.evidence e WHERE e.book_id=d_capture.book_id
   AND e.id=d_capture.body->'source'->'review'->'evidence'->>'id'
   AND e.sha256=d_capture.body->'source'->'review'->'evidence'->>'sha256') THEN
  PERFORM openerp.fail('StaleDependency','Seal only the captured immutable issue/review/evidence and exact generator.'); END IF;
 IF jsonb_typeof(p_input->'contentBase64') IS DISTINCT FROM 'string'
  OR length(p_input->>'contentBase64') NOT BETWEEN 4 AND 1398104
  OR (p_input->>'contentBase64') !~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
  OR jsonb_typeof(p_input->'byteLength') IS DISTINCT FROM 'number'
  OR coalesce(p_input->>'byteLength','') !~ '^[1-9][0-9]{0,6}$'
  OR coalesce(p_input->>'sha256','') !~ '^[a-f0-9]{64}$' THEN
  PERFORM openerp.fail('InvalidJournal','Supply bounded canonical base64, byte length and SHA256.'); END IF;
 d_content:=decode(p_input->>'contentBase64','base64');
 IF octet_length(d_content) NOT BETWEEN 1 AND 1048576
  OR replace(encode(d_content,'base64'),E'\n','') IS DISTINCT FROM p_input->>'contentBase64'
  OR octet_length(d_content)<>(p_input->>'byteLength')::integer
  OR encode(sha256(d_content),'hex') IS DISTINCT FROM p_input->>'sha256' THEN
  PERFORM openerp.fail('InvalidJournal','Rendered document bytes do not match their declared bounds, hash or length.'); END IF;
 BEGIN d_text:=convert_from(d_content,'UTF8');
 EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN
  PERFORM openerp.fail('InvalidJournal','The document must contain valid UTF-8 bytes.'); END;
 IF left(d_text,15) IS DISTINCT FROM '<!doctype html>' OR right(d_text,8) IS DISTINCT FROM E'</html>\n'
  OR position('SYNTHETIC REVIEW DOCUMENT — NOT A LEGAL INVOICE — NOT DELIVERED' in d_text)=0 THEN
  PERFORM openerp.fail('InvalidJournal','The fixed review-document boundaries are missing.'); END IF;
 SELECT a.content INTO d_existing FROM openerp.invoice_document_artifacts a WHERE a.book_id=d_capture.book_id AND a.capture_id=p_id;
 IF FOUND THEN
  IF d_existing IS DISTINCT FROM d_content THEN PERFORM openerp.fail('IdempotencyConflict','This capture already has different immutable document bytes.'); END IF;
  RETURN openerp.get_invoice_document(p_token,p_scope,p_id);
 END IF;
 d_descriptor:=jsonb_build_object('captureId',p_id,'scope',d_capture.body->'scope','captureDigest',d_capture.body->>'digest',
  'sourceDigest',d_capture.body->>'sourceDigest','issueId',d_capture.issue_id,
  'issueDigest',d_capture.body->'input'->>'issueDigest','generatorVersion',d_capture.generator_version,
  'format','synthetic-invoice-review-html','language','en','encoding','UTF-8','mediaType','text/html',
  'filename',p_id||'.html','byteLength',octet_length(d_content),'sha256',encode(sha256(d_content),'hex'),
  'sealedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'historicalOnly',true,'legalInvoice',false,'delivered',false);
 INSERT INTO openerp.invoice_document_artifacts VALUES(d_capture.book_id,p_id,d_descriptor,d_content);
 RETURN openerp.get_invoice_document(p_token,p_scope,p_id);
END $$;

CREATE FUNCTION openerp.invoice_document_history(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_items jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 IF NOT EXISTS(SELECT FROM openerp.invoice_issues i WHERE i.book_id=p_scope->>'bookId' AND i.id=p_id) THEN
  PERFORM openerp.fail('NotFound','The issued synthetic invoice was not found in this book.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'captureDigest',c.body->>'digest','createdAt',c.body->>'createdAt',
  'sealed',a.capture_id IS NOT NULL,'sha256',a.descriptor->>'sha256') ORDER BY c.id),'[]') INTO d_items
 FROM openerp.invoice_document_captures c LEFT JOIN openerp.invoice_document_artifacts a ON (a.book_id,a.capture_id)=(c.book_id,c.id)
 WHERE c.book_id=p_scope->>'bookId' AND c.issue_id=p_id;
 RETURN jsonb_build_object('scope',p_scope,'issueId',p_id,'complete',true,'items',d_items);
END $$;
REVOKE ALL ON FUNCTION openerp.capture_invoice_document(text,jsonb,text,jsonb),openerp.get_invoice_document(text,jsonb,text),
 openerp.seal_invoice_document(text,jsonb,text,jsonb),openerp.invoice_document_history(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.capture_invoice_document(text,jsonb,text,jsonb),openerp.get_invoice_document(text,jsonb,text),
 openerp.seal_invoice_document(text,jsonb,text,jsonb),openerp.invoice_document_history(text,jsonb,text) TO openerp_runtime;
