CREATE TABLE openerp.cash_forecasts (
  book_id text NOT NULL,
  id text NOT NULL,
  basis_id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,basis_id) REFERENCES openerp.cash_bases(book_id,id),
  CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'basisId'=basis_id) IS TRUE),
  CHECK (body=content::jsonb AND byte_length=octet_length(content)),
  CHECK (sha256=encode(sha256(convert_to(content,'UTF8')),'hex')),
  CHECK ((body->>'digest'=openerp.digest(body-'digest')) IS TRUE)
);
CREATE TRIGGER immutable_cash_forecast BEFORE UPDATE OR DELETE ON openerp.cash_forecasts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.cash_forecasts TO openerp_runtime;
