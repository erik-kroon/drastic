-- Reviewed ordinary Swedish supplier purchases. Existing synthetic profiles keep their original functions.
ALTER FUNCTION openerp.prepare_supplier_acceptance(text,jsonb,text,jsonb) RENAME TO prepare_supplier_acceptance_synthetic;
ALTER FUNCTION openerp.execute_supplier_acceptance(text,jsonb,text,text,jsonb) RENAME TO execute_supplier_acceptance_synthetic;
ALTER FUNCTION openerp.supplier_credit_snapshot(text,jsonb) RENAME TO supplier_credit_snapshot_synthetic;
ALTER FUNCTION openerp.prepare_supplier_credit(text,jsonb,text,jsonb) RENAME TO prepare_supplier_credit_synthetic;

CREATE FUNCTION openerp.supplier_purchase_lines(p_book text,p_draft jsonb,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_line jsonb; v_assignment jsonb; v_lines jsonb:='[]'::jsonb; v_net numeric; v_tax numeric;
  v_rate integer; v_account text; v_control text; v_vat text; v_count integer:=0;
BEGIN
  IF jsonb_typeof(p_input->'lineAssignments') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'lineAssignments')<>jsonb_array_length(p_draft->'content'->'lines') THEN
    PERFORM openerp.fail('InvalidJournal','Review exactly one account and VAT rate for every supplier line.'); END IF;
  SELECT a.id INTO v_control FROM openerp.accounts a WHERE a.book_id=p_book AND a.code='2440' AND a.active;
  SELECT a.id INTO v_vat FROM openerp.accounts a WHERE a.book_id=p_book AND a.code='2641' AND a.active;
  IF v_control IS NULL OR v_control IS DISTINCT FROM p_input->>'controlAccountId' OR v_vat IS NULL THEN
    PERFORM openerp.fail('InvalidJournal','This book needs active BAS 2440 and 2641 accounts, and the payable must use 2440.'); END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_draft->'content'->'lines') LOOP
    SELECT value INTO v_assignment FROM jsonb_array_elements(p_input->'lineAssignments')
      WHERE value->>'lineId'=v_line->>'id';
    IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Every supplier line needs a reviewed assignment.'); END IF;
    PERFORM openerp.commerce_exact_object(v_assignment,ARRAY['lineId','expenseAccountId','vatRatePercent']);
    IF (SELECT count(*) FROM jsonb_array_elements(p_input->'lineAssignments') x WHERE x->>'lineId'=v_line->>'id')<>1 THEN
      PERFORM openerp.fail('InvalidJournal','Supplier line assignments must have distinct line IDs.'); END IF;
    v_account:=openerp.commerce_text(v_assignment,'expenseAccountId',128);
    IF NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=v_account AND a.active
      AND a.code ~ '^[4-8][0-9]{3}$') OR v_account IN (v_control,v_vat)
      OR EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=v_account)
      OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=v_account) THEN
      PERFORM openerp.fail('InvalidJournal','Choose an active BAS expense account for each supplier line.'); END IF;
    IF jsonb_typeof(v_assignment->'vatRatePercent') IS DISTINCT FROM 'number'
      OR (v_assignment->>'vatRatePercent') NOT IN ('0','6','12','25') THEN
      PERFORM openerp.fail('InvalidJournal','Ordinary purchase VAT rates are 0, 6, 12 or 25 percent.'); END IF;
    v_rate:=(v_assignment->>'vatRatePercent')::integer;
    v_net:=(v_line->>'baseMinor')::numeric-(v_line->>'discountMinor')::numeric+(v_line->>'chargeMinor')::numeric;
    v_tax:=(v_line->>'taxMinor')::numeric;
    IF v_net<=0 OR v_tax<0 OR abs(v_tax-round(v_net*v_rate/100))>1 THEN
      PERFORM openerp.fail('InvalidJournal','The reviewed VAT rate does not match the evidenced line tax within one minor unit.'); END IF;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('lineId',v_line->>'id','expenseAccountId',v_account,
      'netMinor',v_net::text,'taxMinor',v_tax::text,'vatRatePercent',v_rate));
    v_count:=v_count+1;
  END LOOP;
  IF v_count<>jsonb_array_length(p_input->'lineAssignments') THEN
    PERFORM openerp.fail('InvalidJournal','Unknown supplier line assignment.'); END IF;
  RETURN jsonb_build_object('originalLines',v_lines,'inputVatAccountId',v_vat);
END $$;

CREATE FUNCTION openerp.prepare_supplier_acceptance_purchase(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_draft jsonb; v_evidence jsonb; v_posting jsonb;
  v_result jsonb; v_id text:=openerp.new_id('supplier_review'); v_ordinal integer; v_field text;
  v_detail jsonb; v_line jsonb; v_lines jsonb:='[]'::jsonb; v_tax numeric:=0; v_net numeric:=0;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'prepare_supplier_acceptance',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','draftId','expectedRevision','expectedDigest','controlAccountId',
    'lineAssignments','accountingPeriodId','series','reason','acknowledgeSyntheticOnly']);
  IF p_input->>'profile' IS DISTINCT FROM 'swedish-purchase-v1' OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','This purchase profile requires explicit synthetic-book acknowledgement.'); END IF;
  FOREACH v_field IN ARRAY ARRAY['draftId','controlAccountId','accountingPeriodId'] LOOP
    IF openerp.commerce_text(p_input,v_field,128) !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Supply scoped draft, payable and period identifiers.'); END IF;
  END LOOP;
  IF openerp.commerce_text(p_input,'expectedRevision',18) !~ '^[1-9][0-9]{0,17}$'
    OR openerp.commerce_text(p_input,'expectedDigest',71) !~ '^sha256:[a-f0-9]{64}$'
    OR openerp.commerce_text(p_input,'series',16) !~ '^[A-Z0-9]{1,16}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply an exact draft revision/digest and an uppercase voucher series.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_draft:=openerp.supplier_acceptance_draft(v_book.id,p_input);
  IF v_book.currency<>'SEK' OR v_book.currency_scale<>2
    OR v_draft->'content'->>'currency'<>'SEK' OR v_draft->'content'->'currencyScale'<>'2'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Ordinary Swedish purchase posting requires a SEK book with two minor digits.'); END IF;
  v_detail:=openerp.supplier_purchase_lines(v_book.id,v_draft,p_input);
  SELECT count(*)+1 INTO v_ordinal FROM openerp.supplier_acceptance_reviews r WHERE r.book_id=v_book.id AND r.draft_id=p_input->>'draftId';
  IF v_ordinal>50 THEN PERFORM openerp.fail('InvalidJournal','This draft reached its 50-review bound.'); END IF;
  v_evidence:=openerp.commerce_evidence(v_book.id,v_draft->'content'->>'sourceEvidenceId');
  IF EXISTS(SELECT FROM openerp.vouchers v JOIN openerp.events e ON e.book_id=v.book_id AND e.id=v.event_id
    WHERE v.book_id=v_book.id AND (e.evidence_id=v_evidence->>'evidenceId'
      OR EXISTS(SELECT FROM jsonb_array_elements(v.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=v_evidence->>'evidenceId'))) THEN
    PERFORM openerp.fail('AlreadyPosted','This original supplier source already has posted history.'); END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_detail->'originalLines') LOOP
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_line->>'expenseAccountId',
      'debitMinor',v_line->>'netMinor','creditMinor','0','description','Supplier line '||(v_line->>'lineId')));
    v_net:=v_net+(v_line->>'netMinor')::numeric; v_tax:=v_tax+(v_line->>'taxMinor')::numeric;
  END LOOP;
  IF v_net IS DISTINCT FROM (v_draft->'totals'->>'netMinor')::numeric OR v_tax IS DISTINCT FROM (v_draft->'totals'->>'taxMinor')::numeric
    OR v_tax<=0 THEN PERFORM openerp.fail('InvalidJournal','Ordinary purchase totals must retain positive, exact input VAT.'); END IF;
  v_lines:=v_lines||jsonb_build_array(
    jsonb_build_object('accountId',v_detail->>'inputVatAccountId','debitMinor',v_tax::text,'creditMinor','0','description','Input VAT'),
    jsonb_build_object('accountId',p_input->>'controlAccountId','debitMinor','0','creditMinor',v_draft->'totals'->>'grossMinor','description','Supplier payable'));
  v_posting:=openerp.prepare_journal(p_token,p_scope,'sa_'||v_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',v_evidence->>'evidenceId','eventKey','swedish_supplier_'||(v_draft->>'id'),
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',v_draft->'content'->>'documentDate',
    'series',p_input->>'series','description','Supplier invoice: '||(v_draft->'content'->>'title'),
    'rationale',p_input->>'reason','taxAssessment','not_applicable','lines',v_lines));
  v_result:=jsonb_build_object('id',v_id,'scope',jsonb_build_object('entityId',v_book.entity_id,'bookId',v_book.id),
    'version',1,'profile','swedish-purchase-v1','ordinal',v_ordinal,'input',p_input,'draftSnapshot',v_draft,
    'originalLines',v_detail->'originalLines','inputVatAccountId',v_detail->>'inputVatAccountId',
    'postingPlan',v_posting,'evidence',v_evidence,
    'legalBlockers',jsonb_build_array('legal_identity_not_verified','tax_profile_not_activated','payment_not_initiated'))
    ||openerp.commerce_record_metadata(p_key,'prepare_supplier_acceptance',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The acceptance review exceeds 256 KiB.'); END IF;
  INSERT INTO openerp.supplier_acceptance_reviews VALUES(v_book.id,v_id,v_draft->>'id',(v_draft->>'revision')::bigint,
    v_ordinal,v_posting->>'id',v_posting->'groups'->0->'actions'->0->>'eventId',v_evidence->>'evidenceId',v_result);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'prepare_supplier_acceptance',p_input,v_result);
END $$;

CREATE FUNCTION openerp.prepare_supplier_acceptance(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_input->>'profile'='swedish-purchase-v1' THEN
    RETURN openerp.prepare_supplier_acceptance_purchase(p_token,p_scope,p_key,p_input);
  END IF;
  RETURN openerp.prepare_supplier_acceptance_synthetic(p_token,p_scope,p_key,p_input);
END $$;

CREATE FUNCTION openerp.execute_supplier_acceptance_purchase(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_review jsonb; v_approval openerp.supplier_acceptance_approvals;
  v_kernel_approval jsonb; v_posting jsonb; v_registered jsonb; v_result jsonb; v_draft jsonb;
  v_id text:=openerp.new_id('supplier_acceptance'); v_control_line text;
  v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'execute_supplier_acceptance',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','approvalId','acknowledgeSyntheticOnly']);
  v_review:=openerp.supplier_acceptance_checked(p_scope->>'bookId',p_id,p_input);
  IF v_review->>'profile' IS DISTINCT FROM 'swedish-purchase-v1' THEN PERFORM openerp.fail('UnsupportedProfile','Select the purchase review.'); END IF;
  PERFORM openerp.commerce_text(p_input,'approvalId',128);
  SELECT * INTO v_approval FROM openerp.supplier_acceptance_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR v_approval.actor_id IS DISTINCT FROM v_actor OR v_approval.digest IS DISTINCT FROM v_review->>'digest'
    OR v_approval.expires_at<=clock_timestamp()
    OR EXISTS(SELECT FROM openerp.supplier_acceptances i WHERE i.book_id=p_scope->>'bookId' AND i.approval_id=v_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','The same current operator must execute their unexpired, unused exact supplier acceptance approval.'); END IF;
  SELECT l.value->>'lineId' INTO v_control_line
    FROM jsonb_array_elements(v_review->'postingPlan'->'groups'->0->'actions'->0->'lines') l(value)
    WHERE l.value->>'accountId'=v_review->'input'->>'controlAccountId'
      AND l.value->>'creditMinor'=v_review->'draftSnapshot'->'totals'->>'grossMinor';
  IF v_control_line IS NULL THEN PERFORM openerp.fail('InvalidJournal','The reviewed payable line is missing.'); END IF;
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
    'recognitionLineId',v_control_line,'evidenceId',v_review->'evidence'->>'evidenceId',
    'description','Supplier invoice: '||(v_draft->'content'->>'title')));
  v_result:=jsonb_build_object('id',v_id,'scope',v_review->'scope','reviewId',p_id,'reviewDigest',v_review->>'digest',
    'approvalId',v_approval.id,'profile','swedish-purchase-v1','draftId',v_draft->>'id',
    'draftRevision',v_draft->>'revision','draftDigest',v_draft->>'digest','supplierDocumentNumber',v_draft->'content'->>'supplierDocumentNumber',
    'accepted',true,'recognized',true,'paid',false,'postingReceipt',v_posting,'registerInvoiceId',v_registered->>'id',
    'legalBlockers',v_review->'legalBlockers')||openerp.commerce_record_metadata(p_key,'execute_supplier_acceptance',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.supplier_acceptances VALUES(p_scope->>'bookId',v_id,p_id,v_approval.id,v_draft->>'id',
    (v_draft->>'revision')::bigint,v_posting->>'id',v_registered->>'id',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'execute_supplier_acceptance',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.execute_supplier_acceptance(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.supplier_acceptance_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id
    AND r.body->>'profile'='swedish-purchase-v1') THEN
    RETURN openerp.execute_supplier_acceptance_purchase(p_token,p_scope,p_id,p_key,p_input);
  END IF;
  RETURN openerp.execute_supplier_acceptance_synthetic(p_token,p_scope,p_id,p_key,p_input);
END $$;

CREATE FUNCTION openerp.supplier_credit_snapshot_purchase(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_invoice openerp.commerce_invoices; v_body jsonb; v_acceptance openerp.supplier_acceptances;
  v_review jsonb; v_voucher openerp.vouchers; v_evidence jsonb; v_amount numeric; v_tax numeric;
  v_name text; v_date date; v_lines jsonb; v_line jsonb;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  SELECT * INTO v_invoice FROM openerp.commerce_invoices i
    WHERE i.book_id=p_book AND i.id=p_input->>'invoiceId' AND i.direction='supplier';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select an accepted supplier payable in this book.'); END IF;
  SELECT * INTO v_acceptance FROM openerp.supplier_acceptances a WHERE a.book_id=p_book AND a.register_invoice_id=v_invoice.id;
  IF NOT FOUND OR v_acceptance.body->>'profile' IS DISTINCT FROM 'swedish-purchase-v1'
    OR p_input->>'profile' IS DISTINCT FROM 'swedish-purchase-full-credit-v1' THEN
    PERFORM openerp.fail('UnsupportedProfile','Full credit requires an accepted ordinary Swedish purchase.'); END IF;
  SELECT r.body INTO STRICT v_review FROM openerp.supplier_acceptance_reviews r
    WHERE r.book_id=p_book AND r.id=v_acceptance.review_id;
  v_body:=openerp.commerce_invoice_body(p_book,v_invoice.id);
  IF v_body->'blockers'<>'[]'::jsonb OR v_body->>'outstandingMinor' IS NULL THEN
    PERFORM openerp.fail('StaleDependency','Resolve the payable and allocation blockers before crediting it.'); END IF;
  IF p_input->>'expectedOutstandingMinor' IS DISTINCT FROM v_body->>'outstandingMinor'
    OR p_input->>'expectedAllocationVersion' IS DISTINCT FROM v_body->>'allocationVersion'
    OR p_input->>'expectedInvoiceRevision' IS DISTINCT FROM v_body->'currentRevision'->>'revision'
    OR p_input->>'acceptanceDigest' IS DISTINCT FROM v_acceptance.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Reopen the supplier payable and select the current acceptance, invoice and residual.'); END IF;
  IF EXISTS(SELECT FROM openerp.supplier_payment_batch_items x WHERE x.book_id=p_book AND x.invoice_id=v_invoice.id) THEN
    PERFORM openerp.fail('StaleDependency','Resolve the exported payment file outcome before reducing this payable.'); END IF;
  v_amount:=openerp.commerce_positive_minor(p_input,'amountMinor');
  IF v_amount<>v_invoice.amount_minor OR v_amount<>(v_body->>'outstandingMinor')::numeric
    OR EXISTS(SELECT FROM openerp.supplier_credits c WHERE c.book_id=p_book AND c.invoice_id=v_invoice.id) THEN
    PERFORM openerp.fail('UnsupportedProfile','A full credit requires the complete unpaid original amount and no earlier credits.'); END IF;
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
    PERFORM openerp.fail('AlreadyPosted','The supplier credit source already has posted history.'); END IF;
  v_date:=openerp.bank_date(p_input->>'creditDate');
  SELECT * INTO STRICT v_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=v_invoice.recognition_voucher_id;
  IF v_date<v_invoice.issued_on OR v_date<v_voucher.posting_date THEN
    PERFORM openerp.fail('InvalidJournal','The supplier credit date cannot precede its original invoice and recognition.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=v_voucher.id
    AND l.id=v_invoice.recognition_line_id AND l.account_id=v_invoice.control_account_id
    AND l.credit_minor=v_invoice.amount_minor AND l.debit_minor=0) THEN
    PERFORM openerp.fail('StaleDependency','The original supplier payable line no longer matches its register.'); END IF;
  v_lines:=v_review->'originalLines';
  IF jsonb_typeof(v_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(v_lines)=0 THEN
    PERFORM openerp.fail('UnsupportedProfile','The original reviewed line assignments are missing.'); END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
    IF NOT EXISTS(SELECT FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=v_voucher.id
      AND l.account_id=v_line->>'expenseAccountId' AND l.debit_minor=(v_line->>'netMinor')::numeric AND l.credit_minor=0) THEN
      PERFORM openerp.fail('StaleDependency','The original expense posting does not match its accepted review.'); END IF;
  END LOOP;
  IF EXISTS(
    (SELECT x->>'expenseAccountId' account_id,(x->>'netMinor')::numeric debit_minor
      FROM jsonb_array_elements(v_lines) x
     EXCEPT ALL
     SELECT l.account_id,l.debit_minor FROM openerp.journal_lines l
      WHERE l.book_id=p_book AND l.voucher_id=v_voucher.id
        AND l.account_id NOT IN (v_invoice.control_account_id,v_review->>'inputVatAccountId'))
    UNION ALL
    (SELECT l.account_id,l.debit_minor FROM openerp.journal_lines l
      WHERE l.book_id=p_book AND l.voucher_id=v_voucher.id
        AND l.account_id NOT IN (v_invoice.control_account_id,v_review->>'inputVatAccountId')
     EXCEPT ALL
     SELECT x->>'expenseAccountId',(x->>'netMinor')::numeric FROM jsonb_array_elements(v_lines) x)
  ) THEN PERFORM openerp.fail('StaleDependency','The original expense legs differ from the accepted lines.'); END IF;
  SELECT coalesce(sum((x->>'taxMinor')::numeric),0) INTO v_tax FROM jsonb_array_elements(v_lines) x;
  IF NOT EXISTS(SELECT FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=v_voucher.id
    AND l.account_id=v_review->>'inputVatAccountId' AND l.debit_minor=v_tax AND l.credit_minor=0)
    OR (SELECT count(*) FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=v_voucher.id)
      <>jsonb_array_length(v_lines)+2 THEN
    PERFORM openerp.fail('StaleDependency','The original input VAT posting does not match its accepted review.'); END IF;
  RETURN jsonb_build_object('invoice',v_body,'acceptanceDigest',v_acceptance.body->>'digest',
    'originalVoucherId',v_voucher.id,'originalLines',v_lines,'inputVatAccountId',v_review->>'inputVatAccountId',
    'creditEvidence',v_evidence,'amountMinor',v_amount::text,'taxMinor',v_tax::text,
    'creditDate',v_date::text,'supplierCreditNumber',v_name);
END $$;

CREATE FUNCTION openerp.supplier_credit_snapshot(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_input->>'profile'='swedish-purchase-full-credit-v1' THEN
    RETURN openerp.supplier_credit_snapshot_purchase(p_book,p_input);
  END IF;
  RETURN openerp.supplier_credit_snapshot_synthetic(p_book,p_input);
END $$;

CREATE FUNCTION openerp.prepare_supplier_credit_purchase(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_snapshot jsonb; v_plan jsonb; v_result jsonb;
  v_id text:=openerp.new_id('supplier_credit_review'); v_lines jsonb:='[]'::jsonb; v_line jsonb;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'prepare_supplier_credit',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','invoiceId','acceptanceDigest','expectedInvoiceRevision',
    'expectedAllocationVersion','expectedOutstandingMinor','creditEvidenceId','supplierCreditNumber','amountMinor',
    'creditDate','accountingPeriodId','series','reason','acknowledgeSyntheticOnly']);
  IF p_input->>'profile' IS DISTINCT FROM 'swedish-purchase-full-credit-v1'
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','This full credit requires explicit synthetic-book acknowledgement.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  IF openerp.commerce_text(p_input,'series',16) !~ '^[A-Z0-9]{1,16}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use an uppercase voucher series.'); END IF;
  PERFORM openerp.commerce_text(p_input,'accountingPeriodId',128);
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.supplier_credit_reviews r
    WHERE r.book_id=p_scope->>'bookId' AND r.invoice_id=p_input->>'invoiceId' LIMIT 51) bounded)>=50 THEN
    PERFORM openerp.fail('InvalidJournal','This supplier invoice reached its 50-credit-review bound.'); END IF;
  v_snapshot:=openerp.supplier_credit_snapshot_purchase(p_scope->>'bookId',p_input);
  v_lines:=jsonb_build_array(jsonb_build_object('accountId',v_snapshot->'invoice'->>'controlAccountId',
    'debitMinor',p_input->>'amountMinor','creditMinor','0','description','Reverse supplier payable'));
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_snapshot->'originalLines') LOOP
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_line->>'expenseAccountId',
      'debitMinor','0','creditMinor',v_line->>'netMinor','description','Reverse supplier line '||(v_line->>'lineId')));
  END LOOP;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_snapshot->>'inputVatAccountId',
    'debitMinor','0','creditMinor',v_snapshot->>'taxMinor','description','Reverse input VAT'));
  v_plan:=openerp.prepare_journal(p_token,p_scope,'sc_'||v_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',p_input->>'creditEvidenceId','eventKey','supplier_credit_'||v_id,
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',p_input->>'creditDate','series',p_input->>'series',
    'description','Supplier full credit '||(p_input->>'supplierCreditNumber'),
    'rationale',p_input->>'reason','taxAssessment','not_applicable','lines',v_lines));
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'profile','swedish-purchase-full-credit-v1',
    'input',p_input,'snapshot',v_snapshot,'postingPlan',v_plan,'taxMinor',v_snapshot->>'taxMinor','vatFactsCreated',false)
    ||openerp.commerce_record_metadata(p_key,'prepare_supplier_credit',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The credit review exceeds its 256 KiB bound.'); END IF;
  INSERT INTO openerp.supplier_credit_reviews VALUES(p_scope->>'bookId',v_id,p_input->>'invoiceId',
    v_plan->>'id',v_plan->'groups'->0->'actions'->0->>'eventId',p_input->>'creditEvidenceId',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'prepare_supplier_credit',p_input,v_result);
END $$;

CREATE FUNCTION openerp.prepare_supplier_credit(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_input->>'profile'='swedish-purchase-full-credit-v1' THEN
    RETURN openerp.prepare_supplier_credit_purchase(p_token,p_scope,p_key,p_input);
  END IF;
  RETURN openerp.prepare_supplier_credit_synthetic(p_token,p_scope,p_key,p_input);
END $$;

REVOKE ALL ON FUNCTION openerp.supplier_purchase_lines(text,jsonb,jsonb),
  openerp.prepare_supplier_acceptance_purchase(text,jsonb,text,jsonb),
  openerp.execute_supplier_acceptance_purchase(text,jsonb,text,text,jsonb),
  openerp.supplier_credit_snapshot_purchase(text,jsonb),
  openerp.prepare_supplier_credit_purchase(text,jsonb,text,jsonb),
  openerp.supplier_credit_snapshot(text,jsonb)
  FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_supplier_acceptance(text,jsonb,text,jsonb),
  openerp.execute_supplier_acceptance(text,jsonb,text,text,jsonb),
  openerp.prepare_supplier_credit(text,jsonb,text,jsonb)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_supplier_acceptance(text,jsonb,text,jsonb),
  openerp.execute_supplier_acceptance(text,jsonb,text,text,jsonb),
  openerp.prepare_supplier_credit(text,jsonb,text,jsonb) TO openerp_runtime;

-- Disclose the exact acceptance selected by a payable without changing its accounting body.
ALTER FUNCTION openerp.commerce_invoice_body(text,text) RENAME TO commerce_invoice_body_without_acceptance;
CREATE FUNCTION openerp.commerce_invoice_body(p_book text,p_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,openerp AS $$
DECLARE v_body jsonb; v_digest text; v_profile text;
BEGIN
  v_body:=openerp.commerce_invoice_body_without_acceptance(p_book,p_id);
  SELECT a.body->>'digest',a.body->>'profile' INTO v_digest,v_profile FROM openerp.supplier_acceptances a
    WHERE a.book_id=p_book AND a.register_invoice_id=p_id;
  IF v_digest IS NOT NULL THEN
    v_body:=v_body||jsonb_build_object('supplierAcceptanceDigest',v_digest,'supplierAcceptanceProfile',v_profile);
  END IF;
  RETURN v_body;
END $$;

CREATE FUNCTION openerp.supplier_account_suggestions(p_token text,p_scope jsonb,p_counterparty_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  IF NOT EXISTS(SELECT FROM openerp.commerce_counterparties c WHERE c.book_id=p_scope->>'bookId'
    AND c.id=p_counterparty_id AND c.role IN ('supplier','both')) THEN
    PERFORM openerp.fail('NotFound','Select a supplier in this book.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('expenseAccountId',s.expense_account_id,
    'vatRatePercent',s.vat_rate_percent,'sourceInvoiceId',s.invoice_id) ORDER BY s.accepted_at DESC,s.invoice_id DESC),'[]'::jsonb)
    INTO v_items FROM (
      SELECT * FROM (
        SELECT DISTINCT ON (x.value->>'expenseAccountId',x.value->>'vatRatePercent')
          x.value->>'expenseAccountId' expense_account_id,(x.value->>'vatRatePercent')::integer vat_rate_percent,
          a.register_invoice_id invoice_id,a.body->>'createdAt' accepted_at
        FROM openerp.supplier_acceptances a
        JOIN openerp.supplier_acceptance_reviews r ON r.book_id=a.book_id AND r.id=a.review_id
        CROSS JOIN LATERAL jsonb_array_elements(r.body->'originalLines') x(value)
        WHERE a.book_id=p_scope->>'bookId' AND a.body->>'profile'='swedish-purchase-v1'
          AND r.body->'draftSnapshot'->'content'->>'counterpartyId'=p_counterparty_id
        ORDER BY x.value->>'expenseAccountId',x.value->>'vatRatePercent',a.body->>'createdAt' DESC,a.register_invoice_id DESC
      ) latest ORDER BY accepted_at DESC,invoice_id DESC LIMIT 5
    ) s;
  RETURN jsonb_build_object('scope',p_scope,'counterpartyId',p_counterparty_id,'items',v_items);
END $$;
REVOKE ALL ON FUNCTION openerp.commerce_invoice_body(text,text),
  openerp.supplier_account_suggestions(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.supplier_account_suggestions(text,jsonb,text) TO openerp_runtime;

ALTER FUNCTION openerp.supplier_acceptance_blockers(text,jsonb) RENAME TO supplier_acceptance_blockers_without_purchase;
CREATE FUNCTION openerp.supplier_acceptance_blockers(p_book text,p_review jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_blockers jsonb; v_message text;
BEGIN
  v_blockers:=openerp.supplier_acceptance_blockers_without_purchase(p_book,p_review);
  IF v_blockers<>'[]'::jsonb OR p_review->>'profile'<>'swedish-purchase-v1' THEN RETURN v_blockers; END IF;
  BEGIN
    PERFORM openerp.supplier_purchase_lines(p_book,p_review->'draftSnapshot',p_review->'input');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    RETURN jsonb_build_array(v_message);
  END;
  RETURN '[]'::jsonb;
END $$;
REVOKE ALL ON FUNCTION openerp.supplier_acceptance_blockers(text,jsonb) FROM PUBLIC,openerp_runtime;
