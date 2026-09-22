-- Depends on0500. Keep recurring preparation separate from bank matching and posting.

CREATE OR REPLACE FUNCTION openerp.recurring_selection(book text, rule jsonb, input jsonb) RETURNS jsonb LANGUAGE plpgsql
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
      AND openerp.bank_allocated_source(o.book_id,o.statement_id,o.row_ordinal)=0;
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
      AND openerp.bank_allocated_source(o.book_id,o.statement_id,o.row_ordinal)=0;
  SELECT count(*) FILTER (WHERE openerp.bank_allocated_source(o.book_id,o.statement_id,o.row_ordinal)<>0),
    count(*) FILTER (WHERE openerp.bank_allocated_source(o.book_id,o.statement_id,o.row_ordinal)=0) - matching_count
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

CREATE OR REPLACE FUNCTION openerp.recurring_prepare_observation(token text, scope jsonb, rule jsonb, row_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE prepared openerp.recurring_preparations; plan jsonb; voucher openerp.vouchers; period openerp.periods;
  observed_event_id text; observed_event_key text; command_key text; input jsonb; magnitude text; bank_debit text; bank_credit text;
BEGIN
  IF openerp.bank_allocated_source(scope->>'bookId',row_data->>'statementId',(row_data->>'rowOrdinal')::integer)<>0 THEN
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

REVOKE ALL ON FUNCTION openerp.recurring_selection(text,jsonb,jsonb),openerp.recurring_prepare_observation(text,jsonb,jsonb,jsonb) FROM PUBLIC,openerp_runtime;
