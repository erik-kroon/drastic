-- Read projection only: each domain retains its own review and execution authority.
CREATE FUNCTION openerp.workspace_attention(token text, scope jsonb, filters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  a_book openerp.books; a_kind text; a_status text; a_sort text; a_search text; a_after text;
  a_period openerp.periods; a_items jsonb; a_next text; a_total text; a_counts jsonb;
  a_anchor jsonb; a_checked text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  SELECT * INTO STRICT a_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF filters IS NULL OR jsonb_typeof(filters)<>'object' OR EXISTS(
    SELECT FROM jsonb_object_keys(filters) k WHERE k NOT IN ('kind','period','status','sort','q','after')
  ) OR EXISTS(SELECT FROM jsonb_each(filters) e WHERE jsonb_typeof(e.value)<>'string') THEN
    PERFORM openerp.fail('InvalidJournal','Supply valid work filters.'); END IF;
  a_kind:=coalesce(filters->>'kind','all'); a_status:=coalesce(filters->>'status','open');
  a_sort:=coalesce(filters->>'sort','newest'); a_search:=btrim(coalesce(filters->>'q','')); a_after:=filters->>'after';
  IF a_kind NOT IN ('all','journal','invoice','expense') OR a_status NOT IN ('all','open','completed')
    OR a_sort NOT IN ('newest','oldest') OR length(a_search)>200 THEN
    PERFORM openerp.fail('InvalidJournal','The work filter is not supported.'); END IF;
  IF filters->>'period' IS NOT NULL THEN
    SELECT * INTO a_period FROM openerp.periods p WHERE p.book_id=a_book.id AND p.id=filters->>'period';
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period does not belong to this book.'); END IF;
  END IF;
  a_checked:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  WITH journals AS (
    SELECT c.*, openerp.posting_recovery_summary(a_book.id,c) recovery,
      c.plan->'groups'->0->'actions'->0 action
    FROM openerp.change_sets c WHERE c.book_id=a_book.id AND openerp.posting_recovery_standalone(c.book_id,c.id)
  ), expenses AS (
    SELECT s.id, openerp.expense_tax_current(a_book.id,s.id) source,
      openerp.expense_tax_latest_review(a_book.id,s.id) review
    FROM openerp.expense_tax_sources s WHERE s.book_id=a_book.id
  ), observed AS (
    SELECT 'journal_'||j.id key,'journal' kind,j.id id,j.digest revision,j.action->>'description' title,
      j.action->>'postingDate' date,j.recovery->>'createdAt' updated,
      (SELECT coalesce(sum((line->>'debitMinor')::numeric),0)::text FROM jsonb_array_elements(j.action->'lines') line) amount,
      j.action->>'currency' currency,a_book.currency_scale scale,
      CASE WHEN j.recovery->>'postingStatus'='unposted_at_check' THEN 'open' ELSE 'completed' END state,
      CASE WHEN j.recovery->>'postingStatus'='unposted_at_check' THEN 'journal_review' ELSE 'journal_posted' END reason
    FROM journals j
    UNION ALL
    SELECT 'invoice_'||d.id,'invoice',d.id,r.body->>'digest',r.body->'content'->>'title',
      r.body->'content'->>'plannedIssueDate',r.body->>'createdAt',r.body->'totals'->>'grossMinor',
      r.body->'content'->>'currency',(r.body->'content'->>'currencyScale')::integer,
      CASE WHEN i.id IS NULL THEN 'open' ELSE 'completed' END,
      CASE WHEN i.id IS NULL THEN 'invoice_draft' ELSE 'invoice_issued' END
    FROM openerp.invoice_drafts d JOIN openerp.invoice_draft_revisions r ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision
      LEFT JOIN openerp.invoice_issues i ON i.book_id=d.book_id AND i.draft_id=d.id WHERE d.book_id=a_book.id
    UNION ALL
    SELECT 'expense_'||e.id,'expense',e.id,e.source->>'digest',e.source->'facts'->>'description',
      e.source->'facts'->>'issuedOn',e.source->>'recordedAt',e.source->'facts'->'amounts'->>'grossMinor',
      e.source->'facts'->>'currency',(e.source->'facts'->>'currencyScale')::integer,
      CASE WHEN e.review->>'sourceDigest'=e.source->>'digest' THEN 'completed' ELSE 'open' END,
      CASE WHEN e.review->>'sourceDigest'=e.source->>'digest' THEN 'expense_reviewed' ELSE 'expense_review' END
    FROM expenses e
  ), scoped AS MATERIALIZED (
    SELECT * FROM observed o
    WHERE (a_kind='all' OR o.kind=a_kind) AND (a_search='' OR strpos(lower(o.title),lower(a_search))>0)
      AND (a_period.id IS NULL OR o.date BETWEEN a_period.starts_on::text AND a_period.ends_on::text)
  ), anchor AS (
    SELECT * FROM scoped WHERE key=a_after
  ), filtered AS MATERIALIZED (
    SELECT * FROM scoped WHERE a_status='all' OR state=a_status
  ), candidates AS MATERIALIZED (
    SELECT f.* FROM filtered f WHERE a_after IS NULL
      OR (a_sort='newest' AND (f.updated::timestamptz,f.key COLLATE "C")<(SELECT updated::timestamptz,key COLLATE "C" FROM anchor))
      OR (a_sort='oldest' AND (f.updated::timestamptz,f.key COLLATE "C")>(SELECT updated::timestamptz,key COLLATE "C" FROM anchor))
    ORDER BY CASE WHEN a_sort='newest' THEN updated::timestamptz END DESC,CASE WHEN a_sort='newest' THEN key END COLLATE "C" DESC,
      CASE WHEN a_sort='oldest' THEN updated::timestamptz END,CASE WHEN a_sort='oldest' THEN key END COLLATE "C" LIMIT 51
  ), numbered AS (
    SELECT c.*,row_number() OVER(ORDER BY CASE WHEN a_sort='newest' THEN updated::timestamptz END DESC,CASE WHEN a_sort='newest' THEN key END COLLATE "C" DESC,
      CASE WHEN a_sort='oldest' THEN updated::timestamptz END,CASE WHEN a_sort='oldest' THEN key END COLLATE "C") ordinal FROM candidates c
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('key',n.key,'kind',n.kind,'id',n.id,'revision',n.revision,
      'title',n.title,'date',n.date,'updatedAt',n.updated,'amountMinor',n.amount,'currency',n.currency,'currencyScale',n.scale,'state',n.state,'reason',n.reason) ORDER BY n.ordinal) FILTER(WHERE n.ordinal<=50),'[]'),
      CASE WHEN (SELECT count(*) FROM candidates)>50 THEN (SELECT key FROM numbered WHERE ordinal=50) END,
      (SELECT count(*)::text FROM filtered),
      (SELECT jsonb_build_object('open',count(*) FILTER(WHERE state='open')::text,'completed',count(*) FILTER(WHERE state='completed')::text) FROM scoped),
      (SELECT jsonb_build_object('key',key) FROM anchor)
    INTO a_items,a_next,a_total,a_counts,a_anchor FROM numbered n;
  IF a_after IS NOT NULL AND a_anchor IS NULL THEN
    PERFORM openerp.fail('NotFound','The continuation is no longer in this work list. Return to the first page.'); END IF;
  RETURN jsonb_build_object('scope',scope,'checkedAt',a_checked,'coverage','journals_invoice_drafts_expense_reviews',
    'filters',jsonb_build_object('kind',a_kind,'status',a_status,'period',filters->>'period','sort',a_sort,'q',a_search),
    'counts',a_counts,'total',a_total,'items',a_items,'next',a_next);
END $$;
REVOKE ALL ON FUNCTION openerp.workspace_attention(text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.workspace_attention(text,jsonb,jsonb) TO openerp_runtime;
