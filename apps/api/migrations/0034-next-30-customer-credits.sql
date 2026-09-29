-- NEXT-30: customer unapplied cash, paid credits and refunds.
--
-- A receipt origin records the unallocated remainder of one adopted customer
-- cash receipt as a customer-credit liability. An effect records one
-- application of that origin to an invoice, one cash refund of it, or one
-- owned correction. The origin never moves: effects consume its remaining
-- capacity, and the remaining capacity is always original less effective
-- applications less effective refunds.
--
-- Origins and effects are immutable. Correcting a misapplied effect appends a
-- reversing effect through the refusal path, never an edit.

CREATE TABLE openerp.customer_credit_origins (
  book_id text NOT NULL,
  id text NOT NULL,
  customer_id text NOT NULL,
  currency text NOT NULL,
  original_minor text NOT NULL,
  source_kind text NOT NULL,
  source_ref text NOT NULL,
  credit_liability_account_id text NOT NULL,
  receivable_control_account_id text NOT NULL,
  receipt_id text NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_credit_origins_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT customer_credit_origins_currency_check CHECK (currency ~ '^[A-Z]{3}$'::text),
  CONSTRAINT customer_credit_origins_kind_check CHECK (source_kind = ANY (ARRAY['new_cash'::text, 'adopted_clearing'::text])),
  CONSTRAINT customer_credit_origins_receipt_key UNIQUE (book_id, receipt_id)
);

CREATE TABLE openerp.customer_credit_effects (
  book_id text NOT NULL,
  id text NOT NULL,
  origin_id text NOT NULL,
  kind text NOT NULL,
  signed_consumed_minor text NOT NULL,
  destination_identity text NOT NULL,
  receipt_id text NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_credit_effects_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT customer_credit_effects_origin_fkey
    FOREIGN KEY (book_id, origin_id) REFERENCES openerp.customer_credit_origins (book_id, id),
  CONSTRAINT customer_credit_effects_kind_check CHECK (kind = ANY (ARRAY['apply_to_invoice'::text, 'cash_refund'::text, 'owned_correction'::text])),
  CONSTRAINT customer_credit_effects_receipt_key UNIQUE (book_id, receipt_id)
);

CREATE INDEX customer_credit_effects_origin
  ON openerp.customer_credit_effects (book_id, origin_id);

CREATE TRIGGER immutable_customer_credit_origin
  BEFORE UPDATE OR DELETE ON openerp.customer_credit_origins
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_customer_credit_effect
  BEFORE UPDATE OR DELETE ON openerp.customer_credit_effects
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role retains origins and appends effects. It never updates or
-- deletes either, and it never posts except through the shared posting kernel.
GRANT SELECT, INSERT ON openerp.customer_credit_origins TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.customer_credit_effects TO openerp_runtime;
