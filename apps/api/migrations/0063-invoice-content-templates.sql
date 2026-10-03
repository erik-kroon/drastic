CREATE TABLE openerp.invoice_templates (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  current_revision bigint NOT NULL CHECK (current_revision BETWEEN 1 AND 1000),
  PRIMARY KEY (book_id,id)
);
CREATE TABLE openerp.invoice_template_revisions (
  book_id text NOT NULL,
  template_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 1000),
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,template_id,revision),
  FOREIGN KEY (book_id,template_id) REFERENCES openerp.invoice_templates(book_id,id),
  CHECK (octet_length(body::text) <= 131072),
  CHECK ((body->>'id'=template_id AND body->'scope'->>'bookId'=book_id
    AND body->>'revision'=revision::text AND body->>'status' IN ('active','archived')
    AND jsonb_typeof(body->'content')='object' AND body->>'digest' IS NOT NULL) IS TRUE)
);
ALTER TABLE openerp.invoice_templates ADD CONSTRAINT invoice_template_current_revision_fkey
  FOREIGN KEY (book_id,id,current_revision) REFERENCES openerp.invoice_template_revisions(book_id,template_id,revision)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER immutable_invoice_template_revision BEFORE UPDATE OR DELETE ON openerp.invoice_template_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.invoice_templates,openerp.invoice_template_revisions TO openerp_runtime;
GRANT UPDATE (current_revision) ON openerp.invoice_templates TO openerp_runtime;
