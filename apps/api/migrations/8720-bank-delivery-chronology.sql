-- Delivery review starts with the most recent outcome, with stable keyset continuation.
CREATE OR REPLACE FUNCTION openerp.list_bank_connector_batches(p_token text,p_scope jsonb,p_id text,p_cursor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb; next_cursor text; cursor_time text;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
  IF NOT EXISTS(SELECT FROM openerp.bank_connector_consents WHERE book_id=p_scope->>'bookId' AND id=p_id) THEN
    PERFORM openerp.fail('NotFound','The connector consent was not found in this book.'); END IF;
  IF p_cursor<>'' THEN
    SELECT body->>'receivedAt' INTO cursor_time FROM openerp.bank_connector_batches
      WHERE book_id=p_scope->>'bookId' AND consent_id=p_id AND id=p_cursor;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The delivery cursor was not found in this consent.'); END IF;
  END IF;
  WITH page AS (
    SELECT id,body FROM openerp.bank_connector_batches
      WHERE book_id=p_scope->>'bookId' AND consent_id=p_id
        AND (p_cursor='' OR (body->>'receivedAt',id)<(cursor_time,p_cursor))
      ORDER BY body->>'receivedAt' DESC,id DESC LIMIT 51
  ), visible AS (SELECT * FROM page ORDER BY body->>'receivedAt' DESC,id DESC LIMIT 50)
  SELECT coalesce((SELECT jsonb_agg(body ORDER BY body->>'receivedAt' DESC,id DESC) FROM visible),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>50
      THEN (SELECT id FROM visible ORDER BY body->>'receivedAt',id LIMIT 1) ELSE NULL END
  INTO items,next_cursor;
  RETURN jsonb_build_object('scope',p_scope,'consentId',p_id,'items',items,'nextCursor',next_cursor);
END $$;
CREATE INDEX bank_connector_batches_chronology ON openerp.bank_connector_batches(book_id,consent_id,(body->>'receivedAt') DESC,id DESC);
