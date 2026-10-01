-- Keep historical immutable receipts readable. New receipts distinguish actual
-- funding recorded from a repayable claim; a contribution is not a loan.
ALTER TABLE openerp.owner_operation_receipts
  DROP CONSTRAINT owner_operation_receipts_amount_body_check;
ALTER TABLE openerp.owner_operation_receipts
  ADD CONSTRAINT owner_operation_receipts_amount_body_check CHECK (
    CASE WHEN body ? 'recordedAmountMinor' THEN
      (body->>'recordedAmountMinor' = amount_minor::text) IS TRUE
      AND (body->>'ownerClaimMinor' = CASE WHEN mode='owner_contribution'
        THEN '0' ELSE amount_minor::text END) IS TRUE
    ELSE NOT body->>'ownerClaimMinor' IS DISTINCT FROM amount_minor::text END
  );
