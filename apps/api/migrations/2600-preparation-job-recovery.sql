-- Explicitly replace only obsolete ready preparation jobs. Historical0940 remains unchanged.
-- The book barrier makes stop + replacement + receipt atomic; no run is resumed or advanced here.
CREATE OR REPLACE FUNCTION openerp.admit_preparation_job(token text, scope jsonb, id text, key text, executor_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; executor text; prior jsonb; job openerp.preparation_jobs; run openerp.preparation_runs;
  fingerprint text:=encode(sha256(convert_to(token,'UTF8')),'hex'); credential text; session_ref text; audit_count integer;
  input jsonb; stop_reason text;
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
  SELECT coalesce(max(a.ordinal),0) INTO audit_count FROM openerp.preparation_run_audit a WHERE a.book_id=run.book_id AND a.run_id=run.id;
  SELECT * INTO job FROM openerp.preparation_jobs j
    WHERE j.book_id=run.book_id AND j.run_id=run.id AND j.state='ready' FOR UPDATE;
  IF FOUND THEN
    -- Old authority is read without locks; never reverse credential/member-before-book admission order.
    stop_reason:=CASE
      WHEN job.executor_id<>executor THEN 'Stopped by explicit replacement admission with a different configured executor.'
      WHEN NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=job.book_id
        AND m.actor_id=job.executor_id AND m.role='agent') THEN 'The previous executor no longer has the agent role.'
      WHEN NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=job.book_id AND m.actor_id=job.requested_by)
        OR (job.credential_hash IS NOT NULL AND NOT EXISTS(SELECT FROM openerp.credentials c
          WHERE c.token_hash=job.credential_hash AND c.actor_id=job.requested_by
            AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()))
        OR (job.session_id IS NOT NULL AND NOT EXISTS(SELECT FROM openerp_auth.session s
          WHERE s.id=job.session_id AND s.user_id=job.requested_by AND s.expires_at>clock_timestamp()))
        THEN 'The previous submitting authority is missing, expired or revoked.'
      WHEN job.expected_audit<>audit_count THEN 'The preparation run was changed manually before explicit replacement admission.'
      ELSE NULL END;
    IF stop_reason IS NULL THEN
      PERFORM openerp.fail('InvalidJournal','This preparation run already has an active background job.'); END IF;
    UPDATE openerp.preparation_jobs j SET state='stopped',reason=stop_reason,checked_at=clock_timestamp()
      WHERE j.book_id=job.book_id AND j.id=job.id;
  END IF;
  SELECT c.token_hash INTO credential FROM openerp.credentials c WHERE c.token_hash=fingerprint
    AND c.actor_id=actor AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp();
  IF credential IS NULL THEN
    SELECT s.id INTO STRICT session_ref FROM openerp_auth.session s WHERE s.token=admit_preparation_job.token AND s.user_id=actor;
  END IF;
  INSERT INTO openerp.preparation_jobs(book_id,id,run_id,requested_by,executor_id,credential_hash,session_id,expected_audit)
    VALUES(run.book_id,openerp.new_id('job'),run.id,actor,executor,credential,session_ref,audit_count) RETURNING * INTO job;
  RETURN openerp.save_command(run.book_id,key,actor,'admit_preparation_job',input,openerp.preparation_job_body(job));
END $$;
