-- An occurrence has at most 50 immutable previews. Return the complete inventory
-- without original bytes, posting authority, or unbounded preview bodies.
CREATE FUNCTION openerp.list_sie_source_previews(p_token text,p_scope jsonb,p_occurrence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF NOT EXISTS(SELECT FROM openerp.intake_occurrences
    WHERE book_id=p_scope->>'bookId' AND id=p_occurrence) THEN
    PERFORM openerp.fail('NotFound','Original source occurrence was not found.');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'ordinal',ordinal,'encoding',body->'encoding',
    'ready',body->'ready','createdAt',body->'createdAt') ORDER BY ordinal DESC),'[]'::jsonb)
    INTO items FROM openerp.sie_source_previews
    WHERE book_id=p_scope->>'bookId' AND occurrence_id=p_occurrence;
  RETURN jsonb_build_object('scope',p_scope,'occurrenceId',p_occurrence,'items',items);
END $$;
REVOKE ALL ON FUNCTION openerp.list_sie_source_previews(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.list_sie_source_previews(text,jsonb,text) TO openerp_runtime;
