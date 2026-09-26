-- NEXT-14: the original dimension assignment of a posted journal line.
--
-- One immutable row per posted line and per dimension effective at that line's
-- posting date. The row records what the source line carried, not a live
-- classification and not a computed default: an explicit catalogue value, an
-- explicitly reviewed unassigned value, a historical exemption bound to
-- retained evidence, and a source that carried no dimension evidence at all are
-- four different facts and stay distinguishable.
--
-- This file declares no function, no policy, no default value and no
-- dispatcher. It holds the scoped references, the storage uniqueness, the
-- ordinary shape checks and the immutability of an original assignment. Which
-- value is eligible on a given date, which requirement applies, whether a
-- reversal inherits archived values and which partition the money falls into
-- are application-owned decisions in apps/api/src/application/dimensions.
--
-- A row is written in the same transaction as the journal lines it belongs to.
-- There is no public path that appends or changes an assignment on an already
-- posted line, and no path that deletes one.

CREATE TABLE openerp.journal_line_dimensions (
  book_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  dimension_code text COLLATE "C" NOT NULL,
  dimension_revision integer NOT NULL,
  status text NOT NULL,
  value_code text COLLATE "C",
  value_revision integer,
  captured_label text NOT NULL,
  exemption_evidence_id text,
  source_value_code text COLLATE "C",
  inherited_from_voucher_id text,
  inherited_from_line_id text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_line_dimensions_pkey PRIMARY KEY (book_id, voucher_id, line_id, dimension_code),
  CONSTRAINT journal_line_dimensions_status_check CHECK (status = ANY (ARRAY['explicit'::text, 'explicit_unassigned'::text, 'historical_exemption'::text, 'not_recorded_in_source'::text])),
  CONSTRAINT journal_line_dimensions_dimension_revision_check CHECK (dimension_revision >= 1 AND dimension_revision < 100000),
  CONSTRAINT journal_line_dimensions_value_revision_check CHECK (value_revision IS NULL OR value_revision >= 1 AND value_revision < 100000),
  -- Only an explicit assignment names a catalogue value. Explicitly unassigned,
  -- evidenced exempt and not recorded in the source each say something
  -- different, and a row that blurred them would lose that difference.
  CONSTRAINT journal_line_dimensions_coded_shape_check CHECK ((status = 'explicit'::text) = (value_code IS NOT NULL AND value_revision IS NOT NULL)),
  CONSTRAINT journal_line_dimensions_exemption_shape_check CHECK ((status = 'historical_exemption'::text) = (exemption_evidence_id IS NOT NULL)),
  CONSTRAINT journal_line_dimensions_label_check CHECK (length(captured_label) >= 1 AND length(captured_label) <= 2000),
  CONSTRAINT journal_line_dimensions_dimension_code_check CHECK (dimension_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'::text),
  CONSTRAINT journal_line_dimensions_value_code_check CHECK (value_code IS NULL OR value_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'::text),
  CONSTRAINT journal_line_dimensions_source_value_code_check CHECK (source_value_code IS NULL OR source_value_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'::text),
  -- A retained source code is an alias of a different native code. Recording the
  -- native code as its own alias would be ambiguous rather than informative.
  CONSTRAINT journal_line_dimensions_alias_differs_check CHECK (source_value_code IS NULL OR value_code IS NULL OR source_value_code <> value_code),
  CONSTRAINT journal_line_dimensions_inherit_shape_check CHECK ((inherited_from_voucher_id IS NULL) = (inherited_from_line_id IS NULL)),
  CONSTRAINT journal_line_dimensions_line_fkey FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT journal_line_dimensions_dimension_revision_fkey FOREIGN KEY (book_id, dimension_code, dimension_revision) REFERENCES openerp.dimension_revisions(book_id, code, revision),
  CONSTRAINT journal_line_dimensions_value_revision_fkey FOREIGN KEY (book_id, dimension_code, value_code, value_revision) REFERENCES openerp.dimension_value_revisions(book_id, dimension_code, code, revision),
  CONSTRAINT journal_line_dimensions_exemption_evidence_fkey FOREIGN KEY (book_id, exemption_evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT journal_line_dimensions_inherited_line_fkey FOREIGN KEY (book_id, inherited_from_voucher_id, inherited_from_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);

CREATE INDEX journal_line_dimensions_partition ON openerp.journal_line_dimensions (book_id, dimension_code, value_code, voucher_id, line_id);
CREATE INDEX journal_line_dimensions_evidence ON openerp.journal_line_dimensions (book_id, exemption_evidence_id) WHERE exemption_evidence_id IS NOT NULL;

-- An original assignment is history. A later archive, a later reclassification
-- or a later correction creates new records against a new line; it never
-- rewrites what this line originally carried.
CREATE TRIGGER immutable_journal_line_dimension
  BEFORE DELETE OR UPDATE ON openerp.journal_line_dimensions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role appends one assignment per line inside the same financial
-- transaction that writes the line. It can never change or remove one, and it
-- cannot reach the dimension catalogue through this table.
GRANT SELECT, INSERT ON TABLE openerp.journal_line_dimensions TO openerp_runtime;
