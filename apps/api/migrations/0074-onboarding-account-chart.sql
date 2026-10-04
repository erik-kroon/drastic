ALTER TABLE openerp.company_fact_revisions
  DROP CONSTRAINT company_fact_revisions_fact_kind_check;
ALTER TABLE openerp.company_fact_revisions
  ADD CONSTRAINT company_fact_revisions_fact_kind_check CHECK (fact_kind IN (
    'jurisdiction', 'legal_form', 'organization_number', 'accounting_method',
    'vat_registration', 'vat_period', 'fiscal_year', 'payroll_registration',
    'reporting_framework', 'base_currency', 'payroll_applicability',
    'asset_applicability', 'foreign_currency_applicability', 'account_chart'
  ));
