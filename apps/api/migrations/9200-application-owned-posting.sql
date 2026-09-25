ALTER TABLE openerp.vouchers ADD COLUMN expected_line_count integer;

UPDATE openerp.vouchers
SET expected_line_count = jsonb_array_length(action->'lines')
WHERE expected_line_count IS NULL;

ALTER TABLE openerp.vouchers
  ALTER COLUMN expected_line_count SET NOT NULL,
  ADD CONSTRAINT voucher_expected_line_count CHECK (expected_line_count BETWEEN 2 AND 500);

CREATE FUNCTION openerp.voucher_expected_line_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE
  target_book text;
  target_voucher text;
  actual_count integer;
  expected_count integer;
  debit numeric;
  credit numeric;
BEGIN
  IF TG_TABLE_NAME = 'vouchers' THEN
    target_book := NEW.book_id;
    target_voucher := NEW.id;
    expected_count := NEW.expected_line_count;
  ELSE
    target_book := NEW.book_id;
    target_voucher := NEW.voucher_id;
    SELECT expected_line_count INTO expected_count
      FROM openerp.vouchers
     WHERE book_id = target_book AND id = target_voucher;
  END IF;
  SELECT count(*), sum(debit_minor), sum(credit_minor)
    INTO actual_count, debit, credit
    FROM openerp.journal_lines
   WHERE book_id = target_book AND voucher_id = target_voucher;
  IF actual_count IS DISTINCT FROM expected_count THEN
    PERFORM openerp.fail('InvalidJournal', 'The voucher journal line count does not match its expected count.');
  END IF;
  IF actual_count < 2 OR debit IS NULL OR credit IS NULL OR debit <= 0 OR debit <> credit THEN
    PERFORM openerp.fail('InvalidJournal', 'A voucher must have at least two lines and balance exactly.');
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER voucher_expected_line_count_voucher
AFTER INSERT ON openerp.vouchers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION openerp.voucher_expected_line_count();

CREATE CONSTRAINT TRIGGER voucher_expected_line_count_line
AFTER INSERT ON openerp.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION openerp.voucher_expected_line_count();

CREATE TABLE openerp.posting_group_receipts (
  book_id text NOT NULL,
  id text NOT NULL,
  change_set_id text NOT NULL,
  group_id text NOT NULL,
  plan_digest text NOT NULL,
  body jsonb NOT NULL,
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, change_set_id, group_id),
  FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CHECK (group_id ~ '^[a-z][a-z0-9_-]{2,127}$'),
  CHECK (body->>'changeSetId' = change_set_id),
  CHECK (body->>'groupId' = group_id),
  CHECK (body->>'planDigest' = plan_digest)
);

CREATE TABLE openerp.approval_consumptions (
  book_id text NOT NULL,
  approval_id text NOT NULL,
  change_set_id text NOT NULL,
  group_id text NOT NULL,
  plan_digest text NOT NULL,
  receipt_id text NOT NULL,
  approver_id text NOT NULL,
  consumed_by_id text NOT NULL,
  consumed_at timestamptz NOT NULL,
  PRIMARY KEY (book_id, approval_id, group_id),
  UNIQUE (book_id, receipt_id, group_id),
  FOREIGN KEY (book_id, approval_id) REFERENCES openerp.approvals(book_id, id),
  FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.posting_group_receipts(book_id, id),
  CHECK (group_id ~ '^[a-z][a-z0-9_-]{2,127}$'),
  CHECK (plan_digest ~ '^sha256:[a-f0-9]{64}$')
);

CREATE TRIGGER immutable_posting_group_receipt
BEFORE UPDATE OR DELETE ON openerp.posting_group_receipts
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_approval_consumption
BEFORE UPDATE OR DELETE ON openerp.approval_consumptions
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

REVOKE ALL ON TABLE openerp.posting_group_receipts, openerp.approval_consumptions,
  openerp.vouchers, openerp.journal_lines, openerp.change_sets, openerp.approvals,
  openerp.series_counters, openerp.events, openerp.evidence, openerp.execution_receipts,
  openerp.command_receipts, openerp.outbox, openerp.books, openerp.fiscal_years, openerp.periods,
  openerp.accounts, openerp.memberships, openerp.correction_bundles,
  openerp.correction_bundle_approvals, openerp.correction_bundle_receipts,
  openerp.posting_saved_requests, openerp.posting_request_outcomes,
  openerp.posting_approval_revocations, openerp.correction_impact_reviews,
  openerp.bank_matches, openerp.bank_allocation_legs, openerp.bank_allocation_plans,
  openerp.bank_allocation_executions, openerp.commerce_invoices,
  openerp.commerce_allocation_legs, openerp.commerce_allocation_plans,
  openerp.commerce_allocation_receipts, openerp.subledger_preparations,
  openerp.report_snapshots, openerp.closing_certificates
FROM PUBLIC, openerp_runtime;

GRANT SELECT ON TABLE openerp.credentials, openerp.memberships, openerp.identity_admissions, openerp.books,
  openerp.fiscal_years, openerp.periods, openerp.accounts, openerp.evidence, openerp.events,
  openerp.change_sets, openerp.approvals, openerp.series_counters, openerp.vouchers, openerp.journal_lines,
  openerp.execution_receipts, openerp.command_receipts, openerp.outbox, openerp.posting_group_receipts,
  openerp.approval_consumptions, openerp.correction_bundles, openerp.correction_bundle_approvals,
  openerp.correction_bundle_receipts, openerp.posting_saved_requests, openerp.posting_request_outcomes,
  openerp.posting_approval_revocations, openerp.correction_impact_reviews, openerp.bank_matches,
  openerp.bank_allocation_legs, openerp.bank_allocation_plans, openerp.bank_allocation_executions,
  openerp.commerce_invoices, openerp.commerce_allocation_legs, openerp.commerce_allocation_plans,
  openerp.commerce_allocation_receipts, openerp.subledger_preparations, openerp.report_snapshots,
  openerp.closing_certificates TO openerp_runtime;

GRANT INSERT ON TABLE openerp.evidence, openerp.events, openerp.change_sets, openerp.approvals,
  openerp.series_counters, openerp.vouchers, openerp.journal_lines, openerp.execution_receipts,
  openerp.command_receipts, openerp.outbox, openerp.posting_group_receipts,
  openerp.approval_consumptions, openerp.correction_bundles, openerp.correction_bundle_approvals,
  openerp.correction_bundle_receipts, openerp.posting_saved_requests, openerp.posting_request_outcomes,
  openerp.posting_approval_revocations, openerp.correction_impact_reviews TO openerp_runtime;

GRANT UPDATE (committed_sequence) ON openerp.books TO openerp_runtime;
GRANT UPDATE (last_number) ON openerp.series_counters TO openerp_runtime;
GRANT UPDATE (consumed_at) ON openerp.approvals TO openerp_runtime;
