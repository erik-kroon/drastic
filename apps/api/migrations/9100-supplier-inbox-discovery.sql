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
    'messageIdentity',v_entry.message_identity,'draftId',v_entry.draft_id,'attempts',v_attempts);
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

REVOKE ALL ON FUNCTION openerp.list_supplier_inboxes(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_supplier_inboxes(text,jsonb,text) TO openerp_runtime;
