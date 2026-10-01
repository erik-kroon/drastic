CREATE TABLE openerp.supplier_settlement_receipts (
 book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, approval_id text NOT NULL,
 statement_id text NOT NULL, row_ordinal integer NOT NULL, invoice_id text NOT NULL,
 voucher_id text NOT NULL, allocation_receipt_id text NOT NULL,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=262144),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,plan_id), UNIQUE(book_id,approval_id), UNIQUE(book_id,voucher_id), UNIQUE(book_id,allocation_receipt_id),
 FOREIGN KEY(book_id,plan_id) REFERENCES openerp.supplier_settlement_plans(book_id,id),
 FOREIGN KEY(book_id,approval_id) REFERENCES openerp.supplier_settlement_approvals(book_id,id),
 FOREIGN KEY(book_id,statement_id,row_ordinal) REFERENCES openerp.bank_matches(book_id,statement_id,row_ordinal),
 FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices(book_id,id),
 FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
 FOREIGN KEY(book_id,allocation_receipt_id) REFERENCES openerp.commerce_allocation_receipts(book_id,id),
 CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'planId'=plan_id AND body->>'approvalId'=approval_id AND body->'postingReceipt'->>'voucherId'=voucher_id AND body->'allocationReceipt'->>'id'=allocation_receipt_id AND body->'match'->>'statementId'=statement_id AND (body->'match'->>'rowOrdinal')::integer=row_ordinal) IS TRUE)
);
CREATE TABLE openerp.supplier_settlement_source_claims (
 book_id text NOT NULL, statement_id text NOT NULL, row_ordinal integer NOT NULL,
 receipt_id text NOT NULL, plan_id text NOT NULL,
 PRIMARY KEY(book_id,statement_id,row_ordinal), UNIQUE(book_id,receipt_id),
 FOREIGN KEY(book_id,statement_id,row_ordinal) REFERENCES openerp.bank_observations(book_id,statement_id,row_ordinal),
 FOREIGN KEY(book_id,receipt_id) REFERENCES openerp.supplier_settlement_receipts(book_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(book_id,plan_id) REFERENCES openerp.supplier_settlement_plans(book_id,id)
);
CREATE TABLE openerp.supplier_settlement_cancellation_plans (
 book_id text NOT NULL, id text NOT NULL, settlement_receipt_id text NOT NULL,
 payment_change_set_id text NOT NULL, allocation_reversal_id text NOT NULL, match_reversal_id text NOT NULL,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=262144),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,payment_change_set_id), UNIQUE(book_id,allocation_reversal_id), UNIQUE(book_id,match_reversal_id),
 FOREIGN KEY(book_id,settlement_receipt_id) REFERENCES openerp.supplier_settlement_receipts(book_id,id),
 FOREIGN KEY(book_id,payment_change_set_id) REFERENCES openerp.change_sets(book_id,id),
 FOREIGN KEY(book_id,allocation_reversal_id) REFERENCES openerp.commerce_allocation_reversal_plans(book_id,id),
 FOREIGN KEY(book_id,match_reversal_id) REFERENCES openerp.bank_match_reversal_plans(book_id,id),
 CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->'original'->>'id'=settlement_receipt_id AND body->'paymentPlan'->>'id'=payment_change_set_id AND body->'allocationReversal'->>'id'=allocation_reversal_id AND body->'matchReversal'->>'id'=match_reversal_id) IS TRUE)
);
CREATE TABLE openerp.supplier_settlement_cancellation_approvals (
 book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, actor_id text NOT NULL REFERENCES openerp.actors(id),
 payment_approval_id text NOT NULL, allocation_approval_id text NOT NULL, match_approval_id text NOT NULL,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=262144),
 PRIMARY KEY(book_id,id),
 FOREIGN KEY(book_id,plan_id) REFERENCES openerp.supplier_settlement_cancellation_plans(book_id,id),
 FOREIGN KEY(book_id,payment_approval_id) REFERENCES openerp.approvals(book_id,id),
 FOREIGN KEY(book_id,allocation_approval_id) REFERENCES openerp.commerce_allocation_reversal_approvals(book_id,id),
 FOREIGN KEY(book_id,match_approval_id) REFERENCES openerp.bank_match_reversal_approvals(book_id,id),
 CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'planId'=plan_id AND body->>'actorId'=actor_id AND body->>'paymentApprovalId'=payment_approval_id AND body->>'allocationApprovalId'=allocation_approval_id AND body->>'matchApprovalId'=match_approval_id) IS TRUE)
);
CREATE TABLE openerp.supplier_settlement_cancellation_receipts (
 book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, approval_id text NOT NULL, settlement_receipt_id text NOT NULL,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=262144), PRIMARY KEY(book_id,id), UNIQUE(book_id,settlement_receipt_id), UNIQUE(book_id,plan_id), UNIQUE(book_id,approval_id),
 FOREIGN KEY(book_id,plan_id) REFERENCES openerp.supplier_settlement_cancellation_plans(book_id,id),
 FOREIGN KEY(book_id,approval_id) REFERENCES openerp.supplier_settlement_cancellation_approvals(book_id,id),
 FOREIGN KEY(book_id,settlement_receipt_id) REFERENCES openerp.supplier_settlement_receipts(book_id,id),
 CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'planId'=plan_id AND body->>'approvalId'=approval_id AND body->>'settlementReceiptId'=settlement_receipt_id) IS TRUE)
);
CREATE TRIGGER immutable_supplier_settlement_receipt BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_settlement_source_claim BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_source_claims FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_settlement_cancellation_plan BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_cancellation_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_settlement_cancellation_approval BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_cancellation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_settlement_cancellation_receipt BEFORE UPDATE OR DELETE ON openerp.supplier_settlement_cancellation_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.supplier_settlement_receipts,openerp.supplier_settlement_source_claims,openerp.supplier_settlement_cancellation_plans,openerp.supplier_settlement_cancellation_approvals,openerp.supplier_settlement_cancellation_receipts TO openerp_runtime;
ALTER TABLE openerp.supplier_settlement_receipts ADD UNIQUE(book_id,id,plan_id,statement_id,row_ordinal);
ALTER TABLE openerp.supplier_settlement_source_claims ADD FOREIGN KEY(book_id,receipt_id,plan_id,statement_id,row_ordinal) REFERENCES openerp.supplier_settlement_receipts(book_id,id,plan_id,statement_id,row_ordinal) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.supplier_settlement_cancellation_plans ADD UNIQUE(book_id,id,settlement_receipt_id);
ALTER TABLE openerp.supplier_settlement_cancellation_approvals ADD UNIQUE(book_id,id,plan_id);
ALTER TABLE openerp.supplier_settlement_cancellation_receipts ADD FOREIGN KEY(book_id,plan_id,settlement_receipt_id) REFERENCES openerp.supplier_settlement_cancellation_plans(book_id,id,settlement_receipt_id);
ALTER TABLE openerp.supplier_settlement_cancellation_receipts ADD FOREIGN KEY(book_id,approval_id,plan_id) REFERENCES openerp.supplier_settlement_cancellation_approvals(book_id,id,plan_id);
