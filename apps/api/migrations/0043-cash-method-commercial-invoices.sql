-- Native commercial-only supplier invoices. No second invoice or VAT ledger.
-- Applied 0040 and the released baseline remain immutable.
ALTER TABLE openerp.commerce_invoices
  ALTER COLUMN recognition_voucher_id DROP NOT NULL,
  ALTER COLUMN recognition_line_id DROP NOT NULL,
  ADD COLUMN cash_method_source_draft_id text,
  ADD CONSTRAINT commerce_cash_draft_key UNIQUE (book_id, cash_method_source_draft_id),
  ADD CONSTRAINT commerce_cash_draft_fkey FOREIGN KEY (book_id, cash_method_source_draft_id)
    REFERENCES openerp.supplier_invoice_drafts(book_id, id),
  ADD CONSTRAINT commerce_recognition_shape CHECK (coalesce((
    (recognition_voucher_id IS NOT NULL AND recognition_line_id IS NOT NULL
      AND cash_method_source_draft_id IS NULL
      AND body->>'kind' <> 'cash_method_supplier_invoice_v1')
    OR
    (recognition_voucher_id IS NULL AND recognition_line_id IS NULL
      AND cash_method_source_draft_id IS NOT NULL AND direction = 'supplier'
      AND body->>'kind' = 'cash_method_supplier_invoice_v1'
      AND body->'recognition' = 'null'::jsonb
      AND jsonb_typeof(body->'cashMethod') = 'object'
      AND body->'cashMethod'->>'draftId' = cash_method_source_draft_id)
  ), false));

-- This bounded admission treats one retained original as one supplier document.
CREATE UNIQUE INDEX commerce_cash_original_key ON openerp.commerce_invoices(book_id,evidence_id)
  WHERE cash_method_source_draft_id IS NOT NULL;
