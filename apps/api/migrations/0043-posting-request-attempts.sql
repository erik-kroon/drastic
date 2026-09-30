-- DF-04: referenced-state refusals do not consume the saved command identity.
-- Old outcomes stay immutable. New runs append observations and retain the
-- same saved body/kernel key, so later success never rewrites a prior refusal.
CREATE TABLE openerp.posting_request_attempts (
  book_id text NOT NULL,
  key text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  state text NOT NULL CHECK (state IN ('committed', 'refused')),
  result jsonb,
  refusal jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, key, attempt),
  FOREIGN KEY (book_id, key) REFERENCES openerp.posting_saved_requests(book_id, key),
  CHECK ((state = 'committed' AND result IS NOT NULL AND refusal IS NULL)
      OR (state = 'refused' AND result IS NULL AND refusal IS NOT NULL))
);

CREATE UNIQUE INDEX posting_request_one_commit
  ON openerp.posting_request_attempts(book_id, key) WHERE state = 'committed';

CREATE TRIGGER posting_request_attempt_immutable
  BEFORE UPDATE OR DELETE ON openerp.posting_request_attempts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON openerp.posting_request_attempts TO openerp_runtime;
