-- Reviewed unmatch; requires existing bank, owner and correction migrations through0890.
-- Originals remain immutable. These private projections own effective matching capacity.
CREATE TABLE openerp.bank_match_reversal_plans (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  target_key text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id)
);
CREATE TABLE openerp.bank_match_reversal_approvals (
  book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors, expires_at timestamptz NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.bank_match_reversal_plans
);
CREATE TABLE openerp.bank_match_reversal_revocations (
  book_id text NOT NULL, approval_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,approval_id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.bank_match_reversal_approvals
);
CREATE TABLE openerp.bank_match_reversals (
  book_id text NOT NULL, plan_id text NOT NULL, approval_id text NOT NULL,
  target_key text NOT NULL, allocation_plan_id text,
  statement_id text, row_ordinal integer, body jsonb NOT NULL,
  PRIMARY KEY(book_id,plan_id), UNIQUE(book_id,target_key), UNIQUE(book_id,approval_id),
  UNIQUE(book_id,allocation_plan_id), UNIQUE(book_id,statement_id,row_ordinal),
  CHECK ((allocation_plan_id IS NOT NULL AND statement_id IS NULL AND row_ordinal IS NULL)
    OR (allocation_plan_id IS NULL AND statement_id IS NOT NULL AND row_ordinal IS NOT NULL)),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.bank_match_reversal_plans,
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.bank_match_reversal_approvals,
  FOREIGN KEY(book_id,allocation_plan_id) REFERENCES openerp.bank_allocation_executions(book_id,plan_id),
  FOREIGN KEY(book_id,statement_id,row_ordinal) REFERENCES openerp.bank_matches
);
CREATE TRIGGER immutable_bank_match_reversal_plan BEFORE UPDATE OR DELETE ON openerp.bank_match_reversal_plans
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_match_reversal_approval BEFORE UPDATE OR DELETE ON openerp.bank_match_reversal_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_match_reversal_revocation BEFORE UPDATE OR DELETE ON openerp.bank_match_reversal_revocations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_match_reversal BEFORE UPDATE OR DELETE ON openerp.bank_match_reversals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE VIEW openerp.bank_active_matches AS
  SELECT m.* FROM openerp.bank_matches m WHERE NOT EXISTS (
    SELECT FROM openerp.bank_match_reversals r WHERE r.book_id=m.book_id
      AND r.statement_id=m.statement_id AND r.row_ordinal=m.row_ordinal
  );
CREATE VIEW openerp.bank_active_allocation_legs AS
  SELECT a.* FROM openerp.bank_allocation_legs a WHERE NOT EXISTS (
    SELECT FROM openerp.bank_match_reversals r WHERE r.book_id=a.book_id AND r.allocation_plan_id=a.plan_id
  );
REVOKE ALL ON openerp.bank_match_reversal_plans,openerp.bank_match_reversal_approvals,
  openerp.bank_match_reversal_revocations,openerp.bank_match_reversals,
  openerp.bank_active_matches,openerp.bank_active_allocation_legs FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.bank_match_open_periods(p_book text,p_legs jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE br_date date; br_periods jsonb;
BEGIN
  -- Caller holds the book barrier; lock all affected period rows before account rows.
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=p_book AND EXISTS (
    SELECT FROM jsonb_array_elements(p_legs) leg
    JOIN openerp.bank_observations o ON o.book_id=p_book AND o.statement_id=leg->>'statementId' AND o.row_ordinal=(leg->>'rowOrdinal')::integer
    JOIN openerp.vouchers v ON v.book_id=p_book AND v.id=leg->>'voucherId'
    WHERE o.observed_on BETWEEN p.starts_on AND p.ends_on OR v.posting_date BETWEEN p.starts_on AND p.ends_on
  ) ORDER BY p.id FOR SHARE;
  FOR br_date IN
    SELECT o.observed_on FROM jsonb_array_elements(p_legs) leg JOIN openerp.bank_observations o
      ON o.book_id=p_book AND o.statement_id=leg->>'statementId' AND o.row_ordinal=(leg->>'rowOrdinal')::integer
    UNION
    SELECT v.posting_date FROM jsonb_array_elements(p_legs) leg JOIN openerp.vouchers v
      ON v.book_id=p_book AND v.id=leg->>'voucherId'
  LOOP
    IF (SELECT count(*) FROM openerp.periods p WHERE p.book_id=p_book AND br_date BETWEEN p.starts_on AND p.ends_on)<>1 THEN
      PERFORM openerp.fail('UnsupportedProfile','Each matched source and posting date must belong to exactly one period.'); END IF;
    IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=p_book AND br_date BETWEEN p.starts_on AND p.ends_on AND p.locked) THEN
      PERFORM openerp.fail('PeriodLocked','Reopen the affected source and posting periods explicitly before changing bank matching.'); END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text) ORDER BY p.id),'[]') INTO br_periods
    FROM openerp.periods p WHERE p.book_id=p_book AND EXISTS (
      SELECT FROM jsonb_array_elements(p_legs) leg
      JOIN openerp.bank_observations o ON o.book_id=p_book AND o.statement_id=leg->>'statementId' AND o.row_ordinal=(leg->>'rowOrdinal')::integer
      JOIN openerp.vouchers v ON v.book_id=p_book AND v.id=leg->>'voucherId'
      WHERE o.observed_on BETWEEN p.starts_on AND p.ends_on OR v.posting_date BETWEEN p.starts_on AND p.ends_on
    );
  RETURN br_periods;
END $$;

CREATE FUNCTION openerp.bank_match_reversal_snapshot(p_book text,p_target jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE br_original jsonb; br_legs jsonb; br_account text; br_periods jsonb; br_capacities jsonb;
BEGIN
  IF jsonb_typeof(p_target) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Select one applied allocation or retained exact match.'); END IF;
  IF p_target->>'kind'='allocation' THEN
    IF p_target-ARRAY['kind','allocationPlanId']<>'{}'::jsonb
      OR jsonb_typeof(p_target->'allocationPlanId') IS DISTINCT FROM 'string'
      OR coalesce(p_target->>'allocationPlanId','')!~'^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select an applied allocation plan by identity.'); END IF;
    SELECT e.body,p.account_id INTO br_original,br_account FROM openerp.bank_allocation_executions e
      JOIN openerp.bank_allocation_plans p ON (p.book_id,p.id)=(e.book_id,e.plan_id)
      WHERE e.book_id=p_book AND e.plan_id=p_target->>'allocationPlanId';
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The applied allocation was not found in this book.'); END IF;
    IF (SELECT count(*) FROM openerp.bank_allocation_legs a WHERE a.book_id=p_book AND a.plan_id=p_target->>'allocationPlanId') NOT BETWEEN 1 AND 100 THEN
      PERFORM openerp.fail('UnsupportedProfile','Unmatch requires the complete bounded allocation.'); END IF;
    SELECT jsonb_agg(jsonb_build_object('statementId',a.statement_id,'rowOrdinal',a.row_ordinal,
      'voucherId',a.voucher_id,'lineId',a.line_id,'amountMinor',a.amount_minor::text) ORDER BY a.ordinal) INTO br_legs
      FROM openerp.bank_allocation_legs a WHERE a.book_id=p_book AND a.plan_id=p_target->>'allocationPlanId';
  ELSIF p_target->>'kind'='exact_match' THEN
    IF p_target-ARRAY['kind','statementId','rowOrdinal']<>'{}'::jsonb
      OR jsonb_typeof(p_target->'statementId') IS DISTINCT FROM 'string'
      OR coalesce(p_target->>'statementId','')!~'^[a-z][a-z0-9_-]{2,127}$'
      OR jsonb_typeof(p_target->'rowOrdinal') IS DISTINCT FROM 'number'
      OR coalesce(p_target->>'rowOrdinal','')!~'^[1-9][0-9]{0,4}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select a retained exact match by statement and row.'); END IF;
    IF (p_target->>'rowOrdinal')::integer>10000 THEN PERFORM openerp.fail('InvalidJournal','Choose a retained row between 1 and10000.'); END IF;
    SELECT openerp.bank_match_body(m),s.account_id,
      jsonb_build_array(jsonb_build_object('statementId',m.statement_id,'rowOrdinal',m.row_ordinal,
        'voucherId',m.voucher_id,'lineId',m.line_id,'amountMinor',o.amount_minor::text))
      INTO br_original,br_account,br_legs FROM openerp.bank_matches m
      JOIN openerp.bank_observations o ON (o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal)
      JOIN openerp.bank_statements s ON (s.book_id,s.id)=(m.book_id,m.statement_id)
      WHERE m.book_id=p_book AND m.statement_id=p_target->>'statementId' AND m.row_ordinal=(p_target->>'rowOrdinal')::integer;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained exact match was not found in this book.'); END IF;
  ELSE PERFORM openerp.fail('UnsupportedProfile','Only whole applied allocations and retained exact matches can be unmatched.'); END IF;
  IF EXISTS(SELECT FROM openerp.bank_match_reversals r WHERE r.book_id=p_book AND r.target_key=openerp.digest(p_target)) THEN
    PERFORM openerp.fail('StaleDependency','This target is already unmatched. Recover its reversal receipt.'); END IF;
  PERFORM openerp.bank_require_profile(p_book);
  br_periods:=openerp.bank_match_open_periods(p_book,br_legs);
  IF EXISTS(SELECT FROM jsonb_array_elements(br_legs) leg JOIN openerp.vouchers v ON v.book_id=p_book AND v.id=leg->>'voucherId'
    WHERE v.posting_purpose='reversal' OR EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=p_book AND r.corrects_voucher_id=v.id)) THEN
    PERFORM openerp.fail('UnsupportedProfile','A reversed or reversing voucher requires its owning correction workflow.'); END IF;
  SELECT jsonb_agg(jsonb_build_object('leg',leg,'evidenceId',s.evidence_id,'evidenceSha256',e.sha256,
    'observedOn',o.observed_on::text,'postedOn',v.posting_date::text,
    'sourceAmountMinor',o.amount_minor::text,'sourceAllocatedMinor',openerp.bank_allocated_source(p_book,o.statement_id,o.row_ordinal)::text,
    'lineAmountMinor',(l.debit_minor-l.credit_minor)::text,'lineAllocatedMinor',openerp.bank_allocated_line(p_book,l.voucher_id,l.id)::text)
    ORDER BY ord) INTO br_capacities FROM jsonb_array_elements(br_legs) WITH ORDINALITY item(leg,ord)
    JOIN openerp.bank_observations o ON o.book_id=p_book AND o.statement_id=leg->>'statementId' AND o.row_ordinal=(leg->>'rowOrdinal')::integer
    JOIN openerp.bank_statements s ON (s.book_id,s.id)=(o.book_id,o.statement_id)
    JOIN openerp.evidence e ON (e.book_id,e.id)=(s.book_id,s.evidence_id)
    JOIN openerp.journal_lines l ON l.book_id=p_book AND l.voucher_id=leg->>'voucherId' AND l.id=leg->>'lineId'
    JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.voucher_id);
  RETURN jsonb_build_object('accountId',br_account,'original',br_original,'legs',br_legs,
    'periods',br_periods,'versions',openerp.bank_allocation_versions(p_book,br_account),'capacities',br_capacities);
END $$;

CREATE FUNCTION openerp.prepare_bank_match_reversal(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE br_actor text; br_previous jsonb; br_book openerp.books; br_snapshot jsonb; br_body jsonb; br_id text:=openerp.new_id('bankunmatch');
BEGIN
  br_actor:=openerp.authorize(token,scope);
  SELECT * INTO STRICT br_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  br_previous:=openerp.replay(br_book.id,key,br_actor,'prepare_bank_match_reversal',input);
  IF br_previous IS NOT NULL THEN RETURN br_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['target','reason']<>'{}'::jsonb
    OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(input->>'reason')),0) NOT BETWEEN 1 AND 2000 OR length(input->>'reason')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Select the original match and give a nonblank unmatch reason.'); END IF;
  br_snapshot:=openerp.bank_match_reversal_snapshot(br_book.id,input->'target');
  br_body:=jsonb_build_object('id',br_id,'version',1,'scope',scope,'input',input,'snapshot',br_snapshot,
    'currency',br_book.currency,'currencyScale',br_book.currency_scale,'createdBy',br_actor,
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  br_body:=br_body||jsonb_build_object('digest',openerp.digest(br_body),
    'receipt',jsonb_build_object('key',key,'operation','prepare_bank_match_reversal','actorId',br_actor));
  INSERT INTO openerp.bank_match_reversal_plans VALUES(br_book.id,br_id,openerp.digest(input->'target'),br_body);
  RETURN openerp.save_command(br_book.id,key,br_actor,'prepare_bank_match_reversal',input,br_body);
END $$;

CREATE FUNCTION openerp.bank_match_reversal_checked(p_book text,p_id text,p_input jsonb,p_executing boolean)
RETURNS openerp.bank_match_reversal_plans LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE br_plan openerp.bank_match_reversal_plans;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_input->'version' IS DISTINCT FROM '1'::jsonb
    OR p_input-(CASE WHEN p_executing THEN ARRAY['digest','version','approvalId'] ELSE ARRAY['digest','version'] END)<>'{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Use only the saved digest, version and execution approval.'); END IF;
  SELECT * INTO br_plan FROM openerp.bank_match_reversal_plans p WHERE p.book_id=p_book AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The unmatch plan was not found in this book.'); END IF;
  IF p_input->>'digest' IS DISTINCT FROM br_plan.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Review the exact saved unmatch plan.'); END IF;
  RETURN br_plan;
END $$;

CREATE FUNCTION openerp.approve_bank_match_reversal(token text,scope jsonb,key text,id text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE br_actor text; br_previous jsonb; br_plan openerp.bank_match_reversal_plans; br_body jsonb;
  br_id text:=openerp.new_id('unmatchapproval'); br_expires timestamptz:=clock_timestamp()+interval '1 hour';
  br_request jsonb:=jsonb_build_object('planId',id,'input',input);
BEGIN
  br_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  br_previous:=openerp.replay(scope->>'bookId',key,br_actor,'approve_bank_match_reversal',br_request);
  IF br_previous IS NOT NULL THEN RETURN br_previous; END IF;
  br_plan:=openerp.bank_match_reversal_checked(scope->>'bookId',id,input,false);
  IF openerp.bank_match_reversal_snapshot(br_plan.book_id,br_plan.body->'input'->'target') IS DISTINCT FROM br_plan.body->'snapshot' THEN
    PERFORM openerp.fail('StaleDependency','Matching, periods or configuration changed. Prepare a new unmatch plan.'); END IF;
  br_body:=jsonb_build_object('id',br_id,'planId',id,'digest',input->>'digest','version',1,'actorId',br_actor,
    'expiresAt',to_char(br_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','approve_bank_match_reversal','actorId',br_actor));
  INSERT INTO openerp.bank_match_reversal_approvals VALUES(br_plan.book_id,br_id,id,br_actor,br_expires,br_body);
  RETURN openerp.save_command(br_plan.book_id,key,br_actor,'approve_bank_match_reversal',br_request,br_body);
END $$;

CREATE FUNCTION openerp.revoke_bank_match_reversal_approval(token text,scope jsonb,key text,id text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE br_actor text; br_previous jsonb; br_body jsonb; br_request jsonb:=jsonb_build_object('approvalId',id,'input',input);
BEGIN
  br_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  br_previous:=openerp.replay(scope->>'bookId',key,br_actor,'revoke_bank_match_reversal_approval',br_request);
  IF br_previous IS NOT NULL THEN RETURN br_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['reason']<>'{}'::jsonb
    OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(input->>'reason')),0) NOT BETWEEN 1 AND 2000 OR length(input->>'reason')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Give a nonblank reason for revoking this approval.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.bank_match_reversal_approvals a WHERE a.book_id=scope->>'bookId' AND a.id=revoke_bank_match_reversal_approval.id) THEN
    PERFORM openerp.fail('NotFound','The unmatch approval was not found in this book.'); END IF;
  IF EXISTS(SELECT FROM openerp.bank_match_reversals r WHERE r.book_id=scope->>'bookId' AND r.approval_id=revoke_bank_match_reversal_approval.id)
    OR EXISTS(SELECT FROM openerp.bank_match_reversal_revocations r WHERE r.book_id=scope->>'bookId' AND r.approval_id=revoke_bank_match_reversal_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','This approval is already consumed or revoked.'); END IF;
  br_body:=jsonb_build_object('approvalId',id,'reason',input->>'reason','actorId',br_actor,
    'revokedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','revoke_bank_match_reversal_approval','actorId',br_actor));
  INSERT INTO openerp.bank_match_reversal_revocations VALUES(scope->>'bookId',id,br_body);
  RETURN openerp.save_command(scope->>'bookId',key,br_actor,'revoke_bank_match_reversal_approval',br_request,br_body);
END $$;

CREATE FUNCTION openerp.execute_bank_match_reversal(token text,scope jsonb,key text,id text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE br_actor text; br_previous jsonb; br_plan openerp.bank_match_reversal_plans;
  br_approval openerp.bank_match_reversal_approvals; br_target jsonb; br_body jsonb; br_revision bigint;
  br_request jsonb:=jsonb_build_object('planId',id,'input',input);
BEGIN
  br_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  br_previous:=openerp.replay(scope->>'bookId',key,br_actor,'execute_bank_match_reversal',br_request);
  IF br_previous IS NOT NULL THEN RETURN br_previous; END IF;
  br_plan:=openerp.bank_match_reversal_checked(scope->>'bookId',id,input,true);
  SELECT r.body INTO br_body FROM openerp.bank_match_reversals r WHERE r.book_id=br_plan.book_id AND r.plan_id=execute_bank_match_reversal.id;
  IF br_body IS NOT NULL THEN
    IF br_body->>'approvalId' IS DISTINCT FROM input->>'approvalId' THEN
      PERFORM openerp.fail('ApprovalRequired','Recover the original committed unmatch approval and receipt.'); END IF;
    RETURN openerp.save_command(br_plan.book_id,key,br_actor,'execute_bank_match_reversal',br_request,br_body);
  END IF;
  br_target:=br_plan.body->'input'->'target';
  IF openerp.bank_match_reversal_snapshot(br_plan.book_id,br_target) IS DISTINCT FROM br_plan.body->'snapshot' THEN
    PERFORM openerp.fail('StaleDependency','Matching, periods or configuration changed. Prepare and approve a new plan.'); END IF;
  SELECT * INTO br_approval FROM openerp.bank_match_reversal_approvals a
    WHERE a.book_id=br_plan.book_id AND a.id=input->>'approvalId' AND a.plan_id=execute_bank_match_reversal.id FOR UPDATE;
  IF NOT FOUND OR br_approval.expires_at<=clock_timestamp() OR EXISTS(
    SELECT FROM openerp.bank_match_reversal_revocations r WHERE r.book_id=br_plan.book_id AND r.approval_id=br_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','A current, unrevoked human approval of this unmatch plan is required.'); END IF;
  PERFORM 1 FROM openerp.memberships m WHERE m.book_id=br_plan.book_id AND m.actor_id=br_approval.actor_id AND m.role='operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approving operator no longer has book authority.'); END IF;
  SELECT s.revision INTO STRICT br_revision FROM openerp.bank_sources s WHERE s.book_id=br_plan.book_id AND s.account_id=br_plan.body->'snapshot'->>'accountId';
  IF br_revision=9223372036854775807 THEN PERFORM openerp.fail('UnsupportedProfile','The bank source revision counter is exhausted.'); END IF;
  br_body:=jsonb_build_object('planId',id,'digest',input->>'digest','version',1,'approvalId',br_approval.id,
    'scope',scope,'target',br_target,'reason',br_plan.body->'input'->>'reason','accountId',br_plan.body->'snapshot'->>'accountId',
    'releasedLegs',br_plan.body->'snapshot'->'legs','sourceRevision',(br_revision+1)::text,
    'executedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','execute_bank_match_reversal','actorId',br_actor));
  INSERT INTO openerp.bank_match_reversals VALUES(br_plan.book_id,id,br_approval.id,br_plan.target_key,
    br_target->>'allocationPlanId',br_target->>'statementId',(br_target->>'rowOrdinal')::integer,br_body);
  UPDATE openerp.bank_sources SET revision=br_revision+1 WHERE book_id=br_plan.book_id AND account_id=br_plan.body->'snapshot'->>'accountId';
  RETURN openerp.save_command(br_plan.book_id,key,br_actor,'execute_bank_match_reversal',br_request,br_body);
END $$;

CREATE FUNCTION openerp.get_bank_match_reversal(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE br_plan openerp.bank_match_reversal_plans; br_approval jsonb; br_execution jsonb; br_current boolean:=false; br_error text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO br_plan FROM openerp.bank_match_reversal_plans p WHERE p.book_id=scope->>'bookId' AND p.id=get_bank_match_reversal.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The unmatch plan was not found in this book.'); END IF;
  SELECT a.body INTO br_approval FROM openerp.bank_match_reversal_approvals a JOIN openerp.memberships m
    ON m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator'
    WHERE a.book_id=br_plan.book_id AND a.plan_id=get_bank_match_reversal.id AND a.expires_at>clock_timestamp()
      AND NOT EXISTS(SELECT FROM openerp.bank_match_reversal_revocations r WHERE r.book_id=a.book_id AND r.approval_id=a.id)
    ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
  SELECT r.body INTO br_execution FROM openerp.bank_match_reversals r WHERE r.book_id=br_plan.book_id AND r.plan_id=get_bank_match_reversal.id;
  IF br_execution IS NULL THEN
    BEGIN br_current:=openerp.bank_match_reversal_snapshot(br_plan.book_id,br_plan.body->'input'->'target')=br_plan.body->'snapshot';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS br_error=PG_EXCEPTION_DETAIL;
      IF br_error IS NULL OR br_error NOT IN ('StaleDependency','PeriodLocked','UnsupportedProfile','NotFound') THEN RAISE; END IF;
    END;
  END IF;
  RETURN jsonb_build_object('plan',br_plan.body,'approval',CASE WHEN br_execution IS NULL THEN br_approval ELSE NULL END,
    'execution',br_execution,'dependenciesCurrent',br_current);
END $$;

CREATE FUNCTION openerp.list_bank_match_reversals(token text,scope jsonb,after_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE br_items jsonb; br_last text; br_next text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF after_id IS NOT NULL AND after_id!~'^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use the returned unmatch continuation identity.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'target',p.body->'input'->'target','reason',p.body->'input'->>'reason',
    'createdAt',p.body->>'createdAt','execution',r.body) ORDER BY p.id COLLATE "C"),'[]'),max(p.id COLLATE "C") INTO br_items,br_last
    FROM (SELECT x.* FROM openerp.bank_match_reversal_plans x WHERE x.book_id=scope->>'bookId'
      AND (after_id IS NULL OR x.id COLLATE "C">after_id COLLATE "C") ORDER BY x.id COLLATE "C" LIMIT 25) p
    LEFT JOIN openerp.bank_match_reversals r ON (r.book_id,r.plan_id)=(p.book_id,p.id);
  IF EXISTS(SELECT FROM openerp.bank_match_reversal_plans p WHERE p.book_id=scope->>'bookId' AND p.id COLLATE "C">br_last COLLATE "C") THEN br_next:=br_last; END IF;
  RETURN jsonb_build_object('items',br_items,'next',br_next);
END $$;

REVOKE ALL ON FUNCTION openerp.bank_match_open_periods(text,jsonb),openerp.bank_match_reversal_snapshot(text,jsonb),
  openerp.bank_match_reversal_checked(text,text,jsonb,boolean),openerp.prepare_bank_match_reversal(text,jsonb,text,jsonb),
  openerp.approve_bank_match_reversal(text,jsonb,text,text,jsonb),openerp.revoke_bank_match_reversal_approval(text,jsonb,text,text,jsonb),
  openerp.execute_bank_match_reversal(text,jsonb,text,text,jsonb),openerp.get_bank_match_reversal(text,jsonb,text),
  openerp.list_bank_match_reversals(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_bank_match_reversal(text,jsonb,text,jsonb),openerp.approve_bank_match_reversal(text,jsonb,text,text,jsonb),
  openerp.revoke_bank_match_reversal_approval(text,jsonb,text,text,jsonb),openerp.execute_bank_match_reversal(text,jsonb,text,text,jsonb),
  openerp.get_bank_match_reversal(text,jsonb,text),openerp.list_bank_match_reversals(text,jsonb,text) TO openerp_runtime;

-- Forward replacements use only live relationships; historical tables and saved bodies stay unchanged.

CREATE OR REPLACE FUNCTION openerp.bank_allocated_source(book text, statement text, ordinal integer) RETURNS numeric
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT coalesce((SELECT o.amount_minor FROM openerp.bank_active_matches m JOIN openerp.bank_observations o
    ON (o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal)
    WHERE m.book_id=bank_allocated_source.book AND m.statement_id=bank_allocated_source.statement AND m.row_ordinal=bank_allocated_source.ordinal),0)
    + coalesce((SELECT sum(a.amount_minor) FROM openerp.bank_active_allocation_legs a
      WHERE a.book_id=bank_allocated_source.book AND a.statement_id=bank_allocated_source.statement AND a.row_ordinal=bank_allocated_source.ordinal),0)
$$;

CREATE OR REPLACE FUNCTION openerp.bank_allocated_line(book text, voucher text, line text) RETURNS numeric
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT coalesce((SELECT l.debit_minor-l.credit_minor FROM openerp.bank_active_matches m JOIN openerp.journal_lines l
    ON (l.book_id,l.voucher_id,l.id)=(m.book_id,m.voucher_id,m.line_id)
    WHERE m.book_id=bank_allocated_line.book AND m.voucher_id=bank_allocated_line.voucher AND m.line_id=bank_allocated_line.line),0)
    + coalesce((SELECT sum(a.amount_minor) FROM openerp.bank_active_allocation_legs a
      WHERE a.book_id=bank_allocated_line.book AND a.voucher_id=bank_allocated_line.voucher AND a.line_id=bank_allocated_line.line),0)
$$;

CREATE OR REPLACE FUNCTION openerp.bank_exact_match_capacity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books WHERE id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.bank_active_allocation_legs a WHERE a.book_id=NEW.book_id AND
    ((a.statement_id=NEW.statement_id AND a.row_ordinal=NEW.row_ordinal) OR
     (a.voucher_id=NEW.voucher_id AND a.line_id=NEW.line_id))) THEN
    PERFORM openerp.fail('InvalidJournal','Partial bank capacity is already allocated. Use a reviewed allocation plan for the remainder.');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION openerp.get_bank_statement(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE statement openerp.bank_statements; matches jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE books.id = scope->>'bookId' FOR SHARE;
  SELECT * INTO statement FROM openerp.bank_statements s WHERE s.book_id = scope->>'bookId' AND s.id = get_bank_statement.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound', 'The bank statement was not found in this book.'); END IF;
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(ROW(m.*)::openerp.bank_matches) ORDER BY m.row_ordinal), '[]') INTO matches
    FROM openerp.bank_active_matches m WHERE m.book_id = statement.book_id AND m.statement_id = statement.id;
  RETURN jsonb_build_object('statement', openerp.bank_statement_body(statement), 'matches', matches,
    'checkpoint', openerp.bank_checkpoint(statement.book_id, statement.account_id));
END $$;

CREATE OR REPLACE FUNCTION openerp.reconcile_bank(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; b openerp.books; account text := input->>'accountId';
  starts date; ends date; statement openerp.bank_statements; last_end date; last_closing numeric;
  bank_open numeric; bank_close numeric; ledger_open numeric; ledger_close numeric;
  watermark bigint; account_sequence bigint; source_revision bigint;
  statements jsonb := '[]'; observations jsonb; ledger_lines jsonb; matches jsonb;
  unmatched_source jsonb; unmatched_ledger jsonb; differences jsonb := '[]'; gaps jsonb := '[]';
  result jsonb; report_id text := openerp.new_id('reconciliation'); report_status text;
BEGIN
  actor := openerp.authorize(token, scope);
  SELECT * INTO STRICT b FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(b.id, key, actor, 'reconcile_bank', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  PERFORM openerp.bank_require_profile(b.id);
  starts := openerp.bank_date(input->>'startsOn'); ends := openerp.bank_date(input->>'endsOn');
  IF starts > ends OR NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id = b.id AND a.id = account) THEN
    PERFORM openerp.fail('InvalidJournal', 'Choose a book account and an ordered date interval.');
  END IF;
  -- Partial statements cannot establish independent opening/closing checkpoints.
  IF EXISTS(SELECT FROM openerp.bank_statements s WHERE s.book_id = b.id AND s.account_id = account
    AND s.starts_on <= ends AND s.ends_on >= starts AND (s.starts_on < starts OR s.ends_on > ends)) THEN
    PERFORM openerp.fail('InvalidJournal', 'The report cuts through a statement. Use whole statement intervals; unsupported splits cannot prove coverage.');
  END IF;
  -- This synchronous report materializes every selected row; never return a partial report.
  IF (SELECT count(*) FROM (
    SELECT 1 FROM openerp.bank_observations o JOIN openerp.bank_statements s
      ON s.book_id=o.book_id AND s.id=o.statement_id
      WHERE s.book_id=b.id AND s.account_id=account AND s.starts_on>=starts AND s.ends_on<=ends
    UNION ALL
    SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
      WHERE l.book_id=b.id AND l.account_id=account AND v.posting_date BETWEEN starts AND ends
      AND v.sequence<=b.committed_sequence
    LIMIT 1001
  ) selected_rows)>1000 OR (SELECT count(*) FROM (
    SELECT 1 FROM openerp.bank_statements s WHERE s.book_id=b.id AND s.account_id=account
      AND s.starts_on>=starts AND s.ends_on<=ends LIMIT 101
  ) selected_statements)>100 THEN
    PERFORM openerp.fail('InvalidJournal', 'This synchronous reconciliation supports at most 1000 combined source/ledger rows and 100 statements. Select a smaller whole-statement interval; larger durable reports are not implemented.');
  END IF;
  watermark := b.committed_sequence;
  SELECT coalesce(s.revision, 0) INTO source_revision FROM openerp.bank_sources s WHERE s.book_id = b.id AND s.account_id = account;
  source_revision := coalesce(source_revision, 0);
  FOR statement IN SELECT s.* FROM openerp.bank_statements s WHERE s.book_id = b.id AND s.account_id = account
    AND s.starts_on >= starts AND s.ends_on <= ends ORDER BY s.starts_on, s.id LOOP
    statements := statements || jsonb_build_array(openerp.bank_statement_body(statement));
    IF last_end IS NULL THEN
      bank_open := (statement.source->>'openingMinor')::numeric;
      IF statement.starts_on <> starts THEN gaps := gaps || jsonb_build_array('No statement covers the start of the requested interval.'); END IF;
    ELSE
      IF statement.starts_on <> last_end + 1 THEN gaps := gaps || jsonb_build_array('There is a gap between retained statement intervals.'); END IF;
      IF (statement.source->>'openingMinor')::numeric <> last_closing THEN
        differences := differences || jsonb_build_array('Consecutive statement closing and opening balances differ.');
      END IF;
    END IF;
    IF statement.source->'completeness'->>'declaredComplete' <> 'true' THEN
      gaps := gaps || jsonb_build_array('Statement ' || statement.id || ' is explicitly declared incomplete.');
    END IF;
    bank_close := (statement.source->>'closingMinor')::numeric;
    last_closing := bank_close; last_end := statement.ends_on;
  END LOOP;
  IF last_end IS NULL THEN gaps := gaps || jsonb_build_array('No bank statement covers this interval.');
  ELSIF last_end <> ends THEN gaps := gaps || jsonb_build_array('No statement covers the end of the requested interval.'); END IF;

  SELECT coalesce(sum(l.debit_minor - l.credit_minor) FILTER (WHERE v.posting_date < starts), 0),
    coalesce(sum(l.debit_minor - l.credit_minor), 0), coalesce(max(v.sequence), 0)
    INTO ledger_open, ledger_close, account_sequence
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = b.id AND l.account_id = account AND v.posting_date <= ends AND v.sequence <= watermark;
  SELECT coalesce(jsonb_agg(jsonb_build_object('statementId', o.statement_id, 'evidenceId', s.evidence_id,
      'evidenceSha256', e.sha256, 'rowOrdinal', o.row_ordinal, 'providerId', o.provider_id,
      'date', o.observed_on::text, 'description', o.description, 'amountMinor', o.amount_minor::text)
      ORDER BY s.starts_on, o.row_ordinal), '[]') INTO observations
    FROM openerp.bank_observations o JOIN openerp.bank_statements s ON s.book_id = o.book_id AND s.id = o.statement_id
    JOIN openerp.evidence e ON e.book_id = s.book_id AND e.id = s.evidence_id
    WHERE s.book_id = b.id AND s.account_id = account AND s.starts_on >= starts AND s.ends_on <= ends;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId', v.id, 'lineId', l.id,
      'date', v.posting_date::text, 'sequence', v.sequence::text, 'description', l.description,
      'amountMinor', (l.debit_minor - l.credit_minor)::text) ORDER BY v.sequence, l.ordinal), '[]') INTO ledger_lines
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = b.id AND l.account_id = account AND v.posting_date BETWEEN starts AND ends AND v.sequence <= watermark;
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(ROW(m.*)::openerp.bank_matches) ORDER BY s.starts_on, m.row_ordinal), '[]') INTO matches
    FROM openerp.bank_active_matches m JOIN openerp.bank_statements s ON s.book_id = m.book_id AND s.id = m.statement_id
    WHERE s.book_id = b.id AND s.account_id = account AND s.starts_on >= starts AND s.ends_on <= ends;
  SELECT coalesce(jsonb_agg(o.value ORDER BY o.ordinal), '[]') INTO unmatched_source
    FROM jsonb_array_elements(observations) WITH ORDINALITY o(value, ordinal)
    WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(matches) m WHERE m->>'statementId' = o.value->>'statementId' AND m->>'rowOrdinal' = o.value->>'rowOrdinal');
  SELECT coalesce(jsonb_agg(l.value ORDER BY l.ordinal), '[]') INTO unmatched_ledger
    FROM jsonb_array_elements(ledger_lines) WITH ORDINALITY l(value, ordinal)
    WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(matches) m WHERE m->>'voucherId' = l.value->>'voucherId' AND m->>'lineId' = l.value->>'lineId');
  IF bank_open IS NULL OR bank_close IS NULL THEN
    differences := differences || jsonb_build_array('Bank opening and closing balances are unavailable.');
  ELSE
    IF bank_open <> ledger_open THEN differences := differences || jsonb_build_array('The bank and ledger opening balances differ.'); END IF;
    IF bank_close <> ledger_close THEN differences := differences || jsonb_build_array('The bank and ledger closing balances differ.'); END IF;
  END IF;
  IF jsonb_array_length(unmatched_source) > 0 THEN differences := differences || jsonb_build_array('Retained bank observations have no exact posted-line match.'); END IF;
  IF jsonb_array_length(unmatched_ledger) > 0 THEN differences := differences || jsonb_build_array('Posted bank lines have no retained source match.'); END IF;
  report_status := CASE WHEN jsonb_array_length(differences) > 0 THEN 'differences'
    WHEN jsonb_array_length(gaps) > 0 THEN 'balanced_but_incomplete' ELSE 'complete' END;
  result := jsonb_build_object('id', report_id, 'scope', scope, 'accountId', account, 'currency', b.currency,
    'startsOn', starts::text, 'endsOn', ends::text, 'status', report_status,
    'checkpoint', jsonb_build_object('sequence', watermark::text, 'sourceRevision', source_revision::text),
    'accountLedgerSequence', account_sequence::text,
    'ledgerOpeningMinor', ledger_open::text, 'ledgerClosingMinor', ledger_close::text,
    'bankOpeningMinor', bank_open::text, 'bankClosingMinor', bank_close::text,
    'openingDifferenceMinor', (bank_open - ledger_open)::text, 'closingDifferenceMinor', (bank_close - ledger_close)::text,
    'sourceCoverageComplete', jsonb_array_length(gaps) = 0,
    'statements', statements, 'sourceRows', observations, 'ledgerLines', ledger_lines, 'matches', matches,
    'unmatchedSource', unmatched_source, 'unmatchedLedger', unmatched_ledger, 'differences', differences, 'coverageGaps', gaps,
    'receipt', jsonb_build_object('key', key, 'operation', 'reconcile_bank', 'actorId', actor),
    'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.bank_reconciliations VALUES(b.id, report_id, account, result);
  RETURN openerp.save_command(b.id, key, actor, 'reconcile_bank', input, result);
END $$;

CREATE OR REPLACE FUNCTION openerp.reconcile_bank_capacity(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE bc_actor text; bc_previous jsonb; bc_b openerp.books; bc_account text := input->>'accountId';
  bc_starts date; bc_ends date; bc_statement openerp.bank_statements; bc_last_end date; bc_last_closing numeric;
  bc_bank_open numeric; bc_bank_close numeric; bc_ledger_open numeric; bc_ledger_close numeric;
  bc_watermark bigint; bc_account_sequence bigint; bc_source_revision bigint;
  bc_statements jsonb := '[]'; bc_observations jsonb; bc_ledger_lines jsonb; bc_matches jsonb;
  bc_unmatched_source jsonb; bc_unmatched_ledger jsonb; bc_differences jsonb := '[]'; bc_gaps jsonb := '[]';
  bc_result jsonb; bc_report_id text := openerp.new_id('bankcapacity'); bc_report_status text; bc_allocations jsonb;
BEGIN
  bc_actor := openerp.authorize(token, scope);
  SELECT * INTO STRICT bc_b FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  bc_previous := openerp.replay(bc_b.id, key, bc_actor, 'reconcile_bank_capacity', input);
  IF bc_previous IS NOT NULL THEN RETURN bc_previous; END IF;
  PERFORM openerp.bank_require_profile(bc_b.id);
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Provide a bank account and whole-statement interval.'); END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN ('accountId','startsOn','endsOn')) THEN
    PERFORM openerp.fail('InvalidJournal','Unexpected reconciliation field.'); END IF;
  bc_starts := openerp.bank_date(input->>'startsOn'); bc_ends := openerp.bank_date(input->>'endsOn');
  IF bc_starts > bc_ends OR NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id = bc_b.id AND a.id = bc_account) THEN
    PERFORM openerp.fail('InvalidJournal', 'Choose a book account and an ordered date interval.');
  END IF;
  -- Partial statements cannot establish independent opening/closing checkpoints.
  IF EXISTS(SELECT FROM openerp.bank_statements s WHERE s.book_id = bc_b.id AND s.account_id = bc_account
    AND s.starts_on <= bc_ends AND s.ends_on >= bc_starts AND (s.starts_on < bc_starts OR s.ends_on > bc_ends)) THEN
    PERFORM openerp.fail('InvalidJournal', 'The report cuts through a statement. Use whole statement intervals; unsupported splits cannot prove coverage.');
  END IF;
  -- This synchronous report materializes every selected row; never return a partial report.
  IF (SELECT count(*) FROM (
    SELECT 1 FROM openerp.bank_observations o JOIN openerp.bank_statements s
      ON s.book_id=o.book_id AND s.id=o.statement_id
      WHERE s.book_id=bc_b.id AND s.account_id=bc_account AND s.starts_on>=bc_starts AND s.ends_on<=bc_ends
    UNION ALL
    SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
      WHERE l.book_id=bc_b.id AND l.account_id=bc_account AND v.posting_date BETWEEN bc_starts AND bc_ends
      AND v.sequence<=bc_b.committed_sequence
    LIMIT 1001
  ) selected_rows)>1000 OR (SELECT count(*) FROM (
    SELECT 1 FROM openerp.bank_statements s WHERE s.book_id=bc_b.id AND s.account_id=bc_account
      AND s.starts_on>=bc_starts AND s.ends_on<=bc_ends LIMIT 101
  ) selected_statements)>100 THEN
    PERFORM openerp.fail('InvalidJournal', 'This synchronous reconciliation supports at most 1000 combined source/ledger rows and 100 statements. Select a smaller whole-statement interval; larger durable reports are not implemented.');
  END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.bank_active_allocation_legs a JOIN openerp.bank_statements s
    ON (s.book_id,s.id)=(a.book_id,a.statement_id) WHERE s.book_id=bc_b.id AND s.account_id=bc_account
    AND s.starts_on>=bc_starts AND s.ends_on<=bc_ends LIMIT 1001) selected_allocations)>1000 THEN
    PERFORM openerp.fail('InvalidJournal','This synchronous capacity report supports at most 1000 allocation legs. Larger reports are not implemented.');
  END IF;
  bc_watermark := bc_b.committed_sequence;
  SELECT coalesce(s.revision, 0) INTO bc_source_revision FROM openerp.bank_sources s WHERE s.book_id = bc_b.id AND s.account_id = bc_account;
  bc_source_revision := coalesce(bc_source_revision, 0);
  FOR bc_statement IN SELECT s.* FROM openerp.bank_statements s WHERE s.book_id = bc_b.id AND s.account_id = bc_account
    AND s.starts_on >= bc_starts AND s.ends_on <= bc_ends ORDER BY s.starts_on, s.id LOOP
    bc_statements := bc_statements || jsonb_build_array(openerp.bank_statement_body(bc_statement));
    IF bc_last_end IS NULL THEN
      bc_bank_open := (bc_statement.source->>'openingMinor')::numeric;
      IF bc_statement.starts_on <> bc_starts THEN bc_gaps := bc_gaps || jsonb_build_array('No statement covers the start of the requested interval.'); END IF;
    ELSE
      IF bc_statement.starts_on <> bc_last_end + 1 THEN bc_gaps := bc_gaps || jsonb_build_array('There is a gap between retained statement intervals.'); END IF;
      IF (bc_statement.source->>'openingMinor')::numeric <> bc_last_closing THEN
        bc_differences := bc_differences || jsonb_build_array('Consecutive statement closing and opening balances differ.');
      END IF;
    END IF;
    IF bc_statement.source->'completeness'->>'declaredComplete' <> 'true' THEN
      bc_gaps := bc_gaps || jsonb_build_array('Statement ' || bc_statement.id || ' is explicitly declared incomplete.');
    END IF;
    bc_bank_close := (bc_statement.source->>'closingMinor')::numeric;
    bc_last_closing := bc_bank_close; bc_last_end := bc_statement.ends_on;
  END LOOP;
  IF bc_last_end IS NULL THEN bc_gaps := bc_gaps || jsonb_build_array('No bank statement covers this interval.');
  ELSIF bc_last_end <> bc_ends THEN bc_gaps := bc_gaps || jsonb_build_array('No statement covers the end of the requested interval.'); END IF;

  SELECT coalesce(sum(l.debit_minor - l.credit_minor) FILTER (WHERE v.posting_date < bc_starts), 0),
    coalesce(sum(l.debit_minor - l.credit_minor), 0), coalesce(max(v.sequence), 0)
    INTO bc_ledger_open, bc_ledger_close, bc_account_sequence
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = bc_b.id AND l.account_id = bc_account AND v.posting_date <= bc_ends AND v.sequence <= bc_watermark;
  SELECT coalesce(jsonb_agg(jsonb_build_object('statementId', o.statement_id, 'evidenceId', s.evidence_id,
      'evidenceSha256', e.sha256, 'rowOrdinal', o.row_ordinal, 'providerId', o.provider_id,
      'date', o.observed_on::text, 'description', o.description, 'amountMinor', o.amount_minor::text, 'allocatedMinor', openerp.bank_allocated_source(bc_b.id,o.statement_id,o.row_ordinal)::text,
      'remainingMinor', (o.amount_minor-openerp.bank_allocated_source(bc_b.id,o.statement_id,o.row_ordinal))::text)
      ORDER BY s.starts_on, o.row_ordinal), '[]') INTO bc_observations
    FROM openerp.bank_observations o JOIN openerp.bank_statements s ON s.book_id = o.book_id AND s.id = o.statement_id
    JOIN openerp.evidence e ON e.book_id = s.book_id AND e.id = s.evidence_id
    WHERE s.book_id = bc_b.id AND s.account_id = bc_account AND s.starts_on >= bc_starts AND s.ends_on <= bc_ends;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId', v.id, 'lineId', l.id,
      'date', v.posting_date::text, 'sequence', v.sequence::text, 'description', l.description,
      'amountMinor', (l.debit_minor - l.credit_minor)::text, 'allocatedMinor', openerp.bank_allocated_line(bc_b.id,l.voucher_id,l.id)::text,
      'remainingMinor', (l.debit_minor-l.credit_minor-openerp.bank_allocated_line(bc_b.id,l.voucher_id,l.id))::text) ORDER BY v.sequence, l.ordinal), '[]') INTO bc_ledger_lines
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = bc_b.id AND l.account_id = bc_account AND v.posting_date BETWEEN bc_starts AND bc_ends AND v.sequence <= bc_watermark;
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(ROW(m.*)::openerp.bank_matches) ORDER BY s.starts_on, m.row_ordinal), '[]') INTO bc_matches
    FROM openerp.bank_active_matches m JOIN openerp.bank_statements s ON s.book_id = m.book_id AND s.id = m.statement_id
    WHERE s.book_id = bc_b.id AND s.account_id = bc_account AND s.starts_on >= bc_starts AND s.ends_on <= bc_ends;
  SELECT coalesce(jsonb_agg(o.value ORDER BY o.ordinal), '[]') INTO bc_unmatched_source
    FROM jsonb_array_elements(bc_observations) WITH ORDINALITY o(value, ordinal)
    WHERE (o.value->>'remainingMinor')::numeric<>0;
  SELECT coalesce(jsonb_agg(l.value ORDER BY l.ordinal), '[]') INTO bc_unmatched_ledger
    FROM jsonb_array_elements(bc_ledger_lines) WITH ORDINALITY l(value, ordinal)
    WHERE (l.value->>'remainingMinor')::numeric<>0;
  IF bc_bank_open IS NULL OR bc_bank_close IS NULL THEN
    bc_differences := bc_differences || jsonb_build_array('Bank opening and closing balances are unavailable.');
  ELSE
    IF bc_bank_open <> bc_ledger_open THEN bc_differences := bc_differences || jsonb_build_array('The bank and ledger opening balances differ.'); END IF;
    IF bc_bank_close <> bc_ledger_close THEN bc_differences := bc_differences || jsonb_build_array('The bank and ledger closing balances differ.'); END IF;
  END IF;
  IF jsonb_array_length(bc_unmatched_source) > 0 THEN bc_differences := bc_differences || jsonb_build_array('Retained bank observations have unallocated residual amounts.'); END IF;
  IF jsonb_array_length(bc_unmatched_ledger) > 0 THEN bc_differences := bc_differences || jsonb_build_array('Posted bank lines have unallocated residual amounts.'); END IF;
  bc_report_status := CASE WHEN jsonb_array_length(bc_differences) > 0 THEN 'differences'
    WHEN jsonb_array_length(bc_gaps) > 0 THEN 'balanced_but_incomplete' ELSE 'complete' END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('planId',a.plan_id,'ordinal',a.ordinal,'statementId',a.statement_id,
      'rowOrdinal',a.row_ordinal,'voucherId',a.voucher_id,'lineId',a.line_id,'amountMinor',a.amount_minor::text)
      ORDER BY a.plan_id,a.ordinal),'[]') INTO bc_allocations FROM openerp.bank_active_allocation_legs a JOIN openerp.bank_statements s
      ON (s.book_id,s.id)=(a.book_id,a.statement_id) WHERE s.book_id=bc_b.id AND s.account_id=bc_account AND s.starts_on>=bc_starts AND s.ends_on<=bc_ends;
  bc_result := jsonb_build_object('schemaVersion','bank-capacity-v2','allocations',bc_allocations,'currencyScale',bc_b.currency_scale,'id', bc_report_id, 'scope', scope, 'accountId', bc_account, 'currency', bc_b.currency,
    'startsOn', bc_starts::text, 'endsOn', bc_ends::text, 'status', bc_report_status,
    'checkpoint', jsonb_build_object('sequence', bc_watermark::text, 'sourceRevision', bc_source_revision::text),
    'accountLedgerSequence', bc_account_sequence::text,
    'ledgerOpeningMinor', bc_ledger_open::text, 'ledgerClosingMinor', bc_ledger_close::text,
    'bankOpeningMinor', bc_bank_open::text, 'bankClosingMinor', bc_bank_close::text,
    'openingDifferenceMinor', (bc_bank_open - bc_ledger_open)::text, 'closingDifferenceMinor', (bc_bank_close - bc_ledger_close)::text,
    'sourceCoverageComplete', jsonb_array_length(bc_gaps) = 0,
    'statements', bc_statements, 'sourceRows', bc_observations, 'ledgerLines', bc_ledger_lines, 'matches', bc_matches,
    'unmatchedSource', bc_unmatched_source, 'unmatchedLedger', bc_unmatched_ledger, 'differences', bc_differences, 'coverageGaps', bc_gaps,
    'receipt', jsonb_build_object('key', key, 'operation', 'reconcile_bank_capacity', 'actorId', bc_actor),
    'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.bank_capacity_reconciliations VALUES(bc_b.id, bc_report_id, bc_account, bc_result);
  RETURN openerp.save_command(bc_b.id, key, bc_actor, 'reconcile_bank_capacity', input, bc_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.owner_guard_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE v_voucher text; v_line text;
BEGIN
 PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
 IF TG_TABLE_NAME='owner_effects' THEN
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=NEW.book_id AND i.recognition_voucher_id=NEW.voucher_id AND i.recognition_line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.commerce_allocation_legs l WHERE l.book_id=NEW.book_id AND l.payment_voucher_id=NEW.voucher_id AND l.payment_line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.bank_active_matches m WHERE m.book_id=NEW.book_id AND m.voucher_id=NEW.voucher_id AND m.line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.bank_active_allocation_legs l WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.line_id=NEW.line_id) THEN
   PERFORM openerp.fail('StaleDependency','This posted line is already used by commerce or bank matching.'); END IF;
 ELSE
  IF TG_TABLE_NAME='commerce_invoices' THEN v_voucher:=NEW.recognition_voucher_id; v_line:=NEW.recognition_line_id;
  ELSIF TG_TABLE_NAME='commerce_allocation_legs' THEN v_voucher:=NEW.payment_voucher_id; v_line:=NEW.payment_line_id;
  ELSE v_voucher:=NEW.voucher_id; v_line:=NEW.line_id; END IF;
  IF EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=NEW.book_id AND e.voucher_id=v_voucher AND e.line_id=v_line) THEN PERFORM openerp.fail('StaleDependency','This posted control line already belongs to an owner source.'); END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION openerp.correction_impact_resources(p_book text,p_voucher text,p_date date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_resources jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.id,'detail',r.detail,'path',r.path,'blocks',r.blocks)
      ORDER BY r.kind,r.id,r.detail),'[]') INTO ci_resources FROM (
    SELECT 'bank_match' kind,m.statement_id id,'Retained bank match: row '||m.row_ordinal::text||', line '||m.line_id||'. Unmatch this active relationship before correcting the voucher.' detail,
      '/bank-statements/'||m.statement_id path,true blocks FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',a.plan_id,'Applied bank allocation: row '||a.row_ordinal::text||', line '||a.line_id||'. Unmatch this active allocation before correcting the voucher.',
      '/bank-allocation-plans/'||a.plan_id,true FROM openerp.bank_active_allocation_legs a WHERE a.book_id=p_book AND a.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',p.id,'Unexecuted bank allocation plan references this voucher. It must revalidate after any correction.',
      '/bank-allocation-plans/'||p.id,false FROM openerp.bank_allocation_plans p WHERE p.book_id=p_book
      AND NOT EXISTS(SELECT FROM openerp.bank_allocation_executions e WHERE e.book_id=p.book_id AND e.plan_id=p.id)
      AND EXISTS(SELECT FROM jsonb_array_elements(p.input->'legs') item(leg) WHERE leg->>'voucherId'=p_voucher)
    UNION ALL SELECT 'invoice',i.id,'Registered invoice recognition, line '||i.recognition_line_id||'. Use the commerce owner; generic release is unavailable.',
      '/commerce/invoices/'||i.id,true FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',a.receipt_id,'Applied invoice payment, invoice '||a.invoice_id||', line '||a.payment_line_id||'. Allocation compensation is unavailable.',
      '/commerce/invoices/'||a.invoice_id,true FROM openerp.commerce_allocation_legs a WHERE a.book_id=p_book AND a.payment_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',p.id,'Unapplied commerce payment plan references this voucher. Its owner must revalidate the plan; this review does not release capacity.',
      '/commerce/allocation-plans/'||p.id,false FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_book
      AND p.body->'payment'->>'voucherId'=p_voucher
      AND NOT EXISTS(SELECT FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p.book_id AND r.plan_id=p.id)
    UNION ALL SELECT DISTINCT 'schedule',s.schedule_id,'Represented schedule occurrence '||s.ordinal::text||'. Posted-occurrence compensation is unavailable.',
      '/schedules/'||s.schedule_id,true FROM openerp.subledger_preparations s JOIN openerp.change_sets c ON c.book_id=s.book_id AND c.id=s.change_set_id
      JOIN openerp.vouchers v ON v.book_id=s.book_id AND v.id=p_voucher
      WHERE s.book_id=p_book AND (s.change_set_id=v.change_set_id OR c.plan->'groups'->0->'actions'->0->>'eventId'=v.event_id)
    UNION ALL SELECT 'report',r.id,'Retained report covers the correction date. Its original bytes stay unchanged; prepare a new snapshot after posting.',
      '/report-snapshots/'||r.id,false FROM openerp.report_snapshots r WHERE r.book_id=p_book AND p_date BETWEEN r.starts_on AND r.ends_on
    UNION ALL SELECT 'closing',c.id,'Technical certificate depends on the ledger sequence. A new posting makes its basis stale; no automatic reopen or statutory finding.',
      '/closing-certificates/'||c.id,false FROM openerp.closing_certificates c WHERE c.book_id=p_book AND p_date IS NOT NULL
  ) r;
  -- Keep the original resource shape unchanged when no owner record is affected.
  -- The enclosing basis comparison binds these digests at seal/approve/execute.
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind',resource->>'id',resource->>'detail'),'[]') INTO ci_resources
    FROM jsonb_array_elements(ci_resources||openerp.correction_owner_impact_resources(p_book,p_voucher)) item(resource);
  IF jsonb_array_length(ci_resources)>1000 THEN PERFORM openerp.fail('UnsupportedProfile','This impact exceeds1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN ci_resources;
END $$;

CREATE OR REPLACE FUNCTION openerp.bank_add_match(book text, actor text, input jsonb, match_origin text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE observation openerp.bank_observations; statement openerp.bank_statements;
  line openerp.journal_lines; matched openerp.bank_matches; posted_on date;
BEGIN
  IF coalesce(input->>'rowOrdinal', '') !~ '^[1-9][0-9]{0,4}$'
    OR jsonb_typeof(input->'rowOrdinal') IS DISTINCT FROM 'number'
    OR (input->>'rowOrdinal')::integer > 10000 THEN
    PERFORM openerp.fail('InvalidJournal', 'Select one retained row by ordinal; split matches are unsupported.');
  END IF;
  SELECT * INTO observation FROM openerp.bank_observations o WHERE o.book_id = book
    AND o.statement_id = input->>'statementId' AND o.row_ordinal = (input->>'rowOrdinal')::integer;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound', 'The source observation was not found in this book.'); END IF;
  SELECT * INTO STRICT statement FROM openerp.bank_statements s WHERE s.book_id = book AND s.id = observation.statement_id;
  SELECT * INTO line FROM openerp.journal_lines l WHERE l.book_id = book
    AND l.voucher_id = input->>'voucherId' AND l.id = input->>'lineId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound', 'The posted journal line was not found in this book.'); END IF;
  SELECT v.posting_date INTO STRICT posted_on FROM openerp.vouchers v WHERE v.book_id = book AND v.id = line.voucher_id;
  IF line.account_id <> statement.account_id OR line.debit_minor - line.credit_minor <> observation.amount_minor
    OR posted_on NOT BETWEEN statement.starts_on AND statement.ends_on THEN
    PERFORM openerp.fail('InvalidJournal', 'Match one exact bank line with equal signed amount in the statement interval. Splits and timing allocations are unsupported.');
  END IF;
  IF EXISTS(SELECT FROM openerp.bank_matches m JOIN openerp.bank_match_reversals r
    ON (r.book_id,r.statement_id,r.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal)
    WHERE m.book_id=book AND ((m.statement_id=observation.statement_id AND m.row_ordinal=observation.row_ordinal)
      OR (m.voucher_id=line.voucher_id AND m.line_id=line.id)))
    OR EXISTS(SELECT FROM openerp.bank_allocation_legs a JOIN openerp.bank_match_reversals r
      ON (r.book_id,r.allocation_plan_id)=(a.book_id,a.plan_id)
      WHERE a.book_id=book AND ((a.statement_id=observation.statement_id AND a.row_ordinal=observation.row_ordinal)
        OR (a.voucher_id=line.voucher_id AND a.line_id=line.id))) THEN
    PERFORM openerp.fail('UnsupportedProfile','This source or posted line has retained unmatch history. Use a new reviewed allocation plan; old relationships stay immutable.'); END IF;
  SELECT * INTO matched FROM openerp.bank_matches m WHERE m.book_id = book AND m.statement_id = observation.statement_id AND m.row_ordinal = observation.row_ordinal;
  IF FOUND THEN
    IF matched.voucher_id <> line.voucher_id OR matched.line_id <> line.id THEN
      PERFORM openerp.fail('InvalidJournal', 'This observation already consumes another journal line.');
    END IF;
    RETURN openerp.bank_match_body(matched);
  END IF;
  IF EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id = book AND m.voucher_id = line.voucher_id AND m.line_id = line.id) THEN
    PERFORM openerp.fail('InvalidJournal', 'The journal line is already matched; its capacity cannot be consumed twice.');
  END IF;
  INSERT INTO openerp.bank_matches VALUES(book, observation.statement_id, observation.row_ordinal, line.voucher_id, line.id, match_origin, actor) RETURNING * INTO matched;
  UPDATE openerp.bank_sources SET revision = revision + 1 WHERE book_id = book AND account_id = statement.account_id;
  RETURN openerp.bank_match_body(matched);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_bank_allocation(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ba_plan openerp.bank_allocation_plans; ba_approval jsonb; ba_execution jsonb; ba_current boolean;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO ba_plan FROM openerp.bank_allocation_plans p WHERE p.book_id=scope->>'bookId' AND p.id=get_bank_allocation.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank allocation plan was not found in this book.'); END IF;
  SELECT a.body INTO ba_approval FROM openerp.bank_allocation_approvals a JOIN openerp.memberships m
    ON m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator'
    WHERE a.book_id=ba_plan.book_id AND a.plan_id=get_bank_allocation.id AND a.expires_at>clock_timestamp() ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
  SELECT e.body INTO ba_execution FROM openerp.bank_allocation_executions e WHERE e.book_id=ba_plan.book_id AND e.plan_id=get_bank_allocation.id;
  BEGIN ba_current:=openerp.bank_allocation_versions(ba_plan.book_id,ba_plan.account_id)=ba_plan.body->'snapshot'->'versions';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN ba_current:=false; END;
  RETURN jsonb_build_object('plan',ba_plan.body,'approval',ba_approval,'execution',ba_execution,'dependenciesCurrent',ba_current,
    'unmatch',(SELECT jsonb_build_object('planId',r.plan_id,'executedAt',r.body->>'executedAt','reason',r.body->>'reason')
      FROM openerp.bank_match_reversals r WHERE r.book_id=ba_plan.book_id AND r.allocation_plan_id=ba_plan.id));
END $$;

-- Both exact-match insertion and reviewed allocation execution must reject closed or reversed lines.
CREATE FUNCTION openerp.bank_matching_admission_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  PERFORM openerp.bank_match_open_periods(NEW.book_id,jsonb_build_array(jsonb_build_object(
    'statementId',NEW.statement_id,'rowOrdinal',NEW.row_ordinal,'voucherId',NEW.voucher_id)));
  IF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=NEW.book_id AND v.id=NEW.voucher_id
    AND (v.posting_purpose='reversal' OR EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=v.book_id AND r.corrects_voucher_id=v.id))) THEN
    PERFORM openerp.fail('StaleDependency','A reversed or reversing voucher cannot acquire bank matching capacity.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_matching_admission BEFORE INSERT ON openerp.bank_matches
  FOR EACH ROW EXECUTE FUNCTION openerp.bank_matching_admission_guard();
CREATE TRIGGER bank_allocation_admission BEFORE INSERT ON openerp.bank_allocation_legs
  FOR EACH ROW EXECUTE FUNCTION openerp.bank_matching_admission_guard();
REVOKE ALL ON FUNCTION openerp.bank_matching_admission_guard() FROM PUBLIC,openerp_runtime;

CREATE OR REPLACE FUNCTION openerp.bank_allocation_snapshot(book text, input jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE ba_leg jsonb; ba_source openerp.bank_observations; ba_statement openerp.bank_statements;
  ba_line openerp.journal_lines; ba_posted date; ba_source_used numeric; ba_line_used numeric;
  ba_amount numeric; ba_caps jsonb:='[]'; ba_group record; ba_candidates integer; ba_versions jsonb;
BEGIN
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Provide an allocation plan object.'); END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN ('accountId','reason','ambiguityAcknowledged','legs'))
    OR coalesce(input->>'accountId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR coalesce(length(input->>'reason'),0) NOT BETWEEN 1 AND 2000
    OR input->'ambiguityAcknowledged' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'legs') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Choose explicit allocation legs, record your reason, and acknowledge that candidate matches can be ambiguous.');
  END IF;
  IF jsonb_array_length(input->'legs') NOT BETWEEN 1 AND 100 THEN PERFORM openerp.fail('InvalidJournal','Use 1–100 explicit allocation legs.'); END IF;
  FOR ba_leg IN SELECT value FROM jsonb_array_elements(input->'legs') LOOP
    IF jsonb_typeof(ba_leg) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Each allocation leg must be an object.'); END IF;
    IF EXISTS(SELECT FROM jsonb_object_keys(ba_leg) k WHERE k NOT IN ('statementId','rowOrdinal','voucherId','lineId','amountMinor'))
      OR coalesce(ba_leg->>'statementId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR coalesce(ba_leg->>'voucherId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR coalesce(ba_leg->>'lineId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR jsonb_typeof(ba_leg->'rowOrdinal') IS DISTINCT FROM 'number' OR coalesce(ba_leg->>'rowOrdinal','') !~ '^[1-9][0-9]{0,4}$'
      OR jsonb_typeof(ba_leg->'amountMinor') IS DISTINCT FROM 'string' OR coalesce(ba_leg->>'amountMinor','') !~ '^-?[1-9][0-9]{0,37}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select retained source and posted line identities with a nonzero signed minor-unit amount.');
    END IF;
  END LOOP;
  PERFORM openerp.bank_match_open_periods(book,input->'legs');
  ba_versions:=openerp.bank_allocation_versions(book,input->>'accountId');
  FOR ba_leg IN SELECT value FROM jsonb_array_elements(input->'legs') LOOP
    ba_amount:=(ba_leg->>'amountMinor')::numeric;
    SELECT * INTO ba_source FROM openerp.bank_observations o WHERE o.book_id=book
      AND o.statement_id=ba_leg->>'statementId' AND o.row_ordinal=(ba_leg->>'rowOrdinal')::integer;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained observation was not found in this book.'); END IF;
    SELECT * INTO STRICT ba_statement FROM openerp.bank_statements s WHERE s.book_id=book AND s.id=ba_source.statement_id;
    SELECT * INTO ba_line FROM openerp.journal_lines l WHERE l.book_id=book AND l.voucher_id=ba_leg->>'voucherId' AND l.id=ba_leg->>'lineId';
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The posted line was not found in this book.'); END IF;
    SELECT v.posting_date INTO STRICT ba_posted FROM openerp.vouchers v WHERE v.book_id=book AND v.id=ba_line.voucher_id;
    IF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=book AND v.id=ba_line.voucher_id
      AND (v.posting_purpose='reversal' OR EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=book AND r.corrects_voucher_id=v.id))) THEN
      PERFORM openerp.fail('StaleDependency','A reversed or reversing voucher cannot acquire bank matching capacity.'); END IF;
    IF ba_statement.account_id<>input->>'accountId' OR ba_line.account_id<>ba_statement.account_id
      OR ba_posted NOT BETWEEN ba_statement.starts_on AND ba_statement.ends_on
      OR sign(ba_amount)<>sign(ba_source.amount_minor) OR sign(ba_amount)<>sign(ba_line.debit_minor-ba_line.credit_minor) THEN
      PERFORM openerp.fail('InvalidJournal','Allocate the same bank account and sign within the whole retained statement interval; timing and opposite-sign netting are unsupported.');
    END IF;
    ba_source_used:=openerp.bank_allocated_source(book,ba_source.statement_id,ba_source.row_ordinal);
    ba_line_used:=openerp.bank_allocated_line(book,ba_line.voucher_id,ba_line.id);
    SELECT count(*) INTO ba_candidates FROM (SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v
      ON (v.book_id,v.id)=(l.book_id,l.voucher_id) WHERE l.book_id=book AND l.account_id=ba_statement.account_id
      AND v.posting_date BETWEEN ba_statement.starts_on AND ba_statement.ends_on
      AND sign(l.debit_minor-l.credit_minor)=sign(ba_source.amount_minor)
      AND abs(l.debit_minor-l.credit_minor)>abs(openerp.bank_allocated_line(book,l.voucher_id,l.id)) LIMIT 1001) candidates;
    IF ba_candidates>1000 THEN PERFORM openerp.fail('InvalidJournal','More than 1000 candidate lines require a larger-scope review workflow, which is not implemented.'); END IF;
    ba_caps:=ba_caps||jsonb_build_array(jsonb_build_object('leg',ba_leg,
      'sourceAmountMinor',ba_source.amount_minor::text,'sourceAllocatedMinor',ba_source_used::text,
      'lineAmountMinor',(ba_line.debit_minor-ba_line.credit_minor)::text,'lineAllocatedMinor',ba_line_used::text,
      'evidenceId',ba_statement.evidence_id,'evidenceSha256',(SELECT e.sha256 FROM openerp.evidence e WHERE e.book_id=book AND e.id=ba_statement.evidence_id),
      'providerId',ba_source.provider_id,'sourceBankAccountId',ba_source.source_bank_account_id,
      'observedOn',ba_source.observed_on::text,'postedOn',ba_posted::text,'candidateCount',ba_candidates));
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(input->'legs') l GROUP BY l->>'statementId',l->>'rowOrdinal',l->>'voucherId',l->>'lineId' HAVING count(*)>1) THEN
    PERFORM openerp.fail('InvalidJournal','A source/line pair repeats. Use one exact amount per pair.');
  END IF;
  FOR ba_group IN SELECT c->'leg'->>'statementId' statement_id,c->'leg'->>'rowOrdinal' ordinal,
    sum((c->'leg'->>'amountMinor')::numeric) requested,max(abs((c->>'sourceAmountMinor')::numeric)) capacity,
    max(abs((c->>'sourceAllocatedMinor')::numeric)) used FROM jsonb_array_elements(ba_caps) c GROUP BY 1,2 LOOP
    IF abs(ba_group.requested)+ba_group.used>ba_group.capacity THEN PERFORM openerp.fail('InvalidJournal','The combined legs exceed a retained observation capacity.'); END IF;
  END LOOP;
  FOR ba_group IN SELECT c->'leg'->>'voucherId' voucher_id,c->'leg'->>'lineId' line_id,
    sum((c->'leg'->>'amountMinor')::numeric) requested,max(abs((c->>'lineAmountMinor')::numeric)) capacity,
    max(abs((c->>'lineAllocatedMinor')::numeric)) used FROM jsonb_array_elements(ba_caps) c GROUP BY 1,2 LOOP
    IF abs(ba_group.requested)+ba_group.used>ba_group.capacity THEN PERFORM openerp.fail('InvalidJournal','The combined legs exceed a posted bank-line capacity.'); END IF;
  END LOOP;
  RETURN jsonb_build_object('versions',ba_versions,'capacities',ba_caps);
END $$;

CREATE OR REPLACE FUNCTION openerp.bank_allocation_checked(book text, id text, input jsonb, executing boolean) RETURNS openerp.bank_allocation_plans
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ba_plan openerp.bank_allocation_plans;
BEGIN
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Provide an exact plan digest and version.'); END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN ('digest','version') AND (NOT executing OR k<>'approvalId'))
    OR input->'version' IS DISTINCT FROM '1'::jsonb THEN PERFORM openerp.fail('InvalidJournal','Use the exact versioned allocation command.'); END IF;
  SELECT * INTO ba_plan FROM openerp.bank_allocation_plans p WHERE p.book_id=book AND p.id=bank_allocation_checked.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank allocation plan was not found in this book.'); END IF;
  IF input->>'digest' IS DISTINCT FROM ba_plan.body->>'digest' THEN PERFORM openerp.fail('StaleDependency','Review the exact saved allocation plan digest.'); END IF;
  PERFORM openerp.bank_require_profile(book);
  PERFORM openerp.bank_match_open_periods(book,ba_plan.input->'legs');
  IF openerp.bank_allocation_versions(book,ba_plan.account_id) IS DISTINCT FROM ba_plan.body->'snapshot'->'versions' THEN
    PERFORM openerp.fail('StaleDependency','Bank source, ledger capacity or configuration changed. Prepare and approve a new allocation plan.');
  END IF;
  RETURN ba_plan;
END $$;

CREATE OR REPLACE FUNCTION openerp.import_bank_statement(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; source jsonb := input - 'evidenceId' - 'existingMatches';
  evidence openerp.evidence; statement openerp.bank_statements; source_row jsonb; match_input jsonb;
  starts date; ends date; row_date date; total numeric := 0; matches jsonb := '[]'; result jsonb;
BEGIN
  actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'import_bank_statement', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  PERFORM openerp.bank_require_profile(scope->>'bookId');
  IF input->>'kind' IS DISTINCT FROM 'synthetic_bank_statement_v1'
    OR jsonb_typeof(input->'statementIdentifier') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'sourceBankAccountId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'completeness'->'basis') IS DISTINCT FROM 'string'
    OR coalesce(length(input->>'statementIdentifier'), 0) NOT BETWEEN 1 AND 200
    OR coalesce(length(input->>'sourceBankAccountId'), 0) NOT BETWEEN 1 AND 200
    OR coalesce(input->>'openingMinor', '') !~ '^(0|-?[1-9][0-9]{0,37})$'
    OR coalesce(input->>'closingMinor', '') !~ '^(0|-?[1-9][0-9]{0,37})$'
    OR jsonb_typeof(input->'openingMinor') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'closingMinor') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'completeness'->'declaredComplete') IS DISTINCT FROM 'boolean'
    OR coalesce(length(input->'completeness'->>'basis'), 0) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(input->'rows') IS DISTINCT FROM 'array'
    OR jsonb_typeof(input->'existingMatches') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal', 'Provide a synthetic statement with exact balances, rows and an explicit coverage declaration.');
  END IF;
  IF jsonb_array_length(input->'rows') > 10000 OR jsonb_array_length(input->'existingMatches') > 10000 THEN
    PERFORM openerp.fail('InvalidJournal', 'The synthetic import supports at most 10000 rows and matches.');
  END IF;
  starts := openerp.bank_date(input->>'startsOn'); ends := openerp.bank_date(input->>'endsOn');
  IF starts > ends THEN PERFORM openerp.fail('InvalidJournal', 'The statement interval is reversed.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.accounts a JOIN openerp.books b ON b.id = a.book_id
    WHERE a.book_id = scope->>'bookId' AND a.id = input->>'accountId' AND a.active AND b.currency = input->>'currency') THEN
    PERFORM openerp.fail('InvalidJournal', 'Choose an active book account and the book currency.');
  END IF;
  SELECT * INTO evidence FROM openerp.evidence e WHERE e.book_id = scope->>'bookId' AND e.id = input->>'evidenceId';
  IF NOT FOUND OR evidence.media_type <> 'application/json' THEN
    PERFORM openerp.fail('MissingEvidence', 'Retain the exact synthetic statement source as JSON evidence first.');
  END IF;
  IF evidence.content::jsonb IS DISTINCT FROM source THEN
    PERFORM openerp.fail('MissingEvidence', 'The retained JSON must equal the statement input without evidenceId and existingMatches.');
  END IF;
  SELECT * INTO statement FROM openerp.bank_statements s WHERE s.book_id = scope->>'bookId'
    AND s.source_bank_account_id = input->>'sourceBankAccountId' AND s.statement_identifier = input->>'statementIdentifier';
  IF FOUND THEN
    IF statement.import_input IS DISTINCT FROM input THEN
      PERFORM openerp.fail('IdempotencyConflict', 'The stable statement identity already has different retained content or matches.');
    END IF;
  ELSE
    IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id = scope->>'bookId' AND
      ((s.account_id = input->>'accountId' AND s.source_bank_account_id <> input->>'sourceBankAccountId') OR
       (s.source_bank_account_id = input->>'sourceBankAccountId' AND s.account_id <> input->>'accountId'))) THEN
      PERFORM openerp.fail('InvalidJournal', 'The bank source mapping conflicts with the retained book account mapping.');
    END IF;
    IF EXISTS(SELECT FROM openerp.bank_statements s WHERE s.book_id = scope->>'bookId' AND s.account_id = input->>'accountId'
      AND s.starts_on <= ends AND s.ends_on >= starts) THEN
      PERFORM openerp.fail('InvalidJournal', 'Overlapping bank statements require explicit set reconciliation, which is unsupported. No rows were discarded.');
    END IF;
    INSERT INTO openerp.bank_sources(book_id, account_id, source_bank_account_id)
      VALUES(scope->>'bookId', input->>'accountId', input->>'sourceBankAccountId') ON CONFLICT DO NOTHING;
    INSERT INTO openerp.bank_statements VALUES(scope->>'bookId', openerp.new_id('statement'), input->>'accountId',
      input->>'sourceBankAccountId', input->>'statementIdentifier', evidence.id, starts, ends, source, input) RETURNING * INTO statement;
    FOR source_row IN SELECT value FROM jsonb_array_elements(input->'rows') LOOP
      IF coalesce(source_row->>'rowOrdinal', '') !~ '^[1-9][0-9]{0,4}$'
        OR jsonb_typeof(source_row->'rowOrdinal') IS DISTINCT FROM 'number'
        OR (source_row->>'rowOrdinal')::integer > 10000
        OR coalesce(source_row->>'amountMinor', '') !~ '^(0|-?[1-9][0-9]{0,37})$'
        OR jsonb_typeof(source_row->'amountMinor') IS DISTINCT FROM 'string'
        OR jsonb_typeof(source_row->'description') IS DISTINCT FROM 'string'
        OR coalesce(length(source_row->>'description'), 0) NOT BETWEEN 1 AND 2000
        OR NOT (source_row ? 'providerId')
        OR (source_row->'providerId' <> 'null'::jsonb AND
          (jsonb_typeof(source_row->'providerId') <> 'string' OR length(source_row->>'providerId') NOT BETWEEN 1 AND 200)) THEN
        PERFORM openerp.fail('InvalidJournal', 'Each retained row needs a unique ordinal, optional provider ID, date, description and exact signed amount.');
      END IF;
      row_date := openerp.bank_date(source_row->>'date');
      IF row_date NOT BETWEEN starts AND ends THEN PERFORM openerp.fail('InvalidJournal', 'Every observation must lie inside the statement interval.'); END IF;
      IF EXISTS(SELECT FROM openerp.bank_observations o WHERE o.book_id = statement.book_id AND
        ((o.statement_id = statement.id AND o.row_ordinal = (source_row->>'rowOrdinal')::integer) OR
        (o.source_bank_account_id = statement.source_bank_account_id AND o.provider_id = source_row->>'providerId'))) THEN
        PERFORM openerp.fail('InvalidJournal', 'A row ordinal or provider identity repeats. Equal amounts alone are not duplicates.');
      END IF;
      INSERT INTO openerp.bank_observations VALUES(statement.book_id, statement.id, (source_row->>'rowOrdinal')::integer,
        source_row->>'providerId', statement.source_bank_account_id, row_date, source_row->>'description', (source_row->>'amountMinor')::numeric);
      total := total + (source_row->>'amountMinor')::numeric;
    END LOOP;
    IF (input->>'openingMinor')::numeric + total <> (input->>'closingMinor')::numeric THEN
      PERFORM openerp.fail('InvalidJournal', 'The complete retained row sum does not equal the stated closing balance.');
    END IF;
    UPDATE openerp.bank_sources SET revision = revision + 1 WHERE book_id = statement.book_id AND account_id = statement.account_id;
    FOR match_input IN SELECT value FROM jsonb_array_elements(input->'existingMatches') LOOP
      PERFORM openerp.bank_add_match(statement.book_id, actor, match_input || jsonb_build_object('statementId', statement.id), 'imported');
    END LOOP;
  END IF;
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(ROW(m.*)::openerp.bank_matches) ORDER BY m.row_ordinal), '[]') INTO matches
    FROM openerp.bank_active_matches m WHERE m.book_id = statement.book_id AND m.statement_id = statement.id;
  result := jsonb_build_object('statement', openerp.bank_statement_body(statement), 'matches', matches,
    'checkpoint', openerp.bank_checkpoint(statement.book_id, statement.account_id),
    'receipt', jsonb_build_object('key', key, 'operation', 'import_bank_statement', 'actorId', actor));
  RETURN openerp.save_command(statement.book_id, key, actor, 'import_bank_statement', input, result);
END $$;
