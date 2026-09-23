-- One read projection across draft and registered customer invoices. Domain functions own balances and state.
CREATE FUNCTION openerp.sales_register(p_token text,p_scope jsonb,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_query text:=btrim(coalesce(p_query->>'q','')); s_status text:=coalesce(p_query->>'status','all');
 s_sort text:=coalesce(p_query->>'sort','newest'); s_page integer; s_result jsonb;
 s_today date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 IF length(s_query)>200 OR s_status NOT IN ('all','draft','open','overdue','settled','cancelled')
  OR s_sort NOT IN ('newest','oldest','customer','due')
  OR coalesce(p_query->>'page','1') !~ '^[1-9][0-9]{0,5}$' THEN
  PERFORM openerp.fail('InvalidJournal','Choose a supported invoice view, sort and page.');
 END IF;
 s_page:=coalesce(p_query->>'page','1')::integer;
 WITH registered AS MATERIALIZED (
  SELECT i.id,openerp.commerce_invoice_body(i.book_id,i.id) body,
   issued.draft_id,issued.review_id
  FROM openerp.commerce_invoices i
  LEFT JOIN openerp.invoice_issues issued ON issued.book_id=i.book_id AND issued.register_invoice_id=i.id
  WHERE i.book_id=p_scope->>'bookId' AND i.direction='customer'
 ), entries AS MATERIALIZED (
  SELECT jsonb_build_object('id',d.id,'kind','draft','title',r.body->'content'->>'title','number',NULL,
   'customer',r.body->'content'->'customer'->>'legalName','date',r.body->>'createdAt',
   'dueOn',r.body->'content'->'dueDate','currency',r.body->'content'->>'currency',
   'currencyScale',r.body->'content'->'currencyScale','amountMinor',r.body->'totals'->'grossMinor',
   'outstandingMinor',NULL,'status','draft','needsDetails',EXISTS(
    SELECT FROM jsonb_array_elements(r.body->'blockers') blocker
    WHERE blocker->>'code' NOT IN ('issuance_not_implemented','legal_identity_not_verified','tax_profile_not_activated')),
   'overdue',false,'draftId',d.id,'issueReviewId',NULL) row
  FROM openerp.invoice_drafts d JOIN openerp.invoice_draft_revisions r
   ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision
  WHERE d.book_id=p_scope->>'bookId' AND NOT EXISTS(
   SELECT FROM openerp.invoice_issues issued WHERE issued.book_id=d.book_id AND issued.draft_id=d.id)
  UNION ALL
  SELECT jsonb_build_object('id',i.id,'kind','invoice','title',i.body->'currentRevision'->>'description',
   'number',i.body->>'documentNumber','customer',i.body->>'counterpartyName','date',i.body->>'issuedOn',
   'dueOn',i.body->'currentRevision'->'dueOn','currency',i.body->>'currency','currencyScale',i.body->'currencyScale',
   'amountMinor',i.body->'amountMinor','outstandingMinor',i.body->'outstandingMinor','status',i.body->>'status',
   'needsDetails',i.body->>'status'='blocked',
   'overdue',coalesce(i.body->>'status' IN ('open','partially_allocated')
     AND (i.body->'currentRevision'->>'dueOn')::date<s_today,false),
   'draftId',i.draft_id,'issueReviewId',i.review_id) row
  FROM registered i
 ), searched AS MATERIALIZED (
  SELECT e.row FROM entries e WHERE s_query='' OR position(lower(s_query) IN
   lower(concat_ws(' ',e.row->>'title',e.row->>'number',e.row->>'customer')))>0
 ), filtered AS MATERIALIZED (
  SELECT e.row FROM searched e WHERE s_status='all'
   OR (s_status='draft' AND e.row->>'kind'='draft')
   OR (s_status='open' AND e.row->>'status' IN ('open','partially_allocated','blocked'))
   OR (s_status='overdue' AND (e.row->>'overdue')::boolean)
   OR (s_status='settled' AND e.row->>'status'='allocated')
   OR (s_status='cancelled' AND e.row->>'status'='cancelled')
 ), ordered AS (
  SELECT f.row,row_number() OVER (ORDER BY
   CASE WHEN s_sort='customer' THEN lower(f.row->>'customer') END COLLATE "C" ASC,
   CASE WHEN s_sort='due' THEN f.row->>'dueOn' END ASC NULLS LAST,
   CASE WHEN s_sort='oldest' THEN f.row->>'date' END ASC,
   CASE WHEN s_sort='newest' THEN f.row->>'date' END DESC,
   f.row->>'id' COLLATE "C") ordinal FROM filtered f
 ), page AS (
  SELECT o.row,o.ordinal FROM ordered o WHERE o.ordinal>(s_page-1)*50 AND o.ordinal<=s_page*50
 )
 SELECT jsonb_build_object('scope',p_scope,'checkedAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'asOf',s_today::text,'page',s_page,'pageSize',50,'total',(SELECT count(*) FROM filtered),
  'counts',(SELECT jsonb_build_object('all',count(*),'draft',count(*) FILTER(WHERE e.row->>'kind'='draft'),
   'open',count(*) FILTER(WHERE e.row->>'status' IN ('open','partially_allocated','blocked')),
   'overdue',count(*) FILTER(WHERE (e.row->>'overdue')::boolean),
   'settled',count(*) FILTER(WHERE e.row->>'status'='allocated'),
   'cancelled',count(*) FILTER(WHERE e.row->>'status'='cancelled')) FROM searched e),
  'items',coalesce((SELECT jsonb_agg(p.row ORDER BY p.ordinal) FROM page p),'[]'::jsonb)) INTO s_result;
 RETURN s_result;
END $$;
REVOKE ALL ON FUNCTION openerp.sales_register(text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.sales_register(text,jsonb,jsonb) TO openerp_runtime;
