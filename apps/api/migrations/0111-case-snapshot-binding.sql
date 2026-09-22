-- PL/pgSQL function-name qualification applies to parameters, not unlabeled locals.
CREATE OR REPLACE FUNCTION openerp.prepare_case_snapshot(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; b openerp.books; previous jsonb; captured_snapshot_id text := openerp.new_id('case_snapshot');
  captured_at timestamptz; case_bodies jsonb; result jsonb; totals jsonb; selected_count bigint; plan_count bigint;
BEGIN
  actor := openerp.authorize(token, scope);
  SELECT books.* INTO STRICT b FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(b.id, key, actor, 'prepare_case_snapshot', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  IF b.profile <> 'synthetic-core-v1' OR b.authority <> 'native' THEN
    PERFORM openerp.fail('UnsupportedProfile', 'Only native synthetic-core-v1 manual journal cases are supported.');
  END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR
    (input ? 'caseId' AND coalesce(input->>'caseId', '') !~ '^[a-z][a-z0-9_-]{2,127}$') THEN
    PERFORM openerp.fail('InvalidJournal', 'Use an optional manual-journal case identifier.');
  END IF;
  captured_at := clock_timestamp();
  SELECT count(*) INTO selected_count FROM openerp.events e WHERE e.book_id = b.id
    AND (NOT input ? 'caseId' OR e.id = input->>'caseId') AND EXISTS (
      SELECT FROM openerp.change_sets p WHERE p.book_id = e.book_id AND p.plan #>> '{groups,0,actions,0,eventId}' = e.id
        AND p.plan #>> '{groups,0,actions,0,postingPurpose}' = 'adjustment'
        AND p.plan #>> '{groups,0,actions,0,occurrenceKey}' = 'manual_journal');
  IF input ? 'caseId' AND selected_count = 0 THEN PERFORM openerp.fail('NotFound', 'This manual-journal case was not found.'); END IF;
  IF selected_count > 1000 THEN PERFORM openerp.fail('InvalidJournal', 'A snapshot supports at most 1000 cases; select a caseId.'); END IF;
  SELECT count(*) INTO plan_count FROM (
    SELECT 1 FROM openerp.change_sets p JOIN openerp.events e ON e.book_id = p.book_id
      AND e.id = p.plan #>> '{groups,0,actions,0,eventId}'
    WHERE e.book_id = b.id AND (NOT (input ? 'caseId') OR e.id = input->>'caseId') AND EXISTS (
      SELECT FROM openerp.change_sets original WHERE original.book_id = e.book_id
        AND original.plan #>> '{groups,0,actions,0,eventId}' = e.id
        AND original.plan #>> '{groups,0,actions,0,postingPurpose}' = 'adjustment'
        AND original.plan #>> '{groups,0,actions,0,occurrenceKey}' = 'manual_journal')
    LIMIT 10001
  ) selected_plans;
  IF plan_count > 10000 THEN PERFORM openerp.fail('InvalidJournal', 'A snapshot supports at most 10000 plans; narrow the case selection.'); END IF;
  SELECT coalesce(jsonb_agg(openerp.case_summary(e, openerp.case_base_uri(scope)) ORDER BY e.id), '[]') INTO case_bodies
    FROM openerp.events e WHERE e.book_id = b.id AND (NOT input ? 'caseId' OR e.id = input->>'caseId') AND EXISTS (
      SELECT FROM openerp.change_sets p WHERE p.book_id = e.book_id AND p.plan #>> '{groups,0,actions,0,eventId}' = e.id
        AND p.plan #>> '{groups,0,actions,0,postingPurpose}' = 'adjustment'
        AND p.plan #>> '{groups,0,actions,0,occurrenceKey}' = 'manual_journal');
  SELECT jsonb_build_object('cases', count(*)::text,
    'proposedCases', (count(*) FILTER (WHERE value->>'state' = 'proposed'))::text,
    'postedCases', (count(*) FILTER (WHERE value->>'state' = 'posted'))::text,
    'reversedCases', (count(*) FILTER (WHERE value->>'state' = 'reversed'))::text,
    'plans', plan_count::text,
    'postedDebitMinor', coalesce(sum((value #>> '{financialState,postedDebitMinor}')::numeric), 0)::text,
    'postedCreditMinor', coalesce(sum((value #>> '{financialState,postedCreditMinor}')::numeric), 0)::text)
    INTO totals FROM jsonb_array_elements(case_bodies);
  result := jsonb_build_object('id', captured_snapshot_id, 'scope', jsonb_build_object('entityId', b.entity_id, 'bookId', b.id),
    'schemaVersion', '1', 'kind', 'manual_journal_cases', 'selectedCaseId', input->>'caseId',
    'capturedAt', to_char(captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'preparedBy', actor,
    'sequence', b.committed_sequence::text, 'profile', b.profile, 'profileVersion', b.profile_version::text,
    'writerEpoch', b.writer_epoch::text, 'totals', totals,
    'coverage', jsonb_build_object('status', 'unknown', 'bankImportsIncluded', false, 'reconciliationReportId', NULL,
      'reason', 'Only events created by manual-journal proposals are selected. Imported bank rows are not business cases and this snapshot does not assess source completion; inspect an explicit bank reconciliation report separately.'));
  INSERT INTO openerp.case_context_snapshots VALUES(b.id, captured_snapshot_id, result);
  INSERT INTO openerp.case_context_items(book_id, snapshot_id, event_id, ordinal, body)
    SELECT b.id, captured_snapshot_id, value->>'id', ordinal, value FROM jsonb_array_elements(case_bodies) WITH ORDINALITY item(value, ordinal);
  INSERT INTO openerp.case_context_plans(book_id, snapshot_id, event_id, ordinal, change_set_id, body)
    SELECT b.id, captured_snapshot_id, c.event_id, row_number() OVER (PARTITION BY c.event_id ORDER BY p.created_at, p.id), p.id,
      openerp.case_plan_ref(p, openerp.case_base_uri(scope))
    FROM openerp.case_context_items c JOIN openerp.change_sets p ON p.book_id = c.book_id
      AND p.plan #>> '{groups,0,actions,0,eventId}' = c.event_id
    WHERE c.book_id = b.id AND c.snapshot_id = captured_snapshot_id;
  RETURN openerp.save_command(b.id, key, actor, 'prepare_case_snapshot', input, result);
END $$;

