-- NEXT-06: owner-paid expenses, reimbursement and funding.
--
-- One owner operation is one book-scoped financial group. This is its retained
-- history: the sealed review that carries the exact journal group and the exact
-- owner effect, the operator approval over that review's digest, and the
-- immutable receipt that names the voucher, the owner effect and every
-- reimbursement or payable effect the group committed.
--
-- The owner-funded purchase recognition is a separate economic identity from a
-- supplier-funded one because it creates no supplier payable: its funding leg is
-- the owner liability. Its signed tax components are the same components the
-- source-line purchase compiler produces, published under this funding role. The
-- economic key is shared with the supplier-funded recognition, so only one of the
-- two may own it in a book.
--
-- The application owns the funding decision, the classification, the capacity
-- checks, the exact amounts and the allocation. This migration declares no
-- function, no policy and no calculator: it adds relationships, the uniqueness
-- and exactness rules the application depends on, and the runtime grants. It
-- reuses the baseline immutable_row guard and the digest check helper.

CREATE TABLE openerp.owner_operation_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  mode text NOT NULL,
  owner_id text NOT NULL,
  ordinal integer NOT NULL,
  change_set_id text NOT NULL,
  event_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT owner_operation_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_operation_reviews_mode_check CHECK (mode = ANY (ARRAY[
    'owner_paid_purchase'::text, 'owner_pays_payable'::text, 'reimburse_owner'::text,
    'owner_loan'::text, 'owner_contribution'::text
  ])),
  CONSTRAINT owner_operation_reviews_ordinal_check CHECK (ordinal >= 1),
  -- One review per exact change set, and one per owner/evidence occurrence, so a
  -- second group cannot be minted for the same retained event.
  CONSTRAINT owner_operation_reviews_change_set_key UNIQUE (book_id, change_set_id),
  CONSTRAINT owner_operation_reviews_occurrence_key UNIQUE (book_id, event_id),
  CONSTRAINT owner_operation_reviews_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT owner_operation_reviews_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT owner_operation_reviews_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT owner_operation_reviews_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT owner_operation_reviews_owner_check CHECK (NOT body ->> 'ownerId'::text IS DISTINCT FROM owner_id),
  CONSTRAINT owner_operation_reviews_mode_body_check CHECK (NOT body ->> 'mode'::text IS DISTINCT FROM mode),
  CONSTRAINT owner_operation_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT owner_operation_reviews_book_id_owner_id_fkey FOREIGN KEY (book_id, owner_id) REFERENCES openerp.owner_parties(book_id, id),
  CONSTRAINT owner_operation_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT owner_operation_reviews_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT owner_operation_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);

CREATE TABLE openerp.owner_operation_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT owner_operation_approvals_pkey PRIMARY KEY (book_id, id),
  -- One approval per reviewer per review. A second reviewer is a second row.
  CONSTRAINT owner_operation_approvals_reviewer_key UNIQUE (book_id, review_id, actor_id),
  CONSTRAINT owner_operation_approvals_body_check CHECK (octet_length(body::text) <= 65536),
  CONSTRAINT owner_operation_approvals_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT owner_operation_approvals_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT owner_operation_approvals_review_check CHECK (NOT body ->> 'reviewId'::text IS DISTINCT FROM review_id),
  CONSTRAINT owner_operation_approvals_actor_check CHECK (NOT body ->> 'actorId'::text IS DISTINCT FROM actor_id),
  CONSTRAINT owner_operation_approvals_review_digest_check CHECK (NOT body ->> 'reviewDigest'::text IS DISTINCT FROM digest),
  CONSTRAINT owner_operation_approvals_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT owner_operation_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.owner_operation_reviews(book_id, id),
  CONSTRAINT owner_operation_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id)
);

CREATE TABLE openerp.owner_operation_receipts (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  mode text NOT NULL,
  owner_id text NOT NULL,
  owner_record_id text NOT NULL,
  owner_effect_id text NOT NULL,
  voucher_id text NOT NULL,
  control_line_id text NOT NULL,
  recognition_id text,
  invoice_id text,
  amount_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  committed_at timestamptz NOT NULL,
  CONSTRAINT owner_operation_receipts_pkey PRIMARY KEY (book_id, id),
  -- One receipt per review, per consumed approval and per posted control line.
  CONSTRAINT owner_operation_receipts_review_key UNIQUE (book_id, review_id),
  CONSTRAINT owner_operation_receipts_approval_key UNIQUE (book_id, approval_id),
  CONSTRAINT owner_operation_receipts_line_key UNIQUE (book_id, voucher_id, control_line_id),
  CONSTRAINT owner_operation_receipts_amount_check CHECK (amount_minor > 0),
  -- Only the owner-paid purchase publishes a recognition; only the payable
  -- transfer discharges an invoice.
  CONSTRAINT owner_operation_receipts_source_check CHECK (
    (mode = 'owner_paid_purchase'::text AND recognition_id IS NOT NULL AND invoice_id IS NULL)
    OR (mode = 'owner_pays_payable'::text AND recognition_id IS NULL AND invoice_id IS NOT NULL)
    OR (mode = ANY (ARRAY['reimburse_owner'::text, 'owner_loan'::text, 'owner_contribution'::text])
      AND recognition_id IS NULL AND invoice_id IS NULL)
  ),
  CONSTRAINT owner_operation_receipts_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT owner_operation_receipts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT owner_operation_receipts_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT owner_operation_receipts_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT owner_operation_receipts_owner_check CHECK (NOT body ->> 'ownerId'::text IS DISTINCT FROM owner_id),
  CONSTRAINT owner_operation_receipts_mode_body_check CHECK (NOT body ->> 'mode'::text IS DISTINCT FROM mode),
  CONSTRAINT owner_operation_receipts_amount_body_check CHECK (NOT body ->> 'ownerClaimMinor'::text IS DISTINCT FROM amount_minor::text),
  CONSTRAINT owner_operation_receipts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT owner_operation_receipts_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.owner_operation_reviews(book_id, id),
  CONSTRAINT owner_operation_receipts_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.owner_operation_approvals(book_id, id),
  CONSTRAINT owner_operation_receipts_book_id_owner_id_fkey FOREIGN KEY (book_id, owner_id) REFERENCES openerp.owner_parties(book_id, id),
  CONSTRAINT owner_operation_receipts_book_id_owner_record_id_fkey FOREIGN KEY (book_id, owner_record_id) REFERENCES openerp.owner_records(book_id, id),
  CONSTRAINT owner_operation_receipts_book_id_owner_effect_id_fkey FOREIGN KEY (book_id, owner_effect_id) REFERENCES openerp.owner_effects(book_id, id),
  CONSTRAINT owner_operation_receipts_book_id_voucher_id_control_line_id_fkey FOREIGN KEY (book_id, voucher_id, control_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);

-- The reimbursement legs of one committed owner group. The owner control reads
-- both this and the retained allocation legs, so a claim's remaining capacity
-- counts every leg exactly once regardless of which owner consumed it.
CREATE TABLE openerp.owner_operation_allocations (
  book_id text NOT NULL,
  receipt_id text NOT NULL,
  ordinal integer NOT NULL,
  claim_id text NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  CONSTRAINT owner_operation_allocations_pkey PRIMARY KEY (book_id, receipt_id, ordinal),
  CONSTRAINT owner_operation_allocations_claim_key UNIQUE (book_id, receipt_id, claim_id),
  CONSTRAINT owner_operation_allocations_amount_check CHECK (amount_minor > 0),
  CONSTRAINT owner_operation_allocations_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT owner_operation_allocations_book_id_receipt_id_fkey FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.owner_operation_receipts(book_id, id),
  CONSTRAINT owner_operation_allocations_book_id_claim_id_fkey FOREIGN KEY (book_id, claim_id) REFERENCES openerp.owner_effects(book_id, id)
);

-- The owner-funded purchase recognition. Its funding leg is the owner liability,
-- so it owns no supplier payable, and its economic key is the one the
-- supplier-funded recognition of the same document would use.
CREATE TABLE openerp.owner_purchase_recognitions (
  book_id text NOT NULL,
  id text NOT NULL,
  economic_key text NOT NULL,
  owner_id text NOT NULL,
  owner_record_id text NOT NULL,
  owner_effect_id text NOT NULL,
  counterparty_id text NOT NULL,
  document_number text COLLATE "C" NOT NULL,
  voucher_id text NOT NULL,
  change_set_id text NOT NULL,
  approval_id text NOT NULL,
  recognition_date date NOT NULL,
  tax_point_on date NOT NULL,
  gross_minor openerp.minor_units NOT NULL,
  deductible_tax_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT owner_purchase_recognitions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_purchase_recognitions_economic_key UNIQUE (book_id, economic_key),
  CONSTRAINT owner_purchase_recognitions_voucher_key UNIQUE (book_id, voucher_id),
  CONSTRAINT owner_purchase_recognitions_change_set_key UNIQUE (book_id, change_set_id),
  CONSTRAINT owner_purchase_recognitions_approval_key UNIQUE (book_id, approval_id),
  CONSTRAINT owner_purchase_recognitions_gross_check CHECK (gross_minor > 0),
  CONSTRAINT owner_purchase_recognitions_deductible_check CHECK (deductible_tax_minor <= gross_minor),
  CONSTRAINT owner_purchase_recognitions_tax_point_check CHECK (tax_point_on <= recognition_date),
  CONSTRAINT owner_purchase_recognitions_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT owner_purchase_recognitions_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT owner_purchase_recognitions_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT owner_purchase_recognitions_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT owner_purchase_recognitions_owner_check CHECK (NOT body ->> 'ownerId'::text IS DISTINCT FROM owner_id),
  CONSTRAINT owner_purchase_recognitions_gross_body_check CHECK (NOT body ->> 'grossMinor'::text IS DISTINCT FROM gross_minor::text),
  CONSTRAINT owner_purchase_recognitions_deductible_body_check CHECK (NOT body ->> 'deductibleTaxMinor'::text IS DISTINCT FROM deductible_tax_minor::text),
  CONSTRAINT owner_purchase_recognitions_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT owner_purchase_recognitions_book_id_owner_id_fkey FOREIGN KEY (book_id, owner_id) REFERENCES openerp.owner_parties(book_id, id),
  CONSTRAINT owner_purchase_recognitions_book_id_owner_record_id_fkey FOREIGN KEY (book_id, owner_record_id) REFERENCES openerp.owner_records(book_id, id),
  CONSTRAINT owner_purchase_recognitions_book_id_owner_effect_id_fkey FOREIGN KEY (book_id, owner_effect_id) REFERENCES openerp.owner_effects(book_id, id),
  CONSTRAINT owner_purchase_recognitions_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT owner_purchase_recognitions_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT owner_purchase_recognitions_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.owner_operation_approvals(book_id, id)
);

-- The exact signed input tax components the source-line purchase compiler
-- produced for this funding role. They are history: a later adjustment appends a
-- new component and never rewrites these.
CREATE TABLE openerp.owner_purchase_tax_facts (
  book_id text NOT NULL,
  id text NOT NULL,
  recognition_id text NOT NULL,
  source_line_id text NOT NULL,
  component_role text NOT NULL,
  tax_component_id text NOT NULL,
  voucher_id text NOT NULL,
  signed_base_minor numeric NOT NULL,
  signed_output_tax_minor numeric NOT NULL,
  signed_deductible_tax_minor numeric NOT NULL,
  source_tax_minor openerp.minor_units NOT NULL,
  non_deductible_tax_minor openerp.minor_units NOT NULL,
  tax_point_on date NOT NULL,
  adjusts_tax_fact_id text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT owner_purchase_tax_facts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_purchase_tax_facts_component_key UNIQUE (book_id, recognition_id, source_line_id, component_role),
  CONSTRAINT owner_purchase_tax_facts_tax_component_key UNIQUE (book_id, tax_component_id),
  CONSTRAINT owner_purchase_tax_facts_component_role_check CHECK (component_role = ANY (ARRAY['input_tax'::text])),
  CONSTRAINT owner_purchase_tax_facts_basis_check CHECK (
    body ->> 'basis'::text = ANY (ARRAY['full_deduction'::text, 'half_deduction'::text, 'no_deduction_exclusion'::text, 'no_tax_exempt'::text])
  ),
  CONSTRAINT owner_purchase_tax_facts_signed_bounds_check CHECK (
    signed_base_minor = trunc(signed_base_minor) AND abs(signed_base_minor) < '100000000000000000000000000000000000000'::numeric
    AND signed_output_tax_minor = trunc(signed_output_tax_minor) AND abs(signed_output_tax_minor) < '100000000000000000000000000000000000000'::numeric
    AND signed_deductible_tax_minor = trunc(signed_deductible_tax_minor) AND abs(signed_deductible_tax_minor) < '100000000000000000000000000000000000000'::numeric
  ),
  CONSTRAINT owner_purchase_tax_facts_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT owner_purchase_tax_facts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT owner_purchase_tax_facts_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT owner_purchase_tax_facts_recognition_check CHECK (NOT body ->> 'recognitionId'::text IS DISTINCT FROM recognition_id),
  CONSTRAINT owner_purchase_tax_facts_line_check CHECK (NOT body ->> 'sourceLineId'::text IS DISTINCT FROM source_line_id),
  CONSTRAINT owner_purchase_tax_facts_book_id_recognition_id_fkey FOREIGN KEY (book_id, recognition_id) REFERENCES openerp.owner_purchase_recognitions(book_id, id),
  CONSTRAINT owner_purchase_tax_facts_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);

CREATE INDEX owner_operation_reviews_owner ON openerp.owner_operation_reviews (book_id, owner_id, created_at);
CREATE INDEX owner_operation_approvals_review ON openerp.owner_operation_approvals (book_id, review_id);
CREATE INDEX owner_operation_receipts_owner ON openerp.owner_operation_receipts (book_id, owner_id, committed_at);
CREATE INDEX owner_operation_receipts_invoice ON openerp.owner_operation_receipts (book_id, invoice_id) where invoice_id is not null;
CREATE INDEX owner_operation_allocations_claim ON openerp.owner_operation_allocations (book_id, claim_id);
CREATE INDEX owner_purchase_recognitions_counterparty ON openerp.owner_purchase_recognitions (book_id, counterparty_id, document_number);

-- A sealed group, the approval that bound it and the committed receipt are
-- history. A committed group is changed only by its own owner correction.
CREATE TRIGGER immutable_owner_operation_review
  BEFORE DELETE OR UPDATE ON openerp.owner_operation_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_operation_approval
  BEFORE DELETE OR UPDATE ON openerp.owner_operation_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_operation_receipt
  BEFORE DELETE OR UPDATE ON openerp.owner_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_purchase_recognition
  BEFORE DELETE OR UPDATE ON openerp.owner_purchase_recognitions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_purchase_tax_fact
  BEFORE DELETE OR UPDATE ON openerp.owner_purchase_tax_facts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE
  openerp.owner_operation_reviews,
  openerp.owner_operation_approvals,
  openerp.owner_operation_receipts,
  openerp.owner_operation_allocations,
  openerp.owner_purchase_recognitions,
  openerp.owner_purchase_tax_facts
  TO openerp_runtime;
