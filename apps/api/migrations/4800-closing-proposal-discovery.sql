-- Saved-proposal discovery only. No readiness/provider evaluation, approvals or writes.
CREATE INDEX closing_proposals_discovery ON openerp.closing_proposals(book_id,period_id,id COLLATE "C");

CREATE FUNCTION openerp.list_closing_proposals(p_token text,p_scope jsonb,p_period text,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_anchor text:=''; c_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF NOT EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_period) THEN
    PERFORM openerp.fail('NotFound','The period was not found in this book.'); END IF;
  IF coalesce(p_after,'')<>'' THEN
    IF p_after!~'^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$'
      OR split_part(p_after,':',1) IS DISTINCT FROM p_period THEN
      PERFORM openerp.fail('InvalidJournal','Use a saved-proposal cursor from this exact period.'); END IF;
    c_anchor:=split_part(p_after,':',2);
    IF NOT EXISTS(SELECT FROM openerp.closing_proposals p WHERE p.book_id=p_scope->>'bookId'
      AND p.period_id=p_period AND p.id=c_anchor) THEN
      PERFORM openerp.fail('InvalidJournal','The cursor must identify a saved proposal in this book and period.'); END IF;
  END IF;
  WITH page AS MATERIALIZED (
    SELECT p.id,p.body FROM openerp.closing_proposals p
      WHERE p.book_id=p_scope->>'bookId' AND p.period_id=p_period AND p.id COLLATE "C">c_anchor COLLATE "C"
      ORDER BY p.id COLLATE "C" LIMIT 51
  ), shown AS (
    SELECT * FROM page ORDER BY id COLLATE "C" LIMIT 50
  )
  SELECT jsonb_build_object('scope',p_scope,'periodId',p_period,
    'items',coalesce(jsonb_agg(jsonb_build_object('id',p.id,'periodId',p_period,'digest',p.body->>'digest',
      'action',p.body->>'action','reason',p.body->>'reason','proposedBy',p.body->>'proposedBy','createdAt',p.body->>'createdAt',
      'capturedStartsOn',p.body->'basis'->>'startsOn','capturedEndsOn',p.body->'basis'->>'endsOn',
      'capturedLedgerSequence',p.body->'basis'->'dependencies'->>'ledgerSequence',
      -- Deliberate identity-only allowlist: no approval ID, command payload or key.
      'execution',CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('transitionId',t.id,'certificateId',t.body->>'certificateId') END
    ) ORDER BY p.id COLLATE "C"),'[]'),
    'next',CASE WHEN (SELECT count(*) FROM page)>50 THEN p_period||':'||max(p.id COLLATE "C") ELSE NULL END,
    'discovery','live_saved_proposal_history','liveReadinessChecked',false,'approvalAuthority',false)
    INTO c_result FROM shown p LEFT JOIN openerp.closing_transitions t
      ON t.book_id=p_scope->>'bookId' AND t.period_id=p_period AND t.proposal_id=p.id;
  RETURN c_result;
END $$;
REVOKE ALL ON FUNCTION openerp.list_closing_proposals(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_closing_proposals(text,jsonb,text,text) TO openerp_runtime;
