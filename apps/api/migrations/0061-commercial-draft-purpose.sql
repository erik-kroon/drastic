ALTER TABLE openerp.invoice_draft_revisions
  ADD CONSTRAINT invoice_draft_revision_purpose_check CHECK ((
    body->>'purpose' IS NULL
    OR (
      body->>'purpose' = 'source_transcription'
      AND body->>'calculationBasis' = 'explicit_line_amounts_v1'
    )
    OR (
      body->>'purpose' = 'commercial'
      AND body->>'calculationBasis' = 'commercial_minor_v1'
      AND jsonb_typeof(body->'commercialInput') = 'object'
      AND body->>'inputDigest' IS NOT NULL
      AND body->'content'->'sourceTotalMinor' = 'null'::jsonb
    )
  ) IS TRUE);
