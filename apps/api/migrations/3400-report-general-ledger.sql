-- END-03: account movements and running balances over an existing immutable report.
-- No new opening assertion, fiscal transfer, source-completeness claim or ledger write.
CREATE FUNCTION openerp.report_general_ledger(
  p_token text,p_scope jsonb,p_report text,p_account text,p_after text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE
  v_report jsonb;
  v_snapshot openerp.report_snapshots;
  v_line jsonb;
  v_after_sequence bigint := 0;
  v_after_ordinal integer := 0;
  v_page_opening numeric;
  v_total bigint;
  v_result jsonb;
BEGIN
  v_report:=openerp.get_report(p_token,p_scope,p_report);
  SELECT r.* INTO STRICT v_snapshot FROM openerp.report_snapshots r
    WHERE r.book_id=p_scope->>'bookId' AND r.id=p_report;
  SELECT l.body INTO v_line FROM openerp.report_lines l
    WHERE l.book_id=v_snapshot.book_id AND l.report_id=p_report AND l.account_id=p_account;
  IF NOT FOUND THEN
    PERFORM openerp.fail('NotFound','The account is not part of this report snapshot.');
  END IF;

  IF coalesce(p_after,'')<>'' THEN
    IF p_after !~ '^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,18}:[1-9][0-9]{0,9}$'
      OR split_part(p_after,':',1) IS DISTINCT FROM p_report
      OR split_part(p_after,':',2) IS DISTINCT FROM p_account THEN
      PERFORM openerp.fail('InvalidJournal','Use a general-ledger cursor from this report and account.');
    END IF;
    BEGIN
      v_after_sequence:=split_part(p_after,':',3)::bigint;
      v_after_ordinal:=split_part(p_after,':',4)::integer;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      PERFORM openerp.fail('InvalidJournal','The general-ledger cursor is out of range.');
    END;
    IF NOT EXISTS(
      SELECT FROM openerp.vouchers v JOIN openerp.journal_lines l
        ON l.book_id=v.book_id AND l.voucher_id=v.id
      WHERE v.book_id=v_snapshot.book_id AND v.sequence=v_after_sequence
        AND v.sequence<=v_snapshot.sequence
        AND v.posting_date BETWEEN v_snapshot.starts_on AND v_snapshot.ends_on
        AND l.account_id=p_account AND l.ordinal=v_after_ordinal
    ) THEN
      PERFORM openerp.fail('InvalidJournal','The cursor does not identify a movement in this report account.');
    END IF;
  END IF;

  -- The frozen opening includes all earlier postings. Only selected-period movements
  -- participate in the page carry-forward; posting dates do not reorder committed history.
  SELECT count(*), (v_line->>'openingMinor')::numeric
    +coalesce(sum(l.debit_minor-l.credit_minor)
      FILTER (WHERE (v.sequence,l.ordinal)<=(v_after_sequence,v_after_ordinal)),0)
    INTO v_total,v_page_opening
    FROM openerp.vouchers v JOIN openerp.journal_lines l
      ON l.book_id=v.book_id AND l.voucher_id=v.id
    WHERE v.book_id=v_snapshot.book_id AND v.sequence<=v_snapshot.sequence
      AND v.posting_date BETWEEN v_snapshot.starts_on AND v_snapshot.ends_on
      AND l.account_id=p_account;

  WITH page AS MATERIALIZED (
    SELECT v.id AS voucher_id,l.id AS line_id,v.sequence,l.ordinal,v.posting_date,
      v.series,v.number,v.posting_purpose,v.corrects_voucher_id,
      l.description,l.debit_minor,l.credit_minor,v.action->'evidenceRefs' AS evidence_refs
    FROM openerp.vouchers v JOIN openerp.journal_lines l
      ON l.book_id=v.book_id AND l.voucher_id=v.id
    WHERE v.book_id=v_snapshot.book_id AND v.sequence<=v_snapshot.sequence
      AND v.posting_date BETWEEN v_snapshot.starts_on AND v_snapshot.ends_on
      AND l.account_id=p_account
      AND (v.sequence,l.ordinal)>(v_after_sequence,v_after_ordinal)
    ORDER BY v.sequence,l.ordinal LIMIT 101
  ), shown AS (
    SELECT * FROM page ORDER BY sequence,ordinal LIMIT 100
  ), entries AS (
    SELECT s.*,v_page_opening+sum(s.debit_minor-s.credit_minor)
      OVER (ORDER BY s.sequence,s.ordinal ROWS UNBOUNDED PRECEDING) AS running_balance
    FROM shown s
  )
  SELECT jsonb_build_object(
    'report',v_report,'line',v_line,'order','committed_sequence_then_line_ordinal',
    'formula','balance = opening + debits - credits','totalMovements',v_total,
    'pageOpeningMinor',v_page_opening::text,
    'pageClosingMinor',(v_page_opening+coalesce(sum(e.debit_minor-e.credit_minor),0))::text,
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'voucherId',e.voucher_id,'lineId',e.line_id,'sequence',e.sequence::text,
      'ordinal',e.ordinal,'postingDate',e.posting_date::text,'part','movement',
      'series',e.series,'voucherNumber',e.number::text,'postingPurpose',e.posting_purpose,
      'correctsVoucherId',e.corrects_voucher_id,'description',e.description,
      'debitMinor',e.debit_minor::text,'creditMinor',e.credit_minor::text,
      'evidenceRefs',e.evidence_refs,'runningBalanceMinor',e.running_balance::text
    ) ORDER BY e.sequence,e.ordinal),'[]'::jsonb),
    'next',CASE WHEN (SELECT count(*) FROM page)>100 THEN
      (SELECT p_report||':'||p_account||':'||s.sequence::text||':'||s.ordinal::text
        FROM shown s ORDER BY s.sequence DESC,s.ordinal DESC LIMIT 1)
      ELSE NULL END
  ) INTO v_result FROM entries e;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION openerp.report_general_ledger(text,jsonb,text,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.report_general_ledger(text,jsonb,text,text,text) TO openerp_runtime;
