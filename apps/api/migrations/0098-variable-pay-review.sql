CREATE TABLE openerp.payroll_input_assessments (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  input_id text GENERATED ALWAYS AS (body->>'inputId') STORED NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_payroll_input_assessments BEFORE UPDATE OR DELETE ON openerp.payroll_input_assessments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_input_assessments TO openerp_runtime;

CREATE TABLE openerp.payroll_input_pending_selections (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  input_id text GENERATED ALWAYS AS (body->>'inputId') STORED NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  assessment_id text GENERATED ALWAYS AS (body->>'assessmentId') STORED NOT NULL,
  FOREIGN KEY(book_id,assessment_id) REFERENCES openerp.payroll_input_assessments(book_id,id),
  UNIQUE(book_id,assessment_id),
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_payroll_input_pending_selections BEFORE UPDATE OR DELETE ON openerp.payroll_input_pending_selections FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_input_pending_selections TO openerp_runtime;

CREATE TABLE openerp.payroll_input_dispositions (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  input_id text GENERATED ALWAYS AS (body->>'inputId') STORED NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  assessment_id text GENERATED ALWAYS AS (body->>'assessmentId') STORED NOT NULL,
  selection_id text GENERATED ALWAYS AS (body->>'selectionId') STORED NOT NULL,
  FOREIGN KEY(book_id,assessment_id) REFERENCES openerp.payroll_input_assessments(book_id,id),
  FOREIGN KEY(book_id,selection_id) REFERENCES openerp.payroll_input_pending_selections(book_id,id),
  UNIQUE(book_id,selection_id),
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_payroll_input_dispositions BEFORE UPDATE OR DELETE ON openerp.payroll_input_dispositions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_input_dispositions TO openerp_runtime;

ALTER TABLE openerp.payroll_input_assessments ADD UNIQUE(book_id,id,input_id,digest);
ALTER TABLE openerp.payroll_input_pending_selections ADD COLUMN assessment_digest text GENERATED ALWAYS AS (body->>'assessmentDigest') STORED NOT NULL;
ALTER TABLE openerp.payroll_input_pending_selections ADD FOREIGN KEY(book_id,assessment_id,input_id,assessment_digest) REFERENCES openerp.payroll_input_assessments(book_id,id,input_id,digest);
ALTER TABLE openerp.payroll_input_pending_selections ADD UNIQUE(book_id,id,input_id,assessment_id,assessment_digest);
ALTER TABLE openerp.payroll_input_dispositions ADD COLUMN assessment_digest text GENERATED ALWAYS AS (body->>'assessmentDigest') STORED NOT NULL;
ALTER TABLE openerp.payroll_input_dispositions ADD FOREIGN KEY(book_id,selection_id,input_id,assessment_id,assessment_digest) REFERENCES openerp.payroll_input_pending_selections(book_id,id,input_id,assessment_id,assessment_digest);

ALTER TABLE openerp.payroll_inputs ADD UNIQUE(book_id,id,digest);
ALTER TABLE openerp.payroll_input_assessments ADD COLUMN input_digest text GENERATED ALWAYS AS (body->>'inputDigest') STORED NOT NULL;
ALTER TABLE openerp.payroll_input_assessments ADD FOREIGN KEY(book_id,input_id,input_digest) REFERENCES openerp.payroll_inputs(book_id,id,digest);
ALTER TABLE openerp.payroll_input_assessments ADD UNIQUE(book_id,id,input_id,input_digest,digest);
ALTER TABLE openerp.payroll_input_pending_selections ADD COLUMN input_digest text GENERATED ALWAYS AS (body->>'inputDigest') STORED NOT NULL;
ALTER TABLE openerp.payroll_input_pending_selections ADD FOREIGN KEY(book_id,input_id,input_digest) REFERENCES openerp.payroll_inputs(book_id,id,digest);
ALTER TABLE openerp.payroll_input_pending_selections ADD FOREIGN KEY(book_id,assessment_id,input_id,input_digest,assessment_digest) REFERENCES openerp.payroll_input_assessments(book_id,id,input_id,input_digest,digest);
ALTER TABLE openerp.payroll_input_pending_selections ADD UNIQUE(book_id,id,input_id,input_digest,assessment_id,assessment_digest);
ALTER TABLE openerp.payroll_input_dispositions ADD COLUMN input_digest text GENERATED ALWAYS AS (body->>'inputDigest') STORED NOT NULL;
ALTER TABLE openerp.payroll_input_dispositions ADD FOREIGN KEY(book_id,input_id,input_digest) REFERENCES openerp.payroll_inputs(book_id,id,digest);
ALTER TABLE openerp.payroll_input_dispositions ADD FOREIGN KEY(book_id,selection_id,input_id,input_digest,assessment_id,assessment_digest) REFERENCES openerp.payroll_input_pending_selections(book_id,id,input_id,input_digest,assessment_id,assessment_digest);
