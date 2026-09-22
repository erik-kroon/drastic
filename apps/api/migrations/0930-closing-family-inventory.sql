-- END-01: forward-only family applicability inventory. Historical0800/0820 records stay unchanged.
-- New close proposals require complete declarations. Reopen and committed replays retain their existing protocols.
CREATE OR REPLACE FUNCTION openerp.declare_closing_inventory(token text, scope jsonb, period_id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_payload jsonb; c_body jsonb; c_evidence openerp.evidence; c_family jsonb; c_families jsonb:='[]'; c_reviewed date; c_revision bigint;
BEGIN
  c_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  c_payload:=jsonb_build_object('periodId',period_id,'input',input);
  c_previous:=openerp.replay(scope->>'bookId',key,c_actor,'declare_closing_inventory',c_payload);
  IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
  PERFORM openerp.bank_require_profile(scope->>'bookId');
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId' AND p.id=period_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period was not found in this book.'); END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-'evidenceId'-'bankAccountIds'-'families'<>'{}'::jsonb
    OR jsonb_typeof(input->'bankAccountIds') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Declare expected bank accounts and retained inventory evidence.'); END IF;
  IF jsonb_array_length(input->'bankAccountIds')>100
    OR EXISTS(SELECT FROM jsonb_array_elements(input->'bankAccountIds') a WHERE jsonb_typeof(a) IS DISTINCT FROM 'string')
    OR (SELECT count(DISTINCT a) FROM jsonb_array_elements_text(input->'bankAccountIds') a)<>jsonb_array_length(input->'bankAccountIds')
    OR EXISTS(SELECT FROM jsonb_array_elements_text(input->'bankAccountIds') a(account_id)
      WHERE NOT EXISTS(SELECT FROM openerp.accounts ac WHERE ac.book_id=scope->>'bookId' AND ac.id=a.account_id)) THEN
    PERFORM openerp.fail('InvalidJournal','Declare at most100 distinct existing book accounts. An empty list is an explicit synthetic no-bank declaration.'); END IF;
  IF input ? 'families' THEN
    IF jsonb_typeof(input->'families') IS DISTINCT FROM 'array' THEN
      PERFORM openerp.fail('InvalidJournal','Supply every close family exactly once.'); END IF;
    IF jsonb_array_length(input->'families')<>10 THEN
      PERFORM openerp.fail('InvalidJournal','Supply every close family exactly once.'); END IF;
    FOR c_family IN SELECT value FROM jsonb_array_elements(input->'families') LOOP
      IF jsonb_typeof(c_family) IS DISTINCT FROM 'object' THEN
        PERFORM openerp.fail('InvalidJournal','Each family decision must be an object.'); END IF;
      IF c_family-ARRAY['family','status','reviewedOn','evidenceId','rationale']<>'{}'::jsonb
        OR jsonb_typeof(c_family->'family') IS DISTINCT FROM 'string'
        OR NOT coalesce(c_family->>'family'=ANY(ARRAY['bank_sources','invoices','tax','payroll','assets_deferrals',
          'foreign_currency','owner_balances','other_balances','external_schedules','disclosures']),false)
        OR jsonb_typeof(c_family->'status') IS DISTINCT FROM 'string'
        OR NOT coalesce(c_family->>'status'=ANY(ARRAY['required','not_applicable','unsupported','unknown']),false)
        OR jsonb_typeof(c_family->'rationale') IS DISTINCT FROM 'string'
        OR length(btrim(coalesce(c_family->>'rationale',''))) NOT BETWEEN 1 AND 2000
        OR jsonb_typeof(c_family->'reviewedOn') IS DISTINCT FROM 'string'
        OR coalesce(c_family->>'reviewedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        PERFORM openerp.fail('InvalidJournal','Supply a known family, decision, review date and nonblank rationale.'); END IF;
      BEGIN
        c_reviewed:=(c_family->>'reviewedOn')::date;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        PERFORM openerp.fail('InvalidJournal','The family review date must be a real calendar date.');
      END;
      IF to_char(c_reviewed,'YYYY-MM-DD')<>c_family->>'reviewedOn'
        OR c_reviewed>(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date THEN
        PERFORM openerp.fail('InvalidJournal','The family review date cannot be in the future.'); END IF;
      IF jsonb_typeof(c_family->'evidenceId') IS DISTINCT FROM 'string' THEN
        PERFORM openerp.fail('MissingEvidence','Every family decision needs retained evidence in this book.'); END IF;
      SELECT e.* INTO c_evidence FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=c_family->>'evidenceId';
      IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Every family decision needs retained evidence in this book.'); END IF;
      c_families:=c_families||jsonb_build_array(c_family||jsonb_build_object('evidenceSha256',c_evidence.sha256));
    END LOOP;
    IF (SELECT count(DISTINCT f->>'family') FROM jsonb_array_elements(c_families) f)<>10 THEN
      PERFORM openerp.fail('InvalidJournal','A family cannot be declared twice or omitted.'); END IF;
    SELECT jsonb_agg(f ORDER BY f->>'family' COLLATE "C") INTO c_families FROM jsonb_array_elements(c_families) f;
  END IF;
  SELECT e.* INTO c_evidence FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=input->>'evidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain evidence for this synthetic bank-source inventory first.'); END IF;
  SELECT coalesce(max(i.ordinal),0) INTO c_revision FROM openerp.closing_inventories i
    WHERE i.book_id=scope->>'bookId' AND i.period_id=declare_closing_inventory.period_id;
  IF c_revision=9223372036854775807 THEN
    PERFORM openerp.fail('UnsupportedProfile','This period reached its retained inventory revision limit.'); END IF;
  c_revision:=c_revision+1;
  c_body:=(input-'families')||jsonb_build_object('id',openerp.new_id('closing_inventory'),'evidenceSha256',c_evidence.sha256,
    'actorId',c_actor,'declaredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revision',c_revision::text,'coverage',CASE WHEN input ? 'families' THEN 'synthetic_family_inventory_v1' ELSE 'synthetic_bank_sources_only' END);
  IF input ? 'families' THEN c_body:=c_body||jsonb_build_object('families',c_families); END IF;
  -- The book lock serializes this period-local ordinal without non-MVCC sequence state.
  INSERT INTO openerp.closing_inventories(book_id,id,period_id,ordinal,body)
    VALUES(scope->>'bookId',c_body->>'id',period_id,c_revision,c_body);
  RETURN openerp.save_command(scope->>'bookId',key,c_actor,'declare_closing_inventory',c_payload,c_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.closing_basis(p_book text, p_period text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE c_book openerp.books; c_period openerp.periods; c_report text;
  c_sources jsonb; c_schedules jsonb; c_inventory jsonb; c_accounts jsonb;
  c_checks jsonb; c_dependencies jsonb; c_banks_ready boolean; c_periods jsonb; c_commerce jsonb; c_bank_state jsonb; c_latest_reopen timestamptz; c_owners jsonb; c_expense_tax jsonb; c_families jsonb:='[]'; c_family text; c_decision jsonb;
  c_family_checks jsonb; c_count bigint; c_codes text[]; c_provider text; c_passed boolean;
BEGIN
  SELECT b.* INTO STRICT c_book FROM openerp.books b WHERE b.id=p_book;
  SELECT p.* INTO c_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_period;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period was not found in this book.'); END IF;
  SELECT r.id INTO c_report FROM openerp.report_snapshots r
    WHERE r.book_id=p_book AND r.starts_on=c_period.starts_on AND r.ends_on=c_period.ends_on
      AND r.sequence=c_book.committed_sequence AND r.body->>'balanced'='true'
      AND NOT EXISTS(SELECT FROM openerp.closing_invalidations i WHERE i.book_id=p_book AND i.kind='report' AND i.artifact_id=r.id)
    ORDER BY r.body->>'createdAt' DESC,r.id DESC LIMIT 1;
  c_bank_state:=openerp.bank_close_dependencies(p_book,c_period.starts_on,c_period.ends_on);
  c_sources:=c_bank_state->'sources';
  SELECT max((t.body->>'committedAt')::timestamptz) INTO c_latest_reopen
    FROM openerp.closing_transitions t JOIN openerp.periods p ON p.book_id=t.book_id AND p.id=t.period_id
    WHERE t.book_id=p_book AND t.body->>'action'='reopen' AND p.starts_on<=c_period.ends_on;
  c_banks_ready:=coalesce((c_bank_state->>'allRepresentedReady')::boolean,false)
    AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_sources) s
      WHERE (s->>'reconciliationCreatedAt')::timestamptz<=c_latest_reopen);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'version',a.version::text) ORDER BY a.id),'[]')
    INTO c_accounts FROM openerp.accounts a WHERE a.book_id=p_book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text,'locked',p.locked,
      'startsOn',p.starts_on::text,'endsOn',p.ends_on::text) ORDER BY p.id),'[]')
    INTO c_periods FROM openerp.periods p WHERE p.book_id=p_book AND p.starts_on<=c_period.ends_on;
  c_schedules:=openerp.subledger_close_dependencies(p_book,c_period.ends_on);
  c_commerce:=openerp.commerce_period_status(p_book,c_period.starts_on,c_period.ends_on);
  -- Bound inputs before any owner/tax provider aggregate; never hash a truncated inventory.
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_records r WHERE r.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_effects e WHERE e.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book LIMIT 5001) bounded)>5000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.expense_tax_sources s WHERE s.book_id=p_book LIMIT 201) bounded)>200 THEN
    PERFORM openerp.fail('InvalidJournal','Technical closing supports 1000 owner sources/effects, 5000 allocation legs and 200 expense sources. Provider basis is not truncated.'); END IF;
  c_owners:=openerp.owner_period_status(p_book,c_period.starts_on,c_period.ends_on);
  c_expense_tax:=openerp.expense_tax_dependencies(p_book);
  -- Missing source/company obligations cannot become an empty, complete inventory.
  SELECT i.body INTO c_inventory FROM openerp.closing_inventories i WHERE i.book_id=p_book AND i.period_id=p_period
    ORDER BY i.ordinal DESC LIMIT 1;
  IF jsonb_array_length(c_sources)=0 AND c_inventory->'bankAccountIds'='[]'::jsonb THEN c_banks_ready:=true; END IF;
  c_checks:=jsonb_build_array(
    jsonb_build_object('code','DeclaredBankInventory','passed',c_inventory IS NOT NULL
      AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(c_inventory->'bankAccountIds') expected(account_id)
        WHERE NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=expected.account_id))
      AND NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book
        AND NOT (c_inventory->'bankAccountIds' ? s.account_id)),
      'detail','An operator must explicitly declare expected synthetic bank accounts with evidence. Every expected account needs a retained source, and every observed source must be declared.'),
    jsonb_build_object('code','SyntheticNativeProfile','passed',c_book.profile='synthetic-core-v1' AND c_book.authority='native',
      'detail','Only the native synthetic profile supports this technical lock.'),
    jsonb_build_object('code','PeriodBoundaries','passed',EXISTS(SELECT FROM openerp.fiscal_years y
      WHERE y.book_id=p_book AND y.id=c_period.fiscal_year_id AND c_period.starts_on>=y.starts_on AND c_period.ends_on<=y.ends_on)
      AND NOT EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=p_book AND p.id<>p_period
        AND p.starts_on<=c_period.ends_on AND p.ends_on>=c_period.starts_on),
      'detail','The period must fit its fiscal year and must not overlap another posting period.'),
    jsonb_build_object('code','CurrentTrialBalance','passed',c_report IS NOT NULL,
      'detail','A current balanced internal trial balance must cover this exact period. It is not an annual report.'),
    jsonb_build_object('code','RepresentedBankSources','passed',c_banks_ready,
      'detail','Every represented bank source needs a fresh complete reconciliation for this exact period; missing sources are not inferred absent.'),
    jsonb_build_object('code','RegisteredCommerce','passed',
      coalesce((c_commerce->>'invalidRecognitionCount')::bigint=0 AND (c_commerce->>'invalidAllocationCount')::bigint=0
        AND (c_commerce->>'conservationFailureCount')::bigint=0,false),
      'detail','Registered invoices and allocations must remain valid and conserve exact amounts. Unpaid invoices are allowed; company invoice completeness is not established.'),
    jsonb_build_object('code','OwnerSourceReview','passed',
      coalesce((c_owners->>'unresolvedReviewCount')::bigint=0 AND (c_owners->>'unlinkedRecordCount')::bigint=0,false),
      'detail','Owner sources through period end need resolved reviews and posted-reference coverage. Unpaid linked claims are allowed; this does not certify opening balances or completeness.'),
    jsonb_build_object('code','ExpenseReviewCurrentness','passed',
      coalesce((c_expense_tax->>'missingOrStaleReviewCount')::bigint=0,false),
      'detail','Every represented expense source needs a review of its current source digest. Current review is not supported tax treatment, deduction eligibility, ledger reconciliation or company completeness.'),
    jsonb_build_object('code','ExpenseControlCoverage','passed',coalesce((c_expense_tax->>'sourceCount')::bigint=0,false),
      'detail','Known expense sources lack supported posting and ledger-reconciliation coverage in this provider version, even with a digest-current review. They block technical close. No represented sources is not proof of company completeness or no tax obligations.'),
    jsonb_build_object('code','RepresentedSchedules','passed',
      coalesce((c_schedules->>'dueUnpreparedCount')::bigint=0 AND (c_schedules->>'dueUnpostedCount')::bigint=0
        AND (c_schedules->>'reversedOccurrenceCount')::bigint=0,false),
      'detail','Represented due schedule occurrences must be posted and unreversed; schedule inventory and control-account completeness remain unestablished.')
  );
  -- A declaration cannot waive an existing provider failure. Missing controls are explicit.
  FOREACH c_family IN ARRAY ARRAY['bank_sources','invoices','tax','payroll','assets_deferrals',
    'foreign_currency','owner_balances','other_balances','external_schedules','disclosures'] LOOP
    SELECT f INTO c_decision FROM jsonb_array_elements(coalesce(c_inventory->'families','[]')) f
      WHERE f->>'family'=c_family;
    c_count:=NULL; c_codes:=ARRAY[]::text[]; c_provider:='unavailable';
    CASE c_family
      WHEN 'bank_sources' THEN
        c_count:=greatest(jsonb_array_length(c_sources),coalesce(jsonb_array_length(c_inventory->'bankAccountIds'),0));
        c_codes:=ARRAY['DeclaredBankInventory','RepresentedBankSources']; c_provider:='bank_close_dependencies';
      WHEN 'invoices' THEN
        c_count:=(c_commerce->>'registeredInvoiceCount')::bigint;
        c_codes:=ARRAY['RegisteredCommerce']; c_provider:='commerce_period_status_v1';
      WHEN 'tax' THEN
        c_count:=(c_expense_tax->>'sourceCount')::bigint;
        c_codes:=ARRAY['ExpenseReviewCurrentness','ExpenseControlCoverage']; c_provider:='expense_tax_dependencies_v1';
      WHEN 'assets_deferrals' THEN
        c_count:=(c_schedules->>'scheduleCount')::bigint;
        c_codes:=ARRAY['RepresentedSchedules']; c_provider:='subledger_close_dependencies_v1';
      WHEN 'owner_balances' THEN
        c_count:=(c_owners->>'registeredRecordCount')::bigint;
        c_codes:=ARRAY['OwnerSourceReview']; c_provider:='owner_period_status_v1';
      ELSE NULL;
    END CASE;
    SELECT coalesce(jsonb_agg(jsonb_build_object('code',ch->>'code',
      'status',CASE WHEN ch->>'passed'='true' THEN 'passed' ELSE 'failed' END,'detail',ch->>'detail') ORDER BY ch->>'code'),'[]')
      INTO c_family_checks FROM jsonb_array_elements(c_checks) ch WHERE ch->>'code'=ANY(c_codes);
    IF c_family='bank_sources' AND c_decision->>'status'='required' THEN
      c_family_checks:=c_family_checks||jsonb_build_array(jsonb_build_object('code','RequiredBankSources',
        'status',CASE WHEN c_count>0 THEN 'passed' ELSE 'failed' END,
        'detail','A required bank family needs declared and represented sources, not an empty inventory.'));
    END IF;
    -- Non-bank providers report represented state, not full required control coverage.
    IF c_family<>'bank_sources' THEN
      c_family_checks:=c_family_checks||jsonb_build_array(jsonb_build_object('code','FullFamilyCoverage',
        'status','unavailable','detail','Complete source inventory and required family control coverage are not implemented. A required declaration remains blocked.'));
    END IF;
    c_passed:=false;
    IF c_decision->>'status'='not_applicable' THEN
      c_passed:=coalesce(c_count,0)=0
        AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_family_checks) ch WHERE ch->>'status'='failed');
    ELSIF c_decision->>'status'='required' THEN
      c_passed:=jsonb_array_length(c_family_checks)>0
        AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_family_checks) ch WHERE ch->>'status'<>'passed');
    END IF;
    c_family_checks:=c_family_checks||jsonb_build_array(jsonb_build_object('code','ReviewedApplicability',
      'status',CASE WHEN c_passed THEN 'passed' ELSE 'failed' END,
      'detail',CASE
        WHEN c_decision IS NULL THEN 'No family decision is retained. Declare required, not applicable with evidence, unsupported or unknown.'
        WHEN c_decision->>'status'='not_applicable' AND coalesce(c_count,0)>0 THEN 'Represented records contradict the not-applicable declaration.'
        WHEN c_decision->>'status'='not_applicable' THEN 'Dated operator decision only. It does not establish legal applicability or company completeness.'
        WHEN c_decision->>'status'='required' THEN 'Every required provider check must be available and pass.'
        ELSE 'Unsupported and unknown obligations block technical close.' END));
    c_families:=c_families||jsonb_build_array(jsonb_build_object('family',c_family,'declaration',c_decision,
      'providerVersion',c_provider,'representedCount',c_count,'checks',c_family_checks,'passed',c_passed,'coverage','not_established'));
  END LOOP;
  c_checks:=c_checks||jsonb_build_array(jsonb_build_object('code','CompleteFamilyInventory',
    'passed',coalesce(c_inventory->>'coverage'='synthetic_family_inventory_v1',false)
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_families) f WHERE f->>'passed' IS DISTINCT FROM 'true'),
    'detail','Every close family needs an evidenced decision. Required unavailable controls, unknown obligations and contradictions block this technical scope.'));
  c_dependencies:=jsonb_build_object('periodVersion',c_period.version::text,'ledgerSequence',c_book.committed_sequence::text,
    'profileVersion',c_book.profile_version::text,'writerEpoch',c_book.writer_epoch::text,
    'periodDigest',openerp.digest(jsonb_build_object('periods',c_periods,'fiscalYear',(SELECT to_jsonb(y) FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=c_period.fiscal_year_id))),'accountsDigest',openerp.digest(c_accounts),
    'bankDigest',openerp.digest(c_bank_state),'scheduleDigest',openerp.digest(c_schedules),
    'familyInventoryDigest',openerp.digest(jsonb_build_object('inventory',c_inventory,'families',c_families)),
    'inventoryDigest',openerp.digest(jsonb_build_object('bankInventory',c_inventory,'commerce',c_commerce)),
    'ownerSourceDigest',c_owners->>'sourceDigest','expenseTaxBasisDigest',c_expense_tax->>'basisDigest','reportId',c_report);
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',c_book.entity_id,'bookId',p_book),
    'periodId',p_period,'startsOn',c_period.starts_on::text,'endsOn',c_period.ends_on::text,'locked',c_period.locked,
    'inventoryScope','synthetic_family_inventory_v1','families',c_families,
    'inventory',c_inventory,'dependencies',c_dependencies,'checks',c_checks,
    'ownerTaxStatus',jsonb_build_object('owners',c_owners,'expenseTax',c_expense_tax),
    'technicalCloseAllowed',NOT c_period.locked AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_checks) ch WHERE ch->>'passed' IS DISTINCT FROM 'true'),
    'statutoryReady',false,'statutoryBlockers',jsonb_build_array(
      'Actual company profile, accounting method, obligations and complete expected source inventory are not established.',
      'Tax, receivables/payables, owner balances, assets, payroll, valuation and control-account completeness are not certified.',
      'Technical locking does not perform year-end transfers, tax calculation, annual reporting, SIE or iXBRL validation.',
      'Retention, restore, reviewed statutory schemas, signing authority and filing acceptance remain unverified.'));
END $$;

REVOKE ALL ON FUNCTION openerp.declare_closing_inventory(text,jsonb,text,text,jsonb),
  openerp.closing_basis(text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.declare_closing_inventory(text,jsonb,text,text,jsonb) TO openerp_runtime;
