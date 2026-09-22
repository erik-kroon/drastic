-- Synthetic recurring preparation only. No rule grants posting or payment authority.
CREATE TABLE openerp.recurring_rules (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id)
);
CREATE TABLE openerp.recurring_simulations (
  book_id text NOT NULL, id text NOT NULL, rule_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), FOREIGN KEY (book_id,rule_id) REFERENCES openerp.recurring_rules
);
CREATE TABLE openerp.recurring_activations (
  book_id text NOT NULL, id text NOT NULL, rule_id text NOT NULL, simulation_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), FOREIGN KEY (book_id,rule_id) REFERENCES openerp.recurring_rules,
  FOREIGN KEY (book_id,simulation_id) REFERENCES openerp.recurring_simulations
);
CREATE TABLE openerp.recurring_deactivations (
  book_id text NOT NULL, activation_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,activation_id), FOREIGN KEY (book_id,activation_id) REFERENCES openerp.recurring_activations
);
CREATE TABLE openerp.preparation_runs (
  book_id text NOT NULL, id text NOT NULL, rule_id text NOT NULL, activation_id text NOT NULL,
  selection jsonb NOT NULL, state text NOT NULL CHECK (state IN ('ready','blocked','cancelled','completed')),
  cursor integer NOT NULL DEFAULT 0 CHECK (cursor >= 0), results jsonb NOT NULL DEFAULT '[]', blocker jsonb,
  PRIMARY KEY (book_id,id), FOREIGN KEY (book_id,rule_id) REFERENCES openerp.recurring_rules,
  FOREIGN KEY (book_id,activation_id) REFERENCES openerp.recurring_activations,
  CHECK (cursor <= jsonb_array_length(selection->'rows'))
);
CREATE TABLE openerp.preparation_run_audit (
  book_id text NOT NULL, run_id text NOT NULL, ordinal integer NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,run_id,ordinal), FOREIGN KEY (book_id,run_id) REFERENCES openerp.preparation_runs
);
CREATE TABLE openerp.recurring_preparations (
  book_id text NOT NULL, statement_id text NOT NULL, row_ordinal integer NOT NULL,
  rule_id text NOT NULL, change_set_id text NOT NULL,
  PRIMARY KEY (book_id,statement_id,row_ordinal),
  FOREIGN KEY (book_id,statement_id,row_ordinal) REFERENCES openerp.bank_observations,
  FOREIGN KEY (book_id,rule_id) REFERENCES openerp.recurring_rules,
  FOREIGN KEY (book_id,change_set_id) REFERENCES openerp.change_sets
);
CREATE TRIGGER immutable_recurring_rule BEFORE UPDATE OR DELETE ON openerp.recurring_rules FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_simulation BEFORE UPDATE OR DELETE ON openerp.recurring_simulations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_activation BEFORE UPDATE OR DELETE ON openerp.recurring_activations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_deactivation BEFORE UPDATE OR DELETE ON openerp.recurring_deactivations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_preparation_audit BEFORE UPDATE OR DELETE ON openerp.preparation_run_audit FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_preparation BEFORE UPDATE OR DELETE ON openerp.recurring_preparations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.freeze_preparation_inputs() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF TG_OP='DELETE' THEN PERFORM openerp.fail('Forbidden','Preparation runs are retained; cancel instead of deleting.'); END IF;
  IF (NEW.book_id,NEW.id,NEW.rule_id,NEW.activation_id,NEW.selection) IS DISTINCT FROM
    (OLD.book_id,OLD.id,OLD.rule_id,OLD.activation_id,OLD.selection) THEN
    PERFORM openerp.fail('Forbidden','A preparation run keeps its frozen rule, activation and observation selection.'); END IF;
  IF NEW.cursor<OLD.cursor OR jsonb_array_length(NEW.results)<>NEW.cursor OR EXISTS(
    SELECT FROM jsonb_array_elements(OLD.results) WITH ORDINALITY previous(value,ordinal)
    WHERE NEW.results->(previous.ordinal::integer-1) IS DISTINCT FROM previous.value) THEN
    PERFORM openerp.fail('Forbidden','Preparation results are append-only and the committed cursor cannot move backwards.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER frozen_preparation_inputs BEFORE UPDATE OR DELETE ON openerp.preparation_runs FOR EACH ROW EXECUTE FUNCTION openerp.freeze_preparation_inputs();

CREATE FUNCTION openerp.recurring_rule_body(book text, id text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE result jsonb;
BEGIN
  SELECT r.body INTO result FROM openerp.recurring_rules r WHERE r.book_id=book AND r.id=recurring_rule_body.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The recurring rule was not found in this book.'); END IF;
  RETURN result;
END $$;
CREATE FUNCTION openerp.recurring_dependencies_current(book text, rule jsonb) RETURNS boolean LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE dependency jsonb; current_version text;
BEGIN
  IF rule->>'digest' IS DISTINCT FROM openerp.digest(rule-'digest')
    OR NOT EXISTS(SELECT FROM openerp.books b WHERE b.id=book AND b.profile='synthetic-core-v1' AND b.authority='native') THEN RETURN false; END IF;
  FOR dependency IN SELECT value FROM jsonb_array_elements(rule->'dependencies') LOOP
    current_version := NULL;
    CASE dependency->>'kind'
      WHEN 'profile' THEN SELECT b.profile_version::text INTO current_version FROM openerp.books b WHERE b.id=book;
      WHEN 'writer_epoch' THEN SELECT b.writer_epoch::text INTO current_version FROM openerp.books b WHERE b.id=book;
      WHEN 'account' THEN SELECT a.version::text INTO current_version FROM openerp.accounts a WHERE a.book_id=book AND a.id=dependency->>'resourceId' AND a.active;
      ELSE RETURN false;
    END CASE;
    IF current_version IS DISTINCT FROM dependency->>'version' THEN RETURN false; END IF;
  END LOOP;
  RETURN EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=book AND s.account_id=rule->'input'->>'accountId'
    AND s.source_bank_account_id=rule->'input'->>'sourceBankAccountId');
END $$;
CREATE FUNCTION openerp.recurring_overlaps(book text, rule jsonb) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT coalesce(jsonb_agg(DISTINCT r.id ORDER BY r.id),'[]') FROM openerp.recurring_activations a
  JOIN openerp.recurring_rules r ON r.book_id=a.book_id AND r.id=a.rule_id
  WHERE a.book_id=book AND r.id<>rule->>'id'
    AND NOT EXISTS(SELECT FROM openerp.recurring_deactivations d WHERE d.book_id=a.book_id AND d.activation_id=a.id)
    AND r.body->'input'->>'accountId'=rule->'input'->>'accountId'
    AND (r.body->'input'->>'description') COLLATE "C"=(rule->'input'->>'description') COLLATE "C"
    AND r.body->'input'->>'sign'=rule->'input'->>'sign'
$$;
CREATE FUNCTION openerp.recurring_selection(book text, rule jsonb, input jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE starts date; ends date; selected jsonb; rule_conflicts jsonb; blockers jsonb := '[]';
  matching_count bigint; matched_count bigint; unmatched_count bigint; total numeric; revision bigint; watermark bigint;
BEGIN
  starts:=openerp.bank_date(input->>'startsOn'); ends:=openerp.bank_date(input->>'endsOn');
  IF starts>ends THEN PERFORM openerp.fail('InvalidJournal','Choose an ordered observation interval.'); END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=book AND p.starts_on<=ends AND p.ends_on>=starts ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=book AND a.id IN (rule->'input'->>'accountId',rule->'input'->>'counterpartAccountId') ORDER BY a.id FOR SHARE;
  IF NOT openerp.recurring_dependencies_current(book,rule) THEN PERFORM openerp.fail('StaleDependency','The recurring rule configuration changed. Propose a new rule.'); END IF;
  SELECT s.revision INTO STRICT revision FROM openerp.bank_sources s WHERE s.book_id=book AND s.account_id=rule->'input'->>'accountId';
  SELECT b.committed_sequence INTO STRICT watermark FROM openerp.books b WHERE b.id=book;
  SELECT count(*) INTO matching_count FROM openerp.bank_observations o JOIN openerp.bank_statements s ON s.book_id=o.book_id AND s.id=o.statement_id
    WHERE o.book_id=book AND s.account_id=rule->'input'->>'accountId' AND o.observed_on BETWEEN starts AND ends
      AND o.description COLLATE "C"=(rule->'input'->>'description') COLLATE "C"
      AND ((rule->'input'->>'sign'='positive' AND o.amount_minor>0) OR (rule->'input'->>'sign'='negative' AND o.amount_minor<0))
      AND NOT EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id=o.book_id AND m.statement_id=o.statement_id AND m.row_ordinal=o.row_ordinal);
  IF matching_count>1000 THEN PERFORM openerp.fail('InvalidJournal','Narrow the interval to at most 1000 eligible observations. No observations were dropped.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('statementId',o.statement_id,'rowOrdinal',o.row_ordinal,'evidenceId',s.evidence_id,
      'date',o.observed_on::text,'description',o.description,'amountMinor',o.amount_minor::text,
      'accountingPeriodId',p.id,'periodVersion',p.version::text) ORDER BY o.observed_on,o.statement_id,o.row_ordinal),'[]'),
    coalesce(sum(o.amount_minor),0) INTO selected,total
    FROM openerp.bank_observations o JOIN openerp.bank_statements s ON s.book_id=o.book_id AND s.id=o.statement_id
    LEFT JOIN openerp.periods p ON p.book_id=o.book_id AND o.observed_on BETWEEN p.starts_on AND p.ends_on
    WHERE o.book_id=book AND s.account_id=rule->'input'->>'accountId' AND o.observed_on BETWEEN starts AND ends
      AND o.description COLLATE "C"=(rule->'input'->>'description') COLLATE "C"
      AND ((rule->'input'->>'sign'='positive' AND o.amount_minor>0) OR (rule->'input'->>'sign'='negative' AND o.amount_minor<0))
      AND NOT EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id=o.book_id AND m.statement_id=o.statement_id AND m.row_ordinal=o.row_ordinal);
  SELECT count(*) FILTER (WHERE EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id=o.book_id AND m.statement_id=o.statement_id AND m.row_ordinal=o.row_ordinal)),
    count(*) FILTER (WHERE NOT EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id=o.book_id AND m.statement_id=o.statement_id AND m.row_ordinal=o.row_ordinal)) - matching_count
    INTO matched_count,unmatched_count FROM openerp.bank_observations o JOIN openerp.bank_statements s ON s.book_id=o.book_id AND s.id=o.statement_id
    WHERE o.book_id=book AND s.account_id=rule->'input'->>'accountId' AND o.observed_on BETWEEN starts AND ends;
  IF EXISTS(SELECT FROM jsonb_array_elements(selected) row_data WHERE row_data->>'accountingPeriodId' IS NULL) THEN
    blockers:=blockers||jsonb_build_array('Some eligible observations have no accounting period.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(selected) row_data JOIN openerp.periods p ON p.book_id=book AND p.id=row_data->>'accountingPeriodId' WHERE p.locked) THEN
    blockers:=blockers||jsonb_build_array('Some eligible observations belong to a locked accounting period.'); END IF;
  rule_conflicts:=openerp.recurring_overlaps(book,rule);
  IF jsonb_array_length(rule_conflicts)>0 THEN blockers:=blockers||jsonb_build_array('An active recurring rule has the same bank account, exact description and sign.'); END IF;
  RETURN jsonb_build_object('startsOn',starts::text,'endsOn',ends::text,'sourceRevision',revision::text,'sequence',watermark::text,
    'rows',selected,'matchingCount',matching_count,'totalMinor',total::text,'unmatchedCount',unmatched_count,
    'alreadyMatchedCount',matched_count,'overlappingRuleIds',rule_conflicts,'blockers',blockers);
END $$;

CREATE FUNCTION openerp.propose_recurring_rule(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; b openerp.books; previous jsonb; dependencies jsonb; account_dependencies jsonb; result jsonb; rule_id text:=openerp.new_id('rule');
BEGIN
  actor:=openerp.authorize(token,scope);
  SELECT * INTO STRICT b FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(b.id,key,actor,'propose_recurring_rule',input); IF previous IS NOT NULL THEN RETURN previous; END IF;
  PERFORM openerp.bank_require_profile(b.id);
  IF input-ARRAY['kind','name','sourceBankAccountId','accountId','description','sign','counterpartAccountId','series','taxAssessment']<>'{}'::jsonb
    OR jsonb_typeof(input->'sourceBankAccountId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'accountId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'counterpartAccountId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'series') IS DISTINCT FROM 'string'
    OR input->>'kind' IS DISTINCT FROM 'synthetic_recurring_preparation_v1' OR input->>'taxAssessment' IS DISTINCT FROM 'not_applicable'
    OR coalesce(input->>'sign','') NOT IN ('positive','negative') OR coalesce(input->>'series','') !~ '^[A-Z0-9]{1,16}$'
    OR jsonb_typeof(input->'description') IS DISTINCT FROM 'string' OR coalesce(length(input->>'description'),0) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(input->'name') IS DISTINCT FROM 'string' OR coalesce(length(input->>'name'),0) NOT BETWEEN 1 AND 2000
    OR input->>'accountId' IS NOT DISTINCT FROM input->>'counterpartAccountId' THEN
    PERFORM openerp.fail('InvalidJournal','Provide one exact synthetic preparation rule with distinct bank and counterpart accounts.');
  END IF;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=b.id AND a.id IN (input->>'accountId',input->>'counterpartAccountId') ORDER BY a.id FOR SHARE;
  IF (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=b.id AND a.active AND a.id IN (input->>'accountId',input->>'counterpartAccountId'))<>2
    OR NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=b.id AND s.account_id=input->>'accountId' AND s.source_bank_account_id=input->>'sourceBankAccountId') THEN
    PERFORM openerp.fail('InvalidJournal','Select a retained bank source and two active accounts in this book.');
  END IF;
  dependencies:=jsonb_build_array(
    jsonb_build_object('kind','profile','resourceId',b.id,'version',b.profile_version::text,'reason','Synthetic book currency and profile'),
    jsonb_build_object('kind','writer_epoch','resourceId',b.id,'version',b.writer_epoch::text,'reason','Native writer authority'));
  SELECT jsonb_agg(jsonb_build_object('kind','account','resourceId',a.id,'version',a.version::text,'reason','Exact recurring account configuration') ORDER BY a.id)
    INTO account_dependencies FROM openerp.accounts a WHERE a.book_id=b.id AND a.id IN (input->>'accountId',input->>'counterpartAccountId');
  result:=jsonb_build_object('id',rule_id,'version',1,'scope',scope,'input',input,'dependencies',dependencies||account_dependencies,
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'proposedBy',actor,
    'receipt',jsonb_build_object('key',key,'operation','propose_recurring_rule','actorId',actor));
  result:=result||jsonb_build_object('digest',openerp.digest(result));
  INSERT INTO openerp.recurring_rules VALUES(b.id,rule_id,result);
  RETURN openerp.save_command(b.id,key,actor,'propose_recurring_rule',input,result);
END $$;
CREATE FUNCTION openerp.get_recurring_rule(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE rule jsonb; activation jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR SHARE;
  rule:=openerp.recurring_rule_body(scope->>'bookId',id);
  SELECT a.body INTO activation FROM openerp.recurring_activations a WHERE a.book_id=scope->>'bookId' AND a.rule_id=get_recurring_rule.id
    AND NOT EXISTS(SELECT FROM openerp.recurring_deactivations d WHERE d.book_id=a.book_id AND d.activation_id=a.id);
  RETURN jsonb_build_object('rule',rule,'activeActivation',activation,'dependenciesCurrent',openerp.recurring_dependencies_current(scope->>'bookId',rule));
END $$;
CREATE FUNCTION openerp.simulate_recurring_rule(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; rule jsonb; result jsonb; simulation_id text:=openerp.new_id('simulation');
BEGIN
  actor:=openerp.authorize(token,scope);
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
CREATE FUNCTION openerp.get_recurring_simulation(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  SELECT s.body INTO result FROM openerp.recurring_simulations s WHERE s.book_id=scope->>'bookId' AND s.id=get_recurring_simulation.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The recurring simulation was not found in this book.'); END IF;
  RETURN result;
END $$;
CREATE FUNCTION openerp.activate_recurring_rule(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; rule jsonb; simulation jsonb; current_selection jsonb; result jsonb; activation_id text:=openerp.new_id('activation');
BEGIN
  actor:=openerp.authorize(token,scope,true);
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
CREATE FUNCTION openerp.deactivate_recurring_rule(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; result jsonb;
BEGIN
  actor:=openerp.authorize(token,scope,true);
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

CREATE FUNCTION openerp.recurring_require_activation(book text, activation_id text, rule_id text) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.recurring_activations a JOIN openerp.memberships m ON m.book_id=a.book_id AND m.actor_id=a.body->>'actorId' AND m.role='operator'
    WHERE a.book_id=book AND a.id=activation_id AND a.rule_id=recurring_require_activation.rule_id
      AND NOT EXISTS(SELECT FROM openerp.recurring_deactivations d WHERE d.book_id=a.book_id AND d.activation_id=a.id) FOR SHARE OF m;
  IF NOT FOUND THEN
    PERFORM openerp.fail('ApprovalRequired','The exact recurring preparation activation is inactive or its operator no longer has authority.'); END IF;
END $$;
CREATE FUNCTION openerp.preparation_run_body(run openerp.preparation_runs) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT jsonb_build_object('id',run.id,'scope',r.body->'scope','ruleId',run.rule_id,'ruleDigest',r.body->>'digest',
    'activationId',run.activation_id,'selection',run.selection,'state',run.state,'cursor',run.cursor,
    'total',jsonb_array_length(run.selection->'rows'),'results',run.results,'blocker',run.blocker,
    'requiresPostingApproval',true,'audit',(SELECT coalesce(jsonb_agg(a.body ORDER BY a.ordinal),'[]') FROM openerp.preparation_run_audit a WHERE a.book_id=run.book_id AND a.run_id=run.id))
  FROM openerp.recurring_rules r WHERE r.book_id=run.book_id AND r.id=run.rule_id
$$;
CREATE FUNCTION openerp.preparation_audit(run openerp.preparation_runs, actor text, key text, operation text, action text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE ordinal integer; entry jsonb;
BEGIN
  SELECT coalesce(max(a.ordinal),0)+1 INTO ordinal FROM openerp.preparation_run_audit a WHERE a.book_id=run.book_id AND a.run_id=run.id;
  entry:=jsonb_build_object('index',ordinal,'action',action,'state',run.state,'cursor',run.cursor,'blocker',run.blocker,
    'actorId',actor,'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation',operation,'actorId',actor));
  INSERT INTO openerp.preparation_run_audit VALUES(run.book_id,run.id,ordinal,entry);
  RETURN openerp.preparation_run_body(run);
END $$;
CREATE FUNCTION openerp.create_preparation_run(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; activation openerp.recurring_activations; rule jsonb; selection jsonb;
  run openerp.preparation_runs; result jsonb; state text; blocker jsonb;
BEGIN
  actor:=openerp.authorize(token,scope);
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
CREATE FUNCTION openerp.get_preparation_run(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE run openerp.preparation_runs;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO run FROM openerp.preparation_runs r WHERE r.book_id=scope->>'bookId' AND r.id=get_preparation_run.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The preparation run was not found in this book.'); END IF;
  RETURN openerp.preparation_run_body(run);
END $$;
CREATE FUNCTION openerp.recurring_prepare_observation(token text, scope jsonb, rule jsonb, row_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE prepared openerp.recurring_preparations; plan jsonb; voucher openerp.vouchers; period openerp.periods;
  observed_event_id text; observed_event_key text; command_key text; input jsonb; magnitude text; bank_debit text; bank_credit text;
BEGIN
  IF EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id=scope->>'bookId' AND m.statement_id=row_data->>'statementId' AND m.row_ordinal=(row_data->>'rowOrdinal')::integer) THEN
    RETURN jsonb_build_object('statementId',row_data->>'statementId','rowOrdinal',(row_data->>'rowOrdinal')::integer,
      'state','skipped_matched','changeSetId',NULL,'planDigest',NULL,'voucherId',NULL);
  END IF;
  observed_event_key:='bank_'||(row_data->>'statementId')||'_'||(row_data->>'rowOrdinal');
  SELECT e.id INTO observed_event_id FROM openerp.events e WHERE e.book_id=scope->>'bookId' AND e.evidence_id=row_data->>'evidenceId' AND e.event_key=observed_event_key;
  IF observed_event_id IS NOT NULL THEN
    SELECT * INTO voucher FROM openerp.vouchers v WHERE v.book_id=scope->>'bookId' AND v.event_id=observed_event_id AND v.posting_purpose='adjustment' AND v.occurrence_key='manual_journal';
    IF FOUND THEN
      SELECT c.plan INTO STRICT plan FROM openerp.change_sets c WHERE c.book_id=voucher.book_id AND c.id=voucher.change_set_id;
      RETURN jsonb_build_object('statementId',row_data->>'statementId','rowOrdinal',(row_data->>'rowOrdinal')::integer,
        'state','already_posted','changeSetId',voucher.change_set_id,'planDigest',plan->>'planDigest','voucherId',voucher.id);
    END IF;
  END IF;
  SELECT * INTO prepared FROM openerp.recurring_preparations p WHERE p.book_id=scope->>'bookId' AND p.statement_id=row_data->>'statementId' AND p.row_ordinal=(row_data->>'rowOrdinal')::integer;
  IF FOUND THEN
    IF prepared.rule_id<>rule->>'id' THEN PERFORM openerp.fail('InvalidJournal','This observation already has a proposal under another immutable rule. Review that proposal; no duplicate was created.'); END IF;
    SELECT c.plan INTO STRICT plan FROM openerp.change_sets c WHERE c.book_id=prepared.book_id AND c.id=prepared.change_set_id;
    PERFORM openerp.check_dependencies(scope,plan);
    RETURN jsonb_build_object('statementId',prepared.statement_id,'rowOrdinal',prepared.row_ordinal,'state','recovered',
      'changeSetId',prepared.change_set_id,'planDigest',plan->>'planDigest','voucherId',NULL);
  END IF;
  IF observed_event_id IS NOT NULL AND EXISTS(SELECT FROM openerp.change_sets c WHERE c.book_id=scope->>'bookId' AND c.plan->'groups'->0->'actions'->0->>'eventId'=observed_event_id) THEN
    PERFORM openerp.fail('InvalidJournal','This observation already has a journal proposal. Inspect its existing case instead of creating a duplicate.'); END IF;
  SELECT * INTO period FROM openerp.periods p WHERE p.book_id=scope->>'bookId' AND p.id=row_data->>'accountingPeriodId' FOR SHARE;
  IF NOT FOUND OR period.version::text IS DISTINCT FROM row_data->>'periodVersion' THEN
    PERFORM openerp.fail('StaleDependency','The frozen observation period changed or is missing. Start a new run after reviewing the period.'); END IF;
  IF period.locked THEN PERFORM openerp.fail('PeriodLocked','The observation accounting period is locked.'); END IF;
  magnitude:=abs((row_data->>'amountMinor')::numeric)::text;
  bank_debit:=CASE WHEN (row_data->>'amountMinor')::numeric>0 THEN magnitude ELSE '0' END;
  bank_credit:=CASE WHEN (row_data->>'amountMinor')::numeric<0 THEN magnitude ELSE '0' END;
  input:=jsonb_build_object('kind','manual_journal','evidenceId',row_data->>'evidenceId','eventKey',observed_event_key,
    'accountingPeriodId',period.id,'postingDate',row_data->>'date','series',rule->'input'->>'series',
    'description',row_data->>'description','rationale','Prepared by recurring rule '||(rule->>'id')||'; separate operator approval is required.',
    'taxAssessment','not_applicable','lines',jsonb_build_array(
      jsonb_build_object('accountId',rule->'input'->>'accountId','description',row_data->>'description','debitMinor',bank_debit,'creditMinor',bank_credit),
      jsonb_build_object('accountId',rule->'input'->>'counterpartAccountId','description',row_data->>'description','debitMinor',bank_credit,'creditMinor',bank_debit)));
  command_key:='auto_'||encode(sha256(convert_to(openerp.canonical(jsonb_build_object('bookId',scope->>'bookId','statementId',row_data->>'statementId','rowOrdinal',row_data->'rowOrdinal')),'UTF8')),'hex');
  plan:=openerp.prepare_journal(token,scope,command_key,input);
  INSERT INTO openerp.recurring_preparations VALUES(scope->>'bookId',row_data->>'statementId',(row_data->>'rowOrdinal')::integer,rule->>'id',plan->>'id');
  RETURN jsonb_build_object('statementId',row_data->>'statementId','rowOrdinal',(row_data->>'rowOrdinal')::integer,'state','prepared',
    'changeSetId',plan->>'id','planDigest',plan->>'planDigest','voucherId',NULL);
END $$;
CREATE FUNCTION openerp.advance_preparation_run(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; run openerp.preparation_runs; rule jsonb; result jsonb; item_result jsonb;
  payload jsonb:=jsonb_build_object('id',id,'input',input); processed integer:=0; limit_count integer; error_code text; error_message text;
BEGIN
  actor:=openerp.authorize(token,scope);
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

REVOKE ALL ON openerp.recurring_rules,openerp.recurring_simulations,openerp.recurring_activations,
  openerp.recurring_deactivations,openerp.preparation_runs,openerp.preparation_run_audit,openerp.recurring_preparations FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.freeze_preparation_inputs(),openerp.recurring_rule_body(text,text),openerp.recurring_dependencies_current(text,jsonb),openerp.recurring_overlaps(text,jsonb),
  openerp.recurring_selection(text,jsonb,jsonb),openerp.recurring_require_activation(text,text,text),
  openerp.preparation_run_body(openerp.preparation_runs),openerp.preparation_audit(openerp.preparation_runs,text,text,text,text),
  openerp.recurring_prepare_observation(text,jsonb,jsonb,jsonb),openerp.propose_recurring_rule(text,jsonb,text,jsonb),
  openerp.get_recurring_rule(text,jsonb,text),openerp.simulate_recurring_rule(text,jsonb,text,jsonb),openerp.get_recurring_simulation(text,jsonb,text),
  openerp.activate_recurring_rule(text,jsonb,text,jsonb),openerp.deactivate_recurring_rule(text,jsonb,text,jsonb),
  openerp.create_preparation_run(text,jsonb,text,jsonb),openerp.get_preparation_run(text,jsonb,text),
  openerp.advance_preparation_run(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.propose_recurring_rule(text,jsonb,text,jsonb),openerp.get_recurring_rule(text,jsonb,text),
  openerp.simulate_recurring_rule(text,jsonb,text,jsonb),openerp.get_recurring_simulation(text,jsonb,text),openerp.activate_recurring_rule(text,jsonb,text,jsonb),
  openerp.deactivate_recurring_rule(text,jsonb,text,jsonb),openerp.create_preparation_run(text,jsonb,text,jsonb),
  openerp.get_preparation_run(text,jsonb,text),openerp.advance_preparation_run(text,jsonb,text,text,jsonb) TO openerp_runtime;
