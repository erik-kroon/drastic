CREATE TABLE openerp.onboarding_delta_proposals (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  delta_id text NOT NULL,
  source_reference text NOT NULL,
  decision_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,delta_id,source_reference,decision_id),
  FOREIGN KEY(book_id,delta_id) REFERENCES openerp.onboarding_source_deltas(book_id,id),
  FOREIGN KEY(book_id,decision_id) REFERENCES openerp.onboarding_source_delta_decisions(book_id,id),
  CHECK(octet_length(body::text)<=262144),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'deltaId'=delta_id
    AND body->>'sourceReference'=source_reference AND body->>'decisionId'=decision_id
    AND body->>'digest'=openerp.digest(body-'digest')) IS TRUE)
);
CREATE TABLE openerp.onboarding_delta_effects (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  delta_id text NOT NULL,
  proposal_id text NOT NULL,
  source_reference text NOT NULL,
  executed_sequence numeric(39,0) NOT NULL CHECK(executed_sequence>0),
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,delta_id,source_reference),
  FOREIGN KEY(book_id,delta_id) REFERENCES openerp.onboarding_source_deltas(book_id,id),
  FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.onboarding_delta_proposals(book_id,id),
  CHECK(octet_length(body::text)<=262144),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'deltaId'=delta_id
    AND body->>'proposalId'=proposal_id AND body->>'sourceReference'=source_reference
    AND body->>'executedSequence'=executed_sequence::text
    AND body->>'digest'=openerp.digest(body-'digest')) IS TRUE)
);
CREATE TRIGGER immutable_onboarding_delta_proposal BEFORE UPDATE OR DELETE ON openerp.onboarding_delta_proposals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_delta_effect BEFORE UPDATE OR DELETE ON openerp.onboarding_delta_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.onboarding_delta_proposals,openerp.onboarding_delta_effects TO openerp_runtime;
