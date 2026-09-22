CREATE OR REPLACE FUNCTION openerp.reconcile_bank(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; b openerp.books; account text := input->>'accountId';
  starts date; ends date; statement openerp.bank_statements; last_end date; last_closing numeric;
  bank_open numeric; bank_close numeric; ledger_open numeric; ledger_close numeric;
  watermark bigint; account_sequence bigint; source_revision bigint;
  statements jsonb := '[]'; observations jsonb; ledger_lines jsonb; matches jsonb;
  unmatched_source jsonb; unmatched_ledger jsonb; differences jsonb := '[]'; gaps jsonb := '[]';
  result jsonb; report_id text := openerp.new_id('reconciliation'); report_status text;
BEGIN
  actor := openerp.authorize(token, scope);
  SELECT * INTO STRICT b FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(b.id, key, actor, 'reconcile_bank', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  PERFORM openerp.bank_require_profile(b.id);
  starts := openerp.bank_date(input->>'startsOn'); ends := openerp.bank_date(input->>'endsOn');
  IF starts > ends OR NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id = b.id AND a.id = account) THEN
    PERFORM openerp.fail('InvalidJournal', 'Choose a book account and an ordered date interval.');
  END IF;
  -- Partial statements cannot establish independent opening/closing checkpoints.
  IF EXISTS(SELECT FROM openerp.bank_statements s WHERE s.book_id = b.id AND s.account_id = account
    AND s.starts_on <= ends AND s.ends_on >= starts AND (s.starts_on < starts OR s.ends_on > ends)) THEN
    PERFORM openerp.fail('InvalidJournal', 'The report cuts through a statement. Use whole statement intervals; unsupported splits cannot prove coverage.');
  END IF;
  -- This synchronous report materializes every selected row; never return a partial report.
  IF (SELECT count(*) FROM (
    SELECT 1 FROM openerp.bank_observations o JOIN openerp.bank_statements s
      ON s.book_id=o.book_id AND s.id=o.statement_id
      WHERE s.book_id=b.id AND s.account_id=account AND s.starts_on>=starts AND s.ends_on<=ends
    UNION ALL
    SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
      WHERE l.book_id=b.id AND l.account_id=account AND v.posting_date BETWEEN starts AND ends
      AND v.sequence<=b.committed_sequence
    LIMIT 1001
  ) selected_rows)>1000 OR (SELECT count(*) FROM (
    SELECT 1 FROM openerp.bank_statements s WHERE s.book_id=b.id AND s.account_id=account
      AND s.starts_on>=starts AND s.ends_on<=ends LIMIT 101
  ) selected_statements)>100 THEN
    PERFORM openerp.fail('InvalidJournal', 'This synchronous reconciliation supports at most 1000 combined source/ledger rows and 100 statements. Select a smaller whole-statement interval; larger durable reports are not implemented.');
  END IF;
  watermark := b.committed_sequence;
  SELECT coalesce(s.revision, 0) INTO source_revision FROM openerp.bank_sources s WHERE s.book_id = b.id AND s.account_id = account;
  source_revision := coalesce(source_revision, 0);
  FOR statement IN SELECT s.* FROM openerp.bank_statements s WHERE s.book_id = b.id AND s.account_id = account
    AND s.starts_on >= starts AND s.ends_on <= ends ORDER BY s.starts_on, s.id LOOP
    statements := statements || jsonb_build_array(openerp.bank_statement_body(statement));
    IF last_end IS NULL THEN
      bank_open := (statement.source->>'openingMinor')::numeric;
      IF statement.starts_on <> starts THEN gaps := gaps || jsonb_build_array('No statement covers the start of the requested interval.'); END IF;
    ELSE
      IF statement.starts_on <> last_end + 1 THEN gaps := gaps || jsonb_build_array('There is a gap between retained statement intervals.'); END IF;
      IF (statement.source->>'openingMinor')::numeric <> last_closing THEN
        differences := differences || jsonb_build_array('Consecutive statement closing and opening balances differ.');
      END IF;
    END IF;
    IF statement.source->'completeness'->>'declaredComplete' <> 'true' THEN
      gaps := gaps || jsonb_build_array('Statement ' || statement.id || ' is explicitly declared incomplete.');
    END IF;
    bank_close := (statement.source->>'closingMinor')::numeric;
    last_closing := bank_close; last_end := statement.ends_on;
  END LOOP;
  IF last_end IS NULL THEN gaps := gaps || jsonb_build_array('No bank statement covers this interval.');
  ELSIF last_end <> ends THEN gaps := gaps || jsonb_build_array('No statement covers the end of the requested interval.'); END IF;

  SELECT coalesce(sum(l.debit_minor - l.credit_minor) FILTER (WHERE v.posting_date < starts), 0),
    coalesce(sum(l.debit_minor - l.credit_minor), 0), coalesce(max(v.sequence), 0)
    INTO ledger_open, ledger_close, account_sequence
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = b.id AND l.account_id = account AND v.posting_date <= ends AND v.sequence <= watermark;
  SELECT coalesce(jsonb_agg(jsonb_build_object('statementId', o.statement_id, 'evidenceId', s.evidence_id,
      'evidenceSha256', e.sha256, 'rowOrdinal', o.row_ordinal, 'providerId', o.provider_id,
      'date', o.observed_on::text, 'description', o.description, 'amountMinor', o.amount_minor::text)
      ORDER BY s.starts_on, o.row_ordinal), '[]') INTO observations
    FROM openerp.bank_observations o JOIN openerp.bank_statements s ON s.book_id = o.book_id AND s.id = o.statement_id
    JOIN openerp.evidence e ON e.book_id = s.book_id AND e.id = s.evidence_id
    WHERE s.book_id = b.id AND s.account_id = account AND s.starts_on >= starts AND s.ends_on <= ends;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId', v.id, 'lineId', l.id,
      'date', v.posting_date::text, 'sequence', v.sequence::text, 'description', l.description,
      'amountMinor', (l.debit_minor - l.credit_minor)::text) ORDER BY v.sequence, l.ordinal), '[]') INTO ledger_lines
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = b.id AND l.account_id = account AND v.posting_date BETWEEN starts AND ends AND v.sequence <= watermark;
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(m) ORDER BY s.starts_on, m.row_ordinal), '[]') INTO matches
    FROM openerp.bank_matches m JOIN openerp.bank_statements s ON s.book_id = m.book_id AND s.id = m.statement_id
    WHERE s.book_id = b.id AND s.account_id = account AND s.starts_on >= starts AND s.ends_on <= ends;
  SELECT coalesce(jsonb_agg(o.value ORDER BY o.ordinal), '[]') INTO unmatched_source
    FROM jsonb_array_elements(observations) WITH ORDINALITY o(value, ordinal)
    WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(matches) m WHERE m->>'statementId' = o.value->>'statementId' AND m->>'rowOrdinal' = o.value->>'rowOrdinal');
  SELECT coalesce(jsonb_agg(l.value ORDER BY l.ordinal), '[]') INTO unmatched_ledger
    FROM jsonb_array_elements(ledger_lines) WITH ORDINALITY l(value, ordinal)
    WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(matches) m WHERE m->>'voucherId' = l.value->>'voucherId' AND m->>'lineId' = l.value->>'lineId');
  IF bank_open IS NULL OR bank_close IS NULL THEN
    differences := differences || jsonb_build_array('Bank opening and closing balances are unavailable.');
  ELSE
    IF bank_open <> ledger_open THEN differences := differences || jsonb_build_array('The bank and ledger opening balances differ.'); END IF;
    IF bank_close <> ledger_close THEN differences := differences || jsonb_build_array('The bank and ledger closing balances differ.'); END IF;
  END IF;
  IF jsonb_array_length(unmatched_source) > 0 THEN differences := differences || jsonb_build_array('Retained bank observations have no exact posted-line match.'); END IF;
  IF jsonb_array_length(unmatched_ledger) > 0 THEN differences := differences || jsonb_build_array('Posted bank lines have no retained source match.'); END IF;
  report_status := CASE WHEN jsonb_array_length(differences) > 0 THEN 'differences'
    WHEN jsonb_array_length(gaps) > 0 THEN 'balanced_but_incomplete' ELSE 'complete' END;
  result := jsonb_build_object('id', report_id, 'scope', scope, 'accountId', account, 'currency', b.currency,
    'startsOn', starts::text, 'endsOn', ends::text, 'status', report_status,
    'checkpoint', jsonb_build_object('sequence', watermark::text, 'sourceRevision', source_revision::text),
    'accountLedgerSequence', account_sequence::text,
    'ledgerOpeningMinor', ledger_open::text, 'ledgerClosingMinor', ledger_close::text,
    'bankOpeningMinor', bank_open::text, 'bankClosingMinor', bank_close::text,
    'openingDifferenceMinor', (bank_open - ledger_open)::text, 'closingDifferenceMinor', (bank_close - ledger_close)::text,
    'sourceCoverageComplete', jsonb_array_length(gaps) = 0,
    'statements', statements, 'sourceRows', observations, 'ledgerLines', ledger_lines, 'matches', matches,
    'unmatchedSource', unmatched_source, 'unmatchedLedger', unmatched_ledger, 'differences', differences, 'coverageGaps', gaps,
    'receipt', jsonb_build_object('key', key, 'operation', 'reconcile_bank', 'actorId', actor),
    'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.bank_reconciliations VALUES(b.id, report_id, account, result);
  RETURN openerp.save_command(b.id, key, actor, 'reconcile_bank', input, result);
END $$;
