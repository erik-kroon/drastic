-- Fiscal-year choices and their existing migration decisions share one scoped read.
CREATE FUNCTION openerp.list_historical_bases(p_token text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',y.id,'startsOn',y.starts_on::text,'endsOn',y.ends_on::text,
    'basis',CASE WHEN b.body IS NULL THEN 'null'::jsonb
      ELSE b.body||jsonb_build_object('voucherId',b.opening_voucher_id) END
  ) ORDER BY y.starts_on DESC,y.id),'[]'::jsonb)
  INTO items FROM openerp.fiscal_years y
  LEFT JOIN openerp.historical_bases b ON b.book_id=y.book_id AND b.fiscal_year_id=y.id
  WHERE y.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'years',items);
END $$;
REVOKE ALL ON FUNCTION openerp.list_historical_bases(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.list_historical_bases(text,jsonb) TO openerp_runtime;
