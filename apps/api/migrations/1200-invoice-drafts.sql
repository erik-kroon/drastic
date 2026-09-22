-- Commercial drafts only. No issue numbering, posting, allocation, profile or delivery effects.
CREATE TABLE openerp.invoice_drafts (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  draft_key text COLLATE "C" NOT NULL, current_revision bigint NOT NULL CHECK (current_revision BETWEEN 1 AND 50),
  PRIMARY KEY (book_id,id), UNIQUE (book_id,draft_key)
);
CREATE TABLE openerp.invoice_draft_revisions (
  book_id text NOT NULL, draft_id text NOT NULL, revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 50),
  body jsonb NOT NULL CHECK (octet_length(body::text)<=131072),
  PRIMARY KEY (book_id,draft_id,revision),
  FOREIGN KEY (book_id,draft_id) REFERENCES openerp.invoice_drafts,
  CHECK (body->>'id'=draft_id AND body->>'revision'=revision::text),
  CHECK (body->>'digest'=openerp.digest(body-'digest'))
);
ALTER TABLE openerp.invoice_drafts ADD FOREIGN KEY (book_id,id,current_revision)
  REFERENCES openerp.invoice_draft_revisions(book_id,draft_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER freeze_invoice_draft_identity BEFORE UPDATE OR DELETE ON openerp.invoice_drafts
  FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER immutable_invoice_draft_revision BEFORE UPDATE OR DELETE ON openerp.invoice_draft_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.invoice_draft_optional_text(p_input jsonb,p_field text,p_max integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_input->p_field='null'::jsonb THEN RETURN NULL; END IF;
  RETURN openerp.commerce_text(p_input,p_field,p_max);
END $$;
CREATE FUNCTION openerp.invoice_draft_minor(p_input jsonb,p_field text,p_nullable boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_nullable AND p_input->p_field='null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_input->p_field) IS DISTINCT FROM 'string' OR coalesce(p_input->>p_field,'') !~ '^(0|[1-9][0-9]{0,37})$' THEN
    PERFORM openerp.fail('InvalidJournal','Draft amounts must be exact nonnegative integer minor-unit strings, at most 38 digits. Use null only for an explicitly unknown amount.');
  END IF;
  RETURN (p_input->>p_field)::numeric;
END $$;
CREATE FUNCTION openerp.invoice_draft_identity(p_book text,p_identity jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_country text;
BEGIN
  PERFORM openerp.commerce_exact_object(p_identity,ARRAY['legalName','registrationId','taxId','address','countryCode','evidenceId']);
  PERFORM openerp.commerce_text(p_identity,'legalName',200);
  PERFORM openerp.invoice_draft_optional_text(p_identity,'registrationId',200);
  PERFORM openerp.invoice_draft_optional_text(p_identity,'taxId',200);
  PERFORM openerp.invoice_draft_optional_text(p_identity,'address',1000);
  v_country:=openerp.invoice_draft_optional_text(p_identity,'countryCode',2);
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use an explicit two-letter country code or null; country applicability is not verified.');
  END IF;
  RETURN openerp.commerce_evidence(p_book,openerp.commerce_text(p_identity,'evidenceId',128));
END $$;

CREATE FUNCTION openerp.invoice_draft_calculate(p_book text,p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_book openerp.books; v_party openerp.commerce_counterparties; v_counterparty jsonb;
  v_seller jsonb; v_customer jsonb; v_line jsonb; v_id text; v_seen text[]:='{}'; v_price numeric;
  v_quantity numeric; v_product numeric; v_calculated numeric; v_base numeric; v_discount numeric; v_charge numeric;
  v_net numeric; v_tax numeric; v_gross numeric; v_source numeric; v_tax_evidence jsonb; v_line_match boolean;
  v_base_total numeric:=0; v_discount_total numeric:=0; v_charge_total numeric:=0; v_net_total numeric:=0;
  v_tax_total numeric:=0; v_gross_total numeric; v_tax_known boolean:=true; v_source_total numeric; v_total_match boolean;
  v_issue date; v_due date; v_field text; v_identity text; v_lines jsonb:='[]';
  v_blockers jsonb:='[{"code":"issuance_not_implemented","lineId":null},{"code":"legal_identity_not_verified","lineId":null},{"code":"tax_profile_not_activated","lineId":null}]';
BEGIN
  PERFORM openerp.commerce_exact_object(p_content,ARRAY['title','counterpartyId','counterpartyRevision','seller','customer',
    'currency','currencyScale','plannedIssueDate','supplyDate','dueDate','paymentTerms','sourceTotalMinor','lines']);
  PERFORM openerp.commerce_text(p_content,'title',200);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
  IF p_content->>'currency' IS DISTINCT FROM v_book.currency OR p_content->'currencyScale' IS DISTINCT FROM to_jsonb(v_book.currency_scale) THEN
    PERFORM openerp.fail('InvalidJournal','This draft slice requires the exact book currency and scale. Currency conversion is not implemented.');
  END IF;
  v_seller:=openerp.invoice_draft_identity(p_book,p_content->'seller');
  v_customer:=openerp.invoice_draft_identity(p_book,p_content->'customer');
  FOREACH v_identity IN ARRAY ARRAY['seller','customer'] LOOP
    IF p_content->v_identity->>'registrationId' IS NULL OR p_content->v_identity->>'address' IS NULL
      OR p_content->v_identity->>'countryCode' IS NULL THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code',v_identity||'_identity_fields_missing','lineId',NULL));
    END IF;
  END LOOP;
  SELECT * INTO v_party FROM openerp.commerce_counterparties c WHERE c.book_id=p_book
    AND c.id=openerp.commerce_text(p_content,'counterpartyId',128);
  IF NOT FOUND OR v_party.role NOT IN ('customer','both') THEN
    PERFORM openerp.fail('InvalidJournal','Choose an existing customer counterpart in this book.');
  END IF;
  IF openerp.commerce_text(p_content,'counterpartyRevision',18) IS DISTINCT FROM v_party.current_revision::text THEN
    PERFORM openerp.fail('StaleDependency','Read and explicitly select the current counterpart revision before saving a draft.');
  END IF;
  SELECT r.body INTO STRICT v_counterparty FROM openerp.commerce_counterparty_revisions r
    WHERE r.book_id=p_book AND r.counterparty_id=v_party.id AND r.revision=v_party.current_revision;
  FOREACH v_field IN ARRAY ARRAY['plannedIssueDate','supplyDate','dueDate'] LOOP
    IF p_content->v_field<>'null'::jsonb THEN
      IF jsonb_typeof(p_content->v_field) IS DISTINCT FROM 'string' THEN
        PERFORM openerp.fail('InvalidJournal','Draft dates must be calendar date strings or null.');
      END IF;
      PERFORM openerp.bank_date(p_content->>v_field);
    END IF;
  END LOOP;
  v_issue:=(p_content->>'plannedIssueDate')::date; v_due:=(p_content->>'dueDate')::date;
  IF v_issue IS NOT NULL AND v_due IS NOT NULL AND v_due<v_issue THEN
    PERFORM openerp.fail('InvalidJournal','The proposed due date cannot precede the planned issue date.');
  END IF;
  PERFORM openerp.invoice_draft_optional_text(p_content,'paymentTerms',1000);
  IF v_issue IS NULL OR v_due IS NULL OR p_content->>'supplyDate' IS NULL OR p_content->>'paymentTerms' IS NULL THEN
    v_blockers:=v_blockers||'[{"code":"dates_or_terms_missing","lineId":null}]'::jsonb;
  END IF;
  v_source_total:=openerp.invoice_draft_minor(p_content,'sourceTotalMinor',true);
  IF jsonb_typeof(p_content->'lines') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the complete draft line array.');
  END IF;
  IF jsonb_array_length(p_content->'lines') NOT BETWEEN 1 AND 50 THEN
    PERFORM openerp.fail('InvalidJournal','A commercial draft contains 1 to 50 lines. No truncation is supported.');
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_content->'lines') LOOP
    PERFORM openerp.commerce_exact_object(v_line,ARRAY['id','description','quantity','unitPriceMinor','baseMinor','discountMinor',
      'chargeMinor','taxMinor','taxDescription','taxEvidenceId','sourceGrossMinor']);
    v_id:=openerp.commerce_text(v_line,'id',128);
    IF v_id !~ '^[a-z][a-z0-9_-]{2,127}$' OR v_id=ANY(v_seen) THEN
      PERFORM openerp.fail('InvalidJournal','Every draft line needs a distinct stable identifier.');
    END IF;
    v_seen:=array_append(v_seen,v_id);
    PERFORM openerp.commerce_text(v_line,'description',200);
    IF jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'string' OR coalesce(v_line->>'quantity','') !~
      '^([1-9][0-9]{0,11}|(0|[1-9][0-9]{0,11})\.[0-9]{0,5}[1-9])$' THEN
      PERFORM openerp.fail('InvalidJournal','Use a positive canonical decimal quantity: at most 12 integer and 6 fractional digits, without trailing fractional zeros.');
    END IF;
    v_quantity:=(v_line->>'quantity')::numeric;
    v_price:=openerp.invoice_draft_minor(v_line,'unitPriceMinor',true);
    v_base:=openerp.invoice_draft_minor(v_line,'baseMinor');
    v_discount:=openerp.invoice_draft_minor(v_line,'discountMinor');
    v_charge:=openerp.invoice_draft_minor(v_line,'chargeMinor');
    v_tax:=openerp.invoice_draft_minor(v_line,'taxMinor',true);
    v_source:=openerp.invoice_draft_minor(v_line,'sourceGrossMinor',true);
    PERFORM openerp.invoice_draft_optional_text(v_line,'taxDescription',200);
    v_tax_evidence:=NULL;
    IF v_line->'taxEvidenceId'<>'null'::jsonb THEN
      v_tax_evidence:=openerp.commerce_evidence(p_book,openerp.commerce_text(v_line,'taxEvidenceId',128));
    END IF;
    IF v_tax IS NULL OR v_tax_evidence IS NULL OR v_line->>'taxDescription' IS NULL THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','tax_inputs_unreviewed','lineId',v_id));
    END IF;
    IF v_discount>v_base THEN PERFORM openerp.fail('InvalidJournal','A line discount cannot exceed its explicit base. Credit notes are outside this draft slice.'); END IF;
    v_net:=v_base-v_discount+v_charge; v_gross:=v_net+v_tax;
    IF v_net>=1e38::numeric OR v_gross>=1e38::numeric THEN
      PERFORM openerp.fail('InvalidJournal','Each calculated draft line amount must remain below 10^38 minor units.');
    END IF;
    v_product:=v_quantity*v_price; v_calculated:=NULL;
    IF v_product IS NULL OR v_product<>trunc(v_product) THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','quantity_price_not_exact','lineId',v_id));
    ELSE
      v_calculated:=trunc(v_product);
      IF v_calculated<>v_base THEN
        v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','line_base_mismatch','lineId',v_id));
      END IF;
    END IF;
    v_line_match:=CASE WHEN v_gross IS NULL OR v_source IS NULL THEN NULL ELSE v_gross=v_source END;
    IF v_line_match=false THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','line_total_mismatch','lineId',v_id));
    END IF;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('id',v_id,'calculatedBaseMinor',v_calculated::text,
      'netMinor',v_net::text,'grossMinor',v_gross::text,'sourceGrossMatches',v_line_match,'taxEvidence',v_tax_evidence));
    v_base_total:=v_base_total+v_base; v_discount_total:=v_discount_total+v_discount;
    v_charge_total:=v_charge_total+v_charge; v_net_total:=v_net_total+v_net;
    IF v_tax IS NULL THEN v_tax_known:=false; ELSE v_tax_total:=v_tax_total+v_tax; END IF;
  END LOOP;
  IF NOT v_tax_known THEN v_tax_total:=NULL; END IF;
  v_gross_total:=v_net_total+v_tax_total;
  v_total_match:=CASE WHEN v_gross_total IS NULL OR v_source_total IS NULL THEN NULL ELSE v_gross_total=v_source_total END;
  IF v_total_match=false THEN v_blockers:=v_blockers||'[{"code":"document_total_mismatch","lineId":null}]'::jsonb; END IF;
  RETURN jsonb_build_object('counterparty',v_counterparty,'sellerEvidence',v_seller,'customerEvidence',v_customer,
    'totals',jsonb_build_object('baseMinor',v_base_total::text,'discountMinor',v_discount_total::text,'chargeMinor',v_charge_total::text,
      'netMinor',v_net_total::text,'taxMinor',v_tax_total::text,'grossMinor',v_gross_total::text,'sourceTotalMatches',v_total_match),
    'calculatedLines',v_lines,'blockers',v_blockers);
END $$;

CREATE FUNCTION openerp.create_invoice_draft(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_result jsonb; v_key text;
  v_id text:=openerp.new_id('invoice_draft'); v_count integer;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'create_invoice_draft',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  IF v_book.authority<>'native' THEN PERFORM openerp.fail('Forbidden','Commercial draft writes require the native book writer.'); END IF;
  IF octet_length(p_input::text)>65536 THEN PERFORM openerp.fail('InvalidJournal','Draft input exceeds 64 KiB. Nothing was saved.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['draftKey','content']);
  v_key:=openerp.commerce_text(p_input,'draftKey',128);
  IF v_key !~ '^[a-z][a-z0-9_-]{2,127}$' THEN PERFORM openerp.fail('InvalidJournal','Supply a stable draft key, not an issued invoice number.'); END IF;
  IF EXISTS(SELECT FROM openerp.invoice_drafts d WHERE d.book_id=v_book.id AND d.draft_key=v_key) THEN
    PERFORM openerp.fail('IdempotencyConflict','This draft key already exists. Open the retained draft or retry its original command.');
  END IF;
  SELECT count(*) INTO v_count FROM (SELECT 1 FROM openerp.invoice_drafts d WHERE d.book_id=v_book.id LIMIT 201) bounded;
  IF v_count>=200 THEN PERFORM openerp.fail('InvalidJournal','This bounded slice supports 200 drafts per book. No draft was discarded or saved.'); END IF;
  v_result:=openerp.invoice_draft_calculate(v_book.id,p_input->'content')||jsonb_build_object(
    'id',v_id,'scope',jsonb_build_object('entityId',v_book.entity_id,'bookId',v_book.id),'draftKey',v_key,'revision','1',
    'status','draft','issued',false,'recognized',false,'delivered',false,'calculationBasis','explicit_line_amounts_v1',
    'content',p_input->'content','reason','Initial commercial draft')||openerp.commerce_record_metadata(p_key,'create_invoice_draft',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>131072 THEN PERFORM openerp.fail('InvalidJournal','The retained draft exceeds 128 KiB. Nothing was saved.'); END IF;
  INSERT INTO openerp.invoice_drafts VALUES(v_book.id,v_id,v_key,1);
  INSERT INTO openerp.invoice_draft_revisions VALUES(v_book.id,v_id,1,v_result);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'create_invoice_draft',p_input,v_result);
END $$;

CREATE FUNCTION openerp.revise_invoice_draft(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_draft openerp.invoice_drafts; v_head jsonb; v_previous jsonb; v_result jsonb;
  v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'revise_invoice_draft',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  IF v_book.authority<>'native' THEN PERFORM openerp.fail('Forbidden','Commercial draft writes require the native book writer.'); END IF;
  IF octet_length(p_input::text)>65536 THEN PERFORM openerp.fail('InvalidJournal','Draft input exceeds 64 KiB. Nothing was saved.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedRevision','expectedDigest','reason','content']);
  SELECT * INTO v_draft FROM openerp.invoice_drafts d WHERE d.book_id=v_book.id AND d.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The commercial draft was not found in this book.'); END IF;
  SELECT r.body INTO STRICT v_head FROM openerp.invoice_draft_revisions r
    WHERE r.book_id=v_book.id AND r.draft_id=p_id AND r.revision=v_draft.current_revision;
  IF openerp.commerce_text(p_input,'expectedRevision',18) IS DISTINCT FROM v_draft.current_revision::text
    OR openerp.commerce_text(p_input,'expectedDigest',71) IS DISTINCT FROM v_head->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','The commercial draft changed. Reopen its current revision before editing; do not replace an uncertain retry key.');
  END IF;
  IF v_draft.current_revision>=50 THEN PERFORM openerp.fail('InvalidJournal','This bounded draft already has 50 retained revisions. Nothing was overwritten.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_result:=openerp.invoice_draft_calculate(v_book.id,p_input->'content')||jsonb_build_object(
    'id',p_id,'scope',jsonb_build_object('entityId',v_book.entity_id,'bookId',v_book.id),'draftKey',v_draft.draft_key,
    'revision',(v_draft.current_revision+1)::text,'status','draft','issued',false,'recognized',false,'delivered',false,
    'calculationBasis','explicit_line_amounts_v1','content',p_input->'content','reason',p_input->>'reason')
    ||openerp.commerce_record_metadata(p_key,'revise_invoice_draft',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>131072 THEN PERFORM openerp.fail('InvalidJournal','The retained draft exceeds 128 KiB. Nothing was saved.'); END IF;
  INSERT INTO openerp.invoice_draft_revisions VALUES(v_book.id,p_id,v_draft.current_revision+1,v_result);
  UPDATE openerp.invoice_drafts d SET current_revision=current_revision+1 WHERE d.book_id=v_book.id AND d.id=p_id;
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'revise_invoice_draft',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.invoice_draft_summary(p_body jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
  SELECT jsonb_build_object('id',p_body->>'id','draftKey',p_body->>'draftKey','revision',p_body->>'revision',
    'title',p_body->'content'->>'title','customerName',p_body->'content'->'customer'->>'legalName',
    'currency',p_body->'content'->>'currency','currencyScale',p_body->'content'->'currencyScale',
    'grossMinor',p_body->'totals'->'grossMinor','blockerCount',jsonb_array_length(p_body->'blockers'),
    'createdAt',p_body->>'createdAt','digest',p_body->>'digest')
$$;
CREATE FUNCTION openerp.get_invoice_draft(p_token text,p_scope jsonb,p_id text,p_revision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_head bigint; v_digest text; v_record jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  IF coalesce(p_revision,'')<>'' AND p_revision !~ '^[1-9][0-9]{0,17}$' THEN PERFORM openerp.fail('InvalidJournal','Select a positive draft revision.'); END IF;
  SELECT d.current_revision,r.body->>'digest' INTO v_head,v_digest FROM openerp.invoice_drafts d
    JOIN openerp.invoice_draft_revisions r ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision
    WHERE d.book_id=p_scope->>'bookId' AND d.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The commercial draft was not found in this book.'); END IF;
  SELECT r.body INTO v_record FROM openerp.invoice_draft_revisions r WHERE r.book_id=p_scope->>'bookId'
    AND r.draft_id=p_id AND r.revision=coalesce(nullif(p_revision,'')::bigint,v_head);
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained commercial draft revision was not found.'); END IF;
  RETURN jsonb_build_object('record',v_record,'currentRevision',v_head::text,'currentDigest',v_digest);
END $$;
CREATE FUNCTION openerp.list_invoice_drafts(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_count bigint; v_items jsonb; v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT count(*) INTO v_count FROM (SELECT 1 FROM openerp.invoice_drafts d WHERE d.book_id=p_scope->>'bookId' LIMIT 201) bounded;
  IF v_count>200 THEN PERFORM openerp.fail('InvalidJournal','The commercial draft inventory exceeds the complete-list bound. No partial list is returned.'); END IF;
  SELECT coalesce(jsonb_agg(openerp.invoice_draft_summary(r.body) ORDER BY d.draft_key COLLATE "C"),'[]') INTO v_items
    FROM openerp.invoice_drafts d JOIN openerp.invoice_draft_revisions r
      ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision WHERE d.book_id=p_scope->>'bookId';
  IF jsonb_array_length(v_items)<>v_count THEN PERFORM openerp.fail('InvalidJournal','A commercial draft head is missing. No partial list is returned.'); END IF;
  v_result:=jsonb_build_object('scope',jsonb_build_object('entityId',p_scope->>'entityId','bookId',p_scope->>'bookId'),
    'complete',true,'count',v_count,'items',v_items,'capturedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  RETURN v_result||jsonb_build_object('digest',openerp.digest(v_result));
END $$;
CREATE FUNCTION openerp.invoice_draft_history(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_head bigint; v_items jsonb; v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT d.current_revision INTO v_head FROM openerp.invoice_drafts d WHERE d.book_id=p_scope->>'bookId' AND d.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The commercial draft was not found in this book.'); END IF;
  SELECT coalesce(jsonb_agg(openerp.invoice_draft_summary(r.body) ORDER BY r.revision),'[]') INTO v_items
    FROM openerp.invoice_draft_revisions r WHERE r.book_id=p_scope->>'bookId' AND r.draft_id=p_id;
  IF jsonb_array_length(v_items)<>v_head OR v_head>50 THEN
    PERFORM openerp.fail('InvalidJournal','Commercial draft history is missing or exceeds its complete-list bound. No partial history is returned.');
  END IF;
  v_result:=jsonb_build_object('scope',jsonb_build_object('entityId',p_scope->>'entityId','bookId',p_scope->>'bookId'),
    'id',p_id,'currentRevision',v_head::text,'complete',true,'count',v_head,'items',v_items,
    'capturedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  RETURN v_result||jsonb_build_object('digest',openerp.digest(v_result));
END $$;

REVOKE ALL ON openerp.invoice_drafts,openerp.invoice_draft_revisions FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.invoice_draft_optional_text(jsonb,text,integer),openerp.invoice_draft_minor(jsonb,text,boolean),
  openerp.invoice_draft_identity(text,jsonb),openerp.invoice_draft_calculate(text,jsonb),openerp.invoice_draft_summary(jsonb),
  openerp.create_invoice_draft(text,jsonb,text,jsonb),openerp.revise_invoice_draft(text,jsonb,text,text,jsonb),
  openerp.get_invoice_draft(text,jsonb,text,text),openerp.list_invoice_drafts(text,jsonb),openerp.invoice_draft_history(text,jsonb,text)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.create_invoice_draft(text,jsonb,text,jsonb),openerp.revise_invoice_draft(text,jsonb,text,text,jsonb),
  openerp.get_invoice_draft(text,jsonb,text,text),openerp.list_invoice_drafts(text,jsonb),openerp.invoice_draft_history(text,jsonb,text)
  TO openerp_runtime;
