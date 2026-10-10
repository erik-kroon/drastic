-- Better Auth OAuth Provider 1.7.5 persistence. OAuth grant admission is separately enforced by the application.

CREATE TABLE openerp_auth.oauth_client (
  id text PRIMARY KEY,
  client_id text NOT NULL UNIQUE,
  client_secret text,
  client_discovery_id text,
  disabled boolean,
  skip_consent boolean,
  enable_end_session boolean,
  subject_type text,
  scopes text[],
  client_credentials_scopes text[],
  user_id text REFERENCES openerp_auth."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name text,
  uri text,
  icon text,
  contacts text[],
  tos text,
  policy text,
  software_id text,
  software_version text,
  software_statement text,
  redirect_uris text[] NOT NULL,
  post_logout_redirect_uris text[],
  backchannel_logout_uri text,
  backchannel_logout_session_required boolean,
  token_endpoint_auth_method text,
  application_type text,
  jwks text,
  jwks_uri text,
  grant_types text[],
  response_types text[],
  require_pkce boolean,
  dpop_bound_access_tokens boolean,
  reference_id text,
  metadata jsonb
);

CREATE INDEX oauth_client_user_id_idx ON openerp_auth.oauth_client (user_id);

CREATE TABLE openerp_auth.oauth_resource (
  id text PRIMARY KEY,
  identifier text NOT NULL UNIQUE,
  name text NOT NULL,
  access_token_ttl integer,
  refresh_token_ttl integer,
  signing_algorithm text,
  signing_key_id text,
  allowed_scopes text[],
  custom_claims jsonb,
  dpop_bound_access_tokens_required boolean,
  disabled boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  policy_version integer,
  metadata jsonb
);

CREATE TABLE openerp_auth.oauth_client_resource (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES openerp_auth.oauth_client(client_id) ON DELETE CASCADE,
  resource_id text NOT NULL REFERENCES openerp_auth.oauth_resource(identifier) ON DELETE CASCADE,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_client_resource_client_id_idx ON openerp_auth.oauth_client_resource (client_id);

CREATE INDEX oauth_client_resource_resource_id_idx ON openerp_auth.oauth_client_resource (resource_id);

CREATE TABLE openerp_auth.oauth_refresh_token (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  client_id text NOT NULL REFERENCES openerp_auth.oauth_client(client_id),
  session_id text REFERENCES openerp_auth.session(id) ON DELETE SET NULL,
  user_id text NOT NULL REFERENCES openerp_auth."user"(id),
  reference_id text,
  authorization_code_id text,
  resources text[],
  requested_user_info_claims text[],
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked timestamptz,
  rotated_at timestamptz,
  rotation_replay_response text,
  rotation_replay_expires_at timestamptz,
  auth_time timestamptz,
  confirmation jsonb,
  scopes text[] NOT NULL
);

CREATE INDEX oauth_refresh_token_client_id_idx ON openerp_auth.oauth_refresh_token (client_id);

CREATE INDEX oauth_refresh_token_session_id_idx ON openerp_auth.oauth_refresh_token (session_id);

CREATE INDEX oauth_refresh_token_user_id_idx ON openerp_auth.oauth_refresh_token (user_id);

CREATE INDEX oauth_refresh_token_authorization_code_id_idx ON openerp_auth.oauth_refresh_token (authorization_code_id);

CREATE TABLE openerp_auth.oauth_access_token (
  id text PRIMARY KEY,
  token text UNIQUE,
  client_id text NOT NULL REFERENCES openerp_auth.oauth_client(client_id),
  session_id text REFERENCES openerp_auth.session(id) ON DELETE SET NULL,
  user_id text REFERENCES openerp_auth."user"(id),
  reference_id text,
  authorization_code_id text,
  resources text[],
  requested_user_info_claims text[],
  refresh_id text REFERENCES openerp_auth.oauth_refresh_token(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked timestamptz,
  confirmation jsonb,
  scopes text[] NOT NULL
);

CREATE INDEX oauth_access_token_client_id_idx ON openerp_auth.oauth_access_token (client_id);

CREATE INDEX oauth_access_token_session_id_idx ON openerp_auth.oauth_access_token (session_id);

CREATE INDEX oauth_access_token_user_id_idx ON openerp_auth.oauth_access_token (user_id);

CREATE INDEX oauth_access_token_authorization_code_id_idx ON openerp_auth.oauth_access_token (authorization_code_id);

CREATE INDEX oauth_access_token_refresh_id_idx ON openerp_auth.oauth_access_token (refresh_id);

CREATE TABLE openerp_auth.oauth_consent (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES openerp_auth.oauth_client(client_id),
  user_id text REFERENCES openerp_auth."user"(id),
  reference_id text,
  resources text[],
  requested_user_info_claims text[],
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_consent_client_id_idx ON openerp_auth.oauth_consent (client_id);

CREATE INDEX oauth_consent_user_id_idx ON openerp_auth.oauth_consent (user_id);

CREATE TABLE openerp_auth.oauth_client_assertion (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  openerp_auth.oauth_client, openerp_auth.oauth_resource, openerp_auth.oauth_client_resource,
  openerp_auth.oauth_refresh_token, openerp_auth.oauth_access_token,
  openerp_auth.oauth_consent, openerp_auth.oauth_client_assertion TO openerp_runtime;
