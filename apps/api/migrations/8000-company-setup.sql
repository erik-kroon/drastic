-- Company facts are editable setup inputs, not authority to activate accounting rules.
CREATE TABLE openerp.company_setups (
  book_id text PRIMARY KEY REFERENCES openerp.books(id),
  details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
  revision integer NOT NULL CHECK(revision>0),
  created_by text NOT NULL REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.company_setup_commands (
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  key text NOT NULL,
  book_id text NOT NULL REFERENCES openerp.books(id),
  operation text NOT NULL CHECK(operation IN ('create','save')),
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,key)
);
REVOKE ALL ON openerp.company_setups,openerp.company_setup_commands FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.company_setup_snapshot(p_book text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE b openerp.books; s openerp.company_setups; details jsonb; missing jsonb;
BEGIN
  SELECT * INTO STRICT b FROM openerp.books WHERE id=p_book;
  SELECT * INTO s FROM openerp.company_setups WHERE book_id=p_book;
  details:=coalesce(s.details,jsonb_build_object('name',b.name,'legalForm',null,'organizationNumber',null,
    'accountingMethod',null,'vatRegistered',null,'vatPeriod',null,'fiscalYearStartsOn',null,
    'fiscalYearEndsOn',null,'historyChoice',null,'bankChoice',null));
  SELECT coalesce(jsonb_agg(field ORDER BY ordinal),'[]') INTO missing
    FROM (VALUES (1,'legalForm'),(2,'organizationNumber'),(3,'accountingMethod'),
      (4,'vatRegistered'),(5,'fiscalYearStartsOn'),(6,'fiscalYearEndsOn')) required(ordinal,field)
    WHERE details->>field IS NULL;
  IF details->>'vatRegistered'='true' AND details->>'vatPeriod' IS NULL THEN
    missing:=missing||jsonb_build_array('vatPeriod');
  END IF;
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',b.entity_id,'bookId',b.id),
    'revision',coalesce(s.revision,0),'details',details,'missing',missing,
    'state',CASE WHEN jsonb_array_length(missing)=0 THEN 'details_recorded' ELSE 'incomplete' END,
    'accountingProfile',b.profile);
END $$;

CREATE FUNCTION openerp.company_get_setup(token text,scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR SHARE;
  RETURN openerp.company_setup_snapshot(scope->>'bookId');
END $$;

CREATE FUNCTION openerp.company_create(token text,key text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); previous openerp.company_setup_commands;
  entity text; book text; result jsonb; details jsonb;
BEGIN
  IF key IS NULL OR key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a valid request key.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('company-setup-command:'||actor||':'||key,0));
  SELECT * INTO previous FROM openerp.company_setup_commands c WHERE c.actor_id=actor AND c.key=company_create.key;
  IF FOUND THEN
    IF previous.operation<>'create' OR previous.payload IS DISTINCT FROM payload THEN
      PERFORM openerp.fail('IdempotencyConflict','This request key was already used for different details.'); END IF;
    PERFORM openerp.authorize(token,previous.result->'scope',true);
    RETURN previous.result;
  END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR jsonb_typeof(payload->'name') IS DISTINCT FROM 'string'
    OR length(btrim(payload->>'name')) NOT BETWEEN 1 AND 200
    OR EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k<>'name') THEN
    PERFORM openerp.fail('InvalidJournal','Enter a company name of 1–200 characters.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('company-create:'||actor,0));
  IF (SELECT count(*) FROM openerp.company_setups s WHERE s.created_by=actor)>=100 THEN
    PERFORM openerp.fail('InvalidJournal','This account has reached the limit of 100 created companies.'); END IF;
  entity:='entity_'||replace(gen_random_uuid()::text,'-','');
  book:='book_'||replace(gen_random_uuid()::text,'-','');
  INSERT INTO openerp.entities(id,name) VALUES(entity,btrim(payload->>'name'));
  INSERT INTO openerp.books(id,entity_id,name,currency,currency_scale,profile)
    VALUES(book,entity,btrim(payload->>'name'),'SEK',2,'company-setup-v1');
  INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES(book,actor,'operator');
  details:=openerp.company_setup_snapshot(book)->'details';
  INSERT INTO openerp.company_setups VALUES(book,details,1,actor);
  result:=openerp.company_setup_snapshot(book);
  INSERT INTO openerp.company_setup_commands(actor_id,key,book_id,operation,payload,result)
    VALUES(actor,key,book,'create',payload,result);
  RETURN result;
END $$;

CREATE FUNCTION openerp.company_setup_validate(details jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE field text; starts date; ends date;
BEGIN
  IF details IS NULL OR jsonb_typeof(details)<>'object' OR jsonb_typeof(details->'name') IS DISTINCT FROM 'string'
    OR length(btrim(details->>'name')) NOT BETWEEN 1 AND 200
    OR (SELECT count(*) FROM jsonb_object_keys(details))<>10
    OR EXISTS(SELECT FROM jsonb_object_keys(details) k WHERE k NOT IN ('name','legalForm','organizationNumber',
      'accountingMethod','vatRegistered','vatPeriod','fiscalYearStartsOn','fiscalYearEndsOn','historyChoice','bankChoice')) THEN
    PERFORM openerp.fail('InvalidJournal','Supply company details, using null for facts not yet known.'); END IF;
  FOREACH field IN ARRAY ARRAY['legalForm','organizationNumber','accountingMethod','vatPeriod',
    'fiscalYearStartsOn','fiscalYearEndsOn','historyChoice','bankChoice'] LOOP
    IF jsonb_typeof(details->field) NOT IN ('null','string') THEN
      PERFORM openerp.fail('InvalidJournal','Company details must be text or null.'); END IF;
  END LOOP;
  IF jsonb_typeof(details->'vatRegistered') NOT IN ('null','boolean')
    OR details->>'legalForm' NOT IN ('aktiebolag','enskild_firma')
    OR details->>'accountingMethod' NOT IN ('accrual','cash')
    OR details->>'vatPeriod' NOT IN ('monthly','quarterly','yearly')
    OR details->>'historyChoice' NOT IN ('new_business','sie','opening_balances')
    OR details->>'bankChoice' NOT IN ('connect','file','later')
    OR (details->>'organizationNumber' IS NOT NULL AND details->>'organizationNumber' !~ '^[0-9]{10}$') THEN
    PERFORM openerp.fail('InvalidJournal','Choose one of the available company setup values.'); END IF;
  IF details->>'vatPeriod' IS NOT NULL AND details->>'vatRegistered' IS DISTINCT FROM 'true' THEN
    PERFORM openerp.fail('InvalidJournal','A VAT reporting period requires VAT registration.'); END IF;
  FOREACH field IN ARRAY ARRAY['fiscalYearStartsOn','fiscalYearEndsOn'] LOOP
    IF details->>field IS NOT NULL THEN
      IF details->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        PERFORM openerp.fail('InvalidJournal','Enter fiscal year dates as YYYY-MM-DD.'); END IF;
      BEGIN
        PERFORM (details->>field)::date;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        PERFORM openerp.fail('InvalidJournal','Enter a valid calendar date.');
      END;
    END IF;
  END LOOP;
  starts:=(details->>'fiscalYearStartsOn')::date; ends:=(details->>'fiscalYearEndsOn')::date;
  IF starts>ends THEN PERFORM openerp.fail('InvalidJournal','The fiscal year must end on or after its start date.'); END IF;
END $$;

CREATE FUNCTION openerp.company_save_setup(token text,scope jsonb,key text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.authorize(token,scope,true); previous openerp.company_setup_commands;
  current_revision integer; result jsonb; details jsonb;
BEGIN
  -- All company commands lock the request identity before company configuration.
  IF key IS NULL OR key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a valid request key.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('company-setup-command:'||actor||':'||key,0));
  SELECT * INTO previous FROM openerp.company_setup_commands c WHERE c.actor_id=actor AND c.key=company_save_setup.key;
  IF FOUND THEN
    IF previous.operation<>'save' OR previous.book_id<>scope->>'bookId' OR previous.payload IS DISTINCT FROM payload THEN
      PERFORM openerp.fail('IdempotencyConflict','This request key was already used for different details.'); END IF;
    RETURN previous.result;
  END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object'
    OR jsonb_typeof(payload->'expectedRevision') IS DISTINCT FROM 'number'
    OR (payload->>'expectedRevision') !~ '^[0-9]{1,9}$'
    OR EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('expectedRevision','details')) THEN
    PERFORM openerp.fail('InvalidJournal','Supply setup details and the current revision.'); END IF;
  details:=payload->'details';
  PERFORM openerp.company_setup_validate(details);
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  SELECT s.revision INTO current_revision FROM openerp.company_setups s WHERE s.book_id=scope->>'bookId';
  IF coalesce(current_revision,0)<>(payload->>'expectedRevision')::integer THEN
    PERFORM openerp.fail('StaleDependency','Company details changed. Reload the current details before saving.'); END IF;
  INSERT INTO openerp.company_setups(book_id,details,revision,created_by)
    VALUES(scope->>'bookId',details||jsonb_build_object('name',btrim(details->>'name')),coalesce(current_revision,0)+1,actor)
    ON CONFLICT(book_id) DO UPDATE SET details=excluded.details,revision=excluded.revision;
  UPDATE openerp.books SET name=btrim(details->>'name') WHERE id=scope->>'bookId';
  result:=openerp.company_setup_snapshot(scope->>'bookId');
  INSERT INTO openerp.company_setup_commands(actor_id,key,book_id,operation,payload,result)
    VALUES(actor,key,scope->>'bookId','save',payload,result);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION openerp.company_setup_snapshot(text),openerp.company_setup_validate(jsonb),
  openerp.company_create(text,text,jsonb),openerp.company_get_setup(text,jsonb),
  openerp.company_save_setup(text,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.company_create(text,text,jsonb),openerp.company_get_setup(text,jsonb),
  openerp.company_save_setup(text,jsonb,text,jsonb) TO openerp_runtime;
