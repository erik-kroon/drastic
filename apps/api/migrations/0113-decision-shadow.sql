CREATE TABLE openerp.book_decision_policies (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  question_id text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(book_id,id)
);
CREATE INDEX decision_policy_head ON openerp.book_decision_policies(book_id,question_id,sequence DESC);
CREATE TABLE openerp.decision_requests (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL,
  idempotency_key text NOT NULL, admission_digest text NOT NULL,
  requested_by text NOT NULL REFERENCES openerp.actors(id),
  credential_hash text, session_id text,
  policy_id text NOT NULL, body jsonb NOT NULL CHECK (octet_length(body::text)<=1048576),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,idempotency_key),
  FOREIGN KEY(book_id,policy_id) REFERENCES openerp.book_decision_policies(book_id,id),
  CHECK ((credential_hash IS NULL)<>(session_id IS NULL))
);
CREATE TABLE openerp.decision_request_controls (
  book_id text NOT NULL, request_id text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','running','validated','failed','stale','skipped','uncertain')),
  generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
  lease_expires_at timestamptz, disclosed_at timestamptz, reason text,
  PRIMARY KEY(book_id,request_id), FOREIGN KEY(book_id,request_id) REFERENCES openerp.decision_requests(book_id,id)
);
CREATE TABLE openerp.decision_attempts (
  book_id text NOT NULL, request_id text NOT NULL, generation integer NOT NULL,
  phase text NOT NULL CHECK(phase IN ('claimed','disclosed','terminal')),
  body jsonb NOT NULL CHECK(octet_length(body::text)<=1048576),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(book_id,request_id,generation,phase),
  FOREIGN KEY(book_id,request_id) REFERENCES openerp.decision_requests(book_id,id)
);
CREATE TABLE openerp.decision_results (
  book_id text NOT NULL, request_id text NOT NULL, id text NOT NULL,
  body jsonb NOT NULL CHECK(octet_length(body::text)<=1048576),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(book_id,request_id), UNIQUE(book_id,id),
  FOREIGN KEY(book_id,request_id) REFERENCES openerp.decision_requests(book_id,id)
);
CREATE TABLE openerp.decision_budget_controls (
  book_id text NOT NULL, policy_id text NOT NULL, reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0),
  PRIMARY KEY(book_id,policy_id), FOREIGN KEY(book_id,policy_id) REFERENCES openerp.book_decision_policies(book_id,id)
);
CREATE TABLE openerp.decision_budget_reservations (
  book_id text NOT NULL, request_id text NOT NULL, policy_id text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(book_id,request_id), FOREIGN KEY(book_id,request_id) REFERENCES openerp.decision_requests(book_id,id),
  FOREIGN KEY(book_id,policy_id) REFERENCES openerp.book_decision_policies(book_id,id)
);
CREATE TRIGGER immutable_decision_policy BEFORE UPDATE OR DELETE ON openerp.book_decision_policies FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_decision_request BEFORE UPDATE OR DELETE ON openerp.decision_requests FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_decision_attempt BEFORE UPDATE OR DELETE ON openerp.decision_attempts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_decision_result BEFORE UPDATE OR DELETE ON openerp.decision_results FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_decision_reservation BEFORE UPDATE OR DELETE ON openerp.decision_budget_reservations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT ON openerp.book_decision_policies TO openerp_runtime;
GRANT SELECT,INSERT ON openerp.decision_requests,openerp.decision_attempts,openerp.decision_results,openerp.decision_budget_reservations TO openerp_runtime;
GRANT SELECT,INSERT,UPDATE ON openerp.decision_request_controls,openerp.decision_budget_controls TO openerp_runtime;
