CREATE TABLE openerp.onboarding_cases (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  path text NOT NULL CHECK (path IN ('new_company', 'existing_company', 'bureau_managed', 'demo')),
  record_class text NOT NULL CHECK (record_class IN ('actual_company', 'synthetic')),
  recorded_by text NOT NULL REFERENCES openerp.actors(id),
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id),
  CHECK ((path = 'demo') = (record_class = 'synthetic'))
);

CREATE TABLE openerp.onboarding_revisions (
  book_id text NOT NULL,
  case_id text NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483646),
  body jsonb NOT NULL,
  PRIMARY KEY (book_id, case_id, revision),
  FOREIGN KEY (book_id, case_id) REFERENCES openerp.onboarding_cases(book_id, id),
  CHECK ((body->>'id' = case_id AND body->'scope'->>'bookId' = book_id
    AND (body->>'revision')::integer = revision) IS TRUE),
  CHECK ((body->>'digest' = openerp.digest(body - 'digest')) IS TRUE)
);

CREATE TABLE openerp.onboarding_sources (
  book_id text NOT NULL,
  case_id text NOT NULL,
  id text NOT NULL,
  occurrence_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('company', 'previous_books', 'bank', 'sales', 'purchases', 'tax', 'assets', 'payroll', 'other')),
  body jsonb NOT NULL,
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, case_id, occurrence_id, category),
  FOREIGN KEY (book_id, case_id) REFERENCES openerp.onboarding_cases(book_id, id),
  FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id),
  CHECK ((body->>'id' = id AND body->>'caseId' = case_id
    AND body->'scope'->>'bookId' = book_id AND body->>'category' = category
    AND body->'occurrence'->>'id' = occurrence_id) IS TRUE)
);

CREATE TRIGGER immutable_onboarding_case BEFORE UPDATE OR DELETE ON openerp.onboarding_cases
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_revision BEFORE UPDATE OR DELETE ON openerp.onboarding_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_source BEFORE UPDATE OR DELETE ON openerp.onboarding_sources
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.onboarding_cases, openerp.onboarding_revisions,
  openerp.onboarding_sources TO openerp_runtime;

ALTER TABLE openerp.company_fact_revisions
  DROP CONSTRAINT company_fact_revisions_fact_kind_check;
ALTER TABLE openerp.company_fact_revisions
  ADD CONSTRAINT company_fact_revisions_fact_kind_check CHECK (fact_kind IN (
    'jurisdiction', 'legal_form', 'organization_number', 'accounting_method',
    'vat_registration', 'vat_period', 'fiscal_year', 'payroll_registration',
    'reporting_framework', 'base_currency', 'payroll_applicability',
    'asset_applicability', 'foreign_currency_applicability'
  ));
