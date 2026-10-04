CREATE TABLE openerp.treasury_loans (
 book_id text NOT NULL, id text NOT NULL, principal_effect_id text NOT NULL,
 evidence_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY (book_id,id), UNIQUE (book_id,principal_effect_id),
 FOREIGN KEY (book_id,principal_effect_id) REFERENCES openerp.owner_effects(book_id,id),
 FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
 CHECK (octet_length(body::text)<=1048576 AND body->>'id'=id AND body->'scope'->>'bookId'=book_id
 AND body->'input'->>'principalEffectId'=principal_effect_id AND body->'evidence'->>'evidenceId'=evidence_id
 AND body->>'ledgerDeltaMinor'='0' AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.treasury_loan_account_roles (
 book_id text NOT NULL, account_id text NOT NULL, role text NOT NULL,
 PRIMARY KEY (book_id,account_id),
 FOREIGN KEY (book_id,account_id) REFERENCES openerp.accounts(book_id,id),
 CHECK (role IN ('interest_expense','interest_liability','fee_expense'))
);
CREATE TABLE openerp.treasury_loan_rates (
 book_id text NOT NULL, id text NOT NULL, loan_id text NOT NULL, effective_on date NOT NULL,
 evidence_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY (book_id,id), UNIQUE (book_id,loan_id,effective_on),
 FOREIGN KEY (book_id,loan_id) REFERENCES openerp.treasury_loans(book_id,id),
 FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
 CHECK (body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'loanId'=loan_id
 AND body->'input'->>'effectiveOn'=effective_on::text AND body->'evidence'->>'evidenceId'=evidence_id
 AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.treasury_loan_reviews (
 book_id text NOT NULL, id text NOT NULL, loan_id text NOT NULL, kind text NOT NULL,
 change_set_id text, event_id text, evidence_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY (book_id,id), UNIQUE (book_id,id,loan_id),
 UNIQUE (book_id,change_set_id), UNIQUE (book_id,event_id),
 FOREIGN KEY (book_id,loan_id) REFERENCES openerp.treasury_loans(book_id,id),
 FOREIGN KEY (book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
 FOREIGN KEY (book_id,event_id) REFERENCES openerp.events(book_id,id),
 FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
 CHECK (kind IN ('accrual','repayment') AND octet_length(body::text)<=1048576
 AND body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'loanId'=loan_id
 AND body->'input'->>'kind'=kind AND body->'evidence'->>'evidenceId'=evidence_id
 AND (body->'postingPlan'->>'id') IS NOT DISTINCT FROM change_set_id
 AND (body->'postingPlan'->'groups'->0->'actions'->0->>'eventId') IS NOT DISTINCT FROM event_id
 AND ((change_set_id IS NOT NULL AND event_id IS NOT NULL)
 OR (kind='accrual' AND change_set_id IS NULL AND event_id IS NULL AND body->'calculation'->>'deltaMinor'='0'))
 AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.treasury_loan_approvals (
 book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors(id), expires_at timestamptz NOT NULL, body jsonb NOT NULL,
 kernel_approval_id text,
 PRIMARY KEY (book_id,id), UNIQUE (book_id,id,review_id),
 UNIQUE (book_id,kernel_approval_id),
 FOREIGN KEY (book_id,review_id) REFERENCES openerp.treasury_loan_reviews(book_id,id),
 FOREIGN KEY (book_id,kernel_approval_id) REFERENCES openerp.approvals(book_id,id),
 CHECK (body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'reviewId'=review_id
 AND body->>'actorId'=actor_id AND (body->>'expiresAt')::timestamptz=expires_at
 AND (body->>'kernelApprovalId') IS NOT DISTINCT FROM kernel_approval_id
 AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.treasury_loan_events (
 book_id text NOT NULL, id text NOT NULL, loan_id text NOT NULL, review_id text NOT NULL,
 approval_id text NOT NULL, kind text NOT NULL, posting_date date NOT NULL,
 principal_minor openerp.minor_units NOT NULL, interest_minor openerp.minor_units NOT NULL,
 fee_minor openerp.minor_units NOT NULL, coverage_end_exclusive_on date,
 owner_effect_id text, posting_receipt_id text, voucher_id text, body jsonb NOT NULL,
 PRIMARY KEY (book_id,id), UNIQUE (book_id,review_id), UNIQUE (book_id,approval_id),
 UNIQUE (book_id,posting_receipt_id), UNIQUE (book_id,voucher_id), UNIQUE (book_id,owner_effect_id),
 FOREIGN KEY (book_id,review_id,loan_id) REFERENCES openerp.treasury_loan_reviews(book_id,id,loan_id),
 FOREIGN KEY (book_id,approval_id,review_id) REFERENCES openerp.treasury_loan_approvals(book_id,id,review_id),
 FOREIGN KEY (book_id,owner_effect_id) REFERENCES openerp.owner_effects(book_id,id),
 FOREIGN KEY (book_id,posting_receipt_id) REFERENCES openerp.execution_receipts(book_id,id),
 FOREIGN KEY (book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
 CHECK ((kind='accrual' AND principal_minor::numeric=0 AND fee_minor::numeric=0 AND owner_effect_id IS NULL
 AND coverage_end_exclusive_on IS NOT NULL) OR (kind='repayment' AND coverage_end_exclusive_on IS NULL
 AND ((principal_minor::numeric=0 AND owner_effect_id IS NULL) OR (principal_minor::numeric>0 AND owner_effect_id IS NOT NULL)))),
 CHECK ((posting_receipt_id IS NULL AND voucher_id IS NULL AND kind='accrual' AND interest_minor::numeric=0 AND body->>'noJournal'='true')
 OR (posting_receipt_id IS NOT NULL AND voucher_id IS NOT NULL AND body->>'noJournal'='false')),
 CHECK (body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'loanId'=loan_id
 AND body->>'reviewId'=review_id AND body->>'approvalId'=approval_id AND body->>'kind'=kind
 AND body->>'postingDate'=posting_date::text AND body->>'principalMinor'=principal_minor::text
 AND body->>'interestMinor'=interest_minor::text AND body->>'feeMinor'=fee_minor::text
 AND (body->>'coverageEndExclusiveOn') IS NOT DISTINCT FROM coverage_end_exclusive_on::text
 AND (body->>'ownerEffectId') IS NOT DISTINCT FROM owner_effect_id
 AND (body->'postingReceipt'->>'id') IS NOT DISTINCT FROM posting_receipt_id
 AND (body->'postingReceipt'->>'voucherId') IS NOT DISTINCT FROM voucher_id
 AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.treasury_loan_allocations (
 book_id text NOT NULL, event_id text NOT NULL, claim_id text NOT NULL, settlement_id text NOT NULL,
 amount_minor openerp.minor_units NOT NULL CHECK (amount_minor::numeric>0),
 PRIMARY KEY (book_id,event_id), UNIQUE (book_id,settlement_id),
 FOREIGN KEY (book_id,event_id) REFERENCES openerp.treasury_loan_events(book_id,id),
 FOREIGN KEY (book_id,claim_id) REFERENCES openerp.owner_effects(book_id,id),
 FOREIGN KEY (book_id,settlement_id) REFERENCES openerp.owner_effects(book_id,id)
);
CREATE TRIGGER immutable_treasury_loan BEFORE UPDATE OR DELETE ON openerp.treasury_loans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_treasury_loan_role BEFORE UPDATE OR DELETE ON openerp.treasury_loan_account_roles FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_treasury_loan_rate BEFORE UPDATE OR DELETE ON openerp.treasury_loan_rates FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_treasury_loan_review BEFORE UPDATE OR DELETE ON openerp.treasury_loan_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_treasury_loan_approval BEFORE UPDATE OR DELETE ON openerp.treasury_loan_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_treasury_loan_event BEFORE UPDATE OR DELETE ON openerp.treasury_loan_events FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_treasury_loan_allocation BEFORE UPDATE OR DELETE ON openerp.treasury_loan_allocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.treasury_loans,openerp.treasury_loan_account_roles,openerp.treasury_loan_rates,openerp.treasury_loan_reviews,openerp.treasury_loan_approvals,openerp.treasury_loan_events,openerp.treasury_loan_allocations TO openerp_runtime;
