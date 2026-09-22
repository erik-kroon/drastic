-- Expense tax evidence/review only. No tax profile activation, invoice issuance or ledger writes.
CREATE TABLE openerp.expense_tax_sources (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, source_key text NOT NULL,
  record_class text NOT NULL CHECK(record_class IN ('actual_company','synthetic')),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,source_key)
);
CREATE TABLE openerp.expense_tax_source_revisions (
  book_id text NOT NULL, source_id text NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 20),
  id text NOT NULL, evidence_id text NOT NULL, change_set_id text, voucher_id text, body jsonb NOT NULL,
  PRIMARY KEY(book_id,source_id,revision), UNIQUE(book_id,id),
  FOREIGN KEY(book_id,source_id) REFERENCES openerp.expense_tax_sources,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers
);
CREATE TABLE openerp.expense_tax_reviews (
  book_id text NOT NULL, source_id text NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 100),
  source_revision integer NOT NULL, id text NOT NULL, evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,source_id,revision), UNIQUE(book_id,id),
  FOREIGN KEY(book_id,source_id,source_revision) REFERENCES openerp.expense_tax_source_revisions,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.expense_tax_snapshots (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, ordinal bigint NOT NULL CHECK(ordinal BETWEEN 1 AND 999999999999999999),
  body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,ordinal)
);
CREATE TRIGGER immutable_expense_tax_source BEFORE UPDATE OR DELETE ON openerp.expense_tax_sources FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_source_revision BEFORE UPDATE OR DELETE ON openerp.expense_tax_source_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_review BEFORE UPDATE OR DELETE ON openerp.expense_tax_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_snapshot BEFORE UPDATE OR DELETE ON openerp.expense_tax_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.expense_tax_shape(value jsonb, fields text[]) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Supply an expense tax object with explicit unknown values.'); END IF;
  IF value-fields<>'{}'::jsonb OR NOT value ?& fields THEN
    PERFORM openerp.fail('InvalidJournal','Unknown fields are refused. Use explicit null values for unknown expense tax facts.'); END IF;
END $$;
CREATE FUNCTION openerp.expense_tax_minor(value jsonb, positive boolean DEFAULT false) RETURNS numeric LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE et_text text;
BEGIN
  IF value='null'::jsonb THEN RETURN NULL; END IF;
  et_text:=value#>>'{}';
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR coalesce(et_text,'') !~ '^(0|[1-9][0-9]{0,37})$'
    OR (positive AND et_text='0') THEN
    PERFORM openerp.fail('InvalidJournal','Use canonical nonnegative integer minor units; denominators must be positive.'); END IF;
  RETURN et_text::numeric;
END $$;
CREATE FUNCTION openerp.expense_tax_date(value jsonb) RETURNS date LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF value='null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' THEN PERFORM openerp.fail('InvalidJournal','Use a real calendar date or explicit null.'); END IF;
  RETURN openerp.bank_date(value#>>'{}');
END $$;
CREATE FUNCTION openerp.expense_tax_amounts(value jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, openerp AS $$
BEGIN
  PERFORM openerp.expense_tax_shape(value,ARRAY['grossMinor','netMinor','vatMinor']);
  PERFORM openerp.expense_tax_minor(value->'grossMinor');
  PERFORM openerp.expense_tax_minor(value->'netMinor');
  PERFORM openerp.expense_tax_minor(value->'vatMinor');
END $$;
CREATE FUNCTION openerp.expense_tax_current(book text, source_id text) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE et_body jsonb;
BEGIN
  SELECT r.body INTO et_body FROM openerp.expense_tax_source_revisions r
    WHERE r.book_id=book AND r.source_id=expense_tax_current.source_id ORDER BY r.revision DESC LIMIT 1;
  IF et_body IS NULL THEN PERFORM openerp.fail('NotFound','The expense source is not retained in this book.'); END IF;
  RETURN et_body;
END $$;
CREATE FUNCTION openerp.expense_tax_latest_review(book text, source_id text) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT r.body FROM openerp.expense_tax_reviews r WHERE r.book_id=book AND r.source_id=expense_tax_latest_review.source_id ORDER BY r.revision DESC LIMIT 1
$$;
CREATE FUNCTION openerp.expense_tax_basis(book text) RETURNS text LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT openerp.digest(jsonb_build_object('bookId',book,'currency',b.currency,'currencyScale',b.currency_scale,'profile',b.profile,'profileVersion',b.profile_version::text,
    'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'sourceDigest',r.body->>'digest','reviewDigest',openerp.expense_tax_latest_review(book,s.id)->>'digest') ORDER BY s.id COLLATE "C")
      FROM openerp.expense_tax_sources s JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_source_revisions x
        WHERE x.book_id=book AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true WHERE s.book_id=book),'[]')))
  FROM openerp.books b WHERE b.id=book
$$;

CREATE FUNCTION openerp.record_expense_tax_source(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_actor text; et_previous jsonb; et_current jsonb; et_source openerp.expense_tax_sources;
  et_facts jsonb; et_field text; et_sha text; et_revision integer; et_body jsonb; et_reference jsonb;
BEGIN
  et_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  et_previous:=openerp.replay(scope->>'bookId',key,et_actor,'record_expense_tax_source',input);
  IF et_previous IS NOT NULL THEN RETURN et_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['sourceKey','expectedSourceDigest','facts']);
  IF jsonb_typeof(input->'sourceKey') IS DISTINCT FROM 'string' OR coalesce(input->>'sourceKey','') !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a stable key for one expense source component.'); END IF;
  et_facts:=input->'facts';
  PERFORM openerp.expense_tax_shape(et_facts,ARRAY['evidenceId','sourceLocator','description','recordClass','amounts','currency','currencyScale',
    'supplierJurisdiction','supplyJurisdiction','issuedOn','receivedOn','suppliedOn','taxPointOn','changeSetId','voucherId']);
  FOREACH et_field IN ARRAY ARRAY['evidenceId','sourceLocator','description','recordClass'] LOOP
    IF jsonb_typeof(et_facts->et_field) IS DISTINCT FROM 'string' OR length(et_facts->>et_field) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal','Supply source evidence, locator, description and record class.'); END IF;
  END LOOP;
  IF et_facts->>'recordClass' NOT IN ('actual_company','synthetic') OR et_facts->>'evidenceId' !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Select actual-company observations or a synthetic demonstration explicitly.'); END IF;
  PERFORM openerp.expense_tax_amounts(et_facts->'amounts');
  IF et_facts->'currency'<>'null'::jsonb AND (jsonb_typeof(et_facts->'currency')<>'string' OR et_facts->>'currency' !~ '^[A-Z]{3}$') THEN
    PERFORM openerp.fail('InvalidJournal','Use an explicit three-letter currency or null.'); END IF;
  IF et_facts->'currencyScale'<>'null'::jsonb AND (jsonb_typeof(et_facts->'currencyScale')<>'number' OR et_facts->>'currencyScale' !~ '^[0-6]$') THEN
    PERFORM openerp.fail('InvalidJournal','Use an explicit currency scale from 0 to 6 or null.'); END IF;
  FOREACH et_field IN ARRAY ARRAY['supplierJurisdiction','supplyJurisdiction'] LOOP
    IF et_facts->et_field<>'null'::jsonb AND (jsonb_typeof(et_facts->et_field)<>'string' OR et_facts->>et_field !~ '^[A-Z]{2}$') THEN
      PERFORM openerp.fail('InvalidJournal','Use an explicit two-letter jurisdiction code or null.'); END IF;
  END LOOP;
  FOREACH et_field IN ARRAY ARRAY['issuedOn','receivedOn','suppliedOn','taxPointOn'] LOOP PERFORM openerp.expense_tax_date(et_facts->et_field); END LOOP;
  SELECT e.sha256 INTO et_sha FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=et_facts->>'evidenceId';
  IF et_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain source evidence in this book first.'); END IF;
  FOREACH et_field IN ARRAY ARRAY['changeSetId','voucherId'] LOOP
    IF et_facts->et_field<>'null'::jsonb AND (jsonb_typeof(et_facts->et_field)<>'string' OR et_facts->>et_field !~ '^[a-z][a-z0-9_-]{2,127}$') THEN
      PERFORM openerp.fail('InvalidJournal','Use a scoped proposal/voucher identifier or null.'); END IF;
  END LOOP;
  IF et_facts->>'changeSetId' IS NOT NULL THEN
    SELECT c.plan INTO et_reference FROM openerp.change_sets c WHERE c.book_id=scope->>'bookId' AND c.id=et_facts->>'changeSetId';
    IF et_reference IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(et_reference->'groups') g
      CROSS JOIN LATERAL jsonb_array_elements(g->'actions') a CROSS JOIN LATERAL jsonb_array_elements(a->'evidenceRefs') e
      WHERE e->>'evidenceId'=et_facts->>'evidenceId') THEN
      PERFORM openerp.fail('MissingEvidence','The proposal must exist in this book and cite the retained source evidence.'); END IF;
  END IF;
  IF et_facts->>'voucherId' IS NOT NULL THEN
    SELECT v.action INTO et_reference FROM openerp.vouchers v WHERE v.book_id=scope->>'bookId' AND v.id=et_facts->>'voucherId'
      AND (et_facts->>'changeSetId' IS NULL OR v.change_set_id=et_facts->>'changeSetId');
    IF et_reference IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(et_reference->'evidenceRefs') e WHERE e->>'evidenceId'=et_facts->>'evidenceId') THEN
      PERFORM openerp.fail('MissingEvidence','The voucher must agree with the proposal reference and cite this source evidence in this book.'); END IF;
  END IF;
  SELECT * INTO et_source FROM openerp.expense_tax_sources s WHERE s.book_id=scope->>'bookId' AND s.source_key=input->>'sourceKey';
  IF FOUND THEN
    et_current:=openerp.expense_tax_current(scope->>'bookId',et_source.id);
    IF input->>'expectedSourceDigest' IS DISTINCT FROM et_current->>'digest' THEN
      PERFORM openerp.fail('StaleDependency','Review the current expense source digest before appending a revision.'); END IF;
    IF et_source.record_class<>et_facts->>'recordClass' THEN PERFORM openerp.fail('InvalidJournal','Actual and synthetic source classes cannot be changed between revisions.'); END IF;
    et_revision:=(et_current->>'revision')::integer+1;
    IF et_revision>20 THEN PERFORM openerp.fail('UnsupportedProfile','This source reached its 20 retained revision limit.'); END IF;
  ELSE
    IF input->'expectedSourceDigest'<>'null'::jsonb THEN PERFORM openerp.fail('StaleDependency','A new source must not claim an existing digest.'); END IF;
    IF (SELECT count(*) FROM openerp.expense_tax_sources s WHERE s.book_id=scope->>'bookId')>=200 THEN
      PERFORM openerp.fail('UnsupportedProfile','This bounded review inventory supports at most 200 source components. No source was dropped.'); END IF;
    INSERT INTO openerp.expense_tax_sources VALUES(scope->>'bookId',openerp.new_id('taxsource'),input->>'sourceKey',et_facts->>'recordClass') RETURNING * INTO et_source;
    et_revision:=1;
  END IF;
  et_body:=jsonb_build_object('id',openerp.new_id('taxsourceversion'),'sourceId',et_source.id,'sourceKey',et_source.source_key,
    'revision',et_revision,'previousDigest',et_current->>'digest','scope',scope,'facts',et_facts,'evidenceSha256',et_sha,
    'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','record_expense_tax_source','actorId',et_actor));
  et_body:=et_body||jsonb_build_object('digest',openerp.digest(et_body));
  INSERT INTO openerp.expense_tax_source_revisions VALUES(scope->>'bookId',et_source.id,et_revision,et_body->>'id',et_facts->>'evidenceId',et_facts->>'changeSetId',et_facts->>'voucherId',et_body);
  RETURN openerp.save_command(scope->>'bookId',key,et_actor,'record_expense_tax_source',input,et_body);
END $$;

CREATE FUNCTION openerp.review_expense_tax_source(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_actor text; et_previous jsonb; et_source jsonb; et_review jsonb; et_facts jsonb; et_field text;
  et_revision integer; et_refs jsonb; et_body jsonb; et_payload jsonb:=jsonb_build_object('id',id,'input',input);
BEGIN
  et_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  et_previous:=openerp.replay(scope->>'bookId',key,et_actor,'review_expense_tax_source',et_payload);
  IF et_previous IS NOT NULL THEN RETURN et_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['sourceDigest','expectedReviewDigest','facts']);
  et_source:=openerp.expense_tax_current(scope->>'bookId',id);
  et_review:=openerp.expense_tax_latest_review(scope->>'bookId',id);
  IF input->>'sourceDigest' IS DISTINCT FROM et_source->>'digest' OR input->>'expectedReviewDigest' IS DISTINCT FROM et_review->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','The source or prior review changed. Reload and review the current immutable revisions.'); END IF;
  et_facts:=input->'facts';
  PERFORM openerp.expense_tax_shape(et_facts,ARRAY['evidenceId','rationale','amounts','registration','registrationEvidenceId','method','methodEvidenceId',
    'bookJurisdiction','suppliedOn','taxPointOn','dateBasis','dateEvidenceId','treatment','profileId','profileVersion',
    'rateNumerator','rateDenominator','deductionNumerator','deductionDenominator','deductionBasis','deductionEvidenceId','roundingPolicy']);
  FOREACH et_field IN ARRAY ARRAY['evidenceId','rationale','registration','method','treatment','roundingPolicy'] LOOP
    IF jsonb_typeof(et_facts->et_field) IS DISTINCT FROM 'string' OR length(et_facts->>et_field) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal','Supply reviewer evidence, rationale and explicit known/unknown decisions.'); END IF;
  END LOOP;
  IF et_facts->>'registration' NOT IN ('unknown','registered','not_registered') OR et_facts->>'method' NOT IN ('unknown','accrual','cash')
    OR et_facts->>'treatment' NOT IN ('unknown','domestic_purchase','foreign_purchase','reverse_charge','import','exempt','out_of_scope','other')
    OR et_facts->>'roundingPolicy' NOT IN ('unknown','exact_only') THEN
    PERFORM openerp.fail('InvalidJournal','Choose explicit review states; unsupported treatments remain recorded but excluded.'); END IF;
  PERFORM openerp.expense_tax_amounts(et_facts->'amounts');
  FOREACH et_field IN ARRAY ARRAY['dateBasis','profileId','profileVersion','deductionBasis'] LOOP
    IF et_facts->et_field<>'null'::jsonb AND (jsonb_typeof(et_facts->et_field)<>'string' OR length(et_facts->>et_field) NOT BETWEEN 1 AND 2000) THEN
      PERFORM openerp.fail('InvalidJournal','Review basis/profile fields must be nonempty text or null.'); END IF;
  END LOOP;
  IF et_facts->'bookJurisdiction'<>'null'::jsonb AND (jsonb_typeof(et_facts->'bookJurisdiction')<>'string' OR et_facts->>'bookJurisdiction' !~ '^[A-Z]{2}$') THEN
    PERFORM openerp.fail('InvalidJournal','Use a two-letter book jurisdiction code or null.'); END IF;
  PERFORM openerp.expense_tax_date(et_facts->'suppliedOn'); PERFORM openerp.expense_tax_date(et_facts->'taxPointOn');
  PERFORM openerp.expense_tax_minor(et_facts->'rateNumerator'); PERFORM openerp.expense_tax_minor(et_facts->'rateDenominator',true);
  PERFORM openerp.expense_tax_minor(et_facts->'deductionNumerator'); PERFORM openerp.expense_tax_minor(et_facts->'deductionDenominator',true);
  FOREACH et_field IN ARRAY ARRAY['evidenceId','registrationEvidenceId','methodEvidenceId','dateEvidenceId','deductionEvidenceId'] LOOP
    IF et_facts->>et_field IS NOT NULL THEN
      IF jsonb_typeof(et_facts->et_field)<>'string' OR et_facts->>et_field !~ '^[a-z][a-z0-9_-]{2,127}$'
        OR NOT EXISTS(SELECT FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=et_facts->>et_field) THEN
        PERFORM openerp.fail('MissingEvidence','Every supplied review-basis evidence reference must be retained in this book.'); END IF;
    END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('evidenceId',e.id,'sha256',e.sha256) ORDER BY e.id COLLATE "C") INTO et_refs
    FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id IN(et_facts->>'evidenceId',et_facts->>'registrationEvidenceId',
      et_facts->>'methodEvidenceId',et_facts->>'dateEvidenceId',et_facts->>'deductionEvidenceId');
  et_revision:=coalesce((et_review->>'revision')::integer,0)+1;
  IF et_revision>100 THEN PERFORM openerp.fail('UnsupportedProfile','This source reached its 100 retained review limit.'); END IF;
  et_body:=jsonb_build_object('id',openerp.new_id('taxreview'),'sourceId',id,'revision',et_revision,'sourceDigest',et_source->>'digest',
    'previousDigest',et_review->>'digest','scope',scope,'facts',et_facts,'evidenceRefs',et_refs,'authority','operator_fact_review_only',
    'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','review_expense_tax_source','actorId',et_actor));
  et_body:=et_body||jsonb_build_object('digest',openerp.digest(et_body));
  INSERT INTO openerp.expense_tax_reviews VALUES(scope->>'bookId',id,et_revision,(et_source->>'revision')::integer,et_body->>'id',et_facts->>'evidenceId',et_body);
  RETURN openerp.save_command(scope->>'bookId',key,et_actor,'review_expense_tax_source',et_payload,et_body);
END $$;

-- Exact rational arithmetic belongs here once. No legal rate, account mapping or rounding is inferred.
CREATE FUNCTION openerp.expense_tax_assess(book text, source jsonb, review jsonb, selection jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE et_book openerp.books; et_s jsonb:=source->'facts'; et_r jsonb:=review->'facts'; et_blocks text[]:='{}';
  et_sg numeric; et_sn numeric; et_sv numeric; et_rg numeric; et_rn numeric; et_rv numeric;
  et_rate_n numeric; et_rate_d numeric; et_deduct_n numeric; et_deduct_d numeric;
  et_tax_product numeric; et_tax_remainder numeric; et_tax numeric; et_deduct_product numeric; et_deduct_remainder numeric;
  et_deduct numeric; et_non_deduct numeric; et_expense numeric; et_calc jsonb; et_controls jsonb; et_contribution jsonb;
BEGIN
  SELECT * INTO STRICT et_book FROM openerp.books b WHERE b.id=book;
  et_sg:=(et_s->'amounts'->>'grossMinor')::numeric; et_sn:=(et_s->'amounts'->>'netMinor')::numeric; et_sv:=(et_s->'amounts'->>'vatMinor')::numeric;
  et_rg:=(et_r->'amounts'->>'grossMinor')::numeric; et_rn:=(et_r->'amounts'->>'netMinor')::numeric; et_rv:=(et_r->'amounts'->>'vatMinor')::numeric;
  IF et_sg IS NULL OR et_sn IS NULL OR et_sv IS NULL THEN et_blocks:=array_append(et_blocks,'missing_source_amounts'); END IF;
  IF et_sg-et_sn-et_sv<>0 THEN et_blocks:=array_append(et_blocks,'source_amount_difference'); END IF;
  IF (selection->>'mode'='synthetic_demonstration' AND et_s->>'recordClass'<>'synthetic')
    OR (selection->>'mode'='actual_review' AND et_s->>'recordClass'<>'actual_company') THEN et_blocks:=array_append(et_blocks,'wrong_record_class'); END IF;
  IF selection->>'mode'='actual_review' THEN et_blocks:=array_append(et_blocks,'production_profile_unapproved'); END IF;
  IF et_s->>'currency' IS NULL OR et_s->>'currencyScale' IS NULL THEN et_blocks:=array_append(et_blocks,'missing_currency');
  ELSIF et_s->>'currency'<>et_book.currency OR (et_s->>'currencyScale')::integer<>et_book.currency_scale THEN et_blocks:=array_append(et_blocks,'foreign_currency'); END IF;
  IF et_s->>'issuedOn' IS NULL OR et_s->>'receivedOn' IS NULL THEN et_blocks:=array_append(et_blocks,'missing_source_dates'); END IF;
  IF review IS NULL THEN
    et_blocks:=array_append(et_blocks,'missing_review');
  ELSE
    IF review->>'sourceDigest' IS DISTINCT FROM source->>'digest' THEN et_blocks:=array_append(et_blocks,'stale_review'); END IF;
    IF et_rg IS NULL OR et_rn IS NULL OR et_rv IS NULL THEN et_blocks:=array_append(et_blocks,'missing_review_amounts'); END IF;
    IF et_rg-et_rn-et_rv<>0 THEN et_blocks:=array_append(et_blocks,'review_amount_difference'); END IF;
    IF et_rg-et_sg<>0 OR et_rn-et_sn<>0 OR et_rv-et_sv<>0 THEN et_blocks:=array_append(et_blocks,'source_review_difference'); END IF;
    IF et_r->>'profileId' IS DISTINCT FROM 'synthetic-expense-tax' OR et_r->>'profileVersion' IS DISTINCT FROM '1'
      OR et_book.profile<>'synthetic-core-v1' THEN et_blocks:=array_append(et_blocks,'unsupported_profile'); END IF;
    IF et_s->>'supplierJurisdiction' IS NULL OR et_s->>'supplyJurisdiction' IS NULL OR et_r->>'bookJurisdiction' IS NULL THEN
      et_blocks:=array_append(et_blocks,'missing_jurisdiction');
    ELSIF et_s->>'supplierJurisdiction'<>et_r->>'bookJurisdiction' OR et_s->>'supplyJurisdiction'<>et_r->>'bookJurisdiction' THEN
      et_blocks:=array_append(et_blocks,'foreign_supply'); END IF;
    IF et_r->>'registration'<>'registered' OR et_r->>'registrationEvidenceId' IS NULL THEN et_blocks:=array_append(et_blocks,'registration_unknown_or_unsupported'); END IF;
    IF et_r->>'method'<>'accrual' OR et_r->>'methodEvidenceId' IS NULL THEN et_blocks:=array_append(et_blocks,'method_unknown_or_unsupported'); END IF;
    IF et_r->>'treatment'<>'domestic_purchase' THEN et_blocks:=array_append(et_blocks,'unsupported_treatment'); END IF;
    IF et_r->>'suppliedOn' IS NULL OR et_r->>'taxPointOn' IS NULL OR et_r->>'dateBasis' IS NULL OR et_r->>'dateEvidenceId' IS NULL THEN
      et_blocks:=array_append(et_blocks,'missing_review_dates'); END IF;
    IF (et_s->>'suppliedOn' IS NOT NULL AND et_s->>'suppliedOn' IS DISTINCT FROM et_r->>'suppliedOn')
      OR (et_s->>'taxPointOn' IS NOT NULL AND et_s->>'taxPointOn' IS DISTINCT FROM et_r->>'taxPointOn') THEN et_blocks:=array_append(et_blocks,'date_difference'); END IF;
    IF et_r->>'taxPointOn' IS NOT NULL AND (et_r->>'taxPointOn')::date NOT BETWEEN (selection->>'startsOn')::date AND (selection->>'endsOn')::date THEN
      et_blocks:=array_append(et_blocks,'outside_interval'); END IF;
    et_rate_n:=(et_r->>'rateNumerator')::numeric; et_rate_d:=(et_r->>'rateDenominator')::numeric;
    et_deduct_n:=(et_r->>'deductionNumerator')::numeric; et_deduct_d:=(et_r->>'deductionDenominator')::numeric;
    IF et_rate_n IS NULL OR et_rate_d IS NULL THEN et_blocks:=array_append(et_blocks,'missing_rate'); END IF;
    IF et_deduct_n IS NULL OR et_deduct_d IS NULL OR et_r->>'deductionBasis' IS NULL OR et_r->>'deductionEvidenceId' IS NULL THEN
      et_blocks:=array_append(et_blocks,'missing_deduction_basis'); END IF;
    IF et_deduct_n>et_deduct_d THEN et_blocks:=array_append(et_blocks,'invalid_deduction_fraction'); END IF;
    IF et_r->>'roundingPolicy'<>'exact_only' THEN et_blocks:=array_append(et_blocks,'rounding_policy_unavailable'); END IF;
    IF selection->>'mode'='synthetic_demonstration' AND et_s->>'recordClass'='synthetic'
      AND et_r->>'profileId'='synthetic-expense-tax' AND et_r->>'profileVersion'='1' AND et_book.profile='synthetic-core-v1'
      AND review->>'sourceDigest'=source->>'digest' AND et_r->>'roundingPolicy'='exact_only'
      AND NOT (et_blocks && ARRAY['wrong_record_class','missing_currency','foreign_currency','missing_jurisdiction','foreign_supply',
        'registration_unknown_or_unsupported','method_unknown_or_unsupported','unsupported_treatment','missing_review_dates','missing_source_dates',
        'date_difference','outside_interval','missing_deduction_basis','invalid_deduction_fraction'])
      AND et_rn IS NOT NULL AND et_rate_n IS NOT NULL AND et_rate_d IS NOT NULL THEN
      et_tax_product:=et_rn*et_rate_n; et_tax_remainder:=mod(et_tax_product,et_rate_d);
      IF et_tax_remainder<>0 THEN et_blocks:=array_append(et_blocks,'fractional_tax');
      ELSIF div(et_tax_product,et_rate_d)>=1e38::numeric THEN et_blocks:=array_append(et_blocks,'amount_out_of_range');
      ELSE
        et_tax:=div(et_tax_product,et_rate_d);
        IF et_rv-et_tax<>0 THEN et_blocks:=array_append(et_blocks,'calculated_tax_difference'); END IF;
        IF et_deduct_n IS NOT NULL AND et_deduct_d IS NOT NULL AND et_deduct_n<=et_deduct_d THEN
          et_deduct_product:=et_tax*et_deduct_n; et_deduct_remainder:=mod(et_deduct_product,et_deduct_d);
          IF et_deduct_remainder<>0 THEN et_blocks:=array_append(et_blocks,'fractional_deduction');
          ELSE
            et_deduct:=div(et_deduct_product,et_deduct_d); et_non_deduct:=et_tax-et_deduct; et_expense:=et_rg-et_deduct;
            IF et_expense<0 THEN et_blocks:=array_append(et_blocks,'calculated_tax_difference'); et_expense:=NULL; END IF;
          END IF;
        END IF;
      END IF;
      et_calc:=jsonb_build_object('taxProductNumerator',et_tax_product::text,'rateDenominator',et_rate_d::text,'taxRemainder',et_tax_remainder::text,
        'calculatedVatMinor',et_tax::text,'deductionProductNumerator',et_deduct_product::text,'deductionDenominator',et_deduct_d::text,
        'deductionRemainder',et_deduct_remainder::text,'deductibleMinor',et_deduct::text,'nonDeductibleMinor',et_non_deduct::text,'expenseMinor',et_expense::text);
    END IF;
  END IF;
  et_controls:=jsonb_build_object('sourceBalanceDifferenceMinor',(et_sg-et_sn-et_sv)::text,'reviewBalanceDifferenceMinor',(et_rg-et_rn-et_rv)::text,
    'grossDifferenceMinor',(et_rg-et_sg)::text,'netDifferenceMinor',(et_rn-et_sn)::text,'vatDifferenceMinor',(et_rv-et_sv)::text,'calculatedVatDifferenceMinor',(et_rv-et_tax)::text);
  IF cardinality(et_blocks)=0 THEN
    IF et_deduct IS NULL OR et_expense IS NULL OR et_non_deduct+et_deduct<>et_tax OR et_expense+et_deduct<>et_rg THEN
      PERFORM openerp.fail('InvalidJournal','The synthetic expense-tax contribution does not conserve exact amounts.'); END IF;
    et_contribution:=jsonb_build_object('grossMinor',et_rg::text,'netMinor',et_rn::text,'vatMinor',et_tax::text,
      'deductibleMinor',et_deduct::text,'nonDeductibleMinor',et_non_deduct::text,'expenseMinor',et_expense::text);
  END IF;
  et_blocks:=ARRAY(SELECT DISTINCT reason FROM unnest(et_blocks) reason ORDER BY reason);
  RETURN jsonb_build_object('state',CASE WHEN et_contribution IS NULL THEN 'excluded' ELSE 'included_synthetic' END,
    'blockers',to_jsonb(et_blocks),'controls',et_controls,'calculation',et_calc,'contribution',et_contribution);
END $$;

CREATE FUNCTION openerp.get_expense_tax_source(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_current jsonb; et_review jsonb; et_sources jsonb; et_reviews jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  et_current:=openerp.expense_tax_current(scope->>'bookId',id); et_review:=openerp.expense_tax_latest_review(scope->>'bookId',id);
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO et_sources FROM openerp.expense_tax_source_revisions r
    WHERE r.book_id=scope->>'bookId' AND r.source_id=get_expense_tax_source.id;
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.revision),'[]') INTO et_reviews FROM openerp.expense_tax_reviews r
    WHERE r.book_id=scope->>'bookId' AND r.source_id=get_expense_tax_source.id;
  RETURN jsonb_build_object('current',et_current,'latestReview',et_review,'reviewCurrent',coalesce(et_review->>'sourceDigest'=et_current->>'digest',false),
    'sourceHistory',et_sources,'reviewHistory',et_reviews);
END $$;
CREATE FUNCTION openerp.expense_tax_inventory(token text, scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_sources jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF (SELECT count(*) FROM openerp.expense_tax_sources s WHERE s.book_id=scope->>'bookId')>200 THEN
    PERFORM openerp.fail('UnsupportedProfile','Inventory exceeds the bounded 200-source review scope. Nothing was omitted.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('current',r.body,'latestReview',v.body,
      'reviewCurrent',coalesce(v.body->>'sourceDigest'=r.body->>'digest',false)) ORDER BY s.id COLLATE "C"),'[]') INTO et_sources
    FROM openerp.expense_tax_sources s
    JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_source_revisions x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_reviews x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) v ON true
    WHERE s.book_id=scope->>'bookId';
  RETURN jsonb_build_object('basisDigest',openerp.expense_tax_basis(scope->>'bookId'),'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'coverageEstablished',false,'sources',et_sources);
END $$;
CREATE FUNCTION openerp.prepare_expense_tax_snapshot(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_actor text; et_previous jsonb; et_book openerp.books; et_start date; et_end date; et_entries jsonb;
  et_totals jsonb; et_included integer; et_excluded integer; et_body jsonb; et_ordinal bigint;
BEGIN
  et_actor:=openerp.authorize(token,scope);
  SELECT * INTO STRICT et_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  et_previous:=openerp.replay(et_book.id,key,et_actor,'prepare_expense_tax_snapshot',input);
  IF et_previous IS NOT NULL THEN RETURN et_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['mode','startsOn','endsOn']);
  IF jsonb_typeof(input->'mode') IS DISTINCT FROM 'string' OR input->>'mode' NOT IN ('actual_review','synthetic_demonstration') THEN
    PERFORM openerp.fail('InvalidJournal','Choose actual-company review or a synthetic demonstration explicitly.'); END IF;
  et_start:=openerp.expense_tax_date(input->'startsOn'); et_end:=openerp.expense_tax_date(input->'endsOn');
  IF et_start IS NULL OR et_end IS NULL OR et_start>et_end THEN PERFORM openerp.fail('InvalidJournal','Select an explicit ordered review interval.'); END IF;
  IF (SELECT count(*) FROM openerp.expense_tax_sources s WHERE s.book_id=et_book.id)>200 THEN
    PERFORM openerp.fail('UnsupportedProfile','Snapshot exceeds the bounded 200-source review scope. Nothing was omitted.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('source',r.body,'review',v.body,'assessment',openerp.expense_tax_assess(et_book.id,r.body,v.body,input)) ORDER BY s.id COLLATE "C"),'[]') INTO et_entries
    FROM openerp.expense_tax_sources s
    JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_source_revisions x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_reviews x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) v ON true
    WHERE s.book_id=et_book.id;
  SELECT count(*) FILTER(WHERE value->'assessment'->>'state'='included_synthetic'),count(*) FILTER(WHERE value->'assessment'->>'state'='excluded'),
    jsonb_build_object('grossMinor',coalesce(sum((value->'assessment'->'contribution'->>'grossMinor')::numeric),0)::text,
      'netMinor',coalesce(sum((value->'assessment'->'contribution'->>'netMinor')::numeric),0)::text,
      'vatMinor',coalesce(sum((value->'assessment'->'contribution'->>'vatMinor')::numeric),0)::text,
      'deductibleMinor',coalesce(sum((value->'assessment'->'contribution'->>'deductibleMinor')::numeric),0)::text,
      'nonDeductibleMinor',coalesce(sum((value->'assessment'->'contribution'->>'nonDeductibleMinor')::numeric),0)::text,
      'expenseMinor',coalesce(sum((value->'assessment'->'contribution'->>'expenseMinor')::numeric),0)::text)
    INTO et_included,et_excluded,et_totals FROM jsonb_array_elements(et_entries);
  SELECT coalesce(max(s.ordinal),0)+1 INTO et_ordinal FROM openerp.expense_tax_snapshots s WHERE s.book_id=et_book.id;
  IF et_ordinal>999999999999999999 THEN PERFORM openerp.fail('UnsupportedProfile','Snapshot ordinal capacity exhausted.'); END IF;
  et_body:=jsonb_build_object('schemaVersion','1','calculationEngine','expense-tax-controls-v1','bookProfile',et_book.profile,'bookProfileVersion',et_book.profile_version::text,
    'id',openerp.new_id('taxsnapshot'),'scope',scope,'input',input,'basisDigest',openerp.expense_tax_basis(et_book.id),
    'bookSequence',et_book.committed_sequence::text,'currency',et_book.currency,'currencyScale',et_book.currency_scale,
    'entries',et_entries,'includedCount',et_included,'excludedCount',et_excluded,'syntheticTotals',et_totals,
    'coverageEstablished',false,'ledgerReconciled',false,'vatReturnReady',false,'productionProfileApproved',false,'postingEnabled',false,
    'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','prepare_expense_tax_snapshot','actorId',et_actor));
  et_body:=et_body||jsonb_build_object('digest',openerp.digest(et_body));
  INSERT INTO openerp.expense_tax_snapshots VALUES(et_book.id,et_body->>'id',et_ordinal,et_body);
  RETURN openerp.save_command(et_book.id,key,et_actor,'prepare_expense_tax_snapshot',input,et_body);
END $$;
CREATE FUNCTION openerp.get_expense_tax_snapshot(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_body jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT s.body INTO et_body FROM openerp.expense_tax_snapshots s WHERE s.book_id=scope->>'bookId' AND s.id=get_expense_tax_snapshot.id;
  IF et_body IS NULL THEN PERFORM openerp.fail('NotFound','The expense-tax snapshot is not retained in this book.'); END IF;
  RETURN jsonb_build_object('snapshot',et_body,'basisCurrent',et_body->>'basisDigest'=openerp.expense_tax_basis(scope->>'bookId'));
END $$;
CREATE FUNCTION openerp.list_expense_tax_snapshots(token text, scope jsonb, after_cursor text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_ceiling bigint; et_last bigint:=0; et_end bigint; et_prefix text; et_items jsonb; et_more boolean;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  et_prefix:=substr(openerp.digest(scope),8,16);
  IF after_cursor='' THEN SELECT coalesce(max(s.ordinal),0) INTO et_ceiling FROM openerp.expense_tax_snapshots s WHERE s.book_id=scope->>'bookId';
  ELSE
    IF after_cursor IS NULL OR after_cursor !~ '^[a-f0-9]{16}_[0-9]{1,18}_[0-9]{1,18}$' OR split_part(after_cursor,'_',1)<>et_prefix THEN
      PERFORM openerp.fail('InvalidJournal','Use the snapshot cursor returned for this book and scope.'); END IF;
    et_ceiling:=split_part(after_cursor,'_',2)::bigint; et_last:=split_part(after_cursor,'_',3)::bigint;
    IF et_last>et_ceiling THEN PERFORM openerp.fail('InvalidJournal','The snapshot cursor interval is invalid.'); END IF;
  END IF;
  IF et_ceiling>(SELECT coalesce(max(s.ordinal),0) FROM openerp.expense_tax_snapshots s WHERE s.book_id=scope->>'bookId') THEN
    PERFORM openerp.fail('InvalidJournal','The snapshot cursor names an unobserved future cutoff.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'digest',p.body->>'digest','input',p.body->'input','recordedAt',p.body->>'recordedAt') ORDER BY p.ordinal),'[]'),max(p.ordinal)
    INTO et_items,et_end FROM(SELECT s.* FROM openerp.expense_tax_snapshots s WHERE s.book_id=scope->>'bookId' AND s.ordinal>et_last AND s.ordinal<=et_ceiling ORDER BY s.ordinal LIMIT 25) p;
  SELECT EXISTS(SELECT FROM openerp.expense_tax_snapshots s WHERE s.book_id=scope->>'bookId' AND s.ordinal>et_end AND s.ordinal<=et_ceiling) INTO et_more;
  RETURN jsonb_build_object('items',et_items,'next',CASE WHEN et_more THEN et_prefix||'_'||et_ceiling::text||'_'||et_end::text ELSE NULL END);
END $$;
-- A future setup/closing owner may bind this under its book lock. It never establishes coverage.
CREATE FUNCTION openerp.expense_tax_dependencies(book text) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT jsonb_build_object('basisDigest',openerp.expense_tax_basis(book),'sourceCount',count(*),
    'missingOrStaleReviewCount',count(*) FILTER(WHERE openerp.expense_tax_latest_review(book,s.id)->>'sourceDigest' IS DISTINCT FROM openerp.expense_tax_current(book,s.id)->>'digest'),
    'coverageEstablished',false,'productionProfileApproved',false,'vatReturnReady',false,'postingEnabled',false)
  FROM openerp.expense_tax_sources s WHERE s.book_id=book
$$;
REVOKE ALL ON openerp.expense_tax_sources,openerp.expense_tax_source_revisions,openerp.expense_tax_reviews,openerp.expense_tax_snapshots FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.expense_tax_shape(jsonb,text[]),openerp.expense_tax_minor(jsonb,boolean),openerp.expense_tax_date(jsonb),
  openerp.expense_tax_amounts(jsonb),openerp.expense_tax_current(text,text),openerp.expense_tax_latest_review(text,text),openerp.expense_tax_basis(text),
  openerp.expense_tax_assess(text,jsonb,jsonb,jsonb),openerp.expense_tax_dependencies(text),
  openerp.record_expense_tax_source(text,jsonb,text,jsonb),openerp.review_expense_tax_source(text,jsonb,text,text,jsonb),
  openerp.get_expense_tax_source(text,jsonb,text),openerp.expense_tax_inventory(text,jsonb),openerp.prepare_expense_tax_snapshot(text,jsonb,text,jsonb),
  openerp.get_expense_tax_snapshot(text,jsonb,text),openerp.list_expense_tax_snapshots(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.record_expense_tax_source(text,jsonb,text,jsonb),openerp.review_expense_tax_source(text,jsonb,text,text,jsonb),
  openerp.get_expense_tax_source(text,jsonb,text),openerp.expense_tax_inventory(text,jsonb),openerp.prepare_expense_tax_snapshot(text,jsonb,text,jsonb),
  openerp.get_expense_tax_snapshot(text,jsonb,text),openerp.list_expense_tax_snapshots(text,jsonb,text) TO openerp_runtime;
