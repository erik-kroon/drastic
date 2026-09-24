-- Reviewed legal PDF outbox. No function invokes a provider or claims customer receipt.
CREATE TABLE openerp.ar_legal_delivery_requests (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, capture_id text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('email','peppol')),
 created_by text NOT NULL REFERENCES openerp.actors,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=16384), PRIMARY KEY(book_id,id),
 FOREIGN KEY(book_id,capture_id) REFERENCES openerp.ar_legal_pdf_artifacts,
 CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id
  AND body->'input'->>'pdfCaptureId'=capture_id AND body->'input'->>'channel'=channel
  AND body->>'createdBy'=created_by AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE UNIQUE INDEX ar_legal_delivery_destination ON openerp.ar_legal_delivery_requests
 (book_id,capture_id,channel,((body->'input'->>'destination')));
CREATE TABLE openerp.ar_legal_delivery_approvals (
 book_id text NOT NULL,id text NOT NULL,request_id text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors,body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
 PRIMARY KEY(book_id,id),UNIQUE(book_id,request_id),
 FOREIGN KEY(book_id,request_id) REFERENCES openerp.ar_legal_delivery_requests,
 CHECK(body->>'id'=id AND body->>'requestId'=request_id AND body->>'actorId'=actor_id
  AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.ar_legal_delivery_attempts (
 book_id text NOT NULL,id text NOT NULL,request_id text NOT NULL,approval_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
 body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
 PRIMARY KEY(book_id,id),UNIQUE(book_id,request_id,ordinal),
 FOREIGN KEY(book_id,request_id) REFERENCES openerp.ar_legal_delivery_requests,
 FOREIGN KEY(book_id,approval_id) REFERENCES openerp.ar_legal_delivery_approvals,
 CHECK(body->>'id'=id AND body->>'requestId'=request_id AND body->>'approvalId'=approval_id
  AND (body->>'ordinal')::integer=ordinal AND body->>'status'='provider_unknown'
  AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.ar_legal_delivery_reconciliations (
 book_id text NOT NULL,id text NOT NULL,attempt_id text NOT NULL,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
 PRIMARY KEY(book_id,id),UNIQUE(book_id,attempt_id),
 FOREIGN KEY(book_id,attempt_id) REFERENCES openerp.ar_legal_delivery_attempts,
 CHECK(body->>'id'=id AND body->>'attemptId'=attempt_id
  AND body->>'outcome' IN ('provider_accepted','provider_rejected','confirmed_not_sent')
  AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_ar_legal_delivery_request BEFORE UPDATE OR DELETE ON openerp.ar_legal_delivery_requests
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_delivery_approval BEFORE UPDATE OR DELETE ON openerp.ar_legal_delivery_approvals
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_delivery_attempt BEFORE UPDATE OR DELETE ON openerp.ar_legal_delivery_attempts
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_delivery_reconciliation BEFORE UPDATE OR DELETE ON openerp.ar_legal_delivery_reconciliations
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.ar_legal_delivery_requests,openerp.ar_legal_delivery_approvals,
 openerp.ar_legal_delivery_attempts,openerp.ar_legal_delivery_reconciliations FROM PUBLIC,openerp_runtime;
CREATE FUNCTION openerp.ar_legal_delivery_view(p_book text,p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_request openerp.ar_legal_delivery_requests;v_approval jsonb;v_attempts jsonb;v_last jsonb;
BEGIN
 SELECT * INTO v_request FROM openerp.ar_legal_delivery_requests WHERE book_id=p_book AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal delivery request was not found in this book.'); END IF;
 SELECT body INTO v_approval FROM openerp.ar_legal_delivery_approvals WHERE book_id=p_book AND request_id=p_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('attempt',a.body,'reconciliation',r.body) ORDER BY a.ordinal),'[]')
 INTO v_attempts FROM openerp.ar_legal_delivery_attempts a LEFT JOIN openerp.ar_legal_delivery_reconciliations r
 ON (r.book_id,r.attempt_id)=(a.book_id,a.id) WHERE a.book_id=p_book AND a.request_id=p_id;
 v_last:=v_attempts->(jsonb_array_length(v_attempts)-1);
 RETURN jsonb_build_object('request',v_request.body,'approval',v_approval,'attempts',v_attempts,
  'status',CASE WHEN v_last->'reconciliation' IS NOT NULL AND v_last->'reconciliation'<>'null'::jsonb
   THEN v_last->'reconciliation'->>'outcome'
   WHEN v_last IS NOT NULL THEN 'provider_unknown'
   WHEN v_approval IS NULL THEN 'awaiting_send_approval'
   WHEN v_request.channel='peppol' THEN 'peppol_payload_blocked'
   ELSE 'approved_handoff_ready' END,
  'delivered',false,'complete',true);
END $$;
CREATE FUNCTION openerp.prepare_ar_legal_delivery(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text;v_prior jsonb;v_capture openerp.ar_legal_pdf_captures;
 v_pdf openerp.ar_legal_pdf_artifacts;v_issue jsonb;v_body jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'prepare_ar_legal_delivery',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['pdfCaptureId','captureDigest','artifactSha256',
  'channel','destination','providerProfileKey','reason']);
 IF p_input->>'channel' NOT IN ('email','peppol')
  OR coalesce(p_input->>'providerProfileKey','') !~ '^[a-z][a-z0-9_-]{2,127}$'
  OR char_length(coalesce(p_input->>'destination','')) NOT BETWEEN 3 AND 200
  OR coalesce(p_input->>'reason','')='' THEN
  PERFORM openerp.fail('InvalidJournal','Choose a bounded channel, destination, provider profile key and reason.'); END IF;
 IF (p_input->>'channel'='email' AND p_input->>'destination' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  OR (p_input->>'channel'='peppol' AND p_input->>'destination' !~ '^[0-9]{4}:[A-Za-z0-9._-]{1,160}$') THEN
  PERFORM openerp.fail('InvalidJournal','Use an explicit email address or Peppol participant identifier.'); END IF;
 PERFORM openerp.commerce_text(p_input,'reason',2000);
 SELECT * INTO v_capture FROM openerp.ar_legal_pdf_captures WHERE book_id=p_scope->>'bookId' AND id=p_input->>'pdfCaptureId';
 SELECT * INTO v_pdf FROM openerp.ar_legal_pdf_artifacts WHERE book_id=p_scope->>'bookId' AND capture_id=p_input->>'pdfCaptureId';
 IF v_capture.id IS NULL OR v_pdf.capture_id IS NULL THEN
  PERFORM openerp.fail('NotFound','Select a sealed legal invoice PDF in this book.'); END IF;
 v_issue:=v_capture.body->'source'->'issue';
 IF p_input->>'captureDigest' IS DISTINCT FROM v_capture.body->>'digest'
 OR p_input->>'artifactSha256' IS DISTINCT FROM encode(sha256(v_pdf.content),'hex')
 OR v_pdf.descriptor->>'sha256' IS DISTINCT FROM p_input->>'artifactSha256'
 OR v_pdf.descriptor->>'captureDigest' IS DISTINCT FROM v_capture.body->>'digest'
 OR v_issue->'legalInvoice' IS DISTINCT FROM 'true'::jsonb
 OR v_issue->'delivered' IS DISTINCT FROM 'false'::jsonb
 OR NOT EXISTS(SELECT FROM openerp.ar_legal_issues i WHERE i.book_id=p_scope->>'bookId'
  AND i.id=v_capture.issue_id AND i.body=v_issue) THEN
  PERFORM openerp.fail('StaleDependency','Bind the exact immutable legal issue and saved PDF bytes.'); END IF;
 IF EXISTS(SELECT FROM openerp.ar_legal_delivery_requests WHERE book_id=p_scope->>'bookId'
  AND capture_id=v_capture.id AND channel=p_input->>'channel'
  AND body->'input'->>'destination'=p_input->>'destination') THEN
  PERFORM openerp.fail('IdempotencyConflict','This PDF and destination already have a delivery request. Recover it.'); END IF;
 IF (SELECT count(*) FROM openerp.ar_legal_delivery_requests WHERE book_id=p_scope->>'bookId')>=50 THEN
  PERFORM openerp.fail('UnsupportedProfile','The bounded legal delivery history is full.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('ar_delivery'),'scope',p_scope,'input',p_input,
  'issueId',v_capture.issue_id,'artifactByteLength',octet_length(v_pdf.content),
  'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'sendAuthorized',false,'delivered',false);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.ar_legal_delivery_requests VALUES(p_scope->>'bookId',v_body->>'id',v_capture.id,p_input->>'channel',v_actor,v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'prepare_ar_legal_delivery',p_input,
  openerp.ar_legal_delivery_view(p_scope->>'bookId',v_body->>'id'));
END $$;
CREATE FUNCTION openerp.approve_ar_legal_delivery(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text;v_prior jsonb;v_request openerp.ar_legal_delivery_requests;v_body jsonb;
 v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'approve_ar_legal_delivery',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['requestDigest','reason','approveSendHandoff']);
 SELECT * INTO v_request FROM openerp.ar_legal_delivery_requests WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal delivery request was not found.'); END IF;
 IF p_input->>'requestDigest' IS DISTINCT FROM v_request.body->>'digest'
 OR p_input->'approveSendHandoff' IS DISTINCT FROM 'true'::jsonb
 OR v_actor=v_request.created_by THEN
  PERFORM openerp.fail('ApprovalRequired','A different current operator must approve the exact PDF, recipient and provider handoff.'); END IF;
 PERFORM openerp.commerce_text(p_input,'reason',2000);
 IF EXISTS(SELECT FROM openerp.ar_legal_delivery_approvals WHERE book_id=p_scope->>'bookId' AND request_id=p_id) THEN
  PERFORM openerp.fail('IdempotencyConflict','This exact request already has immutable send approval.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('ar_send_approval'),'scope',p_scope,'requestId',p_id,
  'requestDigest',v_request.body->>'digest','actorId',v_actor,'reason',p_input->>'reason',
  'approvedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'sendAuthorized',true,'providerPayloadReady',v_request.channel='email','delivered',false);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.ar_legal_delivery_approvals VALUES(p_scope->>'bookId',v_body->>'id',p_id,v_actor,v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'approve_ar_legal_delivery',v_payload,
  openerp.ar_legal_delivery_view(p_scope->>'bookId',p_id));
END $$;

CREATE FUNCTION openerp.start_ar_legal_delivery_attempt(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text;v_prior jsonb;v_request openerp.ar_legal_delivery_requests;
 v_approval openerp.ar_legal_delivery_approvals;v_capture openerp.ar_legal_pdf_captures;
 v_pdf openerp.ar_legal_pdf_artifacts;v_body jsonb;v_ordinal integer;
 v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'start_ar_legal_delivery_attempt',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['requestDigest','approvalId','providerProfileKey','acknowledgeUncertainBoundary']);
 SELECT * INTO v_request FROM openerp.ar_legal_delivery_requests WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal delivery request was not found.'); END IF;
 IF v_request.channel='peppol' THEN
  PERFORM openerp.fail('UnsupportedProfile','A PDF is not Peppol BIS Billing XML. No Peppol attempt can start until a validated structured payload and provider contract exist.'); END IF;
 SELECT * INTO v_approval FROM openerp.ar_legal_delivery_approvals WHERE book_id=p_scope->>'bookId' AND request_id=p_id;
 IF v_approval.id IS NULL OR v_approval.id IS DISTINCT FROM p_input->>'approvalId'
 OR v_approval.actor_id IS DISTINCT FROM v_actor
 OR v_request.body->>'digest' IS DISTINCT FROM p_input->>'requestDigest'
 OR v_approval.body->>'requestDigest' IS DISTINCT FROM v_request.body->>'digest'
 OR v_request.body->'input'->>'providerProfileKey' IS DISTINCT FROM p_input->>'providerProfileKey'
 OR p_input->'acknowledgeUncertainBoundary' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('ApprovalRequired','The exact reviewer must reserve an unknown email provider attempt against the approved PDF and provider profile.'); END IF;
 SELECT * INTO v_capture FROM openerp.ar_legal_pdf_captures WHERE book_id=v_request.book_id AND id=v_request.capture_id;
 SELECT * INTO v_pdf FROM openerp.ar_legal_pdf_artifacts WHERE book_id=v_request.book_id AND capture_id=v_request.capture_id;
 IF v_capture.id IS NULL OR v_pdf.capture_id IS NULL
 OR v_request.body->'input'->>'artifactSha256' IS DISTINCT FROM encode(sha256(v_pdf.content),'hex')
 OR v_request.body->>'artifactByteLength' IS DISTINCT FROM octet_length(v_pdf.content)::text
 OR v_request.body->'input'->>'captureDigest' IS DISTINCT FROM v_capture.body->>'digest' THEN
  PERFORM openerp.fail('StaleDependency','The PDF byte identity no longer agrees with approved sending authority.'); END IF;
 IF EXISTS(SELECT FROM openerp.ar_legal_delivery_attempts a WHERE a.book_id=v_request.book_id AND a.request_id=p_id
  AND NOT EXISTS(SELECT FROM openerp.ar_legal_delivery_reconciliations r WHERE r.book_id=a.book_id AND r.attempt_id=a.id)) THEN
  PERFORM openerp.fail('StaleDependency','An unknown provider attempt blocks a new send. Reconcile the original request ID first.'); END IF;
 IF EXISTS(SELECT FROM openerp.ar_legal_delivery_reconciliations r
  JOIN openerp.ar_legal_delivery_attempts a ON (a.book_id,a.id)=(r.book_id,r.attempt_id)
  WHERE a.book_id=v_request.book_id AND a.request_id=p_id AND r.body->>'outcome'<>'confirmed_not_sent') THEN
  PERFORM openerp.fail('StaleDependency','Accepted or rejected provider outcomes cannot be retried as a new send for the same intent.'); END IF;
 SELECT coalesce(max(ordinal),0)+1 INTO v_ordinal FROM openerp.ar_legal_delivery_attempts WHERE book_id=v_request.book_id AND request_id=p_id;
 IF v_ordinal>20 THEN PERFORM openerp.fail('UnsupportedProfile','Delivery attempt history reached its complete bound.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('ar_attempt'),'scope',p_scope,'requestId',p_id,
  'approvalId',v_approval.id,'ordinal',v_ordinal,
  'providerRequestId',openerp.new_id('ar_provider_request'),
  'providerProfileKey',p_input->>'providerProfileKey',
  'pdfCaptureId',v_capture.id,'artifactSha256',v_pdf.descriptor->>'sha256',
  'channel','email','destination',v_request.body->'input'->>'destination',
  'startedBy',v_actor,'startedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'status','provider_unknown','externalTrafficProven',false,'delivered',false);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.ar_legal_delivery_attempts VALUES(v_request.book_id,v_body->>'id',p_id,v_approval.id,v_ordinal,v_body);
 RETURN openerp.save_command(v_request.book_id,p_key,v_actor,'start_ar_legal_delivery_attempt',v_payload,
  openerp.ar_legal_delivery_view(v_request.book_id,p_id));
END $$;
CREATE FUNCTION openerp.reconcile_ar_legal_delivery_attempt(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text;v_prior jsonb;v_attempt openerp.ar_legal_delivery_attempts;
 v_body jsonb;v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'reconcile_ar_legal_delivery_attempt',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['attemptDigest','providerRequestId','outcome',
  'providerMessageId','providerEvidence','reason']);
 SELECT * INTO v_attempt FROM openerp.ar_legal_delivery_attempts WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Provider attempt was not found in this book.'); END IF;
 IF v_attempt.body->>'digest' IS DISTINCT FROM p_input->>'attemptDigest'
  OR v_attempt.body->>'providerRequestId' IS DISTINCT FROM p_input->>'providerRequestId'
  OR v_actor=v_attempt.body->>'startedBy' THEN
  PERFORM openerp.fail('ApprovalRequired','A different current operator must reconcile the exact provider request with retained evidence.'); END IF;
 IF p_input->>'outcome' NOT IN ('provider_accepted','provider_rejected','confirmed_not_sent')
  OR (p_input->>'outcome'='provider_accepted' AND coalesce(p_input->>'providerMessageId','')='')
  OR (p_input->>'outcome'<>'provider_accepted' AND p_input->'providerMessageId'<>'null'::jsonb)
  OR coalesce(p_input->>'reason','')='' THEN
  PERFORM openerp.fail('InvalidJournal','Record a distinct accepted, rejected or independently confirmed not-sent outcome.'); END IF;
 PERFORM openerp.commerce_text(p_input,'reason',2000);
 IF jsonb_typeof(p_input->'providerMessageId')='string' THEN
  PERFORM openerp.commerce_text(p_input,'providerMessageId',200);
 END IF;
 PERFORM openerp.invoice_policy_require_evidence(p_scope->>'bookId',p_input->'providerEvidence');
 IF EXISTS(SELECT FROM openerp.ar_legal_delivery_reconciliations WHERE book_id=p_scope->>'bookId' AND attempt_id=p_id) THEN
  PERFORM openerp.fail('IdempotencyConflict','This attempt already has an immutable provider reconciliation.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('ar_reconciliation'),'scope',p_scope,
  'attemptId',p_id,'attemptDigest',v_attempt.body->>'digest',
  'providerRequestId',v_attempt.body->>'providerRequestId',
  'providerMessageId',p_input->'providerMessageId','providerEvidence',p_input->'providerEvidence',
  'outcome',p_input->>'outcome','reason',p_input->>'reason','actorId',v_actor,
  'reconciledAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'delivered',false);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.ar_legal_delivery_reconciliations VALUES(v_attempt.book_id,v_body->>'id',p_id,v_body);
 RETURN openerp.save_command(v_attempt.book_id,p_key,v_actor,'reconcile_ar_legal_delivery_attempt',v_payload,
  openerp.ar_legal_delivery_view(v_attempt.book_id,v_attempt.request_id));
END $$;
CREATE FUNCTION openerp.get_ar_legal_delivery(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 RETURN openerp.ar_legal_delivery_view(p_scope->>'bookId',p_id);
END $$;
CREATE FUNCTION openerp.ar_legal_delivery_history(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 IF NOT EXISTS(SELECT FROM openerp.ar_legal_pdf_captures WHERE book_id=p_scope->>'bookId' AND id=p_id) THEN
  PERFORM openerp.fail('NotFound','Legal PDF capture was not found in this book.'); END IF;
 SELECT coalesce(jsonb_agg(openerp.ar_legal_delivery_view(book_id,id) ORDER BY id),'[]') INTO v_items
 FROM openerp.ar_legal_delivery_requests WHERE book_id=p_scope->>'bookId' AND capture_id=p_id;
 RETURN jsonb_build_object('scope',p_scope,'pdfCaptureId',p_id,'complete',true,'items',v_items);
END $$;
REVOKE ALL ON FUNCTION openerp.ar_legal_delivery_view(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_ar_legal_delivery(text,jsonb,text,jsonb),openerp.approve_ar_legal_delivery(text,jsonb,text,text,jsonb),
 openerp.start_ar_legal_delivery_attempt(text,jsonb,text,text,jsonb),openerp.reconcile_ar_legal_delivery_attempt(text,jsonb,text,text,jsonb),
 openerp.get_ar_legal_delivery(text,jsonb,text),openerp.ar_legal_delivery_history(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_ar_legal_delivery(text,jsonb,text,jsonb),openerp.approve_ar_legal_delivery(text,jsonb,text,text,jsonb),
 openerp.start_ar_legal_delivery_attempt(text,jsonb,text,text,jsonb),openerp.reconcile_ar_legal_delivery_attempt(text,jsonb,text,text,jsonb),
 openerp.get_ar_legal_delivery(text,jsonb,text),openerp.ar_legal_delivery_history(text,jsonb,text) TO openerp_runtime;
