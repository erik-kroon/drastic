-- Native synthetic no-proceeds disposal only. No legal/tax policy or source completeness claim.
CREATE TABLE openerp.subledger_disposal_reviews (
  book_id text NOT NULL, id text NOT NULL, schedule_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
  change_set_id text NOT NULL, evidence_id text NOT NULL, body jsonb NOT NULL CHECK(octet_length(body::text)<=1048576),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,schedule_id,ordinal), UNIQUE(book_id,change_set_id), UNIQUE(book_id,evidence_id),
  UNIQUE(book_id,id,schedule_id), FOREIGN KEY(book_id,schedule_id) REFERENCES openerp.subledger_schedules,
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets, FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK(body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.subledger_disposal_approvals (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
  actor_id text NOT NULL REFERENCES openerp.actors, expires_at timestamptz NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,review_id,ordinal), UNIQUE(book_id,id,review_id),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.subledger_disposal_reviews,
  CHECK(body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.subledger_disposals (
  book_id text NOT NULL, id text NOT NULL, schedule_id text NOT NULL, review_id text NOT NULL, approval_id text NOT NULL,
  posting_receipt_id text NOT NULL, posting_date date NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,schedule_id), UNIQUE(book_id,review_id), UNIQUE(book_id,approval_id), UNIQUE(book_id,posting_receipt_id),
  FOREIGN KEY(book_id,review_id,schedule_id) REFERENCES openerp.subledger_disposal_reviews(book_id,id,schedule_id),
  FOREIGN KEY(book_id,approval_id,review_id) REFERENCES openerp.subledger_disposal_approvals(book_id,id,review_id),
  FOREIGN KEY(book_id,posting_receipt_id) REFERENCES openerp.execution_receipts,
  CHECK(body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_subledger_disposal_review BEFORE UPDATE OR DELETE ON openerp.subledger_disposal_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_disposal_approval BEFORE UPDATE OR DELETE ON openerp.subledger_disposal_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_disposal BEFORE UPDATE OR DELETE ON openerp.subledger_disposals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- Exact represented basis, not an inferred company-wide control balance. Caller holds book barrier.
CREATE FUNCTION openerp.subledger_disposal_basis(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE d_schedule jsonb; d_basis jsonb; d_states jsonb; d_source openerp.evidence; d_review openerp.evidence;
  d_date date; d_gross numeric; d_opening numeric; d_recognized numeric; d_reversed numeric; d_carrying numeric;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  d_schedule:=openerp.subledger_current(p_book,p_input->>'scheduleId');
  SELECT b.body INTO d_basis FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.schedule_id=p_input->>'scheduleId';
  IF d_basis IS NULL OR d_schedule->'terms'->>'kind'<>'asset' THEN
    PERFORM openerp.fail('UnsupportedProfile','This disposal supports only an asset with a retained gross and accumulated carrying basis.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book AND d.schedule_id=p_input->>'scheduleId') THEN
    PERFORM openerp.fail('AlreadyPosted','This schedule already has an immutable disposal. Recover its retained result.'); END IF;
  IF p_input->>'expectedDigest' IS DISTINCT FROM d_schedule->>'digest'
    OR p_input->>'expectedBasisDigest' IS DISTINCT FROM d_basis->>'digest'
    OR NOT openerp.subledger_basis_matches_revision(d_basis,d_schedule)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.corrects_voucher_id=d_basis->'input'->>'voucherId') THEN
    PERFORM openerp.fail('StaleDependency','Review the current schedule and intact original carrying basis.'); END IF;
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
    PERFORM openerp.fail('UnsupportedProfile','Resolve ambiguous history, posted correction replacements, later postings/reversals and earlier due unposted occurrences before disposal.'); END IF;
  SELECT coalesce(sum((o->>'amountMinor')::numeric) FILTER(WHERE o->>'state'='posted'),0),
    coalesce(sum((o->>'amountMinor')::numeric) FILTER(WHERE o->>'state'='reversed'),0)
    INTO d_recognized,d_reversed FROM jsonb_array_elements(d_states) o;
  d_gross:=(d_basis->'input'->>'originalCostMinor')::numeric;
  d_opening:=(d_basis->'input'->>'accumulatedMinor')::numeric;
  d_carrying:=d_gross-d_opening-d_recognized;
  IF d_carrying<0 OR d_gross<>d_opening+(d_schedule->'terms'->>'costMinor')::numeric
    OR (SELECT coalesce(sum((l->>'debitMinor')::numeric),0) FROM jsonb_array_elements(d_basis->'lines') l)<>d_gross
    OR (SELECT coalesce(sum((l->>'creditMinor')::numeric),0) FROM jsonb_array_elements(d_basis->'lines') l)<>d_opening
    OR EXISTS(SELECT FROM jsonb_array_elements(d_basis->'lines') l WHERE
      ((l->>'debitMinor')::numeric>0 AND l->>'accountId'=d_schedule->'terms'->>'creditAccountId')
      OR ((l->>'creditMinor')::numeric>0 AND l->>'accountId'<>d_schedule->'terms'->>'creditAccountId')
      OR NOT EXISTS(SELECT FROM openerp.journal_lines j WHERE j.book_id=p_book AND j.voucher_id=d_basis->'input'->>'voucherId'
        AND j.id=l->>'lineId' AND j.ordinal=(l->>'ordinal')::integer AND j.account_id=l->>'accountId'
        AND j.debit_minor=(l->>'debitMinor')::numeric AND j.credit_minor=(l->>'creditMinor')::numeric)) THEN
    PERFORM openerp.fail('UnsupportedProfile','Disposal requires intact represented gross controls and a separate schedule accumulated control. Direct net write-down and mixed accumulated controls are unsupported.'); END IF;
  IF p_input->>'lossAccountId'=d_schedule->'terms'->>'creditAccountId'
    OR EXISTS(SELECT FROM jsonb_array_elements(d_basis->'lines') l WHERE l->>'accountId'=p_input->>'lossAccountId') THEN
    PERFORM openerp.fail('InvalidJournal','Choose an explicit loss account distinct from every represented carrying control.'); END IF;
  IF EXISTS(WITH accounts AS (
      SELECT l->>'accountId' id FROM jsonb_array_elements(d_basis->'lines') l
      UNION SELECT d_schedule->'terms'->>'creditAccountId' UNION SELECT p_input->>'lossAccountId'
    ) SELECT FROM accounts a WHERE
      EXISTS(SELECT FROM openerp.bank_sources b WHERE b.book_id=p_book AND b.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.owner_control_accounts o WHERE o.book_id=p_book AND o.account_id=a.id)
      OR NOT EXISTS(SELECT FROM openerp.accounts x WHERE x.book_id=p_book AND x.id=a.id AND x.active)) THEN
    PERFORM openerp.fail('InvalidJournal','Disposal accounts must be active and cannot be known bank, commerce or owner controls.'); END IF;
  SELECT * INTO d_source FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'evidenceId';
  SELECT * INTO d_review FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'reviewEvidenceId';
  IF d_source.id IS NULL OR d_review.id IS NULL THEN
    PERFORM openerp.fail('MissingEvidence','Retain disposal source and review evidence in this book.'); END IF;
  RETURN jsonb_build_object('schedule',d_schedule,'carryingBasis',d_basis,'occurrences',d_states,
    'originalCostMinor',d_gross::text,'openingAccumulatedMinor',d_opening::text,'recognizedMinor',d_recognized::text,
    'reversedMinor',d_reversed::text,'totalAccumulatedMinor',(d_opening+d_recognized)::text,'carryingMinor',d_carrying::text,
    'sourceSha256',d_source.sha256,'reviewSha256',d_review.sha256);
END $$;

CREATE FUNCTION openerp.prepare_subledger_disposal(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
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
    PERFORM openerp.fail('UnsupportedProfile','Explicitly select synthetic no-proceeds disposal and tax-not-applicable. This does not establish real-company legal or tax treatment.'); END IF;
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
  IF (d_basis->>'totalAccumulatedMinor')::numeric>0 THEN
    d_lines:=d_lines||jsonb_build_array(jsonb_build_object('accountId',d_basis->'schedule'->'terms'->>'creditAccountId',
      'debitMinor',d_basis->>'totalAccumulatedMinor','creditMinor','0','description','Release represented synthetic accumulated recognition')); END IF;
  IF (d_basis->>'carryingMinor')::numeric>0 THEN
    d_lines:=d_lines||jsonb_build_array(jsonb_build_object('accountId',p_input->>'lossAccountId',
      'debitMinor',d_basis->>'carryingMinor','creditMinor','0','description','Explicit synthetic no-proceeds carrying loss')); END IF;
  d_evidence:=openerp.create_evidence(p_token,p_scope,'sd_'||d_id||'_evidence',jsonb_build_object(
    'title','Synthetic asset disposal review','mediaType','application/json',
    'content',openerp.canonical(jsonb_build_object('reviewId',d_id,'input',p_input,'basisSnapshotDigest',openerp.digest(d_basis))),
    'origin','Immutable synthetic no-proceeds disposal review; not legal or tax authorization'));
  d_plan:=openerp.prepare_journal(p_token,p_scope,'sd_'||d_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',d_evidence->>'id','eventKey','asset_disposal_'||substr(openerp.digest(p_input->'scheduleId'),8),
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',p_input->>'postingDate','series',p_input->>'series',
    'description','Synthetic no-proceeds asset disposal','rationale',p_input->>'rationale','taxAssessment','not_applicable','lines',d_lines));
  d_body:=jsonb_build_object('id',d_id,'scope',p_scope,'ordinal',d_ordinal,'version',1,'input',p_input,'basis',d_basis,
    'evidence',d_evidence,'postingPlan',d_plan,'coverage','not_established','legalPolicyApproved',false,'requiresPostingApproval',true)
    ||openerp.commerce_record_metadata(p_key,'prepare_subledger_disposal',d_actor);
  d_body:=d_body||jsonb_build_object('digest',openerp.digest(d_body));
  INSERT INTO openerp.subledger_disposal_reviews VALUES(p_scope->>'bookId',d_id,p_input->>'scheduleId',d_ordinal,d_plan->>'id',d_evidence->>'id',d_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,d_actor,'prepare_subledger_disposal',p_input,d_body);
END $$;

CREATE FUNCTION openerp.subledger_disposal_checked(p_book text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE d_review jsonb;
BEGIN
  SELECT r.body INTO d_review FROM openerp.subledger_disposal_reviews r WHERE r.book_id=p_book AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','No disposal review exists in this book.'); END IF;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb
    OR p_input->>'digest' IS DISTINCT FROM d_review->>'digest'
    OR d_review->>'digest' IS DISTINCT FROM openerp.digest(d_review-'digest')
    OR openerp.subledger_disposal_basis(p_book,d_review->'input') IS DISTINCT FROM d_review->'basis' THEN
    PERFORM openerp.fail('StaleDependency','Review and approve a new exact synthetic disposal after any basis or recognition-history change.'); END IF;
  PERFORM openerp.check_dependencies(d_review->'scope',d_review->'postingPlan');
  RETURN d_review;
END $$;

CREATE FUNCTION openerp.approve_subledger_disposal(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_actor text; d_previous jsonb; d_review jsonb; d_body jsonb; d_ordinal integer;
  d_id text:=openerp.new_id('asset_disposal_approval'); d_expiry timestamptz:=clock_timestamp()+interval '1 hour';
  d_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  d_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  d_previous:=openerp.replay(p_scope->>'bookId',p_key,d_actor,'approve_subledger_disposal',d_payload);
  IF d_previous IS NOT NULL THEN RETURN d_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','acknowledgeSyntheticOnly']);
  d_review:=openerp.subledger_disposal_checked(p_scope->>'bookId',p_id,p_input);
  SELECT count(*)+1 INTO d_ordinal FROM openerp.subledger_disposal_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id;
  IF d_ordinal>20 THEN PERFORM openerp.fail('UnsupportedProfile','This disposal review reached its20 retained approval bound.'); END IF;
  d_body:=jsonb_build_object('id',d_id,'scope',p_scope,'reviewId',p_id,'reviewDigest',d_review->>'digest','actorId',d_actor,
    'expiresAt',to_char(d_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'legalPolicyApproved',false)
    ||openerp.commerce_record_metadata(p_key,'approve_subledger_disposal',d_actor);
  d_body:=d_body||jsonb_build_object('digest',openerp.digest(d_body));
  INSERT INTO openerp.subledger_disposal_approvals VALUES(p_scope->>'bookId',d_id,p_id,d_ordinal,d_actor,d_expiry,d_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,d_actor,'approve_subledger_disposal',d_payload,d_body);
END $$;

CREATE FUNCTION openerp.execute_subledger_disposal(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
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
    'recognizedMinor',d_review->'basis'->>'recognizedMinor','totalAccumulatedMinor',d_review->'basis'->>'totalAccumulatedMinor',
    'carryingMinorReleased',d_review->'basis'->>'carryingMinor','carryingMinor','0','status','synthetic_disposed',
    'futureRecognitionBlocked',true,'postingReceipt',d_posting,'coverage','not_established','legalPolicyApproved',false)
    ||openerp.commerce_record_metadata(p_key,'execute_subledger_disposal',d_actor);
  d_body:=d_body||jsonb_build_object('digest',openerp.digest(d_body));
  INSERT INTO openerp.subledger_disposals VALUES(p_scope->>'bookId',d_id,d_review->'input'->>'scheduleId',p_id,d_approval.id,
    d_posting->>'id',(d_review->'input'->>'postingDate')::date,d_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,d_actor,'execute_subledger_disposal',d_payload,d_body);
END $$;


-- Reuse1800's shared validation/deferred proposal/physical voucher owner.
CREATE FUNCTION openerp.subledger_check_disposal(p_book text,p_change text,p_action jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE d_review openerp.subledger_disposal_reviews;
BEGIN
  SELECT * INTO d_review FROM openerp.subledger_disposal_reviews r WHERE r.book_id=p_book AND r.change_set_id=p_change;
  IF FOUND THEN
    IF p_action IS DISTINCT FROM d_review.body->'postingPlan'->'groups'->0->'actions'->0 THEN
      PERFORM openerp.fail('StaleDependency','The disposal action must be the exact retained native plan.'); END IF;
    -- Allow a deferred proposal check to see its own completed aggregate in a compound transaction.
    -- Kernel duplicate constraints still forbid another voucher for this settled change set.
    IF EXISTS(SELECT FROM openerp.subledger_disposals d JOIN openerp.execution_receipts e
      ON e.book_id=d.book_id AND e.id=d.posting_receipt_id WHERE d.book_id=p_book
      AND d.review_id=d_review.id AND e.change_set_id=p_change) THEN RETURN; END IF;
    IF openerp.subledger_disposal_basis(p_book,d_review.body->'input') IS DISTINCT FROM d_review.body->'basis' THEN
      PERFORM openerp.fail('StaleDependency','The disposal carrying basis or posting/reversal history changed. Prepare and approve a new review.'); END IF;
    RETURN;
  END IF;
  IF EXISTS(
    WITH RECURSIVE origins(change_set_id) AS (
      SELECT p_change UNION SELECT v.change_set_id FROM origins o
      JOIN openerp.correction_bundles c ON c.book_id=p_book AND c.replacement_change_set_id=o.change_set_id
      JOIN openerp.vouchers v ON v.book_id=c.book_id AND v.id=c.original_voucher_id
    ) SELECT FROM openerp.subledger_disposal_reviews r WHERE r.book_id=p_book
      AND (r.change_set_id IN(SELECT change_set_id FROM origins)
        OR r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=p_book AND e.id=p_action->>'eventId')
        OR EXISTS(SELECT FROM jsonb_array_elements(p_action->'evidenceRefs') e WHERE e->>'evidenceId'=r.evidence_id))
  ) THEN PERFORM openerp.fail('UnsupportedProfile','Owned disposal evidence and correction ancestry require their complete native disposal aggregate. Generic replacement or reversal is unsupported.'); END IF;
  IF p_action->>'correctsVoucherId' IS NOT NULL AND EXISTS(
    SELECT FROM openerp.subledger_disposals d JOIN openerp.subledger_disposal_reviews r ON r.book_id=d.book_id AND r.id=d.review_id
    WHERE d.book_id=p_book AND (p_action->>'correctsVoucherId'=r.body->'basis'->'carryingBasis'->'input'->>'voucherId'
      OR EXISTS(SELECT FROM jsonb_array_elements(r.body->'basis'->'occurrences') o
        WHERE p_action->>'correctsVoucherId' IN(o->>'voucherId',o->>'reversalVoucherId')))
  ) THEN PERFORM openerp.fail('UnsupportedProfile','A disposed asset freezes its represented acquisition and recognition history. A register-aware disposal correction is not implemented.'); END IF;
END $$;

-- No ambient bypass and no independently callable financial register write.
-- A generic execute_change cannot commit this journal without the operator-only aggregate.
CREATE FUNCTION openerp.subledger_disposal_aggregate_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.subledger_disposal_reviews r WHERE r.book_id=NEW.book_id
    AND (r.change_set_id=NEW.change_set_id
      OR r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
      OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') e WHERE e->>'evidenceId'=r.evidence_id)))
    AND NOT EXISTS(SELECT FROM openerp.subledger_disposals d
      JOIN openerp.subledger_disposal_reviews r ON r.book_id=d.book_id AND r.id=d.review_id
      JOIN openerp.execution_receipts e ON e.book_id=d.book_id AND e.id=d.posting_receipt_id
      WHERE d.book_id=NEW.book_id AND r.change_set_id=NEW.change_set_id AND e.voucher_id=NEW.id
        AND d.posting_date=NEW.posting_date AND NEW.action=r.body->'postingPlan'->'groups'->0->'actions'->0) THEN
    PERFORM openerp.fail('ApprovalRequired','The disposal journal and immutable schedule consequence must commit through operator-only disposal execution.'); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER subledger_disposal_complete_aggregate AFTER INSERT ON openerp.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.subledger_disposal_aggregate_guard();

CREATE FUNCTION openerp.subledger_disposal_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=NEW.book_id AND d.schedule_id=NEW.schedule_id) THEN
    PERFORM openerp.fail('UnsupportedProfile','A disposed schedule retains its full history but cannot recognize or amend remaining installments.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subledger_disposal_freezes_revision BEFORE INSERT ON openerp.subledger_schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.subledger_disposal_revision_guard();

CREATE FUNCTION openerp.get_subledger_disposal_review(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_review jsonb; d_approvals jsonb; d_disposal jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT r.body INTO d_review FROM openerp.subledger_disposal_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','No disposal review exists in this book.'); END IF;
  SELECT coalesce(jsonb_agg(a.body ORDER BY a.ordinal),'[]') INTO d_approvals FROM openerp.subledger_disposal_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id;
  SELECT d.body INTO d_disposal FROM openerp.subledger_disposals d WHERE d.book_id=p_scope->>'bookId' AND d.schedule_id=d_review->'input'->>'scheduleId';
  RETURN jsonb_build_object('review',d_review,'approvals',d_approvals,'disposal',d_disposal,'liveAuthorizationChecked',false);
END $$;
CREATE FUNCTION openerp.list_subledger_disposal_reviews(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE d_items jsonb; d_disposal jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  PERFORM openerp.subledger_current(p_scope->>'bookId',p_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'ordinal',r.ordinal,'digest',r.body->>'digest',
    'createdAt',r.body->>'createdAt','postingDate',r.body->'input'->>'postingDate') ORDER BY r.ordinal),'[]') INTO d_items
    FROM openerp.subledger_disposal_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.schedule_id=p_id;
  SELECT d.body INTO d_disposal FROM openerp.subledger_disposals d WHERE d.book_id=p_scope->>'bookId' AND d.schedule_id=p_id;
  RETURN jsonb_build_object('scope',p_scope,'scheduleId',p_id,'items',d_items,'disposal',d_disposal,'coverage','not_established');
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_check_posting_basis(p_book text,p_change text,p_action jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_preparation openerp.subledger_preparations; s_basis jsonb;
BEGIN
  PERFORM openerp.subledger_check_disposal(p_book,p_change,p_action);
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
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book AND d.schedule_id=p_schedule) THEN
    s_blocker:='disposed';
  ELSIF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book
    AND v.corrects_voucher_id=s_basis.voucher_id) THEN
    s_blocker:='basis_reversed_or_corrected';
  ELSIF NOT openerp.subledger_basis_matches_revision(s_basis.body,s_current) THEN
    s_blocker:='basis_mismatch';
  ELSIF NOT openerp.subledger_estimate_current(p_book,s_current) THEN
    s_blocker:='estimate_history_changed';
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

CREATE OR REPLACE FUNCTION openerp.get_schedule(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_current jsonb; sl_revisions jsonb; sl_states jsonb; sl_recognized numeric; sl_disposal jsonb;
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
  RETURN jsonb_build_object('disposal',sl_disposal,'current',sl_current,'revisions',sl_revisions,'occurrences',sl_states,
    'recognizedMinor',sl_recognized::text,'remainingMinor',CASE WHEN sl_disposal IS NOT NULL THEN '0' ELSE ((sl_current->'terms'->>'costMinor')::numeric-sl_recognized)::text END,
    'revisionAllowed',NOT EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=scope->>'bookId' AND b.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.subledger_preparations p WHERE p.book_id=scope->>'bookId' AND p.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.events e WHERE e.book_id=scope->>'bookId' AND e.evidence_id=sl_current->'terms'->>'evidenceId'
        AND e.event_key IN(SELECT value->>'eventKey' FROM jsonb_array_elements(sl_current->'occurrences')))
      AND (sl_current->>'revision')::integer<20,
    'controlAccountReconciled',false,'requiresPostingApproval',true,
    'postingBasis',openerp.subledger_posting_basis(scope->>'bookId',id));
END $$;

CREATE OR REPLACE FUNCTION openerp.subledger_control_dependency_digest(p_book text) RETURNS text LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE s_body jsonb;
BEGIN
  IF (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_schedules s WHERE s.book_id=p_book LIMIT 201) x)>200
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.accounts a WHERE a.book_id=p_book LIMIT 1001) x)>1000
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.periods p WHERE p.book_id=p_book LIMIT 1001) x)>1000
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_preparations p WHERE p.book_id=p_book LIMIT 10001) x)>10000 THEN
    RETURN NULL; END IF;
  SELECT jsonb_build_object('sequence',b.committed_sequence::text,'profile',b.profile,'profileVersion',b.profile_version::text,
    'authority',b.authority,'writerEpoch',b.writer_epoch::text,'currency',b.currency,'currencyScale',b.currency_scale,
    'periods',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text,'locked',p.locked,'startsOn',p.starts_on,'endsOn',p.ends_on,'year',p.fiscal_year_id) ORDER BY p.id COLLATE "C")
      FROM openerp.periods p WHERE p.book_id=p_book),'[]'),
    'accounts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'version',a.version::text,'code',a.code,'name',a.name,'active',a.active) ORDER BY a.id COLLATE "C")
      FROM openerp.accounts a WHERE a.book_id=p_book),'[]'),
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
  RETURN openerp.digest(s_body);
END $$;

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
    'disposal',disposed.body,'recognizedMinor',recognized.amount::text,
    'carryingMinor',CASE WHEN b.body IS NULL OR (b.body->'input'->>'effectiveOn')::date>s_date
      OR EXISTS(SELECT FROM openerp.vouchers rv WHERE rv.book_id=s_book.id AND rv.corrects_voucher_id=b.voucher_id
        AND rv.posting_date<=s_date AND rv.sequence<=s_book.committed_sequence)
      THEN NULL WHEN disposed.body IS NOT NULL THEN '0' ELSE ((b.body->'input'->>'carryingMinor')::numeric-recognized.amount)::text END)
    ORDER BY s.id COLLATE "C"),'[]') INTO s_schedules FROM openerp.subledger_schedules s
    CROSS JOIN LATERAL(SELECT openerp.subledger_current(s_book.id,s.id) body) r
    LEFT JOIN openerp.subledger_bases b ON b.book_id=s.book_id AND b.schedule_id=s.id
    LEFT JOIN openerp.subledger_disposals disposed ON disposed.book_id=s.book_id AND disposed.schedule_id=s.id AND disposed.posting_date<=s_date
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
    UNION ALL
    SELECT d.schedule_id,'disposal_release',e.voucher_id,l.ordinal::integer,l.value->>'accountId',
      (l.value->>'debitMinor')::numeric-(l.value->>'creditMinor')::numeric
      FROM openerp.subledger_disposals d JOIN openerp.subledger_disposal_reviews r ON r.book_id=d.book_id AND r.id=d.review_id
      JOIN openerp.execution_receipts e ON e.book_id=d.book_id AND e.id=d.posting_receipt_id
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'postingPlan'->'groups'->0->'actions'->0->'lines') WITH ORDINALITY l(value,ordinal)
      WHERE d.book_id=s_book.id AND d.posting_date<=s_date AND l.value->>'accountId'<>r.body->'input'->>'lossAccountId'
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
        OR EXISTS(SELECT FROM jsonb_array_elements(s->'occurrences') o WHERE o->>'state'<>'posted'
          AND NOT(coalesce(s->'disposal'<>'null'::jsonb,false) AND o->>'state' IN('unprepared','prepared')
            AND (o->>'postingDate')::date>=(s->'disposal'->>'postingDate')::date)))
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

CREATE OR REPLACE FUNCTION openerp.subledger_close_dependencies(book text, ends_on date) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  WITH schedules AS (
    SELECT s.id,r.body,d.body disposal,openerp.subledger_occurrence_states(book,r.body,ends_on) states FROM openerp.subledger_schedules s
      JOIN LATERAL(SELECT x.body FROM openerp.subledger_schedule_revisions x WHERE x.book_id=book AND x.schedule_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true
      LEFT JOIN openerp.subledger_disposals d ON d.book_id=s.book_id AND d.schedule_id=s.id
      WHERE s.book_id=book
  ), occurrences AS (SELECT o.value FROM schedules s CROSS JOIN LATERAL jsonb_array_elements(s.states) o(value)
    WHERE s.disposal IS NULL OR (s.disposal->>'postingDate')::date>ends_on
      OR o.value->>'state' NOT IN('unprepared','prepared')
      OR (o.value->>'postingDate')::date<(s.disposal->>'postingDate')::date)
  SELECT jsonb_build_object('coverageEstablished',false,
    'scheduleRevisionDigest',openerp.digest(coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'digest',s.body->>'digest','occurrences',s.states)||CASE WHEN s.disposal IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('disposalDigest',s.disposal->>'digest') END ORDER BY s.id COLLATE "C") FROM schedules s),'[]')),
    'scheduleCount',(SELECT count(*) FROM schedules),
    'dueUnpreparedCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='unprepared'),
    'dueUnpostedCount',(SELECT count(*) FROM occurrences WHERE value->>'state' IN('unprepared','prepared','conflicted')),
    'reversedOccurrenceCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='reversed'),
    'conflictedOccurrenceCount',(SELECT count(*) FROM occurrences WHERE value->>'state'='conflicted'),
    'limitation','Schedule inventory completeness and control-account reconciliation are not established.')
$$;

REVOKE ALL ON openerp.subledger_disposal_reviews,openerp.subledger_disposal_approvals,openerp.subledger_disposals FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.subledger_disposal_basis(text,jsonb),
  openerp.subledger_disposal_checked(text,text,jsonb),
  openerp.subledger_check_disposal(text,text,jsonb),
  openerp.subledger_disposal_aggregate_guard(),
  openerp.subledger_disposal_revision_guard(),
  openerp.subledger_check_posting_basis(text,text,jsonb),
  openerp.subledger_posting_basis(text,text),
  openerp.subledger_control_dependency_digest(text),
  openerp.subledger_close_dependencies(text,date),
  openerp.prepare_subledger_disposal(text,jsonb,text,jsonb),
  openerp.approve_subledger_disposal(text,jsonb,text,text,jsonb),
  openerp.execute_subledger_disposal(text,jsonb,text,text,jsonb),
  openerp.get_subledger_disposal_review(text,jsonb,text),
  openerp.list_subledger_disposal_reviews(text,jsonb,text),
  openerp.get_schedule(text,jsonb,text),
  openerp.create_subledger_control(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_subledger_disposal(text,jsonb,text,jsonb),
  openerp.approve_subledger_disposal(text,jsonb,text,text,jsonb),
  openerp.execute_subledger_disposal(text,jsonb,text,text,jsonb),
  openerp.get_subledger_disposal_review(text,jsonb,text),
  openerp.list_subledger_disposal_reviews(text,jsonb,text),
  openerp.get_schedule(text,jsonb,text),
  openerp.create_subledger_control(text,jsonb,text,jsonb) TO openerp_runtime;
