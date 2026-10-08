ALTER TABLE openerp.reminder_messages DROP CONSTRAINT reminder_messages_check;
ALTER TABLE openerp.reminder_messages ADD CONSTRAINT reminder_messages_body_check CHECK (
  jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 131072
  AND body->>'id' = id AND body->'scope'->>'bookId' = book_id
  AND body->>'digest' = openerp.digest(body - 'digest')
  AND body->>'provider' = 'local-fixture-v1'
  AND jsonb_typeof(body->'attachments') = 'array' AND jsonb_array_length(body->'attachments') <= 1
  AND body->>'feeMinor' = '0' AND body->>'interestMinor' = '0'
);
