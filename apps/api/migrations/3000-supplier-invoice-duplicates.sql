-- Read-only COM-01 diagnostics over retained registrations, not source completeness.
-- Exact supplier identity and document spelling are preserved; no fuzzy identity merge.
CREATE FUNCTION openerp.commerce_supplier_invoice_duplicates(
  p_token text,p_scope jsonb,p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE
  v_book text := p_scope->>'bookId';
  v_party text;
  v_number text;
  v_evidence jsonb;
  v_after text := '';
  v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM openerp.commerce_exact_object(p_input-'after',ARRAY['counterpartyId','documentNumber','evidenceId']);
  v_party:=openerp.commerce_text(p_input,'counterpartyId',128);
  v_number:=openerp.commerce_text(p_input,'documentNumber',200);
  PERFORM openerp.commerce_text(p_input,'evidenceId',128);
  IF v_party !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR (p_input->>'evidenceId') !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply valid counterpart and evidence identifiers.');
  END IF;
  IF p_input ? 'after' THEN
    v_after:=openerp.commerce_text(p_input,'after',128);
    IF v_after !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Supply a valid invoice pagination identifier.');
    END IF;
  END IF;
  IF NOT EXISTS(SELECT FROM openerp.commerce_counterparties c
    WHERE c.book_id=v_book AND c.id=v_party AND c.role IN ('supplier','both')) THEN
    PERFORM openerp.fail('NotFound','Select a registered supplier in this book.');
  END IF;
  v_evidence:=openerp.commerce_evidence(v_book,p_input->>'evidenceId');

  -- Original evidence is immutable. Later metadata evidence must not replace its identity.
  -- Corrected/blocked registrations remain candidates and expose their live blockers.
  WITH page AS MATERIALIZED (
    SELECT i.id,
      i.document_number=v_number COLLATE "C" AS same_number,
      e.sha256=v_evidence->>'sha256' AS same_content
    FROM openerp.commerce_invoices i
    JOIN openerp.evidence e ON e.book_id=i.book_id AND e.id=i.evidence_id
    WHERE i.book_id=v_book AND i.direction='supplier' AND i.counterparty_id=v_party
      AND i.id COLLATE "C">v_after COLLATE "C"
      AND (i.document_number=v_number COLLATE "C" OR e.sha256=v_evidence->>'sha256')
    ORDER BY i.id COLLATE "C" LIMIT 51
  ), shown AS (
    SELECT * FROM page ORDER BY id COLLATE "C" LIMIT 50
  )
  SELECT jsonb_build_object(
    'scope',jsonb_build_object('entityId',p_scope->>'entityId','bookId',v_book),
    'counterpartyId',v_party,'documentNumber',v_number,'evidence',v_evidence,
    'coverage','registered_supplier_invoices_only',
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'invoice',openerp.commerce_invoice_body(v_book,s.id),
      'reasons',(CASE WHEN s.same_number THEN '["same_document_number"]'::jsonb ELSE '[]'::jsonb END)
        ||(CASE WHEN s.same_content THEN '["same_original_evidence_content"]'::jsonb ELSE '[]'::jsonb END)
    ) ORDER BY s.id COLLATE "C"),'[]'::jsonb),
    'next',CASE WHEN (SELECT count(*) FROM page)>50 THEN max(s.id COLLATE "C") ELSE NULL END
  ) INTO v_result FROM shown s;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION openerp.commerce_supplier_invoice_duplicates(text,jsonb,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_supplier_invoice_duplicates(text,jsonb,jsonb) TO openerp_runtime;
