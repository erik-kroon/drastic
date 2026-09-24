-- Live, read-only reasons to inspect other supplier drafts and retained registrations.
-- No duplicate verdict, source reservation, acceptance, posting or saved review artifact.
CREATE FUNCTION openerp.supplier_invoice_draft_duplicates(
  p_token text,p_scope jsonb,p_id text,p_after text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE v_book text:=p_scope->>'bookId';v_source jsonb;v_party text;v_number text;v_sha text;v_context text;
  v_after_kind text:='';v_after_id text:='';v_after_revision bigint;v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=v_book FOR SHARE;
  SELECT r.body INTO v_source FROM openerp.supplier_invoice_drafts d
    JOIN openerp.supplier_invoice_draft_revisions r
      ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision
    WHERE d.book_id=v_book AND d.id=p_id;
  IF v_source IS NULL THEN PERFORM openerp.fail('NotFound','The supplier commercial draft was not found in this book.'); END IF;
  v_party:=v_source->'content'->>'counterpartyId';
  v_number:=v_source->'content'->>'supplierDocumentNumber';
  v_sha:=v_source->'sourceEvidence'->>'sha256';
  v_context:=substr(openerp.digest(jsonb_build_object('entityId',p_scope->>'entityId','bookId',v_book,
    'draftId',p_id,'draftDigest',v_source->>'digest')),8);
  IF p_after IS DISTINCT FROM '' THEN
    IF p_after IS NULL OR length(p_after)>203
      OR p_after !~ '^sid1:[a-f0-9]{64}:(d:[a-z][a-z0-9_-]{2,127}:([1-9]|[1-4][0-9]|50)|r:[a-z][a-z0-9_-]{2,127}:0)$'
      OR split_part(p_after,':',2) IS DISTINCT FROM v_context THEN
      PERFORM openerp.fail('InvalidJournal','Use the bounded duplicate-review cursor for this current draft revision and scope. Omit after and restart if the source changed.'); END IF;
    v_after_kind:=split_part(p_after,':',3);v_after_id:=split_part(p_after,':',4);
    v_after_revision:=split_part(p_after,':',5)::bigint;
    IF v_after_kind='d' THEN
      -- Anchor the captured immutable revision, even if its current head no longer matches.
      IF NOT EXISTS(SELECT FROM openerp.supplier_invoice_draft_revisions r
        WHERE r.book_id=v_book AND r.draft_id=v_after_id AND r.draft_id<>p_id AND r.revision=v_after_revision
          AND r.body->'content'->>'counterpartyId'=v_party
          AND ((v_number IS NOT NULL AND r.body->'content'->>'supplierDocumentNumber'=v_number COLLATE "C")
            OR r.body->'sourceEvidence'->>'sha256'=v_sha)) THEN
        PERFORM openerp.fail('InvalidJournal','The cursor does not identify a retained matching supplier draft revision.'); END IF;
    ELSE
      IF NOT EXISTS(SELECT FROM openerp.commerce_invoices i
        JOIN openerp.evidence e ON e.book_id=i.book_id AND e.id=i.evidence_id
        WHERE i.book_id=v_book AND i.id=v_after_id AND i.direction='supplier' AND i.counterparty_id=v_party
          AND ((v_number IS NOT NULL AND i.document_number=v_number COLLATE "C") OR e.sha256=v_sha)) THEN
        PERFORM openerp.fail('InvalidJournal','The cursor does not identify a matching registered supplier invoice.'); END IF;
    END IF;
  END IF;
  -- Only matching identity tuples and reasons reach this bounded materialization.
  -- Full draft summaries and registration bodies are built for the first50 only.
  WITH page AS MATERIALIZED (
    SELECT candidate.* FROM (
      SELECT 'd'::text AS kind,d.id,r.revision,
        (v_number IS NOT NULL AND r.body->'content'->>'supplierDocumentNumber'=v_number COLLATE "C") AS same_number,
        r.body->'sourceEvidence'->>'sha256'=v_sha AS same_content
      FROM openerp.supplier_invoice_drafts d
      JOIN openerp.supplier_invoice_draft_revisions r
        ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision
      WHERE d.book_id=v_book AND d.id<>p_id AND r.body->'content'->>'counterpartyId'=v_party
        AND ((v_number IS NOT NULL AND r.body->'content'->>'supplierDocumentNumber'=v_number COLLATE "C")
          OR r.body->'sourceEvidence'->>'sha256'=v_sha)
      UNION ALL
      SELECT 'r'::text AS kind,i.id,0::bigint AS revision,
        (v_number IS NOT NULL AND i.document_number=v_number COLLATE "C") AS same_number,e.sha256=v_sha AS same_content
      FROM openerp.commerce_invoices i
      JOIN openerp.evidence e ON e.book_id=i.book_id AND e.id=i.evidence_id
      WHERE i.book_id=v_book AND i.direction='supplier' AND i.counterparty_id=v_party
        AND ((v_number IS NOT NULL AND i.document_number=v_number COLLATE "C") OR e.sha256=v_sha)
    ) candidate
    WHERE (candidate.kind COLLATE "C",candidate.id COLLATE "C")>(v_after_kind COLLATE "C",v_after_id COLLATE "C")
    ORDER BY candidate.kind COLLATE "C",candidate.id COLLATE "C" LIMIT 51
  ), shown AS MATERIALIZED (
    SELECT * FROM page ORDER BY kind COLLATE "C",id COLLATE "C" LIMIT 50
  )
  SELECT jsonb_build_object('scope',jsonb_build_object('entityId',p_scope->>'entityId','bookId',v_book),
    'source',openerp.supplier_invoice_draft_summary(v_source),
    'coverage','current_supplier_drafts_and_registered_supplier_invoices','consistency','live_candidates',
    'items',coalesce(jsonb_agg(jsonb_build_object('kind',CASE WHEN s.kind='d' THEN 'draft' ELSE 'registered' END,
      'reasons',(CASE WHEN s.same_number THEN '["same_document_number"]'::jsonb ELSE '[]'::jsonb END)
        ||(CASE WHEN s.same_content THEN '["same_original_evidence_content"]'::jsonb ELSE '[]'::jsonb END))
      ||CASE WHEN s.kind='d' THEN jsonb_build_object('draft',(
        SELECT openerp.supplier_invoice_draft_summary(r.body) FROM openerp.supplier_invoice_draft_revisions r
          WHERE r.book_id=v_book AND r.draft_id=s.id AND r.revision=s.revision))
        ELSE jsonb_build_object('invoice',openerp.commerce_invoice_body(v_book,s.id)) END
      ORDER BY s.kind COLLATE "C",s.id COLLATE "C"),'[]'),
    'next',CASE WHEN (SELECT count(*) FROM page)>50 THEN (
      SELECT 'sid1:'||v_context||':'||anchor.kind||':'||anchor.id||':'||anchor.revision::text FROM shown anchor
        ORDER BY anchor.kind COLLATE "C" DESC,anchor.id COLLATE "C" DESC LIMIT 1) ELSE NULL END)
    INTO v_result FROM shown s;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION openerp.supplier_invoice_draft_duplicates(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.supplier_invoice_draft_duplicates(text,jsonb,text,text) TO openerp_runtime;
