CREATE TABLE openerp.reminder_messages (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  prepare_key text NOT NULL,
  request_digest text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 131072
    AND body->>'id' = id AND body->'scope'->>'bookId' = book_id
    AND body->>'digest' = openerp.digest(body - 'digest')
    AND body->>'provider' = 'local-fixture-v1' AND body->'attachments' = '[]'::jsonb
    AND body->>'feeMinor' = '0' AND body->>'interestMinor' = '0'),
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, prepare_key)
);
CREATE TABLE openerp.reminder_approvals (
  book_id text NOT NULL,
  message_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  session_id text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 8192
    AND body->>'messageId' = message_id AND body->>'approvedBy' = actor_id
    AND body->>'digest' = openerp.digest(body - 'digest')),
  PRIMARY KEY (book_id, message_id),
  FOREIGN KEY (book_id, message_id) REFERENCES openerp.reminder_messages(book_id, id)
);
CREATE TABLE openerp.reminder_attempts (
  book_id text NOT NULL,
  message_id text NOT NULL,
  id text NOT NULL,
  external_identity text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 8192
    AND body->>'id' = id AND body->>'messageId' = message_id
    AND body->>'externalIdentity' = external_identity
    AND body->>'digest' = openerp.digest(body - 'digest')),
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, message_id),
  UNIQUE (external_identity),
  FOREIGN KEY (book_id, message_id) REFERENCES openerp.reminder_approvals(book_id, message_id)
);
CREATE TABLE openerp.reminder_outbox (
  book_id text NOT NULL,
  message_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('approved','admitted','reconciling','provider_accepted','delivered','outcome_unknown','failed','cancelled','refused')),
  checkpoint integer NOT NULL DEFAULT 0 CHECK (checkpoint BETWEEN 0 AND 1000),
  cancel_version integer NOT NULL DEFAULT 0 CHECK (cancel_version BETWEEN 0 AND 1),
  reason text,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, message_id),
  FOREIGN KEY (book_id, message_id) REFERENCES openerp.reminder_approvals(book_id, message_id)
);
CREATE INDEX reminder_pending ON openerp.reminder_outbox(book_id, state, message_id)
  WHERE state IN ('approved','admitted','reconciling');
CREATE TABLE openerp.reminder_observations (
  book_id text NOT NULL,
  attempt_id text NOT NULL,
  observation_id text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 8192
    AND body->>'observationId' = observation_id
    AND body->>'digest' = openerp.digest(body - 'digest')
    AND body->>'kind' IN ('accepted','delivered','rejected','unknown')
    AND body->>'provider' = 'local-fixture-v1'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, attempt_id, observation_id),
  FOREIGN KEY (book_id, attempt_id) REFERENCES openerp.reminder_attempts(book_id, id)
);
CREATE TRIGGER immutable_reminder_message BEFORE UPDATE OR DELETE ON openerp.reminder_messages
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_reminder_approval BEFORE UPDATE OR DELETE ON openerp.reminder_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_reminder_attempt BEFORE UPDATE OR DELETE ON openerp.reminder_attempts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_reminder_observation BEFORE UPDATE OR DELETE ON openerp.reminder_observations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.reminder_messages, openerp.reminder_approvals, openerp.reminder_attempts,
  openerp.reminder_outbox, openerp.reminder_observations TO openerp_runtime;
GRANT UPDATE(state, checkpoint, cancel_version, reason, checked_at) ON openerp.reminder_outbox TO openerp_runtime;
