-- NEXT-07: supplier paid credits and cash refunds with owned tax recognition.
-- Forward migration on the reviewed baseline plus 0006-next-03.sql (owned
-- source-line recognition, line capacities and credit tax facts). The
-- baseline is not renumbered or revived.
--
-- A paid supplier credit reuses the existing supplier_credit_reviews,
-- supplier_credit_approvals and supplier_credits rows: the credit document,
-- its line releases and its tax facts stay one recognition identity with the
-- unpaid path, and the legacy live invoice keeps counting every credit in
-- its credited total. What is new here is the split the paid path records:
-- one row per paid credit states how much of its gross released the payable
-- (ap_release_minor) and how much raised an explicit refund receivable
-- (refund_increase_minor) on a reviewed account that is never an inferred
-- negative payable. A supplier refund receipt settles that receivable in
-- cash, either by posting new bank legs or by adopting an already posted
-- compatible refund-control credit; its allocations consume the refund due
-- exactly, never partially. These tables only hold the sealed reviews,
-- approvals, receipts, allocations and source bindings, so a later posting
-- cannot change what a captured credit or refund already means. There is no
-- function, no policy, no rate table and no report calculation here. No FX,
-- advances or general netting belong to this first profile.

CREATE TABLE openerp.supplier_refund_principal_increases (
  book_id text NOT NULL,
  id text NOT NULL,
  credit_id text NOT NULL,
  invoice_id text NOT NULL,
  ap_release_minor openerp.minor_units NOT NULL,
  refund_increase_minor openerp.minor_units NOT NULL,
  refund_receivable_account_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT supplier_refund_principal_increases_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_refund_principal_increases_book_id_credit_id_key UNIQUE (book_id, credit_id),
  CONSTRAINT supplier_refund_principal_increases_ap_release_check CHECK (ap_release_minor::numeric >= 0::numeric),
  CONSTRAINT supplier_refund_principal_increases_refund_increase_check CHECK (refund_increase_minor::numeric >= 0::numeric),
  CONSTRAINT supplier_refund_principal_increases_split_check CHECK (
    (ap_release_minor::numeric + refund_increase_minor::numeric) > 0::numeric),
  CONSTRAINT supplier_refund_principal_increases_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT supplier_refund_principal_increases_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT supplier_refund_principal_increases_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT supplier_refund_principal_increases_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT supplier_refund_principal_increases_book_id_credit_id_fkey FOREIGN KEY (book_id, credit_id) REFERENCES openerp.supplier_credits(book_id, id),
  CONSTRAINT supplier_refund_principal_increases_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id)
);

CREATE TABLE openerp.supplier_refund_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  invoice_id text NOT NULL,
  change_set_id text,
  event_id text,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_refund_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_refund_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT supplier_refund_reviews_body_check CHECK (octet_length(body::text) <= 262144),
  -- An adopted receipt posts no new journal, so it carries no change set or
  -- event; a cash receipt always carries both. One state or the other holds.
  CONSTRAINT supplier_refund_reviews_posting_check CHECK (
    (change_set_id IS NULL AND event_id IS NULL)
    OR (change_set_id IS NOT NULL AND event_id IS NOT NULL)),
  CONSTRAINT supplier_refund_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT supplier_refund_reviews_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT supplier_refund_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT supplier_refund_reviews_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id)
);

CREATE TABLE openerp.supplier_refund_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_refund_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_refund_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT supplier_refund_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT supplier_refund_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.supplier_refund_reviews(book_id, id)
);

CREATE TABLE openerp.supplier_refunds (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  invoice_id text NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  refund_date date NOT NULL,
  voucher_id text,
  adopted_ref text,
  source_kind text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT supplier_refunds_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_refunds_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT supplier_refunds_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT supplier_refunds_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT supplier_refunds_source_kind_check CHECK (source_kind = ANY (ARRAY['unposted_cash'::text, 'posted_credit'::text])),
  -- A cash receipt posts exactly one voucher and adopts nothing; an adopted
  -- receipt adopts exactly one posted refund-control credit and posts nothing.
  CONSTRAINT supplier_refunds_source_check CHECK (
    (source_kind = 'unposted_cash'::text AND voucher_id IS NOT NULL AND adopted_ref IS NULL)
    OR (source_kind = 'posted_credit'::text AND voucher_id IS NULL AND adopted_ref IS NOT NULL)),
  CONSTRAINT supplier_refunds_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT supplier_refunds_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT supplier_refunds_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT supplier_refunds_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT supplier_refunds_book_id_approval_id_review_id_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.supplier_refund_approvals(book_id, id, review_id),
  CONSTRAINT supplier_refunds_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT supplier_refunds_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT supplier_refunds_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.supplier_refund_reviews(book_id, id),
  CONSTRAINT supplier_refunds_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);

CREATE TABLE openerp.supplier_refund_allocations (
  book_id text NOT NULL,
  refund_id text NOT NULL,
  ordinal integer NOT NULL,
  allocation_id text NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  CONSTRAINT supplier_refund_allocations_pkey PRIMARY KEY (book_id, refund_id, ordinal),
  CONSTRAINT supplier_refund_allocations_book_id_refund_id_allocation_id_key UNIQUE (book_id, refund_id, allocation_id),
  CONSTRAINT supplier_refund_allocations_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT supplier_refund_allocations_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT supplier_refund_allocations_book_id_refund_id_fkey FOREIGN KEY (book_id, refund_id) REFERENCES openerp.supplier_refunds(book_id, id)
);

CREATE TABLE openerp.supplier_refund_source_usages (
  book_id text NOT NULL,
  refund_id text NOT NULL,
  source_kind text NOT NULL,
  bank_account_id text,
  evidence_id text,
  adopted_ref text,
  amount_minor openerp.minor_units NOT NULL,
  CONSTRAINT supplier_refund_source_usages_pkey PRIMARY KEY (book_id, refund_id),
  CONSTRAINT supplier_refund_source_usages_source_kind_check CHECK (source_kind = ANY (ARRAY['unposted_cash'::text, 'posted_credit'::text])),
  CONSTRAINT supplier_refund_source_usages_source_check CHECK (
    (source_kind = 'unposted_cash'::text AND bank_account_id IS NOT NULL AND evidence_id IS NOT NULL AND adopted_ref IS NULL)
    OR (source_kind = 'posted_credit'::text AND bank_account_id IS NULL AND evidence_id IS NULL AND adopted_ref IS NOT NULL)),
  CONSTRAINT supplier_refund_source_usages_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT supplier_refund_source_usages_book_id_refund_id_fkey FOREIGN KEY (book_id, refund_id) REFERENCES openerp.supplier_refunds(book_id, id)
);

CREATE INDEX supplier_refund_principal_increases_invoice ON openerp.supplier_refund_principal_increases (book_id, invoice_id);
CREATE INDEX supplier_refund_reviews_invoice ON openerp.supplier_refund_reviews (book_id, invoice_id);
CREATE INDEX supplier_refunds_invoice ON openerp.supplier_refunds (book_id, invoice_id);
CREATE INDEX supplier_refund_allocations_refund ON openerp.supplier_refund_allocations (book_id, refund_id);

-- A sealed paid-credit split, review, approval, receipt, allocation or
-- source binding is history. A later correction appends; it never rewrites
-- what the captured record already meant.
CREATE TRIGGER immutable_supplier_refund_principal_increase
  BEFORE DELETE OR UPDATE ON openerp.supplier_refund_principal_increases
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_refund_review
  BEFORE DELETE OR UPDATE ON openerp.supplier_refund_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_refund_approval
  BEFORE DELETE OR UPDATE ON openerp.supplier_refund_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_refund
  BEFORE DELETE OR UPDATE ON openerp.supplier_refunds
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_refund_allocation
  BEFORE DELETE OR UPDATE ON openerp.supplier_refund_allocations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_refund_source_usage
  BEFORE DELETE OR UPDATE ON openerp.supplier_refund_source_usages
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.supplier_refund_principal_increases, openerp.supplier_refund_reviews,
  openerp.supplier_refund_approvals, openerp.supplier_refunds, openerp.supplier_refund_allocations,
  openerp.supplier_refund_source_usages TO openerp_runtime;
