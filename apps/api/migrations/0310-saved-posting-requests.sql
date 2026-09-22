-- Forward-only posting request admission and approval revocation.
-- Requires 0300; preserves the later standalone gate and existing kernel commands.
CREATE TABLE openerp.posting_saved_requests (
  book_id text NOT NULL REFERENCES openerp.books,
  key text NOT NULL CHECK (key ~ '^[a-zA-Z0-9_-]{8,128}$'),
  actor_id text NOT NULL REFERENCES openerp.actors,
  command jsonb NOT NULL,
  digest text NOT NULL,
  command_key text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,key), UNIQUE (book_id,command_key)
);
CREATE INDEX posting_saved_order ON openerp.posting_saved_requests(book_id,saved_at DESC,key DESC);
CREATE TABLE openerp.posting_request_outcomes (
  book_id text NOT NULL, key text NOT NULL,
  state text NOT NULL CHECK (state IN ('committed','refused')),
  result jsonb, refusal jsonb,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,key),
  FOREIGN KEY (book_id,key) REFERENCES openerp.posting_saved_requests,
  CHECK ((state='committed' AND result IS NOT NULL AND refusal IS NULL)
    OR (state='refused' AND result IS NULL AND refusal IS NOT NULL))
);
CREATE TABLE openerp.posting_approval_revocations (
  book_id text NOT NULL, approval_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,approval_id),
  FOREIGN KEY (book_id,approval_id) REFERENCES openerp.approvals
);
CREATE TRIGGER posting_saved_immutable BEFORE UPDATE OR DELETE ON openerp.posting_saved_requests
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER posting_outcome_immutable BEFORE UPDATE OR DELETE ON openerp.posting_request_outcomes
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER posting_revocation_immutable BEFORE UPDATE OR DELETE ON openerp.posting_approval_revocations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- Preserve terminal refusal even if a caller reuses the retained command key
-- through an older public kernel endpoint. Mismatched identity also rolls back.
CREATE FUNCTION openerp.posting_guard_saved_command_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE ps_request openerp.posting_saved_requests; ps_operation text; ps_payload jsonb; ps_digest text;
BEGIN
  SELECT * INTO ps_request FROM openerp.posting_saved_requests r
    WHERE r.book_id=NEW.book_id AND r.command_key=NEW.key;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF EXISTS(SELECT FROM openerp.posting_request_outcomes o
    WHERE o.book_id=ps_request.book_id AND o.key=ps_request.key AND o.state='refused') THEN
    PERFORM openerp.fail('IdempotencyConflict','This saved request was terminally refused. Its key cannot execute later.'); END IF;
  ps_operation := ps_request.command->>'operation';
  ps_payload := CASE WHEN ps_operation IN ('create_evidence','prepare_journal') THEN ps_request.command->'input'
    ELSE jsonb_build_object('id',ps_request.command->>'id','input',ps_request.command->'input') END;
  IF ps_operation='revoke_approval' THEN ps_operation := 'revoke_posting_approval'; END IF;
  ps_digest := openerp.digest(jsonb_build_object('operation',ps_operation,'actor',ps_request.actor_id,'input',ps_payload));
  IF NEW.actor_id IS DISTINCT FROM ps_request.actor_id OR NEW.operation IS DISTINCT FROM ps_operation
    OR NEW.request_digest IS DISTINCT FROM ps_digest THEN
    PERFORM openerp.fail('IdempotencyConflict','The reserved kernel key belongs to another exact saved request.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posting_saved_command_identity BEFORE INSERT ON openerp.command_receipts
  FOR EACH ROW EXECUTE FUNCTION openerp.posting_guard_saved_command_receipt();
REVOKE ALL ON FUNCTION openerp.posting_guard_saved_command_receipt() FROM PUBLIC,openerp_runtime;

-- No new ledger writer. Every kernel/bundle approval consumption passes this guard.
CREATE FUNCTION openerp.posting_guard_approval_consumption() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM openerp.fail('Forbidden','Approval history is immutable. Revoke unused authority instead.');
  END IF;
  IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    PERFORM openerp.fail('Forbidden','Approval identity and consumption are immutable.');
  END IF;
  IF NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL THEN
    IF OLD.expires_at <= clock_timestamp() THEN
      PERFORM openerp.fail('ApprovalRequired','This approval expired before consumption. Obtain a new exact-plan approval.'); END IF;
    IF EXISTS(SELECT FROM openerp.posting_approval_revocations r WHERE r.book_id=NEW.book_id AND r.approval_id=NEW.id) THEN
      PERFORM openerp.fail('ApprovalRequired','This approval was revoked. Obtain a new exact-plan approval.'); END IF;
    PERFORM 1 FROM openerp.memberships m WHERE m.book_id=NEW.book_id AND m.actor_id=NEW.actor_id AND m.role='operator' FOR SHARE;
    IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approver no longer has operator authority.'); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posting_approval_consumption BEFORE UPDATE OR DELETE ON openerp.approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.posting_guard_approval_consumption();

CREATE FUNCTION openerp.posting_revoke_approval(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE ps_actor text; ps_previous jsonb; ps_approval openerp.approvals;
  ps_revocation openerp.posting_approval_revocations; ps_result jsonb;
  ps_payload jsonb := jsonb_build_object('id',id,'input',input);
BEGIN
  ps_actor := openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  ps_previous := openerp.replay(scope->>'bookId',key,ps_actor,'revoke_posting_approval',ps_payload);
  IF ps_previous IS NOT NULL THEN RETURN ps_previous; END IF;
  SELECT * INTO ps_approval FROM openerp.approvals a WHERE a.book_id=scope->>'bookId' AND a.id=posting_revoke_approval.id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The approval was not found in this book.'); END IF;
  IF ps_approval.consumed_at IS NOT NULL THEN
    PERFORM openerp.fail('AlreadyPosted','Consumed approval cannot be revoked. Its committed posting is unchanged.'); END IF;
  IF EXISTS(SELECT FROM openerp.posting_approval_revocations r WHERE r.book_id=scope->>'bookId' AND r.approval_id=id) THEN
    PERFORM openerp.fail('ApprovalRequired','This approval has already been revoked.'); END IF;
  INSERT INTO openerp.posting_approval_revocations(book_id,approval_id,actor_id,reason)
    VALUES(scope->>'bookId',id,ps_actor,input->>'reason') RETURNING * INTO ps_revocation;
  ps_result := jsonb_build_object('approvalId',id,'changeSetId',ps_approval.change_set_id,
    'planDigest',ps_approval.digest,'actorId',ps_actor,'reason',ps_revocation.reason,
    'revokedAt',to_char(ps_revocation.revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  RETURN openerp.save_command(scope->>'bookId',key,ps_actor,'revoke_posting_approval',ps_payload,ps_result);
END $$;

-- Exact object keys, including nested line keys. Values are validated by existing
-- kernel commands at run time; malformed values are never silently coerced at save.
CREATE FUNCTION openerp.posting_check_command(command jsonb, authority boolean) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE ps_operation text := command->>'operation'; ps_input jsonb := command->'input'; ps_fields text[];
BEGIN
  IF jsonb_typeof(command) IS DISTINCT FROM 'object' OR jsonb_typeof(ps_input) IS DISTINCT FROM 'object'
    OR octet_length(command::text)>1048576 THEN
    PERFORM openerp.fail('InvalidJournal','Supply a bounded posting request object.'); END IF;
  IF authority THEN
    IF ps_operation NOT IN ('approve_change','revoke_approval') OR ps_operation IS NULL THEN
      PERFORM openerp.fail('Forbidden','Use the human approval request operation.'); END IF;
  ELSIF ps_operation NOT IN ('create_evidence','prepare_journal','execute_change') OR ps_operation IS NULL THEN
    PERFORM openerp.fail('Forbidden','This request operation is not supported.');
  END IF;
  IF ps_operation IN ('approve_change','execute_change','revoke_approval') THEN
    IF command - ARRAY['operation','id','input'] <> '{}'::jsonb
      OR jsonb_typeof(command->'id') IS DISTINCT FROM 'string' OR command->>'id' !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Supply the exact scoped target identity.'); END IF;
  ELSIF command - ARRAY['operation','input'] <> '{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Unsupported request fields.');
  END IF;
  ps_fields := CASE ps_operation
    WHEN 'create_evidence' THEN ARRAY['title','content','mediaType','origin']
    WHEN 'prepare_journal' THEN ARRAY['kind','evidenceId','eventKey','accountingPeriodId','postingDate','series','description','rationale','taxAssessment','lines']
    WHEN 'approve_change' THEN ARRAY['planDigest','version']
    WHEN 'execute_change' THEN ARRAY['planDigest','version','approvalId']
    WHEN 'revoke_approval' THEN ARRAY['reason'] END;
  IF ps_input - ps_fields <> '{}'::jsonb OR NOT ps_input ?& ps_fields THEN
    PERFORM openerp.fail('InvalidJournal','Supply all supported request fields and no others.'); END IF;
  IF EXISTS(SELECT FROM jsonb_each(ps_input) f WHERE f.key NOT IN ('lines','version') AND jsonb_typeof(f.value)<>'string') THEN
    PERFORM openerp.fail('InvalidJournal','Posting input values must retain their string representation.'); END IF;
  IF ps_operation IN ('approve_change','execute_change') AND
    (ps_input->'version' IS DISTINCT FROM '1'::jsonb OR ps_input->>'planDigest' !~ '^sha256:[a-f0-9]{64}$') THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact proposal digest and version.'); END IF;
  IF ps_operation='execute_change' AND ps_input->>'approvalId' !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the scoped approval identity.'); END IF;
  IF ps_operation='revoke_approval' AND length(ps_input->>'reason') NOT BETWEEN 1 AND 2000 THEN
    PERFORM openerp.fail('InvalidJournal','Supply a reason for revoking this approval.'); END IF;
  IF ps_operation='create_evidence' AND (
    length(ps_input->>'title') NOT BETWEEN 1 AND 2000 OR length(ps_input->>'origin') NOT BETWEEN 1 AND 2000
    OR length(ps_input->>'content') NOT BETWEEN 1 AND 65536
    OR ps_input->>'mediaType' NOT IN ('text/plain','application/json')) THEN
    PERFORM openerp.fail('InvalidJournal','Supply bounded evidence text and supported media type.'); END IF;
  IF ps_operation='prepare_journal' AND (
    ps_input->>'kind'<>'manual_journal' OR ps_input->>'taxAssessment'<>'not_applicable'
    OR ps_input->>'evidenceId' !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR ps_input->>'accountingPeriodId' !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR ps_input->>'eventKey' !~ '^[a-zA-Z0-9_-]{1,128}$'
    OR ps_input->>'postingDate' !~ '^\d{4}-\d{2}-\d{2}$'
    OR ps_input->>'series' !~ '^[A-Z0-9]{1,16}$'
    OR length(ps_input->>'description') NOT BETWEEN 1 AND 2000
    OR length(ps_input->>'rationale') NOT BETWEEN 1 AND 2000) THEN
    PERFORM openerp.fail('InvalidJournal','Supply the supported journal request shape and bounded strings.'); END IF;
  IF ps_operation='prepare_journal' THEN
    IF jsonb_typeof(ps_input->'lines') IS DISTINCT FROM 'array' THEN
      PERFORM openerp.fail('InvalidJournal','Supply exact journal lines.'); END IF;
    IF jsonb_array_length(ps_input->'lines') NOT BETWEEN 2 AND 500 OR EXISTS (
      SELECT FROM jsonb_array_elements(ps_input->'lines') l WHERE jsonb_typeof(l)<>'object'
    ) THEN PERFORM openerp.fail('InvalidJournal','Supply 2 to 500 journal line objects.'); END IF;
    IF EXISTS(SELECT FROM jsonb_array_elements(ps_input->'lines') l
      WHERE l - ARRAY['accountId','debitMinor','creditMinor','description'] <> '{}'::jsonb
        OR NOT l ?& ARRAY['accountId','debitMinor','creditMinor','description']
        OR EXISTS(SELECT FROM jsonb_each(l) f WHERE jsonb_typeof(f.value)<>'string')) THEN
      PERFORM openerp.fail('InvalidJournal','Supply only the exact supported journal line fields.'); END IF;
    IF EXISTS(SELECT FROM jsonb_array_elements(ps_input->'lines') l
      WHERE l->>'accountId' !~ '^[a-z][a-z0-9_-]{2,127}$'
        OR l->>'debitMinor' !~ '^(0|[1-9][0-9]{0,37})$'
        OR l->>'creditMinor' !~ '^(0|[1-9][0-9]{0,37})$'
        OR length(l->>'description') NOT BETWEEN 1 AND 2000) THEN
      PERFORM openerp.fail('InvalidJournal','Retain exact account identities and decimal minor-unit strings.'); END IF;
  END IF;
END $$;

CREATE FUNCTION openerp.posting_saved_summary(request openerp.posting_saved_requests) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, openerp AS $$
  SELECT jsonb_build_object('key',(request).key,'actorId',(request).actor_id,'operation',(request).command->>'operation',
    'requestDigest',(request).digest,'commandKey',(request).command_key,
    'savedAt',to_char((request).saved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'state',coalesce((SELECT o.state FROM openerp.posting_request_outcomes o WHERE o.book_id=(request).book_id AND o.key=(request).key),'unknown'))
$$;
CREATE FUNCTION openerp.get_saved_posting_request(token text, scope jsonb, key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE ps_actor text; ps_request openerp.posting_saved_requests; ps_outcome jsonb;
BEGIN
  ps_actor := openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO ps_request FROM openerp.posting_saved_requests r WHERE r.book_id=scope->>'bookId' AND r.key=get_saved_posting_request.key;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','No saved request was observed for this key. A delayed save can still arrive.'); END IF;
  SELECT jsonb_build_object('state',o.state,'result',o.result,'refusal',o.refusal,
    'recordedAt',to_char(o.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) INTO ps_outcome
    FROM openerp.posting_request_outcomes o WHERE o.book_id=ps_request.book_id AND o.key=ps_request.key;
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',scope->>'entityId','bookId',scope->>'bookId'),
    'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'request',openerp.posting_saved_summary(ps_request),'command',ps_request.command,
    'sameActor',ps_request.actor_id=ps_actor,'outcome',ps_outcome);
END $$;
CREATE FUNCTION openerp.list_saved_posting_requests(token text, scope jsonb, after_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE ps_actor text; ps_anchor openerp.posting_saved_requests; ps_items jsonb; ps_next text;
BEGIN
  ps_actor := openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF after_key IS NOT NULL THEN
    SELECT * INTO ps_anchor FROM openerp.posting_saved_requests r WHERE r.book_id=scope->>'bookId' AND r.key=after_key;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The request continuation does not belong to this book.'); END IF;
  END IF;
  WITH candidates AS (
    SELECT r.* FROM openerp.posting_saved_requests r WHERE r.book_id=scope->>'bookId'
      AND (after_key IS NULL OR (r.saved_at,r.key)<(ps_anchor.saved_at,ps_anchor.key))
    ORDER BY r.saved_at DESC,r.key DESC LIMIT 21
  ), page AS (SELECT * FROM candidates ORDER BY saved_at DESC,key DESC LIMIT 20)
  SELECT coalesce(jsonb_agg(openerp.posting_saved_summary(ROW(p.book_id,p.key,p.actor_id,p.command,p.digest,p.command_key,p.saved_at)::openerp.posting_saved_requests)
      ORDER BY p.saved_at DESC,p.key DESC),'[]'),
    CASE WHEN (SELECT count(*) FROM candidates)>20 THEN (SELECT key FROM page ORDER BY saved_at,key LIMIT 1) ELSE NULL END
    INTO ps_items,ps_next FROM page p;
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',scope->>'entityId','bookId',scope->>'bookId'),
    'actorId',ps_actor,'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'items',ps_items,'next',ps_next);
END $$;
CREATE FUNCTION openerp.posting_save_request(token text, scope jsonb, key text, command jsonb, authority boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE ps_actor text; ps_digest text; ps_existing openerp.posting_saved_requests;
BEGIN
  ps_actor := openerp.authorize(token,scope,authority);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  IF key IS NULL OR key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    PERFORM openerp.fail('IdempotencyConflict','Supply the original request key.'); END IF;
  PERFORM openerp.posting_check_command(command,authority);
  ps_digest := openerp.digest(jsonb_build_object('scope',jsonb_build_object('entityId',scope->>'entityId','bookId',scope->>'bookId'),
    'actorId',ps_actor,'command',command));
  SELECT * INTO ps_existing FROM openerp.posting_saved_requests r WHERE r.book_id=scope->>'bookId' AND r.key=posting_save_request.key;
  IF FOUND THEN
    IF ps_existing.digest IS DISTINCT FROM ps_digest OR ps_existing.actor_id IS DISTINCT FROM ps_actor THEN
      PERFORM openerp.fail('IdempotencyConflict','This saved request key belongs to another exact command or actor.'); END IF;
  ELSE
    INSERT INTO openerp.posting_saved_requests(book_id,key,actor_id,command,digest,command_key)
      VALUES(scope->>'bookId',key,ps_actor,command,ps_digest,openerp.new_id('posting_command'));
  END IF;
  RETURN openerp.get_saved_posting_request(token,scope,key);
END $$;
CREATE FUNCTION openerp.posting_run_request(token text, scope jsonb, key text, authority boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE ps_actor text; ps_request openerp.posting_saved_requests; ps_command jsonb;
  ps_result jsonb; ps_code text; ps_message text;
BEGIN
  -- Authentication/authority errors outside the exception block do not fabricate refusal.
  ps_actor := openerp.authorize(token,scope,authority);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  SELECT * INTO ps_request FROM openerp.posting_saved_requests r WHERE r.book_id=scope->>'bookId' AND r.key=posting_run_request.key;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The saved request was not found. Recover before retrying.'); END IF;
  IF ps_request.actor_id<>ps_actor THEN PERFORM openerp.fail('Forbidden','Only the original actor can run this saved request.'); END IF;
  PERFORM openerp.posting_check_command(ps_request.command,authority);
  IF EXISTS(SELECT FROM openerp.posting_request_outcomes o WHERE o.book_id=ps_request.book_id AND o.key=ps_request.key) THEN
    RETURN openerp.get_saved_posting_request(token,scope,key); END IF;
  ps_command := ps_request.command;
  -- Each caught refusal rolls back the complete attempted command subtransaction.
  BEGIN
    CASE ps_command->>'operation'
      WHEN 'create_evidence' THEN ps_result := openerp.create_evidence(token,scope,ps_request.command_key,ps_command->'input');
      WHEN 'prepare_journal' THEN ps_result := openerp.prepare_journal(token,scope,ps_request.command_key,ps_command->'input');
      WHEN 'approve_change' THEN
        IF NOT openerp.posting_recovery_standalone(scope->>'bookId',ps_command->>'id') THEN
          PERFORM openerp.fail('UnsupportedProfile','Review the complete domain bundle instead.'); END IF;
        ps_result := openerp.approve_change(token,scope,ps_command->>'id',ps_request.command_key,ps_command->'input');
      WHEN 'execute_change' THEN
        IF NOT openerp.posting_recovery_standalone(scope->>'bookId',ps_command->>'id') THEN
          PERFORM openerp.fail('UnsupportedProfile','Execute the complete domain bundle instead.'); END IF;
        ps_result := openerp.execute_change(token,scope,ps_command->>'id',ps_request.command_key,ps_command->'input');
      WHEN 'revoke_approval' THEN ps_result := openerp.posting_revoke_approval(token,scope,ps_command->>'id',ps_request.command_key,ps_command->'input');
    END CASE;
    INSERT INTO openerp.posting_request_outcomes(book_id,key,state,result)
      VALUES(ps_request.book_id,ps_request.key,'committed',ps_result);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS ps_code=PG_EXCEPTION_DETAIL,ps_message=MESSAGE_TEXT;
    IF ps_code IS NULL OR ps_code NOT IN ('InvalidJournal','MissingEvidence','PeriodLocked','StaleDependency',
      'IdempotencyConflict','AlreadyPosted','ApprovalRequired','UnsupportedProfile','NotFound') THEN RAISE; END IF;
    INSERT INTO openerp.posting_request_outcomes(book_id,key,state,refusal)
      VALUES(ps_request.book_id,ps_request.key,'refused',jsonb_build_object('code',ps_code,'message',ps_message));
  END;
  RETURN openerp.get_saved_posting_request(token,scope,key);
END $$;
CREATE FUNCTION openerp.save_posting_request(token text, scope jsonb, key text, command jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
  SELECT openerp.posting_save_request(token,scope,key,command,false)
$$;
CREATE FUNCTION openerp.save_posting_authority_request(token text, scope jsonb, key text, command jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
  SELECT openerp.posting_save_request(token,scope,key,command,true)
$$;
CREATE FUNCTION openerp.run_posting_request(token text, scope jsonb, key text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
  SELECT openerp.posting_run_request(token,scope,key,false)
$$;
CREATE FUNCTION openerp.run_posting_authority_request(token text, scope jsonb, key text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
  SELECT openerp.posting_run_request(token,scope,key,true)
$$;
REVOKE ALL ON TABLE openerp.posting_saved_requests,openerp.posting_request_outcomes,openerp.posting_approval_revocations FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.posting_guard_approval_consumption(),openerp.posting_revoke_approval(text,jsonb,text,text,jsonb),
  openerp.posting_check_command(jsonb,boolean),openerp.posting_saved_summary(openerp.posting_saved_requests),
  openerp.posting_save_request(text,jsonb,text,jsonb,boolean),openerp.posting_run_request(text,jsonb,text,boolean),
  openerp.save_posting_request(text,jsonb,text,jsonb),openerp.save_posting_authority_request(text,jsonb,text,jsonb),
  openerp.run_posting_request(text,jsonb,text),openerp.run_posting_authority_request(text,jsonb,text),
  openerp.get_saved_posting_request(text,jsonb,text),openerp.list_saved_posting_requests(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.save_posting_request(text,jsonb,text,jsonb),openerp.save_posting_authority_request(text,jsonb,text,jsonb),
  openerp.run_posting_request(text,jsonb,text),openerp.run_posting_authority_request(text,jsonb,text),
  openerp.get_saved_posting_request(text,jsonb,text),openerp.list_saved_posting_requests(text,jsonb,text) TO openerp_runtime;

-- Live diagnostics only: revoked authority cannot be selected for new execution.
CREATE OR REPLACE FUNCTION openerp.get_posting_recovery(token text, scope jsonb, id text, after_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE pr_actor text; pr_proposal openerp.change_sets; pr_anchor openerp.command_receipts;
  pr_approval jsonb; pr_requests jsonb; pr_next text; pr_validation jsonb; pr_error text; pr_message text;
  pr_checked timestamptz; pr_sequence text;
BEGIN
  pr_actor := openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO pr_proposal FROM openerp.change_sets c WHERE c.book_id=scope->>'bookId' AND c.id=get_posting_recovery.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained proposal was not found in this book.'); END IF;
  IF NOT openerp.posting_recovery_standalone(pr_proposal.book_id,pr_proposal.id) THEN
    PERFORM openerp.fail('UnsupportedProfile','This proposal belongs to an atomic correction bundle. Review and recover the whole bundle instead.'); END IF;
  IF after_key IS NOT NULL THEN
    SELECT * INTO pr_anchor FROM openerp.command_receipts r WHERE r.book_id=scope->>'bookId' AND r.key=after_key
      AND r.operation IN ('prepare_journal','prepare_correction','validate_change','approve_change','execute_change')
      AND coalesce(r.result->>'changeSetId',r.result->>'id')=get_posting_recovery.id;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The request continuation does not belong to this proposal.'); END IF;
  END IF;
  pr_checked := clock_timestamp();
  SELECT b.committed_sequence::text INTO pr_sequence FROM openerp.books b WHERE b.id=scope->>'bookId';
  -- This is live diagnostic information, not a new validation receipt or authority grant.
  BEGIN
    PERFORM openerp.check_dependencies(scope,pr_proposal.plan);
    pr_validation := jsonb_build_object('status','current','blocker',NULL);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS pr_error=PG_EXCEPTION_DETAIL,pr_message=MESSAGE_TEXT;
    IF pr_error NOT IN ('StaleDependency','PeriodLocked','UnsupportedProfile','InvalidJournal','MissingEvidence') THEN RAISE; END IF;
    pr_validation := jsonb_build_object('status','blocked','blocker',jsonb_build_object('code',pr_error,'message',pr_message));
  END;
  SELECT jsonb_build_object('id',a.id,'changeSetId',a.change_set_id,'planDigest',a.digest,'actorId',a.actor_id,
    'expiresAt',to_char(a.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) INTO pr_approval
    FROM openerp.approvals a JOIN openerp.memberships m ON m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator'
    WHERE a.book_id=scope->>'bookId' AND a.change_set_id=get_posting_recovery.id AND a.digest=pr_proposal.digest
      AND a.consumed_at IS NULL AND a.expires_at>pr_checked
      AND NOT EXISTS(SELECT FROM openerp.posting_approval_revocations rv WHERE rv.book_id=a.book_id AND rv.approval_id=a.id)
    ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
  WITH candidates AS (
    SELECT r.* FROM openerp.command_receipts r WHERE r.book_id=scope->>'bookId'
      AND r.operation IN ('prepare_journal','prepare_correction','validate_change','approve_change','execute_change')
      AND coalesce(r.result->>'changeSetId',r.result->>'id')=get_posting_recovery.id
      AND (after_key IS NULL OR (r.recorded_at,r.key)<(pr_anchor.recorded_at,pr_anchor.key))
    ORDER BY r.recorded_at DESC,r.key DESC LIMIT 21
  ), page AS (SELECT * FROM candidates ORDER BY recorded_at DESC,key DESC LIMIT 20)
  SELECT coalesce(jsonb_agg(jsonb_build_object('key',r.key,'operation',r.operation,'actorId',r.actor_id,
      'requestDigest',r.request_digest,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'resultId',r.result->>'id','planDigest',r.result->>'planDigest',
      'approvalState',CASE WHEN r.operation<>'approve_change' THEN NULL
        WHEN a.consumed_at IS NOT NULL THEN 'consumed'
        WHEN EXISTS(SELECT FROM openerp.posting_approval_revocations rv WHERE rv.book_id=a.book_id AND rv.approval_id=a.id) THEN 'revoked'
        WHEN a.expires_at<=pr_checked THEN 'expired'
        WHEN NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator') THEN 'authority_lost'
        ELSE 'unconsumed_at_check' END)
      ORDER BY r.recorded_at DESC,r.key DESC),'[]'),
    CASE WHEN (SELECT count(*) FROM candidates)>20 THEN (SELECT key FROM page ORDER BY recorded_at,key LIMIT 1) ELSE NULL END
    INTO pr_requests,pr_next FROM page r LEFT JOIN openerp.approvals a
      ON r.operation='approve_change' AND a.book_id=r.book_id AND a.id=r.result->>'id';
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',scope->>'entityId','bookId',scope->>'bookId'),
    'actorId',pr_actor,'checkedAt',to_char(pr_checked AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sequence',pr_sequence,'summary',openerp.posting_recovery_summary(scope->>'bookId',pr_proposal),
    'plan',pr_proposal.plan,'validation',pr_validation,'availableApproval',pr_approval,
    'requests',pr_requests,'nextRequest',pr_next);
END $$;
