-- Synthetic asserted-tax gross-cost posting. Tax is retained as source data, never deducted or claimed.
-- Replace only the supplier aggregate admission, review and execution owners; prior receipts stay immutable.
CREATE OR REPLACE FUNCTION openerp.supplier_acceptance_draft(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_draft jsonb; v_recalculated jsonb; v_head bigint;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  SELECT d.current_revision,r.body INTO v_head,v_draft FROM openerp.supplier_invoice_drafts d
    JOIN openerp.supplier_invoice_draft_revisions r ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision
    WHERE d.book_id=p_book AND d.id=p_input->>'draftId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The current supplier draft was not found in this book.'); END IF;
  IF p_input->>'expectedRevision' IS DISTINCT FROM v_head::text OR p_input->>'expectedDigest' IS DISTINCT FROM v_draft->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Reopen the current supplier draft and prepare a new acceptance review.');
  END IF;
  IF EXISTS(SELECT FROM openerp.supplier_acceptances i WHERE i.book_id=p_book AND i.draft_id=p_input->>'draftId') THEN
    PERFORM openerp.fail('AlreadyPosted','This draft already has a supplier acceptance. Recover it from acceptance history.');
  END IF;
  v_recalculated:=openerp.supplier_invoice_draft_calculate(p_book,v_draft->'content');
  IF v_recalculated IS DISTINCT FROM (v_draft - ARRAY['id','scope','draftKey','revision','status','acceptanceSupported','recognitionSupported','recognitionAssessment',
    'calculationBasis','content','reason','createdAt','receipt','digest']) THEN
    PERFORM openerp.fail('StaleDependency','The retained draft facts or counterpart changed. Save and review a new revision.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(v_draft->'blockers') b WHERE b->>'code' NOT IN
    ('acceptance_not_implemented','recognition_not_implemented','legal_identity_not_verified','tax_profile_not_activated'))
    OR v_draft->'content'->>'supplierDocumentNumber' IS NULL
    OR (p_input->>'profile'='synthetic-manual-supplier-v1' AND v_draft->'totals'->>'taxMinor' IS DISTINCT FROM '0')
    OR (p_input->>'profile'='synthetic-gross-cost-supplier-v1' AND
      (coalesce(v_draft->'totals'->>'taxMinor','') !~ '^[1-9][0-9]{0,37}$'
       OR (v_draft->'totals'->>'taxMinor')::numeric >= (v_draft->'totals'->>'grossMinor')::numeric))
    OR coalesce(v_draft->'totals'->>'grossMinor','') !~ '^[1-9][0-9]{0,37}$'
    OR v_draft->'totals'->'sourceTotalMatches' IS DISTINCT FROM 'true'::jsonb
    OR EXISTS(SELECT FROM jsonb_array_elements(v_draft->'calculatedLines') l WHERE l->'sourceGrossMatches' IS DISTINCT FROM 'true'::jsonb) THEN
    PERFORM openerp.fail('UnsupportedProfile','Synthetic supplier acceptance requires a source number, complete exact lines, matching source totals and evidenced exact asserted tax under the selected synthetic profile. No VAT deduction or real-company rule is activated.');
  END IF;
  RETURN v_draft;
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_supplier_acceptance(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_draft jsonb; v_evidence jsonb; v_posting jsonb;
  v_result jsonb; v_id text:=openerp.new_id('supplier_review'); v_ordinal integer; v_field text; v_amount text;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'prepare_supplier_acceptance',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','draftId','expectedRevision','expectedDigest','controlAccountId',
    'debitAccountId','accountingPeriodId','series','reason','acknowledgeSyntheticOnly']);
  IF p_input->>'profile' NOT IN ('synthetic-manual-supplier-v1','synthetic-gross-cost-supplier-v1') OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Explicitly acknowledge synthetic-only supplier acceptance and recognition. Real-company tax treatment is unsupported.');
  END IF;
  FOREACH v_field IN ARRAY ARRAY['draftId','controlAccountId','debitAccountId','accountingPeriodId'] LOOP
    IF openerp.commerce_text(p_input,v_field,128) !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Supply scoped identifiers for the draft, both accounts and period.');
    END IF;
  END LOOP;
  IF openerp.commerce_text(p_input,'expectedRevision',18) !~ '^[1-9][0-9]{0,17}$'
    OR openerp.commerce_text(p_input,'expectedDigest',71) !~ '^sha256:[a-f0-9]{64}$'
    OR openerp.commerce_text(p_input,'series',16) !~ '^[A-Z0-9]{1,16}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply an exact draft revision/digest and an uppercase voucher series.');
  END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_draft:=openerp.supplier_acceptance_draft(v_book.id,p_input);
  PERFORM openerp.supplier_acceptance_accounts(v_book.id,p_input);
  SELECT count(*)+1 INTO v_ordinal FROM openerp.supplier_acceptance_reviews r WHERE r.book_id=v_book.id AND r.draft_id=p_input->>'draftId';
  IF v_ordinal>50 THEN PERFORM openerp.fail('InvalidJournal','This draft reached its 50-review bound. No partial history or new review is admitted.'); END IF;
  v_evidence:=openerp.commerce_evidence(v_book.id,v_draft->'content'->>'sourceEvidenceId');
  IF EXISTS(SELECT FROM openerp.vouchers v JOIN openerp.events e ON e.book_id=v.book_id AND e.id=v.event_id
    WHERE v.book_id=v_book.id AND (e.evidence_id=v_evidence->>'evidenceId'
      OR EXISTS(SELECT FROM jsonb_array_elements(v.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=v_evidence->>'evidenceId'))) THEN
    PERFORM openerp.fail('AlreadyPosted','This original supplier source has posted history. Synthetic acceptance cannot recognize it again.');
  END IF;
  v_amount:=v_draft->'totals'->>'grossMinor';
  v_posting:=openerp.prepare_journal(p_token,p_scope,'sa_'||v_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',v_evidence->>'evidenceId','eventKey','synthetic_supplier_'||(v_draft->>'id'),
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',v_draft->'content'->>'documentDate',
    'series',p_input->>'series','description','Synthetic supplier invoice: '||(v_draft->'content'->>'title'),
    'rationale',p_input->>'reason','taxAssessment','not_applicable','lines',jsonb_build_array(
      jsonb_build_object('accountId',p_input->>'debitAccountId','debitMinor',v_amount,'creditMinor','0','description','Gross supplier cost; no VAT deduction'),
      jsonb_build_object('accountId',p_input->>'controlAccountId','debitMinor','0','creditMinor',v_amount,'description','Explicit supplier payable'))));
  v_result:=jsonb_build_object('id',v_id,'scope',jsonb_build_object('entityId',v_book.entity_id,'bookId',v_book.id),
    'version',1,'profile',p_input->>'profile','ordinal',v_ordinal,'input',p_input,
    'draftSnapshot',v_draft,'postingPlan',v_posting,'evidence',v_evidence,
    'legalBlockers',jsonb_build_array('legal_identity_not_verified','tax_profile_not_activated','payment_not_initiated','asserted_tax_not_deducted'))
    ||openerp.commerce_record_metadata(p_key,'prepare_supplier_acceptance',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The complete acceptance review exceeds 256 KiB. Nothing was saved.'); END IF;
  INSERT INTO openerp.supplier_acceptance_reviews VALUES(v_book.id,v_id,v_draft->>'id',(v_draft->>'revision')::bigint,v_ordinal,v_posting->>'id',v_posting->'groups'->0->'actions'->0->>'eventId',v_evidence->>'evidenceId',v_result);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'prepare_supplier_acceptance',p_input,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.execute_supplier_acceptance(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_review jsonb; v_approval openerp.supplier_acceptance_approvals;
  v_kernel_approval jsonb; v_posting jsonb; v_registered jsonb; v_result jsonb; v_draft jsonb;
  v_id text:=openerp.new_id('supplier_acceptance');
  v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'execute_supplier_acceptance',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','approvalId','acknowledgeSyntheticOnly']);
  v_review:=openerp.supplier_acceptance_checked(p_scope->>'bookId',p_id,p_input);
  PERFORM openerp.commerce_text(p_input,'approvalId',128);
  SELECT * INTO v_approval FROM openerp.supplier_acceptance_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR v_approval.actor_id IS DISTINCT FROM v_actor OR v_approval.digest IS DISTINCT FROM v_review->>'digest'
    OR v_approval.expires_at<=clock_timestamp()
    OR EXISTS(SELECT FROM openerp.supplier_acceptances i WHERE i.book_id=p_scope->>'bookId' AND i.approval_id=v_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','The same current operator must execute their unexpired, unused approval of this exact supplier acceptance and posting.');
  END IF;
  -- Kernel approval is created only inside this transaction, by the still-authorized human.
  v_kernel_approval:=openerp.approve_change(p_token,p_scope,v_review->'postingPlan'->>'id','sa_'||v_approval.id||'_approve',
    jsonb_build_object('version',1,'planDigest',v_review->'postingPlan'->>'planDigest'));
  v_posting:=openerp.execute_change(p_token,p_scope,v_review->'postingPlan'->>'id','sa_'||v_approval.id||'_post',
    jsonb_build_object('version',1,'planDigest',v_review->'postingPlan'->>'planDigest','approvalId',v_kernel_approval->>'id'));
  v_draft:=v_review->'draftSnapshot';
  v_registered:=openerp.commerce_create_invoice(p_token,p_scope,'sa_'||v_approval.id||'_register',jsonb_build_object(
    'kind','synthetic_invoice_v1','direction','supplier','counterpartyId',v_draft->'content'->>'counterpartyId',
    'counterpartyRevision',v_draft->'content'->>'counterpartyRevision','documentNumber',v_draft->'content'->>'supplierDocumentNumber',
    'issuedOn',v_draft->'content'->>'documentDate','dueOn',v_draft->'content'->>'dueDate',
    'currency',v_draft->'content'->>'currency','amountMinor',v_draft->'totals'->>'grossMinor',
    'controlAccountId',v_review->'input'->>'controlAccountId','recognitionVoucherId',v_posting->>'voucherId',
    'recognitionLineId',v_review->'postingPlan'->'groups'->0->'actions'->0->'lines'->1->>'lineId',
    'evidenceId',v_review->'evidence'->>'evidenceId','description','Synthetic supplier invoice: '||(v_draft->'content'->>'title')));
  v_result:=jsonb_build_object('id',v_id,'scope',v_review->'scope','reviewId',p_id,'reviewDigest',v_review->>'digest',
    'approvalId',v_approval.id,'profile',v_review->>'profile','draftId',v_draft->>'id',
    'draftRevision',v_draft->>'revision','draftDigest',v_draft->>'digest','supplierDocumentNumber',v_draft->'content'->>'supplierDocumentNumber',
    'accepted',true,'recognized',true,'paid',false,'postingReceipt',v_posting,'registerInvoiceId',v_registered->>'id',
    'legalBlockers',v_review->'legalBlockers')||openerp.commerce_record_metadata(p_key,'execute_supplier_acceptance',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.supplier_acceptances VALUES(p_scope->>'bookId',v_id,p_id,v_approval.id,v_draft->>'id',
    (v_draft->>'revision')::bigint,v_posting->>'id',v_registered->>'id',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'execute_supplier_acceptance',v_payload,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.supplier_credit_snapshot(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_invoice openerp.commerce_invoices; v_body jsonb; v_acceptance openerp.supplier_acceptances;
  v_voucher openerp.vouchers; v_expense openerp.journal_lines; v_evidence jsonb; v_amount numeric;
  v_name text; v_date date; v_original_tax numeric; v_credited_tax numeric; v_tax numeric;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  SELECT * INTO v_invoice FROM openerp.commerce_invoices i
    WHERE i.book_id=p_book AND i.id=p_input->>'invoiceId' AND i.direction='supplier';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select an accepted supplier payable in this book.'); END IF;
  SELECT * INTO v_acceptance FROM openerp.supplier_acceptances a
    WHERE a.book_id=p_book AND a.register_invoice_id=v_invoice.id;
  IF NOT FOUND OR NOT (
    (v_acceptance.body->>'profile'='synthetic-manual-supplier-v1' AND p_input->>'profile'='synthetic-zero-tax-supplier-credit-v1')
    OR (v_acceptance.body->>'profile'='synthetic-gross-cost-supplier-v1' AND p_input->>'profile'='synthetic-gross-cost-supplier-credit-v1')) THEN
    PERFORM openerp.fail('UnsupportedProfile','The credit must use the matching synthetic supplier recognition profile.'); END IF;
  v_original_tax:=(v_acceptance.body->'draftSnapshot'->'totals'->>'taxMinor')::numeric;
  v_tax:=CASE WHEN p_input->>'profile'='synthetic-zero-tax-supplier-credit-v1' THEN 0
    ELSE openerp.invoice_draft_minor(p_input,'taxMinor') END;
  IF v_tax>(p_input->>'amountMinor')::numeric THEN
    PERFORM openerp.fail('InvalidJournal','Credit asserted tax cannot exceed its gross amount.'); END IF;
  SELECT coalesce(sum((c.body->>'taxMinor')::numeric),0) INTO v_credited_tax
    FROM openerp.supplier_credits c WHERE c.book_id=p_book AND c.invoice_id=v_invoice.id;
  IF v_tax+v_credited_tax>v_original_tax THEN
    PERFORM openerp.fail('InvalidJournal','Credits cannot assert more source tax than the accepted supplier invoice.'); END IF;
  v_body:=openerp.commerce_invoice_body(p_book,v_invoice.id);
  IF v_body->'blockers'<>'[]'::jsonb OR v_body->>'outstandingMinor' IS NULL THEN
    PERFORM openerp.fail('StaleDependency','Resolve the posted payable and allocation blockers before crediting it.'); END IF;
  IF p_input->>'expectedOutstandingMinor' IS DISTINCT FROM v_body->>'outstandingMinor'
    OR p_input->>'expectedAllocationVersion' IS DISTINCT FROM v_body->>'allocationVersion'
    OR p_input->>'expectedInvoiceRevision' IS DISTINCT FROM v_body->'currentRevision'->>'revision'
    OR p_input->>'acceptanceDigest' IS DISTINCT FROM v_acceptance.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Reopen the supplier payable and select the current acceptance, invoice and residual.'); END IF;
  IF EXISTS(SELECT FROM openerp.supplier_payment_batch_items x WHERE x.book_id=p_book AND x.invoice_id=v_invoice.id) THEN
    PERFORM openerp.fail('StaleDependency','Resolve the exported payment file outcome before reducing this payable.'); END IF;
  v_amount:=openerp.commerce_positive_minor(p_input,'amountMinor');
  IF v_amount>(v_body->>'outstandingMinor')::numeric THEN
    PERFORM openerp.fail('StaleDependency','The supplier credit exceeds the unpaid residual. Paid allocations remain unchanged.'); END IF;
  v_name:=openerp.commerce_text(p_input,'supplierCreditNumber',128);
  IF EXISTS(SELECT FROM openerp.supplier_credits c WHERE c.book_id=p_book AND c.counterparty_id=v_invoice.counterparty_id
      AND c.document_number=v_name COLLATE "C")
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.direction='supplier'
      AND i.counterparty_id=v_invoice.counterparty_id AND i.document_number=v_name COLLATE "C") THEN
    PERFORM openerp.fail('IdempotencyConflict','This supplier document number is already retained for this counterpart.'); END IF;
  v_evidence:=openerp.commerce_evidence(p_book,openerp.commerce_text(p_input,'creditEvidenceId',128));
  IF EXISTS(SELECT FROM openerp.vouchers v JOIN openerp.events e ON (e.book_id,e.id)=(v.book_id,v.event_id)
    WHERE v.book_id=p_book AND (e.evidence_id=v_evidence->>'evidenceId'
      OR EXISTS(SELECT FROM jsonb_array_elements(v.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=v_evidence->>'evidenceId'))) THEN
    PERFORM openerp.fail('AlreadyPosted','The supplier credit source has posted history. A second credit posting is refused.'); END IF;
  v_date:=openerp.bank_date(p_input->>'creditDate');
  SELECT * INTO STRICT v_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=v_invoice.recognition_voucher_id;
  IF v_date<v_invoice.issued_on OR v_date<v_voucher.posting_date THEN
    PERFORM openerp.fail('InvalidJournal','The supplier credit date cannot precede its original invoice and recognition.'); END IF;
  SELECT * INTO v_expense FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=v_voucher.id
    AND l.account_id<>v_invoice.control_account_id AND l.debit_minor=v_invoice.amount_minor AND l.credit_minor=0;
  IF NOT FOUND OR (SELECT count(*) FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=v_voucher.id)<>2 THEN
    PERFORM openerp.fail('UnsupportedProfile','The original synthetic recognition must have one exact non-control expense debit.'); END IF;
  IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=v_expense.account_id)
    OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=v_expense.account_id) THEN
    PERFORM openerp.fail('StaleDependency','The original expense account changed role. Credit is unsupported until resolved.'); END IF;
  RETURN jsonb_build_object('invoice',v_body,'acceptanceDigest',v_acceptance.body->>'digest',
    'originalVoucherId',v_voucher.id,'expenseAccountId',v_expense.account_id,'creditEvidence',v_evidence,
    'amountMinor',v_amount::text,'taxMinor',v_tax::text,'creditDate',v_date::text,'supplierCreditNumber',v_name);
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_supplier_credit(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_snapshot jsonb; v_plan jsonb; v_result jsonb;
  v_id text:=openerp.new_id('supplier_credit_review');
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'prepare_supplier_credit',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','invoiceId','acceptanceDigest','expectedInvoiceRevision',
    'expectedAllocationVersion','expectedOutstandingMinor','creditEvidenceId','supplierCreditNumber','amountMinor',
    'creditDate','accountingPeriodId','series','reason','acknowledgeSyntheticOnly','taxMinor']);
  IF p_input->>'profile' NOT IN ('synthetic-zero-tax-supplier-credit-v1','synthetic-gross-cost-supplier-credit-v1')
    OR (p_input->>'profile'='synthetic-zero-tax-supplier-credit-v1' AND p_input ? 'taxMinor')
    OR (p_input->>'profile'='synthetic-gross-cost-supplier-credit-v1' AND NOT p_input ? 'taxMinor')
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Only matching, explicit synthetic supplier credit profiles are supported.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  IF openerp.commerce_text(p_input,'series',16) !~ '^[A-Z0-9]{1,16}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use an uppercase voucher series.'); END IF;
  PERFORM openerp.commerce_text(p_input,'accountingPeriodId',128);
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.supplier_credit_reviews r
    WHERE r.book_id=p_scope->>'bookId' AND r.invoice_id=p_input->>'invoiceId' LIMIT 51) bounded)>=50 THEN
    PERFORM openerp.fail('InvalidJournal','This supplier invoice reached its 50-credit-review bound.'); END IF;
  v_snapshot:=openerp.supplier_credit_snapshot(p_scope->>'bookId',p_input);
  v_plan:=openerp.prepare_journal(p_token,p_scope,'sc_'||v_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',p_input->>'creditEvidenceId','eventKey','supplier_credit_'||v_id,
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',p_input->>'creditDate','series',p_input->>'series',
    'description','Synthetic supplier credit '||(p_input->>'supplierCreditNumber'),
    'rationale',p_input->>'reason','taxAssessment','not_applicable','lines',jsonb_build_array(
      jsonb_build_object('accountId',v_snapshot->'invoice'->>'controlAccountId','debitMinor',p_input->>'amountMinor',
        'creditMinor','0','description','Reduce supplier payable'),
      jsonb_build_object('accountId',v_snapshot->>'expenseAccountId','debitMinor','0','creditMinor',p_input->>'amountMinor',
        'description','Reverse synthetic gross cost; no VAT deduction'))));
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'profile',p_input->>'profile',
    'input',p_input,'snapshot',v_snapshot,'postingPlan',v_plan,'taxMinor',v_snapshot->>'taxMinor','vatFactsCreated',false)
    ||openerp.commerce_record_metadata(p_key,'prepare_supplier_credit',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The credit review exceeds its 256 KiB bound.'); END IF;
  INSERT INTO openerp.supplier_credit_reviews VALUES(p_scope->>'bookId',v_id,p_input->>'invoiceId',
    v_plan->>'id',v_plan->'groups'->0->'actions'->0->>'eventId',p_input->>'creditEvidenceId',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'prepare_supplier_credit',p_input,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.execute_supplier_credit(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_review jsonb; v_approval openerp.supplier_credit_approvals;
  v_kernel jsonb; v_posting jsonb; v_result jsonb; v_invoice jsonb; v_id text:=openerp.new_id('supplier_credit');
  v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'execute_supplier_credit',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['digest','approvalId','acknowledgeSyntheticOnly']);
  SELECT r.body INTO v_review FROM openerp.supplier_credit_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','This supplier credit review was not found.'); END IF;
  IF p_input->>'digest' IS DISTINCT FROM v_review->>'digest' OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb
    OR NOT openerp.supplier_credit_current(p_scope->>'bookId',v_review) THEN
    PERFORM openerp.fail('StaleDependency','The supplier credit source, register capacity or posting dependencies changed.'); END IF;
  SELECT * INTO v_approval FROM openerp.supplier_credit_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR v_approval.actor_id IS DISTINCT FROM v_actor OR v_approval.digest IS DISTINCT FROM v_review->>'digest'
    OR v_approval.expires_at<=clock_timestamp() THEN
    PERFORM openerp.fail('ApprovalRequired','The same current operator must execute their unexpired exact supplier credit approval.'); END IF;
  v_kernel:=openerp.approve_change(p_token,p_scope,v_review->'postingPlan'->>'id','sc_'||v_approval.id||'_approve',
    jsonb_build_object('version',1,'planDigest',v_review->'postingPlan'->>'planDigest'));
  v_posting:=openerp.execute_change(p_token,p_scope,v_review->'postingPlan'->>'id','sc_'||v_approval.id||'_post',
    jsonb_build_object('version',1,'planDigest',v_review->'postingPlan'->>'planDigest','approvalId',v_kernel->>'id'));
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'reviewId',p_id,'reviewDigest',v_review->>'digest',
    'approvalId',v_approval.id,'invoiceId',v_review->'input'->>'invoiceId','supplierCreditNumber',v_review->'input'->>'supplierCreditNumber',
    'creditDate',v_review->'input'->>'creditDate','amountMinor',v_review->'input'->>'amountMinor',
    'taxMinor',v_review->>'taxMinor','vatFactsCreated',false,'originalAllocatedMinor',v_review->'snapshot'->'invoice'->>'recordedAllocatedMinor',
    'postingReceipt',v_posting,'creditEvidence',v_review->'snapshot'->'creditEvidence',
    'status','credited','paid',false,
    'outstandingAfterMinor',((v_review->'snapshot'->'invoice'->>'outstandingMinor')::numeric
      -(v_review->'input'->>'amountMinor')::numeric)::text)
    ||openerp.commerce_record_metadata(p_key,'execute_supplier_credit',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.supplier_credits VALUES(p_scope->>'bookId',v_id,p_id,v_approval.id,
    v_review->'input'->>'invoiceId',v_review->'snapshot'->'invoice'->>'counterpartyId',
    v_review->'input'->>'supplierCreditNumber',(v_review->'input'->>'creditDate')::date,
    (v_review->'input'->>'amountMinor')::numeric,v_posting->>'voucherId',
    v_review->'postingPlan'->'groups'->0->'actions'->0->'lines'->0->>'lineId',
    v_review->'input'->>'creditEvidenceId',v_result);
  v_invoice:=openerp.commerce_invoice_body(p_scope->>'bookId',v_review->'input'->>'invoiceId');
  IF v_invoice->>'outstandingMinor' IS DISTINCT FROM v_result->>'outstandingAfterMinor' THEN
    PERFORM openerp.fail('InvalidJournal','The retained credit did not reduce the supplier residual by its exact amount.'); END IF;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'execute_supplier_credit',v_payload,v_result);
END $$;
