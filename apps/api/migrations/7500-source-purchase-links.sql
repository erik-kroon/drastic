-- Read scoped purchase work from the original's retained occurrence identity.
-- Entry evidence is user supplied; malformed JSON is never treated as a link.
CREATE FUNCTION openerp.purchase_source_reference(p_content text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_entry jsonb;
BEGIN
  v_entry:=p_content::jsonb;
  IF v_entry->>'kind' IN ('expense_entry_v1','supplier_invoice_source_v1')
    AND jsonb_typeof(v_entry->'source')='object' THEN
    RETURN v_entry->'source';
  END IF;
  RETURN NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;

CREATE FUNCTION openerp.get_source_purchase_links(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_source openerp.intake_occurrences; v_drafts jsonb; v_expenses jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT * INTO v_source FROM openerp.intake_occurrences o
    WHERE o.book_id=p_scope->>'bookId' AND o.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The original was not found in this book.'); END IF;
  IF (SELECT count(*) FROM openerp.supplier_invoice_drafts d WHERE d.book_id=v_source.book_id)>200
    OR (SELECT count(*) FROM openerp.expense_tax_sources s WHERE s.book_id=v_source.book_id)>200 THEN
    PERFORM openerp.fail('UnsupportedProfile','Purchase source links exceed the complete inventory bound. No partial links are returned.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',r.body->'content'->>'title',
    'revision',r.body->>'revision') ORDER BY d.id COLLATE "C"),'[]') INTO v_drafts
  FROM openerp.supplier_invoice_drafts d
  JOIN openerp.supplier_invoice_draft_revisions r ON r.book_id=d.book_id
    AND r.draft_id=d.id AND r.revision=d.current_revision
  JOIN openerp.evidence e ON e.book_id=d.book_id AND e.id=r.body->'content'->>'sourceEvidenceId'
  WHERE d.book_id=v_source.book_id
    AND openerp.purchase_source_reference(e.content)->>'occurrenceId'=p_id
    AND openerp.purchase_source_reference(e.content)->>'sha256'=v_source.body->>'sha256';

  WITH linked AS (
    SELECT DISTINCT r.source_id FROM openerp.expense_tax_source_revisions r
    JOIN openerp.evidence e ON e.book_id=r.book_id AND e.id=r.evidence_id
    WHERE r.book_id=v_source.book_id
      AND openerp.purchase_source_reference(e.content)->>'occurrenceId'=p_id
      AND openerp.purchase_source_reference(e.content)->>'sha256'=v_source.body->>'sha256'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,
    'description',r.body->'facts'->>'description',
    'currentSource',coalesce(openerp.purchase_source_reference(current_e.content)->>'occurrenceId'=p_id
      AND openerp.purchase_source_reference(current_e.content)->>'sha256'=v_source.body->>'sha256',false),
    'reviewCurrent',w.source_id IS NULL AND coalesce(v.body->>'sourceDigest'=r.body->>'digest',false),
    'withdrawn',w.source_id IS NOT NULL) ORDER BY s.id COLLATE "C"),'[]') INTO v_expenses
  FROM linked l JOIN openerp.expense_tax_sources s ON s.book_id=v_source.book_id AND s.id=l.source_id
  JOIN LATERAL (SELECT x.body FROM openerp.expense_tax_source_revisions x
    WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true
  JOIN openerp.evidence current_e ON current_e.book_id=s.book_id AND current_e.id=r.body->'facts'->>'evidenceId'
  LEFT JOIN LATERAL (SELECT x.body FROM openerp.expense_tax_reviews x
    WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) v ON true
  LEFT JOIN openerp.expense_tax_source_withdrawals w ON w.book_id=s.book_id AND w.source_id=s.id;

  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',p_scope->>'entityId','bookId',v_source.book_id),
    'occurrenceId',p_id,'supplierDrafts',v_drafts,'expenses',v_expenses);
END $$;

REVOKE ALL ON FUNCTION openerp.purchase_source_reference(text),
  openerp.get_source_purchase_links(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_source_purchase_links(text,jsonb,text) TO openerp_runtime;
