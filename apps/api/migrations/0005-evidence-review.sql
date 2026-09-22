CREATE OR REPLACE FUNCTION openerp.book_setup(token text, scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE accounts jsonb; periods jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'active', active) ORDER BY code), '[]') INTO accounts
    FROM openerp.accounts WHERE book_id = scope->>'bookId';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'startsOn', starts_on::text, 'endsOn', ends_on::text, 'locked', locked) ORDER BY starts_on), '[]') INTO periods
    FROM openerp.periods WHERE book_id = scope->>'bookId';
  RETURN jsonb_build_object('accounts', accounts, 'periods', periods, 'blockers', CASE WHEN EXISTS(SELECT FROM openerp.books WHERE id = scope->>'bookId' AND profile = 'synthetic-core-v1' AND authority = 'native') THEN '[]'::jsonb ELSE jsonb_build_array('The book profile or writer authority is not supported.') END, 'warnings', jsonb_build_array(
    'Only the synthetic-core-v1 manual journal profile is implemented. This book is not verified for production accounting or Swedish compliance.',
    'Tax treatment, source completeness, external archive and statutory reporting are not implemented.'));
END $$;

CREATE FUNCTION openerp.get_evidence(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE source openerp.evidence;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT e.* INTO source FROM openerp.evidence e WHERE e.book_id = scope->>'bookId' AND e.id = get_evidence.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound', 'The evidence was not found in this book.'); END IF;
  RETURN jsonb_build_object('id', source.id, 'title', source.title, 'content', source.content,
    'sha256', source.sha256, 'mediaType', source.media_type, 'origin', source.origin,
    'createdAt', to_char(source.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;
REVOKE ALL ON FUNCTION openerp.get_evidence(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.get_evidence(text,jsonb,text) TO openerp_runtime;
