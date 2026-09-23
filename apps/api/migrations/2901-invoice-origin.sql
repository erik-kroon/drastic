-- Keep issued document actions addressable from the registered invoice itself.
CREATE OR REPLACE FUNCTION openerp.commerce_get_invoice(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_invoice jsonb; v_origin jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 v_invoice:=openerp.commerce_invoice_body(p_scope->>'bookId',p_id);
 SELECT jsonb_build_object('issueId',i.id,'reviewId',i.review_id,'draftId',i.draft_id)
 INTO v_origin FROM openerp.invoice_issues i
 WHERE i.book_id=p_scope->>'bookId' AND i.register_invoice_id=p_id;
 RETURN v_invoice||jsonb_build_object('issueOrigin',v_origin);
END $$;
REVOKE ALL ON FUNCTION openerp.commerce_get_invoice(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.commerce_get_invoice(text,jsonb,text) TO openerp_runtime;
