-- A synthetic SIE4 source-staging profile. No ledger, opening, or subledger effect is implied.
CREATE TABLE openerp.sie_source_previews (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  occurrence_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50), body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), UNIQUE(book_id,occurrence_id,ordinal),
  FOREIGN KEY (book_id,occurrence_id) REFERENCES openerp.intake_occurrences(book_id,id)
);
CREATE TABLE openerp.sie_source_plans (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  preview_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), UNIQUE(book_id,preview_id),
  FOREIGN KEY (book_id,preview_id) REFERENCES openerp.sie_source_previews(book_id,id)
);
CREATE TABLE openerp.sie_source_runs (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  plan_id text NOT NULL, next_ordinal integer NOT NULL DEFAULT 1,
  fence bigint NOT NULL DEFAULT 1, lease_until timestamptz, status text NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','paused','staged')),
  PRIMARY KEY (book_id,id), UNIQUE(book_id,plan_id),
  FOREIGN KEY (book_id,plan_id) REFERENCES openerp.sie_source_plans(book_id,id)
);
CREATE TABLE openerp.sie_source_chunks (
  book_id text NOT NULL, run_id text NOT NULL, ordinal integer NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,run_id,ordinal),
  FOREIGN KEY (book_id,run_id) REFERENCES openerp.sie_source_runs(book_id,id)
);
CREATE TABLE openerp.sie_source_vouchers (
  book_id text NOT NULL, run_id text NOT NULL, ordinal integer NOT NULL,
  source_reference text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,run_id,ordinal),
  FOREIGN KEY (book_id,run_id) REFERENCES openerp.sie_source_runs(book_id,id)
);
CREATE TRIGGER immutable_sie_preview BEFORE UPDATE OR DELETE ON openerp.sie_source_previews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_plan BEFORE UPDATE OR DELETE ON openerp.sie_source_plans
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_chunk BEFORE UPDATE OR DELETE ON openerp.sie_source_chunks
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_voucher BEFORE UPDATE OR DELETE ON openerp.sie_source_vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.sie_source_previews,openerp.sie_source_plans,openerp.sie_source_runs,
  openerp.sie_source_chunks,openerp.sie_source_vouchers FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.capture_sie_source(p_token text,p_scope jsonb,p_key text,p_occurrence text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE a text; previous jsonb; request jsonb:=jsonb_build_object('occurrenceId',p_occurrence,'preview',p_body);
  source openerp.intake_occurrences; result jsonb; next_revision integer;
BEGIN
  a:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,a,'capture_sie_source',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO source FROM openerp.intake_occurrences o WHERE o.book_id=p_scope->>'bookId' AND o.id=p_occurrence;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Original source occurrence was not found.'); END IF;
  IF p_body->>'sourceSha256' IS DISTINCT FROM source.sha256
    OR p_body->>'encoding' NOT IN ('utf-8','windows-1252')
    OR p_body->>'profile' IS DISTINCT FROM 'sie4_source_v1'
    OR jsonb_typeof(p_body->'records') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_body->'vouchers') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_body->'controls') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_body->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_body->'ready') IS DISTINCT FROM 'boolean'
    OR jsonb_array_length(p_body->'records')>2000
    OR jsonb_array_length(p_body->'vouchers')>200
    OR octet_length(p_body::text)>1048576
    THEN PERFORM openerp.fail('UnsupportedProfile','The selected SIE4 profile or bounded complete interpretation is unsupported. No records were truncated.'); END IF;
  IF EXISTS(SELECT FROM openerp.sie_source_runs r JOIN openerp.sie_source_plans p ON (p.book_id,p.id)=(r.book_id,r.plan_id)
    JOIN openerp.sie_source_previews v ON (v.book_id,v.id)=(p.book_id,p.preview_id)
    WHERE v.book_id=source.book_id AND v.occurrence_id=source.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This occurrence already has a staged run; retained source history cannot be reinterpreted in place.'); END IF;
  SELECT coalesce(max(p.ordinal),0)+1 INTO next_revision FROM openerp.sie_source_previews p
    WHERE p.book_id=source.book_id AND p.occurrence_id=source.id;
  IF next_revision>50 THEN PERFORM openerp.fail('UnsupportedProfile','The retained occurrence has reached its complete SIE preview limit.'); END IF;
  result:=p_body||jsonb_build_object('id',openerp.new_id('siepreview'),'scope',p_scope,'occurrenceId',p_occurrence,
    'createdBy',a,'ordinal',next_revision,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  result:=result||jsonb_build_object('digest',openerp.digest(result),
    'receipt',jsonb_build_object('key',p_key,'operation','capture_sie_source','actorId',a));
  INSERT INTO openerp.sie_source_previews VALUES(source.book_id,result->>'id',source.id,next_revision,result);
  RETURN openerp.save_command(source.book_id,p_key,a,'capture_sie_source',request,result);
END $$;
CREATE FUNCTION openerp.get_sie_source(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT p.body INTO result FROM openerp.sie_source_previews p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF result IS NULL THEN PERFORM openerp.fail('NotFound','SIE source interpretation was not found.'); END IF;
  RETURN result;
END $$;

-- Controls are independent operator-supplied totals, not balances inferred from imported movements.
CREATE FUNCTION openerp.seal_sie_source_plan(p_token text,p_scope jsonb,p_key text,p_preview text,p_input jsonb) RETURNS jsonb
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
    AND o.id=preview.occurrence_id AND left(o.source_system,10)='synthetic_') THEN
    PERFORM openerp.fail('UnsupportedProfile','Actual historical source admission is blocked until the D-06 source profile and history scope are reviewed.'); END IF;
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
     OR p_input->>'sourceKind' IS DISTINCT FROM 'synthetic'
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
CREATE FUNCTION openerp.get_sie_source_plan(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT p.body INTO result FROM openerp.sie_source_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF result IS NULL THEN PERFORM openerp.fail('NotFound','SIE plan was not found.'); END IF;
  RETURN result;
END $$;

CREATE FUNCTION openerp.start_sie_source_run(p_token text,p_scope jsonb,p_key text,p_plan text,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE a text; previous jsonb; request jsonb:=jsonb_build_object('planId',p_plan,'digest',p_digest);
  plan openerp.sie_source_plans; run openerp.sie_source_runs; result jsonb;
BEGIN
  a:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,a,'start_sie_source_run',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO plan FROM openerp.sie_source_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_plan;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','SIE plan was not found.'); END IF;
  IF plan.body->>'digest' IS DISTINCT FROM p_digest THEN PERFORM openerp.fail('StaleDependency','The exact frozen plan digest is required.'); END IF;
  IF EXISTS(SELECT FROM openerp.sie_source_previews later JOIN openerp.sie_source_previews selected
    ON later.book_id=selected.book_id AND later.occurrence_id=selected.occurrence_id
    WHERE (selected.book_id,selected.id)=(plan.book_id,plan.preview_id) AND later.ordinal>selected.ordinal) THEN
    PERFORM openerp.fail('StaleDependency','A later SIE interpretation superseded this plan before staging.'); END IF;
  IF EXISTS(SELECT FROM openerp.sie_source_runs r JOIN openerp.sie_source_plans p ON (p.book_id,p.id)=(r.book_id,r.plan_id)
    JOIN openerp.sie_source_previews v ON (v.book_id,v.id)=(p.book_id,p.preview_id)
    JOIN openerp.sie_source_previews selected ON (selected.book_id,selected.id)=(plan.book_id,plan.preview_id)
    WHERE v.book_id=selected.book_id AND v.occurrence_id=selected.occurrence_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','The retained occurrence already has a staged run.'); END IF;
  IF EXISTS(SELECT FROM openerp.sie_source_runs r WHERE r.book_id=plan.book_id AND r.plan_id=plan.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','The plan already has a run; recover and resume its existing identity.'); END IF;
  INSERT INTO openerp.sie_source_runs VALUES(plan.book_id,openerp.new_id('sierun'),plan.id,1,1,clock_timestamp()+interval '15 minutes','running') RETURNING * INTO run;
  result:=jsonb_build_object('id',run.id,'planId',plan.id,'planDigest',p_digest,'nextOrdinal',1,
    'fence','1','leaseUntil',to_char(run.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'status','running','financialAdmission','unsupported');
  RETURN openerp.save_command(plan.book_id,p_key,a,'start_sie_source_run',request,result);
END $$;
CREATE FUNCTION openerp.sie_source_run_view(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE r openerp.sie_source_runs; plan openerp.sie_source_plans; chunks jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO r FROM openerp.sie_source_runs s WHERE s.book_id=p_scope->>'bookId' AND s.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','SIE run was not found.'); END IF;
  SELECT * INTO STRICT plan FROM openerp.sie_source_plans p WHERE p.book_id=r.book_id AND p.id=r.plan_id;
  SELECT coalesce(jsonb_agg(c.body ORDER BY c.ordinal),'[]'::jsonb) INTO chunks
    FROM openerp.sie_source_chunks c WHERE c.book_id=r.book_id AND c.run_id=r.id;
  RETURN jsonb_build_object('id',r.id,'planId',r.plan_id,'planDigest',plan.body->>'digest',
    'nextOrdinal',r.next_ordinal,'fence',r.fence::text,'leaseUntil',CASE WHEN r.lease_until IS NULL THEN NULL ELSE to_char(r.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'status',r.status,
    'voucherCount',plan.body->'voucherCount','chunks',chunks,'financialAdmission','unsupported');
END $$;
CREATE FUNCTION openerp.advance_sie_source_run(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE a text; previous jsonb; request jsonb:=jsonb_build_object('runId',p_id,'input',p_input);
  run openerp.sie_source_runs; plan openerp.sie_source_plans; preview openerp.sie_source_previews;
  item jsonb; first_ordinal integer; last_ordinal integer; chunk jsonb; total integer;
BEGIN
  a:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,a,'advance_sie_source_run',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO run FROM openerp.sie_source_runs r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','SIE run was not found.'); END IF;
  SELECT * INTO STRICT plan FROM openerp.sie_source_plans p WHERE p.book_id=run.book_id AND p.id=run.plan_id;
  SELECT * INTO STRICT preview FROM openerp.sie_source_previews p WHERE p.book_id=run.book_id AND p.id=plan.preview_id;
  total:=(plan.body->>'voucherCount')::integer;
  IF run.status<>'running' OR run.lease_until<=clock_timestamp() OR p_input->>'fence' IS DISTINCT FROM run.fence::text
    OR p_input->>'planDigest' IS DISTINCT FROM plan.body->>'digest'
    OR p_input->>'firstOrdinal' IS DISTINCT FROM run.next_ordinal::text THEN
    PERFORM openerp.fail('StaleDependency','Resume the current run fence and exact next frozen chunk.'); END IF;
  first_ordinal:=run.next_ordinal;
  last_ordinal:=least(total,first_ordinal+199);
  IF first_ordinal>total THEN PERFORM openerp.fail('IdempotencyConflict','All source vouchers are already staged.'); END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(preview.body->'vouchers') v
      WHERE (v->>'ordinal')::integer BETWEEN first_ordinal AND last_ordinal) <> last_ordinal-first_ordinal+1 THEN
    PERFORM openerp.fail('MissingEvidence','Frozen voucher membership is incomplete.'); END IF;
  IF (SELECT coalesce(sum(jsonb_array_length(v->'transactions')),0) FROM jsonb_array_elements(preview.body->'vouchers') v
    WHERE (v->>'ordinal')::integer BETWEEN first_ordinal AND last_ordinal)>2000 THEN
    PERFORM openerp.fail('UnsupportedProfile','The frozen chunk exceeds 2,000 transaction lines. No partial chunk was staged.'); END IF;
  chunk:=jsonb_build_object('runId',run.id,'planDigest',plan.body->>'digest',
    'firstOrdinal',first_ordinal,'lastOrdinal',last_ordinal,'fence',run.fence::text,
    'voucherCount',last_ordinal-first_ordinal+1,
    'membershipDigest',openerp.digest((SELECT jsonb_agg(v ORDER BY (v->>'ordinal')::integer)
      FROM jsonb_array_elements(preview.body->'vouchers') v
      WHERE (v->>'ordinal')::integer BETWEEN first_ordinal AND last_ordinal)),
    'receipt',jsonb_build_object('key',p_key,'operation','advance_sie_source_run','actorId',a));
  IF octet_length(chunk::text)>1048576 THEN PERFORM openerp.fail('UnsupportedProfile','Chunk payload exceeds the bounded profile.'); END IF;
  FOR item IN SELECT v FROM jsonb_array_elements(preview.body->'vouchers') v
    WHERE (v->>'ordinal')::integer BETWEEN first_ordinal AND last_ordinal LOOP
    IF jsonb_array_length(item->'transactions')>2000 THEN PERFORM openerp.fail('UnsupportedProfile','Voucher exceeds the supported line bound.'); END IF;
    INSERT INTO openerp.sie_source_vouchers VALUES(run.book_id,run.id,(item->>'ordinal')::integer,
      item->>'sourceReference',item);
  END LOOP;
  INSERT INTO openerp.sie_source_chunks VALUES(run.book_id,run.id,first_ordinal,chunk);
  UPDATE openerp.sie_source_runs SET next_ordinal=last_ordinal+1,
    lease_until=CASE WHEN last_ordinal=total THEN NULL ELSE clock_timestamp()+interval '15 minutes' END,
    status=CASE WHEN last_ordinal=total THEN 'staged' ELSE 'running' END
    WHERE book_id=run.book_id AND id=run.id;
  RETURN openerp.save_command(run.book_id,p_key,a,'advance_sie_source_run',request,chunk);
END $$;
CREATE FUNCTION openerp.reclaim_sie_source_run(p_token text,p_scope jsonb,p_key text,p_id text,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE a text; previous jsonb; request jsonb:=jsonb_build_object('runId',p_id,'action',p_action);
  run openerp.sie_source_runs; result jsonb;
BEGIN
  a:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,a,'reclaim_sie_source_run',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO run FROM openerp.sie_source_runs r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','SIE run was not found.'); END IF;
  IF p_action NOT IN ('pause','resume') OR run.status='staged' THEN
    PERFORM openerp.fail('InvalidJournal','Only an unfinished historical source run can pause or resume.'); END IF;
  UPDATE openerp.sie_source_runs SET status=CASE WHEN p_action='pause' THEN 'paused' ELSE 'running' END,
    lease_until=CASE WHEN p_action='pause' THEN NULL ELSE clock_timestamp()+interval '15 minutes' END,
    fence=fence+1 WHERE book_id=run.book_id AND id=run.id RETURNING * INTO run;
  result:=jsonb_build_object('id',run.id,'nextOrdinal',run.next_ordinal,'fence',run.fence::text,'leaseUntil',CASE WHEN run.lease_until IS NULL THEN NULL ELSE to_char(run.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'status',run.status);
  RETURN openerp.save_command(run.book_id,p_key,a,'reclaim_sie_source_run',request,result);
END $$;
REVOKE ALL ON FUNCTION openerp.capture_sie_source(text,jsonb,text,text,jsonb),
  openerp.get_sie_source(text,jsonb,text),openerp.seal_sie_source_plan(text,jsonb,text,text,jsonb),
  openerp.get_sie_source_plan(text,jsonb,text),openerp.start_sie_source_run(text,jsonb,text,text),
  openerp.sie_source_run_view(text,jsonb,text),openerp.advance_sie_source_run(text,jsonb,text,text,jsonb),
  openerp.reclaim_sie_source_run(text,jsonb,text,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.capture_sie_source(text,jsonb,text,text,jsonb),
  openerp.get_sie_source(text,jsonb,text),openerp.seal_sie_source_plan(text,jsonb,text,text,jsonb),
  openerp.get_sie_source_plan(text,jsonb,text),openerp.start_sie_source_run(text,jsonb,text,text),
  openerp.sie_source_run_view(text,jsonb,text),openerp.advance_sie_source_run(text,jsonb,text,text,jsonb),
  openerp.reclaim_sie_source_run(text,jsonb,text,text,text) TO openerp_runtime;
