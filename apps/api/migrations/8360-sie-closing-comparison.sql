CREATE FUNCTION openerp.compare_sie_closing(p_token text,p_scope jsonb,p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE run openerp.sie_financial_runs; source openerp.sie_source_runs; plan openerp.sie_source_plans;
  year_end date; sequence bigint; items jsonb; balanced boolean;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  -- Hold the book barrier so the reported sequence and balances describe the same ledger.
  SELECT committed_sequence INTO sequence FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO run FROM openerp.sie_financial_runs WHERE book_id=p_scope->>'bookId' AND source_run_id=p_source;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Start a financial import before comparing closing balances.'); END IF;
  SELECT * INTO STRICT source FROM openerp.sie_source_runs WHERE book_id=run.book_id AND id=p_source;
  SELECT * INTO STRICT plan FROM openerp.sie_source_plans WHERE book_id=run.book_id AND id=source.plan_id;
  SELECT ends_on INTO STRICT year_end FROM openerp.fiscal_years WHERE book_id=run.book_id AND id=run.fiscal_year_id;
  WITH expected AS (
    SELECT m->>'accountId' account_id,sum((c->>'independentClosingMinor')::numeric) balance
    FROM jsonb_array_elements(plan.body->'input'->'openingControls') c
    JOIN LATERAL jsonb_array_elements(plan.body->'input'->'mappings') m ON m->>'sourceAccount'=c->>'sourceAccount'
    GROUP BY m->>'accountId'
  ), actual AS (
    SELECT l.account_id,sum(l.debit_minor-l.credit_minor) balance FROM openerp.journal_lines l
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    WHERE l.book_id=run.book_id AND v.posting_date<=year_end GROUP BY l.account_id
  ), compared AS (
    SELECT coalesce(e.account_id,a.account_id) account_id,coalesce(e.balance,0) expected,
      coalesce(a.balance,0) actual FROM expected e FULL JOIN actual a USING(account_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',c.account_id,'code',a.code,
    'expectedMinor',c.expected::text,'actualMinor',c.actual::text,'differenceMinor',(c.actual-c.expected)::text)
    ORDER BY a.code,c.account_id),'[]'::jsonb),coalesce(bool_and(c.expected=c.actual),false)
    INTO items,balanced FROM compared c JOIN openerp.accounts a ON a.book_id=run.book_id AND a.id=c.account_id;
  RETURN jsonb_build_object('scope',p_scope,'sourceRunId',p_source,'sourcePlanId',plan.id,
    'fiscalYearId',run.fiscal_year_id,'asOf',year_end::text,'bookSequence',sequence::text,
    'postingComplete',run.status='posted','balanced',balanced,'items',items);
END $$;
REVOKE ALL ON FUNCTION openerp.compare_sie_closing(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.compare_sie_closing(text,jsonb,text) TO openerp_runtime;
