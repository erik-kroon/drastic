CREATE TABLE openerp.subledger_valuation_reviews (
 book_id text NOT NULL, id text NOT NULL, schedule_id text NOT NULL,
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 20), decision_key text NOT NULL,
 change_set_id text NOT NULL, evidence_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY (book_id,id), UNIQUE (book_id,id,schedule_id), UNIQUE (book_id,decision_key),
 UNIQUE (book_id,change_set_id), UNIQUE (book_id,schedule_id,ordinal),
 FOREIGN KEY (book_id,schedule_id) REFERENCES openerp.subledger_schedules(book_id,id),
 FOREIGN KEY (book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
 FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
 CHECK (octet_length(body::text) <= 1048576 AND body->>'id'=id AND body->'scope'->>'bookId'=book_id
 AND body->'input'->>'scheduleId'=schedule_id AND body->'input'->>'decisionKey'=decision_key
 AND body->'postingPlan'->>'id'=change_set_id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.subledger_valuation_approvals (
 book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL,
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 20), actor_id text NOT NULL REFERENCES openerp.actors(id),
 expires_at timestamptz NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY (book_id,id), UNIQUE (book_id,id,review_id), UNIQUE (book_id,review_id,ordinal),
 FOREIGN KEY (book_id,review_id) REFERENCES openerp.subledger_valuation_reviews(book_id,id),
 CHECK (body->>'id'=id AND body->>'reviewId'=review_id AND body->>'actorId'=actor_id
 AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.subledger_valuations (
 book_id text NOT NULL, id text NOT NULL, schedule_id text NOT NULL, review_id text NOT NULL,
 approval_id text NOT NULL, decision_key text NOT NULL, kind text NOT NULL,
 direction text NOT NULL CHECK (direction IN ('increase','decrease')),
 correction_of text, magnitude_minor openerp.minor_units NOT NULL CHECK (magnitude_minor::numeric > 0),
 schedule_revision integer NOT NULL, posting_date date NOT NULL,
 accumulated_impairment_account_id text NOT NULL, income_or_loss_account_id text NOT NULL,
 posting_receipt_id text NOT NULL, event_id text NOT NULL, voucher_id text NOT NULL,
 contra_line_id text NOT NULL, result_line_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY (book_id,id), UNIQUE (book_id,review_id), UNIQUE (book_id,approval_id),
 UNIQUE (book_id,decision_key), UNIQUE (book_id,event_id), UNIQUE (book_id,voucher_id),
 UNIQUE (book_id,posting_receipt_id), UNIQUE (book_id,correction_of),
 FOREIGN KEY (book_id,review_id,schedule_id) REFERENCES openerp.subledger_valuation_reviews(book_id,id,schedule_id),
 FOREIGN KEY (book_id,approval_id,review_id) REFERENCES openerp.subledger_valuation_approvals(book_id,id,review_id),
 FOREIGN KEY (book_id,schedule_id,schedule_revision) REFERENCES openerp.subledger_schedule_revisions(book_id,schedule_id,revision),
 FOREIGN KEY (book_id,correction_of) REFERENCES openerp.subledger_valuations(book_id,id),
 FOREIGN KEY (book_id,accumulated_impairment_account_id) REFERENCES openerp.accounts(book_id,id),
 FOREIGN KEY (book_id,income_or_loss_account_id) REFERENCES openerp.accounts(book_id,id),
 FOREIGN KEY (book_id,posting_receipt_id) REFERENCES openerp.execution_receipts(book_id,id),
 FOREIGN KEY (book_id,event_id) REFERENCES openerp.events(book_id,id),
 FOREIGN KEY (book_id,voucher_id,contra_line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id),
 FOREIGN KEY (book_id,voucher_id,result_line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id),
 CHECK ((kind='economic_reversal' AND direction='decrease') OR (kind='full_impairment' AND direction='increase') OR kind='error_correction'),
 CHECK ((kind IN ('economic_reversal','full_impairment') AND correction_of IS NULL)
 OR (kind='error_correction' AND correction_of IS NOT NULL)),
 CHECK (accumulated_impairment_account_id<>income_or_loss_account_id AND body->>'id'=id
 AND body->'scope'->>'bookId'=book_id AND body->>'scheduleId'=schedule_id AND body->>'reviewId'=review_id
 AND body->>'approvalId'=approval_id AND body->>'decisionKey'=decision_key AND body->>'kind'=kind
 AND (body->>'correctionOf') IS NOT DISTINCT FROM correction_of AND body->>'direction'=direction AND body->>'magnitudeMinor'=magnitude_minor::text
 AND body->>'scheduleRevision'=schedule_revision::text AND body->>'postingDate'=posting_date::text
 AND body->>'accumulatedImpairmentAccountId'=accumulated_impairment_account_id
 AND body->>'incomeOrLossAccountId'=income_or_loss_account_id
 AND body->'postingReceipt'->>'id'=posting_receipt_id AND body->'postingReceipt'->>'voucherId'=voucher_id
 AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.subledger_retired_occurrences (
 book_id text NOT NULL, schedule_id text NOT NULL, event_key text NOT NULL, valuation_id text NOT NULL,
 PRIMARY KEY (book_id,schedule_id,event_key),
 FOREIGN KEY (book_id,valuation_id) REFERENCES openerp.subledger_valuations(book_id,id),
 FOREIGN KEY (book_id,schedule_id) REFERENCES openerp.subledger_schedules(book_id,id)
);
CREATE TRIGGER immutable_subledger_valuation_review BEFORE UPDATE OR DELETE ON openerp.subledger_valuation_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_valuation_approval BEFORE UPDATE OR DELETE ON openerp.subledger_valuation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_valuation BEFORE UPDATE OR DELETE ON openerp.subledger_valuations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_retired_occurrence BEFORE UPDATE OR DELETE ON openerp.subledger_retired_occurrences FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.subledger_valuation_reviews, openerp.subledger_valuation_approvals, openerp.subledger_valuations, openerp.subledger_retired_occurrences TO openerp_runtime;
