-- Supplier inbox binds a retained original to one reviewed draft. No OCR or mail provider is installed.
CREATE TABLE openerp.supplier_inbox (
  book_id text NOT NULL REFERENCES openerp.books, occurrence_id text NOT NULL,
  channel text NOT NULL CHECK(channel IN ('upload','email')),
  message_identity text,
  draft_id text,
  PRIMARY KEY(book_id,occurrence_id),
  FOREIGN KEY(book_id,occurrence_id) REFERENCES openerp.intake_occurrences,
  FOREIGN KEY(book_id,draft_id) REFERENCES openerp.supplier_invoice_drafts,
  UNIQUE(book_id,channel,message_identity), UNIQUE(book_id,draft_id),
  CHECK(channel='upload' OR message_identity IS NOT NULL)
);
CREATE TABLE openerp.supplier_extraction_attempts (
  book_id text NOT NULL, id text NOT NULL, occurrence_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
  body jsonb NOT NULL CHECK(octet_length(body::text)<=65536),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,occurrence_id,ordinal),
  FOREIGN KEY(book_id,occurrence_id) REFERENCES openerp.supplier_inbox,
  CHECK(body->>'id'=id AND body->>'occurrenceId'=occurrence_id)
);
CREATE TRIGGER immutable_supplier_extraction_attempt BEFORE UPDATE OR DELETE ON openerp.supplier_extraction_attempts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.supplier_inbox_view(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_book text; v_entry openerp.supplier_inbox; v_source jsonb; v_attempts jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  v_book:=p_scope->>'bookId';
  SELECT * INTO v_entry FROM openerp.supplier_inbox WHERE book_id=v_book AND occurrence_id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Supplier inbox original not found in this book.'); END IF;
  v_source:=openerp.get_source_occurrence(p_token,p_scope,p_id);
  SELECT coalesce(jsonb_agg(body ORDER BY ordinal),'[]'::jsonb) INTO v_attempts
    FROM openerp.supplier_extraction_attempts WHERE book_id=v_book AND occurrence_id=p_id;
  RETURN jsonb_build_object('occurrence',v_source,'channel',v_entry.channel,
    'messageIdentity',v_entry.message_identity,'draftId',v_entry.draft_id,'attempts',v_attempts);
END $$;

CREATE FUNCTION openerp.register_supplier_inbox(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_occ text; v_channel text; v_message text; v_result jsonb;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'register_supplier_inbox',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  IF v_book.authority<>'native' THEN PERFORM openerp.fail('Forbidden','Inbox changes require the native book writer.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['occurrenceId','channel','messageIdentity']);
  v_occ:=openerp.commerce_text(p_input,'occurrenceId',128);
  v_channel:=p_input->>'channel'; v_message:=p_input->>'messageIdentity';
  IF v_channel NOT IN ('upload','email') OR
    (v_channel='email' AND (v_message IS NULL OR length(v_message) NOT BETWEEN 1 AND 200)) OR
    (v_channel='upload' AND v_message IS NOT NULL) THEN
    PERFORM openerp.fail('InvalidJournal','Select an upload or a bounded email attachment identity.'); END IF;
  PERFORM 1 FROM openerp.intake_occurrences WHERE book_id=v_book.id AND id=v_occ;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Retain the original in this book before inbox registration.'); END IF;
  IF v_message IS NOT NULL AND EXISTS(SELECT FROM openerp.supplier_inbox
      WHERE book_id=v_book.id AND channel=v_channel AND message_identity=v_message AND occurrence_id<>v_occ) THEN
    PERFORM openerp.fail('IdempotencyConflict','This email attachment identity belongs to another original.'); END IF;
  INSERT INTO openerp.supplier_inbox(book_id,occurrence_id,channel,message_identity)
    VALUES(v_book.id,v_occ,v_channel,v_message) ON CONFLICT(book_id,occurrence_id) DO NOTHING;
  IF NOT EXISTS(SELECT FROM openerp.supplier_inbox WHERE book_id=v_book.id AND occurrence_id=v_occ
    AND channel=v_channel AND message_identity IS NOT DISTINCT FROM v_message) THEN
    PERFORM openerp.fail('IdempotencyConflict','The original has another inbox identity.'); END IF;
  v_result:=openerp.supplier_inbox_view(p_token,p_scope,v_occ);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'register_supplier_inbox',p_input,v_result);
END $$;

CREATE FUNCTION openerp.record_supplier_extraction(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_count integer; v_body jsonb; v_result jsonb;
  v_payload jsonb:=jsonb_build_object('occurrenceId',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'record_supplier_extraction',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  IF v_book.authority<>'native' THEN PERFORM openerp.fail('Forbidden','Extraction changes require the native book writer.'); END IF;
  IF octet_length(p_input::text)>32768 THEN PERFORM openerp.fail('InvalidJournal','Extraction exceeds 32 KiB.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['parserVersion','status','suggestions','diagnostics']);
  PERFORM openerp.commerce_text(p_input,'parserVersion',128);
  IF p_input->>'status' NOT IN ('failed','suggested') OR
    jsonb_typeof(p_input->'suggestions')<>'array' OR jsonb_array_length(p_input->'suggestions')>50 OR
    jsonb_typeof(p_input->'diagnostics')<>'array' OR jsonb_array_length(p_input->'diagnostics')>50 THEN
    PERFORM openerp.fail('InvalidJournal','Supply a bounded extraction result and diagnostics.'); END IF;
  PERFORM 1 FROM openerp.supplier_inbox WHERE book_id=v_book.id AND occurrence_id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Register the retained original before extraction.'); END IF;
  SELECT count(*) INTO v_count FROM openerp.supplier_extraction_attempts WHERE book_id=v_book.id AND occurrence_id=p_id;
  IF v_count>=50 THEN PERFORM openerp.fail('InvalidJournal','Extraction history is full.'); END IF;
  v_body:=p_input||jsonb_build_object('id',openerp.new_id('supplier_extraction'),'occurrenceId',p_id,
    'ordinal',v_count+1,'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.supplier_extraction_attempts VALUES(v_book.id,v_body->>'id',p_id,v_count+1,v_body);
  v_result:=openerp.supplier_inbox_view(p_token,p_scope,p_id);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'record_supplier_extraction',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.review_supplier_inbox(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_entry openerp.supplier_inbox; v_draft jsonb; v_result jsonb;
  v_payload jsonb:=jsonb_build_object('occurrenceId',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'review_supplier_inbox',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  SELECT * INTO v_entry FROM openerp.supplier_inbox WHERE book_id=v_book.id AND occurrence_id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Supplier inbox original not found.'); END IF;
  IF v_entry.draft_id IS NOT NULL THEN PERFORM openerp.fail('IdempotencyConflict','This original already has a reviewed draft. Open it instead.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['draft','reviewReason']);
  PERFORM openerp.commerce_text(p_input,'reviewReason',2000);
  -- The reviewed content must cite this original through the existing evidence validation.
  PERFORM 1 FROM openerp.evidence e WHERE e.book_id=v_book.id
    AND e.id=p_input->'draft'->'content'->>'sourceEvidenceId'
    AND openerp.purchase_source_reference(e.content)->>'occurrenceId'=p_id
    AND openerp.purchase_source_reference(e.content)->>'sha256'=
      (SELECT o.sha256 FROM openerp.intake_occurrences o WHERE o.book_id=v_book.id AND o.id=p_id);
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Reviewed draft evidence must refer to this original.'); END IF;
  v_draft:=openerp.create_supplier_invoice_draft(p_token,p_scope,'ap_'||substr(encode(sha256((v_book.id||':'||p_id)::bytea),'hex'),1,60),p_input->'draft');
  UPDATE openerp.supplier_inbox SET draft_id=v_draft->>'id' WHERE book_id=v_book.id AND occurrence_id=p_id;
  v_result:=jsonb_build_object('inbox',openerp.supplier_inbox_view(p_token,p_scope,p_id),'draft',v_draft);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'review_supplier_inbox',v_payload,v_result);
END $$;
REVOKE ALL ON openerp.supplier_inbox,openerp.supplier_extraction_attempts FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.supplier_inbox_view(text,jsonb,text),openerp.register_supplier_inbox(text,jsonb,text,jsonb),
  openerp.record_supplier_extraction(text,jsonb,text,text,jsonb),openerp.review_supplier_inbox(text,jsonb,text,text,jsonb)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.supplier_inbox_view(text,jsonb,text),openerp.register_supplier_inbox(text,jsonb,text,jsonb),
  openerp.record_supplier_extraction(text,jsonb,text,text,jsonb),openerp.review_supplier_inbox(text,jsonb,text,text,jsonb)
  TO openerp_runtime;
