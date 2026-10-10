CREATE TABLE openerp.close_predicate_captures (
 book_id text NOT NULL REFERENCES openerp.books(id),
 id text NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 period_id text NOT NULL,
 command_key text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors(id),
 digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
 body jsonb NOT NULL,
 PRIMARY KEY (book_id,id),
 UNIQUE (book_id,command_key),
 FOREIGN KEY (book_id,period_id) REFERENCES openerp.periods(book_id,id),
 CHECK (body->>'id'=id AND body->>'digest'=digest AND body#>>'{scope,bookId}'=book_id AND body#>>'{period,id}'=period_id)
);
CREATE INDEX close_predicate_month ON openerp.close_predicate_captures(book_id,period_id,ordinal DESC);
CREATE TRIGGER immutable_close_predicate BEFORE DELETE OR UPDATE ON openerp.close_predicate_captures FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.close_predicate_captures TO openerp_runtime;
GRANT USAGE,SELECT ON SEQUENCE openerp.close_predicate_captures_ordinal_seq TO openerp_runtime;
