CREATE TABLE openerp.asset_proceeds_reviews (
 book_id text NOT NULL, id text NOT NULL, schedule_id text NOT NULL,
 change_set_id text NOT NULL, evidence_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY(book_id,id), UNIQUE(book_id,id,schedule_id), UNIQUE(book_id,change_set_id),
 FOREIGN KEY(book_id,schedule_id) REFERENCES openerp.subledger_schedules(book_id,id),
 FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
 FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
 CHECK(octet_length(body::text)<=1048576 AND body->>'id'=id AND body->'scope'->>'bookId'=book_id
 AND body->'assetBasis'->'schedule'->>'scheduleId'=schedule_id
 AND body->'postingPlan'->>'id'=change_set_id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.asset_proceeds_approvals (
 book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors(id), expires_at timestamptz NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY(book_id,id), UNIQUE(book_id,id,review_id),
 FOREIGN KEY(book_id,review_id) REFERENCES openerp.asset_proceeds_reviews(book_id,id),
 CHECK(body->>'id'=id AND body->>'reviewId'=review_id AND body->>'actorId'=actor_id
 AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.asset_proceeds_effects (
 book_id text NOT NULL, id text NOT NULL, schedule_id text NOT NULL, review_id text NOT NULL,
 approval_id text NOT NULL, kind text NOT NULL CHECK(kind IN('disposal','error_correction')),
 correction_of text, proceeds_identity text NOT NULL, posting_date date NOT NULL,
 voucher_id text NOT NULL, posting_receipt_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY(book_id,id), UNIQUE(book_id,review_id), UNIQUE(book_id,approval_id),
 UNIQUE(book_id,voucher_id), UNIQUE(book_id,posting_receipt_id), UNIQUE(book_id,correction_of),
 FOREIGN KEY(book_id,review_id,schedule_id) REFERENCES openerp.asset_proceeds_reviews(book_id,id,schedule_id),
 FOREIGN KEY(book_id,approval_id,review_id) REFERENCES openerp.asset_proceeds_approvals(book_id,id,review_id),
 FOREIGN KEY(book_id,correction_of) REFERENCES openerp.asset_proceeds_effects(book_id,id),
 FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
 FOREIGN KEY(book_id,posting_receipt_id) REFERENCES openerp.execution_receipts(book_id,id),
 CHECK((kind='disposal' AND correction_of IS NULL) OR(kind='error_correction' AND correction_of IS NOT NULL)),
 CHECK(octet_length(body::text)<=1048576 AND body->>'id'=id AND body->'scope'->>'bookId'=book_id
 AND body->>'scheduleId'=schedule_id AND body->>'reviewId'=review_id AND body->>'approvalId'=approval_id
 AND body->>'kind'=kind AND (body->>'correctionOf') IS NOT DISTINCT FROM correction_of
 AND body->'proceeds'->>'proceedsIdentity'=proceeds_identity
 AND body->'postingReceipt'->>'id'=posting_receipt_id AND body->'postingReceipt'->>'voucherId'=voucher_id
 AND body->>'digest'=openerp.digest(body-'digest'))
);
ALTER TABLE openerp.bank_allocation_approvals ADD COLUMN owner_kind text,
 ADD COLUMN owner_review_id text, ADD COLUMN owner_approval_id text,
 ADD CONSTRAINT bank_allocation_approval_owner CHECK(
 (owner_kind IS NULL AND owner_review_id IS NULL AND owner_approval_id IS NULL) OR
 (owner_kind IS NOT NULL AND owner_kind='asset_proceeds_disposal' AND owner_review_id IS NOT NULL AND owner_approval_id IS NOT NULL)),
 ADD CONSTRAINT bank_allocation_approval_owner_fk FOREIGN KEY(book_id,owner_approval_id,owner_review_id)
 REFERENCES openerp.asset_proceeds_approvals(book_id,id,review_id);
CREATE TRIGGER immutable_asset_proceeds_review BEFORE UPDATE OR DELETE ON openerp.asset_proceeds_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_asset_proceeds_approval BEFORE UPDATE OR DELETE ON openerp.asset_proceeds_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_asset_proceeds_effect BEFORE UPDATE OR DELETE ON openerp.asset_proceeds_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.asset_proceeds_reviews,openerp.asset_proceeds_approvals,
 openerp.asset_proceeds_effects TO openerp_runtime;
