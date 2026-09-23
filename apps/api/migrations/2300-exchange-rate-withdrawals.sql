-- Permanent evidence-backed withdrawal. Retained revisions/artifacts are unchanged.
CREATE TABLE openerp.exchange_rate_withdrawals (
  book_id text NOT NULL, observation_id text NOT NULL, id text NOT NULL, revision integer NOT NULL,
  evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,observation_id), UNIQUE(book_id,id),
  FOREIGN KEY(book_id,observation_id,revision) REFERENCES openerp.exchange_rate_revisions,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK(body->>'id' IS NOT DISTINCT FROM id),
  CHECK(body->>'observationId' IS NOT DISTINCT FROM observation_id),
  CHECK(body->'scope'->>'bookId' IS NOT DISTINCT FROM book_id),
  CHECK(body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_exchange_rate_withdrawal BEFORE UPDATE OR DELETE ON openerp.exchange_rate_withdrawals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.exchange_rate_withdrawals FROM PUBLIC,openerp_runtime;

-- Caller holds the book barrier. This reports withdrawal only, not complete conversion readiness.
CREATE FUNCTION openerp.exchange_rate_usability(p_book text,p_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE w_body jsonb;
BEGIN
  SELECT w.body INTO w_body FROM openerp.exchange_rate_withdrawals w
    WHERE w.book_id=p_book AND w.observation_id=p_id;
  RETURN jsonb_build_object('state',CASE WHEN FOUND THEN 'withdrawn' ELSE 'active' END,'withdrawal',w_body);
END $$;
CREATE FUNCTION openerp.exchange_rate_require_active(p_book text,p_id text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.exchange_rate_withdrawals w WHERE w.book_id=p_book AND w.observation_id=p_id) THEN
    PERFORM openerp.fail('StaleDependency','This observation is permanently withdrawn. Recover its history or separately review a new observation; no replacement or reactivation is automatic.');
  END IF;
END $$;
CREATE FUNCTION openerp.withdraw_exchange_rate(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE w_actor text; w_previous jsonb; w_current jsonb; w_evidence openerp.evidence; w_body jsonb;
  w_id text:=openerp.new_id('rate_withdrawal'); w_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  w_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  w_previous:=openerp.replay(p_scope->>'bookId',p_key,w_actor,'withdraw_exchange_rate',w_payload);
  IF w_previous IS NOT NULL THEN RETURN w_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedDigest','evidenceId','rationale']);
  w_current:=openerp.exchange_rate_current(p_scope->>'bookId',p_id);
  IF p_input->>'expectedDigest' IS DISTINCT FROM w_current->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Select the exact current observation revision before withdrawal.'); END IF;
  PERFORM openerp.exchange_rate_require_active(p_scope->>'bookId',p_id);
  IF jsonb_typeof(p_input->'evidenceId') IS DISTINCT FROM 'string' OR p_input->>'evidenceId' !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'rationale')) NOT BETWEEN 1 AND 2000
    OR p_input->>'rationale' IS DISTINCT FROM btrim(p_input->>'rationale') THEN
    PERFORM openerp.fail('InvalidJournal','Supply retained withdrawal evidence and an explicit rationale without surrounding whitespace.'); END IF;
  SELECT * INTO w_evidence FROM openerp.evidence e WHERE e.book_id=p_scope->>'bookId' AND e.id=p_input->>'evidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the withdrawal evidence in this book first.'); END IF;
  w_body:=jsonb_build_object('id',w_id,'scope',p_scope,'observationId',p_id,'revision',w_current->'revision',
    'revisionDigest',w_current->>'digest','input',p_input,'evidenceSha256',w_evidence.sha256,'permanent',true)
    ||openerp.commerce_record_metadata(p_key,'withdraw_exchange_rate',w_actor);
  w_body:=w_body||jsonb_build_object('digest',openerp.digest(w_body));
  INSERT INTO openerp.exchange_rate_withdrawals VALUES(p_scope->>'bookId',p_id,w_id,(w_current->>'revision')::integer,w_evidence.id,w_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,w_actor,'withdraw_exchange_rate',w_payload,w_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.revise_exchange_rate(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_actor text; f_previous jsonb; f_current jsonb; f_body jsonb; f_revision integer;
  f_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  f_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  f_previous:=openerp.replay(p_scope->>'bookId',p_key,f_actor,'revise_exchange_rate',f_payload);
  IF f_previous IS NOT NULL THEN RETURN f_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedDigest','terms']);
  f_current:=openerp.exchange_rate_current(p_scope->>'bookId',p_id);
  PERFORM openerp.exchange_rate_require_active(p_scope->>'bookId',p_id);
  IF p_input->>'expectedDigest' IS DISTINCT FROM f_current->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Review the current rate revision before revising.'); END IF;
  f_revision:=(f_current->>'revision')::integer+1;
  IF f_revision>20 THEN PERFORM openerp.fail('UnsupportedProfile','This observation reached its20-revision limit.'); END IF;
  f_body:=openerp.exchange_rate_revision_body(p_scope,p_id,f_current->>'sourceKey',f_revision,f_current->>'digest',p_input->'terms',f_actor,p_key,'revise_exchange_rate');
  INSERT INTO openerp.exchange_rate_revisions VALUES(p_scope->>'bookId',p_id,f_revision,p_input->'terms'->>'evidenceId',p_input->'terms'->>'reviewEvidenceId',f_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,f_actor,'revise_exchange_rate',f_payload,f_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.capture_conversion_review(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_actor text; f_previous jsonb; f_book openerp.books; f_rate jsonb; f_basis jsonb; f_evidence openerp.evidence;
  f_field text; f_n numeric; f_d numeric; f_q numeric; f_r numeric; f_rounded numeric; f_body jsonb;
  f_id text:=openerp.new_id('conversion'); f_content text; f_hash text; f_bytes integer;
BEGIN
  f_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT f_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  f_previous:=openerp.replay(f_book.id,p_key,f_actor,'capture_conversion_review',p_input);
  IF f_previous IS NOT NULL THEN RETURN f_previous; END IF;
  IF f_book.profile<>'synthetic-core-v1' OR f_book.authority<>'native' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only native synthetic conversion review is supported. No FX posting is available.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['observationId','revisionDigest','conversionDate','fromCurrency',
    'sourceScale','originalMinor','roundingPolicy','evidenceId','sourceLocator','rationale']);
  IF p_input->>'roundingPolicy' IS DISTINCT FROM 'synthetic_half_up_nonnegative_v1'
    OR jsonb_typeof(p_input->'sourceScale') IS DISTINCT FROM 'number' OR p_input->>'sourceScale' !~ '^[0-6]$'
    OR jsonb_typeof(p_input->'originalMinor') IS DISTINCT FROM 'string' OR p_input->>'originalMinor' !~ '^(0|[1-9][0-9]{0,37})$'
    OR jsonb_typeof(p_input->'fromCurrency') IS DISTINCT FROM 'string' OR p_input->>'fromCurrency' !~ '^[A-Z]{3}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a nonnegative exact minor-unit amount, explicit scale0–6, source currency and the named synthetic rounding policy.'); END IF;
  FOREACH f_field IN ARRAY ARRAY['observationId','evidenceId'] LOOP
    IF jsonb_typeof(p_input->f_field) IS DISTINCT FROM 'string' OR p_input->>f_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Use retained rate and original-amount evidence identifiers.'); END IF;
  END LOOP;
  FOREACH f_field IN ARRAY ARRAY['sourceLocator','rationale'] LOOP
    IF jsonb_typeof(p_input->f_field) IS DISTINCT FROM 'string' OR length(btrim(p_input->>f_field)) NOT BETWEEN 1 AND 2000
      OR p_input->>f_field IS DISTINCT FROM btrim(p_input->>f_field) THEN
      PERFORM openerp.fail('InvalidJournal','Retain the original amount source locator and calculation rationale.'); END IF;
  END LOOP;
  IF length(p_input->>'sourceLocator')>256 OR jsonb_typeof(p_input->'conversionDate') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a conversion date and a source locator of at most256 characters.'); END IF;
  PERFORM openerp.bank_date(p_input->>'conversionDate');
  f_rate:=openerp.exchange_rate_current(f_book.id,p_input->>'observationId');
  PERFORM openerp.exchange_rate_require_active(f_book.id,p_input->>'observationId');
  IF p_input->>'revisionDigest' IS DISTINCT FROM f_rate->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Select the exact current rate revision. Superseded rates cannot create a new review.'); END IF;
  IF p_input->>'conversionDate' IS DISTINCT FROM f_rate->'terms'->>'effectiveOn'
    OR p_input->>'fromCurrency' IS DISTINCT FROM f_rate->'terms'->>'fromCurrency'
    OR f_book.currency IS DISTINCT FROM f_rate->'terms'->>'toCurrency' THEN
    PERFORM openerp.fail('StaleDependency','Rate direction, book currency and exact effective date must match. No nearby date, inversion or rate1 fallback is supported.'); END IF;
  SELECT * INTO f_evidence FROM openerp.evidence e WHERE e.book_id=f_book.id AND e.id=p_input->>'evidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the original amount evidence in this book.'); END IF;
  IF (SELECT count(*) FROM openerp.exchange_conversion_reviews r WHERE r.book_id=f_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book reached its200-conversion-review limit.'); END IF;
  -- All operands are exact integers. The rate is target major units / source major unit.
  f_n:=(p_input->>'originalMinor')::numeric*(f_rate->'terms'->>'rateNumerator')::numeric*('1'||repeat('0',f_book.currency_scale))::numeric;
  f_d:=(f_rate->'terms'->>'rateDenominator')::numeric*('1'||repeat('0',(p_input->>'sourceScale')::integer))::numeric;
  f_q:=div(f_n,f_d); f_r:=mod(f_n,f_d);
  f_rounded:=f_q+CASE WHEN 2*f_r>=f_d THEN 1 ELSE 0 END;
  IF f_rounded>=1e38::numeric THEN PERFORM openerp.fail('InvalidJournal','The rounded book amount exceeds the supported38-digit minor-unit bound.'); END IF;
  f_basis:=openerp.exchange_rate_book_basis(f_book.id);
  f_body:=jsonb_build_object('id',f_id,'scope',p_scope,'kind','synthetic_exchange_conversion_v1','input',p_input,
    'sourceSha256',f_evidence.sha256,'rate',f_rate,'bookBasis',f_basis,
    'calculation',jsonb_build_object('exactNumerator',trunc(f_n)::text,'exactDenominator',trunc(f_d)::text,
      'quotientMinor',trunc(f_q)::text,'remainderNumerator',trunc(f_r)::text,'roundedMinor',trunc(f_rounded)::text,
      'residualNumerator',trunc(f_n-f_rounded*f_d)::text,'residualDenominator',trunc(f_d)::text),
    'formula','N = originalMinor * rateNumerator * 10^bookScale; D = rateDenominator * 10^sourceScale; rounded = div(N,D) + (2*mod(N,D) >= D ? 1 : 0); residualNumerator = N - rounded*D; residualDenominator = D',
    'legalPolicyApproved',false,'postingSupported',false,'financialCloseReady',false)
    ||openerp.commerce_record_metadata(p_key,'capture_conversion_review',f_actor);
  f_body:=f_body||jsonb_build_object('digest',openerp.digest(f_body));
  f_content:=openerp.canonical(f_body);
  f_bytes:=octet_length(convert_to(f_content,'UTF8'));
  IF f_bytes>1048576 THEN PERFORM openerp.fail('UnsupportedProfile','The conversion artifact exceeds1MiB. Nothing was retained.'); END IF;
  f_hash:=encode(sha256(convert_to(f_content,'UTF8')),'hex');
  INSERT INTO openerp.exchange_conversion_reviews VALUES(f_book.id,f_id,p_input->>'observationId',(f_rate->>'revision')::integer,
    f_evidence.id,f_body,f_content,f_hash,f_bytes);
  RETURN openerp.save_command(f_book.id,p_key,f_actor,'capture_conversion_review',p_input,f_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_exchange_rate(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_current jsonb; f_revisions jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  f_current:=openerp.exchange_rate_current(p_scope->>'bookId',p_id);
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO f_revisions FROM openerp.exchange_rate_revisions r
    WHERE r.book_id=p_scope->>'bookId' AND r.observation_id=p_id;
  RETURN jsonb_build_object('current',f_current,'revisions',f_revisions,'usability',openerp.exchange_rate_usability(p_scope->>'bookId',p_id));
END $$;

CREATE OR REPLACE FUNCTION openerp.list_exchange_rates(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_items jsonb; f_statuses jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(openerp.exchange_rate_current(p_scope->>'bookId',r.id) ORDER BY r.source_key COLLATE "C"),'[]') INTO f_items
    FROM openerp.exchange_rate_observations r WHERE r.book_id=p_scope->>'bookId';
  SELECT coalesce(jsonb_agg(jsonb_build_object('observationId',r.id,'usability',openerp.exchange_rate_usability(p_scope->>'bookId',r.id)) ORDER BY r.source_key COLLATE "C"),'[]') INTO f_statuses
    FROM openerp.exchange_rate_observations r WHERE r.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',f_items,'statuses',f_statuses);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_conversion_review(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_saved openerp.exchange_conversion_reviews; f_rate jsonb; f_basis jsonb; f_usability jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO f_saved FROM openerp.exchange_conversion_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The conversion review was not found in this book.'); END IF;
  f_rate:=openerp.exchange_rate_current(p_scope->>'bookId',f_saved.observation_id);
  f_basis:=openerp.exchange_rate_book_basis(p_scope->>'bookId');
  f_usability:=openerp.exchange_rate_usability(p_scope->>'bookId',f_saved.observation_id);
  RETURN jsonb_build_object('review',f_saved.body,'rateUsability',f_usability,
    'dependenciesCurrent',coalesce(f_usability->>'state'='active' AND f_saved.body->'rate'->>'digest'=f_rate->>'digest' AND f_saved.body->'bookBasis'=f_basis,false),
    'artifact',jsonb_build_object('content',f_saved.content,'sha256',f_saved.sha256,'byteLength',f_saved.byte_length,'mediaType','application/json'));
END $$;

REVOKE ALL ON FUNCTION openerp.exchange_rate_usability(text,text),openerp.exchange_rate_require_active(text,text),
  openerp.withdraw_exchange_rate(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.withdraw_exchange_rate(text,jsonb,text,text,jsonb) TO openerp_runtime;
