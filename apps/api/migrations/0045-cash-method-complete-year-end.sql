CREATE TABLE openerp.cash_method_population_epochs (
  book_id text PRIMARY KEY REFERENCES openerp.books(id), version bigint NOT NULL CHECK(version>0)
);
INSERT INTO openerp.cash_method_population_epochs(book_id,version) SELECT id,1 FROM openerp.books;
GRANT SELECT,INSERT ON openerp.cash_method_population_epochs TO openerp_runtime;
GRANT UPDATE(version) ON openerp.cash_method_population_epochs TO openerp_runtime;

CREATE TABLE openerp.cash_method_year_end_plans (
  book_id text NOT NULL, id text NOT NULL, fiscal_year_id text NOT NULL,
  change_set_id text, evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,change_set_id),
  FOREIGN KEY(book_id,fiscal_year_id) REFERENCES openerp.fiscal_years(book_id,id),
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
  CHECK(body->>'digest'=openerp.digest(body-'digest')),
  CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id
    AND body->'selection'->'fiscalYear'->>'id'=fiscal_year_id)
);
CREATE TABLE openerp.cash_method_year_end_approvals (
  book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, actor_id text NOT NULL,
  consumed_at timestamptz, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.cash_method_year_end_plans(book_id,id),
  FOREIGN KEY(actor_id) REFERENCES openerp.actors(id),
  CHECK(body->>'id'=id AND body->>'planId'=plan_id AND body->>'actorId'=actor_id)
);
ALTER TABLE openerp.cash_method_year_end_runs
  ADD COLUMN fiscal_year_id text,
  ADD COLUMN plan_id text,
  ADD COLUMN approval_id text,
  ADD COLUMN body jsonb,
  ADD UNIQUE(book_id,fiscal_year_id),
  ADD UNIQUE(book_id,plan_id),
  ADD UNIQUE(book_id,approval_id),
  ADD FOREIGN KEY(book_id,fiscal_year_id) REFERENCES openerp.fiscal_years(book_id,id),
  ADD FOREIGN KEY(book_id,plan_id) REFERENCES openerp.cash_method_year_end_plans(book_id,id),
  ADD FOREIGN KEY(book_id,approval_id) REFERENCES openerp.cash_method_year_end_approvals(book_id,id);
CREATE TABLE openerp.cash_method_year_end_members (
  book_id text NOT NULL, run_id text NOT NULL, invoice_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,run_id,invoice_id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.cash_method_year_end_runs(book_id,id),
  FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices(book_id,id)
);
CREATE TRIGGER immutable_cash_year_end_plan BEFORE UPDATE OR DELETE ON openerp.cash_method_year_end_plans
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_cash_year_end_member BEFORE UPDATE OR DELETE ON openerp.cash_method_year_end_members
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER cash_year_end_approval_consumption BEFORE UPDATE OR DELETE ON openerp.cash_method_year_end_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.posting_guard_approval_consumption();
GRANT SELECT,INSERT ON openerp.cash_method_year_end_plans,openerp.cash_method_year_end_approvals,openerp.cash_method_year_end_members TO openerp_runtime;
GRANT UPDATE(consumed_at) ON openerp.cash_method_year_end_approvals TO openerp_runtime;
