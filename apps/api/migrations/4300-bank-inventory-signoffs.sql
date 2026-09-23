-- Aggregate existing immutable3500 account signoffs. No reconciliation or financial authority.
CREATE TABLE openerp.bank_inventory_signoff_plans (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, inventory_id text NOT NULL,
  body jsonb NOT NULL, content text NOT NULL, sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 8388608), PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,inventory_id) REFERENCES openerp.closing_inventories(book_id,id),
  CHECK(byte_length=octet_length(convert_to(content,'UTF8'))),
  CHECK(sha256=encode(sha256(convert_to(content,'UTF8')),'hex'))
);
CREATE TABLE openerp.bank_inventory_signoffs (
  book_id text NOT NULL, plan_id text NOT NULL, evidence_id text NOT NULL,
  body jsonb NOT NULL, content text NOT NULL, sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 8388608), PRIMARY KEY(book_id,plan_id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.bank_inventory_signoff_plans(book_id,id),
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
  CHECK(byte_length=octet_length(convert_to(content,'UTF8'))),
  CHECK(sha256=encode(sha256(convert_to(content,'UTF8')),'hex'))
);
CREATE TRIGGER immutable_bank_inventory_signoff_plan BEFORE UPDATE OR DELETE ON openerp.bank_inventory_signoff_plans
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_inventory_signoff BEFORE UPDATE OR DELETE ON openerp.bank_inventory_signoffs
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.bank_inventory_signoff_plans,openerp.bank_inventory_signoffs FROM PUBLIC,openerp_runtime;

-- Every member has the same3500 dependency capture. Evaluate its existing bounded owner once.
-- Member signatures and artifact identities are immutable; new alternative reports/signatures do not supersede them.
CREATE FUNCTION openerp.bank_inventory_signoff_current(p_book text,p_plan jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_digest text;
BEGIN
  s_digest:=openerp.bank_source_coverage_dependency_digest(p_book,p_plan->'basis'->>'inventoryId');
  RETURN coalesce(s_digest=p_plan->'basis'->>'dependencyDigest',false)
    AND NOT EXISTS(SELECT FROM jsonb_array_elements(p_plan->'members') m
      WHERE NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=m->>'accountId' AND a.active));
END $$;

CREATE FUNCTION openerp.prepare_bank_inventory_signoff(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_previous jsonb; s_book openerp.books; s_inventory openerp.closing_inventories;
  s_period openerp.periods; s_starts date; s_ends date; s_ids text[]; s_expected text[]; s_actual text[];
  s_member record; s_members jsonb:='[]'; s_digest text; s_body jsonb; s_content text; s_bytes integer;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(s_book.id,p_key,s_actor,'prepare_bank_inventory_signoff',p_input);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  PERFORM openerp.bank_require_profile(s_book.id);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['inventoryId','startsOn','endsOn','signoffPlanIds']);
  IF jsonb_typeof(p_input->'inventoryId') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'inventoryId','')!~'^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'startsOn') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'endsOn') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'signoffPlanIds') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Select the latest period inventory and every already signed account plan.'); END IF;
  IF jsonb_array_length(p_input->'signoffPlanIds') NOT BETWEEN 1 AND 100
    OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'signoffPlanIds') x
      WHERE jsonb_typeof(x)<>'string' OR (x#>>'{}')!~'^[a-z][a-z0-9_-]{2,127}$') THEN
    PERFORM openerp.fail('InvalidJournal','Supply 1–100 signed account plan IDs without duplicates.'); END IF;
  SELECT array_agg(x ORDER BY x COLLATE "C") INTO s_ids FROM jsonb_array_elements_text(p_input->'signoffPlanIds') x;
  IF (SELECT count(DISTINCT x) FROM unnest(s_ids) x)<>cardinality(s_ids) THEN
    PERFORM openerp.fail('InvalidJournal','Each signed account plan may be selected only once.'); END IF;
  s_starts:=openerp.bank_date(p_input->>'startsOn'); s_ends:=openerp.bank_date(p_input->>'endsOn');
  SELECT * INTO s_inventory FROM openerp.closing_inventories i WHERE i.book_id=s_book.id AND i.id=p_input->>'inventoryId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The declared bank inventory was not found in this book.'); END IF;
  SELECT * INTO STRICT s_period FROM openerp.periods p WHERE p.book_id=s_book.id AND p.id=s_inventory.period_id FOR SHARE;
  IF s_starts<>s_period.starts_on OR s_ends<>s_period.ends_on THEN
    PERFORM openerp.fail('InvalidJournal','Use exactly the inclusive accounting period owned by this inventory.'); END IF;
  IF EXISTS(SELECT FROM openerp.closing_inventories i WHERE i.book_id=s_book.id AND i.period_id=s_inventory.period_id AND i.ordinal>s_inventory.ordinal) THEN
    PERFORM openerp.fail('StaleDependency','Select the latest evidenced inventory for this period.'); END IF;
  IF s_inventory.body->>'coverage' IS DISTINCT FROM 'synthetic_family_inventory_v1'
    OR jsonb_array_length(s_inventory.body->'bankAccountIds') NOT BETWEEN 1 AND 100
    OR (SELECT count(*) FROM jsonb_array_elements(coalesce(s_inventory.body->'families','[]')) f
      WHERE f->>'family'='bank_sources' AND f->>'status'='required')<>1 THEN
    PERFORM openerp.fail('InvalidJournal','A nonempty evidenced required bank-family inventory is mandatory. Unknown or inapplicable scope cannot be signed.'); END IF;
  SELECT array_agg(x ORDER BY x COLLATE "C") INTO s_expected FROM jsonb_array_elements_text(s_inventory.body->'bankAccountIds') x;
  IF cardinality(s_expected)<>cardinality(s_ids)
    OR (SELECT count(DISTINCT x) FROM unnest(s_expected) x)<>cardinality(s_expected)
    OR EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=s_book.id AND NOT(s.account_id=ANY(s_expected))) THEN
    PERFORM openerp.fail('InvalidJournal','Include exactly every declared account and resolve all known undeclared bank sources first.'); END IF;
  IF (SELECT count(*) FROM openerp.bank_inventory_signoff_plans p WHERE p.book_id=s_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book has reached 200 inventory signoff captures. Existing history remains readable.'); END IF;
  s_digest:=openerp.bank_source_coverage_dependency_digest(s_book.id,s_inventory.id);
  IF s_digest IS NULL THEN PERFORM openerp.fail('UnsupportedProfile','The complete current bank dependency exceeds its existing coverage bounds. Nothing was captured.'); END IF;
  SELECT array_agg(p.body->>'accountId' ORDER BY p.body->>'accountId' COLLATE "C") INTO s_actual
    FROM openerp.bank_signoff_plans p JOIN openerp.bank_reconciliation_signoffs signed
      ON (signed.book_id,signed.plan_id)=(p.book_id,p.id) WHERE p.book_id=s_book.id AND p.id=ANY(s_ids);
  IF s_actual IS DISTINCT FROM s_expected THEN
    PERFORM openerp.fail('InvalidJournal','Use one already signed plan per declared account. Missing, extra, duplicate, unsigned or foreign-book selections are not accepted.'); END IF;
  FOR s_member IN SELECT p.body plan,signed.body signoff,signed.content,signed.sha256,signed.byte_length,c.body coverage
    FROM openerp.bank_signoff_plans p JOIN openerp.bank_reconciliation_signoffs signed
      ON (signed.book_id,signed.plan_id)=(p.book_id,p.id)
    JOIN openerp.bank_source_coverage_reports c ON (c.book_id,c.id)=(p.book_id,p.coverage_report_id)
    WHERE p.book_id=s_book.id AND p.id=ANY(s_ids) ORDER BY p.body->>'accountId' COLLATE "C" LOOP
    IF s_member.plan->'scope' IS DISTINCT FROM p_scope
      OR s_member.plan->>'startsOn' IS DISTINCT FROM s_starts::text OR s_member.plan->>'endsOn' IS DISTINCT FROM s_ends::text
      OR s_member.plan->>'currency' IS DISTINCT FROM s_book.currency OR s_member.plan->'currencyScale' IS DISTINCT FROM to_jsonb(s_book.currency_scale)
      OR s_member.plan->'basis'->>'inventoryId' IS DISTINCT FROM s_inventory.id
      OR s_member.plan->'basis'->>'inventoryDigest' IS DISTINCT FROM openerp.digest(s_inventory.body)
      OR s_member.plan->'basis'->>'ledgerSequence' IS DISTINCT FROM s_book.committed_sequence::text
      OR s_member.plan->'basis'->>'dependencyDigest' IS DISTINCT FROM s_digest
      OR NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=s_book.id AND a.id=s_member.plan->>'accountId' AND a.active) THEN
      PERFORM openerp.fail('StaleDependency','Every signed account must use this latest inventory, whole period, currency, ledger cutoff and current dependency.'); END IF;
    --3500 validates its own account. Whole-inventory review additionally rejects any peer gap.
    IF s_member.coverage->'hasReviewGaps' IS DISTINCT FROM 'false'::jsonb
      OR s_member.coverage->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN
      PERFORM openerp.fail('InvalidJournal','Resolve all declared and known bank-source coverage gaps before whole-inventory review.'); END IF;
    IF s_member.plan->>'digest' IS DISTINCT FROM openerp.digest(s_member.plan-'digest')
      OR s_member.signoff->>'digest' IS DISTINCT FROM s_member.plan->>'digest'
      OR s_member.signoff->>'planId' IS DISTINCT FROM s_member.plan->>'id'
      OR s_member.signoff->'version' IS DISTINCT FROM '1'::jsonb
      OR s_member.content IS DISTINCT FROM openerp.canonical(jsonb_build_object('plan',s_member.plan,'signoff',s_member.signoff))
      OR s_member.byte_length<>octet_length(convert_to(s_member.content,'UTF8'))
      OR s_member.sha256 IS DISTINCT FROM encode(sha256(convert_to(s_member.content,'UTF8')),'hex') THEN
      PERFORM openerp.fail('StaleDependency','The retained individual signature and exact artifact identity do not agree.'); END IF;
    s_members:=s_members||jsonb_build_array(jsonb_build_object('accountId',s_member.plan->>'accountId','plan',s_member.plan,
      'signoff',s_member.signoff,'artifact',jsonb_build_object('sha256',s_member.sha256,'byteLength',s_member.byte_length,'mediaType','application/json')));
  END LOOP;
  s_body:=jsonb_build_object('id',openerp.new_id('bank_inventory_signoff'),'version',1,'scope',p_scope,'input',p_input,
    'periodId',s_period.id,'startsOn',s_starts::text,'endsOn',s_ends::text,'currency',s_book.currency,'currencyScale',s_book.currency_scale,
    'inventory',s_inventory.body,'members',s_members,
    'basis',jsonb_build_object('inventoryId',s_inventory.id,'inventoryDigest',openerp.digest(s_inventory.body),
      'dependencyDigest',s_digest,'memberDigest',openerp.digest(s_members),'ledgerSequence',s_book.committed_sequence::text,
      'checkVersion','declared_bank_inventory_signoff_v1'),
    'reviewScope','whole_declared_bank_inventory','coverage','declared_inventory_only','companyCompleteness','not_established','financialCloseReady',false)
    ||openerp.commerce_record_metadata(p_key,'prepare_bank_inventory_signoff',s_actor);
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  s_content:=openerp.canonical(s_body); s_bytes:=octet_length(convert_to(s_content,'UTF8'));
  IF s_bytes>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','The complete inventory capture exceeds 8 MiB. No partial capture was saved.'); END IF;
  INSERT INTO openerp.bank_inventory_signoff_plans VALUES(s_book.id,s_body->>'id',s_inventory.id,s_body,s_content,
    encode(sha256(convert_to(s_content,'UTF8')),'hex'),s_bytes);
  RETURN openerp.save_command(s_book.id,p_key,s_actor,'prepare_bank_inventory_signoff',p_input,s_body);
END $$;

CREATE FUNCTION openerp.sign_bank_inventory(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_previous jsonb; s_request jsonb:=jsonb_build_object('planId',p_id,'input',p_input);
  s_plan openerp.bank_inventory_signoff_plans; s_existing openerp.bank_inventory_signoffs;
  s_evidence openerp.evidence; s_body jsonb; s_content text; s_bytes integer;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(p_scope->>'bookId',p_key,s_actor,'sign_bank_inventory',s_request);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('ApprovalRequired','Review the exact plan and retain your signoff evidence and rationale.'); END IF;
  IF p_input-ARRAY['digest','version','evidenceId','rationale']<>'{}'::jsonb
    OR p_input->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(p_input->'digest') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'evidenceId') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'evidenceId','')!~'^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(p_input->>'rationale')),0) NOT BETWEEN 1 AND 2000
    OR length(p_input->>'rationale')>2000 THEN
    PERFORM openerp.fail('ApprovalRequired','Review the exact plan and retain your signoff evidence and rationale.'); END IF;
  SELECT * INTO s_plan FROM openerp.bank_inventory_signoff_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank inventory signoff plan was not found in this book.'); END IF;
  IF p_input->>'digest' IS DISTINCT FROM s_plan.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Sign only the exact retained plan digest.'); END IF;
  SELECT * INTO s_existing FROM openerp.bank_inventory_signoffs s WHERE s.book_id=s_plan.book_id AND s.plan_id=s_plan.id;
  IF FOUND THEN
    IF s_existing.body->>'actorId' IS DISTINCT FROM s_actor
      OR s_existing.body-ARRAY['planId','evidenceSha256','actorId','signedAt','receipt'] IS DISTINCT FROM p_input THEN
      PERFORM openerp.fail('IdempotencyConflict','This preparation already has a different immutable signoff.'); END IF;
    RETURN openerp.save_command(s_plan.book_id,p_key,s_actor,'sign_bank_inventory',s_request,s_existing.body);
  END IF;
  PERFORM openerp.bank_require_profile(s_plan.book_id);
  IF NOT openerp.bank_inventory_signoff_current(s_plan.book_id,s_plan.body) THEN
    PERFORM openerp.fail('StaleDependency','The source, inventory, ledger or configuration basis changed. Prepare a fresh signoff.'); END IF;
  SELECT * INTO s_evidence FROM openerp.evidence e WHERE e.book_id=s_plan.book_id AND e.id=p_input->>'evidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the review evidence in this book before signing.'); END IF;
  s_body:=p_input||jsonb_build_object('planId',s_plan.id,'evidenceSha256',s_evidence.sha256,'actorId',s_actor,
    'signedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',p_key,'operation','sign_bank_inventory','actorId',s_actor));
  s_content:=openerp.canonical(jsonb_build_object('plan',s_plan.body,'signoff',s_body));
  s_bytes:=octet_length(convert_to(s_content,'UTF8'));
  IF s_bytes>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','The signoff artifact exceeds 8 MiB. Nothing was signed.'); END IF;
  INSERT INTO openerp.bank_inventory_signoffs VALUES(s_plan.book_id,s_plan.id,s_evidence.id,s_body,s_content,
    encode(sha256(convert_to(s_content,'UTF8')),'hex'),s_bytes);
  RETURN openerp.save_command(s_plan.book_id,p_key,s_actor,'sign_bank_inventory',s_request,s_body);
END $$;

CREATE FUNCTION openerp.get_bank_inventory_signoff(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_plan openerp.bank_inventory_signoff_plans; s_signed openerp.bank_inventory_signoffs; s_artifact jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO s_plan FROM openerp.bank_inventory_signoff_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank inventory signoff plan was not found in this book.'); END IF;
  SELECT * INTO s_signed FROM openerp.bank_inventory_signoffs s WHERE s.book_id=s_plan.book_id AND s.plan_id=s_plan.id;
  IF FOUND THEN s_artifact:=jsonb_build_object('content',s_signed.content,'sha256',s_signed.sha256,
    'byteLength',s_signed.byte_length,'mediaType','application/json'); END IF;
  RETURN jsonb_build_object('plan',s_plan.body,'signoff',s_signed.body,'signedArtifact',s_artifact,
    'preparedArtifact',jsonb_build_object('content',s_plan.content,'sha256',s_plan.sha256,'byteLength',s_plan.byte_length,'mediaType','application/json'),
    'dependenciesCurrent',openerp.bank_inventory_signoff_current(s_plan.book_id,s_plan.body));
END $$;
CREATE FUNCTION openerp.list_bank_inventory_signoffs(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'inventoryId',p.inventory_id,'periodId',p.body->>'periodId',
    'startsOn',p.body->>'startsOn','endsOn',p.body->>'endsOn','accountCount',jsonb_array_length(p.body->'members'),
    'createdAt',p.body->>'createdAt','digest',p.body->>'digest','signedAt',s.body->>'signedAt')
    ORDER BY p.body->>'createdAt' DESC,p.id COLLATE "C"),'[]') INTO s_items
    FROM openerp.bank_inventory_signoff_plans p LEFT JOIN openerp.bank_inventory_signoffs s
      ON (s.book_id,s.plan_id)=(p.book_id,p.id) WHERE p.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',s_items);
END $$;
REVOKE ALL ON FUNCTION openerp.bank_inventory_signoff_current(text,jsonb),openerp.prepare_bank_inventory_signoff(text,jsonb,text,jsonb),
  openerp.sign_bank_inventory(text,jsonb,text,text,jsonb),openerp.get_bank_inventory_signoff(text,jsonb,text),
  openerp.list_bank_inventory_signoffs(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_bank_inventory_signoff(text,jsonb,text,jsonb),openerp.sign_bank_inventory(text,jsonb,text,text,jsonb),
  openerp.get_bank_inventory_signoff(text,jsonb,text),openerp.list_bank_inventory_signoffs(text,jsonb) TO openerp_runtime;
