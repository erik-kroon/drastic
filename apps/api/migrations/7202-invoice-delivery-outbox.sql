-- A review-only outbox over saved PDF bytes. No function sends traffic or marks an invoice delivered.
CREATE TABLE openerp.invoice_delivery_requests (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, capture_id text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors, channel text NOT NULL CHECK(channel IN ('email','peppol','local_simulation')),
 body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
 PRIMARY KEY(book_id,id),
 FOREIGN KEY(book_id,capture_id) REFERENCES openerp.invoice_pdf_artifacts(book_id,capture_id),
 CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'createdBy'=actor_id
  AND body->'input'->>'pdfCaptureId'=capture_id AND body->'input'->>'channel'=channel
  AND body->'sendAuthorized'='false'::jsonb AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE UNIQUE INDEX invoice_delivery_unique_destination ON openerp.invoice_delivery_requests (book_id,capture_id,channel,((body->'input'->>'destination')));
CREATE TABLE openerp.invoice_delivery_approvals (
 book_id text NOT NULL, id text NOT NULL, request_id text NOT NULL, actor_id text NOT NULL REFERENCES openerp.actors,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=16384), PRIMARY KEY(book_id,id), UNIQUE(book_id,request_id),
 FOREIGN KEY(book_id,request_id) REFERENCES openerp.invoice_delivery_requests,
 CHECK(body->>'id'=id AND body->>'requestId'=request_id AND body->>'createdBy'=actor_id
  AND body->'sendAuthorized'='false'::jsonb AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.invoice_delivery_attempts (
 book_id text NOT NULL, id text NOT NULL, request_id text NOT NULL, approval_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20), body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,request_id,ordinal),
 FOREIGN KEY(book_id,request_id) REFERENCES openerp.invoice_delivery_requests,
 FOREIGN KEY(book_id,approval_id) REFERENCES openerp.invoice_delivery_approvals,
 CHECK(body->>'id'=id AND body->>'requestId'=request_id AND body->>'approvalId'=approval_id
  AND (body->>'ordinal')::integer=ordinal AND body->>'status'='simulated_unknown'
  AND body->'externalTraffic'='false'::jsonb AND body->'providerRequestId'='null'::jsonb
  AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.invoice_delivery_resolutions (
 book_id text NOT NULL, id text NOT NULL, attempt_id text NOT NULL, body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,attempt_id),
 FOREIGN KEY(book_id,attempt_id) REFERENCES openerp.invoice_delivery_attempts,
 CHECK(body->>'id'=id AND body->>'attemptId'=attempt_id AND body->>'outcome'='simulated_not_sent'
  AND body->'externalTraffic'='false'::jsonb AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_invoice_delivery_request BEFORE UPDATE OR DELETE ON openerp.invoice_delivery_requests
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_delivery_approval BEFORE UPDATE OR DELETE ON openerp.invoice_delivery_approvals
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_delivery_attempt BEFORE UPDATE OR DELETE ON openerp.invoice_delivery_attempts
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_delivery_resolution BEFORE UPDATE OR DELETE ON openerp.invoice_delivery_resolutions
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_delivery_requests,openerp.invoice_delivery_approvals,
 openerp.invoice_delivery_attempts,openerp.invoice_delivery_resolutions FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.invoice_delivery_view(p_book text,p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_request openerp.invoice_delivery_requests; v_approval jsonb; v_attempts jsonb; v_last jsonb;
BEGIN
 SELECT * INTO v_request FROM openerp.invoice_delivery_requests WHERE book_id=p_book AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Delivery intent was not found in this book.'); END IF;
 SELECT body INTO v_approval FROM openerp.invoice_delivery_approvals WHERE book_id=p_book AND request_id=p_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('attempt',a.body,'resolution',r.body) ORDER BY a.ordinal),'[]') INTO v_attempts
 FROM openerp.invoice_delivery_attempts a LEFT JOIN openerp.invoice_delivery_resolutions r
 ON (r.book_id,r.attempt_id)=(a.book_id,a.id) WHERE a.book_id=p_book AND a.request_id=p_id;
 v_last:=v_attempts->(jsonb_array_length(v_attempts)-1);
 RETURN jsonb_build_object('request',v_request.body,'approval',v_approval,'attempts',v_attempts,
  'status',CASE WHEN v_last->'resolution' IS NOT NULL AND v_last->'resolution'<>'null'::jsonb THEN 'simulated_not_sent'
   WHEN v_last IS NOT NULL THEN 'simulated_unknown'
   WHEN v_approval IS NULL THEN 'review_only'
   WHEN v_request.channel<>'local_simulation' THEN 'provider_blocked'
   ELSE 'simulation_ready' END,
  'sendAuthorized',false,'complete',true);
END $$;
CREATE FUNCTION openerp.prepare_invoice_delivery(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_capture openerp.invoice_pdf_captures; v_artifact openerp.invoice_pdf_artifacts;
 v_body jsonb; v_existing text;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'prepare_invoice_delivery',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['pdfCaptureId','captureDigest','artifactSha256','channel',
  'destination','reason','acknowledgeNoTransmission']);
 IF coalesce(p_input->>'channel','') NOT IN ('email','peppol','local_simulation')
  OR p_input->'acknowledgeNoTransmission' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(p_input->'destination') IS DISTINCT FROM 'string'
  OR char_length(p_input->>'destination') NOT BETWEEN 1 AND 200 OR btrim(p_input->>'destination')=''
  OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
  OR char_length(p_input->>'reason') NOT BETWEEN 1 AND 2000 OR btrim(p_input->>'reason')='' THEN
  PERFORM openerp.fail('InvalidJournal','Choose an explicit review-only channel, destination and reason.'); END IF;
 SELECT * INTO v_capture FROM openerp.invoice_pdf_captures WHERE book_id=p_scope->>'bookId' AND id=p_input->>'pdfCaptureId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','PDF capture was not found in this book.'); END IF;
 SELECT * INTO v_artifact FROM openerp.invoice_pdf_artifacts WHERE book_id=v_capture.book_id AND capture_id=v_capture.id;
 IF NOT FOUND THEN PERFORM openerp.fail('StaleDependency','Render and save the exact PDF bytes before planning delivery.'); END IF;
 IF p_input->>'captureDigest' IS DISTINCT FROM v_capture.body->>'digest'
  OR p_input->>'artifactSha256' IS DISTINCT FROM v_artifact.descriptor->>'sha256'
  OR v_artifact.descriptor->>'sha256' IS DISTINCT FROM encode(sha256(v_artifact.content),'hex')
  OR v_artifact.descriptor->>'captureDigest' IS DISTINCT FROM v_capture.body->>'digest'
  OR v_capture.body->'legalInvoice' IS DISTINCT FROM 'false'::jsonb THEN
  PERFORM openerp.fail('StaleDependency','The sealed PDF byte identity and synthetic source must agree.'); END IF;
 SELECT id INTO v_existing FROM openerp.invoice_delivery_requests WHERE book_id=v_capture.book_id
  AND capture_id=v_capture.id AND channel=p_input->>'channel'
  AND body->'input'->>'destination'=p_input->>'destination';
 IF FOUND THEN PERFORM openerp.fail('IdempotencyConflict','That PDF, channel and destination already have a retained intent. Recover it by ID.'); END IF;
 IF (SELECT count(*) FROM openerp.invoice_delivery_requests WHERE book_id=v_capture.book_id)>=50 THEN
  PERFORM openerp.fail('UnsupportedProfile','The bounded delivery intent history is full.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('invoice_delivery'),'scope',p_scope,'input',p_input,
  'artifactByteLength',octet_length(v_artifact.content),'pdfIssueId',v_capture.issue_id,
  'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'status','review_only','legalInvoice',false,'sendAuthorized',false);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.invoice_delivery_requests VALUES(v_capture.book_id,v_body->>'id',v_capture.id,v_actor,p_input->>'channel',v_body);
 RETURN openerp.save_command(v_capture.book_id,p_key,v_actor,'prepare_invoice_delivery',p_input,openerp.invoice_delivery_view(v_capture.book_id,v_body->>'id'));
END $$;
CREATE FUNCTION openerp.approve_invoice_delivery(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_request openerp.invoice_delivery_requests; v_body jsonb; v_payload jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_payload:=jsonb_build_object('id',p_id,'input',p_input);
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'approve_invoice_delivery',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 SELECT * INTO v_request FROM openerp.invoice_delivery_requests WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Delivery intent was not found in this book.'); END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['requestDigest','reason','acknowledgeNoTransmission']);
 IF p_input->>'requestDigest' IS DISTINCT FROM v_request.body->>'digest'
  OR p_input->'acknowledgeNoTransmission' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('StaleDependency','Review the exact intent; approval does not grant sending authority.'); END IF;
 IF v_actor=v_request.actor_id THEN PERFORM openerp.fail('ApprovalRequired','A separate current operator must review the delivery intent.'); END IF;
 IF jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
  OR char_length(p_input->>'reason') NOT BETWEEN 1 AND 2000 OR btrim(p_input->>'reason')='' THEN
  PERFORM openerp.fail('InvalidJournal','Record an explicit review reason.'); END IF;
 IF EXISTS(SELECT FROM openerp.invoice_delivery_approvals WHERE book_id=v_request.book_id AND request_id=p_id) THEN
  PERFORM openerp.fail('IdempotencyConflict','This intent already has a separate immutable review.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('invoice_delivery_approval'),'scope',p_scope,'requestId',p_id,
  'input',p_input,'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'sendAuthorized',false,'simulationAuthorized',v_request.channel='local_simulation');
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.invoice_delivery_approvals VALUES(v_request.book_id,v_body->>'id',p_id,v_actor,v_body);
 RETURN openerp.save_command(v_request.book_id,p_key,v_actor,'approve_invoice_delivery',v_payload,openerp.invoice_delivery_view(v_request.book_id,p_id));
END $$;
CREATE FUNCTION openerp.start_invoice_delivery_simulation(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_request openerp.invoice_delivery_requests; v_approval openerp.invoice_delivery_approvals;
 v_artifact openerp.invoice_pdf_artifacts; v_body jsonb; v_ordinal integer; v_payload jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_payload:=jsonb_build_object('id',p_id,'input',p_input);
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'start_invoice_delivery_simulation',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 SELECT * INTO v_request FROM openerp.invoice_delivery_requests WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Delivery intent was not found in this book.'); END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['requestDigest','approvalId','acknowledgeNoExternalCall']);
 IF v_request.channel<>'local_simulation' OR p_input->'acknowledgeNoExternalCall' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('UnsupportedProfile','Email and Peppol require an active legal profile and provider authority. No provider attempt can start here.'); END IF;
 SELECT * INTO v_approval FROM openerp.invoice_delivery_approvals WHERE book_id=v_request.book_id AND request_id=p_id;
 IF NOT FOUND OR v_approval.id IS DISTINCT FROM p_input->>'approvalId'
  OR v_actor IS DISTINCT FROM v_approval.actor_id OR p_input->>'requestDigest' IS DISTINCT FROM v_request.body->>'digest' THEN
  PERFORM openerp.fail('ApprovalRequired','The separate current reviewer must start the exact approved local simulation.'); END IF;
 SELECT * INTO v_artifact FROM openerp.invoice_pdf_artifacts WHERE book_id=v_request.book_id AND capture_id=v_request.capture_id;
 IF NOT FOUND OR v_request.body->'input'->>'artifactSha256' IS DISTINCT FROM encode(sha256(v_artifact.content),'hex')
  OR v_request.body->>'artifactByteLength' IS DISTINCT FROM octet_length(v_artifact.content)::text THEN
  PERFORM openerp.fail('StaleDependency','Saved PDF bytes no longer agree with the reviewed intent.'); END IF;
 IF EXISTS(SELECT FROM openerp.invoice_delivery_attempts a WHERE a.book_id=v_request.book_id AND a.request_id=p_id
  AND NOT EXISTS(SELECT FROM openerp.invoice_delivery_resolutions r WHERE r.book_id=a.book_id AND r.attempt_id=a.id)) THEN
  PERFORM openerp.fail('StaleDependency','An unresolved simulated outcome blocks another attempt. Recover and resolve it first.'); END IF;
 SELECT coalesce(max(ordinal),0)+1 INTO v_ordinal FROM openerp.invoice_delivery_attempts WHERE book_id=v_request.book_id AND request_id=p_id;
 IF v_ordinal>20 THEN PERFORM openerp.fail('UnsupportedProfile','The bounded simulation attempt history is full.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('invoice_delivery_attempt'),'scope',p_scope,'requestId',p_id,
  'ordinal',v_ordinal,'approvalId',v_approval.id,'artifactSha256',v_request.body->'input'->>'artifactSha256',
  'startedBy',v_actor,'startedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'status','simulated_unknown','externalTraffic',false,'providerRequestId',NULL);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.invoice_delivery_attempts VALUES(v_request.book_id,v_body->>'id',p_id,v_approval.id,v_ordinal,v_body);
 RETURN openerp.save_command(v_request.book_id,p_key,v_actor,'start_invoice_delivery_simulation',v_payload,openerp.invoice_delivery_view(v_request.book_id,p_id));
END $$;
CREATE FUNCTION openerp.resolve_invoice_delivery_simulation(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_attempt openerp.invoice_delivery_attempts;
 v_body jsonb; v_payload jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_payload:=jsonb_build_object('id',p_id,'input',p_input);
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'resolve_invoice_delivery_simulation',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 SELECT * INTO v_attempt FROM openerp.invoice_delivery_attempts WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Simulated attempt was not found in this book.'); END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['attemptDigest','reason','assertNoExternalCall']);
 IF p_input->>'attemptDigest' IS DISTINCT FROM v_attempt.body->>'digest'
  OR p_input->'assertNoExternalCall' IS DISTINCT FROM 'true'::jsonb
  OR v_actor IS DISTINCT FROM v_attempt.body->>'startedBy' THEN
  PERFORM openerp.fail('ApprovalRequired','Only the current simulation operator can resolve the exact local attempt.'); END IF;
 IF jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
  OR char_length(p_input->>'reason') NOT BETWEEN 1 AND 2000 OR btrim(p_input->>'reason')='' THEN
  PERFORM openerp.fail('InvalidJournal','Explain the explicit no-external-call resolution.'); END IF;
 IF EXISTS(SELECT FROM openerp.invoice_delivery_resolutions WHERE book_id=v_attempt.book_id AND attempt_id=p_id) THEN
  PERFORM openerp.fail('IdempotencyConflict','This attempt already has an immutable resolution.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('invoice_delivery_resolution'),'scope',p_scope,
  'attemptId',p_id,'actorId',v_actor,'reason',p_input->>'reason','outcome','simulated_not_sent',
  'externalTraffic',false,'resolvedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.invoice_delivery_resolutions VALUES(v_attempt.book_id,v_body->>'id',p_id,v_body);
 RETURN openerp.save_command(v_attempt.book_id,p_key,v_actor,'resolve_invoice_delivery_simulation',v_payload,openerp.invoice_delivery_view(v_attempt.book_id,v_attempt.request_id));
END $$;
CREATE FUNCTION openerp.get_invoice_delivery(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
 RETURN openerp.invoice_delivery_view(p_scope->>'bookId',p_id);
END $$;
CREATE FUNCTION openerp.invoice_delivery_history(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
 IF NOT EXISTS(SELECT FROM openerp.invoice_pdf_captures WHERE book_id=p_scope->>'bookId' AND id=p_id) THEN
  PERFORM openerp.fail('NotFound','PDF capture was not found in this book.'); END IF;
 SELECT coalesce(jsonb_agg(openerp.invoice_delivery_view(r.book_id,r.id) ORDER BY r.id),'[]') INTO v_items
 FROM openerp.invoice_delivery_requests r WHERE r.book_id=p_scope->>'bookId' AND r.capture_id=p_id;
 RETURN jsonb_build_object('scope',p_scope,'pdfCaptureId',p_id,'complete',true,'items',v_items);
END $$;
REVOKE ALL ON FUNCTION openerp.invoice_delivery_view(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_invoice_delivery(text,jsonb,text,jsonb),
 openerp.approve_invoice_delivery(text,jsonb,text,text,jsonb),openerp.start_invoice_delivery_simulation(text,jsonb,text,text,jsonb),
 openerp.resolve_invoice_delivery_simulation(text,jsonb,text,text,jsonb),openerp.get_invoice_delivery(text,jsonb,text),
 openerp.invoice_delivery_history(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_invoice_delivery(text,jsonb,text,jsonb),
 openerp.approve_invoice_delivery(text,jsonb,text,text,jsonb),openerp.start_invoice_delivery_simulation(text,jsonb,text,text,jsonb),
 openerp.resolve_invoice_delivery_simulation(text,jsonb,text,text,jsonb),openerp.get_invoice_delivery(text,jsonb,text),
 openerp.invoice_delivery_history(text,jsonb,text) TO openerp_runtime;
