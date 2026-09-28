-- NEXT-37: successful effects consume source events, not preparation rows.
-- Historical immutable bodies remain readable. Only successful receipts consume
-- identities, events and matches; an unexecuted proposal may be renewed under a
-- fresh immutable ID and independent approval.
ALTER TABLE openerp.vat_assessment_receipts
  ADD COLUMN event_id text,
  ADD COLUMN assessment_identity text;

-- Backfill only relational projections of existing successful receipts. Their
-- immutable bodies/digests and command results are not rewritten. The migration
-- owner temporarily disables this one guard inside the migration transaction;
-- runtime permissions do not change. Conflicting historic financial receipts
-- fail the constraints below instead of being silently discarded.
ALTER TABLE openerp.vat_assessment_receipts DISABLE TRIGGER immutable_vat_assessment_receipt;
UPDATE openerp.vat_assessment_receipts r
  SET event_id = a.event_id, assessment_identity = a.assessment_identity
  FROM openerp.vat_assessments a
  WHERE (a.book_id, a.id) = (r.book_id, r.assessment_id);
ALTER TABLE openerp.vat_assessment_receipts ENABLE TRIGGER immutable_vat_assessment_receipt;
ALTER TABLE openerp.vat_assessment_receipts
  ALTER COLUMN event_id SET NOT NULL,
  ALTER COLUMN assessment_identity SET NOT NULL;

ALTER TABLE openerp.vat_assessments
  DROP CONSTRAINT vat_assessments_book_id_assessment_identity_key,
  ADD CONSTRAINT vat_assessments_record_identity_key UNIQUE (book_id, id, assessment_identity);
DROP INDEX openerp.vat_assessments_match_ref_key;
CREATE INDEX vat_assessments_identity ON openerp.vat_assessments(book_id, assessment_identity);
ALTER TABLE openerp.vat_assessments
  ADD CONSTRAINT vat_assessments_record_event_key UNIQUE (book_id, id, event_id);
ALTER TABLE openerp.tax_account_matches
  ADD CONSTRAINT tax_account_matches_assessment_key UNIQUE (book_id, id, event_id, voucher_id);
ALTER TABLE openerp.vat_assessment_receipts
  ADD CONSTRAINT vat_assessment_receipts_event_fkey FOREIGN KEY (book_id, event_id)
    REFERENCES openerp.tax_account_events(book_id, id),
  ADD CONSTRAINT vat_assessment_receipts_match_fkey FOREIGN KEY (book_id, match_ref)
    REFERENCES openerp.tax_account_matches(book_id, id) NOT VALID,
  ADD CONSTRAINT vat_assessment_receipts_record_event_fkey FOREIGN KEY (book_id, assessment_id, event_id)
    REFERENCES openerp.vat_assessments(book_id, id, event_id),
  ADD CONSTRAINT vat_assessment_receipts_record_identity_fkey FOREIGN KEY (book_id, assessment_id, assessment_identity)
    REFERENCES openerp.vat_assessments(book_id, id, assessment_identity),
  ADD CONSTRAINT vat_assessment_receipts_matched_event_fkey FOREIGN KEY (book_id, match_ref, event_id, voucher_id)
    REFERENCES openerp.tax_account_matches(book_id, id, event_id, voucher_id),
  ADD CONSTRAINT vat_assessment_receipts_event_body_check CHECK (
    NOT (body ? 'eventId') OR (body->>'eventId' IS NOT DISTINCT FROM event_id)),
  ADD CONSTRAINT vat_assessment_receipts_identity_body_check CHECK (
    NOT (body ? 'assessmentIdentity') OR (body->>'assessmentIdentity' IS NOT DISTINCT FROM assessment_identity)),
  ADD CONSTRAINT vat_assessment_receipts_event_key UNIQUE (book_id, event_id),
  ADD CONSTRAINT vat_assessment_receipts_identity_key UNIQUE (book_id, assessment_identity),
  ADD CONSTRAINT vat_assessment_receipts_match_key UNIQUE (book_id, match_ref);

CREATE TABLE openerp.vat_assessment_return_bindings (
  book_id text NOT NULL,
  return_id text NOT NULL,
  obligation_id text NOT NULL,
  PRIMARY KEY (book_id, return_id),
  FOREIGN KEY (book_id, return_id) REFERENCES openerp.vat_actual_returns(book_id, id),
  FOREIGN KEY (book_id, obligation_id) REFERENCES openerp.vat_reporting_obligations(book_id, id)
);
CREATE INDEX vat_assessment_return_bindings_obligation
  ON openerp.vat_assessment_return_bindings(book_id, obligation_id);
CREATE TRIGGER immutable_vat_assessment_return_binding
  BEFORE UPDATE OR DELETE ON openerp.vat_assessment_return_bindings
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.vat_assessment_return_bindings TO openerp_runtime;
