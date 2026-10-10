CREATE TABLE openerp.suggestion_records (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  session_id text,
  subject_identity text NOT NULL,
  subject_digest text NOT NULL CHECK (subject_digest ~ '^sha256:[0-9a-f]{64}$'),
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,id)
);
CREATE INDEX suggestion_exposure ON openerp.suggestion_records(book_id,actor_id,subject_identity);
CREATE TABLE openerp.decision_provenance (
  book_id text NOT NULL REFERENCES openerp.books(id),
  decision_kind text NOT NULL CHECK (decision_kind IN ('supplier_approval','bank_match','bank_allocation','extraction_field','batch_member','historical_voucher')),
  decision_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  classification text NOT NULL CHECK (classification IN ('independent','accepted_unchanged','corrected','batch_approved','unknown_exposure','historical_import')),
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,decision_kind,decision_id)
);
CREATE TRIGGER immutable_suggestion_record BEFORE DELETE OR UPDATE ON openerp.suggestion_records FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_decision_provenance BEFORE DELETE OR UPDATE ON openerp.decision_provenance FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.suggestion_records,openerp.decision_provenance TO openerp_runtime;
