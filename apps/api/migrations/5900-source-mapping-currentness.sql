-- Close cross-account mapping staleness without changing captured dependency identities or replay.
-- Match the existing intake_interpret/import_bank_statement two-way source mapping fence.
-- Callers hold the book barrier. Unknown/foreign occurrences and null accounts fail closed.
CREATE FUNCTION openerp.intake_source_mapping_current(p_book text,p_occurrence text,p_account text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT p_account IS NOT NULL AND EXISTS(
    SELECT FROM openerp.intake_occurrences o WHERE o.book_id=p_book AND o.id=p_occurrence
      AND NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=o.book_id
        AND ((s.account_id=p_account AND s.source_bank_account_id<>o.source_account_id)
          OR (s.source_bank_account_id=o.source_account_id AND s.account_id<>p_account))))
$$;
REVOKE ALL ON FUNCTION openerp.intake_source_mapping_current(text,text,text) FROM PUBLIC,openerp_runtime;

CREATE OR REPLACE FUNCTION openerp.approve_source_preview(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_request jsonb:=jsonb_build_object('previewId',id,'input',input); v_previous jsonb;
 v_preview openerp.intake_previews; v_body jsonb; v_expires timestamptz;
BEGIN
 v_actor:=openerp.authorize(token,scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'approve_source_preview',v_request);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 SELECT * INTO v_preview FROM openerp.intake_previews p WHERE p.book_id=scope->>'bookId' AND p.id=approve_source_preview.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
 IF input->>'digest' IS DISTINCT FROM v_preview.body->>'digest' OR input->'version' IS DISTINCT FROM '1'::jsonb
   OR jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string' OR coalesce(length(input->>'rationale'),0) NOT BETWEEN 1 AND 2000 THEN
   PERFORM openerp.fail('ApprovalRequired','Review the exact digest/version and record your rationale.'); END IF;
 IF v_preview.body->'ready' IS DISTINCT FROM 'true'::jsonb THEN PERFORM openerp.fail('InvalidJournal','Resolve every blocking diagnostic in a new preview before approval.'); END IF;
 IF v_preview.body->'dependencies' IS DISTINCT FROM openerp.intake_dependencies(v_preview.book_id,v_preview.body->'mapping'->>'accountId')
   OR NOT openerp.intake_source_mapping_current(v_preview.book_id,v_preview.occurrence_id,v_preview.body->'mapping'->>'accountId') THEN
   PERFORM openerp.fail('StaleDependency','Source or configuration changed. Create and review a new preview.'); END IF;
 IF EXISTS(SELECT FROM openerp.intake_admissions a WHERE a.book_id=v_preview.book_id AND a.occurrence_id=v_preview.occurrence_id) THEN
   PERFORM openerp.fail('IdempotencyConflict','This occurrence already has an admitted interpretation.'); END IF;
 v_expires:=clock_timestamp()+interval '1 hour';
 v_body:=input||jsonb_build_object('id',openerp.new_id('intakeapproval'),'previewId',id,'actorId',v_actor,
   'expiresAt',to_char(v_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'receipt',jsonb_build_object('key',key,'operation','approve_source_preview','actorId',v_actor));
 INSERT INTO openerp.intake_approvals VALUES(v_preview.book_id,v_body->>'id',id,v_actor,v_expires,v_body);
 RETURN openerp.save_command(v_preview.book_id,key,v_actor,'approve_source_preview',v_request,v_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.admit_source_preview(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_request jsonb:=jsonb_build_object('previewId',id,'input',input); v_previous jsonb;
 v_preview openerp.intake_previews; v_approval openerp.intake_approvals; v_existing openerp.intake_admissions;
 v_evidence jsonb; v_import jsonb; v_body jsonb; v_internal text;
BEGIN
 -- The approving operator admits their own exact interpretation. Ordinary agent tools cannot approve/admit.
 v_actor:=openerp.authorize(token,scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'admit_source_preview',v_request);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 SELECT * INTO v_preview FROM openerp.intake_previews p WHERE p.book_id=scope->>'bookId' AND p.id=admit_source_preview.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
 IF input->>'digest' IS DISTINCT FROM v_preview.body->>'digest' OR input->'version' IS DISTINCT FROM '1'::jsonb THEN
   PERFORM openerp.fail('ApprovalRequired','Admit only the exact reviewed digest and version.'); END IF;
 SELECT * INTO v_existing FROM openerp.intake_admissions a WHERE a.book_id=v_preview.book_id AND a.occurrence_id=v_preview.occurrence_id;
 IF FOUND THEN
   IF v_existing.preview_id<>id OR v_existing.approval_id IS DISTINCT FROM input->>'approvalId' THEN
     PERFORM openerp.fail('IdempotencyConflict','This occurrence already has a different admitted interpretation.'); END IF;
   RETURN openerp.save_command(v_preview.book_id,key,v_actor,'admit_source_preview',v_request,v_existing.body);
 END IF;
 SELECT * INTO v_approval FROM openerp.intake_approvals a WHERE a.book_id=v_preview.book_id AND a.id=input->>'approvalId' AND a.preview_id=v_preview.id AND a.actor_id=v_actor;
 IF NOT FOUND OR v_approval.expires_at<=clock_timestamp() OR v_approval.body->>'digest' IS DISTINCT FROM input->>'digest' THEN
   PERFORM openerp.fail('ApprovalRequired','A current exact approval by this operator is required.'); END IF;
 IF v_preview.body->'ready' IS DISTINCT FROM 'true'::jsonb OR v_preview.body->'statement'='null'::jsonb THEN
   PERFORM openerp.fail('InvalidJournal','A blocked preview cannot admit observations.'); END IF;
 IF v_preview.body->'dependencies' IS DISTINCT FROM openerp.intake_dependencies(v_preview.book_id,v_preview.body->'mapping'->>'accountId')
   OR NOT openerp.intake_source_mapping_current(v_preview.book_id,v_preview.occurrence_id,v_preview.body->'mapping'->>'accountId') THEN
   PERFORM openerp.fail('StaleDependency','Source or configuration changed. Create and review a new preview.'); END IF;
 v_internal:='intake_'||v_preview.occurrence_id;
 v_evidence:=openerp.create_evidence(token,scope,v_internal||'_evidence',jsonb_build_object(
   'title','Reviewed bank CSV interpretation '||v_preview.id,'content',(v_preview.body->'statement')::text,
   'mediaType','application/json','origin','Retained source '||v_preview.occurrence_id||'; preview '||v_preview.id||'; '||(v_preview.body->>'sourceSha256')));
 v_import:=openerp.import_bank_statement(token,scope,v_internal||'_import',v_preview.body->'statement'||jsonb_build_object('evidenceId',v_evidence->>'id','existingMatches','[]'::jsonb));
 v_body:=jsonb_build_object('occurrenceId',v_preview.occurrence_id,'previewId',id,'approvalId',v_approval.id,'digest',input->>'digest',
   'admittedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'imported',v_import,
   'receipt',jsonb_build_object('key',key,'operation','admit_source_preview','actorId',v_actor));
 INSERT INTO openerp.intake_admissions VALUES(v_preview.book_id,v_preview.occurrence_id,id,v_approval.id,v_body);
 RETURN openerp.save_command(v_preview.book_id,key,v_actor,'admit_source_preview',v_request,v_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_source_preview(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_preview openerp.intake_previews; v_approval jsonb; v_admission jsonb; v_actor text; v_replacement text;
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO v_preview FROM openerp.intake_previews p WHERE p.book_id=scope->>'bookId' AND p.id=get_source_preview.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
  SELECT s.replacement_preview_id INTO v_replacement FROM openerp.intake_preview_supersessions s
    WHERE s.book_id=v_preview.book_id AND s.previous_preview_id=v_preview.id;
  IF v_replacement IS NULL THEN
    SELECT a.body INTO v_approval FROM openerp.intake_approvals a WHERE a.book_id=v_preview.book_id AND a.preview_id=v_preview.id AND a.actor_id=v_actor AND a.expires_at>clock_timestamp() ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
  END IF;
  SELECT a.body INTO v_admission FROM openerp.intake_admissions a WHERE a.book_id=v_preview.book_id AND a.occurrence_id=v_preview.occurrence_id;
  RETURN jsonb_build_object('preview',v_preview.body,'approval',v_approval,'admission',v_admission,
    'supersededByPreviewId',v_replacement,
    'dependenciesCurrent',v_replacement IS NULL AND v_preview.body->'dependencies'=openerp.intake_dependencies(v_preview.book_id,v_preview.body->'mapping'->>'accountId')
      AND openerp.intake_source_mapping_current(v_preview.book_id,v_preview.occurrence_id,v_preview.body->'mapping'->>'accountId'));
END $$;

CREATE OR REPLACE FUNCTION openerp.capture_source_review(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE r_actor text; r_previous jsonb; r_request jsonb:=jsonb_build_object('previewId',p_id,'input',p_input);
  r_preview openerp.intake_previews; r_occurrence openerp.intake_occurrences;
  r_content openerp.intake_contents; r_saved openerp.source_review_artifacts;
  r_reviews jsonb; r_supersessions jsonb; r_admission jsonb; r_replacement text;
  r_now timestamptz; r_body jsonb; r_json text; r_bytes integer; r_receipt jsonb;
BEGIN
  r_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  r_previous:=openerp.replay(p_scope->>'bookId',p_key,r_actor,'capture_source_review',r_request);
  IF r_previous IS NOT NULL THEN RETURN r_previous; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Select the exact retained preview digest to capture.'); END IF;
  IF p_input-'digest'<>'{}'::jsonb OR jsonb_typeof(p_input->'digest') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Select the exact retained preview digest to capture.'); END IF;
  SELECT * INTO r_preview FROM openerp.intake_previews p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
  IF p_input->>'digest' IS DISTINCT FROM r_preview.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Capture only the exact retained preview digest.'); END IF;
  SELECT * INTO STRICT r_occurrence FROM openerp.intake_occurrences o
    WHERE o.book_id=r_preview.book_id AND o.id=r_preview.occurrence_id;
  SELECT * INTO STRICT r_content FROM openerp.intake_contents c
    WHERE c.book_id=r_occurrence.book_id AND c.sha256=r_occurrence.sha256;
  IF r_preview.body->>'sourceSha256' IS DISTINCT FROM r_content.sha256
    OR r_occurrence.body->>'sha256' IS DISTINCT FROM r_content.sha256
    OR r_occurrence.body->>'byteLength' IS DISTINCT FROM coalesce(octet_length(r_content.bytes),r_content.byte_length)::text
    OR r_preview.body->>'digest' IS DISTINCT FROM openerp.digest(r_preview.body-ARRAY['digest','receipt']) THEN
    PERFORM openerp.fail('MissingEvidence','The retained interpretation and original content identity do not agree.'); END IF;
  IF (SELECT count(*) FROM openerp.source_review_artifacts a WHERE a.book_id=r_preview.book_id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book has reached its 200 retained review captures. Existing artifacts remain readable.'); END IF;
  IF (SELECT count(*) FROM(SELECT 1 FROM openerp.intake_approvals a
      WHERE a.book_id=r_preview.book_id AND a.preview_id=r_preview.id LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM openerp.intake_previews p
      WHERE p.book_id=r_preview.book_id AND p.occurrence_id=r_preview.occurrence_id)>50
    OR (SELECT count(*) FROM openerp.intake_preview_supersessions s JOIN openerp.intake_previews p
      ON (p.book_id,p.id)=(s.book_id,s.previous_preview_id)
      WHERE p.book_id=r_preview.book_id AND p.occurrence_id=r_preview.occurrence_id)>49 THEN
    PERFORM openerp.fail('UnsupportedProfile','Complete capture supports 200 selected-preview reviews and 50 occurrence previews. No history was truncated.'); END IF;
  r_now:=clock_timestamp();
  -- Deliberate allowlist: no approval identifier, command key, digest/version payload
  -- or receipt is copied into reviewer summaries visible to another scoped actor.
  SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',a.actor_id,
    'rationale',a.body->>'rationale','expiresAt',a.body->>'expiresAt','expiredAtCapture',a.expires_at<=r_now)
    ORDER BY a.expires_at,a.id COLLATE "C"),'[]') INTO r_reviews
    FROM openerp.intake_approvals a WHERE a.book_id=r_preview.book_id AND a.preview_id=r_preview.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('previousPreviewId',s.previous_preview_id,
    'previousDigest',s.body->>'previousDigest','replacementPreviewId',s.replacement_preview_id,
    'replacementDigest',s.body->>'replacementDigest','rationale',s.body->>'rationale',
    'actorId',s.body->>'actorId','createdAt',s.body->>'createdAt') ORDER BY p.ordinal),'[]') INTO r_supersessions
    FROM openerp.intake_preview_supersessions s JOIN openerp.intake_previews p
      ON (p.book_id,p.id)=(s.book_id,s.previous_preview_id)
    WHERE p.book_id=r_preview.book_id AND p.occurrence_id=r_preview.occurrence_id;
  SELECT s.replacement_preview_id INTO r_replacement FROM openerp.intake_preview_supersessions s
    WHERE s.book_id=r_preview.book_id AND s.previous_preview_id=r_preview.id;
  SELECT jsonb_build_object('previewId',a.preview_id,'digest',a.body->>'digest',
    'admittedAt',a.body->>'admittedAt','admittedBy',a.body->'receipt'->>'actorId',
    'statementId',a.body->'imported'->'statement'->>'id','evidenceId',a.body->'imported'->'statement'->>'evidenceId',
    'checkpoint',a.body->'imported'->'checkpoint') INTO r_admission
    FROM openerp.intake_admissions a WHERE a.book_id=r_preview.book_id AND a.occurrence_id=r_preview.occurrence_id;
  r_body:=jsonb_build_object('id',openerp.new_id('source_review'),'kind','source_review_artifact_v1',
    'scope',p_scope,'previewId',r_preview.id,'previewDigest',r_preview.body->>'digest',
    'occurrenceId',r_occurrence.id,'sourceSha256',r_content.sha256,'capturedBy',r_actor,
    'capturedAt',to_char(r_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'coverage','not_established','postingAuthority',false,'approvalAuthority',false,
    'occurrence',r_occurrence.body,'original',jsonb_build_object('bookId',r_occurrence.book_id,
      'sha256',r_content.sha256,'byteLength',coalesce(octet_length(r_content.bytes),r_content.byte_length),
      'mediaType',r_occurrence.body->>'mediaType','availability','not_checked'),
    'preview',r_preview.body,'supersessions',r_supersessions,
    'stateAtCapture',jsonb_build_object('dependenciesCurrent',r_replacement IS NULL
      AND r_preview.body->'dependencies'=openerp.intake_dependencies(r_preview.book_id,r_preview.body->'mapping'->>'accountId')
      AND openerp.intake_source_mapping_current(r_preview.book_id,r_preview.occurrence_id,r_preview.body->'mapping'->>'accountId'),
      'supersededByPreviewId',r_replacement,'reviews',r_reviews,'admission',r_admission,
      'selectedPreviewAdmitted',coalesce(r_admission->>'previewId'=r_preview.id,false)));
  r_json:=openerp.canonical(r_body); r_bytes:=octet_length(convert_to(r_json,'UTF8'));
  IF r_bytes>4194304 THEN PERFORM openerp.fail('UnsupportedProfile','The complete review artifact exceeds 4 MiB. No partial artifact was saved.'); END IF;
  r_receipt:=jsonb_build_object('key',p_key,'operation','capture_source_review','actorId',r_actor);
  INSERT INTO openerp.source_review_artifacts VALUES(r_preview.book_id,r_body->>'id',r_occurrence.id,r_preview.id,
    r_body,r_json,encode(sha256(convert_to(r_json,'UTF8')),'hex'),r_bytes,r_receipt) RETURNING * INTO r_saved;
  RETURN openerp.save_command(r_preview.book_id,p_key,r_actor,'capture_source_review',r_request,
    openerp.source_review_artifact_summary(r_saved));
END $$;

-- Existing public function signatures/EXECUTE grants are retained by CREATE OR REPLACE.
