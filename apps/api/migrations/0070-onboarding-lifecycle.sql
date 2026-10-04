ALTER TABLE openerp.books DROP CONSTRAINT books_authority_check;
ALTER TABLE openerp.books ADD CONSTRAINT books_authority_check
  CHECK (authority IN ('native', 'onboarding_fenced'));

CREATE TABLE openerp.onboarding_controls (
 book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, snapshot_id text,
 body jsonb NOT NULL, PRIMARY KEY(book_id,id),
 CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE)
);
CREATE TABLE openerp.onboarding_responsibilities (
 book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, snapshot_id text,
 body jsonb NOT NULL, PRIMARY KEY(book_id,id),
 CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE)
);
CREATE UNIQUE INDEX onboarding_policy_revision ON openerp.onboarding_responsibilities(book_id, (body->>'revision'));
CREATE TABLE openerp.onboarding_snapshots (
 book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, snapshot_id text,
 body jsonb NOT NULL, PRIMARY KEY(book_id,id),
 CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=openerp.digest(body-'digest')) IS TRUE)
);
CREATE TABLE openerp.onboarding_decisions (
 book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, snapshot_id text NOT NULL,
 body jsonb NOT NULL, PRIMARY KEY(book_id,id),
 FOREIGN KEY(book_id,snapshot_id) REFERENCES openerp.onboarding_snapshots(book_id,id),
 CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'snapshotId'=snapshot_id) IS TRUE)
);
CREATE TABLE openerp.onboarding_activation_intents (
 book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, snapshot_id text NOT NULL,
 body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,snapshot_id),
 FOREIGN KEY(book_id,snapshot_id) REFERENCES openerp.onboarding_snapshots(book_id,id),
 CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'snapshotId'=snapshot_id) IS TRUE)
);
CREATE TABLE openerp.onboarding_operational_proofs (
 book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, snapshot_id text NOT NULL,
 body jsonb NOT NULL, PRIMARY KEY(book_id,id),
 FOREIGN KEY(book_id,snapshot_id) REFERENCES openerp.onboarding_snapshots(book_id,id),
 CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'snapshotId'=snapshot_id
   AND body->>'kind'='synthetic_local_writer_fence_restore_v1') IS TRUE)
);
CREATE TABLE openerp.onboarding_activation_receipts (
 book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, snapshot_id text NOT NULL,
 body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id),
 FOREIGN KEY(book_id,snapshot_id) REFERENCES openerp.onboarding_snapshots(book_id,id),
 CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->'snapshot'->>'id'=snapshot_id) IS TRUE)
);
CREATE TABLE openerp.onboarding_first_period_completions (
 book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, snapshot_id text NOT NULL,
 body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,snapshot_id),
 FOREIGN KEY(book_id,snapshot_id) REFERENCES openerp.onboarding_snapshots(book_id,id),
 CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->'snapshot'->>'id'=snapshot_id) IS TRUE)
);
CREATE TRIGGER immutable_onboarding_control BEFORE UPDATE OR DELETE ON openerp.onboarding_controls FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_policy BEFORE UPDATE OR DELETE ON openerp.onboarding_responsibilities FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_snapshot BEFORE UPDATE OR DELETE ON openerp.onboarding_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_decision BEFORE UPDATE OR DELETE ON openerp.onboarding_decisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_intent BEFORE UPDATE OR DELETE ON openerp.onboarding_activation_intents FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_proof BEFORE UPDATE OR DELETE ON openerp.onboarding_operational_proofs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_activation BEFORE UPDATE OR DELETE ON openerp.onboarding_activation_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_onboarding_completion BEFORE UPDATE OR DELETE ON openerp.onboarding_first_period_completions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT ON openerp.onboarding_controls, openerp.onboarding_responsibilities,
 openerp.onboarding_snapshots, openerp.onboarding_decisions, openerp.onboarding_activation_intents,
 openerp.onboarding_operational_proofs, openerp.onboarding_activation_receipts,
 openerp.onboarding_first_period_completions TO openerp_runtime;
GRANT INSERT ON openerp.onboarding_controls, openerp.onboarding_responsibilities,
 openerp.onboarding_snapshots, openerp.onboarding_decisions, openerp.onboarding_activation_intents,
 openerp.onboarding_first_period_completions TO openerp_runtime;
