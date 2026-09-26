-- NEXT-02 capability-specific company admission. Forward migration on the reviewed
-- 0001-0003 baseline, which is not renumbered or revived.
--
-- The application owns fact review, release selection, role resolution and
-- activation policy. This file carries structure, the existing immutable-record
-- guards, and the runtime grants only: no feature procedure, no calculator, no
-- dispatcher and no session context.
--
-- Sealed activation plans, their approvals and their no-journal receipts reuse the
-- existing change_sets / approvals / posting_group_receipts identity, so this file
-- adds only the company admission record model those records reference.

CREATE TABLE openerp.rule_releases (
  id text NOT NULL,
  jurisdiction text COLLATE "C" NOT NULL,
  family text NOT NULL,
  version integer NOT NULL,
  checksum text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT rule_releases_pkey PRIMARY KEY (id),
  CONSTRAINT rule_releases_jurisdiction_family_version_key UNIQUE (jurisdiction, family, version),
  CONSTRAINT rule_releases_family_check CHECK (family = ANY (ARRAY['posting_eligibility'::text, 'vat'::text, 'payroll'::text, 'statements'::text, 'legal_ar'::text])),
  CONSTRAINT rule_releases_jurisdiction_check CHECK (jurisdiction ~ '^[A-Z]{2}$'::text),
  CONSTRAINT rule_releases_version_check CHECK (version >= 1 AND version <= 10000),
  CONSTRAINT rule_releases_checksum_check CHECK (checksum ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT rule_releases_body_check CHECK (octet_length(body::text) <= 131072)
);

CREATE TABLE openerp.company_fact_revisions (
  entity_id text NOT NULL,
  id text NOT NULL,
  fact_kind text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  supersedes_id text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT company_fact_revisions_pkey PRIMARY KEY (entity_id, id),
  CONSTRAINT company_fact_revisions_fact_kind_check CHECK (fact_kind = ANY (ARRAY['jurisdiction'::text, 'legal_form'::text, 'organization_number'::text, 'accounting_method'::text, 'vat_registration'::text, 'vat_period'::text, 'fiscal_year'::text, 'payroll_registration'::text])),
  CONSTRAINT company_fact_revisions_interval_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT company_fact_revisions_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT company_fact_revisions_body_check CHECK (body ->> 'id'::text = id AND body ->> 'entityId'::text = entity_id AND body ->> 'factKind'::text = fact_kind AND body ->> 'effectiveFrom'::text = effective_from::text AND body ->> 'recordedBy'::text = recorded_by),
  CONSTRAINT company_fact_revisions_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES openerp.entities(id),
  CONSTRAINT company_fact_revisions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES openerp.actors(id)
);
CREATE INDEX company_fact_revisions_selection_idx
  ON openerp.company_fact_revisions (entity_id, fact_kind, effective_from, effective_to);

CREATE TABLE openerp.company_fact_reviews (
  entity_id text NOT NULL,
  fact_revision_id text NOT NULL,
  reviewer text NOT NULL,
  result text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT company_fact_reviews_pkey PRIMARY KEY (entity_id, fact_revision_id),
  CONSTRAINT company_fact_reviews_result_check CHECK (result = ANY (ARRAY['confirmed'::text, 'rejected'::text])),
  CONSTRAINT company_fact_reviews_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT company_fact_reviews_body_check CHECK (body ->> 'factRevisionId'::text = fact_revision_id AND body ->> 'reviewer'::text = reviewer AND body ->> 'result'::text = result),
  CONSTRAINT company_fact_reviews_reviewer_fkey FOREIGN KEY (reviewer) REFERENCES openerp.actors(id),
  CONSTRAINT company_fact_reviews_revision_fkey FOREIGN KEY (entity_id, fact_revision_id) REFERENCES openerp.company_fact_revisions(entity_id, id)
);

CREATE TABLE openerp.company_role_bindings (
  book_id text NOT NULL,
  id text NOT NULL,
  role_kind text NOT NULL,
  account_id text NOT NULL,
  account_version bigint NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  supersedes_id text,
  reviewer text NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT company_role_bindings_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT company_role_bindings_role_kind_check CHECK (role_kind = ANY (ARRAY['bank'::text, 'commerce'::text, 'owner'::text, 'subledger'::text, 'tax'::text, 'vat'::text])),
  CONSTRAINT company_role_bindings_account_version_check CHECK (account_version > 0),
  CONSTRAINT company_role_bindings_interval_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT company_role_bindings_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT company_role_bindings_body_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'roleKind'::text = role_kind AND body ->> 'accountId'::text = account_id AND body ->> 'accountVersion'::text = account_version::text),
  CONSTRAINT company_role_bindings_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT company_role_bindings_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT company_role_bindings_reviewer_fkey FOREIGN KEY (reviewer) REFERENCES openerp.actors(id),
  CONSTRAINT company_role_bindings_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES openerp.actors(id)
);
CREATE INDEX company_role_bindings_selection_idx
  ON openerp.company_role_bindings (book_id, role_kind, effective_from, effective_to);

-- One mutable admission epoch per family. Every sealed activation plan depends on
-- it, so an activation that lands first makes a stale plan fail rather than write.
CREATE TABLE openerp.company_family_memberships (
  book_id text NOT NULL,
  family text NOT NULL,
  membership_epoch bigint DEFAULT 1 NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT company_family_memberships_pkey PRIMARY KEY (book_id, family),
  CONSTRAINT company_family_memberships_epoch_check CHECK (membership_epoch >= 1),
  CONSTRAINT company_family_memberships_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);

CREATE TABLE openerp.company_activations (
  book_id text NOT NULL,
  id text NOT NULL,
  family text NOT NULL,
  rule_release_id text NOT NULL,
  change_set_id text,
  effective_from date NOT NULL,
  effective_to date,
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT company_activations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT company_activations_book_id_id_effective_from_key UNIQUE (book_id, id, effective_from),
  CONSTRAINT company_activations_family_check CHECK (family = ANY (ARRAY['posting_eligibility'::text, 'vat'::text, 'payroll'::text, 'statements'::text, 'legal_ar'::text])),
  CONSTRAINT company_activations_interval_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT company_activations_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT company_activations_body_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'family'::text = family AND body ->> 'ruleReleaseId'::text = rule_release_id),
  CONSTRAINT company_activations_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT company_activations_rule_release_id_fkey FOREIGN KEY (rule_release_id) REFERENCES openerp.rule_releases(id),
  CONSTRAINT company_activations_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES openerp.actors(id),
  CONSTRAINT company_activations_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id)
);
CREATE INDEX company_activations_selection_idx
  ON openerp.company_activations (book_id, family, effective_from, effective_to);
-- One committed effect per sealed proposal, so a new key cannot activate the same
-- proposal twice.
CREATE UNIQUE INDEX company_activations_plan_key
  ON openerp.company_activations (book_id, change_set_id)
  WHERE change_set_id IS NOT NULL;

-- A retroactive fact correction never rewrites a committed activation. It records
-- which already-selected revisions that correction reaches.
CREATE TABLE openerp.company_activation_impacts (
  book_id text NOT NULL,
  id text NOT NULL,
  fact_revision_id text NOT NULL,
  superseded_revision_id text NOT NULL,
  activation_id text NOT NULL,
  already_in_force boolean NOT NULL,
  recorded_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT company_activation_impacts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT company_activation_impacts_unique_key UNIQUE (book_id, fact_revision_id, activation_id),
  CONSTRAINT company_activation_impacts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT company_activation_impacts_body_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'factRevisionId'::text = fact_revision_id AND body ->> 'activationId'::text = activation_id),
  CONSTRAINT company_activation_impacts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT company_activation_impacts_activation_id_fkey FOREIGN KEY (book_id, activation_id) REFERENCES openerp.company_activations(book_id, id)
);

-- Immutable history. The guard functions and the canonicalization helpers are the
-- ones 0001-0003 already reviewed; this migration declares no function.
CREATE TRIGGER immutable_rule_release BEFORE DELETE OR UPDATE ON openerp.rule_releases FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_company_fact_revision BEFORE DELETE OR UPDATE ON openerp.company_fact_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_company_fact_review BEFORE DELETE OR UPDATE ON openerp.company_fact_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_company_role_binding BEFORE DELETE OR UPDATE ON openerp.company_role_bindings FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_company_activation BEFORE DELETE OR UPDATE ON openerp.company_activations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_company_activation_impact BEFORE DELETE OR UPDATE ON openerp.company_activation_impacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role receives only the company admission tables this release uses.
-- Rule releases are read-only here: no application operation writes one.
GRANT SELECT ON TABLE openerp.rule_releases TO openerp_runtime;
GRANT SELECT, INSERT ON TABLE openerp.company_fact_revisions, openerp.company_fact_reviews,
  openerp.company_role_bindings, openerp.company_activations,
  openerp.company_activation_impacts TO openerp_runtime;
GRANT SELECT, INSERT, UPDATE (membership_epoch, updated_at)
  ON TABLE openerp.company_family_memberships TO openerp_runtime;
