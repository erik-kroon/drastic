-- NEXT-15: legal customer credit notes.
--
-- A legal customer credit is an issued document that reduces an already recognized
-- domestic sale. It posts the reduction of the original revenue and output VAT
-- accounts against the same receivable control, records the exact per-original-line
-- credit consumed, freezes the legal document identity, and records the negative tax
-- effect of the credit.
--
-- There is no function, no policy, no tax calculator, no renderer and no dispatcher
-- here. Numbering continues the reviewed legal sales policy's existing series through
-- the existing rollback-safe counter in openerp.ar_legal_issue_counters; this
-- migration does not add a second numbering authority, a second legal policy owner or
-- a second accounting profile. The original line amounts, the original rate and
-- rounding contract, the payable capacity and the original recognition component are
-- all read from the existing released owners; these tables only retain the credit's
-- own identity, its immutable plan, its consumed capacity and its signed tax effect.
--
-- No VAT return is computed, and no statutory credit support is claimed. The VAT
-- return, amendment and reclassification owners are not released, so
-- customer_credit_tax_corrections records the exact negative components a qualified
-- adjustment policy would consume and nothing more.

CREATE TABLE openerp.customer_credit_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  original_legal_issue_id text NOT NULL,
  register_invoice_id text NOT NULL,
  accounting_profile_id text NOT NULL,
  change_set_id text NOT NULL,
  event_id text NOT NULL,
  evidence_id text NOT NULL,
  ordinal integer NOT NULL,
  credit_date date NOT NULL,
  net_minor openerp.minor_units NOT NULL,
  tax_minor openerp.minor_units NOT NULL,
  gross_minor openerp.minor_units NOT NULL,
  unpaid_before_minor openerp.minor_units NOT NULL,
  unpaid_after_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT customer_credit_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT customer_credit_reviews_book_id_original_legal_issue_id_ordinal_key UNIQUE (book_id, original_legal_issue_id, ordinal),
  CONSTRAINT customer_credit_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT customer_credit_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT customer_credit_reviews_amount_check CHECK (net_minor::numeric > 0::numeric AND tax_minor::numeric >= 0::numeric),
  CONSTRAINT customer_credit_reviews_gross_check CHECK (gross_minor::numeric = net_minor::numeric + tax_minor::numeric),
  CONSTRAINT customer_credit_reviews_unpaid_check CHECK (unpaid_before_minor::numeric >= gross_minor::numeric AND unpaid_after_minor::numeric = unpaid_before_minor::numeric - gross_minor::numeric),
  CONSTRAINT customer_credit_reviews_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT customer_credit_reviews_body_id_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT customer_credit_reviews_body_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT customer_credit_reviews_body_profile_check CHECK (body ->> 'profile'::text = 'se-domestic-b2b-sek-25-accrual-credit-v1'::text),
  CONSTRAINT customer_credit_reviews_body_original_check CHECK (NOT body -> 'input'::text ->> 'originalLegalIssueId'::text IS DISTINCT FROM original_legal_issue_id),
  CONSTRAINT customer_credit_reviews_body_no_refund_check CHECK (body -> 'input'::text ->> 'acknowledgeNoRefundOrCreditBalance'::text = 'true'::text),
  CONSTRAINT customer_credit_reviews_body_totals_check CHECK (
    NOT body -> 'totals'::text ->> 'netMinor'::text IS DISTINCT FROM net_minor::text
    AND NOT body -> 'totals'::text ->> 'taxMinor'::text IS DISTINCT FROM tax_minor::text
    AND NOT body -> 'totals'::text ->> 'grossMinor'::text IS DISTINCT FROM gross_minor::text
  ),
  CONSTRAINT customer_credit_reviews_body_capacity_check CHECK (jsonb_typeof(body -> 'capacity'::text) = 'object'::text),
  CONSTRAINT customer_credit_reviews_body_unobserved_check CHECK (body ->> 'taxConsequenceObserved'::text = 'false'::text),
  CONSTRAINT customer_credit_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT customer_credit_reviews_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT customer_credit_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT customer_credit_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT customer_credit_reviews_book_id_original_legal_issue_id_fkey FOREIGN KEY (book_id, original_legal_issue_id) REFERENCES openerp.ar_legal_issues(book_id, id),
  CONSTRAINT customer_credit_reviews_book_id_register_invoice_id_fkey FOREIGN KEY (book_id, register_invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT customer_credit_reviews_book_id_accounting_profile_id_fkey FOREIGN KEY (book_id, accounting_profile_id) REFERENCES openerp.ar_legal_accounting_profiles(book_id, id)
);

CREATE TABLE openerp.customer_credit_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT customer_credit_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT customer_credit_approvals_book_id_review_id_ordinal_key UNIQUE (book_id, review_id, ordinal),
  CONSTRAINT customer_credit_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT customer_credit_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT customer_credit_approvals_body_check CHECK (octet_length(body::text) <= 32768),
  CONSTRAINT customer_credit_approvals_body_id_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT customer_credit_approvals_body_review_check CHECK (NOT body ->> 'reviewId'::text IS DISTINCT FROM review_id),
  CONSTRAINT customer_credit_approvals_body_digest_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM digest),
  CONSTRAINT customer_credit_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT customer_credit_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.customer_credit_reviews(book_id, id)
);

CREATE TABLE openerp.customer_credit_notes (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  original_legal_issue_id text NOT NULL,
  register_invoice_id text NOT NULL,
  credit_series text COLLATE "C" NOT NULL,
  credit_number bigint NOT NULL,
  credit_date date NOT NULL,
  period_id text NOT NULL,
  voucher_id text NOT NULL,
  control_line_id text NOT NULL,
  document_id text NOT NULL,
  counterparty_id text NOT NULL,
  evidence_id text NOT NULL,
  net_minor openerp.minor_units NOT NULL,
  tax_minor openerp.minor_units NOT NULL,
  gross_minor openerp.minor_units NOT NULL,
  unpaid_after_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT customer_credit_notes_pkey PRIMARY KEY (book_id, id),
  -- One legal credit number per reviewed credit series, and one credit per review,
  -- approval, number, voucher, retained document and original issue.
  CONSTRAINT customer_credit_notes_book_id_credit_series_credit_number_key UNIQUE (book_id, credit_series, credit_number),
  CONSTRAINT customer_credit_notes_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT customer_credit_notes_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT customer_credit_notes_book_id_voucher_id_key UNIQUE (book_id, voucher_id),
  CONSTRAINT customer_credit_notes_book_id_document_id_key UNIQUE (book_id, document_id),
  CONSTRAINT customer_credit_notes_book_id_original_legal_issue_id_credit_number_key UNIQUE (book_id, original_legal_issue_id, credit_number),
  -- One retained credit decision yields at most one issued legal credit, so a new
  -- request key cannot issue the same reviewed credit a second time.
  CONSTRAINT customer_credit_notes_book_id_evidence_id_key UNIQUE (book_id, evidence_id),
  CONSTRAINT customer_credit_notes_number_check CHECK (credit_number >= 1::bigint AND credit_number <= 999999999999999999::bigint),
  CONSTRAINT customer_credit_notes_amount_check CHECK (net_minor::numeric > 0::numeric AND tax_minor::numeric >= 0::numeric),
  CONSTRAINT customer_credit_notes_gross_check CHECK (gross_minor::numeric = net_minor::numeric + tax_minor::numeric),
  CONSTRAINT customer_credit_notes_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT customer_credit_notes_body_id_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT customer_credit_notes_body_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT customer_credit_notes_body_review_check CHECK (NOT body ->> 'reviewId'::text IS DISTINCT FROM review_id),
  CONSTRAINT customer_credit_notes_body_approval_check CHECK (NOT body ->> 'approvalId'::text IS DISTINCT FROM approval_id),
  CONSTRAINT customer_credit_notes_body_series_check CHECK (NOT body ->> 'creditSeries'::text IS DISTINCT FROM credit_series),
  CONSTRAINT customer_credit_notes_body_number_check CHECK (
    NOT body ->> 'legalDocumentNumber'::text IS DISTINCT FROM credit_series || '-' || credit_number::text
  ),
  CONSTRAINT customer_credit_notes_body_original_check CHECK (NOT body ->> 'originalLegalIssueId'::text IS DISTINCT FROM original_legal_issue_id),
  CONSTRAINT customer_credit_notes_body_totals_check CHECK (
    NOT body -> 'totals'::text ->> 'netMinor'::text IS DISTINCT FROM net_minor::text
    AND NOT body -> 'totals'::text ->> 'taxMinor'::text IS DISTINCT FROM tax_minor::text
    AND NOT body -> 'totals'::text ->> 'grossMinor'::text IS DISTINCT FROM gross_minor::text
  ),
  CONSTRAINT customer_credit_notes_body_unpaid_check CHECK (NOT body ->> 'unpaidAfterMinor'::text IS DISTINCT FROM unpaid_after_minor::text),
  CONSTRAINT customer_credit_notes_body_evidence_check CHECK (
    NOT body -> 'creditEvidence'::text ->> 'evidenceId'::text IS DISTINCT FROM evidence_id
    AND body -> 'creditEvidence'::text ->> 'basis'::text = 'retained_credit_evidence_v1'::text
  ),
  CONSTRAINT customer_credit_notes_body_state_check CHECK (
    body ->> 'issued'::text = 'true'::text
    AND body ->> 'legalCredit'::text = 'true'::text
    AND body ->> 'artifactState'::text = 'issued_artifact_pending'::text
    AND body ->> 'refundState'::text = 'not_refunded'::text
    AND body ->> 'taxConsequenceObserved'::text = 'false'::text
  ),
  CONSTRAINT customer_credit_notes_body_document_check CHECK (jsonb_typeof(body -> 'semanticDocument'::text) = 'object'::text),
  CONSTRAINT customer_credit_notes_body_corrections_check CHECK (
    jsonb_array_length(body -> 'taxCorrections'::text) >= 1
    AND jsonb_array_length(body -> 'taxCorrections'::text) = jsonb_array_length(body -> 'lines'::text)
  ),
  CONSTRAINT customer_credit_notes_book_id_approval_id_review_id_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.customer_credit_approvals(book_id, id, review_id),
  CONSTRAINT customer_credit_notes_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT customer_credit_notes_book_id_original_legal_issue_id_fkey FOREIGN KEY (book_id, original_legal_issue_id) REFERENCES openerp.ar_legal_issues(book_id, id),
  CONSTRAINT customer_credit_notes_book_id_period_id_fkey FOREIGN KEY (book_id, period_id) REFERENCES openerp.periods(book_id, id),
  CONSTRAINT customer_credit_notes_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT customer_credit_notes_book_id_register_invoice_id_fkey FOREIGN KEY (book_id, register_invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT customer_credit_notes_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.customer_credit_reviews(book_id, id),
  CONSTRAINT customer_credit_notes_book_id_voucher_id_control_line_id_fkey FOREIGN KEY (book_id, voucher_id, control_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);

-- The consumed original-line credit capacity. One row per credited original line per
-- issued credit, so a single credit can never name an original line twice and the
-- remaining capacity of that line is the sum of these rows under the book lock.
CREATE TABLE openerp.customer_credit_line_credits (
  book_id text NOT NULL,
  credit_id text NOT NULL,
  ordinal integer NOT NULL,
  original_line_id text NOT NULL,
  net_minor openerp.minor_units NOT NULL,
  tax_minor openerp.minor_units NOT NULL,
  gross_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT customer_credit_line_credits_pkey PRIMARY KEY (book_id, credit_id, ordinal),
  CONSTRAINT customer_credit_line_credits_line_key UNIQUE (book_id, credit_id, original_line_id),
  CONSTRAINT customer_credit_line_credits_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT customer_credit_line_credits_amount_check CHECK (net_minor::numeric + tax_minor::numeric > 0::numeric),
  CONSTRAINT customer_credit_line_credits_gross_check CHECK (gross_minor::numeric = net_minor::numeric + tax_minor::numeric),
  CONSTRAINT customer_credit_line_credits_body_check CHECK (octet_length(body::text) <= 32768),
  CONSTRAINT customer_credit_line_credits_body_credit_check CHECK (NOT body ->> 'creditId'::text IS DISTINCT FROM credit_id),
  CONSTRAINT customer_credit_line_credits_body_line_check CHECK (NOT body -> 'credit'::text ->> 'originalLineId'::text IS DISTINCT FROM original_line_id),
  CONSTRAINT customer_credit_line_credits_body_amount_check CHECK (
    NOT body -> 'credit'::text ->> 'creditedNetMinor'::text IS DISTINCT FROM net_minor::text
    AND NOT body -> 'credit'::text ->> 'creditedTaxMinor'::text IS DISTINCT FROM tax_minor::text
  ),
  CONSTRAINT customer_credit_line_credits_book_id_credit_id_fkey FOREIGN KEY (book_id, credit_id) REFERENCES openerp.customer_credit_notes(book_id, id)
);

-- The immutable semantic document revision. Rendering reads this exact revision and
-- never re-derives a total, a tax component or a reference from newer customer data.
CREATE TABLE openerp.customer_credit_documents (
  book_id text NOT NULL,
  id text NOT NULL,
  credit_id text NOT NULL,
  revision bigint NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT customer_credit_documents_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT customer_credit_documents_book_id_credit_id_revision_key UNIQUE (book_id, credit_id, revision),
  CONSTRAINT customer_credit_documents_revision_check CHECK (revision >= 1::bigint AND revision <= 50::bigint),
  CONSTRAINT customer_credit_documents_digest_check CHECK (digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT customer_credit_documents_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT customer_credit_documents_body_revision_check CHECK (NOT body ->> 'revision'::text IS DISTINCT FROM revision::text),
  CONSTRAINT customer_credit_documents_body_credit_check CHECK (NOT body ->> 'creditId'::text IS DISTINCT FROM credit_id),
  CONSTRAINT customer_credit_documents_body_digest_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM digest),
  CONSTRAINT customer_credit_documents_body_document_check CHECK (body ->> 'kind'::text = 'legal_customer_credit_note_v1'::text),
  CONSTRAINT customer_credit_documents_body_original_check CHECK (
    body ->> 'originalLegalIssueId'::text IS NOT NULL
    AND body ->> 'originalDocumentNumber'::text IS NOT NULL
    AND body ->> 'originalDocumentHash'::text ~ '^sha256:[a-f0-9]{64}$'::text
  ),
  CONSTRAINT customer_credit_documents_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);

-- The negative tax effect of the credit. The base and the output tax are the exact
-- negatives of the credited net and credited tax, and every row is bound to the
-- original recognition component and the qualified tax period. Nothing here is a
-- return, a box mapping or a statutory conclusion: the VAT return, amendment and
-- reclassification owners are not released.
CREATE TABLE openerp.customer_credit_tax_corrections (
  book_id text NOT NULL,
  id text NOT NULL,
  credit_id text NOT NULL,
  ordinal integer NOT NULL,
  original_line_id text NOT NULL,
  original_voucher_id text NOT NULL,
  original_control_line_id text NOT NULL,
  original_posting_date date NOT NULL,
  original_evidence_id text NOT NULL,
  tax_period_id text NOT NULL,
  qualified_on date NOT NULL,
  base_minor numeric NOT NULL,
  output_tax_minor numeric NOT NULL,
  credit_voucher_id text NOT NULL,
  revenue_line_id text NOT NULL,
  output_vat_line_id text NOT NULL,
  control_line_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT customer_credit_tax_corrections_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT customer_credit_tax_corrections_book_id_credit_id_ordinal_key UNIQUE (book_id, credit_id, ordinal),
  CONSTRAINT customer_credit_tax_corrections_book_id_credit_id_original_line_id_key UNIQUE (book_id, credit_id, original_line_id),
  CONSTRAINT customer_credit_tax_corrections_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  -- Exact signed minor units. No rounding ever lands inside a stored amount and no
  -- credit effect is ever stored as a nonnegative magnitude of a negative economic fact.
  CONSTRAINT customer_credit_tax_corrections_amount_check CHECK (
    base_minor::numeric = trunc(base_minor::numeric) AND base_minor::numeric < 0::numeric
    AND output_tax_minor::numeric = trunc(output_tax_minor::numeric) AND output_tax_minor::numeric <= 0::numeric
    AND abs(base_minor::numeric) < 1e38::numeric AND abs(output_tax_minor::numeric) < 1e38::numeric
  ),
  CONSTRAINT customer_credit_tax_corrections_body_check CHECK (octet_length(body::text) <= 65536),
  CONSTRAINT customer_credit_tax_corrections_body_id_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT customer_credit_tax_corrections_body_credit_check CHECK (NOT body ->> 'creditId'::text IS DISTINCT FROM credit_id),
  CONSTRAINT customer_credit_tax_corrections_body_line_check CHECK (NOT body ->> 'originalLineId'::text IS DISTINCT FROM original_line_id),
  CONSTRAINT customer_credit_tax_corrections_body_amount_check CHECK (
    NOT body ->> 'baseMinor'::text IS DISTINCT FROM base_minor::text
    AND NOT body ->> 'outputTaxMinor'::text IS DISTINCT FROM output_tax_minor::text
  ),
  CONSTRAINT customer_credit_tax_corrections_body_period_check CHECK (NOT body -> 'qualifiedTaxPeriod'::text ->> 'accountingPeriodId'::text IS DISTINCT FROM tax_period_id),
  CONSTRAINT customer_credit_tax_corrections_body_unobserved_check CHECK (
    body ->> 'vatReturnOwner'::text = 'not_released'::text
    AND body ->> 'vatReturnConsequence'::text = 'unobserved_pending_next_04'::text
  ),
  CONSTRAINT customer_credit_tax_corrections_book_id_credit_id_fkey FOREIGN KEY (book_id, credit_id) REFERENCES openerp.customer_credit_notes(book_id, id),
  CONSTRAINT customer_credit_tax_corrections_book_id_control_line_id_credit_voucher_fkey FOREIGN KEY (book_id, credit_voucher_id, control_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT customer_credit_tax_corrections_book_id_output_vat_line_id_credit_voucher_fkey FOREIGN KEY (book_id, credit_voucher_id, output_vat_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT customer_credit_tax_corrections_book_id_revenue_line_id_credit_voucher_fkey FOREIGN KEY (book_id, credit_voucher_id, revenue_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT customer_credit_tax_corrections_book_id_tax_period_id_fkey FOREIGN KEY (book_id, tax_period_id) REFERENCES openerp.periods(book_id, id)
);

CREATE INDEX customer_credit_notes_original_issue
  ON openerp.customer_credit_notes (book_id, original_legal_issue_id, credit_number);
CREATE INDEX customer_credit_line_credits_original_line
  ON openerp.customer_credit_line_credits (book_id, original_line_id, credit_id);
CREATE INDEX customer_credit_tax_corrections_period
  ON openerp.customer_credit_tax_corrections (book_id, tax_period_id, ordinal);

-- A sealed review, an issued credit, its consumed per-line capacity, its frozen
-- document revision and its negative tax effect are all history. A correction is a new
-- credit note through this same owner; it never rewrites what one issued credit means.
CREATE TRIGGER immutable_customer_credit_review
  BEFORE DELETE OR UPDATE ON openerp.customer_credit_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_customer_credit_note
  BEFORE DELETE OR UPDATE ON openerp.customer_credit_notes
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_customer_credit_line_credit
  BEFORE DELETE OR UPDATE ON openerp.customer_credit_line_credits
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_customer_credit_document
  BEFORE DELETE OR UPDATE ON openerp.customer_credit_documents
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_customer_credit_tax_correction
  BEFORE DELETE OR UPDATE ON openerp.customer_credit_tax_corrections
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- A credit and its frozen document revision reference each other; the pair of
-- foreign keys closes that cycle once both tables exist.
ALTER TABLE openerp.customer_credit_documents
  ADD CONSTRAINT customer_credit_documents_book_id_credit_id_fkey FOREIGN KEY (book_id, credit_id) REFERENCES openerp.customer_credit_notes(book_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.customer_credit_notes
  ADD CONSTRAINT customer_credit_notes_book_id_document_id_fkey FOREIGN KEY (book_id, document_id) REFERENCES openerp.customer_credit_documents(book_id, id) DEFERRABLE INITIALLY DEFERRED;

GRANT SELECT, INSERT ON TABLE openerp.customer_credit_reviews, openerp.customer_credit_approvals,
  openerp.customer_credit_notes, openerp.customer_credit_line_credits,
  openerp.customer_credit_documents, openerp.customer_credit_tax_corrections
  TO openerp_runtime;
