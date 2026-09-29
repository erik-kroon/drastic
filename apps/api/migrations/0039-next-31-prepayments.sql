-- NEXT-31: invoice-linked prepayments and accrued-cost true-up.
--
-- The subledger schedule owner already allocates a reviewed cost over future
-- occurrences. What it could not do is relate that schedule to a purchase
-- recognition, or resolve an accrued cost against the invoice that finally
-- arrived. This adds those two relationships without a second scheduling
-- engine: the schedule, its revisions and its occurrences stay exactly where
-- they are, and this records only the link and the resolution.
--
--   * expense_cost_bases links one purchase recognition's source lines to the
--     schedule that defers them. It is the evidence that the deferred cost is
--     the same cost the purchase recognised, which is what stops a deferral
--     from being created against a figure nobody posted.
--   * accrued_costs records an evidenced service already received with a
--     reviewed estimate, and its resolution against the invoice. The residual
--     is always original less resolved, so a second resolution of the same
--     invoice is not representable.
--
-- The expense cost excludes deductible input VAT. Deferring cost changes when
-- accounting expense is recognized, never the VAT tax point, so no tax fact is
-- created or moved here. An invoice that is a valid tax invoice still does not
-- prove a service spans the dates a model asserts, which is why the service
-- period is reviewed evidence rather than a derived date.

CREATE TABLE openerp.expense_cost_bases (
  book_id text NOT NULL,
  id text NOT NULL,
  -- The purchase recognition whose cost this schedule defers. The link is
  -- what makes the deferral a deferral of something real.
  purchase_recognition_id text NOT NULL,
  schedule_id text NOT NULL,
  currency text NOT NULL,
  -- The cost that excludes deductible input VAT, retained exactly.
  cost_minor text NOT NULL,
  service_starts_on date NOT NULL,
  service_ends_on_exclusive date NOT NULL,
  -- The reviewed service evidence and the cutoff the review was made at. A
  -- valid tax invoice is not accepted as proof of service coverage.
  service_evidence_id text NOT NULL,
  reviewed_cutoff_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_cost_bases_pkey PRIMARY KEY (book_id, id),
  -- One schedule is the deferral of one recognition. A second basis over the
  -- same schedule would defer the same cost twice.
  CONSTRAINT expense_cost_bases_schedule_key UNIQUE (book_id, schedule_id),
  CONSTRAINT expense_cost_bases_schedule_fkey
    FOREIGN KEY (book_id, schedule_id) REFERENCES openerp.subledger_schedules (book_id, id),
  CONSTRAINT expense_cost_bases_evidence_fkey
    FOREIGN KEY (book_id, service_evidence_id) REFERENCES openerp.evidence (book_id, id),
  CONSTRAINT expense_cost_bases_currency_check CHECK (currency ~ '^[A-Z]{3}$'::text),
  CONSTRAINT expense_cost_bases_cost_check
    CHECK (cost_minor ~ '^-?[0-9]+$'::text AND length(cost_minor) <= 38),
  -- An exclusive end at or before the start describes no service at all.
  CONSTRAINT expense_cost_bases_period_check
    CHECK (service_ends_on_exclusive > service_starts_on)
);

CREATE INDEX expense_cost_bases_recognition
  ON openerp.expense_cost_bases (book_id, purchase_recognition_id);

-- An evidenced service already received, carried at a reviewed estimate until
-- the invoice arrives. The residual is derived, never stated.
CREATE TABLE openerp.accrued_costs (
  book_id text NOT NULL,
  id text NOT NULL,
  -- The review identity of the service. A later invoice that describes a
  -- different service cannot resolve this accrual.
  service_identity text NOT NULL,
  expense_account_id text NOT NULL,
  liability_account_id text NOT NULL,
  currency text NOT NULL,
  original_minor text NOT NULL,
  evidence_id text NOT NULL,
  reviewed_on date NOT NULL,
  -- The prepared journal that recognizes the expected cost. It is prepared,
  -- not executed: the accrual exists before its journal is approved, exactly
  -- as every other prepared posting in this repository does.
  change_set_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accrued_costs_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT accrued_costs_change_set_fkey
    FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets (book_id, id),
  CONSTRAINT accrued_costs_service_key UNIQUE (book_id, service_identity),
  CONSTRAINT accrued_costs_evidence_fkey
    FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence (book_id, id),
  CONSTRAINT accrued_costs_currency_check CHECK (currency ~ '^[A-Z]{3}$'::text),
  CONSTRAINT accrued_costs_original_check
    CHECK (original_minor ~ '^[0-9]+$'::text AND length(original_minor) <= 38),
  -- An accrual with no positive expected cost is not an accrual.
  CONSTRAINT accrued_costs_positive_check
    CHECK (original_minor::numeric > 0 AND original_minor::numeric < '1e37'::numeric)
);

-- One invoice resolves an accrual at most once. The identity is the accrual
-- plus the invoice's own retained identity, so a re-presented invoice under a
-- new key still collides.
CREATE TABLE openerp.accrual_resolutions (
  book_id text NOT NULL,
  id text NOT NULL,
  accrual_id text NOT NULL,
  -- The signed expense true-up: positive on underestimate, negative on
  -- overestimate. It is a computed difference, never a plug.
  true_up_minor text NOT NULL,
  consumed_minor text NOT NULL,
  actual_net_minor text NOT NULL,
  deductible_tax_minor text NOT NULL,
  invoice_identity text NOT NULL,
  payable_minor text NOT NULL,
  change_set_id text NOT NULL,
  receipt_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accrual_resolutions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT accrual_resolutions_invoice_key UNIQUE (book_id, accrual_id, invoice_identity),
  CONSTRAINT accrual_resolutions_accrual_fkey
    FOREIGN KEY (book_id, accrual_id) REFERENCES openerp.accrued_costs (book_id, id),
  CONSTRAINT accrual_resolutions_change_set_fkey
    FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets (book_id, id),
  CONSTRAINT accrual_resolutions_true_up_check
    CHECK (true_up_minor ~ '^-?[0-9]+$'::text AND length(true_up_minor) <= 38),
  CONSTRAINT accrual_resolutions_amounts_check
    CHECK (consumed_minor ~ '^[0-9]+$'::text AND actual_net_minor ~ '^[0-9]+$'::text
      AND deductible_tax_minor ~ '^[0-9]+$'::text AND payable_minor ~ '^[0-9]+$'::text)
);

CREATE INDEX accrual_resolutions_accrual
  ON openerp.accrual_resolutions (book_id, accrual_id, created_at);

-- Both tables are evidence of a review and a computed effect. Correcting one
-- appends a reversing resolution through the correction owner; neither is
-- edited in place.
CREATE TRIGGER immutable_expense_cost_basis
  BEFORE UPDATE OR DELETE ON openerp.expense_cost_bases
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_accrual_resolution
  BEFORE UPDATE OR DELETE ON openerp.accrual_resolutions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role links a recognition to a schedule, records an accrual and
-- appends its resolution. It may never update any of the three.
GRANT SELECT, INSERT ON openerp.expense_cost_bases TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.accrued_costs TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.accrual_resolutions TO openerp_runtime;
