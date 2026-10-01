CREATE TABLE openerp.agent_context_captures (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  body jsonb NOT NULL,
  inventory jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,id,actor_id),
  CHECK ((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'actorId'=actor_id) IS TRUE)
);
CREATE TABLE openerp.agent_context_progress (
  book_id text NOT NULL,
  capture_id text NOT NULL,
  actor_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision>0),
  position bigint NOT NULL CHECK (position>=0),
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,capture_id,revision),
  FOREIGN KEY (book_id,capture_id,actor_id) REFERENCES openerp.agent_context_captures(book_id,id,actor_id),
  CHECK ((body->>'captureId'=capture_id AND (body->>'revision')::bigint=revision AND (body->>'position')::bigint=position) IS TRUE)
);
CREATE TRIGGER immutable_agent_context_capture BEFORE UPDATE OR DELETE ON openerp.agent_context_captures
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_agent_context_progress BEFORE UPDATE OR DELETE ON openerp.agent_context_progress
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.agent_context_captures,openerp.agent_context_progress TO openerp_runtime;
