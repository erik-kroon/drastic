-- Bounded VAT review drafts. No legal profile, ledger writes, return filing or XML export.
CREATE TABLE openerp.vat_fact_components (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, source_key text NOT NULL,
  record_class text NOT NULL CHECK(record_class IN ('actual_company','synthetic')),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,source_key)
);
CREATE TABLE openerp.vat_fact_revisions (
  book_id text NOT NULL, fact_id text NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 20),
  id text NOT NULL, evidence_id text NOT NULL, review_evidence_id text NOT NULL, voucher_id text, body jsonb NOT NULL,
  PRIMARY KEY(book_id,fact_id,revision), UNIQUE(book_id,id),
  FOREIGN KEY(book_id,fact_id) REFERENCES openerp.vat_fact_components,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  FOREIGN KEY(book_id,review_evidence_id) REFERENCES openerp.evidence,
  FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers
);
CREATE TABLE openerp.vat_return_drafts (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 500),
  body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,ordinal)
);
CREATE TRIGGER immutable_vat_fact_component BEFORE UPDATE OR DELETE ON openerp.vat_fact_components FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_fact_revision BEFORE UPDATE OR DELETE ON openerp.vat_fact_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_return_draft BEFORE UPDATE OR DELETE ON openerp.vat_return_drafts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.record_vat_fact(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE vr_actor text; vr_previous jsonb; vr_current jsonb; vr_component openerp.vat_fact_components;
  vr_field text; vr_refs jsonb := '[]'; vr_sha text; vr_voucher jsonb; vr_source jsonb; vr_review jsonb;
  vr_revision integer; vr_body jsonb;
BEGIN
  vr_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  vr_previous:=openerp.replay(scope->>'bookId',key,vr_actor,'record_vat_fact',input);
  IF vr_previous IS NOT NULL THEN RETURN vr_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['sourceKey','expectedDigest','recordClass','evidenceId','sourceLocator','description',
    'reviewEvidenceId','reviewRationale','treatment','netMinor','vatMinor','grossMinor','currency','issuedOn','receivedOn','suppliedOn','taxPointOn',
    'dateBasis','periodEvidenceId','registration','registrationEvidenceId','method','methodEvidenceId','domesticEligibility','treatmentEvidenceId',
    'fullDeduction','deductionEvidenceId','voucherId','taxLineIds','expenseLink']);
  IF jsonb_typeof(input->'sourceKey') IS DISTINCT FROM 'string' OR coalesce(input->>'sourceKey','') !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a stable source component key.'); END IF;
  FOREACH vr_field IN ARRAY ARRAY['recordClass','treatment','registration','method','domesticEligibility','fullDeduction','sourceLocator','description','reviewRationale'] LOOP
    IF jsonb_typeof(input->vr_field) IS DISTINCT FROM 'string' OR length(input->>vr_field) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal','Supply explicit review states and source/review descriptions.'); END IF;
  END LOOP;
  IF input->>'recordClass' NOT IN ('actual_company','synthetic') OR input->>'treatment' NOT IN ('unknown','domestic_sale','domestic_purchase','unsupported')
    OR input->>'registration' NOT IN ('unknown','registered','not_registered') OR input->>'method' NOT IN ('unknown','accrual','cash')
    OR input->>'domesticEligibility' NOT IN ('unknown','confirmed','unsupported') OR input->>'fullDeduction' NOT IN ('unknown','confirmed','unsupported') THEN
    PERFORM openerp.fail('InvalidJournal','Unsupported review state. Unknown eligibility must remain explicit.'); END IF;
  FOREACH vr_field IN ARRAY ARRAY['netMinor','vatMinor','grossMinor'] LOOP
    IF input->vr_field='null'::jsonb THEN PERFORM openerp.fail('InvalidJournal','VAT fact capture requires exact source amounts.'); END IF;
    PERFORM openerp.expense_tax_minor(input->vr_field);
  END LOOP;
  IF input->'currency'<>'null'::jsonb AND (jsonb_typeof(input->'currency')<>'string' OR input->>'currency' !~ '^[A-Z]{3}$') THEN
    PERFORM openerp.fail('InvalidJournal','Supply a three-letter source currency or null.'); END IF;
  IF input->'dateBasis'<>'null'::jsonb AND (jsonb_typeof(input->'dateBasis')<>'string' OR length(input->>'dateBasis') NOT BETWEEN 1 AND 2000) THEN
    PERFORM openerp.fail('InvalidJournal','Supply a date basis or null.'); END IF;
  FOREACH vr_field IN ARRAY ARRAY['issuedOn','receivedOn','suppliedOn','taxPointOn'] LOOP PERFORM openerp.expense_tax_date(input->vr_field); END LOOP;
  FOREACH vr_field IN ARRAY ARRAY['evidenceId','reviewEvidenceId','periodEvidenceId','registrationEvidenceId','methodEvidenceId','treatmentEvidenceId','deductionEvidenceId'] LOOP
    IF vr_field IN ('evidenceId','reviewEvidenceId') AND input->vr_field='null'::jsonb THEN PERFORM openerp.fail('MissingEvidence','Source and review evidence are required.'); END IF;
    IF input->vr_field<>'null'::jsonb THEN
      IF jsonb_typeof(input->vr_field)<>'string' OR input->>vr_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN PERFORM openerp.fail('InvalidJournal','Use scoped evidence identifiers.'); END IF;
      SELECT e.sha256 INTO vr_sha FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=input->>vr_field;
      IF vr_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain every cited source and review basis in this book first.'); END IF;
      vr_refs:=vr_refs||jsonb_build_array(jsonb_build_object('evidenceId',input->>vr_field,'sha256',vr_sha));
    END IF;
  END LOOP;
  IF input->'voucherId'<>'null'::jsonb AND (jsonb_typeof(input->'voucherId')<>'string' OR input->>'voucherId' !~ '^[a-z][a-z0-9_-]{2,127}$') THEN
    PERFORM openerp.fail('InvalidJournal','Use a posted voucher identifier or null.'); END IF;
  IF jsonb_typeof(input->'taxLineIds') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'taxLineIds')>20 THEN
    PERFORM openerp.fail('InvalidJournal','Select at most 20 tax journal lines.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(input->'taxLineIds') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[a-z][a-z0-9_-]{2,127}$')
    OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements_text(input->'taxLineIds') x) THEN
    PERFORM openerp.fail('InvalidJournal','Tax journal lines must be distinct identifiers.'); END IF;
  IF input->>'voucherId' IS NULL AND jsonb_array_length(input->'taxLineIds')>0 THEN PERFORM openerp.fail('InvalidJournal','Tax lines require their posted voucher.'); END IF;
  IF input->>'voucherId' IS NOT NULL THEN
    SELECT v.action INTO vr_voucher FROM openerp.vouchers v WHERE v.book_id=scope->>'bookId' AND v.id=input->>'voucherId';
    IF vr_voucher IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(vr_voucher->'evidenceRefs') e WHERE e->>'evidenceId'=input->>'evidenceId') THEN
      PERFORM openerp.fail('MissingEvidence','The posted voucher must exist in this book and cite the source evidence.'); END IF;
    IF EXISTS(SELECT FROM jsonb_array_elements_text(input->'taxLineIds') x(id) WHERE NOT EXISTS(SELECT FROM openerp.journal_lines l
      WHERE l.book_id=scope->>'bookId' AND l.voucher_id=input->>'voucherId' AND l.id=x.id)) THEN
      PERFORM openerp.fail('NotFound','A selected tax line is not in this posted voucher.'); END IF;
  END IF;
  IF input->'expenseLink'<>'null'::jsonb THEN
    PERFORM openerp.expense_tax_shape(input->'expenseLink',ARRAY['sourceId','sourceDigest','reviewDigest']);
    vr_source:=openerp.expense_tax_current(scope->>'bookId',input->'expenseLink'->>'sourceId');
    vr_review:=openerp.expense_tax_latest_review(scope->>'bookId',input->'expenseLink'->>'sourceId');
    IF input->>'treatment'<>'domestic_purchase' OR input->'expenseLink'->>'sourceDigest' IS DISTINCT FROM vr_source->>'digest'
      OR input->'expenseLink'->>'reviewDigest' IS DISTINCT FROM vr_review->>'digest' OR vr_review->>'sourceDigest' IS DISTINCT FROM vr_source->>'digest' THEN
      PERFORM openerp.fail('StaleDependency','Link a current reviewed expense purchase, with exact source and review digests.'); END IF;
    IF vr_source->'facts'->>'recordClass' IS DISTINCT FROM input->>'recordClass' OR vr_source->'facts'->>'evidenceId' IS DISTINCT FROM input->>'evidenceId'
      OR vr_source->'facts'->>'voucherId' IS DISTINCT FROM input->>'voucherId' OR vr_source->'facts'->>'currency' IS DISTINCT FROM input->>'currency'
      OR vr_source->'facts'->'currencyScale' IS DISTINCT FROM '2'::jsonb
      OR vr_source->'facts'->>'sourceLocator' IS DISTINCT FROM input->>'sourceLocator'
      OR vr_source->'facts'->>'issuedOn' IS DISTINCT FROM input->>'issuedOn' OR vr_source->'facts'->>'receivedOn' IS DISTINCT FROM input->>'receivedOn'
      OR vr_review->'facts'->>'suppliedOn' IS DISTINCT FROM input->>'suppliedOn'
      OR (input->>'domesticEligibility'='confirmed' AND (vr_source->'facts'->>'supplierJurisdiction' IS DISTINCT FROM 'SE'
        OR vr_source->'facts'->>'supplyJurisdiction' IS DISTINCT FROM 'SE' OR vr_review->'facts'->>'bookJurisdiction' IS DISTINCT FROM 'SE'))
      OR (input->>'fullDeduction'='confirmed' AND (vr_review->'facts'->>'deductionDenominator' IS NULL
        OR vr_review->'facts'->>'deductionNumerator' IS DISTINCT FROM vr_review->'facts'->>'deductionDenominator'))
      OR vr_source->'facts'->'amounts' IS DISTINCT FROM jsonb_build_object('netMinor',input->'netMinor','vatMinor',input->'vatMinor','grossMinor',input->'grossMinor')
      OR vr_review->'facts'->'amounts' IS DISTINCT FROM vr_source->'facts'->'amounts'
      OR vr_review->'facts'->>'treatment' IS DISTINCT FROM 'domestic_purchase'
      OR vr_review->'facts'->>'registration' IS DISTINCT FROM input->>'registration' OR vr_review->'facts'->>'method' IS DISTINCT FROM input->>'method'
      OR vr_review->'facts'->>'taxPointOn' IS DISTINCT FROM input->>'taxPointOn' THEN
      PERFORM openerp.fail('InvalidJournal','Expense linkage must preserve class, amounts, evidence, voucher and compatible reviewed treatment/date.'); END IF;
  END IF;
  SELECT c.* INTO vr_component FROM openerp.vat_fact_components c WHERE c.book_id=scope->>'bookId' AND c.source_key=input->>'sourceKey';
  IF FOUND THEN
    SELECT r.body INTO vr_current FROM openerp.vat_fact_revisions r WHERE r.book_id=scope->>'bookId' AND r.fact_id=vr_component.id ORDER BY r.revision DESC LIMIT 1;
    IF input->>'expectedDigest' IS DISTINCT FROM vr_current->>'digest' THEN PERFORM openerp.fail('StaleDependency','Reload the current VAT fact before appending a revision.'); END IF;
    IF input->>'recordClass'<>vr_component.record_class THEN PERFORM openerp.fail('InvalidJournal','A VAT source cannot change its actual/synthetic class.'); END IF;
    vr_revision:=(vr_current->>'revision')::integer+1;
    IF vr_revision>20 THEN PERFORM openerp.fail('UnsupportedProfile','This VAT source reached its 20-revision bound.'); END IF;
  ELSE
    IF input->'expectedDigest'<>'null'::jsonb THEN PERFORM openerp.fail('StaleDependency','A new fact cannot claim a prior digest.'); END IF;
    IF (SELECT count(*) FROM openerp.vat_fact_components c WHERE c.book_id=scope->>'bookId')>=200 THEN
      PERFORM openerp.fail('UnsupportedProfile','The bounded VAT inventory supports 200 components; none was omitted.'); END IF;
    INSERT INTO openerp.vat_fact_components VALUES(scope->>'bookId',openerp.new_id('vatfact'),input->>'sourceKey',input->>'recordClass') RETURNING * INTO vr_component;
    vr_revision:=1;
  END IF;
  vr_body:=jsonb_build_object('id',openerp.new_id('vatfactrev'),'factId',vr_component.id,'revision',vr_revision,'previousDigest',vr_current->>'digest',
    'scope',scope,'input',input,'evidenceRefs',vr_refs,'expenseSourceDigest',vr_source->>'digest','expenseReviewDigest',vr_review->>'digest',
    'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','record_vat_fact','actorId',vr_actor));
  vr_body:=vr_body||jsonb_build_object('digest',openerp.digest(vr_body));
  INSERT INTO openerp.vat_fact_revisions VALUES(scope->>'bookId',vr_component.id,vr_revision,vr_body->>'id',input->>'evidenceId',input->>'reviewEvidenceId',input->>'voucherId',vr_body);
  RETURN openerp.save_command(scope->>'bookId',key,vr_actor,'record_vat_fact',input,vr_body);
END $$;

-- Owning callers must already hold a shared or exclusive book lock.
CREATE FUNCTION openerp.vat_return_basis_body(book text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE vr_book openerp.books; vr_facts jsonb; vr_body jsonb;
BEGIN
  SELECT * INTO STRICT vr_book FROM openerp.books b WHERE b.id=book;
  IF (SELECT count(*) FROM openerp.vat_fact_components c WHERE c.book_id=book)>200 THEN PERFORM openerp.fail('UnsupportedProfile','VAT inventory exceeds its complete-read bound.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('fact',r.body,
    'expenseLinkCurrent',CASE WHEN r.body->'input'->'expenseLink'='null'::jsonb THEN true ELSE
      openerp.expense_tax_current(book,r.body->'input'->'expenseLink'->>'sourceId')->>'digest'=r.body->>'expenseSourceDigest'
      AND openerp.expense_tax_latest_review(book,r.body->'input'->'expenseLink'->>'sourceId')->>'digest'=r.body->>'expenseReviewDigest' END,
    'voucherReversed',coalesce(v.posting_purpose='reversal',false) OR EXISTS(SELECT FROM openerp.vouchers x WHERE x.book_id=book AND x.corrects_voucher_id=r.voucher_id AND x.posting_purpose='reversal'),
    'voucherPostingDate',v.posting_date::text,
    'taxLines',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'accountId',l.account_id,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text) ORDER BY l.ordinal)
      FROM openerp.journal_lines l WHERE l.book_id=book AND l.voucher_id=r.voucher_id AND r.body->'input'->'taxLineIds' ? l.id),'[]')) ORDER BY c.id COLLATE "C"),'[]')
    INTO vr_facts FROM openerp.vat_fact_components c JOIN LATERAL(SELECT x.* FROM openerp.vat_fact_revisions x WHERE x.book_id=book AND x.fact_id=c.id ORDER BY x.revision DESC LIMIT 1) r ON true
    LEFT JOIN openerp.vouchers v ON v.book_id=book AND v.id=r.voucher_id WHERE c.book_id=book;
  vr_body:=jsonb_build_object('bookSequence',vr_book.committed_sequence::text,'bookProfile',vr_book.profile,'bookProfileVersion',vr_book.profile_version::text,
    'currency',vr_book.currency,'currencyScale',vr_book.currency_scale,'facts',vr_facts);
  RETURN vr_body||jsonb_build_object('digest',openerp.digest(vr_body));
END $$;
CREATE FUNCTION openerp.vat_return_basis(token text, scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  RETURN openerp.vat_return_basis_body(scope->>'bookId');
END $$;
CREATE FUNCTION openerp.get_vat_fact(token text, scope jsonb, id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE vr_history jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO vr_history FROM openerp.vat_fact_revisions r WHERE r.book_id=scope->>'bookId' AND r.fact_id=get_vat_fact.id;
  IF vr_history IS NULL THEN PERFORM openerp.fail('NotFound','The VAT fact is not in this book.'); END IF;
  RETURN jsonb_build_object('current',vr_history->-1,'history',vr_history);
END $$;

CREATE FUNCTION openerp.seal_vat_return_draft(token text, scope jsonb, key text, input jsonb, basis jsonb, calculation jsonb) RETURNS jsonb
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
  IF calculation->>'engine' IS DISTINCT FROM 'vat-return-draft-v1' OR jsonb_typeof(calculation->'assessments') IS DISTINCT FROM 'array'
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
        OR f.body->'fact'->'input'->>'recordClass'<>'synthetic'))) THEN
    PERFORM openerp.fail('InvalidJournal','Calculation lineage and synthetic class must match the sealed source inventory.'); END IF;
  SELECT count(*)+1 INTO vr_ordinal FROM openerp.vat_return_drafts d WHERE d.book_id=scope->>'bookId';
  IF vr_ordinal>500 THEN PERFORM openerp.fail('UnsupportedProfile','This bounded review supports 500 saved drafts; no history was deleted.'); END IF;
  vr_body:=jsonb_build_object('id',openerp.new_id('vatdraft'),'scope',scope,'input',input,'basis',basis,'calculation',calculation,'periodEvidenceSha256',vr_sha,
    'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','prepare_vat_return_draft','actorId',vr_actor));
  vr_body:=vr_body||jsonb_build_object('digest',openerp.digest(vr_body));
  INSERT INTO openerp.vat_return_drafts VALUES(scope->>'bookId',vr_body->>'id',vr_ordinal,vr_body);
  RETURN openerp.save_command(scope->>'bookId',key,vr_actor,'prepare_vat_return_draft',input,vr_body);
END $$;
CREATE FUNCTION openerp.get_vat_return_draft(token text, scope jsonb, id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE vr_body jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT d.body INTO vr_body FROM openerp.vat_return_drafts d WHERE d.book_id=scope->>'bookId' AND d.id=get_vat_return_draft.id;
  IF vr_body IS NULL THEN PERFORM openerp.fail('NotFound','The VAT draft is not in this book.'); END IF;
  RETURN jsonb_build_object('draft',vr_body,'basisCurrent',vr_body->'basis'->>'digest'=openerp.vat_return_basis_body(scope->>'bookId')->>'digest');
END $$;
CREATE FUNCTION openerp.list_vat_return_drafts(token text, scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE vr_items jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF (SELECT count(*) FROM openerp.vat_return_drafts d WHERE d.book_id=scope->>'bookId')>500 THEN PERFORM openerp.fail('UnsupportedProfile','VAT draft list exceeds its complete-read bound.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'digest',d.body->>'digest','input',d.body->'input','recordedAt',d.body->>'recordedAt') ORDER BY d.ordinal DESC),'[]')
    INTO vr_items FROM openerp.vat_return_drafts d WHERE d.book_id=scope->>'bookId';
  RETURN jsonb_build_object('items',vr_items);
END $$;
-- Private hook for closing/accountant owners, under their existing book lock.
CREATE FUNCTION openerp.vat_return_dependencies(book text) RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE vr_basis jsonb; vr_drafts integer;
BEGIN
  vr_basis:=openerp.vat_return_basis_body(book);
  SELECT count(*) INTO vr_drafts FROM openerp.vat_return_drafts d WHERE d.book_id=book;
  IF vr_drafts>500 THEN PERFORM openerp.fail('UnsupportedProfile','VAT draft inventory exceeds its bound.'); END IF;
  RETURN jsonb_build_object('basisDigest',vr_basis->>'digest','sourceCount',jsonb_array_length(vr_basis->'facts'),'draftCount',vr_drafts,
    'coverageEstablished',false,'ledgerReconciled',false,'legalProfileActive',false,'filingReady',false);
END $$;
REVOKE ALL ON openerp.vat_fact_components,openerp.vat_fact_revisions,openerp.vat_return_drafts FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.vat_return_basis_body(text),openerp.vat_return_dependencies(text),
  openerp.record_vat_fact(text,jsonb,text,jsonb),openerp.vat_return_basis(text,jsonb),openerp.get_vat_fact(text,jsonb,text),
  openerp.seal_vat_return_draft(text,jsonb,text,jsonb,jsonb,jsonb),openerp.get_vat_return_draft(text,jsonb,text),openerp.list_vat_return_drafts(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.record_vat_fact(text,jsonb,text,jsonb),openerp.vat_return_basis(text,jsonb),openerp.get_vat_fact(text,jsonb,text),
  openerp.seal_vat_return_draft(text,jsonb,text,jsonb,jsonb,jsonb),openerp.get_vat_return_draft(text,jsonb,text),openerp.list_vat_return_drafts(text,jsonb) TO openerp_runtime;
