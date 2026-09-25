CREATE TABLE openerp.subledger_impairment_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  schedule_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
  decision_key text NOT NULL,
  change_set_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL CHECK(octet_length(body::text)<=1048576),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,schedule_id,ordinal),
  UNIQUE(book_id,decision_key),
  UNIQUE(book_id,change_set_id),
  UNIQUE(book_id,evidence_id),
  UNIQUE(book_id,id,schedule_id),
  FOREIGN KEY(book_id,schedule_id) REFERENCES openerp.subledger_schedules,
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id
    AND body->'input'->>'scheduleId'=schedule_id
    AND body->'input'->>'decisionKey'=decision_key
    AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.subledger_impairment_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
  actor_id text NOT NULL REFERENCES openerp.actors,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,review_id,ordinal),
  UNIQUE(book_id,id,review_id),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.subledger_impairment_reviews,
  CHECK(body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.subledger_impairments (
  book_id text NOT NULL,
  id text NOT NULL,
  schedule_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  event_id text NOT NULL,
  voucher_id text NOT NULL,
  loss_line_id text NOT NULL,
  accumulated_impairment_line_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
  decision_key text NOT NULL,
  schedule_revision integer NOT NULL CHECK(schedule_revision BETWEEN 2 AND 20),
  posting_date date NOT NULL,
  impairment_minor openerp.minor_units NOT NULL CHECK(impairment_minor>0),
  loss_account_id text NOT NULL,
  accumulated_impairment_account_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,schedule_id,ordinal),
  UNIQUE(book_id,review_id),
  UNIQUE(book_id,approval_id),
  UNIQUE(book_id,posting_receipt_id),
  UNIQUE(book_id,event_id),
  UNIQUE(book_id,voucher_id),
  UNIQUE(book_id,decision_key),
  FOREIGN KEY(book_id,review_id,schedule_id) REFERENCES openerp.subledger_impairment_reviews(book_id,id,schedule_id),
  FOREIGN KEY(book_id,approval_id,review_id) REFERENCES openerp.subledger_impairment_approvals(book_id,id,review_id),
  FOREIGN KEY(book_id,posting_receipt_id) REFERENCES openerp.execution_receipts,
  FOREIGN KEY(book_id,event_id) REFERENCES openerp.events,
  FOREIGN KEY(book_id,voucher_id,loss_line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id),
  FOREIGN KEY(book_id,voucher_id,accumulated_impairment_line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id),
  FOREIGN KEY(book_id,loss_account_id) REFERENCES openerp.accounts(book_id,id),
  FOREIGN KEY(book_id,accumulated_impairment_account_id) REFERENCES openerp.accounts(book_id,id),
  CHECK(loss_account_id<>accumulated_impairment_account_id
    AND body->>'id'=id AND body->'scope'->>'bookId'=book_id
    AND body->>'scheduleId'=schedule_id AND body->>'reviewId'=review_id
    AND body->>'approvalId'=approval_id AND body->>'decisionKey'=decision_key
    AND body->>'scheduleRevision'=schedule_revision::text
    AND body->>'postingDate'=posting_date::text
    AND body->>'impairmentMinor'=impairment_minor::text
    AND body->>'lossAccountId'=loss_account_id
    AND body->>'accumulatedImpairmentAccountId'=accumulated_impairment_account_id
    AND body->'postingReceipt'->>'id'=posting_receipt_id
    AND body->'postingReceipt'->>'voucherId'=voucher_id
    AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_subledger_impairment_review BEFORE UPDATE OR DELETE ON openerp.subledger_impairment_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_impairment_approval BEFORE UPDATE OR DELETE ON openerp.subledger_impairment_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_impairment BEFORE UPDATE OR DELETE ON openerp.subledger_impairments
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.subledger_revision_at(p_book text,p_schedule text,p_date date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  WITH candidates AS (
    SELECT r.revision FROM openerp.subledger_schedule_revisions r
    WHERE r.book_id=p_book AND r.schedule_id=p_schedule AND (r.body->>'createdAt')::date<=p_date
    UNION
    SELECT i.schedule_revision FROM openerp.subledger_impairments i
    WHERE i.book_id=p_book AND i.schedule_id=p_schedule AND i.posting_date<=p_date
    UNION
    SELECT r.revision FROM openerp.subledger_disposals d
    JOIN openerp.subledger_schedule_revisions r ON r.book_id=d.book_id AND r.schedule_id=d.schedule_id
      AND r.body->>'digest'=d.body->>'scheduleDigest'
    WHERE d.book_id=p_book AND d.schedule_id=p_schedule AND d.posting_date<=p_date
  )
  SELECT r.body FROM openerp.subledger_schedule_revisions r
  WHERE r.book_id=p_book AND r.schedule_id=p_schedule
    AND r.revision=(SELECT max(revision) FROM candidates)
$$;

CREATE FUNCTION openerp.subledger_impairment_basis(p_book text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE
  i_current jsonb; i_basis jsonb; i_states jsonb; i_state jsonb; i_source openerp.evidence; i_review openerp.evidence;
  i_date date; i_last date; i_reversal_date date; i_seen_suffix boolean:=false;
  i_reversed numeric:=0; i_recognized numeric:=0; i_prior numeric; i_carrying numeric;
  i_post numeric; i_future numeric; i_impairment numeric; i_residual numeric; i_sum numeric:=0;
  i_installation jsonb; i_count integer;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  i_current:=openerp.subledger_current(p_book,p_input->>'scheduleId');
  SELECT b.body INTO i_basis FROM openerp.subledger_bases b
    WHERE b.book_id=p_book AND b.schedule_id=p_input->>'scheduleId';
  IF i_basis IS NULL OR i_current->'terms'->>'kind'<>'asset' THEN
    PERFORM openerp.fail('UnsupportedProfile','Impairment supports only a native asset with a retained gross and accumulated carrying basis.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book AND d.schedule_id=p_input->>'scheduleId') THEN
    PERFORM openerp.fail('AlreadyPosted','This schedule is disposed and cannot be impaired.'); END IF;
  IF p_input->>'profile' IS DISTINCT FROM 'synthetic_asset_impairment_v1'
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb
    OR p_input->>'taxAssessment' IS DISTINCT FROM 'not_applicable'
    OR p_input->>'expectedDigest' IS DISTINCT FROM i_current->>'digest'
    OR p_input->>'expectedBasisDigest' IS DISTINCT FROM i_basis->>'digest'
    OR NOT openerp.subledger_basis_matches_revision(i_basis,i_current)
    OR openerp.subledger_posting_basis(p_book,p_input->>'scheduleId')->>'supported' IS DISTINCT FROM 'true' THEN
    PERFORM openerp.fail('StaleDependency','Review the current schedule, carrying basis and post-impairment schedule before impairment.'); END IF;
  i_date:=openerp.bank_date(p_input->>'postingDate');
  IF i_date<(i_basis->'input'->>'effectiveOn')::date THEN
    PERFORM openerp.fail('InvalidJournal','Impairment cannot precede its retained acquisition or imported basis.'); END IF;
  i_states:=openerp.subledger_occurrence_states(p_book,i_current,'9999-12-31'::date);
  IF jsonb_array_length(i_states)<>jsonb_array_length(i_current->'occurrences')
    OR EXISTS(SELECT FROM jsonb_array_elements(i_states) state
      WHERE state->>'state' NOT IN('unprepared','prepared','posted','reversed'))
    OR EXISTS(SELECT FROM jsonb_array_elements(i_states) state
      WHERE state->>'state'='reversed' AND NOT EXISTS(
        SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=state->>'reversalVoucherId'
          AND v.posting_purpose='reversal')) THEN
    PERFORM openerp.fail('UnsupportedProfile','Resolve ambiguous or unsupported occurrence history before impairment.'); END IF;
  FOR i_state IN SELECT value FROM jsonb_array_elements(i_states) LOOP
    IF NOT i_seen_suffix AND i_state->>'state' IN('posted','reversed') THEN
      IF i_state->>'state'='posted' THEN
        i_recognized:=i_recognized+(i_state->>'amountMinor')::numeric;
      ELSE
        i_reversed:=i_reversed+(i_state->>'amountMinor')::numeric;
        SELECT v.posting_date INTO i_reversal_date FROM openerp.vouchers v
          WHERE v.book_id=p_book AND v.id=i_state->>'reversalVoucherId';
      END IF;
      i_last:=greatest(i_last,i_state->>'postingDate'::date,i_reversal_date);
      i_reversal_date:=NULL;
    ELSE
      i_seen_suffix:=true;
      IF i_state->>'state' NOT IN('unprepared','prepared') THEN
        PERFORM openerp.fail('UnsupportedProfile','Every occurrence after the consumed prefix must be wholly unposted and unprepared or prepared.'); END IF;
    END IF;
  END LOOP;
  IF NOT i_seen_suffix OR (i_last IS NOT NULL AND i_date<i_last)
    OR EXISTS(SELECT FROM jsonb_array_elements(i_states) state JOIN openerp.correction_bundles c
      ON c.book_id=p_book AND c.original_voucher_id=state->>'voucherId'
      WHERE state->>'voucherId' IS NOT NULL) THEN
    PERFORM openerp.fail('UnsupportedProfile','A complete future suffix is required and consumed correction replacement history is unsupported.'); END IF;
  SELECT coalesce(sum(e.impairment_minor),0) INTO i_prior
    FROM openerp.subledger_impairments e WHERE e.book_id=p_book AND e.schedule_id=p_input->>'scheduleId';
  IF EXISTS(SELECT FROM openerp.subledger_impairments e WHERE e.book_id=p_book
      AND e.schedule_id=p_input->>'scheduleId' AND e.posting_date>i_date) THEN
    PERFORM openerp.fail('StaleDependency','A later impairment already changes this schedule. Review the current carrying amount.'); END IF;
  i_impairment:=(p_input->>'impairmentMinor')::numeric;
  i_residual:=(p_input->>'residualMinor')::numeric;
  i_carrying:=(i_basis->'input'->>'carryingMinor')::numeric-i_recognized-i_prior;
  i_post:=i_carrying-i_impairment;
  i_future:=i_post-i_residual;
  IF i_impairment<=0 OR i_impairment>=i_carrying OR i_post<=0 OR i_future<=0
    OR p_input->>'futureMinor' IS DISTINCT FROM i_future::text
    OR jsonb_typeof(p_input->'installments') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Impairment must be positive and below current carrying, with positive post-impairment carrying, future installments and nonnegative residual.'); END IF;
  i_count:=jsonb_array_length(p_input->'installments');
  IF i_count NOT BETWEEN 1 AND 120 THEN
    PERFORM openerp.fail('InvalidJournal','Supply at least one and at most120 complete future installments.'); END IF;
  FOR i_installation IN SELECT value FROM jsonb_array_elements(p_input->'installments') LOOP
    PERFORM openerp.commerce_exact_object(i_installation,ARRAY['postingDate','accountingPeriodId','amountMinor']);
    IF jsonb_typeof(i_installation->'amountMinor') IS DISTINCT FROM 'string'
      OR coalesce(i_installation->>'amountMinor','') !~ '^[1-9][0-9]{0,37}$' THEN
      PERFORM openerp.fail('InvalidJournal','Each future impairment installment needs a positive canonical minor-unit amount.'); END IF;
    i_sum:=i_sum+(i_installation->>'amountMinor')::numeric;
  END LOOP;
  IF i_sum<>i_future THEN
    PERFORM openerp.fail('InvalidJournal','The complete future suffix must sum exactly to post-impairment carrying less residual.'); END IF;
  IF p_input->>'lossAccountId'=p_input->>'accumulatedImpairmentAccountId'
    OR p_input->>'lossAccountId' IN(i_current->'terms'->>'debitAccountId',i_current->'terms'->>'creditAccountId')
    OR p_input->>'accumulatedImpairmentAccountId' IN(i_current->'terms'->>'debitAccountId',i_current->'terms'->>'creditAccountId')
    OR EXISTS(SELECT FROM jsonb_array_elements(i_basis->'lines') l
      WHERE l->>'accountId' IN(p_input->>'lossAccountId',p_input->>'accumulatedImpairmentAccountId'))
    OR (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=p_book AND a.active
      AND a.id IN(p_input->>'lossAccountId',p_input->>'accumulatedImpairmentAccountId'))<>2 THEN
    PERFORM openerp.fail('InvalidJournal','Select distinct active impairment roles outside all ordinary schedule and carrying controls.'); END IF;
  IF EXISTS(WITH ids AS (
      SELECT p_input->>'lossAccountId' id UNION SELECT p_input->>'accumulatedImpairmentAccountId'
      UNION SELECT i_current->'terms'->>'debitAccountId' UNION SELECT i_current->'terms'->>'creditAccountId'
      UNION SELECT l->>'accountId' FROM jsonb_array_elements(i_basis->'lines') l
    ) SELECT FROM ids x WHERE
      EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.owner_control_accounts c WHERE c.book_id=p_book AND c.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.tax_account_sources t WHERE t.book_id=p_book AND t.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.vat_control_account_roles v WHERE v.book_id=p_book AND v.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.subledger_impairments e WHERE e.book_id=p_book
        AND e.schedule_id=p_input->>'scheduleId'
        AND e.accumulated_impairment_account_id<>p_input->>'accumulatedImpairmentAccountId'
        AND e.accumulated_impairment_account_id=x.id)) THEN
    PERFORM openerp.fail('InvalidJournal','Impairment roles must be distinct from known controls and retain one accumulated-impairment account per schedule.'); END IF;
  SELECT * INTO i_source FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'evidenceId';
  SELECT * INTO i_review FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'reviewEvidenceId';
  IF i_source.id IS NULL OR i_review.id IS NULL THEN
    PERFORM openerp.fail('MissingEvidence','Retain impairment source and review evidence in this book.'); END IF;
  RETURN jsonb_build_object('schedule',i_current,'carryingBasis',i_basis,'occurrences',i_states,
    'originalCostMinor',i_basis->'input'->>'originalCostMinor','openingAccumulatedMinor',i_basis->'input'->>'accumulatedMinor',
    'recognizedMinor',i_recognized::text,'reversedMinor',i_reversed::text,'priorImpairmentMinor',i_prior::text,
    'currentCarryingMinor',i_carrying::text,'postImpairmentCarryingMinor',i_post::text,'futureMinor',i_future::text,
    'residualMinor',i_residual::text,'sourceSha256',i_source.sha256,'reviewSha256',i_review.sha256);
END $$;

CREATE FUNCTION openerp.prepare_subledger_impairment(p_token text,p_scope jsonb,p_key text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  i_actor text; i_book openerp.books; i_previous jsonb; i_basis jsonb; i_schedule jsonb; i_states jsonb;
  i_state jsonb; i_period jsonb; i_occurrences jsonb:='[]'; i_periods jsonb:='[]'; i_revision jsonb;
  i_body jsonb; i_evidence jsonb; i_plan jsonb; i_id text:=openerp.new_id('asset_impairment_review');
  i_ordinal integer; i_index integer:=0; i_first integer; i_revision_number integer; i_event_key text;
  i_recognized numeric; i_reversed numeric; i_prior numeric; i_impairment numeric; i_net numeric;
  i_future numeric; i_date date; i_reversal_date date; i_last date; i_today date; i_field text;
BEGIN
  i_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT i_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  i_previous:=openerp.replay(i_book.id,p_key,i_actor,'prepare_subledger_impairment',p_input);
  IF i_previous IS NOT NULL THEN RETURN i_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','scheduleId','decisionKey','expectedDigest','expectedBasisDigest',
    'postingDate','accountingPeriodId','series','lossAccountId','accumulatedImpairmentAccountId','impairmentMinor',
    'futureMinor','residualMinor','installments','evidenceId','reviewEvidenceId','rationale','taxAssessment','acknowledgeSyntheticOnly']);
  FOREACH i_field IN ARRAY ARRAY['decisionKey','series'] LOOP
    IF jsonb_typeof(p_input->i_field) IS DISTINCT FROM 'string' THEN
      PERFORM openerp.fail('InvalidJournal','Supply a stable decision key and explicit voucher series.'); END IF;
  END LOOP;
  IF p_input->>'decisionKey' !~ '^[a-zA-Z0-9_-]{8,128}$' OR p_input->>'series' !~ '^[A-Z0-9]{1,16}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use a stable decision key and an uppercase voucher series.'); END IF;
  FOREACH i_field IN ARRAY ARRAY['scheduleId','accountingPeriodId','lossAccountId','accumulatedImpairmentAccountId','evidenceId','reviewEvidenceId'] LOOP
    IF openerp.commerce_text(p_input,i_field,128) !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Use retained identifiers from this book.'); END IF;
  END LOOP;
  FOREACH i_field IN ARRAY ARRAY['expectedDigest','expectedBasisDigest'] LOOP
    IF openerp.commerce_text(p_input,i_field,71) !~ '^sha256:[a-f0-9]{64}$' THEN
      PERFORM openerp.fail('InvalidJournal','Supply exact current schedule and carrying-basis digests.'); END IF;
  END LOOP;
  FOREACH i_field IN ARRAY ARRAY['impairmentMinor','futureMinor','residualMinor'] LOOP
    IF jsonb_typeof(p_input->i_field) IS DISTINCT FROM 'string'
      OR p_input->>i_field !~ '^(0|[1-9][0-9]{0,37})$' THEN
      PERFORM openerp.fail('InvalidJournal','Use canonical nonnegative integer minor-unit amounts.'); END IF;
  END LOOP;
  PERFORM openerp.commerce_text(p_input,'postingDate',10);
  PERFORM openerp.commerce_text(p_input,'rationale',2000);
  IF EXISTS(SELECT FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_scope->>'bookId'
      AND r.decision_key=p_input->>'decisionKey') THEN
    PERFORM openerp.fail('IdempotencyConflict','This impairment decision key already has a retained review. Recover it before creating another decision.'); END IF;
  i_basis:=openerp.subledger_impairment_basis(p_scope->>'bookId',p_input);
  i_schedule:=i_basis->'schedule'; i_states:=i_basis->'occurrences';
  i_recognized:=(i_basis->>'recognizedMinor')::numeric; i_reversed:=(i_basis->>'reversedMinor')::numeric;
  i_prior:=(i_basis->>'priorImpairmentMinor')::numeric; i_impairment:=(p_input->>'impairmentMinor')::numeric;
  i_net:=i_prior+i_impairment; i_future:=(i_basis->>'futureMinor')::numeric;
  i_revision_number:=(i_schedule->>'revision')::integer+1;
  i_today:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF i_revision_number>20 THEN
    PERFORM openerp.fail('UnsupportedProfile','This schedule reached its20 retained revision bound.'); END IF;
  FOR i_state IN SELECT value FROM jsonb_array_elements(i_states) LOOP
    i_index:=i_index+1;
    IF i_state->>'state' IN('posted','reversed') THEN
      i_occurrences:=i_occurrences||jsonb_build_array(i_schedule->'occurrences'->(i_index-1));
      i_periods:=i_periods||jsonb_build_array(i_schedule->'terms'->'periods'->(i_index-1));
      i_reversal_date:=NULL;
      IF i_state->>'state'='reversed' THEN
        SELECT v.posting_date INTO i_reversal_date FROM openerp.vouchers v
          WHERE v.book_id=p_scope->>'bookId' AND v.id=i_state->>'reversalVoucherId';
      END IF;
      i_last:=greatest(i_last,i_state->>'postingDate'::date,i_reversal_date);
    ELSE i_first:=coalesce(i_first,i_index); END IF;
  END LOOP;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=p_scope->>'bookId'
    AND p.id IN(p_input->>'accountingPeriodId',(SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(p_input->'installments') x))
    ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=p_scope->>'bookId' AND a.id IN(
    p_input->>'lossAccountId',p_input->>'accumulatedImpairmentAccountId',
    i_schedule->'terms'->>'debitAccountId',i_schedule->'terms'->>'creditAccountId') ORDER BY a.id FOR SHARE;
  IF (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=p_scope->>'bookId' AND a.active
      AND a.id IN(p_input->>'lossAccountId',p_input->>'accumulatedImpairmentAccountId',
        i_schedule->'terms'->>'debitAccountId',i_schedule->'terms'->>'creditAccountId'))<>4
    OR (SELECT count(*) FROM openerp.periods p WHERE p.book_id=p_scope->>'bookId'
      AND p.id IN(p_input->>'accountingPeriodId',(SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(p_input->'installments') x)))
      <> (SELECT count(DISTINCT requested.id) FROM (VALUES (p_input->>'accountingPeriodId'),
        ((SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(p_input->'installments') x))) AS requested(id)) THEN
    PERFORM openerp.fail('InvalidJournal','Impairment posting and future periods must use four distinct active accounts and retained periods from this book.'); END IF;
  i_index:=i_first-1;
  FOR i_period IN SELECT value FROM jsonb_array_elements(p_input->'installments') LOOP
    i_index:=i_index+1;
    IF i_index>120 THEN PERFORM openerp.fail('InvalidJournal','The revised suffix exceeds120 current occurrences.'); END IF;
    i_date:=openerp.bank_date(i_period->>'postingDate');
    IF i_date<=greatest(i_today,openerp.bank_date(p_input->>'postingDate'),
        (i_basis->'carryingBasis'->'input'->>'effectiveOn')::date,i_last)
      OR NOT EXISTS(SELECT FROM openerp.periods p JOIN openerp.fiscal_years y ON y.book_id=p.book_id AND y.id=p.fiscal_year_id
        WHERE p.book_id=p_scope->>'bookId' AND p.id=i_period->>'accountingPeriodId'
          AND i_date BETWEEN p.starts_on AND p.ends_on AND p.starts_on>=y.starts_on AND p.ends_on<=y.ends_on)
      OR EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=p_scope->>'bookId'
        AND p.id=i_period->>'accountingPeriodId' AND p.locked) THEN
      PERFORM openerp.fail('InvalidJournal','Every revised future installment must use an open matching period after impairment and consumed history.'); END IF;
    i_event_key:=openerp.new_id('impairment_occurrence');
    IF i_event_key !~ '^[a-zA-Z0-9_-]{1,128}$'
      OR EXISTS(SELECT FROM jsonb_array_elements(i_occurrences) o WHERE o->>'eventKey'=i_event_key)
      OR EXISTS(SELECT FROM openerp.subledger_schedule_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
        WHERE r.book_id=p_scope->>'bookId' AND o->>'eventKey'=i_event_key)
      OR EXISTS(SELECT FROM openerp.events e WHERE e.book_id=p_scope->>'bookId'
        AND e.evidence_id=i_schedule->'terms'->>'evidenceId' AND e.event_key=i_event_key) THEN
      PERFORM openerp.fail('InvalidJournal','Every revised impairment occurrence needs a fresh retained event identity.'); END IF;
    i_occurrences:=i_occurrences||jsonb_build_array(i_period||jsonb_build_object('ordinal',i_index,'eventKey',i_event_key));
    i_periods:=i_periods||jsonb_build_array(i_period-'amountMinor');
    i_last:=i_date;
  END LOOP;
  IF jsonb_array_length(i_occurrences)<>i_first-1+jsonb_array_length(p_input->'installments') THEN
    PERFORM openerp.fail('InvalidJournal','The revised suffix must preserve the consumed prefix and replace every future occurrence.'); END IF;
  i_revision:=(i_schedule-ARRAY['digest','amendment'])||jsonb_build_object('revision',i_revision_number,
    'previousDigest',i_schedule->>'digest','allocatedMinor',(i_recognized+i_future)::text,
    'terms',(i_schedule->'terms')||jsonb_build_object('periods',i_periods,'residualMinor',p_input->>'residualMinor',
      'allocationPolicy','explicit_remaining_minor_v1','usefulPeriods',jsonb_array_length(i_occurrences)),
    'occurrences',i_occurrences,'amendment',jsonb_build_object('kind','impairment_v1','reviewId',i_id,'input',p_input,
      'recognizedMinor',i_recognized::text,'reversedMinor',i_reversed::text,'priorImpairmentMinor',i_prior::text,
      'impairmentMinor',i_impairment::text,'netImpairmentMinor',i_net::text,'basisDigest',i_basis->'carryingBasis'->>'digest',
      'basisScheduleDigest',i_basis->'carryingBasis'->>'scheduleDigest','sourceSha256',i_basis->>'sourceSha256',
      'reviewSha256',i_basis->>'reviewSha256','reviewedOn',i_today::text))
    ||openerp.commerce_record_metadata(p_key,'prepare_subledger_impairment',i_actor);
  i_revision:=i_revision||jsonb_build_object('digest',openerp.digest(i_revision));
  i_evidence:=openerp.create_evidence(p_token,p_scope,'si_'||i_id||'_evidence',jsonb_build_object(
    'title','Synthetic asset impairment review','mediaType','application/json',
    'content',openerp.canonical(jsonb_build_object('reviewId',i_id,'input',p_input,'basisDigest',openerp.digest(i_basis),
      'proposedRevisionDigest',i_revision->>'digest')),
    'origin','Immutable synthetic asset impairment review; not legal or tax authorization'));
  i_plan:=openerp.prepare_journal(p_token,p_scope,'si_'||i_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',i_evidence->>'id','eventKey','asset_impairment_'||substr(openerp.digest(i_id),8),
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',p_input->>'postingDate','series',p_input->>'series',
    'description','Synthetic asset impairment','rationale',p_input->>'rationale','taxAssessment','not_applicable',
    'lines',jsonb_build_array(
      jsonb_build_object('accountId',p_input->>'lossAccountId','debitMinor',p_input->>'impairmentMinor','creditMinor','0',
        'description','Synthetic asset impairment loss'),
      jsonb_build_object('accountId',p_input->>'accumulatedImpairmentAccountId','debitMinor','0',
        'creditMinor',p_input->>'impairmentMinor','description','Synthetic accumulated impairment'))));
  SELECT count(*)+1 INTO i_ordinal FROM openerp.subledger_impairment_reviews r
    WHERE r.book_id=p_scope->>'bookId' AND r.schedule_id=p_input->>'scheduleId';
  IF i_ordinal>20 THEN PERFORM openerp.fail('UnsupportedProfile','This schedule reached its20 retained impairment-review bound.'); END IF;
  i_body:=jsonb_build_object('id',i_id,'scope',p_scope,'ordinal',i_ordinal,'version',1,'input',p_input,'basis',i_basis,
    'proposedRevision',i_revision,'evidence',i_evidence,'postingPlan',i_plan,'coverage','not_established',
    'legalPolicyApproved',false,'requiresPostingApproval',true)
    ||openerp.commerce_record_metadata(p_key,'prepare_subledger_impairment',i_actor);
  i_body:=i_body||jsonb_build_object('digest',openerp.digest(i_body));
  IF octet_length(i_body::text)>1048576 THEN
    PERFORM openerp.fail('UnsupportedProfile','The complete impairment review exceeds1MiB. No partial review or proposal is retained.'); END IF;
  INSERT INTO openerp.subledger_impairment_reviews
    VALUES(p_scope->>'bookId',i_id,p_input->>'scheduleId',i_ordinal,p_input->>'decisionKey',i_plan->>'id',i_evidence->>'id',i_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,i_actor,'prepare_subledger_impairment',p_input,i_body);
END $$;

CREATE FUNCTION openerp.subledger_impairment_checked(p_book text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE i_review jsonb;
BEGIN
  SELECT r.body INTO i_review FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_book AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','No impairment review exists in this book.'); END IF;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb
    OR p_input->>'digest' IS DISTINCT FROM i_review->>'digest'
    OR i_review->>'digest' IS DISTINCT FROM openerp.digest(i_review-'digest')
    OR openerp.subledger_impairment_basis(p_book,i_review->'input') IS DISTINCT FROM i_review->'basis'
    OR i_review->'proposedRevision'->>'previousDigest' IS DISTINCT FROM openerp.subledger_current(p_book,i_review->'input'->>'scheduleId')->>'digest'
    OR EXISTS(SELECT FROM openerp.subledger_impairments e WHERE e.book_id=p_book AND e.review_id=p_id) THEN
    PERFORM openerp.fail('StaleDependency','Review and approve a new exact impairment after any schedule, basis or impairment-history change.'); END IF;
  PERFORM openerp.check_dependencies(i_review->'scope',i_review->'postingPlan');
  RETURN i_review;
END $$;

CREATE FUNCTION openerp.approve_subledger_impairment(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  i_actor text; i_book openerp.books; i_previous jsonb; i_review jsonb; i_body jsonb; i_ordinal integer;
  i_id text:=openerp.new_id('asset_impairment_approval'); i_expiry timestamptz:=clock_timestamp()+interval '1 hour';
  i_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  i_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT i_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  i_previous:=openerp.replay(i_book.id,p_key,i_actor,'approve_subledger_impairment',i_payload);
  IF i_previous IS NOT NULL THEN RETURN i_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','acknowledgeSyntheticOnly']);
  i_review:=openerp.subledger_impairment_checked(p_scope->>'bookId',p_id,p_input);
  SELECT count(*)+1 INTO i_ordinal FROM openerp.subledger_impairment_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id;
  IF i_ordinal>20 THEN PERFORM openerp.fail('UnsupportedProfile','This impairment review reached its20 retained approval bound.'); END IF;
  i_body:=jsonb_build_object('id',i_id,'scope',p_scope,'reviewId',p_id,'reviewDigest',i_review->>'digest','actorId',i_actor,
    'expiresAt',to_char(i_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'legalPolicyApproved',false)
    ||openerp.commerce_record_metadata(p_key,'approve_subledger_impairment',i_actor);
  i_body:=i_body||jsonb_build_object('digest',openerp.digest(i_body));
  INSERT INTO openerp.subledger_impairment_approvals VALUES(p_scope->>'bookId',i_id,p_id,i_ordinal,i_actor,i_expiry,i_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,i_actor,'approve_subledger_impairment',i_payload,i_body);
END $$;

CREATE FUNCTION openerp.execute_subledger_impairment(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  i_actor text; i_book openerp.books; i_previous jsonb; i_review jsonb; i_approval openerp.subledger_impairment_approvals;
  i_kernel_approval jsonb; i_posting jsonb; i_body jsonb; i_id text:=openerp.new_id('asset_impairment');
  i_loss_line text; i_accumulated_line text; i_event text; i_revision integer; i_ordinal integer;
  i_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  i_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT i_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  i_previous:=openerp.replay(i_book.id,p_key,i_actor,'execute_subledger_impairment',i_payload);
  IF i_previous IS NOT NULL THEN RETURN i_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','approvalId','acknowledgeSyntheticOnly']);
  i_review:=openerp.subledger_impairment_checked(p_scope->>'bookId',p_id,p_input);
  SELECT * INTO i_approval FROM openerp.subledger_impairment_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR i_approval.actor_id IS DISTINCT FROM i_actor OR i_approval.expires_at<=clock_timestamp()
    OR i_approval.body->>'reviewDigest' IS DISTINCT FROM i_review->>'digest'
    OR EXISTS(SELECT FROM openerp.subledger_impairments e WHERE e.book_id=p_scope->>'bookId' AND e.approval_id=i_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','The same current operator must execute their unexpired unused approval of this exact impairment.'); END IF;
  i_kernel_approval:=openerp.approve_change(p_token,p_scope,i_review->'postingPlan'->>'id','si_'||i_approval.id||'_approve',
    jsonb_build_object('version',1,'planDigest',i_review->'postingPlan'->>'planDigest'));
  i_posting:=openerp.execute_change(p_token,p_scope,i_review->'postingPlan'->>'id','si_'||i_approval.id||'_post',
    jsonb_build_object('version',1,'planDigest',i_review->'postingPlan'->>'planDigest','approvalId',i_kernel_approval->>'id'));
  i_revision:=(i_review->'proposedRevision'->>'revision')::integer;
  INSERT INTO openerp.subledger_schedule_revisions(book_id,schedule_id,revision,evidence_id,body)
    VALUES(p_scope->>'bookId',i_review->'input'->>'scheduleId',i_revision,
      i_review->'proposedRevision'->'terms'->>'evidenceId',i_review->'proposedRevision');
  i_event:=i_review->'postingPlan'->'groups'->0->'actions'->0->>'eventId';
  i_loss_line:=i_review->'postingPlan'->'groups'->0->'actions'->0->'lines'->0->>'lineId';
  i_accumulated_line:=i_review->'postingPlan'->'groups'->0->'actions'->0->'lines'->1->>'lineId';
  SELECT count(*)+1 INTO i_ordinal FROM openerp.subledger_impairments e
    WHERE e.book_id=p_scope->>'bookId' AND e.schedule_id=i_review->'input'->>'scheduleId';
  i_body:=jsonb_build_object('id',i_id,'scope',p_scope,'scheduleId',i_review->'input'->>'scheduleId','reviewId',p_id,
    'reviewDigest',i_review->>'digest','approvalId',i_approval.id,'ordinal',i_ordinal,'decisionKey',i_review->'input'->>'decisionKey',
    'postingDate',i_review->'input'->>'postingDate','scheduleRevision',i_revision,
    'scheduleDigest',i_review->'proposedRevision'->>'digest','basisDigest',i_review->'input'->>'expectedBasisDigest',
    'originalCostMinor',i_review->'basis'->>'originalCostMinor','openingAccumulatedMinor',i_review->'basis'->>'openingAccumulatedMinor',
    'recognizedMinor',i_review->'basis'->>'recognizedMinor','reversedMinor',i_review->'basis'->>'reversedMinor',
    'priorImpairmentMinor',i_review->'basis'->>'priorImpairmentMinor','impairmentMinor',i_review->'input'->>'impairmentMinor',
    'netImpairmentMinor',((i_review->'basis'->>'priorImpairmentMinor')::numeric+(i_review->'input'->>'impairmentMinor')::numeric)::text,
    'postImpairmentCarryingMinor',i_review->'basis'->>'postImpairmentCarryingMinor','futureMinor',i_review->'basis'->>'futureMinor',
    'residualMinor',i_review->'input'->>'residualMinor','lossAccountId',i_review->'input'->>'lossAccountId',
    'accumulatedImpairmentAccountId',i_review->'input'->>'accumulatedImpairmentAccountId','postingReceipt',i_posting,
    'status','synthetic_impairment','futureRecognitionBlocked',false,'coverage','not_established','legalPolicyApproved',false)
    ||openerp.commerce_record_metadata(p_key,'execute_subledger_impairment',i_actor);
  i_body:=i_body||jsonb_build_object('digest',openerp.digest(i_body));
  INSERT INTO openerp.subledger_impairments VALUES(p_scope->>'bookId',i_id,i_review->'input'->>'scheduleId',p_id,i_approval.id,
    i_posting->>'id',i_event,i_posting->>'voucherId',i_loss_line,i_accumulated_line,i_ordinal,i_review->'input'->>'decisionKey',
    i_revision,(i_review->'input'->>'postingDate')::date,(i_review->'input'->>'impairmentMinor')::numeric,
    i_review->'input'->>'lossAccountId',i_review->'input'->>'accumulatedImpairmentAccountId',i_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,i_actor,'execute_subledger_impairment',i_payload,i_body);
END $$;

CREATE FUNCTION openerp.get_subledger_impairment_review(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE i_review jsonb; i_approvals jsonb; i_impairment jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT r.body INTO i_review FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','No impairment review exists in this book.'); END IF;
  SELECT coalesce(jsonb_agg(a.body ORDER BY a.ordinal),'[]') INTO i_approvals FROM openerp.subledger_impairment_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id;
  SELECT i.body INTO i_impairment FROM openerp.subledger_impairments i WHERE i.book_id=p_scope->>'bookId' AND i.review_id=p_id;
  RETURN jsonb_build_object('review',i_review,'approvals',i_approvals,'impairment',i_impairment,'liveAuthorizationChecked',false);
END $$;

CREATE FUNCTION openerp.list_subledger_impairment_reviews(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE i_items jsonb; i_impairments jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  PERFORM openerp.subledger_current(p_scope->>'bookId',p_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'ordinal',r.ordinal,'decisionKey',r.decision_key,'digest',r.body->>'digest',
    'createdAt',r.body->>'createdAt','postingDate',r.body->'input'->>'postingDate') ORDER BY r.ordinal),'[]') INTO i_items
    FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.schedule_id=p_id;
  SELECT coalesce(jsonb_agg(i.body ORDER BY i.ordinal),'[]') INTO i_impairments FROM openerp.subledger_impairments i
    WHERE i.book_id=p_scope->>'bookId' AND i.schedule_id=p_id;
  RETURN jsonb_build_object('scope',p_scope,'scheduleId',p_id,'items',i_items,'impairments',i_impairments,'coverage','not_established');
END $$;

CREATE FUNCTION openerp.subledger_impairment_schedule_for_voucher(p_book text,p_voucher text)
RETURNS TABLE(schedule_id text) LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT DISTINCT x.schedule_id COLLATE "C" FROM (
    SELECT e.schedule_id FROM openerp.subledger_impairments e WHERE e.book_id=p_book AND e.voucher_id=p_voucher
    UNION ALL
    SELECT b.schedule_id FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.voucher_id=p_voucher
      AND EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=b.book_id AND i.schedule_id=b.schedule_id)
    UNION ALL
    SELECT r.schedule_id FROM openerp.subledger_schedule_revisions r
      JOIN openerp.events e ON e.book_id=r.book_id AND e.evidence_id=r.evidence_id
      JOIN openerp.vouchers v ON v.book_id=e.book_id AND v.event_id=e.id AND v.id=p_voucher
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
      WHERE r.book_id=p_book AND e.event_key=o->>'eventKey'
        AND EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=r.book_id AND i.schedule_id=r.schedule_id)
    UNION ALL
    SELECT r.schedule_id FROM openerp.vouchers original
      JOIN openerp.events e ON e.book_id=original.book_id AND e.id=original.event_id
      JOIN openerp.vouchers reversal ON reversal.book_id=original.book_id
        AND reversal.corrects_voucher_id=original.id AND reversal.id=p_voucher
      JOIN openerp.subledger_schedule_revisions r ON r.book_id=e.book_id AND r.evidence_id=e.evidence_id
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
      WHERE original.book_id=p_book AND e.event_key=o->>'eventKey'
        AND EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=r.book_id AND i.schedule_id=r.schedule_id)
  ) x ORDER BY x.schedule_id COLLATE "C"
$$;

CREATE FUNCTION openerp.subledger_check_impairment(p_book text,p_change text,p_action jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE i_review jsonb;
BEGIN
  SELECT r.body INTO i_review FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_book
    AND (r.change_set_id=p_change OR r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e
      WHERE e.book_id=p_book AND e.id=p_action->>'eventId')
      OR EXISTS(SELECT FROM jsonb_array_elements(p_action->'evidenceRefs') x WHERE x->>'evidenceId'=r.evidence_id));
  IF FOUND THEN
    IF p_action IS DISTINCT FROM i_review->'postingPlan'->'groups'->0->'actions'->0
      OR openerp.subledger_impairment_basis(p_book,i_review->'input') IS DISTINCT FROM i_review->'basis' THEN
      PERFORM openerp.fail('StaleDependency','The impairment action and complete reviewed aggregate must remain current.'); END IF;
    RETURN;
  END IF;
  IF p_action->>'correctsVoucherId' IS NOT NULL AND EXISTS(
    SELECT FROM openerp.subledger_impairment_schedule_for_voucher(p_book,p_action->>'correctsVoucherId')) THEN
    PERFORM openerp.fail('UnsupportedProfile','This voucher is consumed by an asset impairment. Generic reversal or replacement is blocked; a complete owned correction is required.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_book AND
      (r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=p_book AND e.id=p_action->>'eventId')
        OR EXISTS(SELECT FROM jsonb_array_elements(p_action->'evidenceRefs') x WHERE x->>'evidenceId'=r.evidence_id))) THEN
    PERFORM openerp.fail('UnsupportedProfile','Impairment review evidence cannot be reused by a generic proposal or correction.'); END IF;
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_check_posting_basis(p_book text,p_change text,p_action jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_preparation openerp.subledger_preparations; s_basis jsonb;
BEGIN
  PERFORM openerp.subledger_check_impairment(p_book,p_change,p_action);
  PERFORM openerp.subledger_check_disposal(p_book,p_change,p_action);
  IF p_action->>'postingPurpose'='reversal' AND p_action->>'correctsVoucherId' IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO s_preparation FROM openerp.subledger_preparations p WHERE p.book_id=p_book AND p.change_set_id=p_change;
  IF FOUND THEN
    s_basis:=openerp.subledger_posting_basis(p_book,s_preparation.schedule_id);
    IF s_basis->>'supported' IS DISTINCT FROM 'true' THEN
      PERFORM openerp.fail('StaleDependency','The linked carrying basis is reversed, corrected, disposed or mismatched. Further recognition is blocked; inspect the retained basis and controls.'); END IF;
    IF s_preparation.basis_dependency IS DISTINCT FROM s_basis
      AND NOT(s_preparation.basis_dependency IS NULL AND s_basis->>'mode'='standalone_synthetic') THEN
      PERFORM openerp.fail('StaleDependency','This proposal did not capture the current carrying basis. Prepare the occurrence again and obtain a new human approval.'); END IF;
    RETURN;
  END IF;
  IF EXISTS(
    WITH RECURSIVE origin_changes(change_set_id) AS (
      SELECT p_change
      UNION
      SELECT v.change_set_id FROM origin_changes o JOIN openerp.correction_bundles c ON c.book_id=p_book AND c.replacement_change_set_id=o.change_set_id
        JOIN openerp.vouchers v ON v.book_id=c.book_id AND v.id=c.original_voucher_id
    ), origin_events(event_id) AS (
      SELECT p_action->>'eventId'
      UNION
      SELECT v.event_id FROM origin_changes o JOIN openerp.vouchers v ON v.book_id=p_book AND v.change_set_id=o.change_set_id
    )
    SELECT FROM openerp.subledger_bases b JOIN openerp.subledger_schedule_revisions r ON r.book_id=b.book_id AND r.schedule_id=b.schedule_id
      JOIN openerp.events e ON e.book_id=r.book_id AND e.evidence_id=r.evidence_id JOIN origin_events source ON source.event_id=e.id
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
    WHERE b.book_id=p_book AND e.event_key=o->>'eventKey') THEN
    PERFORM openerp.fail('StaleDependency','This event belongs to a basis-linked schedule. Use native occurrence preparation; generic replacement recognition is unsupported.');
  END IF;
END $$;

CREATE FUNCTION openerp.subledger_impairment_aggregate_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE i_review jsonb;
BEGIN
  SELECT r.body INTO i_review FROM openerp.subledger_impairment_reviews r WHERE r.book_id=NEW.book_id
    AND (r.change_set_id=NEW.change_set_id
      OR r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
      OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') x WHERE x->>'evidenceId'=r.evidence_id));
  IF FOUND AND (NEW.action IS DISTINCT FROM i_review->'postingPlan'->'groups'->0->'actions'->0
    OR NOT EXISTS(SELECT FROM openerp.subledger_impairments i JOIN openerp.execution_receipts e
      ON e.book_id=i.book_id AND e.id=i.posting_receipt_id
      WHERE i.book_id=NEW.book_id AND i.review_id=i_review->>'id' AND e.voucher_id=NEW.id
        AND e.change_set_id=NEW.change_set_id AND i.schedule_id=i_review->'input'->>'scheduleId'
        AND EXISTS(SELECT FROM openerp.subledger_schedule_revisions r WHERE r.book_id=i.book_id
          AND r.schedule_id=i.schedule_id AND r.body=i_review->'proposedRevision'))) THEN
    PERFORM openerp.fail('ApprovalRequired','The impairment journal, immutable effect and complete revised schedule must commit through operator-only execution.'); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER subledger_impairment_complete_aggregate AFTER INSERT ON openerp.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.subledger_impairment_aggregate_guard();

CREATE OR REPLACE FUNCTION openerp.subledger_basis_matches_revision(p_basis jsonb,p_revision jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
  SELECT coalesce(p_basis->>'digest'=openerp.digest(p_basis-'digest')
    AND p_revision->>'digest'=openerp.digest(p_revision-'digest')
    AND (p_basis->>'scheduleDigest'=p_revision->>'digest'
      OR (p_revision->'amendment'->>'kind' IN('future_dates_v1','remaining_estimate_v1','remaining_lifetime_v1','impairment_v1')
        AND p_revision->'amendment'->>'basisDigest'=p_basis->>'digest'
        AND p_revision->'amendment'->>'basisScheduleDigest'=p_basis->>'scheduleDigest')),false)
$$;

CREATE OR REPLACE FUNCTION openerp.subledger_estimate_current(p_book text,p_schedule jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_states jsonb; s_effective numeric; s_impairment numeric;
BEGIN
  IF p_schedule->'terms'->>'allocationPolicy' IS DISTINCT FROM 'explicit_remaining_minor_v1' THEN RETURN true; END IF;
  s_states:=openerp.subledger_occurrence_states(p_book,p_schedule,'9999-12-31'::date);
  IF jsonb_array_length(s_states)<>jsonb_array_length(p_schedule->'occurrences')
    OR EXISTS(SELECT FROM jsonb_array_elements(s_states) o WHERE o->>'state' NOT IN('unprepared','prepared','posted','reversed')
      OR (o->>'state'='reversed' AND NOT EXISTS(SELECT FROM openerp.vouchers v
        WHERE v.book_id=p_book AND v.id=o->>'reversalVoucherId' AND v.posting_purpose='reversal'))
      OR EXISTS(SELECT FROM openerp.correction_bundles c JOIN openerp.vouchers v
        ON v.book_id=c.book_id AND v.change_set_id=c.replacement_change_set_id
        WHERE c.book_id=p_book AND c.original_voucher_id=o->>'voucherId')) THEN RETURN false; END IF;
  SELECT coalesce(sum((o->>'amountMinor')::numeric),0) INTO s_effective
    FROM jsonb_array_elements(s_states) o WHERE o->>'state'<>'reversed';
  SELECT coalesce(sum(e.impairment_minor),0) INTO s_impairment
    FROM openerp.subledger_impairments e WHERE e.book_id=p_book AND e.schedule_id=p_schedule->>'scheduleId';
  IF p_schedule->'amendment'->>'kind'='impairment_v1' THEN
    s_impairment:=(p_schedule->'amendment'->>'netImpairmentMinor')::numeric;
  END IF;
  RETURN s_effective+s_impairment+(p_schedule->'terms'->>'residualMinor')::numeric=(p_schedule->'terms'->>'costMinor')::numeric
    AND s_effective=(p_schedule->>'allocatedMinor')::numeric;
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_basis_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE
  s_basis jsonb; s_current jsonb; s_kind text; s_estimate boolean; s_first integer;
  s_lifetime boolean; s_book openerp.books; s_input jsonb; s_review openerp.evidence; s_actor text; s_key text;
  s_states jsonb; s_state jsonb; s_occurrence jsonb; s_period jsonb; s_impairment_review jsonb;
  s_occurrences jsonb:='[]'; s_periods jsonb:='[]'; s_remaining numeric:=0; s_recognized numeric:=0;
  s_reversed numeric:=0; s_count integer; s_new_count integer; s_index integer:=0; s_event_key text;
  s_today date; s_date date; s_last date; s_reversal_date date;
BEGIN
  s_kind:=NEW.body->'amendment'->>'kind';
  IF s_kind='impairment_v1' THEN
    SELECT r.body INTO s_impairment_review FROM openerp.subledger_impairment_reviews r
      WHERE r.book_id=NEW.book_id AND r.id=NEW.body->'amendment'->>'reviewId';
    s_current:=openerp.subledger_current(NEW.book_id,NEW.schedule_id);
    SELECT b.body INTO s_basis FROM openerp.subledger_bases b WHERE b.book_id=NEW.book_id AND b.schedule_id=NEW.schedule_id;
    IF s_impairment_review IS NULL OR s_basis IS NULL OR s_impairment_review->'proposedRevision' IS DISTINCT FROM NEW.body
      OR NEW.revision<>(s_current->>'revision')::integer+1 OR NEW.body->>'revision' IS DISTINCT FROM NEW.revision::text
      OR NEW.evidence_id IS DISTINCT FROM s_current->'terms'->>'evidenceId'
      OR s_impairment_review->'basis'->'schedule'->>'digest' IS DISTINCT FROM s_current->>'digest'
      OR NOT openerp.subledger_basis_matches_revision(s_basis,NEW.body)
      OR EXISTS(SELECT FROM openerp.subledger_impairments e WHERE e.book_id=NEW.book_id
        AND e.review_id=s_impairment_review->>'id')
      OR NOT openerp.subledger_estimate_current(NEW.book_id,NEW.body) THEN
      PERFORM openerp.fail('UnsupportedProfile','An impairment revision must be the exact reviewed aggregate over the intact current basis and complete future suffix.'); END IF;
    RETURN NEW;
  END IF;
  s_lifetime:=s_kind='remaining_lifetime_v1';
  IF s_lifetime THEN SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE; END IF;
  SELECT b.body INTO s_basis FROM openerp.subledger_bases b WHERE b.book_id=NEW.book_id AND b.schedule_id=NEW.schedule_id;
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
      OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=s_book.id
        AND v.corrects_voucher_id=s_basis->'input'->>'voucherId') THEN
      PERFORM openerp.fail('StaleDependency','Lifetime amendments require the exact current schedule and intact linked carrying basis.'); END IF;
    s_actor:=NEW.body->'receipt'->>'actorId'; s_key:=NEW.body->'receipt'->>'key';
    IF jsonb_typeof(NEW.body->'receipt'->'key') IS DISTINCT FROM 'string'
      OR coalesce(s_key,'') !~ '^[a-zA-Z0-9_-]{8,128}$'
      OR jsonb_typeof(NEW.body->'receipt'->'actorId') IS DISTINCT FROM 'string'
      OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=s_book.id AND m.actor_id=s_actor AND m.role='operator')
      OR NEW.body->'receipt' IS DISTINCT FROM jsonb_build_object('key',s_key,'operation','amend_schedule_estimate','actorId',s_actor) THEN
      PERFORM openerp.fail('InvalidJournal','A lifetime revision requires the exact operator amendment receipt identity.'); END IF;
    SELECT * INTO s_review FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=s_input->>'reviewEvidenceId';
    IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the lifetime-review evidence in this book first.'); END IF;
    s_first:=(s_input->>'firstOrdinal')::integer; s_count:=jsonb_array_length(s_current->'occurrences');
    s_new_count:=s_first-1+jsonb_array_length(s_input->'installments');
    IF s_first NOT BETWEEN 1 AND s_count OR jsonb_array_length(s_input->'installments') NOT BETWEEN 1 AND 120
      OR s_new_count NOT BETWEEN 1 AND 120 OR s_new_count=s_count OR NEW.revision>20
      OR jsonb_typeof(NEW.body->'occurrences') IS DISTINCT FROM 'array'
      OR jsonb_typeof(NEW.body->'terms'->'periods') IS DISTINCT FROM 'array' THEN
      PERFORM openerp.fail('InvalidJournal','A lifetime amendment must change a nonempty remaining count within120 current occurrences and20 revisions.'); END IF;
    IF jsonb_array_length(NEW.body->'occurrences')<>s_new_count
      OR NEW.body->>'revision' IS DISTINCT FROM to_jsonb(NEW.revision)
      OR NEW.body->'terms'->>'usefulPeriods' IS DISTINCT FROM to_jsonb(s_new_count)
      OR jsonb_array_length(NEW.body->'terms'->'periods')<>s_new_count
      OR NEW.body->'terms'->>'residualMinor' IS DISTINCT FROM s_input->'residualMinor'
      OR NEW.body->'terms'->>'allocationPolicy' IS DISTINCT FROM 'explicit_remaining_minor_v1'
      OR (NEW.body->'terms'-ARRAY['periods','residualMinor','allocationPolicy','usefulPeriods'])
        IS DISTINCT FROM (s_current->'terms'-ARRAY['periods','residualMinor','allocationPolicy','usefulPeriods']) THEN
      PERFORM openerp.fail('UnsupportedProfile','Lifetime amendments may change only explicit future dates, amounts, count and residual, not source or accounts.'); END IF;
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
      s_index:=s_index+1; s_state:=s_states->(s_index-1);
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
        ELSE s_recognized:=s_recognized+(s_occurrence->>'amountMinor')::numeric; END IF;
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
        IF (s_occurrence->>'postingDate')::date<=s_today
          OR EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=s_book.id
            AND p.id=s_occurrence->>'accountingPeriodId' AND p.locked) THEN
          PERFORM openerp.fail('UnsupportedProfile','Only a wholly future unposted suffix can be rescheduled. Due occurrences cannot be deferred by this command.'); END IF;
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
        OR s_date<=(s_basis->'input'->>'effectiveOn')::date
        OR NOT EXISTS(SELECT FROM openerp.periods p JOIN openerp.fiscal_years y
          ON y.book_id=p.book_id AND y.id=p.fiscal_year_id
          WHERE p.book_id=s_book.id AND p.id=s_period->>'accountingPeriodId'
            AND s_date BETWEEN p.starts_on AND p.ends_on AND p.starts_on>=y.starts_on AND p.ends_on<=y.ends_on)
        OR EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=s_book.id
          AND p.id=s_period->>'accountingPeriodId' AND p.locked) THEN
        PERFORM openerp.fail('InvalidJournal','New dates must be future, strictly increasing and after all prefix postings/reversals and the carrying basis.'); END IF;
      s_last:=s_date; s_remaining:=s_remaining+(s_period->>'amountMinor')::numeric;
      s_occurrence:=NEW.body->'occurrences'->(s_index-1); s_event_key:=s_occurrence->>'eventKey';
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
        'recognizedMinor',s_recognized::text,'reversedMinor',s_reversed::text,'basisDigest',s_basis->>'digest',
        'basisScheduleDigest',s_basis->>'scheduleDigest','reviewSha256',s_review.sha256,'reviewedOn',s_today::text)
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
          ((s_current->'occurrences'->(o.n::integer-1))-CASE WHEN s_estimate
            THEN ARRAY['postingDate','accountingPeriodId','amountMinor'] ELSE ARRAY['postingDate','accountingPeriodId'] END))
    OR NOT openerp.subledger_estimate_current(NEW.book_id,NEW.body) THEN
    PERFORM openerp.fail('StaleDependency','Posted history must remain unchanged and the live recognized, future, impairment and residual amounts must conserve the retained cost.'); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_posting_basis(p_book text,p_schedule text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_basis openerp.subledger_bases; s_current jsonb; s_blocker text; s_result jsonb;
BEGIN
  s_current:=openerp.subledger_current(p_book,p_schedule);
  SELECT * INTO s_basis FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.schedule_id=p_schedule;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('mode','standalone_synthetic','supported',true,'basisDigest',NULL,'basisVoucherId',NULL,
      'blocker',NULL,'legalPolicyApproved',false);
  END IF;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book AND d.schedule_id=p_schedule) THEN s_blocker:='disposed';
  ELSIF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.corrects_voucher_id=s_basis.voucher_id) THEN s_blocker:='basis_reversed_or_corrected';
  ELSIF NOT openerp.subledger_basis_matches_revision(s_basis.body,s_current) THEN s_blocker:='basis_mismatch';
  ELSIF NOT openerp.subledger_estimate_current(p_book,s_current) THEN s_blocker:='estimate_history_changed'; END IF;
  s_result:=jsonb_build_object('mode','linked_basis','supported',s_blocker IS NULL,'basisDigest',s_basis.body->>'digest',
    'basisVoucherId',s_basis.voucher_id,'blocker',s_blocker,'legalPolicyApproved',false);
  IF s_current ? 'amendment' THEN s_result:=s_result||jsonb_build_object('scheduleDigest',s_current->>'digest'); END IF;
  RETURN s_result;
END $$;

CREATE OR REPLACE FUNCTION openerp.get_schedule(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  sl_current jsonb; sl_revisions jsonb; sl_states jsonb; sl_recognized numeric; sl_disposal jsonb; sl_tax_matches jsonb;
  sl_impairments jsonb; sl_impairment numeric; sl_basis jsonb; sl_basis_reversed boolean; sl_carrying numeric;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  sl_current:=openerp.subledger_current(scope->>'bookId',id);
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO sl_revisions FROM openerp.subledger_schedule_revisions r
    WHERE r.book_id=scope->>'bookId' AND r.schedule_id=id;
  sl_states:=openerp.subledger_occurrence_states(scope->>'bookId',sl_current,'9999-12-31'::date);
  SELECT coalesce(sum((value->>'amountMinor')::numeric),0) INTO sl_recognized
    FROM jsonb_array_elements(sl_states) WHERE value->>'state'='posted';
  SELECT d.body INTO sl_disposal FROM openerp.subledger_disposals d WHERE d.book_id=scope->>'bookId' AND d.schedule_id=get_schedule.id;
  SELECT b.body INTO sl_basis FROM openerp.subledger_bases b WHERE b.book_id=scope->>'bookId' AND b.schedule_id=get_schedule.id;
  sl_basis_reversed:=sl_basis IS NOT NULL AND EXISTS(SELECT FROM openerp.vouchers v
    WHERE v.book_id=scope->>'bookId' AND v.corrects_voucher_id=sl_basis->'input'->>'voucherId');
  SELECT coalesce(jsonb_agg(i.body ORDER BY i.ordinal),'[]'),coalesce(sum(i.impairment_minor),0)
    INTO sl_impairments,sl_impairment FROM openerp.subledger_impairments i
    WHERE i.book_id=scope->>'bookId' AND i.schedule_id=get_schedule.id;
  IF sl_basis IS NULL OR sl_basis_reversed THEN sl_carrying:=NULL;
  ELSE sl_carrying:=(sl_basis->'input'->>'carryingMinor')::numeric-sl_recognized-sl_impairment; END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_basis_lines l
    WHERE l.book_id=scope->>'bookId' AND l.schedule_id=get_schedule.id LIMIT 21) bounded)>20 THEN
    PERFORM openerp.fail('UnsupportedProfile','This schedule exceeds20 retained basis lines. No partial references are returned.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId',l.voucher_id,'lineId',l.line_id,'matchId',m.id,
    'eventId',m.event_id,'matchDigest',m.body->>'digest') ORDER BY l.voucher_id COLLATE "C",l.line_id COLLATE "C",m.id COLLATE "C"),'[]')
    INTO sl_tax_matches FROM openerp.subledger_basis_lines l
    JOIN openerp.tax_account_match_capacity c ON c.book_id=l.book_id AND c.voucher_id=l.voucher_id AND c.line_id=l.line_id
    JOIN openerp.tax_account_matches m ON m.book_id=c.book_id AND m.id=c.match_id AND m.event_id=c.event_id
      AND m.voucher_id=c.voucher_id AND m.line_id=c.line_id
    WHERE l.book_id=scope->>'bookId' AND l.schedule_id=get_schedule.id;
  RETURN jsonb_build_object('basisTaxMatches',jsonb_build_object('roleCompatibility','not_assessed','matches',sl_tax_matches),
    'disposal',sl_disposal,'impairments',sl_impairments,'netImpairmentMinor',sl_impairment::text,
    'carryingMinor',CASE WHEN sl_disposal IS NOT NULL THEN '0' WHEN sl_carrying IS NULL THEN NULL ELSE sl_carrying::text END,
    'current',sl_current,'revisions',sl_revisions,'occurrences',sl_states,'recognizedMinor',sl_recognized::text,
    'remainingMinor',((sl_current->'terms'->>'costMinor')::numeric-sl_recognized)::text,
    'revisionAllowed',NOT EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=scope->>'bookId' AND b.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.subledger_preparations p WHERE p.book_id=scope->>'bookId' AND p.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.events e WHERE e.book_id=scope->>'bookId' AND e.evidence_id=sl_current->'terms'->>'evidenceId'
        AND e.event_key IN(SELECT value->>'eventKey' FROM jsonb_array_elements(sl_current->'occurrences')))
      AND (sl_current->>'revision')::integer<20,'controlAccountReconciled',false,'requiresPostingApproval',true,
    'postingBasis',openerp.subledger_posting_basis(scope->>'bookId',id));
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_disposal_basis(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE
  d_schedule jsonb; d_basis jsonb; d_states jsonb; d_source openerp.evidence; d_review openerp.evidence;
  d_impairment_accounts jsonb; d_date date; d_gross numeric; d_opening numeric; d_recognized numeric;
  d_reversed numeric; d_impairment numeric; d_carrying numeric;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  d_schedule:=openerp.subledger_current(p_book,p_input->>'scheduleId');
  SELECT b.body INTO d_basis FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.schedule_id=p_input->>'scheduleId';
  IF d_basis IS NULL OR d_schedule->'terms'->>'kind'<>'asset' THEN
    PERFORM openerp.fail('UnsupportedProfile','Disposal supports only an asset with a retained gross and accumulated carrying basis.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book AND d.schedule_id=p_input->>'scheduleId') THEN
    PERFORM openerp.fail('AlreadyPosted','This schedule already has an immutable disposal. Recover its retained result.'); END IF;
  IF p_input->>'expectedDigest' IS DISTINCT FROM d_schedule->>'digest'
    OR p_input->>'expectedBasisDigest' IS DISTINCT FROM d_basis->>'digest'
    OR NOT openerp.subledger_basis_matches_revision(d_basis,d_schedule)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.corrects_voucher_id=d_basis->'input'->>'voucherId') THEN
    PERFORM openerp.fail('StaleDependency','Review the current post-impairment schedule and intact original carrying basis.'); END IF;
  d_date:=openerp.bank_date(p_input->>'postingDate');
  IF d_date<(d_basis->'input'->>'effectiveOn')::date THEN
    PERFORM openerp.fail('InvalidJournal','Disposal cannot precede its retained acquisition or imported basis.'); END IF;
  d_states:=openerp.subledger_occurrence_states(p_book,d_schedule,'9999-12-31'::date);
  IF jsonb_array_length(d_states)<>jsonb_array_length(d_schedule->'occurrences')
    OR EXISTS(SELECT FROM jsonb_array_elements(d_states) o WHERE o->>'state' NOT IN('unprepared','prepared','posted','reversed')
      OR (o->>'state' IN('unprepared','prepared') AND (o->>'postingDate')::date<d_date)
      OR (o->>'state' IN('posted','reversed') AND (o->>'postingDate')::date>d_date)
      OR (o->>'state'='reversed' AND NOT EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book
        AND v.id=o->>'reversalVoucherId' AND v.posting_purpose='reversal' AND v.posting_date<=d_date))
      OR EXISTS(SELECT FROM openerp.correction_bundles c JOIN openerp.vouchers v
        ON v.book_id=c.book_id AND v.change_set_id=c.replacement_change_set_id
        WHERE c.book_id=p_book AND c.original_voucher_id=o->>'voucherId')) THEN
    PERFORM openerp.fail('UnsupportedProfile','Resolve ambiguous history, later postings, reversals and earlier due occurrences before disposal.'); END IF;
  SELECT coalesce(sum((o->>'amountMinor')::numeric) FILTER(WHERE o->>'state'='posted'),0),
    coalesce(sum((o->>'amountMinor')::numeric) FILTER(WHERE o->>'state'='reversed'),0)
    INTO d_recognized,d_reversed FROM jsonb_array_elements(d_states) o;
  d_gross:=(d_basis->'input'->>'originalCostMinor')::numeric;
  d_opening:=(d_basis->'input'->>'accumulatedMinor')::numeric;
  SELECT coalesce(sum(i.impairment_minor),0),coalesce(jsonb_agg(DISTINCT i.accumulated_impairment_account_id),'[]')
    INTO d_impairment,d_impairment_accounts FROM openerp.subledger_impairments i
    WHERE i.book_id=p_book AND i.schedule_id=p_input->>'scheduleId';
  IF EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=p_book
      AND i.schedule_id=p_input->>'scheduleId' AND i.posting_date>d_date) THEN
    PERFORM openerp.fail('StaleDependency','A later impairment already changes the current carrying value.'); END IF;
  d_carrying:=d_gross-d_opening-d_recognized-d_impairment;
  IF d_carrying<0 OR d_gross<>d_opening+(d_schedule->'terms'->>'costMinor')::numeric
    OR (SELECT coalesce(sum((l->>'debitMinor')::numeric),0) FROM jsonb_array_elements(d_basis->'lines') l)<>d_gross
    OR (SELECT coalesce(sum((l->>'creditMinor')::numeric),0) FROM jsonb_array_elements(d_basis->'lines') l)<>d_opening
    OR EXISTS(SELECT FROM jsonb_array_elements(d_basis->'lines') l WHERE
      ((l->>'debitMinor')::numeric>0 AND l->>'accountId'=d_schedule->'terms'->>'creditAccountId')
      OR ((l->>'creditMinor')::numeric>0 AND l->>'accountId'<>'creditAccountId')
      OR NOT EXISTS(SELECT FROM openerp.journal_lines j WHERE j.book_id=p_book AND j.voucher_id=d_basis->'input'->>'voucherId'
        AND j.id=l->>'lineId' AND j.ordinal=(l->>'ordinal')::integer AND j.account_id=l->>'accountId'
        AND j.debit_minor=(l->>'debitMinor')::numeric AND j.credit_minor=(l->>'creditMinor')::numeric)) THEN
    PERFORM openerp.fail('UnsupportedProfile','Disposal requires intact gross, ordinary accumulated and post-impairment carrying controls.'); END IF;
  IF p_input->>'lossAccountId'=d_schedule->'terms'->>'creditAccountId'
    OR (d_impairment>0 AND p_input->>'lossAccountId'=d_impairment_accounts->>0)
    OR EXISTS(SELECT FROM openerp.subledger_bases b CROSS JOIN LATERAL jsonb_array_elements(b.body->'lines') l
      WHERE b.book_id=p_book AND l->>'accountId'=p_input->>'lossAccountId')
    OR EXISTS(SELECT FROM openerp.subledger_schedules s WHERE s.book_id=p_book
      AND openerp.subledger_current(p_book,s.id)->'terms'->>'creditAccountId'=p_input->>'lossAccountId') THEN
    PERFORM openerp.fail('InvalidJournal','Choose a disposal loss account distinct from every carrying and impairment control.'); END IF;
  IF EXISTS(WITH accounts AS (
      SELECT l->>'accountId' id FROM jsonb_array_elements(d_basis->'lines') l
      UNION SELECT d_schedule->'terms'->>'creditAccountId' UNION SELECT p_input->>'lossAccountId'
      UNION SELECT jsonb_array_elements_text(d_impairment_accounts)) SELECT FROM accounts a WHERE
      EXISTS(SELECT FROM openerp.bank_sources b WHERE b.book_id=p_book AND b.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.owner_control_accounts o WHERE o.book_id=p_book AND o.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.tax_account_sources t WHERE t.book_id=p_book AND t.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.vat_control_account_roles v WHERE v.book_id=p_book AND v.account_id=a.id)
      OR NOT EXISTS(SELECT FROM openerp.accounts x WHERE x.book_id=p_book AND x.id=a.id AND x.active)) THEN
    PERFORM openerp.fail('InvalidJournal','Disposal accounts must be active and cannot be known bank, commerce, owner, VAT or tax controls.'); END IF;
  SELECT * INTO d_source FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'evidenceId';
  SELECT * INTO d_review FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'reviewEvidenceId';
  IF d_source.id IS NULL OR d_review.id IS NULL THEN
    PERFORM openerp.fail('MissingEvidence','Retain disposal source and review evidence in this book.'); END IF;
  RETURN jsonb_build_object('schedule',d_schedule,'carryingBasis',d_basis,'occurrences',d_states,
    'originalCostMinor',d_gross::text,'openingAccumulatedMinor',d_opening::text,'recognizedMinor',d_recognized::text,
    'reversedMinor',d_reversed::text,'impairmentMinor',d_impairment::text,
    'impairmentAccountId',CASE WHEN d_impairment>0 THEN d_impairment_accounts->>0 ELSE NULL END,
    'totalAccumulatedMinor',(d_opening+d_recognized)::text,'carryingMinor',d_carrying::text,
    'sourceSha256',d_source.sha256,'reviewSha256',d_review.sha256);
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_subledger_disposal(p_token text,p_scope jsonb,p_key text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_actor text; d_previous jsonb; d_basis jsonb; d_evidence jsonb; d_plan jsonb; d_lines jsonb; d_body jsonb;
  d_id text:=openerp.new_id('asset_disposal_review'); d_ordinal integer; d_field text;
BEGIN
  d_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  d_previous:=openerp.replay(p_scope->>'bookId',p_key,d_actor,'prepare_subledger_disposal',p_input);
  IF d_previous IS NOT NULL THEN RETURN d_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','scheduleId','expectedDigest','expectedBasisDigest','postingDate',
    'accountingPeriodId','series','lossAccountId','evidenceId','reviewEvidenceId','rationale','proceedsMinor','taxAssessment','acknowledgeSyntheticOnly']);
  IF p_input->>'profile' IS DISTINCT FROM 'synthetic_no_proceeds_asset_disposal_v1'
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb
    OR p_input->'proceedsMinor' IS DISTINCT FROM '"0"'::jsonb
    OR p_input->>'taxAssessment' IS DISTINCT FROM 'not_applicable' THEN
    PERFORM openerp.fail('UnsupportedProfile','Explicitly select synthetic no-proceeds disposal and tax-not-applicable.'); END IF;
  FOREACH d_field IN ARRAY ARRAY['scheduleId','accountingPeriodId','lossAccountId','evidenceId','reviewEvidenceId'] LOOP
    IF openerp.commerce_text(p_input,d_field,128) !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Use retained identifiers from this book.'); END IF;
  END LOOP;
  FOREACH d_field IN ARRAY ARRAY['expectedDigest','expectedBasisDigest'] LOOP
    IF openerp.commerce_text(p_input,d_field,71) !~ '^sha256:[a-f0-9]{64}$' THEN
      PERFORM openerp.fail('InvalidJournal','Supply exact current schedule and carrying-basis digests.'); END IF;
  END LOOP;
  IF openerp.commerce_text(p_input,'series',16) !~ '^[A-Z0-9]{1,16}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use an explicit uppercase voucher series.'); END IF;
  PERFORM openerp.commerce_text(p_input,'rationale',2000);
  PERFORM openerp.commerce_text(p_input,'postingDate',10);
  d_basis:=openerp.subledger_disposal_basis(p_scope->>'bookId',p_input);
  SELECT count(*)+1 INTO d_ordinal FROM openerp.subledger_disposal_reviews r
    WHERE r.book_id=p_scope->>'bookId' AND r.schedule_id=p_input->>'scheduleId';
  IF d_ordinal>20 THEN PERFORM openerp.fail('UnsupportedProfile','This schedule reached its20 retained disposal-review bound.'); END IF;
  SELECT jsonb_agg(jsonb_build_object('accountId',l->>'accountId','debitMinor','0','creditMinor',l->>'debitMinor',
    'description','Release represented synthetic gross control') ORDER BY (l->>'ordinal')::integer) INTO d_lines
    FROM jsonb_array_elements(d_basis->'carryingBasis'->'lines') l WHERE (l->>'debitMinor')::numeric>0;
  IF (d_basis->>'totalAccumulatedMinor')::numeric>0 THEN d_lines:=d_lines||jsonb_build_array(jsonb_build_object(
    'accountId',d_basis->'schedule'->'terms'->>'creditAccountId','debitMinor',d_basis->>'totalAccumulatedMinor',
    'creditMinor','0','description','Release ordinary accumulated recognition')); END IF;
  IF (d_basis->>'impairmentMinor')::numeric>0 THEN d_lines:=d_lines||jsonb_build_array(jsonb_build_object(
    'accountId',d_basis->>'impairmentAccountId','debitMinor',d_basis->>'impairmentMinor','creditMinor','0',
    'description','Release accumulated impairment')); END IF;
  IF (d_basis->>'carryingMinor')::numeric>0 THEN d_lines:=d_lines||jsonb_build_array(jsonb_build_object(
    'accountId',p_input->>'lossAccountId','debitMinor',d_basis->>'carryingMinor','creditMinor','0',
    'description','Explicit post-impairment carrying loss')); END IF;
  d_evidence:=openerp.create_evidence(p_token,p_scope,'sd_'||d_id||'_evidence',jsonb_build_object(
    'title','Synthetic asset disposal review','mediaType','application/json',
    'content',openerp.canonical(jsonb_build_object('reviewId',d_id,'input',p_input,'basisSnapshotDigest',openerp.digest(d_basis))),
    'origin','Immutable synthetic post-impairment no-proceeds disposal review'));
  d_plan:=openerp.prepare_journal(p_token,p_scope,'sd_'||d_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',d_evidence->>'id','eventKey','asset_disposal_'||substr(openerp.digest(p_input->'scheduleId'),8),
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',p_input->>'postingDate','series',p_input->>'series',
    'description','Synthetic no-proceeds asset disposal','rationale',p_input->>'rationale','taxAssessment','not_applicable','lines',d_lines));
  d_body:=jsonb_build_object('id',d_id,'scope',p_scope,'ordinal',d_ordinal,'version',1,'input',p_input,'basis',d_basis,
    'evidence',d_evidence,'postingPlan',d_plan,'coverage','not_established','legalPolicyApproved',false,'requiresPostingApproval',true)
    ||openerp.commerce_record_metadata(p_key,'prepare_subledger_disposal',d_actor);
  d_body:=d_body||jsonb_build_object('digest',openerp.digest(d_body));
  IF octet_length(d_body::text)>1048576 THEN
    PERFORM openerp.fail('UnsupportedProfile','The complete disposal review exceeds1MiB. No partial review is retained.'); END IF;
  INSERT INTO openerp.subledger_disposal_reviews VALUES(p_scope->>'bookId',d_id,p_input->>'scheduleId',d_ordinal,
    d_plan->>'id',d_evidence->>'id',d_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,d_actor,'prepare_subledger_disposal',p_input,d_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.execute_subledger_disposal(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_actor text; d_previous jsonb; d_review jsonb; d_approval openerp.subledger_disposal_approvals;
  d_kernel_approval jsonb; d_posting jsonb; d_body jsonb; d_id text:=openerp.new_id('asset_disposal');
  d_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  d_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  d_previous:=openerp.replay(p_scope->>'bookId',p_key,d_actor,'execute_subledger_disposal',d_payload);
  IF d_previous IS NOT NULL THEN RETURN d_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','approvalId','acknowledgeSyntheticOnly']);
  d_review:=openerp.subledger_disposal_checked(p_scope->>'bookId',p_id,p_input);
  SELECT * INTO d_approval FROM openerp.subledger_disposal_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR d_approval.actor_id IS DISTINCT FROM d_actor OR d_approval.expires_at<=clock_timestamp()
    OR d_approval.body->>'reviewDigest' IS DISTINCT FROM d_review->>'digest'
    OR EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_scope->>'bookId' AND d.approval_id=d_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','The same current operator must execute their unexpired unused approval of this exact disposal.'); END IF;
  d_kernel_approval:=openerp.approve_change(p_token,p_scope,d_review->'postingPlan'->>'id','sd_'||d_approval.id||'_approve',
    jsonb_build_object('version',1,'planDigest',d_review->'postingPlan'->>'planDigest'));
  d_posting:=openerp.execute_change(p_token,p_scope,d_review->'postingPlan'->>'id','sd_'||d_approval.id||'_post',
    jsonb_build_object('version',1,'planDigest',d_review->'postingPlan'->>'planDigest','approvalId',d_kernel_approval->>'id'));
  d_body:=jsonb_build_object('id',d_id,'scope',p_scope,'scheduleId',d_review->'input'->>'scheduleId','reviewId',p_id,
    'reviewDigest',d_review->>'digest','approvalId',d_approval.id,'postingDate',d_review->'input'->>'postingDate',
    'scheduleDigest',d_review->'input'->>'expectedDigest','basisDigest',d_review->'input'->>'expectedBasisDigest',
    'originalCostMinor',d_review->'basis'->>'originalCostMinor','openingAccumulatedMinor',d_review->'basis'->>'openingAccumulatedMinor',
    'recognizedMinor',d_review->'basis'->>'recognizedMinor','impairmentMinorReleased',d_review->'basis'->>'impairmentMinor',
    'totalAccumulatedMinor',d_review->'basis'->>'totalAccumulatedMinor','carryingMinorReleased',d_review->'basis'->>'carryingMinor',
    'carryingMinor','0','status','synthetic_disposed','futureRecognitionBlocked',true,'postingReceipt',d_posting,
    'coverage','not_established','legalPolicyApproved',false)
    ||openerp.commerce_record_metadata(p_key,'execute_subledger_disposal',d_actor);
  d_body:=d_body||jsonb_build_object('digest',openerp.digest(d_body));
  INSERT INTO openerp.subledger_disposals VALUES(p_scope->>'bookId',d_id,d_review->'input'->>'scheduleId',p_id,d_approval.id,
    d_posting->>'id',(d_review->'input'->>'postingDate')::date,d_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,d_actor,'execute_subledger_disposal',d_payload,d_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_control_dependency_digest(p_book text) RETURNS text LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE s_body jsonb;
BEGIN
  IF (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_schedules s WHERE s.book_id=p_book LIMIT 201) x)>200
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.accounts a WHERE a.book_id=p_book LIMIT 1001) x)>1000
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.periods p WHERE p.book_id=p_book LIMIT 1001) x)>1000
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_preparations p WHERE p.book_id=p_book LIMIT 10001) x)>10000
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_book LIMIT 4001) x)>4000
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_impairments i WHERE i.book_id=p_book LIMIT 4001) x)>4000 THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('sequence',b.committed_sequence::text,'profile',b.profile,'profileVersion',b.profile_version::text,
    'authority',b.authority,'writerEpoch',b.writer_epoch::text,'currency',b.currency,'currencyScale',b.currency_scale,
    'periods',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text,'locked',p.locked,
      'startsOn',p.starts_on,'endsOn',p.ends_on,'year',p.fiscal_year_id) ORDER BY p.id COLLATE "C")
      FROM openerp.periods p WHERE p.book_id=p_book),'[]'),
    'accounts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'version',a.version::text,'code',a.code,
      'name',a.name,'active',a.active) ORDER BY a.id COLLATE "C") FROM openerp.accounts a WHERE a.book_id=p_book),'[]'),
    'schedules',coalesce((SELECT jsonb_agg(openerp.subledger_current(p_book,s.id)->>'digest' ORDER BY s.id COLLATE "C")
      FROM openerp.subledger_schedules s WHERE s.book_id=p_book),'[]'),
    'bases',coalesce((SELECT jsonb_agg(x.body->>'digest' ORDER BY x.schedule_id COLLATE "C")
      FROM openerp.subledger_bases x WHERE x.book_id=p_book),'[]'),
    'preparations',coalesce((SELECT jsonb_agg(jsonb_build_array(p.schedule_id,p.ordinal,p.attempt,p.change_set_id)
      ORDER BY p.schedule_id COLLATE "C",p.ordinal,p.attempt) FROM openerp.subledger_preparations p WHERE p.book_id=p_book),'[]'))
    INTO s_body FROM openerp.books b WHERE b.id=p_book;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book) THEN
    s_body:=s_body||jsonb_build_object('disposals',(SELECT jsonb_agg(d.body->>'digest' ORDER BY d.schedule_id COLLATE "C")
      FROM openerp.subledger_disposals d WHERE d.book_id=p_book)); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=p_book) THEN
    s_body:=s_body||jsonb_build_object('impairments',(SELECT jsonb_agg(i.body->>'digest' ORDER BY i.schedule_id COLLATE "C",i.ordinal)
      FROM openerp.subledger_impairments i WHERE i.book_id=p_book)); END IF;
  RETURN openerp.digest(s_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.create_subledger_control(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE
  s_actor text; s_book openerp.books; s_previous jsonb; s_date date; s_digest text; s_evidence openerp.evidence;
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
    OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'rationale')) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(p_input->'inventoryEvidenceId') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the control date and evidence-backed account inventory rationale.'); END IF;
  s_date:=openerp.bank_date(p_input->'asOfDate');
  SELECT * INTO s_evidence FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=p_input->>'inventoryEvidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain evidence for the declared control accounts.'); END IF;
  s_account_count:=jsonb_array_length(p_input->'accountIds');
  IF s_account_count NOT BETWEEN 1 AND 20 OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'accountIds') a
      WHERE jsonb_typeof(a) IS DISTINCT FROM 'string' OR a#>>'{}' !~ '^[a-z][a-z0-9_-]{2,127}$')
    OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements_text(p_input->'accountIds') x)
    OR (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=s_book.id
      AND a.id IN(SELECT jsonb_array_elements_text(p_input->'accountIds')))<>s_account_count THEN
    PERFORM openerp.fail('InvalidJournal','Declare distinct existing control accounts from this book.'); END IF;
  s_digest:=openerp.subledger_control_dependency_digest(s_book.id);
  IF s_digest IS NULL THEN
    PERFORM openerp.fail('UnsupportedProfile','Control capture exceeds its bounded schedule, account, period, preparation or impairment scope.'); END IF;
  IF (SELECT count(*) FROM openerp.subledger_control_snapshots c WHERE c.book_id=s_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book reached its200 retained control-snapshot bound.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('revision',r.body,'basis',b.body,'occurrences',o.states,
    'basisReversed',EXISTS(SELECT FROM openerp.vouchers rv WHERE rv.book_id=s_book.id AND rv.corrects_voucher_id=b.voucher_id
      AND rv.posting_date<=s_date AND rv.sequence<=s_book.committed_sequence),'disposal',disposed.body,
    'recognizedMinor',recognized.amount::text,'impairmentMinor',impairment.amount::text,
    'carryingMinor',CASE WHEN b.body IS NULL OR (b.body->'input'->>'effectiveOn')::date>s_date
      OR EXISTS(SELECT FROM openerp.vouchers rv WHERE rv.book_id=s_book.id AND rv.corrects_voucher_id=b.voucher_id
        AND rv.posting_date<=s_date AND rv.sequence<=s_book.committed_sequence) THEN NULL
      WHEN disposed.body IS NOT NULL THEN '0'
      ELSE ((b.body->'input'->>'carryingMinor')::numeric-recognized.amount-impairment.amount)::text END)
    ORDER BY s.id COLLATE "C"),'[]') INTO s_schedules
  FROM openerp.subledger_schedules s
  CROSS JOIN LATERAL(SELECT openerp.subledger_revision_at(s_book.id,s.id,s_date) body) r
  LEFT JOIN openerp.subledger_bases b ON b.book_id=s.book_id AND b.schedule_id=s.id
  LEFT JOIN openerp.subledger_disposals disposed ON disposed.book_id=s.book_id AND disposed.schedule_id=s.id
    AND disposed.posting_date<=s_date
  CROSS JOIN LATERAL(SELECT openerp.subledger_occurrence_states(s_book.id,r.body,s_date) states) o
  CROSS JOIN LATERAL(SELECT coalesce(sum((x->>'amountMinor')::numeric),0) amount
    FROM jsonb_array_elements(o.states) x WHERE x->>'state'='posted') recognized
  CROSS JOIN LATERAL(SELECT coalesce(sum(i.impairment_minor),0) amount FROM openerp.subledger_impairments i
    WHERE i.book_id=s_book.id AND i.schedule_id=s.id AND i.posting_date<=s_date) impairment
  WHERE s.book_id=s_book.id AND r.body IS NOT NULL;
  IF EXISTS(SELECT FROM jsonb_array_elements(s_schedules) s
      WHERE NOT (p_input->'accountIds' ? (s->'revision'->'terms'->>'creditAccountId'))
        OR p_input->'accountIds' ? (s->'revision'->'terms'->>'debitAccountId'))
    OR EXISTS(SELECT FROM openerp.subledger_bases b CROSS JOIN LATERAL jsonb_array_elements(b.body->'lines') l
      WHERE b.book_id=s_book.id AND NOT (p_input->'accountIds' ? (l->>'accountId')))
    OR EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=s_book.id
      AND NOT (p_input->'accountIds' ? (i.accumulated_impairment_account_id))) THEN
    PERFORM openerp.fail('InvalidJournal','Declare every gross, ordinary accumulated and accumulated-impairment control account, but no schedule expense account.'); END IF;
  WITH effects AS (
    SELECT b.schedule_id,'basis'::text kind,b.voucher_id,(l->>'ordinal')::integer ordinal,l->>'accountId' account_id,
      (l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric amount
      FROM openerp.subledger_bases b CROSS JOIN LATERAL jsonb_array_elements(b.body->'lines') l
      WHERE b.book_id=s_book.id AND (b.body->'input'->>'effectiveOn')::date<=s_date
    UNION ALL SELECT s->'revision'->>'scheduleId','occurrence',o->>'voucherId',2,
      s->'revision'->'terms'->>'creditAccountId',-(o->>'amountMinor')::numeric
      FROM jsonb_array_elements(s_schedules) s CROSS JOIN LATERAL jsonb_array_elements(s->'occurrences') o
      WHERE o->>'state' IN('posted','reversed')
    UNION ALL SELECT s->'revision'->>'scheduleId','occurrence_reversal',o->>'reversalVoucherId',2,
      s->'revision'->'terms'->>'creditAccountId',(o->>'amountMinor')::numeric
      FROM jsonb_array_elements(s_schedules) s CROSS JOIN LATERAL jsonb_array_elements(s->'occurrences') o
      WHERE o->>'state'='reversed'
    UNION ALL SELECT i.schedule_id,'impairment',e.voucher_id,2,i.accumulated_impairment_account_id,-i.impairment_minor::numeric
      FROM openerp.subledger_impairments i JOIN openerp.execution_receipts e ON e.book_id=i.book_id AND e.id=i.posting_receipt_id
      WHERE i.book_id=s_book.id AND i.posting_date<=s_date
    UNION ALL SELECT d.schedule_id,'disposal_release',e.voucher_id,l.ordinal::integer,l.value->>'accountId',
      (l.value->>'debitMinor')::numeric-(l.value->>'creditMinor')::numeric
      FROM openerp.subledger_disposals d JOIN openerp.subledger_disposal_reviews r ON r.book_id=d.book_id AND r.id=d.review_id
      JOIN openerp.execution_receipts e ON e.book_id=d.book_id AND e.id=d.posting_receipt_id
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'postingPlan'->'groups'->0->'actions'->0->'lines')
        WITH ORDINALITY l(value,ordinal)
      WHERE d.book_id=s_book.id AND d.posting_date<=s_date
        AND l.value->>'accountId'<>r.body->'input'->>'lossAccountId'
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('scheduleId',e.schedule_id,'kind',e.kind,'voucherId',e.voucher_id,
      'ordinal',e.ordinal,'accountId',e.account_id,'expectedMinor',e.amount::text)
      ORDER BY e.schedule_id COLLATE "C",e.kind COLLATE "C",e.voucher_id COLLATE "C",e.ordinal),'[]')
    INTO s_effects FROM effects e;
  IF EXISTS(SELECT FROM jsonb_array_elements(s_effects) e GROUP BY e->>'voucherId',e->>'ordinal' HAVING count(*)>1) THEN
    PERFORM openerp.fail('InvalidJournal','Owned subledger effects claim the same posted line.'); END IF;
  SELECT count(*) INTO s_line_count FROM(SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v
    ON v.book_id=l.book_id AND v.id=l.voucher_id WHERE l.book_id=s_book.id
      AND l.account_id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'))
      AND v.posting_date<=s_date AND v.sequence<=s_book.committed_sequence LIMIT 5001) bounded;
  IF s_line_count>5000 THEN PERFORM openerp.fail('UnsupportedProfile','Declared-account controls exceed5000 ledger lines.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId',v.id,'lineId',l.id,'ordinal',l.ordinal,
    'sequence',v.sequence::text,'postingDate',v.posting_date::text,'accountId',l.account_id,
    'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,'description',l.description,
    'correctsVoucherId',v.corrects_voucher_id,'evidenceRefs',v.action->'evidenceRefs','scheduleId',e.body->>'scheduleId',
    'effectKind',e.body->>'kind','expectedMinor',coalesce(e.body->>'expectedMinor','0'),
    'unexplainedMinor',(l.debit_minor-l.credit_minor-coalesce((e.body->>'expectedMinor')::numeric,0))::text)
    ORDER BY v.sequence,l.ordinal),'[]') INTO s_lines
  FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
  LEFT JOIN LATERAL(SELECT x body FROM jsonb_array_elements(s_effects) x WHERE x->>'voucherId'=v.id
    AND (x->>'ordinal')::integer=l.ordinal AND x->>'accountId'=l.account_id) e ON true
  WHERE l.book_id=s_book.id AND l.account_id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'))
    AND v.posting_date<=s_date AND v.sequence<=s_book.committed_sequence;
  IF jsonb_array_length(s_lines)<>s_line_count THEN PERFORM openerp.fail('InvalidJournal','Control contribution count changed.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',a.id,'code',a.code,'name',a.name,'version',a.version::text,
    'active',a.active,'expectedMinor',expected.amount::text,'ledgerMinor',ledger.amount::text,
    'differenceMinor',(ledger.amount-expected.amount)::text,'unexplainedLineCount',ledger.unexplained,
    'missingEffectCount',(SELECT count(*) FROM jsonb_array_elements(s_effects) e WHERE e->>'accountId'=a.id
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(s_lines) l WHERE l->>'voucherId'=e->>'voucherId'
        AND l->>'ordinal'=e->>'ordinal' AND l->>'accountId'=e->>'accountId'))) ORDER BY a.id COLLATE "C"),'[]')
    INTO s_controls FROM openerp.accounts a
    CROSS JOIN LATERAL(SELECT coalesce(sum((e->>'expectedMinor')::numeric),0) amount
      FROM jsonb_array_elements(s_effects) e WHERE e->>'accountId'=a.id) expected
    CROSS JOIN LATERAL(SELECT coalesce(sum((l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric),0) amount,
      count(*) FILTER(WHERE (l->>'unexplainedMinor')::numeric<>0) unexplained
      FROM jsonb_array_elements(s_lines) l WHERE l->>'accountId'=a.id) ledger
    WHERE a.book_id=s_book.id AND a.id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'));
  s_body:=jsonb_build_object('id',openerp.new_id('schedule_control'),'scope',p_scope,'kind','synthetic_subledger_control_v1',
    'input',p_input,'inventorySha256',s_evidence.sha256,'sequence',s_book.committed_sequence::text,'currency',s_book.currency,
    'currencyScale',s_book.currency_scale,'dependencyDigest',s_digest,'knowledgeBasis','current_known_facts_at_capture',
    'coverage','not_established','financialCloseReady',false,'schedules',s_schedules,'expectedEffects',s_effects,
    'ledgerLines',s_lines,'controls',s_controls,'hasReviewGaps',jsonb_array_length(s_schedules)=0
      OR EXISTS(SELECT FROM jsonb_array_elements(s_schedules) s WHERE s->'basis'='null'::jsonb
        OR (s->>'basisReversed')::boolean OR NOT openerp.subledger_basis_matches_revision(s->'basis',s->'revision')
        OR EXISTS(SELECT FROM jsonb_array_elements(s->'occurrences') o WHERE o->>'state'<>'posted'
          AND NOT(coalesce(s->'disposal'<>'null'::jsonb,false) AND o->>'state' IN('unprepared','prepared')
            AND (o->>'postingDate')::date>=(s->'disposal'->>'postingDate')::date)))
      OR EXISTS(SELECT FROM jsonb_array_elements(s_controls) c WHERE (c->>'differenceMinor')::numeric<>0
        OR (c->>'unexplainedLineCount')::integer<>0 OR (c->>'missingEffectCount')::integer<>0))
    ||openerp.commerce_record_metadata(p_key,'create_subledger_control',s_actor);
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  s_content:=openerp.canonical(s_body); s_bytes:=octet_length(convert_to(s_content,'UTF8'));
  IF s_bytes>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','The retained control JSON exceeds8MiB.'); END IF;
  s_hash:=encode(sha256(convert_to(s_content,'UTF8')),'hex');
  INSERT INTO openerp.subledger_control_snapshots VALUES(s_book.id,s_body->>'id',s_body,s_content,s_hash,s_bytes);
  RETURN openerp.save_command(s_book.id,p_key,s_actor,'create_subledger_control',p_input,s_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_close_dependencies(book text,ends_on date) RETURNS jsonb LANGUAGE sql STABLE
SET search_path=pg_catalog,openerp AS $$
  WITH schedules AS (
    SELECT s.id,r.body,d.body disposal,openerp.subledger_occurrence_states(book,r.body,ends_on) states
      FROM openerp.subledger_schedules s
      CROSS JOIN LATERAL(SELECT openerp.subledger_revision_at(book,s.id,ends_on) body) r
      LEFT JOIN openerp.subledger_disposals d ON d.book_id=s.book_id AND d.schedule_id=s.id
      WHERE s.book_id=book AND r.body IS NOT NULL
  ), occurrences AS (
    SELECT o.value FROM schedules s CROSS JOIN LATERAL jsonb_array_elements(s.states) o(value)
    WHERE s.disposal IS NULL OR (s.disposal->>'postingDate')::date>ends_on
      OR o.value->>'state' NOT IN('unprepared','prepared')
      OR (o.value->>'postingDate')::date<(s.disposal->>'postingDate')::date
  )
  SELECT jsonb_build_object('coverageEstablished',false,
    'scheduleRevisionDigest',openerp.digest(coalesce((SELECT jsonb_agg(
      jsonb_build_object('id',s.id,'digest',s.body->>'digest','occurrences',s.states,
        'impairmentDigests',coalesce((SELECT jsonb_agg(i.body->>'digest' ORDER BY i.ordinal)
          FROM openerp.subledger_impairments i WHERE i.book_id=book AND i.schedule_id=s.id AND i.posting_date<=ends_on),'[]'))
      ||CASE WHEN s.disposal IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('disposalDigest',s.disposal->>'digest') END
      ORDER BY s.id COLLATE "C") FROM schedules s),'[]')),
    'scheduleCount',(SELECT count(*) FROM schedules),
    'dueUnpreparedCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='unprepared'),
    'dueUnpostedCount',(SELECT count(*) FROM occurrences WHERE value->>'state' IN('unprepared','prepared','conflicted')),
    'reversedOccurrenceCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='reversed'),
    'conflictedOccurrenceCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='conflicted'),
    'impairmentCount',(SELECT count(*) FROM openerp.subledger_impairments i WHERE i.book_id=book AND i.posting_date<=ends_on),
    'limitation','Schedule inventory completeness, impairment valuation policy and control reconciliation are not established.')
$$;

ALTER FUNCTION openerp.correction_impact_resources(text,text,date) RENAME TO correction_impact_resources_before_impairment;
CREATE FUNCTION openerp.correction_impact_resources(p_book text,p_voucher text,p_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_base jsonb; c_impairment jsonb;
BEGIN
  c_base:=openerp.correction_impact_resources_before_impairment(p_book,p_voucher,p_date);
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','schedule','id',x.schedule_id,
    'detail','Asset impairment history for schedule '||x.schedule_id||' consumes this voucher. Generic correction is blocked; a complete owned correction is not implemented.',
    'path','/schedules/'||x.schedule_id,'blocks',true,
    'dependencyDigest',openerp.digest((SELECT jsonb_agg(i.body->>'digest' ORDER BY i.ordinal)
      FROM openerp.subledger_impairments i WHERE i.book_id=p_book AND i.schedule_id=x.schedule_id)))
    ORDER BY x.schedule_id COLLATE "C"),'[]') INTO c_impairment
    FROM openerp.subledger_impairment_schedule_for_voucher(p_book,p_voucher) x;
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind' COLLATE "C",resource->>'id' COLLATE "C",
    resource->>'detail' COLLATE "C"),'[]') INTO c_base
    FROM jsonb_array_elements(c_base||c_impairment) item(resource);
  IF jsonb_array_length(c_base)>1000 THEN
    PERFORM openerp.fail('UnsupportedProfile','This impact exceeds1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN c_base;
END $$;

CREATE OR REPLACE FUNCTION openerp.posting_recovery_standalone(book text,id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT NOT EXISTS(SELECT FROM openerp.correction_bundles b WHERE b.book_id=book
      AND posting_recovery_standalone.id IN(b.reversal_change_set_id,b.replacement_change_set_id))
    AND NOT EXISTS(SELECT FROM openerp.vat_control_reclassification_reviews r
      WHERE r.book_id=book AND r.change_set_id=posting_recovery_standalone.id)
    AND NOT EXISTS(SELECT FROM openerp.subledger_impairment_reviews r
      WHERE r.book_id=book AND r.change_set_id=posting_recovery_standalone.id)
$$;

CREATE OR REPLACE FUNCTION openerp.accountant_review_providers_bounded(p_book text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT openerp.tax_account_close_dependencies(p_book) IS NOT NULL
    AND openerp.vat_return_dependencies(p_book) IS NOT NULL
    AND NOT((SELECT count(*) FROM (SELECT 1 FROM openerp.owner_parties p WHERE p.book_id=p_book LIMIT 101) bounded)>100
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_records r WHERE r.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_effects e WHERE e.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book LIMIT 5001) bounded)>5000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.expense_tax_sources s WHERE s.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_fact_components v WHERE v.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_return_drafts v WHERE v.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_draft_amendments v WHERE v.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_profiles p WHERE p.book_id=p_book LIMIT 21) bounded)>20
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_reporting_obligations o WHERE o.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_reclassification_approvals a WHERE a.book_id=p_book LIMIT 10001) bounded)>10000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_reclassification_contributions c WHERE c.book_id=p_book LIMIT 5001) bounded)>5000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_schedules s WHERE s.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_bases b WHERE b.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_control_snapshots c WHERE c.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_preparations p WHERE p.book_id=p_book LIMIT 10001) bounded)>10000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_book LIMIT 4001) bounded)>4000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_impairments i WHERE i.book_id=p_book LIMIT 4001) bounded)>4000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.accounts a WHERE a.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.periods p WHERE p.book_id=p_book LIMIT 1001) bounded)>1000)
$$;

REVOKE ALL ON openerp.subledger_impairment_reviews,openerp.subledger_impairment_approvals,openerp.subledger_impairments
  FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.subledger_revision_at(text,text,date),openerp.subledger_impairment_basis(text,jsonb),
  openerp.prepare_subledger_impairment(text,jsonb,text,jsonb),openerp.subledger_impairment_checked(text,text,jsonb),
  openerp.approve_subledger_impairment(text,jsonb,text,text,jsonb),openerp.execute_subledger_impairment(text,jsonb,text,text,jsonb),
  openerp.get_subledger_impairment_review(text,jsonb,text),openerp.list_subledger_impairment_reviews(text,jsonb,text),
  openerp.subledger_impairment_schedule_for_voucher(text,text),openerp.subledger_check_impairment(text,text,jsonb),
  openerp.subledger_impairment_aggregate_guard(),openerp.subledger_basis_matches_revision(jsonb,jsonb),
  openerp.subledger_estimate_current(text,jsonb),openerp.subledger_basis_revision_guard(),openerp.subledger_check_posting_basis(text,text,jsonb),
  openerp.subledger_posting_basis(text,text),openerp.get_schedule(text,jsonb,text),openerp.subledger_disposal_basis(text,jsonb),
  openerp.prepare_subledger_disposal(text,jsonb,text,jsonb),openerp.execute_subledger_disposal(text,jsonb,text,text,jsonb),
  openerp.subledger_control_dependency_digest(text),openerp.create_subledger_control(text,jsonb,text,jsonb),
  openerp.subledger_close_dependencies(text,date),openerp.correction_impact_resources(text,text,date),
  openerp.posting_recovery_standalone(text,text),openerp.accountant_review_providers_bounded(text)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_subledger_impairment(text,jsonb,text,jsonb),
  openerp.approve_subledger_impairment(text,jsonb,text,text,jsonb),openerp.execute_subledger_impairment(text,jsonb,text,text,jsonb),
  openerp.get_subledger_impairment_review(text,jsonb,text),openerp.list_subledger_impairment_reviews(text,jsonb,text),
  openerp.get_schedule(text,jsonb,text),openerp.prepare_subledger_disposal(text,jsonb,text,jsonb),
  openerp.execute_subledger_disposal(text,jsonb,text,text,jsonb),openerp.create_subledger_control(text,jsonb,text,jsonb)
  TO openerp_runtime;
