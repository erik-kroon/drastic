-- Quotes/orders are commercial intent. Only explicit conversion creates an unissued invoice draft.
CREATE TABLE openerp.sales_documents (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, kind text NOT NULL CHECK(kind IN ('quote','order')),
 source_quote_id text, source_quote_revision bigint, current_revision bigint NOT NULL DEFAULT 1 CHECK(current_revision BETWEEN 1 AND 50),
 PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,source_quote_id) REFERENCES openerp.sales_documents(book_id,id)
);
CREATE TABLE openerp.sales_document_revisions (
 book_id text NOT NULL, document_id text NOT NULL, revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 50),
 body jsonb NOT NULL CHECK(octet_length(body::text)<=131072),
 PRIMARY KEY(book_id,document_id,revision),
 FOREIGN KEY(book_id,document_id) REFERENCES openerp.sales_documents(book_id,id),
 CHECK(body->>'id'=document_id AND body->>'revision'=revision::text AND body->>'digest'=openerp.digest(body-'digest'))
);
ALTER TABLE openerp.sales_documents ADD FOREIGN KEY(book_id,id,current_revision)
 REFERENCES openerp.sales_document_revisions(book_id,document_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER freeze_sales_document_identity BEFORE UPDATE OR DELETE ON openerp.sales_documents
 FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER immutable_sales_document_revision BEFORE UPDATE OR DELETE ON openerp.sales_document_revisions
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TABLE openerp.sales_order_conversions (
 book_id text NOT NULL, order_id text NOT NULL, draft_id text NOT NULL,
 order_revision bigint NOT NULL, portions jsonb NOT NULL,
 PRIMARY KEY(book_id,order_id,draft_id), UNIQUE(book_id,draft_id),
 FOREIGN KEY(book_id,order_id) REFERENCES openerp.sales_documents(book_id,id),
 FOREIGN KEY(book_id,draft_id) REFERENCES openerp.invoice_drafts(book_id,id)
);
CREATE TRIGGER immutable_sales_order_conversion BEFORE UPDATE OR DELETE ON openerp.sales_order_conversions
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.sales_document_command(p_token text,p_scope jsonb,p_key text,p_action text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_doc openerp.sales_documents; v_head jsonb; v_body jsonb;
 v_content jsonb; v_calc jsonb; v_prior jsonb; v_payload jsonb:=jsonb_build_object('action',p_action,'id',p_id,'input',p_input);
 v_revision bigint:=1; v_id text; v_kind text; v_state text:='draft'; v_quote openerp.sales_documents;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(v_book.id,p_key,v_actor,'sales_document_command',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 IF v_book.authority<>'native' THEN PERFORM openerp.fail('Forbidden','Sales writes require the native book writer.'); END IF;
 IF octet_length(p_input::text)>65536 THEN PERFORM openerp.fail('InvalidJournal','Sales document input is too large.'); END IF;
 IF p_action IN ('create_quote','create_order') THEN
   IF (SELECT count(*) FROM openerp.sales_documents WHERE book_id=v_book.id)>=200 THEN
     PERFORM openerp.fail('InvalidJournal','This book already has 200 sales documents.'); END IF;
   v_kind:=CASE WHEN p_action='create_quote' THEN 'quote' ELSE 'order' END;
   PERFORM openerp.commerce_exact_object(p_input,ARRAY['content']);
   v_content:=p_input->'content'; v_id:=openerp.new_id(v_kind);
 ELSIF p_action IN ('revise','accept','cancel','order_from_quote') THEN
   SELECT * INTO v_doc FROM openerp.sales_documents WHERE book_id=v_book.id AND id=p_id;
   IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Sales document not found in this book.'); END IF;
   SELECT body INTO STRICT v_head FROM openerp.sales_document_revisions
     WHERE book_id=v_book.id AND document_id=p_id AND revision=v_doc.current_revision;
   PERFORM openerp.commerce_exact_object(p_input,CASE WHEN p_action='revise'
     THEN ARRAY['expectedRevision','expectedDigest','content','reason'] ELSE ARRAY['expectedRevision','expectedDigest'] END);
   IF p_input->>'expectedRevision' IS DISTINCT FROM v_doc.current_revision::text
      OR p_input->>'expectedDigest' IS DISTINCT FROM v_head->>'digest' THEN
      PERFORM openerp.fail('StaleDependency','Sales document changed; reopen its current revision.');
   END IF;
   IF p_action='revise' THEN
     IF v_head->>'state'<>'draft' THEN PERFORM openerp.fail('InvalidJournal','Accepted or cancelled documents cannot be revised.'); END IF;
     v_content:=p_input->'content'; v_state:='draft';
   ELSIF p_action='accept' THEN
     IF v_head->>'state'<>'draft' THEN PERFORM openerp.fail('InvalidJournal','Only a draft can be accepted.'); END IF;
     v_content:=v_head->'content'; v_state:='accepted';
   ELSIF p_action='cancel' THEN
     IF v_head->>'state'='cancelled' THEN PERFORM openerp.fail('InvalidJournal','Document already cancelled.'); END IF;
     IF v_doc.kind='order' AND EXISTS(SELECT FROM openerp.sales_order_conversions WHERE book_id=v_book.id AND order_id=p_id) THEN
       PERFORM openerp.fail('InvalidJournal','An order with converted portions cannot be cancelled; review invoice cancellation or credits.');
     END IF;
     v_content:=v_head->'content'; v_state:='cancelled';
   ELSE
     IF v_doc.kind<>'quote' OR v_head->>'state'<>'accepted' THEN
       PERFORM openerp.fail('InvalidJournal','Only an accepted quote can start an order.');
     END IF;
     v_content:=v_head->'content'; v_state:='accepted'; v_id:=openerp.new_id('sales_order'); v_kind:='order';
   END IF;
   IF p_action NOT IN ('order_from_quote') THEN
     IF v_doc.current_revision>=50 THEN PERFORM openerp.fail('InvalidJournal','Sales document history is full.'); END IF;
     v_revision:=v_doc.current_revision+1; v_id:=p_id; v_kind:=v_doc.kind;
   END IF;
 ELSE PERFORM openerp.fail('InvalidJournal','Unsupported sales document action.'); END IF;
 IF p_action IN ('create_quote','create_order','revise') THEN
   v_calc:=openerp.invoice_draft_calculate(v_book.id,v_content);
 ELSE v_calc:=v_head->'calculation'; END IF;
 v_body:=jsonb_build_object('id',v_id,'scope',jsonb_build_object('entityId',v_book.entity_id,'bookId',v_book.id),
   'kind',v_kind,'state',v_state,'revision',v_revision::text,'content',v_content,'calculation',v_calc,
   'sourceQuoteId',CASE WHEN p_action='order_from_quote' THEN p_id ELSE v_head->>'sourceQuoteId' END,
   'sourceQuoteRevision',CASE WHEN p_action='order_from_quote' THEN v_doc.current_revision::text ELSE v_head->>'sourceQuoteRevision' END)
   ||openerp.commerce_record_metadata(p_key,'sales_document_command',v_actor);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 IF p_action IN ('create_quote','create_order','order_from_quote') THEN
   INSERT INTO openerp.sales_documents(book_id,id,kind,source_quote_id,source_quote_revision,current_revision)
   VALUES(v_book.id,v_id,v_kind,CASE WHEN p_action='order_from_quote' THEN p_id END,
     CASE WHEN p_action='order_from_quote' THEN v_doc.current_revision END,1);
 ELSE UPDATE openerp.sales_documents SET current_revision=v_revision WHERE book_id=v_book.id AND id=v_id; END IF;
 INSERT INTO openerp.sales_document_revisions VALUES(v_book.id,v_id,v_revision,v_body);
 RETURN openerp.save_command(v_book.id,p_key,v_actor,'sales_document_command',v_payload,v_body);
END $$;

CREATE FUNCTION openerp.sales_document_view(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_doc openerp.sales_documents; v_body jsonb; v_conversions jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT * INTO v_doc FROM openerp.sales_documents WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Sales document not found in this book.'); END IF;
 SELECT body INTO STRICT v_body FROM openerp.sales_document_revisions
 WHERE book_id=v_doc.book_id AND document_id=v_doc.id AND revision=v_doc.current_revision;
 SELECT coalesce(jsonb_agg(jsonb_build_object('draftId',draft_id,'orderRevision',order_revision::text,'portions',portions)
 ORDER BY draft_id),'[]'::jsonb) INTO v_conversions FROM openerp.sales_order_conversions
 WHERE book_id=v_doc.book_id AND order_id=v_doc.id;
 RETURN jsonb_build_object('record',v_body,'conversions',v_conversions);
END $$;

CREATE FUNCTION openerp.convert_sales_order(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_doc openerp.sales_documents; v_head jsonb; v_previous jsonb;
 v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input); v_content jsonb; v_line jsonb; v_source jsonb;
 v_lines jsonb:='[]'; v_portions jsonb:='[]'; v_consumed numeric; v_requested numeric; v_available numeric;
 v_field text; v_total numeric; v_piece numeric; v_draft jsonb; v_id text; v_qty numeric; v_source_qty numeric;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(v_book.id,p_key,v_actor,'convert_sales_order',v_payload);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 IF v_book.authority<>'native' THEN PERFORM openerp.fail('Forbidden','Conversion requires the native book writer.'); END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedRevision','expectedDigest','draftKey','lines']);
 SELECT * INTO v_doc FROM openerp.sales_documents WHERE book_id=v_book.id AND id=p_id AND kind='order';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Order not found in this book.'); END IF;
 SELECT body INTO STRICT v_head FROM openerp.sales_document_revisions
 WHERE book_id=v_book.id AND document_id=p_id AND revision=v_doc.current_revision;
 IF v_head->>'state'<>'accepted' OR p_input->>'expectedRevision' IS DISTINCT FROM v_doc.current_revision::text
 OR p_input->>'expectedDigest' IS DISTINCT FROM v_head->>'digest' THEN
   PERFORM openerp.fail('StaleDependency','An accepted current order revision is required.');
 END IF;
 IF jsonb_typeof(p_input->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'lines') NOT BETWEEN 1 AND 50 THEN
   PERFORM openerp.fail('InvalidJournal','Select 1 to 50 order line portions.');
 END IF;
 FOR v_line IN SELECT value FROM jsonb_array_elements(p_input->'lines') LOOP
   PERFORM openerp.commerce_exact_object(v_line,ARRAY['id','quantity']);
   v_id:=openerp.commerce_text(v_line,'id',128);
   IF EXISTS(SELECT FROM jsonb_array_elements(v_portions) x WHERE x->>'id'=v_id) THEN
     PERFORM openerp.fail('InvalidJournal','Select each order line once.'); END IF;
   SELECT value INTO v_source FROM jsonb_array_elements(v_head->'content'->'lines') WHERE value->>'id'=v_id;
   IF v_source IS NULL THEN PERFORM openerp.fail('InvalidJournal','Selected line is not in the accepted order.'); END IF;
   IF jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'string' OR v_line->>'quantity' !~
      '^([1-9][0-9]{0,11}|(0|[1-9][0-9]{0,11})\.[0-9]{0,5}[1-9])$' THEN
     PERFORM openerp.fail('InvalidJournal','Select a positive canonical order quantity.'); END IF;
   v_qty:=(v_line->>'quantity')::numeric; v_source_qty:=(v_source->>'quantity')::numeric;
   SELECT coalesce(sum((portion->>'quantity')::numeric),0) INTO v_consumed
   FROM openerp.sales_order_conversions c CROSS JOIN LATERAL jsonb_array_elements(c.portions) portion
   WHERE c.book_id=v_book.id AND c.order_id=p_id AND portion->>'id'=v_id;
   IF v_qty+v_consumed>v_source_qty THEN
     PERFORM openerp.fail('StaleDependency','This order line has insufficient unconverted quantity.'); END IF;
   v_portions:=v_portions||jsonb_build_array(v_line);
   v_source:=v_source||jsonb_build_object('quantity',v_line->>'quantity');
   FOREACH v_field IN ARRAY ARRAY['baseMinor','discountMinor','chargeMinor','taxMinor','sourceGrossMinor'] LOOP
     IF v_source->v_field='null'::jsonb THEN CONTINUE; END IF;
     v_total:=(v_source->>v_field)::numeric;
     SELECT coalesce(sum((portion->>v_field)::numeric),0) INTO v_consumed
     FROM openerp.sales_order_conversions c CROSS JOIN LATERAL jsonb_array_elements(c.portions) portion
     WHERE c.book_id=v_book.id AND c.order_id=p_id AND portion->>'id'=v_id;
     IF v_qty+coalesce((SELECT sum((portion->>'quantity')::numeric) FROM openerp.sales_order_conversions c
       CROSS JOIN LATERAL jsonb_array_elements(c.portions) portion WHERE c.book_id=v_book.id AND c.order_id=p_id
       AND portion->>'id'=v_id),0)=v_source_qty THEN
       v_piece:=v_total-v_consumed;
     ELSE
       v_piece:=v_total*v_qty/v_source_qty;
       IF v_piece<>trunc(v_piece) THEN PERFORM openerp.fail('InvalidJournal','This partial amount cannot be split into exact minor units. Choose another quantity.'); END IF;
     END IF;
     v_source:=jsonb_set(v_source,ARRAY[v_field],to_jsonb(v_piece::text));
     v_line:=v_line||jsonb_build_object(v_field,v_piece::text);
   END LOOP;
   v_portions:=jsonb_set(v_portions,ARRAY[(jsonb_array_length(v_portions)-1)::text],v_line);
   v_lines:=v_lines||jsonb_build_array(v_source);
 END LOOP;
 v_content:=jsonb_set(v_head->'content',ARRAY['lines'],v_lines);
 v_content:=jsonb_set(v_content,ARRAY['sourceTotalMinor'],coalesce(to_jsonb(
   (SELECT CASE WHEN count(*) FILTER (WHERE value->>'sourceGrossMinor' IS NULL)>0 THEN NULL ELSE sum((value->>'sourceGrossMinor')::numeric)::text END FROM jsonb_array_elements(v_lines))), 'null'::jsonb));
 v_draft:=openerp.create_invoice_draft(p_token,p_scope,'sales_'||md5(p_key),jsonb_build_object('draftKey',p_input->>'draftKey','content',v_content));
 INSERT INTO openerp.sales_order_conversions VALUES(v_book.id,p_id,v_draft->>'id',v_doc.current_revision,v_portions);
 RETURN openerp.save_command(v_book.id,p_key,v_actor,'convert_sales_order',v_payload,
   jsonb_build_object('orderId',p_id,'orderRevision',v_doc.current_revision::text,'portions',v_portions,'draft',v_draft));
END $$;
CREATE FUNCTION openerp.sales_document_list(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT coalesce(jsonb_agg(r.body ORDER BY d.id),'[]'::jsonb) INTO v_items
 FROM openerp.sales_documents d JOIN openerp.sales_document_revisions r
 ON r.book_id=d.book_id AND r.document_id=d.id AND r.revision=d.current_revision
 WHERE d.book_id=p_scope->>'bookId';
 RETURN jsonb_build_object('scope',p_scope,'items',v_items);
END $$;
REVOKE ALL ON openerp.sales_documents,openerp.sales_document_revisions,openerp.sales_order_conversions FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.sales_document_command(text,jsonb,text,text,text,jsonb),
 openerp.sales_document_view(text,jsonb,text),openerp.sales_document_list(text,jsonb),openerp.convert_sales_order(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.sales_document_command(text,jsonb,text,text,text,jsonb),
 openerp.sales_document_view(text,jsonb,text),openerp.sales_document_list(text,jsonb),openerp.convert_sales_order(text,jsonb,text,text,jsonb) TO openerp_runtime;
