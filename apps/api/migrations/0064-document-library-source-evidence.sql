CREATE INDEX supplier_invoice_draft_revision_source_evidence
  ON openerp.supplier_invoice_draft_revisions (book_id, (body->'content'->>'sourceEvidenceId'));
