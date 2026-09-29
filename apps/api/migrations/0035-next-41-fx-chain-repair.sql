-- NEXT-41: late FX valuation and consumed-chain correction reviews.
--
-- A chain repair replays one item's frozen facts with a corrected rate: prior
-- valuations and settlements are read as history, never rewritten, and the
-- resulting per-date attribution delta posts as a correction journal. A repair
-- review seals the basis, the corrected rate and the computed deltas; an
-- approval authorizes exactly that sealed digest.

CREATE TABLE openerp.commerce_fx_chain_repair_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_chain_repair_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_chain_repair_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_chain_repair_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);

CREATE TABLE openerp.commerce_fx_chain_repair_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_chain_repair_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_chain_repair_approvals_book_id_review_id_id_key UNIQUE (book_id, review_id, id),
  CONSTRAINT commerce_fx_chain_repair_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_chain_repair_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.commerce_fx_chain_repair_reviews(book_id, id)
);

-- One review per sealed repair key. Replaying the identical correction is a
-- replay of the same review, never a second gain.
CREATE UNIQUE INDEX commerce_fx_chain_repair_reviews_key
  ON openerp.commerce_fx_chain_repair_reviews (book_id, (body->>'repairKey'));

CREATE TRIGGER immutable_commerce_fx_chain_repair_review
  BEFORE UPDATE OR DELETE ON openerp.commerce_fx_chain_repair_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_commerce_fx_chain_repair_approval
  BEFORE UPDATE OR DELETE ON openerp.commerce_fx_chain_repair_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON openerp.commerce_fx_chain_repair_reviews TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.commerce_fx_chain_repair_approvals TO openerp_runtime;
