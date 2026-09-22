-- Explicit synthetic allocation, not a Swedish depreciation, tax or payroll policy.
CREATE TABLE openerp.subledger_schedules (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, source_key text NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,source_key)
);
CREATE TABLE openerp.subledger_schedule_revisions (
  book_id text NOT NULL, schedule_id text NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 20),
  evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,schedule_id,revision),
  FOREIGN KEY(book_id,schedule_id) REFERENCES openerp.subledger_schedules,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.subledger_preparations (
  book_id text NOT NULL, schedule_id text NOT NULL, revision integer NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 120),
  attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 100), change_set_id text NOT NULL,
  PRIMARY KEY(book_id,schedule_id,ordinal,attempt), UNIQUE(book_id,change_set_id),
  FOREIGN KEY(book_id,schedule_id,revision) REFERENCES openerp.subledger_schedule_revisions,
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets
);
CREATE TRIGGER immutable_subledger_schedule BEFORE UPDATE OR DELETE ON openerp.subledger_schedules
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_revision BEFORE UPDATE OR DELETE ON openerp.subledger_schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_preparation BEFORE UPDATE OR DELETE ON openerp.subledger_preparations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.subledger_current(book text, schedule_id text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE sl_body jsonb;
BEGIN
  SELECT r.body INTO sl_body FROM openerp.subledger_schedule_revisions r
    WHERE r.book_id=book AND r.schedule_id=subledger_current.schedule_id ORDER BY r.revision DESC LIMIT 1;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The schedule was not found in this book.'); END IF;
  RETURN sl_body;
END $$;

CREATE FUNCTION openerp.subledger_revision_body(book text, schedule_id text, source_key text, revision integer,
  previous_digest text, terms jsonb, actor text, key text, operation text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE sl_book openerp.books; sl_evidence openerp.evidence; sl_cost numeric; sl_residual numeric;
  sl_count integer; sl_base numeric; sl_amount numeric; sl_total numeric:=0; sl_index integer:=0;
  sl_period jsonb; sl_date date; sl_last_date date; sl_occurrences jsonb:='[]'; sl_body jsonb;
BEGIN
  SELECT * INTO STRICT sl_book FROM openerp.books b WHERE b.id=book;
  IF sl_book.profile<>'synthetic-core-v1' OR sl_book.authority<>'native' THEN
    PERFORM openerp.fail('UnsupportedProfile','Schedules support only the native synthetic-core-v1 preparation profile.'); END IF;
  IF jsonb_typeof(terms) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply explicit schedule terms.'); END IF;
  IF terms-ARRAY['kind','name','evidenceId','rationale','costMinor','residualMinor','usefulPeriods','allocationPolicy',
      'debitAccountId','creditAccountId','series','periods','taxAssessment']<>'{}'::jsonb
    OR coalesce(terms->>'kind','') NOT IN ('asset','deferral')
    OR terms->>'allocationPolicy' IS DISTINCT FROM 'equal_minor_final_remainder_v1'
    OR terms->>'taxAssessment' IS DISTINCT FROM 'not_applicable'
    OR EXISTS(SELECT FROM unnest(ARRAY['kind','name','evidenceId','rationale','costMinor','residualMinor','allocationPolicy',
        'debitAccountId','creditAccountId','series','taxAssessment']) field_name
      WHERE jsonb_typeof(terms->field_name) IS DISTINCT FROM 'string')
    OR coalesce(length(terms->>'name'),0) NOT BETWEEN 1 AND 2000
    OR coalesce(length(terms->>'rationale'),0) NOT BETWEEN 1 AND 2000
    OR coalesce(terms->>'costMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
    OR coalesce(terms->>'residualMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
    OR coalesce(terms->>'evidenceId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR coalesce(terms->>'debitAccountId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR coalesce(terms->>'creditAccountId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR terms->>'debitAccountId' IS NOT DISTINCT FROM terms->>'creditAccountId'
    OR coalesce(terms->>'series','') !~ '^[A-Z0-9]{1,16}$'
    OR jsonb_typeof(terms->'usefulPeriods') IS DISTINCT FROM 'number'
    OR coalesce(terms->>'usefulPeriods','') !~ '^[1-9][0-9]{0,2}$'
    OR jsonb_typeof(terms->'periods') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Supply exact amounts, distinct accounts, explicit periods and the supported allocation policy.'); END IF;
  sl_count:=(terms->>'usefulPeriods')::integer;
  IF sl_count NOT BETWEEN 1 AND 120 OR jsonb_array_length(terms->'periods')<>sl_count THEN
    PERFORM openerp.fail('InvalidJournal','Supply one explicit date and accounting period for each of 1 to 120 useful periods.'); END IF;
  sl_cost:=(terms->>'costMinor')::numeric; sl_residual:=(terms->>'residualMinor')::numeric;
  IF sl_cost-sl_residual<sl_count THEN
    PERFORM openerp.fail('InvalidJournal','Cost less residual must allow at least one minor unit per occurrence.'); END IF;
  SELECT * INTO sl_evidence FROM openerp.evidence e WHERE e.book_id=book AND e.id=terms->>'evidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain supporting evidence in this book first.'); END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=book
    AND p.id IN (SELECT value->>'accountingPeriodId' FROM jsonb_array_elements(terms->'periods')) ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=book AND a.id IN(terms->>'debitAccountId',terms->>'creditAccountId') ORDER BY a.id FOR SHARE;
  IF (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=book AND a.active
      AND a.id IN(terms->>'debitAccountId',terms->>'creditAccountId'))<>2 THEN
    PERFORM openerp.fail('InvalidJournal','Choose two active accounts from this book.'); END IF;
  sl_base:=div(sl_cost-sl_residual,sl_count);
  FOR sl_period IN SELECT value FROM jsonb_array_elements(terms->'periods') LOOP
    IF jsonb_typeof(sl_period) IS DISTINCT FROM 'object' THEN
      PERFORM openerp.fail('InvalidJournal','Each occurrence needs an explicit date and accounting period.'); END IF;
    IF sl_period-ARRAY['postingDate','accountingPeriodId']<>'{}'::jsonb
      OR jsonb_typeof(sl_period->'postingDate') IS DISTINCT FROM 'string'
      OR jsonb_typeof(sl_period->'accountingPeriodId') IS DISTINCT FROM 'string'
      OR coalesce(sl_period->>'accountingPeriodId','') !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Each occurrence needs only its explicit date and accounting period.'); END IF;
    sl_date:=openerp.bank_date(sl_period->>'postingDate');
    IF sl_last_date IS NOT NULL AND sl_date<=sl_last_date THEN
      PERFORM openerp.fail('InvalidJournal','Occurrence dates must be strictly increasing.'); END IF;
    IF NOT EXISTS(SELECT FROM openerp.periods p JOIN openerp.fiscal_years y ON y.book_id=p.book_id AND y.id=p.fiscal_year_id
      WHERE p.book_id=book AND p.id=sl_period->>'accountingPeriodId' AND sl_date BETWEEN p.starts_on AND p.ends_on
        AND p.starts_on>=y.starts_on AND p.ends_on<=y.ends_on) THEN
      PERFORM openerp.fail('InvalidJournal','Every date must belong to its supplied period and fiscal year in this book.'); END IF;
    IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=book AND p.id=sl_period->>'accountingPeriodId' AND p.locked) THEN
      PERFORM openerp.fail('PeriodLocked','Schedule dates must use open periods.'); END IF;
    sl_last_date:=sl_date; sl_index:=sl_index+1;
    sl_amount:=CASE WHEN sl_index=sl_count THEN sl_cost-sl_residual-sl_base*(sl_count-1) ELSE sl_base END;
    sl_total:=sl_total+sl_amount;
    sl_occurrences:=sl_occurrences||jsonb_build_array(sl_period||jsonb_build_object(
      'ordinal',sl_index,'eventKey',schedule_id||'_'||sl_index::text,'amountMinor',sl_amount::text));
  END LOOP;
  IF sl_total+sl_residual<>sl_cost THEN PERFORM openerp.fail('InvalidJournal','Schedule amounts do not conserve the source cost.'); END IF;
  sl_body:=jsonb_build_object('scheduleId',schedule_id,'sourceKey',source_key,'revision',revision,
    'scope',jsonb_build_object('entityId',sl_book.entity_id,'bookId',book),'terms',terms,
    'currency',sl_book.currency,'currencyScale',sl_book.currency_scale,'sourceSha256',sl_evidence.sha256,
    'previousDigest',previous_digest,'occurrences',sl_occurrences,'allocatedMinor',sl_total::text,
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation',operation,'actorId',actor));
  RETURN sl_body||jsonb_build_object('digest',openerp.digest(sl_body));
END $$;

CREATE FUNCTION openerp.create_schedule(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_actor text; sl_previous jsonb; sl_body jsonb; sl_id text:=openerp.new_id('schedule');
BEGIN
  sl_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  sl_previous:=openerp.replay(scope->>'bookId',key,sl_actor,'create_schedule',input);
  IF sl_previous IS NOT NULL THEN RETURN sl_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Supply a schedule command.'); END IF;
  IF input-ARRAY['sourceKey','terms']<>'{}'::jsonb OR jsonb_typeof(input->'sourceKey') IS DISTINCT FROM 'string'
    OR coalesce(input->>'sourceKey','') !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a stable source component key and schedule terms.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_schedules s WHERE s.book_id=scope->>'bookId' AND s.source_key=input->>'sourceKey') THEN
    PERFORM openerp.fail('IdempotencyConflict','This source component already has a schedule. Recover it from the schedule list.'); END IF;
  sl_body:=openerp.subledger_revision_body(scope->>'bookId',sl_id,input->>'sourceKey',1,NULL,input->'terms',sl_actor,key,'create_schedule');
  INSERT INTO openerp.subledger_schedules VALUES(scope->>'bookId',sl_id,input->>'sourceKey');
  INSERT INTO openerp.subledger_schedule_revisions VALUES(scope->>'bookId',sl_id,1,input->'terms'->>'evidenceId',sl_body);
  RETURN openerp.save_command(scope->>'bookId',key,sl_actor,'create_schedule',input,sl_body);
END $$;

CREATE FUNCTION openerp.revise_schedule(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_actor text; sl_previous jsonb; sl_current jsonb; sl_body jsonb; sl_revision integer;
  sl_payload jsonb:=jsonb_build_object('id',id,'input',input);
BEGIN
  sl_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  sl_previous:=openerp.replay(scope->>'bookId',key,sl_actor,'revise_schedule',sl_payload);
  IF sl_previous IS NOT NULL THEN RETURN sl_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Supply a revision command.'); END IF;
  sl_current:=openerp.subledger_current(scope->>'bookId',id);
  IF input-ARRAY['expectedDigest','terms']<>'{}'::jsonb OR input->>'expectedDigest' IS DISTINCT FROM sl_current->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Review the current schedule digest before revising.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_preparations p WHERE p.book_id=scope->>'bookId' AND p.schedule_id=id)
    OR EXISTS(SELECT FROM openerp.events e WHERE e.book_id=scope->>'bookId' AND e.evidence_id=sl_current->'terms'->>'evidenceId'
      AND e.event_key IN(SELECT value->>'eventKey' FROM jsonb_array_elements(sl_current->'occurrences'))) THEN
    PERFORM openerp.fail('UnsupportedProfile','Prepared schedules are frozen. Future-term changes and correction replacements need a separate reviewed workflow.'); END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId'
    AND p.id IN(SELECT value->>'accountingPeriodId' FROM jsonb_array_elements(sl_current->'occurrences')) ORDER BY p.id FOR SHARE;
  IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=scope->>'bookId' AND p.locked
      AND p.id IN(SELECT value->>'accountingPeriodId' FROM jsonb_array_elements(sl_current->'occurrences'))) THEN
    PERFORM openerp.fail('PeriodLocked','A prior schedule occurrence belongs to a locked period. Reopen through the authorized workflow before revising.'); END IF;
  sl_revision:=(sl_current->>'revision')::integer+1;
  IF sl_revision>20 THEN PERFORM openerp.fail('UnsupportedProfile','This bounded schedule supports at most 20 retained revisions.'); END IF;
  sl_body:=openerp.subledger_revision_body(scope->>'bookId',id,sl_current->>'sourceKey',sl_revision,sl_current->>'digest',input->'terms',sl_actor,key,'revise_schedule');
  INSERT INTO openerp.subledger_schedule_revisions VALUES(scope->>'bookId',id,sl_revision,input->'terms'->>'evidenceId',sl_body);
  RETURN openerp.save_command(scope->>'bookId',key,sl_actor,'revise_schedule',sl_payload,sl_body);
END $$;

-- Caller holds the book lock. Only proposals made by this schedule count as recognition.
CREATE FUNCTION openerp.subledger_occurrence_states(book text, schedule jsonb, through_date date) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT coalesce(jsonb_agg(o.value||jsonb_build_object(
    'changeSetId',coalesce(posted_plan.id,c.id),'planDigest',coalesce(posted_plan.digest,c.digest),'voucherId',v.id,'reversalVoucherId',rv.id,
    'state',CASE WHEN v.id IS NOT NULL AND NOT EXISTS(SELECT FROM openerp.subledger_preparations linked
          WHERE linked.book_id=book AND linked.schedule_id=schedule->>'scheduleId'
            AND linked.ordinal=(o.value->>'ordinal')::integer AND linked.change_set_id=v.change_set_id) THEN 'conflicted'
      WHEN rv.id IS NOT NULL THEN 'reversed' WHEN v.id IS NOT NULL THEN 'posted'
      WHEN c.id IS NOT NULL THEN 'prepared' ELSE 'unprepared' END) ORDER BY (o.value->>'ordinal')::integer),'[]')
  FROM jsonb_array_elements(schedule->'occurrences') o(value)
  LEFT JOIN LATERAL(SELECT p.change_set_id FROM openerp.subledger_preparations p
    WHERE p.book_id=book AND p.schedule_id=schedule->>'scheduleId' AND p.ordinal=(o.value->>'ordinal')::integer
    ORDER BY p.attempt DESC LIMIT 1) prep ON true
  LEFT JOIN openerp.change_sets c ON c.book_id=book AND c.id=prep.change_set_id
  LEFT JOIN openerp.events e ON e.book_id=book AND e.evidence_id=schedule->'terms'->>'evidenceId' AND e.event_key=o.value->>'eventKey'
  LEFT JOIN openerp.vouchers v ON v.book_id=book AND v.event_id=e.id AND v.posting_purpose='adjustment'
    AND v.occurrence_key='manual_journal' AND v.posting_date<=through_date
  LEFT JOIN openerp.change_sets posted_plan ON posted_plan.book_id=book AND posted_plan.id=v.change_set_id
  LEFT JOIN openerp.vouchers rv ON rv.book_id=book AND rv.corrects_voucher_id=v.id AND rv.posting_date<=through_date
  WHERE (o.value->>'postingDate')::date<=through_date
$$;

CREATE FUNCTION openerp.get_schedule(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_current jsonb; sl_revisions jsonb; sl_states jsonb; sl_recognized numeric;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  sl_current:=openerp.subledger_current(scope->>'bookId',id);
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO sl_revisions FROM openerp.subledger_schedule_revisions r
    WHERE r.book_id=scope->>'bookId' AND r.schedule_id=id;
  sl_states:=openerp.subledger_occurrence_states(scope->>'bookId',sl_current,'9999-12-31'::date);
  SELECT coalesce(sum((value->>'amountMinor')::numeric),0) INTO sl_recognized
    FROM jsonb_array_elements(sl_states) WHERE value->>'state'='posted';
  RETURN jsonb_build_object('current',sl_current,'revisions',sl_revisions,'occurrences',sl_states,
    'recognizedMinor',sl_recognized::text,'remainingMinor',((sl_current->'terms'->>'costMinor')::numeric-sl_recognized)::text,
    'revisionAllowed',NOT EXISTS(SELECT FROM openerp.subledger_preparations p WHERE p.book_id=scope->>'bookId' AND p.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.events e WHERE e.book_id=scope->>'bookId' AND e.evidence_id=sl_current->'terms'->>'evidenceId'
        AND e.event_key IN(SELECT value->>'eventKey' FROM jsonb_array_elements(sl_current->'occurrences')))
      AND (sl_current->>'revision')::integer<20,
    'controlAccountReconciled',false,'requiresPostingApproval',true);
END $$;

CREATE FUNCTION openerp.list_schedules(token text, scope jsonb, after_id text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_items jsonb; sl_last text; sl_more boolean;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF after_id IS NULL OR (after_id<>'' AND after_id !~ '^[a-z][a-z0-9_-]{2,127}$') THEN
    PERFORM openerp.fail('InvalidJournal','Supply a schedule identifier cursor.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'sourceKey',r.body->>'sourceKey','name',r.body->'terms'->>'name','kind',r.body->'terms'->>'kind',
      'revision',(r.body->>'revision')::integer,'digest',r.body->>'digest') ORDER BY s.id COLLATE "C"),'[]'),max(s.id COLLATE "C") INTO sl_items,sl_last
    FROM(SELECT x.id FROM openerp.subledger_schedules x WHERE x.book_id=scope->>'bookId' AND x.id COLLATE "C">after_id COLLATE "C"
      ORDER BY x.id COLLATE "C" LIMIT 25) s
    JOIN LATERAL(SELECT y.body FROM openerp.subledger_schedule_revisions y WHERE y.book_id=scope->>'bookId' AND y.schedule_id=s.id ORDER BY y.revision DESC LIMIT 1) r ON true;
  SELECT EXISTS(SELECT FROM openerp.subledger_schedules s WHERE s.book_id=scope->>'bookId' AND s.id COLLATE "C">sl_last COLLATE "C") INTO sl_more;
  RETURN jsonb_build_object('items',sl_items,'next',CASE WHEN sl_more THEN sl_last ELSE NULL END);
END $$;

CREATE FUNCTION openerp.prepare_schedule_occurrence(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_actor text; sl_previous jsonb; sl_current jsonb; sl_occurrence jsonb; sl_plan jsonb; sl_result jsonb;
  sl_ordinal integer; sl_attempt integer; sl_error_code text; sl_payload jsonb:=jsonb_build_object('id',id,'input',input);
BEGIN
  sl_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  sl_previous:=openerp.replay(scope->>'bookId',key,sl_actor,'prepare_schedule_occurrence',sl_payload);
  IF sl_previous IS NOT NULL THEN RETURN sl_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Supply a preparation command.'); END IF;
  IF input-ARRAY['expectedDigest','ordinal']<>'{}'::jsonb OR jsonb_typeof(input->'ordinal') IS DISTINCT FROM 'number'
    OR coalesce(input->>'ordinal','') !~ '^[1-9][0-9]{0,2}$' THEN
    PERFORM openerp.fail('InvalidJournal','Select an occurrence and the reviewed revision digest.'); END IF;
  sl_current:=openerp.subledger_current(scope->>'bookId',id);
  IF input->>'expectedDigest' IS DISTINCT FROM sl_current->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','The schedule revision changed. Review it before preparation.'); END IF;
  sl_ordinal:=(input->>'ordinal')::integer;
  sl_occurrence:=sl_current->'occurrences'->(sl_ordinal-1);
  IF sl_occurrence IS NULL THEN PERFORM openerp.fail('NotFound','This occurrence is not in the schedule.'); END IF;
  IF EXISTS(SELECT FROM openerp.events e JOIN openerp.vouchers v ON v.book_id=e.book_id AND v.event_id=e.id
    WHERE e.book_id=scope->>'bookId' AND e.evidence_id=sl_current->'terms'->>'evidenceId'
      AND e.event_key=sl_occurrence->>'eventKey' AND v.posting_purpose='adjustment' AND v.occurrence_key='manual_journal') THEN
    PERFORM openerp.fail('AlreadyPosted','This schedule occurrence has a posting. Inspect its voucher and any linked reversal.'); END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId' AND p.id=sl_occurrence->>'accountingPeriodId' FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=scope->>'bookId'
    AND a.id IN(sl_current->'terms'->>'debitAccountId',sl_current->'terms'->>'creditAccountId') ORDER BY a.id FOR SHARE;
  SELECT p.attempt,c.plan INTO sl_attempt,sl_plan FROM openerp.subledger_preparations p
    JOIN openerp.change_sets c ON c.book_id=p.book_id AND c.id=p.change_set_id
    WHERE p.book_id=scope->>'bookId' AND p.schedule_id=prepare_schedule_occurrence.id AND p.ordinal=sl_ordinal ORDER BY p.attempt DESC LIMIT 1;
  IF sl_plan IS NOT NULL THEN
    BEGIN
      PERFORM openerp.check_dependencies(scope,sl_plan);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS sl_error_code=PG_EXCEPTION_DETAIL;
      IF sl_error_code<>'StaleDependency' THEN RAISE; END IF;
      sl_plan:=NULL;
    END;
  END IF;
  IF sl_plan IS NULL THEN
    sl_attempt:=coalesce(sl_attempt,0)+1;
    IF sl_attempt>100 THEN PERFORM openerp.fail('UnsupportedProfile','This occurrence reached its retained preparation limit.'); END IF;
    sl_plan:=openerp.prepare_journal(token,scope,
      'sl_'||substr(openerp.digest(jsonb_build_object('actor',sl_actor,'key',key,'id',id)),8),
      jsonb_build_object('kind','manual_journal','evidenceId',sl_current->'terms'->>'evidenceId','eventKey',sl_occurrence->>'eventKey',
        'accountingPeriodId',sl_occurrence->>'accountingPeriodId','postingDate',sl_occurrence->>'postingDate',
        'series',sl_current->'terms'->>'series','description',sl_current->'terms'->>'name',
        'rationale',left('Schedule '||id||' revision '||(sl_current->>'revision')||' occurrence '||sl_ordinal::text||': '||(sl_current->'terms'->>'rationale'),2000),
        'taxAssessment','not_applicable','lines',jsonb_build_array(
          jsonb_build_object('accountId',sl_current->'terms'->>'debitAccountId','debitMinor',sl_occurrence->>'amountMinor','creditMinor','0','description',sl_current->'terms'->>'name'),
          jsonb_build_object('accountId',sl_current->'terms'->>'creditAccountId','creditMinor',sl_occurrence->>'amountMinor','debitMinor','0','description',sl_current->'terms'->>'name'))));
    INSERT INTO openerp.subledger_preparations VALUES(scope->>'bookId',id,(sl_current->>'revision')::integer,sl_ordinal,sl_attempt,sl_plan->>'id');
  END IF;
  sl_result:=jsonb_build_object('scheduleId',id,'revisionDigest',sl_current->>'digest','ordinal',sl_ordinal,
    'changeSetId',sl_plan->>'id','planDigest',sl_plan->>'planDigest','requiresPostingApproval',true,
    'receipt',jsonb_build_object('key',key,'operation','prepare_schedule_occurrence','actorId',sl_actor));
  RETURN openerp.save_command(scope->>'bookId',key,sl_actor,'prepare_schedule_occurrence',sl_payload,sl_result);
END $$;

-- Internal close dependency, not a completeness certificate. Caller must hold the book lock.
CREATE FUNCTION openerp.subledger_close_dependencies(book text, ends_on date) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  WITH schedules AS (
    SELECT s.id,r.body,openerp.subledger_occurrence_states(book,r.body,ends_on) states FROM openerp.subledger_schedules s
      JOIN LATERAL(SELECT x.body FROM openerp.subledger_schedule_revisions x WHERE x.book_id=book AND x.schedule_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true
      WHERE s.book_id=book
  ), occurrences AS (SELECT o.value FROM schedules s CROSS JOIN LATERAL jsonb_array_elements(s.states) o(value))
  SELECT jsonb_build_object('coverageEstablished',false,
    'scheduleRevisionDigest',openerp.digest(coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'digest',s.body->>'digest','occurrences',s.states) ORDER BY s.id COLLATE "C") FROM schedules s),'[]')),
    'scheduleCount',(SELECT count(*) FROM schedules),
    'dueUnpreparedCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='unprepared'),
    'dueUnpostedCount',(SELECT count(*) FROM occurrences WHERE value->>'state' IN('unprepared','prepared','conflicted')),
    'reversedOccurrenceCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='reversed'),
    'conflictedOccurrenceCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='conflicted'),
    'limitation','Schedule inventory completeness and control-account reconciliation are not established.')
$$;

REVOKE ALL ON openerp.subledger_schedules,openerp.subledger_schedule_revisions,openerp.subledger_preparations FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.subledger_current(text,text),
  openerp.subledger_revision_body(text,text,text,integer,text,jsonb,text,text,text),openerp.subledger_occurrence_states(text,jsonb,date),
  openerp.subledger_close_dependencies(text,date),openerp.create_schedule(text,jsonb,text,jsonb),
  openerp.revise_schedule(text,jsonb,text,text,jsonb),openerp.get_schedule(text,jsonb,text),openerp.list_schedules(text,jsonb,text),
  openerp.prepare_schedule_occurrence(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.create_schedule(text,jsonb,text,jsonb),openerp.revise_schedule(text,jsonb,text,text,jsonb),
  openerp.get_schedule(text,jsonb,text),openerp.list_schedules(text,jsonb,text),
  openerp.prepare_schedule_occurrence(text,jsonb,text,text,jsonb) TO openerp_runtime;
