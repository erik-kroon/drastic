-- Retain scale only for newly captured reports; old headers/receipts/lines are untouched.
-- The sole prepare_report change from0120 is the currencyScale field in its saved header.
CREATE OR REPLACE FUNCTION openerp.prepare_report(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; book openerp.books; start_date date; end_date date;
  report_id text; result jsonb; account_count bigint; voucher_count bigint; debit numeric; credit numeric;
BEGIN
  actor := openerp.authorize(token, scope);
  SELECT * INTO book FROM openerp.books WHERE id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(book.id, key, actor, 'prepare_report', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  IF coalesce(input->>'kind', '') <> 'trial_balance_v1' OR book.profile <> 'synthetic-core-v1' THEN
    PERFORM openerp.fail('UnsupportedProfile', 'Only synthetic internal trial balances are implemented.');
  END IF;
  BEGIN
    IF coalesce(input->>'startsOn','') !~ '^\d{4}-\d{2}-\d{2}$'
      OR coalesce(input->>'endsOn','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      PERFORM openerp.fail('InvalidJournal', 'Supply a valid report date interval.');
    END IF;
    start_date := (input->>'startsOn')::date; end_date := (input->>'endsOn')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    PERFORM openerp.fail('InvalidJournal', 'Supply valid report dates.');
  END;
  IF start_date > end_date THEN PERFORM openerp.fail('InvalidJournal', 'The report start must not follow its end.'); END IF;
  report_id := openerp.new_id('report');
  SELECT count(*) INTO account_count FROM openerp.accounts a WHERE a.book_id = book.id;
  SELECT count(*) INTO voucher_count FROM openerp.vouchers v WHERE v.book_id = book.id
    AND v.sequence <= book.committed_sequence AND v.posting_date BETWEEN start_date AND end_date;
  SELECT coalesce(sum(l.debit_minor),0), coalesce(sum(l.credit_minor),0) INTO debit, credit
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    WHERE v.book_id=book.id AND v.sequence<=book.committed_sequence AND v.posting_date BETWEEN start_date AND end_date;
  result := jsonb_build_object('kind', 'trial_balance_v1', 'id', report_id, 'scope', scope,
    'startsOn', start_date::text, 'endsOn', end_date::text, 'sequence', book.committed_sequence::text,
    'currency', book.currency, 'currencyScale', book.currency_scale, 'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'accountCount', account_count, 'voucherCount', voucher_count, 'debitMinor', debit::text,
    'creditMinor', credit::text, 'balanced', debit=credit, 'coverage', 'not_established',
    'warnings', jsonb_build_array('Internal synthetic trial balance only; not a statutory financial statement.',
      'A balanced ledger does not establish complete source records, tax correctness or period readiness.',
      'Opening balances include all earlier postings; no fiscal-year profit transfer is inferred.'));
  INSERT INTO openerp.report_snapshots VALUES (book.id, report_id, start_date, end_date, book.committed_sequence, result);
  INSERT INTO openerp.report_lines(book_id,report_id,account_id,body)
    SELECT book.id, report_id, a.id, jsonb_build_object('accountId',a.id,'code',a.code,'name',a.name,
      'openingMinor',coalesce(t.opening,0)::text,'debitMinor',coalesce(t.debit,0)::text,
      'creditMinor',coalesce(t.credit,0)::text,'closingMinor',(coalesce(t.opening,0)+coalesce(t.debit,0)-coalesce(t.credit,0))::text)
    FROM openerp.accounts a LEFT JOIN (
      SELECT l.account_id,
        sum(l.debit_minor-l.credit_minor) FILTER (WHERE v.posting_date < start_date) AS opening,
        sum(l.debit_minor) FILTER (WHERE v.posting_date >= start_date) AS debit,
        sum(l.credit_minor) FILTER (WHERE v.posting_date >= start_date) AS credit
      FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
      WHERE v.book_id=book.id AND v.sequence<=book.committed_sequence AND v.posting_date<=end_date
      GROUP BY l.account_id
    ) t ON t.account_id=a.id WHERE a.book_id=book.id;
  RETURN openerp.save_command(book.id,key,actor,'prepare_report',input,result);
END $$;

-- END-03 read-only arithmetic over two complete immutable saved trial balances.
-- No live account/voucher reads, reviewed opening assertion, statutory comparability or writes.
CREATE FUNCTION openerp.compare_reports(p_token text,p_scope jsonb,p_left text,p_right text,p_after text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_left jsonb; v_right jsonb; v_header jsonb; v_id text; v_totals jsonb; v_digest text;
  v_left_totals jsonb; v_right_totals jsonb; v_left_digest text; v_right_digest text;
  v_counts jsonb; v_difference jsonb; v_page jsonb; v_anchor text:=''; v_count integer;
BEGIN
  -- The existing owner authorizes both IDs against the supplied book before any comparison.
  v_left:=openerp.get_report(p_token,p_scope,p_left);
  v_right:=openerp.get_report(p_token,p_scope,p_right);
  IF v_left->>'kind' IS DISTINCT FROM 'trial_balance_v1' OR v_right->>'kind' IS DISTINCT FROM 'trial_balance_v1' THEN
    PERFORM openerp.fail('UnsupportedProfile','Compare only saved synthetic trial-balance snapshots.'); END IF;
  IF jsonb_typeof(v_left->'currencyScale') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_right->'currencyScale') IS DISTINCT FROM 'number' THEN
    PERFORM openerp.fail('UnsupportedProfile','Both saved snapshots must retain currency scale. Historical scale is not inferred from the current book.'); END IF;
  IF v_left->>'currency' IS DISTINCT FROM v_right->>'currency'
    OR v_left->'currencyScale' IS DISTINCT FROM v_right->'currencyScale' THEN
    PERFORM openerp.fail('UnsupportedProfile','Saved report currencies and scales must agree. No conversion or rescaling is performed.'); END IF;
  -- Complete source aggregation is bounded separately from paging; no partial digest/totals.
  FOREACH v_id IN ARRAY ARRAY[p_left,p_right] LOOP
    SELECT count(*) INTO v_count FROM (SELECT 1 FROM openerp.report_lines l
      WHERE l.book_id=p_scope->>'bookId' AND l.report_id=v_id LIMIT 10001) bounded;
    IF v_count>10000 THEN PERFORM openerp.fail('UnsupportedProfile','Comparison supports 10000 complete account lines per saved report. No partial financial totals are returned.'); END IF;
    v_header:=CASE WHEN v_id=p_left THEN v_left ELSE v_right END;
    IF v_count IS DISTINCT FROM (v_header->>'accountCount')::integer
      OR EXISTS(SELECT FROM openerp.report_lines l WHERE l.book_id=p_scope->>'bookId' AND l.report_id=v_id
        AND (l.body->>'accountId' IS DISTINCT FROM l.account_id
          OR (l.body->>'closingMinor')::numeric<>(l.body->>'openingMinor')::numeric+(l.body->>'debitMinor')::numeric-(l.body->>'creditMinor')::numeric)) THEN
      PERFORM openerp.fail('InvalidJournal','The saved report line inventory or closing formula is inconsistent.'); END IF;
    SELECT jsonb_build_object('openingMinor',coalesce(sum((l.body->>'openingMinor')::numeric),0)::text,
      'debitMinor',coalesce(sum((l.body->>'debitMinor')::numeric),0)::text,
      'creditMinor',coalesce(sum((l.body->>'creditMinor')::numeric),0)::text,
      'movementMinor',coalesce(sum((l.body->>'debitMinor')::numeric-(l.body->>'creditMinor')::numeric),0)::text,
      'closingMinor',coalesce(sum((l.body->>'closingMinor')::numeric),0)::text),
      openerp.digest(jsonb_build_object('header',v_header,'lines',coalesce(jsonb_agg(
        jsonb_build_object('accountId',l.account_id,'digest',openerp.digest(l.body)) ORDER BY l.account_id COLLATE "C"),'[]')))
      INTO v_totals,v_digest FROM openerp.report_lines l WHERE l.book_id=p_scope->>'bookId' AND l.report_id=v_id;
    IF v_totals->>'debitMinor' IS DISTINCT FROM v_header->>'debitMinor'
      OR v_totals->>'creditMinor' IS DISTINCT FROM v_header->>'creditMinor' THEN
      PERFORM openerp.fail('InvalidJournal','The saved complete line totals do not match the report header.'); END IF;
    IF v_id=p_left THEN v_left_totals:=v_totals;v_left_digest:=v_digest; END IF;
    IF v_id=p_right THEN v_right_totals:=v_totals;v_right_digest:=v_digest; END IF;
  END LOOP;
  IF coalesce(p_after,'')<>'' THEN
    IF p_after!~'^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$'
      OR split_part(p_after,':',1) IS DISTINCT FROM p_left OR split_part(p_after,':',2) IS DISTINCT FROM p_right THEN
      PERFORM openerp.fail('InvalidJournal','Use a comparison cursor for these exact left and right saved reports.'); END IF;
    v_anchor:=split_part(p_after,':',3);
    IF NOT EXISTS(SELECT FROM openerp.report_lines l WHERE l.book_id=p_scope->>'bookId' AND l.report_id IN(p_left,p_right) AND l.account_id=v_anchor) THEN
      PERFORM openerp.fail('InvalidJournal','The cursor must identify a retained account in this report pair.'); END IF;
  END IF;
  WITH all_accounts AS MATERIALIZED (
    SELECT coalesce(l.account_id,r.account_id) account_id,l.body left_body,r.body right_body
      FROM (SELECT account_id,body FROM openerp.report_lines WHERE book_id=p_scope->>'bookId' AND report_id=p_left) l
      FULL JOIN (SELECT account_id,body FROM openerp.report_lines WHERE book_id=p_scope->>'bookId' AND report_id=p_right) r USING(account_id)
  ), page AS MATERIALIZED (
    SELECT * FROM all_accounts WHERE account_id COLLATE "C">v_anchor COLLATE "C" ORDER BY account_id COLLATE "C" LIMIT 101
  ), shown AS (
    SELECT * FROM page ORDER BY account_id COLLATE "C" LIMIT 100
  )
  SELECT jsonb_build_object('totalAccounts',(SELECT count(*) FROM all_accounts),
      'bothPresentCount',(SELECT count(*) FROM all_accounts WHERE left_body IS NOT NULL AND right_body IS NOT NULL),
      'leftOnlyCount',(SELECT count(*) FROM all_accounts WHERE right_body IS NULL),
      'rightOnlyCount',(SELECT count(*) FROM all_accounts WHERE left_body IS NULL)),
    jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('accountId',s.account_id,
      'presence',CASE WHEN s.left_body IS NULL THEN 'right_only' WHEN s.right_body IS NULL THEN 'left_only' ELSE 'both' END,
      'left',CASE WHEN s.left_body IS NULL THEN NULL ELSE s.left_body||jsonb_build_object('movementMinor',
        ((s.left_body->>'debitMinor')::numeric-(s.left_body->>'creditMinor')::numeric)::text) END,
      'right',CASE WHEN s.right_body IS NULL THEN NULL ELSE s.right_body||jsonb_build_object('movementMinor',
        ((s.right_body->>'debitMinor')::numeric-(s.right_body->>'creditMinor')::numeric)::text) END,
      'labelsChanged',CASE WHEN s.left_body IS NULL OR s.right_body IS NULL THEN NULL ELSE
        (s.left_body->>'code',s.left_body->>'name') IS DISTINCT FROM (s.right_body->>'code',s.right_body->>'name') END,
      'difference',CASE WHEN s.left_body IS NULL OR s.right_body IS NULL THEN NULL ELSE jsonb_build_object(
        'openingMinor',((s.right_body->>'openingMinor')::numeric-(s.left_body->>'openingMinor')::numeric)::text,
        'debitMinor',((s.right_body->>'debitMinor')::numeric-(s.left_body->>'debitMinor')::numeric)::text,
        'creditMinor',((s.right_body->>'creditMinor')::numeric-(s.left_body->>'creditMinor')::numeric)::text,
        'movementMinor',((s.right_body->>'debitMinor')::numeric-(s.right_body->>'creditMinor')::numeric
          -(s.left_body->>'debitMinor')::numeric+(s.left_body->>'creditMinor')::numeric)::text,
        'closingMinor',((s.right_body->>'closingMinor')::numeric-(s.left_body->>'closingMinor')::numeric)::text) END
      ) ORDER BY s.account_id COLLATE "C"),'[]'),
      'next',CASE WHEN (SELECT count(*) FROM page)>100 THEN
        p_left||':'||p_right||':'||(SELECT account_id FROM shown ORDER BY account_id COLLATE "C" DESC LIMIT 1) ELSE NULL END)
    INTO v_counts,v_page FROM shown s;
  IF v_counts->>'leftOnlyCount'='0' AND v_counts->>'rightOnlyCount'='0' THEN
    v_difference:=jsonb_build_object(
      'openingMinor',((v_right_totals->>'openingMinor')::numeric-(v_left_totals->>'openingMinor')::numeric)::text,
      'debitMinor',((v_right_totals->>'debitMinor')::numeric-(v_left_totals->>'debitMinor')::numeric)::text,
      'creditMinor',((v_right_totals->>'creditMinor')::numeric-(v_left_totals->>'creditMinor')::numeric)::text,
      'movementMinor',((v_right_totals->>'movementMinor')::numeric-(v_left_totals->>'movementMinor')::numeric)::text,
      'closingMinor',((v_right_totals->>'closingMinor')::numeric-(v_left_totals->>'closingMinor')::numeric)::text);
  END IF;
  RETURN v_counts||v_page||jsonb_build_object('left',jsonb_build_object('report',v_left,'digest',v_left_digest,'digestScope','saved_header_and_account_lines'),
    'right',jsonb_build_object('report',v_right,'digest',v_right_digest,'digestScope','saved_header_and_account_lines'),
    'currency',v_left->>'currency','currencyScale',v_left->'currencyScale','order','account_identity',
    'differenceFormula','difference = right - left','movementFormula','movement = debits - credits','closingFormula','closing = opening + debits - credits',
    'sameInterval',(v_left->>'startsOn',v_left->>'endsOn') IS NOT DISTINCT FROM (v_right->>'startsOn',v_right->>'endsOn'),
    'sameCutoff',v_left->>'sequence'=v_right->>'sequence','totals',jsonb_build_object('left',v_left_totals,'right',v_right_totals,'difference',v_difference),
    'interpretation','saved_snapshot_arithmetic_only','coverage','not_established','reviewedOpening',false,'statutoryComparability',false,'financialCloseReady',false,
    'warnings',jsonb_build_array('Differences are right minus left over saved minor units, not approved prior-year comparatives or financial-close results.',
      'Different intervals and cutoffs remain visible; equal dates or cutoffs do not establish like-for-like source completeness.',
      'Missing account sides and their differences are null, never zero. Full-total difference is unavailable when account identity sets differ.',
      'Frozen account codes and names can differ. Identity, not labels, aligns accounts; no new, renamed or absent account is guessed equivalent.',
      'Opening amounts include earlier postings in each saved report, not a reviewed OpeningSet or inferred fiscal-year transfer.'));
END $$;
REVOKE ALL ON FUNCTION openerp.compare_reports(text,jsonb,text,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.compare_reports(text,jsonb,text,text,text) TO openerp_runtime;
