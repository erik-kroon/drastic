CREATE TABLE openerp.firm_access_requests (
  firm_id text NOT NULL REFERENCES openerp.firms(id),
  id text NOT NULL,
  client_name text NOT NULL CHECK (length(btrim(client_name)) BETWEEN 1 AND 200),
  organization_number text CHECK (organization_number ~ '^[0-9]{10}$'),
  lead_id text REFERENCES openerp.actors(id),
  requested_by text NOT NULL REFERENCES openerp.actors(id),
  state text NOT NULL CHECK (state IN ('requested', 'revoked')),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (firm_id, id)
);

GRANT SELECT, INSERT, UPDATE ON openerp.firm_access_requests TO openerp_runtime;
