ALTER TABLE openerp.peppol_validation_runs
  ADD COLUMN invoice_issue_id text,
  ADD COLUMN credit_id text,
  ADD COLUMN sender_binding_id text,
  ADD COLUMN recipient_binding_id text,
  ADD COLUMN created_by text REFERENCES openerp.actors(id),
  ADD COLUMN created_at timestamptz,
  ADD FOREIGN KEY(book_id,invoice_issue_id) REFERENCES openerp.ar_legal_issues(book_id,id),
  ADD FOREIGN KEY(book_id,credit_id) REFERENCES openerp.customer_credit_notes(book_id,id),
  ADD FOREIGN KEY(book_id,sender_binding_id) REFERENCES openerp.peppol_bindings(book_id,id),
  ADD FOREIGN KEY(book_id,recipient_binding_id) REFERENCES openerp.peppol_bindings(book_id,id),
  ADD CHECK ((
    (invoice_issue_id IS NULL AND credit_id IS NULL AND sender_binding_id IS NULL
      AND recipient_binding_id IS NULL AND created_by IS NULL AND created_at IS NULL)
    OR ((invoice_issue_id IS NULL) <> (credit_id IS NULL)
      AND sender_binding_id IS NOT NULL AND recipient_binding_id IS NOT NULL
      AND created_by IS NOT NULL AND created_at IS NOT NULL
      AND body->>'id'=id AND body->'scope'->>'bookId'=book_id
      AND body->>'createdBy'=created_by
      AND body->'input'->'document'->>'id'=coalesce(invoice_issue_id,credit_id)
      AND body->'input'->>'senderBindingId'=sender_binding_id
      AND body->'input'->>'recipientBindingId'=recipient_binding_id)
  ) IS TRUE);
CREATE INDEX peppol_review_invoice_page ON openerp.peppol_validation_runs
  (book_id,invoice_issue_id,created_at,id) WHERE invoice_issue_id IS NOT NULL;
CREATE INDEX peppol_review_credit_page ON openerp.peppol_validation_runs
  (book_id,credit_id,created_at,id) WHERE credit_id IS NOT NULL;

CREATE TABLE openerp.peppol_review_returns (
  book_id text NOT NULL, id text NOT NULL,
  review_id text NOT NULL, actor_id text NOT NULL REFERENCES openerp.actors(id),
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,review_id),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.peppol_validation_runs(book_id,id),
  CHECK((body->>'id'=id AND body->>'reviewId'=review_id AND body->>'actorId'=actor_id) IS TRUE)
);
CREATE TRIGGER immutable_peppol_review_return BEFORE UPDATE OR DELETE
  ON openerp.peppol_review_returns FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.peppol_review_returns TO openerp_runtime;
