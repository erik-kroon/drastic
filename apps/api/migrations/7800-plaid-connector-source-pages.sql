-- Plaid-specific raw-page link and content revisions. Other operator-delivered providers keep their prior contract.
-- Cursor max 256 follows Plaid Transactions Sync documentation; no table writes granted to runtime.
CREATE OR REPLACE FUNCTION openerp.ingest_bank_connector_batch(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_request jsonb:=jsonb_build_object('consentId',p_id,'input',p_input);
 v_consent openerp.bank_connector_consents; v_item jsonb; v_bytes bytea; v_hash text; v_old openerp.bank_connector_records;
 v_occurrence openerp.intake_occurrences; v_occurrence_body jsonb; v_batch jsonb; v_items jsonb:='[]';
 v_record_count integer:=0; v_overlap_count integer:=0; v_status text; v_revision text; v_source openerp.intake_occurrences;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'ingest_bank_connector_batch',v_request);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 SELECT * INTO v_consent FROM openerp.bank_connector_consents c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id FOR UPDATE;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The connector consent was not found in this book.'); END IF;
 IF v_consent.revoked_at IS NOT NULL THEN PERFORM openerp.fail('ApprovalRequired','The connector consent was revoked.'); END IF;
 IF NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=v_consent.book_id AND a.id=v_consent.account_id AND a.active) OR
 EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=v_consent.book_id AND
 ((s.source_bank_account_id=v_consent.source_account_id AND s.account_id<>v_consent.account_id) OR
  (s.account_id=v_consent.account_id AND s.source_bank_account_id<>v_consent.source_account_id))) THEN
   PERFORM openerp.fail('StaleDependency','The reviewed connector account mapping is no longer current.'); END IF;
 v_status:=p_input->>'providerOutcome';
 IF v_status IS NULL OR v_status NOT IN ('delivered','uncertain','failed') OR jsonb_typeof(p_input->'previousCursor') IS DISTINCT FROM 'string' OR
 length(p_input->>'previousCursor')>256 OR p_input->>'previousCursor' IS DISTINCT FROM coalesce(v_consent.cursor,'') OR
 jsonb_typeof(p_input->'nextCursor') IS DISTINCT FROM 'string' OR length(p_input->>'nextCursor')>256 OR
 jsonb_typeof(p_input->'sourceRevision') IS DISTINCT FROM 'string' OR length(p_input->>'sourceRevision') NOT BETWEEN 1 AND 200 OR
 jsonb_typeof(p_input->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'records')>20 OR
 octet_length(p_input::text)>262144 OR
 (v_status='delivered' AND (p_input->>'nextCursor')=(p_input->>'previousCursor')) OR
 (v_status<>'delivered' AND (jsonb_array_length(p_input->'records')<>0 OR p_input->>'nextCursor'<>p_input->>'previousCursor')) THEN
   PERFORM openerp.fail('InvalidJournal','Supply a bounded delivered page and changed cursor, or an empty uncertain/failed result at the current cursor.'); END IF;
 IF v_consent.provider_id='plaid' AND EXISTS(SELECT FROM jsonb_array_elements(p_input->'records') e(value) WHERE e.value ? 'revision') AND
    jsonb_typeof(p_input->'sourceOccurrenceId') IS DISTINCT FROM 'string' THEN
   PERFORM openerp.fail('MissingEvidence','Retain the exact provider page before ingesting its mapped updates.'); END IF;
 IF p_input ? 'sourceOccurrenceId' THEN
 SELECT * INTO v_source FROM openerp.intake_occurrences o WHERE o.book_id=v_consent.book_id AND o.id=p_input->>'sourceOccurrenceId';
 IF NOT FOUND OR v_source.source_system<>'connector-raw:'||v_consent.provider_id OR
   v_source.source_account_id<>v_consent.source_account_id OR
   v_source.source_revision<>p_input->>'sourceRevision' OR
   v_source.sha256<>'sha256:'||p_input->>'sourceRevision' OR
   v_source.body->>'mediaType'<>'application/json' THEN
   PERFORM openerp.fail('MissingEvidence','The exact provider page was not retained for this account and revision.'); END IF;
 END IF;
 v_batch:=jsonb_build_object('id',openerp.new_id('connectorbatch'),'scope',p_scope,'consentId',p_id,
 'providerOutcome',v_status,'previousCursor',p_input->>'previousCursor','nextCursor',p_input->>'nextCursor',
 'sourceRevision',p_input->>'sourceRevision','recordCount',0,'overlapCount',0,
 'receivedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'receivedBy',v_actor,
 'receipt',jsonb_build_object('key',p_key,'operation','ingest_bank_connector_batch','actorId',v_actor));
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_input->'records') r(value) LOOP
   IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR
    jsonb_typeof(v_item->'externalId') IS DISTINCT FROM 'string' OR length(v_item->>'externalId') NOT BETWEEN 1 AND 200 OR
    jsonb_typeof(v_item->'raw') IS DISTINCT FROM 'string' OR octet_length(v_item->>'raw') NOT BETWEEN 1 AND 65536 THEN
     PERFORM openerp.fail('InvalidJournal','Every delivered record needs a stable external ID and raw bytes of at most 64 KiB.'); END IF;
   v_revision:=coalesce(v_item->>'revision',p_input->>'sourceRevision');
   IF v_consent.provider_id='plaid' AND v_item ? 'revision' AND (jsonb_typeof(v_item->'revision') IS DISTINCT FROM 'string' OR v_revision !~ '^[a-f0-9]{64}$' OR
      encode(sha256(convert_to(v_item->>'raw','UTF8')),'hex')<>v_revision) THEN
     PERFORM openerp.fail('InvalidJournal','Each record revision must be the SHA-256 of its retained UTF-8 update.'); END IF;
   v_bytes:=convert_to(v_item->>'raw','UTF8'); v_hash:='sha256:'||encode(sha256(v_bytes),'hex');
   SELECT * INTO v_old FROM openerp.bank_connector_records r WHERE r.book_id=v_consent.book_id AND r.consent_id=p_id
     AND r.external_id=v_item->>'externalId' AND r.revision=v_revision;
   IF FOUND THEN
     IF v_old.sha256<>v_hash THEN PERFORM openerp.fail('IdempotencyConflict','The same provider ID and revision changed raw bytes. Resolve the source revision explicitly.'); END IF;
     v_overlap_count:=v_overlap_count+1;
     v_items:=v_items||jsonb_build_array(jsonb_build_object('externalId',v_item->>'externalId','revision',v_revision,
       'occurrenceId',v_old.occurrence_id,'status','overlap'));
     CONTINUE;
   END IF;
   -- The source-intake content/occurrence split retains exact UTF-8 bytes; no interpretation or bank import is implied.
   INSERT INTO openerp.intake_contents(book_id,sha256,bytes) VALUES(v_consent.book_id,v_hash,v_bytes) ON CONFLICT DO NOTHING;
   SELECT * INTO v_occurrence FROM openerp.intake_occurrences o WHERE o.book_id=v_consent.book_id AND
    o.source_system='connector:'||v_consent.provider_id AND o.source_account_id=v_consent.source_account_id AND
    o.occurrence_key=v_item->>'externalId' AND o.source_revision=v_revision;
   IF FOUND THEN PERFORM openerp.fail('IdempotencyConflict','A retained file or another connector already owns this source identity.'); END IF;
   v_occurrence_body:=jsonb_build_object('id',openerp.new_id('source'),'scope',p_scope,
    'sourceSystem','connector:'||v_consent.provider_id,'sourceAccountId',v_consent.source_account_id,
    'occurrenceKey',v_item->>'externalId','sourceRevision',v_revision,
    'filename','provider-record','sha256',v_hash,'byteLength',octet_length(v_bytes),
    'mediaType','application/octet-stream','retainedBy',v_actor,'retainedAt',v_batch->>'receivedAt',
    'receipt',v_batch->'receipt');
   INSERT INTO openerp.intake_occurrences VALUES(v_consent.book_id,v_occurrence_body->>'id',v_hash,
    'connector:'||v_consent.provider_id,v_consent.source_account_id,v_item->>'externalId',v_revision,v_occurrence_body);
   INSERT INTO openerp.bank_connector_records VALUES(v_consent.book_id,p_id,v_item->>'externalId',v_revision,
    v_occurrence_body->>'id',v_batch->>'id',v_hash);
   v_record_count:=v_record_count+1;
   v_items:=v_items||jsonb_build_array(jsonb_build_object('externalId',v_item->>'externalId','revision',v_revision,
    'occurrenceId',v_occurrence_body->>'id','status',
    CASE WHEN EXISTS(SELECT FROM openerp.bank_connector_records r WHERE r.book_id=v_consent.book_id AND r.consent_id=p_id
      AND r.external_id=v_item->>'externalId' AND r.revision<>v_revision) THEN 'revision' ELSE 'new' END));
 END LOOP;
 IF p_input ? 'sourceOccurrenceId' THEN v_batch:=v_batch||jsonb_build_object('sourceOccurrenceId',p_input->>'sourceOccurrenceId'); END IF;
 v_batch:=v_batch||jsonb_build_object('recordCount',v_record_count,'overlapCount',v_overlap_count,'items',v_items,
  'recognition','not_admitted','providerVerification','not_established');
 INSERT INTO openerp.bank_connector_batches VALUES(v_consent.book_id,v_batch->>'id',p_id,v_batch);
 IF v_status='delivered' THEN UPDATE openerp.bank_connector_consents SET cursor=p_input->>'nextCursor' WHERE book_id=v_consent.book_id AND id=p_id; END IF;
 RETURN openerp.save_command(v_consent.book_id,p_key,v_actor,'ingest_bank_connector_batch',v_request,v_batch);
END $$;

