-- A browser consent selects one immutable firm/book ceiling. Revoke separately; never
-- widen an existing grant after a membership change or refresh-token rotation.
CREATE TABLE openerp.oauth_agent_grants (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  firm_id text NOT NULL REFERENCES openerp.firms(id),
  book_id text NOT NULL REFERENCES openerp.books(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE openerp.oauth_agent_selections (
  session_id text PRIMARY KEY REFERENCES openerp_auth.session(id) ON DELETE CASCADE,
  grant_id text NOT NULL UNIQUE REFERENCES openerp.oauth_agent_grants(id)
);
CREATE TABLE openerp.oauth_agent_revocations (
  grant_id text PRIMARY KEY REFERENCES openerp.oauth_agent_grants(id),
  revoked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON TABLE openerp.oauth_agent_grants,
  openerp.oauth_agent_selections, openerp.oauth_agent_revocations TO openerp_runtime;
