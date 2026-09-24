-- Migration basis is scoped to a book, fiscal year and cutover date. Existing books are not retrofitted.
CREATE TABLE openerp.historical_bases (
  book_id text NOT NULL, fiscal_year_id text NOT NULL, mode text NOT NULL
    CHECK (mode IN ('full_history','opening_set')),
  cutover_on date NOT NULL, source_plan_id text NOT NULL, source_digest text NOT NULL,
  change_set_id text, opening_voucher_id text,
  control jsonb NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,fiscal_year_id), UNIQUE(book_id,change_set_id),
  FOREIGN KEY(book_id,fiscal_year_id) REFERENCES openerp.fiscal_years,
  FOREIGN KEY(book_id,source_plan_id) REFERENCES openerp.sie_source_plans,
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY(book_id,opening_voucher_id) REFERENCES openerp.vouchers,
  CHECK ((mode='full_history' AND change_set_id IS NULL AND opening_voucher_id IS NULL)
      OR (mode='opening_set' AND change_set_id IS NOT NULL))
);
REVOKE ALL ON openerp.historical_bases FROM PUBLIC,openerp_runtime;

-- Check every final posting path, not just manual-journal HTTP routes. The book barrier is
-- held by every approved ledger execution and historical-basis transition.
CREATE FUNCTION openerp.guard_historical_basis() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE basis openerp.historical_bases;
BEGIN
  SELECT * INTO basis FROM openerp.historical_bases b
    WHERE b.book_id=NEW.book_id AND b.fiscal_year_id=NEW.fiscal_year_id;
  IF FOUND AND basis.mode='opening_set' THEN
    IF NEW.change_set_id=basis.change_set_id THEN
      IF basis.opening_voucher_id IS NOT NULL OR NEW.posting_date<>basis.cutover_on THEN
        PERFORM openerp.fail('AlreadyPosted','The migration opening is single-use and must post on its reviewed cutover date.'); END IF;
    ELSIF basis.opening_voucher_id IS NULL OR NEW.posting_date<basis.cutover_on THEN
      PERFORM openerp.fail('ApprovalRequired','Post the reviewed opening before later movements; never backdate through its cutover.');
    END IF;
  END IF;
  IF EXISTS(SELECT FROM openerp.sie_financial_runs r WHERE r.book_id=NEW.book_id AND r.status='running'
    AND (r.permitted_change_id IS DISTINCT FROM NEW.change_set_id OR r.lease_until<=clock_timestamp())) THEN
    PERFORM openerp.fail('StaleDependency','An active historical import fences unrelated ledger postings.'); END IF;
  RETURN NEW;
END $$;
-- The later financial-run migration creates the table referenced by the guard; defined there.

CREATE FUNCTION openerp.select_historical_basis(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; prior jsonb; y openerp.fiscal_years; plan openerp.sie_source_plans;
  changes openerp.change_sets; action jsonb; row jsonb; item jsonb; lines jsonb; signed numeric;
  seen text[]:='{}'; net numeric:=0; voucher_balance numeric; start_date date;
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  prior:=openerp.replay(p_scope->>'bookId',p_key,actor,'select_historical_basis',p_input);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input-ARRAY['fiscalYearId','mode','cutoverOn','sourcePlanId','sourceDigest','changeSetId','controls','rationale']<>'{}'::jsonb
    OR p_input->>'mode' NOT IN ('full_history','opening_set')
    OR coalesce(length(p_input->>'rationale'),0) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(p_input->'controls') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'controls') NOT BETWEEN 2 AND 500 THEN
    PERFORM openerp.fail('InvalidJournal','Review one bounded complete historical basis and independent account controls.'); END IF;
  SELECT * INTO y FROM openerp.fiscal_years WHERE book_id=p_scope->>'bookId' AND id=p_input->>'fiscalYearId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Fiscal year not found.'); END IF;
  BEGIN
    start_date:=(p_input->>'cutoverOn')::date;
    IF to_char(start_date,'YYYY-MM-DD') IS DISTINCT FROM p_input->>'cutoverOn' THEN RAISE invalid_datetime_format; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    PERFORM openerp.fail('InvalidJournal','Supply a valid cutover date.');
  END;
  IF start_date NOT BETWEEN y.starts_on AND y.ends_on THEN
    PERFORM openerp.fail('InvalidJournal','Cutover must fall inside the selected fiscal year.'); END IF;
  SELECT * INTO plan FROM openerp.sie_source_plans WHERE book_id=y.book_id AND id=p_input->>'sourcePlanId';
  IF NOT FOUND OR plan.body->>'digest' IS DISTINCT FROM p_input->>'sourceDigest'
    OR NOT EXISTS(SELECT FROM openerp.sie_source_runs r WHERE r.book_id=y.book_id AND r.plan_id=plan.id AND r.status='staged') THEN
    PERFORM openerp.fail('StaleDependency','A fully staged immutable source plan and its exact digest are required.'); END IF;
  IF EXISTS(SELECT FROM openerp.historical_bases WHERE book_id=y.book_id AND fiscal_year_id=y.id)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=y.book_id AND v.posting_date>=y.starts_on)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=y.book_id AND v.posting_date<y.starts_on AND p_input->>'mode'='opening_set') THEN
    PERFORM openerp.fail('AlreadyPosted','Select a migration opening only before any book history; select full history only before posting the selected year.'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_input->'controls') LOOP
    IF item-ARRAY['accountId','signedMinor','basis']<>'{}'::jsonb
      OR coalesce(item->>'accountId','')!~'^[a-z][a-z0-9_-]{2,127}$'
      OR item->>'accountId'=ANY(seen)
      OR coalesce(item->>'signedMinor','')!~'^(0|-?[1-9][0-9]{0,37})$'
      OR coalesce(length(item->>'basis'),0) NOT BETWEEN 1 AND 2000
      OR NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=y.book_id AND a.id=item->>'accountId' AND a.active) THEN
      PERFORM openerp.fail('InvalidJournal','Supply unique active mapped accounts and independently sourced exact balances.'); END IF;
    seen:=array_append(seen,item->>'accountId'); net:=net+(item->>'signedMinor')::numeric;
  END LOOP;
  IF net<>0 OR (p_input->>'mode'='opening_set' AND NOT EXISTS(
      SELECT FROM jsonb_array_elements(p_input->'controls') i WHERE (i->>'signedMinor')::numeric>0)) THEN
    PERFORM openerp.fail('InvalidJournal','Independent controls must balance; an OpeningSet needs nonzero debit and credit sides.'); END IF;
  IF p_input->>'mode'='full_history' AND (
    (SELECT count(DISTINCT c->>'year') FROM jsonb_array_elements(plan.body->'input'->'openingControls') c)<>1
    OR EXISTS(
      WITH source_opening AS (
        SELECT m->>'accountId' account_id,sum((c->>'independentOpeningMinor')::numeric) balance
        FROM jsonb_array_elements(plan.body->'input'->'openingControls') c
        JOIN LATERAL jsonb_array_elements(plan.body->'input'->'mappings') m
          ON m->>'sourceAccount'=c->>'sourceAccount' GROUP BY m->>'accountId'
      ), reviewed AS (
        SELECT i->>'accountId' account_id,(i->>'signedMinor')::numeric balance
          FROM jsonb_array_elements(p_input->'controls') i
      )
      SELECT FROM source_opening s FULL JOIN reviewed r USING(account_id)
        WHERE s.balance IS DISTINCT FROM r.balance
    )) THEN
    PERFORM openerp.fail('InvalidJournal','Full-history independent account controls must equal the complete retained SIE opening for one source year.'); END IF;
  IF p_input->>'mode'='opening_set' THEN
    SELECT * INTO changes FROM openerp.change_sets WHERE book_id=y.book_id AND id=p_input->>'changeSetId';
    action:=changes.plan->'groups'->0->'actions'->0;
    IF NOT FOUND OR action->>'fiscalYearId' IS DISTINCT FROM y.id
      OR action->>'postingDate' IS DISTINCT FROM start_date::text
      OR action->>'postingPurpose' IS DISTINCT FROM 'adjustment'
      OR EXISTS(SELECT FROM openerp.execution_receipts r WHERE r.book_id=y.book_id AND r.change_set_id=changes.id)
      OR jsonb_array_length(action->'lines')<>jsonb_array_length(p_input->'controls') THEN
      PERFORM openerp.fail('ApprovalRequired','Seal an unposted ledger change with the exact cutover date and complete opening controls.'); END IF;
    PERFORM openerp.check_dependencies(p_scope,changes.plan);
    FOR item IN SELECT value FROM jsonb_array_elements(p_input->'controls') LOOP
      signed:=(item->>'signedMinor')::numeric;
      IF NOT EXISTS(SELECT FROM jsonb_array_elements(action->'lines') l
        WHERE l->>'accountId'=item->>'accountId'
          AND (l->>'debitMinor')::numeric=greatest(signed,0)
          AND (l->>'creditMinor')::numeric=greatest(-signed,0)) THEN
        PERFORM openerp.fail('InvalidJournal','Approved ledger lines differ from independent opening controls.'); END IF;
    END LOOP;
  ELSIF p_input->'changeSetId' IS NOT NULL AND p_input->'changeSetId'<>'null'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Full retained history must not include an opening ledger plan.');
  END IF;
  row:=jsonb_build_object('fiscalYearId',y.id,'mode',p_input->>'mode','cutoverOn',start_date::text,
    'sourcePlanId',plan.id,'sourceDigest',plan.body->>'digest','changeSetId',p_input->'changeSetId',
    'controls',p_input->'controls','rationale',p_input->>'rationale','actorId',actor,
    'selectedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.historical_bases(book_id,fiscal_year_id,mode,cutover_on,source_plan_id,source_digest,change_set_id,control,body)
    VALUES(y.book_id,y.id,p_input->>'mode',start_date,plan.id,plan.body->>'digest',
      CASE WHEN p_input->>'mode'='opening_set' THEN changes.id ELSE NULL END,p_input->'controls',row);
  RETURN openerp.save_command(y.book_id,p_key,actor,'select_historical_basis',p_input,row);
END $$;

CREATE FUNCTION openerp.post_historical_opening(p_token text,p_scope jsonb,p_key text,p_year text,p_digest text,p_approval text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; prior jsonb; b openerp.historical_bases; result jsonb;
  request jsonb:=jsonb_build_object('fiscalYearId',p_year,'planDigest',p_digest,'approvalId',p_approval);
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  prior:=openerp.replay(p_scope->>'bookId',p_key,actor,'post_historical_opening',request);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  SELECT * INTO b FROM openerp.historical_bases WHERE book_id=p_scope->>'bookId' AND fiscal_year_id=p_year FOR UPDATE;
  IF NOT FOUND OR b.mode<>'opening_set' OR b.opening_voucher_id IS NOT NULL THEN
    PERFORM openerp.fail('ApprovalRequired','Select an unposted OpeningSet once before posting its ledger change.'); END IF;
  IF p_digest IS DISTINCT FROM (SELECT digest FROM openerp.change_sets WHERE book_id=b.book_id AND id=b.change_set_id) THEN
    PERFORM openerp.fail('StaleDependency','Approve the exact reviewed ledger plan.'); END IF;
  result:=openerp.execute_change(p_token,p_scope,b.change_set_id,p_key||'_ledger',
    jsonb_build_object('version',1,'planDigest',p_digest,'approvalId',p_approval));
  UPDATE openerp.historical_bases SET opening_voucher_id=result->>'voucherId'
    WHERE book_id=b.book_id AND fiscal_year_id=b.fiscal_year_id;
  RETURN openerp.save_command(b.book_id,p_key,actor,'post_historical_opening',request,
    b.body||jsonb_build_object('voucherId',result->>'voucherId','ledgerReceipt',result));
END $$;

CREATE FUNCTION openerp.get_historical_basis(p_token text,p_scope jsonb,p_year text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT body||jsonb_build_object('voucherId',opening_voucher_id) INTO result
    FROM openerp.historical_bases WHERE book_id=p_scope->>'bookId' AND fiscal_year_id=p_year;
  IF result IS NULL THEN PERFORM openerp.fail('NotFound','Historical basis was not found.'); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION openerp.select_historical_basis(text,jsonb,text,jsonb),
  openerp.post_historical_opening(text,jsonb,text,text,text,text),openerp.get_historical_basis(text,jsonb,text)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.select_historical_basis(text,jsonb,text,jsonb),
  openerp.post_historical_opening(text,jsonb,text,text,text,text),openerp.get_historical_basis(text,jsonb,text)
  TO openerp_runtime;
