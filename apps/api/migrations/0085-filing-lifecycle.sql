CREATE TABLE openerp.filing_adoptions (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id), CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE), CHECK(digest=openerp.digest(body-'digest')),
  manifest_id text GENERATED ALWAYS AS (body->>'manifestId') STORED NOT NULL, FOREIGN KEY(book_id,manifest_id) REFERENCES openerp.document_manifests(book_id,id)
);
CREATE TRIGGER immutable_filing_adoptions BEFORE UPDATE OR DELETE ON openerp.filing_adoptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.filing_adoptions TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.filing_adoptions_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.filing_adoption_reviews (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id), CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE), CHECK(digest=openerp.digest(body-'digest')),
  adoption_id text GENERATED ALWAYS AS (body->>'adoptionId') STORED NOT NULL, FOREIGN KEY(book_id,adoption_id) REFERENCES openerp.filing_adoptions(book_id,id)
);
CREATE TRIGGER immutable_filing_adoption_reviews BEFORE UPDATE OR DELETE ON openerp.filing_adoption_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.filing_adoption_reviews TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.filing_adoption_reviews_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.filing_intents (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  adoption_id text GENERATED ALWAYS AS (body->>'adoptionId') STORED NOT NULL, FOREIGN KEY(book_id,adoption_id) REFERENCES openerp.filing_adoptions(book_id,id), manifest_id text GENERATED ALWAYS AS (body->'input'->>'manifestId') STORED NOT NULL, copy_artifact_id text GENERATED ALWAYS AS (body->'input'->>'copyArtifactId') STORED NOT NULL, fiscal_year_id text GENERATED ALWAYS AS (body->>'fiscalYearId') STORED NOT NULL, predecessor_id text GENERATED ALWAYS AS (body->'input'->>'predecessorIntentId') STORED, FOREIGN KEY(book_id,manifest_id) REFERENCES openerp.document_manifests(book_id,id), FOREIGN KEY(book_id,copy_artifact_id) REFERENCES openerp.annual_report_artifacts(book_id,id), FOREIGN KEY(book_id,fiscal_year_id) REFERENCES openerp.fiscal_years(book_id,id), FOREIGN KEY(book_id,predecessor_id) REFERENCES openerp.filing_intents(book_id,id)
);
CREATE TRIGGER immutable_filing_intents BEFORE UPDATE OR DELETE ON openerp.filing_intents FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.filing_intents TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.filing_intents_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.filing_authorizations (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  intent_id text GENERATED ALWAYS AS (body->>'intentId') STORED NOT NULL, actor_id text GENERATED ALWAYS AS (body->>'actorId') STORED NOT NULL, FOREIGN KEY(book_id,intent_id) REFERENCES openerp.filing_intents(book_id,id), FOREIGN KEY(actor_id) REFERENCES openerp.actors(id)
);
CREATE TRIGGER immutable_filing_authorizations BEFORE UPDATE OR DELETE ON openerp.filing_authorizations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.filing_authorizations TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.filing_authorizations_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.filing_attempts (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  intent_id text GENERATED ALWAYS AS (body->>'intentId') STORED NOT NULL, authorization_id text GENERATED ALWAYS AS (body->>'authorizationId') STORED NOT NULL, FOREIGN KEY(book_id,intent_id) REFERENCES openerp.filing_intents(book_id,id), FOREIGN KEY(book_id,authorization_id) REFERENCES openerp.filing_authorizations(book_id,id), UNIQUE(book_id,intent_id)
);
CREATE TRIGGER immutable_filing_attempts BEFORE UPDATE OR DELETE ON openerp.filing_attempts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.filing_attempts TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.filing_attempts_ordinal_seq TO openerp_runtime;
CREATE TABLE openerp.filing_observations (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, body jsonb NOT NULL, digest text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')), CHECK(octet_length(body::text)<=4194304),
  intent_id text GENERATED ALWAYS AS (body->>'intentId') STORED NOT NULL, attempt_id text GENERATED ALWAYS AS (body->>'attemptId') STORED NOT NULL, FOREIGN KEY(book_id,intent_id) REFERENCES openerp.filing_intents(book_id,id), FOREIGN KEY(book_id,attempt_id) REFERENCES openerp.filing_attempts(book_id,id)
);
CREATE TRIGGER immutable_filing_observations BEFORE UPDATE OR DELETE ON openerp.filing_observations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.filing_observations TO openerp_runtime;
GRANT USAGE ON SEQUENCE openerp.filing_observations_ordinal_seq TO openerp_runtime;
