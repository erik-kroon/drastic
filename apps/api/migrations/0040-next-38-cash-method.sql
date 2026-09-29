-- NEXT-38: cash-method recognition and unpaid year-end cutover.
--
-- An accrual book recognizes a purchase or sale when the document is issued.
-- A cash-method book recognizes it when it is paid, and once-only at year end
-- recognizes the unpaid remainder. The commercial balance and the accounting
-- recognition are separate, and this migration keeps them separate:
--
--   * cash_method_lines is the per-line recognized state. Original amounts are
--     immutable in the invoice owner; this holds the paid prefix P, the
--     recognized prefix R and the credited suffix C, with the leaf's invariant
--     0 <= P <= R <= G - C enforced here so a state the leaf would refuse
--     cannot be written.
--   * cash_method_recognitions is the append-only history. Every recognition
--     records the payment receipt or the year-end run that triggered it and the
--     evidence for it, so a recognized amount is always traceable to a real
--     trigger rather than to a date.
--   * cash_method_year_end_runs records one reviewed year-end cutover per
--     period, and the recognition it consumed. A second run over the same
--     period is not representable.
--
-- Eligibility is never inferred. A line is cash-method only because a reviewed
-- profile witness says so, and the witness is retained with the line. Switching
-- a book between methods is a reviewed decision with its own record, never a
-- relabelling of existing accrual effects.

CREATE TABLE openerp.cash_method_lines (
  book_id text NOT NULL,
  id text NOT NULL,
  invoice_id text NOT NULL,
  source_line_id text NOT NULL,
  direction text NOT NULL,
  currency text NOT NULL,
  -- The original amounts, copied from the invoice so this row is readable on
  -- its own. They are never the authority: the invoice remains it.
  original_gross_minor text NOT NULL,
  credited_gross_minor text NOT NULL,
  -- The paid prefix and the recognized prefix. R never falls below P.
  paid_gross_minor text NOT NULL DEFAULT '0',
  recognized_gross_minor text NOT NULL DEFAULT '0',
  -- The exact tax split, carried per component policy and rounding mode. These
  -- are reviewed profile values, never defaults.
  component_policy text NOT NULL,
  rounding text NOT NULL,
  -- The reviewed witness that put this line on cash method at all.
  profile_witness text NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_method_lines_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT cash_method_lines_invoice_source_key UNIQUE (book_id, invoice_id, source_line_id),
  CONSTRAINT cash_method_lines_invoice_fkey
    FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices (book_id, id),
  -- The accounting direction. The invoice owner records customer/supplier;
  -- this records the accounting view of the same two, so a reader never has to
  -- guess which is which.
  CONSTRAINT cash_method_lines_direction_check
    CHECK (direction = ANY (ARRAY['purchase'::text, 'sale'::text])),
  CONSTRAINT cash_method_lines_currency_check CHECK (currency ~ '^[A-Z]{3}$'::text),
  CONSTRAINT cash_method_lines_policy_check
    CHECK (component_policy = 'tax_first_cumulative_v1'::text),
  CONSTRAINT cash_method_lines_rounding_check
    CHECK (rounding = ANY (ARRAY['exact'::text, 'half_up'::text])),
  CONSTRAINT cash_method_lines_amounts_check CHECK (
    original_gross_minor ~ '^[0-9]+$'::text
    AND credited_gross_minor ~ '^[0-9]+$'::text
    AND paid_gross_minor ~ '^[0-9]+$'::text
    AND recognized_gross_minor ~ '^[0-9]+$'::text
  ),
  -- The invariant the leaf enforces, enforced here too. A line whose
  -- recognized amount fell below what was paid, or above what remained after
  -- credits, is not representable.
  CONSTRAINT cash_method_lines_prefix_check CHECK (
    paid_gross_minor::numeric <= recognized_gross_minor::numeric
    AND recognized_gross_minor::numeric <= original_gross_minor::numeric - credited_gross_minor::numeric
  ),
  CONSTRAINT cash_method_lines_version_check CHECK (version >= 0 AND version < 1000000000)
);

-- A line must really be on the side it claims. This cannot be a CHECK
-- constraint because PostgreSQL forbids a subquery there, and it is exactly
-- the cross-table fact that must be enforced: a purchase line over a customer
-- document would defer the wrong side's cost.
CREATE OR REPLACE FUNCTION openerp.cash_method_line_side()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  invoice_direction text;
BEGIN
  SELECT i.direction into invoice_direction
  from openerp.commerce_invoices i
  where i.book_id = NEW.book_id and i.id = NEW.invoice_id;

  IF invoice_direction IS NULL THEN
    RAISE EXCEPTION 'cash method line names an invoice that is not retained';
  END IF;

  IF (NEW.direction = 'sale'::text AND invoice_direction <> 'customer'::text)
     OR (NEW.direction = 'purchase'::text AND invoice_direction <> 'supplier'::text) THEN
    RAISE EXCEPTION 'cash method line direction does not match the invoice it belongs to';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_method_line_side
  BEFORE INSERT ON openerp.cash_method_lines
  FOR EACH ROW EXECUTE FUNCTION openerp.cash_method_line_side();

CREATE INDEX cash_method_lines_invoice ON openerp.cash_method_lines (book_id, invoice_id);

-- One year-end cutover per period. The consumed population is recorded with it,
-- so a later read can tell what was recognized and why.
CREATE TABLE openerp.cash_method_year_end_runs (
  book_id text NOT NULL,
  id text NOT NULL,
  accounting_period_id text NOT NULL,
  cutoff_on date NOT NULL,
  -- The reviewed decision and the evidence a human reviewed. A method change
  -- is never inferred from a company size or a relabelled effect.
  rationale text NOT NULL,
  evidence_id text NOT NULL,
  recognized_line_count integer NOT NULL,
  recognized_gross_minor text NOT NULL,
  run_key text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_method_year_end_runs_pkey PRIMARY KEY (book_id, id),
  -- One cutover per period. A second year-end recognition over the same period
  -- would recognize the same unpaid remainder twice.
  CONSTRAINT cash_method_year_end_runs_period_key UNIQUE (book_id, accounting_period_id),
  CONSTRAINT cash_method_year_end_runs_key UNIQUE (book_id, run_key),
  CONSTRAINT cash_method_year_end_runs_period_fkey
    FOREIGN KEY (book_id, accounting_period_id) REFERENCES openerp.periods (book_id, id),
  CONSTRAINT cash_method_year_end_runs_evidence_fkey
    FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence (book_id, id),
  CONSTRAINT cash_method_year_end_runs_actor_fkey
    FOREIGN KEY (created_by) REFERENCES openerp.actors (id),
  CONSTRAINT cash_method_year_end_runs_counts_check
    CHECK (recognized_line_count >= 0 AND recognized_line_count <= 10000
      AND recognized_gross_minor ~ '^[0-9]+$'::text)
);

-- Append-only recognition history. A recognition always names the trigger
-- that caused it: a real payment receipt, or a year-end run. There is no
-- recognition without one.
CREATE TABLE openerp.cash_method_recognitions (
  book_id text NOT NULL,
  id text NOT NULL,
  line_id text NOT NULL,
  trigger_kind text NOT NULL,
  trigger_ref text NOT NULL,
  -- The exact amount recognized by this event, and the cumulative total after
  -- it. The cumulative value is what makes a double recognition visible.
  recognized_gross_minor text NOT NULL,
  recognized_gross_after_minor text NOT NULL,
  paid_gross_after_minor text NOT NULL,
  net_minor text NOT NULL,
  tax_minor text NOT NULL,
  deductible_minor text NOT NULL,
  evidence_id text NOT NULL,
  change_set_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_method_recognitions_pkey PRIMARY KEY (book_id, id),
  -- One recognition per trigger per line. A re-presented payment under a new
  -- key still collides, because the trigger is the payment's own identity.
  CONSTRAINT cash_method_recognitions_trigger_key
    UNIQUE (book_id, line_id, trigger_kind, trigger_ref),
  CONSTRAINT cash_method_recognitions_line_fkey
    FOREIGN KEY (book_id, line_id) REFERENCES openerp.cash_method_lines (book_id, id),
  CONSTRAINT cash_method_recognitions_evidence_fkey
    FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence (book_id, id),
  CONSTRAINT cash_method_recognitions_change_set_fkey
    FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets (book_id, id),
  CONSTRAINT cash_method_recognitions_trigger_check
    CHECK (trigger_kind = ANY (ARRAY['actual_payment'::text, 'year_end_unpaid'::text])),
  -- A year-end recognition must cite a real cutover run, enforced by the
  -- trigger below because PostgreSQL forbids a subquery in a CHECK. A payment
  -- recognition cites its own payment identity, which this schema cannot
  -- foreign-key: a purchase payment and a customer receipt are recorded by
  -- different owners and there is no single retained payment table to point
  -- at. Rather than invent one, the trigger identity is carried on the row and
  -- the owner's own replay check refuses a second recognition of it.
  CONSTRAINT cash_method_recognitions_trigger_ref_check
    CHECK (length(trigger_ref) >= 1 AND length(trigger_ref) <= 200),
  CONSTRAINT cash_method_recognitions_amounts_check
    CHECK (recognized_gross_minor ~ '^[0-9]+$'::text
      AND recognized_gross_after_minor ~ '^[0-9]+$'::text
      AND paid_gross_after_minor ~ '^[0-9]+$'::text
      AND net_minor ~ '^[0-9]+$'::text
      AND tax_minor ~ '^[0-9]+$'::text
      AND deductible_minor ~ '^[0-9]+$'::text),
  -- A recognition moves the recognized prefix forward and never back.
  CONSTRAINT cash_method_recognitions_monotonic_check
    CHECK (recognized_gross_after_minor::numeric >= recognized_gross_minor::numeric)
);

-- A year-end recognition must name a real retained cutover run. Without this,
-- a recognition could claim a year-end trigger that never happened.
CREATE OR REPLACE FUNCTION openerp.cash_method_year_end_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trigger_kind = 'year_end_unpaid'::text AND NOT EXISTS (
    select 1 from openerp.cash_method_year_end_runs y
    where y.book_id = NEW.book_id and y.id = NEW.trigger_ref
  ) THEN
    RAISE EXCEPTION 'cash method year-end recognition names a cutover run that is not retained';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_method_year_end_trigger
  BEFORE INSERT ON openerp.cash_method_recognitions
  FOR EACH ROW EXECUTE FUNCTION openerp.cash_method_year_end_trigger();

CREATE TRIGGER immutable_cash_method_recognition
  BEFORE UPDATE OR DELETE ON openerp.cash_method_recognitions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_cash_method_year_end_run
  BEFORE UPDATE OR DELETE ON openerp.cash_method_year_end_runs
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The line is a pointer to its current recognized prefix. It advances exactly
-- one version per recognition, under the version the writer observed, so two
-- concurrent recognitions of the same line cannot both succeed.
CREATE OR REPLACE FUNCTION openerp.cash_method_line_fence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.book_id <> OLD.book_id
     OR NEW.id <> OLD.id
     OR NEW.version <> OLD.version + 1
     OR NEW.paid_gross_minor::numeric < OLD.paid_gross_minor::numeric
     OR NEW.recognized_gross_minor::numeric < OLD.recognized_gross_minor::numeric THEN
    RAISE EXCEPTION
      'cash method line must advance exactly one version and never rewind a prefix';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_method_line_fence
  BEFORE UPDATE ON openerp.cash_method_lines
  FOR EACH ROW EXECUTE FUNCTION openerp.cash_method_line_fence();

-- The runtime role keeps the line, appends recognitions and records a year-end
-- run. It may only advance the line's own pointer columns.
GRANT SELECT, INSERT ON openerp.cash_method_lines TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.cash_method_recognitions TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.cash_method_year_end_runs TO openerp_runtime;
GRANT UPDATE (paid_gross_minor, recognized_gross_minor, version)
  ON openerp.cash_method_lines TO openerp_runtime;
