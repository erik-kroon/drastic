-- Reviewed bank matching only. No journal or invoice writes.
CREATE TABLE openerp.bank_allocation_plans (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  account_id text NOT NULL, input jsonb NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,account_id) REFERENCES openerp.accounts
);
CREATE TABLE openerp.bank_allocation_approvals (
  book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors, expires_at timestamptz NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.bank_allocation_plans
);
CREATE TABLE openerp.bank_allocation_executions (
  book_id text NOT NULL, plan_id text NOT NULL, approval_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,plan_id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.bank_allocation_plans,
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.bank_allocation_approvals
);
CREATE TABLE openerp.bank_allocation_legs (
  book_id text NOT NULL, plan_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 100),
  statement_id text NOT NULL, row_ordinal integer NOT NULL, voucher_id text NOT NULL, line_id text NOT NULL,
  amount_minor numeric NOT NULL CHECK(amount_minor=trunc(amount_minor) AND amount_minor<>0 AND abs(amount_minor)<1e38::numeric),
  PRIMARY KEY(book_id,plan_id,ordinal),
  UNIQUE(book_id,plan_id,statement_id,row_ordinal,voucher_id,line_id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.bank_allocation_executions,
  FOREIGN KEY(book_id,statement_id,row_ordinal) REFERENCES openerp.bank_observations,
  FOREIGN KEY(book_id,voucher_id,line_id) REFERENCES openerp.journal_lines
);
CREATE INDEX bank_allocation_source ON openerp.bank_allocation_legs(book_id,statement_id,row_ordinal);
CREATE INDEX bank_allocation_line ON openerp.bank_allocation_legs(book_id,voucher_id,line_id);
CREATE TABLE openerp.bank_capacity_reconciliations (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, account_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,account_id) REFERENCES openerp.accounts
);
CREATE TRIGGER immutable_bank_allocation_plan BEFORE UPDATE OR DELETE ON openerp.bank_allocation_plans
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_allocation_approval BEFORE UPDATE OR DELETE ON openerp.bank_allocation_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_allocation_execution BEFORE UPDATE OR DELETE ON openerp.bank_allocation_executions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_allocation_leg BEFORE UPDATE OR DELETE ON openerp.bank_allocation_legs
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_capacity_report BEFORE UPDATE OR DELETE ON openerp.bank_capacity_reconciliations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.bank_allocated_source(book text, statement text, ordinal integer) RETURNS numeric
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT coalesce((SELECT o.amount_minor FROM openerp.bank_matches m JOIN openerp.bank_observations o
    ON (o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal)
    WHERE m.book_id=bank_allocated_source.book AND m.statement_id=bank_allocated_source.statement AND m.row_ordinal=bank_allocated_source.ordinal),0)
    + coalesce((SELECT sum(a.amount_minor) FROM openerp.bank_allocation_legs a
      WHERE a.book_id=bank_allocated_source.book AND a.statement_id=bank_allocated_source.statement AND a.row_ordinal=bank_allocated_source.ordinal),0)
$$;
CREATE FUNCTION openerp.bank_allocated_line(book text, voucher text, line text) RETURNS numeric
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT coalesce((SELECT l.debit_minor-l.credit_minor FROM openerp.bank_matches m JOIN openerp.journal_lines l
    ON (l.book_id,l.voucher_id,l.id)=(m.book_id,m.voucher_id,m.line_id)
    WHERE m.book_id=bank_allocated_line.book AND m.voucher_id=bank_allocated_line.voucher AND m.line_id=bank_allocated_line.line),0)
    + coalesce((SELECT sum(a.amount_minor) FROM openerp.bank_allocation_legs a
      WHERE a.book_id=bank_allocated_line.book AND a.voucher_id=bank_allocated_line.voucher AND a.line_id=bank_allocated_line.line),0)
$$;
-- Keep immutable v1 imports and exact matches, but close their capacity back door.
CREATE FUNCTION openerp.bank_legacy_allocation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books WHERE id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.bank_allocation_legs a WHERE a.book_id=NEW.book_id AND
    ((a.statement_id=NEW.statement_id AND a.row_ordinal=NEW.row_ordinal) OR
     (a.voucher_id=NEW.voucher_id AND a.line_id=NEW.line_id))) THEN
    PERFORM openerp.fail('InvalidJournal','Partial bank capacity is already allocated. Use a reviewed allocation plan for the remainder.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_legacy_capacity BEFORE INSERT ON openerp.bank_matches
  FOR EACH ROW EXECUTE FUNCTION openerp.bank_legacy_allocation_guard();

CREATE FUNCTION openerp.bank_allocation_versions(book text, account text) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE ba_account openerp.accounts; ba_result jsonb;
BEGIN
  SELECT * INTO ba_account FROM openerp.accounts a WHERE a.book_id=book AND a.id=account FOR SHARE;
  IF NOT FOUND OR NOT ba_account.active THEN PERFORM openerp.fail('StaleDependency','The selected bank account is unavailable.'); END IF;
  SELECT jsonb_build_object('profileVersion',b.profile_version::text,'writerEpoch',b.writer_epoch::text,
    'accountVersion',ba_account.version::text,'sourceRevision',coalesce(s.revision,0)::text,
    'accountLedgerSequence',coalesce((SELECT max(v.sequence) FROM openerp.journal_lines l JOIN openerp.vouchers v
      ON (v.book_id,v.id)=(l.book_id,l.voucher_id) WHERE l.book_id=book AND l.account_id=account),0)::text)
    INTO ba_result FROM openerp.books b LEFT JOIN openerp.bank_sources s ON s.book_id=b.id AND s.account_id=account WHERE b.id=book;
  RETURN ba_result;
END $$;

CREATE FUNCTION openerp.bank_allocation_snapshot(book text, input jsonb) RETURNS jsonb LANGUAGE plpgsql
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
  ba_versions:=openerp.bank_allocation_versions(book,input->>'accountId');
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
    ba_amount:=(ba_leg->>'amountMinor')::numeric;
    SELECT * INTO ba_source FROM openerp.bank_observations o WHERE o.book_id=book
      AND o.statement_id=ba_leg->>'statementId' AND o.row_ordinal=(ba_leg->>'rowOrdinal')::integer;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained observation was not found in this book.'); END IF;
    SELECT * INTO STRICT ba_statement FROM openerp.bank_statements s WHERE s.book_id=book AND s.id=ba_source.statement_id;
    SELECT * INTO ba_line FROM openerp.journal_lines l WHERE l.book_id=book AND l.voucher_id=ba_leg->>'voucherId' AND l.id=ba_leg->>'lineId';
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The posted line was not found in this book.'); END IF;
    SELECT v.posting_date INTO STRICT ba_posted FROM openerp.vouchers v WHERE v.book_id=book AND v.id=ba_line.voucher_id;
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

CREATE FUNCTION openerp.prepare_bank_allocation(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ba_actor text; ba_previous jsonb; ba_book openerp.books; ba_body jsonb; ba_snapshot jsonb; ba_id text:=openerp.new_id('bankplan');
BEGIN
  ba_actor:=openerp.authorize(token,scope);
  SELECT * INTO STRICT ba_book FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  ba_previous:=openerp.replay(ba_book.id,key,ba_actor,'prepare_bank_allocation',input);
  IF ba_previous IS NOT NULL THEN RETURN ba_previous; END IF;
  PERFORM openerp.bank_require_profile(ba_book.id);
  ba_snapshot:=openerp.bank_allocation_snapshot(ba_book.id,input);
  ba_body:=jsonb_build_object('id',ba_id,'version',1,'scope',scope,'currency',ba_book.currency,'currencyScale',ba_book.currency_scale,
    'input',input,'snapshot',ba_snapshot,'createdBy',ba_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  ba_body:=ba_body||jsonb_build_object('digest',openerp.digest(ba_body),
    'receipt',jsonb_build_object('key',key,'operation','prepare_bank_allocation','actorId',ba_actor));
  INSERT INTO openerp.bank_allocation_plans VALUES(ba_book.id,ba_id,input->>'accountId',input,ba_body);
  RETURN openerp.save_command(ba_book.id,key,ba_actor,'prepare_bank_allocation',input,ba_body);
END $$;

CREATE FUNCTION openerp.bank_allocation_checked(book text, id text, input jsonb, executing boolean) RETURNS openerp.bank_allocation_plans
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
  IF openerp.bank_allocation_versions(book,ba_plan.account_id) IS DISTINCT FROM ba_plan.body->'snapshot'->'versions' THEN
    PERFORM openerp.fail('StaleDependency','Bank source, ledger capacity or configuration changed. Prepare and approve a new allocation plan.');
  END IF;
  RETURN ba_plan;
END $$;

CREATE FUNCTION openerp.approve_bank_allocation(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ba_actor text; ba_previous jsonb; ba_plan openerp.bank_allocation_plans; ba_id text:=openerp.new_id('bankapproval');
  ba_expires timestamptz:=clock_timestamp()+interval '1 hour'; ba_result jsonb; ba_request jsonb:=jsonb_build_object('planId',id,'input',input);
BEGIN
  ba_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR UPDATE;
  ba_previous:=openerp.replay(scope->>'bookId',key,ba_actor,'approve_bank_allocation',ba_request);
  IF ba_previous IS NOT NULL THEN RETURN ba_previous; END IF;
  ba_plan:=openerp.bank_allocation_checked(scope->>'bookId',id,input,false);
  ba_result:=jsonb_build_object('id',ba_id,'planId',id,'digest',input->>'digest','version',1,'actorId',ba_actor,
    'expiresAt',to_char(ba_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','approve_bank_allocation','actorId',ba_actor));
  INSERT INTO openerp.bank_allocation_approvals VALUES(ba_plan.book_id,ba_id,id,ba_actor,ba_expires,ba_result);
  RETURN openerp.save_command(ba_plan.book_id,key,ba_actor,'approve_bank_allocation',ba_request,ba_result);
END $$;

CREATE FUNCTION openerp.execute_bank_allocation(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ba_actor text; ba_previous jsonb; ba_plan openerp.bank_allocation_plans; ba_approval openerp.bank_allocation_approvals;
  ba_result jsonb; ba_legs jsonb; ba_request jsonb:=jsonb_build_object('planId',id,'input',input);
BEGIN
  ba_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR UPDATE;
  ba_previous:=openerp.replay(scope->>'bookId',key,ba_actor,'execute_bank_allocation',ba_request);
  IF ba_previous IS NOT NULL THEN RETURN ba_previous; END IF;
  IF EXISTS(SELECT FROM openerp.bank_allocation_executions e WHERE e.book_id=scope->>'bookId' AND e.plan_id=execute_bank_allocation.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This allocation plan already executed. Recover its saved execution or retry the original command key.');
  END IF;
  ba_plan:=openerp.bank_allocation_checked(scope->>'bookId',id,input,true);
  SELECT * INTO ba_approval FROM openerp.bank_allocation_approvals a WHERE a.book_id=ba_plan.book_id AND a.id=input->>'approvalId' AND a.plan_id=execute_bank_allocation.id;
  IF NOT FOUND OR ba_approval.expires_at<=clock_timestamp() THEN PERFORM openerp.fail('ApprovalRequired','A current operator approval of this exact allocation plan is required.'); END IF;
  PERFORM 1 FROM openerp.memberships m WHERE m.book_id=ba_plan.book_id AND m.actor_id=ba_approval.actor_id AND m.role='operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approving operator no longer has authority for this book.'); END IF;
  -- Re-evaluate all aggregate capacities under the same book lock immediately before insertion.
  IF openerp.bank_allocation_snapshot(ba_plan.book_id,ba_plan.input) IS DISTINCT FROM ba_plan.body->'snapshot' THEN
    PERFORM openerp.fail('StaleDependency','Allocation capacities changed. Prepare and approve a new plan.');
  END IF;
  SELECT jsonb_agg(l.value||jsonb_build_object('planId',id,'ordinal',l.ordinal) ORDER BY l.ordinal) INTO ba_legs
    FROM jsonb_array_elements(ba_plan.input->'legs') WITH ORDINALITY l(value,ordinal);
  ba_result:=jsonb_build_object('planId',id,'digest',input->>'digest','version',1,'approvalId',ba_approval.id,
    'scope',scope,'accountId',ba_plan.account_id,'currency',ba_plan.body->>'currency','currencyScale',ba_plan.body->'currencyScale',
    'legs',ba_legs,'executedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','execute_bank_allocation','actorId',ba_actor));
  INSERT INTO openerp.bank_allocation_executions VALUES(ba_plan.book_id,id,ba_approval.id,ba_result);
  INSERT INTO openerp.bank_allocation_legs SELECT ba_plan.book_id,id,l.ordinal::integer,l.value->>'statementId',
    (l.value->>'rowOrdinal')::integer,l.value->>'voucherId',l.value->>'lineId',(l.value->>'amountMinor')::numeric
    FROM jsonb_array_elements(ba_plan.input->'legs') WITH ORDINALITY l(value,ordinal);
  UPDATE openerp.bank_sources SET revision=revision+1 WHERE book_id=ba_plan.book_id AND account_id=ba_plan.account_id;
  RETURN openerp.save_command(ba_plan.book_id,key,ba_actor,'execute_bank_allocation',ba_request,ba_result);
END $$;

CREATE FUNCTION openerp.get_bank_allocation(token text, scope jsonb, id text) RETURNS jsonb
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
  RETURN jsonb_build_object('plan',ba_plan.body,'approval',ba_approval,'execution',ba_execution,'dependenciesCurrent',ba_current);
END $$;

CREATE FUNCTION openerp.reconcile_bank_capacity(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
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
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.bank_allocation_legs a JOIN openerp.bank_statements s
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
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(m) ORDER BY s.starts_on, m.row_ordinal), '[]') INTO bc_matches
    FROM openerp.bank_matches m JOIN openerp.bank_statements s ON s.book_id = m.book_id AND s.id = m.statement_id
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
      ORDER BY a.plan_id,a.ordinal),'[]') INTO bc_allocations FROM openerp.bank_allocation_legs a JOIN openerp.bank_statements s
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

CREATE FUNCTION openerp.get_bank_capacity_reconciliation(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE bc_body jsonb; bc_revision bigint; bc_sequence bigint;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR SHARE;
  SELECT r.body INTO bc_body FROM openerp.bank_capacity_reconciliations r
    WHERE r.book_id=scope->>'bookId' AND r.id=get_bank_capacity_reconciliation.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank capacity reconciliation was not found in this book.'); END IF;
  SELECT coalesce(s.revision,0) INTO bc_revision FROM openerp.bank_sources s WHERE s.book_id=scope->>'bookId' AND s.account_id=bc_body->>'accountId';
  bc_revision:=coalesce(bc_revision,0);
  SELECT coalesce(max(v.sequence),0) INTO bc_sequence FROM openerp.journal_lines l JOIN openerp.vouchers v
    ON (v.book_id,v.id)=(l.book_id,l.voucher_id) WHERE l.book_id=scope->>'bookId' AND l.account_id=bc_body->>'accountId'
    AND v.posting_date<=(bc_body->>'endsOn')::date;
  RETURN jsonb_build_object('report',bc_body,'fresh',bc_revision=(bc_body->'checkpoint'->>'sourceRevision')::bigint
    AND bc_sequence=(bc_body->>'accountLedgerSequence')::bigint,
    'currentSourceRevision',bc_revision::text,'currentAccountLedgerSequence',bc_sequence::text);
END $$;

REVOKE ALL ON openerp.bank_allocation_plans,openerp.bank_allocation_approvals,openerp.bank_allocation_executions,
  openerp.bank_allocation_legs,openerp.bank_capacity_reconciliations FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.bank_allocated_source(text,text,integer),openerp.bank_allocated_line(text,text,text),
  openerp.bank_legacy_allocation_guard(),openerp.bank_allocation_versions(text,text),openerp.bank_allocation_snapshot(text,jsonb),
  openerp.bank_allocation_checked(text,text,jsonb,boolean),openerp.prepare_bank_allocation(text,jsonb,text,jsonb),
  openerp.approve_bank_allocation(text,jsonb,text,text,jsonb),openerp.execute_bank_allocation(text,jsonb,text,text,jsonb),
  openerp.get_bank_allocation(text,jsonb,text),openerp.reconcile_bank_capacity(text,jsonb,text,jsonb),
  openerp.get_bank_capacity_reconciliation(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_bank_allocation(text,jsonb,text,jsonb),openerp.approve_bank_allocation(text,jsonb,text,text,jsonb),
  openerp.execute_bank_allocation(text,jsonb,text,text,jsonb),openerp.get_bank_allocation(text,jsonb,text),
  openerp.reconcile_bank_capacity(text,jsonb,text,jsonb),openerp.get_bank_capacity_reconciliation(text,jsonb,text) TO openerp_runtime;

-- Caller must authorize and hold the book lock. Inventory completeness belongs to year-end.
CREATE FUNCTION openerp.bank_close_dependencies(book text, starts_on date, ends_on date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT jsonb_build_object('sources',coalesce(jsonb_agg(jsonb_build_object(
    'accountId',s.account_id,'sourceId',s.source_bank_account_id,'revision',s.revision::text,
    'reconciliationId',chosen.id,'reconciliationKind',chosen.kind,'reconciliationCreatedAt',chosen.body->>'createdAt')
    ORDER BY s.account_id),'[]'), 'allRepresentedReady',count(*)>0 AND coalesce(bool_and(chosen.id IS NOT NULL),false))
  FROM openerp.bank_sources s
  LEFT JOIN LATERAL (
    SELECT r.id,r.body,r.kind FROM (
      SELECT v1.id,v1.body,'bank-v1'::text kind FROM openerp.bank_reconciliations v1 WHERE v1.book_id=bank_close_dependencies.book AND v1.account_id=s.account_id
      UNION ALL
      SELECT v2.id,v2.body,'bank-capacity-v2'::text kind FROM openerp.bank_capacity_reconciliations v2 WHERE v2.book_id=bank_close_dependencies.book AND v2.account_id=s.account_id
    ) r WHERE r.body->>'startsOn'=bank_close_dependencies.starts_on::text AND r.body->>'endsOn'=bank_close_dependencies.ends_on::text
      AND r.body->>'status'='complete' AND (r.body->'checkpoint'->>'sourceRevision')::bigint=s.revision
      AND (r.body->>'accountLedgerSequence')::bigint=(SELECT coalesce(max(v.sequence),0) FROM openerp.journal_lines l JOIN openerp.vouchers v
        ON (v.book_id,v.id)=(l.book_id,l.voucher_id) WHERE l.book_id=bank_close_dependencies.book AND l.account_id=s.account_id AND v.posting_date<=bank_close_dependencies.ends_on)
    ORDER BY r.body->>'createdAt' DESC,r.id DESC LIMIT 1
  ) chosen ON true WHERE s.book_id=bank_close_dependencies.book
$$;
REVOKE ALL ON FUNCTION openerp.bank_close_dependencies(text,date,date) FROM PUBLIC,openerp_runtime;
