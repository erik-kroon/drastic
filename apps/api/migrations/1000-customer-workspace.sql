-- Work is a projection of retained proposals. Original operations own all transitions.
CREATE FUNCTION openerp.workspace_list_work(token text, scope jsonb, filters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE
  w_actor text; w_book openerp.books; w_period text; w_status text; w_sort text; w_search text;
  w_after text; w_anchor openerp.change_sets; w_items jsonb; w_next text;
  w_total text; w_open text; w_completed text; w_checked text;
BEGIN
  w_actor := openerp.authorize(token, scope);
  SELECT * INTO w_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF filters IS NULL OR jsonb_typeof(filters)<>'object' OR EXISTS(
    SELECT FROM jsonb_object_keys(filters) key WHERE key NOT IN ('period','status','sort','q','after')
  ) OR EXISTS(SELECT FROM jsonb_each(filters) e WHERE jsonb_typeof(e.value)<>'string') THEN
    PERFORM openerp.fail('InvalidJournal','Supply valid workspace filters.');
  END IF;
  w_period := filters->>'period';
  w_status := coalesce(filters->>'status','open');
  w_sort := coalesce(filters->>'sort','newest');
  w_search := btrim(coalesce(filters->>'q',''));
  w_after := filters->>'after';
  IF w_status NOT IN ('all','open','completed') OR w_sort NOT IN ('newest','oldest') OR length(w_search)>200 THEN
    PERFORM openerp.fail('InvalidJournal','The workspace filter is not supported.');
  END IF;
  IF w_period IS NOT NULL AND NOT EXISTS(
    SELECT FROM openerp.periods p WHERE p.book_id=w_book.id AND p.id=w_period
  ) THEN PERFORM openerp.fail('NotFound','The period does not belong to this book.'); END IF;
  IF w_after IS NOT NULL THEN
    SELECT * INTO w_anchor FROM openerp.change_sets c WHERE c.book_id=w_book.id AND c.id=w_after
      AND openerp.posting_recovery_standalone(c.book_id,c.id);
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The continuation does not belong to this work list.'); END IF;
  END IF;
  w_checked := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  WITH observed AS MATERIALIZED (
    SELECT c.*, openerp.posting_recovery_summary(w_book.id,c) AS recovery,
      c.plan->'groups'->0->'actions'->0 AS action
    FROM openerp.change_sets c
    WHERE c.book_id=w_book.id AND openerp.posting_recovery_standalone(c.book_id,c.id)
      AND (w_period IS NULL OR c.plan->'groups'->0->'actions'->0->>'accountingPeriodId'=w_period)
      AND (w_search='' OR strpos(lower(c.plan->'groups'->0->'actions'->0->>'description'),lower(w_search))>0
        OR strpos(lower(c.id),lower(w_search))>0)
  ), filtered AS MATERIALIZED (
    SELECT * FROM observed o WHERE w_status='all'
      OR (w_status='open' AND o.recovery->>'postingStatus'='unposted_at_check')
      OR (w_status='completed' AND o.recovery->>'postingStatus'<>'unposted_at_check')
  ), candidates AS MATERIALIZED (
    SELECT * FROM filtered f WHERE w_after IS NULL
      OR (w_sort='newest' AND (f.created_at,f.id COLLATE "C")<(w_anchor.created_at,w_anchor.id COLLATE "C"))
      OR (w_sort='oldest' AND (f.created_at,f.id COLLATE "C")>(w_anchor.created_at,w_anchor.id COLLATE "C"))
    ORDER BY CASE WHEN w_sort='newest' THEN f.created_at END DESC,
      CASE WHEN w_sort='newest' THEN f.id END COLLATE "C" DESC,
      CASE WHEN w_sort='oldest' THEN f.created_at END,
      CASE WHEN w_sort='oldest' THEN f.id END COLLATE "C"
    LIMIT 51
  ), numbered AS (
    SELECT c.*, row_number() OVER (ORDER BY
      CASE WHEN w_sort='newest' THEN c.created_at END DESC,
      CASE WHEN w_sort='newest' THEN c.id END COLLATE "C" DESC,
      CASE WHEN w_sort='oldest' THEN c.created_at END,
      CASE WHEN w_sort='oldest' THEN c.id END COLLATE "C") AS ordinal FROM candidates c
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'kind','journal_proposal','id',p.id,'revision',p.digest,
      'description',p.action->>'description','createdAt',p.recovery->>'createdAt','createdBy',p.created_by,
      'postingDate',p.action->>'postingDate','periodId',p.action->>'accountingPeriodId',
      'amountMinor',(SELECT coalesce(sum((line->>'debitMinor')::numeric),0)::text FROM jsonb_array_elements(p.action->'lines') line),
      'currency',p.action->>'currency',
      'state',CASE p.recovery->>'postingStatus' WHEN 'unposted_at_check' THEN 'unposted'
        WHEN 'posted' THEN 'posted' ELSE 'posted_elsewhere' END,
      'receiptId',p.recovery->'executionReceipt'->>'id'
    ) ORDER BY p.ordinal) FILTER (WHERE p.ordinal<=50),'[]'),
    CASE WHEN (SELECT count(*) FROM candidates)>50 THEN (SELECT id FROM numbered WHERE ordinal=50) END,
    (SELECT count(*)::text FROM filtered),
    (SELECT count(*)::text FROM observed WHERE recovery->>'postingStatus'='unposted_at_check'),
    (SELECT count(*)::text FROM observed WHERE recovery->>'postingStatus'<>'unposted_at_check')
  INTO w_items,w_next,w_total,w_open,w_completed FROM numbered p;

  RETURN jsonb_build_object(
    'scope',jsonb_build_object('entityId',scope->>'entityId','bookId',w_book.id),
    'actorId',w_actor,'checkedAt',w_checked,'sequence',w_book.committed_sequence::text,'currencyScale',w_book.currency_scale,
    'filters',jsonb_build_object('period',w_period,'status',w_status,'sort',w_sort,'q',w_search),
    'coverage','journal_proposals_only','total',w_total,
    'counts',jsonb_build_object('open',w_open,'completed',w_completed),'items',w_items,'next',w_next
  );
END $$;

REVOKE ALL ON FUNCTION openerp.workspace_list_work(text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.workspace_list_work(text,jsonb,jsonb) TO openerp_runtime;
