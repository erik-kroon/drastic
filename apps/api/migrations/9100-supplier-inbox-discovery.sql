ALTER TABLE openerp.supplier_inbox ADD COLUMN review_reason text
  CHECK (review_reason IS NULL OR length(review_reason) BETWEEN 1 AND 2000);

CREATE OR REPLACE FUNCTION openerp.supplier_inbox_view(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_book text; v_entry openerp.supplier_inbox; v_occurrence openerp.intake_occurrences; v_source jsonb; v_attempts jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  v_book:=p_scope->>'bookId';
  SELECT * INTO v_entry FROM openerp.supplier_inbox WHERE book_id=v_book AND occurrence_id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Supplier inbox original not found in this book.'); END IF;
  SELECT * INTO v_occurrence FROM openerp.intake_occurrences WHERE book_id=v_book AND id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Retained original not found in this book.'); END IF;
  v_source:=openerp.intake_summary(v_occurrence);
  SELECT coalesce(jsonb_agg(body ORDER BY ordinal),'[]'::jsonb) INTO v_attempts
    FROM openerp.supplier_extraction_attempts WHERE book_id=v_book AND occurrence_id=p_id;
  RETURN jsonb_build_object('occurrence',v_source,'channel',v_entry.channel,
    'messageIdentity',v_entry.message_identity,'draftId',v_entry.draft_id,'reviewReason',v_entry.review_reason,'attempts',v_attempts);
END $$;

CREATE FUNCTION openerp.list_supplier_inboxes(p_token text,p_scope jsonb,p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb; v_next text;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(page.body ORDER BY page.occurrence_id),'[]'::jsonb) INTO v_items FROM (
    SELECT i.occurrence_id,jsonb_build_object(
      'occurrence',openerp.intake_summary(o),
      'channel',i.channel,
      'messageIdentity',i.message_identity,
      'draftId',i.draft_id,
      'reviewReason',i.review_reason,
      'attempts',coalesce((SELECT jsonb_agg(a.body ORDER BY a.ordinal) FROM openerp.supplier_extraction_attempts a
        WHERE a.book_id=i.book_id AND a.occurrence_id=i.occurrence_id),'[]'::jsonb)
    ) AS body
    FROM openerp.supplier_inbox i
    JOIN openerp.intake_occurrences o ON o.book_id=i.book_id AND o.id=i.occurrence_id
    WHERE i.book_id=p_scope->>'bookId' AND (p_cursor IS NULL OR i.occurrence_id>p_cursor)
    ORDER BY i.occurrence_id
    LIMIT 21
  ) page;
  IF jsonb_array_length(v_items)=21 THEN
    v_next:=v_items->19->'occurrence'->>'id';
    v_items:=v_items-20;
  END IF;
  RETURN jsonb_build_object('items',v_items,'nextCursor',v_next);
END $$;

CREATE OR REPLACE FUNCTION openerp.review_supplier_inbox(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
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
  PERFORM 1 FROM openerp.evidence e WHERE e.book_id=v_book.id
    AND e.id=p_input->'draft'->'content'->>'sourceEvidenceId'
    AND openerp.purchase_source_reference(e.content)->>'occurrenceId'=p_id
    AND openerp.purchase_source_reference(e.content)->>'sha256'=
      (SELECT o.sha256 FROM openerp.intake_occurrences o WHERE o.book_id=v_book.id AND o.id=p_id);
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Reviewed draft evidence must refer to this original.'); END IF;
  v_draft:=openerp.create_supplier_invoice_draft(p_token,p_scope,'ap_'||substr(encode(sha256((v_book.id||':'||p_id)::bytea),'hex'),1,60),p_input->'draft');
  UPDATE openerp.supplier_inbox SET draft_id=v_draft->>'id',review_reason=p_input->>'reviewReason'
    WHERE book_id=v_book.id AND occurrence_id=p_id;
  v_result:=jsonb_build_object('inbox',openerp.supplier_inbox_view(p_token,p_scope,p_id),'draft',v_draft);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'review_supplier_inbox',v_payload,v_result);
END $$;

REVOKE ALL ON FUNCTION openerp.list_supplier_inboxes(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_supplier_inboxes(text,jsonb,text) TO openerp_runtime;
