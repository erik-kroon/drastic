-- Exact retained fact-membership projection through the existing getVatFact owner.
-- No readiness evaluation, new artifact, recalculation or mutation.
CREATE FUNCTION openerp.vat_fact_lineage_assessment(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,openerp AS $$
  SELECT jsonb_build_object('factId',value->'factId','sourceDigest',value->'sourceDigest','state',value->'state',
    'blockers',value->'blockers','sourceDifferenceMinor',value->'sourceDifferenceMinor',
    'rateDifferenceNumerator',value->'rateDifferenceNumerator','ledgerTaxMinor',value->'ledgerTaxMinor',
    'ledgerDifferenceMinor',value->'ledgerDifferenceMinor',
    'contribution',CASE WHEN value->'contribution'='null'::jsonb THEN NULL ELSE jsonb_build_object(
      'box05Minor',value->'contribution'->'box05Minor','box10Minor',value->'contribution'->'box10Minor',
      'box48Minor',value->'contribution'->'box48Minor') END)
$$;
REVOKE ALL ON FUNCTION openerp.vat_fact_lineage_assessment(jsonb) FROM PUBLIC,openerp_runtime;

CREATE OR REPLACE FUNCTION openerp.get_vat_fact(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE vr_history jsonb;vr_drafts jsonb:='[]';vr_amendments jsonb:='[]';vr_row record;vr_assessment jsonb;vr_impact jsonb;
  vr_seen_drafts text[]:='{}';vr_seen_amendments text[]:='{}';vr_body jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO vr_history FROM openerp.vat_fact_revisions r
    WHERE r.book_id=scope->>'bookId' AND r.fact_id=get_vat_fact.id;
  IF vr_history IS NULL THEN PERFORM openerp.fail('NotFound','The VAT fact is not in this book.'); END IF;
  -- Refuse an incomplete book inventory before projecting exact membership; never clip history.
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_return_drafts d WHERE d.book_id=scope->>'bookId' LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_draft_amendments a WHERE a.book_id=scope->>'bookId' LIMIT 501) bounded)>500 THEN
    PERFORM openerp.fail('UnsupportedProfile','VAT lineage requires complete inventories within500 drafts and500 amendment reviews. Nothing was truncated.'); END IF;
  FOR vr_row IN
    SELECT d.id,d.body,d.body->'calculation'->'assessments'->((f.ordinality-1)::integer) AS assessment,f.body->'fact' AS fact
    FROM openerp.vat_return_drafts d
    CROSS JOIN LATERAL jsonb_array_elements(d.body->'basis'->'facts') WITH ORDINALITY f(body,ordinality)
    WHERE d.book_id=scope->>'bookId' AND f.body->'fact'->>'factId'=get_vat_fact.id
    ORDER BY d.ordinal DESC
  LOOP
    -- All saved engines bind assessment order and identity at sealing. Do not hide malformed membership.
    IF vr_row.id=ANY(vr_seen_drafts) OR vr_row.assessment IS NULL
      OR vr_row.assessment->>'factId' IS DISTINCT FROM id
      OR vr_row.assessment->>'sourceDigest' IS DISTINCT FROM vr_row.fact->>'digest'
      OR coalesce(vr_row.body->'calculation'->>'engine','') NOT IN ('vat-return-draft-v1','vat-return-draft-v2','vat-return-draft-v3') THEN
      PERFORM openerp.fail('UnsupportedProfile','A retained VAT draft has unsupported or ambiguous fact-assessment lineage. No partial lineage was returned.'); END IF;
    vr_seen_drafts:=array_append(vr_seen_drafts,vr_row.id);
    vr_assessment:=openerp.vat_fact_lineage_assessment(vr_row.assessment);
    vr_drafts:=vr_drafts||jsonb_build_array(jsonb_build_object('draftId',vr_row.id,'draftDigest',vr_row.body->'digest',
      'engine',vr_row.body->'calculation'->'engine','startsOn',vr_row.body->'input'->'startsOn','endsOn',vr_row.body->'input'->'endsOn',
      'recordedAt',vr_row.body->'recordedAt','revisionId',vr_row.fact->'id','revision',vr_row.fact->'revision',
      'sourceDigest',vr_row.fact->'digest','assessment',vr_assessment));
  END LOOP;
  FOR vr_row IN
    SELECT a.id,a.original_draft_id,a.replacement_draft_id,a.body,f.body AS fact
    FROM openerp.vat_draft_amendments a
    CROSS JOIN LATERAL jsonb_array_elements(a.body->'impact'->'facts') f(body)
    WHERE a.book_id=scope->>'bookId' AND f.body->>'factId'=get_vat_fact.id ORDER BY a.ordinal DESC
  LOOP
    IF vr_row.id=ANY(vr_seen_amendments) OR vr_row.body->'impact'->>'version' IS DISTINCT FROM 'vat-draft-impact-v1' THEN
      PERFORM openerp.fail('UnsupportedProfile','A retained amendment has unsupported or ambiguous fact lineage. No partial lineage was returned.'); END IF;
    vr_seen_amendments:=array_append(vr_seen_amendments,vr_row.id);
    vr_impact:=jsonb_build_object('factId',vr_row.fact->'factId',
      'original',CASE WHEN vr_row.fact->'original'='null'::jsonb THEN NULL ELSE jsonb_build_object(
        'revisionId',vr_row.fact->'original'->'revisionId','revision',vr_row.fact->'original'->'revision',
        'assessment',openerp.vat_fact_lineage_assessment(vr_row.fact->'original'->'assessment')) END,
      'replacement',CASE WHEN vr_row.fact->'replacement'='null'::jsonb THEN NULL ELSE jsonb_build_object(
        'revisionId',vr_row.fact->'replacement'->'revisionId','revision',vr_row.fact->'replacement'->'revision',
        'assessment',openerp.vat_fact_lineage_assessment(vr_row.fact->'replacement'->'assessment')) END,
      'sourceChanged',vr_row.fact->'sourceChanged','assessmentChanged',vr_row.fact->'assessmentChanged',
      'contributionDelta',jsonb_build_object('box05Minor',vr_row.fact->'contributionDelta'->'box05Minor',
        'box10Minor',vr_row.fact->'contributionDelta'->'box10Minor','box48Minor',vr_row.fact->'contributionDelta'->'box48Minor'));
    vr_amendments:=vr_amendments||jsonb_build_array(jsonb_build_object('amendmentId',vr_row.id,'amendmentDigest',vr_row.body->'digest',
      'recordedAt',vr_row.body->'recordedAt','originalDraftId',vr_row.original_draft_id,
      'originalDraftDigest',vr_row.body->'impact'->'original'->'digest','replacementDraftId',vr_row.replacement_draft_id,
      'replacementDraftDigest',vr_row.body->'impact'->'replacement'->'digest','impactDigest',vr_row.body->'impact'->'digest','factImpact',vr_impact));
  END LOOP;
  vr_body:=jsonb_build_object('current',vr_history->-1,'history',vr_history,
    'withdrawal',(SELECT w.body FROM openerp.vat_fact_withdrawals w WHERE w.book_id=scope->>'bookId' AND w.fact_id=get_vat_fact.id),
    'lineage',jsonb_build_object('interpretation','retained_fact_membership','drafts',vr_drafts,'amendments',vr_amendments,
      'currentnessChecked',false,'legalObligationAssessed',false));
  IF octet_length(convert_to(openerp.canonical(vr_body),'UTF8'))>8388608 THEN
    PERFORM openerp.fail('UnsupportedProfile','Complete VAT fact history and lineage exceed8MiB. No entries or original history were omitted.'); END IF;
  RETURN vr_body;
END $$;
REVOKE ALL ON FUNCTION openerp.get_vat_fact(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_vat_fact(text,jsonb,text) TO openerp_runtime;
