CREATE TABLE openerp.recurring_invoice_draft_schedules (
  book_id text NOT NULL,
  agreement_id text NOT NULL,
  enabled boolean NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  first_automatic_cycle bigint NOT NULL CHECK (first_automatic_cycle >= 0),
  next_cycle_ordinal bigint NOT NULL CHECK (next_cycle_ordinal >= first_automatic_cycle),
  requested_by text NOT NULL REFERENCES openerp.actors(id),
  time_zone text NOT NULL,
  due_policy text NOT NULL CHECK (due_policy = 'local_calendar_date_v1'),
  changed_at timestamptz NOT NULL,
  PRIMARY KEY (book_id, agreement_id),
  FOREIGN KEY (book_id, agreement_id) REFERENCES openerp.recurring_invoice_agreements(book_id, id)
);
CREATE TABLE openerp.recurring_invoice_draft_schedule_events (
  book_id text NOT NULL,
  agreement_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  body jsonb NOT NULL,
  PRIMARY KEY (book_id, agreement_id, generation),
  FOREIGN KEY (book_id, agreement_id) REFERENCES openerp.recurring_invoice_draft_schedules(book_id, agreement_id)
);
CREATE TRIGGER immutable_recurring_draft_schedule_event BEFORE UPDATE OR DELETE ON openerp.recurring_invoice_draft_schedule_events
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TABLE openerp.recurring_invoice_draft_jobs (
  book_id text NOT NULL,
  id text NOT NULL,
  agreement_id text NOT NULL,
  cycle_ordinal bigint NOT NULL CHECK (cycle_ordinal >= 0),
  generation bigint NOT NULL CHECK (generation > 0),
  schedule_generation bigint NOT NULL CHECK (schedule_generation > 0),
  requested_by text NOT NULL REFERENCES openerp.actors(id),
  executor_id text NOT NULL REFERENCES openerp.actors(id),
  admitted jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('ready', 'drafted', 'skipped', 'existing', 'failed')),
  reason text,
  draft_id text,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL,
  settled_at timestamptz,
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, agreement_id, cycle_ordinal, generation),
  FOREIGN KEY (book_id, agreement_id) REFERENCES openerp.recurring_invoice_draft_schedules(book_id, agreement_id),
  FOREIGN KEY (book_id, draft_id) REFERENCES openerp.invoice_drafts(book_id, id),
  CHECK ((state IN ('drafted', 'existing')) = (draft_id IS NOT NULL))
);
CREATE INDEX recurring_invoice_draft_jobs_ready ON openerp.recurring_invoice_draft_jobs(book_id, executor_id, id) WHERE state = 'ready';
CREATE INDEX recurring_invoice_draft_schedule_scan ON openerp.recurring_invoice_draft_schedules(book_id, agreement_id);
GRANT SELECT, INSERT ON openerp.recurring_invoice_draft_schedules, openerp.recurring_invoice_draft_schedule_events, openerp.recurring_invoice_draft_jobs TO openerp_runtime;
GRANT UPDATE (enabled, generation, next_cycle_ordinal, requested_by, changed_at) ON openerp.recurring_invoice_draft_schedules TO openerp_runtime;
GRANT UPDATE (state, reason, draft_id, dispatched_at, settled_at) ON openerp.recurring_invoice_draft_jobs TO openerp_runtime;

ALTER TABLE openerp.workspace_assignments DROP CONSTRAINT workspace_assignments_kind_check;
ALTER TABLE openerp.workspace_assignments ADD CONSTRAINT workspace_assignments_kind_check
  CHECK (kind IN ('journal', 'invoice', 'expense', 'document', 'supplier', 'recurring'));
