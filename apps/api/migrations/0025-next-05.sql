-- NEXT-05: general-rule cross-border service purchases with owned
-- reverse-charge recognition.
-- Forward migration on the reviewed baseline plus 0004-next-02.sql
-- (rule_releases), 0006-next-03.sql (supplier drafts, payables) and
-- 0015-next-04.sql with 0023-vat-owned-producers.sql (actual VAT return). The
-- baseline is not renumbered or revived.
--
-- A service recognition is its own economic event with its own sealed plan,
-- journal group, book-currency payable and signed reverse-charge components.
-- The original supplier liability, the book carrying value and the SEK tax
-- base stay distinct in the sealed body; a later settlement changes carrying
-- and FX but never the sealed original tax fact. These tables only hold the
-- sealed reviews, approvals, receipts, recognitions and tax components, so a
-- later posting cannot change what a captured recognition already means.
-- There is no function, no policy, no rate table and no report calculation
-- here. Rates, boxes, service eligibility and conversions are qualified
-- inputs carried by the `vat` rule release's general-rule section and the
-- sealed command; a missing one is a refusal, never a default, and none of
-- them is stored as a policy in this file.

CREATE TABLE openerp.service_purchase_recognitions (
  book_id text NOT NULL,
  id text NOT NULL,
  economic_key text NOT NULL,
  event_owner text NOT NULL,
  draft_id text NOT NULL,
  draft_revision bigint NOT NULL,
  counterparty_id text NOT NULL,
  document_number text NOT NULL,
  voucher_id text NOT NULL,
  payable_id text NOT NULL,
  change_set_id text NOT NULL,
  approval_id text NOT NULL,
  recognition_date date NOT NULL,
  tax_point_on date NOT NULL,
  gross_minor numeric NOT NULL,
  deductible_tax_minor numeric NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT service_purchase_recognitions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT service_purchase_recognitions_economic_key_key UNIQUE (book_id, economic_key),
  CONSTRAINT service_purchase_recognitions_book_id_voucher_id_key UNIQUE (book_id, voucher_id),
  CONSTRAINT service_purchase_recognitions_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT service_purchase_recognitions_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT service_purchase_recognitions_book_id_payable_id_key UNIQUE (book_id, payable_id),
  CONSTRAINT service_purchase_recognitions_event_owner_check CHECK (event_owner = 'service_purchase'::text),
  -- A service recognition names the reviewed supplier draft it recognized. No
  -- second recognition identity exists in this owner.
  CONSTRAINT service_purchase_recognitions_owner_source_check CHECK (
    draft_id IS NOT NULL AND draft_revision IS NOT NULL
  ),
  CONSTRAINT service_purchase_recognitions_gross_minor_check CHECK (gross_minor > 0),
  CONSTRAINT service_purchase_recognitions_deductible_minor_check CHECK (deductible_tax_minor <= gross_minor),
  CONSTRAINT service_purchase_recognitions_tax_point_check CHECK (tax_point_on <= recognition_date),
  CONSTRAINT service_purchase_recognitions_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT service_purchase_recognitions_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT service_purchase_recognitions_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT service_purchase_recognitions_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT service_purchase_recognitions_owner_check CHECK (NOT body ->> 'eventOwner'::text IS DISTINCT FROM event_owner),
  CONSTRAINT service_purchase_recognitions_book_id_draft_id_draft_revisio_fkey FOREIGN KEY (book_id, draft_id, draft_revision) REFERENCES openerp.supplier_invoice_draft_revisions(book_id, draft_id, revision),
  CONSTRAINT service_purchase_recognitions_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT service_purchase_recognitions_book_id_payable_id_fkey FOREIGN KEY (book_id, payable_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT service_purchase_recognitions_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id)
);

CREATE TABLE openerp.service_purchase_tax_facts (
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
  source_tax_minor numeric NOT NULL,
  non_deductible_tax_minor numeric NOT NULL,
  tax_point_on date NOT NULL,
  adjusts_tax_fact_id text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT service_purchase_tax_facts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT service_purchase_tax_facts_component_key UNIQUE (book_id, recognition_id, source_line_id, component_role),
  CONSTRAINT service_purchase_tax_facts_tax_component_key UNIQUE (book_id, tax_component_id),
  CONSTRAINT service_purchase_tax_facts_component_role_check CHECK (component_role = 'reverse_charge'::text),
  CONSTRAINT service_purchase_tax_facts_signed_bounds_check CHECK (
    signed_base_minor = trunc(signed_base_minor) AND abs(signed_base_minor) < '100000000000000000000000000000000000000'::numeric
    AND signed_output_tax_minor = trunc(signed_output_tax_minor) AND abs(signed_output_tax_minor) < '100000000000000000000000000000000000000'::numeric
    AND signed_deductible_tax_minor = trunc(signed_deductible_tax_minor) AND abs(signed_deductible_tax_minor) < '100000000000000000000000000000000000000'::numeric
  ),
  CONSTRAINT service_purchase_tax_facts_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT service_purchase_tax_facts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT service_purchase_tax_facts_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT service_purchase_tax_facts_recognition_check CHECK (NOT body ->> 'recognitionId'::text IS DISTINCT FROM recognition_id),
  CONSTRAINT service_purchase_tax_facts_line_check CHECK (NOT body ->> 'sourceLineId'::text IS DISTINCT FROM source_line_id),
  CONSTRAINT service_purchase_tax_facts_book_id_recognition_id_fkey FOREIGN KEY (book_id, recognition_id) REFERENCES openerp.service_purchase_recognitions(book_id, id),
  CONSTRAINT service_purchase_tax_facts_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT service_purchase_tax_facts_book_id_adjusts_tax_fact_id_fkey FOREIGN KEY (book_id, adjusts_tax_fact_id) REFERENCES openerp.service_purchase_tax_facts(book_id, id)
);

CREATE TABLE openerp.service_purchase_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  draft_id text NOT NULL,
  draft_revision bigint NOT NULL,
  ordinal integer NOT NULL,
  change_set_id text NOT NULL,
  event_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT service_purchase_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT service_purchase_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT service_purchase_reviews_book_id_draft_id_ordinal_key UNIQUE (book_id, draft_id, ordinal),
  CONSTRAINT service_purchase_reviews_book_id_id_draft_id_draft_revis_key UNIQUE (book_id, id, draft_id, draft_revision),
  CONSTRAINT service_purchase_reviews_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT service_purchase_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT service_purchase_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT service_purchase_reviews_book_id_draft_id_draft_revisio_fkey FOREIGN KEY (book_id, draft_id, draft_revision) REFERENCES openerp.supplier_invoice_draft_revisions(book_id, draft_id, revision),
  CONSTRAINT service_purchase_reviews_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT service_purchase_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);

CREATE TABLE openerp.service_purchase_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT service_purchase_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT service_purchase_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT service_purchase_approvals_book_id_review_id_ordinal_key UNIQUE (book_id, review_id, ordinal),
  CONSTRAINT service_purchase_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT service_purchase_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT service_purchase_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.service_purchase_reviews(book_id, id)
);

CREATE TABLE openerp.service_purchases (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  draft_id text NOT NULL,
  draft_revision bigint NOT NULL,
  posting_receipt_id text NOT NULL,
  register_invoice_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT service_purchases_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT service_purchases_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT service_purchases_book_id_draft_id_key UNIQUE (book_id, draft_id),
  CONSTRAINT service_purchases_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT service_purchases_book_id_register_invoice_id_key UNIQUE (book_id, register_invoice_id),
  CONSTRAINT service_purchases_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT service_purchases_book_id_approval_id_review_id_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.service_purchase_approvals(book_id, id, review_id),
  CONSTRAINT service_purchases_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT service_purchases_book_id_register_invoice_id_fkey FOREIGN KEY (book_id, register_invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT service_purchases_book_id_review_id_draft_id_draft_revi_fkey FOREIGN KEY (book_id, review_id, draft_id, draft_revision) REFERENCES openerp.service_purchase_reviews(book_id, id, draft_id, draft_revision)
);

CREATE INDEX service_purchase_recognitions_draft ON openerp.service_purchase_recognitions (book_id, draft_id);
CREATE INDEX service_purchase_recognitions_counterparty ON openerp.service_purchase_recognitions (book_id, counterparty_id, document_number);
CREATE INDEX service_purchase_recognitions_tax_point ON openerp.service_purchase_recognitions (book_id, tax_point_on);
CREATE INDEX service_purchase_tax_facts_recognition ON openerp.service_purchase_tax_facts (book_id, recognition_id);
CREATE INDEX service_purchase_tax_facts_voucher ON openerp.service_purchase_tax_facts (book_id, voucher_id);
CREATE INDEX service_purchase_tax_facts_adjusts ON openerp.service_purchase_tax_facts (book_id, adjusts_tax_fact_id);

-- A recognized service purchase and its reverse-charge components are
-- history. A later correction appends a new signed component; it never
-- rewrites what the recognition already meant.
CREATE TRIGGER immutable_service_purchase_recognition
  BEFORE DELETE OR UPDATE ON openerp.service_purchase_recognitions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_service_purchase_tax_fact
  BEFORE DELETE OR UPDATE ON openerp.service_purchase_tax_facts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_service_purchase_review
  BEFORE DELETE OR UPDATE ON openerp.service_purchase_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_service_purchase_approval
  BEFORE DELETE OR UPDATE ON openerp.service_purchase_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_service_purchase
  BEFORE DELETE OR UPDATE ON openerp.service_purchases
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.service_purchase_recognitions, openerp.service_purchase_tax_facts,
  openerp.service_purchase_reviews, openerp.service_purchase_approvals, openerp.service_purchases TO openerp_runtime;

-- The actual VAT return admits one more owned contribution origin. Saved
-- returns and source facts are not rewritten; only the provenance vocabulary
-- grows, exactly as 0023-vat-owned-producers.sql did for its owners.
ALTER TABLE openerp.vat_actual_return_contributions
  DROP CONSTRAINT vat_actual_return_contributions_origin_check,
  ADD CONSTRAINT vat_actual_return_contributions_origin_check CHECK (
    origin IN ('manual_admission', 'owned_purchase_recognition', 'owned_owner_purchase', 'owned_customer_credit', 'owned_service_purchase')
  );

-- The actual VAT return declares the general-rule reverse-charge boxes: 21/22
-- for the EU/non-EU tax base and 30/31/32 for the output tax by rate. The net
-- box stays derived, never a member.
ALTER TABLE openerp.vat_actual_return_boxes
  DROP CONSTRAINT vat_actual_return_boxes_box_check,
  ADD CONSTRAINT vat_actual_return_boxes_box_check CHECK (box = ANY (ARRAY['05'::text, '10'::text, '11'::text, '12'::text, '21'::text, '22'::text, '30'::text, '31'::text, '32'::text, '48'::text, '49'::text]));

ALTER TABLE openerp.vat_actual_return_contributions
  DROP CONSTRAINT vat_actual_return_contributions_box_check,
  ADD CONSTRAINT vat_actual_return_contributions_box_check CHECK (box = ANY (ARRAY['05'::text, '10'::text, '11'::text, '12'::text, '21'::text, '22'::text, '30'::text, '31'::text, '32'::text, '48'::text]));
