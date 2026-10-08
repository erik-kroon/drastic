ALTER TABLE openerp.reminder_outbox DROP CONSTRAINT reminder_outbox_state_check;
ALTER TABLE openerp.reminder_outbox ADD CONSTRAINT reminder_outbox_state_check
  CHECK (state IN ('awaiting_dispatch','approved','admitted','reconciling','provider_accepted','delivered','outcome_unknown','failed','cancelled','refused'));
UPDATE openerp.reminder_outbox o SET state = 'awaiting_dispatch',
  reason = 'Explicit dispatch required after approval.', checked_at = clock_timestamp()
WHERE o.state = 'approved' AND NOT EXISTS (
  SELECT FROM openerp.reminder_attempts a WHERE a.book_id = o.book_id AND a.message_id = o.message_id
);
