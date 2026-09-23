-- Privileged, reviewed identity admission is separate from runtime accounting writes.
CREATE TABLE openerp.identity_provisioning_receipts (
  request_id text PRIMARY KEY,
  manifest jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON openerp.identity_provisioning_receipts FROM PUBLIC,openerp_runtime;
