-- NEXT-20: frozen regular-payroll calculations.
--
-- A frozen calculation is a captured, sealed proposal. It has no financial
-- effect: no journal, no salary payment, no declaration, and no reservation of
-- monthly contribution capacity. The application owns the basis capture, the
-- exact calculation, the refusal vocabulary and the sealed digest; these tables
-- only retain the immutable calculation header, its exact retained input
-- references and its sealed payload, so a later employment, work, opening or
-- rule-release change cannot rewrite what one captured pay run already means.
--
-- There is no function, no policy, no payroll calculator and no dispatcher here.
-- The rule release that carries the statutory tables, decisions, contribution
-- bands and holiday policy remains the one existing owner in
-- openerp.rule_releases; this migration does not add a second release authority.

CREATE TABLE openerp.payroll_calculations (
  book_id text NOT NULL,
  id text NOT NULL,
  employee_id text NOT NULL,
  change_set_id text NOT NULL,
  plan_digest text NOT NULL,
  rule_release_id text NOT NULL,
  earnings_period_start date NOT NULL,
  earnings_period_end date NOT NULL,
  expected_payment_on date NOT NULL,
  gross_minor numeric NOT NULL,
  withholding_minor numeric NOT NULL,
  net_deduction_minor numeric NOT NULL,
  contribution_base_minor numeric NOT NULL,
  employer_contribution_minor numeric NOT NULL,
  payable_minor numeric NOT NULL,
  no_financial_effect boolean NOT NULL,
  body jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_calculations_pkey PRIMARY KEY (book_id, id),
  -- One original regular earning event per employee and earnings period. A new
  -- work or employment revision requires a new calculation, never a second
  -- salary event for the same period.
  CONSTRAINT payroll_calculations_earning_event_key UNIQUE (book_id, employee_id, earnings_period_start, earnings_period_end),
  CONSTRAINT payroll_calculations_plan_key UNIQUE (book_id, change_set_id),
  CONSTRAINT payroll_calculations_digest_check CHECK (plan_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT payroll_calculations_no_effect_check CHECK (no_financial_effect),
  CONSTRAINT payroll_calculations_period_check CHECK (earnings_period_start <= earnings_period_end),
  CONSTRAINT payroll_calculations_period_month_check CHECK (left(earnings_period_start::text, 7) = left(earnings_period_end::text, 7)),
  CONSTRAINT payroll_calculations_amount_bound_check CHECK (
    gross_minor >= 0 AND withholding_minor >= 0 AND net_deduction_minor >= 0
    AND contribution_base_minor >= 0 AND employer_contribution_minor >= 0 AND payable_minor >= 0
  ),
  CONSTRAINT payroll_calculations_body_check CHECK (jsonb_typeof(body) = 'object'::text AND body <> '{}'::jsonb),
  CONSTRAINT payroll_calculations_body_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT payroll_calculations_body_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT payroll_calculations_body_employee_check CHECK (NOT body ->> 'employeeId'::text IS DISTINCT FROM employee_id),
  CONSTRAINT payroll_calculations_body_owner_check CHECK (body -> 'calculation'::text ->> 'owner'::text = 'payroll_calculation'::text),
  CONSTRAINT payroll_calculations_body_no_effect_check CHECK (body ->> 'noFinancialEffect'::text = 'true'::text),
  CONSTRAINT payroll_calculations_body_period_check CHECK (
    NOT body -> 'calculation'::text -> 'earningsPeriod'::text ->> 'startsOn'::text IS DISTINCT FROM earnings_period_start::text
    AND NOT body -> 'calculation'::text -> 'earningsPeriod'::text ->> 'endsOn'::text IS DISTINCT FROM earnings_period_end::text
  ),
  CONSTRAINT payroll_calculations_body_payment_on_check CHECK (NOT body -> 'calculation'::text ->> 'expectedPaymentOn'::text IS DISTINCT FROM expected_payment_on::text),
  CONSTRAINT payroll_calculations_body_plan_digest_check CHECK (NOT body ->> 'planDigest'::text IS DISTINCT FROM plan_digest),
  CONSTRAINT payroll_calculations_body_gross_check CHECK (NOT body -> 'calculation'::text ->> 'grossMinor'::text IS DISTINCT FROM gross_minor::text),
  CONSTRAINT payroll_calculations_body_withholding_check CHECK (NOT body -> 'calculation'::text ->> 'withholdingMinor'::text IS DISTINCT FROM withholding_minor::text),
  CONSTRAINT payroll_calculations_body_deduction_check CHECK (NOT body -> 'calculation'::text ->> 'netDeductionMinor'::text IS DISTINCT FROM net_deduction_minor::text),
  CONSTRAINT payroll_calculations_body_contribution_base_check CHECK (NOT body -> 'calculation'::text ->> 'contributionBaseMinor'::text IS DISTINCT FROM contribution_base_minor::text),
  CONSTRAINT payroll_calculations_body_contribution_check CHECK (NOT body -> 'calculation'::text ->> 'employerContributionMinor'::text IS DISTINCT FROM employer_contribution_minor::text),
  CONSTRAINT payroll_calculations_body_payable_check CHECK (NOT body -> 'calculation'::text ->> 'payableMinor'::text IS DISTINCT FROM payable_minor::text),
  CONSTRAINT payroll_calculations_body_created_at_check CHECK (NOT body ->> 'createdAt'::text IS DISTINCT FROM created_at::text),
  CONSTRAINT payroll_calculations_body_created_by_check CHECK (NOT body ->> 'createdBy'::text IS DISTINCT FROM created_by),
  CONSTRAINT payroll_calculations_body_basis_check CHECK (jsonb_typeof(body -> 'basis'::text) = 'object'::text),
  CONSTRAINT payroll_calculations_body_release_check CHECK (NOT body -> 'basis'::text ->> 'ruleReleaseId'::text IS DISTINCT FROM rule_release_id),
  CONSTRAINT payroll_calculations_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT payroll_calculations_rule_release_id_fkey FOREIGN KEY (rule_release_id) REFERENCES openerp.rule_releases(id),
  CONSTRAINT payroll_calculations_book_id_employee_id_fkey FOREIGN KEY (book_id, employee_id) REFERENCES openerp.payroll_employees(book_id, id),
  CONSTRAINT payroll_calculations_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);

CREATE TABLE openerp.payroll_calculation_inputs (
  book_id text NOT NULL,
  calculation_id text NOT NULL,
  ordinal integer NOT NULL,
  kind text NOT NULL,
  resource_id text NOT NULL,
  version text NOT NULL,
  reason text NOT NULL,
  CONSTRAINT payroll_calculation_inputs_pkey PRIMARY KEY (book_id, calculation_id, ordinal),
  CONSTRAINT payroll_calculation_inputs_ref_key UNIQUE (book_id, calculation_id, kind, resource_id),
  CONSTRAINT payroll_calculation_inputs_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT payroll_calculation_inputs_kind_check CHECK (kind = ANY (ARRAY[
    'employment_revision'::text, 'work_revision'::text, 'opening_revision'::text,
    'prior_frozen_calculation'::text, 'rule_release'::text, 'company_activation'::text,
    'company_fact_revision'::text, 'company_fact_review'::text, 'company_role_binding'::text,
    'evidence'::text
  ])),
  CONSTRAINT payroll_calculation_inputs_ref_check CHECK (length(resource_id) > 0 AND length(version) > 0),
  CONSTRAINT payroll_calculation_inputs_book_id_calculation_id_fkey FOREIGN KEY (book_id, calculation_id) REFERENCES openerp.payroll_calculations(book_id, id)
);

CREATE INDEX payroll_calculations_employee_period ON openerp.payroll_calculations (book_id, employee_id, earnings_period_start, id);
CREATE INDEX payroll_calculations_period ON openerp.payroll_calculations (book_id, earnings_period_start, earnings_period_end, id);

-- A frozen calculation is history. Later activity creates a new calculation; it
-- never rewrites the meaning of a captured one, and its retained input
-- references are never re-pointed.
CREATE TRIGGER immutable_payroll_calculation
  BEFORE DELETE OR UPDATE ON openerp.payroll_calculations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_calculation_input
  BEFORE DELETE OR UPDATE ON openerp.payroll_calculation_inputs
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.payroll_calculations, openerp.payroll_calculation_inputs TO openerp_runtime;
