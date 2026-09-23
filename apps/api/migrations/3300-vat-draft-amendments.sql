-- Internal synthetic draft amendments only. No filing, submission, settlement or legal activation.
-- Requires immutable VAT facts/drafts from1000. Historical migrations remain unchanged.
CREATE TABLE openerp.vat_draft_amendments (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 500),
  original_draft_id text NOT NULL,
  replacement_draft_id text NOT NULL,
  review_evidence_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), UNIQUE (book_id,ordinal),
  UNIQUE (book_id,original_draft_id,replacement_draft_id),
  CHECK (original_draft_id <> replacement_draft_id),
  FOREIGN KEY (book_id,original_draft_id) REFERENCES openerp.vat_return_drafts,
  FOREIGN KEY (book_id,replacement_draft_id) REFERENCES openerp.vat_return_drafts,
  FOREIGN KEY (book_id,review_evidence_id) REFERENCES openerp.evidence
);
CREATE TRIGGER immutable_vat_draft_amendment BEFORE UPDATE OR DELETE ON openerp.vat_draft_amendments
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- Private comparison of retained output, not another tax calculator. The caller holds the book lock.
CREATE FUNCTION openerp.vat_draft_impact_body(p_book text,p_input jsonb) RETURNS jsonb
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
      OR va_draft->'calculation'->>'engine' IS DISTINCT FROM 'vat-return-draft-v1'
      OR jsonb_typeof(va_draft->'calculation'->'syntheticBoxes') IS DISTINCT FROM 'object' THEN
      PERFORM openerp.fail('UnsupportedProfile','Only retained SEK synthetic-core-v1 demonstrations from vat-return-draft-v1 can be compared.');
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

CREATE FUNCTION openerp.compare_vat_drafts(token text,scope jsonb,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE va_impact jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  va_impact:=openerp.vat_draft_impact_body(scope->>'bookId',input);
  RETURN jsonb_build_object('impact',va_impact,'replacementBasisCurrent',
    va_impact->'replacement'->>'basisDigest'=openerp.vat_return_basis_body(scope->>'bookId')->>'digest');
END $$;

CREATE FUNCTION openerp.review_vat_amendment(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE va_actor text; va_previous jsonb; va_impact jsonb; va_sha text; va_body jsonb; va_ordinal integer;
BEGIN
  va_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  va_previous:=openerp.replay(scope->>'bookId',key,va_actor,'review_vat_amendment',input);
  IF va_previous IS NOT NULL THEN RETURN va_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['originalDraftId','originalDraftDigest','replacementDraftId','replacementDraftDigest',
    'expectedImpactDigest','reviewEvidenceId','rationale']);
  IF jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string' OR length(btrim(input->>'rationale')) NOT BETWEEN 1 AND 2000
    OR length(input->>'rationale')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Explain the reviewed internal draft amendment.');
  END IF;
  IF jsonb_typeof(input->'expectedImpactDigest') IS DISTINCT FROM 'string' OR input->>'expectedImpactDigest' !~ '^sha256:[a-f0-9]{64}$'
    OR jsonb_typeof(input->'reviewEvidenceId') IS DISTINCT FROM 'string' OR input->>'reviewEvidenceId' !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Pin the reviewed impact digest and retained review evidence.');
  END IF;
  va_impact:=openerp.vat_draft_impact_body(scope->>'bookId',input-'expectedImpactDigest'-'reviewEvidenceId'-'rationale');
  IF va_impact->>'digest' IS DISTINCT FROM input->>'expectedImpactDigest' THEN
    PERFORM openerp.fail('StaleDependency','Compare the exact draft versions and review that impact before recording the relationship.');
  END IF;
  IF va_impact->'replacement'->>'basisDigest' IS DISTINCT FROM openerp.vat_return_basis_body(scope->>'bookId')->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','The replacement draft is no longer current. Prepare and compare a new draft. Historical drafts remain unchanged.');
  END IF;
  SELECT e.sha256 INTO va_sha FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=input->>'reviewEvidenceId';
  IF va_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain the operator review evidence in this book.'); END IF;
  IF EXISTS(SELECT FROM openerp.vat_draft_amendments a WHERE a.book_id=scope->>'bookId'
    AND a.original_draft_id=input->>'originalDraftId' AND a.replacement_draft_id=input->>'replacementDraftId') THEN
    PERFORM openerp.fail('IdempotencyConflict','This draft pair already has an immutable review. Read it or replay its original command.');
  END IF;
  SELECT count(*)+1 INTO va_ordinal FROM openerp.vat_draft_amendments a WHERE a.book_id=scope->>'bookId';
  IF va_ordinal>500 THEN PERFORM openerp.fail('UnsupportedProfile','The bounded VAT amendment inventory supports 500 reviews; none was removed.'); END IF;
  va_body:=jsonb_build_object('id',openerp.new_id('vatamendment'),'scope',scope,'input',input,'impact',va_impact,
    'reviewEvidenceSha256',va_sha,'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','review_vat_amendment','actorId',va_actor),
    'state','reviewed_internal_amendment','filingReady',false,'externalState','not_submitted');
  va_body:=va_body||jsonb_build_object('digest',openerp.digest(va_body));
  INSERT INTO openerp.vat_draft_amendments VALUES(scope->>'bookId',va_body->>'id',va_ordinal,
    input->>'originalDraftId',input->>'replacementDraftId',input->>'reviewEvidenceId',va_body);
  RETURN openerp.save_command(scope->>'bookId',key,va_actor,'review_vat_amendment',input,va_body);
END $$;

CREATE FUNCTION openerp.get_vat_amendment(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE va_row openerp.vat_draft_amendments; va_original jsonb; va_replacement jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT a.* INTO va_row FROM openerp.vat_draft_amendments a WHERE a.book_id=scope->>'bookId' AND a.id=get_vat_amendment.id;
  IF va_row.id IS NULL THEN PERFORM openerp.fail('NotFound','The VAT draft amendment is not in this book.'); END IF;
  SELECT d.body INTO va_original FROM openerp.vat_return_drafts d WHERE d.book_id=scope->>'bookId' AND d.id=va_row.original_draft_id;
  SELECT d.body INTO va_replacement FROM openerp.vat_return_drafts d WHERE d.book_id=scope->>'bookId' AND d.id=va_row.replacement_draft_id;
  RETURN jsonb_build_object('amendment',va_row.body,'originalDraft',va_original,'replacementDraft',va_replacement,
    'replacementBasisCurrent',va_replacement->'basis'->>'digest'=openerp.vat_return_basis_body(scope->>'bookId')->>'digest');
END $$;

CREATE FUNCTION openerp.list_vat_amendments(token text,scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE va_items jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF (SELECT count(*) FROM openerp.vat_draft_amendments a WHERE a.book_id=scope->>'bookId')>500 THEN
    PERFORM openerp.fail('UnsupportedProfile','The VAT amendment inventory exceeds its complete-read bound.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'digest',a.body->>'digest',
    'originalDraftId',a.original_draft_id,'replacementDraftId',a.replacement_draft_id,'recordedAt',a.body->>'recordedAt') ORDER BY a.ordinal DESC),'[]')
    INTO va_items FROM openerp.vat_draft_amendments a WHERE a.book_id=scope->>'bookId';
  RETURN jsonb_build_object('items',va_items);
END $$;

REVOKE ALL ON openerp.vat_draft_amendments FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.vat_draft_impact_body(text,jsonb),openerp.compare_vat_drafts(text,jsonb,jsonb),
  openerp.review_vat_amendment(text,jsonb,text,jsonb),openerp.get_vat_amendment(text,jsonb,text),openerp.list_vat_amendments(text,jsonb)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.compare_vat_drafts(text,jsonb,jsonb),openerp.review_vat_amendment(text,jsonb,text,jsonb),
  openerp.get_vat_amendment(text,jsonb,text),openerp.list_vat_amendments(text,jsonb) TO openerp_runtime;
