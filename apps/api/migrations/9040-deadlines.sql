-- DEADLINE-1: reviewed, manual obligations only. Legal rule generation needs separate activation.
CREATE TABLE openerp.deadline_obligations (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  period_id text NOT NULL, responsible_actor_id text NOT NULL REFERENCES openerp.actors(id),
  due_at timestamptz NOT NULL, time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 100),
  source_reference text NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 1000),
  source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 120),
  override_reason text CHECK (length(override_reason) BETWEEN 1 AND 1000),
  outcome_kind text NOT NULL CHECK (outcome_kind IN ('prepared','submitted','accepted')),
  outcome_reference text, outcome_at timestamptz,
  reminder_dismissed_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,period_id) REFERENCES openerp.periods(book_id,id),
  CHECK ((outcome_reference IS NULL) = (outcome_at IS NULL)),
  CHECK (outcome_reference IS NULL OR length(outcome_reference) BETWEEN 1 AND 500)
);
CREATE TABLE openerp.deadline_revisions (
  book_id text NOT NULL, obligation_id text NOT NULL, revision bigint NOT NULL,
  changed_by text NOT NULL REFERENCES openerp.actors(id), changed_at timestamptz NOT NULL DEFAULT now(),
  prior_due_at timestamptz, prior_source_reference text, prior_source_revision text,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  PRIMARY KEY (book_id,obligation_id,revision),
  FOREIGN KEY (book_id,obligation_id) REFERENCES openerp.deadline_obligations(book_id,id)
);
CREATE TRIGGER immutable_deadline_revision BEFORE UPDATE OR DELETE ON openerp.deadline_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TABLE openerp.deadline_feeds (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL,
  token_hash text NOT NULL UNIQUE, created_by text NOT NULL REFERENCES openerp.actors(id),
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  PRIMARY KEY (book_id,id)
);
CREATE INDEX deadline_due ON openerp.deadline_obligations(book_id,due_at);

CREATE FUNCTION openerp.deadline_save(p_token text,p_scope jsonb,p_id text,p_expected bigint,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_old openerp.deadline_obligations%ROWTYPE; v_new openerp.deadline_obligations%ROWTYPE;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
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
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
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
  SELECT * INTO v_new FROM openerp.deadline_obligations WHERE book_id=p_scope->>'bookId' AND id=p_id;
  RETURN to_jsonb(v_new);
END $$;

CREATE FUNCTION openerp.deadline_activity(p_token text,p_scope jsonb,p_id text,p_action text,p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_row openerp.deadline_obligations%ROWTYPE;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  SELECT * INTO v_row FROM openerp.deadline_obligations WHERE book_id=p_scope->>'bookId' AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Obligation not found in this book.'); END IF;
  IF p_action='dismiss_reminder' THEN
    UPDATE openerp.deadline_obligations SET reminder_dismissed_at=now() WHERE book_id=v_row.book_id AND id=p_id;
  ELSIF p_action='record_outcome' AND p_reference IS NOT NULL AND length(p_reference) BETWEEN 1 AND 500 THEN
    UPDATE openerp.deadline_obligations SET outcome_reference=p_reference,outcome_at=now() WHERE book_id=v_row.book_id AND id=p_id;
  ELSE PERFORM openerp.fail('InvalidJournal','Unsupported deadline action or missing outcome reference.'); END IF;
  SELECT * INTO v_row FROM openerp.deadline_obligations WHERE book_id=p_scope->>'bookId' AND id=p_id;
  RETURN to_jsonb(v_row);
END $$;

CREATE FUNCTION openerp.deadline_list(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('status',CASE
    WHEN o.outcome_reference IS NOT NULL THEN o.outcome_kind
    WHEN o.due_at < now() THEN 'overdue' ELSE 'upcoming' END) ORDER BY o.due_at,o.id),'[]'::jsonb)
    INTO v_items FROM openerp.deadline_obligations o WHERE o.book_id=p_scope->>'bookId';
  RETURN v_items;
END $$;

CREATE FUNCTION openerp.deadline_feed_create(p_token text,p_scope jsonb,p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_secret text;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  v_secret:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO openerp.deadline_feeds(book_id,id,token_hash,created_by)
    VALUES(p_scope->>'bookId',p_id,encode(sha256(convert_to(v_secret,'UTF8')),'hex'),v_actor);
  RETURN jsonb_build_object('id',p_id,'secret',v_secret);
END $$;
CREATE FUNCTION openerp.deadline_feed_revoke(p_token text,p_scope jsonb,p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM openerp.authorize(p_token,p_scope,true);
  UPDATE openerp.deadline_feeds SET revoked_at=now() WHERE book_id=p_scope->>'bookId' AND id=p_id AND revoked_at IS NULL;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Active feed not found.'); END IF;
  RETURN jsonb_build_object('id',p_id,'revoked',true);
END $$;
CREATE FUNCTION openerp.deadline_feed_events(p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_book text; v_events jsonb;
BEGIN
  SELECT book_id INTO v_book FROM openerp.deadline_feeds WHERE token_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN PERFORM openerp.fail('Forbidden','Feed access is revoked or invalid.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'dueAt',o.due_at,'updatedAt',o.updated_at,'timeZone',o.time_zone)
    ORDER BY o.due_at,o.id),'[]'::jsonb) INTO v_events FROM openerp.deadline_obligations o WHERE o.book_id=v_book;
  RETURN jsonb_build_object('bookId',v_book,'events',v_events);
END $$;

REVOKE ALL ON openerp.deadline_obligations,openerp.deadline_revisions,openerp.deadline_feeds FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.deadline_save(text,jsonb,text,bigint,jsonb),openerp.deadline_activity(text,jsonb,text,text,text),
  openerp.deadline_list(text,jsonb),openerp.deadline_feed_create(text,jsonb,text),
  openerp.deadline_feed_revoke(text,jsonb,text),openerp.deadline_feed_events(text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.deadline_save(text,jsonb,text,bigint,jsonb),openerp.deadline_activity(text,jsonb,text,text,text),
  openerp.deadline_list(text,jsonb),openerp.deadline_feed_create(text,jsonb,text),
  openerp.deadline_feed_revoke(text,jsonb,text),openerp.deadline_feed_events(text) TO openerp_runtime;
