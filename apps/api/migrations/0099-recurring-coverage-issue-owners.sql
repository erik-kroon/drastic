ALTER TABLE openerp.recurring_invoice_occurrence_issues
  ADD COLUMN invoice_issue_owner text NOT NULL DEFAULT 'internal',
  ADD CONSTRAINT recurring_coverage_issue_owner_check CHECK (invoice_issue_owner IN ('internal', 'legal')),
  ADD CONSTRAINT recurring_coverage_issue_owner_body_check
    CHECK (invoice_issue_owner = COALESCE(body->>'invoiceIssueOwner', 'internal'));

ALTER TABLE openerp.recurring_invoice_occurrence_issues
  ADD COLUMN internal_invoice_issue_id text GENERATED ALWAYS AS
    (CASE WHEN invoice_issue_owner = 'internal' THEN invoice_issue_id END) STORED,
  ADD COLUMN legal_invoice_issue_id text GENERATED ALWAYS AS
    (CASE WHEN invoice_issue_owner = 'legal' THEN invoice_issue_id END) STORED,
  ADD CONSTRAINT recurring_coverage_internal_issue_fkey
    FOREIGN KEY (book_id, internal_invoice_issue_id) REFERENCES openerp.invoice_issues(book_id, id),
  ADD CONSTRAINT recurring_coverage_legal_issue_fkey
    FOREIGN KEY (book_id, legal_invoice_issue_id) REFERENCES openerp.ar_legal_issues(book_id, id),
  DROP CONSTRAINT recurring_invoice_occurrence_issues_invoice_issue_fkey;
