CREATE TABLE openerp.crm_customer_recipients (
  book_id text NOT NULL,
  party_id text NOT NULL,
  current_revision bigint NOT NULL CHECK (current_revision BETWEEN 1 AND 1000),
  PRIMARY KEY (book_id, party_id),
  FOREIGN KEY (book_id, party_id) REFERENCES openerp.commerce_counterparties(book_id, id)
);

CREATE TABLE openerp.crm_customer_recipients_revisions (
  book_id text NOT NULL,
  party_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 1000),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 16384
    AND body ?& ARRAY['scope', 'partyId', 'revision', 'digest', 'reviewEvidence', 'recordedBy', 'recordedAt', 'reason']
    AND jsonb_typeof(body->'scope') = 'object' AND body->>'recordedBy' = recorded_by
    AND body->>'partyId' = party_id AND body->>'revision' = revision::text
    AND body->'scope'->>'bookId' = book_id),
  recorded_by text NOT NULL REFERENCES openerp.actors(id),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (book_id, party_id, revision),
  FOREIGN KEY (book_id, party_id) REFERENCES openerp.crm_customer_recipients(book_id, party_id)
);

ALTER TABLE openerp.crm_customer_recipients ADD FOREIGN KEY (book_id, party_id, current_revision)
  REFERENCES openerp.crm_customer_recipients_revisions(book_id, party_id, revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER immutable_crm_customer_recipients_revision BEFORE UPDATE OR DELETE ON openerp.crm_customer_recipients_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.crm_customer_recipients, openerp.crm_customer_recipients_revisions TO openerp_runtime;
GRANT UPDATE(current_revision) ON openerp.crm_customer_recipients TO openerp_runtime;

CREATE TABLE openerp.crm_customer_invoice_defaults (
  book_id text NOT NULL,
  party_id text NOT NULL,
  current_revision bigint NOT NULL CHECK (current_revision BETWEEN 1 AND 1000),
  PRIMARY KEY (book_id, party_id),
  FOREIGN KEY (book_id, party_id) REFERENCES openerp.commerce_counterparties(book_id, id)
);

CREATE TABLE openerp.crm_customer_invoice_defaults_revisions (
  book_id text NOT NULL,
  party_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 1000),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 16384
    AND body ?& ARRAY['scope', 'partyId', 'revision', 'digest', 'reviewEvidence', 'recordedBy', 'recordedAt', 'reason']
    AND jsonb_typeof(body->'scope') = 'object' AND body->>'recordedBy' = recorded_by
    AND body->>'partyId' = party_id AND body->>'revision' = revision::text
    AND body->'scope'->>'bookId' = book_id),
  recorded_by text NOT NULL REFERENCES openerp.actors(id),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (book_id, party_id, revision),
  FOREIGN KEY (book_id, party_id) REFERENCES openerp.crm_customer_invoice_defaults(book_id, party_id)
);

ALTER TABLE openerp.crm_customer_invoice_defaults ADD FOREIGN KEY (book_id, party_id, current_revision)
  REFERENCES openerp.crm_customer_invoice_defaults_revisions(book_id, party_id, revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER immutable_crm_customer_invoice_defaults_revision BEFORE UPDATE OR DELETE ON openerp.crm_customer_invoice_defaults_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.crm_customer_invoice_defaults, openerp.crm_customer_invoice_defaults_revisions TO openerp_runtime;
GRANT UPDATE(current_revision) ON openerp.crm_customer_invoice_defaults TO openerp_runtime;
