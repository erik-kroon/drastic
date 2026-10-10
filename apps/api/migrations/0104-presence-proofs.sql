-- ADR 0020. Per-book authority policy, written only by the operator console. The
-- runtime role can read it but cannot relax it. No row means the defaults below.
CREATE TABLE openerp.book_authority_policies (
  book_id text PRIMARY KEY REFERENCES openerp.books(id),
  presence_required boolean NOT NULL DEFAULT false,
  posting_mandates_enabled boolean NOT NULL DEFAULT false,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- A one-time enrollment ticket minted out of band. Only its hash is retained.
CREATE TABLE openerp.presence_enrollment_tickets (
  id text PRIMARY KEY,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  ticket_hash text NOT NULL UNIQUE CHECK (ticket_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > issued_at)
);

-- The registration challenge issued to one browser session redeeming a ticket.
CREATE TABLE openerp.presence_enrollment_challenges (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES openerp.presence_enrollment_tickets(id),
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  session_id text NOT NULL,
  challenge text NOT NULL UNIQUE CHECK (length(challenge) BETWEEN 32 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

-- An enrolled authenticator. The unique ticket reference makes each ticket
-- redeemable exactly once.
CREATE TABLE openerp.presence_authenticators (
  credential_id text PRIMARY KEY CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) BETWEEN 16 AND 1366),
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  ticket_id text NOT NULL UNIQUE REFERENCES openerp.presence_enrollment_tickets(id),
  public_key text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]+$' AND length(public_key) BETWEEN 40 AND 2800),
  initial_counter bigint NOT NULL CHECK (initial_counter >= 0),
  enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE openerp.presence_authenticator_revocations (
  credential_id text PRIMARY KEY REFERENCES openerp.presence_authenticators(credential_id),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- A step-up challenge bound to one actor, session, book, gesture and exact request.
CREATE TABLE openerp.presence_challenges (
  id text PRIMARY KEY,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  book_id text NOT NULL REFERENCES openerp.books(id),
  session_id text NOT NULL,
  gesture text NOT NULL CHECK (gesture ~ '^[a-z_]{1,64}$'),
  binding_digest text NOT NULL CHECK (binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  challenge text NOT NULL UNIQUE CHECK (length(challenge) BETWEEN 32 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

-- A verified assertion for one challenge. The counter is the authenticator's
-- signature counter at verification.
CREATE TABLE openerp.presence_assertions (
  challenge_id text PRIMARY KEY REFERENCES openerp.presence_challenges(id),
  credential_id text NOT NULL REFERENCES openerp.presence_authenticators(credential_id),
  counter bigint NOT NULL CHECK (counter >= 0),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Consumption commits with the guarded gesture and rolls back with it.
CREATE TABLE openerp.presence_consumptions (
  challenge_id text PRIMARY KEY REFERENCES openerp.presence_assertions(challenge_id),
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX presence_challenges_binding ON openerp.presence_challenges (actor_id, binding_digest);
CREATE INDEX presence_assertions_credential ON openerp.presence_assertions (credential_id);

CREATE TRIGGER immutable_presence_enrollment_ticket BEFORE DELETE OR UPDATE ON openerp.presence_enrollment_tickets FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_presence_enrollment_challenge BEFORE DELETE OR UPDATE ON openerp.presence_enrollment_challenges FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_presence_authenticator BEFORE DELETE OR UPDATE ON openerp.presence_authenticators FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_presence_authenticator_revocation BEFORE DELETE OR UPDATE ON openerp.presence_authenticator_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_presence_challenge BEFORE DELETE OR UPDATE ON openerp.presence_challenges FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_presence_assertion BEFORE DELETE OR UPDATE ON openerp.presence_assertions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_presence_consumption BEFORE DELETE OR UPDATE ON openerp.presence_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT ON openerp.book_authority_policies TO openerp_runtime;
GRANT SELECT ON openerp.presence_enrollment_tickets TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.presence_enrollment_challenges TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.presence_authenticators TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.presence_authenticator_revocations TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.presence_challenges TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.presence_assertions TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.presence_consumptions TO openerp_runtime;
-- Lock-only grants: assertion and consumption serialize on these rows, and the
-- immutable triggers refuse any actual update.
GRANT UPDATE (credential_id) ON openerp.presence_authenticators TO openerp_runtime;
GRANT UPDATE (id) ON openerp.presence_challenges TO openerp_runtime;
