CREATE TABLE openerp.onboarding_source_deltas (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  candidate_preview_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,candidate_preview_id) REFERENCES openerp.sie_source_previews(book_id,id),
  CHECK(octet_length(body::text)<=8388608),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id
    AND body->>'candidatePreviewId'=candidate_preview_id AND body->>'digest'=openerp.digest(body-'digest')) IS TRUE)
);
CREATE TABLE openerp.onboarding_source_delta_decisions (
  book_id text NOT NULL,
  id text NOT NULL,
  delta_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,delta_id) REFERENCES openerp.onboarding_source_deltas(book_id,id),
  CHECK(octet_length(body::text)<=65536),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id
    AND body->>'deltaId'=delta_id AND body->>'actorId'=actor_id) IS TRUE)
);
CREATE TRIGGER immutable_onboarding_source_delta BEFORE UPDATE OR DELETE ON openerp.onboarding_source_deltas FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_source_delta_decision BEFORE UPDATE OR DELETE ON openerp.onboarding_source_delta_decisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.onboarding_source_deltas,openerp.onboarding_source_delta_decisions TO openerp_runtime;
