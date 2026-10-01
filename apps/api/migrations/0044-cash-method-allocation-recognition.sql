-- Cash recognition is metadata/coverage over native invoices and allocation legs.
-- VAT effects use the existing VAT fact owner; journals use the posting kernel.
CREATE TABLE openerp.cash_method_allocation_effects (
  book_id text NOT NULL, allocation_plan_id text NOT NULL,
  change_set_id text, evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,allocation_plan_id),
  UNIQUE(book_id,change_set_id),
  FOREIGN KEY(book_id,allocation_plan_id) REFERENCES openerp.commerce_allocation_plans(book_id,id),
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence(book_id,id)
);
CREATE TRIGGER immutable_cash_allocation_effect BEFORE UPDATE OR DELETE ON openerp.cash_method_allocation_effects
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.cash_method_allocation_effects TO openerp_runtime;

ALTER TABLE openerp.cash_method_lines
  ADD COLUMN original_net_minor text,
  ADD COLUMN original_tax_minor text,
  ADD COLUMN original_deductible_minor text,
  ADD COLUMN released_deductible_minor text NOT NULL DEFAULT '0',
  ADD CONSTRAINT cash_original_components CHECK (
    original_net_minor IS NULL OR (original_net_minor ~ '^(0|[1-9][0-9]*)$'
      AND original_tax_minor ~ '^(0|[1-9][0-9]*)$' AND original_deductible_minor ~ '^(0|[1-9][0-9]*)$'
      AND original_net_minor::numeric+original_tax_minor::numeric=original_gross_minor::numeric
      AND original_deductible_minor::numeric<=original_tax_minor::numeric)),
  ADD CONSTRAINT cash_released_deduction CHECK (released_deductible_minor ~ '^(0|[1-9][0-9]*)$'
    AND (original_deductible_minor IS NULL OR released_deductible_minor::numeric<=original_deductible_minor::numeric));
GRANT UPDATE(released_deductible_minor) ON openerp.cash_method_lines TO openerp_runtime;

ALTER TABLE openerp.cash_method_recognitions
  ADD COLUMN allocation_receipt_id text,
  ADD COLUMN allocation_ordinal integer,
  ADD COLUMN source_payment_voucher_id text,
  ADD COLUMN source_payment_line_id text,
  ADD COLUMN voucher_id text,
  ADD COLUMN vat_fact_id text,
  ADD FOREIGN KEY(book_id,allocation_receipt_id,allocation_ordinal)
    REFERENCES openerp.commerce_allocation_legs(book_id,receipt_id,ordinal),
  ADD FOREIGN KEY(book_id,source_payment_voucher_id,source_payment_line_id)
    REFERENCES openerp.journal_lines(book_id,voucher_id,id),
  ADD FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
  ADD FOREIGN KEY(book_id,vat_fact_id) REFERENCES openerp.vat_fact_components(book_id,id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE openerp.vat_fact_components ADD COLUMN cash_method_recognition_id text,
  ADD FOREIGN KEY(book_id,cash_method_recognition_id) REFERENCES openerp.cash_method_recognitions(book_id,id)
    DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX vat_cash_recognition_key ON openerp.vat_fact_components(book_id,cash_method_recognition_id)
  WHERE cash_method_recognition_id IS NOT NULL;
