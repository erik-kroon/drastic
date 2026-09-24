-- Extend the frozen reviewed SIE4 plan to explicit external source identities.
CREATE OR REPLACE FUNCTION openerp.seal_sie_source_plan(p_token text,p_scope jsonb,p_key text,p_preview text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE a text; previous jsonb; request jsonb:=jsonb_build_object('previewId',p_preview,'input',p_input);
  preview openerp.sie_source_previews; result jsonb; item jsonb; control jsonb;
  source_accounts text[]:='{}'; compared text[]:='{}'; open_compared text[]:='{}';
  open_identities text[]:='{}'; matched integer; supplied text; observed text; expected numeric;
BEGIN
  a:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,a,'seal_sie_source_plan',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO preview FROM openerp.sie_source_previews p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_preview;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','SIE interpretation was not found.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.intake_occurrences o WHERE o.book_id=preview.book_id
    AND o.id=preview.occurrence_id
    AND ((left(o.source_system,10)='synthetic_' AND p_input->>'sourceKind'='synthetic')
      OR (left(o.source_system,10)<>'synthetic_' AND p_input->>'sourceKind'='reviewed_sie4'))) THEN
    PERFORM openerp.fail('UnsupportedProfile','Select the reviewed SIE4 origin explicitly; synthetic and external source identities cannot be interchanged.'); END IF;
  IF preview.ordinal IS DISTINCT FROM (SELECT max(v.ordinal) FROM openerp.sie_source_previews v
     WHERE v.book_id=preview.book_id AND v.occurrence_id=preview.occurrence_id) THEN
     PERFORM openerp.fail('StaleDependency','Review and seal only the latest retained SIE interpretation.'); END IF;
  IF preview.body->'ready' IS DISTINCT FROM 'true'::jsonb OR preview.body->>'digest' IS DISTINCT FROM p_input->>'digest'
     OR jsonb_typeof(p_input->'mappings') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_input->'openingControls') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_input->'openItems') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_input->'openItemControls') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_input->'mappings')>500 OR jsonb_array_length(p_input->'openingControls')>500
     OR jsonb_array_length(p_input->'openItems')>500 OR jsonb_array_length(p_input->'openItemControls')>500
     OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string'
     OR length(p_input->>'rationale') NOT BETWEEN 1 AND 2000
     OR p_input->>'openingPolicy' IS DISTINCT FROM 'unreconstructable_detail'
     OR p_input->>'sourceKind' NOT IN ('synthetic','reviewed_sie4')
     THEN PERFORM openerp.fail('ApprovalRequired','Review exact SIE digest, account mappings, independent controls and synthetic missing-history policy.'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_input->'mappings') LOOP
    IF coalesce(item->>'sourceAccount','') !~ '^[0-9]{4}$'
       OR coalesce(item->>'accountId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
       OR item - ARRAY['sourceAccount','accountId'] <> '{}'::jsonb
       OR NOT EXISTS(SELECT FROM openerp.accounts x WHERE x.book_id=preview.book_id AND x.id=item->>'accountId')
       OR item->>'sourceAccount'=ANY(source_accounts) THEN
      PERFORM openerp.fail('InvalidJournal','Every source account requires one distinct reviewed existing native account mapping.'); END IF;
    source_accounts:=array_append(source_accounts,item->>'sourceAccount');
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(preview.body->'records') WHERE value->>'tag' IN ('KONTO','TRANS','RTRANS','BTRANS','IB','UB','RES') LOOP
    IF NOT (coalesce(item->'fields'->>CASE WHEN item->>'tag' IN ('IB','UB','RES') THEN 1 ELSE 0 END,'')=ANY(source_accounts)) THEN
      PERFORM openerp.fail('InvalidJournal','SIE record references a source account without a reviewed mapping.'); END IF;
  END LOOP;
  FOR control IN SELECT value FROM jsonb_array_elements(p_input->'openingControls') LOOP
    IF NOT (coalesce(control->>'sourceAccount','')=ANY(source_accounts))
       OR coalesce(control->>'year','') !~ '^-?[0-9]{1,4}$'
       OR coalesce(control->>'independentOpeningMinor','') !~ '^(0|-?[1-9][0-9]{0,37})$'
       OR coalesce(control->>'independentClosingMinor','') !~ '^(0|-?[1-9][0-9]{0,37})$'
       OR control - ARRAY['sourceAccount','year','independentOpeningMinor','independentClosingMinor','basis'] <> '{}'::jsonb
       OR length(coalesce(control->>'basis','')) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal','Supply independent exact opening and closing controls with provenance.'); END IF;
    IF (control->>'sourceAccount'||':'||control->>'year')=ANY(compared) THEN
      PERFORM openerp.fail('InvalidJournal','Duplicate opening/closing comparison for the same source year and account.'); END IF;
    compared:=array_append(compared,control->>'sourceAccount'||':'||control->>'year');
    FOR supplied,observed IN
      SELECT v.kind, v.amount FROM jsonb_to_recordset(preview.body->'controls')
        AS v(kind text,year text,account text,amount text, "recordOrdinal" integer)
        WHERE v.year=control->>'year' AND v.account=control->>'sourceAccount' AND v.kind IN ('IB','UB')
    LOOP
      IF supplied='IB' AND ((observed::numeric*100)::numeric(38,0))::text IS DISTINCT FROM control->>'independentOpeningMinor'
        OR supplied='UB' AND ((observed::numeric*100)::numeric(38,0))::text IS DISTINCT FROM control->>'independentClosingMinor' THEN
        PERFORM openerp.fail('InvalidJournal','Independent opening or closing total differs from the retained SIE control.'); END IF;
    END LOOP;
    SELECT count(*) INTO matched FROM jsonb_to_recordset(preview.body->'controls')
      AS v(kind text,year text,account text,amount text, "recordOrdinal" integer)
      WHERE v.year=control->>'year' AND v.account=control->>'sourceAccount' AND v.kind IN ('IB','UB');
    IF matched<>2 OR (SELECT count(*) FROM jsonb_to_recordset(preview.body->'controls')
      AS v(kind text,year text,account text,amount text, "recordOrdinal" integer)
      WHERE v.year=control->>'year' AND v.account=control->>'sourceAccount' AND v.kind='IB')<>1
      OR (SELECT count(*) FROM jsonb_to_recordset(preview.body->'controls')
      AS v(kind text,year text,account text,amount text, "recordOrdinal" integer)
      WHERE v.year=control->>'year' AND v.account=control->>'sourceAccount' AND v.kind='UB')<>1 THEN
      PERFORM openerp.fail('InvalidJournal','Every compared source year/account requires exactly one #IB and one #UB.'); END IF;
  END LOOP;
  IF EXISTS (SELECT FROM jsonb_to_recordset(preview.body->'controls')
    AS v(kind text,year text,account text,amount text, "recordOrdinal" integer)
    WHERE v.kind IN ('IB','UB') AND NOT ((v.account||':'||v.year)=ANY(compared))) THEN
    PERFORM openerp.fail('InvalidJournal','All retained #IB/#UB source controls require an independent comparison.'); END IF;
  IF jsonb_array_length(p_input->'openingControls')=0 THEN
    PERFORM openerp.fail('InvalidJournal','An independent historical opening/closing comparison is required.'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_input->'openItems') LOOP
    IF item - ARRAY['sourceIdentity','sourceAccount','currency','originalMinor','outstandingMinor',
        'asOf','assertedState','detailAvailability','basis'] <> '{}'::jsonb
      OR length(coalesce(item->>'sourceIdentity','')) NOT BETWEEN 1 AND 200
      OR (item->>'sourceIdentity')=ANY(open_identities)
      OR NOT ((item->>'sourceAccount')=ANY(source_accounts))
      OR coalesce(item->>'currency','') !~ '^[A-Z]{3}$'
      OR coalesce(item->>'originalMinor','') !~ '^(0|-?[1-9][0-9]{0,37})$'
      OR coalesce(item->>'outstandingMinor','') !~ '^(0|-?[1-9][0-9]{0,37})$'
      OR coalesce(item->>'asOf','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR coalesce(item->>'assertedState','') NOT IN ('unpaid','partly_paid','unknown')
      OR coalesce(item->>'detailAvailability','') NOT IN ('source_asserted','unreconstructable')
      OR length(coalesce(item->>'basis','')) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal','Each historical open item needs a distinct retained source identity and explicit asserted state.'); END IF;
    open_identities:=array_append(open_identities,item->>'sourceIdentity');
  END LOOP;
  FOR control IN SELECT value FROM jsonb_array_elements(p_input->'openItemControls') LOOP
    IF control - ARRAY['sourceAccount','currency','independentOutstandingMinor','basis'] <> '{}'::jsonb
       OR NOT ((control->>'sourceAccount')=ANY(source_accounts))
       OR coalesce(control->>'currency','') !~ '^[A-Z]{3}$'
       OR coalesce(control->>'independentOutstandingMinor','') !~ '^(0|-?[1-9][0-9]{0,37})$'
       OR length(coalesce(control->>'basis','')) NOT BETWEEN 1 AND 2000
       OR (control->>'sourceAccount'||':'||control->>'currency')=ANY(open_compared) THEN
      PERFORM openerp.fail('InvalidJournal','Historical open-item controls must be independent, complete and unique.'); END IF;
    open_compared:=array_append(open_compared,control->>'sourceAccount'||':'||control->>'currency');
    SELECT coalesce(sum((v->>'outstandingMinor')::numeric),0) INTO expected
      FROM jsonb_array_elements(p_input->'openItems') v
      WHERE v->>'sourceAccount'=control->>'sourceAccount' AND v->>'currency'=control->>'currency';
    IF expected IS DISTINCT FROM (control->>'independentOutstandingMinor')::numeric THEN
      PERFORM openerp.fail('InvalidJournal','Open-item total differs from its independently declared control.'); END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(p_input->'openItems') v
    WHERE NOT ((v->>'sourceAccount'||':'||v->>'currency')=ANY(open_compared))) THEN
    PERFORM openerp.fail('InvalidJournal','Every historical open item needs an independently declared control.'); END IF;
  IF jsonb_array_length(p_input->'openItems')=0 AND jsonb_array_length(p_input->'openItemControls')<>0 THEN
    PERFORM openerp.fail('InvalidJournal','A control without source open items cannot claim reconstructed item detail.'); END IF;
  IF EXISTS(SELECT FROM openerp.sie_source_plans p WHERE p.book_id=preview.book_id AND p.preview_id=preview.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This interpretation already has a frozen reviewed plan.'); END IF;
  result:=jsonb_build_object('id',openerp.new_id('sieplan'),'scope',p_scope,'previewId',preview.id,
     'previewDigest',preview.body->>'digest','sourceSha256',preview.body->>'sourceSha256',
     'input',p_input,'voucherCount',jsonb_array_length(preview.body->'vouchers'),
     'createdBy',a,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'financialAdmission','unsupported','unreconstructableDetail',true);
  result:=result||jsonb_build_object('digest',openerp.digest(result),
    'receipt',jsonb_build_object('key',p_key,'operation','seal_sie_source_plan','actorId',a));
  INSERT INTO openerp.sie_source_plans VALUES(preview.book_id,result->>'id',preview.id,result);
  RETURN openerp.save_command(preview.book_id,p_key,a,'seal_sie_source_plan',request,result);
END $$;
