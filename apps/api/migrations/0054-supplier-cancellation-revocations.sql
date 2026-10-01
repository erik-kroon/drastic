CREATE TABLE openerp.supplier_settlement_cancellation_revocations (
  book_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 262144),
  PRIMARY KEY (book_id, approval_id),
  FOREIGN KEY (book_id, approval_id) REFERENCES openerp.supplier_settlement_cancellation_approvals(book_id, id),
  CHECK ((body->>'approvalId' = approval_id) IS TRUE)
);
CREATE TRIGGER immutable_supplier_settlement_cancellation_revocation
  BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_cancellation_revocations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.supplier_settlement_cancellation_revocations TO openerp_runtime;
