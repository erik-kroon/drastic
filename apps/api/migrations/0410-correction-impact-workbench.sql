-- Depends on0401,0500,0600,0700,0800 and0900. All earlier files remain immutable.
-- A review is a conservative snapshot, never a posting or compensation authority.
CREATE TABLE openerp.correction_impact_reviews (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  voucher_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers
);
CREATE TRIGGER immutable_correction_impact BEFORE UPDATE OR DELETE ON openerp.correction_impact_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.correction_chain_body(p_book text,p_voucher text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_ids text[]; ci_vouchers jsonb; ci_receipts jsonb; ci_balances jsonb; ci_root text; ci_scope jsonb; ci_sequence text;
BEGIN
  IF NOT EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher) THEN
    PERFORM openerp.fail('NotFound','The voucher was not found in this book.'); END IF;
  WITH RECURSIVE edges(source,target) AS (
    SELECT v.id,v.corrects_voucher_id FROM openerp.vouchers v WHERE v.book_id=p_book AND v.corrects_voucher_id IS NOT NULL
    UNION SELECT v.corrects_voucher_id,v.id FROM openerp.vouchers v WHERE v.book_id=p_book AND v.corrects_voucher_id IS NOT NULL
    UNION SELECT r.original_voucher_id,e.voucher_id FROM openerp.correction_bundle_receipts r
      JOIN openerp.execution_receipts e ON e.book_id=r.book_id AND e.id=r.replacement_receipt_id WHERE r.book_id=p_book
    UNION SELECT e.voucher_id,r.original_voucher_id FROM openerp.correction_bundle_receipts r
      JOIN openerp.execution_receipts e ON e.book_id=r.book_id AND e.id=r.replacement_receipt_id WHERE r.book_id=p_book
  ), chain(id) AS (
    SELECT p_voucher UNION SELECT e.target FROM edges e JOIN chain c ON c.id=e.source
  ) SELECT array_agg(c.id ORDER BY c.id COLLATE "C") INTO ci_ids FROM chain c;
  IF cardinality(ci_ids)>200 THEN PERFORM openerp.fail('UnsupportedProfile','This chain exceeds the bounded review of200 vouchers. No partial chain or totals are returned.'); END IF;
  SELECT jsonb_agg(openerp.voucher_body(v) ORDER BY v.sequence) INTO ci_vouchers
    FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=ANY(ci_ids);
  ci_root:=ci_vouchers->0->>'id';
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.body->>'committedAt',r.bundle_id),'[]') INTO ci_receipts
    FROM openerp.correction_bundle_receipts r WHERE r.book_id=p_book AND r.original_voucher_id=ANY(ci_ids);
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',totals.account_id,'debitMinor',totals.debit::text,
    'creditMinor',totals.credit::text,'balanceMinor',(totals.debit-totals.credit)::text) ORDER BY totals.account_id),'[]') INTO ci_balances
    FROM (SELECT l.account_id,sum(l.debit_minor) debit,sum(l.credit_minor) credit FROM openerp.journal_lines l
      WHERE l.book_id=p_book AND l.voucher_id=ANY(ci_ids) GROUP BY l.account_id) totals;
  SELECT jsonb_build_object('entityId',b.entity_id,'bookId',b.id),b.committed_sequence::text INTO ci_scope,ci_sequence FROM openerp.books b WHERE b.id=p_book;
  RETURN jsonb_build_object('scope',ci_scope,'selectedVoucherId',p_voucher,'rootVoucherId',ci_root,
    'sequence',ci_sequence,'vouchers',ci_vouchers,'receipts',ci_receipts,'balances',ci_balances);
END $$;

-- Only stable retained relationships are read. No ownership/release semantics are inferred.
CREATE FUNCTION openerp.correction_impact_resources(p_book text,p_voucher text,p_date date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_resources jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.id,'detail',r.detail,'path',r.path,'blocks',r.blocks)
      ORDER BY r.kind,r.id,r.detail),'[]') INTO ci_resources FROM (
    SELECT 'bank_match' kind,m.statement_id id,'Retained bank match: row '||m.row_ordinal::text||', line '||m.line_id||'. Match supersession is unavailable.' detail,
      '/bank-statements/'||m.statement_id path,true blocks FROM openerp.bank_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',a.plan_id,'Applied bank allocation: row '||a.row_ordinal::text||', line '||a.line_id||'. Compensation is unavailable.',
      '/bank-allocation-plans/'||a.plan_id,true FROM openerp.bank_allocation_legs a WHERE a.book_id=p_book AND a.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',p.id,'Unexecuted bank allocation plan references this voucher. It must revalidate after any correction.',
      '/bank-allocation-plans/'||p.id,false FROM openerp.bank_allocation_plans p WHERE p.book_id=p_book
      AND NOT EXISTS(SELECT FROM openerp.bank_allocation_executions e WHERE e.book_id=p.book_id AND e.plan_id=p.id)
      AND EXISTS(SELECT FROM jsonb_array_elements(p.input->'legs') item(leg) WHERE leg->>'voucherId'=p_voucher)
    UNION ALL SELECT 'invoice',i.id,'Registered invoice recognition, line '||i.recognition_line_id||'. Use the commerce owner; generic release is unavailable.',
      '/commerce/invoices/'||i.id,true FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',a.receipt_id,'Applied invoice payment, invoice '||a.invoice_id||', line '||a.payment_line_id||'. Allocation compensation is unavailable.',
      '/commerce/invoices/'||a.invoice_id,true FROM openerp.commerce_allocation_legs a WHERE a.book_id=p_book AND a.payment_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',p.id,'Unapplied commerce payment plan references this voucher. Its owner must revalidate the plan; this review does not release capacity.',
      '/commerce/allocation-plans/'||p.id,false FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_book
      AND p.body->'payment'->>'voucherId'=p_voucher
      AND NOT EXISTS(SELECT FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p.book_id AND r.plan_id=p.id)
    UNION ALL SELECT DISTINCT 'schedule',s.schedule_id,'Represented schedule occurrence '||s.ordinal::text||'. Posted-occurrence compensation is unavailable.',
      '/schedules/'||s.schedule_id,true FROM openerp.subledger_preparations s JOIN openerp.change_sets c ON c.book_id=s.book_id AND c.id=s.change_set_id
      JOIN openerp.vouchers v ON v.book_id=s.book_id AND v.id=p_voucher
      WHERE s.book_id=p_book AND (s.change_set_id=v.change_set_id OR c.plan->'groups'->0->'actions'->0->>'eventId'=v.event_id)
    UNION ALL SELECT 'report',r.id,'Retained report covers the correction date. Its original bytes stay unchanged; prepare a new snapshot after posting.',
      '/report-snapshots/'||r.id,false FROM openerp.report_snapshots r WHERE r.book_id=p_book AND p_date BETWEEN r.starts_on AND r.ends_on
    UNION ALL SELECT 'closing',c.id,'Technical certificate depends on the ledger sequence. A new posting makes its basis stale; no automatic reopen or statutory finding.',
      '/closing-certificates/'||c.id,false FROM openerp.closing_certificates c WHERE c.book_id=p_book AND p_date IS NOT NULL
  ) r;
  IF jsonb_array_length(ci_resources)>1000 THEN PERFORM openerp.fail('UnsupportedProfile','This impact exceeds1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN ci_resources;
END $$;

CREATE FUNCTION openerp.correction_require_unbound(p_book text,p_voucher text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_resource jsonb;
BEGIN
  FOR ci_resource IN SELECT value FROM jsonb_array_elements(openerp.correction_impact_resources(p_book,p_voucher,NULL)) LOOP
    IF ci_resource->>'blocks'='true' THEN
      PERFORM openerp.fail('UnsupportedProfile',ci_resource->>'detail'); END IF;
  END LOOP;
END $$;

-- Covers reversal-only and old sealed proposals as well as the bundle workbench.
CREATE FUNCTION openerp.correction_unsupported_reversal_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    PERFORM openerp.correction_require_unbound(NEW.book_id,NEW.corrects_voucher_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER correction_unsupported_reversal BEFORE INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.correction_unsupported_reversal_guard();

CREATE FUNCTION openerp.correction_net_change(p_original jsonb,p_lines jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
  WITH changes AS (
    SELECT line->>'accountId' account_id,-((line->>'debitMinor')::numeric-(line->>'creditMinor')::numeric) amount
      FROM jsonb_array_elements(p_original->'lines') item(line)
    UNION ALL SELECT line->>'accountId',(line->>'debitMinor')::numeric-(line->>'creditMinor')::numeric
      FROM jsonb_array_elements(p_lines) item(line)
  ), totals AS (SELECT account_id,sum(amount) delta FROM changes GROUP BY account_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'deltaMinor',delta::text) ORDER BY account_id),'[]') FROM totals
$$;

CREATE FUNCTION openerp.correction_impact_basis(p_scope jsonb,p_voucher text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_original openerp.vouchers; ci_period openerp.periods; ci_action jsonb; ci_lines jsonb; ci_date date;
  ci_resources jsonb; ci_blockers jsonb:='[]'; ci_configuration jsonb; ci_accounts jsonb; ci_periods jsonb; ci_years jsonb;
  ci_error text; ci_code text; ci_delta jsonb:='[]'; ci_chain jsonb;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Supply an exact correction intent.'); END IF;
  IF p_input-ARRAY['datePolicy','accountingPeriodId','postingDate','rationale','replacement']<>'{}'::jsonb
    OR p_input->>'datePolicy' IS DISTINCT FROM 'explicit_open_period'
    OR coalesce(length(btrim(p_input->>'rationale')),0) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(p_input->'replacement') IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the supported correction policy, rationale and replacement.'); END IF;
  IF (p_input->'replacement')-ARRAY['description','lines']<>'{}'::jsonb
    OR jsonb_typeof(p_input->'replacement'->'lines') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Supply only a replacement description and exact lines.'); END IF;
  IF jsonb_array_length(p_input->'replacement'->'lines') NOT BETWEEN 2 AND 500 OR EXISTS(
    SELECT FROM jsonb_array_elements(p_input->'replacement'->'lines') item(line)
      WHERE jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['accountId','debitMinor','creditMinor','description']<>'{}'::jsonb) THEN
    PERFORM openerp.fail('InvalidJournal','Supply2 to500 exact replacement lines without unsupported dimensions or tax fields.'); END IF;
  ci_date:=openerp.bank_date(p_input->>'postingDate');
  SELECT v.* INTO ci_original FROM openerp.vouchers v WHERE v.book_id=p_scope->>'bookId' AND v.id=p_voucher;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The original voucher was not found in this book.'); END IF;
  ci_chain:=openerp.correction_chain_body(p_scope->>'bookId',p_voucher);
  ci_resources:=openerp.correction_impact_resources(p_scope->>'bookId',p_voucher,ci_date);
  SELECT ci_blockers||coalesce(jsonb_agg(jsonb_build_object('code','UnsupportedProfile','message',r->>'detail')),'[]') INTO ci_blockers
    FROM jsonb_array_elements(ci_resources) item(r) WHERE r->>'blocks'='true';
  IF ci_original.posting_purpose='reversal' THEN
    ci_blockers:=ci_blockers||jsonb_build_array(jsonb_build_object('code','InvalidJournal','message','Correct the original or its replacement, not a reversal.')); END IF;
  IF ci_date<ci_original.posting_date THEN
    ci_blockers:=ci_blockers||jsonb_build_array(jsonb_build_object('code','InvalidJournal','message','Correction date cannot precede the original posting date.')); END IF;
  IF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=ci_original.book_id AND v.corrects_voucher_id=p_voucher) THEN
    ci_blockers:=ci_blockers||jsonb_build_array(jsonb_build_object('code','AlreadyPosted','message','The original already has a reversal. Recover its chain; a standalone reversal cannot be upgraded into an atomic bundle.')); END IF;
  SELECT p.* INTO ci_period FROM openerp.periods p WHERE p.book_id=ci_original.book_id AND p.id=p_input->>'accountingPeriodId';
  SELECT jsonb_agg(line||jsonb_build_object('lineId','review_line_'||ordinal::text) ORDER BY ordinal) INTO ci_lines
    FROM jsonb_array_elements(p_input->'replacement'->'lines') WITH ORDINALITY item(line,ordinal);
  ci_action:=ci_original.action||jsonb_build_object('correctsVoucherId',NULL,'postingPurpose','adjustment','occurrenceKey','manual_journal',
    'fiscalYearId',ci_period.fiscal_year_id,'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',p_input->>'postingDate',
    'rationale',p_input->>'rationale','description',p_input->'replacement'->>'description','lines',ci_lines);
  BEGIN
    PERFORM openerp.inspect_action(ci_original.book_id,ci_action);
    ci_delta:=openerp.correction_net_change(ci_original.action,p_input->'replacement'->'lines');
    IF ci_date=ci_original.posting_date AND ci_period.id=ci_original.period_id
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(ci_delta) item(d) WHERE d->>'deltaMinor'<>'0') THEN
      ci_blockers:=ci_blockers||jsonb_build_array(jsonb_build_object('code','InvalidJournal','message','The replacement changes no supported economic amount or posting date. Description-only, reordered or split equivalent lines are not a financial correction.')); END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS ci_code=PG_EXCEPTION_DETAIL,ci_error=MESSAGE_TEXT;
    ci_blockers:=ci_blockers||jsonb_build_array(jsonb_build_object('code',ci_code,'message',ci_error));
  END;
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') INTO ci_accounts FROM openerp.accounts a WHERE a.book_id=ci_original.book_id;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') INTO ci_periods FROM openerp.periods p WHERE p.book_id=ci_original.book_id;
  SELECT coalesce(jsonb_agg(to_jsonb(y) ORDER BY y.id),'[]') INTO ci_years FROM openerp.fiscal_years y WHERE y.book_id=ci_original.book_id;
  SELECT jsonb_build_object('book',to_jsonb(b),'accounts',ci_accounts,'periods',ci_periods,'years',ci_years) INTO ci_configuration
    FROM openerp.books b WHERE b.id=ci_original.book_id;
  RETURN jsonb_build_object('intent',p_input,'chain',ci_chain,'resources',ci_resources,'blockers',ci_blockers,
    'configurationDigest',openerp.digest(ci_configuration),'netChange',ci_delta,'executable',false,
    'limitations',jsonb_build_array('Snapshot-current is not full executability. Approval authority and all kernel and dependent-domain guards are checked at execution.',
      'Only native synthetic manual journal economics are supported. Company date policy, tax, payroll, funding classification and statutory filing effects are not established.',
      'Only registered relationships are visible. Missing company evidence, liabilities or sources are not inferred absent. No report, match, invoice, schedule or closed period is rewritten.'));
END $$;

CREATE FUNCTION openerp.prepare_correction_impact(token text,scope jsonb,id text,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ci_actor text; ci_previous jsonb; ci_basis jsonb; ci_body jsonb; ci_id text:=openerp.new_id('impact');
  ci_payload jsonb:=jsonb_build_object('id',id,'input',input);
BEGIN
  ci_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  ci_previous:=openerp.replay(scope->>'bookId',key,ci_actor,'prepare_correction_impact',ci_payload);
  IF ci_previous IS NOT NULL THEN RETURN ci_previous; END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId' ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM openerp.fiscal_years y WHERE y.book_id=scope->>'bookId' ORDER BY y.id FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=scope->>'bookId' ORDER BY a.id FOR SHARE;
  ci_basis:=openerp.correction_impact_basis(scope,id,input);
  ci_body:=jsonb_build_object('id',ci_id,'scope',scope,'voucherId',id,'createdBy',ci_actor,
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'basis',ci_basis);
  ci_body:=ci_body||jsonb_build_object('digest',openerp.digest(ci_body));
  INSERT INTO openerp.correction_impact_reviews VALUES(scope->>'bookId',ci_id,id,ci_body);
  RETURN openerp.save_command(scope->>'bookId',key,ci_actor,'prepare_correction_impact',ci_payload,ci_body);
END $$;

CREATE FUNCTION openerp.get_correction_impact(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ci_review openerp.correction_impact_reviews; ci_current jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT r.* INTO ci_review FROM openerp.correction_impact_reviews r WHERE r.book_id=scope->>'bookId' AND r.id=get_correction_impact.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The correction impact review was not found in this book.'); END IF;
  ci_current:=openerp.correction_impact_basis(scope,ci_review.voucher_id,ci_review.body->'basis'->'intent');
  RETURN jsonb_build_object('impact',ci_review.body,'snapshotCurrent',ci_current=ci_review.body->'basis','executable',false);
END $$;

CREATE FUNCTION openerp.get_correction_chain(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  RETURN openerp.correction_chain_body(scope->>'bookId',id);
END $$;

CREATE FUNCTION openerp.list_correction_bundles(token text,scope jsonb,after_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ci_items jsonb; ci_last text; ci_next text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF after_id IS NULL OR (after_id<>'' AND after_id!~'^[a-z][a-z0-9_-]{2,127}$') THEN PERFORM openerp.fail('InvalidJournal','Invalid correction bundle cursor.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'originalVoucherId',b.original_voucher_id,'createdAt',b.body->>'createdAt',
    'bundleDigest',b.digest,'receipt',r.body) ORDER BY b.id COLLATE "C"),'[]'),max(b.id COLLATE "C") INTO ci_items,ci_last
    FROM (SELECT x.* FROM openerp.correction_bundles x WHERE x.book_id=scope->>'bookId' AND x.id COLLATE "C">after_id COLLATE "C" ORDER BY x.id COLLATE "C" LIMIT 25) b
    LEFT JOIN openerp.correction_bundle_receipts r ON r.book_id=b.book_id AND r.bundle_id=b.id;
  IF EXISTS(SELECT FROM openerp.correction_bundles b WHERE b.book_id=scope->>'bookId' AND b.id COLLATE "C">ci_last COLLATE "C") THEN ci_next:=ci_last; END IF;
  RETURN jsonb_build_object('items',ci_items,'next',ci_next);
END $$;

CREATE FUNCTION openerp.recover_correction_request(token text,scope jsonb,key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ci_actor text; ci_receipt openerp.command_receipts;
BEGIN
  ci_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF key IS NULL OR key!~'^[a-zA-Z0-9_-]{8,128}$' THEN PERFORM openerp.fail('InvalidJournal','Supply the original correction request key.'); END IF;
  SELECT r.* INTO ci_receipt FROM openerp.command_receipts r WHERE r.book_id=scope->>'bookId' AND r.key=recover_correction_request.key AND r.actor_id=ci_actor
    AND r.operation IN('prepare_correction_impact','prepare_correction_bundle','approve_correction_bundle','execute_correction_bundle');
  RETURN jsonb_build_object('key',key,'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'status',CASE WHEN ci_receipt.key IS NULL THEN 'not_recorded_at_check' ELSE 'recorded' END,'operation',ci_receipt.operation,'result',ci_receipt.result);
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_correction_bundle(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE cb_actor text; cb_previous jsonb; cb_original openerp.vouchers; cb_reversal jsonb;
  cb_replacement jsonb; cb_action jsonb; cb_lines jsonb; cb_event text; cb_year text;
  ci_review openerp.correction_impact_reviews; ci_basis jsonb;
  cb_id text := openerp.new_id('correction'); cb_body jsonb; cb_digest text;
  cb_payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  cb_actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books b WHERE b.id = scope->>'bookId' FOR UPDATE;
  cb_previous := openerp.replay(scope->>'bookId', key, cb_actor, 'prepare_correction_bundle', cb_payload);
  IF cb_previous IS NOT NULL THEN RETURN cb_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object'
    OR input - ARRAY['datePolicy','accountingPeriodId','postingDate','rationale','replacement','impactReview'] <> '{}'::jsonb
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
  IF jsonb_typeof(input->'impactReview') IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('UnsupportedProfile','Create and review a correction impact snapshot before sealing this bundle.'); END IF;
  IF (input->'impactReview')-ARRAY['id','digest']<>'{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Supply only the exact impact review ID and digest.'); END IF;
  SELECT r.* INTO ci_review FROM openerp.correction_impact_reviews r
    WHERE r.book_id=scope->>'bookId' AND r.voucher_id=prepare_correction_bundle.id AND r.id=input->'impactReview'->>'id';
  IF NOT FOUND OR ci_review.body->>'digest' IS DISTINCT FROM input->'impactReview'->>'digest'
    OR ci_review.body->>'digest' IS DISTINCT FROM openerp.digest(ci_review.body-'digest')
    OR ci_review.body->'basis'->'intent' IS DISTINCT FROM (input-'impactReview') THEN
    PERFORM openerp.fail('StaleDependency','The impact review does not bind this exact original, replacement, date and rationale.'); END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId' ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM openerp.fiscal_years y WHERE y.book_id=scope->>'bookId' ORDER BY y.id FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=scope->>'bookId' ORDER BY a.id FOR SHARE;
  ci_basis:=openerp.correction_impact_basis(scope,id,input-'impactReview');
  IF ci_basis IS DISTINCT FROM ci_review.body->'basis' THEN
    PERFORM openerp.fail('StaleDependency','Correction impacts changed. Refresh and review a new immutable impact snapshot.'); END IF;
  IF jsonb_array_length(ci_basis->'blockers')>0 THEN
    PERFORM openerp.fail(ci_basis->'blockers'->0->>'code',ci_basis->'blockers'->0->>'message'); END IF;
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
    'impactReview',input->'impactReview',
    'originalVoucher', openerp.voucher_body(cb_original), 'datePolicy', input->>'datePolicy', 'rationale', input->>'rationale',
    'reversal', cb_reversal, 'replacement', cb_replacement, 'createdBy', cb_actor,
    'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  cb_digest := openerp.digest(cb_body);
  cb_body := cb_body || jsonb_build_object('bundleDigest', cb_digest);
  INSERT INTO openerp.correction_bundles(book_id,id,original_voucher_id,reversal_change_set_id,replacement_change_set_id,body,digest)
    VALUES(scope->>'bookId', cb_id, id, cb_reversal->>'id', cb_replacement->>'id', cb_body, cb_digest);
  RETURN openerp.save_command(scope->>'bookId', key, cb_actor, 'prepare_correction_bundle', cb_payload, cb_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.check_correction_bundle(scope jsonb, bundle jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE ci_intent jsonb; ci_basis jsonb; ci_review openerp.correction_impact_reviews;
BEGIN
  IF bundle->>'bundleDigest' IS DISTINCT FROM openerp.digest(bundle - 'bundleDigest') THEN
    PERFORM openerp.fail('StaleDependency', 'The correction bundle digest is invalid.');
  END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId' ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM openerp.fiscal_years y WHERE y.book_id=scope->>'bookId' ORDER BY y.id FOR SHARE;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=scope->>'bookId' ORDER BY a.id FOR SHARE;
  SELECT jsonb_build_object('datePolicy',bundle->>'datePolicy','rationale',bundle->>'rationale',
    'accountingPeriodId',bundle->'replacement'->'groups'->0->'actions'->0->>'accountingPeriodId',
    'postingDate',bundle->'replacement'->'groups'->0->'actions'->0->>'postingDate',
    'replacement',jsonb_build_object('description',bundle->'replacement'->'groups'->0->'actions'->0->>'description',
      'lines',jsonb_agg(line-'lineId' ORDER BY ordinal))) INTO ci_intent
    FROM jsonb_array_elements(bundle->'replacement'->'groups'->0->'actions'->0->'lines') WITH ORDINALITY item(line,ordinal);
  ci_basis:=openerp.correction_impact_basis(scope,bundle->'originalVoucher'->>'id',ci_intent);
  IF jsonb_array_length(ci_basis->'blockers')>0 THEN
    PERFORM openerp.fail(ci_basis->'blockers'->0->>'code',ci_basis->'blockers'->0->>'message'); END IF;
  IF bundle ? 'impactReview' THEN
    SELECT r.* INTO ci_review FROM openerp.correction_impact_reviews r WHERE r.book_id=scope->>'bookId'
      AND r.id=bundle->'impactReview'->>'id' AND r.voucher_id=bundle->'originalVoucher'->>'id';
    IF NOT FOUND OR ci_review.body->>'digest' IS DISTINCT FROM bundle->'impactReview'->>'digest'
      OR ci_basis IS DISTINCT FROM ci_review.body->'basis' THEN
      PERFORM openerp.fail('StaleDependency','The sealed impact review is no longer current. Prepare and approve a new reviewed bundle.'); END IF;
  END IF;
  PERFORM openerp.check_dependencies(scope, bundle->'reversal');
  PERFORM openerp.check_dependencies(scope, bundle->'replacement');
  IF EXISTS (SELECT FROM openerp.vouchers v WHERE v.book_id = scope->>'bookId'
    AND v.corrects_voucher_id = bundle->'originalVoucher'->>'id' AND v.posting_purpose = 'reversal') THEN
    PERFORM openerp.fail('AlreadyPosted', 'This original already has a reversal. Recover the committed bundle or review the standalone reversal; do not reverse it again.');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_correction(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE ci_actor text; ci_previous jsonb; ci_original jsonb; ci_action jsonb; ci_lines jsonb; ci_fiscal_year text; ci_result jsonb;
  ci_payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  ci_actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  ci_previous := openerp.replay(scope->>'bookId', key, ci_actor, 'prepare_correction', ci_payload);
  IF ci_previous IS NOT NULL THEN RETURN ci_previous; END IF;
  SELECT v.action INTO ci_original FROM openerp.vouchers v WHERE book_id = scope->>'bookId' AND v.id = prepare_correction.id;
  IF ci_original IS NULL THEN PERFORM openerp.fail('NotFound', 'The original voucher was not found in this book.'); END IF;
  PERFORM openerp.correction_require_unbound(scope->>'bookId',id);
  SELECT fiscal_year_id INTO ci_fiscal_year FROM openerp.periods WHERE book_id = scope->>'bookId' AND periods.id = input->>'accountingPeriodId';
  SELECT jsonb_agg(value || jsonb_build_object('lineId', openerp.new_id('line'), 'debitMinor', value->>'creditMinor',
    'creditMinor', value->>'debitMinor') ORDER BY ordinal) INTO ci_lines FROM jsonb_array_elements(ci_original->'lines') WITH ORDINALITY item(value, ordinal);
  ci_action := ci_original || jsonb_build_object('correctsVoucherId', id, 'postingPurpose', 'reversal', 'occurrenceKey', id,
    'fiscalYearId', ci_fiscal_year, 'accountingPeriodId', input->>'accountingPeriodId', 'postingDate', input->>'postingDate',
    'description', 'Reversal: ' || left(ci_original->>'description', 1990), 'rationale', input->>'rationale', 'lines', ci_lines);
  ci_result := openerp.seal(scope, ci_actor, ci_action);
  RETURN openerp.save_command(scope->>'bookId', key, ci_actor, 'prepare_correction', ci_payload, ci_result);
END $$;

REVOKE ALL ON openerp.correction_impact_reviews FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.correction_chain_body(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.correction_impact_resources(text,text,date) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.correction_require_unbound(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.correction_unsupported_reversal_guard() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.correction_net_change(jsonb,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.correction_impact_basis(jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_correction_impact(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_correction_impact(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_correction_chain(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.list_correction_bundles(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.recover_correction_request(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_correction_impact(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_correction_impact(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_correction_chain(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_correction_bundles(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.recover_correction_request(text,jsonb,text) TO openerp_runtime;
