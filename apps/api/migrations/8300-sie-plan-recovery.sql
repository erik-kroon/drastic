-- An occurrence has at most 50 immutable previews. Return the complete inventory
-- without original bytes, posting authority, or unbounded preview bodies.
CREATE OR REPLACE FUNCTION openerp.list_sie_source_previews(p_token text,p_scope jsonb,p_occurrence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF NOT EXISTS(SELECT FROM openerp.intake_occurrences
    WHERE book_id=p_scope->>'bookId' AND id=p_occurrence) THEN
    PERFORM openerp.fail('NotFound','Original source occurrence was not found.');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,'ordinal',v.ordinal,'encoding',v.body->'encoding',
    'ready',v.body->'ready','createdAt',v.body->'createdAt',
    'planId',p.id,'runId',r.id) ORDER BY v.ordinal DESC),'[]'::jsonb)
    INTO items FROM openerp.sie_source_previews v
    LEFT JOIN openerp.sie_source_plans p ON p.book_id=v.book_id AND p.preview_id=v.id
    LEFT JOIN openerp.sie_source_runs r ON r.book_id=p.book_id AND r.plan_id=p.id
    WHERE v.book_id=p_scope->>'bookId' AND v.occurrence_id=p_occurrence;
  RETURN jsonb_build_object('scope',p_scope,'occurrenceId',p_occurrence,'items',items);
END $$;
REVOKE ALL ON FUNCTION openerp.list_sie_source_previews(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.list_sie_source_previews(text,jsonb,text) TO openerp_runtime;
