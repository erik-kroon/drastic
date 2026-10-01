ALTER TABLE openerp.owner_operation_reviews DROP CONSTRAINT owner_operation_reviews_mode_check;
ALTER TABLE openerp.owner_operation_reviews ADD CONSTRAINT owner_operation_reviews_mode_check CHECK
  (mode IN ('owner_paid_purchase','owner_pays_payable','reimburse_owner','owner_loan',
    'owner_contribution','repay_owner_loan'));
ALTER TABLE openerp.owner_operation_receipts DROP CONSTRAINT owner_operation_receipts_source_check;
ALTER TABLE openerp.owner_operation_receipts ADD CONSTRAINT owner_operation_receipts_source_check CHECK (
  (mode='owner_paid_purchase' AND recognition_id IS NOT NULL AND invoice_id IS NULL)
  OR (mode='owner_pays_payable' AND recognition_id IS NULL AND invoice_id IS NOT NULL)
  OR (mode IN ('reimburse_owner','owner_loan','owner_contribution','repay_owner_loan')
    AND recognition_id IS NULL AND invoice_id IS NULL)
);
