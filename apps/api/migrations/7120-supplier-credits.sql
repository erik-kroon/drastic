-- Synthetic zero-tax supplier credit against an accepted payable. Original and paid legs stay immutable.
CREATE TABLE openerp.supplier_credit_reviews (
  book_id text NOT NULL, id text NOT NULL, invoice_id text NOT NULL,
  change_set_id text NOT NULL, event_id text NOT NULL, evidence_id text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text)<=262144),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,change_set_id),
  FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices,
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY(book_id,event_id) REFERENCES openerp.events,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.supplier_credit_approvals (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL, actor_id text NOT NULL REFERENCES openerp.actors,
  digest text NOT NULL, expires_at timestamptz NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,id,review_id), FOREIGN KEY(book_id,review_id) REFERENCES openerp.supplier_credit_reviews
);
CREATE TABLE openerp.supplier_credits (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL, approval_id text NOT NULL,
  invoice_id text NOT NULL, counterparty_id text NOT NULL, document_number text COLLATE "C" NOT NULL,
  credit_date date NOT NULL, amount_minor openerp.minor_units NOT NULL CHECK(amount_minor>0),
  voucher_id text NOT NULL, control_line_id text NOT NULL, evidence_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,review_id), UNIQUE(book_id,approval_id),
  UNIQUE(book_id,counterparty_id,document_number), UNIQUE(book_id,voucher_id),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.supplier_credit_reviews,
  FOREIGN KEY(book_id,approval_id,review_id) REFERENCES openerp.supplier_credit_approvals(book_id,id,review_id),
  FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices,
  FOREIGN KEY(book_id,voucher_id,control_line_id) REFERENCES openerp.journal_lines,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE INDEX supplier_credits_invoice ON openerp.supplier_credits(book_id,invoice_id);
CREATE FUNCTION openerp.supplier_credit_conserve() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE v_amount numeric; v_credited numeric; v_allocated numeric; v_account text; v_line openerp.journal_lines;
BEGIN
  SELECT i.amount_minor,i.control_account_id INTO v_amount,v_account FROM openerp.commerce_invoices i
    WHERE i.book_id=NEW.book_id AND i.id=NEW.invoice_id AND i.direction='supplier';
  SELECT coalesce(sum(c.amount_minor),0) INTO v_credited FROM openerp.supplier_credits c
    WHERE c.book_id=NEW.book_id AND c.invoice_id=NEW.invoice_id;
  SELECT coalesce(sum(l.amount_minor),0) INTO v_allocated FROM openerp.commerce_active_allocation_legs l
    WHERE l.book_id=NEW.book_id AND l.invoice_id=NEW.invoice_id;
  SELECT * INTO v_line FROM openerp.journal_lines l
    WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.id=NEW.control_line_id;
  IF v_amount IS NULL OR v_credited+v_allocated>v_amount OR v_line.account_id IS DISTINCT FROM v_account
    OR v_line.debit_minor IS DISTINCT FROM NEW.amount_minor OR v_line.credit_minor IS DISTINCT FROM 0 THEN
    PERFORM openerp.fail('InvalidJournal','The supplier credit and retained payment allocations must conserve the exact original payable and control line.'); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER supplier_credit_conservation AFTER INSERT ON openerp.supplier_credits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.supplier_credit_conserve();

CREATE TRIGGER supplier_credit_review_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_credit_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_credit_approval_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_credit_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_credit_immutable BEFORE UPDATE OR DELETE ON openerp.supplier_credits
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.supplier_credit_require_aggregate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL AND EXISTS(SELECT FROM openerp.supplier_credits c
    WHERE c.book_id=NEW.book_id AND c.voucher_id=NEW.corrects_voucher_id) THEN
    PERFORM openerp.fail('StaleDependency','A supplier credit voucher belongs to a retained register effect. Generic reversal is unsupported.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_credit_no_generic_correction BEFORE INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.supplier_credit_require_aggregate();
CREATE FUNCTION openerp.supplier_credit_source_boundary() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.supplier_credit_reviews r
    WHERE r.book_id=NEW.book_id AND (r.event_id=NEW.event_id
      OR r.evidence_id IN (SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
      OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=r.evidence_id)))
    AND NOT EXISTS(SELECT FROM openerp.supplier_credits c
      JOIN openerp.supplier_credit_reviews r ON (r.book_id,r.id)=(c.book_id,c.review_id)
      WHERE c.book_id=NEW.book_id AND r.change_set_id=NEW.change_set_id AND c.voucher_id=NEW.id) THEN
    PERFORM openerp.fail('ApprovalRequired','This supplier credit source requires its exact approved credit register and posting.');
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER supplier_credit_posting_boundary AFTER INSERT ON openerp.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.supplier_credit_source_boundary();


-- Retain the old invoice calculation as a private base, then expose credit capacity in the canonical body.
CREATE FUNCTION openerp.supplier_credit_base_invoice_body(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
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
CREATE OR REPLACE FUNCTION openerp.commerce_invoice_body(p_book text,p_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,openerp AS $$
DECLARE v_base jsonb; v_total numeric; v_count bigint; v_invalid boolean;
  v_outstanding numeric; v_blockers jsonb; v_status text;
BEGIN
  v_base:=openerp.supplier_credit_base_invoice_body(p_book,p_id);
  SELECT coalesce(sum(c.amount_minor),0),count(*),bool_or(NOT openerp.commerce_voucher_current(p_book,c.voucher_id)
    OR l.account_id<>v_base->>'controlAccountId' OR l.debit_minor<>c.amount_minor OR l.credit_minor<>0)
    INTO v_total,v_count,v_invalid FROM openerp.supplier_credits c
      JOIN openerp.journal_lines l ON (l.book_id,l.voucher_id,l.id)=(c.book_id,c.voucher_id,c.control_line_id)
      WHERE c.book_id=p_book AND c.invoice_id=p_id;
  v_blockers:=v_base->'blockers';
  IF coalesce(v_invalid,false) THEN v_blockers:=v_blockers||jsonb_build_array('A supplier credit posting or payable line is invalid.'); END IF;
  IF v_total+(v_base->>'recordedAllocatedMinor')::numeric>(v_base->>'amountMinor')::numeric-(v_base->>'cancelledMinor')::numeric THEN
    v_blockers:=v_blockers||jsonb_build_array('Supplier credits and applied payments exceed the original payable.'); END IF;
  v_outstanding:=(v_base->>'amountMinor')::numeric-(v_base->>'cancelledMinor')::numeric
    -v_total-(v_base->>'recordedAllocatedMinor')::numeric;
  v_status:=CASE WHEN v_blockers<>'[]'::jsonb THEN 'blocked'
    WHEN v_base->>'status'='cancelled' THEN 'cancelled'
    WHEN v_total>0 AND v_outstanding=0 THEN 'credited'
    WHEN v_total>0 THEN 'partially_credited'
    ELSE v_base->>'status' END;
  RETURN v_base||jsonb_build_object('creditedMinor',v_total::text,'creditCount',v_count::text,
    'effectiveAmountMinor',((v_base->>'amountMinor')::numeric-(v_base->>'cancelledMinor')::numeric-v_total)::text,
    'allocationVersion',((v_base->>'allocationVersion')::bigint+v_count)::text,
    'outstandingMinor',CASE WHEN v_blockers='[]'::jsonb THEN to_jsonb(v_outstanding::text) ELSE 'null'::jsonb END,
    'status',v_status,'blockers',v_blockers);
END $$;
CREATE FUNCTION openerp.supplier_credit_snapshot(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_invoice openerp.commerce_invoices; v_body jsonb; v_acceptance openerp.supplier_acceptances;
  v_voucher openerp.vouchers; v_expense openerp.journal_lines; v_evidence jsonb; v_amount numeric;
  v_name text; v_date date;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  SELECT * INTO v_invoice FROM openerp.commerce_invoices i
    WHERE i.book_id=p_book AND i.id=p_input->>'invoiceId' AND i.direction='supplier';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select an accepted supplier payable in this book.'); END IF;
  SELECT * INTO v_acceptance FROM openerp.supplier_acceptances a
    WHERE a.book_id=p_book AND a.register_invoice_id=v_invoice.id;
  IF NOT FOUND OR v_acceptance.body->>'profile' IS DISTINCT FROM 'synthetic-manual-supplier-v1' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only a reviewed synthetic zero-tax supplier payable can be credited here.'); END IF;
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
    'amountMinor',v_amount::text,'creditDate',v_date::text,'supplierCreditNumber',v_name);
END $$;

CREATE FUNCTION openerp.prepare_supplier_credit(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
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
    'creditDate','accountingPeriodId','series','reason','acknowledgeSyntheticOnly']);
  IF p_input->>'profile' IS DISTINCT FROM 'synthetic-zero-tax-supplier-credit-v1'
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Only explicit synthetic zero-tax supplier credits are supported.'); END IF;
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
        'description','Reverse synthetic expense, zero asserted tax'))));
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'profile','synthetic-zero-tax-supplier-credit-v1',
    'input',p_input,'snapshot',v_snapshot,'postingPlan',v_plan,'taxMinor','0','vatFactsCreated',false)
    ||openerp.commerce_record_metadata(p_key,'prepare_supplier_credit',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The credit review exceeds its 256 KiB bound.'); END IF;
  INSERT INTO openerp.supplier_credit_reviews VALUES(p_scope->>'bookId',v_id,p_input->>'invoiceId',
    v_plan->>'id',v_plan->'groups'->0->'actions'->0->>'eventId',p_input->>'creditEvidenceId',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'prepare_supplier_credit',p_input,v_result);
END $$;
CREATE FUNCTION openerp.supplier_credit_current(p_book text,p_review jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_snapshot jsonb;
BEGIN
  IF p_review->>'digest' IS DISTINCT FROM openerp.digest(p_review-'digest') THEN RETURN false; END IF;
  IF EXISTS(SELECT FROM openerp.supplier_credits c WHERE c.book_id=p_book AND c.review_id=p_review->>'id') THEN RETURN false; END IF;
  BEGIN
    v_snapshot:=openerp.supplier_credit_snapshot(p_book,p_review->'input');
    PERFORM openerp.check_dependencies(p_review->'scope',p_review->'postingPlan');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN false;
  END;
  RETURN v_snapshot=p_review->'snapshot';
END $$;
CREATE FUNCTION openerp.approve_supplier_credit(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_review jsonb; v_result jsonb;
  v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input); v_id text:=openerp.new_id('credit_approval');
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'approve_supplier_credit',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['digest','acknowledgeSyntheticOnly']);
  SELECT r.body INTO v_review FROM openerp.supplier_credit_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','This supplier credit review was not found.'); END IF;
  IF p_input->>'digest' IS DISTINCT FROM v_review->>'digest' OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb
    OR NOT openerp.supplier_credit_current(p_scope->>'bookId',v_review) THEN
    PERFORM openerp.fail('StaleDependency','Approve the current exact synthetic supplier credit review.'); END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.supplier_credit_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id LIMIT 51) bounded)>=50 THEN
    PERFORM openerp.fail('InvalidJournal','This credit review reached its 50-approval bound.'); END IF;
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'reviewId',p_id,'digest',v_review->>'digest',
    'actorId',v_actor,'expiresAt',to_char((clock_timestamp()+interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'approve_supplier_credit',v_actor);
  INSERT INTO openerp.supplier_credit_approvals VALUES(p_scope->>'bookId',v_id,p_id,v_actor,v_review->>'digest',
    clock_timestamp()+interval '1 hour',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'approve_supplier_credit',v_payload,v_result);
END $$;
CREATE FUNCTION openerp.execute_supplier_credit(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
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
    'taxMinor','0','vatFactsCreated',false,'originalAllocatedMinor',v_review->'snapshot'->'invoice'->>'recordedAllocatedMinor',
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
CREATE FUNCTION openerp.get_supplier_credit_review(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_review jsonb; v_approval jsonb; v_credit jsonb; v_blocked boolean;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT r.body INTO v_review FROM openerp.supplier_credit_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The supplier credit review was not found in this book.'); END IF;
  SELECT a.body INTO v_approval FROM openerp.supplier_credit_approvals a WHERE a.book_id=p_scope->>'bookId'
    AND a.review_id=p_id ORDER BY a.expires_at DESC,a.id COLLATE "C" DESC LIMIT 1;
  SELECT c.body INTO v_credit FROM openerp.supplier_credits c WHERE c.book_id=p_scope->>'bookId' AND c.review_id=p_id;
  v_blocked:=v_credit IS NULL AND NOT openerp.supplier_credit_current(p_scope->>'bookId',v_review);
  RETURN jsonb_build_object('review',v_review,'approval',v_approval,'credit',v_credit,'dependenciesCurrent',NOT v_blocked);
END $$;
CREATE FUNCTION openerp.supplier_credit_history(p_token text,p_scope jsonb,p_invoice text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb; v_count integer;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  IF NOT EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId' AND i.id=p_invoice AND i.direction='supplier') THEN
    PERFORM openerp.fail('NotFound','The supplier invoice was not found.'); END IF;
  SELECT count(*) INTO v_count FROM openerp.supplier_credits c WHERE c.book_id=p_scope->>'bookId' AND c.invoice_id=p_invoice;
  IF v_count>50 THEN PERFORM openerp.fail('InvalidJournal','The bounded credit history is full.'); END IF;
  SELECT coalesce(jsonb_agg(c.body ORDER BY c.credit_date,c.id COLLATE "C"),'[]') INTO v_items FROM openerp.supplier_credits c
    WHERE c.book_id=p_scope->>'bookId' AND c.invoice_id=p_invoice;
  RETURN jsonb_build_object('scope',p_scope,'invoiceId',p_invoice,'count',v_count,'items',v_items);
END $$;

CREATE OR REPLACE FUNCTION openerp.commerce_period_status(p_book text,p_starts date,p_ends date) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_registered bigint; v_recognition_invalid bigint; v_allocation_invalid bigint; v_conservation_invalid bigint;
  v_sources jsonb; v_legs jsonb; v_reversals jsonb; v_cancellations jsonb; v_credits jsonb; v_credit_invalid bigint; v_book openerp.books; v_blockers jsonb:='[]';
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
  SELECT count(*) FILTER (WHERE NOT openerp.commerce_voucher_current(p_book,v.id)
      OR j.account_id<>i.control_account_id OR j.debit_minor<>c.amount_minor OR j.credit_minor<>0
      OR c.credit_date<i.issued_on OR v.posting_date<c.credit_date),
    coalesce(jsonb_agg(c.body ORDER BY c.id COLLATE "C"),'[]') INTO v_credit_invalid,v_credits
    FROM openerp.supplier_credits c
    JOIN openerp.commerce_invoices i ON (i.book_id,i.id)=(c.book_id,c.invoice_id)
    JOIN openerp.vouchers v ON (v.book_id,v.id)=(c.book_id,c.voucher_id)
    JOIN openerp.journal_lines j ON (j.book_id,j.voucher_id,j.id)=(c.book_id,c.voucher_id,c.control_line_id)
    WHERE c.book_id=p_book AND v.posting_date<=p_ends;
  SELECT v_conservation_invalid+count(*) INTO v_conservation_invalid FROM openerp.commerce_invoices i
    WHERE i.book_id=p_book AND EXISTS(SELECT FROM openerp.supplier_credits c JOIN openerp.vouchers v
      ON (v.book_id,v.id)=(c.book_id,c.voucher_id) WHERE c.book_id=i.book_id AND c.invoice_id=i.id AND v.posting_date<=p_ends)
      AND (SELECT coalesce(sum(c.amount_minor),0) FROM openerp.supplier_credits c JOIN openerp.vouchers v
        ON (v.book_id,v.id)=(c.book_id,c.voucher_id) WHERE c.book_id=i.book_id AND c.invoice_id=i.id AND v.posting_date<=p_ends)
        +(SELECT coalesce(sum(l.amount_minor),0) FROM openerp.commerce_active_allocation_legs l JOIN openerp.vouchers v
        ON (v.book_id,v.id)=(l.book_id,l.payment_voucher_id) WHERE l.book_id=i.book_id AND l.invoice_id=i.id
        AND v.posting_date<=p_ends)>i.amount_minor;
  IF v_credit_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Supplier credit control effects are invalid or reversed.'); END IF;
  IF v_recognition_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered invoice recognition is invalid or reversed.'); END IF;
  IF v_allocation_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered payment allocations have invalid or reversed references.'); END IF;
  IF v_conservation_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered allocation capacities are inconsistent.'); END IF;
  RETURN jsonb_build_object('schemaVersion',1,'coverage','not_established','startsOn',p_starts::text,'endsOn',p_ends::text,
    'registeredInvoiceCount',v_registered,'invalidRecognitionCount',v_recognition_invalid,'invalidAllocationCount',v_allocation_invalid,
    'conservationFailureCount',v_conservation_invalid,'sourceDigest',openerp.digest(jsonb_build_object(
      'scope',jsonb_build_object('bookId',p_book,'entityId',v_book.entity_id),'currency',v_book.currency,'currencyScale',v_book.currency_scale,
      'startsOn',p_starts::text,'endsOn',p_ends::text,'invoices',v_sources,'allocations',v_legs)
      ||CASE WHEN v_reversals='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('unallocations',v_reversals) END
      ||CASE WHEN v_cancellations='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('invoiceCancellations',v_cancellations) END
      ||CASE WHEN v_credits='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('supplierCredits',v_credits) END),'blockers',v_blockers);
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
    'creditedMinor',credit.amount::text,
    'effectiveAmountMinor',((CASE WHEN cancel.id IS NULL THEN i.amount_minor ELSE 0 END)-credit.amount)::text,
    'cancellation',openerp.invoice_cancellation_summary(cancel.body),
    'outstandingMinor',(CASE WHEN cancel.id IS NULL THEN i.amount_minor ELSE 0 END-paid.amount-credit.amount)::text,
    'daysOverdue',greatest(v_date-(r.body->>'dueOn')::date,0),
    'ageBucket',CASE WHEN v_date<=(r.body->>'dueOn')::date THEN 'not_due'
      WHEN v_date-(r.body->>'dueOn')::date<=30 THEN 'days_1_30'
      WHEN v_date-(r.body->>'dueOn')::date<=60 THEN 'days_31_60'
      WHEN v_date-(r.body->>'dueOn')::date<=90 THEN 'days_61_90' ELSE 'over_90' END
  ) ORDER BY i.id COLLATE "C"),'[]') INTO v_invoices
    FROM openerp.commerce_invoices i
    JOIN openerp.commerce_invoice_revisions r ON r.book_id=i.book_id AND r.invoice_id=i.id AND r.revision=i.current_revision
    LEFT JOIN openerp.invoice_cancellations cancel ON cancel.book_id=i.book_id AND cancel.register_invoice_id=i.id AND cancel.posting_date<=v_date
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(sc.amount_minor),0) AS amount FROM openerp.supplier_credits sc
        JOIN openerp.vouchers cv ON (cv.book_id,cv.id)=(sc.book_id,sc.voucher_id)
      WHERE sc.book_id=i.book_id AND sc.invoice_id=i.id AND cv.posting_date<=v_date
        AND cv.sequence<=v_book.committed_sequence
    ) credit
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
    'invoiceId',coalesce(invoice.value->>'id',cancelled.value->>'id',credit.invoice_id),'allocatedMinor',paid.amount::text,
    'cancellationId',cancelled.value->'cancellation'->>'id','creditId',credit.id,
    'registerContributionKind',CASE WHEN invoice.value IS NOT NULL THEN 'recognition' WHEN cancelled.value IS NOT NULL THEN 'cancellation'
      WHEN credit.id IS NOT NULL THEN 'credit' WHEN paid.amount>0 THEN 'allocation' ELSE 'unexplained' END,
    'registerEffectMinor',(coalesce((invoice.value->>'amountMinor')::numeric,0)-coalesce((cancelled.value->>'cancelledMinor')::numeric,0)-coalesce(credit.amount_minor,0)-paid.amount)::text,
    'unexplainedMinor',((CASE WHEN c.direction='customer' THEN l.debit_minor-l.credit_minor ELSE l.credit_minor-l.debit_minor END)
      -coalesce((invoice.value->>'amountMinor')::numeric,0)+coalesce((cancelled.value->>'cancelledMinor')::numeric,0)+coalesce(credit.amount_minor,0)+paid.amount)::text
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
    LEFT JOIN openerp.supplier_credits credit ON (credit.book_id,credit.voucher_id,credit.control_line_id)=(l.book_id,v.id,l.id)
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
    'recognizedMinor',invoices.recognized::text,'cancelledMinor',invoices.cancelled::text,
    'creditedMinor',invoices.credited::text,'allocatedMinor',invoices.allocated::text,
    'outstandingMinor',invoices.outstanding::text,'ledgerMinor',ledger.balance::text,
    'differenceMinor',(ledger.balance-invoices.outstanding)::text,'unexplainedLineCount',ledger.unexplained,
    'ageing',jsonb_build_object('not_due',invoices.not_due::text,'days_1_30',invoices.days_1_30::text,
      'days_31_60',invoices.days_31_60::text,'days_61_90',invoices.days_61_90::text,'over_90',invoices.over_90::text)
  ) ORDER BY c.account_id COLLATE "C"),'[]') INTO v_controls
    FROM openerp.commerce_control_accounts c JOIN openerp.accounts a ON a.book_id=c.book_id AND a.id=c.account_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((i->>'amountMinor')::numeric),0) AS recognized,
        coalesce(sum((i->>'cancelledMinor')::numeric),0) AS cancelled,
        coalesce(sum((i->>'creditedMinor')::numeric),0) AS credited,
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

REVOKE ALL ON openerp.supplier_credit_reviews,openerp.supplier_credit_approvals,openerp.supplier_credits FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.supplier_credit_base_invoice_body(text,text),openerp.supplier_credit_conserve(),openerp.supplier_credit_require_aggregate(),openerp.supplier_credit_source_boundary(),
  openerp.supplier_credit_snapshot(text,jsonb),openerp.supplier_credit_current(text,jsonb),
  openerp.prepare_supplier_credit(text,jsonb,text,jsonb),openerp.approve_supplier_credit(text,jsonb,text,text,jsonb),
  openerp.execute_supplier_credit(text,jsonb,text,text,jsonb),openerp.get_supplier_credit_review(text,jsonb,text),
  openerp.supplier_credit_history(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_supplier_credit(text,jsonb,text,jsonb),
  openerp.approve_supplier_credit(text,jsonb,text,text,jsonb),openerp.execute_supplier_credit(text,jsonb,text,text,jsonb),
  openerp.get_supplier_credit_review(text,jsonb,text),openerp.supplier_credit_history(text,jsonb,text) TO openerp_runtime;
