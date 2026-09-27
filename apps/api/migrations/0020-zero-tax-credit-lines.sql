-- A zero tax correction remains a semantic fact but posts no monetary tax line.
-- Keep the journal's no-zero-line invariant and the FK for emitted components.
ALTER TABLE openerp.customer_credit_tax_corrections
  ALTER COLUMN output_vat_line_id DROP NOT NULL,
  ADD CONSTRAINT customer_credit_tax_corrections_tax_line_presence_check
    CHECK ((output_tax_minor = 0) = (output_vat_line_id IS NULL)),
  ADD CONSTRAINT customer_credit_tax_corrections_tax_line_body_check
    CHECK (NOT body ->> 'outputVatLineId'::text IS DISTINCT FROM output_vat_line_id);
