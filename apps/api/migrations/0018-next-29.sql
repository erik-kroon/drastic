-- NEXT-29: recurring invoice occurrences without duplicate billing.
--
-- A recurring occurrence is identified by its agreement and its cycle ordinal
-- against the original anchor. The selected template revision is deliberately
-- absent from that identity: it travels on the occurrence as the frozen fact the
-- draft was built from, so amending a template can never re-identify a cycle
-- that is already issued.
--
-- Coverage is a second, independent uniqueness. The occurrence is written once
-- per agreement and cycle, and the invoice issue owner appends one coverage
-- consumption per issued occurrence in the same financial transaction that
-- issues the invoice. A second issue of the same occurrence therefore meets a
-- unique violation rather than deduplicating silently, and the service interval
-- it covers is retained so a later cadence change can be refused instead of
-- billed twice.
--
-- The application owns the cycle arithmetic, the template revision selection,
-- the pause, resume and end policy and every write. This migration declares no
-- function, no policy and no calculator: it adds the records, the uniqueness
-- the application depends on, the exactness rules and the runtime grants. It
-- reuses the baseline immutable_row guard and the digest check helper.

CREATE TABLE openerp.recurring_invoice_agreements (
  book_id text NOT NULL,
  id text NOT NULL,
  revision bigint NOT NULL,
  customer_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT recurring_invoice_agreements_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT recurring_invoice_agreements_revision_check CHECK (revision > 0),
  CONSTRAINT recurring_invoice_agreements_body_check CHECK (octet_length(body::text) <= 65536),
  CONSTRAINT recurring_invoice_agreements_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT recurring_invoice_agreements_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT recurring_invoice_agreements_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT recurring_invoice_agreements_customer_check CHECK (NOT body ->> 'customerId'::text IS DISTINCT FROM customer_id),
  CONSTRAINT recurring_invoice_agreements_revision_body_check CHECK (NOT body ->> 'revision'::text IS DISTINCT FROM revision::text),
  CONSTRAINT recurring_invoice_agreements_anchor_check CHECK (
    (body -> 'schedule'::text ->> 'anchorLocalDate'::text) ~ '^\d{4}-\d{2}-\d{2}$'::text
    AND (body -> 'schedule'::text ->> 'firstCycleOrdinal'::text) ~ '^(0|[1-9][0-9]{0,17})$'::text
  ),
  CONSTRAINT recurring_invoice_agreements_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT recurring_invoice_agreements_book_id_customer_id_fkey FOREIGN KEY (book_id, customer_id) REFERENCES openerp.commerce_counterparties(book_id, id)
);

CREATE TABLE openerp.recurring_invoice_template_revisions (
  book_id text NOT NULL,
  id text NOT NULL,
  agreement_id text NOT NULL,
  revision bigint NOT NULL,
  effective_from_cycle bigint NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT recurring_invoice_template_revisions_pkey PRIMARY KEY (book_id, id),
  -- One revision number per agreement, and one governing boundary per cycle, so
  -- two revisions can never claim the same first affected cycle.
  CONSTRAINT recurring_invoice_template_revisions_revision_key UNIQUE (book_id, agreement_id, revision),
  CONSTRAINT recurring_invoice_template_revisions_boundary_key UNIQUE (book_id, agreement_id, effective_from_cycle),
  CONSTRAINT recurring_invoice_template_revisions_revision_check CHECK (revision > 0),
  CONSTRAINT recurring_invoice_template_revisions_cycle_check CHECK (effective_from_cycle >= 0 AND effective_from_cycle < 1000000000000000000::bigint),
  CONSTRAINT recurring_invoice_template_revisions_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT recurring_invoice_template_revisions_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT recurring_invoice_template_revisions_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT recurring_invoice_template_revisions_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT recurring_invoice_template_revisions_agreement_check CHECK (NOT body ->> 'agreementId'::text IS DISTINCT FROM agreement_id),
  CONSTRAINT recurring_invoice_template_revisions_revision_body_check CHECK (NOT body ->> 'revision'::text IS DISTINCT FROM revision::text),
  CONSTRAINT recurring_invoice_template_revisions_cycle_body_check CHECK (NOT body ->> 'effectiveFromCycle'::text IS DISTINCT FROM effective_from_cycle::text),
  CONSTRAINT recurring_invoice_template_revisions_components_check CHECK (
    jsonb_typeof(body -> 'chargeComponentKeys'::text) = 'array'::text
    AND jsonb_array_length(body -> 'chargeComponentKeys'::text) <= 50
  ),
  CONSTRAINT recurring_invoice_template_revisions_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT recurring_invoice_template_revisions_agreement_fkey FOREIGN KEY (book_id, agreement_id) REFERENCES openerp.recurring_invoice_agreements(book_id, id)
);

CREATE TABLE openerp.recurring_invoice_agreement_events (
  book_id text NOT NULL,
  id text NOT NULL,
  agreement_id text NOT NULL,
  ordinal integer NOT NULL,
  kind text NOT NULL,
  effective_cycle bigint NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT recurring_invoice_agreement_events_pkey PRIMARY KEY (book_id, id),
  -- The retained order of one agreement's lifecycle, and one boundary per kind,
  -- so a pause, a resume and an end cannot be recorded twice for one cycle.
  CONSTRAINT recurring_invoice_agreement_events_ordinal_key UNIQUE (book_id, agreement_id, ordinal),
  CONSTRAINT recurring_invoice_agreement_events_boundary_key UNIQUE (book_id, agreement_id, kind, effective_cycle),
  CONSTRAINT recurring_invoice_agreement_events_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 200),
  CONSTRAINT recurring_invoice_agreement_events_kind_check CHECK (kind = ANY (ARRAY['pause'::text, 'resume'::text, 'end'::text])),
  CONSTRAINT recurring_invoice_agreement_events_cycle_check CHECK (effective_cycle >= 0 AND effective_cycle < 1000000000000000000::bigint),
  CONSTRAINT recurring_invoice_agreement_events_body_check CHECK (octet_length(body::text) <= 65536),
  CONSTRAINT recurring_invoice_agreement_events_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT recurring_invoice_agreement_events_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT recurring_invoice_agreement_events_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT recurring_invoice_agreement_events_agreement_check CHECK (NOT body ->> 'agreementId'::text IS DISTINCT FROM agreement_id),
  CONSTRAINT recurring_invoice_agreement_events_ordinal_body_check CHECK (NOT body ->> 'ordinal'::text IS DISTINCT FROM ordinal::text),
  CONSTRAINT recurring_invoice_agreement_events_kind_body_check CHECK (NOT body ->> 'kind'::text IS DISTINCT FROM kind),
  CONSTRAINT recurring_invoice_agreement_events_cycle_body_check CHECK (NOT body ->> 'effectiveCycle'::text IS DISTINCT FROM effective_cycle::text),
  CONSTRAINT recurring_invoice_agreement_events_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT recurring_invoice_agreement_events_agreement_fkey FOREIGN KEY (book_id, agreement_id) REFERENCES openerp.recurring_invoice_agreements(book_id, id)
);

CREATE TABLE openerp.recurring_invoice_occurrences (
  book_id text NOT NULL,
  id text NOT NULL,
  agreement_id text NOT NULL,
  cycle_ordinal bigint NOT NULL,
  cycle_date date NOT NULL,
  service_starts_on date NOT NULL,
  service_ends_on date NOT NULL,
  selected_template_revision bigint NOT NULL,
  selected_template_digest text NOT NULL,
  draft_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT recurring_invoice_occurrences_pkey PRIMARY KEY (book_id, id),
  -- The occurrence identity. It contains no template revision, so an amendment
  -- cannot mint a second occurrence for a cycle, and one cycle owns one draft.
  CONSTRAINT recurring_invoice_occurrences_cycle_key UNIQUE (book_id, agreement_id, cycle_ordinal),
  CONSTRAINT recurring_invoice_occurrences_draft_key UNIQUE (book_id, draft_id),
  CONSTRAINT recurring_invoice_occurrences_cycle_check CHECK (cycle_ordinal >= 0 AND cycle_ordinal < 1000000000000000000::bigint),
  CONSTRAINT recurring_invoice_occurrences_interval_check CHECK (service_starts_on <= service_ends_on),
  CONSTRAINT recurring_invoice_occurrences_template_check CHECK (selected_template_revision > 0),
  CONSTRAINT recurring_invoice_occurrences_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT recurring_invoice_occurrences_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT recurring_invoice_occurrences_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT recurring_invoice_occurrences_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT recurring_invoice_occurrences_agreement_check CHECK (NOT body ->> 'agreementId'::text IS DISTINCT FROM agreement_id),
  CONSTRAINT recurring_invoice_occurrences_cycle_body_check CHECK (NOT body ->> 'cycleOrdinal'::text IS DISTINCT FROM cycle_ordinal::text),
  CONSTRAINT recurring_invoice_occurrences_date_body_check CHECK (NOT body ->> 'cycleDate'::text IS DISTINCT FROM cycle_date::text),
  CONSTRAINT recurring_invoice_occurrences_interval_body_check CHECK (
    NOT body -> 'serviceInterval'::text ->> 'serviceStartsOn'::text IS DISTINCT FROM service_starts_on::text
    AND NOT body -> 'serviceInterval'::text ->> 'serviceEndsOn'::text IS DISTINCT FROM service_ends_on::text
  ),
  CONSTRAINT recurring_invoice_occurrences_template_body_check CHECK (NOT body ->> 'selectedTemplateRevision'::text IS DISTINCT FROM selected_template_revision::text),
  CONSTRAINT recurring_invoice_occurrences_template_digest_check CHECK (NOT body ->> 'selectedTemplateDigest'::text IS DISTINCT FROM selected_template_digest),
  CONSTRAINT recurring_invoice_occurrences_draft_body_check CHECK (NOT body ->> 'draftId'::text IS DISTINCT FROM draft_id),
  CONSTRAINT recurring_invoice_occurrences_components_check CHECK (
    jsonb_typeof(body -> 'chargeComponentKeys'::text) = 'array'::text
    AND jsonb_array_length(body -> 'chargeComponentKeys'::text) <= 50
  ),
  CONSTRAINT recurring_invoice_occurrences_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT recurring_invoice_occurrences_agreement_fkey FOREIGN KEY (book_id, agreement_id) REFERENCES openerp.recurring_invoice_agreements(book_id, id),
  CONSTRAINT recurring_invoice_occurrences_template_fkey FOREIGN KEY (book_id, agreement_id, selected_template_revision) REFERENCES openerp.recurring_invoice_template_revisions(book_id, agreement_id, revision),
  CONSTRAINT recurring_invoice_occurrences_draft_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.invoice_drafts(book_id, id)
);

CREATE TABLE openerp.recurring_invoice_occurrence_issues (
  book_id text NOT NULL,
  id text NOT NULL,
  occurrence_id text NOT NULL,
  agreement_id text NOT NULL,
  cycle_ordinal bigint NOT NULL,
  charge_component_key text COLLATE "C" NOT NULL,
  draft_id text NOT NULL,
  invoice_issue_id text NOT NULL,
  register_invoice_id text NOT NULL,
  document_number text COLLATE "C" NOT NULL,
  posting_receipt_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT recurring_invoice_occurrence_issues_pkey PRIMARY KEY (book_id, id),
  -- Approved billing coverage is unique per occurrence component, per cycle and
  -- charge component, per issued invoice, per registered invoice and per ledger
  -- receipt. A second billing of the same coverage is refused by the database,
  -- not merged into the first one.
  CONSTRAINT recurring_invoice_occurrence_issues_component_key UNIQUE (book_id, occurrence_id, charge_component_key),
  CONSTRAINT recurring_invoice_occurrence_issues_cycle_key UNIQUE (book_id, agreement_id, cycle_ordinal, charge_component_key),
  CONSTRAINT recurring_invoice_occurrence_issues_invoice_issue_key UNIQUE (book_id, invoice_issue_id, charge_component_key),
  CONSTRAINT recurring_invoice_occurrence_issues_register_key UNIQUE (book_id, register_invoice_id, charge_component_key),
  CONSTRAINT recurring_invoice_occurrence_issues_posting_key UNIQUE (book_id, posting_receipt_id, charge_component_key),
  CONSTRAINT recurring_invoice_occurrence_issues_cycle_check CHECK (cycle_ordinal >= 0 AND cycle_ordinal < 1000000000000000000::bigint),
  CONSTRAINT recurring_invoice_occurrence_issues_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT recurring_invoice_occurrence_issues_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT recurring_invoice_occurrence_issues_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT recurring_invoice_occurrence_issues_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT recurring_invoice_occurrence_issues_occurrence_check CHECK (NOT body ->> 'occurrenceId'::text IS DISTINCT FROM occurrence_id),
  CONSTRAINT recurring_invoice_occurrence_issues_agreement_check CHECK (NOT body ->> 'agreementId'::text IS DISTINCT FROM agreement_id),
  CONSTRAINT recurring_invoice_occurrence_issues_cycle_body_check CHECK (NOT body ->> 'cycleOrdinal'::text IS DISTINCT FROM cycle_ordinal::text),
  CONSTRAINT recurring_invoice_occurrence_issues_component_body_check CHECK (NOT body ->> 'chargeComponentKey'::text IS DISTINCT FROM charge_component_key),
  CONSTRAINT recurring_invoice_occurrence_issues_draft_body_check CHECK (NOT body ->> 'draftId'::text IS DISTINCT FROM draft_id),
  CONSTRAINT recurring_invoice_occurrence_issues_document_body_check CHECK (NOT body ->> 'documentNumber'::text IS DISTINCT FROM document_number),
  CONSTRAINT recurring_invoice_occurrence_issues_posting_body_check CHECK (NOT body ->> 'postingReceiptId'::text IS DISTINCT FROM posting_receipt_id),
  CONSTRAINT recurring_invoice_occurrence_issues_key_check CHECK (charge_component_key ~ '^[a-z][a-z0-9_-]{2,63}$'::text),
  CONSTRAINT recurring_invoice_occurrence_issues_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT recurring_invoice_occurrence_issues_occurrence_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.recurring_invoice_occurrences(book_id, id),
  CONSTRAINT recurring_invoice_occurrence_issues_draft_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.invoice_drafts(book_id, id),
  CONSTRAINT recurring_invoice_occurrence_issues_invoice_issue_fkey FOREIGN KEY (book_id, invoice_issue_id) REFERENCES openerp.invoice_issues(book_id, id),
  CONSTRAINT recurring_invoice_occurrence_issues_register_fkey FOREIGN KEY (book_id, register_invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT recurring_invoice_occurrence_issues_posting_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id)
);

CREATE INDEX recurring_invoice_template_revisions_agreement ON openerp.recurring_invoice_template_revisions (book_id, agreement_id, effective_from_cycle);
CREATE INDEX recurring_invoice_agreement_events_agreement ON openerp.recurring_invoice_agreement_events (book_id, agreement_id, ordinal);
CREATE INDEX recurring_invoice_occurrences_agreement ON openerp.recurring_invoice_occurrences (book_id, agreement_id, cycle_ordinal);
CREATE INDEX recurring_invoice_occurrences_interval ON openerp.recurring_invoice_occurrences (book_id, agreement_id, service_starts_on, service_ends_on);
CREATE INDEX recurring_invoice_occurrence_issues_agreement ON openerp.recurring_invoice_occurrence_issues (book_id, agreement_id, cycle_ordinal);

-- A recorded agreement, template revision, event, occurrence and coverage
-- consumption are all history. An amendment appends a new record; a correction
-- runs through the invoice issue owner that wrote the consumption.
CREATE TRIGGER immutable_recurring_invoice_agreement
  BEFORE DELETE OR UPDATE ON openerp.recurring_invoice_agreements
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_invoice_template_revision
  BEFORE DELETE OR UPDATE ON openerp.recurring_invoice_template_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_invoice_agreement_event
  BEFORE DELETE OR UPDATE ON openerp.recurring_invoice_agreement_events
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_invoice_occurrence
  BEFORE DELETE OR UPDATE ON openerp.recurring_invoice_occurrences
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_invoice_occurrence_issue
  BEFORE DELETE OR UPDATE ON openerp.recurring_invoice_occurrence_issues
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE
  openerp.recurring_invoice_agreements,
  openerp.recurring_invoice_template_revisions,
  openerp.recurring_invoice_agreement_events,
  openerp.recurring_invoice_occurrences,
  openerp.recurring_invoice_occurrence_issues
  TO openerp_runtime;
