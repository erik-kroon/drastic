-- Admission-time lock protection. Historical vouchers in a now-locked period
-- remain valid; closing and approved reopening stay application workflows.
CREATE FUNCTION openerp.check_financial_period_open() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$
DECLARE target_period text; period_locked boolean;
BEGIN
  PERFORM 1 FROM openerp.books WHERE id = NEW.book_id FOR UPDATE;
  IF TG_TABLE_NAME = 'vouchers' THEN
    target_period := NEW.period_id;
  ELSE
    SELECT period_id INTO target_period FROM openerp.vouchers
      WHERE book_id = NEW.book_id AND id = NEW.recognition_voucher_id;
  END IF;
  SELECT locked INTO period_locked FROM openerp.periods
    WHERE book_id = NEW.book_id AND id = target_period FOR SHARE;
  IF period_locked IS NULL THEN
    PERFORM openerp.fail('InvalidJournal', 'A financial write must reference a retained accounting period.');
  END IF;
  IF period_locked THEN
    PERFORM openerp.fail('PeriodLocked', 'The accounting period is locked.');
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION openerp.check_financial_period_open() FROM PUBLIC;
CREATE TRIGGER voucher_period_open AFTER INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.check_financial_period_open();
CREATE TRIGGER invoice_recognition_period_open AFTER INSERT ON openerp.commerce_invoices
  FOR EACH ROW EXECUTE FUNCTION openerp.check_financial_period_open();
