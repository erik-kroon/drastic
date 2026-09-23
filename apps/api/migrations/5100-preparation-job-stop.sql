-- Stop exactly one admitted preparation delivery identity. No run or accounting effects.
CREATE FUNCTION openerp.stop_preparation_job(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_previous jsonb; s_job openerp.preparation_jobs; s_result jsonb;
  s_outcome text:='already_terminal'; s_payload jsonb:=jsonb_build_object('jobId',p_id,'input',p_input);
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(p_scope->>'bookId',p_key,s_actor,'stop_preparation_job',s_payload);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact job-stop command object.'); END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(p_input) supplied(field) WHERE supplied.field<>'reason')
    OR p_id IS NULL OR p_id !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'reason')) NOT BETWEEN 1 AND 2000 OR length(p_input->>'reason')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Select the exact admitted job and give a reason of1–2000 characters.'); END IF;
  SELECT * INTO s_job FROM openerp.preparation_jobs j
    WHERE j.book_id=p_scope->>'bookId' AND j.id=p_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The preparation job was not found in this book.'); END IF;
  IF s_job.state='ready' THEN
    UPDATE openerp.preparation_jobs j SET state='stopped',reason=p_input->>'reason',checked_at=clock_timestamp()
      WHERE j.book_id=s_job.book_id AND j.id=s_job.id RETURNING * INTO s_job;
    s_outcome:='stopped';
  END IF;
  -- An existing terminal job is returned unchanged; the requested reason was not applied to it.
  s_result:=jsonb_build_object('job',openerp.preparation_job_body(s_job),'outcome',s_outcome,
    'receipt',jsonb_build_object('key',p_key,'operation','stop_preparation_job','actorId',s_actor));
  RETURN openerp.save_command(s_job.book_id,p_key,s_actor,'stop_preparation_job',s_payload,s_result);
END $$;
REVOKE ALL ON FUNCTION openerp.stop_preparation_job(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.stop_preparation_job(text,jsonb,text,text,jsonb) TO openerp_runtime;
