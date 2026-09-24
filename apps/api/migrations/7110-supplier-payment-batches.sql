-- Offline synthetic ISO 20022 preparation. Exporting bytes is not bank acceptance or payment.
CREATE TABLE openerp.supplier_payment_batch_previews (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  body jsonb NOT NULL CHECK (octet_length(body::text)<=131072),
  PRIMARY KEY(book_id,id), CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.supplier_payment_batch_exports (
  book_id text NOT NULL, id text NOT NULL, preview_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,preview_id),
  FOREIGN KEY(book_id,preview_id) REFERENCES openerp.supplier_payment_batch_previews,
  CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.supplier_payment_batch_items (
  book_id text NOT NULL, export_id text NOT NULL, invoice_id text NOT NULL,
  PRIMARY KEY(book_id,export_id,invoice_id), UNIQUE(book_id,invoice_id),
  FOREIGN KEY(book_id,export_id) REFERENCES openerp.supplier_payment_batch_exports,
  FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices
);
CREATE TRIGGER supplier_payment_preview_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_payment_batch_previews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payment_export_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_payment_batch_exports
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payment_item_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_payment_batch_items
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.supplier_payment_iban(p_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_reordered text; v_chr text; v_mod integer:=0; v_n integer;
BEGIN
  IF p_value IS NULL OR p_value !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply an uppercase unspaced IBAN of 15 to 34 characters.'); END IF;
  v_reordered:=substring(p_value FROM 5)||substring(p_value FROM 1 FOR 4);
  FOR v_n IN 1..length(v_reordered) LOOP
    v_chr:=substring(v_reordered FROM v_n FOR 1);
    IF v_chr BETWEEN 'A' AND 'Z' THEN
      v_mod:=(v_mod*100+ascii(v_chr)-55)%97;
    ELSE
      v_mod:=(v_mod*10+ascii(v_chr)-48)%97;
    END IF;
  END LOOP;
  IF v_mod<>1 THEN PERFORM openerp.fail('InvalidJournal','IBAN check digits do not match.'); END IF;
  RETURN p_value;
END $$;
CREATE FUNCTION openerp.supplier_payment_xml(p_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_value ~ '[[:cntrl:]]' THEN
    PERFORM openerp.fail('InvalidJournal','Payment XML text contains an unsupported control character.'); END IF;
  RETURN replace(replace(replace(replace(replace(p_value,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),chr(39),'&apos;');
END $$;
CREATE FUNCTION openerp.supplier_payment_bic(p_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_value IS NULL OR p_value !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply an uppercase 8- or 11-character BIC.'); END IF;
  RETURN p_value;
END $$;

CREATE FUNCTION openerp.supplier_payment_current(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_item jsonb; v_invoice openerp.commerce_invoices; v_body jsonb; v_evidence jsonb;
  v_seen text[]:='{}'; v_total numeric:=0; v_items jsonb:='[]'; v_amount numeric; v_name text;
BEGIN
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','executionDate','debtorName','debtorIban','debtorBic','items','reason','acknowledgeOfflineOnly']);
  IF p_input->>'profile' IS DISTINCT FROM 'synthetic-offline-pain001-v1'
    OR p_input->'acknowledgeOfflineOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Only an explicitly acknowledged offline synthetic payment file is supported. Bank upload compatibility is not established.'); END IF;
  PERFORM openerp.commerce_require_profile(p_book);
  IF NOT EXISTS(SELECT FROM openerp.books b WHERE b.id=p_book AND b.currency='SEK' AND b.currency_scale=2) THEN
    PERFORM openerp.fail('UnsupportedProfile','This offline pain.001 profile requires exact SEK minor units at scale 2.'); END IF;
  IF openerp.bank_date(openerp.commerce_text(p_input,'executionDate',10))
    < (clock_timestamp() AT TIME ZONE 'UTC')::date THEN
    PERFORM openerp.fail('StaleDependency','The requested payment date has passed. Prepare a new preview.'); END IF;
  PERFORM openerp.supplier_payment_xml(openerp.commerce_text(p_input,'debtorName',70));
  PERFORM openerp.supplier_payment_iban(openerp.commerce_text(p_input,'debtorIban',34));
  PERFORM openerp.supplier_payment_bic(openerp.commerce_text(p_input,'debtorBic',11));
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  IF jsonb_typeof(p_input->'items') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Select a complete payment instruction array.'); END IF;
  IF jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 20 THEN
    PERFORM openerp.fail('InvalidJournal','Select one to twenty complete supplier payment instructions.'); END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
    PERFORM openerp.commerce_exact_object(v_item,ARRAY['invoiceId','expectedOutstandingMinor','expectedAllocationVersion',
      'amountMinor','creditorName','creditorIban','creditorBic','payeeEvidenceId']);
    IF openerp.commerce_text(v_item,'invoiceId',128)=ANY(v_seen) THEN
      PERFORM openerp.fail('InvalidJournal','A supplier invoice may occur only once in a payment batch.'); END IF;
    v_seen:=array_append(v_seen,v_item->>'invoiceId');
    v_amount:=openerp.commerce_positive_minor(v_item,'amountMinor');
    IF v_amount>=1e36::numeric OR v_total+v_amount>=1e36::numeric THEN
      PERFORM openerp.fail('InvalidJournal','The batch exceeds exact minor-unit capacity.'); END IF;
    v_total:=v_total+v_amount;
    v_name:=openerp.commerce_text(v_item,'creditorName',70);
    PERFORM openerp.supplier_payment_xml(v_name);
    PERFORM openerp.supplier_payment_iban(openerp.commerce_text(v_item,'creditorIban',34));
    PERFORM openerp.supplier_payment_bic(openerp.commerce_text(v_item,'creditorBic',11));
    v_evidence:=openerp.commerce_evidence(p_book,openerp.commerce_text(v_item,'payeeEvidenceId',128));
    SELECT * INTO v_invoice FROM openerp.commerce_invoices i
      WHERE i.book_id=p_book AND i.id=v_item->>'invoiceId' AND i.direction='supplier';
    IF NOT FOUND OR NOT EXISTS(SELECT FROM openerp.supplier_acceptances a
      WHERE a.book_id=p_book AND a.register_invoice_id=v_invoice.id) THEN
      PERFORM openerp.fail('NotFound','Select an accepted synthetic supplier invoice in this book.'); END IF;
    IF EXISTS(SELECT FROM openerp.supplier_payment_batch_items x
      WHERE x.book_id=p_book AND x.invoice_id=v_invoice.id) THEN
      PERFORM openerp.fail('StaleDependency','This invoice already belongs to an exported file; resolve its outcome before another export.'); END IF;
    PERFORM openerp.supplier_payment_xml(v_invoice.document_number);
    v_body:=openerp.commerce_invoice_body(p_book,v_invoice.id);
    IF v_body->'blockers'<>'[]'::jsonb OR v_body->>'outstandingMinor' IS NULL
      OR v_item->>'expectedOutstandingMinor' IS DISTINCT FROM v_body->>'outstandingMinor'
      OR v_item->>'expectedAllocationVersion' IS DISTINCT FROM v_body->>'allocationVersion'
      OR v_amount>(v_body->>'outstandingMinor')::numeric THEN
      PERFORM openerp.fail('StaleDependency','The posted supplier payable, allocations or selected outstanding amount changed. Reopen the invoice.'); END IF;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('invoiceId',v_invoice.id,'supplierDocumentNumber',v_invoice.document_number,
      'amountMinor',v_amount::text,'outstandingMinor',v_body->>'outstandingMinor',
      'allocationVersion',v_body->>'allocationVersion','creditorName',v_name,'creditorIban',v_item->>'creditorIban',
      'creditorBic',v_item->>'creditorBic','payeeEvidence',v_evidence));
  END LOOP;
  RETURN jsonb_build_object('items',v_items,'totalMinor',v_total::text,'count',jsonb_array_length(v_items));
END $$;

CREATE FUNCTION openerp.supplier_payment_amount(p_minor text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
  SELECT (p_minor::numeric/100)::numeric(38,2)::text
$$;
CREATE FUNCTION openerp.supplier_payment_document(p_preview jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_item jsonb; v_xml text; v_input jsonb:=p_preview->'input'; v_selection jsonb:=p_preview->'selection';
  v_name text; v_number text;
BEGIN
  v_xml:='<?xml version="1.0" encoding="UTF-8"?>'||
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn><GrpHdr><MsgId>'||p_preview->>'id'||
    '</MsgId><CreDtTm>'||p_preview->>'createdAt'||'</CreDtTm><NbOfTxs>'||v_selection->>'count'||
    '</NbOfTxs><CtrlSum>'||openerp.supplier_payment_amount(v_selection->>'totalMinor')||'</CtrlSum><InitgPty><Nm>'||
    openerp.supplier_payment_xml(v_input->>'debtorName')||'</Nm></InitgPty></GrpHdr><PmtInf><PmtInfId>'||p_preview->>'id'||
    '</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>'||v_selection->>'count'||'</NbOfTxs><CtrlSum>'||
    openerp.supplier_payment_amount(v_selection->>'totalMinor')||'</CtrlSum>'||
    '<ReqdExctnDt>'||v_input->>'executionDate'||'</ReqdExctnDt><Dbtr><Nm>'||
    openerp.supplier_payment_xml(v_input->>'debtorName')||'</Nm></Dbtr><DbtrAcct><Id><IBAN>'||v_input->>'debtorIban'||
    '</IBAN></Id></DbtrAcct><DbtrAgt><FinInstnId><BIC>'||v_input->>'debtorBic'||
    '</BIC></FinInstnId></DbtrAgt><ChrgBr>SLEV</ChrgBr>';
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_selection->'items') LOOP
    v_name:=openerp.supplier_payment_xml(v_item->>'creditorName');
    v_number:=openerp.supplier_payment_xml(v_item->>'supplierDocumentNumber');
    v_xml:=v_xml||'<CdtTrfTxInf><PmtId><EndToEndId>'||right(v_item->>'invoiceId',32)||'</EndToEndId></PmtId><Amt><InstdAmt Ccy="SEK">'||
      openerp.supplier_payment_amount(v_item->>'amountMinor')||'</InstdAmt></Amt><CdtrAgt><FinInstnId><BIC>'||
      v_item->>'creditorBic'||'</BIC></FinInstnId></CdtrAgt><Cdtr><Nm>'||v_name||'</Nm></Cdtr>'||
      '<CdtrAcct><Id><IBAN>'||v_item->>'creditorIban'||'</IBAN></Id></CdtrAcct><RmtInf><Ustrd>'||
      v_number||'</Ustrd></RmtInf></CdtTrfTxInf>';
  END LOOP;
  RETURN v_xml||'</PmtInf></CstmrCdtTrfInitn></Document>';
END $$;

CREATE FUNCTION openerp.prepare_supplier_payment_batch(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_selection jsonb; v_result jsonb;
  v_id text:=openerp.new_id('pb'); v_count integer;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'prepare_supplier_payment_batch',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  SELECT count(*) INTO v_count FROM (SELECT 1 FROM openerp.supplier_payment_batch_previews r
    WHERE r.book_id=p_scope->>'bookId' LIMIT 201) bounded;
  IF v_count>=200 THEN PERFORM openerp.fail('InvalidJournal','The bounded payment preview history is full.'); END IF;
  v_selection:=openerp.supplier_payment_current(p_scope->>'bookId',p_input);
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'input',p_input,'selection',v_selection,'format','pain.001.001.03',
    'status','preview','bankCompatible',false,'bankAccepted',false,'paid',false)
    ||openerp.commerce_record_metadata(p_key,'prepare_supplier_payment_batch',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>131072 THEN PERFORM openerp.fail('InvalidJournal','The bounded payment preview is too large.'); END IF;
  INSERT INTO openerp.supplier_payment_batch_previews VALUES(p_scope->>'bookId',v_id,v_actor,v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'prepare_supplier_payment_batch',p_input,v_result);
END $$;
CREATE FUNCTION openerp.export_supplier_payment_batch(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_preview openerp.supplier_payment_batch_previews; v_result jsonb;
  v_selection jsonb; v_bytes bytea; v_xml text; v_item jsonb;
  v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input); v_id text:=openerp.new_id('payment_export');
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'export_supplier_payment_batch',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['digest','acknowledgeOfflineOnly']);
  IF p_input->'acknowledgeOfflineOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','A bank-compatible or accepted payment is not implemented.'); END IF;
  SELECT * INTO v_preview FROM openerp.supplier_payment_batch_previews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The payment preview was not found in this book.'); END IF;
  IF v_preview.actor_id IS DISTINCT FROM v_actor
    OR openerp.commerce_text(p_input,'digest',71) IS DISTINCT FROM v_preview.body->>'digest' THEN
    PERFORM openerp.fail('ApprovalRequired','The same current operator must export the exact reviewed preview digest.'); END IF;
  IF EXISTS(SELECT FROM openerp.supplier_payment_batch_exports e WHERE e.book_id=p_scope->>'bookId' AND e.preview_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','The preview already has an immutable exported artifact. Read it instead.'); END IF;
  v_selection:=openerp.supplier_payment_current(p_scope->>'bookId',v_preview.body->'input');
  IF v_selection IS DISTINCT FROM v_preview.body->'selection' THEN
    PERFORM openerp.fail('StaleDependency','Payee evidence or supplier balances changed. Prepare a new preview.'); END IF;
  v_xml:=openerp.supplier_payment_document(v_preview.body);
  v_bytes:=convert_to(v_xml,'UTF8');
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'previewId',p_id,'previewDigest',v_preview.body->>'digest',
    'format','pain.001.001.03','mediaType','application/xml','sha256',encode(sha256(v_bytes),'hex'),
    'base64',encode(v_bytes,'base64'),'status','exported','bankCompatible',false,'bankAccepted',false,'paid',false,
    'selection',v_selection)||openerp.commerce_record_metadata(p_key,'export_supplier_payment_batch',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.supplier_payment_batch_exports VALUES(p_scope->>'bookId',v_id,p_id,v_result);
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_selection->'items') LOOP
    INSERT INTO openerp.supplier_payment_batch_items VALUES(p_scope->>'bookId',v_id,v_item->>'invoiceId');
  END LOOP;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'export_supplier_payment_batch',v_payload,v_result);
END $$;
CREATE FUNCTION openerp.get_supplier_payment_batch(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_preview jsonb; v_export jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT r.body INTO v_preview FROM openerp.supplier_payment_batch_previews r
    WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The payment preview was not found in this book.'); END IF;
  SELECT e.body INTO v_export FROM openerp.supplier_payment_batch_exports e
    WHERE e.book_id=p_scope->>'bookId' AND e.preview_id=p_id;
  RETURN jsonb_build_object('preview',v_preview,'export',v_export);
END $$;
REVOKE ALL ON openerp.supplier_payment_batch_previews,openerp.supplier_payment_batch_exports,
  openerp.supplier_payment_batch_items FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.supplier_payment_iban(text),openerp.supplier_payment_bic(text),openerp.supplier_payment_xml(text),
  openerp.supplier_payment_current(text,jsonb),openerp.supplier_payment_amount(text),openerp.supplier_payment_document(jsonb),
  openerp.prepare_supplier_payment_batch(text,jsonb,text,jsonb),openerp.export_supplier_payment_batch(text,jsonb,text,text,jsonb),
  openerp.get_supplier_payment_batch(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_supplier_payment_batch(text,jsonb,text,jsonb),
  openerp.export_supplier_payment_batch(text,jsonb,text,text,jsonb),openerp.get_supplier_payment_batch(text,jsonb,text)
  TO openerp_runtime;
