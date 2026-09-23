-- Recover a completed exact-key upload without touching its external object.
-- Existing reference fields and the pending-upload path remain unchanged.
-- CREATE OR REPLACE preserves the existing runtime EXECUTE grants.
CREATE OR REPLACE FUNCTION openerp.begin_source_upload(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_field text; v_saved jsonb; v_owner text;
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'retain_source_object',input);
  IF v_previous IS NOT NULL THEN
    RETURN jsonb_build_object('objectKey','v1/'||(scope->>'bookId')||'/'||substring(input->>'sha256' FROM 8),
      'sha256',input->>'sha256','byteLength',(input->>'byteLength')::integer,'completed',v_previous);
  END IF;
  FOREACH v_field IN ARRAY ARRAY['sourceSystem','sourceAccountId','occurrenceKey','sourceRevision','filename'] LOOP
    IF jsonb_typeof(input->v_field) IS DISTINCT FROM 'string' OR coalesce(length(input->>v_field),0) NOT BETWEEN 1 AND 200 THEN
      PERFORM openerp.fail('InvalidJournal','Supply explicit source, occurrence, revision and filename labels of 1–200 characters.');
    END IF;
  END LOOP;
  IF input->>'sha256' IS NULL OR input->>'sha256' !~ '^sha256:[a-f0-9]{64}$'
    OR jsonb_typeof(input->'byteLength') IS DISTINCT FROM 'number'
    OR input->>'byteLength' !~ '^[1-9][0-9]{0,6}$'
    OR (input->>'byteLength')::numeric > 5242880
    OR input->>'mediaType' IS NULL OR input->>'mediaType' NOT IN
      ('text/csv','text/plain','application/pdf','application/json','application/xml','image/jpeg','image/png','application/octet-stream')
    OR EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN
      ('sourceSystem','sourceAccountId','occurrenceKey','sourceRevision','filename','sha256','byteLength','mediaType')) THEN
    PERFORM openerp.fail('InvalidJournal','Supply a supported original document of 1–5242880 bytes with a SHA-256 digest.');
  END IF;
  INSERT INTO openerp.source_uploads(book_id,key,input,created_by)
    VALUES(scope->>'bookId',key,input,v_actor) ON CONFLICT DO NOTHING;
  SELECT u.input,u.created_by INTO STRICT v_saved,v_owner FROM openerp.source_uploads u
    WHERE u.book_id=scope->>'bookId' AND u.key=begin_source_upload.key;
  IF v_saved IS DISTINCT FROM input OR v_owner<>v_actor THEN
    PERFORM openerp.fail('IdempotencyConflict','This upload key identifies different bytes or metadata.');
  END IF;
  RETURN jsonb_build_object('objectKey','v1/'||(scope->>'bookId')||'/'||substring(input->>'sha256' FROM 8),
    'sha256',input->>'sha256','byteLength',(input->>'byteLength')::integer);
END $$;
