-- NEXT-37: VAT assessment ownership and exact-to-assessed bridge.
-- Forward migration on the reviewed baseline plus 0015-next-04.sql (actual
-- VAT returns). The baseline is not renumbered or revived.
--
-- A rounding bridge carries the exact precision difference between a sealed
-- actual return's exact and reported net into the VAT settlement control,
-- explained only by retained rounding lineage and never by tolerance. An
-- authority assessment binds one tax-account event to one obligation with
-- reviewed confirmations, adopting an already-posted compatible effect or
-- recording a new posting for the released tax-account match port. These
-- tables only hold the sealed records, so a later posting cannot change what
-- a captured assessment already meant. There is no function, no policy, no
-- rate table and no report calculation here. Nets come from the sealed
-- return, the release from its rule release, and the accounts from reviewed
-- operator input; a missing one is a refusal, never a default, and none of
-- them is stored as a policy in this file. The reserved reclassification
-- and amendment owners are consumed, never repeated: no second
-- reclassification, delta or intake is declared here.

CREATE TABLE openerp.vat_rounding_bridges (
  book_id text NOT NULL,
  id text NOT NULL,
  return_id text NOT NULL,
  delta_minor numeric NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT vat_rounding_bridges_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_rounding_bridges_signed_bounds_check CHECK (
    delta_minor = trunc(delta_minor) AND abs(delta_minor) < '100000000000000000000000000000000000000'::numeric),
  CONSTRAINT vat_rounding_bridges_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT vat_rounding_bridges_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT vat_rounding_bridges_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_rounding_bridges_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT vat_rounding_bridges_book_id_return_id_fkey FOREIGN KEY (book_id, return_id) REFERENCES openerp.vat_actual_returns(book_id, id)
);

CREATE TABLE openerp.vat_bridge_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  bridge_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_bridge_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_bridge_approvals_book_id_bridge_id_ordinal_key UNIQUE (book_id, bridge_id, ordinal),
  CONSTRAINT vat_bridge_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT vat_bridge_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT vat_bridge_approvals_book_id_bridge_id_fkey FOREIGN KEY (book_id, bridge_id) REFERENCES openerp.vat_rounding_bridges(book_id, id)
);

CREATE TABLE openerp.vat_assessments (
  book_id text NOT NULL,
  id text NOT NULL,
  assessment_identity text NOT NULL,
  return_id text NOT NULL,
  event_id text NOT NULL,
  match_ref text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT vat_assessments_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_assessments_book_id_assessment_identity_key UNIQUE (book_id, assessment_identity),
  CONSTRAINT vat_assessments_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT vat_assessments_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT vat_assessments_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_assessments_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT vat_assessments_book_id_return_id_fkey FOREIGN KEY (book_id, return_id) REFERENCES openerp.vat_actual_returns(book_id, id)
);

-- One compatible tax-account match adopts at most one authority assessment.
-- The relationship is consumed by reference, never reserved twice.
CREATE UNIQUE INDEX vat_assessments_match_ref_key
  ON openerp.vat_assessments (book_id, match_ref) WHERE match_ref IS NOT NULL;

-- Execution receipts bind a sealed bridge or assessment to its human
-- approval and its posted voucher. The plan rows above are never updated:
-- execution appends here, so a sealed plan cannot change under its approval.
CREATE TABLE openerp.vat_bridge_receipts (
  book_id text NOT NULL,
  id text NOT NULL,
  bridge_id text NOT NULL,
  approval_id text NOT NULL,
  voucher_id text,
  change_set_id text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT vat_bridge_receipts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_bridge_receipts_book_id_bridge_id_key UNIQUE (book_id, bridge_id),
  CONSTRAINT vat_bridge_receipts_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT vat_bridge_receipts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT vat_bridge_receipts_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_bridge_receipts_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT vat_bridge_receipts_book_id_bridge_id_fkey FOREIGN KEY (book_id, bridge_id) REFERENCES openerp.vat_rounding_bridges(book_id, id),
  CONSTRAINT vat_bridge_receipts_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);

CREATE TABLE openerp.vat_assessment_receipts (
  book_id text NOT NULL,
  id text NOT NULL,
  assessment_id text NOT NULL,
  approval_id text NOT NULL,
  voucher_id text,
  match_ref text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT vat_assessment_receipts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_assessment_receipts_book_id_assessment_id_key UNIQUE (book_id, assessment_id),
  CONSTRAINT vat_assessment_receipts_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT vat_assessment_receipts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT vat_assessment_receipts_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_assessment_receipts_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT vat_assessment_receipts_book_id_assessment_id_fkey FOREIGN KEY (book_id, assessment_id) REFERENCES openerp.vat_assessments(book_id, id),
  CONSTRAINT vat_assessment_receipts_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);

CREATE TABLE openerp.vat_assessment_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  assessment_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_assessment_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_assessment_approvals_book_id_assessment_id_ordinal_key UNIQUE (book_id, assessment_id, ordinal),
  CONSTRAINT vat_assessment_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT vat_assessment_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT vat_assessment_approvals_book_id_assessment_id_fkey FOREIGN KEY (book_id, assessment_id) REFERENCES openerp.vat_assessments(book_id, id)
);

CREATE INDEX vat_rounding_bridges_return ON openerp.vat_rounding_bridges (book_id, return_id);
CREATE INDEX vat_assessments_return ON openerp.vat_assessments (book_id, return_id);
CREATE INDEX vat_assessments_event ON openerp.vat_assessments (book_id, event_id);

-- A sealed bridge or assessment is history. A corrected authority decision
-- is a new source event with its own assessment; it never overwrites the old
-- one, and previous return, bridge and assessment revisions stay readable.
CREATE TRIGGER immutable_vat_rounding_bridge
  BEFORE DELETE OR UPDATE ON openerp.vat_rounding_bridges
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_bridge_approval
  BEFORE DELETE OR UPDATE ON openerp.vat_bridge_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_assessment
  BEFORE DELETE OR UPDATE ON openerp.vat_assessments
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_assessment_approval
  BEFORE DELETE OR UPDATE ON openerp.vat_assessment_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_bridge_receipt
  BEFORE DELETE OR UPDATE ON openerp.vat_bridge_receipts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_assessment_receipt
  BEFORE DELETE OR UPDATE ON openerp.vat_assessment_receipts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.vat_rounding_bridges, openerp.vat_bridge_approvals,
  openerp.vat_bridge_receipts, openerp.vat_assessments, openerp.vat_assessment_approvals,
  openerp.vat_assessment_receipts TO openerp_runtime;
