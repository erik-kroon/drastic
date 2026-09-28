-- NEXT-23 reviewed lifecycle. Existing sealed records stay immutable.
ALTER TABLE openerp.corporate_tax_bridges DROP CONSTRAINT corporate_tax_bridges_body_created_at_check;
ALTER TABLE openerp.corporate_tax_bridges ADD CONSTRAINT corporate_tax_bridges_body_created_at_check
  CHECK ((body->>'createdAt')::timestamptz IS NOT DISTINCT FROM created_at);
ALTER TABLE openerp.corporate_tax_bridges DROP CONSTRAINT corporate_tax_bridges_body_statement_check;
ALTER TABLE openerp.corporate_tax_bridges ADD CONSTRAINT corporate_tax_bridges_body_statement_check
  CHECK (body->'overlay'->>'statementSnapshotId' IS NOT DISTINCT FROM statement_snapshot_id
    AND body->'overlay'->>'statementDigest' IS NOT DISTINCT FROM statement_digest);
ALTER TABLE openerp.corporate_tax_effects DROP CONSTRAINT corporate_tax_effects_body_committed_at_check;
ALTER TABLE openerp.corporate_tax_effects ADD CONSTRAINT corporate_tax_effects_body_committed_at_check
  CHECK ((body->>'committedAt')::timestamptz IS NOT DISTINCT FROM committed_at);
-- Released NEXT-22 contracts already name these roles/family; its baseline
-- constraints omitted them. These additions enable the consumed tax HTTP port.
-- Row locking needs an UPDATE privilege; the immutable trigger still refuses DML.
GRANT UPDATE(id) ON openerp.corporate_tax_bridges TO openerp_runtime;
ALTER TABLE openerp.rule_releases DROP CONSTRAINT rule_releases_family_check;
ALTER TABLE openerp.rule_releases ADD CONSTRAINT rule_releases_family_check
  CHECK (family IN ('posting_eligibility','vat','payroll','statements','legal_ar','corporate_tax'));
ALTER TABLE openerp.company_activations DROP CONSTRAINT company_activations_family_check;
ALTER TABLE openerp.company_activations ADD CONSTRAINT company_activations_family_check
  CHECK (family IN ('posting_eligibility','vat','payroll','statements','legal_ar','corporate_tax'));
ALTER TABLE openerp.company_role_bindings DROP CONSTRAINT company_role_bindings_role_kind_check;
ALTER TABLE openerp.company_role_bindings ADD CONSTRAINT company_role_bindings_role_kind_check
  CHECK (role_kind IN ('bank','commerce','owner','subledger','tax','vat','corporate_tax_expense','corporate_tax_liability','corporate_tax_other_expense'));
CREATE TABLE openerp.financial_reopen_proposals (
  book_id text NOT NULL, id text NOT NULL, certificate_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,certificate_id) REFERENCES openerp.financial_close_certificates(book_id,id),
  CHECK (body->>'id'=id AND body->'scope'->>'bookId'=book_id),
  CHECK (body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.financial_reopen_approvals (
  book_id text NOT NULL, id text NOT NULL, proposal_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id), body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,proposal_id) REFERENCES openerp.financial_reopen_proposals(book_id,id),
  CHECK (body->>'id'=id AND body->>'proposalId'=proposal_id AND body->>'actorId'=actor_id)
);
CREATE TRIGGER immutable_financial_reopen_proposal BEFORE UPDATE OR DELETE ON openerp.financial_reopen_proposals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_financial_reopen_approval BEFORE UPDATE OR DELETE ON openerp.financial_reopen_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.financial_reopen_proposals,openerp.financial_reopen_approvals TO openerp_runtime;

-- Refusals retain exact dependencies but do not consume the certificate.
ALTER TABLE openerp.financial_reopen_events DROP CONSTRAINT financial_reopen_events_book_id_certificate_id_key;
CREATE UNIQUE INDEX financial_reopen_success ON openerp.financial_reopen_events(book_id,certificate_id)
  WHERE body->'downstreamRefusals'='[]'::jsonb;
CREATE UNIQUE INDEX financial_reopen_proposal_outcome ON openerp.financial_reopen_events(book_id,(body->>'proposalId'));
CREATE UNIQUE INDEX financial_reopen_approval_use ON openerp.financial_reopen_events(book_id,(body->>'approvalId'));
CREATE UNIQUE INDEX financial_close_approval_use ON openerp.financial_close_certificates(book_id,(body->>'approvalId'));
