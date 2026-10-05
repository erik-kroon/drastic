CREATE TABLE openerp.sie_source_year_partitions (
  book_id text NOT NULL,
  id text NOT NULL,
  preview_id text NOT NULL,
  source_plan_id text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,preview_id),
  FOREIGN KEY (book_id,preview_id) REFERENCES openerp.sie_source_previews(book_id,id),
  FOREIGN KEY (book_id,source_plan_id) REFERENCES openerp.sie_source_plans(book_id,id),
  CHECK (body->>'id'=id AND body->>'digest'=digest)
);
CREATE TRIGGER immutable_sie_source_year_partition BEFORE UPDATE OR DELETE ON openerp.sie_source_year_partitions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
ALTER TABLE openerp.sie_financial_runs ADD COLUMN partition_id text;
ALTER TABLE openerp.sie_financial_runs ADD CONSTRAINT sie_financial_partition_fkey FOREIGN KEY(book_id,partition_id) REFERENCES openerp.sie_source_year_partitions(book_id,id);
ALTER TABLE openerp.sie_financial_runs ADD COLUMN year_ordinal integer NOT NULL DEFAULT 0 CHECK(year_ordinal>=0);
CREATE TABLE openerp.sie_financial_year_comparisons (
  book_id text NOT NULL,
  run_id text NOT NULL,
  year_ordinal integer NOT NULL CHECK(year_ordinal>=0),
  fiscal_year_id text NOT NULL,
  book_sequence bigint NOT NULL,
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
  PRIMARY KEY(book_id,run_id,year_ordinal),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.sie_financial_runs(book_id,id),
  FOREIGN KEY(book_id,fiscal_year_id) REFERENCES openerp.fiscal_years(book_id,id)
);
CREATE TRIGGER immutable_sie_financial_year_comparison BEFORE UPDATE OR DELETE ON openerp.sie_financial_year_comparisons FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.sie_source_year_partitions,openerp.sie_financial_year_comparisons TO openerp_runtime;
GRANT UPDATE(fiscal_year_id,year_ordinal) ON openerp.sie_financial_runs TO openerp_runtime;
