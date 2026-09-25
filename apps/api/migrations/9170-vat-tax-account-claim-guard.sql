CREATE OR REPLACE FUNCTION openerp.tax_account_line_claimed(p_book text,p_voucher text,p_line text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT EXISTS(SELECT FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher AND m.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.bank_active_allocation_legs l WHERE l.book_id=p_book AND l.voucher_id=p_voucher AND l.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.voucher_id=p_voucher AND e.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher AND i.recognition_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher AND v.posting_purpose='vat_control_reclassification_v1')
    OR EXISTS(SELECT FROM openerp.vat_control_reclassification_contributions c WHERE c.book_id=p_book AND c.voucher_id=p_voucher AND c.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=p_book AND i.voucher_id=p_voucher AND i.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=p_book AND s.voucher_id=p_voucher
      AND p_line IN(s.cash_line_id,s.control_line_id,s.realized_line_id))
$$;
REVOKE ALL ON FUNCTION openerp.tax_account_line_claimed(text,text,text) FROM PUBLIC,openerp_runtime;
