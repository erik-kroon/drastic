CREATE TABLE openerp.historical_pool_revisions (
  book_id text NOT NULL,
  id text NOT NULL,
  pool_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal > 0),
  admission_id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,pool_id,ordinal),
  UNIQUE(book_id,pool_id,admission_id),
  FOREIGN KEY(book_id,pool_id) REFERENCES openerp.historical_control_pools(book_id,id),
  FOREIGN KEY(book_id,admission_id) REFERENCES openerp.historical_item_admissions(book_id,id),
  CHECK(body->>'id'=id AND body->>'poolId'=pool_id AND body->>'digest'=digest)
);
CREATE TRIGGER immutable_historical_pool_revision BEFORE UPDATE OR DELETE ON openerp.historical_pool_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.historical_pool_revisions TO openerp_runtime;
