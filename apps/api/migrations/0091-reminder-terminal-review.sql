CREATE TABLE openerp.reminder_refusals (
  book_id text NOT NULL,
  message_id text NOT NULL,
  body jsonb NOT NULL CHECK ((jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 262144
    AND body->'scope'->>'bookId' = book_id AND body->>'messageId' = message_id
    AND body->>'admission' = 'not_admitted'
    AND body->>'digest' = openerp.digest(body - 'digest')) IS TRUE),
  PRIMARY KEY (book_id, message_id),
  FOREIGN KEY (book_id, message_id) REFERENCES openerp.reminder_approvals(book_id, message_id)
);
CREATE TABLE openerp.reminder_resolutions (
  book_id text NOT NULL,
  message_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  replacement_message_id text,
  body jsonb NOT NULL CHECK ((jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 8192
    AND body->'scope'->>'bookId' = book_id AND body->>'messageId' = message_id
    AND body->>'actorId' = actor_id AND body->>'digest' = openerp.digest(body - 'digest')
    AND ((body->>'kind' = 'cancelled' AND replacement_message_id IS NULL)
      OR (body->>'kind' = 'replaced' AND replacement_message_id IS NOT NULL
        AND body->>'replacementMessageId' = replacement_message_id))) IS TRUE),
  PRIMARY KEY (book_id, message_id),
  UNIQUE (book_id, replacement_message_id),
  FOREIGN KEY (book_id, message_id) REFERENCES openerp.reminder_messages(book_id, id),
  FOREIGN KEY (book_id, replacement_message_id) REFERENCES openerp.reminder_messages(book_id, id),
  CHECK (replacement_message_id IS NULL OR replacement_message_id <> message_id)
);
CREATE TRIGGER immutable_reminder_refusal BEFORE UPDATE OR DELETE ON openerp.reminder_refusals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_reminder_resolution BEFORE UPDATE OR DELETE ON openerp.reminder_resolutions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE INDEX reminder_invoice_directory ON openerp.reminder_messages
  (book_id, (body->>'invoiceId'), id COLLATE "C");
GRANT SELECT, INSERT ON openerp.reminder_refusals, openerp.reminder_resolutions TO openerp_runtime;
