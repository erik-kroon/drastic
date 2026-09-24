CREATE FUNCTION openerp.list_bank_connector_feeds(p_token text,p_scope jsonb,p_cursor text,p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb; v_next text;   v_read_at text;

BEGIN
  PERFORM openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
  v_read_at:=to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  IF coalesce(p_cursor,'')!='' AND p_cursor!~'^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use a valid connector feed inventory cursor.'); END IF;
  IF coalesce(p_id,'')!='' AND p_id!~'^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use a valid connector consent ID.'); END IF;
  IF coalesce(p_id,'')!='' AND NOT EXISTS(SELECT FROM openerp.bank_connector_consents
      WHERE book_id=p_scope->>'bookId' AND id=p_id) THEN
    PERFORM openerp.fail('NotFound','The connector consent was not found in this book.'); END IF;
  WITH selected AS (
    SELECT c.* FROM openerp.bank_connector_consents c
      WHERE c.book_id=p_scope->>'bookId' AND (coalesce(p_id,'')='' OR c.id=p_id)
        AND (coalesce(p_cursor,'')='' OR c.id>p_cursor)
      ORDER BY c.id LIMIT 21
  ), visible AS (
    SELECT * FROM selected ORDER BY id LIMIT 20
  ), feed_rows AS (
    SELECT c.*,stats.retained_page_count,stats.retained_page_start_cursor,stats.last_page_id,stats.last_page_at,
      recent.pages
    FROM visible c
    CROSS JOIN LATERAL (
      SELECT count(*)::integer retained_page_count,
        (array_agg(b.body->>'previousCursor' ORDER BY b.body->>'receivedAt',b.id))[1] retained_page_start_cursor,
        (array_agg(b.id ORDER BY b.body->>'receivedAt' DESC,b.id DESC))[1] last_page_id,
        (array_agg(b.body->>'receivedAt' ORDER BY b.body->>'receivedAt' DESC,b.id DESC))[1] last_page_at
      FROM openerp.bank_connector_batches b
      WHERE b.book_id=c.book_id AND b.consent_id=c.id
    ) stats
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(page.body ORDER BY page.received_at DESC,page.id DESC),'[]'::jsonb) pages
      FROM (
        SELECT b.id,b.body->>'receivedAt' received_at,jsonb_build_object(
          'id',b.id,'requestKey',b.body#>>'{receipt,key}',
          'providerOutcome',b.body->>'providerOutcome','previousCursor',b.body->>'previousCursor',
          'nextCursor',b.body->>'nextCursor','sourceRevision',b.body->>'sourceRevision',
          'recordCount',b.body->'recordCount','overlapCount',b.body->'overlapCount',
          'source',CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
            'occurrenceId',o.id,'occurrenceKey',o.occurrence_key,'sha256',o.sha256,
            'byteLength',(o.body->>'byteLength')::integer,'mediaType',o.body->>'mediaType',
            'originalAvailability','not_checked') END,
          'recognition',b.body->>'recognition','providerVerification',b.body->>'providerVerification',
          'receivedAt',b.body->>'receivedAt','receivedBy',b.body->>'receivedBy') body
        FROM (SELECT id,body FROM openerp.bank_connector_batches
          WHERE book_id=c.book_id AND consent_id=c.id ORDER BY body->>'receivedAt' DESC,id DESC LIMIT 20) b
        LEFT JOIN openerp.intake_occurrences o ON o.book_id=b.book_id
          AND o.id=b.body->>'sourceOccurrenceId'
      ) page
    ) recent
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'scope',p_scope,'consent',f.body||jsonb_build_object('cursor',coalesce(f.cursor,''),'revoked',f.revoked_at IS NOT NULL),
    'account',jsonb_build_object('externalAccountId',f.external_account_id,'sourceAccountId',f.source_account_id,
      'accountId',f.account_id,'active',EXISTS(SELECT FROM openerp.accounts a
        WHERE a.book_id=f.book_id AND a.id=f.account_id AND a.active)),
     'readAt',v_read_at,

    'cursorSnapshot',jsonb_build_object('cursor',coalesce(f.cursor,''),'retainedPageCount',f.retained_page_count,
      'retainedPageStartCursor',f.retained_page_start_cursor,'lastPageId',f.last_page_id,'lastPageAt',f.last_page_at),
    'pages',f.pages,'pageEvidenceTruncated',f.retained_page_count>20,
    'providerAcceptance','not_established','accountCoverage','not_established','automaticRecovery',false,
    'recoveryBlockers',CASE WHEN f.provider_id='plaid' THEN jsonb_build_array(
      jsonb_build_object('code','PAGINATION_START_NOT_RETAINED','state','structural_limit',
        'message','The first cursor for the current provider pagination window is not retained, so retained pages cannot safely replay that window.',
        'operatorAction','inspect_retained_pages_and_reconcile_a_fresh_provider_snapshot'),
      jsonb_build_object('code','TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION','state','not_observed_in_retained_evidence',
        'message','A provider mutation during pagination requires a fresh provider snapshot and operator review; this feed does not automatically recover.',
        'operatorAction','inspect_retained_pages_and_reconcile_a_fresh_provider_snapshot')
    ) ELSE '[]'::jsonb END
  ) ORDER BY f.id),'[]'::jsonb),
    CASE WHEN coalesce(p_id,'')='' AND (SELECT count(*) FROM selected)>20
      THEN (SELECT max(id) FROM visible) ELSE NULL END
  INTO v_items,v_next FROM feed_rows f;
  RETURN jsonb_build_object('scope',p_scope,'items',v_items,'nextCursor',v_next);
END $$;
REVOKE ALL ON FUNCTION openerp.list_bank_connector_feeds(text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.list_bank_connector_feeds(text,jsonb,text,text) TO openerp_runtime;
