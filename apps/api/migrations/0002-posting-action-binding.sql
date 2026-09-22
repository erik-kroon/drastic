CREATE OR REPLACE FUNCTION openerp.execute_change(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; plan jsonb; posting_action jsonb; approval openerp.approvals;
  voucher_id text := openerp.new_id('voucher'); receipt_id text := openerp.new_id('receipt');
  voucher_number bigint; sequence bigint; recorded_at timestamptz; result jsonb;
  payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'execute_change', payload);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  plan := openerp.get_change(token, scope, id);
  posting_action := plan->'groups'->0->'actions'->0;
  IF input->>'planDigest' IS DISTINCT FROM plan->>'planDigest' OR input->>'version' IS DISTINCT FROM '1' THEN
    PERFORM openerp.fail('StaleDependency', 'Execute the exact approved version and digest.');
  END IF;
  PERFORM 1 FROM openerp.periods WHERE book_id = scope->>'bookId' AND periods.id = posting_action->>'accountingPeriodId' FOR SHARE;
  PERFORM 1 FROM openerp.accounts WHERE book_id = scope->>'bookId'
    AND accounts.id IN (SELECT value->>'accountId' FROM jsonb_array_elements(posting_action->'lines')) ORDER BY accounts.id FOR SHARE;
  PERFORM openerp.check_dependencies(scope, plan);
  SELECT * INTO approval FROM openerp.approvals WHERE book_id = scope->>'bookId' AND approvals.id = input->>'approvalId' FOR UPDATE;
  IF NOT FOUND OR approval.change_set_id <> id OR approval.digest <> plan->>'planDigest'
    OR approval.consumed_at IS NOT NULL OR approval.expires_at <= clock_timestamp() THEN
    PERFORM openerp.fail('ApprovalRequired', 'A current, unconsumed human approval of this exact change set is required.');
  END IF;
  PERFORM 1 FROM openerp.memberships WHERE book_id = scope->>'bookId' AND actor_id = approval.actor_id AND role = 'operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired', 'The approver no longer has authority for this book.'); END IF;
  IF EXISTS (SELECT FROM openerp.vouchers WHERE book_id = scope->>'bookId' AND
    ((event_id = posting_action->>'eventId' AND posting_purpose = posting_action->>'postingPurpose' AND occurrence_key = posting_action->>'occurrenceKey')
      OR change_set_id = execute_change.id OR (posting_action->>'postingPurpose' = 'reversal' AND corrects_voucher_id = posting_action->>'correctsVoucherId'))) THEN
    PERFORM openerp.fail('AlreadyPosted', 'This economic posting already exists. Inspect the original voucher or recover its receipt.');
  END IF;
  INSERT INTO openerp.series_counters(book_id, fiscal_year_id, series, last_number)
    VALUES(scope->>'bookId', posting_action->>'fiscalYearId', posting_action->>'series', 1)
    ON CONFLICT (book_id, fiscal_year_id, series) DO UPDATE SET last_number = openerp.series_counters.last_number + 1
    RETURNING last_number INTO voucher_number;
  UPDATE openerp.books SET committed_sequence = committed_sequence + 1 WHERE books.id = scope->>'bookId'
    RETURNING committed_sequence INTO sequence;
  INSERT INTO openerp.vouchers(book_id, id, fiscal_year_id, period_id, series, number, sequence, posting_date,
      event_id, posting_purpose, occurrence_key, corrects_voucher_id, change_set_id, action)
    VALUES(scope->>'bookId', voucher_id, posting_action->>'fiscalYearId', posting_action->>'accountingPeriodId', posting_action->>'series', voucher_number,
      sequence, (posting_action->>'postingDate')::date, posting_action->>'eventId', posting_action->>'postingPurpose', posting_action->>'occurrenceKey',
      posting_action->>'correctsVoucherId', id, posting_action) RETURNING vouchers.recorded_at INTO recorded_at;
  INSERT INTO openerp.journal_lines(book_id, voucher_id, id, ordinal, account_id, debit_minor, credit_minor, description)
    SELECT scope->>'bookId', voucher_id, value->>'lineId', ordinal, value->>'accountId', (value->>'debitMinor')::numeric,
      (value->>'creditMinor')::numeric, value->>'description'
      FROM jsonb_array_elements(posting_action->'lines') WITH ORDINALITY item(value, ordinal);
  result := jsonb_build_object('id', receipt_id, 'changeSetId', id, 'voucherId', voucher_id, 'planDigest', plan->>'planDigest',
    'sequence', sequence::text, 'voucherNumber', voucher_number::text,
    'committedAt', to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.execution_receipts VALUES(scope->>'bookId', receipt_id, id, voucher_id, approval.id, result);
  UPDATE openerp.approvals SET consumed_at = recorded_at WHERE book_id = scope->>'bookId' AND approvals.id = approval.id;
  INSERT INTO openerp.outbox(book_id, id, receipt_id, kind, payload)
    VALUES(scope->>'bookId', openerp.new_id('outbox'), receipt_id, 'voucher.posted.v1', result);
  RETURN openerp.save_command(scope->>'bookId', key, actor, 'execute_change', payload, result);
END $$;
