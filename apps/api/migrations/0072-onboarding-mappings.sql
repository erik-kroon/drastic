CREATE TABLE openerp.onboarding_account_mappings (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  source_system text NOT NULL,
  source_account_id text NOT NULL,
  source_account text NOT NULL,
  account_id text NOT NULL,
  revision integer NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,source_system,source_account_id,source_account,revision),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id
    AND body->>'sourceSystem'=source_system AND body->>'sourceAccountId'=source_account_id
    AND body->>'sourceAccount'=source_account AND body->>'accountId'=account_id AND (body->>'revision')::integer=revision) IS TRUE),
  FOREIGN KEY(book_id,account_id) REFERENCES openerp.accounts(book_id,id)
);
CREATE TRIGGER immutable_onboarding_mapping BEFORE UPDATE OR DELETE ON openerp.onboarding_account_mappings
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.onboarding_account_mappings TO openerp_runtime;
