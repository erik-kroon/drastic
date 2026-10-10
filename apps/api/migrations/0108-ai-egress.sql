CREATE TABLE openerp.ai_identity_tokens (
  book_id text NOT NULL REFERENCES openerp.books(id),
  subject_key text NOT NULL,
  identity_kind text NOT NULL CHECK (identity_kind IN ('CLIENT','PERSON','SUPPLIER','CUSTOMER')),
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (book_id, subject_key),
  UNIQUE (ordinal)
);
CREATE TABLE openerp.ai_identity_aliases (
  book_id text NOT NULL,
  subject_key text NOT NULL,
  alias text NOT NULL,
  PRIMARY KEY (book_id,subject_key,alias),
  FOREIGN KEY (book_id,subject_key) REFERENCES openerp.ai_identity_tokens(book_id,subject_key)
);
CREATE TABLE openerp.ai_counterparty_classifications (
  book_id text NOT NULL,
  counterparty_id text NOT NULL,
  revision bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('company','person','sole_trader')),
  evidence_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,counterparty_id,revision),
  FOREIGN KEY (book_id,counterparty_id,revision) REFERENCES openerp.commerce_counterparty_revisions(book_id,counterparty_id,revision),
  FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence(book_id,id)
);
CREATE TABLE openerp.ai_egress_admissions (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  purpose text NOT NULL CHECK (purpose IN ('decision','document','agent')),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  provider text NOT NULL,
  destination text NOT NULL,
  model_release text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('structured','document_submit','document_poll')),
  disclosure text NOT NULL CHECK (disclosure IN ('tokenised','raw_document','operation_reference')),
  categories jsonb NOT NULL CHECK (jsonb_typeof(categories)='array'),
  policy text NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,id)
);
CREATE INDEX ai_egress_book_time ON openerp.ai_egress_admissions(book_id,recorded_at,id);
CREATE TRIGGER immutable_ai_identity_token BEFORE UPDATE OR DELETE ON openerp.ai_identity_tokens FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ai_identity_alias BEFORE UPDATE OR DELETE ON openerp.ai_identity_aliases FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ai_counterparty_classification BEFORE UPDATE OR DELETE ON openerp.ai_counterparty_classifications FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ai_egress_admission BEFORE UPDATE OR DELETE ON openerp.ai_egress_admissions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.ai_identity_tokens,openerp.ai_identity_aliases,openerp.ai_counterparty_classifications,openerp.ai_egress_admissions TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.ai_identity_tokens_ordinal_seq,openerp.ai_egress_admissions_sequence_seq TO openerp_runtime;
