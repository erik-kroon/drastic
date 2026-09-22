CREATE TABLE openerp.report_snapshots (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL,
  sequence bigint NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id, id)
);
CREATE TABLE openerp.report_lines (
  book_id text NOT NULL, report_id text NOT NULL, account_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id, report_id, account_id),
  FOREIGN KEY (book_id, report_id) REFERENCES openerp.report_snapshots,
  FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts
);
CREATE TRIGGER immutable_report BEFORE UPDATE OR DELETE ON openerp.report_snapshots
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_report_line BEFORE UPDATE OR DELETE ON openerp.report_lines
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.prepare_report(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
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
    'currency', book.currency, 'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
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

CREATE FUNCTION openerp.get_report(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  SELECT r.body INTO result FROM openerp.report_snapshots r WHERE r.book_id=scope->>'bookId' AND r.id=get_report.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The report was not found in this book.'); END IF;
  RETURN result;
END $$;

CREATE FUNCTION openerp.get_report_lines(token text, scope jsonb, id text, after_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE report jsonb; items jsonb; next_id text;
BEGIN
  report := openerp.get_report(token,scope,id);
  SELECT coalesce(jsonb_agg(page.body ORDER BY page.account_id),'[]') INTO items FROM (
    SELECT l.account_id,l.body FROM openerp.report_lines l WHERE l.book_id=scope->>'bookId'
      AND l.report_id=get_report_lines.id AND l.account_id>coalesce(after_id,'') ORDER BY l.account_id LIMIT 100
  ) page;
  IF jsonb_array_length(items)=100 AND EXISTS(SELECT FROM openerp.report_lines l WHERE l.book_id=scope->>'bookId'
    AND l.report_id=get_report_lines.id AND l.account_id>items->99->>'accountId') THEN next_id:=items->99->>'accountId'; END IF;
  RETURN jsonb_build_object('reportId',id,'total',report->'accountCount','items',items,'next',next_id);
END $$;

CREATE FUNCTION openerp.explain_report_line(token text, scope jsonb, id text, account text, after_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE report jsonb; line jsonb; snapshot openerp.report_snapshots; items jsonb; total bigint;
  after_sequence bigint:=0; after_ordinal integer:=0; next_cursor text;
BEGIN
  report:=openerp.get_report(token,scope,id);
  SELECT r.* INTO snapshot FROM openerp.report_snapshots r WHERE r.book_id=scope->>'bookId' AND r.id=explain_report_line.id;
  SELECT l.body INTO line FROM openerp.report_lines l WHERE l.book_id=snapshot.book_id AND l.report_id=snapshot.id AND l.account_id=account;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The account is not part of this report snapshot.'); END IF;
  IF after_cursor IS NOT NULL AND after_cursor<>'' THEN
    IF after_cursor !~ '^[0-9]+:[0-9]+$' THEN PERFORM openerp.fail('InvalidJournal','Invalid contribution cursor.'); END IF;
    BEGIN
      after_sequence:=split_part(after_cursor,':',1)::bigint; after_ordinal:=split_part(after_cursor,':',2)::integer;
    EXCEPTION WHEN numeric_value_out_of_range THEN PERFORM openerp.fail('InvalidJournal','Invalid contribution cursor.'); END;
  END IF;
  SELECT count(*) INTO total FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    WHERE v.book_id=snapshot.book_id AND v.sequence<=snapshot.sequence AND v.posting_date<=snapshot.ends_on AND l.account_id=account;
  SELECT coalesce(jsonb_agg(page.body ORDER BY page.sequence,page.ordinal),'[]') INTO items FROM (
    SELECT v.sequence,l.ordinal,jsonb_build_object('voucherId',v.id,'lineId',l.id,'sequence',v.sequence::text,
      'ordinal',l.ordinal,'postingDate',v.posting_date::text,'part',CASE WHEN v.posting_date<snapshot.starts_on THEN 'opening' ELSE 'movement' END,
      'description',l.description,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,'evidenceRefs',v.action->'evidenceRefs') AS body
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    WHERE v.book_id=snapshot.book_id AND v.sequence<=snapshot.sequence AND v.posting_date<=snapshot.ends_on
      AND l.account_id=account AND (v.sequence,l.ordinal)>(after_sequence,after_ordinal)
    ORDER BY v.sequence,l.ordinal LIMIT 100
  ) page;
  IF jsonb_array_length(items)=100 AND EXISTS(
    SELECT FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    WHERE v.book_id=snapshot.book_id AND v.sequence<=snapshot.sequence AND v.posting_date<=snapshot.ends_on AND l.account_id=account
      AND (v.sequence,l.ordinal)>((items->99->>'sequence')::bigint,(items->99->>'ordinal')::integer)
  ) THEN next_cursor:=(items->99->>'sequence')||':'||(items->99->>'ordinal'); END IF;
  RETURN jsonb_build_object('report',report,'line',line,'formula','closing = opening + debits - credits',
    'totalContributions',total,'items',items,'next',next_cursor);
END $$;
REVOKE ALL ON FUNCTION openerp.prepare_report(text,jsonb,text,jsonb), openerp.get_report(text,jsonb,text),
  openerp.get_report_lines(text,jsonb,text,text), openerp.explain_report_line(text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.prepare_report(text,jsonb,text,jsonb), openerp.get_report(text,jsonb,text),
  openerp.get_report_lines(text,jsonb,text,text), openerp.explain_report_line(text,jsonb,text,text,text) TO openerp_runtime;
