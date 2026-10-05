ALTER TABLE openerp.payroll_calculations
  DROP CONSTRAINT payroll_calculations_body_created_at_check;
ALTER TABLE openerp.payroll_calculations
  ADD CONSTRAINT payroll_calculations_body_created_at_check
  CHECK ((body->>'createdAt')::timestamptz IS NOT DISTINCT FROM created_at);

ALTER TABLE openerp.corporate_tax_declarations
  DROP CONSTRAINT corporate_tax_declarations_body_created_at_check;
ALTER TABLE openerp.corporate_tax_declarations
  ADD CONSTRAINT corporate_tax_declarations_body_created_at_check
  CHECK ((body->>'createdAt')::timestamptz IS NOT DISTINCT FROM created_at);
