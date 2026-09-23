-- Live discovery for the existing one-shot classification-resolution command.
-- Scan retained identities before filtering; no artifact, receipt or source mutation.
CREATE FUNCTION openerp.list_unclassified_tax_account_events(
  token text,scope jsonb,account_id text,after_cursor text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE t_context text;t_after text:='';t_last text;t_items jsonb;t_scanned integer;t_more boolean;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF account_id IS NULL OR account_id !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Select a retained tax-account source account.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.tax_account_sources s
    WHERE s.book_id=scope->>'bookId' AND s.account_id=list_unclassified_tax_account_events.account_id) THEN
    PERFORM openerp.fail('NotFound','The tax-account source account is not in this book.'); END IF;
  t_context:=substr(openerp.digest(jsonb_build_object(
    'entityId',scope->>'entityId','bookId',scope->>'bookId','accountId',account_id)),8);
  IF after_cursor IS DISTINCT FROM '' THEN
    IF after_cursor IS NULL OR length(after_cursor)>199
      OR after_cursor !~ '^taue1:[a-f0-9]{64}:[a-z][a-z0-9_-]{2,127}$'
      OR split_part(after_cursor,':',2) IS DISTINCT FROM t_context THEN
      PERFORM openerp.fail('InvalidJournal','Use the bounded worklist cursor for this exact book and source account.'); END IF;
    t_after:=split_part(after_cursor,':',3);
    -- A resolved anchor remains valid: continuation follows retained identity, not membership.
    IF NOT EXISTS(SELECT FROM openerp.tax_account_events e
      WHERE e.book_id=scope->>'bookId' AND e.account_id=list_unclassified_tax_account_events.account_id AND e.id=t_after) THEN
      PERFORM openerp.fail('InvalidJournal','The worklist cursor must identify a retained event in this source account.'); END IF;
  END IF;
  WITH scanned AS MATERIALIZED (
    SELECT e.id FROM openerp.tax_account_events e
      WHERE e.book_id=scope->>'bookId' AND e.account_id=list_unclassified_tax_account_events.account_id
        AND e.id COLLATE "C">t_after COLLATE "C"
      ORDER BY e.id COLLATE "C" LIMIT 51
  ), examined AS MATERIALIZED (
    SELECT s.id FROM scanned s ORDER BY s.id COLLATE "C" LIMIT 50
  ), classified AS MATERIALIZED (
    SELECT e.id,openerp.tax_account_event_classification(scope->>'bookId',e.id) AS view
      FROM examined e
  )
  SELECT coalesce(jsonb_agg(c.view ORDER BY c.id COLLATE "C")
      FILTER (WHERE c.view->>'effectiveClassification'='unknown'),'[]'),
    count(*)::integer,(SELECT count(*)>50 FROM scanned),
    (SELECT e.id FROM examined e ORDER BY e.id COLLATE "C" DESC LIMIT 1)
    INTO t_items,t_scanned,t_more,t_last FROM classified c;
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',scope->>'entityId','bookId',scope->>'bookId'),
    'accountId',account_id,'items',t_items,'scanned',t_scanned,
    'next',CASE WHEN t_more THEN 'taue1:'||t_context||':'||t_last ELSE NULL END,
    'consistency','live_unclassified_events');
END $$;

REVOKE ALL ON FUNCTION openerp.list_unclassified_tax_account_events(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_unclassified_tax_account_events(text,jsonb,text,text) TO openerp_runtime;
