ALTER TABLE openerp.company_setup_commands
  DROP CONSTRAINT company_setup_commands_operation_check;

ALTER TABLE openerp.company_setup_commands
  ADD CONSTRAINT company_setup_commands_operation_check
  CHECK (operation IN ('create', 'save', 'native_ledger'));

GRANT INSERT ON openerp.accounts, openerp.fiscal_years, openerp.periods TO openerp_runtime;
