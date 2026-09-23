-- Bind continuation to an exact immutable accountant pack section and retained row.
-- Saved artifacts and list continuation remain unchanged.
CREATE OR REPLACE FUNCTION openerp.accountant_review_rows_page(token text,scope jsonb,id text,section text,after_ordinal text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ar_pack jsonb; ar_after bigint:=0; ar_items jsonb; ar_last bigint; ar_next text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  IF section IS NULL OR section NOT IN ('balances','journal','evidence','coverage','owner_sources','owner_controls','expense_tax') THEN PERFORM openerp.fail('InvalidJournal','Choose a review section.'); END IF;
  SELECT p.body INTO ar_pack FROM openerp.accountant_review_packs p WHERE p.book_id=scope->>'bookId' AND p.id=accountant_review_rows_page.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The accountant review pack was not found in this book.'); END IF;
  IF after_ordinal IS NOT NULL AND after_ordinal<>'' THEN
    IF length(after_ordinal)>163 THEN
      PERFORM openerp.fail('InvalidJournal','Use the bounded row cursor returned for this pack and section.'); END IF;
    IF after_ordinal !~ '^[a-z][a-z0-9_-]{2,127}:(balances|journal|evidence|coverage|owner_sources|owner_controls|expense_tax):[1-9][0-9]{0,18}$' THEN
      PERFORM openerp.fail('InvalidJournal','Use the bounded row cursor returned for this pack and section.'); END IF;
    IF split_part(after_ordinal,':',1) IS DISTINCT FROM ar_pack->>'id'
      OR split_part(after_ordinal,':',2) IS DISTINCT FROM section THEN
      PERFORM openerp.fail('InvalidJournal','The row cursor belongs to another pack or section. Omit after and restart this section from its first page.'); END IF;
    BEGIN
      ar_after:=split_part(after_ordinal,':',3)::bigint;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      PERFORM openerp.fail('InvalidJournal','The row cursor position exceeds supported numeric bounds.'); END;
    IF NOT EXISTS(SELECT FROM openerp.accountant_review_rows r WHERE r.book_id=scope->>'bookId'
      AND r.pack_id=accountant_review_rows_page.id AND r.section=accountant_review_rows_page.section AND r.ordinal=ar_after) THEN
      PERFORM openerp.fail('InvalidJournal','The row cursor does not identify a retained row in this pack and section.'); END IF;
  END IF;
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.ordinal),'[]'),max(r.ordinal) INTO ar_items,ar_last FROM (
    SELECT rr.* FROM openerp.accountant_review_rows rr WHERE rr.book_id=scope->>'bookId' AND rr.pack_id=accountant_review_rows_page.id
      AND rr.section=accountant_review_rows_page.section AND rr.ordinal>ar_after ORDER BY rr.ordinal LIMIT 25
  ) r;
  IF EXISTS(SELECT FROM openerp.accountant_review_rows rr WHERE rr.book_id=scope->>'bookId' AND rr.pack_id=accountant_review_rows_page.id
    AND rr.section=accountant_review_rows_page.section AND rr.ordinal>ar_last) THEN ar_next:=(ar_pack->>'id')||':'||section||':'||ar_last::text; END IF;
  RETURN jsonb_build_object('packId',id,'packDigest',ar_pack->>'digest','section',section,'total',ar_pack->'counts'->section,'items',ar_items,'next',ar_next);
END $$;
