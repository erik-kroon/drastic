ALTER TABLE openerp.workspace_assignments DROP CONSTRAINT workspace_assignments_kind_check;
ALTER TABLE openerp.workspace_assignments ADD CONSTRAINT workspace_assignments_kind_check CHECK (kind IN ('journal', 'invoice', 'expense', 'document', 'supplier'));
