-- NEXT-18: incremental open-item FX remeasurement reviews and approvals.
--
-- A remeasurement review seals one valuation plan: the eligible population it
-- covered, the per-item target less current carrying, and the balanced journal
-- it would post. An approval authorizes exactly that sealed digest. Execution
-- re-checks the population, posts the journal through the shared posting path
-- and records the effect. Nothing here creates an item, a rate or a carrying;
-- those stay with the FX item, rate-revision and settlement owners.

CREATE TABLE openerp.commerce_fx_remeasurement_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_remeasurement_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_remeasurement_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_remeasurement_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);

CREATE TABLE openerp.commerce_fx_remeasurement_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_remeasurement_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_remeasurement_approvals_book_id_review_id_id_key UNIQUE (book_id, review_id, id),
  CONSTRAINT commerce_fx_remeasurement_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_remeasurement_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.commerce_fx_remeasurement_reviews(book_id, id)
);

-- One review per sealed plan digest. Re-preparing the identical population at
-- the identical cutoff is a replay of the same review, never a second one, so
-- two reviewers cannot hold two different beliefs about the same valuation.
CREATE UNIQUE INDEX commerce_fx_remeasurement_reviews_digest_key
  ON openerp.commerce_fx_remeasurement_reviews (book_id, (body->>'digest'));

CREATE TRIGGER immutable_commerce_fx_remeasurement_review
  BEFORE UPDATE OR DELETE ON openerp.commerce_fx_remeasurement_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_commerce_fx_remeasurement_approval
  BEFORE UPDATE OR DELETE ON openerp.commerce_fx_remeasurement_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role prepares reviews, records approvals and reads both. It
-- never updates or deletes a sealed review or approval.
GRANT SELECT, INSERT ON openerp.commerce_fx_remeasurement_reviews TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.commerce_fx_remeasurement_approvals TO openerp_runtime;
