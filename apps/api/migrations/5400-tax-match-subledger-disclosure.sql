-- Public read-only disclosure over4100 and immutable1500 basis registration.
-- No role/exclusivity decision. Private matching, controls, digests and guards remain unchanged.
CREATE OR REPLACE FUNCTION openerp.get_tax_account_match(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_body jsonb;t_reference jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  t_body:=openerp.tax_account_match_view(scope->>'bookId',id);
  IF t_body IS NULL THEN PERFORM openerp.fail('NotFound','The matching review is not in this book.'); END IF;
  -- Factual retained registration only. Basis-line uniqueness bounds this exact pair to zero or one.
  SELECT jsonb_build_object('scheduleId',l.schedule_id,'basisDigest',b.body->>'digest',
    'voucherId',l.voucher_id,'lineId',l.line_id) INTO t_reference
    FROM openerp.tax_account_matches m
    JOIN openerp.subledger_basis_lines l ON l.book_id=m.book_id AND l.voucher_id=m.voucher_id AND l.line_id=m.line_id
    JOIN openerp.subledger_bases b ON b.book_id=l.book_id AND b.schedule_id=l.schedule_id
    WHERE m.book_id=scope->>'bookId' AND m.id=get_tax_account_match.id;
  RETURN t_body||jsonb_build_object('subledgerBasisReference',t_reference,'roleCompatibilityAssessed',false);
END $$;
REVOKE ALL ON FUNCTION openerp.get_tax_account_match(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_tax_account_match(text,jsonb,text) TO openerp_runtime;
