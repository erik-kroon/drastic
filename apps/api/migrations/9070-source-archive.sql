-- A bounded, book-authorized archive index. Filters apply to retained occurrence labels only.
CREATE FUNCTION openerp.search_source_archive(token text, scope jsonb, filters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb; v_next text; v_cursor text:=filters->>'cursor';
BEGIN
 PERFORM openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
 IF jsonb_typeof(filters) <> 'object' OR EXISTS(SELECT FROM jsonb_object_keys(filters) k WHERE k NOT IN ('cursor','sourceSystem','filename','retainedFrom','retainedTo'))
   OR (filters ? 'retainedFrom' AND (filters->>'retainedFrom') !~ '^\d{4}-\d{2}-\d{2}$')
   OR (filters ? 'retainedTo' AND (filters->>'retainedTo') !~ '^\d{4}-\d{2}-\d{2}$') THEN
   PERFORM openerp.fail('InvalidJournal','Supply supported archive filters.');
 END IF;
 SELECT coalesce(jsonb_agg(page.body ORDER BY page.id),'[]'::jsonb) INTO v_items FROM (
   SELECT o.id,o.body FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId'
     AND (v_cursor IS NULL OR o.id>v_cursor)
     AND (NOT filters ? 'sourceSystem' OR o.source_system=filters->>'sourceSystem')
     AND (NOT filters ? 'filename' OR o.body->>'filename'=filters->>'filename')
     AND (NOT filters ? 'retainedFrom' OR left(o.body->>'retainedAt',10) >= filters->>'retainedFrom')
     AND (NOT filters ? 'retainedTo' OR left(o.body->>'retainedAt',10) <= filters->>'retainedTo')
   ORDER BY o.id LIMIT 11
 ) page;
 IF jsonb_array_length(v_items)>10 THEN v_next:=v_items->9->>'id'; v_items:=v_items-10; END IF;
 RETURN jsonb_build_object('items',v_items,'nextCursor',v_next);
END $$;
REVOKE ALL ON FUNCTION openerp.search_source_archive(text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.search_source_archive(text,jsonb,jsonb) TO openerp_runtime;
