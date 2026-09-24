-- Disambiguate the snapshot JSONB key removal in the legal PDF capture guard.
-- 7610 is already versioned; replacing the approved function keeps existing grants.
CREATE OR REPLACE FUNCTION openerp.capture_ar_legal_pdf(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_issue jsonb; v_source jsonb; v_body jsonb; v_existing jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'capture_ar_legal_pdf',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['issueId','issueDigest','rendererVersion']);
 IF p_input->>'rendererVersion' IS DISTINCT FROM 'openerp-se-invoice-takumi-v1' THEN
  PERFORM openerp.fail('UnsupportedProfile','Select the pinned Takumi legal invoice renderer.'); END IF;
 SELECT body INTO v_issue FROM openerp.ar_legal_issues WHERE book_id=p_scope->>'bookId' AND id=p_input->>'issueId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal issue was not found in this book.'); END IF;
 IF v_issue->>'digest' IS DISTINCT FROM p_input->>'issueDigest'
  OR v_issue->>'digest' IS DISTINCT FROM openerp.digest(v_issue-'digest')
  OR v_issue->'scope' IS DISTINCT FROM p_scope
  OR v_issue->'issued' IS DISTINCT FROM 'true'::jsonb
  OR v_issue->'legalInvoice' IS DISTINCT FROM 'true'::jsonb
  OR v_issue->'recognized' IS DISTINCT FROM 'true'::jsonb
  OR v_issue->'delivered' IS DISTINCT FROM 'false'::jsonb
  OR v_issue->>'issuedOn' IS DISTINCT FROM v_issue->'draftSnapshot'->'content'->>'plannedIssueDate'
  OR left(v_issue->>'issuedAt',10) IS DISTINCT FROM v_issue->>'issuedOn'
  OR v_issue->'policySnapshot'->>'digest' IS DISTINCT FROM v_issue->>'policyDigest'
  OR v_issue->'draftSnapshot'->>'digest' IS DISTINCT FROM openerp.digest((v_issue->'draftSnapshot')-'digest')
  OR v_issue->>'legalDocumentNumber' LIKE 'SYN-%'
  OR NOT EXISTS(SELECT FROM openerp.ar_legal_policies p WHERE p.book_id=p_scope->>'bookId'
   AND p.id=v_issue->>'policyId' AND p.body=v_issue->'policySnapshot')
  OR NOT EXISTS(SELECT FROM openerp.execution_receipts e WHERE e.book_id=p_scope->>'bookId'
   AND e.id=v_issue->'postingReceipt'->>'id' AND e.body=v_issue->'postingReceipt')
  OR NOT EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId'
   AND i.id=v_issue->>'registerInvoiceId' AND i.document_number=v_issue->>'legalDocumentNumber'
   AND i.recognition_voucher_id=v_issue->'postingReceipt'->>'voucherId') THEN
  PERFORM openerp.fail('StaleDependency','Only the exact approved legal issue, policy, posted receipt and register can be captured.'); END IF;
 SELECT body INTO v_existing FROM openerp.ar_legal_pdf_captures WHERE book_id=p_scope->>'bookId' AND issue_id=p_input->>'issueId';
 IF FOUND THEN
  IF v_existing->'input' IS DISTINCT FROM p_input THEN
   PERFORM openerp.fail('IdempotencyConflict','This issue already has an immutable different PDF capture.'); END IF;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'capture_ar_legal_pdf',p_input,v_existing);
 END IF;
 v_source:=jsonb_build_object('issue',v_issue);
 v_body:=jsonb_build_object('id',openerp.new_id('ar_pdf'),'scope',p_scope,'issueId',v_issue->>'id',
  'input',p_input,'source',v_source,'sourceDigest',openerp.digest(v_source),
  'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 IF octet_length(v_body::text)>524288 THEN PERFORM openerp.fail('UnsupportedProfile','Complete legal PDF source exceeds 512 KiB.'); END IF;
 INSERT INTO openerp.ar_legal_pdf_captures VALUES(p_scope->>'bookId',v_body->>'id',v_issue->>'id',v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'capture_ar_legal_pdf',p_input,v_body);
END $$;
