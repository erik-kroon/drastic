-- Workflows deliver bounded preparation steps; PostgreSQL remains authoritative.
CREATE TABLE openerp.preparation_jobs (
  book_id text NOT NULL,
  id text NOT NULL,
  run_id text NOT NULL,
  requested_by text NOT NULL REFERENCES openerp.actors,
  executor_id text NOT NULL REFERENCES openerp.actors,
  credential_hash text,
  session_id text,
  expected_audit integer NOT NULL,
  checkpoint integer NOT NULL DEFAULT 0 CHECK (checkpoint BETWEEN 0 AND 50),
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','completed','blocked','stopped')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,run_id) REFERENCES openerp.preparation_runs,
  CHECK ((credential_hash IS NULL) <> (session_id IS NULL))
);
CREATE UNIQUE INDEX one_preparation_job ON openerp.preparation_jobs(book_id,run_id) WHERE state='ready';
CREATE INDEX preparation_job_dispatch ON openerp.preparation_jobs(executor_id,checked_at) WHERE state='ready';

CREATE FUNCTION openerp.preparation_job_body(job openerp.preparation_jobs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT jsonb_build_object('id',job.id,'scope',jsonb_build_object('entityId',b.entity_id,'bookId',b.id),
    'runId',job.run_id,'requestedBy',job.requested_by,'executorId',job.executor_id,
    'checkpoint',job.checkpoint,'state',job.state,'reason',job.reason,
    'createdAt',to_char(job.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'checkedAt',to_char(job.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'requiresPostingApproval',true) FROM openerp.books b WHERE b.id=job.book_id
$$;

CREATE FUNCTION openerp.admit_preparation_job(token text, scope jsonb, id text, key text, executor_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; executor text; prior jsonb; job openerp.preparation_jobs; run openerp.preparation_runs;
  fingerprint text:=encode(sha256(convert_to(token,'UTF8')),'hex'); credential text; session_ref text; audit_count integer;
  input jsonb;
BEGIN
  actor:=openerp.authorize(token,scope);
  executor:=openerp.authorize(executor_token,scope);
  -- Require a dedicated prepare-only actor, not an operator credential.
  IF NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=scope->>'bookId' AND m.actor_id=executor AND m.role='agent') THEN
    PERFORM openerp.fail('Forbidden','The background executor must have the agent role in this book.'); END IF;
  input:=jsonb_build_object('runId',id,'executorId',executor);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  prior:=openerp.replay(scope->>'bookId',key,actor,'admit_preparation_job',input);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  SELECT * INTO run FROM openerp.preparation_runs r WHERE r.book_id=scope->>'bookId' AND r.id=admit_preparation_job.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Preparation run not found.'); END IF;
  IF run.state<>'ready' THEN PERFORM openerp.fail('InvalidJournal','Only a ready preparation run can start in the background. Resume blocked or cancelled runs explicitly first.'); END IF;
  IF EXISTS(SELECT FROM openerp.preparation_jobs j WHERE j.book_id=run.book_id AND j.run_id=run.id AND j.state='ready') THEN
    PERFORM openerp.fail('InvalidJournal','This preparation run already has an active background job.'); END IF;
  SELECT c.token_hash INTO credential FROM openerp.credentials c WHERE c.token_hash=fingerprint
    AND c.actor_id=actor AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp();
  IF credential IS NULL THEN
    SELECT s.id INTO STRICT session_ref FROM openerp_auth.session s WHERE s.token=admit_preparation_job.token AND s.user_id=actor;
  END IF;
  SELECT coalesce(max(a.ordinal),0) INTO audit_count FROM openerp.preparation_run_audit a WHERE a.book_id=run.book_id AND a.run_id=run.id;
  INSERT INTO openerp.preparation_jobs(book_id,id,run_id,requested_by,executor_id,credential_hash,session_id,expected_audit)
    VALUES(run.book_id,openerp.new_id('job'),run.id,actor,executor,credential,session_ref,audit_count) RETURNING * INTO job;
  RETURN openerp.save_command(run.book_id,key,actor,'admit_preparation_job',input,openerp.preparation_job_body(job));
END $$;

CREATE FUNCTION openerp.get_preparation_job(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE job openerp.preparation_jobs;
BEGIN
  PERFORM openerp.authorize(token,scope);
  SELECT * INTO job FROM openerp.preparation_jobs j WHERE j.book_id=scope->>'bookId' AND j.run_id=get_preparation_job.id
    ORDER BY j.created_at DESC,j.id DESC LIMIT 1;
  RETURN CASE WHEN FOUND THEN openerp.preparation_job_body(job) ELSE NULL END;
END $$;

CREATE FUNCTION openerp.pending_preparation_jobs(token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; result jsonb;
BEGIN
  actor:=openerp.authenticate(token);
  WITH selected AS
    (SELECT jobs.book_id,jobs.id FROM openerp.preparation_jobs jobs JOIN openerp.memberships m
      ON m.book_id=jobs.book_id AND m.actor_id=actor AND m.role='agent'
      WHERE jobs.executor_id=actor AND jobs.state='ready' ORDER BY jobs.checked_at,jobs.id LIMIT 100 FOR UPDATE OF jobs SKIP LOCKED),
    claimed AS (UPDATE openerp.preparation_jobs jobs SET checked_at=clock_timestamp() FROM selected s
      WHERE jobs.book_id=s.book_id AND jobs.id=s.id RETURNING jobs.*)
    SELECT coalesce(jsonb_agg(openerp.preparation_job_body(j::openerp.preparation_jobs)),'[]') INTO result FROM claimed j;
  RETURN result;
END $$;

CREATE FUNCTION openerp.execute_preparation_job(token text, scope jsonb, id text, step integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; job openerp.preparation_jobs; run openerp.preparation_runs; member text; credential_actor text;
  audit_count integer; result jsonb; reason text;
BEGIN
  actor:=openerp.authorize(token,scope);
  SELECT * INTO job FROM openerp.preparation_jobs j WHERE j.book_id=scope->>'bookId' AND j.id=execute_preparation_job.id;
  IF NOT FOUND OR job.executor_id<>actor THEN PERFORM openerp.fail('Forbidden','This executor cannot run the requested job.'); END IF;
  IF step IS NULL OR step NOT BETWEEN 0 AND 49 THEN PERFORM openerp.fail('InvalidJournal','Invalid preparation checkpoint.'); END IF;
  -- Lock submitter credentials and membership before the book, like request admission.
  IF job.credential_hash IS NOT NULL THEN
    SELECT c.actor_id INTO credential_actor FROM openerp.credentials c WHERE c.token_hash=job.credential_hash
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() FOR SHARE;
  ELSE
    SELECT s.user_id INTO credential_actor FROM openerp_auth.session s WHERE s.id=job.session_id AND s.expires_at>clock_timestamp() FOR SHARE;
  END IF;
  SELECT m.actor_id INTO member FROM openerp.memberships m WHERE m.book_id=job.book_id AND m.actor_id=job.requested_by FOR SHARE;
  PERFORM 1 FROM openerp.books b WHERE b.id=job.book_id FOR UPDATE;
  SELECT * INTO STRICT job FROM openerp.preparation_jobs j WHERE j.book_id=scope->>'bookId' AND j.id=execute_preparation_job.id FOR UPDATE;
  IF job.state<>'ready' OR step<job.checkpoint THEN RETURN openerp.preparation_job_body(job); END IF;
  IF step<>job.checkpoint THEN PERFORM openerp.fail('InvalidJournal','The preparation checkpoint is not current.'); END IF;
  SELECT * INTO STRICT run FROM openerp.preparation_runs r WHERE r.book_id=job.book_id AND r.id=job.run_id;
  SELECT coalesce(max(a.ordinal),0) INTO audit_count FROM openerp.preparation_run_audit a WHERE a.book_id=job.book_id AND a.run_id=job.run_id;
  IF credential_actor IS DISTINCT FROM job.requested_by OR member IS NULL THEN reason:='Submitting authority expired or was revoked.';
  ELSIF NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=job.book_id AND m.actor_id=actor AND m.role='agent') THEN reason:='Executor no longer has the agent role.';
  ELSIF audit_count<>job.expected_audit THEN reason:='The preparation run was changed manually. Start a new background job explicitly.';
  ELSIF run.state<>'ready' THEN reason:='The preparation run is no longer ready.';
  END IF;
  IF reason IS NOT NULL THEN
    UPDATE openerp.preparation_jobs j SET state='stopped',reason=execute_preparation_job.reason,checked_at=clock_timestamp()
      WHERE j.book_id=job.book_id AND j.id=job.id RETURNING * INTO job;
  ELSE
    result:=openerp.advance_preparation_run(token,scope,job.run_id,job.id||'_step_'||step,
      jsonb_build_object('action','continue','maxItems',20));
    UPDATE openerp.preparation_jobs j SET checkpoint=j.checkpoint+1,expected_audit=jsonb_array_length(result->'audit'),
      state=CASE WHEN result->>'state'='ready' THEN 'ready' WHEN result->>'state'='completed' THEN 'completed' ELSE 'blocked' END,
      reason=result->'blocker'->>'message',checked_at=clock_timestamp()
      WHERE j.book_id=job.book_id AND j.id=job.id RETURNING * INTO job;
  END IF;
  RETURN openerp.preparation_job_body(job);
END $$;

REVOKE ALL ON openerp.preparation_jobs FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.preparation_job_body(openerp.preparation_jobs),
  openerp.admit_preparation_job(text,jsonb,text,text,text),openerp.get_preparation_job(text,jsonb,text),
  openerp.pending_preparation_jobs(text),openerp.execute_preparation_job(text,jsonb,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.admit_preparation_job(text,jsonb,text,text,text),openerp.get_preparation_job(text,jsonb,text),
  openerp.pending_preparation_jobs(text),openerp.execute_preparation_job(text,jsonb,text,integer) TO openerp_runtime;
