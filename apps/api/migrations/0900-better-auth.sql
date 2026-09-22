CREATE SCHEMA openerp_auth;
REVOKE ALL ON SCHEMA openerp_auth FROM PUBLIC;

CREATE TABLE openerp_auth."user" (
  id text PRIMARY KEY REFERENCES openerp.actors(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE openerp_auth.session (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES openerp_auth."user"(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);
CREATE INDEX session_user_id_idx ON openerp_auth.session(user_id);
CREATE TABLE openerp_auth.account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES openerp_auth."user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_provider_identity_key UNIQUE (provider_id, account_id)
);
CREATE INDEX account_user_id_idx ON openerp_auth.account(user_id);
CREATE TABLE openerp_auth.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON openerp_auth.verification(identifier);
CREATE TABLE openerp_auth.rate_limit (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);

GRANT USAGE ON SCHEMA openerp_auth TO openerp_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA openerp_auth TO openerp_runtime;

-- Retain admission locks: sign-out/session revocation waits for admitted accounting work.
-- A Better Auth user ID references an existing actor; membership remains separately assigned.
CREATE OR REPLACE FUNCTION openerp.authenticate(token text) RETURNS text LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE actor text;
BEGIN
  IF token IS NULL OR length(token) < 32 OR length(token) > 512 THEN
    PERFORM openerp.fail('Unauthorized', 'Sign in or provide a valid API token.');
  END IF;
  SELECT actor_id INTO actor FROM openerp.credentials
    WHERE token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
      AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR SHARE;
  IF actor IS NULL THEN
    SELECT s.user_id INTO actor FROM openerp_auth.session s
      WHERE s.token = authenticate.token AND s.expires_at > clock_timestamp() FOR SHARE OF s;
  END IF;
  IF actor IS NULL THEN PERFORM openerp.fail('Unauthorized', 'Sign in or provide a valid API token.'); END IF;
  RETURN actor;
END $$;
