-- NEXT-11: immutable complete-book SIE4E export capture, membership and artifact.
--
-- A complete-book export is a separate export purpose from the retained SIE4I
-- transaction transfer. The application owns the frozen selection, the raw
-- balance arithmetic, the record encoding and the independent semantic
-- comparison; these tables only hold the sealed header, the retained membership
-- and financial rows, and the verified object bytes with their manifest. There is
-- no function, no policy and no SIE calculation here.
--
-- Nothing in this file accepts a calculated effect from a caller. The runtime role
-- can append an export, its rows and one immutable verified artifact, and can
-- never rewrite or delete a sealed export.

CREATE TABLE openerp.sie_book_exports (
  book_id text NOT NULL,
  id text NOT NULL,
  ordinal bigint NOT NULL,
  fiscal_year_id text NOT NULL,
  as_of date NOT NULL,
  sequence bigint NOT NULL,
  evidence_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sie_book_exports_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT sie_book_exports_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT sie_book_exports_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT sie_book_exports_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT sie_book_exports_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT sie_book_exports_kind_check CHECK (body ->> 'kind'::text = 'complete_book_sie_v1'::text),
  CONSTRAINT sie_book_exports_fiscal_year_check CHECK (NOT body -> 'fiscalYear'::text ->> 'id'::text IS DISTINCT FROM fiscal_year_id),
  CONSTRAINT sie_book_exports_as_of_check CHECK (NOT body ->> 'asOf'::text IS DISTINCT FROM as_of::text),
  CONSTRAINT sie_book_exports_sequence_check CHECK (NOT body ->> 'ledgerBoundary'::text IS DISTINCT FROM sequence::text),
  CONSTRAINT sie_book_exports_sequence_bound_check CHECK (sequence >= 0),
  CONSTRAINT sie_book_exports_ordinal_bound_check CHECK (ordinal > 0),
  CONSTRAINT sie_book_exports_actor_check CHECK (NOT body ->> 'createdBy'::text IS DISTINCT FROM actor_id),
  CONSTRAINT sie_book_exports_format_check CHECK (body -> 'rendererRelease'::text ->> 'format'::text = 'SIE4E'::text),
  CONSTRAINT sie_book_exports_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id),
  CONSTRAINT sie_book_exports_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT sie_book_exports_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT sie_book_exports_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);

CREATE TABLE openerp.sie_book_export_rows (
  book_id text NOT NULL,
  export_id text NOT NULL,
  ordinal integer NOT NULL,
  row_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT sie_book_export_rows_pkey PRIMARY KEY (book_id, export_id, ordinal),
  CONSTRAINT sie_book_export_rows_row_key UNIQUE (book_id, export_id, row_id),
  CONSTRAINT sie_book_export_rows_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT sie_book_export_rows_identity_check CHECK (NOT body ->> 'rowId'::text IS DISTINCT FROM row_id),
  CONSTRAINT sie_book_export_rows_ordinal_body_check CHECK (NOT (body ->> 'ordinal')::integer IS DISTINCT FROM ordinal),
  CONSTRAINT sie_book_export_rows_kind_check CHECK (body ->> 'kind'::text = ANY (ARRAY['account'::text, 'balance'::text, 'line'::text])),
  CONSTRAINT sie_book_export_rows_body_check CHECK (octet_length(body::text) <= 65536),
  CONSTRAINT sie_book_export_rows_book_id_export_id_fkey FOREIGN KEY (book_id, export_id) REFERENCES openerp.sie_book_exports(book_id, id)
);

CREATE TABLE openerp.sie_book_export_artifacts (
  book_id text NOT NULL,
  export_id text NOT NULL,
  descriptor jsonb NOT NULL,
  content bytea NOT NULL,
  CONSTRAINT sie_book_export_artifacts_pkey PRIMARY KEY (book_id, export_id),
  CONSTRAINT sie_book_export_artifacts_identity_check CHECK (NOT descriptor ->> 'exportId'::text IS DISTINCT FROM export_id),
  CONSTRAINT sie_book_export_artifacts_scope_check CHECK (NOT descriptor -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT sie_book_export_artifacts_sha256_check CHECK (NOT descriptor ->> 'sha256'::text IS DISTINCT FROM encode(sha256(content), 'hex'::text)),
  CONSTRAINT sie_book_export_artifacts_length_check CHECK (NOT (descriptor ->> 'byteLength')::bigint IS DISTINCT FROM octet_length(content)::bigint),
  CONSTRAINT sie_book_export_artifacts_content_check CHECK (octet_length(content) >= 1 AND octet_length(content) <= 8388608),
  CONSTRAINT sie_book_export_artifacts_book_id_export_id_fkey FOREIGN KEY (book_id, export_id) REFERENCES openerp.sie_book_exports(book_id, id)
);

CREATE INDEX sie_book_exports_scope_id ON openerp.sie_book_exports (book_id, id);
CREATE INDEX sie_book_export_rows_scan ON openerp.sie_book_export_rows (book_id, export_id, ordinal);

-- A sealed export is history. Later activity creates a new export; it never
-- rewrites the meaning of a captured one, and a repeated download returns the
-- retained bytes rather than a newly rendered file.
CREATE TRIGGER immutable_sie_book_export
  BEFORE DELETE OR UPDATE ON openerp.sie_book_exports
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_book_export_row
  BEFORE DELETE OR UPDATE ON openerp.sie_book_export_rows
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_book_export_artifact
  BEFORE DELETE OR UPDATE ON openerp.sie_book_export_artifacts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.sie_book_exports,
  openerp.sie_book_export_rows, openerp.sie_book_export_artifacts TO openerp_runtime;
