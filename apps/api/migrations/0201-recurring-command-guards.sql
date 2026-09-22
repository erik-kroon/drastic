CREATE OR REPLACE FUNCTION openerp.simulate_recurring_rule(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; rule jsonb; result jsonb; simulation_id text:=openerp.new_id('simulation');
BEGIN
  actor:=openerp.authorize(token,scope);
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact documented command object.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) supplied(field) WHERE supplied.field NOT IN ('ruleId','startsOn','endsOn')) THEN
    PERFORM openerp.fail('InvalidJournal','Unsupported command fields are not accepted. No extra posting or policy authority can be requested.');
  END IF;
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(scope->>'bookId',key,actor,'simulate_recurring_rule',input); IF previous IS NOT NULL THEN RETURN previous; END IF;
  rule:=openerp.recurring_rule_body(scope->>'bookId',input->>'ruleId');
  result:=openerp.recurring_selection(scope->>'bookId',rule,input)||jsonb_build_object('id',simulation_id,'ruleId',rule->>'id','ruleDigest',rule->>'digest',
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','simulate_recurring_rule','actorId',actor));
  result:=result||jsonb_build_object('digest',openerp.digest(result));
  INSERT INTO openerp.recurring_simulations VALUES(scope->>'bookId',simulation_id,rule->>'id',result);
  RETURN openerp.save_command(scope->>'bookId',key,actor,'simulate_recurring_rule',input,result);
END $$;

CREATE OR REPLACE FUNCTION openerp.activate_recurring_rule(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; rule jsonb; simulation jsonb; current_selection jsonb; result jsonb; activation_id text:=openerp.new_id('activation');
BEGIN
  actor:=openerp.authorize(token,scope,true);
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact documented command object.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) supplied(field) WHERE supplied.field NOT IN ('ruleId','ruleDigest','simulationId','simulationDigest')) THEN
    PERFORM openerp.fail('InvalidJournal','Unsupported command fields are not accepted. No extra posting or policy authority can be requested.');
  END IF;
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(scope->>'bookId',key,actor,'activate_recurring_rule',input); IF previous IS NOT NULL THEN RETURN previous; END IF;
  rule:=openerp.recurring_rule_body(scope->>'bookId',input->>'ruleId');
  SELECT s.body INTO simulation FROM openerp.recurring_simulations s WHERE s.book_id=scope->>'bookId' AND s.id=input->>'simulationId' AND s.rule_id=rule->>'id';
  IF simulation IS NULL THEN PERFORM openerp.fail('NotFound','Select a retained simulation for this rule.'); END IF;
  IF rule->>'digest' IS DISTINCT FROM input->>'ruleDigest' OR simulation->>'digest' IS DISTINCT FROM input->>'simulationDigest' THEN
    PERFORM openerp.fail('StaleDependency','Activate the exact rule and simulation digests reviewed by the operator.'); END IF;
  current_selection:=openerp.recurring_selection(scope->>'bookId',rule,simulation);
  -- Ignore the book watermark: unrelated postings do not change a preparation policy.
  IF current_selection-'sequence' IS DISTINCT FROM simulation-ARRAY['id','ruleId','ruleDigest','digest','createdAt','receipt','sequence'] THEN
    PERFORM openerp.fail('StaleDependency','Relevant source rows, matches, periods or active rules changed after simulation.'); END IF;
  IF jsonb_array_length(current_selection->'blockers')>0 OR (current_selection->>'matchingCount')::integer=0 THEN
    PERFORM openerp.fail('InvalidJournal','Activation needs at least one eligible observation and no simulation blockers.'); END IF;
  IF EXISTS(SELECT FROM openerp.recurring_activations a WHERE a.book_id=scope->>'bookId' AND a.rule_id=rule->>'id'
    AND NOT EXISTS(SELECT FROM openerp.recurring_deactivations d WHERE d.book_id=a.book_id AND d.activation_id=a.id)) THEN
    PERFORM openerp.fail('InvalidJournal','This recurring rule is already active.'); END IF;
  result:=input||jsonb_build_object('id',activation_id,'actorId',actor,'authority','prepare_only',
    'activatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','activate_recurring_rule','actorId',actor));
  INSERT INTO openerp.recurring_activations VALUES(scope->>'bookId',activation_id,rule->>'id',simulation->>'id',result);
  RETURN openerp.save_command(scope->>'bookId',key,actor,'activate_recurring_rule',input,result);
END $$;

CREATE OR REPLACE FUNCTION openerp.deactivate_recurring_rule(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; result jsonb;
BEGIN
  actor:=openerp.authorize(token,scope,true);
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact documented command object.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) supplied(field) WHERE supplied.field NOT IN ('activationId','reason')) THEN
    PERFORM openerp.fail('InvalidJournal','Unsupported command fields are not accepted. No extra posting or policy authority can be requested.');
  END IF;
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(scope->>'bookId',key,actor,'deactivate_recurring_rule',input); IF previous IS NOT NULL THEN RETURN previous; END IF;
  IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR coalesce(length(input->>'reason'),0) NOT BETWEEN 1 AND 2000 THEN
    PERFORM openerp.fail('InvalidJournal','Explain why this preparation policy is being deactivated.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.recurring_activations a WHERE a.book_id=scope->>'bookId' AND a.id=input->>'activationId') THEN
    PERFORM openerp.fail('NotFound','The activation was not found in this book.'); END IF;
  SELECT d.body INTO result FROM openerp.recurring_deactivations d WHERE d.book_id=scope->>'bookId' AND d.activation_id=input->>'activationId';
  IF NOT FOUND THEN
    result:=input||jsonb_build_object('actorId',actor,'deactivatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'receipt',jsonb_build_object('key',key,'operation','deactivate_recurring_rule','actorId',actor));
    INSERT INTO openerp.recurring_deactivations VALUES(scope->>'bookId',input->>'activationId',result);
  END IF;
  RETURN openerp.save_command(scope->>'bookId',key,actor,'deactivate_recurring_rule',input,result);
END $$;

CREATE OR REPLACE FUNCTION openerp.create_preparation_run(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; activation openerp.recurring_activations; rule jsonb; selection jsonb;
  run openerp.preparation_runs; result jsonb; state text; blocker jsonb;
BEGIN
  actor:=openerp.authorize(token,scope);
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact documented command object.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) supplied(field) WHERE supplied.field NOT IN ('activationId','startsOn','endsOn')) THEN
    PERFORM openerp.fail('InvalidJournal','Unsupported command fields are not accepted. No extra posting or policy authority can be requested.');
  END IF;
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(scope->>'bookId',key,actor,'create_preparation_run',input); IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO activation FROM openerp.recurring_activations a WHERE a.book_id=scope->>'bookId' AND a.id=input->>'activationId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The rule activation was not found in this book.'); END IF;
  PERFORM openerp.recurring_require_activation(activation.book_id,activation.id,activation.rule_id);
  rule:=openerp.recurring_rule_body(activation.book_id,activation.rule_id);
  selection:=openerp.recurring_selection(activation.book_id,rule,input);
  state:=CASE WHEN jsonb_array_length(selection->'blockers')>0 THEN 'blocked' WHEN jsonb_array_length(selection->'rows')=0 THEN 'completed' ELSE 'ready' END;
  IF state='blocked' THEN blocker:=jsonb_build_object('code','InvalidJournal','message',selection->'blockers'->>0); END IF;
  INSERT INTO openerp.preparation_runs(book_id,id,rule_id,activation_id,selection,state,blocker)
    VALUES(activation.book_id,openerp.new_id('run'),activation.rule_id,activation.id,selection,state,blocker) RETURNING * INTO run;
  result:=openerp.preparation_audit(run,actor,key,'create_preparation_run','create');
  RETURN openerp.save_command(run.book_id,key,actor,'create_preparation_run',input,result);
END $$;

CREATE OR REPLACE FUNCTION openerp.advance_preparation_run(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; run openerp.preparation_runs; rule jsonb; result jsonb; item_result jsonb;
  payload jsonb:=jsonb_build_object('id',id,'input',input); processed integer:=0; limit_count integer; error_code text; error_message text;
BEGIN
  actor:=openerp.authorize(token,scope);
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact documented command object.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) supplied(field) WHERE supplied.field NOT IN ('action','maxItems')) THEN
    PERFORM openerp.fail('InvalidJournal','Unsupported command fields are not accepted. No extra posting or policy authority can be requested.');
  END IF;
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(scope->>'bookId',key,actor,'advance_preparation_run',payload); IF previous IS NOT NULL THEN RETURN previous; END IF;
  IF coalesce(input->>'action','') NOT IN ('continue','cancel','resume')
    OR jsonb_typeof(input->'maxItems') IS DISTINCT FROM 'number' OR coalesce(input->>'maxItems','') !~ '^([1-9]|1[0-9]|20)$' THEN
    PERFORM openerp.fail('InvalidJournal','Choose continue, cancel or resume and an integer chunk size from 1 to 20.'); END IF;
  limit_count:=(input->>'maxItems')::integer;
  SELECT * INTO run FROM openerp.preparation_runs r WHERE r.book_id=scope->>'bookId' AND r.id=advance_preparation_run.id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The preparation run was not found in this book.'); END IF;
  IF run.state='completed' THEN
    result:=openerp.preparation_audit(run,actor,key,'advance_preparation_run',input->>'action');
    RETURN openerp.save_command(run.book_id,key,actor,'advance_preparation_run',payload,result);
  END IF;
  IF input->>'action'='cancel' THEN
    UPDATE openerp.preparation_runs r SET state='cancelled',blocker=NULL WHERE r.book_id=run.book_id AND r.id=run.id RETURNING * INTO run;
  ELSE
    IF input->>'action'='continue' AND run.state IN ('cancelled','blocked') THEN
      PERFORM openerp.fail('InvalidJournal','Use resume explicitly for a cancelled or blocked preparation run.'); END IF;
    run.state:='ready'; run.blocker:=NULL;
    rule:=openerp.recurring_rule_body(run.book_id,run.rule_id);
    BEGIN
      PERFORM openerp.recurring_require_activation(run.book_id,run.activation_id,run.rule_id);
      PERFORM 1 FROM openerp.periods p WHERE p.book_id=run.book_id AND p.id IN
        (SELECT row_data->>'accountingPeriodId' FROM jsonb_array_elements(run.selection->'rows') row_data) ORDER BY p.id FOR SHARE;
      PERFORM 1 FROM openerp.accounts a WHERE a.book_id=run.book_id AND a.id IN (rule->'input'->>'accountId',rule->'input'->>'counterpartAccountId') ORDER BY a.id FOR SHARE;
      IF NOT openerp.recurring_dependencies_current(run.book_id,rule) OR jsonb_array_length(openerp.recurring_overlaps(run.book_id,rule))>0 THEN
        PERFORM openerp.fail('StaleDependency','The recurring preparation policy configuration or active-rule set changed.'); END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS error_code=PG_EXCEPTION_DETAIL,error_message=MESSAGE_TEXT;
      IF SQLSTATE<>'P0001' OR coalesce(error_code,'') NOT IN ('Unauthorized','Forbidden','NotFound','InvalidJournal','MissingEvidence','PeriodLocked','StaleDependency','IdempotencyConflict','AlreadyPosted','ApprovalRequired','UnsupportedProfile','Unavailable','InternalError') THEN
        error_code:='InternalError'; error_message:='The preparation policy could not be checked. No pending row was processed.'; END IF;
      run.state:='blocked'; run.blocker:=jsonb_build_object('code',error_code,'message',error_message);
    END;
    WHILE run.state='ready' AND run.cursor<jsonb_array_length(run.selection->'rows') AND processed<limit_count LOOP
      BEGIN
        item_result:=openerp.recurring_prepare_observation(token,scope,rule,run.selection->'rows'->run.cursor);
        run.results:=run.results||jsonb_build_array(item_result); run.cursor:=run.cursor+1; processed:=processed+1;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS error_code=PG_EXCEPTION_DETAIL,error_message=MESSAGE_TEXT;
        IF SQLSTATE<>'P0001' OR coalesce(error_code,'') NOT IN ('Unauthorized','Forbidden','NotFound','InvalidJournal','MissingEvidence','PeriodLocked','StaleDependency','IdempotencyConflict','AlreadyPosted','ApprovalRequired','UnsupportedProfile','Unavailable','InternalError') THEN
          error_code:='InternalError'; error_message:='The preparation step failed. The observation remains pending and no partial proposal was retained.'; END IF;
        run.state:='blocked'; run.blocker:=jsonb_build_object('code',error_code,'message',error_message);
      END;
    END LOOP;
    IF run.state='ready' AND run.cursor=jsonb_array_length(run.selection->'rows') THEN run.state:='completed'; END IF;
    UPDATE openerp.preparation_runs r SET state=run.state,cursor=run.cursor,results=run.results,blocker=run.blocker
      WHERE r.book_id=run.book_id AND r.id=run.id RETURNING * INTO run;
  END IF;
  result:=openerp.preparation_audit(run,actor,key,'advance_preparation_run',input->>'action');
  RETURN openerp.save_command(run.book_id,key,actor,'advance_preparation_run',payload,result);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_recurring_rule(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE rule jsonb; activation jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR SHARE;
  rule:=openerp.recurring_rule_body(scope->>'bookId',id);
  SELECT a.body INTO activation FROM openerp.recurring_activations a WHERE a.book_id=scope->>'bookId' AND a.rule_id=get_recurring_rule.id
    AND EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=a.book_id AND m.actor_id=a.body->>'actorId' AND m.role='operator')
    AND NOT EXISTS(SELECT FROM openerp.recurring_deactivations d WHERE d.book_id=a.book_id AND d.activation_id=a.id);
  RETURN jsonb_build_object('rule',rule,'activeActivation',activation,'dependenciesCurrent',openerp.recurring_dependencies_current(scope->>'bookId',rule));
END $$;
