-- Match account and direction are retained relational facts, not allocation policy.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM openerp.bank_matches m
    JOIN openerp.bank_observations o ON (o.book_id, o.statement_id, o.row_ordinal) = (m.book_id, m.statement_id, m.row_ordinal)
    JOIN openerp.bank_statements s ON (s.book_id, s.id) = (o.book_id, o.statement_id)
    JOIN openerp.journal_lines l ON (l.book_id, l.voucher_id, l.id) = (m.book_id, m.voucher_id, m.line_id)
    WHERE l.account_id <> s.account_id OR sign(l.debit_minor - l.credit_minor) <> sign(o.amount_minor)
  ) THEN
    PERFORM openerp.fail('InvalidJournal', 'Existing bank matches have inconsistent accounts or directions. Review retained history before applying this migration.');
  END IF;
END $$;

CREATE FUNCTION openerp.check_bank_match_integrity() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM openerp.books WHERE id = NEW.book_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT FROM openerp.bank_observations o
    JOIN openerp.bank_statements s ON (s.book_id, s.id) = (o.book_id, o.statement_id)
    JOIN openerp.journal_lines l ON l.book_id = o.book_id
      AND l.voucher_id = NEW.voucher_id AND l.id = NEW.line_id
    WHERE o.book_id = NEW.book_id AND o.statement_id = NEW.statement_id AND o.row_ordinal = NEW.row_ordinal
      AND l.account_id = s.account_id AND sign(l.debit_minor - l.credit_minor) = sign(o.amount_minor)
  ) THEN
    PERFORM openerp.fail('InvalidJournal', 'A bank match must reference its settlement account with the observed direction.');
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION openerp.check_bank_match_integrity() FROM PUBLIC;
CREATE TRIGGER bank_match_integrity AFTER INSERT ON openerp.bank_matches
  FOR EACH ROW EXECUTE FUNCTION openerp.check_bank_match_integrity();
