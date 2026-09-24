-- Scoped keyset inventories recover retained consent and source-delivery state.
CREATE FUNCTION openerp.list_bank_connector_consents(p_token text,p_scope jsonb,p_cursor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb; next_cursor text;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
  IF p_cursor<>'' AND p_cursor!~'^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use a returned connector inventory cursor.'); END IF;
  WITH page AS (
    SELECT id,body||jsonb_build_object('cursor',coalesce(cursor,''),'revoked',revoked_at IS NOT NULL) body
    FROM openerp.bank_connector_consents WHERE book_id=p_scope->>'bookId' AND id>p_cursor ORDER BY id LIMIT 51
  ), visible AS (SELECT * FROM page ORDER BY id LIMIT 50)
  SELECT coalesce((SELECT jsonb_agg(body ORDER BY id) FROM visible),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT max(id) FROM visible) ELSE NULL END
  INTO items,next_cursor;
  RETURN jsonb_build_object('scope',p_scope,'items',items,'nextCursor',next_cursor);
END $$;

CREATE FUNCTION openerp.list_bank_connector_batches(p_token text,p_scope jsonb,p_id text,p_cursor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb; next_cursor text;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
  IF NOT EXISTS(SELECT FROM openerp.bank_connector_consents WHERE book_id=p_scope->>'bookId' AND id=p_id) THEN
    PERFORM openerp.fail('NotFound','The connector consent was not found in this book.'); END IF;
  IF p_cursor<>'' AND p_cursor!~'^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use a returned delivery inventory cursor.'); END IF;
  WITH page AS (
    SELECT id,body FROM openerp.bank_connector_batches
      WHERE book_id=p_scope->>'bookId' AND consent_id=p_id AND id>p_cursor ORDER BY id LIMIT 51
  ), visible AS (SELECT * FROM page ORDER BY id LIMIT 50)
  SELECT coalesce((SELECT jsonb_agg(body ORDER BY id) FROM visible),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT max(id) FROM visible) ELSE NULL END
  INTO items,next_cursor;
  RETURN jsonb_build_object('scope',p_scope,'consentId',p_id,'items',items,'nextCursor',next_cursor);
END $$;
CREATE INDEX bank_connector_batches_consent_inventory ON openerp.bank_connector_batches(book_id,consent_id,id);
REVOKE ALL ON FUNCTION openerp.list_bank_connector_consents(text,jsonb,text),
  openerp.list_bank_connector_batches(text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.list_bank_connector_consents(text,jsonb,text),
  openerp.list_bank_connector_batches(text,jsonb,text,text) TO openerp_runtime;
