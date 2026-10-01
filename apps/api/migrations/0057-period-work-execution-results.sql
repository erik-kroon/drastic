CREATE TABLE openerp.period_work_execution_results (
  book_id text NOT NULL,
  batch_id text NOT NULL,
  command_key text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,command_key),
  FOREIGN KEY (book_id,batch_id) REFERENCES openerp.period_work_batches(book_id,id),
  FOREIGN KEY (book_id,command_key) REFERENCES openerp.command_receipts(book_id,key),
  CHECK ((body->>'batchId'=batch_id) IS TRUE)
);
CREATE TRIGGER immutable_period_work_execution_result BEFORE UPDATE OR DELETE
  ON openerp.period_work_execution_results FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.period_work_execution_results TO openerp_runtime;
