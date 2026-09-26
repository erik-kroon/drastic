-- NEXT-03: owned source-line purchase recognition and its exact tax facts.
--
-- A recognized domestic purchase is one economic event. This is its retained
-- identity: the unique economic key, the reviewed profile witness that admitted
-- it, the exact journal and payable references, and the sealed compiler result.
-- The immutable purchase tax facts are its signed components, one per source
-- line, and the line capacities are the only mutable state: what a later
-- supplier credit has already consumed of a recognized source line.
--
-- The application owns the treatment decision, the exact rounding, the
-- discrepancy result and the deduction release. This migration declares no
-- function, no policy and no calculator: it adds relationships, the two
-- uniqueness rules the application depends on, ordinary amount bounds and the
-- runtime grants. It reuses the baseline immutable_row guard.

CREATE TABLE openerp.purchase_recognitions (
  book_id text NOT NULL,
  id text NOT NULL,
  economic_key text NOT NULL,
  event_owner text NOT NULL,
  original_recognition_id text,
  draft_id text,
  draft_revision bigint,
  counterparty_id text NOT NULL,
  document_number text COLLATE "C" NOT NULL,
  voucher_id text NOT NULL,
  payable_id text NOT NULL,
  change_set_id text NOT NULL,
  approval_id text NOT NULL,
  recognition_date date NOT NULL,
  tax_point_on date NOT NULL,
  gross_minor openerp.minor_units NOT NULL,
  deductible_tax_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT purchase_recognitions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT purchase_recognitions_economic_key_key UNIQUE (book_id, economic_key),
  CONSTRAINT purchase_recognitions_book_id_voucher_id_key UNIQUE (book_id, voucher_id),
  CONSTRAINT purchase_recognitions_book_id_payable_id_key UNIQUE (book_id, payable_id, event_owner),
  CONSTRAINT purchase_recognitions_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT purchase_recognitions_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT purchase_recognitions_event_owner_check CHECK (event_owner = ANY (ARRAY['supplier_purchase'::text, 'supplier_credit'::text])),
  -- A purchase recognition names its reviewed supplier draft; a credit
  -- recognition names the purchase recognition it adjusts. Neither borrows the
  -- other's identity.
  CONSTRAINT purchase_recognitions_owner_source_check CHECK (
    (event_owner = 'supplier_purchase'::text AND draft_id IS NOT NULL AND draft_revision IS NOT NULL AND original_recognition_id IS NULL)
    OR (event_owner = 'supplier_credit'::text AND draft_id IS NULL AND draft_revision IS NULL AND original_recognition_id IS NOT NULL)
  ),
  CONSTRAINT purchase_recognitions_gross_minor_check CHECK (gross_minor > 0),
  CONSTRAINT purchase_recognitions_deductible_minor_check CHECK (deductible_tax_minor <= gross_minor),
  CONSTRAINT purchase_recognitions_tax_point_check CHECK (tax_point_on <= recognition_date),
  CONSTRAINT purchase_recognitions_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT purchase_recognitions_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT purchase_recognitions_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT purchase_recognitions_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT purchase_recognitions_owner_check CHECK (NOT body ->> 'eventOwner'::text IS DISTINCT FROM event_owner),
  CONSTRAINT purchase_recognitions_gross_body_check CHECK (NOT body ->> 'payableMinor'::text IS DISTINCT FROM gross_minor::text),
  CONSTRAINT purchase_recognitions_deductible_body_check CHECK (NOT body ->> 'totalDeductibleTaxMinor'::text IS DISTINCT FROM deductible_tax_minor::text),
  CONSTRAINT purchase_recognitions_original_recognition_id_fkey FOREIGN KEY (book_id, original_recognition_id) REFERENCES openerp.purchase_recognitions(book_id, id),
  CONSTRAINT purchase_recognitions_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT purchase_recognitions_book_id_payable_id_fkey FOREIGN KEY (book_id, payable_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT purchase_recognitions_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT purchase_recognitions_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.supplier_invoice_drafts(book_id, id)
);

CREATE TABLE openerp.purchase_tax_facts (
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
  CONSTRAINT purchase_tax_facts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT purchase_tax_facts_component_key UNIQUE (book_id, recognition_id, source_line_id, component_role),
  CONSTRAINT purchase_tax_facts_tax_component_key UNIQUE (book_id, tax_component_id),
  CONSTRAINT purchase_tax_facts_component_role_check CHECK (component_role = ANY (ARRAY['input_tax'::text])),
  CONSTRAINT purchase_tax_facts_basis_check CHECK (
    body ->> 'basis'::text = ANY (ARRAY['full_deduction'::text, 'half_deduction'::text, 'no_deduction_exclusion'::text, 'no_tax_exempt'::text])
  ),
  CONSTRAINT purchase_tax_facts_signed_bounds_check CHECK (
    signed_base_minor = trunc(signed_base_minor) AND abs(signed_base_minor) < '100000000000000000000000000000000000000'::numeric
    AND signed_output_tax_minor = trunc(signed_output_tax_minor) AND abs(signed_output_tax_minor) < '100000000000000000000000000000000000000'::numeric
    AND signed_deductible_tax_minor = trunc(signed_deductible_tax_minor) AND abs(signed_deductible_tax_minor) < '100000000000000000000000000000000000000'::numeric
  ),
  CONSTRAINT purchase_tax_facts_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT purchase_tax_facts_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT purchase_tax_facts_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT purchase_tax_facts_recognition_check CHECK (NOT body ->> 'recognitionId'::text IS DISTINCT FROM recognition_id),
  CONSTRAINT purchase_tax_facts_line_check CHECK (NOT body ->> 'sourceLineId'::text IS DISTINCT FROM source_line_id),
  CONSTRAINT purchase_tax_facts_book_id_recognition_id_fkey FOREIGN KEY (book_id, recognition_id) REFERENCES openerp.purchase_recognitions(book_id, id),
  CONSTRAINT purchase_tax_facts_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);

CREATE TABLE openerp.purchase_line_capacities (
  book_id text NOT NULL,
  recognition_id text NOT NULL,
  source_line_id text NOT NULL,
  expense_account_id text NOT NULL,
  input_vat_account_id text,
  original_net_minor openerp.minor_units NOT NULL,
  original_source_tax_minor openerp.minor_units NOT NULL,
  original_deductible_tax_minor openerp.minor_units NOT NULL,
  credited_net_minor openerp.minor_units NOT NULL DEFAULT 0,
  credited_source_tax_minor openerp.minor_units NOT NULL DEFAULT 0,
  released_deduction_minor openerp.minor_units NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  body jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT purchase_line_capacities_pkey PRIMARY KEY (book_id, recognition_id, source_line_id),
  CONSTRAINT purchase_line_capacities_credited_net_check CHECK (credited_net_minor <= original_net_minor),
  CONSTRAINT purchase_line_capacities_credited_tax_check CHECK (credited_source_tax_minor <= original_source_tax_minor),
  CONSTRAINT purchase_line_capacities_released_check CHECK (released_deduction_minor <= original_deductible_tax_minor),
  CONSTRAINT purchase_line_capacities_deduction_check CHECK (original_deductible_tax_minor <= original_source_tax_minor),
  CONSTRAINT purchase_line_capacities_version_check CHECK (version >= 1),
  CONSTRAINT purchase_line_capacities_body_check CHECK (octet_length(body::text) <= 65536),
  CONSTRAINT purchase_line_capacities_identity_check CHECK (NOT body ->> 'sourceLineId'::text IS DISTINCT FROM source_line_id),
  CONSTRAINT purchase_line_capacities_book_id_recognition_id_fkey FOREIGN KEY (book_id, recognition_id) REFERENCES openerp.purchase_recognitions(book_id, id)
);

CREATE INDEX purchase_recognitions_draft ON openerp.purchase_recognitions (book_id, draft_id);
CREATE INDEX purchase_recognitions_counterparty ON openerp.purchase_recognitions (book_id, counterparty_id, document_number);
CREATE INDEX purchase_recognitions_tax_point ON openerp.purchase_recognitions (book_id, tax_point_on);
CREATE INDEX purchase_tax_facts_recognition ON openerp.purchase_tax_facts (book_id, recognition_id);
CREATE INDEX purchase_tax_facts_voucher ON openerp.purchase_tax_facts (book_id, voucher_id);
CREATE INDEX purchase_tax_facts_adjusts ON openerp.purchase_tax_facts (book_id, adjusts_tax_fact_id);
CREATE INDEX purchase_line_capacities_line ON openerp.purchase_line_capacities (book_id, source_line_id);

-- A recognized purchase and its tax components are history. A later supplier
-- credit appends a new signed component and consumes line capacity; it never
-- rewrites what the recognition already meant.
CREATE TRIGGER immutable_purchase_recognition
  BEFORE DELETE OR UPDATE ON openerp.purchase_recognitions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_purchase_tax_fact
  BEFORE DELETE OR UPDATE ON openerp.purchase_tax_facts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.purchase_recognitions, openerp.purchase_tax_facts TO openerp_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE openerp.purchase_line_capacities TO openerp_runtime;
