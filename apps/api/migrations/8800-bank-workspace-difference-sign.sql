-- Use bank minus ledger, matching the retained reconciliation report.
-- Current read model for the account workspace. Existing matching functions own capacity.
CREATE OR REPLACE FUNCTION openerp.bank_workspace(p_token text,p_scope jsonb,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE b openerp.books; d_from date; d_to date; d_account text:=p_query->>'accountId';
 d_view text:=coalesce(p_query->>'view','unmatched'); d_page integer; d_search text:=lower(coalesce(p_query->>'q',''));
 d_accounts jsonb; d_rows jsonb; d_counts jsonb; d_total integer; d_reviews jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT * INTO STRICT b FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
 d_from:=openerp.bank_date(p_query->>'startsOn'); d_to:=openerp.bank_date(p_query->>'endsOn');
 IF d_from>d_to OR d_view NOT IN ('unmatched','all','matched','ledger') OR length(d_search)>200
  OR coalesce(p_query->>'page','1') !~ '^[1-9][0-9]{0,5}$' THEN
  PERFORM openerp.fail('InvalidJournal','Choose a valid account view and date interval.'); END IF;
 d_page:=coalesce(p_query->>'page','1')::integer;
 IF d_account IS NOT NULL AND NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=b.id AND s.account_id=d_account) THEN
  PERFORM openerp.fail('NotFound','This bank account is not available in this book.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,'code',a.code,'name',a.name,'active',a.active,'sourceName',s.source_bank_account_id,
  'statementId',st.id,'statementDate',st.ends_on::text,'statementBalanceMinor',st.source->>'closingMinor',
  'ledgerBalanceMinor',l.balance::text,
  'differenceMinor',CASE WHEN st.ends_on=d_to THEN ((st.source->>'closingMinor')::numeric-l.balance)::text END,
  'statementCount',(SELECT count(*) FROM openerp.bank_observations o JOIN openerp.bank_statements bs ON (bs.book_id,bs.id)=(o.book_id,o.statement_id)
    WHERE o.book_id=b.id AND bs.account_id=a.id AND o.observed_on BETWEEN d_from AND d_to),
  'unmatchedCount',(SELECT count(*) FROM openerp.bank_observations o JOIN openerp.bank_statements bs ON (bs.book_id,bs.id)=(o.book_id,o.statement_id)
    WHERE o.book_id=b.id AND bs.account_id=a.id AND o.observed_on BETWEEN d_from AND d_to AND o.amount_minor<>openerp.bank_allocated_source(b.id,o.statement_id,o.row_ordinal)),
  'unmatchedLedgerCount',(SELECT count(*) FROM openerp.journal_lines jl JOIN openerp.vouchers v ON (v.book_id,v.id)=(jl.book_id,jl.voucher_id)
    WHERE jl.book_id=b.id AND jl.account_id=a.id AND v.posting_date BETWEEN d_from AND d_to AND v.sequence<=b.committed_sequence
    AND jl.debit_minor-jl.credit_minor<>openerp.bank_allocated_line(b.id,jl.voucher_id,jl.id))
 ) ORDER BY a.code),'[]') INTO d_accounts
 FROM openerp.bank_sources s JOIN openerp.accounts a ON (a.book_id,a.id)=(s.book_id,s.account_id)
 LEFT JOIN LATERAL (SELECT bs.* FROM openerp.bank_statements bs WHERE bs.book_id=b.id AND bs.account_id=a.id AND bs.ends_on<=d_to ORDER BY bs.ends_on DESC,bs.id DESC LIMIT 1) st ON true
 CROSS JOIN LATERAL (SELECT coalesce(sum(jl.debit_minor-jl.credit_minor),0) balance FROM openerp.journal_lines jl JOIN openerp.vouchers v ON (v.book_id,v.id)=(jl.book_id,jl.voucher_id)
  WHERE jl.book_id=b.id AND jl.account_id=a.id AND v.posting_date<=d_to AND v.sequence<=b.committed_sequence) l
 WHERE s.book_id=b.id;
 WITH activity AS MATERIALIZED (
  SELECT o.statement_id||':'||o.row_ordinal::text id,o.observed_on date,o.description,o.amount_minor amount,
   openerp.bank_allocated_source(b.id,o.statement_id,o.row_ordinal) allocated,o.statement_id,o.row_ordinal,NULL::text voucher_id,NULL::text line_id,false ledger
  FROM openerp.bank_observations o JOIN openerp.bank_statements bs ON (bs.book_id,bs.id)=(o.book_id,o.statement_id)
  WHERE o.book_id=b.id AND bs.account_id=d_account AND o.observed_on BETWEEN d_from AND d_to
  UNION ALL
  SELECT jl.voucher_id||':'||jl.id,v.posting_date,jl.description,jl.debit_minor-jl.credit_minor,
   openerp.bank_allocated_line(b.id,jl.voucher_id,jl.id),NULL::text,NULL::integer,jl.voucher_id,jl.id,true
  FROM openerp.journal_lines jl JOIN openerp.vouchers v ON (v.book_id,v.id)=(jl.book_id,jl.voucher_id)
  WHERE jl.book_id=b.id AND jl.account_id=d_account AND v.posting_date BETWEEN d_from AND d_to AND v.sequence<=b.committed_sequence
 ), searched AS (SELECT * FROM activity WHERE d_search='' OR position(d_search in lower(description))>0),
 filtered AS (SELECT * FROM searched WHERE CASE d_view WHEN 'ledger' THEN ledger WHEN 'all' THEN NOT ledger WHEN 'matched' THEN NOT ledger AND amount=allocated ELSE NOT ledger AND amount<>allocated END),
 paged AS (SELECT * FROM filtered ORDER BY date DESC,id LIMIT 50 OFFSET (d_page-1)*50)
 SELECT (SELECT count(*) FROM filtered),
  jsonb_build_object('all',count(*) FILTER(WHERE NOT ledger),'unmatched',count(*) FILTER(WHERE NOT ledger AND amount<>allocated),'matched',count(*) FILTER(WHERE NOT ledger AND amount=allocated),'ledger',count(*) FILTER(WHERE ledger)),
  (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'date',date::text,'description',description,'amountMinor',amount::text,'allocatedMinor',allocated::text,'remainingMinor',(amount-allocated)::text,
   'statementId',statement_id,'rowOrdinal',row_ordinal,'voucherId',voucher_id,'lineId',line_id) ORDER BY date DESC,id),'[]') FROM paged)
 INTO d_total,d_counts,d_rows FROM searched;
 SELECT coalesce(jsonb_agg(value ORDER BY created DESC),'[]') INTO d_reviews FROM (
  SELECT p.body->>'createdAt' created,jsonb_build_object('id',p.id,'reason',p.body->'input'->>'reason','createdAt',p.body->>'createdAt',
   'completed',EXISTS(SELECT FROM openerp.bank_allocation_executions e WHERE e.book_id=p.book_id AND e.plan_id=p.id)) value
  FROM openerp.bank_allocation_plans p WHERE p.book_id=b.id AND p.account_id=d_account
  AND EXISTS(SELECT FROM jsonb_array_elements(p.body->'snapshot'->'capacities') c WHERE (c->>'observedOn')::date BETWEEN d_from AND d_to)
  ORDER BY p.body->>'createdAt' DESC,p.id LIMIT 20
 ) recent;
 RETURN jsonb_build_object('scope',p_scope,'currency',b.currency,'currencyScale',b.currency_scale,'startsOn',d_from::text,'endsOn',d_to::text,
  'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'accounts',d_accounts,'total',d_total,'page',d_page,'pageSize',50,'counts',d_counts,'rows',d_rows,'reviews',d_reviews);
END $$;
REVOKE ALL ON FUNCTION openerp.bank_workspace(text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.bank_workspace(text,jsonb,jsonb) TO openerp_runtime;
