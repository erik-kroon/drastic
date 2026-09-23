-- Use an unambiguous local record reference when reading the latest handoff.
CREATE OR REPLACE FUNCTION openerp.workspace_assign_work(token text, scope jsonb, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; result jsonb; current_revision integer; saved openerp.workspace_assignments; a_kind text; a_record_id text;
BEGIN
  actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  result:=openerp.replay(scope->>'bookId',key,actor,'workspace_assign_work',payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR
    EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('kind','recordId','assigneeId','dueOn','note','expectedRevision')) OR
    jsonb_typeof(payload->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'recordId') IS DISTINCT FROM 'string' OR
    jsonb_typeof(payload->'note') IS DISTINCT FROM 'string' OR length(payload->>'note')>2000 OR
    jsonb_typeof(payload->'expectedRevision') IS DISTINCT FROM 'number' OR (payload->>'expectedRevision') !~ '^[0-9]{1,9}$' OR
    coalesce(jsonb_typeof(payload->'assigneeId'),'missing') NOT IN ('string','null') OR
    coalesce(jsonb_typeof(payload->'dueOn'),'missing') NOT IN ('string','null') THEN
    PERFORM openerp.fail('InvalidJournal','Supply valid handoff details and the current revision.'); END IF;
  a_kind:=payload->>'kind'; a_record_id:=payload->>'recordId';
  IF NOT ((a_kind='journal' AND openerp.posting_recovery_standalone(scope->>'bookId',a_record_id)) OR
    (a_kind='invoice' AND EXISTS(SELECT FROM openerp.invoice_drafts d WHERE d.book_id=scope->>'bookId' AND d.id=a_record_id)) OR
    (a_kind='expense' AND EXISTS(SELECT FROM openerp.expense_tax_sources s WHERE s.book_id=scope->>'bookId' AND s.id=a_record_id))) THEN
    PERFORM openerp.fail('NotFound','This work item does not belong to this book.'); END IF;
  IF payload->>'assigneeId' IS NOT NULL THEN
    PERFORM 1 FROM openerp.memberships m WHERE m.book_id=scope->>'bookId' AND m.actor_id=payload->>'assigneeId' FOR SHARE;
    IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Choose a current member of this book.'); END IF;
  END IF;
  IF payload->>'dueOn' IS NOT NULL THEN
    IF payload->>'dueOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      PERFORM openerp.fail('InvalidJournal','Supply a valid due date.'); END IF;
    BEGIN PERFORM (payload->>'dueOn')::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      PERFORM openerp.fail('InvalidJournal','Supply a valid due date.'); END;
  END IF;
  SELECT coalesce(max(a.revision),0) INTO current_revision FROM openerp.workspace_assignments a
    WHERE a.book_id=scope->>'bookId' AND a.kind=a_kind AND a.record_id=a_record_id;
  IF current_revision<>(payload->>'expectedRevision')::integer THEN
    PERFORM openerp.fail('StaleDependency','This handoff changed. Close it and refresh the work list before editing again.'); END IF;
  INSERT INTO openerp.workspace_assignments VALUES(scope->>'bookId',a_kind,a_record_id,current_revision+1,
    payload->>'assigneeId',(payload->>'dueOn')::date,payload->>'note',clock_timestamp(),actor) RETURNING * INTO saved;
  result:=jsonb_build_object('scope',scope,'assignment',openerp.workspace_assignment_json(saved));
  RETURN openerp.save_command(scope->>'bookId',key,actor,'workspace_assign_work',payload,result);
END $$;
