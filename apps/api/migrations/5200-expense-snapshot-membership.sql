-- Bounded retained source membership through the existing expense snapshot list.
-- Keep0710's three-argument owner/cursor/output untouched; the explicit overload delegates unfiltered reads.
CREATE FUNCTION openerp.list_expense_tax_snapshots(p_token text,p_scope jsonb,p_after text,p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE et_ceiling bigint;et_last bigint:=0;et_through bigint:=0;et_examined integer:=0;et_prefix text;et_more boolean;
  et_items jsonb:='[]';et_matches jsonb;et_entry jsonb;et_membership jsonb;et_result jsonb;et_snapshot record;
BEGIN
  IF coalesce(p_source,'')='' THEN
    -- Existing authorization, book barrier, fixed ceiling and legacy cursor semantics remain authoritative.
    et_result:=openerp.list_expense_tax_snapshots(p_token,p_scope,p_after);
  ELSE
    PERFORM openerp.authorize(p_token,p_scope);
    PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
    IF p_source !~ '^[a-z][a-z0-9_-]{2,127}$' THEN PERFORM openerp.fail('InvalidJournal','Select an exact retained expense source identity.'); END IF;
    IF NOT EXISTS(SELECT FROM openerp.expense_tax_sources s WHERE s.book_id=p_scope->>'bookId' AND s.id=p_source) THEN
      PERFORM openerp.fail('NotFound','The expense source is not retained in this book.'); END IF;
    IF p_after='' THEN
      SELECT coalesce(max(s.ordinal),0) INTO et_ceiling FROM openerp.expense_tax_snapshots s WHERE s.book_id=p_scope->>'bookId';
    ELSE
      IF p_after IS NULL OR p_after !~ '^esm1_[a-f0-9]{64}_[0-9]{1,18}_[0-9]{1,18}$' THEN
        PERFORM openerp.fail('InvalidJournal','Use a filtered snapshot cursor for this exact source; unfiltered cursors cannot change mode.'); END IF;
      et_ceiling:=split_part(p_after,'_',3)::bigint;et_last:=split_part(p_after,'_',4)::bigint;
    END IF;
    et_prefix:=substr(openerp.digest(jsonb_build_object('scope',p_scope,'sourceId',p_source,'ceiling',et_ceiling::text,
      'interpretation','expense-source-membership-v1')),8);
    IF p_after<>'' AND split_part(p_after,'_',2) IS DISTINCT FROM et_prefix THEN
      PERFORM openerp.fail('InvalidJournal','The filtered cursor belongs to another scope, source or captured cutoff.'); END IF;
    IF et_last>et_ceiling
      OR (et_ceiling>0 AND NOT EXISTS(SELECT FROM openerp.expense_tax_snapshots s WHERE s.book_id=p_scope->>'bookId' AND s.ordinal=et_ceiling))
      OR (et_last>0 AND NOT EXISTS(SELECT FROM openerp.expense_tax_snapshots s WHERE s.book_id=p_scope->>'bookId' AND s.ordinal=et_last)) THEN
      PERFORM openerp.fail('InvalidJournal','The filtered cursor must identify an observed cutoff and examined snapshot in this book.'); END IF;
    et_through:=et_last;
    -- The materialized window is selected BEFORE any JSON membership lookup. Sparse histories stay bounded.
    FOR et_snapshot IN
      WITH scanned AS MATERIALIZED (
        SELECT s.id,s.ordinal,s.body FROM openerp.expense_tax_snapshots s
        WHERE s.book_id=p_scope->>'bookId' AND s.ordinal>et_last AND s.ordinal<=et_ceiling
        ORDER BY s.ordinal LIMIT 25
      ) SELECT * FROM scanned ORDER BY ordinal
    LOOP
      et_examined:=et_examined+1;et_through:=et_snapshot.ordinal;
      IF NOT coalesce((et_snapshot.body->>'schemaVersion'='1' AND et_snapshot.body->>'calculationEngine'='expense-tax-controls-v1')
        OR (et_snapshot.body->>'schemaVersion'='2' AND et_snapshot.body->>'calculationEngine'='expense-tax-controls-v2'),false)
        OR jsonb_typeof(et_snapshot.body->'entries') IS DISTINCT FROM 'array' THEN
        PERFORM openerp.fail('UnsupportedProfile','A scanned expense snapshot has an unsupported captured shape. No partial membership was returned.'); END IF;
      IF jsonb_array_length(et_snapshot.body->'entries')>200 THEN
        PERFORM openerp.fail('UnsupportedProfile','A scanned expense snapshot exceeds its200-source capture bound. No entries were omitted.'); END IF;
      IF EXISTS(SELECT FROM jsonb_array_elements(et_snapshot.body->'entries') e(body)
        WHERE jsonb_typeof(e.body->'source') IS DISTINCT FROM 'object'
          OR e.body->'source'->>'sourceId' IS NULL
          OR e.body->'source'->'scope'->>'bookId' IS DISTINCT FROM p_scope->>'bookId'
          OR jsonb_typeof(e.body->'assessment') IS DISTINCT FROM 'object'
          OR NOT (e.body ? 'review')
          OR (et_snapshot.body->>'schemaVersion'='2' AND NOT (e.body ? 'withdrawal'))) THEN
        PERFORM openerp.fail('UnsupportedProfile','A scanned snapshot has incomplete source-entry identity or captured metadata. No partial membership was returned.'); END IF;
      SELECT jsonb_agg(e.body) INTO et_matches FROM jsonb_array_elements(et_snapshot.body->'entries') e(body)
        WHERE e.body->'source'->>'sourceId'=p_source;
      IF et_matches IS NULL THEN CONTINUE; END IF;
      IF jsonb_array_length(et_matches)<>1 THEN
        PERFORM openerp.fail('UnsupportedProfile','A scanned snapshot repeats the selected source identity. No ambiguous membership was returned.'); END IF;
      et_entry:=et_matches->0;
      IF (et_entry->'review'<>'null'::jsonb AND et_entry->'review'->>'sourceId' IS DISTINCT FROM p_source)
        OR (et_entry ? 'withdrawal' AND et_entry->'withdrawal'<>'null'::jsonb
          AND (et_entry->'withdrawal'->>'sourceId' IS DISTINCT FROM p_source
            OR et_entry->'withdrawal'->>'revisionDigest' IS DISTINCT FROM et_entry->'source'->>'digest')) THEN
        PERFORM openerp.fail('UnsupportedProfile','Captured review or withdrawal identity does not belong to the selected source revision.'); END IF;
      et_membership:=jsonb_build_object('schemaVersion',et_snapshot.body->'schemaVersion','calculationEngine',et_snapshot.body->'calculationEngine',
        'revisionId',et_entry->'source'->'id','revision',et_entry->'source'->'revision','sourceDigest',et_entry->'source'->'digest',
        'review',CASE WHEN et_entry->'review'='null'::jsonb THEN NULL ELSE jsonb_build_object(
          'id',et_entry->'review'->'id','revision',et_entry->'review'->'revision','digest',et_entry->'review'->'digest',
          'sourceDigest',et_entry->'review'->'sourceDigest') END,
        -- Both supported engines construct this assessment inside the private0710/4500 SQL calculation owner.
        'assessment',et_entry->'assessment');
      -- Absent legacy metadata is distinct from a captured explicit null withdrawal.
      IF et_entry ? 'withdrawal' THEN
        et_membership:=et_membership||jsonb_build_object('withdrawal',CASE WHEN et_entry->'withdrawal'='null'::jsonb THEN NULL ELSE jsonb_build_object(
          'id',et_entry->'withdrawal'->'id','digest',et_entry->'withdrawal'->'digest',
          'revisionId',et_entry->'withdrawal'->'revisionId','revisionDigest',et_entry->'withdrawal'->'revisionDigest') END);
      END IF;
      et_items:=et_items||jsonb_build_array(jsonb_build_object('id',et_snapshot.id,'digest',et_snapshot.body->'digest',
        'input',et_snapshot.body->'input','recordedAt',et_snapshot.body->'recordedAt','sourceMembership',et_membership));
    END LOOP;
    SELECT EXISTS(SELECT FROM openerp.expense_tax_snapshots s WHERE s.book_id=p_scope->>'bookId'
      AND s.ordinal>et_through AND s.ordinal<=et_ceiling) INTO et_more;
    et_result:=jsonb_build_object('items',et_items,
      'next',CASE WHEN et_more THEN 'esm1_'||et_prefix||'_'||et_ceiling::text||'_'||et_through::text ELSE NULL END,
      'membershipScan',jsonb_build_object('sourceId',p_source,'cutoffOrdinal',et_ceiling::text,
        'examinedThroughOrdinal',et_through::text,'examinedCount',et_examined,'interpretation','retained_source_membership',
        'currentnessChecked',false,'legalObligationAssessed',false));
  END IF;
  IF octet_length(convert_to(openerp.canonical(et_result),'UTF8'))>8388608 THEN
    PERFORM openerp.fail('UnsupportedProfile','The complete snapshot-list response exceeds8MiB. No matching entries were omitted to fit.'); END IF;
  RETURN et_result;
END $$;
REVOKE ALL ON FUNCTION openerp.list_expense_tax_snapshots(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_expense_tax_snapshots(text,jsonb,text,text) TO openerp_runtime;
