-- Explicit remaining-count changes on the existing estimates command.
-- Retired future identities remain immutable history and never regain posting authority.

CREATE OR REPLACE FUNCTION openerp.subledger_occurrence_states(book text, schedule jsonb, through_date date) RETURNS jsonb LANGUAGE sql STABLE
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
    JOIN openerp.subledger_schedule_revisions r ON r.book_id=p.book_id AND r.schedule_id=p.schedule_id AND r.revision=p.revision
    WHERE p.book_id=book AND p.schedule_id=schedule->>'scheduleId' AND p.ordinal=(o.value->>'ordinal')::integer
      AND r.evidence_id=schedule->'terms'->>'evidenceId'
      AND r.body->'occurrences'->(p.ordinal-1)->>'ordinal'=o.value->>'ordinal'
      AND r.body->'occurrences'->(p.ordinal-1)->>'eventKey'=o.value->>'eventKey'
    ORDER BY p.attempt DESC LIMIT 1) prep ON true
  LEFT JOIN openerp.change_sets c ON c.book_id=book AND c.id=prep.change_set_id
  LEFT JOIN openerp.events e ON e.book_id=book AND e.evidence_id=schedule->'terms'->>'evidenceId' AND e.event_key=o.value->>'eventKey'
  LEFT JOIN openerp.vouchers v ON v.book_id=book AND v.event_id=e.id AND v.posting_purpose='adjustment'
    AND v.occurrence_key='manual_journal' AND v.posting_date<=through_date
  LEFT JOIN openerp.change_sets posted_plan ON posted_plan.book_id=book AND posted_plan.id=v.change_set_id
  LEFT JOIN openerp.vouchers rv ON rv.book_id=book AND rv.corrects_voucher_id=v.id AND rv.posting_date<=through_date
  WHERE (o.value->>'postingDate')::date<=through_date
$$;

CREATE OR REPLACE FUNCTION openerp.subledger_basis_matches_revision(p_basis jsonb,p_revision jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
  SELECT coalesce(p_basis->>'digest'=openerp.digest(p_basis-'digest')
    AND p_revision->>'digest'=openerp.digest(p_revision-'digest')
    AND (p_basis->>'scheduleDigest'=p_revision->>'digest'
      OR (p_revision->'amendment'->>'kind' IN('future_dates_v1','remaining_estimate_v1','remaining_lifetime_v1')
        AND p_revision->'amendment'->>'basisDigest'=p_basis->>'digest'
        AND p_revision->'amendment'->>'basisScheduleDigest'=p_basis->>'scheduleDigest')),false)
$$;

CREATE OR REPLACE FUNCTION openerp.subledger_basis_revision_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE s_basis jsonb; s_current jsonb; s_kind text; s_estimate boolean; s_first integer;
  s_lifetime boolean; s_book openerp.books; s_input jsonb; s_review openerp.evidence; s_actor text; s_key text;
  s_states jsonb; s_state jsonb; s_occurrence jsonb; s_period jsonb;
  s_occurrences jsonb:='[]'; s_periods jsonb:='[]'; s_remaining numeric:=0; s_recognized numeric:=0; s_reversed numeric:=0;
  s_count integer; s_new_count integer; s_index integer:=0; s_event_key text;
  s_today date; s_date date; s_last date; s_reversal_date date;
BEGIN
  s_kind:=NEW.body->'amendment'->>'kind';
  s_lifetime:=s_kind='remaining_lifetime_v1';
  IF s_lifetime THEN
    SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  END IF;
  SELECT b.body INTO s_basis FROM openerp.subledger_bases b
    WHERE b.book_id=NEW.book_id AND b.schedule_id=NEW.schedule_id;
  IF NOT FOUND THEN
    IF s_lifetime THEN PERFORM openerp.fail('UnsupportedProfile','A lifetime amendment requires a linked carrying basis.'); END IF;
    RETURN NEW;
  END IF;
  s_current:=openerp.subledger_current(NEW.book_id,NEW.schedule_id);
  s_estimate:=s_kind IN('remaining_estimate_v1','remaining_lifetime_v1');
  IF s_kind IS NULL OR s_kind NOT IN('future_dates_v1','remaining_estimate_v1','remaining_lifetime_v1')
    OR NEW.body->'receipt'->>'operation' IS DISTINCT FROM
      (CASE WHEN s_estimate THEN 'amend_schedule_estimate' ELSE 'amend_schedule_future_dates' END)
    OR NEW.body->>'previousDigest' IS DISTINCT FROM s_current->>'digest'
    OR NEW.body->'amendment'->'input'->>'expectedDigest' IS DISTINCT FROM s_current->>'digest'
    OR NEW.revision<>(s_current->>'revision')::integer+1
    OR NEW.body->>'revision' IS DISTINCT FROM NEW.revision::text
    OR NEW.evidence_id IS DISTINCT FROM s_current->'terms'->>'evidenceId'
    OR NOT openerp.subledger_basis_matches_revision(s_basis,NEW.body)
    OR (NEW.body-ARRAY['digest','previousDigest','revision','createdAt','receipt','terms','occurrences','amendment','allocatedMinor'])
      IS DISTINCT FROM (s_current-ARRAY['digest','previousDigest','revision','createdAt','receipt','terms','occurrences','amendment','allocatedMinor'])
    OR (NOT s_lifetime AND jsonb_array_length(NEW.body->'occurrences')<>jsonb_array_length(s_current->'occurrences')) THEN
    PERFORM openerp.fail('UnsupportedProfile','A linked basis requires an immutable reviewed amendment with unchanged source and installment identities.'); END IF;
  IF s_lifetime THEN
    -- The physical revision boundary independently validates the whole transition.
    -- It does not trust a command's claimed recognition, identities or review metadata.
    s_input:=NEW.body->'amendment'->'input';
    s_today:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
    IF s_book.profile<>'synthetic-core-v1' OR s_book.authority<>'native' THEN
      PERFORM openerp.fail('UnsupportedProfile','Only native synthetic schedules support remaining-lifetime amendments.'); END IF;
    PERFORM openerp.commerce_exact_object(s_input,ARRAY['expectedDigest','expectedBasisDigest','firstOrdinal',
      'remainingMinor','residualMinor','installments','reviewEvidenceId','rationale']);
    IF jsonb_typeof(s_input->'firstOrdinal') IS DISTINCT FROM 'number'
      OR coalesce(s_input->>'firstOrdinal','') !~ '^[1-9][0-9]{0,2}$'
      OR jsonb_typeof(s_input->'remainingMinor') IS DISTINCT FROM 'string'
      OR coalesce(s_input->>'remainingMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
      OR jsonb_typeof(s_input->'residualMinor') IS DISTINCT FROM 'string'
      OR coalesce(s_input->>'residualMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
      OR jsonb_typeof(s_input->'installments') IS DISTINCT FROM 'array'
      OR jsonb_typeof(s_input->'reviewEvidenceId') IS DISTINCT FROM 'string'
      OR coalesce(s_input->>'reviewEvidenceId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR jsonb_typeof(s_input->'rationale') IS DISTINCT FROM 'string'
      OR length(s_input->>'rationale')>2000 OR length(btrim(s_input->>'rationale'))<1 THEN
      PERFORM openerp.fail('InvalidJournal','Supply the entire remaining suffix, exact remaining minor units, review evidence and rationale.'); END IF;
    IF s_input->>'expectedDigest' IS DISTINCT FROM s_current->>'digest'
      OR s_input->>'expectedBasisDigest' IS DISTINCT FROM s_basis->>'digest'
      OR NOT openerp.subledger_basis_matches_revision(s_basis,s_current)
      OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=s_book.id AND v.corrects_voucher_id=s_basis->'input'->>'voucherId') THEN
      PERFORM openerp.fail('StaleDependency','Lifetime amendments require the exact current schedule and intact linked carrying basis.'); END IF;
    s_actor:=NEW.body->'receipt'->>'actorId';
    s_key:=NEW.body->'receipt'->>'key';
    IF jsonb_typeof(NEW.body->'receipt'->'key') IS DISTINCT FROM 'string'
      OR coalesce(s_key,'') !~ '^[a-zA-Z0-9_-]{8,128}$'
      OR jsonb_typeof(NEW.body->'receipt'->'actorId') IS DISTINCT FROM 'string'
      OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=s_book.id AND m.actor_id=s_actor AND m.role='operator')
      OR NEW.body->'receipt' IS DISTINCT FROM jsonb_build_object('key',s_key,'operation','amend_schedule_estimate','actorId',s_actor) THEN
      PERFORM openerp.fail('InvalidJournal','A lifetime revision requires the exact operator amendment receipt identity.'); END IF;
    SELECT * INTO s_review FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=s_input->>'reviewEvidenceId';
    IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the lifetime-review evidence in this book first.'); END IF;
    s_first:=(s_input->>'firstOrdinal')::integer;
    s_count:=jsonb_array_length(s_current->'occurrences');
    s_new_count:=s_first-1+jsonb_array_length(s_input->'installments');
    IF s_first NOT BETWEEN 1 AND s_count OR jsonb_array_length(s_input->'installments') NOT BETWEEN 1 AND 120
      OR s_new_count NOT BETWEEN 1 AND 120 OR s_new_count=s_count OR NEW.revision>20
      OR jsonb_typeof(NEW.body->'occurrences') IS DISTINCT FROM 'array'
      OR jsonb_typeof(NEW.body->'terms'->'periods') IS DISTINCT FROM 'array' THEN
      PERFORM openerp.fail('InvalidJournal','A lifetime amendment must change a nonempty remaining count within120 current occurrences and20 revisions.'); END IF;
    IF jsonb_array_length(NEW.body->'occurrences')<>s_new_count
      OR NEW.body->'revision' IS DISTINCT FROM to_jsonb(NEW.revision)
      OR NEW.body->'terms'->'usefulPeriods' IS DISTINCT FROM to_jsonb(s_new_count)
      OR jsonb_array_length(NEW.body->'terms'->'periods')<>s_new_count
      OR NEW.body->'terms'->'residualMinor' IS DISTINCT FROM s_input->'residualMinor'
      OR NEW.body->'terms'->>'allocationPolicy' IS DISTINCT FROM 'explicit_remaining_minor_v1'
      OR (NEW.body->'terms'-ARRAY['periods','residualMinor','allocationPolicy','usefulPeriods'])
        IS DISTINCT FROM (s_current->'terms'-ARRAY['periods','residualMinor','allocationPolicy','usefulPeriods']) THEN
      PERFORM openerp.fail('UnsupportedProfile','Lifetime amendments may change only explicit future dates, amounts, count and residual, not source or accounts.'); END IF;
    -- Same lock order as native preparation; the book barrier serializes all schedule writers.
    PERFORM 1 FROM openerp.periods p WHERE p.book_id=s_book.id AND p.id IN(
      SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(s_input->'installments') x
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
        IF coalesce(s_state->>'state','') NOT IN('posted','reversed') THEN
          PERFORM openerp.fail('UnsupportedProfile','Every occurrence before the remaining suffix must be posted or fully reversed, never pending or conflicted.'); END IF;
        s_reversal_date:=NULL;
        IF s_state->>'state'='reversed' THEN
          SELECT v.posting_date INTO s_reversal_date FROM openerp.vouchers v
            WHERE v.book_id=s_book.id AND v.id=s_state->>'reversalVoucherId' AND v.posting_purpose='reversal';
          IF NOT FOUND THEN PERFORM openerp.fail('UnsupportedProfile','Only an exact retained full reversal can release prior recognition for this estimate.'); END IF;
          IF EXISTS(SELECT FROM openerp.correction_bundles c JOIN openerp.vouchers v
            ON v.book_id=c.book_id AND v.change_set_id=c.replacement_change_set_id
            WHERE c.book_id=s_book.id AND c.original_voucher_id=s_state->>'voucherId') THEN
            PERFORM openerp.fail('UnsupportedProfile','A posted correction replacement needs a separate carrying-basis review; its original reversal cannot fund this estimate.'); END IF;
          s_reversed:=s_reversed+(s_occurrence->>'amountMinor')::numeric;
        ELSE
          s_recognized:=s_recognized+(s_occurrence->>'amountMinor')::numeric;
        END IF;
        s_period:=s_current->'terms'->'periods'->(s_index-1);
        s_last:=greatest(s_last,(s_occurrence->>'postingDate')::date,s_reversal_date);
        s_occurrences:=s_occurrences||jsonb_build_array(s_occurrence);
        s_periods:=s_periods||jsonb_build_array(s_period-'amountMinor');
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
      END IF;
    END LOOP;
    s_index:=s_first-1;
    FOR s_period IN SELECT value FROM jsonb_array_elements(s_input->'installments') LOOP
      s_index:=s_index+1;
      PERFORM openerp.commerce_exact_object(s_period,ARRAY['postingDate','accountingPeriodId','amountMinor']);
      IF jsonb_typeof(s_period->'amountMinor') IS DISTINCT FROM 'string'
        OR coalesce(s_period->>'amountMinor','') !~ '^[1-9][0-9]{0,37}$'
        OR jsonb_typeof(s_period->'postingDate') IS DISTINCT FROM 'string'
        OR jsonb_typeof(s_period->'accountingPeriodId') IS DISTINCT FROM 'string'
        OR coalesce(s_period->>'accountingPeriodId','') !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
        PERFORM openerp.fail('InvalidJournal','Each remaining installment needs positive exact minor units, an explicit date and a period from this book. Zero-value completion is unsupported.'); END IF;
      s_date:=openerp.bank_date(s_period->>'postingDate');
      IF s_date<=s_today OR (s_last IS NOT NULL AND s_date<=s_last)
        OR s_date<=(s_basis->'input'->>'effectiveOn')::date THEN
        PERFORM openerp.fail('InvalidJournal','New dates must be future, strictly increasing and after all prefix postings/reversals and the carrying basis.'); END IF;
      IF NOT EXISTS(SELECT FROM openerp.periods p JOIN openerp.fiscal_years y ON y.book_id=p.book_id AND y.id=p.fiscal_year_id
        WHERE p.book_id=s_book.id AND p.id=s_period->>'accountingPeriodId'
          AND s_date BETWEEN p.starts_on AND p.ends_on AND p.starts_on>=y.starts_on AND p.ends_on<=y.ends_on) THEN
        PERFORM openerp.fail('InvalidJournal','Each new date must belong to its declared period and fiscal year.'); END IF;
      IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=s_book.id AND p.id=s_period->>'accountingPeriodId' AND p.locked) THEN
        PERFORM openerp.fail('PeriodLocked','New schedule dates must use open periods.'); END IF;
      s_last:=s_date;
      s_remaining:=s_remaining+(s_period->>'amountMinor')::numeric;
      s_occurrence:=NEW.body->'occurrences'->(s_index-1);
      s_event_key:=s_occurrence->>'eventKey';
      IF jsonb_typeof(s_occurrence->'eventKey') IS DISTINCT FROM 'string'
        OR s_occurrence IS DISTINCT FROM s_period||jsonb_build_object('ordinal',s_index,'eventKey',s_event_key) THEN
        PERFORM openerp.fail('InvalidJournal','Every new lifetime occurrence must match its explicit installment and contiguous ordinal.'); END IF;
      IF s_event_key !~ '^[a-zA-Z0-9_-]{1,128}$'
        OR EXISTS(SELECT FROM jsonb_array_elements(s_occurrences) o WHERE o->>'eventKey'=s_event_key)
        OR EXISTS(SELECT FROM openerp.subledger_schedule_revisions r
          CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
          WHERE r.book_id=s_book.id AND o->>'eventKey'=s_event_key)
        OR EXISTS(SELECT FROM openerp.events e WHERE e.book_id=s_book.id
          AND e.evidence_id=s_current->'terms'->>'evidenceId' AND e.event_key=s_event_key) THEN
        PERFORM openerp.fail('InvalidJournal','New lifetime occurrences require fresh unique event keys that have never been retained or used.'); END IF;
      s_occurrences:=s_occurrences||jsonb_build_array(s_occurrence);
      s_periods:=s_periods||jsonb_build_array(s_period-'amountMinor');
    END LOOP;
    IF s_remaining<>(s_input->>'remainingMinor')::numeric
      OR s_recognized+s_remaining+(s_input->>'residualMinor')::numeric<>(s_current->'terms'->>'costMinor')::numeric
      OR NEW.body->'allocatedMinor' IS DISTINCT FROM to_jsonb((s_recognized+s_remaining)::text)
      OR NEW.body->'occurrences' IS DISTINCT FROM s_occurrences
      OR NEW.body->'terms'->'periods' IS DISTINCT FROM s_periods
      OR NEW.body->'amendment' IS DISTINCT FROM jsonb_build_object('kind','remaining_lifetime_v1','input',s_input,
        'recognizedMinor',s_recognized::text,'reversedMinor',s_reversed::text,
        'basisDigest',s_basis->>'digest','basisScheduleDigest',s_basis->>'scheduleDigest',
        'reviewSha256',s_review.sha256,'reviewedOn',s_today::text)
      OR NOT openerp.subledger_estimate_current(NEW.book_id,NEW.body) THEN
      PERFORM openerp.fail('StaleDependency','Lifetime review must preserve every historical prefix byte and conserve the exact retained net carrying basis.'); END IF;
    RETURN NEW;
  END IF;
  s_first:=(NEW.body->'amendment'->'input'->>'firstOrdinal')::integer;
  IF s_first IS NULL OR s_first NOT BETWEEN 1 AND jsonb_array_length(s_current->'occurrences') THEN
    PERFORM openerp.fail('InvalidJournal','Select the complete remaining suffix.'); END IF;
  IF s_estimate THEN
    IF NEW.body->'terms'->>'allocationPolicy' IS DISTINCT FROM 'explicit_remaining_minor_v1'
      OR (NEW.body->'terms'-ARRAY['periods','residualMinor','allocationPolicy'])
        IS DISTINCT FROM (s_current->'terms'-ARRAY['periods','residualMinor','allocationPolicy']) THEN
      PERFORM openerp.fail('UnsupportedProfile','An estimate may change only future amounts/dates and residual under the explicit synthetic policy.'); END IF;
  ELSE
    IF (NEW.body->'terms'-'periods') IS DISTINCT FROM (s_current->'terms'-'periods')
      OR NEW.body->>'allocatedMinor' IS DISTINCT FROM s_current->>'allocatedMinor' THEN
      PERFORM openerp.fail('UnsupportedProfile','Date-only amendments cannot change financial terms or allocation.'); END IF;
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(NEW.body->'occurrences') WITH ORDINALITY o(value,n)
      WHERE (o.n<s_first AND o.value IS DISTINCT FROM s_current->'occurrences'->(o.n::integer-1))
        OR (o.value-CASE WHEN s_estimate THEN ARRAY['postingDate','accountingPeriodId','amountMinor']
          ELSE ARRAY['postingDate','accountingPeriodId'] END) IS DISTINCT FROM
          ((s_current->'occurrences'->(o.n::integer-1))-CASE WHEN s_estimate THEN ARRAY['postingDate','accountingPeriodId','amountMinor']
          ELSE ARRAY['postingDate','accountingPeriodId'] END))
    OR NOT openerp.subledger_estimate_current(NEW.book_id,NEW.body) THEN
    PERFORM openerp.fail('StaleDependency','Posted history must remain unchanged and the live recognized, future and residual amounts must conserve the retained cost.'); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION openerp.amend_schedule_estimate(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_book openerp.books; s_previous jsonb; s_current jsonb; s_basis jsonb;
  s_review openerp.evidence; s_states jsonb; s_state jsonb; s_occurrence jsonb; s_period jsonb;
  s_occurrences jsonb:='[]'; s_periods jsonb:='[]'; s_body jsonb; s_remaining numeric:=0;
  s_recognized numeric:=0; s_reversed numeric:=0; s_reversal_date date; s_first integer; s_count integer; s_index integer:=0; s_revision integer;
  s_new_count integer; s_lifetime boolean; s_event_key text;
  s_today date; s_date date; s_last date;
  s_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(s_book.id,p_key,s_actor,'amend_schedule_estimate',s_payload);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  s_today:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF s_book.profile<>'synthetic-core-v1' OR s_book.authority<>'native' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only native synthetic schedules support remaining-estimate amendments.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedDigest','expectedBasisDigest','firstOrdinal',
    'remainingMinor','residualMinor','installments','reviewEvidenceId','rationale']);
  IF jsonb_typeof(p_input->'firstOrdinal') IS DISTINCT FROM 'number'
    OR coalesce(p_input->>'firstOrdinal','') !~ '^[1-9][0-9]{0,2}$'
    OR jsonb_typeof(p_input->'remainingMinor') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'remainingMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
    OR jsonb_typeof(p_input->'residualMinor') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'residualMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
    OR jsonb_typeof(p_input->'installments') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_input->'reviewEvidenceId') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'reviewEvidenceId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string'
    OR length(p_input->>'rationale')>2000 OR length(btrim(p_input->>'rationale'))<1 THEN
    PERFORM openerp.fail('InvalidJournal','Supply the entire remaining suffix, exact remaining minor units, review evidence and rationale.'); END IF;
  s_current:=openerp.subledger_current(s_book.id,p_id);
  SELECT b.body INTO s_basis FROM openerp.subledger_bases b WHERE b.book_id=s_book.id AND b.schedule_id=p_id;
  IF s_basis IS NULL THEN
    PERFORM openerp.fail('UnsupportedProfile','Link a reviewed acquisition or imported carrying basis before changing the remaining estimate.'); END IF;
  IF p_input->>'expectedDigest' IS DISTINCT FROM s_current->>'digest'
    OR p_input->>'expectedBasisDigest' IS DISTINCT FROM s_basis->>'digest'
    OR NOT openerp.subledger_basis_matches_revision(s_basis,s_current)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=s_book.id AND v.corrects_voucher_id=s_basis->'input'->>'voucherId') THEN
    PERFORM openerp.fail('StaleDependency','Review the current schedule and intact linked carrying basis before changing the remaining estimate.'); END IF;
  SELECT * INTO s_review FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=p_input->>'reviewEvidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the remaining-estimate review evidence in this book first.'); END IF;
  s_first:=(p_input->>'firstOrdinal')::integer;
  s_count:=jsonb_array_length(s_current->'occurrences');
  s_revision:=(s_current->>'revision')::integer+1;
  IF s_revision>20 THEN PERFORM openerp.fail('UnsupportedProfile','This schedule reached its20 retained revision bound.'); END IF;
  s_new_count:=s_first-1+jsonb_array_length(p_input->'installments');
  s_lifetime:=s_new_count<>s_count;
  IF s_first NOT BETWEEN 1 AND s_count OR jsonb_array_length(p_input->'installments') NOT BETWEEN 1 AND 120
    OR s_new_count NOT BETWEEN 1 AND 120 THEN
    PERFORM openerp.fail('InvalidJournal','Replace an existing complete future suffix with at least one positive installment and at most120 total current occurrences.'); END IF;
  -- Same lock order as native preparation; the book barrier serializes all schedule writers.
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=s_book.id AND p.id IN(
    SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(p_input->'installments') x
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
      IF coalesce(s_state->>'state','') NOT IN('posted','reversed') THEN
        PERFORM openerp.fail('UnsupportedProfile','Every occurrence before the remaining suffix must be posted or fully reversed, never pending or conflicted.'); END IF;
      s_reversal_date:=NULL;
      IF s_state->>'state'='reversed' THEN
        SELECT v.posting_date INTO s_reversal_date FROM openerp.vouchers v
          WHERE v.book_id=s_book.id AND v.id=s_state->>'reversalVoucherId' AND v.posting_purpose='reversal';
        IF NOT FOUND THEN PERFORM openerp.fail('UnsupportedProfile','Only an exact retained full reversal can release prior recognition for this estimate.'); END IF;
        IF EXISTS(SELECT FROM openerp.correction_bundles c JOIN openerp.vouchers v
          ON v.book_id=c.book_id AND v.change_set_id=c.replacement_change_set_id
          WHERE c.book_id=s_book.id AND c.original_voucher_id=s_state->>'voucherId') THEN
          PERFORM openerp.fail('UnsupportedProfile','A posted correction replacement needs a separate carrying-basis review; its original reversal cannot fund this estimate.'); END IF;
        s_reversed:=s_reversed+(s_occurrence->>'amountMinor')::numeric;
      ELSE
        s_recognized:=s_recognized+(s_occurrence->>'amountMinor')::numeric;
      END IF;
      s_period:=s_current->'terms'->'periods'->(s_index-1);
      s_last:=greatest(s_last,(s_occurrence->>'postingDate')::date,s_reversal_date);
      s_occurrences:=s_occurrences||jsonb_build_array(s_occurrence);
      s_periods:=s_periods||jsonb_build_array(s_period-'amountMinor');
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
    END IF;
  END LOOP;
  -- Validate all old rows first, including rows omitted by a reduction.
  s_index:=s_first-1;
  FOR s_period IN SELECT value FROM jsonb_array_elements(p_input->'installments') LOOP
    s_index:=s_index+1;
    PERFORM openerp.commerce_exact_object(s_period,ARRAY['postingDate','accountingPeriodId','amountMinor']);
    IF jsonb_typeof(s_period->'amountMinor') IS DISTINCT FROM 'string'
      OR coalesce(s_period->>'amountMinor','') !~ '^[1-9][0-9]{0,37}$'
      OR jsonb_typeof(s_period->'postingDate') IS DISTINCT FROM 'string'
      OR jsonb_typeof(s_period->'accountingPeriodId') IS DISTINCT FROM 'string'
      OR coalesce(s_period->>'accountingPeriodId','') !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Each remaining installment needs positive exact minor units, an explicit date and a period from this book. Zero-value completion is unsupported.'); END IF;
    s_date:=openerp.bank_date(s_period->>'postingDate');
    IF s_date<=s_today OR (s_last IS NOT NULL AND s_date<=s_last)
      OR s_date<=(s_basis->'input'->>'effectiveOn')::date THEN
      PERFORM openerp.fail('InvalidJournal','New dates must be future, strictly increasing and after all prefix postings/reversals and the carrying basis.'); END IF;
    IF NOT EXISTS(SELECT FROM openerp.periods p JOIN openerp.fiscal_years y ON y.book_id=p.book_id AND y.id=p.fiscal_year_id
      WHERE p.book_id=s_book.id AND p.id=s_period->>'accountingPeriodId'
        AND s_date BETWEEN p.starts_on AND p.ends_on AND p.starts_on>=y.starts_on AND p.ends_on<=y.ends_on) THEN
      PERFORM openerp.fail('InvalidJournal','Each new date must belong to its declared period and fiscal year.'); END IF;
    IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=s_book.id AND p.id=s_period->>'accountingPeriodId' AND p.locked) THEN
      PERFORM openerp.fail('PeriodLocked','New schedule dates must use open periods.'); END IF;
    s_last:=s_date;
    s_remaining:=s_remaining+(s_period->>'amountMinor')::numeric;
    IF s_lifetime THEN
      s_event_key:=openerp.new_id('occurrence');
      IF s_event_key !~ '^[a-zA-Z0-9_-]{1,128}$'
        OR EXISTS(SELECT FROM jsonb_array_elements(s_occurrences) o WHERE o->>'eventKey'=s_event_key)
        OR EXISTS(SELECT FROM openerp.subledger_schedule_revisions r
          CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
          WHERE r.book_id=s_book.id AND o->>'eventKey'=s_event_key)
        OR EXISTS(SELECT FROM openerp.events e WHERE e.book_id=s_book.id
          AND e.evidence_id=s_current->'terms'->>'evidenceId' AND e.event_key=s_event_key) THEN
        PERFORM openerp.fail('InvalidJournal','New lifetime occurrences require fresh unique event keys that have never been retained or used.'); END IF;
      s_occurrence:=s_period||jsonb_build_object('ordinal',s_index,'eventKey',s_event_key);
    ELSE
      s_occurrence:=(s_current->'occurrences'->(s_index-1))||s_period;
    END IF;
    s_occurrences:=s_occurrences||jsonb_build_array(s_occurrence);
    s_periods:=s_periods||jsonb_build_array(s_period-'amountMinor');
  END LOOP;
  IF s_remaining<>(p_input->>'remainingMinor')::numeric
    OR s_remaining+s_recognized+(p_input->>'residualMinor')::numeric<>(s_current->'terms'->>'costMinor')::numeric THEN
    PERFORM openerp.fail('StaleDependency','Recognized amount plus the explicit remaining installments and residual must equal retained carrying cost exactly.'); END IF;
  IF s_occurrences=s_current->'occurrences'
    AND p_input->>'residualMinor'=s_current->'terms'->>'residualMinor'
    AND openerp.subledger_estimate_current(s_book.id,s_current) THEN
    PERFORM openerp.fail('InvalidJournal','The explicit amounts, residual and dates do not change the current schedule.'); END IF;
  s_body:=(s_current-ARRAY['digest','amendment'])||jsonb_build_object('revision',s_revision,
    'previousDigest',s_current->>'digest','allocatedMinor',(s_recognized+s_remaining)::text,
    'terms',(s_current->'terms')||jsonb_build_object('periods',s_periods,'residualMinor',p_input->>'residualMinor',
      'allocationPolicy','explicit_remaining_minor_v1')
      ||CASE WHEN s_lifetime THEN jsonb_build_object('usefulPeriods',s_new_count) ELSE '{}'::jsonb END,
    'occurrences',s_occurrences,'amendment',jsonb_build_object('kind',CASE WHEN s_lifetime THEN 'remaining_lifetime_v1' ELSE 'remaining_estimate_v1' END,'input',p_input,'recognizedMinor',s_recognized::text,'reversedMinor',s_reversed::text,
      'basisDigest',s_basis->>'digest','basisScheduleDigest',s_basis->>'scheduleDigest',
      'reviewSha256',s_review.sha256,'reviewedOn',s_today::text))
    ||openerp.commerce_record_metadata(p_key,'amend_schedule_estimate',s_actor);
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  INSERT INTO openerp.subledger_schedule_revisions(book_id,schedule_id,revision,evidence_id,body)
    VALUES(s_book.id,p_id,s_revision,s_current->'terms'->>'evidenceId',s_body);
  RETURN openerp.save_command(s_book.id,p_key,s_actor,'amend_schedule_estimate',s_payload,s_body);
END $$;
