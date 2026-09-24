-- Read the sealed acceptance review, not its receipt, for the original asserted tax capacity.
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
  SELECT (r.body->'draftSnapshot'->'totals'->>'taxMinor')::numeric INTO v_original_tax
    FROM openerp.supplier_acceptance_reviews r
    WHERE r.book_id=p_book AND r.id=v_acceptance.review_id;
  IF v_original_tax IS NULL THEN
    PERFORM openerp.fail('UnsupportedProfile','The sealed supplier acceptance has no exact source tax total.'); END IF;
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
