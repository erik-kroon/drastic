-- Permanent VAT source withdrawal. Preserve retained fact revisions, draft/amendment bodies and receipts.
-- New draft calculations use v2; saved v1 drafts remain readable and comparable without recalculation.
CREATE TABLE openerp.vat_fact_withdrawals (
  book_id text NOT NULL, fact_id text NOT NULL, revision integer NOT NULL,
  id text NOT NULL, evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,fact_id), UNIQUE(book_id,id),
  FOREIGN KEY(book_id,fact_id,revision) REFERENCES openerp.vat_fact_revisions,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK(body->>'id' IS NOT DISTINCT FROM id),
  CHECK(body->>'factId' IS NOT DISTINCT FROM fact_id),
  CHECK(body->'scope'->>'bookId' IS NOT DISTINCT FROM book_id),
  CHECK(body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_vat_fact_withdrawal BEFORE UPDATE OR DELETE ON openerp.vat_fact_withdrawals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.vat_fact_withdrawals FROM PUBLIC,openerp_runtime;

-- The existing record_vat_fact command replays before inserting a revision. Fence only new writes.
-- Taking its existing book barrier also orders this fence against withdrawal.
CREATE FUNCTION openerp.refuse_withdrawn_vat_fact_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.vat_fact_withdrawals w WHERE w.book_id=NEW.book_id AND w.fact_id=NEW.fact_id) THEN
    PERFORM openerp.fail('StaleDependency','This VAT source identity is permanently withdrawn. Its history remains readable; new revisions and reactivation are refused.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refuse_withdrawn_vat_fact_revision BEFORE INSERT ON openerp.vat_fact_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.refuse_withdrawn_vat_fact_revision();

CREATE FUNCTION openerp.withdraw_vat_fact(token text,scope jsonb,id text,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE w_actor text; w_previous jsonb; w_current jsonb; w_sha text; w_body jsonb;
  w_payload jsonb:=jsonb_build_object('id',id,'input',input);
BEGIN
  w_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  w_previous:=openerp.replay(scope->>'bookId',key,w_actor,'withdraw_vat_fact',w_payload);
  IF w_previous IS NOT NULL THEN RETURN w_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['expectedDigest','evidenceId','rationale']);
  IF id IS NULL OR id !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(input->'expectedDigest') IS DISTINCT FROM 'string' OR input->>'expectedDigest' !~ '^sha256:[a-f0-9]{64}$'
    OR jsonb_typeof(input->'evidenceId') IS DISTINCT FROM 'string' OR input->>'evidenceId' !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string' OR length(btrim(input->>'rationale')) NOT BETWEEN 1 AND 2000
    OR length(input->>'rationale')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Supply the exact VAT fact digest, retained withdrawal evidence and a reason.');
  END IF;
  SELECT r.body INTO w_current FROM openerp.vat_fact_revisions r
    WHERE r.book_id=scope->>'bookId' AND r.fact_id=withdraw_vat_fact.id ORDER BY r.revision DESC LIMIT 1;
  IF w_current IS NULL THEN PERFORM openerp.fail('NotFound','The VAT source fact is not in this book.'); END IF;
  IF input->>'expectedDigest' IS DISTINCT FROM w_current->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Reload the current VAT fact revision before withdrawing it.'); END IF;
  IF EXISTS(SELECT FROM openerp.vat_fact_withdrawals w WHERE w.book_id=scope->>'bookId' AND w.fact_id=withdraw_vat_fact.id) THEN
    PERFORM openerp.fail('StaleDependency','This VAT source is already permanently withdrawn. Read its retained withdrawal or replay its original command.'); END IF;
  SELECT e.sha256 INTO w_sha FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=input->>'evidenceId';
  IF w_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain the withdrawal evidence in this book first.'); END IF;
  w_body:=jsonb_build_object('id',openerp.new_id('vatwithdrawal'),'scope',scope,'factId',id,
    'revisionId',w_current->>'id','revision',w_current->'revision','revisionDigest',w_current->>'digest',
    'input',input,'evidenceSha256',w_sha,'permanent',true,
    'recordedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','withdraw_vat_fact','actorId',w_actor));
  w_body:=w_body||jsonb_build_object('digest',openerp.digest(w_body));
  INSERT INTO openerp.vat_fact_withdrawals VALUES(scope->>'bookId',id,(w_current->>'revision')::integer,w_body->>'id',input->>'evidenceId',w_body);
  RETURN openerp.save_command(scope->>'bookId',key,w_actor,'withdraw_vat_fact',w_payload,w_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.vat_return_basis_body(book text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE vr_book openerp.books; vr_facts jsonb; vr_body jsonb;
BEGIN
  SELECT * INTO STRICT vr_book FROM openerp.books b WHERE b.id=book;
  IF (SELECT count(*) FROM openerp.vat_fact_components c WHERE c.book_id=book)>200 THEN PERFORM openerp.fail('UnsupportedProfile','VAT inventory exceeds its complete-read bound.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('fact',r.body,
    'withdrawal',w.body,
    'expenseLinkCurrent',CASE WHEN r.body->'input'->'expenseLink'='null'::jsonb THEN true ELSE
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

CREATE OR REPLACE FUNCTION openerp.get_vat_fact(token text, scope jsonb, id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE vr_history jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO vr_history FROM openerp.vat_fact_revisions r WHERE r.book_id=scope->>'bookId' AND r.fact_id=get_vat_fact.id;
  IF vr_history IS NULL THEN PERFORM openerp.fail('NotFound','The VAT fact is not in this book.'); END IF;
  RETURN jsonb_build_object('current',vr_history->-1,'history',vr_history,
    'withdrawal',(SELECT w.body FROM openerp.vat_fact_withdrawals w WHERE w.book_id=scope->>'bookId' AND w.fact_id=get_vat_fact.id));
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
  IF calculation->>'engine' IS DISTINCT FROM 'vat-return-draft-v2' OR jsonb_typeof(calculation->'assessments') IS DISTINCT FROM 'array'
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
        OR f.body->'fact'->'input'->>'recordClass'<>'synthetic' OR f.body->'withdrawal' IS DISTINCT FROM 'null'::jsonb))) THEN
    PERFORM openerp.fail('InvalidJournal','Calculation lineage and synthetic class must match the sealed source inventory.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(calculation->'assessments') WITH ORDINALITY a(body,n)
    JOIN jsonb_array_elements(basis->'facts') WITH ORDINALITY f(body,n) USING(n)
    WHERE f.body->'withdrawal' IS DISTINCT FROM 'null'::jsonb
      AND (a.body->>'state' IS DISTINCT FROM 'excluded'
        OR a.body->'contribution' IS DISTINCT FROM 'null'::jsonb
        OR NOT coalesce(a.body->'blockers' ? 'withdrawn_fact',false))) THEN
    PERFORM openerp.fail('InvalidJournal','Every withdrawn fact must remain explicitly excluded, with withdrawal lineage retained in the basis.');
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

-- Compare retained v1 and withdrawal-aware v2 results, never recalculate either historical draft.
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
      OR coalesce(va_draft->'calculation'->>'engine','') NOT IN ('vat-return-draft-v1','vat-return-draft-v2')
      OR jsonb_typeof(va_draft->'calculation'->'syntheticBoxes') IS DISTINCT FROM 'object' THEN
      PERFORM openerp.fail('UnsupportedProfile','Only retained SEK synthetic-core-v1 demonstrations from vat-return-draft-v1/v2 can be compared.');
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

REVOKE ALL ON FUNCTION openerp.refuse_withdrawn_vat_fact_revision(),openerp.withdraw_vat_fact(text,jsonb,text,text,jsonb)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.withdraw_vat_fact(text,jsonb,text,text,jsonb) TO openerp_runtime;
