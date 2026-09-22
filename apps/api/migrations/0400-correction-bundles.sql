-- A correction bundle composes two unchanged one-voucher kernel commands.
-- This migration does not enable a statutory correction policy or a tax profile.
CREATE TABLE openerp.correction_bundles (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  original_voucher_id text NOT NULL,
  reversal_change_set_id text NOT NULL,
  replacement_change_set_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, reversal_change_set_id),
  UNIQUE (book_id, replacement_change_set_id),
  CHECK (reversal_change_set_id <> replacement_change_set_id),
  FOREIGN KEY (book_id, original_voucher_id) REFERENCES openerp.vouchers,
  FOREIGN KEY (book_id, reversal_change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY (book_id, replacement_change_set_id) REFERENCES openerp.change_sets,
  CHECK (digest = openerp.digest(body - 'bundleDigest') AND body->>'bundleDigest' = digest)
);
CREATE TABLE openerp.correction_bundle_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  bundle_id text NOT NULL,
  reversal_approval_id text NOT NULL,
  replacement_approval_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, bundle_id, id),
  FOREIGN KEY (book_id, bundle_id) REFERENCES openerp.correction_bundles,
  FOREIGN KEY (book_id, reversal_approval_id) REFERENCES openerp.approvals,
  FOREIGN KEY (book_id, replacement_approval_id) REFERENCES openerp.approvals
);
CREATE TABLE openerp.correction_bundle_receipts (
  book_id text NOT NULL,
  bundle_id text NOT NULL,
  original_voucher_id text NOT NULL,
  approval_id text NOT NULL,
  reversal_receipt_id text NOT NULL,
  replacement_receipt_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id, bundle_id),
  UNIQUE (book_id, original_voucher_id),
  UNIQUE (book_id, reversal_receipt_id),
  UNIQUE (book_id, replacement_receipt_id),
  FOREIGN KEY (book_id, bundle_id) REFERENCES openerp.correction_bundles,
  FOREIGN KEY (book_id, original_voucher_id) REFERENCES openerp.vouchers,
  FOREIGN KEY (book_id, bundle_id, approval_id) REFERENCES openerp.correction_bundle_approvals(book_id, bundle_id, id),
  FOREIGN KEY (book_id, reversal_receipt_id) REFERENCES openerp.execution_receipts,
  FOREIGN KEY (book_id, replacement_receipt_id) REFERENCES openerp.execution_receipts
);
CREATE TRIGGER immutable_correction_bundle BEFORE UPDATE OR DELETE ON openerp.correction_bundles
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_correction_bundle_approval BEFORE UPDATE OR DELETE ON openerp.correction_bundle_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_correction_bundle_receipt BEFORE UPDATE OR DELETE ON openerp.correction_bundle_receipts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- Also protects callers of the existing single-change execute endpoint. A child
-- command can never commit independently, even if an operator approves it alone.
CREATE FUNCTION openerp.require_complete_correction_bundle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE cb_bundle openerp.correction_bundles;
BEGIN
  SELECT b.* INTO cb_bundle FROM openerp.correction_bundles b
    WHERE b.book_id = NEW.book_id AND NEW.change_set_id IN (b.reversal_change_set_id, b.replacement_change_set_id);
  IF FOUND AND NOT EXISTS (
    SELECT FROM openerp.correction_bundle_receipts r
    JOIN openerp.execution_receipts reverse_receipt ON reverse_receipt.book_id = r.book_id AND reverse_receipt.id = r.reversal_receipt_id
    JOIN openerp.execution_receipts replace_receipt ON replace_receipt.book_id = r.book_id AND replace_receipt.id = r.replacement_receipt_id
    WHERE r.book_id = cb_bundle.book_id AND r.bundle_id = cb_bundle.id
      AND r.original_voucher_id = cb_bundle.original_voucher_id
      AND reverse_receipt.change_set_id = cb_bundle.reversal_change_set_id
      AND replace_receipt.change_set_id = cb_bundle.replacement_change_set_id
  ) THEN
    PERFORM openerp.fail('ApprovalRequired', 'This change belongs to a correction bundle. Approve and execute the complete bundle; neither part can post alone.');
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER complete_correction_bundle AFTER INSERT ON openerp.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_complete_correction_bundle();

CREATE FUNCTION openerp.get_correction_bundle(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE cb_body jsonb; cb_approval jsonb; cb_receipt jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  -- One committed view of approval/receipt state across concurrent execution.
  PERFORM 1 FROM openerp.books b WHERE b.id = scope->>'bookId' FOR SHARE;
  SELECT b.body INTO cb_body FROM openerp.correction_bundles b
    WHERE b.book_id = scope->>'bookId' AND b.id = get_correction_bundle.id;
  IF cb_body IS NULL THEN PERFORM openerp.fail('NotFound', 'The correction bundle was not found in this book.'); END IF;
  SELECT r.body INTO cb_receipt FROM openerp.correction_bundle_receipts r
    WHERE r.book_id = scope->>'bookId' AND r.bundle_id = get_correction_bundle.id;
  SELECT a.body INTO cb_approval FROM openerp.correction_bundle_approvals a
    JOIN openerp.approvals reverse_approval ON reverse_approval.book_id = a.book_id AND reverse_approval.id = a.reversal_approval_id
    JOIN openerp.approvals replace_approval ON replace_approval.book_id = a.book_id AND replace_approval.id = a.replacement_approval_id
    JOIN openerp.memberships approver ON approver.book_id = a.book_id AND approver.actor_id = a.body->>'actorId' AND approver.role = 'operator'
    WHERE a.book_id = scope->>'bookId' AND a.bundle_id = get_correction_bundle.id
      AND a.body->>'bundleDigest' = cb_body->>'bundleDigest'
      AND reverse_approval.change_set_id = cb_body->'reversal'->>'id'
      AND reverse_approval.digest = cb_body->'reversal'->>'planDigest'
      AND replace_approval.change_set_id = cb_body->'replacement'->>'id'
      AND replace_approval.digest = cb_body->'replacement'->>'planDigest'
      AND reverse_approval.actor_id = approver.actor_id AND replace_approval.actor_id = approver.actor_id
      AND reverse_approval.consumed_at IS NULL AND replace_approval.consumed_at IS NULL
      AND reverse_approval.expires_at > clock_timestamp() AND replace_approval.expires_at > clock_timestamp()
      AND a.expires_at > clock_timestamp() AND cb_receipt IS NULL
    ORDER BY a.expires_at DESC, a.id DESC LIMIT 1;
  RETURN jsonb_build_object('bundle', cb_body, 'approval', cb_approval, 'receipt', cb_receipt);
END $$;
CREATE FUNCTION openerp.get_correction_bundle_for_voucher(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE cb_id text;
BEGIN
  PERFORM openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books b WHERE b.id = scope->>'bookId' FOR SHARE;
  SELECT b.id INTO cb_id FROM openerp.correction_bundles b
    LEFT JOIN openerp.correction_bundle_receipts r ON r.book_id = b.book_id AND r.bundle_id = b.id
    WHERE b.book_id = scope->>'bookId' AND b.original_voucher_id = get_correction_bundle_for_voucher.id
    ORDER BY (r.bundle_id IS NOT NULL) DESC, b.created_at DESC, b.id DESC LIMIT 1;
  IF cb_id IS NULL THEN PERFORM openerp.fail('NotFound', 'No correction bundle exists for this original voucher.'); END IF;
  RETURN openerp.get_correction_bundle(token, scope, cb_id);
END $$;

CREATE FUNCTION openerp.prepare_correction_bundle(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
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
    OR input->'replacement' - ARRAY['description','lines'] <> '{}'::jsonb
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

-- Lock the union before either child command checks dependencies or posts.
CREATE FUNCTION openerp.check_correction_bundle(scope jsonb, bundle jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF bundle->>'bundleDigest' IS DISTINCT FROM openerp.digest(bundle - 'bundleDigest') THEN
    PERFORM openerp.fail('StaleDependency', 'The correction bundle digest is invalid.');
  END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id = scope->>'bookId'
    AND p.id IN (bundle->'reversal'->'groups'->0->'actions'->0->>'accountingPeriodId',
                 bundle->'replacement'->'groups'->0->'actions'->0->>'accountingPeriodId') ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM openerp.fiscal_years y WHERE y.book_id = scope->>'bookId'
    AND y.id IN (bundle->'reversal'->'groups'->0->'actions'->0->>'fiscalYearId',
                 bundle->'replacement'->'groups'->0->'actions'->0->>'fiscalYearId') ORDER BY y.id FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id = scope->>'bookId' AND a.id IN (
    SELECT line->>'accountId' FROM jsonb_array_elements(
      (bundle->'reversal'->'groups'->0->'actions'->0->'lines') ||
      (bundle->'replacement'->'groups'->0->'actions'->0->'lines')) items(line)
  ) ORDER BY a.id FOR SHARE;
  PERFORM openerp.check_dependencies(scope, bundle->'reversal');
  PERFORM openerp.check_dependencies(scope, bundle->'replacement');
  IF EXISTS (SELECT FROM openerp.vouchers v WHERE v.book_id = scope->>'bookId'
    AND v.corrects_voucher_id = bundle->'originalVoucher'->>'id' AND v.posting_purpose = 'reversal') THEN
    PERFORM openerp.fail('AlreadyPosted', 'This original already has a reversal. Recover the committed bundle or review the standalone reversal; do not reverse it again.');
  END IF;
END $$;

CREATE FUNCTION openerp.approve_correction_bundle(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE cb_actor text; cb_previous jsonb; cb_bundle jsonb; cb_reverse_approval jsonb; cb_replace_approval jsonb;
  cb_approval_id text := openerp.new_id('bundleapproval'); cb_expires timestamptz; cb_body jsonb;
  cb_payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  cb_actor := openerp.authorize(token, scope, true);
  PERFORM 1 FROM openerp.books b WHERE b.id = scope->>'bookId' FOR UPDATE;
  cb_previous := openerp.replay(scope->>'bookId', key, cb_actor, 'approve_correction_bundle', cb_payload);
  IF cb_previous IS NOT NULL THEN RETURN cb_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input - ARRAY['bundleDigest','version'] <> '{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal', 'Approve only the sealed bundle digest and version.');
  END IF;
  cb_bundle := openerp.get_correction_bundle(token, scope, id)->'bundle';
  IF input->>'bundleDigest' IS DISTINCT FROM cb_bundle->>'bundleDigest' OR input->>'version' IS DISTINCT FROM '1' THEN
    PERFORM openerp.fail('StaleDependency', 'Approve the exact correction bundle shown in the review.');
  END IF;
  PERFORM openerp.check_correction_bundle(scope, cb_bundle);
  cb_reverse_approval := openerp.approve_change(token, scope, cb_bundle->'reversal'->>'id', openerp.new_id('bundlecommand'),
    jsonb_build_object('planDigest', cb_bundle->'reversal'->>'planDigest', 'version', 1));
  cb_replace_approval := openerp.approve_change(token, scope, cb_bundle->'replacement'->>'id', openerp.new_id('bundlecommand'),
    jsonb_build_object('planDigest', cb_bundle->'replacement'->>'planDigest', 'version', 1));
  cb_expires := least((cb_reverse_approval->>'expiresAt')::timestamptz, (cb_replace_approval->>'expiresAt')::timestamptz);
  cb_body := jsonb_build_object('id', cb_approval_id, 'bundleId', id, 'bundleDigest', cb_bundle->>'bundleDigest',
    'actorId', cb_actor, 'expiresAt', to_char(cb_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.correction_bundle_approvals(book_id,id,bundle_id,reversal_approval_id,replacement_approval_id,expires_at,body)
    VALUES(scope->>'bookId', cb_approval_id, id, cb_reverse_approval->>'id', cb_replace_approval->>'id', cb_expires, cb_body);
  RETURN openerp.save_command(scope->>'bookId', key, cb_actor, 'approve_correction_bundle', cb_payload, cb_body);
END $$;

CREATE FUNCTION openerp.execute_correction_bundle(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE cb_actor text; cb_previous jsonb; cb_bundle jsonb; cb_approval openerp.correction_bundle_approvals;
  cb_reverse_receipt jsonb; cb_replace_receipt jsonb; cb_body jsonb;
  cb_payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  cb_actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books b WHERE b.id = scope->>'bookId' FOR UPDATE;
  cb_previous := openerp.replay(scope->>'bookId', key, cb_actor, 'execute_correction_bundle', cb_payload);
  IF cb_previous IS NOT NULL THEN RETURN cb_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input - ARRAY['bundleDigest','version','approvalId'] <> '{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal', 'Execute only the approved bundle digest, version and approval ID. Replacement lines are not accepted.');
  END IF;
  cb_bundle := openerp.get_correction_bundle(token, scope, id)->'bundle';
  IF input->>'bundleDigest' IS DISTINCT FROM cb_bundle->>'bundleDigest' OR input->>'version' IS DISTINCT FROM '1' THEN
    PERFORM openerp.fail('StaleDependency', 'Execute the exact approved correction bundle.');
  END IF;
  SELECT r.body INTO cb_body FROM openerp.correction_bundle_receipts r
    WHERE r.book_id = scope->>'bookId' AND r.bundle_id = execute_correction_bundle.id;
  IF cb_body IS NOT NULL THEN
    IF input->>'approvalId' IS DISTINCT FROM cb_body->>'approvalId' THEN
      PERFORM openerp.fail('ApprovalRequired', 'Recover the committed receipt using its original bundle approval.');
    END IF;
    RETURN openerp.save_command(scope->>'bookId', key, cb_actor, 'execute_correction_bundle', cb_payload, cb_body);
  END IF;
  PERFORM openerp.check_correction_bundle(scope, cb_bundle);
  SELECT a.* INTO cb_approval FROM openerp.correction_bundle_approvals a
    WHERE a.book_id = scope->>'bookId' AND a.bundle_id = execute_correction_bundle.id AND a.id = input->>'approvalId';
  IF NOT FOUND OR cb_approval.expires_at <= clock_timestamp()
    OR cb_approval.body->>'bundleDigest' IS DISTINCT FROM cb_bundle->>'bundleDigest' THEN
    PERFORM openerp.fail('ApprovalRequired', 'A current operator approval of this complete bundle is required.');
  END IF;
  cb_reverse_receipt := openerp.execute_change(token, scope, cb_bundle->'reversal'->>'id', openerp.new_id('bundlecommand'),
    jsonb_build_object('planDigest', cb_bundle->'reversal'->>'planDigest', 'version', 1, 'approvalId', cb_approval.reversal_approval_id));
  cb_replace_receipt := openerp.execute_change(token, scope, cb_bundle->'replacement'->>'id', openerp.new_id('bundlecommand'),
    jsonb_build_object('planDigest', cb_bundle->'replacement'->>'planDigest', 'version', 1, 'approvalId', cb_approval.replacement_approval_id));
  cb_body := jsonb_build_object('id', openerp.new_id('bundlereceipt'), 'bundleId', id,
    'bundleDigest', cb_bundle->>'bundleDigest', 'approvalId', cb_approval.id,
    'originalVoucherId', cb_bundle->'originalVoucher'->>'id', 'reversal', cb_reverse_receipt, 'replacement', cb_replace_receipt,
    'committedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.correction_bundle_receipts(book_id,bundle_id,original_voucher_id,approval_id,reversal_receipt_id,replacement_receipt_id,body)
    VALUES(scope->>'bookId', id, cb_bundle->'originalVoucher'->>'id', cb_approval.id, cb_reverse_receipt->>'id', cb_replace_receipt->>'id', cb_body);
  RETURN openerp.save_command(scope->>'bookId', key, cb_actor, 'execute_correction_bundle', cb_payload, cb_body);
END $$;

--0300 owns this hook; recovery must not offer a single-part execution path.
CREATE OR REPLACE FUNCTION openerp.posting_recovery_standalone(book text, id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, openerp AS $$
  SELECT NOT EXISTS (SELECT FROM openerp.correction_bundles b WHERE b.book_id = book
    AND posting_recovery_standalone.id IN (b.reversal_change_set_id, b.replacement_change_set_id))
$$;

REVOKE ALL ON openerp.correction_bundles, openerp.correction_bundle_approvals, openerp.correction_bundle_receipts FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.require_complete_correction_bundle() FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.check_correction_bundle(jsonb,jsonb) FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.posting_recovery_standalone(text,text) FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_correction_bundle(text,jsonb,text) FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_correction_bundle_for_voucher(text,jsonb,text) FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_correction_bundle(text,jsonb,text,text,jsonb) FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.approve_correction_bundle(text,jsonb,text,text,jsonb) FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.execute_correction_bundle(text,jsonb,text,text,jsonb) FROM PUBLIC, openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_correction_bundle(text,jsonb,text),
  openerp.get_correction_bundle_for_voucher(text,jsonb,text),
  openerp.prepare_correction_bundle(text,jsonb,text,text,jsonb),
  openerp.approve_correction_bundle(text,jsonb,text,text,jsonb),
  openerp.execute_correction_bundle(text,jsonb,text,text,jsonb) TO openerp_runtime;
