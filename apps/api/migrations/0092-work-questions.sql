CREATE TABLE openerp.workspace_questions (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  root_key text NOT NULL,
  occurrence_id text,
  supplier_draft_id text,
  statement_id text,
  row_ordinal integer,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  PRIMARY KEY (book_id, id),
  FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id),
  FOREIGN KEY (book_id, supplier_draft_id) REFERENCES openerp.supplier_invoice_drafts(book_id, id),
  FOREIGN KEY (book_id, statement_id, row_ordinal) REFERENCES openerp.bank_observations(book_id, statement_id, row_ordinal),
  CHECK (body->>'id' = id AND body#>>'{root,key}' = root_key),
  CHECK (
    (occurrence_id IS NOT NULL AND supplier_draft_id IS NULL AND statement_id IS NULL AND row_ordinal IS NULL AND body#>>'{root,kind}' = 'document' AND body#>>'{root,recordId}' = occurrence_id)
    OR (supplier_draft_id IS NOT NULL AND occurrence_id IS NULL AND statement_id IS NULL AND row_ordinal IS NULL AND body#>>'{root,kind}' = 'supplier' AND body#>>'{root,recordId}' = supplier_draft_id)
    OR (statement_id IS NOT NULL AND row_ordinal IS NOT NULL AND occurrence_id IS NULL AND supplier_draft_id IS NULL AND body#>>'{root,kind}' = 'bank' AND body#>>'{root,recordId}' = statement_id AND (body#>>'{root,rowOrdinal}')::integer = row_ordinal)
  )
);
CREATE INDEX workspace_questions_root ON openerp.workspace_questions(book_id, root_key);

CREATE TABLE openerp.workspace_question_revisions (
  book_id text NOT NULL,
  question_id text NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 50),
  state text NOT NULL CHECK (state IN ('open', 'answered', 'closed')),
  waiting_on text REFERENCES openerp.actors(id),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  PRIMARY KEY (book_id, question_id, revision),
  FOREIGN KEY (book_id, question_id) REFERENCES openerp.workspace_questions(book_id, id),
  CHECK ((body->>'revision')::integer = revision)
);

CREATE UNIQUE INDEX intake_occurrences_question_hash ON openerp.intake_occurrences(book_id, id, sha256);
CREATE TABLE openerp.workspace_question_attachments (
  book_id text NOT NULL,
  question_id text NOT NULL,
  revision integer NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
  occurrence_id text NOT NULL,
  sha256 text NOT NULL,
  PRIMARY KEY (book_id, question_id, revision, ordinal),
  FOREIGN KEY (book_id, question_id, revision) REFERENCES openerp.workspace_question_revisions(book_id, question_id, revision),
  FOREIGN KEY (book_id, occurrence_id, sha256) REFERENCES openerp.intake_occurrences(book_id, id, sha256)
);

CREATE TRIGGER immutable_workspace_question BEFORE UPDATE OR DELETE ON openerp.workspace_questions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_workspace_question_revision BEFORE UPDATE OR DELETE ON openerp.workspace_question_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_workspace_question_attachment BEFORE UPDATE OR DELETE ON openerp.workspace_question_attachments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.workspace_questions, openerp.workspace_question_revisions, openerp.workspace_question_attachments TO openerp_runtime;
