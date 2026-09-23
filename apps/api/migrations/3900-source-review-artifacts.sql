-- Durable interpretation review exports. Never reparses, imports, approves or posts.
CREATE TABLE openerp.source_review_artifacts (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  occurrence_id text NOT NULL, preview_id text NOT NULL,
  body jsonb NOT NULL, content text NOT NULL,
  sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 4194304),
  receipt jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,occurrence_id) REFERENCES openerp.intake_occurrences(book_id,id),
  FOREIGN KEY(book_id,preview_id) REFERENCES openerp.intake_previews(book_id,id),
  CHECK(byte_length=octet_length(convert_to(content,'UTF8'))),
  CHECK(sha256=encode(sha256(convert_to(content,'UTF8')),'hex'))
);
CREATE TRIGGER immutable_source_review_artifact BEFORE UPDATE OR DELETE ON openerp.source_review_artifacts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.source_review_artifacts FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.source_review_artifact_summary(p_saved openerp.source_review_artifacts) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
  SELECT ((p_saved).body-ARRAY['occurrence','original','preview','stateAtCapture','supersessions'])
    ||jsonb_build_object('sha256',(p_saved).sha256,'byteLength',(p_saved).byte_length,
      'mediaType','application/json','receipt',(p_saved).receipt)
$$;

CREATE FUNCTION openerp.capture_source_review(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
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
      AND r_preview.body->'dependencies'=openerp.intake_dependencies(r_preview.book_id,r_preview.body->'mapping'->>'accountId'),
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

CREATE FUNCTION openerp.get_source_review_artifact(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE r_saved openerp.source_review_artifacts;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO r_saved FROM openerp.source_review_artifacts a WHERE a.book_id=p_scope->>'bookId' AND a.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The source review artifact was not found in this book.'); END IF;
  RETURN jsonb_build_object('capture',openerp.source_review_artifact_summary(r_saved),
    'snapshot',r_saved.body,'content',r_saved.content);
END $$;
CREATE FUNCTION openerp.list_source_review_artifacts(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE r_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(openerp.source_review_artifact_summary(a)
    ORDER BY a.body->>'capturedAt' DESC,a.id COLLATE "C"),'[]') INTO r_items
    FROM openerp.source_review_artifacts a WHERE a.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',r_items);
END $$;
REVOKE ALL ON FUNCTION openerp.source_review_artifact_summary(openerp.source_review_artifacts),
  openerp.capture_source_review(text,jsonb,text,text,jsonb),openerp.get_source_review_artifact(text,jsonb,text),
  openerp.list_source_review_artifacts(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.capture_source_review(text,jsonb,text,text,jsonb),
  openerp.get_source_review_artifact(text,jsonb,text),openerp.list_source_review_artifacts(text,jsonb) TO openerp_runtime;
