-- NEXT-10: provider revisions to reviewed bank observations.
--
-- A published sync window (NEXT-09) says what the provider said. It is not
-- yet a reviewed bank observation, and it is certainly not accounting. These
-- tables carry the step in between:
--
--   * bank_source_revisions is immutable interpreted history. One row per
--     provider transaction identity per publication version, holding the exact
--     normalized facts derived from the retained provider bytes plus the
--     digest of those bytes. A removal carries no facts, because a removal
--     schema has no amount to require.
--   * bank_observation_heads is the current head per provider identity. It is a
--     pointer, not a financial fact, so it alone is updated in place, and only
--     under a version guard.
--   * bank_source_cases records what a human must decide: a material change to
--     an admitted or matched observation, a removal of something already
--     booked, or an unresolved lookalike. A case never moves money.
--   * bank_source_admissions is the reviewed decision. An admission adopts an
--     existing statement-backed bank observation with added provenance, or
--     records that none exists yet. It never creates a second observation and
--     never creates cash capacity.
--
-- The reason an admission can only adopt is structural, not a choice:
-- bank_observations is keyed by statement_id and cannot hold a row without a
-- statement. A provider change on its own is therefore not admissible as an
-- observation, and this schema does not invent a second observation register
-- to work around that.

CREATE TABLE openerp.bank_source_revisions (
  book_id text NOT NULL,
  id text NOT NULL,
  consent_id text NOT NULL,
  generation_id text NOT NULL,
  page_ordinal integer NOT NULL,
  record_ordinal integer NOT NULL,
  provider_transaction_id text NOT NULL,
  change_kind text NOT NULL,
  publication_version text NOT NULL,
  -- The exact provider bytes this was interpreted from. The normalized facts
  -- below are a function of these, never of anything a client stated.
  raw_content_sha256 text NOT NULL,
  raw_locator text NOT NULL,
  -- The interpreted facts, or NULL for a removal: a removal schema carries no
  -- amount, and demanding one would invent a figure the provider never sent.
  normalized jsonb,
  parser_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_source_revisions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_source_revisions_consent_fkey
    FOREIGN KEY (book_id, consent_id) REFERENCES openerp.bank_connector_consents (book_id, id),
  CONSTRAINT bank_source_revisions_generation_fkey
    FOREIGN KEY (book_id, generation_id) REFERENCES openerp.bank_sync_generations (book_id, id),
  CONSTRAINT bank_source_revisions_content_fkey
    FOREIGN KEY (book_id, raw_content_sha256) REFERENCES openerp.intake_contents (book_id, sha256),
  CONSTRAINT bank_source_revisions_kind_check
    CHECK (change_kind = ANY (ARRAY['added'::text, 'modified'::text, 'removed'::text])),
  CONSTRAINT bank_source_revisions_identity_check
    CHECK (length(provider_transaction_id) >= 1 AND length(provider_transaction_id) <= 256),
  CONSTRAINT bank_source_revisions_ordinal_check
    CHECK (page_ordinal >= 0 AND record_ordinal >= 0),
  CONSTRAINT bank_source_revisions_version_check
    CHECK (publication_version ~ '^(0|[1-9][0-9]{0,37})$'::text),
  CONSTRAINT bank_source_revisions_digest_check
    CHECK (raw_content_sha256 ~ '^sha256:[a-f0-9]{64}$'::text),
  -- A removal has no facts and a non-removal must have them. This is what
  -- stops an interpreted removal from smuggling in an amount.
  CONSTRAINT bank_source_revisions_facts_check CHECK (
    (change_kind = 'removed'::text AND normalized IS NULL)
    OR (change_kind <> 'removed'::text AND jsonb_typeof(normalized) = 'object'::text)
  ),
  -- One interpretation per provider identity per publication version. The
  -- revision order is the published order, never a guessed timestamp.
  CONSTRAINT bank_source_revisions_identity_version_key
    UNIQUE (book_id, consent_id, provider_transaction_id, publication_version)
);

CREATE INDEX bank_source_revisions_identity
  ON openerp.bank_source_revisions
    (book_id, consent_id, provider_transaction_id, publication_version);

-- The current head per provider identity. The only mutable row here.
CREATE TABLE openerp.bank_observation_heads (
  book_id text NOT NULL,
  consent_id text NOT NULL,
  provider_transaction_id text NOT NULL,
  latest_revision_id text NOT NULL,
  -- Bumped when a material change makes existing matching or coverage
  -- eligibility stale. It is evidence that a re-check is owed, not a flag
  -- that something is already wrong.
  eligibility_version bigint NOT NULL DEFAULT 0,
  -- The exact statement-backed observation this identity was admitted as, if
  -- it was. Adopting is the only way in: this table never points at a
  -- free-standing observation.
  admitted_statement_id text,
  admitted_row_ordinal integer,
  matched boolean NOT NULL DEFAULT false,
  accounting_complete boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_observation_heads_pkey
    PRIMARY KEY (book_id, consent_id, provider_transaction_id),
  CONSTRAINT bank_observation_heads_revision_fkey
    FOREIGN KEY (book_id, latest_revision_id) REFERENCES openerp.bank_source_revisions (book_id, id),
  -- An admitted head names a real observation or nothing at all. A half-set
  -- pair would claim admission without an observation behind it.
  CONSTRAINT bank_observation_heads_admission_check CHECK (
    (admitted_statement_id IS NULL AND admitted_row_ordinal IS NULL)
    OR (admitted_statement_id IS NOT NULL AND admitted_row_ordinal IS NOT NULL)
  ),
  CONSTRAINT bank_observation_heads_identity_check
    CHECK (length(provider_transaction_id) >= 1 AND length(provider_transaction_id) <= 256),
  CONSTRAINT bank_observation_heads_version_check
    CHECK (version >= 0 AND version < 1000000000),
  CONSTRAINT bank_observation_heads_eligibility_check
    CHECK (eligibility_version >= 0 AND eligibility_version < 1000000000)
);

-- What a human must decide. A case is evidence and never a ledger effect.
CREATE TABLE openerp.bank_source_cases (
  book_id text NOT NULL,
  id text NOT NULL,
  consent_id text NOT NULL,
  provider_transaction_id text NOT NULL,
  case_kind text NOT NULL,
  body jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_source_cases_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_source_cases_consent_fkey
    FOREIGN KEY (book_id, consent_id) REFERENCES openerp.bank_connector_consents (book_id, id),
  CONSTRAINT bank_source_cases_kind_check CHECK (
    case_kind = ANY (ARRAY[
      'material_source_change'::text,
      'removed_booked_observation'::text,
      'unresolved_lookalike'::text
    ])
  ),
  CONSTRAINT bank_source_cases_body_check CHECK (jsonb_typeof(body) = 'object'::text)
);

CREATE INDEX bank_source_cases_identity
  ON openerp.bank_source_cases (book_id, consent_id, provider_transaction_id, recorded_at desc);

-- The reviewed decision. Immutable, and unique per revision: one provider
-- revision is admitted at most once, and admitting it twice would double the
-- provenance over a single observation.
CREATE TABLE openerp.bank_source_admissions (
  book_id text NOT NULL,
  id text NOT NULL,
  consent_id text NOT NULL,
  provider_transaction_id text NOT NULL,
  revision_id text NOT NULL,
  -- The adopted observation. It exists in bank_observations, so an admission
  -- cannot invent one.
  statement_id text NOT NULL,
  row_ordinal integer NOT NULL,
  relation text NOT NULL,
  -- The command that recorded the decision, so a repeated command recovers its
  -- own admission and a different one is refused as a second decision.
  command_key text NOT NULL,
  reviewer text NOT NULL,
  review_digest text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_source_admissions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_source_admissions_revision_fkey
    FOREIGN KEY (book_id, revision_id) REFERENCES openerp.bank_source_revisions (book_id, id),
  CONSTRAINT bank_source_admissions_observation_fkey
    FOREIGN KEY (book_id, statement_id, row_ordinal)
    REFERENCES openerp.bank_observations (book_id, statement_id, row_ordinal),
  CONSTRAINT bank_source_admissions_revision_key UNIQUE (book_id, revision_id),
  CONSTRAINT bank_source_admissions_relation_check
    CHECK (relation = ANY (ARRAY['same_event'::text, 'new_statement_observation'::text])),
  CONSTRAINT bank_source_admissions_digest_check
    CHECK (review_digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT bank_source_admissions_body_check CHECK (jsonb_typeof(body) = 'object'::text)
);

CREATE TRIGGER immutable_bank_source_revision
  BEFORE UPDATE OR DELETE ON openerp.bank_source_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_bank_source_case
  BEFORE UPDATE OR DELETE ON openerp.bank_source_cases
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_bank_source_admission
  BEFORE UPDATE OR DELETE ON openerp.bank_source_admissions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The head is a pointer. Its guard is the version the writer observed, so a
-- concurrent revision for the same identity is refused rather than silently
-- merged, and the eligibility version never rewinds.
CREATE OR REPLACE FUNCTION openerp.bank_observation_head_fence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.book_id <> OLD.book_id
     OR NEW.consent_id <> OLD.consent_id
     OR NEW.provider_transaction_id <> OLD.provider_transaction_id
     OR NEW.version <> OLD.version + 1
     OR NEW.eligibility_version < OLD.eligibility_version THEN
    RAISE EXCEPTION
      'bank observation head must advance exactly one version and never rewind eligibility';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_observation_head_fence
  BEFORE UPDATE ON openerp.bank_observation_heads
  FOR EACH ROW EXECUTE FUNCTION openerp.bank_observation_head_fence();

-- The runtime role interprets published changes, keeps the head and records
-- cases. It may only update the head's own columns, and never a revision, a
-- case or an admission.
GRANT SELECT, INSERT ON openerp.bank_source_revisions TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.bank_source_cases TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.bank_source_admissions TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.bank_observation_heads TO openerp_runtime;
GRANT UPDATE (latest_revision_id, eligibility_version, admitted_statement_id,
  admitted_row_ordinal, matched, accounting_complete, version)
  ON openerp.bank_observation_heads TO openerp_runtime;
