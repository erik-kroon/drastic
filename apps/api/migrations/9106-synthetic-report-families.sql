CREATE FUNCTION openerp.report_family_lines(p_book text,p_report text,p_family text,p_mapping jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH role_map AS (
    SELECT m->>'accountId' AS account_id,m->>'role' AS role_name
    FROM jsonb_array_elements(p_mapping->'roles') m
  ), allowed AS (
    SELECT *
    FROM (VALUES
      ('revenue','Revenue',10,'credit'),
      ('other_income','Other income',20,'credit'),
      ('cost_of_sales','Cost of sales',30,'debit'),
      ('operating_expense','Operating expenses',40,'debit'),
      ('other_expense','Other expenses',50,'debit'),
      ('income_tax','Income tax',60,'debit'),
      ('cash_and_cash_equivalents','Cash and cash equivalents',10,'debit'),
      ('accounts_receivable','Accounts receivable',20,'debit'),
      ('inventory','Inventory',30,'debit'),
      ('other_current_assets','Other current assets',40,'debit'),
      ('property_plant_and_equipment','Property, plant and equipment',50,'debit'),
      ('other_non_current_assets','Other non-current assets',60,'debit'),
      ('accounts_payable','Accounts payable',70,'credit'),
      ('accrued_liabilities','Accrued liabilities',80,'credit'),
      ('tax_liabilities','Tax liabilities',90,'credit'),
      ('other_current_liabilities','Other current liabilities',100,'credit'),
      ('long_term_debt','Long-term debt',110,'credit'),
      ('other_non_current_liabilities','Other non-current liabilities',120,'credit'),
      ('equity','Equity',130,'credit'),
      ('operating_cash_inflow','Operating cash inflow',10,'credit'),
      ('operating_cash_outflow','Operating cash outflow',20,'debit'),
      ('investing_cash_inflow','Investing cash inflow',30,'credit'),
      ('investing_cash_outflow','Investing cash outflow',40,'debit'),
      ('financing_cash_inflow','Financing cash inflow',50,'credit'),
      ('financing_cash_outflow','Financing cash outflow',60,'debit')
    ) AS values(role_name,label,ord,side)
    WHERE role_name='excluded'
      OR (p_family='profit_and_loss' AND role_name IN ('revenue','other_income','cost_of_sales','operating_expense','other_expense','income_tax'))
      OR (p_family='balance_sheet' AND role_name IN ('cash_and_cash_equivalents','accounts_receivable','inventory','other_current_assets','property_plant_and_equipment','other_non_current_assets','accounts_payable','accrued_liabilities','tax_liabilities','other_current_liabilities','long_term_debt','other_non_current_liabilities','equity'))
      OR (p_family='cash_flow' AND role_name IN ('operating_cash_inflow','operating_cash_outflow','investing_cash_inflow','investing_cash_outflow','financing_cash_inflow','financing_cash_outflow'))
  ), grouped AS (
    SELECT a.role_name,a.label,a.ord,a.side,
      coalesce(jsonb_agg(l.account_id ORDER BY l.account_id COLLATE "C") FILTER (WHERE l.account_id IS NOT NULL),'[]'::jsonb) AS account_ids,
      coalesce(sum((l.body->>'openingMinor')::numeric),0) AS opening_minor,
      coalesce(sum((l.body->>'debitMinor')::numeric-(l.body->>'creditMinor')::numeric),0) AS movement_minor,
      coalesce(sum((l.body->>'closingMinor')::numeric),0) AS closing_minor
    FROM allowed a
    LEFT JOIN role_map m ON m.role_name=a.role_name
    LEFT JOIN openerp.report_lines l ON l.book_id=p_book AND l.report_id=p_report AND l.account_id=m.account_id
    GROUP BY a.role_name,a.label,a.ord,a.side
  ), calculated AS (
    SELECT g.*,CASE
      WHEN p_family='profit_and_loss' AND g.side='credit' THEN -g.movement_minor
      WHEN p_family IN ('profit_and_loss','cash_flow') AND g.side='debit' THEN g.movement_minor
      WHEN p_family='balance_sheet' AND g.side='credit' THEN -g.closing_minor
      ELSE g.closing_minor
    END AS amount_minor
    FROM grouped g
  ), totals AS (
    SELECT coalesce(sum(opening_minor),0) AS opening_minor,
      coalesce(sum(movement_minor),0) AS movement_minor,
      coalesce(sum(closing_minor),0) AS closing_minor,
      coalesce(sum(amount_minor),0) AS amount_minor
    FROM calculated
  )
  SELECT jsonb_build_object(
    'lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',c.role_name,'label',c.label,'accountIds',c.account_ids,
      'openingMinor',c.opening_minor::text,'movementMinor',c.movement_minor::text,
      'closingMinor',c.closing_minor::text,'amountMinor',c.amount_minor::text
    ) ORDER BY c.ord) FROM calculated c),'[]'::jsonb),
    'totals',jsonb_build_object(
      'openingMinor',t.opening_minor::text,'movementMinor',t.movement_minor::text,
      'closingMinor',t.closing_minor::text,'amountMinor',t.amount_minor::text
    )
  ) INTO v_result FROM totals t;
  RETURN v_result;
END $$;

CREATE FUNCTION openerp.get_report_family(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  report jsonb;
  family text;
  mapping jsonb;
  source_report_id text;
  family_lines jsonb;
BEGIN
  report:=openerp.get_report(token,scope,id);
  family:=report->>'family';
  mapping:=report->'mapping';
  source_report_id:=report->>'sourceReportId';
  IF family IS NULL OR family NOT IN ('profit_and_loss','balance_sheet','cash_flow') OR source_report_id IS NULL
    OR report->>'mappingDigest' IS NULL OR mapping IS NULL THEN
    PERFORM openerp.fail('UnsupportedProfile','The saved report is not a synthetic report-family snapshot.');
  END IF;
  IF mapping->>'version'<>'synthetic_report_mapping_v1' OR mapping->'reviewed' IS DISTINCT FROM 'true'::jsonb
    OR report->>'mappingDigest' IS DISTINCT FROM openerp.digest(mapping) THEN
    PERFORM openerp.fail('UnsupportedProfile','The saved report-family mapping is not explicitly reviewed.');
  END IF;
  family_lines:=openerp.report_family_lines(scope->>'bookId',id,family,mapping);
  RETURN jsonb_build_object(
    'report',report,'family',report->>'family','sourceReportId',source_report_id,
    'cutoff',jsonb_build_object('sequence',report->'sequence','startsOn',report->'startsOn','endsOn',report->'endsOn'),
    'mapping',mapping,'mappingDigest',report->>'mappingDigest',
    'lines',family_lines->'lines','totals',family_lines->'totals',
    'interpretation','synthetic_reviewed_mapping_only','coverage','not_established',
    'reviewedOpening',false,'statutory',false,'financialClose',false,
    'warnings',report->'warnings'
  );
END $$;

CREATE FUNCTION openerp.prepare_report_family(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  actor text;
  previous jsonb;
  book openerp.books;
  source openerp.report_snapshots;
  source_body jsonb;
  mapping jsonb;
  family text;
  report_id text;
  result jsonb;
  line_count bigint;
  mapping_count bigint;
  mapped_count bigint;
  role_entry jsonb;
  role_name text;
  mapping_digest text;
BEGIN
  actor:=openerp.authorize(token,scope);
  SELECT * INTO book FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(book.id,key,actor,'prepare_report_family',input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['kind','sourceReportId','mapping']<>'{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Supply exactly the report-family command fields.');
  END IF;
  family:=input->>'kind';
  IF family IS NULL OR family NOT IN ('profit_and_loss','balance_sheet','cash_flow') THEN
    PERFORM openerp.fail('UnsupportedProfile','Select a supported synthetic report family.');
  END IF;
  IF jsonb_typeof(input->'mapping') IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('UnsupportedProfile','This book has no explicit reviewed account-role mapping for the selected report family.');
  END IF;
  mapping:=input->'mapping';
  IF jsonb_typeof(mapping) IS NOT DISTINCT FROM 'object' THEN
    PERFORM openerp.commerce_exact_object(mapping,ARRAY['version','reviewed','roles']);
  END IF;
  IF mapping->>'version'<>'synthetic_report_mapping_v1' OR mapping->'reviewed' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(mapping->'roles') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('UnsupportedProfile','Use an explicit reviewed synthetic account-role mapping.');
  END IF;
  SELECT count(*) INTO mapping_count FROM jsonb_array_elements(mapping->'roles');
  IF mapping_count<1 OR mapping_count>500 THEN
    PERFORM openerp.fail('UnsupportedProfile','The synthetic report-family mapping is outside its complete bound.');
  END IF;
  FOR role_entry IN
    SELECT value FROM jsonb_array_elements(mapping->'roles')
  LOOP
    PERFORM openerp.commerce_exact_object(role_entry,ARRAY['accountId','role']);
    IF jsonb_typeof(role_entry->'accountId') IS DISTINCT FROM 'string'
      OR role_entry->>'accountId' !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR jsonb_typeof(role_entry->'role') IS DISTINCT FROM 'string' THEN
      PERFORM openerp.fail('InvalidJournal','Each mapping role needs an account identity and role.');
    END IF;
    role_name:=role_entry->>'role';
    IF role_name <> 'excluded'
      AND ((family='profit_and_loss' AND role_name NOT IN ('revenue','other_income','cost_of_sales','operating_expense','other_expense','income_tax'))
      OR (family='balance_sheet' AND role_name NOT IN ('cash_and_cash_equivalents','accounts_receivable','inventory','other_current_assets','property_plant_and_equipment','other_non_current_assets','accounts_payable','accrued_liabilities','tax_liabilities','other_current_liabilities','long_term_debt','other_non_current_liabilities','equity'))
      OR (family='cash_flow' AND role_name NOT IN ('operating_cash_inflow','operating_cash_outflow','investing_cash_inflow','investing_cash_outflow','financing_cash_inflow','financing_cash_outflow'))) THEN
      PERFORM openerp.fail('UnsupportedProfile','The mapping contains an account role that is not approved for this report family.');
    END IF;
  END LOOP;
  SELECT * INTO source FROM openerp.report_snapshots
    WHERE book_id=book.id AND id=input->>'sourceReportId';
  IF NOT FOUND THEN
    PERFORM openerp.fail('NotFound','The source trial-balance report was not found in this book.');
  END IF;
  source_body:=source.body;
  IF source_body->>'kind' IS DISTINCT FROM 'trial_balance_v1' OR book.profile IS DISTINCT FROM 'synthetic-core-v1' THEN
    PERFORM openerp.fail('UnsupportedProfile','Report families require a saved synthetic trial-balance source.');
  END IF;
  IF jsonb_typeof(source_body->'currencyScale') IS DISTINCT FROM 'number' THEN
    PERFORM openerp.fail('UnsupportedProfile','The source report has no retained currency scale. Historical scale is not inferred.');
  END IF;
  SELECT count(*) INTO line_count FROM openerp.report_lines
    WHERE book_id=book.id AND report_id=source.id;
  IF line_count<1 OR line_count>10000 THEN
    PERFORM openerp.fail('UnsupportedProfile','The source report account inventory is outside the complete report-family bound.');
  END IF;
  SELECT count(DISTINCT m->>'accountId') INTO mapped_count
    FROM jsonb_array_elements(mapping->'roles') m;
  IF mapping_count<>mapped_count OR mapped_count<>line_count
    OR EXISTS(SELECT FROM openerp.report_lines l WHERE l.book_id=book.id AND l.report_id=source.id
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(mapping->'roles') m WHERE m->>'accountId'=l.account_id))
    OR EXISTS(SELECT FROM jsonb_array_elements(mapping->'roles') m
      WHERE NOT EXISTS(SELECT FROM openerp.report_lines l WHERE l.book_id=book.id AND l.report_id=source.id AND l.account_id=m->>'accountId')) THEN
    PERFORM openerp.fail('UnsupportedProfile','The book has no complete approved account-role mapping for this saved source report.');
  END IF;
  report_id:=openerp.new_id('report');
  mapping_digest:=openerp.digest(mapping);
  result:=jsonb_build_object(
    'kind',family,'id',report_id,'scope',scope,'sourceReportId',source.id,'family',family,
    'startsOn',source.starts_on::text,'endsOn',source.ends_on::text,'sequence',source.sequence::text,
    'currency',source_body->'currency','currencyScale',source_body->'currencyScale',
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'accountCount',source_body->'accountCount','voucherCount',source_body->'voucherCount',
    'debitMinor',source_body->'debitMinor','creditMinor',source_body->'creditMinor',
    'balanced',source_body->'balanced','coverage','not_established',
    'mapping',mapping,'mappingDigest',mapping_digest,'reviewedOpening',false,'statutory',false,'financialClose',false,
    'warnings',jsonb_build_array(
      'Synthetic report family only; no statutory financial statement, reviewed opening or financial-close readiness is established.',
      'The report uses the saved source cutoff and explicit reviewed account-role mapping; no account classification is inferred.',
      'Contributing entries remain the existing fixed-cutoff journal-line lineage and require the saved source report interpretation.'
    )
  );
  INSERT INTO openerp.report_snapshots(book_id,id,starts_on,ends_on,sequence,body)
    VALUES(book.id,report_id,source.starts_on,source.ends_on,source.sequence,result);
  INSERT INTO openerp.report_lines(book_id,report_id,account_id,body)
    SELECT book.id,report_id,l.account_id,l.body
    FROM openerp.report_lines l
    WHERE l.book_id=book.id AND l.report_id=source.id;
  RETURN openerp.save_command(book.id,key,actor,'prepare_report_family',input,openerp.get_report_family(token,scope,report_id));
END $$;

REVOKE ALL ON FUNCTION openerp.report_family_lines(text,text,text,jsonb), openerp.get_report_family(text,jsonb,text),
  openerp.prepare_report_family(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_report_family(text,jsonb,text), openerp.prepare_report_family(text,jsonb,text,jsonb) TO openerp_runtime;

CREATE OR REPLACE FUNCTION openerp.list_reports(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF coalesce(p_after,'')<>'' AND p_after !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a valid report pagination identifier.');
  END IF;
  WITH page AS MATERIALIZED (
    SELECT r.id,r.body FROM openerp.report_snapshots r
    WHERE r.book_id=p_scope->>'bookId' AND r.body->>'kind'='trial_balance_v1'
      AND r.id COLLATE "C">coalesce(p_after,'') COLLATE "C"
    ORDER BY r.id COLLATE "C" LIMIT 51
  ), shown AS (
    SELECT * FROM page ORDER BY id COLLATE "C" LIMIT 50
  )
  SELECT jsonb_build_object(
    'items',coalesce(jsonb_agg(s.body ORDER BY s.id COLLATE "C"),'[]'::jsonb),
    'next',CASE WHEN (SELECT count(*) FROM page)>50 THEN max(s.id COLLATE "C") ELSE NULL END
  ) INTO v_result FROM shown s;
  RETURN v_result;
END $$;
