-- A reference and obligation revision can have several immutable observations.
-- New commands append an observation; exact command replay keeps its old result.
ALTER TABLE openerp.deadline_fulfillments
  ADD COLUMN verification_ordinal bigint NOT NULL DEFAULT 1,
  ADD COLUMN evidence_digest text,
  DROP CONSTRAINT deadline_fulfillments_reference_key,
  ADD CONSTRAINT deadline_fulfillments_observation_key
    UNIQUE (book_id, obligation_id, obligation_revision, reference_digest, verification_ordinal),
  ADD CONSTRAINT deadline_fulfillments_observation_check CHECK (
    verification_ordinal >= 1
    AND coalesce(body ->> 'verificationOrdinal', '1') = verification_ordinal::text
    AND NOT body ->> 'evidenceDigest' IS DISTINCT FROM evidence_digest
    AND (evidence_digest IS NULL OR evidence_digest ~ '^sha256:[a-f0-9]{64}$')
  );
