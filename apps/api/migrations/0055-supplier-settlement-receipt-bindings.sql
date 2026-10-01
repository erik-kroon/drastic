ALTER TABLE openerp.supplier_settlement_approvals
  ADD UNIQUE (book_id, id, plan_id);
ALTER TABLE openerp.supplier_settlement_plans
  ADD UNIQUE (book_id, id, invoice_id, statement_id, row_ordinal);
ALTER TABLE openerp.supplier_settlement_receipts
  ADD FOREIGN KEY (book_id, approval_id, plan_id)
    REFERENCES openerp.supplier_settlement_approvals(book_id, id, plan_id),
  ADD FOREIGN KEY (book_id, plan_id, invoice_id, statement_id, row_ordinal)
    REFERENCES openerp.supplier_settlement_plans(book_id, id, invoice_id, statement_id, row_ordinal);
