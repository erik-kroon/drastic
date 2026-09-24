-- Historical register facts do not mutate live commerce or bank allocation capacity.
-- Unknown chronology stays unknown: a source match is not a native payment receipt.
CREATE TABLE openerp.historical_item_admissions (
  book_id text NOT NULL, id text NOT NULL, source_plan_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,source_plan_id),
  FOREIGN KEY(book_id,source_plan_id) REFERENCES openerp.sie_source_plans
);
CREATE TABLE openerp.historical_items (
  book_id text NOT NULL, admission_id text NOT NULL, source_identity text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,admission_id,source_identity),
  FOREIGN KEY(book_id,admission_id) REFERENCES openerp.historical_item_admissions
);
CREATE TABLE openerp.historical_payments (
  book_id text NOT NULL, admission_id text NOT NULL, source_identity text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,admission_id,source_identity),
  FOREIGN KEY(book_id,admission_id) REFERENCES openerp.historical_item_admissions
);
CREATE TABLE openerp.historical_matches (
  book_id text NOT NULL, admission_id text NOT NULL, source_identity text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,admission_id,source_identity),
  FOREIGN KEY(book_id,admission_id) REFERENCES openerp.historical_item_admissions
);
CREATE TRIGGER immutable_historical_item_admission BEFORE UPDATE OR DELETE ON openerp.historical_item_admissions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_item BEFORE UPDATE OR DELETE ON openerp.historical_items
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_payment BEFORE UPDATE OR DELETE ON openerp.historical_payments
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_match BEFORE UPDATE OR DELETE ON openerp.historical_matches
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.historical_item_admissions,openerp.historical_items,
  openerp.historical_payments,openerp.historical_matches FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.admit_historical_items(p_token text,p_scope jsonb,p_key text,p_plan text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; previous jsonb; request jsonb:=jsonb_build_object('planId',p_plan,'input',p_input);
  plan openerp.sie_source_plans; admission jsonb; item jsonb; payment jsonb; match jsonb;
  control jsonb; expected numeric; ids text[]:='{}'; payments text[]:='{}'; matches text[]:='{}';
  amount numeric; original numeric; outstanding numeric;
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,actor,'admit_historical_items',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO plan FROM openerp.sie_source_plans WHERE book_id=p_scope->>'bookId' AND id=p_plan;
  IF NOT FOUND OR p_input->>'planDigest' IS DISTINCT FROM plan.body->>'digest'
    OR NOT EXISTS(SELECT FROM openerp.sie_source_runs r WHERE r.book_id=plan.book_id AND r.plan_id=plan.id AND r.status='staged') THEN
    PERFORM openerp.fail('StaleDependency','Use the exact fully staged source plan before historical item admission.'); END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input-ARRAY['planDigest','payments','matches','paymentControls','matchControls','chronology','rationale']<>'{}'::jsonb
    OR jsonb_typeof(p_input->'payments') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_input->'matches') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_input->'paymentControls') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_input->'matchControls') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'payments')>500 OR jsonb_array_length(p_input->'matches')>500
    OR jsonb_array_length(p_input->'paymentControls')>500 OR jsonb_array_length(p_input->'matchControls')>500
    OR p_input->>'chronology' NOT IN ('dated_source','unknown')
    OR coalesce(length(p_input->>'rationale'),0) NOT BETWEEN 1 AND 2000 THEN
    PERFORM openerp.fail('InvalidJournal','Review bounded source payment and match membership with independent totals and chronology.'); END IF;
  IF EXISTS(SELECT FROM openerp.historical_item_admissions a WHERE a.book_id=plan.book_id AND a.source_plan_id=plan.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','The retained source plan already has an admitted historical register.'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(plan.body->'input'->'openItems') LOOP
    original:=(item->>'originalMinor')::numeric;outstanding:=(item->>'outstandingMinor')::numeric;
    IF (item->>'assertedState'='unpaid' AND original<>outstanding)
      OR (item->>'assertedState'='partly_paid' AND (original=0 OR outstanding=0 OR abs(outstanding)>=abs(original)))
      OR (item->>'assertedState'<>'unknown' AND original*outstanding<0)
      OR abs(outstanding)>abs(original) THEN
      PERFORM openerp.fail('InvalidJournal','Source item state and original/outstanding amounts conflict.'); END IF;
    ids:=array_append(ids,item->>'sourceIdentity');
  END LOOP;
  FOR payment IN SELECT value FROM jsonb_array_elements(p_input->'payments') LOOP
    IF payment-ARRAY['sourceIdentity','sourceAccount','currency','amountMinor','sourceDate','basis']<>'{}'::jsonb
      OR coalesce(length(payment->>'sourceIdentity'),0) NOT BETWEEN 1 AND 200
      OR payment->>'sourceIdentity'=ANY(payments)
      OR coalesce(payment->>'currency','')!~'^[A-Z]{3}$'
      OR coalesce(payment->>'amountMinor','')!~'^[1-9][0-9]{0,37}$'
      OR coalesce(length(payment->>'basis'),0) NOT BETWEEN 1 AND 2000
      OR NOT EXISTS(SELECT FROM jsonb_array_elements(plan.body->'input'->'openItems') i
        WHERE i->>'sourceAccount'=payment->>'sourceAccount' AND i->>'currency'=payment->>'currency') THEN
      PERFORM openerp.fail('InvalidJournal','Each source payment requires a distinct identity, valid amount and mapped item account.'); END IF;
    IF payment->'sourceDate' IS NOT NULL AND payment->'sourceDate'<>'null'::jsonb THEN
      BEGIN
        IF to_char((payment->>'sourceDate')::date,'YYYY-MM-DD') IS DISTINCT FROM payment->>'sourceDate' THEN RAISE invalid_datetime_format; END IF;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        PERFORM openerp.fail('InvalidJournal','Payment source date is invalid; use null when unknown.'); END;
    ELSIF p_input->>'chronology'='dated_source' THEN
      PERFORM openerp.fail('InvalidJournal','Dated source chronology requires every retained payment source date.'); END IF;
    payments:=array_append(payments,payment->>'sourceIdentity');
  END LOOP;
  FOR match IN SELECT value FROM jsonb_array_elements(p_input->'matches') LOOP
    IF match-ARRAY['sourceIdentity','itemIdentity','paymentIdentity','amountMinor','sourceDate','basis']<>'{}'::jsonb
      OR coalesce(length(match->>'sourceIdentity'),0) NOT BETWEEN 1 AND 200
      OR match->>'sourceIdentity'=ANY(matches)
      OR NOT (match->>'itemIdentity'=ANY(ids)) OR NOT (match->>'paymentIdentity'=ANY(payments))
      OR coalesce(match->>'amountMinor','')!~'^[1-9][0-9]{0,37}$'
      OR coalesce(length(match->>'basis'),0) NOT BETWEEN 1 AND 2000
      OR NOT EXISTS(SELECT FROM jsonb_array_elements(plan.body->'input'->'openItems') i,
          jsonb_array_elements(p_input->'payments') pay
          WHERE i->>'sourceIdentity'=match->>'itemIdentity' AND pay->>'sourceIdentity'=match->>'paymentIdentity'
            AND i->>'sourceAccount'=pay->>'sourceAccount' AND i->>'currency'=pay->>'currency') THEN
      PERFORM openerp.fail('InvalidJournal','Source match must identify a distinct payment and item of the same account and currency.'); END IF;
    IF match->'sourceDate' IS NOT NULL AND match->'sourceDate'<>'null'::jsonb THEN
      BEGIN
        IF to_char((match->>'sourceDate')::date,'YYYY-MM-DD') IS DISTINCT FROM match->>'sourceDate' THEN RAISE invalid_datetime_format; END IF;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        PERFORM openerp.fail('InvalidJournal','Match date is invalid; use null when unknown.'); END;
    ELSIF p_input->>'chronology'='dated_source' THEN
      PERFORM openerp.fail('InvalidJournal','Dated source chronology requires every source match date.'); END IF;
    IF p_input->>'chronology'='dated_source' AND EXISTS(
      SELECT FROM jsonb_array_elements(p_input->'payments') pay
      WHERE pay->>'sourceIdentity'=match->>'paymentIdentity'
        AND (match->>'sourceDate')::date<(pay->>'sourceDate')::date) THEN
      PERFORM openerp.fail('InvalidJournal','A source match cannot precede its dated source payment.'); END IF;
    matches:=array_append(matches,match->>'sourceIdentity');
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(p_input->'payments') pay WHERE
      (SELECT coalesce(sum((m->>'amountMinor')::numeric),0) FROM jsonb_array_elements(p_input->'matches') m
        WHERE m->>'paymentIdentity'=pay->>'sourceIdentity')>(pay->>'amountMinor')::numeric)
    OR EXISTS(SELECT FROM jsonb_array_elements(plan.body->'input'->'openItems') i WHERE
      (SELECT coalesce(sum((m->>'amountMinor')::numeric),0) FROM jsonb_array_elements(p_input->'matches') m
        WHERE m->>'itemIdentity'=i->>'sourceIdentity')>abs((i->>'originalMinor')::numeric)) THEN
    PERFORM openerp.fail('InvalidJournal','Retained matches cannot exceed source payment or original item capacity.'); END IF;
  FOR control IN SELECT value FROM jsonb_array_elements(p_input->'paymentControls') LOOP
    IF control-ARRAY['sourceAccount','currency','independentTotalMinor','basis']<>'{}'::jsonb
      OR coalesce(control->>'independentTotalMinor','')!~'^(0|[1-9][0-9]{0,37})$'
      OR coalesce(length(control->>'basis'),0) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal','Independent source payment control is incomplete.'); END IF;
    SELECT coalesce(sum((p->>'amountMinor')::numeric),0) INTO expected FROM jsonb_array_elements(p_input->'payments') p
      WHERE p->>'sourceAccount'=control->>'sourceAccount' AND p->>'currency'=control->>'currency';
    IF expected<>(control->>'independentTotalMinor')::numeric THEN
      PERFORM openerp.fail('InvalidJournal','Source payment amount differs from independent control.'); END IF;
  END LOOP;
  FOR control IN SELECT value FROM jsonb_array_elements(p_input->'matchControls') LOOP
    IF control-ARRAY['sourceAccount','currency','independentTotalMinor','basis']<>'{}'::jsonb
      OR coalesce(control->>'independentTotalMinor','')!~'^(0|[1-9][0-9]{0,37})$'
      OR coalesce(length(control->>'basis'),0) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal','Independent source match control is incomplete.'); END IF;
    SELECT coalesce(sum((m->>'amountMinor')::numeric),0) INTO expected FROM jsonb_array_elements(p_input->'matches') m
      JOIN LATERAL jsonb_array_elements(p_input->'payments') p ON p->>'sourceIdentity'=m->>'paymentIdentity'
      WHERE p->>'sourceAccount'=control->>'sourceAccount' AND p->>'currency'=control->>'currency';
    IF expected<>(control->>'independentTotalMinor')::numeric THEN
      PERFORM openerp.fail('InvalidJournal','Source match amount differs from independent control.'); END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(p_input->'payments') p WHERE NOT EXISTS(
      SELECT FROM jsonb_array_elements(p_input->'paymentControls') c
      WHERE c->>'sourceAccount'=p->>'sourceAccount' AND c->>'currency'=p->>'currency'))
    OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'matches') m
      JOIN LATERAL jsonb_array_elements(p_input->'payments') p ON p->>'sourceIdentity'=m->>'paymentIdentity'
      WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(p_input->'matchControls') c
        WHERE c->>'sourceAccount'=p->>'sourceAccount' AND c->>'currency'=p->>'currency'))
    OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'paymentControls') c GROUP BY c->>'sourceAccount',c->>'currency' HAVING count(*)>1)
    OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'matchControls') c GROUP BY c->>'sourceAccount',c->>'currency' HAVING count(*)>1)
    OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'paymentControls') c WHERE NOT EXISTS(
      SELECT FROM jsonb_array_elements(p_input->'payments') p
        WHERE p->>'sourceAccount'=c->>'sourceAccount' AND p->>'currency'=c->>'currency'))
    OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'matchControls') c WHERE NOT EXISTS(
      SELECT FROM jsonb_array_elements(p_input->'matches') m
        JOIN LATERAL jsonb_array_elements(p_input->'payments') p ON p->>'sourceIdentity'=m->>'paymentIdentity'
        WHERE p->>'sourceAccount'=c->>'sourceAccount' AND p->>'currency'=c->>'currency'))
    OR (jsonb_array_length(p_input->'payments')=0 AND jsonb_array_length(p_input->'paymentControls')<>0)
    OR (jsonb_array_length(p_input->'matches')=0 AND jsonb_array_length(p_input->'matchControls')<>0) THEN
    PERFORM openerp.fail('InvalidJournal','Independent historical controls must cover exactly the supplied payment and match groups.'); END IF;
  admission:=jsonb_build_object('id',openerp.new_id('historical'),'sourcePlanId',plan.id,
    'planDigest',plan.body->>'digest','openItems',plan.body->'input'->'openItems',
    'openItemControls',plan.body->'input'->'openItemControls','payments',p_input->'payments',
    'matches',p_input->'matches','paymentControls',p_input->'paymentControls',
    'matchControls',p_input->'matchControls','chronology',p_input->>'chronology',
    'rationale',p_input->>'rationale','financialEffect','none','admittedBy',actor,
    'admittedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  admission:=admission||jsonb_build_object('digest',openerp.digest(admission));
  INSERT INTO openerp.historical_item_admissions VALUES(plan.book_id,admission->>'id',plan.id,admission);
  INSERT INTO openerp.historical_items SELECT plan.book_id,admission->>'id',i->>'sourceIdentity',i
    FROM jsonb_array_elements(plan.body->'input'->'openItems') i;
  INSERT INTO openerp.historical_payments SELECT plan.book_id,admission->>'id',p->>'sourceIdentity',p
    FROM jsonb_array_elements(p_input->'payments') p;
  INSERT INTO openerp.historical_matches SELECT plan.book_id,admission->>'id',m->>'sourceIdentity',m
    FROM jsonb_array_elements(p_input->'matches') m;
  RETURN openerp.save_command(plan.book_id,p_key,actor,'admit_historical_items',request,admission);
END $$;
CREATE FUNCTION openerp.get_historical_items(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT body INTO result FROM openerp.historical_item_admissions WHERE book_id=p_scope->>'bookId' AND id=p_id;
  IF result IS NULL THEN PERFORM openerp.fail('NotFound','Historical item admission was not found.'); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION openerp.admit_historical_items(text,jsonb,text,text,jsonb),
  openerp.get_historical_items(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.admit_historical_items(text,jsonb,text,text,jsonb),
  openerp.get_historical_items(text,jsonb,text) TO openerp_runtime;
