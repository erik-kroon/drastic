-- Bind native synthetic recognition to the carrying basis reviewed at preparation.
-- Historical preparation rows keep NULL; no retained plan, receipt or posting is rewritten.
ALTER TABLE openerp.subledger_preparations ADD COLUMN basis_dependency jsonb;

-- Caller holds the book barrier. Supported means only this synthetic posting prerequisite.
CREATE FUNCTION openerp.subledger_posting_basis(p_book text,p_schedule text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_basis openerp.subledger_bases; s_current jsonb; s_blocker text;
BEGIN
  s_current:=openerp.subledger_current(p_book,p_schedule);
  SELECT * INTO s_basis FROM openerp.subledger_bases b
    WHERE b.book_id=p_book AND b.schedule_id=p_schedule;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('mode','standalone_synthetic','supported',true,
      'basisDigest',NULL,'basisVoucherId',NULL,'blocker',NULL,'legalPolicyApproved',false);
  END IF;
  IF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book
    AND v.corrects_voucher_id=s_basis.voucher_id) THEN
    s_blocker:='basis_reversed_or_corrected';
  ELSIF s_basis.body->>'scheduleDigest' IS DISTINCT FROM s_current->>'digest'
    OR s_basis.body->>'digest' IS DISTINCT FROM openerp.digest(s_basis.body-'digest') THEN
    s_blocker:='basis_mismatch';
  END IF;
  RETURN jsonb_build_object('mode','linked_basis','supported',s_blocker IS NULL,
    'basisDigest',s_basis.body->>'digest','basisVoucherId',s_basis.voucher_id,
    'blocker',s_blocker,'legalPolicyApproved',false);
END $$;

-- Called for validation/approval/execution and again at the physical voucher boundary.
CREATE FUNCTION openerp.subledger_check_posting_basis(p_book text,p_change text,p_action jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_preparation openerp.subledger_preparations; s_basis jsonb;
BEGIN
  -- Reversal is a source correction, not new schedule recognition. Existing kernel guards
  -- still require the exact original voucher/action and prevent reversal of a reversal.
  IF p_action->>'postingPurpose'='reversal' AND p_action->>'correctsVoucherId' IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO s_preparation FROM openerp.subledger_preparations p
    WHERE p.book_id=p_book AND p.change_set_id=p_change;
  IF FOUND THEN
    s_basis:=openerp.subledger_posting_basis(p_book,s_preparation.schedule_id);
    IF s_basis->>'supported' IS DISTINCT FROM 'true' THEN
      PERFORM openerp.fail('StaleDependency','The linked carrying basis is reversed, corrected or mismatched. Further recognition is blocked; inspect the retained basis and controls.'); END IF;
    IF s_preparation.basis_dependency IS DISTINCT FROM s_basis
      AND NOT(s_preparation.basis_dependency IS NULL AND s_basis->>'mode'='standalone_synthetic') THEN
      PERFORM openerp.fail('StaleDependency','This proposal did not capture the current carrying basis. Prepare the occurrence again and obtain a new human approval.'); END IF;
    RETURN;
  END IF;
  -- Generic/manual/recurring/correction-replacement paths cannot assert native provenance.
  -- Follow retained correction ancestry too: bundle replacements have a different event key.
  -- Unknown keys/evidence outside that lineage are not economic deduplication.
  IF EXISTS(
    WITH RECURSIVE origin_changes(change_set_id) AS (
      SELECT p_change
      UNION
      SELECT v.change_set_id FROM origin_changes o
        JOIN openerp.correction_bundles c ON c.book_id=p_book AND c.replacement_change_set_id=o.change_set_id
        JOIN openerp.vouchers v ON v.book_id=c.book_id AND v.id=c.original_voucher_id
    ), origin_events(event_id) AS (
      SELECT p_action->>'eventId'
      UNION
      SELECT v.event_id FROM origin_changes o JOIN openerp.vouchers v
        ON v.book_id=p_book AND v.change_set_id=o.change_set_id
    )
    SELECT FROM openerp.subledger_bases b
      JOIN openerp.subledger_schedule_revisions r ON r.book_id=b.book_id AND r.schedule_id=b.schedule_id
      JOIN openerp.events e ON e.book_id=r.book_id AND e.evidence_id=r.evidence_id
      JOIN origin_events source ON source.event_id=e.id
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
      WHERE b.book_id=p_book AND e.event_key=o->>'eventKey'
  ) THEN
    PERFORM openerp.fail('StaleDependency','This event belongs to a basis-linked schedule. Use native occurrence preparation; generic replacement recognition is unsupported.');
  END IF;
END $$;

CREATE FUNCTION openerp.subledger_basis_kernel_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_action jsonb;
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF TG_TABLE_NAME='vouchers' THEN
    PERFORM openerp.subledger_check_posting_basis(NEW.book_id,NEW.change_set_id,NEW.action);
  ELSE
    FOR s_action IN SELECT a.value FROM jsonb_array_elements(NEW.plan->'groups') g(value)
      CROSS JOIN LATERAL jsonb_array_elements(g.value->'actions') a(value) LOOP
      PERFORM openerp.subledger_check_posting_basis(NEW.book_id,NEW.id,s_action);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
-- Native preparation links the proposal later in the same transaction. No ambient bypass flag.
CREATE CONSTRAINT TRIGGER subledger_basis_proposal_owner AFTER INSERT ON openerp.change_sets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.subledger_basis_kernel_guard();
CREATE TRIGGER subledger_basis_posting_authority BEFORE INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.subledger_basis_kernel_guard();

CREATE OR REPLACE FUNCTION openerp.check_dependencies(scope jsonb, plan jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE dependency jsonb; current_version text;
BEGIN
  IF plan->>'planDigest' IS DISTINCT FROM openerp.digest(plan - 'planDigest') THEN
    PERFORM openerp.fail('StaleDependency', 'The sealed plan digest is invalid.');
  END IF;
  FOR dependency IN SELECT value FROM jsonb_array_elements(plan->'dependencies') LOOP
    current_version := NULL;
    CASE dependency->>'kind'
      WHEN 'profile' THEN SELECT profile_version::text INTO current_version FROM openerp.books WHERE id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'writer_epoch' THEN SELECT writer_epoch::text INTO current_version FROM openerp.books WHERE id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'period' THEN SELECT version::text INTO current_version FROM openerp.periods WHERE book_id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'account' THEN SELECT version::text INTO current_version FROM openerp.accounts WHERE book_id = scope->>'bookId' AND id = dependency->>'resourceId';
      ELSE PERFORM openerp.fail('StaleDependency', 'An unsupported dependency is present.');
    END CASE;
    IF current_version IS DISTINCT FROM dependency->>'version' THEN
      PERFORM openerp.fail('StaleDependency', 'The ' || (dependency->>'kind') || ' dependency ' || (dependency->>'resourceId') || ' changed. Prepare and approve a new plan.');
    END IF;
  END LOOP;
  PERFORM openerp.inspect_action(scope->>'bookId', plan->'groups'->0->'actions'->0);
  PERFORM openerp.subledger_check_posting_basis(scope->>'bookId',plan->>'id',plan->'groups'->0->'actions'->0);
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_schedule_occurrence(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_actor text; sl_previous jsonb; sl_current jsonb; sl_occurrence jsonb; sl_plan jsonb; sl_result jsonb; sl_basis jsonb;
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
  sl_basis:=openerp.subledger_posting_basis(scope->>'bookId',id);
  IF sl_basis->>'supported' IS DISTINCT FROM 'true' THEN
    PERFORM openerp.fail('StaleDependency','The linked carrying basis is reversed, corrected or mismatched. Further recognition is blocked; inspect the retained basis and controls.'); END IF;
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
    INSERT INTO openerp.subledger_preparations(book_id,schedule_id,revision,ordinal,attempt,change_set_id,basis_dependency)
      VALUES(scope->>'bookId',id,(sl_current->>'revision')::integer,sl_ordinal,sl_attempt,sl_plan->>'id',sl_basis);
  END IF;
  sl_result:=jsonb_build_object('scheduleId',id,'revisionDigest',sl_current->>'digest','ordinal',sl_ordinal,
    'changeSetId',sl_plan->>'id','planDigest',sl_plan->>'planDigest','requiresPostingApproval',true,'postingBasis',sl_basis,
    'receipt',jsonb_build_object('key',key,'operation','prepare_schedule_occurrence','actorId',sl_actor));
  RETURN openerp.save_command(scope->>'bookId',key,sl_actor,'prepare_schedule_occurrence',sl_payload,sl_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_schedule(token text, scope jsonb, id text) RETURNS jsonb
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
    'revisionAllowed',NOT EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=scope->>'bookId' AND b.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.subledger_preparations p WHERE p.book_id=scope->>'bookId' AND p.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.events e WHERE e.book_id=scope->>'bookId' AND e.evidence_id=sl_current->'terms'->>'evidenceId'
        AND e.event_key IN(SELECT value->>'eventKey' FROM jsonb_array_elements(sl_current->'occurrences')))
      AND (sl_current->>'revision')::integer<20,
    'controlAccountReconciled',false,'requiresPostingApproval',true,
    'postingBasis',openerp.subledger_posting_basis(scope->>'bookId',id));
END $$;

REVOKE ALL ON FUNCTION openerp.subledger_posting_basis(text,text),
  openerp.subledger_check_posting_basis(text,text,jsonb),openerp.subledger_basis_kernel_guard(),
  openerp.check_dependencies(jsonb,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_schedule_occurrence(text,jsonb,text,text,jsonb),
  openerp.get_schedule(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_schedule_occurrence(text,jsonb,text,text,jsonb),
  openerp.get_schedule(text,jsonb,text) TO openerp_runtime;
