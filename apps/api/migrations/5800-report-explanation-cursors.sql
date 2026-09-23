-- Exact retained report/account continuation. Old report bytes stay unchanged.
CREATE OR REPLACE FUNCTION openerp.explain_report_line(token text, scope jsonb, id text, account text, after_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE report jsonb; line jsonb; snapshot openerp.report_snapshots; items jsonb; total bigint;
  after_sequence bigint:=0; after_ordinal integer:=0; next_cursor text;
BEGIN
  report:=openerp.get_report(token,scope,id);
  SELECT r.* INTO snapshot FROM openerp.report_snapshots r WHERE r.book_id=scope->>'bookId' AND r.id=explain_report_line.id;
  SELECT l.body INTO line FROM openerp.report_lines l WHERE l.book_id=snapshot.book_id AND l.report_id=snapshot.id AND l.account_id=account;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The account is not part of this report snapshot.'); END IF;
  IF after_cursor IS NOT NULL AND after_cursor<>'' THEN
    IF length(after_cursor)>288 THEN
      PERFORM openerp.fail('InvalidJournal','Use the bounded contribution cursor returned for this report and account.'); END IF;
    IF after_cursor !~ '^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,18}:[1-9][0-9]{0,9}$' THEN
      PERFORM openerp.fail('InvalidJournal','Use the bounded contribution cursor returned for this report and account.'); END IF;
    IF split_part(after_cursor,':',1) IS DISTINCT FROM snapshot.id
      OR split_part(after_cursor,':',2) IS DISTINCT FROM account THEN
      PERFORM openerp.fail('InvalidJournal','The contribution cursor belongs to another report or account. Restart this explanation from its first page.'); END IF;
    BEGIN
      after_sequence:=split_part(after_cursor,':',3)::bigint; after_ordinal:=split_part(after_cursor,':',4)::integer;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      PERFORM openerp.fail('InvalidJournal','The contribution cursor position exceeds supported numeric bounds.'); END;
    IF NOT EXISTS(SELECT FROM openerp.journal_lines l JOIN openerp.vouchers v
      ON v.book_id=l.book_id AND v.id=l.voucher_id
      WHERE v.book_id=snapshot.book_id AND v.sequence<=snapshot.sequence AND v.posting_date<=snapshot.ends_on
        AND l.account_id=account AND v.sequence=after_sequence AND l.ordinal=after_ordinal) THEN
      PERFORM openerp.fail('InvalidJournal','The contribution cursor does not identify an included row in this report and account.'); END IF;
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
  ) THEN next_cursor:=snapshot.id||':'||account||':'||(items->99->>'sequence')||':'||(items->99->>'ordinal'); END IF;
  RETURN jsonb_build_object('report',report,'line',line,'formula','closing = opening + debits - credits',
    'totalContributions',total,'items',items,'next',next_cursor);
END $$;
REVOKE ALL ON FUNCTION openerp.explain_report_line(text,jsonb,text,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.explain_report_line(text,jsonb,text,text,text) TO openerp_runtime;
