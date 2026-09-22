-- Content-addressed original documents; CSV interpretation keeps its existing bound.
ALTER TABLE openerp.intake_contents ALTER COLUMN bytes DROP NOT NULL;
ALTER TABLE openerp.intake_contents ADD COLUMN object_key text;
ALTER TABLE openerp.intake_contents ADD COLUMN byte_length integer;
ALTER TABLE openerp.intake_contents ADD CONSTRAINT intake_content_storage CHECK (
  (bytes IS NOT NULL AND object_key IS NULL AND byte_length IS NULL) OR
  (bytes IS NULL AND object_key IS NOT NULL AND byte_length IS NOT NULL AND byte_length BETWEEN 1 AND 5242880
    AND sha256 ~ '^sha256:[a-f0-9]{64}$'
    AND object_key = 'v1/' || book_id || '/' || substring(sha256 FROM 8))
);

CREATE TABLE openerp.source_uploads (
  book_id text NOT NULL REFERENCES openerp.books,
  key text NOT NULL CHECK (key ~ '^[a-zA-Z0-9_-]{8,128}$'),
  input jsonb NOT NULL,
  created_by text NOT NULL REFERENCES openerp.actors,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, key)
);
CREATE TRIGGER immutable_source_upload BEFORE UPDATE OR DELETE ON openerp.source_uploads
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.begin_source_upload(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_field text; v_saved jsonb; v_owner text;
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'retain_source_object',input);
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

CREATE FUNCTION openerp.complete_source_upload(token text, scope jsonb, key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_input jsonb; v_previous jsonb; v_occurrence openerp.intake_occurrences;
  v_body jsonb; v_content openerp.intake_contents;
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  SELECT u.input INTO v_input FROM openerp.source_uploads u
    WHERE u.book_id=scope->>'bookId' AND u.key=complete_source_upload.key AND u.created_by=v_actor;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Begin and verify the retained upload before completing it.'); END IF;
  v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'retain_source_object',v_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  SELECT * INTO v_occurrence FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId'
    AND o.source_system=v_input->>'sourceSystem' AND o.source_account_id=v_input->>'sourceAccountId'
    AND o.occurrence_key=v_input->>'occurrenceKey' AND o.source_revision=v_input->>'sourceRevision';
  IF FOUND THEN
    IF v_occurrence.sha256<>v_input->>'sha256' OR v_occurrence.body->>'filename'<>v_input->>'filename'
      OR v_occurrence.body->>'mediaType'<>v_input->>'mediaType' THEN
      PERFORM openerp.fail('IdempotencyConflict','This source occurrence already retains different content or metadata.');
    END IF;
    v_body:=v_occurrence.body;
  ELSE
    INSERT INTO openerp.intake_contents(book_id,sha256,object_key,byte_length)
      VALUES(scope->>'bookId',v_input->>'sha256','v1/'||(scope->>'bookId')||'/'||substring(v_input->>'sha256' FROM 8),
        (v_input->>'byteLength')::integer) ON CONFLICT DO NOTHING;
    SELECT * INTO STRICT v_content FROM openerp.intake_contents c
      WHERE c.book_id=scope->>'bookId' AND c.sha256=v_input->>'sha256';
    IF coalesce(octet_length(v_content.bytes),v_content.byte_length)<>(v_input->>'byteLength')::integer THEN
      PERFORM openerp.fail('MissingEvidence','Retained bytes disagree with the content manifest.');
    END IF;
    v_body:=v_input||jsonb_build_object('id',openerp.new_id('source'),'scope',scope,'retainedBy',v_actor,
      'retainedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'receipt',jsonb_build_object('key',key,'operation','retain_source_object','actorId',v_actor));
    INSERT INTO openerp.intake_occurrences VALUES(scope->>'bookId',v_body->>'id',v_input->>'sha256',
      v_input->>'sourceSystem',v_input->>'sourceAccountId',v_input->>'occurrenceKey',v_input->>'sourceRevision',v_body);
  END IF;
  RETURN openerp.save_command(scope->>'bookId',key,v_actor,'retain_source_object',v_input,v_body);
END $$;

CREATE FUNCTION openerp.get_source_storage(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_occurrence openerp.intake_occurrences; v_content openerp.intake_contents; v_previews jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO v_occurrence FROM openerp.intake_occurrences o
    WHERE o.book_id=scope->>'bookId' AND o.id=get_source_storage.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained occurrence was not found in this book.'); END IF;
  SELECT * INTO STRICT v_content FROM openerp.intake_contents c
    WHERE c.book_id=v_occurrence.book_id AND c.sha256=v_occurrence.sha256;
  SELECT coalesce(jsonb_agg(p.id ORDER BY p.ordinal DESC),'[]') INTO v_previews
    FROM openerp.intake_previews p WHERE p.book_id=v_occurrence.book_id AND p.occurrence_id=v_occurrence.id;
  RETURN openerp.intake_summary(v_occurrence)||jsonb_build_object(
    'contentBase64',replace(encode(v_content.bytes,'base64'),E'\n',''),'previewIds',v_previews,
    'object',CASE WHEN v_content.object_key IS NOT NULL THEN
      jsonb_build_object('objectKey',v_content.object_key,'sha256',v_content.sha256,'byteLength',v_content.byte_length) ELSE NULL END);
END $$;

REVOKE ALL ON openerp.source_uploads FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.begin_source_upload(text,jsonb,text,jsonb),
  openerp.complete_source_upload(text,jsonb,text),openerp.get_source_storage(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.begin_source_upload(text,jsonb,text,jsonb),
  openerp.complete_source_upload(text,jsonb,text),openerp.get_source_storage(text,jsonb,text) TO openerp_runtime;

CREATE OR REPLACE FUNCTION openerp.retain_source(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_bytes bytea; v_hash text; v_name text;
 v_occurrence openerp.intake_occurrences; v_body jsonb;
BEGIN
 v_actor:=openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'retain_source',input);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 FOREACH v_name IN ARRAY ARRAY['sourceSystem','sourceAccountId','occurrenceKey','sourceRevision','filename'] LOOP
   IF jsonb_typeof(input->v_name) IS DISTINCT FROM 'string' OR coalesce(length(input->>v_name),0) NOT BETWEEN 1 AND 200 THEN
     PERFORM openerp.fail('InvalidJournal','Supply explicit source, occurrence, revision and filename labels of 1–200 characters.'); END IF;
 END LOOP;
 IF jsonb_typeof(input->'contentBase64') IS DISTINCT FROM 'string' OR coalesce(length(input->>'contentBase64'),0) NOT BETWEEN 4 AND 87384
   OR input->>'contentBase64'!~'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN
   PERFORM openerp.fail('InvalidJournal','Supply canonical base64 for an original file of 1–65536 bytes.'); END IF;
 v_bytes:=decode(input->>'contentBase64','base64');
 IF octet_length(v_bytes) NOT BETWEEN 1 AND 65536 OR replace(encode(v_bytes,'base64'),E'\n','') IS DISTINCT FROM input->>'contentBase64' THEN
   PERFORM openerp.fail('InvalidJournal','Supply canonical base64 for an original file of 1–65536 bytes.'); END IF;
 v_hash:='sha256:'||encode(sha256(v_bytes),'hex');
   IF EXISTS(SELECT FROM openerp.intake_contents c WHERE c.book_id=scope->>'bookId' AND c.sha256=v_hash AND c.bytes IS NULL) THEN
     PERFORM openerp.fail('UnsupportedProfile','These bytes are already retained externally. Retrieve the original through its retained occurrence.'); END IF;
 SELECT * INTO v_occurrence FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId'
   AND o.source_system=input->>'sourceSystem' AND o.source_account_id=input->>'sourceAccountId'
   AND o.occurrence_key=input->>'occurrenceKey' AND o.source_revision=input->>'sourceRevision';
 IF FOUND THEN
   IF v_occurrence.sha256<>v_hash OR v_occurrence.body->>'filename'<>input->>'filename' OR v_occurrence.body->>'mediaType'<>'text/csv' THEN
     PERFORM openerp.fail('IdempotencyConflict','This source occurrence already retains different content or metadata. Supply a distinct occurrence only for a distinct acquisition.'); END IF;
   v_body:=v_occurrence.body;
 ELSE
   INSERT INTO openerp.intake_contents(book_id,sha256,bytes) VALUES(scope->>'bookId',v_hash,v_bytes) ON CONFLICT DO NOTHING;
   v_body:=jsonb_build_object('id',openerp.new_id('source'),'scope',scope,'sourceSystem',input->>'sourceSystem',
     'sourceAccountId',input->>'sourceAccountId','occurrenceKey',input->>'occurrenceKey','sourceRevision',input->>'sourceRevision',
     'filename',input->>'filename','sha256',v_hash,'byteLength',octet_length(v_bytes),'mediaType','text/csv','retainedBy',v_actor,
     'retainedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'receipt',jsonb_build_object('key',key,'operation','retain_source','actorId',v_actor));
   INSERT INTO openerp.intake_occurrences VALUES(scope->>'bookId',v_body->>'id',v_hash,input->>'sourceSystem',input->>'sourceAccountId',input->>'occurrenceKey',input->>'sourceRevision',v_body);
 END IF;
 RETURN openerp.save_command(scope->>'bookId',key,v_actor,'retain_source',input,v_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_source_occurrence(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_occurrence openerp.intake_occurrences; v_bytes bytea; v_previews jsonb;
BEGIN
 PERFORM openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
 SELECT * INTO v_occurrence FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId' AND o.id=get_source_occurrence.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained occurrence was not found in this book.'); END IF;
 SELECT c.bytes INTO STRICT v_bytes FROM openerp.intake_contents c WHERE c.book_id=v_occurrence.book_id AND c.sha256=v_occurrence.sha256;
 IF v_bytes IS NULL THEN PERFORM openerp.fail('UnsupportedProfile','This original requires the object-storage retrieval path.'); END IF;
 SELECT coalesce(jsonb_agg(p.id ORDER BY p.ordinal DESC),'[]') INTO v_previews FROM openerp.intake_previews p WHERE p.book_id=v_occurrence.book_id AND p.occurrence_id=v_occurrence.id;
 RETURN openerp.intake_summary(v_occurrence)||jsonb_build_object('contentBase64',replace(encode(v_bytes,'base64'),E'\n',''),'previewIds',v_previews);
END $$;

CREATE OR REPLACE FUNCTION openerp.preview_source_csv(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_request jsonb:=jsonb_build_object('occurrenceId',id,'mapping',input);
 v_previous jsonb; v_occurrence openerp.intake_occurrences; v_bytes bytea; v_body jsonb; v_ordinal integer;
BEGIN
 v_actor:=openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'preview_source_csv',v_request);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 PERFORM openerp.intake_check_mapping(input);
 SELECT * INTO v_occurrence FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId' AND o.id=preview_source_csv.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained occurrence was not found in this book.'); END IF;
 IF v_occurrence.body->>'mediaType'<>'text/csv' OR (v_occurrence.body->>'byteLength')::integer>65536 THEN
   PERFORM openerp.fail('UnsupportedProfile','CSV interpretation supports text/csv originals of at most 65536 bytes. The original remains retained.'); END IF;
 IF EXISTS(SELECT FROM openerp.intake_admissions a WHERE a.book_id=v_occurrence.book_id AND a.occurrence_id=v_occurrence.id) THEN
   PERFORM openerp.fail('IdempotencyConflict','This occurrence already has an admitted interpretation. Retained provenance cannot be replaced.'); END IF;
 SELECT count(*)+1 INTO v_ordinal FROM openerp.intake_previews p WHERE p.book_id=v_occurrence.book_id AND p.occurrence_id=v_occurrence.id;
 IF v_ordinal>50 THEN PERFORM openerp.fail('InvalidJournal','This occurrence has reached its 50-preview bound. Existing interpretations and bytes remain retained.'); END IF;
 SELECT c.bytes INTO STRICT v_bytes FROM openerp.intake_contents c WHERE c.book_id=v_occurrence.book_id AND c.sha256=v_occurrence.sha256;
 IF v_bytes IS NULL THEN PERFORM openerp.fail('UnsupportedProfile','This original requires the object-storage retrieval path.'); END IF;
 v_body:=openerp.intake_interpret(v_occurrence.book_id,v_occurrence,input,openerp.intake_csv_records(v_bytes,input->>'delimiter',input->>'lineEnding'))
   ||jsonb_build_object('id',openerp.new_id('preview'),'occurrenceId',id,'scope',scope,'version',1,'sourceSha256',v_occurrence.sha256,
     'mapping',input,'dependencies',openerp.intake_dependencies(v_occurrence.book_id,input->>'accountId'),
     'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body),'receipt',jsonb_build_object('key',key,'operation','preview_source_csv','actorId',v_actor));
 INSERT INTO openerp.intake_previews VALUES(v_occurrence.book_id,v_body->>'id',id,v_ordinal,v_body);
 RETURN openerp.save_command(v_occurrence.book_id,key,v_actor,'preview_source_csv',v_request,v_body);
END $$;
