-- COM-04: whole native synthetic cancellation. Original issue/draft/register/document bytes stay immutable.
-- An immutable private admission fence cannot commit without its exact final aggregate and kernel receipt.
CREATE TABLE openerp.invoice_cancellation_reviews (
 book_id text NOT NULL,id text NOT NULL,issue_id text NOT NULL,ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
 change_set_id text NOT NULL,body jsonb NOT NULL CHECK(octet_length(body::text)<=262144),
 PRIMARY KEY(book_id,id),UNIQUE(book_id,issue_id,ordinal),UNIQUE(book_id,change_set_id),
 FOREIGN KEY(book_id,issue_id) REFERENCES openerp.invoice_issues,
 FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets,
 CHECK(body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.invoice_cancellation_approvals (
 book_id text NOT NULL,id text NOT NULL,review_id text NOT NULL,ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
 actor_id text NOT NULL REFERENCES openerp.actors,digest text NOT NULL,expires_at timestamptz NOT NULL,body jsonb NOT NULL,
 PRIMARY KEY(book_id,id),UNIQUE(book_id,review_id,ordinal),UNIQUE(book_id,id,review_id),
 FOREIGN KEY(book_id,review_id) REFERENCES openerp.invoice_cancellation_reviews
);
CREATE TABLE openerp.invoice_cancellation_revocations (
 book_id text NOT NULL,approval_id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(book_id,approval_id),
 FOREIGN KEY(book_id,approval_id) REFERENCES openerp.invoice_cancellation_approvals
);
CREATE TABLE openerp.invoice_cancellation_executions (
 book_id text NOT NULL,review_id text NOT NULL,approval_id text NOT NULL,PRIMARY KEY(book_id,review_id),
 UNIQUE(book_id,approval_id),UNIQUE(book_id,review_id,approval_id),
 FOREIGN KEY(book_id,approval_id,review_id) REFERENCES openerp.invoice_cancellation_approvals(book_id,id,review_id)
);
CREATE TABLE openerp.invoice_cancellations (
 book_id text NOT NULL,id text NOT NULL,review_id text NOT NULL,approval_id text NOT NULL,issue_id text NOT NULL,
 register_invoice_id text NOT NULL,original_voucher_id text NOT NULL,reversal_voucher_id text NOT NULL,
 posting_receipt_id text NOT NULL,posting_date date NOT NULL,body jsonb NOT NULL,
 PRIMARY KEY(book_id,id),UNIQUE(book_id,review_id),UNIQUE(book_id,approval_id),UNIQUE(book_id,issue_id),
 UNIQUE(book_id,register_invoice_id),UNIQUE(book_id,original_voucher_id),UNIQUE(book_id,reversal_voucher_id),UNIQUE(book_id,posting_receipt_id),
 FOREIGN KEY(book_id,review_id,approval_id) REFERENCES openerp.invoice_cancellation_executions(book_id,review_id,approval_id),
 FOREIGN KEY(book_id,issue_id) REFERENCES openerp.invoice_issues,
 FOREIGN KEY(book_id,register_invoice_id) REFERENCES openerp.commerce_invoices,
 FOREIGN KEY(book_id,original_voucher_id) REFERENCES openerp.vouchers,
 FOREIGN KEY(book_id,reversal_voucher_id) REFERENCES openerp.vouchers,
 FOREIGN KEY(book_id,posting_receipt_id) REFERENCES openerp.execution_receipts,
 CHECK(body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
ALTER TABLE openerp.invoice_cancellation_executions ADD CONSTRAINT invoice_cancellation_execution_complete
 FOREIGN KEY(book_id,review_id) REFERENCES openerp.invoice_cancellations(book_id,review_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER immutable_invoice_cancellation_reviews BEFORE UPDATE OR DELETE ON openerp.invoice_cancellation_reviews
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_cancellation_reviews FROM PUBLIC,openerp_runtime;
CREATE TRIGGER immutable_invoice_cancellation_approvals BEFORE UPDATE OR DELETE ON openerp.invoice_cancellation_approvals
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_cancellation_approvals FROM PUBLIC,openerp_runtime;
CREATE TRIGGER immutable_invoice_cancellation_revocations BEFORE UPDATE OR DELETE ON openerp.invoice_cancellation_revocations
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_cancellation_revocations FROM PUBLIC,openerp_runtime;
CREATE TRIGGER immutable_invoice_cancellation_executions BEFORE UPDATE OR DELETE ON openerp.invoice_cancellation_executions
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_cancellation_executions FROM PUBLIC,openerp_runtime;
CREATE TRIGGER immutable_invoice_cancellations BEFORE UPDATE OR DELETE ON openerp.invoice_cancellations
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.invoice_cancellations FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.invoice_cancellation_summary(p_body jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,openerp AS $$
 SELECT CASE WHEN p_body IS NULL THEN NULL ELSE jsonb_build_object('id',p_body->>'id','reviewId',p_body->>'reviewId',
  'issueId',p_body->>'issueId','originalVoucherId',p_body->>'originalVoucherId','reversalVoucherId',p_body->>'reversalVoucherId',
  'postingDate',p_body->>'postingDate','committedAt',p_body->>'committedAt') END
$$;
CREATE FUNCTION openerp.invoice_cancellation_admits(p_book text,p_change text,p_original text,p_action jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
 SELECT EXISTS(SELECT FROM openerp.invoice_cancellation_executions x
  JOIN openerp.invoice_cancellation_reviews r ON (r.book_id,r.id)=(x.book_id,x.review_id)
  JOIN openerp.invoice_issues i ON (i.book_id,i.id)=(r.book_id,r.issue_id)
  JOIN openerp.commerce_invoices inv ON (inv.book_id,inv.id)=(i.book_id,i.register_invoice_id)
  WHERE x.book_id=p_book AND r.change_set_id=p_change AND inv.recognition_voucher_id=p_original
    AND p_action->>'postingPurpose'='reversal' AND p_action->>'correctsVoucherId'=p_original
    AND p_action=r.body->'postingPlan'->'groups'->0->'actions'->0)
$$;
-- Only the exact invoice ownership may be handled here. Generic correction remains strict.
CREATE FUNCTION openerp.invoice_cancellation_resources(p_book text,p_voucher text,p_invoice text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE c_resources jsonb; c_resource jsonb;
BEGIN
 IF EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.voucher_id=p_voucher) THEN
  PERFORM openerp.fail('StaleDependency','This recognition is retained as a schedule carrying basis. Linked schedule compensation is unsupported; cancellation is refused.'); END IF;
 c_resources:=openerp.correction_impact_resources(p_book,p_voucher,NULL);
 FOR c_resource IN SELECT value FROM jsonb_array_elements(c_resources) LOOP
  IF c_resource->>'blocks'='true' AND NOT(c_resource->>'kind'='invoice' AND c_resource->>'id'=p_invoice) THEN
   PERFORM openerp.fail('StaleDependency',c_resource->>'detail'); END IF;
 END LOOP;
 RETURN c_resources;
END $$;
CREATE FUNCTION openerp.invoice_cancellation_snapshot(p_book text,p_issue text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE c_issue openerp.invoice_issues; c_invoice jsonb; c_voucher openerp.vouchers; c_period openerp.periods; c_resources jsonb;
BEGIN
 PERFORM openerp.commerce_require_profile(p_book);
 SELECT * INTO c_issue FROM openerp.invoice_issues i WHERE i.book_id=p_book AND i.id=p_issue;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Choose an immutable native synthetic issue in this book.'); END IF;
 IF c_issue.body->>'profile' IS DISTINCT FROM 'synthetic-manual-invoice-v1'
  OR c_issue.body->'legalInvoice' IS DISTINCT FROM 'false'::jsonb OR c_issue.body->'delivered' IS DISTINCT FROM 'false'::jsonb
  OR c_issue.body->'legalDocumentNumber' IS DISTINCT FROM 'null'::jsonb THEN
  PERFORM openerp.fail('UnsupportedProfile','Only never-legally-issued, undelivered native synthetic invoices can be cancelled.'); END IF;
 IF EXISTS(SELECT FROM openerp.invoice_cancellations c WHERE c.book_id=p_book AND c.issue_id=p_issue) THEN
  PERFORM openerp.fail('AlreadyPosted','This synthetic issue already has an immutable cancellation. Read its receipt.'); END IF;
 c_invoice:=openerp.commerce_invoice_body(p_book,c_issue.register_invoice_id);
 SELECT * INTO STRICT c_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=c_invoice->'recognition'->>'voucherId';
 IF NOT openerp.commerce_voucher_current(p_book,c_voucher.id) OR c_invoice->>'status'='blocked'
  OR c_invoice->>'direction' IS DISTINCT FROM 'customer' OR c_issue.body->'postingReceipt'->>'voucherId' IS DISTINCT FROM c_voucher.id THEN
  PERFORM openerp.fail('StaleDependency','The original synthetic recognition must remain current and valid.'); END IF;
 IF EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.invoice_id=c_issue.register_invoice_id) THEN
  PERFORM openerp.fail('StaleDependency','Unallocate every active payment application explicitly before cancelling this invoice. No payment or refund is changed here.'); END IF;
 SELECT * INTO STRICT c_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=c_voucher.period_id;
 IF c_period.locked THEN PERFORM openerp.fail('PeriodLocked','The original recognition period must remain open for synthetic cancellation.'); END IF;
 IF EXISTS(SELECT FROM openerp.bank_sources s JOIN openerp.journal_lines l ON l.book_id=s.book_id AND l.account_id=s.account_id
  WHERE s.book_id=p_book AND l.voucher_id=c_voucher.id) THEN
  PERFORM openerp.fail('StaleDependency','A recognition account is mapped as a bank source. Resolve bank ownership before cancellation.'); END IF;
 c_resources:=openerp.invoice_cancellation_resources(p_book,c_voucher.id,c_issue.register_invoice_id);
 RETURN jsonb_build_object('issue',c_issue.body,'invoice',c_invoice,
  'sourcePeriod',jsonb_build_object('id',c_period.id,'version',c_period.version::text),'resources',c_resources);
END $$;
CREATE FUNCTION openerp.invoice_cancellation_checked(p_book text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE c_review jsonb;
BEGIN
 SELECT r.body INTO c_review FROM openerp.invoice_cancellation_reviews r WHERE r.book_id=p_book AND r.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','This cancellation review was not found in this book.'); END IF;
 IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'digest' IS DISTINCT FROM c_review->>'digest'
  OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('StaleDependency','Use the exact reviewed cancellation digest and acknowledge its synthetic-only scope.'); END IF;
 IF c_review->>'digest' IS DISTINCT FROM openerp.digest(c_review-'digest') THEN
  PERFORM openerp.fail('StaleDependency','The retained cancellation review digest is invalid.'); END IF;
 IF openerp.invoice_cancellation_snapshot(p_book,c_review->'input'->>'issueId') IS DISTINCT FROM c_review->'snapshot' THEN
  PERFORM openerp.fail('StaleDependency','Recognition, invoice, allocation, source-period or conflict dependencies changed. Prepare a new cancellation review.'); END IF;
 PERFORM openerp.check_dependencies(c_review->'scope',c_review->'postingPlan');
 RETURN c_review;
END $$;
CREATE FUNCTION openerp.prepare_invoice_cancellation(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_snapshot jsonb; c_source openerp.vouchers; c_period openerp.periods;
 c_action jsonb; c_lines jsonb; c_plan jsonb; c_result jsonb; c_date date; c_ordinal integer;
 c_id text:=openerp.new_id('invoice_cancel_review');
BEGIN
 c_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 c_previous:=openerp.replay(p_scope->>'bookId',p_key,c_actor,'prepare_invoice_cancellation',p_input);
 IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['issueId','issueDigest','accountingPeriodId','postingDate','reason','acknowledgeSyntheticOnly']);
 IF p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('UnsupportedProfile','Acknowledge whole synthetic cancellation only. This is not a legal credit or refund.'); END IF;
 PERFORM openerp.commerce_text(p_input,'reason',2000);
 c_snapshot:=openerp.invoice_cancellation_snapshot(p_scope->>'bookId',p_input->>'issueId');
 IF p_input->>'issueDigest' IS DISTINCT FROM c_snapshot->'issue'->>'digest' THEN
  PERFORM openerp.fail('StaleDependency','Choose the exact original immutable synthetic issue digest.'); END IF;
 SELECT * INTO STRICT c_source FROM openerp.vouchers v WHERE v.book_id=p_scope->>'bookId'
  AND v.id=c_snapshot->'invoice'->'recognition'->>'voucherId';
 SELECT * INTO c_period FROM openerp.periods p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_input->>'accountingPeriodId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Choose a cancellation accounting period in this book.'); END IF;
 c_date:=openerp.bank_date(p_input->>'postingDate');
 IF c_date<c_source.posting_date THEN PERFORM openerp.fail('InvalidJournal','Cancellation cannot precede the original recognition date.'); END IF;
 SELECT count(*)+1 INTO c_ordinal FROM openerp.invoice_cancellation_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.issue_id=p_input->>'issueId';
 IF c_ordinal>50 THEN PERFORM openerp.fail('UnsupportedProfile','This synthetic issue reached its 50-review bound. No partial history or new review was saved.'); END IF;
 SELECT jsonb_agg(l.value||jsonb_build_object('debitMinor',l.value->>'creditMinor','creditMinor',l.value->>'debitMinor') ORDER BY l.ordinal)
  INTO c_lines FROM jsonb_array_elements(c_source.action->'lines') WITH ORDINALITY l(value,ordinal);
 c_action:=c_source.action||jsonb_build_object('postingPurpose','reversal','correctsVoucherId',c_source.id,'occurrenceKey',c_source.id,
  'accountingPeriodId',c_period.id,'fiscalYearId',c_period.fiscal_year_id,'postingDate',c_date::text,
  'description','Cancel synthetic invoice '||(c_snapshot->'issue'->>'internalDocumentNumber'),'rationale',p_input->>'reason','lines',c_lines);
 -- Seal exact inverse lines using the kernel; never use generic correction preparation to bypass ownership.
 c_plan:=openerp.seal(p_scope,c_actor,c_action);
 c_result:=jsonb_build_object('id',c_id,'scope',p_scope,'version',1,'input',p_input,'snapshot',c_snapshot,'postingPlan',c_plan,'createdBy',c_actor)
  ||openerp.commerce_record_metadata(p_key,'prepare_invoice_cancellation',c_actor);
 c_result:=c_result||jsonb_build_object('digest',openerp.digest(c_result));
 IF octet_length(c_result::text)>262144 THEN PERFORM openerp.fail('UnsupportedProfile','The complete cancellation review exceeds 256 KiB. No partial review was saved.'); END IF;
 INSERT INTO openerp.invoice_cancellation_reviews VALUES(p_scope->>'bookId',c_id,p_input->>'issueId',c_ordinal,c_plan->>'id',c_result);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,c_actor,'prepare_invoice_cancellation',p_input,c_result);
END $$;
CREATE FUNCTION openerp.approve_invoice_cancellation(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_review jsonb; c_result jsonb; c_ordinal integer;
 c_id text:=openerp.new_id('invoice_cancel_approval'); c_expires timestamptz:=clock_timestamp()+interval '1 hour';
 c_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
 c_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 c_previous:=openerp.replay(p_scope->>'bookId',p_key,c_actor,'approve_invoice_cancellation',c_payload);
 IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','acknowledgeSyntheticOnly']);
 c_review:=openerp.invoice_cancellation_checked(p_scope->>'bookId',p_id,p_input);
 SELECT count(*)+1 INTO c_ordinal FROM openerp.invoice_cancellation_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id;
 IF c_ordinal>50 THEN PERFORM openerp.fail('UnsupportedProfile','This cancellation review reached its 50-approval bound.'); END IF;
 c_result:=jsonb_build_object('id',c_id,'scope',p_scope,'reviewId',p_id,'digest',c_review->>'digest','actorId',c_actor,
  'expiresAt',to_char(c_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  ||openerp.commerce_record_metadata(p_key,'approve_invoice_cancellation',c_actor);
 INSERT INTO openerp.invoice_cancellation_approvals VALUES(p_scope->>'bookId',c_id,p_id,c_ordinal,c_actor,c_review->>'digest',c_expires,c_result);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,c_actor,'approve_invoice_cancellation',c_payload,c_result);
END $$;
CREATE FUNCTION openerp.revoke_invoice_cancellation_approval(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_result jsonb; c_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
 c_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 c_previous:=openerp.replay(p_scope->>'bookId',p_key,c_actor,'revoke_invoice_cancellation_approval',c_payload);
 IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['reason']); PERFORM openerp.commerce_text(p_input,'reason',2000);
 IF NOT EXISTS(SELECT FROM openerp.invoice_cancellation_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.id=p_id) THEN
  PERFORM openerp.fail('NotFound','This cancellation approval was not found in the authorized book.'); END IF;
 IF EXISTS(SELECT FROM openerp.invoice_cancellations c WHERE c.book_id=p_scope->>'bookId' AND c.approval_id=p_id) THEN
  PERFORM openerp.fail('AlreadyPosted','A committed cancellation approval cannot be revoked. The original receipt remains authoritative.'); END IF;
 SELECT r.body INTO c_result FROM openerp.invoice_cancellation_revocations r WHERE r.book_id=p_scope->>'bookId' AND r.approval_id=p_id;
 IF c_result IS NOT NULL THEN RETURN openerp.save_command(p_scope->>'bookId',p_key,c_actor,'revoke_invoice_cancellation_approval',c_payload,c_result); END IF;
 c_result:=jsonb_build_object('approvalId',p_id,'actorId',c_actor,'reason',p_input->>'reason',
  'revokedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  ||openerp.commerce_record_metadata(p_key,'revoke_invoice_cancellation_approval',c_actor);
 INSERT INTO openerp.invoice_cancellation_revocations VALUES(p_scope->>'bookId',p_id,c_result);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,c_actor,'revoke_invoice_cancellation_approval',c_payload,c_result);
END $$;
CREATE FUNCTION openerp.execute_invoice_cancellation(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_review jsonb; c_approval openerp.invoice_cancellation_approvals;
 c_kernel jsonb; c_posting jsonb; c_issue jsonb; c_result jsonb; c_id text:=openerp.new_id('invoice_cancellation');
 c_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
 c_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 c_previous:=openerp.replay(p_scope->>'bookId',p_key,c_actor,'execute_invoice_cancellation',c_payload);
 IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','approvalId','acknowledgeSyntheticOnly']);
 -- New-key recovery is only for the identical consumed review/approval; it cannot create another cancellation.
 SELECT c.body INTO c_result FROM openerp.invoice_cancellations c WHERE c.book_id=p_scope->>'bookId' AND c.review_id=p_id;
 IF c_result IS NOT NULL THEN
  IF c_result->>'approvalId' IS DISTINCT FROM p_input->>'approvalId' OR c_result->>'reviewDigest' IS DISTINCT FROM p_input->>'digest'
   OR p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
   PERFORM openerp.fail('StaleDependency','Use the exact committed cancellation review and approval to recover its receipt.'); END IF;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,c_actor,'execute_invoice_cancellation',c_payload,c_result);
 END IF;
 c_review:=openerp.invoice_cancellation_checked(p_scope->>'bookId',p_id,p_input);
 SELECT * INTO c_approval FROM openerp.invoice_cancellation_approvals a
  WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
 IF NOT FOUND OR c_approval.actor_id IS DISTINCT FROM c_actor OR c_approval.digest IS DISTINCT FROM c_review->>'digest'
  OR c_approval.expires_at<=clock_timestamp()
  OR EXISTS(SELECT FROM openerp.invoice_cancellation_revocations r WHERE r.book_id=c_approval.book_id AND r.approval_id=c_approval.id) THEN
  PERFORM openerp.fail('ApprovalRequired','The same current operator must execute their unexpired, unrevoked approval of this exact cancellation.'); END IF;
 c_kernel:=openerp.approve_change(p_token,p_scope,c_review->'postingPlan'->>'id','ic_'||c_approval.id||'_approve',
  jsonb_build_object('version',1,'planDigest',c_review->'postingPlan'->>'planDigest'));
 -- No mutable session flag and no runtime insert permission. This immutable fence must gain its final receipt before commit.
 INSERT INTO openerp.invoice_cancellation_executions VALUES(p_scope->>'bookId',p_id,c_approval.id);
 c_posting:=openerp.execute_change(p_token,p_scope,c_review->'postingPlan'->>'id','ic_'||c_approval.id||'_post',
  jsonb_build_object('version',1,'planDigest',c_review->'postingPlan'->>'planDigest','approvalId',c_kernel->>'id'));
 c_issue:=c_review->'snapshot'->'issue';
 c_result:=jsonb_build_object('id',c_id,'scope',p_scope,'reviewId',p_id,'reviewDigest',c_review->>'digest','approvalId',c_approval.id,
  'issueId',c_issue->>'id','registerInvoiceId',c_issue->>'registerInvoiceId','internalDocumentNumber',c_issue->>'internalDocumentNumber',
  'originalVoucherId',c_issue->'postingReceipt'->>'voucherId','reversalVoucherId',c_posting->>'voucherId',
  'postingDate',c_review->'input'->>'postingDate','committedAt',c_posting->>'committedAt',
  'amountMinor',c_review->'snapshot'->'invoice'->>'amountMinor','reason',c_review->'input'->>'reason','postingReceipt',c_posting,
  'cancelled',true,'legalCreditIssued',false,'refundInitiated',false,'delivered',false)
  ||openerp.commerce_record_metadata(p_key,'execute_invoice_cancellation',c_actor);
 c_result:=c_result||jsonb_build_object('digest',openerp.digest(c_result));
 INSERT INTO openerp.invoice_cancellations VALUES(p_scope->>'bookId',c_id,p_id,c_approval.id,c_issue->>'id',c_issue->>'registerInvoiceId',
  c_issue->'postingReceipt'->>'voucherId',c_posting->>'voucherId',c_posting->>'id',(c_review->'input'->>'postingDate')::date,c_result);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,c_actor,'execute_invoice_cancellation',c_payload,c_result);
END $$;

CREATE FUNCTION openerp.get_invoice_cancellation(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_actor text; c_review jsonb; c_approval jsonb; c_approvals jsonb; c_receipt jsonb; c_current boolean:=false; c_usable boolean:=false;
BEGIN
 c_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 SELECT r.body INTO c_review FROM openerp.invoice_cancellation_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','This cancellation review was not found in the authorized book.'); END IF;
 SELECT c.body INTO c_receipt FROM openerp.invoice_cancellations c WHERE c.book_id=p_scope->>'bookId' AND c.issue_id=c_review->'input'->>'issueId';
 SELECT coalesce(jsonb_agg(jsonb_build_object('approval',a.body,'revocation',r.body) ORDER BY a.ordinal),'[]') INTO c_approvals
  FROM openerp.invoice_cancellation_approvals a LEFT JOIN openerp.invoice_cancellation_revocations r ON (r.book_id,r.approval_id)=(a.book_id,a.id)
  WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id;
 SELECT a.body,(a.actor_id=c_actor AND a.expires_at>clock_timestamp() AND r.approval_id IS NULL AND EXISTS(
  SELECT FROM openerp.memberships m WHERE m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator')) INTO c_approval,c_usable
  FROM openerp.invoice_cancellation_approvals a LEFT JOIN openerp.invoice_cancellation_revocations r ON (r.book_id,r.approval_id)=(a.book_id,a.id)
  WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id ORDER BY a.ordinal DESC LIMIT 1;
 IF c_receipt IS NULL THEN
  BEGIN
   PERFORM openerp.invoice_cancellation_checked(p_scope->>'bookId',p_id,jsonb_build_object('version',1,'digest',c_review->>'digest','acknowledgeSyntheticOnly',true));
   c_current:=true;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN c_current:=false;
  END;
 END IF;
 RETURN jsonb_build_object('review',c_review,'approval',c_approval,'approvals',c_approvals,'cancellation',c_receipt,
  'dependenciesCurrent',c_current,'approvalUsable',c_current AND coalesce(c_usable,false));
END $$;
CREATE FUNCTION openerp.get_invoice_cancellation_status(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_issue jsonb; c_receipt jsonb; c_reviews jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 SELECT i.body INTO c_issue FROM openerp.invoice_issues i WHERE i.book_id=p_scope->>'bookId' AND i.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The synthetic issue was not found in this book.'); END IF;
 SELECT c.body INTO c_receipt FROM openerp.invoice_cancellations c WHERE c.book_id=p_scope->>'bookId' AND c.issue_id=p_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'digest',r.body->>'digest','createdAt',r.body->>'createdAt',
  'reason',r.body->'input'->>'reason') ORDER BY r.ordinal DESC),'[]') INTO c_reviews
  FROM openerp.invoice_cancellation_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.issue_id=p_id;
 RETURN jsonb_build_object('scope',p_scope,'issue',c_issue,'cancellation',c_receipt,'complete',true,'reviews',c_reviews);
END $$;
CREATE FUNCTION openerp.invoice_cancellation_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE c_cancel openerp.invoice_cancellations; c_review openerp.invoice_cancellation_reviews; c_issue openerp.invoice_issues;
 c_invoice openerp.commerce_invoices; c_original openerp.vouchers; c_reversal openerp.vouchers; c_receipt openerp.execution_receipts;
 c_approval openerp.invoice_cancellation_approvals; c_kernel openerp.approvals;
BEGIN
 SELECT * INTO c_cancel FROM openerp.invoice_cancellations c WHERE c.book_id=NEW.book_id AND c.review_id=NEW.review_id;
 IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','An owned cancellation admission cannot commit without its final aggregate.'); END IF;
 SELECT * INTO STRICT c_review FROM openerp.invoice_cancellation_reviews r WHERE r.book_id=c_cancel.book_id AND r.id=c_cancel.review_id;
 SELECT * INTO STRICT c_issue FROM openerp.invoice_issues i WHERE i.book_id=c_cancel.book_id AND i.id=c_cancel.issue_id;
 SELECT * INTO STRICT c_invoice FROM openerp.commerce_invoices i WHERE i.book_id=c_cancel.book_id AND i.id=c_cancel.register_invoice_id;
 SELECT * INTO STRICT c_original FROM openerp.vouchers v WHERE v.book_id=c_cancel.book_id AND v.id=c_cancel.original_voucher_id;
 SELECT * INTO STRICT c_reversal FROM openerp.vouchers v WHERE v.book_id=c_cancel.book_id AND v.id=c_cancel.reversal_voucher_id;
 SELECT * INTO STRICT c_receipt FROM openerp.execution_receipts e WHERE e.book_id=c_cancel.book_id AND e.id=c_cancel.posting_receipt_id;
 SELECT * INTO STRICT c_approval FROM openerp.invoice_cancellation_approvals a WHERE a.book_id=c_cancel.book_id AND a.id=c_cancel.approval_id;
 SELECT * INTO STRICT c_kernel FROM openerp.approvals a WHERE a.book_id=c_cancel.book_id AND a.id=c_receipt.approval_id;
 IF c_review.issue_id<>c_issue.id OR c_issue.register_invoice_id<>c_invoice.id OR c_invoice.recognition_voucher_id<>c_original.id
  OR c_issue.body IS DISTINCT FROM c_review.body->'snapshot'->'issue'
  OR c_issue.body->'postingReceipt'->>'voucherId' IS DISTINCT FROM c_original.id
  OR c_original.posting_purpose='reversal' OR c_reversal.posting_purpose<>'reversal'
  OR c_reversal.corrects_voucher_id IS DISTINCT FROM c_original.id OR c_reversal.change_set_id<>c_review.change_set_id
  OR c_reversal.action IS DISTINCT FROM c_review.body->'postingPlan'->'groups'->0->'actions'->0
  OR c_reversal.posting_date<>c_cancel.posting_date OR c_reversal.posting_date<c_original.posting_date
  OR c_receipt.change_set_id<>c_review.change_set_id OR c_receipt.voucher_id<>c_reversal.id
  OR c_receipt.body IS DISTINCT FROM c_cancel.body->'postingReceipt'
  OR c_kernel.actor_id<>c_approval.actor_id OR c_kernel.digest IS DISTINCT FROM c_review.body->'postingPlan'->>'planDigest'
  OR c_kernel.consumed_at IS NULL OR c_approval.review_id<>c_review.id OR c_approval.digest IS DISTINCT FROM c_review.body->>'digest'
  OR EXISTS(SELECT FROM openerp.invoice_cancellation_revocations r WHERE r.book_id=c_cancel.book_id AND r.approval_id=c_approval.id)
  OR c_cancel.body->>'issueId' IS DISTINCT FROM c_issue.id OR c_cancel.body->>'registerInvoiceId' IS DISTINCT FROM c_invoice.id
  OR c_cancel.body->>'originalVoucherId' IS DISTINCT FROM c_original.id OR c_cancel.body->>'reversalVoucherId' IS DISTINCT FROM c_reversal.id
  OR c_cancel.body->>'reviewId' IS DISTINCT FROM c_review.id OR c_cancel.body->>'approvalId' IS DISTINCT FROM c_approval.id
  OR c_cancel.body->>'reviewDigest' IS DISTINCT FROM c_review.body->>'digest'
  OR c_cancel.body->>'amountMinor' IS DISTINCT FROM c_invoice.amount_minor::text
  OR c_cancel.body->>'postingDate' IS DISTINCT FROM c_reversal.posting_date::text
  OR c_cancel.body->>'committedAt' IS DISTINCT FROM c_receipt.body->>'committedAt'
  OR NOT openerp.invoice_cancellation_admits(c_cancel.book_id,c_review.change_set_id,c_original.id,c_reversal.action) THEN
  PERFORM openerp.fail('InvalidJournal','The exact cancellation, original issue, register recognition, approval and kernel reversal receipt must commit together.'); END IF;
 PERFORM openerp.inspect_action(c_cancel.book_id,c_reversal.action);
 IF EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=c_cancel.book_id AND l.invoice_id=c_invoice.id) THEN
  PERFORM openerp.fail('InvalidJournal','A cancelled invoice cannot retain active payment allocations.'); END IF;
 IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=c_cancel.book_id AND p.id IN(c_original.period_id,c_reversal.period_id) AND p.locked) THEN
  PERFORM openerp.fail('PeriodLocked','Both recognition and cancellation periods must remain open at cancellation commit.'); END IF;
 PERFORM openerp.invoice_cancellation_resources(c_cancel.book_id,c_original.id,c_invoice.id);
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER invoice_cancellation_fence_proof AFTER INSERT ON openerp.invoice_cancellation_executions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.invoice_cancellation_proof();
CREATE CONSTRAINT TRIGGER invoice_cancellation_receipt_proof AFTER INSERT ON openerp.invoice_cancellations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.invoice_cancellation_proof();

CREATE OR REPLACE FUNCTION openerp.commerce_guard_voucher_reversal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    IF openerp.invoice_cancellation_admits(NEW.book_id,NEW.change_set_id,NEW.corrects_voucher_id,NEW.action) THEN RETURN NEW; END IF;
    IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=NEW.book_id AND i.recognition_voucher_id=NEW.corrects_voucher_id)
      OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=NEW.book_id AND l.payment_voucher_id=NEW.corrects_voucher_id) THEN
      PERFORM openerp.fail('StaleDependency','The voucher retains invoice recognition or active payment allocations. Unallocate active payments first; invoice recognition correction remains unsupported.');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION openerp.correction_unsupported_reversal_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    IF openerp.invoice_cancellation_admits(NEW.book_id,NEW.change_set_id,NEW.corrects_voucher_id,NEW.action) THEN RETURN NEW; END IF;
    PERFORM openerp.correction_require_unbound(NEW.book_id,NEW.corrects_voucher_id);
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION openerp.invoice_issue_require_aggregate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.invoice_issue_reviews r
      WHERE r.book_id=NEW.book_id AND (r.event_id=NEW.event_id
        OR r.evidence_id IN (SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
        OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=r.evidence_id)))
    AND NOT EXISTS(SELECT FROM openerp.invoice_issues i
      JOIN openerp.invoice_issue_reviews r ON r.book_id=i.book_id AND r.id=i.review_id
      JOIN openerp.execution_receipts e ON e.book_id=i.book_id AND e.id=i.posting_receipt_id
      WHERE i.book_id=NEW.book_id AND r.change_set_id=NEW.change_set_id AND e.voucher_id=NEW.id)
    AND NOT EXISTS(SELECT FROM openerp.invoice_cancellations c
      JOIN openerp.invoice_cancellation_reviews r ON (r.book_id,r.id)=(c.book_id,c.review_id)
      JOIN openerp.execution_receipts e ON (e.book_id,e.id)=(c.book_id,c.posting_receipt_id)
      WHERE c.book_id=NEW.book_id AND c.reversal_voucher_id=NEW.id AND r.change_set_id=NEW.change_set_id
        AND e.voucher_id=NEW.id AND e.change_set_id=NEW.change_set_id
        AND c.original_voucher_id=NEW.corrects_voucher_id AND NEW.action=r.body->'postingPlan'->'groups'->0->'actions'->0) THEN
    PERFORM openerp.fail('ApprovalRequired','Use the synthetic invoice issue operation. An owned draft source cannot be posted separately, with another event key, or corrected outside its aggregate.');
  END IF;
  RETURN NULL;
END $$;

-- This is recognition provenance, not reusable payment capacity. commerce_voucher_current stays strict.
CREATE FUNCTION openerp.commerce_recognition_accounted(p_book text,p_voucher text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
 SELECT openerp.commerce_voucher_current(p_book,p_voucher) OR EXISTS(
  SELECT FROM openerp.invoice_cancellations c JOIN openerp.vouchers v ON (v.book_id,v.id)=(c.book_id,c.reversal_voucher_id)
   JOIN openerp.execution_receipts e ON (e.book_id,e.id)=(c.book_id,c.posting_receipt_id)
  WHERE c.book_id=p_book AND c.original_voucher_id=p_voucher AND v.corrects_voucher_id=p_voucher
   AND v.posting_purpose='reversal' AND e.voucher_id=v.id)
$$;
CREATE OR REPLACE FUNCTION openerp.commerce_invoice_body(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_invoice openerp.commerce_invoices; v_revision jsonb; v_allocated numeric; v_count bigint; v_blockers jsonb := '[]'; v_cancellation jsonb; v_cancelled numeric:=0;
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
  SELECT c.body INTO v_cancellation FROM openerp.invoice_cancellations c WHERE c.book_id=p_book AND c.register_invoice_id=p_id;
  IF v_cancellation IS NOT NULL THEN v_cancelled:=v_invoice.amount_minor; v_count:=v_count+1; END IF;
  IF NOT openerp.commerce_recognition_accounted(p_book,v_invoice.recognition_voucher_id) THEN
    v_blockers:=v_blockers||jsonb_build_array('The retained recognition voucher was corrected.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.invoice_id=p_id
    AND NOT openerp.commerce_voucher_current(p_book,l.payment_voucher_id)) THEN
    v_blockers:=v_blockers||jsonb_build_array('A retained allocation payment voucher was corrected.'); END IF;
  IF v_allocated>v_invoice.amount_minor-v_cancelled THEN v_blockers:=v_blockers||jsonb_build_array('Recorded allocations exceed the invoice amount.'); END IF;
  RETURN v_invoice.body||jsonb_build_object('currentRevision',v_revision,'allocationVersion',v_count::text,
    'cancelledMinor',v_cancelled::text,'effectiveAmountMinor',(v_invoice.amount_minor-v_cancelled)::text,
    'cancellation',openerp.invoice_cancellation_summary(v_cancellation),'recordedAllocatedMinor',v_allocated::text,'outstandingMinor',CASE WHEN v_blockers='[]'::jsonb THEN to_jsonb((v_invoice.amount_minor-v_cancelled-v_allocated)::text) ELSE 'null'::jsonb END,
    'status',CASE WHEN v_blockers<>'[]'::jsonb THEN 'blocked' WHEN v_cancellation IS NOT NULL THEN 'cancelled' WHEN v_allocated=0 THEN 'open' WHEN v_allocated=v_invoice.amount_minor THEN 'allocated' ELSE 'partially_allocated' END,
    'blockers',v_blockers);
END $$;
CREATE OR REPLACE FUNCTION openerp.commerce_allocation_selection(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE v_book openerp.books; v_payment jsonb; v_evidence jsonb; v_leg jsonb; v_invoice jsonb;
  v_legs jsonb:='[]'; v_total numeric:=0; v_amount numeric; v_counterparty text; v_account_version bigint; v_period_version bigint; v_payment_event text;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['voucherId','lineId','evidenceId','rationale','allocations']);
  PERFORM openerp.commerce_text(p_input,'rationale',2000);
  IF jsonb_typeof(p_input->'allocations') IS DISTINCT FROM 'array' THEN PERFORM openerp.fail('InvalidJournal','Provide an ordered allocation array.'); END IF;
  IF jsonb_array_length(p_input->'allocations') NOT BETWEEN 1 AND 50 THEN PERFORM openerp.fail('InvalidJournal','Allocate to between one and fifty invoices per plan.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(p_input->'allocations') l GROUP BY l->>'invoiceId' HAVING count(*)>1) THEN
    PERFORM openerp.fail('InvalidJournal','Each invoice may appear only once in an allocation plan.'); END IF;
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
  v_payment:=openerp.commerce_payment_body(p_book,p_input->>'voucherId',p_input->>'lineId');
  v_evidence:=openerp.commerce_evidence(p_book,p_input->>'evidenceId');
  SELECT a.version INTO v_account_version FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=v_payment->>'accountId' AND a.active FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('StaleDependency','The payment control account is inactive.'); END IF;
  SELECT v.event_id INTO STRICT v_payment_event FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=v_payment->>'voucherId';
  SELECT p.version INTO v_period_version FROM openerp.vouchers v JOIN openerp.periods p ON p.book_id=v.book_id AND p.id=v.period_id
    WHERE v.book_id=p_book AND v.id=v_payment->>'voucherId' AND NOT p.locked FOR SHARE OF p;
  IF NOT FOUND THEN PERFORM openerp.fail('PeriodLocked','Allocation in the posted payment period requires that period to remain open.'); END IF;
  FOR v_leg IN SELECT l.value FROM jsonb_array_elements(p_input->'allocations') WITH ORDINALITY l(value,ordinal) ORDER BY l.ordinal LOOP
    PERFORM openerp.commerce_exact_object(v_leg,ARRAY['invoiceId','amountMinor']);
    v_amount:=openerp.commerce_positive_minor(v_leg,'amountMinor');
    v_invoice:=openerp.commerce_invoice_body(p_book,v_leg->>'invoiceId');
    IF v_invoice->>'status' IN('blocked','cancelled') OR v_invoice->>'direction' IS DISTINCT FROM v_payment->>'direction'
      OR v_invoice->>'controlAccountId' IS DISTINCT FROM v_payment->>'accountId'
      OR v_invoice->>'currency' IS DISTINCT FROM v_payment->>'currency'
      OR v_invoice->'recognition'->>'eventId'=v_payment_event
      OR (v_invoice->'recognition'->>'postingDate')::date>(v_payment->>'postingDate')::date THEN
      PERFORM openerp.fail('InvalidJournal','Use current same-account invoice recognition and a distinct later or same-date settlement event. Advances and netting are unsupported.'); END IF;
    IF v_counterparty IS NULL THEN v_counterparty:=v_invoice->>'counterpartyId'; END IF;
    IF v_counterparty IS DISTINCT FROM v_invoice->>'counterpartyId' THEN
      PERFORM openerp.fail('InvalidJournal','One payment allocation plan must identify one counterpart. Cross-counterparty netting is unsupported.'); END IF;
    IF v_amount>(v_invoice->>'outstandingMinor')::numeric THEN
      PERFORM openerp.fail('StaleDependency','An allocation exceeds current invoice outstanding capacity.'); END IF;
    v_total:=v_total+v_amount;
    v_legs:=v_legs||jsonb_build_array(jsonb_build_object('invoiceId',v_invoice->>'id','revision',v_invoice->'currentRevision'->>'revision',
      'allocationVersion',v_invoice->>'allocationVersion','documentNumber',v_invoice->>'documentNumber','counterpartyId',v_counterparty,
      'counterpartyName',v_invoice->>'counterpartyName','recognition',v_invoice->'recognition','evidence',v_invoice->'evidence',
      'outstandingBeforeMinor',v_invoice->>'outstandingMinor','amountMinor',v_amount::text,
      'outstandingAfterMinor',((v_invoice->>'outstandingMinor')::numeric-v_amount)::text));
  END LOOP;
  IF v_total>(v_payment->>'remainingMinor')::numeric THEN
    PERFORM openerp.fail('StaleDependency','The proposed total exceeds current posted payment capacity.'); END IF;
  RETURN jsonb_build_object('profileVersion',v_book.profile_version::text,'writerEpoch',v_book.writer_epoch::text,
    'accountVersion',v_account_version::text,'paymentPeriodVersion',v_period_version::text,'payment',v_payment,
    'evidence',v_evidence,'rationale',p_input->>'rationale','legs',v_legs,'totalMinor',v_total::text,
    'paymentRemainingAfterMinor',((v_payment->>'remainingMinor')::numeric-v_total)::text);
END $$;
CREATE OR REPLACE FUNCTION openerp.commerce_revise_invoice(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_invoice openerp.commerce_invoices; v_evidence jsonb; v_revision jsonb; v_result jsonb;
  v_due date; v_next bigint; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'commerce_revise_invoice',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(p_scope->>'bookId');
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedRevision','dueOn','description','evidenceId','reason']);
  SELECT * INTO v_invoice FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId' AND i.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The invoice is not registered in this book.'); END IF;
  IF EXISTS(SELECT FROM openerp.invoice_cancellations c WHERE c.book_id=p_scope->>'bookId' AND c.register_invoice_id=p_id) THEN
    PERFORM openerp.fail('StaleDependency','A cancelled synthetic invoice retains its historical revisions. It cannot be revised or reopened.'); END IF;
  IF openerp.commerce_text(p_input,'expectedRevision',18) IS DISTINCT FROM v_invoice.current_revision::text THEN
    PERFORM openerp.fail('StaleDependency','The invoice revision changed. Read its current version first.'); END IF;
  v_due:=openerp.bank_date(p_input->>'dueOn');
  IF v_due<v_invoice.issued_on THEN PERFORM openerp.fail('InvalidJournal','The due date cannot precede invoice issue.'); END IF;
  PERFORM openerp.commerce_text(p_input,'description',2000); PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_evidence:=openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId'); v_next:=v_invoice.current_revision+1;
  v_revision:=jsonb_build_object('id',p_id,'scope',p_scope,'revision',v_next::text,'dueOn',v_due::text,'description',p_input->>'description',
    'evidence',v_evidence,'reason',p_input->>'reason')||openerp.commerce_record_metadata(p_key,'commerce_revise_invoice',v_actor);
  INSERT INTO openerp.commerce_invoice_revisions VALUES(p_scope->>'bookId',p_id,v_next,p_input->>'evidenceId',v_revision);
  UPDATE openerp.commerce_invoices i SET current_revision=v_next WHERE i.book_id=p_scope->>'bookId' AND i.id=p_id;
  v_result:=openerp.commerce_invoice_body(p_scope->>'bookId',p_id);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'commerce_revise_invoice',v_payload,v_result);
END $$;
CREATE OR REPLACE FUNCTION openerp.commerce_period_status(p_book text,p_starts date,p_ends date) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_registered bigint; v_recognition_invalid bigint; v_allocation_invalid bigint; v_conservation_invalid bigint;
  v_sources jsonb; v_legs jsonb; v_reversals jsonb; v_cancellations jsonb; v_book openerp.books; v_blockers jsonb:='[]';
BEGIN
  IF p_starts IS NULL OR p_ends IS NULL OR p_starts>p_ends THEN PERFORM openerp.fail('InvalidJournal','Choose an ordered commerce inventory interval.'); END IF;
  SELECT * INTO v_book FROM openerp.books b WHERE b.id=p_book;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The book was not found.'); END IF;
  SELECT count(*),count(*) FILTER (WHERE NOT openerp.commerce_recognition_accounted(p_book,v.id)
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
  SELECT coalesce(jsonb_agg(c.body ORDER BY c.id COLLATE "C"),'[]') INTO v_cancellations
    FROM openerp.invoice_cancellations c JOIN openerp.vouchers original ON (original.book_id,original.id)=(c.book_id,c.original_voucher_id)
    WHERE c.book_id=p_book AND original.posting_date<=p_ends;
  IF v_recognition_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered invoice recognition is invalid or reversed.'); END IF;
  IF v_allocation_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered payment allocations have invalid or reversed references.'); END IF;
  IF v_conservation_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered allocation capacities are inconsistent.'); END IF;
  RETURN jsonb_build_object('schemaVersion',1,'coverage','not_established','startsOn',p_starts::text,'endsOn',p_ends::text,
    'registeredInvoiceCount',v_registered,'invalidRecognitionCount',v_recognition_invalid,'invalidAllocationCount',v_allocation_invalid,
    'conservationFailureCount',v_conservation_invalid,'sourceDigest',openerp.digest(jsonb_build_object(
      'scope',jsonb_build_object('bookId',p_book,'entityId',v_book.entity_id),'currency',v_book.currency,'currencyScale',v_book.currency_scale,
      'startsOn',p_starts::text,'endsOn',p_ends::text,'invoices',v_sources,'allocations',v_legs)
      ||CASE WHEN v_reversals='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('unallocations',v_reversals) END
      ||CASE WHEN v_cancellations='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('invoiceCancellations',v_cancellations) END),'blockers',v_blockers);
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
      AND (NOT openerp.commerce_recognition_accounted(v_book.id,v.id) OR j.account_id<>i.control_account_id
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
    'revision',r.body,'allocatedMinor',paid.amount::text,
    'cancelledMinor',CASE WHEN cancel.id IS NULL THEN '0' ELSE i.amount_minor::text END,
    'effectiveAmountMinor',CASE WHEN cancel.id IS NULL THEN i.amount_minor::text ELSE '0' END,
    'cancellation',openerp.invoice_cancellation_summary(cancel.body),
    'outstandingMinor',(CASE WHEN cancel.id IS NULL THEN i.amount_minor ELSE 0 END-paid.amount)::text,
    'daysOverdue',greatest(v_date-(r.body->>'dueOn')::date,0),
    'ageBucket',CASE WHEN v_date<=(r.body->>'dueOn')::date THEN 'not_due'
      WHEN v_date-(r.body->>'dueOn')::date<=30 THEN 'days_1_30'
      WHEN v_date-(r.body->>'dueOn')::date<=60 THEN 'days_31_60'
      WHEN v_date-(r.body->>'dueOn')::date<=90 THEN 'days_61_90' ELSE 'over_90' END
  ) ORDER BY i.id COLLATE "C"),'[]') INTO v_invoices
    FROM openerp.commerce_invoices i
    JOIN openerp.commerce_invoice_revisions r ON r.book_id=i.book_id AND r.invoice_id=i.id AND r.revision=i.current_revision
    LEFT JOIN openerp.invoice_cancellations cancel ON cancel.book_id=i.book_id AND cancel.register_invoice_id=i.id AND cancel.posting_date<=v_date
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
    'invoiceId',coalesce(invoice.value->>'id',cancelled.value->>'id'),'allocatedMinor',paid.amount::text,
    'cancellationId',cancelled.value->'cancellation'->>'id',
    'registerContributionKind',CASE WHEN invoice.value IS NOT NULL THEN 'recognition' WHEN cancelled.value IS NOT NULL THEN 'cancellation'
      WHEN paid.amount>0 THEN 'allocation' ELSE 'unexplained' END,
    'registerEffectMinor',(coalesce((invoice.value->>'amountMinor')::numeric,0)-coalesce((cancelled.value->>'cancelledMinor')::numeric,0)-paid.amount)::text,
    'unexplainedMinor',((CASE WHEN c.direction='customer' THEN l.debit_minor-l.credit_minor ELSE l.credit_minor-l.debit_minor END)
      -coalesce((invoice.value->>'amountMinor')::numeric,0)+coalesce((cancelled.value->>'cancelledMinor')::numeric,0)+paid.amount)::text
  ) ORDER BY v.sequence,l.ordinal),'[]') INTO v_lines
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    JOIN openerp.commerce_control_accounts c ON c.book_id=l.book_id AND c.account_id=l.account_id
    LEFT JOIN LATERAL (
      SELECT i AS value FROM jsonb_array_elements(v_invoices) i
        WHERE i->'recognition'->>'voucherId'=v.id AND i->'recognition'->>'lineId'=l.id
    ) invoice ON true
    LEFT JOIN LATERAL (
      SELECT i AS value FROM jsonb_array_elements(v_invoices) i
        WHERE i->'cancellation'->>'reversalVoucherId'=v.id AND i->'recognition'->>'lineId'=l.id
    ) cancelled ON true
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
    'recognizedMinor',invoices.recognized::text,'cancelledMinor',invoices.cancelled::text,'allocatedMinor',invoices.allocated::text,
    'outstandingMinor',invoices.outstanding::text,'ledgerMinor',ledger.balance::text,
    'differenceMinor',(ledger.balance-invoices.outstanding)::text,'unexplainedLineCount',ledger.unexplained,
    'ageing',jsonb_build_object('not_due',invoices.not_due::text,'days_1_30',invoices.days_1_30::text,
      'days_31_60',invoices.days_31_60::text,'days_61_90',invoices.days_61_90::text,'over_90',invoices.over_90::text)
  ) ORDER BY c.account_id COLLATE "C"),'[]') INTO v_controls
    FROM openerp.commerce_control_accounts c JOIN openerp.accounts a ON a.book_id=c.book_id AND a.id=c.account_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((i->>'amountMinor')::numeric),0) AS recognized,
        coalesce(sum((i->>'cancelledMinor')::numeric),0) AS cancelled,
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

REVOKE ALL ON FUNCTION openerp.invoice_cancellation_summary(jsonb),
 openerp.invoice_cancellation_admits(text,text,text,jsonb),openerp.invoice_cancellation_resources(text,text,text),
 openerp.invoice_cancellation_snapshot(text,text),openerp.invoice_cancellation_checked(text,text,jsonb),
 openerp.invoice_cancellation_proof(),openerp.commerce_recognition_accounted(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_invoice_cancellation(text,jsonb,text,jsonb),
 openerp.approve_invoice_cancellation(text,jsonb,text,text,jsonb),openerp.execute_invoice_cancellation(text,jsonb,text,text,jsonb),
 openerp.revoke_invoice_cancellation_approval(text,jsonb,text,text,jsonb),openerp.get_invoice_cancellation(text,jsonb,text),
 openerp.get_invoice_cancellation_status(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.prepare_invoice_cancellation(text,jsonb,text,jsonb),
 openerp.approve_invoice_cancellation(text,jsonb,text,text,jsonb),openerp.execute_invoice_cancellation(text,jsonb,text,text,jsonb),
 openerp.revoke_invoice_cancellation_approval(text,jsonb,text,text,jsonb),openerp.get_invoice_cancellation(text,jsonb,text),
 openerp.get_invoice_cancellation_status(text,jsonb,text) TO openerp_runtime;
