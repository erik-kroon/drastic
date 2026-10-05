CREATE TABLE openerp.processor_review_returns (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  digest text NOT NULL,
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,review_id),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.processor_reviews(book_id,id),
  CHECK(body->>'id'=id AND body->>'reviewId'=review_id AND body->>'actorId'=actor_id AND body->>'digest'=digest)
);
CREATE TRIGGER immutable_processor_review_return BEFORE UPDATE OR DELETE ON openerp.processor_review_returns FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.processor_review_returns TO openerp_runtime;
