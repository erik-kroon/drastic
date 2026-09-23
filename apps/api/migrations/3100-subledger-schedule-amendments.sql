-- Bounded AST-02: amend dates of the complete future unposted suffix only.
-- Amounts, occurrence identities, accounts and original carrying bases never change.
-- No historical revision, plan, approval, posting, receipt or report is rewritten.

CREATE FUNCTION openerp.subledger_basis_matches_revision(p_basis jsonb,p_revision jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
  SELECT coalesce(p_basis->>'digest'=openerp.digest(p_basis-'digest')
    AND p_revision->>'digest'=openerp.digest(p_revision-'digest')
    AND (p_basis->>'scheduleDigest'=p_revision->>'digest'
      OR (p_revision->'amendment'->>'kind'='future_dates_v1'
        AND p_revision->'amendment'->>'basisDigest'=p_basis->>'digest'
        AND p_revision->'amendment'->>'basisScheduleDigest'=p_basis->>'scheduleDigest')),false)
$$;

-- Only the new operator command constructs this retained amendment. Existing generic
-- revision commands cannot supply it, and runtime has no direct revision writes.
CREATE OR REPLACE FUNCTION openerp.subledger_basis_revision_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE s_basis jsonb; s_current jsonb;
BEGIN
  SELECT b.body INTO s_basis FROM openerp.subledger_bases b
    WHERE b.book_id=NEW.book_id AND b.schedule_id=NEW.schedule_id;
  IF FOUND THEN
    s_current:=openerp.subledger_current(NEW.book_id,NEW.schedule_id);
    IF NEW.body->'amendment'->>'kind' IS DISTINCT FROM 'future_dates_v1'
      OR NEW.body->'receipt'->>'operation' IS DISTINCT FROM 'amend_schedule_future_dates'
      OR NEW.body->>'previousDigest' IS DISTINCT FROM s_current->>'digest'
      OR NEW.body->'amendment'->'input'->>'expectedDigest' IS DISTINCT FROM s_current->>'digest'
      OR NEW.revision<>(s_current->>'revision')::integer+1
      OR NEW.body->>'revision' IS DISTINCT FROM NEW.revision::text
      OR NEW.evidence_id IS DISTINCT FROM s_current->'terms'->>'evidenceId'
      OR NOT openerp.subledger_basis_matches_revision(s_basis,NEW.body)
      OR (NEW.body-ARRAY['digest','previousDigest','revision','createdAt','receipt','terms','occurrences','amendment'])
        IS DISTINCT FROM (s_current-ARRAY['digest','previousDigest','revision','createdAt','receipt','terms','occurrences','amendment'])
      OR (NEW.body->'terms'-'periods') IS DISTINCT FROM (s_current->'terms'-'periods')
      OR jsonb_array_length(NEW.body->'occurrences')<>jsonb_array_length(s_current->'occurrences')
      OR EXISTS(SELECT FROM jsonb_array_elements(NEW.body->'occurrences') WITH ORDINALITY o(value,n)
        WHERE (o.value-ARRAY['postingDate','accountingPeriodId']) IS DISTINCT FROM
          ((s_current->'occurrences'->(o.n::integer-1))-ARRAY['postingDate','accountingPeriodId'])) THEN
      PERFORM openerp.fail('UnsupportedProfile','A linked basis permits only a reviewed future-date amendment with unchanged amounts and identities.');
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_posting_basis(p_book text,p_schedule text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_basis openerp.subledger_bases; s_current jsonb; s_blocker text; s_result jsonb;
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
  ELSIF NOT openerp.subledger_basis_matches_revision(s_basis.body,s_current) THEN
    s_blocker:='basis_mismatch';
  END IF;
  s_result:=jsonb_build_object('mode','linked_basis','supported',s_blocker IS NULL,
    'basisDigest',s_basis.body->>'digest','basisVoucherId',s_basis.voucher_id,
    'blocker',s_blocker,'legalPolicyApproved',false);
  -- Keep pre-amendment captures compatible. Every amended revision changes this
  -- authority;1800 compares the whole capture at validation and voucher insertion.
  IF s_current ? 'amendment' THEN
    s_result:=s_result||jsonb_build_object('scheduleDigest',s_current->>'digest');
  END IF;
  RETURN s_result;
END $$;

CREATE FUNCTION openerp.amend_schedule_future_dates(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_book openerp.books; s_previous jsonb; s_current jsonb; s_basis jsonb;
  s_review openerp.evidence; s_states jsonb; s_state jsonb; s_occurrence jsonb; s_period jsonb;
  s_occurrences jsonb:='[]'; s_periods jsonb:='[]'; s_body jsonb; s_remaining numeric:=0;
  s_recognized numeric:=0; s_first integer; s_count integer; s_index integer:=0; s_revision integer;
  s_today date; s_date date; s_last date;
  s_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(s_book.id,p_key,s_actor,'amend_schedule_future_dates',s_payload);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  s_today:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF s_book.profile<>'synthetic-core-v1' OR s_book.authority<>'native' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only native synthetic schedules support future-date amendments.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedDigest','expectedBasisDigest','firstOrdinal',
    'remainingMinor','periods','reviewEvidenceId','rationale']);
  IF jsonb_typeof(p_input->'firstOrdinal') IS DISTINCT FROM 'number'
    OR coalesce(p_input->>'firstOrdinal','') !~ '^[1-9][0-9]{0,2}$'
    OR jsonb_typeof(p_input->'remainingMinor') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'remainingMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
    OR jsonb_typeof(p_input->'periods') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_input->'reviewEvidenceId') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'reviewEvidenceId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'rationale')) NOT BETWEEN 1 AND 2000 THEN
    PERFORM openerp.fail('InvalidJournal','Supply the entire remaining suffix, exact remaining minor units, review evidence and rationale.'); END IF;
  s_current:=openerp.subledger_current(s_book.id,p_id);
  SELECT b.body INTO s_basis FROM openerp.subledger_bases b WHERE b.book_id=s_book.id AND b.schedule_id=p_id;
  IF s_basis IS NULL THEN
    PERFORM openerp.fail('UnsupportedProfile','Link a reviewed acquisition or imported carrying basis before amending future dates.'); END IF;
  IF p_input->>'expectedDigest' IS DISTINCT FROM s_current->>'digest'
    OR p_input->>'expectedBasisDigest' IS DISTINCT FROM s_basis->>'digest'
    OR openerp.subledger_posting_basis(s_book.id,p_id)->>'supported' IS DISTINCT FROM 'true' THEN
    PERFORM openerp.fail('StaleDependency','Review the current schedule and intact linked carrying basis before amending future dates.'); END IF;
  SELECT * INTO s_review FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=p_input->>'reviewEvidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the future-date review evidence in this book first.'); END IF;
  s_first:=(p_input->>'firstOrdinal')::integer;
  s_count:=jsonb_array_length(s_current->'occurrences');
  s_revision:=(s_current->>'revision')::integer+1;
  IF s_revision>20 THEN PERFORM openerp.fail('UnsupportedProfile','This schedule reached its20 retained revision bound.'); END IF;
  IF s_first NOT BETWEEN 1 AND s_count OR jsonb_array_length(p_input->'periods')<>s_count-s_first+1 THEN
    PERFORM openerp.fail('InvalidJournal','Supply one period for every remaining occurrence, with unchanged installment count.'); END IF;
  -- Same lock order as native preparation; the book barrier serializes all schedule writers.
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=s_book.id AND p.id IN(
    SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(p_input->'periods') x
    UNION SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(s_current->'occurrences') x
      WHERE (x->>'ordinal')::integer>=s_first) ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=s_book.id
    AND a.id IN(s_current->'terms'->>'debitAccountId',s_current->'terms'->>'creditAccountId') ORDER BY a.id FOR SHARE;
  IF (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=s_book.id AND a.active
    AND a.id IN(s_current->'terms'->>'debitAccountId',s_current->'terms'->>'creditAccountId'))<>2 THEN
    PERFORM openerp.fail('InvalidJournal','Schedule accounts must remain active.'); END IF;
  s_states:=openerp.subledger_occurrence_states(s_book.id,s_current,'9999-12-31'::date);
  IF jsonb_array_length(s_states)<>s_count THEN
    PERFORM openerp.fail('UnsupportedProfile','Occurrence history is ambiguous. Inspect postings and corrections before any amendment.'); END IF;
  FOR s_occurrence IN SELECT value FROM jsonb_array_elements(s_current->'occurrences') LOOP
    s_index:=s_index+1;
    s_state:=s_states->(s_index-1);
    IF s_index<s_first THEN
      IF s_state->>'state' IS DISTINCT FROM 'posted' THEN
        PERFORM openerp.fail('UnsupportedProfile','Every occurrence before the remaining suffix must be posted and unreversed.'); END IF;
      s_recognized:=s_recognized+(s_occurrence->>'amountMinor')::numeric;
      s_period:=s_current->'terms'->'periods'->(s_index-1);
      s_last:=(s_occurrence->>'postingDate')::date;
    ELSE
      IF coalesce(s_state->>'state','') NOT IN('unprepared','prepared')
        OR EXISTS(SELECT FROM openerp.events e JOIN openerp.vouchers v ON v.book_id=e.book_id AND v.event_id=e.id
          WHERE e.book_id=s_book.id AND e.evidence_id=s_current->'terms'->>'evidenceId'
            AND e.event_key=s_occurrence->>'eventKey') THEN
        PERFORM openerp.fail('AlreadyPosted','A remaining occurrence has a posting or correction. Its identity and dates cannot be amended.'); END IF;
      IF (s_occurrence->>'postingDate')::date<=s_today THEN
        PERFORM openerp.fail('UnsupportedProfile','Only a wholly future unposted suffix can be rescheduled. Due occurrences cannot be deferred by this command.'); END IF;
      IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=s_book.id
        AND p.id=s_occurrence->>'accountingPeriodId' AND p.locked) THEN
        PERFORM openerp.fail('PeriodLocked','An original remaining period is locked. Reopen through its authorized workflow first.'); END IF;
      s_period:=p_input->'periods'->(s_index-s_first);
      PERFORM openerp.commerce_exact_object(s_period,ARRAY['postingDate','accountingPeriodId']);
      IF jsonb_typeof(s_period->'postingDate') IS DISTINCT FROM 'string'
        OR jsonb_typeof(s_period->'accountingPeriodId') IS DISTINCT FROM 'string'
        OR coalesce(s_period->>'accountingPeriodId','') !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
        PERFORM openerp.fail('InvalidJournal','Each remaining occurrence needs an explicit date and period from this book.'); END IF;
      s_date:=openerp.bank_date(s_period->>'postingDate');
      IF s_date<=s_today OR (s_last IS NOT NULL AND s_date<=s_last)
        OR s_date<=(s_basis->'input'->>'effectiveOn')::date THEN
        PERFORM openerp.fail('InvalidJournal','New dates must be future, strictly increasing and after the posted prefix and carrying basis.'); END IF;
      IF NOT EXISTS(SELECT FROM openerp.periods p JOIN openerp.fiscal_years y ON y.book_id=p.book_id AND y.id=p.fiscal_year_id
        WHERE p.book_id=s_book.id AND p.id=s_period->>'accountingPeriodId'
          AND s_date BETWEEN p.starts_on AND p.ends_on AND p.starts_on>=y.starts_on AND p.ends_on<=y.ends_on) THEN
        PERFORM openerp.fail('InvalidJournal','Each new date must belong to its declared period and fiscal year.'); END IF;
      IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=s_book.id AND p.id=s_period->>'accountingPeriodId' AND p.locked) THEN
        PERFORM openerp.fail('PeriodLocked','New schedule dates must use open periods.'); END IF;
      s_last:=s_date;
      s_remaining:=s_remaining+(s_occurrence->>'amountMinor')::numeric;
      s_occurrence:=s_occurrence||s_period;
    END IF;
    s_occurrences:=s_occurrences||jsonb_build_array(s_occurrence);
    s_periods:=s_periods||jsonb_build_array(s_period);
  END LOOP;
  IF s_remaining<>(p_input->>'remainingMinor')::numeric
    OR s_remaining+s_recognized+(s_current->'terms'->>'residualMinor')::numeric<>(s_current->'terms'->>'costMinor')::numeric THEN
    PERFORM openerp.fail('StaleDependency','The explicit remaining amount must equal the complete unposted allocation, excluding residual value.'); END IF;
  IF s_occurrences=s_current->'occurrences' THEN
    PERFORM openerp.fail('InvalidJournal','The supplied future dates do not change the current schedule.'); END IF;
  s_body:=(s_current-ARRAY['digest','amendment'])||jsonb_build_object('revision',s_revision,
    'previousDigest',s_current->>'digest','terms',(s_current->'terms')||jsonb_build_object('periods',s_periods),
    'occurrences',s_occurrences,'amendment',jsonb_build_object('kind','future_dates_v1','input',p_input,
      'basisDigest',s_basis->>'digest','basisScheduleDigest',s_basis->>'scheduleDigest',
      'reviewSha256',s_review.sha256,'reviewedOn',s_today::text))
    ||openerp.commerce_record_metadata(p_key,'amend_schedule_future_dates',s_actor);
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  INSERT INTO openerp.subledger_schedule_revisions(book_id,schedule_id,revision,evidence_id,body)
    VALUES(s_book.id,p_id,s_revision,s_current->'terms'->>'evidenceId',s_body);
  RETURN openerp.save_command(s_book.id,p_key,s_actor,'amend_schedule_future_dates',s_payload,s_body);
END $$;

-- Preserve1500 capture semantics; recognize the retained date-amendment basis lineage.
CREATE OR REPLACE FUNCTION openerp.create_subledger_control(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE s_actor text; s_book openerp.books; s_previous jsonb; s_date date; s_digest text; s_evidence openerp.evidence;
  s_schedules jsonb; s_effects jsonb; s_lines jsonb; s_controls jsonb; s_body jsonb; s_content text;
  s_line_count integer; s_account_count integer; s_hash text; s_bytes integer;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(s_book.id,p_key,s_actor,'create_subledger_control',p_input);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  IF s_book.profile<>'synthetic-core-v1' OR s_book.authority<>'native' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only native synthetic schedule controls are implemented.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['asOfDate','accountIds','inventoryEvidenceId','rationale']);
  IF jsonb_typeof(p_input->'asOfDate') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string' OR length(btrim(p_input->>'rationale')) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(p_input->'inventoryEvidenceId') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the control date and evidence-backed account inventory rationale.'); END IF;
  s_date:=openerp.bank_date(p_input->>'asOfDate');
  SELECT * INTO s_evidence FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=p_input->>'inventoryEvidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain evidence for the declared control accounts.'); END IF;
  IF jsonb_typeof(p_input->'accountIds') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Declare1–20 distinct control accounts.'); END IF;
  s_account_count:=jsonb_array_length(p_input->'accountIds');
  IF s_account_count NOT BETWEEN 1 AND 20 OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'accountIds') a
    WHERE jsonb_typeof(a) IS DISTINCT FROM 'string' OR a#>>'{}' !~ '^[a-z][a-z0-9_-]{2,127}$')
    OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements_text(p_input->'accountIds') x)
    OR (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=s_book.id
      AND a.id IN(SELECT jsonb_array_elements_text(p_input->'accountIds')))<>s_account_count THEN
    PERFORM openerp.fail('InvalidJournal','Declare distinct existing control accounts from this book. Inactive accounts remain reportable.'); END IF;
  s_digest:=openerp.subledger_control_dependency_digest(s_book.id);
  IF s_digest IS NULL THEN PERFORM openerp.fail('UnsupportedProfile','Control capture exceeds200 schedules,1000 book accounts/periods or10000 preparations. No partial snapshot was saved.'); END IF;
  IF (SELECT count(*) FROM openerp.subledger_control_snapshots c WHERE c.book_id=s_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book reached its200 retained control-snapshot bound.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('revision',r.body,'basis',b.body,'occurrences',o.states,
    'basisReversed',EXISTS(SELECT FROM openerp.vouchers rv WHERE rv.book_id=s_book.id AND rv.corrects_voucher_id=b.voucher_id
      AND rv.posting_date<=s_date AND rv.sequence<=s_book.committed_sequence),
    'recognizedMinor',recognized.amount::text,
    'carryingMinor',CASE WHEN b.body IS NULL OR (b.body->'input'->>'effectiveOn')::date>s_date
      OR EXISTS(SELECT FROM openerp.vouchers rv WHERE rv.book_id=s_book.id AND rv.corrects_voucher_id=b.voucher_id
        AND rv.posting_date<=s_date AND rv.sequence<=s_book.committed_sequence)
      THEN NULL ELSE ((b.body->'input'->>'carryingMinor')::numeric-recognized.amount)::text END)
    ORDER BY s.id COLLATE "C"),'[]') INTO s_schedules FROM openerp.subledger_schedules s
    CROSS JOIN LATERAL(SELECT openerp.subledger_current(s_book.id,s.id) body) r
    LEFT JOIN openerp.subledger_bases b ON b.book_id=s.book_id AND b.schedule_id=s.id
    CROSS JOIN LATERAL(SELECT openerp.subledger_occurrence_states(s_book.id,r.body,s_date) states) o
    CROSS JOIN LATERAL(SELECT coalesce(sum((x->>'amountMinor')::numeric),0) amount FROM jsonb_array_elements(o.states) x
      WHERE x->>'state'='posted') recognized WHERE s.book_id=s_book.id;
  IF EXISTS(SELECT FROM jsonb_array_elements(s_schedules) s
      WHERE NOT (p_input->'accountIds' ? (s->'revision'->'terms'->>'creditAccountId'))
        OR p_input->'accountIds' ? (s->'revision'->'terms'->>'debitAccountId'))
    OR EXISTS(SELECT FROM openerp.subledger_bases b CROSS JOIN LATERAL jsonb_array_elements(b.body->'lines') l
      WHERE b.book_id=s_book.id AND NOT (p_input->'accountIds' ? (l->>'accountId'))) THEN
    PERFORM openerp.fail('InvalidJournal','Declare every known basis account and schedule credit account, but no schedule expense/debit account. No account was silently omitted.'); END IF;

  -- Expected effects use retained basis amounts and fixed0700 occurrence ordinal2, not GL sums.
  WITH effects AS (
    SELECT b.schedule_id,'basis'::text kind,b.voucher_id,(l->>'ordinal')::integer ordinal,l->>'accountId' account_id,
      (l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric amount
      FROM openerp.subledger_bases b CROSS JOIN LATERAL jsonb_array_elements(b.body->'lines') l
      WHERE b.book_id=s_book.id AND (b.body->'input'->>'effectiveOn')::date<=s_date
    UNION ALL
    SELECT s->'revision'->>'scheduleId','occurrence',o->>'voucherId',2,s->'revision'->'terms'->>'creditAccountId',-(o->>'amountMinor')::numeric
      FROM jsonb_array_elements(s_schedules) s CROSS JOIN LATERAL jsonb_array_elements(s->'occurrences') o
      WHERE o->>'state' IN('posted','reversed')
    UNION ALL
    SELECT s->'revision'->>'scheduleId','occurrence_reversal',o->>'reversalVoucherId',2,s->'revision'->'terms'->>'creditAccountId',(o->>'amountMinor')::numeric
      FROM jsonb_array_elements(s_schedules) s CROSS JOIN LATERAL jsonb_array_elements(s->'occurrences') o WHERE o->>'state'='reversed'
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('scheduleId',e.schedule_id,'kind',e.kind,'voucherId',e.voucher_id,
      'ordinal',e.ordinal,'accountId',e.account_id,'expectedMinor',e.amount::text)
      ORDER BY e.schedule_id COLLATE "C",e.kind COLLATE "C",e.voucher_id COLLATE "C",e.ordinal),'[]') INTO s_effects FROM effects e;
  IF EXISTS(SELECT FROM jsonb_array_elements(s_effects) e GROUP BY e->>'voucherId',e->>'ordinal' HAVING count(*)>1) THEN
    PERFORM openerp.fail('InvalidJournal','Basis and occurrence effects claim the same posted line. No snapshot was saved.'); END IF;
  SELECT count(*) INTO s_line_count FROM(SELECT 1 FROM openerp.journal_lines l
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id WHERE l.book_id=s_book.id
      AND l.account_id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'))
      AND v.posting_date<=s_date AND v.sequence<=s_book.committed_sequence LIMIT 5001) bounded;
  IF s_line_count>5000 THEN PERFORM openerp.fail('UnsupportedProfile','Declared-account controls exceed5000 ledger lines. No partial snapshot was saved.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId',v.id,'lineId',l.id,'ordinal',l.ordinal,'sequence',v.sequence::text,
    'postingDate',v.posting_date::text,'accountId',l.account_id,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,
    'description',l.description,'correctsVoucherId',v.corrects_voucher_id,'evidenceRefs',v.action->'evidenceRefs',
    'scheduleId',e.body->>'scheduleId','effectKind',e.body->>'kind','expectedMinor',coalesce(e.body->>'expectedMinor','0'),
    'unexplainedMinor',(l.debit_minor-l.credit_minor-coalesce((e.body->>'expectedMinor')::numeric,0))::text)
    ORDER BY v.sequence,l.ordinal),'[]') INTO s_lines FROM openerp.journal_lines l
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    LEFT JOIN LATERAL(SELECT x body FROM jsonb_array_elements(s_effects) x WHERE x->>'voucherId'=v.id
      AND (x->>'ordinal')::integer=l.ordinal AND x->>'accountId'=l.account_id) e ON true
    WHERE l.book_id=s_book.id AND l.account_id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'))
      AND v.posting_date<=s_date AND v.sequence<=s_book.committed_sequence;
  IF jsonb_array_length(s_lines)<>s_line_count THEN PERFORM openerp.fail('InvalidJournal','Control contribution count changed. No partial report was saved.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',a.id,'code',a.code,'name',a.name,'version',a.version::text,'active',a.active,
    'expectedMinor',expected.amount::text,'ledgerMinor',ledger.amount::text,'differenceMinor',(ledger.amount-expected.amount)::text,
    'unexplainedLineCount',ledger.unexplained,
    'missingEffectCount',(SELECT count(*) FROM jsonb_array_elements(s_effects) e WHERE e->>'accountId'=a.id
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(s_lines) l WHERE l->>'voucherId'=e->>'voucherId'
        AND l->>'ordinal'=e->>'ordinal' AND l->>'accountId'=e->>'accountId')))
    ORDER BY a.id COLLATE "C"),'[]') INTO s_controls FROM openerp.accounts a
    CROSS JOIN LATERAL(SELECT coalesce(sum((e->>'expectedMinor')::numeric),0) amount
      FROM jsonb_array_elements(s_effects) e WHERE e->>'accountId'=a.id) expected
    CROSS JOIN LATERAL(SELECT coalesce(sum((l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric),0) amount,
      count(*) FILTER(WHERE (l->>'unexplainedMinor')::numeric<>0) unexplained
      FROM jsonb_array_elements(s_lines) l WHERE l->>'accountId'=a.id) ledger
    WHERE a.book_id=s_book.id AND a.id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'));
  s_body:=jsonb_build_object('id',openerp.new_id('schedule_control'),'scope',p_scope,'kind','synthetic_subledger_control_v1',
    'input',p_input,'inventorySha256',s_evidence.sha256,'sequence',s_book.committed_sequence::text,
    'currency',s_book.currency,'currencyScale',s_book.currency_scale,'dependencyDigest',s_digest,
    'knowledgeBasis','current_known_facts_at_capture','coverage','not_established','financialCloseReady',false,
    'schedules',s_schedules,'expectedEffects',s_effects,'ledgerLines',s_lines,'controls',s_controls,
    'hasReviewGaps',jsonb_array_length(s_schedules)=0 OR EXISTS(SELECT FROM jsonb_array_elements(s_schedules) s
      WHERE s->'basis'='null'::jsonb OR (s->>'basisReversed')::boolean
        OR NOT openerp.subledger_basis_matches_revision(s->'basis',s->'revision')
        OR EXISTS(SELECT FROM jsonb_array_elements(s->'occurrences') o WHERE o->>'state'<>'posted'))
      OR EXISTS(SELECT FROM jsonb_array_elements(s_controls) c WHERE (c->>'differenceMinor')::numeric<>0
        OR (c->>'unexplainedLineCount')::integer<>0 OR (c->>'missingEffectCount')::integer<>0))
    ||openerp.commerce_record_metadata(p_key,'create_subledger_control',s_actor);
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  s_content:=openerp.canonical(s_body);
  s_bytes:=octet_length(convert_to(s_content,'UTF8'));
  IF s_bytes>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','The retained control JSON exceeds8MiB. No partial snapshot was saved.'); END IF;
  s_hash:=encode(sha256(convert_to(s_content,'UTF8')),'hex');
  INSERT INTO openerp.subledger_control_snapshots VALUES(s_book.id,s_body->>'id',s_body,s_content,s_hash,s_bytes);
  RETURN openerp.save_command(s_book.id,p_key,s_actor,'create_subledger_control',p_input,s_body);
END $$;

REVOKE ALL ON FUNCTION openerp.subledger_basis_matches_revision(jsonb,jsonb),
  openerp.subledger_basis_revision_guard(),openerp.subledger_posting_basis(text,text),
  openerp.amend_schedule_future_dates(text,jsonb,text,text,jsonb),
  openerp.create_subledger_control(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.amend_schedule_future_dates(text,jsonb,text,text,jsonb),
  openerp.create_subledger_control(text,jsonb,text,jsonb) TO openerp_runtime;
