-- Financial admission reuses the existing sealed journal/approval/receipt transition.
-- Staged #RTRANS/#BTRANS records remain source history; only final #TRANS lines post.
CREATE TABLE openerp.sie_financial_runs (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  source_run_id text NOT NULL, fiscal_year_id text NOT NULL,
  source_plan_digest text NOT NULL, next_ordinal integer NOT NULL DEFAULT 1,
  fence bigint NOT NULL DEFAULT 1, lease_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','paused','posted')),
  permitted_change_id text,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,source_run_id),
  FOREIGN KEY(book_id,source_run_id) REFERENCES openerp.sie_source_runs,
  FOREIGN KEY(book_id,fiscal_year_id) REFERENCES openerp.fiscal_years
);
CREATE UNIQUE INDEX one_live_sie_financial_run ON openerp.sie_financial_runs(book_id)
  WHERE status IN ('running','paused');
CREATE TABLE openerp.sie_financial_postings (
  book_id text NOT NULL, run_id text NOT NULL, ordinal integer NOT NULL,
  source_reference text NOT NULL, source_digest text NOT NULL,
  change_set_id text NOT NULL, voucher_id text NOT NULL, receipt jsonb NOT NULL,
  PRIMARY KEY(book_id,run_id,ordinal), UNIQUE(book_id,run_id,source_reference),
  UNIQUE(book_id,change_set_id), UNIQUE(book_id,voucher_id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.sie_financial_runs,
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers
);
CREATE TRIGGER immutable_sie_financial_posting BEFORE UPDATE OR DELETE ON openerp.sie_financial_postings
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER guard_historical_voucher BEFORE INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.guard_historical_basis();
-- Even an already-approved direct ledger execution cannot leave an untracked opening.
CREATE FUNCTION openerp.record_historical_opening() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
BEGIN
  UPDATE openerp.historical_bases SET opening_voucher_id=NEW.id
    WHERE book_id=NEW.book_id AND fiscal_year_id=NEW.fiscal_year_id
      AND mode='opening_set' AND change_set_id=NEW.change_set_id AND opening_voucher_id IS NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER record_historical_opening AFTER INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.record_historical_opening();
REVOKE ALL ON openerp.sie_financial_runs,openerp.sie_financial_postings FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.start_sie_financial_run(p_token text,p_scope jsonb,p_key text,p_source_run text,p_year text,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; previous jsonb; request jsonb:=jsonb_build_object('sourceRunId',p_source_run,'fiscalYearId',p_year,'planDigest',p_digest);
  source openerp.sie_source_runs; plan openerp.sie_source_plans; preview openerp.sie_source_previews;
  basis openerp.historical_bases; y openerp.fiscal_years; run openerp.sie_financial_runs;
  item jsonb; tx jsonb; balance numeric; control jsonb; mapping jsonb; source_year text;
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,actor,'start_sie_financial_run',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO source FROM openerp.sie_source_runs WHERE book_id=p_scope->>'bookId' AND id=p_source_run;
  IF NOT FOUND OR source.status<>'staged' THEN
    PERFORM openerp.fail('StaleDependency','Stage the complete frozen source before financial admission.'); END IF;
  SELECT * INTO STRICT plan FROM openerp.sie_source_plans WHERE book_id=source.book_id AND id=source.plan_id;
  SELECT * INTO STRICT preview FROM openerp.sie_source_previews WHERE book_id=plan.book_id AND id=plan.preview_id;
  SELECT * INTO basis FROM openerp.historical_bases WHERE book_id=source.book_id AND fiscal_year_id=p_year;
  SELECT * INTO y FROM openerp.fiscal_years WHERE book_id=source.book_id AND id=p_year;
  IF NOT FOUND OR basis.mode IS DISTINCT FROM 'full_history' OR basis.source_plan_id IS DISTINCT FROM plan.id
    OR basis.source_digest IS DISTINCT FROM p_digest OR plan.body->>'digest' IS DISTINCT FROM p_digest THEN
    PERFORM openerp.fail('ApprovalRequired','Select full retained history and its exact source plan for this fiscal year.'); END IF;
  IF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=source.book_id AND v.fiscal_year_id=y.id)
    OR EXISTS(SELECT FROM openerp.sie_financial_runs r WHERE r.book_id=source.book_id AND r.source_run_id=source.id) THEN
    PERFORM openerp.fail('AlreadyPosted','This fiscal year or source run already has financial history.'); END IF;
  IF EXISTS(SELECT FROM openerp.sie_source_vouchers v WHERE v.book_id=source.book_id AND v.run_id=source.id
      AND (v.body->>'date' !~ '^[0-9]{8}$' OR to_date(v.body->>'date','YYYYMMDD') NOT BETWEEN y.starts_on AND y.ends_on))
    OR (SELECT count(*) FROM openerp.sie_source_vouchers v WHERE v.book_id=source.book_id AND v.run_id=source.id)
       IS DISTINCT FROM (plan.body->>'voucherCount')::integer
    OR EXISTS(SELECT FROM openerp.sie_source_vouchers v WHERE v.book_id=source.book_id AND v.run_id=source.id
       GROUP BY v.source_reference HAVING count(*)>1) THEN
    PERFORM openerp.fail('InvalidJournal','Complete distinct source vouchers must fit exactly one selected fiscal year.'); END IF;
  -- The plan compared #IB/#UB against independent controls. Require the final #TRANS movement
  -- to bridge those controls for each mapped source account. A SIE year ordinal is not inferred
  -- from calendar dates: one ordinal must be present and is retained in its original form.
  IF (SELECT count(DISTINCT c->>'year') FROM jsonb_array_elements(plan.body->'input'->'openingControls') c)<>1 THEN
    PERFORM openerp.fail('UnsupportedProfile','Financial admission requires one explicit SIE source-year ordinal.'); END IF;
  SELECT c->>'year' INTO source_year FROM jsonb_array_elements(plan.body->'input'->'openingControls') c LIMIT 1;
  FOR control IN SELECT value FROM jsonb_array_elements(plan.body->'input'->'openingControls') LOOP
    SELECT coalesce(sum((t->>'amount')::numeric*100),0) INTO balance
      FROM openerp.sie_source_vouchers v,
        LATERAL jsonb_array_elements(v.body->'transactions') t
      WHERE v.book_id=source.book_id AND v.run_id=source.id
        AND t->>'kind'='TRANS' AND t->>'account'=control->>'sourceAccount';
    IF balance IS DISTINCT FROM (control->>'independentClosingMinor')::numeric - (control->>'independentOpeningMinor')::numeric THEN
      PERFORM openerp.fail('InvalidJournal','Final transactions do not bridge the independently reviewed source opening and closing controls.'); END IF;
  END LOOP;
  -- A full-history basis carries its source #IB only through already posted prior history.
  -- No imported opening is added. Compare every native account, including prior-only accounts.
  IF EXISTS (
    WITH controls AS (
      SELECT m->>'accountId' account_id, sum((c->>'independentOpeningMinor')::numeric) opening
      FROM jsonb_array_elements(plan.body->'input'->'openingControls') c
      JOIN LATERAL jsonb_array_elements(plan.body->'input'->'mappings') m
        ON m->>'sourceAccount'=c->>'sourceAccount' GROUP BY m->>'accountId'
    ), prior AS (
      SELECT l.account_id,sum(l.debit_minor-l.credit_minor) opening
      FROM openerp.journal_lines l JOIN openerp.vouchers v
        ON v.book_id=l.book_id AND v.id=l.voucher_id
      WHERE v.book_id=y.book_id AND v.posting_date<y.starts_on GROUP BY l.account_id
    )
    SELECT FROM controls c FULL JOIN prior p USING(account_id)
      WHERE coalesce(c.opening,0)<>coalesce(p.opening,0)
  ) THEN
    PERFORM openerp.fail('InvalidJournal','Source #IB does not match the complete prior native ledger; no inferred opening can be added.'); END IF;
  IF EXISTS(SELECT FROM openerp.sie_source_vouchers v,LATERAL jsonb_array_elements(v.body->'transactions') t
    WHERE v.book_id=source.book_id AND v.run_id=source.id AND t->>'kind'='TRANS'
      AND (t->>'dimensions'<>'{}' OR NOT EXISTS(SELECT FROM jsonb_array_elements(plan.body->'input'->'openingControls') c
        WHERE c->>'sourceAccount'=t->>'account' AND c->>'year'=source_year))) THEN
    PERFORM openerp.fail('UnsupportedProfile','Unmapped account controls or source dimensions need reviewed support before financial admission.'); END IF;
  INSERT INTO openerp.sie_financial_runs(book_id,id,source_run_id,fiscal_year_id,source_plan_digest,lease_until)
    VALUES(source.book_id,openerp.new_id('siefin'),source.id,y.id,p_digest,clock_timestamp()+interval '15 minutes')
    RETURNING * INTO run;
  RETURN openerp.save_command(source.book_id,p_key,actor,'start_sie_financial_run',request,
    jsonb_build_object('id',run.id,'sourceRunId',source.id,'fiscalYearId',y.id,'planDigest',p_digest,
      'nextOrdinal',1,'fence',run.fence::text,'status',run.status,'sourceYear',source_year));
END $$;

CREATE FUNCTION openerp.advance_sie_financial_run(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; previous jsonb; request jsonb:=jsonb_build_object('runId',p_id,'input',p_input);
  run openerp.sie_financial_runs; source openerp.sie_source_runs; plan openerp.sie_source_plans;
  voucher openerp.sie_source_vouchers; changes openerp.change_sets; action jsonb;
  binding jsonb; tx jsonb; line jsonb; mapping jsonb; native_account text;
  expected numeric; receipt jsonb; results jsonb:='[]'; ix integer:=0; count_items integer;
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,actor,'advance_sie_financial_run',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO run FROM openerp.sie_financial_runs WHERE book_id=p_scope->>'bookId' AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Financial run not found.'); END IF;
  SELECT * INTO STRICT source FROM openerp.sie_source_runs WHERE book_id=run.book_id AND id=run.source_run_id;
  SELECT * INTO STRICT plan FROM openerp.sie_source_plans WHERE book_id=source.book_id AND id=source.plan_id;
  IF run.status<>'running' OR run.lease_until<=clock_timestamp() OR run.fence::text IS DISTINCT FROM p_input->>'fence'
     OR run.source_plan_digest IS DISTINCT FROM p_input->>'planDigest'
     OR run.next_ordinal::text IS DISTINCT FROM p_input->>'firstOrdinal'
     OR jsonb_typeof(p_input->'items') IS DISTINCT FROM 'array' THEN
     PERFORM openerp.fail('StaleDependency','Use the current fenced cursor and exact immutable financial plan.'); END IF;
  count_items:=jsonb_array_length(p_input->'items');
  IF count_items NOT BETWEEN 1 AND 20 OR run.next_ordinal+count_items-1>(plan.body->>'voucherCount')::integer THEN
    PERFORM openerp.fail('InvalidJournal','Admit one complete ordered chunk of at most 20 source vouchers.'); END IF;
  FOR binding IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
    ix:=ix+1;
    IF binding-ARRAY['changeSetId','planDigest','approvalId']<>'{}'::jsonb THEN
      PERFORM openerp.fail('InvalidJournal','Each source voucher needs one exact sealed ledger plan and approval.'); END IF;
    SELECT * INTO voucher FROM openerp.sie_source_vouchers v WHERE v.book_id=run.book_id AND v.run_id=run.source_run_id
      AND v.ordinal=run.next_ordinal+ix-1;
    SELECT * INTO changes FROM openerp.change_sets c WHERE c.book_id=run.book_id AND c.id=binding->>'changeSetId';
    IF voucher.ordinal IS NULL OR changes.id IS NULL OR changes.digest IS DISTINCT FROM binding->>'planDigest'
      OR changes.plan->>'planDigest' IS DISTINCT FROM changes.digest THEN
      PERFORM openerp.fail('StaleDependency','The frozen source voucher or sealed ledger plan is missing.'); END IF;
    action:=changes.plan->'groups'->0->'actions'->0;
    IF action->>'fiscalYearId' IS DISTINCT FROM run.fiscal_year_id
      OR action->>'postingDate' IS DISTINCT FROM to_char(to_date(voucher.body->>'date','YYYYMMDD'),'YYYY-MM-DD')
      OR action->>'postingPurpose' IS DISTINCT FROM 'adjustment'
      OR action->>'occurrenceKey' IS DISTINCT FROM 'manual_journal'
      OR jsonb_array_length(action->'lines') IS DISTINCT FROM
         (SELECT count(*) FROM jsonb_array_elements(voucher.body->'transactions') t WHERE t->>'kind'='TRANS') THEN
      PERFORM openerp.fail('InvalidJournal','Ledger plan date, year and final source line membership must agree.'); END IF;
    FOR tx IN SELECT value FROM jsonb_array_elements(voucher.body->'transactions') WHERE value->>'kind'='TRANS' LOOP
      SELECT m->>'accountId' INTO native_account FROM jsonb_array_elements(plan.body->'input'->'mappings') m
        WHERE m->>'sourceAccount'=tx->>'account';
      expected:=(tx->>'amount')::numeric*100;
      SELECT value INTO line FROM jsonb_array_elements(action->'lines') WITH ORDINALITY l(value,ordinal)
        WHERE ordinal=(SELECT count(*) FROM jsonb_array_elements(voucher.body->'transactions') t
          WHERE t->>'kind'='TRANS' AND (t->>'recordOrdinal')::integer <= (tx->>'recordOrdinal')::integer);
      IF line->>'accountId' IS DISTINCT FROM native_account
        OR (line->>'debitMinor')::numeric IS DISTINCT FROM greatest(expected,0)
        OR (line->>'creditMinor')::numeric IS DISTINCT FROM greatest(-expected,0) THEN
        PERFORM openerp.fail('InvalidJournal','Native approved lines must preserve every final source amount and mapped account in order.'); END IF;
    END LOOP;
    UPDATE openerp.sie_financial_runs SET permitted_change_id=changes.id WHERE book_id=run.book_id AND id=run.id;
    receipt:=openerp.execute_change(p_token,p_scope,changes.id,p_key||'_ledger_'||ix::text,
      jsonb_build_object('version',1,'planDigest',changes.digest,'approvalId',binding->>'approvalId'));
    INSERT INTO openerp.sie_financial_postings VALUES(run.book_id,run.id,voucher.ordinal,voucher.source_reference,
      openerp.digest(voucher.body),changes.id,receipt->>'voucherId',receipt);
    results:=results||jsonb_build_array(jsonb_build_object('ordinal',voucher.ordinal,'sourceReference',voucher.source_reference,
      'sourceDigest',openerp.digest(voucher.body),'ledgerReceipt',receipt));
  END LOOP;
  UPDATE openerp.sie_financial_runs SET permitted_change_id=NULL,next_ordinal=next_ordinal+count_items,
    lease_until=clock_timestamp()+interval '15 minutes',
    status=CASE WHEN next_ordinal+count_items>(plan.body->>'voucherCount')::integer THEN 'posted' ELSE 'running' END
    WHERE book_id=run.book_id AND id=run.id RETURNING * INTO run;
  RETURN openerp.save_command(run.book_id,p_key,actor,'advance_sie_financial_run',request,
    jsonb_build_object('id',run.id,'nextOrdinal',run.next_ordinal,'fence',run.fence::text,'status',run.status,'items',results));
END $$;
CREATE FUNCTION openerp.reclaim_sie_financial_run(p_token text,p_scope jsonb,p_key text,p_id text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; previous jsonb; run openerp.sie_financial_runs;
  request jsonb:=jsonb_build_object('runId',p_id,'action',p_action); result jsonb;
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,actor,'reclaim_sie_financial_run',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO run FROM openerp.sie_financial_runs WHERE book_id=p_scope->>'bookId' AND id=p_id FOR UPDATE;
  IF NOT FOUND OR run.status='posted' OR p_action NOT IN ('pause','resume') THEN
    PERFORM openerp.fail('InvalidJournal','Only an unfinished financial run can pause or resume.'); END IF;
  UPDATE openerp.sie_financial_runs SET status=CASE WHEN p_action='pause' THEN 'paused' ELSE 'running' END,
    lease_until=clock_timestamp()+interval '15 minutes',fence=fence+1
    WHERE book_id=run.book_id AND id=run.id RETURNING * INTO run;
  result:=jsonb_build_object('id',run.id,'nextOrdinal',run.next_ordinal,'fence',run.fence::text,'status',run.status);
  RETURN openerp.save_command(run.book_id,p_key,actor,'reclaim_sie_financial_run',request,result);
END $$;
CREATE FUNCTION openerp.sie_financial_run_view(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE run openerp.sie_financial_runs; items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT * INTO run FROM openerp.sie_financial_runs WHERE book_id=p_scope->>'bookId' AND id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Financial run not found.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',p.ordinal,'sourceReference',p.source_reference,
    'sourceDigest',p.source_digest,'ledgerReceipt',p.receipt) ORDER BY p.ordinal),'[]') INTO items
    FROM openerp.sie_financial_postings p WHERE p.book_id=run.book_id AND p.run_id=run.id;
  RETURN jsonb_build_object('id',run.id,'sourceRunId',run.source_run_id,'fiscalYearId',run.fiscal_year_id,
    'planDigest',run.source_plan_digest,'nextOrdinal',run.next_ordinal,'fence',run.fence::text,
    'status',run.status,'items',items);
END $$;
REVOKE ALL ON FUNCTION openerp.start_sie_financial_run(text,jsonb,text,text,text,text),
 openerp.advance_sie_financial_run(text,jsonb,text,text,jsonb),openerp.reclaim_sie_financial_run(text,jsonb,text,text,text),
 openerp.sie_financial_run_view(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.start_sie_financial_run(text,jsonb,text,text,text,text),
 openerp.advance_sie_financial_run(text,jsonb,text,text,jsonb),openerp.reclaim_sie_financial_run(text,jsonb,text,text,text),
 openerp.sie_financial_run_view(text,jsonb,text) TO openerp_runtime;
