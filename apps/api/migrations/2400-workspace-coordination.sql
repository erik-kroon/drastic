-- Coordination records describe human work. They never approve or execute accounting.
CREATE TABLE openerp.workspace_views (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  owner_id text NOT NULL REFERENCES openerp.actors(id),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
  visibility text NOT NULL CHECK(visibility IN ('personal','team')),
  filters jsonb NOT NULL CHECK(jsonb_typeof(filters)='object'),
  PRIMARY KEY(book_id,id)
);
CREATE TABLE openerp.workspace_assignments (
  book_id text NOT NULL REFERENCES openerp.books(id),
  kind text NOT NULL CHECK(kind IN ('journal','invoice','expense')),
  record_id text NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  assignee_id text REFERENCES openerp.actors(id),
  due_on date,
  note text NOT NULL CHECK(length(note)<=2000),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL REFERENCES openerp.actors(id),
  PRIMARY KEY(book_id,kind,record_id,revision)
);
REVOKE ALL ON openerp.workspace_views,openerp.workspace_assignments FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.workspace_assignment_json(a openerp.workspace_assignments) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
  SELECT jsonb_build_object('kind',a.kind,'recordId',a.record_id,'assigneeId',a.assignee_id,
    'dueOn',a.due_on::text,'note',a.note,'revision',a.revision,
    'updatedAt',to_char(a.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updatedBy',a.updated_by)
$$;

CREATE FUNCTION openerp.workspace_coordination(token text, scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; members jsonb; views jsonb;
BEGIN
  actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR SHARE;
  IF (SELECT count(*) FROM openerp.memberships WHERE book_id=scope->>'bookId')>200 THEN
    PERFORM openerp.fail('Unavailable','This book exceeds the supported team size of 200 members.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'role',m.role) ORDER BY a.name,a.id),'[]') INTO members
    FROM openerp.memberships m JOIN openerp.actors a ON a.id=m.actor_id WHERE m.book_id=scope->>'bookId';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'ownerId',v.owner_id,'name',v.name,'visibility',v.visibility,'filters',v.filters) ORDER BY v.name,v.id),'[]') INTO views
    FROM openerp.workspace_views v WHERE v.book_id=scope->>'bookId' AND (v.owner_id=actor OR v.visibility='team');
  RETURN jsonb_build_object('scope',scope,'actorId',actor,'members',members,'views',views);
END $$;

CREATE FUNCTION openerp.workspace_save_view(token text, scope jsonb, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; result jsonb; view_id text; visibility text;
BEGIN
  actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  result:=openerp.replay(scope->>'bookId',key,actor,'workspace_save_view',payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  visibility:=payload->>'visibility';
  IF jsonb_typeof(payload)<>'object' OR payload IS NULL OR
    EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('name','visibility','filters')) OR
    jsonb_typeof(payload->'name') IS DISTINCT FROM 'string' OR length(btrim(payload->>'name')) NOT BETWEEN 1 AND 80 OR
    visibility IS NULL OR visibility NOT IN ('personal','team') OR payload->'filters' IS NULL OR payload->'filters' ? 'after' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a name, visibility and valid work filters.'); END IF;
  IF visibility='team' THEN PERFORM openerp.authorize(token,scope,true); END IF;
  PERFORM openerp.workspace_attention(token,scope,payload->'filters');
  IF (SELECT count(*) FROM openerp.workspace_views v WHERE v.book_id=scope->>'bookId' AND
    ((visibility='team' AND v.visibility='team') OR (visibility='personal' AND v.visibility='personal' AND v.owner_id=actor)))>=50 THEN
    PERFORM openerp.fail('InvalidJournal','Remove a saved view before adding another. The limit is 50 personal and 50 shared views.'); END IF;
  view_id:='view_'||replace(gen_random_uuid()::text,'-','');
  INSERT INTO openerp.workspace_views VALUES(scope->>'bookId',view_id,actor,btrim(payload->>'name'),visibility,payload->'filters');
  result:=jsonb_build_object('scope',scope,'view',jsonb_build_object('id',view_id,'ownerId',actor,'name',btrim(payload->>'name'),'visibility',visibility,'filters',payload->'filters'));
  RETURN openerp.save_command(scope->>'bookId',key,actor,'workspace_save_view',payload,result);
END $$;

CREATE FUNCTION openerp.workspace_delete_view(token text, scope jsonb, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; result jsonb; target openerp.workspace_views;
BEGIN
  actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  result:=openerp.replay(scope->>'bookId',key,actor,'workspace_delete_view',payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR
    EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k<>'id') OR jsonb_typeof(payload->'id') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Choose a saved view.'); END IF;
  SELECT * INTO target FROM openerp.workspace_views WHERE book_id=scope->>'bookId' AND id=payload->>'id' AND owner_id=actor;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','This saved view is not available to remove.'); END IF;
  IF target.visibility='team' THEN PERFORM openerp.authorize(token,scope,true); END IF;
  DELETE FROM openerp.workspace_views WHERE book_id=target.book_id AND id=target.id;
  result:=jsonb_build_object('scope',scope,'id',target.id);
  RETURN openerp.save_command(scope->>'bookId',key,actor,'workspace_delete_view',payload,result);
END $$;

CREATE FUNCTION openerp.workspace_assign_work(token text, scope jsonb, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; result jsonb; current_revision integer; saved openerp.workspace_assignments; a_kind text; record_id text;
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
  a_kind:=payload->>'kind'; record_id:=payload->>'recordId';
  IF NOT ((a_kind='journal' AND openerp.posting_recovery_standalone(scope->>'bookId',record_id)) OR
    (a_kind='invoice' AND EXISTS(SELECT FROM openerp.invoice_drafts d WHERE d.book_id=scope->>'bookId' AND d.id=record_id)) OR
    (a_kind='expense' AND EXISTS(SELECT FROM openerp.expense_tax_sources s WHERE s.book_id=scope->>'bookId' AND s.id=record_id))) THEN
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
    WHERE a.book_id=scope->>'bookId' AND a.kind=a_kind AND a.record_id=workspace_assign_work.record_id;
  IF current_revision<>(payload->>'expectedRevision')::integer THEN
    PERFORM openerp.fail('StaleDependency','This handoff changed. Close it and refresh the work list before editing again.'); END IF;
  INSERT INTO openerp.workspace_assignments VALUES(scope->>'bookId',a_kind,record_id,current_revision+1,
    payload->>'assigneeId',(payload->>'dueOn')::date,payload->>'note',clock_timestamp(),actor) RETURNING * INTO saved;
  result:=jsonb_build_object('scope',scope,'assignment',openerp.workspace_assignment_json(saved));
  RETURN openerp.save_command(scope->>'bookId',key,actor,'workspace_assign_work',payload,result);
END $$;

ALTER FUNCTION openerp.workspace_attention(text,jsonb,jsonb) RENAME TO workspace_attention_base;
REVOKE ALL ON FUNCTION openerp.workspace_attention_base(text,jsonb,jsonb) FROM openerp_runtime;
CREATE FUNCTION openerp.workspace_attention(token text, scope jsonb, filters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE result jsonb; items jsonb;
BEGIN
  result:=openerp.workspace_attention_base(token,scope,filters);
  SELECT coalesce(jsonb_agg(item || jsonb_build_object('assignment',(
      SELECT openerp.workspace_assignment_json(a) FROM openerp.workspace_assignments a
      WHERE a.book_id=scope->>'bookId' AND a.kind=item->>'kind' AND a.record_id=item->>'id' ORDER BY a.revision DESC LIMIT 1
    )) ORDER BY ordinal),'[]') INTO items FROM jsonb_array_elements(result->'items') WITH ORDINALITY x(item,ordinal);
  RETURN jsonb_set(result,'{items}',items);
END $$;
REVOKE ALL ON FUNCTION openerp.workspace_assignment_json(openerp.workspace_assignments),openerp.workspace_coordination(text,jsonb),
  openerp.workspace_save_view(text,jsonb,text,jsonb),openerp.workspace_delete_view(text,jsonb,text,jsonb),
  openerp.workspace_assign_work(text,jsonb,text,jsonb),openerp.workspace_attention(text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.workspace_coordination(text,jsonb),openerp.workspace_save_view(text,jsonb,text,jsonb),
  openerp.workspace_delete_view(text,jsonb,text,jsonb),openerp.workspace_assign_work(text,jsonb,text,jsonb),
  openerp.workspace_attention(text,jsonb,jsonb) TO openerp_runtime;
