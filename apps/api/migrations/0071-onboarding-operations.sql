DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='openerp_onboarding_operations') THEN
    CREATE ROLE openerp_onboarding_operations NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='openerp_onboarding_recovery') THEN
    CREATE ROLE openerp_onboarding_recovery NOLOGIN;
  END IF;
END $$;

GRANT openerp_runtime TO openerp_onboarding_operations;
GRANT USAGE ON SCHEMA openerp TO openerp_onboarding_recovery;
GRANT SELECT ON openerp.books, openerp.vouchers, openerp.journal_lines,
  openerp.execution_receipts, openerp.intake_contents, openerp.outbox TO openerp_onboarding_recovery;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON openerp.onboarding_operational_proofs FROM openerp_runtime;
REVOKE UPDATE (authority, writer_epoch) ON openerp.books FROM openerp_runtime;
GRANT INSERT ON openerp.onboarding_operational_proofs TO openerp_onboarding_operations;
GRANT INSERT ON openerp.onboarding_activation_receipts TO openerp_onboarding_operations;
GRANT UPDATE (authority) ON openerp.books TO openerp_onboarding_operations;

CREATE TABLE openerp.onboarding_operation_runs (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  configuration_digest text NOT NULL CHECK(configuration_digest ~ '^[a-f0-9]{64}$'),
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id)
);
CREATE TABLE openerp.onboarding_operation_stages (
  book_id text NOT NULL,
  operation_id text NOT NULL,
  id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,operation_id,id),
  FOREIGN KEY(book_id,operation_id) REFERENCES openerp.onboarding_operation_runs(book_id,id)
);
CREATE TRIGGER immutable_onboarding_operation_run BEFORE UPDATE OR DELETE ON openerp.onboarding_operation_runs
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_operation_stage BEFORE UPDATE OR DELETE ON openerp.onboarding_operation_stages
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT ON openerp.onboarding_operation_runs, openerp.onboarding_operation_stages TO openerp_runtime;
GRANT INSERT ON openerp.onboarding_operation_runs, openerp.onboarding_operation_stages TO openerp_onboarding_operations;
