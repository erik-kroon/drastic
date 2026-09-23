-- Manual evidence-backed synthetic rates and exact review artifacts. No FX posting.
CREATE TABLE openerp.exchange_rate_observations (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, source_key text NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,source_key)
);
CREATE TABLE openerp.exchange_rate_revisions (
  book_id text NOT NULL, observation_id text NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 20),
  evidence_id text NOT NULL, review_evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,observation_id,revision),
  FOREIGN KEY(book_id,observation_id) REFERENCES openerp.exchange_rate_observations,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  FOREIGN KEY(book_id,review_evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.exchange_conversion_reviews (
  book_id text NOT NULL, id text NOT NULL, observation_id text NOT NULL, revision integer NOT NULL,
  evidence_id text NOT NULL, body jsonb NOT NULL, content text NOT NULL,
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 1048576),
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,observation_id,revision) REFERENCES openerp.exchange_rate_revisions,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TRIGGER immutable_exchange_observation BEFORE UPDATE OR DELETE ON openerp.exchange_rate_observations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_exchange_revision BEFORE UPDATE OR DELETE ON openerp.exchange_rate_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_conversion_review BEFORE UPDATE OR DELETE ON openerp.exchange_conversion_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.exchange_rate_current(p_book text,p_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE f_body jsonb;
BEGIN
  SELECT r.body INTO f_body FROM openerp.exchange_rate_revisions r
    WHERE r.book_id=p_book AND r.observation_id=p_id ORDER BY r.revision DESC LIMIT 1;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The exchange-rate observation was not found in this book.'); END IF;
  RETURN f_body;
END $$;
CREATE FUNCTION openerp.exchange_rate_book_basis(p_book text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT jsonb_build_object('currency',b.currency,'currencyScale',b.currency_scale,'profile',b.profile,
    'profileVersion',b.profile_version::text,'writerAuthority',b.authority,'writerEpoch',b.writer_epoch::text)
  FROM openerp.books b WHERE b.id=p_book
$$;
CREATE FUNCTION openerp.exchange_rate_revision_body(p_scope jsonb,p_id text,p_source text,p_revision integer,
  p_previous text,p_terms jsonb,p_actor text,p_key text,p_operation text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE f_book openerp.books; f_field text; f_evidence openerp.evidence; f_review openerp.evidence; f_body jsonb;
BEGIN
  SELECT * INTO STRICT f_book FROM openerp.books b WHERE b.id=p_scope->>'bookId';
  IF f_book.profile<>'synthetic-core-v1' OR f_book.authority<>'native' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only explicit native synthetic exchange-rate review is supported.'); END IF;
  PERFORM openerp.commerce_exact_object(p_terms,ARRAY['fromCurrency','toCurrency','effectiveOn','retrievedOn',
    'rateNumerator','rateDenominator','evidenceId','sourceLocator','reviewEvidenceId','rationale']);
  FOREACH f_field IN ARRAY ARRAY['fromCurrency','toCurrency'] LOOP
    IF jsonb_typeof(p_terms->f_field) IS DISTINCT FROM 'string' OR p_terms->>f_field !~ '^[A-Z]{3}$' THEN
      PERFORM openerp.fail('InvalidJournal','Use explicit three-letter uppercase currency codes.'); END IF;
  END LOOP;
  IF p_terms->>'fromCurrency'=p_terms->>'toCurrency' OR p_terms->>'toCurrency'<>f_book.currency THEN
    PERFORM openerp.fail('UnsupportedProfile','The directional rate must convert a different source currency into this book currency. No inversion is inferred.'); END IF;
  FOREACH f_field IN ARRAY ARRAY['rateNumerator','rateDenominator'] LOOP
    IF jsonb_typeof(p_terms->f_field) IS DISTINCT FROM 'string' OR p_terms->>f_field !~ '^[1-9][0-9]{0,37}$' THEN
      PERFORM openerp.fail('InvalidJournal','Rate numerator and denominator must be positive canonical integers of at most38 digits.'); END IF;
  END LOOP;
  FOREACH f_field IN ARRAY ARRAY['effectiveOn','retrievedOn'] LOOP
    IF jsonb_typeof(p_terms->f_field) IS DISTINCT FROM 'string' THEN
      PERFORM openerp.fail('InvalidJournal','Supply explicit effective and source retrieval dates.'); END IF;
    PERFORM openerp.bank_date(p_terms->>f_field);
  END LOOP;
  FOREACH f_field IN ARRAY ARRAY['evidenceId','reviewEvidenceId'] LOOP
    IF jsonb_typeof(p_terms->f_field) IS DISTINCT FROM 'string' OR p_terms->>f_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Use retained source and review evidence identifiers.'); END IF;
  END LOOP;
  FOREACH f_field IN ARRAY ARRAY['sourceLocator','rationale'] LOOP
    IF jsonb_typeof(p_terms->f_field) IS DISTINCT FROM 'string'
      OR length(btrim(p_terms->>f_field)) NOT BETWEEN 1 AND 2000
      OR p_terms->>f_field IS DISTINCT FROM btrim(p_terms->>f_field) THEN
      PERFORM openerp.fail('InvalidJournal','Retain a source locator and review rationale without surrounding whitespace.'); END IF;
  END LOOP;
  IF length(p_terms->>'sourceLocator')>256 THEN PERFORM openerp.fail('InvalidJournal','Source locators support at most256 characters.'); END IF;
  SELECT * INTO f_evidence FROM openerp.evidence e WHERE e.book_id=f_book.id AND e.id=p_terms->>'evidenceId';
  SELECT * INTO f_review FROM openerp.evidence e WHERE e.book_id=f_book.id AND e.id=p_terms->>'reviewEvidenceId';
  IF f_evidence.id IS NULL OR f_review.id IS NULL THEN
    PERFORM openerp.fail('MissingEvidence','Retain rate source and review evidence in this book first.'); END IF;
  f_body:=jsonb_build_object('observationId',p_id,'sourceKey',p_source,'revision',p_revision,'scope',p_scope,
    'terms',p_terms,'direction','target_major_units_per_source_major_unit','sourceSha256',f_evidence.sha256,
    'reviewSha256',f_review.sha256,'previousDigest',p_previous,'legalPolicyApproved',false)
    ||openerp.commerce_record_metadata(p_key,p_operation,p_actor);
  RETURN f_body||jsonb_build_object('digest',openerp.digest(f_body));
END $$;

CREATE FUNCTION openerp.create_exchange_rate(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_actor text; f_previous jsonb; f_id text:=openerp.new_id('rate'); f_body jsonb;
BEGIN
  f_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  f_previous:=openerp.replay(p_scope->>'bookId',p_key,f_actor,'create_exchange_rate',p_input);
  IF f_previous IS NOT NULL THEN RETURN f_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['sourceKey','terms']);
  IF jsonb_typeof(p_input->'sourceKey') IS DISTINCT FROM 'string' OR p_input->>'sourceKey' !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a stable observation source key.'); END IF;
  IF EXISTS(SELECT FROM openerp.exchange_rate_observations r WHERE r.book_id=p_scope->>'bookId' AND r.source_key=p_input->>'sourceKey') THEN
    PERFORM openerp.fail('IdempotencyConflict','This rate source key already exists. Recover or revise the retained observation.'); END IF;
  IF (SELECT count(*) FROM openerp.exchange_rate_observations r WHERE r.book_id=p_scope->>'bookId')>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book reached its200-observation limit.'); END IF;
  f_body:=openerp.exchange_rate_revision_body(p_scope,f_id,p_input->>'sourceKey',1,NULL,p_input->'terms',f_actor,p_key,'create_exchange_rate');
  INSERT INTO openerp.exchange_rate_observations VALUES(p_scope->>'bookId',f_id,p_input->>'sourceKey');
  INSERT INTO openerp.exchange_rate_revisions VALUES(p_scope->>'bookId',f_id,1,p_input->'terms'->>'evidenceId',p_input->'terms'->>'reviewEvidenceId',f_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,f_actor,'create_exchange_rate',p_input,f_body);
END $$;
CREATE FUNCTION openerp.revise_exchange_rate(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
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
  IF p_input->>'expectedDigest' IS DISTINCT FROM f_current->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Review the current rate revision before revising.'); END IF;
  f_revision:=(f_current->>'revision')::integer+1;
  IF f_revision>20 THEN PERFORM openerp.fail('UnsupportedProfile','This observation reached its20-revision limit.'); END IF;
  f_body:=openerp.exchange_rate_revision_body(p_scope,p_id,f_current->>'sourceKey',f_revision,f_current->>'digest',p_input->'terms',f_actor,p_key,'revise_exchange_rate');
  INSERT INTO openerp.exchange_rate_revisions VALUES(p_scope->>'bookId',p_id,f_revision,p_input->'terms'->>'evidenceId',p_input->'terms'->>'reviewEvidenceId',f_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,f_actor,'revise_exchange_rate',f_payload,f_body);
END $$;
CREATE FUNCTION openerp.get_exchange_rate(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_current jsonb; f_revisions jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  f_current:=openerp.exchange_rate_current(p_scope->>'bookId',p_id);
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO f_revisions FROM openerp.exchange_rate_revisions r
    WHERE r.book_id=p_scope->>'bookId' AND r.observation_id=p_id;
  RETURN jsonb_build_object('current',f_current,'revisions',f_revisions);
END $$;
CREATE FUNCTION openerp.list_exchange_rates(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(openerp.exchange_rate_current(p_scope->>'bookId',r.id) ORDER BY r.source_key COLLATE "C"),'[]') INTO f_items
    FROM openerp.exchange_rate_observations r WHERE r.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',f_items);
END $$;

CREATE FUNCTION openerp.capture_conversion_review(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
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
CREATE FUNCTION openerp.get_conversion_review(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_saved openerp.exchange_conversion_reviews; f_rate jsonb; f_basis jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO f_saved FROM openerp.exchange_conversion_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The conversion review was not found in this book.'); END IF;
  f_rate:=openerp.exchange_rate_current(p_scope->>'bookId',f_saved.observation_id);
  f_basis:=openerp.exchange_rate_book_basis(p_scope->>'bookId');
  RETURN jsonb_build_object('review',f_saved.body,
    'dependenciesCurrent',coalesce(f_saved.body->'rate'->>'digest'=f_rate->>'digest' AND f_saved.body->'bookBasis'=f_basis,false),
    'artifact',jsonb_build_object('content',f_saved.content,'sha256',f_saved.sha256,'byteLength',f_saved.byte_length,'mediaType','application/json'));
END $$;
CREATE FUNCTION openerp.list_conversion_reviews(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE f_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'observationId',r.observation_id,
    'revisionDigest',r.body->'rate'->>'digest','conversionDate',r.body->'input'->>'conversionDate',
    'fromCurrency',r.body->'input'->>'fromCurrency','originalMinor',r.body->'input'->>'originalMinor',
    'sourceScale',r.body->'input'->'sourceScale','roundedMinor',r.body->'calculation'->>'roundedMinor',
    'bookCurrency',r.body->'bookBasis'->>'currency','bookScale',r.body->'bookBasis'->'currencyScale',
    'createdAt',r.body->>'createdAt','digest',r.body->>'digest') ORDER BY r.id COLLATE "C"),'[]') INTO f_items
    FROM openerp.exchange_conversion_reviews r WHERE r.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',f_items);
END $$;

REVOKE ALL ON openerp.exchange_rate_observations,openerp.exchange_rate_revisions,openerp.exchange_conversion_reviews FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.exchange_rate_current(text,text),openerp.exchange_rate_book_basis(text),
  openerp.exchange_rate_revision_body(jsonb,text,text,integer,text,jsonb,text,text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.create_exchange_rate(text,jsonb,text,jsonb),openerp.revise_exchange_rate(text,jsonb,text,text,jsonb),
  openerp.get_exchange_rate(text,jsonb,text),openerp.list_exchange_rates(text,jsonb),openerp.capture_conversion_review(text,jsonb,text,jsonb),
  openerp.get_conversion_review(text,jsonb,text),openerp.list_conversion_reviews(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.create_exchange_rate(text,jsonb,text,jsonb),openerp.revise_exchange_rate(text,jsonb,text,text,jsonb),
  openerp.get_exchange_rate(text,jsonb,text),openerp.list_exchange_rates(text,jsonb),openerp.capture_conversion_review(text,jsonb,text,jsonb),
  openerp.get_conversion_review(text,jsonb,text),openerp.list_conversion_reviews(text,jsonb) TO openerp_runtime;
