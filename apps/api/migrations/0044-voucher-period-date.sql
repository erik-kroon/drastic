-- Date/period consistency is relational integrity, not a posting workflow.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM openerp.vouchers v
    JOIN openerp.periods p ON p.book_id = v.book_id AND p.id = v.period_id
    WHERE v.posting_date < p.starts_on OR v.posting_date > p.ends_on
  ) THEN
    PERFORM openerp.fail('InvalidJournal', 'Existing voucher dates lie outside their accounting periods. Review retained history before applying this migration.');
  END IF;
END $$;

CREATE FUNCTION openerp.check_voucher_period_date() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$
DECLARE period_start date; period_end date;
BEGIN
  PERFORM 1 FROM openerp.books WHERE id = NEW.book_id FOR UPDATE;
  IF TG_TABLE_NAME = 'vouchers' THEN
    SELECT starts_on, ends_on INTO period_start, period_end
      FROM openerp.periods
      WHERE book_id = NEW.book_id AND fiscal_year_id = NEW.fiscal_year_id AND id = NEW.period_id
      FOR SHARE;
    IF period_start IS NULL OR NEW.posting_date < period_start OR NEW.posting_date > period_end THEN
      PERFORM openerp.fail('InvalidJournal', 'A voucher date must lie inside its accounting period.');
    END IF;
  ELSE
    IF EXISTS (
      SELECT FROM openerp.vouchers
      WHERE book_id = NEW.book_id AND period_id = NEW.id
        AND (posting_date < NEW.starts_on OR posting_date > NEW.ends_on)
    ) THEN
      PERFORM openerp.fail('InvalidJournal', 'An accounting period must contain its retained voucher dates.');
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION openerp.check_voucher_period_date() FROM PUBLIC;
CREATE TRIGGER voucher_period_date AFTER INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.check_voucher_period_date();
CREATE TRIGGER period_voucher_dates AFTER UPDATE OF starts_on, ends_on ON openerp.periods
  FOR EACH ROW EXECUTE FUNCTION openerp.check_voucher_period_date();
