-- Committed allocation reads recover the approval named by the immutable application.
-- Uncommitted reads keep their existing latest-approval selection.

CREATE OR REPLACE FUNCTION openerp.commerce_get_allocation(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_plan jsonb; v_approval jsonb; v_application jsonb; v_application_row openerp.commerce_allocation_receipts;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT p.body INTO v_plan FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The allocation plan was not found in this book.'); END IF;
  SELECT r.* INTO v_application_row FROM openerp.commerce_allocation_receipts r
    WHERE r.book_id=p_scope->>'bookId' AND r.plan_id=p_id;
  IF FOUND THEN
    v_application:=v_application_row.body;
    -- Recover the consumed approval, not a newer unused review. Expiry does not erase history.
    SELECT a.body INTO v_approval FROM openerp.commerce_allocation_approvals a
      WHERE a.book_id=v_application_row.book_id AND a.plan_id=v_application_row.plan_id
        AND a.id=v_application_row.approval_id
        AND a.digest=v_plan->>'digest'
        AND a.body->>'id'=a.id AND a.body->>'planId'=a.plan_id
        AND a.body->>'planDigest'=a.digest;
    IF v_approval IS NULL
      OR v_application->>'id' IS DISTINCT FROM v_application_row.id
      OR v_application->>'planId' IS DISTINCT FROM v_application_row.plan_id
      OR v_application->>'approvalId' IS DISTINCT FROM v_application_row.approval_id
      OR v_application->>'planDigest' IS DISTINCT FROM v_plan->>'digest' THEN
      PERFORM openerp.fail('UnsupportedProfile','The retained allocation application and consumed approval have inconsistent lineage. No alternate approval was selected.');
    END IF;
  ELSE
    SELECT a.body INTO v_approval FROM openerp.commerce_allocation_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.plan_id=p_id
      ORDER BY a.expires_at DESC,a.id COLLATE "C" DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('plan',v_plan,'dependenciesCurrent',openerp.commerce_allocation_current(p_scope->>'bookId',v_plan),
    'approval',v_approval,'application',v_application);
END $$;
