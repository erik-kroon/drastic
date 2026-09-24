-- Prepare the reviewed opening and select its basis atomically; approval remains separate.
CREATE FUNCTION openerp.prepare_historical_opening(p_token text,p_scope jsonb,p_key text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; prior jsonb; plan openerp.sie_source_plans; period openerp.periods;
  evidence jsonb; proposal jsonb; basis jsonb; lines jsonb; row jsonb; amount numeric;
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  prior:=openerp.replay(p_scope->>'bookId',p_key,actor,'prepare_historical_opening',p_input);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['fiscalYearId','cutoverOn','sourcePlanId','sourceDigest',
    'controls','rationale','accountingPeriodId','series']);
  SELECT * INTO plan FROM openerp.sie_source_plans WHERE book_id=p_scope->>'bookId' AND id=p_input->>'sourcePlanId';
  IF NOT FOUND OR plan.body->>'digest' IS DISTINCT FROM p_input->>'sourceDigest' THEN
    PERFORM openerp.fail('StaleDependency','Use the exact retained source plan.'); END IF;
  SELECT * INTO period FROM openerp.periods WHERE book_id=p_scope->>'bookId' AND id=p_input->>'accountingPeriodId';
  IF NOT FOUND OR period.fiscal_year_id IS DISTINCT FROM p_input->>'fiscalYearId' THEN
    PERFORM openerp.fail('InvalidJournal','Choose an accounting period in the selected fiscal year.'); END IF;
  IF coalesce(p_input->>'series','')!~'^[A-Z0-9]{1,16}$'
    OR jsonb_typeof(p_input->'controls') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'controls') NOT BETWEEN 2 AND 500 THEN
    PERFORM openerp.fail('InvalidJournal','Supply a series and two to 500 nonzero opening controls.'); END IF;
  lines:='[]'::jsonb;
  FOR row IN SELECT value FROM jsonb_array_elements(p_input->'controls') LOOP
    IF coalesce(row->>'signedMinor','')!~'^-?[1-9][0-9]{0,37}$' THEN
      PERFORM openerp.fail('InvalidJournal','Opening posting controls must contain exact nonzero signed amounts.'); END IF;
    amount:=(row->>'signedMinor')::numeric;
    lines:=lines||jsonb_build_array(jsonb_build_object('accountId',row->>'accountId',
      'debitMinor',greatest(amount,0)::text,'creditMinor',greatest(-amount,0)::text,
      'description','Reviewed historical opening'));
  END LOOP;
  evidence:=openerp.create_evidence(p_token,p_scope,p_key||'_evidence',jsonb_build_object(
    'title','Reviewed historical opening','origin','Independent opening controls and retained source plan',
    'mediaType','application/json','content',jsonb_build_object('input',p_input,'sourceSha256',plan.body->>'sourceSha256')::text));
  proposal:=openerp.prepare_journal(p_token,p_scope,p_key||'_journal',jsonb_build_object(
    'kind','manual_journal','evidenceId',evidence->>'id','eventKey','opening_'||(p_input->>'fiscalYearId'),
    'accountingPeriodId',period.id,'postingDate',p_input->>'cutoverOn','series',p_input->>'series',
    'description','Reviewed historical opening','rationale',p_input->>'rationale',
    'taxAssessment','not_applicable','lines',lines));
  basis:=openerp.select_historical_basis(p_token,p_scope,p_key||'_basis',
    (p_input-ARRAY['accountingPeriodId','series'])||jsonb_build_object('mode','opening_set','changeSetId',proposal->>'id'));
  RETURN openerp.save_command(p_scope->>'bookId',p_key,actor,'prepare_historical_opening',p_input,
    jsonb_build_object('basis',basis,'proposal',proposal));
END $$;
REVOKE ALL ON FUNCTION openerp.prepare_historical_opening(text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.prepare_historical_opening(text,jsonb,text,jsonb) TO openerp_runtime;
