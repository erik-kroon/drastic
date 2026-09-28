-- NEXT-43: reviewed dimension restatement without editing journals.
--
-- A restatement never touches a journal line, a posted amount, an account, a
-- currency, a tax point, an economic owner or an original tag. It records a
-- reviewed classification history beside the retained original assignments and
-- moves the current head, so a report can resolve either the original view or
-- the reviewed view as at its own cutoff.
--
-- Two tables:
--   * dimension_classification_revisions is immutable history. A revision row
--     is the complete reviewed assignment set for one line at one scope, so a
--     row that recorded a partial set would be unreadable as a snapshot.
--   * dimension_classification_heads is the current head per line. It is the
--     only mutable row, because it is a pointer, not a financial fact.

CREATE TABLE openerp.dimension_classification_revisions (
  book_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  revision_id integer NOT NULL,
  analytical_scope text NOT NULL,
  reason text NOT NULL,
  -- The complete reviewed assignment set for this line, canonicalised.
  assignments jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dimension_classification_revisions_pkey
    PRIMARY KEY (book_id, voucher_id, line_id, revision_id),
  -- A revision is a versioned snapshot, so it may never be rewritten. It also
  -- names a real posted line: restating a line that does not exist would
  -- record history against nothing.
  CONSTRAINT dimension_classification_revisions_line_fkey
    FOREIGN KEY (book_id, voucher_id, line_id)
    REFERENCES openerp.journal_lines (book_id, voucher_id, id),
  CONSTRAINT dimension_classification_revisions_revision_check
    CHECK (revision_id >= 1 AND revision_id < 100000),
  CONSTRAINT dimension_classification_revisions_scope_check
    CHECK (length(analytical_scope) >= 1 AND length(analytical_scope) <= 200),
  CONSTRAINT dimension_classification_revisions_reason_check
    CHECK (length(reason) >= 1 AND length(reason) <= 2000),
  -- jsonb_array_length refuses a null or non-array, so a revision can never
  -- carry a partial set smuggled in as a scalar.
  CONSTRAINT dimension_classification_revisions_assignments_check
    CHECK (jsonb_typeof(assignments) = 'array'::text AND jsonb_array_length(assignments) <= 64)
);

CREATE INDEX dimension_classification_revisions_line
  ON openerp.dimension_classification_revisions
    (book_id, voucher_id, line_id, revision_id);

-- The current head per line. The original tag is revision 0, so an untouched
-- line has no row here and still resolves to its original assignments.
CREATE TABLE openerp.dimension_classification_heads (
  book_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  revision_id integer NOT NULL,
  version integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dimension_classification_heads_pkey
    PRIMARY KEY (book_id, voucher_id, line_id),
  CONSTRAINT dimension_classification_heads_line_fkey
    FOREIGN KEY (book_id, voucher_id, line_id)
    REFERENCES openerp.journal_lines (book_id, voucher_id, id),
  CONSTRAINT dimension_classification_heads_revision_check
    CHECK (revision_id >= 1 AND revision_id < 100000),
  CONSTRAINT dimension_classification_heads_version_check
    CHECK (version >= 0 AND version < 1000000)
);

CREATE TRIGGER immutable_dimension_classification_revision
  BEFORE UPDATE OR DELETE ON openerp.dimension_classification_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The head is a pointer, so it is updated in place. Its guard is the head
-- revision itself: a writer must name the revision it expects to replace, so a
-- concurrent restatement is refused rather than silently merged.
CREATE OR REPLACE FUNCTION openerp.dimension_classification_head_fence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.book_id <> OLD.book_id
     OR NEW.voucher_id <> OLD.voucher_id
     OR NEW.line_id <> OLD.line_id
     OR NEW.revision_id <> OLD.revision_id + 1
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION
      'dimension classification head must advance exactly one revision and one version';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER dimension_classification_head_fence
  BEFORE UPDATE ON openerp.dimension_classification_heads
  FOR EACH ROW EXECUTE FUNCTION openerp.dimension_classification_head_fence();

CREATE TRIGGER immutable_dimension_classification_head_delete
  BEFORE DELETE ON openerp.dimension_classification_heads
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role reads both tables and appends history. It may advance a head
-- but may never rewrite a revision, which the immutable trigger enforces too.
GRANT SELECT, INSERT ON openerp.dimension_classification_revisions TO openerp_runtime;
GRANT SELECT, INSERT, UPDATE ON openerp.dimension_classification_heads TO openerp_runtime;

-- The prepared plan is retained so the apply step approves and records exactly
-- the preview a reviewer saw. A plan is immutable: a different selection or a
-- different scope is a different plan, never an edit of this one.
CREATE TABLE openerp.dimension_restatement_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  analytical_scope text NOT NULL,
  reason text NOT NULL,
  digest text NOT NULL,
  -- The sealed plan: the reviewed assignment set, reasons and totals the
  -- reviewer approved.
  plan jsonb NOT NULL,
  -- The posted lines the plan covers, as {lineId, voucherId}. The plan itself
  -- keys a line by its line id, so the voucher each line belongs to is retained
  -- beside it rather than reconstructed at apply time.
  selection jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dimension_restatement_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT dimension_restatement_plans_scope_check
    CHECK (length(analytical_scope) >= 1 AND length(analytical_scope) <= 200),
  CONSTRAINT dimension_restatement_plans_plan_check
    CHECK (jsonb_typeof(plan) = 'object'::text),
  CONSTRAINT dimension_restatement_plans_selection_check
    CHECK (jsonb_typeof(selection) = 'array'::text AND jsonb_array_length(selection) <= 500)
);

CREATE INDEX dimension_restatement_plans_scope
  ON openerp.dimension_restatement_plans (book_id, analytical_scope);

CREATE TRIGGER immutable_dimension_restatement_plan
  BEFORE UPDATE OR DELETE ON openerp.dimension_restatement_plans
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON openerp.dimension_restatement_plans TO openerp_runtime;
