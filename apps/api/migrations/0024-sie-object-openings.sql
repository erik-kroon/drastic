-- Retain original opening contributions beside current-year SIE membership.
-- Existing captures and immutable-row guards keep their original interpretation.
ALTER TABLE openerp.sie_book_export_rows
  DROP CONSTRAINT sie_book_export_rows_kind_check,
  ADD CONSTRAINT sie_book_export_rows_kind_check
    CHECK (body ->> 'kind' IN ('account', 'balance', 'line', 'opening_line'));
