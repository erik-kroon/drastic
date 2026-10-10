CREATE TABLE openerp.decision_example_exports (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 16777216),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,id)
);
CREATE TRIGGER immutable_decision_example_export BEFORE DELETE OR UPDATE ON openerp.decision_example_exports FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.decision_example_exports TO openerp_runtime;
