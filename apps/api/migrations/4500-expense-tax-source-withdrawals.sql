-- Permanent expense observation withdrawal, not a financial reversal or capacity release.
-- Saved0710 expense v1 snapshots and saved VAT v1/v2 drafts remain immutable.
CREATE TABLE openerp.expense_tax_source_withdrawals (
  book_id text NOT NULL,source_id text NOT NULL,revision integer NOT NULL,id text NOT NULL,evidence_id text NOT NULL,body jsonb NOT NULL,
  PRIMARY KEY(book_id,source_id),UNIQUE(book_id,id),
  FOREIGN KEY(book_id,source_id,revision) REFERENCES openerp.expense_tax_source_revisions,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK(body->>'id' IS NOT DISTINCT FROM id),CHECK(body->>'sourceId' IS NOT DISTINCT FROM source_id),
  CHECK(body->'scope'->>'bookId' IS NOT DISTINCT FROM book_id),
  CHECK(body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_expense_tax_withdrawal BEFORE UPDATE OR DELETE ON openerp.expense_tax_source_withdrawals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.expense_tax_source_withdrawals FROM PUBLIC,openerp_runtime;

-- Existing commands recover successful keys before inserting. History is never edited.
CREATE FUNCTION openerp.expense_tax_source_admission() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=NEW.book_id AND w.source_id=NEW.source_id) THEN
    PERFORM openerp.fail('StaleDependency','This expense source identity is permanently withdrawn. New revisions, reviews and reactivation are refused.'); END IF;
  IF TG_TABLE_NAME='expense_tax_source_revisions' AND EXISTS(
    SELECT FROM openerp.expense_tax_sources s
    JOIN LATERAL(SELECT r.body FROM openerp.expense_tax_source_revisions r WHERE r.book_id=s.book_id AND r.source_id=s.id ORDER BY r.revision DESC LIMIT 1) latest ON true
    WHERE s.book_id=NEW.book_id AND s.id<>NEW.source_id
      AND NOT EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=s.book_id AND w.source_id=s.id)
      AND latest.body->>'evidenceSha256'=NEW.body->>'evidenceSha256'
      AND latest.body->'facts'->>'sourceLocator'=NEW.body->'facts'->>'sourceLocator') THEN
    PERFORM openerp.fail('IdempotencyConflict','This evidence component already has an active expense source. Review its identity or explicitly withdraw the erroneous observation first.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expense_tax_revision_admission BEFORE INSERT ON openerp.expense_tax_source_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.expense_tax_source_admission();
CREATE TRIGGER expense_tax_review_admission BEFORE INSERT ON openerp.expense_tax_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.expense_tax_source_admission();

CREATE FUNCTION openerp.withdraw_expense_tax_source(token text,scope jsonb,id text,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE w_actor text;w_previous jsonb;w_current jsonb;w_sha text;w_body jsonb;w_payload jsonb:=jsonb_build_object('id',id,'input',input);
BEGIN
  w_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  w_previous:=openerp.replay(scope->>'bookId',key,w_actor,'withdraw_expense_tax_source',w_payload);
  IF w_previous IS NOT NULL THEN RETURN w_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['expectedSourceDigest','evidenceId','rationale']);
  IF id IS NULL OR id !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(input->'expectedSourceDigest') IS DISTINCT FROM 'string' OR input->>'expectedSourceDigest' !~ '^sha256:[a-f0-9]{64}$'
    OR jsonb_typeof(input->'evidenceId') IS DISTINCT FROM 'string' OR input->>'evidenceId' !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string' OR length(btrim(input->>'rationale')) NOT BETWEEN 1 AND 2000 OR length(input->>'rationale')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact source digest, scoped retained withdrawal evidence and a reason.'); END IF;
  w_current:=openerp.expense_tax_current(scope->>'bookId',id);
  IF input->>'expectedSourceDigest' IS DISTINCT FROM w_current->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Reload the current expense observation before withdrawing it.'); END IF;
  IF EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=scope->>'bookId' AND w.source_id=withdraw_expense_tax_source.id) THEN
    PERFORM openerp.fail('StaleDependency','This expense source is already permanently withdrawn. Read its retained withdrawal or retry the original command key.'); END IF;
  SELECT e.sha256 INTO w_sha FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=input->>'evidenceId';
  IF w_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain the withdrawal evidence in this book first.'); END IF;
  w_body:=jsonb_build_object('id',openerp.new_id('expensewithdrawal'),'scope',scope,'sourceId',id,
    'revisionId',w_current->>'id','revision',w_current->'revision','revisionDigest',w_current->>'digest',
    'input',input,'evidenceSha256',w_sha,'permanent',true,
    'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','withdraw_expense_tax_source','actorId',w_actor));
  w_body:=w_body||jsonb_build_object('digest',openerp.digest(w_body));
  INSERT INTO openerp.expense_tax_source_withdrawals VALUES(scope->>'bookId',id,(w_current->>'revision')::integer,w_body->>'id',input->>'evidenceId',w_body);
  RETURN openerp.save_command(scope->>'bookId',key,w_actor,'withdraw_expense_tax_source',w_payload,w_body);
END $$;


CREATE OR REPLACE FUNCTION openerp.expense_tax_basis(book text) RETURNS text LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT openerp.digest(jsonb_build_object('bookId',book,'currency',b.currency,'currencyScale',b.currency_scale,'profile',b.profile,'profileVersion',b.profile_version::text,
    'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'sourceDigest',r.body->>'digest','reviewDigest',openerp.expense_tax_latest_review(book,s.id)->>'digest',
      'withdrawalDigest',(SELECT w.body->>'digest' FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=book AND w.source_id=s.id)) ORDER BY s.id COLLATE "C")
      FROM openerp.expense_tax_sources s JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_source_revisions x
        WHERE x.book_id=book AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true WHERE s.book_id=book),'[]')))
  FROM openerp.books b WHERE b.id=book
$$;

CREATE OR REPLACE FUNCTION openerp.expense_tax_assess(book text, source jsonb, review jsonb, selection jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE et_book openerp.books; et_s jsonb:=source->'facts'; et_r jsonb:=review->'facts'; et_blocks text[]:='{}';
  et_sg numeric; et_sn numeric; et_sv numeric; et_rg numeric; et_rn numeric; et_rv numeric;
  et_rate_n numeric; et_rate_d numeric; et_deduct_n numeric; et_deduct_d numeric;
  et_tax_product numeric; et_tax_remainder numeric; et_tax numeric; et_deduct_product numeric; et_deduct_remainder numeric;
  et_deduct numeric; et_non_deduct numeric; et_expense numeric; et_calc jsonb; et_controls jsonb; et_contribution jsonb;
BEGIN
  SELECT * INTO STRICT et_book FROM openerp.books b WHERE b.id=book;
  IF EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=book AND w.source_id=source->>'sourceId') THEN
    et_blocks:=array_append(et_blocks,'withdrawn_source');
  ELSE
    IF EXISTS(SELECT FROM openerp.expense_tax_sources s
      JOIN LATERAL(SELECT r.body FROM openerp.expense_tax_source_revisions r WHERE r.book_id=book AND r.source_id=s.id ORDER BY r.revision DESC LIMIT 1) latest ON true
      WHERE s.book_id=book AND s.id<>source->>'sourceId'
        AND NOT EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=book AND w.source_id=s.id)
        AND latest.body->>'evidenceSha256'=source->>'evidenceSha256'
        AND latest.body->'facts'->>'sourceLocator'=et_s->>'sourceLocator') THEN
      et_blocks:=array_append(et_blocks,'duplicate_source_component'); END IF;
    --0710 retains a voucher reference, not disjoint selected-line capacity. Keep ambiguity explicit.
    IF et_s->>'voucherId' IS NOT NULL AND EXISTS(SELECT FROM openerp.expense_tax_sources s
      JOIN LATERAL(SELECT r.voucher_id FROM openerp.expense_tax_source_revisions r WHERE r.book_id=book AND r.source_id=s.id ORDER BY r.revision DESC LIMIT 1) latest ON true
      WHERE s.book_id=book AND s.id<>source->>'sourceId' AND latest.voucher_id=et_s->>'voucherId'
        AND NOT EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=book AND w.source_id=s.id)) THEN
      et_blocks:=array_append(et_blocks,'ambiguous_voucher_sources'); END IF;
  END IF;
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
      AND NOT (et_blocks && ARRAY['withdrawn_source','duplicate_source_component','ambiguous_voucher_sources','wrong_record_class','missing_currency','foreign_currency','missing_jurisdiction','foreign_supply',
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

CREATE OR REPLACE FUNCTION openerp.get_expense_tax_source(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_current jsonb; et_review jsonb; et_sources jsonb; et_reviews jsonb; et_withdrawal jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  et_current:=openerp.expense_tax_current(scope->>'bookId',id); et_review:=openerp.expense_tax_latest_review(scope->>'bookId',id);
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO et_sources FROM openerp.expense_tax_source_revisions r
    WHERE r.book_id=scope->>'bookId' AND r.source_id=get_expense_tax_source.id;
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.revision),'[]') INTO et_reviews FROM openerp.expense_tax_reviews r
    WHERE r.book_id=scope->>'bookId' AND r.source_id=get_expense_tax_source.id;
  SELECT w.body INTO et_withdrawal FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=scope->>'bookId' AND w.source_id=get_expense_tax_source.id;
  RETURN jsonb_build_object('withdrawal',et_withdrawal,'current',et_current,'latestReview',et_review,'reviewCurrent',et_withdrawal IS NULL AND coalesce(et_review->>'sourceDigest'=et_current->>'digest',false),
    'sourceHistory',et_sources,'reviewHistory',et_reviews);
END $$;

CREATE OR REPLACE FUNCTION openerp.expense_tax_inventory(token text, scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE et_sources jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF (SELECT count(*) FROM openerp.expense_tax_sources s WHERE s.book_id=scope->>'bookId')>200 THEN
    PERFORM openerp.fail('UnsupportedProfile','Inventory exceeds the bounded 200-source review scope. Nothing was omitted.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('current',r.body,'latestReview',v.body,'withdrawal',w.body,
      'reviewCurrent',w.source_id IS NULL AND coalesce(v.body->>'sourceDigest'=r.body->>'digest',false)) ORDER BY s.id COLLATE "C"),'[]') INTO et_sources
    FROM openerp.expense_tax_sources s
    JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_source_revisions x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_reviews x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) v ON true
    LEFT JOIN openerp.expense_tax_source_withdrawals w ON w.book_id=s.book_id AND w.source_id=s.id
    WHERE s.book_id=scope->>'bookId';
  RETURN jsonb_build_object('basisDigest',openerp.expense_tax_basis(scope->>'bookId'),'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'coverageEstablished',false,'sources',et_sources);
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_expense_tax_snapshot(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('source',r.body,'review',v.body,'withdrawal',w.body,'assessment',openerp.expense_tax_assess(et_book.id,r.body,v.body,input)) ORDER BY s.id COLLATE "C"),'[]') INTO et_entries
    FROM openerp.expense_tax_sources s
    JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_source_revisions x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_reviews x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) v ON true
    LEFT JOIN openerp.expense_tax_source_withdrawals w ON w.book_id=s.book_id AND w.source_id=s.id
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
  et_body:=jsonb_build_object('schemaVersion','2','calculationEngine','expense-tax-controls-v2','bookProfile',et_book.profile,'bookProfileVersion',et_book.profile_version::text,
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

CREATE OR REPLACE FUNCTION openerp.expense_tax_dependencies(book text) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT jsonb_build_object('basisDigest',openerp.expense_tax_basis(book),'sourceCount',count(*),
    'withdrawnSourceCount',count(*) FILTER(WHERE w.source_id IS NOT NULL),
    'missingOrStaleReviewCount',count(*) FILTER(WHERE w.source_id IS NULL AND openerp.expense_tax_latest_review(book,s.id)->>'sourceDigest' IS DISTINCT FROM openerp.expense_tax_current(book,s.id)->>'digest'),
    'coverageEstablished',false,'productionProfileApproved',false,'vatReturnReady',false,'postingEnabled',false)
  FROM openerp.expense_tax_sources s LEFT JOIN openerp.expense_tax_source_withdrawals w ON w.book_id=s.book_id AND w.source_id=s.id WHERE s.book_id=book
$$;

-- An explicit derived VAT link cannot silently keep using a withdrawn expense observation.
-- Independent VAT facts retain their own operator-reviewed identity; no financial claim is released.
CREATE FUNCTION openerp.refuse_withdrawn_expense_vat_link() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=NEW.book_id
    AND w.source_id=NEW.body->'input'->'expenseLink'->>'sourceId') THEN
    PERFORM openerp.fail('StaleDependency','A new VAT fact revision cannot derive from a permanently withdrawn expense source.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refuse_withdrawn_expense_vat_link BEFORE INSERT ON openerp.vat_fact_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.refuse_withdrawn_expense_vat_link();


CREATE OR REPLACE FUNCTION openerp.vat_return_basis_body(book text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE vr_book openerp.books; vr_facts jsonb; vr_body jsonb;
BEGIN
  SELECT * INTO STRICT vr_book FROM openerp.books b WHERE b.id=book;
  IF (SELECT count(*) FROM openerp.vat_fact_components c WHERE c.book_id=book)>200 THEN PERFORM openerp.fail('UnsupportedProfile','VAT inventory exceeds its complete-read bound.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('fact',r.body,
    'withdrawal',w.body,
    'expenseSourceWithdrawn',EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals ew WHERE ew.book_id=book AND ew.source_id=r.body->'input'->'expenseLink'->>'sourceId'),
    'expenseLinkCurrent',CASE WHEN r.body->'input'->'expenseLink'='null'::jsonb THEN true ELSE
      NOT EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals ew WHERE ew.book_id=book AND ew.source_id=r.body->'input'->'expenseLink'->>'sourceId') AND
      openerp.expense_tax_current(book,r.body->'input'->'expenseLink'->>'sourceId')->>'digest'=r.body->>'expenseSourceDigest'
      AND openerp.expense_tax_latest_review(book,r.body->'input'->'expenseLink'->>'sourceId')->>'digest'=r.body->>'expenseReviewDigest' END,
    'voucherReversed',coalesce(v.posting_purpose='reversal',false) OR EXISTS(SELECT FROM openerp.vouchers x WHERE x.book_id=book AND x.corrects_voucher_id=r.voucher_id AND x.posting_purpose='reversal'),
    'voucherPostingDate',v.posting_date::text,
    'taxLines',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'accountId',l.account_id,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text) ORDER BY l.ordinal)
      FROM openerp.journal_lines l WHERE l.book_id=book AND l.voucher_id=r.voucher_id AND r.body->'input'->'taxLineIds' ? l.id),'[]')) ORDER BY c.id COLLATE "C"),'[]')
    INTO vr_facts FROM openerp.vat_fact_components c JOIN LATERAL(SELECT x.* FROM openerp.vat_fact_revisions x WHERE x.book_id=book AND x.fact_id=c.id ORDER BY x.revision DESC LIMIT 1) r ON true
    LEFT JOIN openerp.vouchers v ON v.book_id=book AND v.id=r.voucher_id
    LEFT JOIN openerp.vat_fact_withdrawals w ON w.book_id=book AND w.fact_id=c.id WHERE c.book_id=book;
  vr_body:=jsonb_build_object('bookSequence',vr_book.committed_sequence::text,'bookProfile',vr_book.profile,'bookProfileVersion',vr_book.profile_version::text,
    'currency',vr_book.currency,'currencyScale',vr_book.currency_scale,'facts',vr_facts);
  RETURN vr_body||jsonb_build_object('digest',openerp.digest(vr_body));
END $$;

CREATE OR REPLACE FUNCTION openerp.seal_vat_return_draft(token text, scope jsonb, key text, input jsonb, basis jsonb, calculation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE vr_actor text; vr_previous jsonb; vr_basis jsonb; vr_body jsonb; vr_ordinal integer; vr_sha text; vr_flag text;
BEGIN
  vr_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  vr_previous:=openerp.replay(scope->>'bookId',key,vr_actor,'prepare_vat_return_draft',input);
  IF vr_previous IS NOT NULL THEN RETURN vr_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['mode','startsOn','endsOn','periodEvidenceId','otherBoxes']);
  IF input->>'mode' IS NULL OR input->>'mode' NOT IN ('actual_review','synthetic_demonstration') OR input->>'otherBoxes' IS NULL
    OR input->>'otherBoxes' NOT IN ('unknown','absent_in_synthetic_example')
    OR (input->>'mode'='actual_review' AND input->>'otherBoxes'<>'unknown') THEN
    PERFORM openerp.fail('InvalidJournal','Select an explicit draft mode; other-box absence is supported only as a synthetic assertion.'); END IF;
  IF openerp.bank_date(input->>'startsOn')>openerp.bank_date(input->>'endsOn')
    OR openerp.bank_date(input->>'endsOn')-openerp.bank_date(input->>'startsOn')>365 THEN
    PERFORM openerp.fail('InvalidJournal','Choose an ordered reporting interval no longer than 366 days.'); END IF;
  IF input->'periodEvidenceId'<>'null'::jsonb THEN
    SELECT e.sha256 INTO vr_sha FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=input->>'periodEvidenceId';
    IF vr_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain the reporting-period basis in this book.'); END IF;
  END IF;
  vr_basis:=openerp.vat_return_basis_body(scope->>'bookId');
  IF basis IS DISTINCT FROM vr_basis THEN PERFORM openerp.fail('StaleDependency','VAT sources or posted ledger basis changed. Review them before preparing a new draft.'); END IF;
  -- The owning Effect workflow computes once. SQL fences identity and unavailable authority; it does not calculate tax.
  PERFORM openerp.expense_tax_shape(calculation,ARRAY['engine','assessments','includedCount','excludedCount','syntheticBoxes','blockers','coverageEstablished','ledgerReconciled','legalProfileActive','filingReady']);
  IF calculation->>'engine' IS DISTINCT FROM 'vat-return-draft-v3' OR jsonb_typeof(calculation->'assessments') IS DISTINCT FROM 'array'
    OR jsonb_array_length(calculation->'assessments')<>jsonb_array_length(basis->'facts') THEN
    PERFORM openerp.fail('InvalidJournal','A draft must retain an assessment for every captured VAT fact.'); END IF;
  FOREACH vr_flag IN ARRAY ARRAY['coverageEstablished','ledgerReconciled','legalProfileActive','filingReady'] LOOP
    IF calculation->vr_flag IS DISTINCT FROM 'false'::jsonb THEN PERFORM openerp.fail('UnsupportedProfile','This draft cannot activate a legal profile or certify a return.'); END IF;
  END LOOP;
  IF input->>'mode'='actual_review' AND (calculation->'syntheticBoxes' IS DISTINCT FROM 'null'::jsonb OR calculation->'includedCount' IS DISTINCT FROM '0'::jsonb) THEN
    PERFORM openerp.fail('UnsupportedProfile','Actual-company review cannot emit supported VAT totals.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(calculation->'assessments') WITH ORDINALITY a(body,n)
    JOIN jsonb_array_elements(basis->'facts') WITH ORDINALITY f(body,n) USING(n)
    WHERE a.body->>'factId' IS DISTINCT FROM f.body->'fact'->>'factId' OR a.body->>'sourceDigest' IS DISTINCT FROM f.body->'fact'->>'digest'
      OR (a.body->>'state'='included_synthetic' AND (input->>'mode'<>'synthetic_demonstration' OR basis->>'bookProfile'<>'synthetic-core-v1'
        OR f.body->'fact'->'input'->>'recordClass'<>'synthetic' OR f.body->'withdrawal' IS DISTINCT FROM 'null'::jsonb
        OR f.body->'expenseSourceWithdrawn'='true'::jsonb))) THEN
    PERFORM openerp.fail('InvalidJournal','Calculation lineage and synthetic class must match the sealed source inventory.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(calculation->'assessments') WITH ORDINALITY a(body,n)
    JOIN jsonb_array_elements(basis->'facts') WITH ORDINALITY f(body,n) USING(n)
    WHERE f.body->'withdrawal' IS DISTINCT FROM 'null'::jsonb
      AND (a.body->>'state' IS DISTINCT FROM 'excluded'
        OR a.body->'contribution' IS DISTINCT FROM 'null'::jsonb
        OR NOT coalesce(a.body->'blockers' ? 'withdrawn_fact',false))) THEN
    PERFORM openerp.fail('InvalidJournal','Every withdrawn fact must remain explicitly excluded, with withdrawal lineage retained in the basis.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(calculation->'assessments') WITH ORDINALITY a(body,n)
    JOIN jsonb_array_elements(basis->'facts') WITH ORDINALITY f(body,n) USING(n)
    WHERE f.body->'expenseSourceWithdrawn'='true'::jsonb
      AND (a.body->>'state' IS DISTINCT FROM 'excluded'
        OR a.body->'contribution' IS DISTINCT FROM 'null'::jsonb
        OR NOT coalesce(a.body->'blockers' ? 'withdrawn_expense_source',false))) THEN
    PERFORM openerp.fail('InvalidJournal','Every fact linked to a withdrawn expense source must remain explicitly excluded without a contribution and with its withdrawal blocker.');
  END IF;
  SELECT count(*)+1 INTO vr_ordinal FROM openerp.vat_return_drafts d WHERE d.book_id=scope->>'bookId';
  IF vr_ordinal>500 THEN PERFORM openerp.fail('UnsupportedProfile','This bounded review supports 500 saved drafts; no history was deleted.'); END IF;
  vr_body:=jsonb_build_object('id',openerp.new_id('vatdraft'),'scope',scope,'input',input,'basis',basis,'calculation',calculation,'periodEvidenceSha256',vr_sha,
    'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','prepare_vat_return_draft','actorId',vr_actor));
  vr_body:=vr_body||jsonb_build_object('digest',openerp.digest(vr_body));
  INSERT INTO openerp.vat_return_drafts VALUES(scope->>'bookId',vr_body->>'id',vr_ordinal,vr_body);
  RETURN openerp.save_command(scope->>'bookId',key,vr_actor,'prepare_vat_return_draft',input,vr_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.vat_draft_impact_body(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE va_original openerp.vat_return_drafts; va_replacement openerp.vat_return_drafts;
  va_field text; va_draft jsonb; va_refs jsonb:='[]'; va_boxes jsonb:='[]'; va_facts jsonb;
  va_before jsonb; va_after jsonb; va_body jsonb;
BEGIN
  PERFORM openerp.expense_tax_shape(p_input,ARRAY['originalDraftId','originalDraftDigest','replacementDraftId','replacementDraftDigest']);
  FOREACH va_field IN ARRAY ARRAY['originalDraftId','replacementDraftId'] LOOP
    IF jsonb_typeof(p_input->va_field) IS DISTINCT FROM 'string'
      OR p_input->>va_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select the exact original and replacement draft identifiers.');
    END IF;
  END LOOP;
  FOREACH va_field IN ARRAY ARRAY['originalDraftDigest','replacementDraftDigest'] LOOP
    IF jsonb_typeof(p_input->va_field) IS DISTINCT FROM 'string'
      OR p_input->>va_field !~ '^sha256:[a-f0-9]{64}$' THEN
      PERFORM openerp.fail('InvalidJournal','Pin both immutable draft digests.');
    END IF;
  END LOOP;
  SELECT d.* INTO va_original FROM openerp.vat_return_drafts d
    WHERE d.book_id=p_book AND d.id=p_input->>'originalDraftId';
  SELECT d.* INTO va_replacement FROM openerp.vat_return_drafts d
    WHERE d.book_id=p_book AND d.id=p_input->>'replacementDraftId';
  IF va_original.id IS NULL OR va_replacement.id IS NULL THEN
    PERFORM openerp.fail('NotFound','Both VAT drafts must be retained in this book.');
  END IF;
  IF va_original.body->>'digest' IS DISTINCT FROM p_input->>'originalDraftDigest'
    OR va_replacement.body->>'digest' IS DISTINCT FROM p_input->>'replacementDraftDigest' THEN
    PERFORM openerp.fail('StaleDependency','Reload and pin the exact retained draft identities.');
  END IF;
  IF va_original.ordinal>=va_replacement.ordinal THEN
    PERFORM openerp.fail('InvalidJournal','The replacement must be a later, distinct saved draft.');
  END IF;
  IF va_original.body->'input'->>'startsOn' IS DISTINCT FROM va_replacement.body->'input'->>'startsOn'
    OR va_original.body->'input'->>'endsOn' IS DISTINCT FROM va_replacement.body->'input'->>'endsOn' THEN
    PERFORM openerp.fail('InvalidJournal','An internal amendment compares the same reporting interval.');
  END IF;
  FOREACH va_draft IN ARRAY ARRAY[va_original.body,va_replacement.body] LOOP
    IF va_draft->'input'->>'mode' IS DISTINCT FROM 'synthetic_demonstration'
      OR va_draft->'basis'->>'bookProfile' IS DISTINCT FROM 'synthetic-core-v1'
      OR va_draft->'basis'->>'currency' IS DISTINCT FROM 'SEK'
      OR va_draft->'basis'->'currencyScale' IS DISTINCT FROM '2'::jsonb
      OR coalesce(va_draft->'calculation'->>'engine','') NOT IN ('vat-return-draft-v1','vat-return-draft-v2','vat-return-draft-v3')
      OR jsonb_typeof(va_draft->'calculation'->'syntheticBoxes') IS DISTINCT FROM 'object' THEN
      PERFORM openerp.fail('UnsupportedProfile','Only retained SEK synthetic-core-v1 demonstrations from vat-return-draft-v1/v2/v3 can be compared.');
    END IF;
    -- Refuse incomplete or ambiguous lineage rather than silently omitting rows through joins.
    IF jsonb_array_length(va_draft->'basis'->'facts')>200
      OR jsonb_array_length(va_draft->'basis'->'facts')<>jsonb_array_length(va_draft->'calculation'->'assessments')
      OR (SELECT count(DISTINCT f->'fact'->>'factId') FROM jsonb_array_elements(va_draft->'basis'->'facts') f)
        <>jsonb_array_length(va_draft->'basis'->'facts')
      OR (SELECT count(DISTINCT a->>'factId') FROM jsonb_array_elements(va_draft->'calculation'->'assessments') a)
        <>jsonb_array_length(va_draft->'basis'->'facts')
      OR EXISTS(SELECT FROM jsonb_array_elements(va_draft->'basis'->'facts') f
        WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(va_draft->'calculation'->'assessments') a
          WHERE a->>'factId'=f->'fact'->>'factId' AND a->>'sourceDigest'=f->'fact'->>'digest')) THEN
      PERFORM openerp.fail('UnsupportedProfile','The retained draft has incomplete or ambiguous fact lineage.');
    END IF;
    FOREACH va_field IN ARRAY ARRAY['coverageEstablished','ledgerReconciled','legalProfileActive','filingReady'] LOOP
      IF va_draft->'calculation'->va_field IS DISTINCT FROM 'false'::jsonb THEN
        PERFORM openerp.fail('UnsupportedProfile','An internal draft comparison cannot inherit filing or legal authority.');
      END IF;
    END LOOP;
    IF EXISTS(SELECT FROM jsonb_array_elements(va_draft->'calculation'->'assessments') a
      WHERE (a->>'state'='excluded' AND a->'contribution' IS DISTINCT FROM 'null'::jsonb)
        OR (a->>'state'='included_synthetic' AND jsonb_typeof(a->'contribution') IS DISTINCT FROM 'object')
        OR a->>'state' IS NULL OR a->>'state' NOT IN ('excluded','included_synthetic')) THEN
      PERFORM openerp.fail('UnsupportedProfile','Retained inclusion states and contributions must agree.');
    END IF;
    FOREACH va_field IN ARRAY ARRAY['box05','box10','box48'] LOOP
      IF (va_draft->'calculation'->'syntheticBoxes'->va_field->>'exactMinor')::numeric IS DISTINCT FROM
        (SELECT coalesce(sum((a->'contribution'->>(va_field||'Minor'))::numeric),0)
          FROM jsonb_array_elements(va_draft->'calculation'->'assessments') a) THEN
        PERFORM openerp.fail('UnsupportedProfile','Retained box totals must reconstruct from retained contributions.');
      END IF;
    END LOOP;
    va_refs:=va_refs||jsonb_build_array(jsonb_build_object(
      'id',va_draft->>'id','digest',va_draft->>'digest','basisDigest',va_draft->'basis'->>'digest',
      'engine',va_draft->'calculation'->>'engine','input',va_draft->'input',
      'bookSequence',va_draft->'basis'->>'bookSequence','bookProfile',va_draft->'basis'->>'bookProfile',
      'bookProfileVersion',va_draft->'basis'->>'bookProfileVersion',
      'currency',va_draft->'basis'->>'currency','currencyScale',va_draft->'basis'->'currencyScale',
      'blockers',va_draft->'calculation'->'blockers'));
  END LOOP;
  WITH original AS (
    SELECT f->'fact' AS fact,a AS assessment
    FROM jsonb_array_elements(va_original.body->'basis'->'facts') f
    JOIN jsonb_array_elements(va_original.body->'calculation'->'assessments') a ON a->>'factId'=f->'fact'->>'factId'
  ), replacement AS (
    SELECT f->'fact' AS fact,a AS assessment
    FROM jsonb_array_elements(va_replacement.body->'basis'->'facts') f
    JOIN jsonb_array_elements(va_replacement.body->'calculation'->'assessments') a ON a->>'factId'=f->'fact'->>'factId'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'factId',coalesce(o.fact->>'factId',n.fact->>'factId'),
    'original',CASE WHEN o.fact IS NOT NULL THEN jsonb_build_object('revisionId',o.fact->>'id','revision',o.fact->'revision','assessment',o.assessment) END,
    'replacement',CASE WHEN n.fact IS NOT NULL THEN jsonb_build_object('revisionId',n.fact->>'id','revision',n.fact->'revision','assessment',n.assessment) END,
    'sourceChanged',o.fact->>'digest' IS DISTINCT FROM n.fact->>'digest',
    'assessmentChanged',o.assessment IS DISTINCT FROM n.assessment,
    -- Missing/excluded fact contributions are zero in the saved sums. Exclusion reasons remain above.
    'contributionDelta',jsonb_build_object(
      'box05Minor',(coalesce((n.assessment->'contribution'->>'box05Minor')::numeric,0)-coalesce((o.assessment->'contribution'->>'box05Minor')::numeric,0))::text,
      'box10Minor',(coalesce((n.assessment->'contribution'->>'box10Minor')::numeric,0)-coalesce((o.assessment->'contribution'->>'box10Minor')::numeric,0))::text,
      'box48Minor',(coalesce((n.assessment->'contribution'->>'box48Minor')::numeric,0)-coalesce((o.assessment->'contribution'->>'box48Minor')::numeric,0))::text)
    ) ORDER BY coalesce(o.fact->>'factId',n.fact->>'factId') COLLATE "C"),'[]') INTO va_facts
  FROM original o FULL JOIN replacement n ON o.fact->>'factId'=n.fact->>'factId';
  FOREACH va_field IN ARRAY ARRAY['box05','box10','box48','box49'] LOOP
    va_before:=va_original.body->'calculation'->'syntheticBoxes'->va_field;
    va_after:=va_replacement.body->'calculation'->'syntheticBoxes'->va_field;
    -- Unavailable reported values/box49 stay null, never an invented zero or a new rounding rule.
    va_boxes:=va_boxes||jsonb_build_array(jsonb_build_object(
      'box',va_field,'original',va_before,'replacement',va_after,
      'exactDeltaMinor',((va_after->>'exactMinor')::numeric-(va_before->>'exactMinor')::numeric)::text,
      'reportedDeltaKrona',((va_after->>'reportedKrona')::numeric-(va_before->>'reportedKrona')::numeric)::text,
      'residualDeltaMinor',((va_after->>'residualMinor')::numeric-(va_before->>'residualMinor')::numeric)::text));
  END LOOP;
  va_body:=jsonb_build_object('version','vat-draft-impact-v1','scope',va_original.body->'scope',
    'original',va_refs->0,'replacement',va_refs->1,'facts',va_facts,'boxes',va_boxes,
    'filingReady',false,'externalState','not_submitted');
  RETURN va_body||jsonb_build_object('digest',openerp.digest(va_body));
END $$;

REVOKE ALL ON FUNCTION openerp.expense_tax_source_admission(),
  openerp.withdraw_expense_tax_source(text,jsonb,text,text,jsonb),
  openerp.expense_tax_basis(text),
  openerp.expense_tax_assess(text,jsonb,jsonb,jsonb),
  openerp.get_expense_tax_source(text,jsonb,text),
  openerp.expense_tax_inventory(text,jsonb),
  openerp.prepare_expense_tax_snapshot(text,jsonb,text,jsonb),
  openerp.expense_tax_dependencies(text),
  openerp.refuse_withdrawn_expense_vat_link(),
  openerp.vat_return_basis_body(text),
  openerp.seal_vat_return_draft(text,jsonb,text,jsonb,jsonb,jsonb),
  openerp.vat_draft_impact_body(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.withdraw_expense_tax_source(text,jsonb,text,text,jsonb),
  openerp.get_expense_tax_source(text,jsonb,text),
  openerp.expense_tax_inventory(text,jsonb),
  openerp.prepare_expense_tax_snapshot(text,jsonb,text,jsonb),
  openerp.seal_vat_return_draft(text,jsonb,text,jsonb,jsonb,jsonb) TO openerp_runtime;
