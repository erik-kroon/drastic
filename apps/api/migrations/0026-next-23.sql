-- NEXT-23: financial close and single-count carry-forward.
-- Forward migration on the reviewed baseline plus 0005-next-13.sql
-- (statement snapshots) and 0013-next-22.sql (corporate-tax bridge and
-- effects). The baseline is not renumbered or revived.
--
-- A financial year closes exactly once per revision: one sealed preparation,
-- one sealed final proposal with its transfer delta, one human approval, one
-- certificate with its derived opening set, and the year lock state commit in
-- a single transaction. A reopen appends an immutable event and supersedes;
-- it never rewrites a sealed certificate, opening or report. These tables
-- only hold the sealed records, so a later posting cannot change what a
-- captured close already meant. There is no function, no policy, no rate
-- table and no report calculation here. The year profit comes from the sealed
-- NEXT-13 snapshot, the current-tax position from the sealed NEXT-22
-- bridge and effects, and the transfer accounts from reviewed operator
-- input; a missing one is a refusal, never a default, and none of them is
-- stored as a policy in this file.
--
-- Fiscal-year status is derived from these rows, never stored: a certificate
-- without an active reopen event is closed, a final proposal without a
-- certificate is ready, a preparation with proposed adjustments and no final
-- proposal is adjustments-pending, any other preparation is preparing, and a
-- year with none of these is open. The baseline fiscal_years row carries no
-- close status and is not altered here.

CREATE TABLE openerp.financial_close_preparations (
  book_id text NOT NULL,
  id text NOT NULL,
  fiscal_year_id text NOT NULL,
  statement_snapshot_id text NOT NULL,
  bridge_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT financial_close_preparations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT financial_close_preparations_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT financial_close_preparations_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT financial_close_preparations_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT financial_close_preparations_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT financial_close_preparations_year_check CHECK (NOT body ->> 'fiscalYearId'::text IS DISTINCT FROM fiscal_year_id),
  CONSTRAINT financial_close_preparations_book_id_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id)
);

CREATE TABLE openerp.financial_close_proposals (
  book_id text NOT NULL,
  id text NOT NULL,
  preparation_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT financial_close_proposals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT financial_close_proposals_book_id_preparation_id_key UNIQUE (book_id, preparation_id),
  CONSTRAINT financial_close_proposals_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT financial_close_proposals_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT financial_close_proposals_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT financial_close_proposals_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT financial_close_proposals_book_id_preparation_id_fkey FOREIGN KEY (book_id, preparation_id) REFERENCES openerp.financial_close_preparations(book_id, id)
);

CREATE TABLE openerp.financial_close_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  proposal_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT financial_close_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT financial_close_approvals_book_id_proposal_id_ordinal_key UNIQUE (book_id, proposal_id, ordinal),
  CONSTRAINT financial_close_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT financial_close_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT financial_close_approvals_book_id_proposal_id_fkey FOREIGN KEY (book_id, proposal_id) REFERENCES openerp.financial_close_proposals(book_id, id)
);

CREATE TABLE openerp.financial_close_transfers (
  book_id text NOT NULL,
  id text NOT NULL,
  fiscal_year_id text NOT NULL,
  ordinal integer NOT NULL,
  delta_minor numeric NOT NULL,
  voucher_id text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT financial_close_transfers_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT financial_close_transfers_book_id_fiscal_year_id_ordinal_key UNIQUE (book_id, fiscal_year_id, ordinal),
  CONSTRAINT financial_close_transfers_signed_bounds_check CHECK (
    delta_minor = trunc(delta_minor) AND abs(delta_minor) < '100000000000000000000000000000000000000'::numeric),
  CONSTRAINT financial_close_transfers_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT financial_close_transfers_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT financial_close_transfers_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT financial_close_transfers_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT financial_close_transfers_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE openerp.financial_opening_sets (
  book_id text NOT NULL,
  id text NOT NULL,
  fiscal_year_id text NOT NULL,
  version integer NOT NULL,
  certificate_id text NOT NULL,
  supersedes_id text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT financial_opening_sets_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT financial_opening_sets_book_id_fiscal_year_id_version_key UNIQUE (book_id, fiscal_year_id, version),
  CONSTRAINT financial_opening_sets_version_check CHECK (version >= 1 AND version <= 100),
  CONSTRAINT financial_opening_sets_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT financial_opening_sets_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT financial_opening_sets_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT financial_opening_sets_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT financial_opening_sets_book_id_supersedes_id_fkey FOREIGN KEY (book_id, supersedes_id) REFERENCES openerp.financial_opening_sets(book_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE openerp.financial_close_certificates (
  book_id text NOT NULL,
  id text NOT NULL,
  proposal_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  opening_set_id text NOT NULL,
  transfer_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT financial_close_certificates_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT financial_close_certificates_book_id_proposal_id_key UNIQUE (book_id, proposal_id),
  CONSTRAINT financial_close_certificates_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT financial_close_certificates_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT financial_close_certificates_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT financial_close_certificates_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT financial_close_certificates_book_id_proposal_id_fkey FOREIGN KEY (book_id, proposal_id) REFERENCES openerp.financial_close_proposals(book_id, id),
  CONSTRAINT financial_close_certificates_book_id_opening_set_id_fkey FOREIGN KEY (book_id, opening_set_id) REFERENCES openerp.financial_opening_sets(book_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT financial_close_certificates_book_id_transfer_id_fkey FOREIGN KEY (book_id, transfer_id) REFERENCES openerp.financial_close_transfers(book_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE openerp.financial_reopen_events (
  book_id text NOT NULL,
  id text NOT NULL,
  certificate_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT financial_reopen_events_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT financial_reopen_events_book_id_certificate_id_key UNIQUE (book_id, certificate_id),
  CONSTRAINT financial_reopen_events_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT financial_reopen_events_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT financial_reopen_events_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT financial_reopen_events_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT financial_reopen_events_book_id_certificate_id_fkey FOREIGN KEY (book_id, certificate_id) REFERENCES openerp.financial_close_certificates(book_id, id)
);

CREATE INDEX financial_close_preparations_year ON openerp.financial_close_preparations (book_id, fiscal_year_id);
CREATE INDEX financial_close_proposals_preparation ON openerp.financial_close_proposals (book_id, preparation_id);
CREATE INDEX financial_close_certificates_year ON openerp.financial_close_certificates (book_id, fiscal_year_id);
CREATE INDEX financial_opening_sets_year ON openerp.financial_opening_sets (book_id, fiscal_year_id);
CREATE INDEX financial_close_transfers_year ON openerp.financial_close_transfers (book_id, fiscal_year_id);

-- A sealed close record is history. A reopen appends an event and a revised
-- close seals new rows; neither rewrites what an earlier close meant.
CREATE TRIGGER immutable_financial_close_preparation
  BEFORE DELETE OR UPDATE ON openerp.financial_close_preparations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_financial_close_proposal
  BEFORE DELETE OR UPDATE ON openerp.financial_close_proposals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_financial_close_approval
  BEFORE DELETE OR UPDATE ON openerp.financial_close_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_financial_close_transfer
  BEFORE DELETE OR UPDATE ON openerp.financial_close_transfers
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_financial_opening_set
  BEFORE DELETE OR UPDATE ON openerp.financial_opening_sets
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_financial_close_certificate
  BEFORE DELETE OR UPDATE ON openerp.financial_close_certificates
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_financial_reopen_event
  BEFORE DELETE OR UPDATE ON openerp.financial_reopen_events
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.financial_close_preparations, openerp.financial_close_proposals,
  openerp.financial_close_approvals, openerp.financial_close_transfers, openerp.financial_opening_sets,
  openerp.financial_close_certificates, openerp.financial_reopen_events TO openerp_runtime;
