-- NEXT-24: K2 annual-report semantic model and iXBRL.
-- Forward migration on the reviewed baseline plus 0005-next-13.sql
-- (statement snapshots) and 0026-next-23.sql (financial-close
-- certificates). The baseline is not renumbered or revived.
--
-- An annual report is one sealed draft, one human approval, one finalized
-- semantic model with its render intent, one presentation revision and one
-- retained artifact. The K2 framework release, the disclosure requirements,
-- the taxonomy concept mappings and every non-ledger fact arrive as reviewed
-- operator input sealed in the draft; a missing one is a refusal, never a
-- default, and none of them is stored as a policy in this file. No qualified
-- native XBRL validator is released, so every retained artifact carries
-- validation pending: retained evidence, never a validated manifest. These
-- tables only hold the sealed records, so a later posting cannot change what
-- a captured report already meant. There is no function, no policy, no rate
-- table and no report calculation here.

CREATE TABLE openerp.annual_report_drafts (
  book_id text NOT NULL,
  id text NOT NULL,
  fiscal_year_id text NOT NULL,
  close_certificate_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT annual_report_drafts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT annual_report_drafts_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT annual_report_drafts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT annual_report_drafts_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT annual_report_drafts_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT annual_report_drafts_year_check CHECK (NOT body ->> 'fiscalYearId'::text IS DISTINCT FROM fiscal_year_id),
  CONSTRAINT annual_report_drafts_book_id_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id)
);

CREATE TABLE openerp.annual_report_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  draft_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT annual_report_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT annual_report_approvals_book_id_draft_id_ordinal_key UNIQUE (book_id, draft_id, ordinal),
  CONSTRAINT annual_report_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT annual_report_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT annual_report_approvals_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.annual_report_drafts(book_id, id)
);

CREATE TABLE openerp.annual_report_finals (
  book_id text NOT NULL,
  id text NOT NULL,
  draft_id text NOT NULL,
  approval_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT annual_report_finals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT annual_report_finals_book_id_draft_id_key UNIQUE (book_id, draft_id),
  CONSTRAINT annual_report_finals_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT annual_report_finals_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT annual_report_finals_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT annual_report_finals_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT annual_report_finals_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.annual_report_drafts(book_id, id)
);

CREATE TABLE openerp.annual_report_presentations (
  book_id text NOT NULL,
  id text NOT NULL,
  final_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT annual_report_presentations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT annual_report_presentations_book_id_final_id_key UNIQUE (book_id, final_id),
  CONSTRAINT annual_report_presentations_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT annual_report_presentations_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT annual_report_presentations_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT annual_report_presentations_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT annual_report_presentations_book_id_final_id_fkey FOREIGN KEY (book_id, final_id) REFERENCES openerp.annual_report_finals(book_id, id)
);

CREATE TABLE openerp.annual_report_artifacts (
  book_id text NOT NULL,
  id text NOT NULL,
  presentation_id text NOT NULL,
  final_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT annual_report_artifacts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT annual_report_artifacts_book_id_presentation_id_key UNIQUE (book_id, presentation_id),
  CONSTRAINT annual_report_artifacts_body_check CHECK (octet_length(body::text) <= 4194304),
  CONSTRAINT annual_report_artifacts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT annual_report_artifacts_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT annual_report_artifacts_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT annual_report_artifacts_book_id_presentation_id_fkey FOREIGN KEY (book_id, presentation_id) REFERENCES openerp.annual_report_presentations(book_id, id)
);

CREATE INDEX annual_report_drafts_year ON openerp.annual_report_drafts (book_id, fiscal_year_id);
CREATE INDEX annual_report_finals_year ON openerp.annual_report_finals (book_id, fiscal_year_id);

-- A sealed report record is history. A revised report seals new rows; it
-- never rewrites what an earlier report meant, and old signed bytes stay
-- retained under their own digest.
CREATE TRIGGER immutable_annual_report_draft
  BEFORE DELETE OR UPDATE ON openerp.annual_report_drafts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_annual_report_approval
  BEFORE DELETE OR UPDATE ON openerp.annual_report_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_annual_report_final
  BEFORE DELETE OR UPDATE ON openerp.annual_report_finals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_annual_report_presentation
  BEFORE DELETE OR UPDATE ON openerp.annual_report_presentations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_annual_report_artifact
  BEFORE DELETE OR UPDATE ON openerp.annual_report_artifacts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.annual_report_drafts, openerp.annual_report_approvals,
  openerp.annual_report_finals, openerp.annual_report_presentations,
  openerp.annual_report_artifacts TO openerp_runtime;
