CREATE TABLE openerp.deadline_activity_history (
  book_id text NOT NULL,
  obligation_id text NOT NULL,
  id text NOT NULL,
  action text NOT NULL CHECK (action IN ('dismiss_reminder','record_outcome')),
  reference text,
  outcome_kind text CHECK (outcome_kind IS NULL OR outcome_kind IN ('prepared','submitted','accepted')),
  recorded_by text NOT NULL REFERENCES openerp.actors(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,obligation_id) REFERENCES openerp.deadline_obligations(book_id,id),
  CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 500),
  CHECK (
    (action='record_outcome' AND reference IS NOT NULL AND outcome_kind IS NOT NULL)
    OR (action='dismiss_reminder' AND reference IS NULL AND outcome_kind IS NULL)
  )
);
CREATE INDEX deadline_activity_history_obligation
  ON openerp.deadline_activity_history(book_id,obligation_id,recorded_at,id);
CREATE TRIGGER immutable_deadline_activity_history
  BEFORE UPDATE OR DELETE ON openerp.deadline_activity_history
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.deadline_projection(p_book text,p_id text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT to_jsonb(o)||jsonb_build_object(
    'current_outcome',CASE WHEN o.outcome_reference IS NOT NULL THEN jsonb_build_object(
      'kind',o.outcome_kind,'reference',o.outcome_reference,'recordedAt',o.outcome_at
    ) END,
    'activity_history',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'action',a.action,'reference',a.reference,'outcomeKind',a.outcome_kind,
        'actorId',a.recorded_by,'recordedAt',a.recorded_at
      ) ORDER BY a.recorded_at,a.id)
      FROM openerp.deadline_activity_history a
      WHERE a.book_id=o.book_id AND a.obligation_id=o.id
    ),'[]'::jsonb)
  ) FROM openerp.deadline_obligations o WHERE o.book_id=p_book AND o.id=p_id;
$$;

DROP FUNCTION openerp.deadline_save(text,jsonb,text,bigint,jsonb);
CREATE FUNCTION openerp.deadline_save(p_token text,p_scope jsonb,p_id text,p_key text,p_expected bigint,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_old openerp.deadline_obligations%ROWTYPE;
  v_payload jsonb:=jsonb_build_object('id',p_id,'expectedRevision',to_jsonb(p_expected),'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'deadline_save',v_payload);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_id !~ '^[a-zA-Z0-9_-]{1,128}$' OR p_input->>'title' IS NULL
    OR p_input->>'periodId' IS NULL OR p_input->>'responsibleActorId' IS NULL
    OR p_input->>'dueAt' IS NULL OR p_input->>'timeZone' IS NULL
    OR p_input->>'sourceReference' IS NULL OR p_input->>'sourceRevision' IS NULL
    OR p_input->>'outcomeKind' NOT IN ('prepared','submitted','accepted') THEN
    PERFORM openerp.fail('InvalidJournal','Complete obligation identity, due-date evidence and outcome requirement are needed.');
  END IF;
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_timezone_names WHERE name=p_input->>'timeZone') THEN
    PERFORM openerp.fail('InvalidJournal','Use a known IANA time zone.');
  END IF;
  IF NOT EXISTS(SELECT FROM openerp.memberships WHERE book_id=p_scope->>'bookId' AND actor_id=p_input->>'responsibleActorId') THEN
    PERFORM openerp.fail('Forbidden','The responsible actor must belong to this book.');
  END IF;
  SELECT * INTO v_old FROM openerp.deadline_obligations WHERE book_id=p_scope->>'bookId' AND id=p_id FOR UPDATE;
  IF FOUND THEN
    IF p_expected IS DISTINCT FROM v_old.revision THEN PERFORM openerp.fail('StaleDependency','Reload the current deadline revision.'); END IF;
    IF (v_old.due_at,v_old.source_reference,v_old.source_revision) IS DISTINCT FROM
       ((p_input->>'dueAt')::timestamptz,p_input->>'sourceReference',p_input->>'sourceRevision')
       AND nullif(p_input->>'overrideReason','') IS NULL THEN
      PERFORM openerp.fail('InvalidJournal','A due date or source change needs a reviewed override reason.');
    END IF;
    INSERT INTO openerp.deadline_revisions(book_id,obligation_id,revision,changed_by,prior_due_at,prior_source_reference,prior_source_revision,reason)
      VALUES(v_old.book_id,p_id,v_old.revision+1,v_actor,v_old.due_at,v_old.source_reference,v_old.source_revision,
        coalesce(nullif(p_input->>'overrideReason',''),'Updated obligation details'));
    UPDATE openerp.deadline_obligations SET title=p_input->>'title', period_id=p_input->>'periodId',
      responsible_actor_id=p_input->>'responsibleActorId',due_at=(p_input->>'dueAt')::timestamptz,
      time_zone=p_input->>'timeZone',source_reference=p_input->>'sourceReference',source_revision=p_input->>'sourceRevision',
      override_reason=nullif(p_input->>'overrideReason',''),outcome_kind=p_input->>'outcomeKind',
      revision=revision+1,updated_at=now() WHERE book_id=v_old.book_id AND id=p_id;
  ELSE
    IF p_expected IS NOT NULL THEN PERFORM openerp.fail('StaleDependency','The obligation no longer exists.'); END IF;
    INSERT INTO openerp.deadline_obligations(book_id,id,title,period_id,responsible_actor_id,due_at,time_zone,source_reference,source_revision,override_reason,outcome_kind)
      VALUES(p_scope->>'bookId',p_id,p_input->>'title',p_input->>'periodId',p_input->>'responsibleActorId',
       (p_input->>'dueAt')::timestamptz,p_input->>'timeZone',p_input->>'sourceReference',p_input->>'sourceRevision',
       nullif(p_input->>'overrideReason',''),p_input->>'outcomeKind');
  END IF;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'deadline_save',v_payload,
    openerp.deadline_projection(p_scope->>'bookId',p_id));
END $$;

DROP FUNCTION openerp.deadline_activity(text,jsonb,text,text,text);
CREATE FUNCTION openerp.deadline_activity(p_token text,p_scope jsonb,p_id text,p_key text,p_action text,p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_row openerp.deadline_obligations%ROWTYPE;
  v_recorded_at timestamptz; v_result jsonb;
  v_payload jsonb:=jsonb_build_object('id',p_id,'action',p_action,'reference',p_reference);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'deadline_activity',v_payload);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  SELECT * INTO v_row FROM openerp.deadline_obligations WHERE book_id=p_scope->>'bookId' AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Obligation not found in this book.'); END IF;
  IF p_action='dismiss_reminder' AND p_reference IS NULL THEN
    v_recorded_at:=clock_timestamp();
    INSERT INTO openerp.deadline_activity_history(book_id,obligation_id,id,action,recorded_by,recorded_at)
      VALUES(v_row.book_id,v_row.id,openerp.new_id('deadline_activity'),p_action,v_actor,v_recorded_at);
    UPDATE openerp.deadline_obligations SET reminder_dismissed_at=v_recorded_at WHERE book_id=v_row.book_id AND id=p_id;
  ELSIF p_action='record_outcome' AND p_reference IS NOT NULL AND length(p_reference) BETWEEN 1 AND 500 THEN
    v_recorded_at:=clock_timestamp();
    INSERT INTO openerp.deadline_activity_history(book_id,obligation_id,id,action,reference,outcome_kind,recorded_by,recorded_at)
      VALUES(v_row.book_id,v_row.id,openerp.new_id('deadline_activity'),p_action,p_reference,v_row.outcome_kind,v_actor,v_recorded_at);
    UPDATE openerp.deadline_obligations SET outcome_reference=p_reference,outcome_at=v_recorded_at WHERE book_id=v_row.book_id AND id=p_id;
  ELSE PERFORM openerp.fail('InvalidJournal','Unsupported deadline action or missing outcome reference.'); END IF;
  v_result:=openerp.deadline_projection(v_row.book_id,v_row.id);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'deadline_activity',v_payload,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.deadline_list(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT coalesce(jsonb_agg(
    openerp.deadline_projection(o.book_id,o.id)||jsonb_build_object('status',CASE
      WHEN o.outcome_reference IS NOT NULL THEN o.outcome_kind
      WHEN o.due_at < now() THEN 'overdue' ELSE 'upcoming' END)
    ORDER BY o.due_at,o.id),'[]'::jsonb)
    INTO v_items FROM openerp.deadline_obligations o WHERE o.book_id=p_scope->>'bookId';
  RETURN v_items;
END $$;

DROP FUNCTION openerp.deadline_feed_revoke(text,jsonb,text);
CREATE FUNCTION openerp.deadline_feed_revoke(p_token text,p_scope jsonb,p_id text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_result jsonb; v_payload jsonb:=jsonb_build_object('id',p_id);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'deadline_feed_revoke',v_payload);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  UPDATE openerp.deadline_feeds SET revoked_at=now() WHERE book_id=p_scope->>'bookId' AND id=p_id AND revoked_at IS NULL;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Active feed not found.'); END IF;
  v_result:=jsonb_build_object('id',p_id,'revoked',true);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'deadline_feed_revoke',v_payload,v_result);
END $$;

REVOKE ALL ON openerp.deadline_activity_history FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.deadline_projection(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.deadline_save(text,jsonb,text,text,bigint,jsonb),
  openerp.deadline_activity(text,jsonb,text,text,text,text),openerp.deadline_list(text,jsonb),
  openerp.deadline_feed_revoke(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.deadline_save(text,jsonb,text,text,bigint,jsonb),
  openerp.deadline_activity(text,jsonb,text,text,text,text),openerp.deadline_list(text,jsonb),
  openerp.deadline_feed_revoke(text,jsonb,text,text) TO openerp_runtime;
