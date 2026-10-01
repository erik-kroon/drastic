-- Partial credits consume the original gross amount; every retained credit counts.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM openerp.supplier_credits c
    JOIN openerp.commerce_invoices i ON i.book_id = c.book_id AND i.id = c.invoice_id
    GROUP BY c.book_id, c.invoice_id, i.amount_minor
    HAVING sum(c.amount_minor) > i.amount_minor
  ) THEN
    PERFORM openerp.fail('InvalidJournal', 'Existing supplier credits exceed their original invoice. Review retained history before applying this migration.');
  END IF;
END $$;

CREATE FUNCTION openerp.check_supplier_credit_cap() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$
DECLARE original_amount numeric;
BEGIN
  PERFORM 1 FROM openerp.books WHERE id = NEW.book_id FOR UPDATE;
  SELECT amount_minor INTO original_amount FROM openerp.commerce_invoices
    WHERE book_id = NEW.book_id AND id = NEW.invoice_id AND direction = 'supplier'
    FOR UPDATE;
  IF original_amount IS NULL OR (
    SELECT coalesce(sum(amount_minor), 0) FROM openerp.supplier_credits
      WHERE book_id = NEW.book_id AND invoice_id = NEW.invoice_id
  ) > original_amount THEN
    PERFORM openerp.fail('InvalidJournal', 'Supplier credits exceed the original invoice capacity.');
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION openerp.check_supplier_credit_cap() FROM PUBLIC;
CREATE TRIGGER supplier_credit_cap AFTER INSERT ON openerp.supplier_credits
  FOR EACH ROW EXECUTE FUNCTION openerp.check_supplier_credit_cap();
