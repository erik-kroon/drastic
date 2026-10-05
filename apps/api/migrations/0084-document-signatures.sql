CREATE TABLE openerp.document_governance (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  fiscal_year_id text GENERATED ALWAYS AS (body->'input'->>'fiscalYearId') STORED NOT NULL, FOREIGN KEY(book_id,fiscal_year_id) REFERENCES openerp.fiscal_years(book_id,id)
);
CREATE TRIGGER immutable_document_governance BEFORE UPDATE OR DELETE ON openerp.document_governance FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.document_governance TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.document_governance_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.document_governance_reviews (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  governance_id text GENERATED ALWAYS AS (body->>'governanceId') STORED NOT NULL, FOREIGN KEY(book_id,governance_id) REFERENCES openerp.document_governance(book_id,id)
);
CREATE TRIGGER immutable_document_governance_reviews BEFORE UPDATE OR DELETE ON openerp.document_governance_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.document_governance_reviews TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.document_governance_reviews_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.document_validations (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  artifact_id text GENERATED ALWAYS AS (body->>'artifactId') STORED NOT NULL, FOREIGN KEY(book_id,artifact_id) REFERENCES openerp.annual_report_artifacts(book_id,id)
);
CREATE TRIGGER immutable_document_validations BEFORE UPDATE OR DELETE ON openerp.document_validations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.document_validations TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.document_validations_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.document_manifests (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  artifact_id text GENERATED ALWAYS AS (body->>'artifactId') STORED NOT NULL, governance_id text GENERATED ALWAYS AS (body->>'governanceId') STORED NOT NULL, validation_id text GENERATED ALWAYS AS (body->>'validationId') STORED NOT NULL, FOREIGN KEY(book_id,artifact_id) REFERENCES openerp.annual_report_artifacts(book_id,id), FOREIGN KEY(book_id,governance_id) REFERENCES openerp.document_governance(book_id,id), FOREIGN KEY(book_id,validation_id) REFERENCES openerp.document_validations(book_id,id)
);
CREATE TRIGGER immutable_document_manifests BEFORE UPDATE OR DELETE ON openerp.document_manifests FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.document_manifests TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.document_manifests_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.document_signature_intents (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  manifest_id text GENERATED ALWAYS AS (body->>'manifestId') STORED NOT NULL, signer_id text GENERATED ALWAYS AS (body->>'signerId') STORED NOT NULL, FOREIGN KEY(book_id,manifest_id) REFERENCES openerp.document_manifests(book_id,id), FOREIGN KEY(signer_id) REFERENCES openerp.actors(id), UNIQUE(book_id,manifest_id,signer_id)
);
CREATE TRIGGER immutable_document_signature_intents BEFORE UPDATE OR DELETE ON openerp.document_signature_intents FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.document_signature_intents TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.document_signature_intents_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.document_signature_attempts (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  intent_id text GENERATED ALWAYS AS (body->>'intentId') STORED NOT NULL, FOREIGN KEY(book_id,intent_id) REFERENCES openerp.document_signature_intents(book_id,id), UNIQUE(book_id,intent_id)
);
CREATE TRIGGER immutable_document_signature_attempts BEFORE UPDATE OR DELETE ON openerp.document_signature_attempts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.document_signature_attempts TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.document_signature_attempts_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.document_signature_observations (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  attempt_id text GENERATED ALWAYS AS (body->>'attemptId') STORED NOT NULL, FOREIGN KEY(book_id,attempt_id) REFERENCES openerp.document_signature_attempts(book_id,id)
);
CREATE TRIGGER immutable_document_signature_observations BEFORE UPDATE OR DELETE ON openerp.document_signature_observations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.document_signature_observations TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.document_signature_observations_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.document_signature_evidence (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  intent_id text GENERATED ALWAYS AS (body->>'intentId') STORED NOT NULL, manifest_id text GENERATED ALWAYS AS (body->>'manifestId') STORED NOT NULL, attempt_id text GENERATED ALWAYS AS (body->>'attemptId') STORED NOT NULL, FOREIGN KEY(book_id,intent_id) REFERENCES openerp.document_signature_intents(book_id,id), FOREIGN KEY(book_id,manifest_id) REFERENCES openerp.document_manifests(book_id,id), FOREIGN KEY(book_id,attempt_id) REFERENCES openerp.document_signature_attempts(book_id,id), UNIQUE(book_id,intent_id), UNIQUE(book_id,attempt_id)
);
CREATE TRIGGER immutable_document_signature_evidence BEFORE UPDATE OR DELETE ON openerp.document_signature_evidence FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.document_signature_evidence TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.document_signature_evidence_ordinal_seq TO openerp_runtime;
