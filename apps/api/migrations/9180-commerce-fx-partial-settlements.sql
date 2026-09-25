ALTER TABLE openerp.commerce_fx_settlements
  ADD COLUMN profile text NOT NULL DEFAULT 'synthetic_full_book_currency_settlement_v1',
  ADD COLUMN leg_ordinal integer NOT NULL DEFAULT 1,
  ADD COLUMN final_leg boolean,
  ADD COLUMN original_remaining_before_minor openerp.minor_units,
  ADD COLUMN original_remaining_after_minor openerp.minor_units,
  ADD COLUMN carrying_remaining_before_minor openerp.minor_units,
  ADD COLUMN carrying_remaining_after_minor openerp.minor_units;
ALTER TABLE openerp.commerce_fx_settlements DROP CONSTRAINT commerce_fx_settlements_book_id_item_id_key;
ALTER TABLE openerp.commerce_fx_settlements DROP CONSTRAINT commerce_fx_settlements_check;
ALTER TABLE openerp.commerce_fx_settlements ALTER COLUMN control_line_id DROP NOT NULL;
ALTER TABLE openerp.commerce_fx_settlements
  ADD CONSTRAINT commerce_fx_settlements_profile_check CHECK ((
    (profile='synthetic_full_book_currency_settlement_v1' AND leg_ordinal=1
      AND final_leg IS NULL AND original_remaining_before_minor IS NULL
      AND original_remaining_after_minor IS NULL AND carrying_remaining_before_minor IS NULL
      AND carrying_remaining_after_minor IS NULL)
    OR
    (profile='synthetic_partial_book_currency_settlement_v1' AND leg_ordinal>0
      AND final_leg IS NOT NULL AND original_remaining_before_minor>0
      AND original_released_minor>0 AND original_released_minor<=original_remaining_before_minor
      AND original_remaining_after_minor=original_remaining_before_minor-original_released_minor
      AND carrying_remaining_before_minor>=0 AND carrying_released_minor>=0
      AND carrying_released_minor<=carrying_remaining_before_minor
      AND carrying_remaining_after_minor=carrying_remaining_before_minor-carrying_released_minor
      AND final_leg=(original_remaining_after_minor=0)
      AND body->>'profile'=profile AND body->>'legOrdinal'=leg_ordinal::text
      AND body->'calculation'->>'originalRemainingBeforeMinor'=original_remaining_before_minor::text
      AND body->'calculation'->>'originalReleasedMinor'=original_released_minor::text
      AND body->'calculation'->>'originalRemainingAfterMinor'=original_remaining_after_minor::text
      AND body->'calculation'->>'carryingRemainingBeforeMinor'=carrying_remaining_before_minor::text
      AND body->'calculation'->>'carryingReleasedMinor'=carrying_released_minor::text
      AND body->'calculation'->>'carryingRemainingAfterMinor'=carrying_remaining_after_minor::text
      AND body->'calculation'->>'considerationMinor'=consideration_minor::text
      AND body->'calculation'->>'realizedGainMinor'=realized_gain_minor::text
      AND body->'calculation'->>'finalLeg'=final_leg::text)) IS TRUE)
  ),
  ADD CONSTRAINT commerce_fx_settlements_line_check CHECK (
    (carrying_released_minor=0 AND control_line_id IS NULL)
    OR (carrying_released_minor>0 AND control_line_id IS NOT NULL)
  ),
  ADD CONSTRAINT commerce_fx_settlements_body_check CHECK ((
    body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'itemId'=item_id
    AND body->>'reviewId'=review_id AND body->>'approvalId'=approval_id
    AND body->'postingReceipt'->>'id'=posting_receipt_id
    AND body->'postingReceipt'->>'voucherId'=voucher_id
    AND ((profile='synthetic_full_book_currency_settlement_v1'
      AND body->>'originalReleasedMinor'=original_released_minor::text
      AND body->>'carryingReleasedMinor'=carrying_released_minor::text
      AND body->>'considerationMinor'=consideration_minor::text
      AND body->>'realizedGainMinor'=realized_gain_minor::text)
      OR profile='synthetic_partial_book_currency_settlement_v1')
    AND original_released_minor>0 AND consideration_minor>0
    AND realized_gain_minor=consideration_minor-carrying_released_minor
    AND body->>'digest'=openerp.digest(body-'digest')) IS TRUE)
  ),
  ADD CONSTRAINT commerce_fx_settlements_profile_item_unique UNIQUE(book_id,item_id,leg_ordinal);
CREATE INDEX commerce_fx_settlement_profile_item ON openerp.commerce_fx_settlements(book_id,item_id,profile,leg_ordinal);

CREATE OR REPLACE FUNCTION openerp.commerce_fx_item_body(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_item openerp.commerce_fx_items; fx_settlement openerp.commerce_fx_settlements;
  fx_correction openerp.commerce_fx_settlement_corrections; fx_partials jsonb; fx_partial_corrections jsonb;
  fx_active_original numeric; fx_active_carrying numeric;
BEGIN
  SELECT * INTO fx_item FROM openerp.commerce_fx_items i WHERE i.book_id=p_book AND i.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The commerce foreign-currency item was not found in this book.'); END IF;
  SELECT * INTO fx_settlement FROM openerp.commerce_fx_settlements s
    WHERE s.book_id=p_book AND s.item_id=p_id AND s.profile='synthetic_full_book_currency_settlement_v1';
  SELECT * INTO fx_correction FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=p_book AND c.settlement_id=fx_settlement.id;
  SELECT jsonb_agg(s.body ORDER BY s.leg_ordinal),
    coalesce(jsonb_agg(c.body ORDER BY s.leg_ordinal) FILTER(WHERE c.id IS NOT NULL),'[]'::jsonb)
    INTO fx_partials,fx_partial_corrections
    FROM openerp.commerce_fx_settlements s
    LEFT JOIN openerp.commerce_fx_settlement_corrections c ON c.book_id=s.book_id AND c.settlement_id=s.id
    WHERE s.book_id=p_book AND s.item_id=p_id AND s.profile='synthetic_partial_book_currency_settlement_v1';
  IF fx_partials IS NULL THEN
    RETURN fx_item.body||jsonb_build_object(
      'status',CASE WHEN fx_settlement.id IS NULL THEN 'open' WHEN fx_correction.id IS NULL THEN 'settled' ELSE 'corrected' END,
      'remainingOriginalMinor',CASE WHEN fx_settlement.id IS NULL OR fx_correction.id IS NOT NULL THEN fx_item.original_minor::text ELSE '0' END,
      'remainingCarryingMinor',CASE WHEN fx_settlement.id IS NULL OR fx_correction.id IS NOT NULL THEN fx_item.carrying_minor::text ELSE '0' END,
      'settlement',fx_settlement.body,'correction',fx_correction.body);
  END IF;
  SELECT coalesce(sum(s.original_released_minor) FILTER(WHERE c.id IS NULL),0),
    coalesce(sum(s.carrying_released_minor) FILTER(WHERE c.id IS NULL),0)
    INTO fx_active_original,fx_active_carrying
    FROM openerp.commerce_fx_settlements s
    LEFT JOIN openerp.commerce_fx_settlement_corrections c ON c.book_id=s.book_id AND c.settlement_id=s.id
    WHERE s.book_id=p_book AND s.item_id=p_id;
  IF fx_active_original>fx_item.original_minor OR fx_active_carrying>fx_item.carrying_minor THEN
    PERFORM openerp.fail('StaleDependency','Commerce FX active settlement capacity exceeds the retained monetary item.'); END IF;
  RETURN fx_item.body||jsonb_build_object(
    'status',CASE
      WHEN fx_active_original=0 AND fx_active_carrying=0 THEN 'settled'
      WHEN fx_active_original=fx_item.original_minor AND fx_active_carrying=fx_item.carrying_minor THEN 'corrected'
      ELSE 'partially_settled' END,
    'remainingOriginalMinor',(fx_item.original_minor-fx_active_original)::text,
    'remainingCarryingMinor',(fx_item.carrying_minor-fx_active_carrying)::text,
    'settlement',fx_settlement.body,'correction',fx_correction.body,
    'partialSettlements',fx_partials,'partialCorrections',fx_partial_corrections);
END $$;

CREATE FUNCTION openerp.commerce_fx_partial_settlement_selection(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_book openerp.books; fx_period openerp.periods; fx_year text; fx_item jsonb; fx_evidence jsonb;
  fx_roles jsonb; fx_date date; fx_original numeric; fx_carrying numeric; fx_consideration numeric;
  fx_n numeric; fx_d numeric; fx_q numeric; fx_r numeric; fx_rounded numeric; fx_gain numeric;
  fx_original_after numeric; fx_carrying_after numeric; fx_final boolean; fx_ordinal integer;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','itemId','originalReleasedMinor','settlementDate',
    'accountingPeriodId','considerationMinor','evidenceId','eventKey','series','reason','feesExcluded',
    'acknowledgeLimitedProfile']);
  IF p_input->>'profile'<>'synthetic_partial_book_currency_settlement_v1'
    OR p_input->'feesExcluded'<>'true'::jsonb OR p_input->'acknowledgeLimitedProfile'<>'true'::jsonb
    OR p_input->>'series' !~ '^[A-Z0-9]{1,16}$' OR p_input->>'eventKey' !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
    PERFORM openerp.fail('UnsupportedProfile','Select the explicit book-currency partial-settlement profile without fees.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  fx_date:=openerp.bank_date(p_input->>'settlementDate');
  fx_original:=openerp.commerce_positive_minor(p_input,'originalReleasedMinor');
  fx_consideration:=openerp.commerce_positive_minor(p_input,'considerationMinor');
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_book;
  fx_item:=openerp.commerce_fx_item_body(p_book,p_input->>'itemId');
  IF fx_item->>'status' NOT IN('open','partially_settled','corrected')
    OR (fx_item->>'remainingOriginalMinor')::numeric<=0 OR (fx_item->>'remainingCarryingMinor')::numeric<0 THEN
    PERFORM openerp.fail('StaleDependency','Partial settlement requires positive current original capacity and nonnegative carrying capacity.'); END IF;
  IF fx_original>(fx_item->>'remainingOriginalMinor')::numeric THEN
    PERFORM openerp.fail('InvalidJournal','Original released units exceed the current unconsumed monetary-item capacity.'); END IF;
  IF fx_date<(fx_item->'source'->>'recognitionDate')::date THEN
    PERFORM openerp.fail('InvalidJournal','Settlement cannot precede recognition.'); END IF;
  SELECT * INTO STRICT fx_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_input->>'accountingPeriodId';
  SELECT p.fiscal_year_id INTO STRICT fx_year FROM openerp.periods p WHERE p.book_id=p_book AND p.id=fx_period.id;
  IF fx_period.locked OR fx_date NOT BETWEEN fx_period.starts_on AND fx_period.ends_on
    OR NOT EXISTS(SELECT FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=fx_year
      AND fx_date BETWEEN y.starts_on AND y.ends_on) THEN
    PERFORM openerp.fail('PeriodLocked','Settlement requires an open period and matching fiscal year on the explicit date.'); END IF;
  fx_evidence:=openerp.commerce_evidence(p_book,p_input->>'evidenceId');
  IF EXISTS(SELECT FROM openerp.events e WHERE e.book_id=p_book
    AND e.evidence_id=p_input->>'evidenceId' AND e.event_key=p_input->>'eventKey') THEN
    PERFORM openerp.fail('IdempotencyConflict','The actual-settlement evidence occurrence already has an event identity.'); END IF;
  SELECT coalesce(max(s.leg_ordinal),0)+1 INTO fx_ordinal
    FROM openerp.commerce_fx_settlements s WHERE s.book_id=p_book AND s.item_id=p_input->>'itemId';
  SELECT jsonb_agg(value ORDER BY ordinal) INTO fx_roles FROM jsonb_array_elements(fx_item->'accountBindings') WITH ORDINALITY x(value,ordinal);
  IF EXISTS(SELECT FROM jsonb_array_elements(fx_roles) role
      WHERE NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=role->>'accountId'
        AND a.active AND a.version::text=role->>'version'))
    OR NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=
      (SELECT value->>'accountId' FROM jsonb_array_elements(fx_roles) WHERE value->>'role'='cash')) THEN
    PERFORM openerp.fail('StaleDependency','The frozen account roles or declared book-currency cash account changed.'); END IF;
  fx_carrying:=(fx_item->>'remainingCarryingMinor')::numeric;
  fx_final:=fx_original=(fx_item->>'remainingOriginalMinor')::numeric;
  fx_n:=fx_carrying*fx_original; fx_d:=(fx_item->>'remainingOriginalMinor')::numeric;
  fx_q:=div(fx_n,fx_d); fx_r:=mod(fx_n,fx_d); fx_rounded:=fx_q+CASE WHEN 2*fx_r>=fx_d THEN 1 ELSE 0 END;
  fx_original_after:=(fx_item->>'remainingOriginalMinor')::numeric-fx_original;
  fx_carrying_after:=fx_carrying-fx_rounded;
  IF fx_rounded<0 OR fx_rounded>=1e38::numeric OR fx_original_after<0 OR fx_carrying_after<0 THEN
    PERFORM openerp.fail('InvalidJournal','The exact partial-settlement allocation is outside the supported capacity bound.'); END IF;
  fx_gain:=fx_consideration-fx_rounded;
  IF abs(fx_gain)>=1e38::numeric THEN
    PERFORM openerp.fail('InvalidJournal','The realized FX result exceeds the supported exact bound.'); END IF;
  RETURN jsonb_build_object('item',fx_item-ARRAY['status','remainingOriginalMinor','remainingCarryingMinor',
      'settlement','correction','partialSettlements','partialCorrections'],
    'sourceEvidence',fx_evidence,
    'calculation',jsonb_build_object('legOrdinal',fx_ordinal,
      'originalRemainingBeforeMinor',fx_item->>'remainingOriginalMinor','originalReleasedMinor',fx_original::text,
      'originalRemainingAfterMinor',fx_original_after::text,'carryingRemainingBeforeMinor',fx_carrying::text,
      'carryingReleasedMinor',fx_rounded::text,'carryingRemainingAfterMinor',fx_carrying_after::text,
      'exactNumerator',fx_n::text,'exactDenominator',fx_d::text,'quotientMinor',fx_q::text,
      'remainderNumerator',fx_r::text,'residualNumerator',(fx_n-fx_rounded*fx_d)::text,
      'residualDenominator',fx_d::text,'roundingPolicy','synthetic_half_up_nonnegative_v1',
      'finalLeg',fx_final,'considerationMinor',fx_consideration::text,'realizedGainMinor',fx_gain::text,
      'formula','N = carryingRemainingBeforeMinor * originalReleasedMinor; D = originalRemainingBeforeMinor; rounded = div(N,D) + (2*mod(N,D) >= D ? 1 : 0); final leg releases the exact remaining carrying amount; realizedGainMinor = considerationMinor - carryingReleasedMinor'),
    'fiscalYearId',fx_year,'profileVersion',fx_book.profile_version::text,'writerEpoch',fx_book.writer_epoch::text,
    'periodVersion',fx_period.version::text,'accountBindings',fx_roles);
END $$;

CREATE FUNCTION openerp.commerce_fx_partial_settlement_checked(p_book text,p_id text,p_input jsonb,p_executing boolean)
RETURNS openerp.commerce_fx_settlement_reviews LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE fx_review openerp.commerce_fx_settlement_reviews;
BEGIN
  PERFORM openerp.commerce_exact_object(p_input,CASE WHEN p_executing THEN ARRAY['version','digest','approvalId'] ELSE ARRAY['version','digest'] END);
  SELECT * INTO STRICT fx_review FROM openerp.commerce_fx_settlement_reviews r WHERE r.book_id=p_book AND r.id=p_id;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'digest' IS DISTINCT FROM fx_review.body->>'digest'
    OR fx_review.body->'input'->>'profile'<>'synthetic_partial_book_currency_settlement_v1' THEN
    PERFORM openerp.fail('StaleDependency','Use the exact saved partial-settlement review digest and version.'); END IF;
  IF openerp.commerce_fx_partial_settlement_selection(p_book,fx_review.body->'input') IS DISTINCT FROM fx_review.body->'snapshot' THEN
    PERFORM openerp.fail('StaleDependency','Item capacity, evidence, account, period, leg or profile dependencies changed. Prepare and approve a new review.'); END IF;
  RETURN fx_review;
END $$;

CREATE FUNCTION openerp.prepare_commerce_fx_partial_settlement(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_body jsonb; fx_book openerp.books;
  fx_id text:=openerp.new_id('fx_partial_settlement_review');
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'prepare_commerce_fx_partial_settlement',p_input);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_body:=jsonb_build_object('id',fx_id,'scope',p_scope,'version',1,'itemId',p_input->>'itemId','input',p_input,
    'snapshot',openerp.commerce_fx_partial_settlement_selection(fx_book.id,p_input))
    ||openerp.commerce_record_metadata(p_key,'prepare_commerce_fx_partial_settlement',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  IF octet_length(fx_body::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The partial-settlement review exceeds 256 KiB.'); END IF;
  INSERT INTO openerp.commerce_fx_settlement_reviews VALUES(fx_book.id,fx_id,p_input->>'itemId',fx_actor,fx_body);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'prepare_commerce_fx_partial_settlement',p_input,fx_body);
END $$;

CREATE FUNCTION openerp.approve_commerce_fx_partial_settlement(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_settlement_reviews; fx_body jsonb;
  fx_id text:=openerp.new_id('fx_partial_settlement_approval'); fx_expires timestamptz:=clock_timestamp()+interval '1 hour';
  fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(p_scope->>'bookId',p_key,fx_actor,'approve_commerce_fx_partial_settlement',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_partial_settlement_checked(p_scope->>'bookId',p_id,p_input,false);
  IF fx_actor=fx_review.actor_id THEN PERFORM openerp.fail('ApprovalRequired','An independent current operator must approve partial settlement.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=fx_review.book_id AND s.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Partial settlement already executed. Recover its receipt.'); END IF;
  fx_body:=jsonb_build_object('id',fx_id,'scope',p_scope,'kind','partial_settlement','reviewId',p_id,
    'reviewDigest',fx_review.body->>'digest','actorId',fx_actor,
    'expiresAt',to_char(fx_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'approve_commerce_fx_partial_settlement',fx_actor);
  INSERT INTO openerp.commerce_fx_settlement_approvals VALUES(p_scope->>'bookId',fx_id,p_id,fx_actor,fx_review.body->>'digest',fx_expires,fx_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,fx_actor,'approve_commerce_fx_partial_settlement',fx_payload,fx_body);
END $$;

CREATE FUNCTION openerp.execute_commerce_fx_partial_settlement(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_settlement_reviews;
  fx_approval openerp.commerce_fx_settlement_approvals; fx_book openerp.books; fx_event text;
  fx_cash_line text:=openerp.new_id('line'); fx_control_line text; fx_realized_line text;
  fx_action jsonb; fx_lines jsonb; fx_posting jsonb; fx_body jsonb; fx_calculation jsonb; fx_roles jsonb;
  fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'execute_commerce_fx_partial_settlement',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_partial_settlement_checked(fx_book.id,p_id,p_input,true);
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=fx_book.id AND s.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Partial settlement already executed. Recover the original command.'); END IF;
  SELECT * INTO STRICT fx_approval FROM openerp.commerce_fx_settlement_approvals a
    WHERE a.book_id=fx_book.id AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR fx_approval.digest IS DISTINCT FROM fx_review.body->>'digest' OR fx_approval.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=fx_book.id AND m.actor_id=fx_approval.actor_id AND m.role='operator') THEN
    PERFORM openerp.fail('ApprovalRequired','A current unused independent operator approval of this exact partial settlement is required.'); END IF;
  SELECT e.id INTO fx_event FROM openerp.events e WHERE e.book_id=fx_book.id
    AND e.evidence_id=fx_review.body->'snapshot'->'sourceEvidence'->>'evidenceId' AND e.event_key=fx_review.body->'input'->>'eventKey';
  IF NOT FOUND THEN
    fx_event:=openerp.new_id('event');
    INSERT INTO openerp.events VALUES(fx_book.id,fx_event,fx_review.body->'snapshot'->'sourceEvidence'->>'evidenceId',fx_review.body->'input'->>'eventKey');
  END IF;
  fx_calculation:=fx_review.body->'snapshot'->'calculation'; fx_roles:=fx_review.body->'snapshot'->'accountBindings';
  IF (fx_calculation->>'carryingReleasedMinor')::numeric>0 THEN fx_control_line:=openerp.new_id('line'); END IF;
  fx_lines:=jsonb_build_array(jsonb_build_object('lineId',fx_cash_line,'accountId',fx_roles->2->>'accountId',
    'debitMinor',fx_calculation->>'considerationMinor','creditMinor','0','description','Book-currency customer cash settlement'));
  IF fx_control_line IS NOT NULL THEN
    fx_lines:=fx_lines||jsonb_build_array(jsonb_build_object('lineId',fx_control_line,'accountId',fx_roles->0->>'accountId',
      'debitMinor','0','creditMinor',fx_calculation->>'carryingReleasedMinor','description','Foreign customer receivable partial carrying release'));
  END IF;
  IF (fx_calculation->>'realizedGainMinor')::numeric>0 THEN
    fx_realized_line:=openerp.new_id('line');
    fx_lines:=fx_lines||jsonb_build_array(jsonb_build_object('lineId',fx_realized_line,'accountId',fx_roles->3->>'accountId',
      'debitMinor','0','creditMinor',fx_calculation->>'realizedGainMinor','description','Realized foreign-currency partial-settlement gain'));
  ELSIF (fx_calculation->>'realizedGainMinor')::numeric<0 THEN
    fx_realized_line:=openerp.new_id('line');
    fx_lines:=fx_lines||jsonb_build_array(jsonb_build_object('lineId',fx_realized_line,'accountId',fx_roles->4->>'accountId',
      'debitMinor',abs((fx_calculation->>'realizedGainMinor')::numeric)::text,'creditMinor','0','description','Realized foreign-currency partial-settlement loss'));
  END IF;
  fx_action:=jsonb_build_object('kind','post_voucher','correctsVoucherId',NULL,'eventId',fx_event,
    'postingPurpose','adjustment','occurrenceKey','commerce_fx_partial_settlement_'||p_id,
    'fiscalYearId',fx_review.body->'snapshot'->>'fiscalYearId','accountingPeriodId',fx_review.body->'input'->>'accountingPeriodId',
    'postingDate',fx_review.body->'input'->>'settlementDate','series',fx_review.body->'input'->>'series','currency',fx_book.currency,
    'description','Synthetic partial book-currency foreign-customer settlement','rationale',fx_review.body->'input'->>'reason',
    'taxAssessment','not_applicable','lines',fx_lines,
    'evidenceRefs',jsonb_build_array(fx_review.body->'snapshot'->'sourceEvidence'||jsonb_build_object('locator',fx_review.body->'input'->>'eventKey')),
    'foreignCurrency',jsonb_build_object('kind','partial_settlement_v1','itemId',fx_review.item_id,
      'reviewId',p_id,'reviewDigest',fx_review.body->>'digest','settlementDigest',openerp.digest(fx_calculation),
      'legOrdinal',fx_calculation->>'legOrdinal'));
  fx_posting:=openerp.commerce_fx_post(p_scope,fx_action,fx_approval.id,fx_approval.actor_id,fx_approval.expires_at);
  fx_body:=jsonb_build_object('id',openerp.new_id('fx_partial_settlement'),'scope',p_scope,'itemId',fx_review.item_id,
    'profile','synthetic_partial_book_currency_settlement_v1','legOrdinal',(fx_calculation->>'legOrdinal')::integer,
    'reviewId',p_id,'reviewDigest',fx_review.body->>'digest','approvalId',fx_approval.id,
    'calculation',fx_calculation,'postingReceipt',fx_posting,
    'committedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'execute_commerce_fx_partial_settlement',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  INSERT INTO openerp.commerce_fx_settlements(book_id,id,item_id,review_id,approval_id,posting_receipt_id,event_id,
    voucher_id,cash_line_id,control_line_id,realized_line_id,original_released_minor,carrying_released_minor,
    consideration_minor,realized_gain_minor,body,profile,leg_ordinal,final_leg,original_remaining_before_minor,
    original_remaining_after_minor,carrying_remaining_before_minor,carrying_remaining_after_minor)
    VALUES(fx_book.id,fx_body->>'id',fx_review.item_id,p_id,fx_approval.id,fx_posting->>'id',fx_event,
      fx_posting->>'voucherId',fx_cash_line,fx_control_line,fx_realized_line,
      (fx_calculation->>'originalReleasedMinor')::numeric,(fx_calculation->>'carryingReleasedMinor')::numeric,
      (fx_calculation->>'considerationMinor')::numeric,(fx_calculation->>'realizedGainMinor')::numeric,fx_body,
      'synthetic_partial_book_currency_settlement_v1',(fx_calculation->>'legOrdinal')::integer,
      (fx_calculation->>'finalLeg')::boolean,(fx_calculation->>'originalRemainingBeforeMinor')::numeric,
      (fx_calculation->>'originalRemainingAfterMinor')::numeric,(fx_calculation->>'carryingRemainingBeforeMinor')::numeric,
      (fx_calculation->>'carryingRemainingAfterMinor')::numeric);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'execute_commerce_fx_partial_settlement',fx_payload,fx_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_fx_correction_selection(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_book openerp.books; fx_settlement openerp.commerce_fx_settlements; fx_item jsonb; fx_voucher openerp.vouchers;
  fx_period openerp.periods; fx_year text; fx_evidence jsonb; fx_lines jsonb; fx_roles jsonb; fx_date date;
  fx_resource jsonb; fx_blocker text;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','settlementId','accountingPeriodId','postingDate',
    'evidenceId','reason','latestUnconsumedOnly','acknowledgeLimitedProfile']);
  IF p_input->>'profile'<>'synthetic_latest_settlement_correction_v1' OR p_input->'latestUnconsumedOnly'<>'true'::jsonb
    OR p_input->'acknowledgeLimitedProfile'<>'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Select the explicit latest-unconsumed settlement correction profile.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_book;
  SELECT * INTO STRICT fx_settlement FROM openerp.commerce_fx_settlements s WHERE s.book_id=p_book AND s.id=p_input->>'settlementId';
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=p_book AND c.settlement_id=fx_settlement.id) THEN
    PERFORM openerp.fail('AlreadyPosted','The selected settlement is already consumed by an owned correction.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlements s
      WHERE s.book_id=p_book AND s.item_id=fx_settlement.item_id AND s.leg_ordinal>fx_settlement.leg_ordinal
      AND NOT EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c
        WHERE c.book_id=s.book_id AND c.settlement_id=s.id)) THEN
    PERFORM openerp.fail('UnsupportedProfile','Only the latest unconsumed settlement leg can use this correction profile.'); END IF;
  SELECT * INTO STRICT fx_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=fx_settlement.voucher_id;
  IF NOT openerp.commerce_voucher_current(p_book,fx_voucher.id) THEN
    PERFORM openerp.fail('StaleDependency','The settlement voucher is already corrected outside this owner.'); END IF;
  FOR fx_resource IN SELECT value FROM jsonb_array_elements(openerp.correction_impact_resources(p_book,fx_voucher.id,NULL)) LOOP
    IF fx_resource->>'blocks'='true' THEN fx_blocker:=fx_resource->>'detail'; END IF;
  END LOOP;
  IF fx_blocker IS NOT NULL THEN PERFORM openerp.fail('UnsupportedProfile',fx_blocker); END IF;
  fx_item:=openerp.commerce_fx_item_body(p_book,fx_settlement.item_id);
  IF fx_settlement.profile='synthetic_full_book_currency_settlement_v1' AND
    (fx_item->>'status'<>'settled' OR fx_item->>'remainingOriginalMinor'<>'0' OR fx_item->>'remainingCarryingMinor'<>'0') THEN
    PERFORM openerp.fail('StaleDependency','Correction requires the settled zero-residual full-settlement owner state.'); END IF;
  IF fx_settlement.profile='synthetic_partial_book_currency_settlement_v1' AND
    fx_item->>'status' NOT IN('settled','partially_settled') THEN
    PERFORM openerp.fail('StaleDependency','Correction requires the selected partial leg to remain active in the current owner state.'); END IF;
  fx_date:=openerp.bank_date(p_input->>'postingDate');
  IF fx_date<fx_voucher.posting_date THEN PERFORM openerp.fail('InvalidJournal','Correction cannot precede the settlement posting.'); END IF;
  SELECT * INTO STRICT fx_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_input->>'accountingPeriodId';
  SELECT p.fiscal_year_id INTO STRICT fx_year FROM openerp.periods p WHERE p.book_id=p_book AND p.id=fx_period.id;
  IF fx_period.locked OR fx_date NOT BETWEEN fx_period.starts_on AND fx_period.ends_on
    OR NOT EXISTS(SELECT FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=fx_year
      AND fx_date BETWEEN y.starts_on AND y.ends_on) THEN
    PERFORM openerp.fail('PeriodLocked','Correction requires an open period and matching fiscal year on the explicit date.'); END IF;
  fx_evidence:=openerp.commerce_evidence(p_book,p_input->>'evidenceId');
  SELECT jsonb_agg(value ORDER BY ordinal) INTO fx_roles FROM jsonb_array_elements(fx_item->'accountBindings') WITH ORDINALITY x(value,ordinal);
  IF EXISTS(SELECT FROM jsonb_array_elements(fx_roles) role
      WHERE NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=role->>'accountId'
        AND a.active AND a.version::text=role->>'version')) THEN
    PERFORM openerp.fail('StaleDependency','An account used by the frozen settlement role profile changed.'); END IF;
  SELECT jsonb_agg(value||jsonb_build_object('lineId',openerp.new_id('line'),'debitMinor',value->>'creditMinor',
    'creditMinor',value->>'debitMinor') ORDER BY ordinal) INTO fx_lines
    FROM jsonb_array_elements(fx_voucher.action->'lines') WITH ORDINALITY l(value,ordinal);
  RETURN jsonb_build_object('item',fx_item,'settlement',fx_settlement.body,'voucher',openerp.voucher_body(fx_voucher),
    'sourceEvidence',fx_evidence,'reversalLines',fx_lines,'fiscalYearId',fx_year,
    'profileVersion',fx_book.profile_version::text,'writerEpoch',fx_book.writer_epoch::text,
    'periodVersion',fx_period.version::text,'accountBindings',fx_roles);
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_fx_correction_checked(p_book text,p_id text,p_input jsonb,p_executing boolean)
RETURNS openerp.commerce_fx_settlement_correction_reviews LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE fx_review openerp.commerce_fx_settlement_correction_reviews; fx_current jsonb;
  fx_saved_lines jsonb; fx_current_lines jsonb;
BEGIN
  PERFORM openerp.commerce_exact_object(p_input,CASE WHEN p_executing THEN ARRAY['version','digest','approvalId'] ELSE ARRAY['version','digest'] END);
  SELECT * INTO STRICT fx_review FROM openerp.commerce_fx_settlement_correction_reviews r WHERE r.book_id=p_book AND r.id=p_id;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'digest' IS DISTINCT FROM fx_review.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Use the exact saved correction review digest and version.'); END IF;
  fx_current:=openerp.commerce_fx_correction_selection(p_book,fx_review.body->'input');
  SELECT jsonb_agg((value-'lineId') ORDER BY ordinal) INTO fx_saved_lines
    FROM jsonb_array_elements(fx_review.body->'snapshot'->'reversalLines') WITH ORDINALITY x(value,ordinal);
  SELECT jsonb_agg((value-'lineId') ORDER BY ordinal) INTO fx_current_lines
    FROM jsonb_array_elements(fx_current->'reversalLines') WITH ORDINALITY x(value,ordinal);
  IF (fx_current-'reversalLines') IS DISTINCT FROM (fx_review.body->'snapshot'-'reversalLines')
    OR fx_saved_lines IS DISTINCT FROM fx_current_lines THEN
    PERFORM openerp.fail('StaleDependency','Settlement, dependencies, evidence or downstream blockers changed. Prepare and approve a new correction.'); END IF;
  RETURN fx_review;
END $$;

CREATE OR REPLACE FUNCTION openerp.execute_commerce_fx_settlement_correction(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_settlement_correction_reviews;
  fx_approval openerp.commerce_fx_settlement_correction_approvals; fx_book openerp.books; fx_settlement openerp.commerce_fx_settlements;
  fx_action jsonb; fx_posting jsonb; fx_body jsonb; fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input); fx_profile jsonb;
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'execute_commerce_fx_settlement_correction',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_correction_checked(fx_book.id,p_id,p_input,true);
  SELECT * INTO STRICT fx_settlement FROM openerp.commerce_fx_settlements s WHERE s.book_id=fx_book.id AND s.id=fx_review.settlement_id;
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=fx_book.id AND c.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Correction already executed. Recover the original command.'); END IF;
  SELECT * INTO STRICT fx_approval FROM openerp.commerce_fx_settlement_correction_approvals a
    WHERE a.book_id=fx_book.id AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR fx_approval.digest IS DISTINCT FROM fx_review.body->>'digest' OR fx_approval.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=fx_book.id AND m.actor_id=fx_approval.actor_id AND m.role='operator') THEN
    PERFORM openerp.fail('ApprovalRequired','A current unused independent operator approval of this exact correction is required.'); END IF;
  fx_action:=jsonb_build_object('kind','post_voucher','correctsVoucherId',fx_settlement.voucher_id,
    'eventId',fx_review.body->'snapshot'->'voucher'->'action'->>'eventId','postingPurpose','reversal',
    'occurrenceKey',fx_settlement.id,'fiscalYearId',fx_review.body->'snapshot'->>'fiscalYearId',
    'accountingPeriodId',fx_review.body->'input'->>'accountingPeriodId','postingDate',fx_review.body->'input'->'postingDate',
    'series',fx_review.body->'snapshot'->'voucher'->'action'->>'series','currency',fx_book.currency,
    'description','Correction: synthetic foreign-customer settlement','rationale',fx_review.body->'input'->>'reason',
    'taxAssessment','not_applicable','lines',fx_review.body->'snapshot'->'reversalLines',
    'evidenceRefs',jsonb_build_array(
      fx_review.body->'snapshot'->'voucher'->'action'->'evidenceRefs'->0,
      fx_review.body->'snapshot'->'sourceEvidence'||jsonb_build_object('locator','correction')),
    'foreignCurrency',jsonb_build_object('kind','settlement_correction_v1','itemId',fx_settlement.item_id,
      'settlementId',fx_settlement.id,'settlementDigest',fx_settlement.body->>'digest','reviewId',p_id,
      'reviewDigest',fx_review.body->>'digest','correctionEvidence',fx_review.body->'snapshot'->'sourceEvidence'));
  fx_posting:=openerp.commerce_fx_post(p_scope,fx_action,fx_approval.id,fx_approval.actor_id,fx_approval.expires_at);
  fx_profile:=CASE WHEN fx_settlement.profile='synthetic_partial_book_currency_settlement_v1'
    THEN jsonb_build_object('settlementProfile',fx_settlement.profile,'legOrdinal',fx_settlement.leg_ordinal)
    ELSE '{}'::jsonb END;
  fx_body:=jsonb_build_object('id',openerp.new_id('fx_settlement_correction'),'scope',p_scope,'itemId',fx_settlement.item_id,
    'settlementId',fx_settlement.id,'settlementDigest',fx_settlement.body->>'digest','reviewId',p_id,
    'reviewDigest',fx_review.body->>'digest','approvalId',fx_approval.id,'originalVoucherId',fx_settlement.voucher_id,
    'postingReceipt',fx_posting,'restoredOriginalMinor',fx_settlement.original_released_minor::text,
    'restoredCarryingMinor',fx_settlement.carrying_released_minor::text,'reason',fx_review.body->'input'->>'reason',
    'committedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))||fx_profile
    ||openerp.commerce_record_metadata(p_key,'execute_commerce_fx_settlement_correction',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  INSERT INTO openerp.commerce_fx_settlement_corrections(book_id,id,item_id,settlement_id,review_id,approval_id,
    posting_receipt_id,original_voucher_id,body)
    VALUES(fx_book.id,fx_body->>'id',fx_settlement.item_id,fx_settlement.id,p_id,fx_approval.id,fx_posting->>'id',
      fx_settlement.voucher_id,fx_body);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'execute_commerce_fx_settlement_correction',fx_payload,fx_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_fx_guard_owned_posting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_meta jsonb:=NEW.action->'foreignCurrency'; fx_plan jsonb; fx_actor text; fx_review jsonb; fx_approval jsonb;
BEGIN
  IF fx_meta IS NOT NULL THEN
    SELECT c.plan,a.actor_id INTO fx_plan,fx_actor FROM openerp.change_sets c JOIN openerp.approvals a
      ON a.book_id=c.book_id AND a.change_set_id=c.id WHERE c.book_id=NEW.book_id AND c.id=NEW.change_set_id
      AND a.digest=c.digest AND a.consumed_at IS NOT NULL;
    IF fx_plan IS NULL OR fx_plan->'groups'->0->'actions'->0 IS DISTINCT FROM NEW.action THEN
      PERFORM openerp.fail('ApprovalRequired','Commerce FX postings require the exact approved kernel action.'); END IF;
    IF fx_meta->>'kind'='recognition_v1' THEN
      SELECT r.body,a.body INTO fx_review,fx_approval FROM openerp.commerce_fx_recognition_reviews r
        JOIN openerp.commerce_fx_recognition_approvals a ON a.book_id=r.book_id AND a.review_id=r.id
        WHERE r.book_id=NEW.book_id AND r.id=fx_meta->>'reviewId' AND a.actor_id=fx_actor AND a.digest=fx_meta->>'reviewDigest';
      IF fx_review IS NULL OR fx_review->>'digest' IS DISTINCT FROM fx_meta->>'reviewDigest'
        OR fx_review->>'itemId' IS DISTINCT FROM fx_meta->>'itemId' OR fx_approval IS NULL
        OR EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.review_id=fx_meta->>'reviewId') THEN
        PERFORM openerp.fail('ApprovalRequired','Recognition is not bound to one current unused custom approval.'); END IF;
    ELSIF fx_meta->>'kind' IN('settlement_v1','partial_settlement_v1') THEN
      SELECT r.body,a.body INTO fx_review,fx_approval FROM openerp.commerce_fx_settlement_reviews r
        JOIN openerp.commerce_fx_settlement_approvals a ON a.book_id=r.book_id AND a.review_id=r.id
        WHERE r.book_id=NEW.book_id AND r.id=fx_meta->>'reviewId' AND a.actor_id=fx_actor AND a.digest=fx_meta->>'reviewDigest';
      IF fx_review IS NULL OR fx_review->>'digest' IS DISTINCT FROM fx_meta->>'reviewDigest'
        OR fx_review->>'itemId' IS DISTINCT FROM fx_meta->>'itemId' OR fx_approval IS NULL
        OR fx_meta->>'settlementDigest' IS DISTINCT FROM openerp.digest(fx_review.body->'snapshot'->'calculation')
        OR (fx_meta->>'kind'='partial_settlement_v1' AND
          (fx_review.body->'input'->>'profile'<>'synthetic_partial_book_currency_settlement_v1'
          OR fx_meta->>'legOrdinal' IS DISTINCT FROM fx_review.body->'snapshot'->'calculation'->>'legOrdinal'))
        OR NOT EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.id=fx_meta->>'itemId')
        OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.review_id=fx_meta->>'reviewId') THEN
        PERFORM openerp.fail('ApprovalRequired','Settlement is not bound to one current unused custom approval.'); END IF;
    ELSIF fx_meta->>'kind'='settlement_correction_v1' THEN
      SELECT r.body,a.body INTO fx_review,fx_approval FROM openerp.commerce_fx_settlement_correction_reviews r
        JOIN openerp.commerce_fx_settlement_correction_approvals a ON a.book_id=r.book_id AND a.review_id=r.id
        WHERE r.book_id=NEW.book_id AND r.id=fx_meta->>'reviewId' AND a.actor_id=fx_actor AND a.digest=fx_meta->>'reviewDigest';
      IF fx_review IS NULL OR fx_review->>'digest' IS DISTINCT FROM fx_meta->>'reviewDigest'
        OR fx_review->>'settlementId' IS DISTINCT FROM fx_meta->>'settlementId' OR fx_approval IS NULL
        OR NOT EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.id=fx_meta->>'settlementId'
          AND s.voucher_id=NEW.corrects_voucher_id AND s.body->>'digest'=fx_meta->>'settlementDigest')
        OR EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=NEW.book_id AND c.review_id=fx_meta->>'reviewId') THEN
        PERFORM openerp.fail('ApprovalRequired','Correction is not bound to one current unused custom approval and settlement digest.'); END IF;
    ELSE
      PERFORM openerp.fail('ApprovalRequired','Unsupported commerce FX posting ownership metadata.'); END IF;
  ELSIF EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.event_id=NEW.event_id)
    OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s JOIN openerp.vouchers v ON v.book_id=s.book_id AND v.id=s.voucher_id
      WHERE s.book_id=NEW.book_id AND v.event_id=NEW.event_id)
    OR (NEW.corrects_voucher_id IS NOT NULL AND (
      EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.voucher_id=NEW.corrects_voucher_id)
      OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.voucher_id=NEW.corrects_voucher_id)
      OR EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c JOIN openerp.execution_receipts x
        ON x.book_id=c.book_id AND x.id=c.posting_receipt_id
        WHERE c.book_id=NEW.book_id AND x.voucher_id=NEW.corrects_voucher_id))) THEN
    PERFORM openerp.fail('ApprovalRequired','FX recognition, settlement and correction vouchers require their commerce FX owner workflow.'); END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION openerp.commerce_fx_settlement_effect_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_item openerp.commerce_fx_items; fx_review jsonb; fx_action jsonb; fx_receipt_id text;
  fx_ordinal integer; fx_consumed_original numeric; fx_consumed_carrying numeric; fx_before_original numeric;
  fx_before_carrying numeric; fx_n numeric; fx_d numeric; fx_q numeric; fx_r numeric; fx_b numeric;
BEGIN
  SELECT * INTO STRICT fx_item FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.id=NEW.item_id;
  SELECT r.body,v.action,x.id INTO fx_review,fx_action,fx_receipt_id
    FROM openerp.commerce_fx_settlement_reviews r
    JOIN openerp.commerce_fx_settlement_approvals a ON a.book_id=r.book_id AND a.review_id=r.id AND a.id=NEW.approval_id
    JOIN openerp.vouchers v ON v.book_id=r.book_id AND v.id=NEW.voucher_id
    JOIN openerp.execution_receipts x ON x.book_id=r.book_id AND x.id=NEW.posting_receipt_id AND x.voucher_id=v.id
    WHERE r.book_id=NEW.book_id AND r.id=NEW.review_id AND r.item_id=NEW.item_id
      AND a.digest=r.body->>'digest' AND x.approval_id=a.id AND v.event_id=NEW.event_id;
  IF fx_review IS NULL OR fx_receipt_id IS DISTINCT FROM NEW.posting_receipt_id
    OR fx_action->'foreignCurrency'->>'itemId' IS DISTINCT FROM NEW.item_id
    OR fx_action->'foreignCurrency'->>'reviewId' IS DISTINCT FROM NEW.review_id
    OR fx_action->'foreignCurrency'->>'reviewDigest' IS DISTINCT FROM fx_review->>'digest'
    OR fx_action->'foreignCurrency'->>'settlementDigest' IS DISTINCT FROM openerp.digest(fx_review->'snapshot'->'calculation')
    OR fx_action->'foreignCurrency'->>'kind' IS DISTINCT FROM
      CASE WHEN NEW.profile='synthetic_partial_book_currency_settlement_v1' THEN 'partial_settlement_v1' ELSE 'settlement_v1' END
    OR (NEW.profile='synthetic_partial_book_currency_settlement_v1' AND
      (fx_review->'input'->>'profile'<>'synthetic_partial_book_currency_settlement_v1'
      OR fx_action->'foreignCurrency'->>'legOrdinal' IS DISTINCT FROM NEW.leg_ordinal::text))
    OR NOT EXISTS(SELECT FROM openerp.journal_lines l WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id
      AND l.id=NEW.cash_line_id AND l.debit_minor=NEW.consideration_minor AND l.credit_minor=0)
    OR (NEW.carrying_released_minor>0 AND NOT EXISTS(SELECT FROM openerp.journal_lines l
      WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.id=NEW.control_line_id
      AND l.debit_minor=0 AND l.credit_minor=NEW.carrying_released_minor))
    OR (NEW.realized_gain_minor>0 AND NOT EXISTS(SELECT FROM openerp.journal_lines l
      WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.id=NEW.realized_line_id
      AND l.debit_minor=0 AND l.credit_minor=NEW.realized_gain_minor))
    OR (NEW.realized_gain_minor<0 AND NOT EXISTS(SELECT FROM openerp.journal_lines l
      WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.id=NEW.realized_line_id
      AND l.debit_minor=abs(NEW.realized_gain_minor) AND l.credit_minor=0)) THEN
    PERFORM openerp.fail('ApprovalRequired','Settlement effect, journal, receipt and approval ownership do not agree.'); END IF;
  IF NEW.profile='synthetic_full_book_currency_settlement_v1' THEN RETURN NEW; END IF;
  SELECT coalesce(max(s.leg_ordinal),0)+1 INTO fx_ordinal
    FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.item_id=NEW.item_id;
  SELECT coalesce(sum(s.original_released_minor) FILTER(WHERE c.id IS NULL),0),
    coalesce(sum(s.carrying_released_minor) FILTER(WHERE c.id IS NULL),0)
    INTO fx_consumed_original,fx_consumed_carrying
    FROM openerp.commerce_fx_settlements s
    LEFT JOIN openerp.commerce_fx_settlement_corrections c ON c.book_id=s.book_id AND c.settlement_id=s.id
    WHERE s.book_id=NEW.book_id AND s.item_id=NEW.item_id AND s.leg_ordinal<NEW.leg_ordinal;
  fx_before_original:=fx_item.original_minor-fx_consumed_original;
  fx_before_carrying:=fx_item.carrying_minor-fx_consumed_carrying;
  IF NEW.leg_ordinal IS DISTINCT FROM fx_ordinal OR fx_before_original<=0 OR fx_before_carrying<0
    OR NEW.original_remaining_before_minor IS DISTINCT FROM fx_before_original
    OR NEW.carrying_remaining_before_minor IS DISTINCT FROM fx_before_carrying THEN
    PERFORM openerp.fail('StaleDependency','Partial settlement does not consume the latest exact paired capacity.'); END IF;
  fx_n:=fx_before_carrying*NEW.original_released_minor; fx_d:=fx_before_original;
  fx_q:=div(fx_n,fx_d); fx_r:=mod(fx_n,fx_d); fx_b:=fx_q+CASE WHEN 2*fx_r>=fx_d THEN 1 ELSE 0 END;
  IF NEW.carrying_released_minor IS DISTINCT FROM fx_b
    OR NEW.original_remaining_after_minor IS DISTINCT FROM fx_before_original-NEW.original_released_minor
    OR NEW.carrying_remaining_after_minor IS DISTINCT FROM fx_before_carrying-fx_b THEN
    PERFORM openerp.fail('StaleDependency','Partial settlement carrying release or residual is not the exact paired half-up result.'); END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER commerce_fx_settlement_effect_complete AFTER INSERT ON openerp.commerce_fx_settlements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_settlement_effect_guard();

CREATE FUNCTION openerp.commerce_fx_voucher_effect_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_meta jsonb:=NEW.action->'foreignCurrency';
BEGIN
  IF fx_meta->>'kind'='recognition_v1' AND NOT EXISTS(
    SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.review_id=fx_meta->>'reviewId'
      AND i.voucher_id=NEW.id AND i.event_id=NEW.event_id
      AND i.posting_receipt_id IN(SELECT x.id FROM openerp.execution_receipts x WHERE x.book_id=NEW.book_id AND x.voucher_id=NEW.id))
  THEN PERFORM openerp.fail('ApprovalRequired','FX recognition voucher requires its complete owned item and receipt.'); END IF;
  IF fx_meta->>'kind' IN('settlement_v1','partial_settlement_v1') AND NOT EXISTS(
    SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.review_id=fx_meta->>'reviewId'
      AND s.voucher_id=NEW.id AND s.event_id=NEW.event_id
      AND s.posting_receipt_id IN(SELECT x.id FROM openerp.execution_receipts x WHERE x.book_id=NEW.book_id AND x.voucher_id=NEW.id))
  THEN PERFORM openerp.fail('ApprovalRequired','FX settlement voucher requires its complete owned leg and receipt.'); END IF;
  IF fx_meta->>'kind'='settlement_correction_v1' AND NOT EXISTS(
    SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=NEW.book_id AND c.review_id=fx_meta->>'reviewId'
      AND c.item_id=fx_meta->>'itemId' AND c.settlement_id=fx_meta->>'settlementId'
      AND c.posting_receipt_id IN(SELECT x.id FROM openerp.execution_receipts x WHERE x.book_id=NEW.book_id AND x.voucher_id=NEW.id))
  THEN PERFORM openerp.fail('ApprovalRequired','FX correction voucher requires its complete owned correction and receipt.'); END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER commerce_fx_voucher_effect_complete AFTER INSERT ON openerp.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_voucher_effect_guard();

CREATE FUNCTION openerp.commerce_fx_correction_effect_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_review jsonb; fx_action jsonb; fx_receipt_id text; fx_settlement_id text; fx_settlement_voucher text;
  fx_settlement_original numeric; fx_settlement_carrying numeric; fx_settlement_digest text;
BEGIN
  SELECT r.body,v.action,x.id,s.id,s.voucher_id,s.original_released_minor,s.carrying_released_minor,s.body->>'digest'
    INTO fx_review,fx_action,fx_receipt_id,fx_settlement_id,fx_settlement_voucher,fx_settlement_original,
      fx_settlement_carrying,fx_settlement_digest
    FROM openerp.commerce_fx_settlement_correction_reviews r
    JOIN openerp.commerce_fx_settlements s ON s.book_id=r.book_id AND s.id=r.settlement_id
    JOIN openerp.commerce_fx_settlement_correction_approvals a ON a.book_id=r.book_id AND a.review_id=r.id AND a.id=NEW.approval_id
    JOIN openerp.execution_receipts x ON x.book_id=r.book_id AND x.id=NEW.posting_receipt_id
    JOIN openerp.vouchers v ON v.book_id=r.book_id AND v.id=x.voucher_id AND v.corrects_voucher_id=NEW.original_voucher_id
    WHERE r.book_id=NEW.book_id AND r.id=NEW.review_id AND r.settlement_id=NEW.settlement_id
      AND s.item_id=NEW.item_id AND a.digest=r.body->>'digest' AND x.approval_id=a.id;
  IF fx_review IS NULL OR fx_receipt_id IS DISTINCT FROM NEW.posting_receipt_id
    OR fx_settlement_voucher IS DISTINCT FROM NEW.original_voucher_id
    OR NEW.body->>'settlementDigest' IS DISTINCT FROM fx_settlement_digest
    OR NEW.body->>'restoredOriginalMinor' IS DISTINCT FROM fx_settlement_original::text
    OR NEW.body->>'restoredCarryingMinor' IS DISTINCT FROM fx_settlement_carrying::text
    OR fx_action->'foreignCurrency'->>'kind' IS DISTINCT FROM 'settlement_correction_v1'
    OR fx_action->'foreignCurrency'->>'itemId' IS DISTINCT FROM NEW.item_id
    OR fx_action->'foreignCurrency'->>'settlementId' IS DISTINCT FROM NEW.settlement_id
    OR fx_action->'foreignCurrency'->>'settlementDigest' IS DISTINCT FROM NEW.body->>'settlementDigest'
    OR fx_action->'foreignCurrency'->>'reviewId' IS DISTINCT FROM NEW.review_id
    OR fx_action->'foreignCurrency'->>'reviewDigest' IS DISTINCT FROM fx_review->>'digest' THEN
    PERFORM openerp.fail('ApprovalRequired','FX correction effect, journal, receipt and approval ownership do not agree.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.item_id=NEW.item_id
      AND s.leg_ordinal>(SELECT leg_ordinal FROM openerp.commerce_fx_settlements WHERE book_id=NEW.book_id AND id=NEW.settlement_id)
      AND NOT EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c
        WHERE c.book_id=s.book_id AND c.settlement_id=s.id)) THEN
    PERFORM openerp.fail('UnsupportedProfile','Only the latest unconsumed settlement leg can be consumed by this correction.'); END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER commerce_fx_correction_effect_complete AFTER INSERT ON openerp.commerce_fx_settlement_corrections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_correction_effect_guard();

CREATE OR REPLACE FUNCTION openerp.recover_commerce_fx_command(p_token text,p_scope jsonb,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_receipt openerp.command_receipts;
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN PERFORM openerp.fail('InvalidJournal','Supply the original commerce FX command key.'); END IF;
  SELECT * INTO fx_receipt FROM openerp.command_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.key=p_key
    AND r.actor_id=fx_actor AND r.operation IN('prepare_commerce_fx_recognition','approve_commerce_fx_recognition',
      'execute_commerce_fx_recognition','prepare_commerce_fx_settlement','approve_commerce_fx_settlement',
      'execute_commerce_fx_settlement','prepare_commerce_fx_partial_settlement',
      'approve_commerce_fx_partial_settlement','execute_commerce_fx_partial_settlement',
      'prepare_commerce_fx_settlement_correction','approve_commerce_fx_settlement_correction',
      'execute_commerce_fx_settlement_correction');
  RETURN jsonb_build_object('key',p_key,'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'status',CASE WHEN fx_receipt.key IS NULL THEN 'not_recorded_at_check' ELSE 'recorded' END,
    'operation',fx_receipt.operation,'result',fx_receipt.result);
END $$;

REVOKE ALL ON FUNCTION openerp.commerce_fx_partial_settlement_selection(text,jsonb),
  openerp.commerce_fx_partial_settlement_checked(text,text,jsonb,boolean),
  openerp.commerce_fx_settlement_effect_guard(),openerp.commerce_fx_voucher_effect_guard(),
  openerp.commerce_fx_correction_effect_guard(),
  openerp.prepare_commerce_fx_partial_settlement(text,jsonb,text,jsonb),
  openerp.approve_commerce_fx_partial_settlement(text,jsonb,text,text,jsonb),
  openerp.execute_commerce_fx_partial_settlement(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_commerce_fx_partial_settlement(text,jsonb,text,jsonb),
  openerp.approve_commerce_fx_partial_settlement(text,jsonb,text,text,jsonb),
  openerp.execute_commerce_fx_partial_settlement(text,jsonb,text,text,jsonb) TO openerp_runtime;
