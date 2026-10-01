CREATE TABLE openerp.evaluation_contracts (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  predecessor_id text,
  predecessor_digest text,
  created_by text NOT NULL REFERENCES openerp.actors(id),
  created_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, id, digest),
  UNIQUE (book_id, predecessor_id),
  FOREIGN KEY (book_id, predecessor_id, predecessor_digest)
    REFERENCES openerp.evaluation_contracts(book_id, id, digest),
  CHECK ((predecessor_id IS NULL) = (predecessor_digest IS NULL)),
  CHECK (digest = openerp.digest(body - 'digest')),
  CHECK ((body->>'id' = id AND body->>'digest' = digest
    AND body->'scope'->>'bookId' = book_id AND body->>'createdBy' = created_by
    AND (body->>'createdAt')::timestamptz = created_at) IS TRUE),
  CHECK ((body->>'state' = 'contract_only' AND body->>'wholeYearComplete' = 'false') IS TRUE),
  CHECK (((predecessor_id IS NULL AND body->'predecessor' = 'null'::jsonb)
    OR (body->'predecessor'->>'id' = predecessor_id
      AND body->'predecessor'->>'digest' = predecessor_digest)) IS TRUE)
);
CREATE TRIGGER immutable_evaluation_contract BEFORE UPDATE OR DELETE
  ON openerp.evaluation_contracts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.evaluation_contracts TO openerp_runtime;
