-- NEXT-22: the pre-close corporate income-tax bridge, the current-tax effect and
-- the INK2/SRU declaration lineage.
--
-- Three records, one per deliverable, and they never share a transaction:
--
--   corporate_tax_bridges        a sealed pre-close proposal. It posts nothing,
--                                consumes no loss right and has no financial effect.
--   corporate_tax_effects        the one financial effect. Each row is an approved
--                                current-tax delta that committed with its journal,
--                                its approval use and its counter, or an approved
--                                no-effect receipt when the target was already
--                                recognised.
--   corporate_tax_declarations   the declaration lineage. It is a report artifact
--                                that is never a financial effect, so it is never
--                                in the bridge journal transaction.
--
-- The application owns the policy, the exact bridge calculation, the INK2 field
-- mapping, the SRU record writer and its refusal vocabulary. These tables only
-- retain the immutable headers, their exact retained input references and their
-- sealed payloads, so a later statement snapshot, role binding, rule release or
-- recognised effect cannot rewrite what one sealed bridge already means.
--
-- There is no function, no policy, no tax calculator, no form state machine and no
-- dispatcher here. It reuses the baseline `immutable_row` guard and the `digest`
-- check helper, reuses the existing `change_sets` / `approvals` /
-- `posting_group_receipts` identity instead of a parallel set, and adds no second
-- rule-release authority: the reviewed rate, rounding, loss profile, journal series,
-- declaration field map and SRU grammar live in the one existing
-- `openerp.rule_releases` record.

CREATE TABLE openerp.corporate_tax_bridges (
  book_id text NOT NULL,
  id text NOT NULL,
  fiscal_year_id text NOT NULL,
  accounting_period_id text NOT NULL,
  statement_snapshot_id text NOT NULL,
  statement_digest text NOT NULL,
  change_set_id text NOT NULL,
  plan_digest text NOT NULL,
  rule_release_id text NOT NULL,
  rule_release_checksum text NOT NULL,
  rule_release_version integer NOT NULL,
  overlay_digest text NOT NULL,
  current_tax_target_minor numeric NOT NULL,
  recognized_minor numeric NOT NULL,
  delta_minor numeric NOT NULL,
  posts_journal boolean NOT NULL,
  no_financial_effect boolean NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corporate_tax_bridges_pkey PRIMARY KEY (book_id, id),
  -- One sealed plan per bridge. A second proposal over the same pre-tax population
  -- is a new bridge with its own digest, never a rewrite of an approved one.
  CONSTRAINT corporate_tax_bridges_change_set_key UNIQUE (book_id, change_set_id),
  CONSTRAINT corporate_tax_bridges_digest_key UNIQUE (book_id, digest),
  CONSTRAINT corporate_tax_bridges_plan_digest_check CHECK (plan_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT corporate_tax_bridges_statement_digest_check CHECK (statement_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT corporate_tax_bridges_overlay_digest_check CHECK (overlay_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT corporate_tax_bridges_digest_body_check CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT corporate_tax_bridges_release_checksum_check CHECK (rule_release_checksum ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT corporate_tax_bridges_release_version_check CHECK (rule_release_version >= 1 AND rule_release_version <= 10000),
  CONSTRAINT corporate_tax_bridges_recognized_check CHECK (recognized_minor >= 0),
  CONSTRAINT corporate_tax_bridges_target_check CHECK (current_tax_target_minor >= 0),
  -- A zero delta is an explicit no-effect plan. It never becomes a zero voucher and
  -- it never consumes a voucher number.
  CONSTRAINT corporate_tax_bridges_posts_journal_check CHECK (
    (posts_journal AND delta_minor <> 0) OR (NOT posts_journal AND delta_minor = 0)
  ),
  CONSTRAINT corporate_tax_bridges_no_effect_check CHECK (no_financial_effect),
  CONSTRAINT corporate_tax_bridges_body_check CHECK (jsonb_typeof(body) = 'object'::text AND body <> '{}'::jsonb),
  CONSTRAINT corporate_tax_bridges_body_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT corporate_tax_bridges_body_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT corporate_tax_bridges_body_kind_check CHECK (body ->> 'kind'::text = 'preclose_corporate_tax_bridge_v1'::text),
  CONSTRAINT corporate_tax_bridges_body_change_set_check CHECK (NOT body ->> 'changeSetId'::text IS DISTINCT FROM change_set_id),
  CONSTRAINT corporate_tax_bridges_body_plan_digest_check CHECK (NOT body ->> 'planDigest'::text IS DISTINCT FROM plan_digest),
  CONSTRAINT corporate_tax_bridges_body_fiscal_year_check CHECK (NOT body ->> 'fiscalYearId'::text IS DISTINCT FROM fiscal_year_id),
  CONSTRAINT corporate_tax_bridges_body_period_check CHECK (NOT body ->> 'accountingPeriodId'::text IS DISTINCT FROM accounting_period_id),
  CONSTRAINT corporate_tax_bridges_body_statement_check CHECK (
    NOT body ->> 'statementSnapshotId'::text IS DISTINCT FROM statement_snapshot_id
    AND NOT body ->> 'statementDigest'::text IS DISTINCT FROM statement_digest
  ),
  CONSTRAINT corporate_tax_bridges_body_target_check CHECK (NOT body ->> 'currentTaxTargetMinor'::text IS DISTINCT FROM current_tax_target_minor::text),
  CONSTRAINT corporate_tax_bridges_body_recognized_check CHECK (NOT body ->> 'recognizedCurrentTaxMinor'::text IS DISTINCT FROM recognized_minor::text),
  CONSTRAINT corporate_tax_bridges_body_delta_check CHECK (NOT body ->> 'remainingCurrentTaxDeltaMinor'::text IS DISTINCT FROM delta_minor::text),
  CONSTRAINT corporate_tax_bridges_body_posts_journal_check CHECK (
    (body ->> 'postsJournal'::text)::boolean IS NOT DISTINCT FROM posts_journal
  ),
  CONSTRAINT corporate_tax_bridges_body_no_effect_check CHECK (body ->> 'noFinancialEffect'::text = 'true'::text),
  CONSTRAINT corporate_tax_bridges_body_release_check CHECK (
    NOT body -> 'mappingRelease'::text ->> 'id'::text IS DISTINCT FROM rule_release_id
    AND NOT body -> 'mappingRelease'::text ->> 'checksum'::text IS DISTINCT FROM rule_release_checksum
    AND NOT body -> 'mappingRelease'::text ->> 'version'::text IS DISTINCT FROM rule_release_version::text
  ),
  CONSTRAINT corporate_tax_bridges_body_digest_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM digest),
  CONSTRAINT corporate_tax_bridges_body_created_by_check CHECK (NOT body ->> 'createdBy'::text IS DISTINCT FROM created_by),
  CONSTRAINT corporate_tax_bridges_body_created_at_check CHECK (NOT body ->> 'createdAt'::text IS DISTINCT FROM created_at::text),
  CONSTRAINT corporate_tax_bridges_body_overlay_check CHECK (jsonb_typeof(body -> 'overlay'::text) = 'object'::text),
  CONSTRAINT corporate_tax_bridges_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT corporate_tax_bridges_book_id_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id),
  CONSTRAINT corporate_tax_bridges_period_fkey FOREIGN KEY (book_id, accounting_period_id) REFERENCES openerp.periods(book_id, id),
  CONSTRAINT corporate_tax_bridges_book_id_statement_snapshot_id_fkey FOREIGN KEY (book_id, statement_snapshot_id) REFERENCES openerp.report_statement_snapshots(book_id, id),
  CONSTRAINT corporate_tax_bridges_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT corporate_tax_bridges_rule_release_id_fkey FOREIGN KEY (rule_release_id) REFERENCES openerp.rule_releases(id),
  CONSTRAINT corporate_tax_bridges_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);

CREATE TABLE openerp.corporate_tax_bridge_inputs (
  book_id text NOT NULL,
  bridge_id text NOT NULL,
  ordinal integer NOT NULL,
  kind text NOT NULL,
  resource_id text NOT NULL,
  version text NOT NULL,
  reason text NOT NULL,
  CONSTRAINT corporate_tax_bridge_inputs_pkey PRIMARY KEY (book_id, bridge_id, ordinal),
  CONSTRAINT corporate_tax_bridge_inputs_ref_key UNIQUE (book_id, bridge_id, kind, resource_id),
  CONSTRAINT corporate_tax_bridge_inputs_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT corporate_tax_bridge_inputs_kind_check CHECK (kind = ANY (ARRAY[
    'statement_snapshot'::text, 'rule_release'::text, 'company_activation'::text,
    'company_family_membership'::text, 'company_fact_revision'::text, 'company_fact_review'::text,
    'company_role_binding'::text, 'accounting_period'::text, 'tax_adjustment'::text,
    'loss_position'::text, 'other_income_tax_support'::text, 'book'::text
  ])),
  CONSTRAINT corporate_tax_bridge_inputs_ref_check CHECK (length(resource_id) > 0 AND length(version) > 0),
  CONSTRAINT corporate_tax_bridge_inputs_book_id_bridge_id_fkey FOREIGN KEY (book_id, bridge_id) REFERENCES openerp.corporate_tax_bridges(book_id, id)
);

CREATE TABLE openerp.corporate_tax_effects (
  book_id text NOT NULL,
  id text NOT NULL,
  bridge_id text NOT NULL,
  change_set_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  voucher_id text,
  approval_id text NOT NULL,
  year_tax_target_minor numeric NOT NULL,
  recognized_before_minor numeric NOT NULL,
  delta_minor numeric NOT NULL,
  recognized_after_minor numeric NOT NULL,
  no_financial_effect boolean NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_by text NOT NULL,
  committed_at timestamptz NOT NULL,
  -- One approved effect per sealed bridge. A different key cannot authorize a
  -- second posting of the same year target, and the year is the level at which the
  -- recognised total is compared, so the effect rows are read in one set.
  CONSTRAINT corporate_tax_effects_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT corporate_tax_effects_bridge_key UNIQUE (book_id, bridge_id),
  CONSTRAINT corporate_tax_effects_change_set_key UNIQUE (book_id, change_set_id),
  CONSTRAINT corporate_tax_effects_digest_key UNIQUE (book_id, digest),
  CONSTRAINT corporate_tax_effects_target_check CHECK (year_tax_target_minor >= 0 AND recognized_before_minor >= 0),
  -- Recognising is a forward movement toward the sealed target, so the recognised
  -- total can only grow and a reversal is a signed negative delta of its own.
  CONSTRAINT corporate_tax_effects_recognized_after_check CHECK (
    recognized_after_minor = recognized_before_minor + delta_minor
  ),
  CONSTRAINT corporate_tax_effects_no_effect_check CHECK (
    no_financial_effect = (voucher_id IS NULL)
  ),
  CONSTRAINT corporate_tax_effects_digest_check CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT corporate_tax_effects_body_check CHECK (jsonb_typeof(body) = 'object'::text AND body <> '{}'::jsonb),
  CONSTRAINT corporate_tax_effects_body_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT corporate_tax_effects_body_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT corporate_tax_effects_body_kind_check CHECK (body ->> 'kind'::text = 'current_income_tax_effect_v1'::text),
  CONSTRAINT corporate_tax_effects_body_bridge_check CHECK (
    NOT body ->> 'bridgeId'::text IS DISTINCT FROM bridge_id
    AND NOT body ->> 'changeSetId'::text IS DISTINCT FROM change_set_id
    AND NOT body ->> 'approvalId'::text IS DISTINCT FROM approval_id
  ),
  CONSTRAINT corporate_tax_effects_body_amounts_check CHECK (
    NOT body ->> 'yearTaxTargetMinor'::text IS DISTINCT FROM year_tax_target_minor::text
    AND NOT body ->> 'recognizedBeforeMinor'::text IS DISTINCT FROM recognized_before_minor::text
    AND NOT body ->> 'deltaMinor'::text IS DISTINCT FROM delta_minor::text
    AND NOT body ->> 'recognizedAfterMinor'::text IS DISTINCT FROM recognized_after_minor::text
  ),
  CONSTRAINT corporate_tax_effects_body_voucher_check CHECK (NOT body ->> 'voucherId'::text IS DISTINCT FROM voucher_id),
  CONSTRAINT corporate_tax_effects_body_no_effect_check CHECK (
    (body ->> 'noFinancialEffect'::text)::boolean IS NOT DISTINCT FROM no_financial_effect
  ),
  CONSTRAINT corporate_tax_effects_body_digest_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM digest),
  CONSTRAINT corporate_tax_effects_body_created_by_check CHECK (NOT body ->> 'createdBy'::text IS DISTINCT FROM created_by),
  CONSTRAINT corporate_tax_effects_body_committed_at_check CHECK (NOT body ->> 'committedAt'::text IS DISTINCT FROM committed_at::text),
  CONSTRAINT corporate_tax_effects_book_id_bridge_id_fkey FOREIGN KEY (book_id, bridge_id) REFERENCES openerp.corporate_tax_bridges(book_id, id),
  CONSTRAINT corporate_tax_effects_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT corporate_tax_effects_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.approvals(book_id, id),
  CONSTRAINT corporate_tax_effects_voucher_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT corporate_tax_effects_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);

CREATE TABLE openerp.corporate_tax_declarations (
  book_id text NOT NULL,
  id text NOT NULL,
  ordinal bigint NOT NULL,
  bridge_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  statement_snapshot_id text NOT NULL,
  field_count integer NOT NULL,
  file_count integer NOT NULL,
  blocked boolean NOT NULL,
  no_financial_effect boolean NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corporate_tax_declarations_pkey PRIMARY KEY (book_id, id),
  -- The retained file bytes make every lineage its own record. A repeated read or a
  -- repeated preparation returns the retained bytes; it never re-renders a file.
  CONSTRAINT corporate_tax_declarations_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT corporate_tax_declarations_digest_key UNIQUE (book_id, digest),
  CONSTRAINT corporate_tax_declarations_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 9223372036854775807),
  CONSTRAINT corporate_tax_declarations_counts_check CHECK (field_count >= 0 AND file_count >= 0 AND file_count <= 2),
  -- A blocked lineage renders no file at all. The two deliverables of the file
  -- transfer contract are either both retained or neither is.
  CONSTRAINT corporate_tax_declarations_blocked_check CHECK (NOT blocked OR file_count = 0),
  CONSTRAINT corporate_tax_declarations_no_effect_check CHECK (no_financial_effect),
  CONSTRAINT corporate_tax_declarations_digest_check CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT corporate_tax_declarations_body_check CHECK (jsonb_typeof(body) = 'object'::text AND body <> '{}'::jsonb),
  CONSTRAINT corporate_tax_declarations_body_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT corporate_tax_declarations_body_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT corporate_tax_declarations_body_kind_check CHECK (body ->> 'kind'::text = 'income_tax_declaration_v1'::text),
  CONSTRAINT corporate_tax_declarations_body_ordinal_check CHECK (NOT body ->> 'ordinal'::text IS DISTINCT FROM ordinal::text),
  CONSTRAINT corporate_tax_declarations_body_bridge_check CHECK (
    NOT body ->> 'bridgeId'::text IS DISTINCT FROM bridge_id
    AND NOT body ->> 'statementSnapshotId'::text IS DISTINCT FROM statement_snapshot_id
    AND NOT body -> 'fiscalYear'::text ->> 'id'::text IS DISTINCT FROM fiscal_year_id
  ),
  CONSTRAINT corporate_tax_declarations_body_counts_check CHECK (
    NOT body ->> 'blocked'::text IS DISTINCT FROM blocked::text
    AND jsonb_array_length(coalesce(body -> 'files'::text, '[]'::jsonb)) = file_count
  ),
  CONSTRAINT corporate_tax_declarations_body_no_effect_check CHECK (body ->> 'noFinancialEffect'::text = 'true'::text),
  CONSTRAINT corporate_tax_declarations_body_digest_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM digest),
  CONSTRAINT corporate_tax_declarations_body_created_by_check CHECK (NOT body ->> 'createdBy'::text IS DISTINCT FROM created_by),
  CONSTRAINT corporate_tax_declarations_body_created_at_check CHECK (NOT body ->> 'createdAt'::text IS DISTINCT FROM created_at::text),
  CONSTRAINT corporate_tax_declarations_book_id_bridge_id_fkey FOREIGN KEY (book_id, bridge_id) REFERENCES openerp.corporate_tax_bridges(book_id, id),
  CONSTRAINT corporate_tax_declarations_book_id_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id),
  CONSTRAINT corporate_tax_declarations_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);

CREATE INDEX corporate_tax_bridges_year ON openerp.corporate_tax_bridges (book_id, fiscal_year_id, id);
CREATE INDEX corporate_tax_bridges_statement ON openerp.corporate_tax_bridges (book_id, statement_snapshot_id, id);
CREATE INDEX corporate_tax_effects_year ON openerp.corporate_tax_effects (book_id, fiscal_year_id, id);
CREATE INDEX corporate_tax_declarations_year ON openerp.corporate_tax_declarations (book_id, fiscal_year_id, id);

-- A sealed bridge, its retained input references, a committed effect and a retained
-- declaration lineage are history. Later activity creates a new one; it never
-- rewrites the meaning of a captured one, and its retained input references are
-- never re-pointed.
CREATE TRIGGER immutable_corporate_tax_bridge
  BEFORE DELETE OR UPDATE ON openerp.corporate_tax_bridges
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_corporate_tax_bridge_input
  BEFORE DELETE OR UPDATE ON openerp.corporate_tax_bridge_inputs
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_corporate_tax_effect
  BEFORE DELETE OR UPDATE ON openerp.corporate_tax_effects
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_corporate_tax_declaration
  BEFORE DELETE OR UPDATE ON openerp.corporate_tax_declarations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.corporate_tax_bridges, openerp.corporate_tax_bridge_inputs, openerp.corporate_tax_effects, openerp.corporate_tax_declarations TO openerp_runtime;
