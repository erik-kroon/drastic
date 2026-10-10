CREATE TABLE openerp.suggestion_identities (
  book_id text NOT NULL REFERENCES openerp.books(id),
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  session_id text,
  subject_digest text NOT NULL CHECK (subject_digest ~ '^sha256:[0-9a-f]{64}$'),
  option_set_digest text NOT NULL CHECK (option_set_digest ~ '^sha256:[0-9a-f]{64}$'),
  suggestion_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE NULLS NOT DISTINCT (book_id,actor_id,session_id,subject_digest,option_set_digest),
  FOREIGN KEY (book_id,suggestion_id) REFERENCES openerp.suggestion_records(book_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX suggestion_legacy_identity ON openerp.suggestion_records(book_id,actor_id,session_id,subject_digest,(body->>'optionSetDigest'),created_at,id);
CREATE TRIGGER immutable_suggestion_identity BEFORE DELETE OR UPDATE ON openerp.suggestion_identities FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.suggestion_identities TO openerp_runtime;
