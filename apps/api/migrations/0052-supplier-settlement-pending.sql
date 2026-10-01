CREATE TABLE openerp.supplier_settlement_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  invoice_id text NOT NULL,
  statement_id text NOT NULL,
  row_ordinal integer NOT NULL CHECK (row_ordinal BETWEEN 1 AND 10000),
  payment_change_set_id text NOT NULL,
  allocation_plan_id text NOT NULL,
  reserved_voucher_id text NOT NULL,
  control_line_id text NOT NULL,
  bank_line_id text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 262144),
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,payment_change_set_id),
  UNIQUE (book_id,allocation_plan_id),
  UNIQUE (book_id,reserved_voucher_id),
  FOREIGN KEY (book_id,invoice_id) REFERENCES openerp.commerce_invoices(book_id,id),
  FOREIGN KEY (book_id,statement_id,row_ordinal) REFERENCES openerp.bank_observations(book_id,statement_id,row_ordinal),
  FOREIGN KEY (book_id,payment_change_set_id) REFERENCES openerp.change_sets(book_id,id),
  FOREIGN KEY (book_id,allocation_plan_id) REFERENCES openerp.commerce_allocation_plans(book_id,id),
  CHECK (control_line_id <> bank_line_id),
  CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->'input'->>'invoiceId'=invoice_id
    AND body->'input'->>'statementId'=statement_id AND (body->'input'->>'rowOrdinal')::integer=row_ordinal
    AND body->'paymentPlan'->>'id'=payment_change_set_id AND body->'pendingAllocation'->>'id'=allocation_plan_id
    AND body->>'reservedVoucherId'=reserved_voucher_id AND body->>'controlLineId'=control_line_id AND body->>'bankLineId'=bank_line_id) IS TRUE)
);
CREATE TABLE openerp.supplier_settlement_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  payment_approval_id text NOT NULL,
  allocation_approval_id text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 262144),
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,plan_id) REFERENCES openerp.supplier_settlement_plans(book_id,id),
  FOREIGN KEY (book_id,payment_approval_id) REFERENCES openerp.approvals(book_id,id),
  FOREIGN KEY (book_id,allocation_approval_id) REFERENCES openerp.commerce_allocation_approvals(book_id,id),
  CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'planId'=plan_id
    AND body->>'actorId'=actor_id AND body->>'paymentApprovalId'=payment_approval_id AND body->>'allocationApprovalId'=allocation_approval_id) IS TRUE)
);
CREATE TABLE openerp.supplier_settlement_revocations (
  book_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 262144),
  PRIMARY KEY (book_id,approval_id),
  FOREIGN KEY (book_id,approval_id) REFERENCES openerp.supplier_settlement_approvals(book_id,id),
  CHECK ((body->>'approvalId'=approval_id) IS TRUE)
);
CREATE TRIGGER immutable_supplier_settlement_plan BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_settlement_approval BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_settlement_revocation BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.supplier_settlement_plans, openerp.supplier_settlement_approvals, openerp.supplier_settlement_revocations TO openerp_runtime;
