-- Repair the unlabeled local binding in2800's existing automatic-stop branch only.
-- No change to authority, lifecycle, advancement, reason text or runtime grants.
CREATE OR REPLACE FUNCTION openerp.execute_preparation_job(token text, scope jsonb, id text, step integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; job openerp.preparation_jobs; run openerp.preparation_runs; member text; credential_actor text;
  audit_count integer; result jsonb; stop_reason text; submitter_enabled boolean;
BEGIN
  actor:=openerp.authorize(token,scope);
  SELECT * INTO job FROM openerp.preparation_jobs j WHERE j.book_id=scope->>'bookId' AND j.id=execute_preparation_job.id;
  IF NOT FOUND OR job.executor_id<>actor THEN PERFORM openerp.fail('Forbidden','This executor cannot run the requested job.'); END IF;
  IF step IS NULL OR step NOT BETWEEN 0 AND 49 THEN PERFORM openerp.fail('InvalidJournal','Invalid preparation checkpoint.'); END IF;
  -- Lock submitter credential/session, identity admission and membership before the book.
  IF job.credential_hash IS NOT NULL THEN
    SELECT c.actor_id INTO credential_actor FROM openerp.credentials c WHERE c.token_hash=job.credential_hash
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() FOR SHARE;
  ELSE
    SELECT s.user_id INTO credential_actor FROM openerp_auth.session s WHERE s.id=job.session_id AND s.expires_at>clock_timestamp() FOR SHARE;
  END IF;
  SELECT a.enabled INTO submitter_enabled FROM openerp.identity_admissions a
    WHERE a.actor_id=job.requested_by FOR SHARE;
  SELECT m.actor_id INTO member FROM openerp.memberships m WHERE m.book_id=job.book_id AND m.actor_id=job.requested_by FOR SHARE;
  PERFORM 1 FROM openerp.books b WHERE b.id=job.book_id FOR UPDATE;
  SELECT * INTO STRICT job FROM openerp.preparation_jobs j WHERE j.book_id=scope->>'bookId' AND j.id=execute_preparation_job.id FOR UPDATE;
  IF job.state<>'ready' OR step<job.checkpoint THEN RETURN openerp.preparation_job_body(job); END IF;
  IF step<>job.checkpoint THEN PERFORM openerp.fail('InvalidJournal','The preparation checkpoint is not current.'); END IF;
  SELECT * INTO STRICT run FROM openerp.preparation_runs r WHERE r.book_id=job.book_id AND r.id=job.run_id;
  SELECT coalesce(max(a.ordinal),0) INTO audit_count FROM openerp.preparation_run_audit a WHERE a.book_id=job.book_id AND a.run_id=job.run_id;
  IF credential_actor IS DISTINCT FROM job.requested_by OR member IS NULL THEN stop_reason:='Submitting authority expired or was revoked.';
  ELSIF submitter_enabled IS FALSE THEN stop_reason:='The submitting identity is disabled.';
  ELSIF NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=job.book_id AND m.actor_id=actor AND m.role='agent') THEN stop_reason:='Executor no longer has the agent role.';
  ELSIF audit_count<>job.expected_audit THEN stop_reason:='The preparation run was changed manually. Start a new background job explicitly.';
  ELSIF run.state<>'ready' THEN stop_reason:='The preparation run is no longer ready.';
  END IF;
  IF stop_reason IS NOT NULL THEN
    UPDATE openerp.preparation_jobs j SET state='stopped',reason=stop_reason,checked_at=clock_timestamp()
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
