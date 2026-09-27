-- Extend contribution provenance without rewriting saved returns or source facts.
ALTER TABLE openerp.vat_actual_return_contributions
  DROP CONSTRAINT vat_actual_return_contributions_origin_check,
  ADD CONSTRAINT vat_actual_return_contributions_origin_check CHECK (
    origin IN ('manual_admission', 'owned_purchase_recognition', 'owned_owner_purchase', 'owned_customer_credit')
  );

-- PostgreSQL requires an UPDATE privilege for the owner's approval row lock.
-- The immutable-row trigger still rejects any UPDATE, including book_id changes.
GRANT UPDATE (book_id) ON openerp.owner_operation_approvals TO openerp_runtime;
