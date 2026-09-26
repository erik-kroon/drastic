-- NEXT-13: immutable semantic profit-and-loss and balance-sheet snapshots.
--
-- A statement snapshot is a read-only artifact. The application owns the mapping,
-- the virtual result, the subtotal graph and the diagnostics; these tables only
-- hold the sealed header, the retained row membership and the retained
-- contribution membership, so a later backdated posting cannot change what a
-- captured statement already means. There is no function, no policy and no
-- report calculation here.

CREATE TABLE openerp.report_statement_snapshots (
  book_id text NOT NULL,
  id text NOT NULL,
  fiscal_year_id text NOT NULL,
  as_of date NOT NULL,
  sequence bigint NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_statement_snapshots_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT report_statement_snapshots_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT report_statement_snapshots_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT report_statement_snapshots_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT report_statement_snapshots_kind_check CHECK (body ->> 'kind'::text = 'semantic_statement_v1'::text),
  CONSTRAINT report_statement_snapshots_as_of_check CHECK (NOT body ->> 'asOf'::text IS DISTINCT FROM as_of::text),
  CONSTRAINT report_statement_snapshots_sequence_check CHECK (NOT body ->> 'ledgerBoundary'::text IS DISTINCT FROM sequence::text),
  CONSTRAINT report_statement_snapshots_sequence_bound_check CHECK (sequence >= 0),
  CONSTRAINT report_statement_snapshots_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id),
  CONSTRAINT report_statement_snapshots_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);

CREATE TABLE openerp.report_statement_rows (
  book_id text NOT NULL,
  snapshot_id text NOT NULL,
  ordinal integer NOT NULL,
  row_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT report_statement_rows_pkey PRIMARY KEY (book_id, snapshot_id, ordinal),
  CONSTRAINT report_statement_rows_row_key UNIQUE (book_id, snapshot_id, row_id),
  CONSTRAINT report_statement_rows_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT report_statement_rows_identity_check CHECK (NOT body ->> 'rowId'::text IS DISTINCT FROM row_id),
  CONSTRAINT report_statement_rows_ordinal_body_check CHECK (NOT (body ->> 'ordinal')::integer IS DISTINCT FROM ordinal),
  CONSTRAINT report_statement_rows_book_id_snapshot_id_fkey FOREIGN KEY (book_id, snapshot_id) REFERENCES openerp.report_statement_snapshots(book_id, id)
);

CREATE TABLE openerp.report_statement_contributions (
  book_id text NOT NULL,
  snapshot_id text NOT NULL,
  ordinal integer NOT NULL,
  row_id text NOT NULL,
  component_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT report_statement_contributions_pkey PRIMARY KEY (book_id, snapshot_id, ordinal),
  CONSTRAINT report_statement_contributions_row_key UNIQUE (book_id, snapshot_id, row_id, component_id),
  CONSTRAINT report_statement_contributions_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT report_statement_contributions_identity_check CHECK (NOT body ->> 'componentId'::text IS DISTINCT FROM component_id),
  CONSTRAINT report_statement_contributions_row_check CHECK (NOT body ->> 'rowId'::text IS DISTINCT FROM row_id),
  CONSTRAINT report_statement_contributions_book_id_snapshot_id_row_id_fkey FOREIGN KEY (book_id, snapshot_id, row_id) REFERENCES openerp.report_statement_rows(book_id, snapshot_id, row_id)
);

CREATE INDEX report_statement_snapshots_scope_id ON openerp.report_statement_snapshots (book_id, id);
CREATE INDEX report_statement_rows_scan ON openerp.report_statement_rows (book_id, snapshot_id, ordinal);
CREATE INDEX report_statement_contributions_row ON openerp.report_statement_contributions (book_id, snapshot_id, row_id, ordinal);

-- A sealed statement is history. Later activity creates a new snapshot; it never
-- rewrites the meaning of a captured one.
CREATE TRIGGER immutable_report_statement_snapshot
  BEFORE DELETE OR UPDATE ON openerp.report_statement_snapshots
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_report_statement_row
  BEFORE DELETE OR UPDATE ON openerp.report_statement_rows
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_report_statement_contribution
  BEFORE DELETE OR UPDATE ON openerp.report_statement_contributions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.report_statement_snapshots,
  openerp.report_statement_rows, openerp.report_statement_contributions TO openerp_runtime;
