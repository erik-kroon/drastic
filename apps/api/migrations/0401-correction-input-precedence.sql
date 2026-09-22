-- Parenthesize JSON extraction before subtraction in the nested input guard.
CREATE OR REPLACE FUNCTION openerp.prepare_correction_bundle(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE cb_actor text; cb_previous jsonb; cb_original openerp.vouchers; cb_reversal jsonb;
  cb_replacement jsonb; cb_action jsonb; cb_lines jsonb; cb_event text; cb_year text;
  cb_id text := openerp.new_id('correction'); cb_body jsonb; cb_digest text;
  cb_payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  cb_actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books b WHERE b.id = scope->>'bookId' FOR UPDATE;
  cb_previous := openerp.replay(scope->>'bookId', key, cb_actor, 'prepare_correction_bundle', cb_payload);
  IF cb_previous IS NOT NULL THEN RETURN cb_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object'
    OR input - ARRAY['datePolicy','accountingPeriodId','postingDate','rationale','replacement'] <> '{}'::jsonb
    OR input->>'datePolicy' IS DISTINCT FROM 'explicit_open_period'
    OR coalesce(length(btrim(input->>'rationale')), 0) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(input->'replacement') IS DISTINCT FROM 'object'
    OR (input->'replacement') - ARRAY['description','lines'] <> '{}'::jsonb
    OR coalesce(length(btrim(input->'replacement'->>'description')), 0) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(input->'replacement'->'lines') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal', 'Supply a correction rationale, explicit open-period date policy and replacement description and lines.');
  END IF;
  IF jsonb_array_length(input->'replacement'->'lines') NOT BETWEEN 2 AND 500 OR EXISTS (
    SELECT FROM jsonb_array_elements(input->'replacement'->'lines') items(line)
    WHERE jsonb_typeof(line) <> 'object' OR line - ARRAY['accountId','debitMinor','creditMinor','description'] <> '{}'::jsonb
  ) THEN PERFORM openerp.fail('InvalidJournal', 'Supply only account, debit, credit and description for 2 to 500 replacement lines.'); END IF;
  SELECT v.* INTO cb_original FROM openerp.vouchers v WHERE v.book_id = scope->>'bookId' AND v.id = prepare_correction_bundle.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound', 'The original voucher was not found in this book.'); END IF;
  IF cb_original.posting_purpose = 'reversal' THEN PERFORM openerp.fail('InvalidJournal', 'Correct the original or its replacement, not a reversal voucher.'); END IF;
  IF EXISTS (SELECT FROM openerp.vouchers v WHERE v.book_id = scope->>'bookId' AND v.corrects_voucher_id = prepare_correction_bundle.id AND v.posting_purpose = 'reversal') THEN
    PERFORM openerp.fail('AlreadyPosted', 'This original already has a reversal. Recover its committed bundle if present. A standalone reversal cannot be upgraded to an atomic bundle.');
  END IF;
  -- Both parts use the explicitly selected open period and date. No silent date
  -- substitution, reopening, backdating before the original, or tax reassessment.
  IF coalesce(input->>'postingDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR input->>'postingDate' < to_char(cb_original.posting_date, 'YYYY-MM-DD') THEN
    PERFORM openerp.fail('InvalidJournal', 'Choose an explicit correction date on or after the original posting date.');
  END IF;
  SELECT p.fiscal_year_id INTO cb_year FROM openerp.periods p
    WHERE p.book_id = scope->>'bookId' AND p.id = input->>'accountingPeriodId' FOR SHARE;
  PERFORM 1 FROM openerp.fiscal_years y WHERE y.book_id = scope->>'bookId' AND y.id = cb_year FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id = scope->>'bookId' AND a.id IN (
    SELECT line->>'accountId' FROM jsonb_array_elements(
      (cb_original.action->'lines') || (input->'replacement'->'lines')) items(line)
  ) ORDER BY a.id FOR SHARE;
  SELECT jsonb_agg(line || jsonb_build_object('lineId', openerp.new_id('line'),
    'debitMinor', line->>'creditMinor', 'creditMinor', line->>'debitMinor') ORDER BY ordinal)
    INTO cb_lines FROM jsonb_array_elements(cb_original.action->'lines') WITH ORDINALITY items(line, ordinal);
  cb_action := cb_original.action || jsonb_build_object('correctsVoucherId', id, 'postingPurpose', 'reversal', 'occurrenceKey', id,
    'fiscalYearId', cb_year, 'accountingPeriodId', input->>'accountingPeriodId', 'postingDate', input->>'postingDate',
    'description', 'Reversal: ' || left(cb_original.action->>'description', 1990), 'rationale', input->>'rationale', 'lines', cb_lines);
  cb_reversal := openerp.seal(scope, cb_actor, cb_action);
  -- Economic identity is derived from the retained original, never a client job.
  SELECT e.id INTO cb_event FROM openerp.events e WHERE e.book_id = scope->>'bookId'
    AND e.evidence_id = cb_original.action->'evidenceRefs'->0->>'evidenceId' AND e.event_key = 'correction:' || prepare_correction_bundle.id;
  IF cb_event IS NULL THEN
    cb_event := openerp.new_id('event');
    INSERT INTO openerp.events(book_id,id,evidence_id,event_key)
      VALUES(scope->>'bookId', cb_event, cb_original.action->'evidenceRefs'->0->>'evidenceId', 'correction:' || id);
  END IF;
  SELECT jsonb_agg(line || jsonb_build_object('lineId', openerp.new_id('line')) ORDER BY ordinal)
    INTO cb_lines FROM jsonb_array_elements(input->'replacement'->'lines') WITH ORDINALITY items(line, ordinal);
  cb_action := cb_action || jsonb_build_object('correctsVoucherId', NULL, 'postingPurpose', 'adjustment',
    'occurrenceKey', 'manual_journal', 'eventId', cb_event, 'description', input->'replacement'->>'description', 'lines', cb_lines);
  cb_replacement := openerp.seal(scope, cb_actor, cb_action);
  cb_body := jsonb_build_object('id', cb_id, 'version', 1, 'scope', scope,
    'originalVoucher', openerp.voucher_body(cb_original), 'datePolicy', input->>'datePolicy', 'rationale', input->>'rationale',
    'reversal', cb_reversal, 'replacement', cb_replacement, 'createdBy', cb_actor,
    'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  cb_digest := openerp.digest(cb_body);
  cb_body := cb_body || jsonb_build_object('bundleDigest', cb_digest);
  INSERT INTO openerp.correction_bundles(book_id,id,original_voucher_id,reversal_change_set_id,replacement_change_set_id,body,digest)
    VALUES(scope->>'bookId', cb_id, id, cb_reversal->>'id', cb_replacement->>'id', cb_body, cb_digest);
  RETURN openerp.save_command(scope->>'bookId', key, cb_actor, 'prepare_correction_bundle', cb_payload, cb_body);
END $$;
