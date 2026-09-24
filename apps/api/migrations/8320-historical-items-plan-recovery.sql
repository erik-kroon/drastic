-- Recover immutable register admissions without retaining a response identifier.
CREATE FUNCTION openerp.get_plan_historical_items(p_token text,p_scope jsonb,p_plan text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF NOT EXISTS(SELECT FROM openerp.sie_source_plans
    WHERE book_id=p_scope->>'bookId' AND id=p_plan) THEN
    PERFORM openerp.fail('NotFound','SIE source plan was not found.');
  END IF;
  SELECT body INTO result FROM openerp.historical_item_admissions
    WHERE book_id=p_scope->>'bookId' AND source_plan_id=p_plan;
  RETURN coalesce(result,'null'::jsonb);
END $$;
REVOKE ALL ON FUNCTION openerp.get_plan_historical_items(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.get_plan_historical_items(text,jsonb,text) TO openerp_runtime;
