-- Synthetic inbound-envelope shape binds all attachments to one book and sender account.
CREATE TABLE openerp.supplier_intake_envelopes (
  book_id text NOT NULL REFERENCES openerp.books(id),
  source_account_id text NOT NULL,
  envelope_id text NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY (book_id, source_account_id, envelope_id)
);
CREATE TRIGGER immutable_supplier_intake_envelope BEFORE UPDATE OR DELETE ON openerp.supplier_intake_envelopes
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.supplier_intake_envelopes TO openerp_runtime;

CREATE TABLE openerp.supplier_intake_batches (
  book_id text NOT NULL REFERENCES openerp.books(id),
  idempotency_key text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  operation text NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY (book_id, idempotency_key)
);
CREATE TABLE openerp.supplier_intake_batch_results (
  book_id text NOT NULL,
  idempotency_key text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 65536),
  PRIMARY KEY (book_id, idempotency_key),
  FOREIGN KEY (book_id, idempotency_key) REFERENCES openerp.supplier_intake_batches(book_id, idempotency_key)
);
CREATE TRIGGER immutable_supplier_intake_batch BEFORE UPDATE OR DELETE ON openerp.supplier_intake_batches
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_intake_batch_result BEFORE UPDATE OR DELETE ON openerp.supplier_intake_batch_results
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.supplier_intake_batches, openerp.supplier_intake_batch_results TO openerp_runtime;

-- Integration operator provisions a local fixture account for one book; callers cannot self-assign it.
CREATE TABLE openerp.supplier_intake_connections (
  book_id text NOT NULL REFERENCES openerp.books(id),
  provider text NOT NULL CHECK (provider IN ('drive', 'dropbox')),
  source_account_id text NOT NULL,
  folder_id text NOT NULL,
  PRIMARY KEY (book_id, provider, source_account_id, folder_id)
);
CREATE TRIGGER immutable_supplier_intake_connection BEFORE UPDATE OR DELETE ON openerp.supplier_intake_connections
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT ON openerp.supplier_intake_connections TO openerp_runtime;

CREATE TABLE openerp.supplier_intake_provenance (
  book_id text NOT NULL REFERENCES openerp.books(id),
  occurrence_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'bulk', 'drive', 'dropbox')),
  source_account_id text NOT NULL,
  envelope_id text,
  folder_id text,
  file_id text NOT NULL,
  source_revision text NOT NULL,
  PRIMARY KEY (book_id, occurrence_id),
  FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id)
);
CREATE TRIGGER immutable_supplier_intake_provenance BEFORE UPDATE OR DELETE ON openerp.supplier_intake_provenance
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.supplier_intake_provenance TO openerp_runtime;
