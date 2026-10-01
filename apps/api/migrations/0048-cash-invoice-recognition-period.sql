DROP TRIGGER invoice_recognition_period_open ON openerp.commerce_invoices;
CREATE TRIGGER invoice_recognition_period_open AFTER INSERT ON openerp.commerce_invoices
  FOR EACH ROW WHEN (NEW.recognition_voucher_id IS NOT NULL)
  EXECUTE FUNCTION openerp.check_financial_period_open();
