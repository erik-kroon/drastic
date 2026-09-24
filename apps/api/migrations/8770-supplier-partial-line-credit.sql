-- Synthetic-book partial line credit. Explicit source net/tax and unpaid capacity; no paid-principal refund.
CREATE FUNCTION openerp.supplier_credit_snapshot_partial(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_invoice openerp.commerce_invoices; v_body jsonb; v_acceptance openerp.supplier_acceptances;
  v_review jsonb; v_voucher openerp.vouchers; v_evidence jsonb; v_amount numeric; v_tax numeric;
  v_name text; v_date date; v_lines jsonb; v_line jsonb; v_credit_lines jsonb:='[]'::jsonb; v_requested jsonb; v_previous_net numeric; v_previous_tax numeric; v_net numeric; v_line_tax numeric; v_sum_net numeric:=0; v_sum_tax numeric:=0;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  SELECT * INTO v_invoice FROM openerp.commerce_invoices i
    WHERE i.book_id=p_book AND i.id=p_input->>'invoiceId' AND i.direction='supplier';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select an accepted supplier payable in this book.'); END IF;
  SELECT * INTO v_acceptance FROM openerp.supplier_acceptances a WHERE a.book_id=p_book AND a.register_invoice_id=v_invoice.id;
  IF NOT FOUND OR v_acceptance.body->>'profile' IS DISTINCT FROM 'swedish-purchase-v1'
    OR p_input->>'profile' IS DISTINCT FROM 'swedish-purchase-partial-credit-v1' THEN
    PERFORM openerp.fail('UnsupportedProfile','Partial credit requires an accepted reviewed Swedish purchase.'); END IF;
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
  IF v_amount>(v_body->>'outstandingMinor')::numeric THEN
    PERFORM openerp.fail('StaleDependency','The partial credit exceeds the unpaid payable. Applied payments remain unchanged.'); END IF;
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
  IF jsonb_typeof(p_input->'creditLines') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'creditLines')=0
    OR jsonb_array_length(p_input->'creditLines')>jsonb_array_length(v_lines) THEN
    PERFORM openerp.fail('InvalidJournal','Supply bounded, explicit credit-note line amounts.'); END IF;
  FOR v_requested IN SELECT value FROM jsonb_array_elements(p_input->'creditLines') LOOP
    PERFORM openerp.commerce_exact_object(v_requested,ARRAY['lineId','netMinor','taxMinor']);
    SELECT value INTO v_line FROM jsonb_array_elements(v_lines) WHERE value->>'lineId'=openerp.commerce_text(v_requested,'lineId',128);
    IF NOT FOUND OR EXISTS(SELECT FROM jsonb_array_elements(v_credit_lines) x WHERE x->>'lineId'=v_requested->>'lineId') THEN
      PERFORM openerp.fail('InvalidJournal','Each credit-note line must identify a distinct accepted invoice line.'); END IF;
    v_net:=openerp.invoice_draft_minor(v_requested,'netMinor');
    v_line_tax:=openerp.invoice_draft_minor(v_requested,'taxMinor');
    IF v_net<=0 OR abs(v_line_tax-round(v_net*(v_line->>'vatRatePercent')::integer/100))>1 THEN
      PERFORM openerp.fail('InvalidJournal','Credit-note net and tax must match the selected original rate.'); END IF;
    SELECT coalesce(sum((x->>'netMinor')::numeric),0),coalesce(sum((x->>'taxMinor')::numeric),0)
      INTO v_previous_net,v_previous_tax
      FROM openerp.supplier_credits c, jsonb_array_elements(c.body->'snapshot'->'creditLines') x
      WHERE c.book_id=p_book AND c.invoice_id=v_invoice.id AND x->>'lineId'=v_requested->>'lineId';
    IF v_previous_net+v_net>(v_line->>'netMinor')::numeric
      OR v_previous_tax+v_line_tax>(v_line->>'taxMinor')::numeric THEN
      PERFORM openerp.fail('InvalidJournal','Credit-note line exceeds its accepted remaining net or source tax.'); END IF;
    v_credit_lines:=v_credit_lines||jsonb_build_array(jsonb_build_object('lineId',v_requested->>'lineId',
      'expenseAccountId',v_line->>'expenseAccountId','netMinor',v_net::text,'taxMinor',v_line_tax::text,
      'vatRatePercent',v_line->'vatRatePercent'));
    v_sum_net:=v_sum_net+v_net; v_sum_tax:=v_sum_tax+v_line_tax;
  END LOOP;
  IF v_sum_net+v_sum_tax<>v_amount THEN
    PERFORM openerp.fail('InvalidJournal','Exact credit-note line net and tax must equal its gross amount.'); END IF;
  RETURN jsonb_build_object('invoice',v_body,'acceptanceDigest',v_acceptance.body->>'digest',
    'originalVoucherId',v_voucher.id,'originalLines',v_lines,'creditLines',v_credit_lines,
    'inputVatAccountId',v_review->>'inputVatAccountId','creditEvidence',v_evidence,
    'amountMinor',v_amount::text,'taxMinor',v_sum_tax::text,
    'creditDate',v_date::text,'supplierCreditNumber',v_name);
END $$;

CREATE FUNCTION openerp.prepare_supplier_credit_partial(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
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
    'creditDate','accountingPeriodId','series','reason','acknowledgeSyntheticOnly','creditLines']);
  IF p_input->>'profile' IS DISTINCT FROM 'swedish-purchase-partial-credit-v1'
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','This partial credit requires explicit synthetic-book acknowledgement.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  IF openerp.commerce_text(p_input,'series',16) !~ '^[A-Z0-9]{1,16}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use an uppercase voucher series.'); END IF;
  PERFORM openerp.commerce_text(p_input,'accountingPeriodId',128);
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.supplier_credit_reviews r
    WHERE r.book_id=p_scope->>'bookId' AND r.invoice_id=p_input->>'invoiceId' LIMIT 51) bounded)>=50 THEN
    PERFORM openerp.fail('InvalidJournal','This supplier invoice reached its 50-credit-review bound.'); END IF;
  v_snapshot:=openerp.supplier_credit_snapshot_partial(p_scope->>'bookId',p_input);
  v_lines:=jsonb_build_array(jsonb_build_object('accountId',v_snapshot->'invoice'->>'controlAccountId',
    'debitMinor',p_input->>'amountMinor','creditMinor','0','description','Reverse supplier payable'));
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_snapshot->'creditLines') LOOP
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_line->>'expenseAccountId',
      'debitMinor','0','creditMinor',v_line->>'netMinor','description','Reverse supplier line '||(v_line->>'lineId')));
  END LOOP;
  IF (v_snapshot->>'taxMinor')::numeric>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_snapshot->>'inputVatAccountId',
      'debitMinor','0','creditMinor',v_snapshot->>'taxMinor','description','Reverse input VAT'));
  END IF;
  v_plan:=openerp.prepare_journal(p_token,p_scope,'sc_'||v_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',p_input->>'creditEvidenceId','eventKey','supplier_credit_'||v_id,
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',p_input->>'creditDate','series',p_input->>'series',
    'description','Supplier partial credit '||(p_input->>'supplierCreditNumber'),
    'rationale',p_input->>'reason','taxAssessment','not_applicable','lines',v_lines));
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'profile','swedish-purchase-partial-credit-v1',
    'input',p_input,'snapshot',v_snapshot,'postingPlan',v_plan,'taxMinor',v_snapshot->>'taxMinor','vatFactsCreated',false)
    ||openerp.commerce_record_metadata(p_key,'prepare_supplier_credit',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The credit review exceeds its 256 KiB bound.'); END IF;
  INSERT INTO openerp.supplier_credit_reviews VALUES(p_scope->>'bookId',v_id,p_input->>'invoiceId',
    v_plan->>'id',v_plan->'groups'->0->'actions'->0->>'eventId',p_input->>'creditEvidenceId',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'prepare_supplier_credit',p_input,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.supplier_credit_snapshot(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_input->>'profile'='swedish-purchase-partial-credit-v1' THEN
    RETURN openerp.supplier_credit_snapshot_partial(p_book,p_input);
  ELSIF p_input->>'profile'='swedish-purchase-full-credit-v1' THEN
    RETURN openerp.supplier_credit_snapshot_purchase(p_book,p_input);
  END IF;
  RETURN openerp.supplier_credit_snapshot_synthetic(p_book,p_input);
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_supplier_credit(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_input->>'profile'='swedish-purchase-partial-credit-v1' THEN
    RETURN openerp.prepare_supplier_credit_partial(p_token,p_scope,p_key,p_input);
  ELSIF p_input->>'profile'='swedish-purchase-full-credit-v1' THEN
    RETURN openerp.prepare_supplier_credit_purchase(p_token,p_scope,p_key,p_input);
  END IF;
  RETURN openerp.prepare_supplier_credit_synthetic(p_token,p_scope,p_key,p_input);
END $$;

REVOKE ALL ON FUNCTION openerp.supplier_credit_snapshot_partial(text,jsonb),
  openerp.prepare_supplier_credit_partial(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_supplier_credit(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_supplier_credit(text,jsonb,text,jsonb) TO openerp_runtime;
