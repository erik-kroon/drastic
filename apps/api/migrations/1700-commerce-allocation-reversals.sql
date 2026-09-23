-- Whole-receipt unallocation. Forward-only over0600/1300/1400/1510.
-- No ledger writes. Original applications, source records and receipts remain immutable.
CREATE TABLE openerp.commerce_allocation_reversal_plans (
 book_id text NOT NULL REFERENCES openerp.books,id text NOT NULL,receipt_id text NOT NULL,
 body jsonb NOT NULL CHECK(octet_length(body::text)<=262144),PRIMARY KEY(book_id,id),
 FOREIGN KEY(book_id,receipt_id) REFERENCES openerp.commerce_allocation_receipts(book_id,id)
);
CREATE TABLE openerp.commerce_allocation_reversal_approvals (
 book_id text NOT NULL,id text NOT NULL,plan_id text NOT NULL,actor_id text NOT NULL REFERENCES openerp.actors,
 expires_at timestamptz NOT NULL,body jsonb NOT NULL,PRIMARY KEY(book_id,id),
 FOREIGN KEY(book_id,plan_id) REFERENCES openerp.commerce_allocation_reversal_plans
);
CREATE TABLE openerp.commerce_allocation_reversal_revocations (
 book_id text NOT NULL,approval_id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(book_id,approval_id),
 FOREIGN KEY(book_id,approval_id) REFERENCES openerp.commerce_allocation_reversal_approvals
);
CREATE TABLE openerp.commerce_allocation_reversals (
 book_id text NOT NULL,plan_id text NOT NULL,approval_id text NOT NULL,receipt_id text NOT NULL,
 body jsonb NOT NULL,PRIMARY KEY(book_id,plan_id),UNIQUE(book_id,receipt_id),UNIQUE(book_id,approval_id),
 FOREIGN KEY(book_id,plan_id) REFERENCES openerp.commerce_allocation_reversal_plans,
 FOREIGN KEY(book_id,approval_id) REFERENCES openerp.commerce_allocation_reversal_approvals,
 FOREIGN KEY(book_id,receipt_id) REFERENCES openerp.commerce_allocation_receipts(book_id,id)
);
CREATE INDEX commerce_unallocation_target ON openerp.commerce_allocation_reversal_plans(book_id,receipt_id);
-- New reports retain a private allocation-history basis without changing historical report bytes.
CREATE TABLE openerp.commerce_register_allocation_dependencies (
 book_id text NOT NULL,report_id text NOT NULL,history_version numeric NOT NULL CHECK(history_version>=0),
 PRIMARY KEY(book_id,report_id),
 FOREIGN KEY(book_id,report_id) REFERENCES openerp.commerce_register_snapshots(book_id,id)
);
CREATE TRIGGER immutable_commerce_register_allocation_dependency BEFORE UPDATE OR DELETE ON openerp.commerce_register_allocation_dependencies
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.commerce_register_allocation_dependencies FROM PUBLIC,openerp_runtime;
CREATE FUNCTION openerp.commerce_allocation_history_version(p_book text,p_ends date) RETURNS numeric
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
 SELECT count(*)::numeric+count(r.plan_id)::numeric FROM openerp.commerce_allocation_legs l
 JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.payment_voucher_id)
 LEFT JOIN openerp.commerce_allocation_reversals r ON (r.book_id,r.receipt_id)=(l.book_id,l.receipt_id)
 WHERE l.book_id=p_book AND v.posting_date<=p_ends
$$;
REVOKE ALL ON FUNCTION openerp.commerce_allocation_history_version(text,date) FROM PUBLIC,openerp_runtime;

CREATE TRIGGER immutable_commerce_allocation_reversal_plans BEFORE UPDATE OR DELETE ON openerp.commerce_allocation_reversal_plans
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversal_approvals BEFORE UPDATE OR DELETE ON openerp.commerce_allocation_reversal_approvals
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversal_revocations BEFORE UPDATE OR DELETE ON openerp.commerce_allocation_reversal_revocations
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversals BEFORE UPDATE OR DELETE ON openerp.commerce_allocation_reversals
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE VIEW openerp.commerce_active_allocation_legs AS
 SELECT l.* FROM openerp.commerce_allocation_legs l WHERE NOT EXISTS (
  SELECT FROM openerp.commerce_allocation_reversals r WHERE r.book_id=l.book_id AND r.receipt_id=l.receipt_id
 );
REVOKE ALL ON openerp.commerce_allocation_reversal_plans,openerp.commerce_allocation_reversal_approvals,
 openerp.commerce_allocation_reversal_revocations,openerp.commerce_allocation_reversals,
 openerp.commerce_active_allocation_legs FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.commerce_allocation_reversal_snapshot(p_book text,p_receipt text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE cr_original jsonb; cr_plan jsonb; cr_book openerp.books; cr_payment jsonb; cr_invoices jsonb:='[]';
 cr_legs jsonb; cr_periods jsonb; cr_account jsonb; cr_invoice jsonb; cr_leg jsonb;
BEGIN
 PERFORM openerp.commerce_require_profile(p_book);
 SELECT * INTO STRICT cr_book FROM openerp.books b WHERE b.id=p_book;
 SELECT r.body,p.body INTO cr_original,cr_plan FROM openerp.commerce_allocation_receipts r
 JOIN openerp.commerce_allocation_plans p ON (p.book_id,p.id)=(r.book_id,r.plan_id)
 WHERE r.book_id=p_book AND r.id=p_receipt;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Choose an applied allocation receipt in this book.'); END IF;
 IF EXISTS(SELECT FROM openerp.commerce_allocation_reversals r WHERE r.book_id=p_book AND r.receipt_id=p_receipt) THEN
  PERFORM openerp.fail('StaleDependency','This whole allocation was already unallocated. Read its immutable reversal receipt.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',l.ordinal,'invoiceId',l.invoice_id,
  'paymentVoucherId',l.payment_voucher_id,'paymentLineId',l.payment_line_id,'amountMinor',l.amount_minor::text)
  ORDER BY l.ordinal),'[]') INTO cr_legs FROM openerp.commerce_allocation_legs l
 WHERE l.book_id=p_book AND l.receipt_id=p_receipt;
 IF jsonb_array_length(cr_legs) NOT BETWEEN 1 AND 50 OR jsonb_array_length(cr_legs)<>jsonb_array_length(cr_plan->'legs') THEN
  PERFORM openerp.fail('StaleDependency','The complete original allocation legs are required. Partial unallocation is unsupported.'); END IF;
 PERFORM openerp.commerce_assert_allocation(p_book,p_receipt);
 -- Both recognition and payment periods remain open. No implicit reopen.
 PERFORM 1 FROM openerp.periods p WHERE p.book_id=p_book AND p.id IN (
  SELECT v.period_id FROM openerp.vouchers v WHERE v.book_id=p_book AND
   (v.id=cr_plan->'payment'->>'voucherId' OR v.id IN (
    SELECT i.recognition_voucher_id FROM openerp.commerce_invoices i
    JOIN openerp.commerce_allocation_legs l ON (l.book_id,l.invoice_id)=(i.book_id,i.id)
    WHERE l.book_id=p_book AND l.receipt_id=p_receipt))) ORDER BY p.id FOR SHARE;
 SELECT jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text,'locked',p.locked) ORDER BY p.id)
 INTO cr_periods FROM openerp.periods p WHERE p.book_id=p_book AND p.id IN (
  SELECT v.period_id FROM openerp.vouchers v WHERE v.book_id=p_book AND
   (v.id=cr_plan->'payment'->>'voucherId' OR v.id IN (
    SELECT i.recognition_voucher_id FROM openerp.commerce_invoices i
    JOIN openerp.commerce_allocation_legs l ON (l.book_id,l.invoice_id)=(i.book_id,i.id)
    WHERE l.book_id=p_book AND l.receipt_id=p_receipt)));
 IF cr_periods IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(cr_periods) p WHERE p->'locked'='true'::jsonb) THEN
  PERFORM openerp.fail('PeriodLocked','Every affected invoice recognition and payment period must be open before unallocation.'); END IF;
 cr_payment:=openerp.commerce_payment_body(p_book,cr_plan->'payment'->>'voucherId',cr_plan->'payment'->>'lineId');
 SELECT jsonb_build_object('id',a.id,'version',a.version::text) INTO cr_account FROM openerp.accounts a
 WHERE a.book_id=p_book AND a.id=cr_payment->>'accountId' AND a.active FOR SHARE;
 IF NOT FOUND THEN PERFORM openerp.fail('StaleDependency','The payment control account must remain active.'); END IF;
 FOR cr_leg IN SELECT value FROM jsonb_array_elements(cr_legs) LOOP
  cr_invoice:=openerp.commerce_invoice_body(p_book,cr_leg->>'invoiceId');
  IF cr_invoice->>'status'='blocked' OR (cr_invoice->>'recordedAllocatedMinor')::numeric<(cr_leg->>'amountMinor')::numeric THEN
   PERFORM openerp.fail('StaleDependency','The invoice allocation capacity is not current.'); END IF;
  cr_invoices:=cr_invoices||jsonb_build_array(jsonb_build_object('invoice',cr_invoice,
   'releasedMinor',cr_leg->>'amountMinor',
   'outstandingAfterMinor',((cr_invoice->>'outstandingMinor')::numeric+(cr_leg->>'amountMinor')::numeric)::text));
 END LOOP;
 RETURN jsonb_build_object('original',cr_original,'originalPlan',cr_plan,'legs',cr_legs,'invoices',cr_invoices,
  'payment',cr_payment,'paymentRemainingAfterMinor',((cr_payment->>'remainingMinor')::numeric+(cr_original->>'totalMinor')::numeric)::text,
  'periods',cr_periods,'account',cr_account,'profileVersion',cr_book.profile_version::text,'writerEpoch',cr_book.writer_epoch::text);
END $$;

CREATE FUNCTION openerp.commerce_allocation_reversal_checked(book text,id text,input jsonb,executing boolean)
RETURNS openerp.commerce_allocation_reversal_plans LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE cr_plan openerp.commerce_allocation_reversal_plans;
BEGIN
 PERFORM openerp.commerce_exact_object(input,CASE WHEN executing THEN ARRAY['version','digest','approvalId'] ELSE ARRAY['version','digest'] END);
 SELECT * INTO cr_plan FROM openerp.commerce_allocation_reversal_plans p WHERE p.book_id=book AND p.id=commerce_allocation_reversal_checked.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The unallocation plan was not found in this book.'); END IF;
 IF input->'version' IS DISTINCT FROM '1'::jsonb OR input->>'digest' IS DISTINCT FROM cr_plan.body->>'digest' THEN
  PERFORM openerp.fail('StaleDependency','Use the exact saved unallocation plan digest and version.'); END IF;
 RETURN cr_plan;
END $$;
CREATE FUNCTION openerp.prepare_commerce_allocation_reversal(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_actor text; cr_previous jsonb; cr_book openerp.books; cr_snapshot jsonb; cr_body jsonb; cr_id text:=openerp.new_id('unallocation');
BEGIN
  cr_actor:=openerp.authorize(token,scope);
  SELECT * INTO STRICT cr_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  cr_previous:=openerp.replay(cr_book.id,key,cr_actor,'prepare_commerce_allocation_reversal',input);
  IF cr_previous IS NOT NULL THEN RETURN cr_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['receiptId','reason']<>'{}'::jsonb
    OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(input->>'reason')),0) NOT BETWEEN 1 AND 2000 OR length(input->>'reason')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Select the original allocation receipt and give a nonblank unallocation reason.'); END IF;
  PERFORM openerp.commerce_text(input,'receiptId',128);
  IF (SELECT count(*) FROM openerp.commerce_allocation_reversal_plans p WHERE p.book_id=cr_book.id AND p.receipt_id=input->>'receiptId')>=50 THEN
    PERFORM openerp.fail('UnsupportedProfile','This receipt already has50 retained unallocation reviews. No partial history is returned.'); END IF;
  cr_snapshot:=openerp.commerce_allocation_reversal_snapshot(cr_book.id,input->>'receiptId');
  cr_body:=jsonb_build_object('id',cr_id,'version',1,'scope',scope,'input',input,'snapshot',cr_snapshot,
    'currency',cr_book.currency,'currencyScale',cr_book.currency_scale,'createdBy',cr_actor,
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  cr_body:=cr_body||jsonb_build_object('digest',openerp.digest(cr_body),
    'receipt',jsonb_build_object('key',key,'operation','prepare_commerce_allocation_reversal','actorId',cr_actor));
  IF octet_length(cr_body::text)>262144 THEN PERFORM openerp.fail('UnsupportedProfile','The complete unallocation review exceeds256 KiB. No partial review was saved.'); END IF;
  INSERT INTO openerp.commerce_allocation_reversal_plans VALUES(cr_book.id,cr_id,input->>'receiptId',cr_body);
  RETURN openerp.save_command(cr_book.id,key,cr_actor,'prepare_commerce_allocation_reversal',input,cr_body);
END $$;

CREATE FUNCTION openerp.approve_commerce_allocation_reversal(token text,scope jsonb,key text,id text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_actor text; cr_previous jsonb; cr_plan openerp.commerce_allocation_reversal_plans; cr_body jsonb;
  cr_id text:=openerp.new_id('unallocationapproval'); cr_expires timestamptz:=clock_timestamp()+interval '1 hour';
  cr_request jsonb:=jsonb_build_object('planId',id,'input',input);
BEGIN
  cr_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  cr_previous:=openerp.replay(scope->>'bookId',key,cr_actor,'approve_commerce_allocation_reversal',cr_request);
  IF cr_previous IS NOT NULL THEN RETURN cr_previous; END IF;
  cr_plan:=openerp.commerce_allocation_reversal_checked(scope->>'bookId',id,input,false);
  IF (SELECT count(*) FROM openerp.commerce_allocation_reversal_approvals a WHERE a.book_id=cr_plan.book_id AND a.plan_id=approve_commerce_allocation_reversal.id)>=50 THEN
    PERFORM openerp.fail('UnsupportedProfile','This review already has50 retained approvals.'); END IF;
  IF openerp.commerce_allocation_reversal_snapshot(cr_plan.book_id,cr_plan.receipt_id) IS DISTINCT FROM cr_plan.body->'snapshot' THEN
    PERFORM openerp.fail('StaleDependency','Allocation capacities, periods or configuration changed. Prepare a new unallocation plan.'); END IF;
  cr_body:=jsonb_build_object('id',cr_id,'planId',id,'digest',input->>'digest','version',1,'actorId',cr_actor,
    'expiresAt',to_char(cr_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','approve_commerce_allocation_reversal','actorId',cr_actor));
  INSERT INTO openerp.commerce_allocation_reversal_approvals VALUES(cr_plan.book_id,cr_id,id,cr_actor,cr_expires,cr_body);
  RETURN openerp.save_command(cr_plan.book_id,key,cr_actor,'approve_commerce_allocation_reversal',cr_request,cr_body);
END $$;

CREATE FUNCTION openerp.revoke_commerce_allocation_reversal_approval(token text,scope jsonb,key text,id text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_actor text; cr_previous jsonb; cr_body jsonb; cr_request jsonb:=jsonb_build_object('approvalId',id,'input',input);
BEGIN
  cr_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  cr_previous:=openerp.replay(scope->>'bookId',key,cr_actor,'revoke_commerce_allocation_reversal_approval',cr_request);
  IF cr_previous IS NOT NULL THEN RETURN cr_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['reason']<>'{}'::jsonb
    OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(input->>'reason')),0) NOT BETWEEN 1 AND 2000 OR length(input->>'reason')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Give a nonblank reason for revoking this approval.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.commerce_allocation_reversal_approvals a WHERE a.book_id=scope->>'bookId' AND a.id=revoke_commerce_allocation_reversal_approval.id) THEN
    PERFORM openerp.fail('NotFound','The unallocation approval was not found in this book.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_allocation_reversals r WHERE r.book_id=scope->>'bookId' AND r.approval_id=revoke_commerce_allocation_reversal_approval.id)
    OR EXISTS(SELECT FROM openerp.commerce_allocation_reversal_revocations r WHERE r.book_id=scope->>'bookId' AND r.approval_id=revoke_commerce_allocation_reversal_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','This approval is already consumed or revoked.'); END IF;
  cr_body:=jsonb_build_object('approvalId',id,'reason',input->>'reason','actorId',cr_actor,
    'revokedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','revoke_commerce_allocation_reversal_approval','actorId',cr_actor));
  INSERT INTO openerp.commerce_allocation_reversal_revocations VALUES(scope->>'bookId',id,cr_body);
  RETURN openerp.save_command(scope->>'bookId',key,cr_actor,'revoke_commerce_allocation_reversal_approval',cr_request,cr_body);
END $$;

CREATE FUNCTION openerp.get_commerce_allocation_reversal(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_plan openerp.commerce_allocation_reversal_plans; cr_approval jsonb; cr_execution jsonb; cr_current boolean:=false; cr_error text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO cr_plan FROM openerp.commerce_allocation_reversal_plans p WHERE p.book_id=scope->>'bookId' AND p.id=get_commerce_allocation_reversal.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The unallocation plan was not found in this book.'); END IF;
  SELECT a.body INTO cr_approval FROM openerp.commerce_allocation_reversal_approvals a JOIN openerp.memberships m
    ON m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator'
    WHERE a.book_id=cr_plan.book_id AND a.plan_id=get_commerce_allocation_reversal.id AND a.expires_at>clock_timestamp()
      AND NOT EXISTS(SELECT FROM openerp.commerce_allocation_reversal_revocations r WHERE r.book_id=a.book_id AND r.approval_id=a.id)
    ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
  SELECT r.body INTO cr_execution FROM openerp.commerce_allocation_reversals r WHERE r.book_id=cr_plan.book_id AND r.plan_id=get_commerce_allocation_reversal.id;
  IF cr_execution IS NULL THEN
    BEGIN cr_current:=openerp.commerce_allocation_reversal_snapshot(cr_plan.book_id,cr_plan.receipt_id)=cr_plan.body->'snapshot';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS cr_error=PG_EXCEPTION_DETAIL;
      IF cr_error IS NULL OR cr_error NOT IN ('StaleDependency','PeriodLocked','UnsupportedProfile','NotFound') THEN RAISE; END IF;
    END;
  END IF;
  RETURN jsonb_build_object('plan',cr_plan.body,'approval',CASE WHEN cr_execution IS NULL THEN cr_approval ELSE NULL END,
    'execution',cr_execution,'dependenciesCurrent',cr_current,
    'approvals',(SELECT coalesce(jsonb_agg(jsonb_build_object('approval',a.body,'revocation',r.body) ORDER BY a.id COLLATE "C"),'[]')
      FROM openerp.commerce_allocation_reversal_approvals a LEFT JOIN openerp.commerce_allocation_reversal_revocations r
      ON (r.book_id,r.approval_id)=(a.book_id,a.id)
      WHERE a.book_id=cr_plan.book_id AND a.plan_id=get_commerce_allocation_reversal.id));
END $$;

CREATE FUNCTION openerp.list_commerce_allocation_reversals(token text,scope jsonb,after_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_items jsonb; cr_last text; cr_next text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF after_id IS NOT NULL AND after_id!~'^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use the returned unallocation continuation identity.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'receiptId',p.receipt_id,'reason',p.body->'input'->>'reason',
    'createdAt',p.body->>'createdAt','execution',r.body) ORDER BY p.id COLLATE "C"),'[]'),max(p.id COLLATE "C") INTO cr_items,cr_last
    FROM (SELECT x.* FROM openerp.commerce_allocation_reversal_plans x WHERE x.book_id=scope->>'bookId'
      AND (after_id IS NULL OR x.id COLLATE "C">after_id COLLATE "C") ORDER BY x.id COLLATE "C" LIMIT 25) p
    LEFT JOIN openerp.commerce_allocation_reversals r ON (r.book_id,r.plan_id)=(p.book_id,p.id);
  IF EXISTS(SELECT FROM openerp.commerce_allocation_reversal_plans p WHERE p.book_id=scope->>'bookId' AND p.id COLLATE "C">cr_last COLLATE "C") THEN cr_next:=cr_last; END IF;
  RETURN jsonb_build_object('items',cr_items,'next',cr_next);
END $$;

CREATE FUNCTION openerp.execute_commerce_allocation_reversal(token text,scope jsonb,key text,id text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_actor text; cr_previous jsonb; cr_plan openerp.commerce_allocation_reversal_plans;
 cr_approval openerp.commerce_allocation_reversal_approvals; cr_body jsonb;
 cr_request jsonb:=jsonb_build_object('planId',id,'input',input);
BEGIN
 cr_actor:=openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 cr_previous:=openerp.replay(scope->>'bookId',key,cr_actor,'execute_commerce_allocation_reversal',cr_request);
 IF cr_previous IS NOT NULL THEN RETURN cr_previous; END IF;
 cr_plan:=openerp.commerce_allocation_reversal_checked(scope->>'bookId',id,input,true);
 SELECT r.body INTO cr_body FROM openerp.commerce_allocation_reversals r WHERE r.book_id=cr_plan.book_id AND r.plan_id=execute_commerce_allocation_reversal.id;
 IF cr_body IS NOT NULL THEN
  IF cr_body->>'approvalId' IS DISTINCT FROM input->>'approvalId' THEN
   PERFORM openerp.fail('ApprovalRequired','Recover the original unallocation approval and receipt.'); END IF;
  RETURN openerp.save_command(cr_plan.book_id,key,cr_actor,'execute_commerce_allocation_reversal',cr_request,cr_body);
 END IF;
 IF openerp.commerce_allocation_reversal_snapshot(cr_plan.book_id,cr_plan.receipt_id) IS DISTINCT FROM cr_plan.body->'snapshot' THEN
  PERFORM openerp.fail('StaleDependency','Allocation capacities, invoice revisions, periods or configuration changed. Prepare and approve a new plan.'); END IF;
 SELECT * INTO cr_approval FROM openerp.commerce_allocation_reversal_approvals a
 WHERE a.book_id=cr_plan.book_id AND a.id=input->>'approvalId' AND a.plan_id=execute_commerce_allocation_reversal.id FOR UPDATE;
 IF NOT FOUND OR cr_approval.expires_at<=clock_timestamp() OR cr_approval.body->>'digest' IS DISTINCT FROM input->>'digest'
  OR EXISTS(SELECT FROM openerp.commerce_allocation_reversal_revocations r WHERE r.book_id=cr_plan.book_id AND r.approval_id=cr_approval.id) THEN
  PERFORM openerp.fail('ApprovalRequired','A current unrevoked human approval of this exact unallocation is required.'); END IF;
 PERFORM 1 FROM openerp.memberships m WHERE m.book_id=cr_plan.book_id AND m.actor_id=cr_approval.actor_id AND m.role='operator' FOR SHARE;
 IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approving operator no longer has book authority.'); END IF;
 cr_body:=jsonb_build_object('planId',id,'digest',input->>'digest','version',1,'approvalId',cr_approval.id,
  'scope',scope,'receiptId',cr_plan.receipt_id,'reason',cr_plan.body->'input'->>'reason',
  'releasedLegs',cr_plan.body->'snapshot'->'legs','totalMinor',cr_plan.body->'snapshot'->'original'->>'totalMinor',
  'ledgerChanged',false,'paymentInitiated',false,
  'executedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'receipt',jsonb_build_object('key',key,'operation','execute_commerce_allocation_reversal','actorId',cr_actor));
 INSERT INTO openerp.commerce_allocation_reversals VALUES(cr_plan.book_id,id,cr_approval.id,cr_plan.receipt_id,cr_body);
 RETURN openerp.save_command(cr_plan.book_id,key,cr_actor,'execute_commerce_allocation_reversal',cr_request,cr_body);
END $$;

-- Effective capacity consumers. Historical application inserts/receipts are unchanged.
CREATE OR REPLACE FUNCTION openerp.commerce_invoice_body(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_invoice openerp.commerce_invoices; v_revision jsonb; v_allocated numeric; v_count bigint; v_blockers jsonb := '[]';
BEGIN
  SELECT * INTO v_invoice FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The invoice is not registered in this book.'); END IF;
  SELECT r.body INTO STRICT v_revision FROM openerp.commerce_invoice_revisions r
    WHERE r.book_id=p_book AND r.invoice_id=p_id AND r.revision=v_invoice.current_revision;
  SELECT coalesce(sum(l.amount_minor),0),count(*) INTO v_allocated,v_count FROM openerp.commerce_active_allocation_legs l
    WHERE l.book_id=p_book AND l.invoice_id=p_id;
  SELECT count(*)+(SELECT count(*) FROM openerp.commerce_allocation_legs l
    JOIN openerp.commerce_allocation_reversals r ON (r.book_id,r.receipt_id)=(l.book_id,l.receipt_id)
    WHERE l.book_id=p_book AND l.invoice_id=p_id) INTO v_count
    FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.invoice_id=p_id;
  IF NOT openerp.commerce_voucher_current(p_book,v_invoice.recognition_voucher_id) THEN
    v_blockers:=v_blockers||jsonb_build_array('The retained recognition voucher was corrected.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.invoice_id=p_id
    AND NOT openerp.commerce_voucher_current(p_book,l.payment_voucher_id)) THEN
    v_blockers:=v_blockers||jsonb_build_array('A retained allocation payment voucher was corrected.'); END IF;
  IF v_allocated>v_invoice.amount_minor THEN v_blockers:=v_blockers||jsonb_build_array('Recorded allocations exceed the invoice amount.'); END IF;
  RETURN v_invoice.body||jsonb_build_object('currentRevision',v_revision,'allocationVersion',v_count::text,
    'recordedAllocatedMinor',v_allocated::text,'outstandingMinor',CASE WHEN v_blockers='[]'::jsonb THEN to_jsonb((v_invoice.amount_minor-v_allocated)::text) ELSE 'null'::jsonb END,
    'status',CASE WHEN v_blockers<>'[]'::jsonb THEN 'blocked' WHEN v_allocated=0 THEN 'open' WHEN v_allocated=v_invoice.amount_minor THEN 'allocated' ELSE 'partially_allocated' END,
    'blockers',v_blockers);
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_payment_body(p_book text,p_voucher text,p_line text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_line openerp.journal_lines; v_voucher openerp.vouchers; v_book openerp.books; v_direction text;
  v_amount numeric; v_allocated numeric; v_count bigint;
BEGIN
  SELECT * INTO v_line FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=p_voucher AND l.id=p_line;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select an existing posted control-account line in this book.'); END IF;
  SELECT c.direction INTO v_direction FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=v_line.account_id;
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','The line account has not been explicitly registered as a commerce control account.'); END IF;
  SELECT * INTO STRICT v_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher;
  IF NOT openerp.commerce_voucher_current(p_book,p_voucher)
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher AND i.recognition_line_id=p_line)
    OR (v_direction='customer' AND v_line.credit_minor=0) OR (v_direction='supplier' AND v_line.debit_minor=0) THEN
    PERFORM openerp.fail('InvalidJournal','Use a current opposite-side settlement line, never recognition or reversal.'); END IF;
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
  v_amount:=v_line.debit_minor+v_line.credit_minor;
  SELECT coalesce(sum(l.amount_minor),0),count(*) INTO v_allocated,v_count FROM openerp.commerce_active_allocation_legs l
    WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line;
  SELECT count(*)+(SELECT count(*) FROM openerp.commerce_allocation_legs l
    JOIN openerp.commerce_allocation_reversals r ON (r.book_id,r.receipt_id)=(l.book_id,l.receipt_id)
    WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line) INTO v_count
    FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line;
  IF v_allocated>v_amount THEN PERFORM openerp.fail('StaleDependency','Payment allocations exceed the posted control-line capacity.'); END IF;
  RETURN jsonb_build_object('voucherId',p_voucher,'lineId',p_line,'scope',jsonb_build_object('bookId',p_book,'entityId',v_book.entity_id),
    'direction',v_direction,'accountId',v_line.account_id,'postingDate',v_voucher.posting_date::text,'currency',v_book.currency,
    'currencyScale',v_book.currency_scale,'amountMinor',v_amount::text,'allocatedMinor',v_allocated::text,
    'remainingMinor',(v_amount-v_allocated)::text,'capacityVersion',v_count::text);
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_create_invoice(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_body jsonb; v_revision jsonb; v_evidence jsonb;
  v_party openerp.commerce_counterparties; v_party_body jsonb; v_line openerp.journal_lines; v_voucher openerp.vouchers;
  v_book openerp.books; v_issued date; v_due date; v_amount numeric; v_number text; v_id text:=openerp.new_id('invoice'); v_direction text;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'commerce_create_invoice',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(v_book.id);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['kind','direction','counterpartyId','counterpartyRevision','documentNumber','issuedOn','dueOn','currency','amountMinor','controlAccountId','recognitionVoucherId','recognitionLineId','evidenceId','description']);
  IF p_input->>'kind' IS DISTINCT FROM 'synthetic_invoice_v1' OR coalesce(p_input->>'direction','') NOT IN ('customer','supplier')
    OR p_input->>'currency' IS DISTINCT FROM v_book.currency THEN
    PERFORM openerp.fail('InvalidJournal','Supply a synthetic customer or supplier invoice in the exact book currency.'); END IF;
  v_direction:=p_input->>'direction'; v_number:=openerp.commerce_text(p_input,'documentNumber',200);
  PERFORM openerp.commerce_text(p_input,'description',2000);
  v_issued:=openerp.bank_date(p_input->>'issuedOn'); v_due:=openerp.bank_date(p_input->>'dueOn');
  IF v_due<v_issued THEN PERFORM openerp.fail('InvalidJournal','The due date cannot precede the issue date.'); END IF;
  v_amount:=openerp.commerce_positive_minor(p_input,'amountMinor');
  v_evidence:=openerp.commerce_evidence(v_book.id,p_input->>'evidenceId');
  SELECT * INTO v_party FROM openerp.commerce_counterparties c WHERE c.book_id=v_book.id AND c.id=p_input->>'counterpartyId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Register the counterpart in this book first.'); END IF;
  IF openerp.commerce_text(p_input,'counterpartyRevision',18) IS DISTINCT FROM v_party.current_revision::text THEN
    PERFORM openerp.fail('StaleDependency','Use the reviewed current counterpart revision.'); END IF;
  IF v_party.role NOT IN (v_direction,'both') THEN PERFORM openerp.fail('InvalidJournal','The counterpart role does not support this invoice direction.'); END IF;
  SELECT r.body INTO STRICT v_party_body FROM openerp.commerce_counterparty_revisions r
    WHERE r.book_id=v_book.id AND r.counterparty_id=v_party.id AND r.revision=v_party.current_revision;
  SELECT * INTO v_line FROM openerp.journal_lines l WHERE l.book_id=v_book.id
    AND l.voucher_id=p_input->>'recognitionVoucherId' AND l.id=p_input->>'recognitionLineId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Choose an existing posted recognition line in this book.'); END IF;
  SELECT * INTO STRICT v_voucher FROM openerp.vouchers v WHERE v.book_id=v_book.id AND v.id=v_line.voucher_id;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=v_book.id AND p.id=v_voucher.period_id AND NOT p.locked FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('PeriodLocked','New registration in a locked recognition period is unsupported.'); END IF;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=v_book.id AND a.id=p_input->>'controlAccountId' AND a.active FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Choose an active explicitly declared control account.'); END IF;
  IF v_line.account_id IS DISTINCT FROM p_input->>'controlAccountId'
    OR (v_direction='customer' AND (v_line.debit_minor<>v_amount OR v_line.credit_minor<>0))
    OR (v_direction='supplier' AND (v_line.credit_minor<>v_amount OR v_line.debit_minor<>0))
    OR NOT openerp.commerce_voucher_current(v_book.id,v_voucher.id)
    OR v_voucher.posting_date<v_issued THEN
    PERFORM openerp.fail('InvalidJournal','Recognition must be current, exact in account, direction and amount, and not before invoice issue.'); END IF;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(v_voucher.action->'evidenceRefs') ref
    WHERE ref->>'evidenceId'=v_evidence->>'evidenceId' AND ref->>'sha256'=v_evidence->>'sha256') THEN
    PERFORM openerp.fail('MissingEvidence','The posted recognition must retain this original invoice evidence.'); END IF;
  IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=v_book.id AND s.account_id=v_line.account_id) THEN
    PERFORM openerp.fail('InvalidJournal','A bank source account cannot also be a commerce control account.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=v_book.id AND
    ((i.direction=v_direction AND i.counterparty_id=v_party.id AND i.document_number=v_number)
      OR (i.recognition_voucher_id=v_line.voucher_id AND i.recognition_line_id=v_line.id)))
    OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=v_book.id AND l.payment_voucher_id=v_line.voucher_id AND l.payment_line_id=v_line.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This invoice identity or posted line is already bound. No duplicate registration is created.'); END IF;
  INSERT INTO openerp.commerce_control_accounts VALUES(v_book.id,v_line.account_id,v_direction) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=v_book.id AND c.account_id=v_line.account_id AND c.direction=v_direction) THEN
    PERFORM openerp.fail('InvalidJournal','Customer and supplier control-account classifications cannot be mixed.'); END IF;
  v_body:=jsonb_build_object('id',v_id,'scope',p_scope,'kind','synthetic_invoice_v1','direction',v_direction,
    'counterpartyId',v_party.id,'counterpartyRevision',v_party.current_revision::text,'counterpartyName',v_party_body->>'displayName',
    'documentNumber',v_number,'issuedOn',v_issued::text,'currency',v_book.currency,'currencyScale',v_book.currency_scale,
    'amountMinor',v_amount::text,'controlAccountId',v_line.account_id,'evidence',v_evidence,
    'recognition',jsonb_build_object('voucherId',v_voucher.id,'lineId',v_line.id,'eventId',v_voucher.event_id,'postingDate',v_voucher.posting_date::text));
  v_revision:=jsonb_build_object('id',v_id,'scope',p_scope,'revision','1','dueOn',v_due::text,'description',p_input->>'description',
    'evidence',v_evidence,'reason','Initial evidence-backed registration')||openerp.commerce_record_metadata(p_key,'commerce_create_invoice',v_actor);
  INSERT INTO openerp.commerce_invoices VALUES(v_book.id,v_id,v_direction,v_party.id,v_party.current_revision,v_number,v_issued,v_amount,
    v_line.account_id,v_voucher.id,v_line.id,p_input->>'evidenceId',1,v_body);
  INSERT INTO openerp.commerce_invoice_revisions VALUES(v_book.id,v_id,1,p_input->>'evidenceId',v_revision);
  v_result:=openerp.commerce_invoice_body(v_book.id,v_id);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'commerce_create_invoice',p_input,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_guard_voucher_reversal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=NEW.book_id AND i.recognition_voucher_id=NEW.corrects_voucher_id)
      OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=NEW.book_id AND l.payment_voucher_id=NEW.corrects_voucher_id) THEN
      PERFORM openerp.fail('StaleDependency','The voucher retains invoice recognition or active payment allocations. Unallocate active payments first; invoice recognition correction remains unsupported.');
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_period_status(p_book text,p_starts date,p_ends date) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_registered bigint; v_recognition_invalid bigint; v_allocation_invalid bigint; v_conservation_invalid bigint;
  v_sources jsonb; v_legs jsonb; v_reversals jsonb; v_book openerp.books; v_blockers jsonb:='[]';
BEGIN
  IF p_starts IS NULL OR p_ends IS NULL OR p_starts>p_ends THEN PERFORM openerp.fail('InvalidJournal','Choose an ordered commerce inventory interval.'); END IF;
  SELECT * INTO v_book FROM openerp.books b WHERE b.id=p_book;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The book was not found.'); END IF;
  SELECT count(*),count(*) FILTER (WHERE NOT openerp.commerce_voucher_current(p_book,v.id)
    OR j.account_id<>i.control_account_id OR (i.direction='customer' AND j.debit_minor<>i.amount_minor)
    OR (i.direction='supplier' AND j.credit_minor<>i.amount_minor)),
    coalesce(jsonb_agg(i.body ORDER BY i.id COLLATE "C"),'[]') INTO v_registered,v_recognition_invalid,v_sources
    FROM openerp.commerce_invoices i JOIN openerp.vouchers v ON v.book_id=i.book_id AND v.id=i.recognition_voucher_id
    JOIN openerp.journal_lines j ON j.book_id=i.book_id AND j.voucher_id=i.recognition_voucher_id AND j.id=i.recognition_line_id
    WHERE i.book_id=p_book AND v.posting_date<=p_ends;
  SELECT count(*) FILTER (WHERE NOT openerp.commerce_voucher_current(p_book,v.id) OR j.account_id<>i.control_account_id
    OR (i.direction='customer' AND j.credit_minor=0) OR (i.direction='supplier' AND j.debit_minor=0)
    OR v.event_id=recognition.event_id OR v.posting_date<recognition.posting_date),
    coalesce(jsonb_agg(jsonb_build_object('receiptId',l.receipt_id,'ordinal',l.ordinal,'invoiceId',l.invoice_id,
      'voucherId',l.payment_voucher_id,'lineId',l.payment_line_id,'postingDate',v.posting_date::text,
      'amountMinor',l.amount_minor::text,'planDigest',r.body->>'planDigest') ORDER BY l.receipt_id COLLATE "C",l.ordinal),'[]')
    INTO v_allocation_invalid,v_legs FROM openerp.commerce_active_allocation_legs l
    JOIN openerp.commerce_allocation_receipts r ON r.book_id=l.book_id AND r.id=l.receipt_id
    JOIN openerp.commerce_invoices i ON i.book_id=l.book_id AND i.id=l.invoice_id
    JOIN openerp.vouchers recognition ON recognition.book_id=i.book_id AND recognition.id=i.recognition_voucher_id
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.payment_voucher_id
    JOIN openerp.journal_lines j ON j.book_id=l.book_id AND j.voucher_id=l.payment_voucher_id AND j.id=l.payment_line_id
    WHERE l.book_id=p_book AND v.posting_date<=p_ends;
  SELECT count(*) INTO v_conservation_invalid FROM (
    SELECT i.id FROM openerp.commerce_invoices i JOIN openerp.commerce_active_allocation_legs l ON l.book_id=i.book_id AND l.invoice_id=i.id
      JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.payment_voucher_id
      WHERE i.book_id=p_book AND v.posting_date<=p_ends GROUP BY i.id,i.amount_minor HAVING sum(l.amount_minor)>i.amount_minor
    UNION ALL
    SELECT j.id FROM openerp.journal_lines j JOIN openerp.commerce_active_allocation_legs l
      ON l.book_id=j.book_id AND l.payment_voucher_id=j.voucher_id AND l.payment_line_id=j.id
      JOIN openerp.vouchers v ON v.book_id=j.book_id AND v.id=j.voucher_id
      WHERE j.book_id=p_book AND v.posting_date<=p_ends GROUP BY j.voucher_id,j.id,j.debit_minor,j.credit_minor HAVING sum(l.amount_minor)>j.debit_minor+j.credit_minor
  ) invalid;
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.plan_id COLLATE "C"),'[]') INTO v_reversals
    FROM openerp.commerce_allocation_reversals r WHERE r.book_id=p_book AND EXISTS(
      SELECT FROM openerp.commerce_allocation_legs l JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.payment_voucher_id)
      WHERE l.book_id=r.book_id AND l.receipt_id=r.receipt_id AND v.posting_date<=p_ends);
  IF v_recognition_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered invoice recognition is invalid or reversed.'); END IF;
  IF v_allocation_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered payment allocations have invalid or reversed references.'); END IF;
  IF v_conservation_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered allocation capacities are inconsistent.'); END IF;
  RETURN jsonb_build_object('schemaVersion',1,'coverage','not_established','startsOn',p_starts::text,'endsOn',p_ends::text,
    'registeredInvoiceCount',v_registered,'invalidRecognitionCount',v_recognition_invalid,'invalidAllocationCount',v_allocation_invalid,
    'conservationFailureCount',v_conservation_invalid,'sourceDigest',openerp.digest(jsonb_build_object(
      'scope',jsonb_build_object('bookId',p_book,'entityId',v_book.entity_id),'currency',v_book.currency,'currencyScale',v_book.currency_scale,
      'startsOn',p_starts::text,'endsOn',p_ends::text,'invoices',v_sources,'allocations',v_legs)
      ||CASE WHEN v_reversals='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('unallocations',v_reversals) END),'blockers',v_blockers);
END $$;

CREATE OR REPLACE FUNCTION openerp.owner_guard_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE v_voucher text; v_line text;
BEGIN
 PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
 IF TG_TABLE_NAME='owner_effects' THEN
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=NEW.book_id AND i.recognition_voucher_id=NEW.voucher_id AND i.recognition_line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=NEW.book_id AND l.payment_voucher_id=NEW.voucher_id AND l.payment_line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.bank_active_matches m WHERE m.book_id=NEW.book_id AND m.voucher_id=NEW.voucher_id AND m.line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.bank_active_allocation_legs l WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.line_id=NEW.line_id) THEN
   PERFORM openerp.fail('StaleDependency','This posted line is already used by commerce or bank matching.'); END IF;
 ELSE
  IF TG_TABLE_NAME='commerce_invoices' THEN v_voucher:=NEW.recognition_voucher_id; v_line:=NEW.recognition_line_id;
  ELSIF TG_TABLE_NAME='commerce_allocation_legs' THEN v_voucher:=NEW.payment_voucher_id; v_line:=NEW.payment_line_id;
  ELSE v_voucher:=NEW.voucher_id; v_line:=NEW.line_id; END IF;
  IF EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=NEW.book_id AND e.voucher_id=v_voucher AND e.line_id=v_line) THEN PERFORM openerp.fail('StaleDependency','This posted control line already belongs to an owner source.'); END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION openerp.correction_impact_resources(p_book text,p_voucher text,p_date date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_resources jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.id,'detail',r.detail,'path',r.path,'blocks',r.blocks)
      ORDER BY r.kind,r.id,r.detail),'[]') INTO ci_resources FROM (
    SELECT 'bank_match' kind,m.statement_id id,'Retained bank match: row '||m.row_ordinal::text||', line '||m.line_id||'. Unmatch this active relationship before correcting the voucher.' detail,
      '/bank-statements/'||m.statement_id path,true blocks FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',a.plan_id,'Applied bank allocation: row '||a.row_ordinal::text||', line '||a.line_id||'. Unmatch this active allocation before correcting the voucher.',
      '/bank-allocation-plans/'||a.plan_id,true FROM openerp.bank_active_allocation_legs a WHERE a.book_id=p_book AND a.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',p.id,'Unexecuted bank allocation plan references this voucher. It must revalidate after any correction.',
      '/bank-allocation-plans/'||p.id,false FROM openerp.bank_allocation_plans p WHERE p.book_id=p_book
      AND NOT EXISTS(SELECT FROM openerp.bank_allocation_executions e WHERE e.book_id=p.book_id AND e.plan_id=p.id)
      AND EXISTS(SELECT FROM jsonb_array_elements(p.input->'legs') item(leg) WHERE leg->>'voucherId'=p_voucher)
    UNION ALL SELECT 'invoice',i.id,'Registered invoice recognition, line '||i.recognition_line_id||'. Use the commerce owner; generic release is unavailable.',
      '/commerce/invoices/'||i.id,true FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',a.receipt_id,'Applied invoice payment, invoice '||a.invoice_id||', line '||a.payment_line_id||'. Unallocate this active whole application before correcting the payment voucher.',
      '/commerce/invoices/'||a.invoice_id,true FROM openerp.commerce_active_allocation_legs a WHERE a.book_id=p_book AND a.payment_voucher_id=p_voucher
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
  -- Keep the original resource shape unchanged when no owner record is affected.
  -- The enclosing basis comparison binds these digests at seal/approve/execute.
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind',resource->>'id',resource->>'detail'),'[]') INTO ci_resources
    FROM jsonb_array_elements(ci_resources||openerp.correction_owner_impact_resources(p_book,p_voucher)) item(resource);
  IF jsonb_array_length(ci_resources)>1000 THEN PERFORM openerp.fail('UnsupportedProfile','This impact exceeds1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN ci_resources;
END $$;

CREATE OR REPLACE FUNCTION openerp.create_register_report(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_date date; v_result jsonb;
  v_invoices jsonb; v_allocations jsonb; v_lines jsonb; v_controls jsonb;
  v_invoice_count integer; v_allocation_count integer; v_line_count integer; v_account_count integer;
  v_ordinal bigint;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'create_register_report',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(v_book.id);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['asOfDate']);
  IF jsonb_typeof(p_input->'asOfDate') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Choose an as-of date in YYYY-MM-DD format.');
  END IF;
  v_date:=openerp.bank_date(p_input->>'asOfDate');

  -- Count only to the rejection boundary before building any snapshot arrays.
  SELECT count(*) INTO v_account_count FROM (
    SELECT 1 FROM openerp.commerce_control_accounts c WHERE c.book_id=v_book.id LIMIT 101
  ) bounded;
  SELECT count(*) INTO v_invoice_count FROM (
    SELECT 1 FROM openerp.commerce_invoices i JOIN openerp.vouchers v
      ON v.book_id=i.book_id AND v.id=i.recognition_voucher_id
      WHERE i.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence LIMIT 2001
  ) bounded;
  SELECT count(*) INTO v_allocation_count FROM (
    SELECT 1 FROM openerp.commerce_active_allocation_legs l JOIN openerp.vouchers v
      ON v.book_id=l.book_id AND v.id=l.payment_voucher_id
      WHERE l.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence LIMIT 2001
  ) bounded;
  SELECT count(*) INTO v_line_count FROM (
    SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
      JOIN openerp.commerce_control_accounts c ON c.book_id=l.book_id AND c.account_id=l.account_id
      WHERE l.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence LIMIT 2001
  ) bounded;
  IF v_account_count>100 OR v_invoice_count+v_allocation_count+v_line_count>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Register snapshots support at most 100 declared accounts and 2000 combined invoices, allocation legs and ledger lines. No partial snapshot was saved.');
  END IF;

  IF EXISTS(SELECT FROM openerp.commerce_invoices i
    JOIN openerp.vouchers v ON v.book_id=i.book_id AND v.id=i.recognition_voucher_id
    JOIN openerp.journal_lines j ON j.book_id=i.book_id AND j.voucher_id=v.id AND j.id=i.recognition_line_id
    WHERE i.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence
      AND (NOT openerp.commerce_voucher_current(v_book.id,v.id) OR j.account_id<>i.control_account_id
        OR i.body->>'currency' IS DISTINCT FROM v_book.currency
        OR (i.direction='customer' AND (j.debit_minor<>i.amount_minor OR j.credit_minor<>0))
        OR (i.direction='supplier' AND (j.credit_minor<>i.amount_minor OR j.debit_minor<>0)))) THEN
    PERFORM openerp.fail('InvalidJournal','A selected invoice has invalid recognition. Resolve the linked register before reporting.');
  END IF;
  IF EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l
    JOIN openerp.commerce_invoices i ON i.book_id=l.book_id AND i.id=l.invoice_id
    JOIN openerp.vouchers recognition ON recognition.book_id=i.book_id AND recognition.id=i.recognition_voucher_id
    JOIN openerp.vouchers payment ON payment.book_id=l.book_id AND payment.id=l.payment_voucher_id
    JOIN openerp.journal_lines j ON j.book_id=l.book_id AND j.voucher_id=payment.id AND j.id=l.payment_line_id
    WHERE l.book_id=v_book.id AND payment.posting_date<=v_date AND payment.sequence<=v_book.committed_sequence
      AND (NOT openerp.commerce_voucher_current(v_book.id,payment.id) OR j.account_id<>i.control_account_id
        OR recognition.posting_date>payment.posting_date OR recognition.sequence>v_book.committed_sequence
        OR recognition.event_id=payment.event_id
        OR (i.direction='customer' AND (j.credit_minor=0 OR j.debit_minor<>0))
        OR (i.direction='supplier' AND (j.debit_minor=0 OR j.credit_minor<>0)))) THEN
    PERFORM openerp.fail('InvalidJournal','A selected allocation has invalid payment or recognition links. Resolve the register before reporting.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'receiptId',l.receipt_id,'ordinal',l.ordinal,'invoiceId',l.invoice_id,
    'paymentVoucherId',l.payment_voucher_id,'paymentLineId',l.payment_line_id,
    'postingDate',v.posting_date::text,'amountMinor',l.amount_minor::text,
    'planId',r.plan_id,'planDigest',r.body->>'planDigest','committedAt',r.body->>'committedAt'
  ) ORDER BY l.receipt_id COLLATE "C",l.ordinal),'[]') INTO v_allocations
    FROM openerp.commerce_active_allocation_legs l
    JOIN openerp.commerce_allocation_receipts r ON r.book_id=l.book_id AND r.id=l.receipt_id
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.payment_voucher_id
    WHERE l.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'direction',i.direction,'counterpartyId',i.counterparty_id,
    'counterpartyRevision',i.counterparty_revision::text,'counterpartyName',i.body->>'counterpartyName',
    'documentNumber',i.document_number,'issuedOn',i.issued_on::text,'amountMinor',i.amount_minor::text,
    'controlAccountId',i.control_account_id,'evidence',i.body->'evidence','recognition',i.body->'recognition',
    'revision',r.body,'allocatedMinor',paid.amount::text,'outstandingMinor',(i.amount_minor-paid.amount)::text,
    'daysOverdue',greatest(v_date-(r.body->>'dueOn')::date,0),
    'ageBucket',CASE WHEN v_date<=(r.body->>'dueOn')::date THEN 'not_due'
      WHEN v_date-(r.body->>'dueOn')::date<=30 THEN 'days_1_30'
      WHEN v_date-(r.body->>'dueOn')::date<=60 THEN 'days_31_60'
      WHEN v_date-(r.body->>'dueOn')::date<=90 THEN 'days_61_90' ELSE 'over_90' END
  ) ORDER BY i.id COLLATE "C"),'[]') INTO v_invoices
    FROM openerp.commerce_invoices i
    JOIN openerp.commerce_invoice_revisions r ON r.book_id=i.book_id AND r.invoice_id=i.id AND r.revision=i.current_revision
    JOIN openerp.vouchers v ON v.book_id=i.book_id AND v.id=i.recognition_voucher_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((a->>'amountMinor')::numeric),0) AS amount FROM jsonb_array_elements(v_allocations) a
        WHERE a->>'invoiceId'=i.id
    ) paid
    WHERE i.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence;
  IF EXISTS(SELECT FROM jsonb_array_elements(v_invoices) i WHERE (i->>'outstandingMinor')::numeric<0) THEN
    PERFORM openerp.fail('InvalidJournal','Recorded allocations exceed a selected invoice amount. No snapshot was saved.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'accountId',l.account_id,'voucherId',v.id,'lineId',l.id,'sequence',v.sequence::text,'ordinal',l.ordinal,
    'postingDate',v.posting_date::text,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,
    'invoiceId',invoice.value->>'id','allocatedMinor',paid.amount::text,
    'registerEffectMinor',(coalesce((invoice.value->>'amountMinor')::numeric,0)-paid.amount)::text,
    'unexplainedMinor',((CASE WHEN c.direction='customer' THEN l.debit_minor-l.credit_minor ELSE l.credit_minor-l.debit_minor END)
      -coalesce((invoice.value->>'amountMinor')::numeric,0)+paid.amount)::text
  ) ORDER BY v.sequence,l.ordinal),'[]') INTO v_lines
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    JOIN openerp.commerce_control_accounts c ON c.book_id=l.book_id AND c.account_id=l.account_id
    LEFT JOIN LATERAL (
      SELECT i AS value FROM jsonb_array_elements(v_invoices) i
        WHERE i->'recognition'->>'voucherId'=v.id AND i->'recognition'->>'lineId'=l.id
    ) invoice ON true
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((a->>'amountMinor')::numeric),0) AS amount FROM jsonb_array_elements(v_allocations) a
        WHERE a->>'paymentVoucherId'=v.id AND a->>'paymentLineId'=l.id
    ) paid
    WHERE l.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence;
  IF EXISTS(SELECT FROM jsonb_array_elements(v_lines) l
    WHERE (l->>'allocatedMinor')::numeric>(l->>'debitMinor')::numeric+(l->>'creditMinor')::numeric) THEN
    PERFORM openerp.fail('InvalidJournal','Recorded allocations exceed a selected payment line. No snapshot was saved.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'accountId',c.account_id,'code',a.code,'name',a.name,'version',a.version::text,'active',a.active,'direction',c.direction,
    'recognizedMinor',invoices.recognized::text,'allocatedMinor',invoices.allocated::text,
    'outstandingMinor',invoices.outstanding::text,'ledgerMinor',ledger.balance::text,
    'differenceMinor',(ledger.balance-invoices.outstanding)::text,'unexplainedLineCount',ledger.unexplained,
    'ageing',jsonb_build_object('not_due',invoices.not_due::text,'days_1_30',invoices.days_1_30::text,
      'days_31_60',invoices.days_31_60::text,'days_61_90',invoices.days_61_90::text,'over_90',invoices.over_90::text)
  ) ORDER BY c.account_id COLLATE "C"),'[]') INTO v_controls
    FROM openerp.commerce_control_accounts c JOIN openerp.accounts a ON a.book_id=c.book_id AND a.id=c.account_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((i->>'amountMinor')::numeric),0) AS recognized,
        coalesce(sum((i->>'allocatedMinor')::numeric),0) AS allocated,
        coalesce(sum((i->>'outstandingMinor')::numeric),0) AS outstanding,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='not_due'),0) AS not_due,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='days_1_30'),0) AS days_1_30,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='days_31_60'),0) AS days_31_60,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='days_61_90'),0) AS days_61_90,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='over_90'),0) AS over_90
      FROM jsonb_array_elements(v_invoices) i WHERE i->>'controlAccountId'=c.account_id
    ) invoices
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(CASE WHEN c.direction='customer' THEN (l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric
        ELSE (l->>'creditMinor')::numeric-(l->>'debitMinor')::numeric END),0) AS balance,
        count(*) FILTER (WHERE (l->>'unexplainedMinor')::numeric<>0) AS unexplained
      FROM jsonb_array_elements(v_lines) l WHERE l->>'accountId'=c.account_id
    ) ledger WHERE c.book_id=v_book.id;

  IF jsonb_array_length(v_invoices)<>v_invoice_count OR jsonb_array_length(v_allocations)<>v_allocation_count
    OR jsonb_array_length(v_lines)<>v_line_count OR jsonb_array_length(v_controls)<>v_account_count THEN
    PERFORM openerp.fail('InvalidJournal','Selected register records are missing from the materialized basis. No partial snapshot was saved.');
  END IF;
  -- This reporting ordinal is serialized by the book lock; it is not a financial document number.
  SELECT coalesce(max(r.ordinal),0) INTO v_ordinal FROM openerp.commerce_register_snapshots r WHERE r.book_id=v_book.id;
  IF v_ordinal=9223372036854775807 THEN
    PERFORM openerp.fail('InvalidJournal','The register report inventory has reached its ordinal limit.');
  END IF;
  v_ordinal:=v_ordinal+1;
  v_result:=jsonb_build_object('id',openerp.new_id('register_report'),'ordinal',v_ordinal::text,'kind','synthetic_register_snapshot_v1',
    'scope',jsonb_build_object('entityId',v_book.entity_id,'bookId',v_book.id),'asOfDate',v_date::text,
    'sequence',v_book.committed_sequence::text,'currency',v_book.currency,'currencyScale',v_book.currency_scale,
    'profileVersion',v_book.profile_version::text,'knowledgeBasis','current_known_facts_at_capture','coverage','not_established',
    'status',CASE WHEN v_account_count=0 THEN 'no_declared_accounts'
      WHEN EXISTS(SELECT FROM jsonb_array_elements(v_controls) c
        WHERE (c->>'differenceMinor')::numeric<>0 OR (c->>'unexplainedLineCount')::integer<>0) THEN 'differences' ELSE 'balanced' END,
    'invoiceCount',v_invoice_count,'allocationCount',v_allocation_count,'ledgerLineCount',v_line_count,'accountCount',v_account_count,
    'controls',v_controls,'invoices',v_invoices,'allocations',v_allocations,'ledgerLines',v_lines)
    ||openerp.commerce_record_metadata(p_key,'create_register_report',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>2097152 THEN
    PERFORM openerp.fail('InvalidJournal','The register snapshot exceeds the 2 MiB retained report limit. No partial snapshot was saved.');
  END IF;
  INSERT INTO openerp.commerce_register_snapshots VALUES(v_book.id,v_result->>'id',v_ordinal,v_result);
  INSERT INTO openerp.commerce_register_allocation_dependencies VALUES(v_book.id,v_result->>'id',openerp.commerce_allocation_history_version(v_book.id,v_date));
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'create_register_report',p_input,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_assert_allocation(p_book text,p_receipt text) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE v_receipt openerp.commerce_allocation_receipts; v_plan jsonb; v_approval openerp.commerce_allocation_approvals;
  v_expected jsonb; v_actual jsonb;
BEGIN
  SELECT * INTO STRICT v_receipt FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p_book AND r.id=p_receipt;
  SELECT p.body INTO STRICT v_plan FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_book AND p.id=v_receipt.plan_id;
  SELECT * INTO STRICT v_approval FROM openerp.commerce_allocation_approvals a WHERE a.book_id=p_book AND a.id=v_receipt.approval_id;
  SELECT jsonb_agg(jsonb_build_object('invoiceId',l.value->>'invoiceId','amountMinor',l.value->>'amountMinor',
    'voucherId',v_plan->'payment'->>'voucherId','lineId',v_plan->'payment'->>'lineId') ORDER BY l.ordinal)
    INTO v_expected FROM jsonb_array_elements(v_plan->'legs') WITH ORDINALITY l(value,ordinal);
  SELECT jsonb_agg(jsonb_build_object('invoiceId',l.invoice_id,'amountMinor',l.amount_minor::text,
    'voucherId',l.payment_voucher_id,'lineId',l.payment_line_id) ORDER BY l.ordinal)
    INTO v_actual FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt;
  IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_actual OR v_approval.plan_id<>v_receipt.plan_id
    OR v_approval.digest IS DISTINCT FROM v_plan->>'digest' OR v_receipt.body->>'planDigest' IS DISTINCT FROM v_plan->>'digest'
    OR v_receipt.body->>'totalMinor' IS DISTINCT FROM v_plan->>'totalMinor' THEN
    PERFORM openerp.fail('InvalidJournal','Applied allocation legs and receipt must exactly match the approved sealed plan.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book
    AND i.id IN (SELECT l.invoice_id FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt)
    AND (SELECT coalesce(sum(l.amount_minor),0) FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=i.book_id AND l.invoice_id=i.id)>i.amount_minor)
    OR EXISTS(SELECT FROM openerp.journal_lines j WHERE j.book_id=p_book
      AND (j.voucher_id,j.id) IN (SELECT l.payment_voucher_id,l.payment_line_id FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt)
      AND (SELECT coalesce(sum(l.amount_minor),0) FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=j.book_id AND l.payment_voucher_id=j.voucher_id AND l.payment_line_id=j.id)>j.debit_minor+j.credit_minor) THEN
    PERFORM openerp.fail('InvalidJournal','Applied allocations must conserve both invoice and posted payment capacities.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l
    JOIN openerp.commerce_invoices i ON i.book_id=l.book_id AND i.id=l.invoice_id
    JOIN openerp.journal_lines j ON j.book_id=l.book_id AND j.voucher_id=l.payment_voucher_id AND j.id=l.payment_line_id
    JOIN openerp.vouchers payment ON payment.book_id=j.book_id AND payment.id=j.voucher_id
    JOIN openerp.vouchers recognition ON recognition.book_id=i.book_id AND recognition.id=i.recognition_voucher_id
    WHERE l.book_id=p_book AND l.receipt_id=p_receipt AND (j.account_id<>i.control_account_id
      OR (i.direction='customer' AND j.credit_minor=0) OR (i.direction='supplier' AND j.debit_minor=0)
      OR payment.event_id=recognition.event_id OR payment.posting_date<recognition.posting_date
      OR NOT openerp.commerce_voucher_current(p_book,payment.id) OR NOT openerp.commerce_voucher_current(p_book,recognition.id))) THEN
    PERFORM openerp.fail('InvalidJournal','Allocation references must retain distinct current recognition and opposite-side settlement on the same control account.'); END IF;
END $$;

-- Live overlay: historical receipts continue to describe original execution, not current allocation.
CREATE FUNCTION openerp.get_commerce_allocation_status(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_receipt jsonb; cr_reversal jsonb; cr_items jsonb;
BEGIN
 PERFORM openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
 SELECT r.body INTO cr_receipt FROM openerp.commerce_allocation_receipts r WHERE r.book_id=scope->>'bookId' AND r.id=get_commerce_allocation_status.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The applied allocation receipt was not found in this book.'); END IF;
 SELECT r.body INTO cr_reversal FROM openerp.commerce_allocation_reversals r WHERE r.book_id=scope->>'bookId' AND r.receipt_id=get_commerce_allocation_status.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'createdAt',p.body->>'createdAt','reason',p.body->'input'->>'reason') ORDER BY p.id COLLATE "C"),'[]')
 INTO cr_items FROM openerp.commerce_allocation_reversal_plans p WHERE p.book_id=scope->>'bookId' AND p.receipt_id=get_commerce_allocation_status.id;
 RETURN jsonb_build_object('original',cr_receipt,'active',cr_reversal IS NULL,'reversal',cr_reversal,'plans',cr_items);
END $$;

-- Narrow freshness claim only: this does not certify ledger/account/invoice metadata freshness.
CREATE FUNCTION openerp.get_commerce_register_allocation_status(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_report jsonb; cr_current boolean; cr_history numeric;
BEGIN
 PERFORM openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
 SELECT r.body INTO cr_report FROM openerp.commerce_register_snapshots r WHERE r.book_id=scope->>'bookId' AND r.id=get_commerce_register_allocation_status.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The register snapshot was not found in this book.'); END IF;
 SELECT d.history_version INTO cr_history FROM openerp.commerce_register_allocation_dependencies d
 WHERE d.book_id=scope->>'bookId' AND d.report_id=get_commerce_register_allocation_status.id;
 -- Pre1700 reports have no captured release basis. Any relevant release makes them stale.
 cr_current:=CASE WHEN cr_history IS NOT NULL THEN cr_history=openerp.commerce_allocation_history_version(scope->>'bookId',(cr_report->>'asOfDate')::date)
 ELSE NOT EXISTS(SELECT FROM openerp.commerce_allocation_reversals r
  JOIN openerp.commerce_allocation_legs l ON (l.book_id,l.receipt_id)=(r.book_id,r.receipt_id)
  JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.payment_voucher_id)
  WHERE r.book_id=scope->>'bookId' AND v.posting_date<=(cr_report->>'asOfDate')::date) END
 AND NOT EXISTS(SELECT FROM (
  (SELECT l.receipt_id,l.ordinal,l.amount_minor FROM openerp.commerce_active_allocation_legs l
   JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.payment_voucher_id)
   WHERE l.book_id=scope->>'bookId' AND v.posting_date<=(cr_report->>'asOfDate')::date
   EXCEPT SELECT a->>'receiptId',(a->>'ordinal')::integer,(a->>'amountMinor')::numeric FROM jsonb_array_elements(cr_report->'allocations') a)
  UNION ALL
  (SELECT a->>'receiptId',(a->>'ordinal')::integer,(a->>'amountMinor')::numeric FROM jsonb_array_elements(cr_report->'allocations') a
   EXCEPT SELECT l.receipt_id,l.ordinal,l.amount_minor FROM openerp.commerce_active_allocation_legs l
   JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.payment_voucher_id)
   WHERE l.book_id=scope->>'bookId' AND v.posting_date<=(cr_report->>'asOfDate')::date)
 ) changed);
 RETURN jsonb_build_object('reportId',id,'allocationDependenciesCurrent',cr_current,
  'historicalSnapshotUnchanged',true,'otherDependenciesChecked',false);
END $$;

CREATE FUNCTION openerp.commerce_assert_unallocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE cr_plan openerp.commerce_allocation_reversal_plans; cr_approval openerp.commerce_allocation_reversal_approvals;
BEGIN
 SELECT * INTO STRICT cr_plan FROM openerp.commerce_allocation_reversal_plans p WHERE p.book_id=NEW.book_id AND p.id=NEW.plan_id;
 SELECT * INTO STRICT cr_approval FROM openerp.commerce_allocation_reversal_approvals a WHERE a.book_id=NEW.book_id AND a.id=NEW.approval_id;
 IF cr_plan.receipt_id<>NEW.receipt_id OR cr_approval.plan_id<>NEW.plan_id
  OR cr_approval.body->>'digest' IS DISTINCT FROM cr_plan.body->>'digest'
  OR NEW.body->>'digest' IS DISTINCT FROM cr_plan.body->>'digest'
  OR NEW.body->'releasedLegs' IS DISTINCT FROM cr_plan.body->'snapshot'->'legs'
  OR NEW.body->>'totalMinor' IS DISTINCT FROM cr_plan.body->'snapshot'->'original'->>'totalMinor' THEN
  PERFORM openerp.fail('InvalidJournal','The unallocation receipt must release the whole exact approved original application.'); END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER commerce_unallocation_integrity AFTER INSERT ON openerp.commerce_allocation_reversals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_assert_unallocation();
REVOKE ALL ON FUNCTION openerp.prepare_commerce_allocation_reversal(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.approve_commerce_allocation_reversal(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.revoke_commerce_allocation_reversal_approval(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.execute_commerce_allocation_reversal(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_commerce_allocation_reversal(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.list_commerce_allocation_reversals(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_commerce_allocation_status(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_commerce_register_allocation_status(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_allocation_reversal_snapshot(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_allocation_reversal_checked(text,text,jsonb,boolean) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_assert_unallocation() FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_commerce_allocation_reversal(text,jsonb,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.approve_commerce_allocation_reversal(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.revoke_commerce_allocation_reversal_approval(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.execute_commerce_allocation_reversal(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_commerce_allocation_reversal(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_commerce_allocation_reversals(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_commerce_allocation_status(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_commerce_register_allocation_status(text,jsonb,text) TO openerp_runtime;
