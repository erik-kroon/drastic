-- Forward-only1500 subledger dependency integration over the latest1001 owners.
--1300 active-bank views/hooks remain dispatched by the unchanged bank consumers.
-- Existing callers hold the book barrier. Historical approvals, receipts and artifacts are not rewritten.

CREATE OR REPLACE FUNCTION openerp.closing_basis(p_book text, p_period text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE c_book openerp.books; c_period openerp.periods; c_report text;
  c_sources jsonb; c_schedules jsonb; c_subledger_controls jsonb; c_inventory jsonb; c_accounts jsonb;
  c_checks jsonb; c_dependencies jsonb; c_banks_ready boolean; c_periods jsonb; c_commerce jsonb; c_bank_state jsonb; c_latest_reopen timestamptz; c_owners jsonb; c_expense_tax jsonb; c_vat_returns jsonb; c_families jsonb:='[]'; c_family text; c_decision jsonb;
  c_family_checks jsonb; c_count bigint; c_codes text[]; c_provider text; c_passed boolean;
BEGIN
  SELECT b.* INTO STRICT c_book FROM openerp.books b WHERE b.id=p_book;
  SELECT p.* INTO c_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_period;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period was not found in this book.'); END IF;
  c_subledger_controls:=openerp.subledger_control_dependencies(p_book);
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
  c_vat_returns:=openerp.vat_return_dependencies(p_book);
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
    jsonb_build_object('code','VatReturnControlCoverage','passed',
      (c_vat_returns->>'sourceCount')::integer=0 AND (c_vat_returns->>'draftCount')::integer=0,
      'detail','Represented VAT facts or saved drafts require complete tax controls, which this provider does not supply. Synthetic calculations and actual-review exclusions do not establish filing readiness. Empty inventories do not establish no tax obligations.'),
    jsonb_build_object('code','ScheduleBasisCoverage','passed',
      (c_subledger_controls->>'missingBasisCount')::bigint=0,
      'detail','Every represented schedule needs a retained carrying basis. Missing acquisition or imported-opening evidence cannot be waived by a family declaration.'),
    jsonb_build_object('code','SubledgerControlCoverage','passed',
      (c_schedules->>'scheduleCount')::bigint=0 AND (c_subledger_controls->>'basisCount')::bigint=0
        AND (c_subledger_controls->>'snapshotCount')::bigint=0,
      'detail','Represented schedules, carrying bases or control snapshots require complete source and accounting controls, which this synthetic provider does not establish. A zero control difference is not complete coverage. Empty inventories do not establish no asset obligations.'),
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
        c_count:=(c_expense_tax->>'sourceCount')::bigint+(c_vat_returns->>'sourceCount')::bigint+(c_vat_returns->>'draftCount')::bigint;
        c_codes:=ARRAY['ExpenseReviewCurrentness','ExpenseControlCoverage','VatReturnControlCoverage']; c_provider:='expense_tax_and_vat_return_dependencies_v1';
      WHEN 'assets_deferrals' THEN
        c_count:=(c_schedules->>'scheduleCount')::bigint+(c_subledger_controls->>'basisCount')::bigint
          +(c_subledger_controls->>'snapshotCount')::bigint;
        c_codes:=ARRAY['RepresentedSchedules','ScheduleBasisCoverage','SubledgerControlCoverage'];
        c_provider:='subledger_and_control_dependencies_v1';
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
    'ownerSourceDigest',c_owners->>'sourceDigest','expenseTaxBasisDigest',c_expense_tax->>'basisDigest',
    'vatReturnDependencyDigest',openerp.digest(c_vat_returns),'subledgerControls',c_subledger_controls,'reportId',c_report);
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',c_book.entity_id,'bookId',p_book),
    'periodId',p_period,'startsOn',c_period.starts_on::text,'endsOn',c_period.ends_on::text,'locked',c_period.locked,
    'inventoryScope','synthetic_family_inventory_v1','families',c_families,
    'inventory',c_inventory,'dependencies',c_dependencies,'checks',c_checks,
    'ownerTaxStatus',jsonb_build_object('owners',c_owners,'expenseTax',c_expense_tax,'vatReturns',c_vat_returns),
    'technicalCloseAllowed',NOT c_period.locked AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_checks) ch WHERE ch->>'passed' IS DISTINCT FROM 'true'),
    'statutoryReady',false,'statutoryBlockers',jsonb_build_array(
      'Actual company profile, accounting method, obligations and complete expected source inventory are not established.',
      'Tax, receivables/payables, owner balances, assets, payroll, valuation and control-account completeness are not certified.',
      'Technical locking does not perform year-end transfers, tax calculation, annual reporting, SIE or iXBRL validation.',
      'Retention, restore, reviewed statutory schemas, signing authority and filing acceptance remain unverified.'));
END $$;

CREATE OR REPLACE FUNCTION openerp.accountant_review_providers_bounded(p_book text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT NOT ((SELECT count(*) FROM (SELECT 1 FROM openerp.owner_parties p WHERE p.book_id=p_book LIMIT 101) bounded)>100
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_records r WHERE r.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_effects e WHERE e.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book LIMIT 5001) bounded)>5000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.expense_tax_sources s WHERE s.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_fact_components v WHERE v.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_return_drafts v WHERE v.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_schedules s WHERE s.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_bases b WHERE b.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_control_snapshots c WHERE c.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_preparations p WHERE p.book_id=p_book LIMIT 10001) bounded)>10000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.accounts a WHERE a.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.periods p WHERE p.book_id=p_book LIMIT 1001) bounded)>1000)
$$;

CREATE OR REPLACE FUNCTION openerp.accountant_review_basis(p_book text,p_starts date,p_ends date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ar_book openerp.books; ar_configuration jsonb; ar_evidence jsonb; ar_inventories jsonb; ar_closing jsonb; ar_owner_inventory jsonb; ar_subledger_controls jsonb;
BEGIN
  SELECT b.* INTO STRICT ar_book FROM openerp.books b WHERE b.id=p_book;
  IF NOT openerp.accountant_review_providers_bounded(p_book) THEN
    PERFORM openerp.fail('InvalidJournal','Review provider basis exceeds 100 owners, 1000 owner sources/effects, 5000 allocation legs or 200 expense sources, 200 VAT facts or 500 VAT drafts. Subledger limits are200 schedules/bases/control snapshots,10000 preparations and1000 accounts/periods. No truncated basis is compared.'); END IF;
  ar_subledger_controls:=openerp.subledger_control_dependencies(p_book);
  SELECT jsonb_build_object(
    'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id COLLATE "C") FROM openerp.accounts a WHERE a.book_id=p_book),'[]'),
    'years',coalesce((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.id COLLATE "C") FROM openerp.fiscal_years y WHERE y.book_id=p_book),'[]'),
    'periods',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id COLLATE "C") FROM openerp.periods p WHERE p.book_id=p_book),'[]')) INTO ar_configuration;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sha256',e.sha256) ORDER BY e.id COLLATE "C"),'[]')
    INTO ar_evidence FROM openerp.evidence e WHERE e.book_id=p_book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('periodId',p.id,'inventoryId',i.body->>'id',
    'evidenceId',i.body->>'evidenceId','expectedAccountIds',i.body->'bankAccountIds') ORDER BY p.id COLLATE "C"),'[]')
    INTO ar_inventories FROM openerp.periods p LEFT JOIN LATERAL(
      SELECT ci.body FROM openerp.closing_inventories ci WHERE ci.book_id=p_book AND ci.period_id=p.id ORDER BY ci.ordinal DESC LIMIT 1
    ) i ON true WHERE p.book_id=p_book AND p.starts_on<=p_ends AND p.ends_on>=p_starts;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'periodId',t.period_id,'version',t.period_version::text,
    'action',t.body->>'action') ORDER BY t.period_id COLLATE "C",t.period_version),'[]')
    INTO ar_closing FROM openerp.closing_transitions t JOIN openerp.periods p ON p.book_id=t.book_id AND p.id=t.period_id
    WHERE t.book_id=p_book AND p.starts_on<=p_ends;
  SELECT jsonb_build_object('owners',coalesce((SELECT jsonb_agg(p.body ORDER BY p.id COLLATE "C")
    FROM openerp.owner_parties p WHERE p.book_id=p_book),'[]'),
    'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('source',r.body,'revision',v.body,'review',w.body) ORDER BY r.id COLLATE "C")
    FROM openerp.owner_records r JOIN openerp.owner_revisions v ON v.book_id=r.book_id AND v.record_id=r.id AND v.revision=r.current_revision
    LEFT JOIN openerp.owner_reviews w ON w.book_id=r.book_id AND w.record_id=r.id AND w.revision=r.current_revision
    WHERE r.book_id=p_book),'[]')) INTO ar_owner_inventory;
  RETURN jsonb_build_object('sequence',ar_book.committed_sequence::text,'profile',ar_book.profile,
    'profileVersion',ar_book.profile_version::text,'writerAuthority',ar_book.authority,'writerEpoch',ar_book.writer_epoch::text,
    'currency',ar_book.currency,'currencyScale',ar_book.currency_scale,
    'configurationDigest',openerp.digest(ar_configuration),'evidenceInventoryDigest',openerp.digest(ar_evidence),
    'closingStateDigest',openerp.digest(ar_closing),'declaredBankInventories',ar_inventories,
    'owners',openerp.owner_period_status(p_book,p_starts,p_ends),'expenseTax',openerp.expense_tax_dependencies(p_book),
    'vatReturns',openerp.vat_return_dependencies(p_book),'subledgerControls',ar_subledger_controls,
    'ownerInventoryDigest',openerp.digest(ar_owner_inventory),
    'bank',openerp.bank_close_dependencies(p_book,p_starts,p_ends),
    'commerce',openerp.commerce_period_status(p_book,p_starts,p_ends),
    'schedules',openerp.subledger_close_dependencies(p_book,p_ends));
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_accountant_review(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ar_actor text; ar_previous jsonb; ar_book openerp.books; ar_report openerp.report_snapshots;
  ar_id text; ar_basis jsonb; ar_body jsonb; ar_balances jsonb; ar_journal jsonb; ar_evidence jsonb; ar_coverage jsonb;
  ar_rows jsonb; ar_descriptors jsonb; ar_result jsonb; ar_csv_context jsonb; ar_earlier bigint; ar_no_posting bigint;
  ar_owner_sources jsonb; ar_owner_controls jsonb; ar_expense_tax jsonb; ar_provider_row jsonb; ar_provider_block text;
  ar_excluded bigint; ar_ordinal bigint; ar_item jsonb; ar_inventory jsonb; ar_expected text; ar_source jsonb;
BEGIN
  ar_actor:=openerp.authorize(token,scope);
  SELECT b.* INTO STRICT ar_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  ar_previous:=openerp.replay(ar_book.id,key,ar_actor,'prepare_accountant_review',input);
  IF ar_previous IS NOT NULL THEN RETURN ar_previous; END IF;
  PERFORM openerp.bank_require_profile(ar_book.id);
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-'reportId'-'openingExplanation'-'openingEvidenceIds'-'accountantNotes'-'excludedSources'<>'{}'::jsonb
    OR jsonb_typeof(input->'openingEvidenceIds') IS DISTINCT FROM 'array' OR jsonb_typeof(input->'excludedSources') IS DISTINCT FROM 'array'
    OR jsonb_typeof(input->'openingExplanation') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'accountantNotes') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(input->>'openingExplanation')),0)<1 OR length(input->>'openingExplanation')>2000
    OR coalesce(length(btrim(input->>'accountantNotes')),0)<1 OR length(input->>'accountantNotes')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Supply a current report, an opening-basis explanation, accountant notes and explicit evidence/exclusion lists.'); END IF;
  IF jsonb_array_length(input->'openingEvidenceIds')>20 OR jsonb_array_length(input->'excludedSources')>20
    OR (SELECT count(DISTINCT e) FROM jsonb_array_elements(input->'openingEvidenceIds') e)<>jsonb_array_length(input->'openingEvidenceIds')
    OR EXISTS(SELECT FROM jsonb_array_elements(input->'openingEvidenceIds') e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN
    PERFORM openerp.fail('InvalidJournal','Provide at most20 distinct opening evidence references and20 declared exclusions.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(input->'openingEvidenceIds') x(id)
    WHERE NOT EXISTS(SELECT FROM openerp.evidence e WHERE e.book_id=ar_book.id AND e.id=x.id)) THEN
    PERFORM openerp.fail('MissingEvidence','An opening explanation reference is not retained in this book.'); END IF;
  FOR ar_item IN SELECT value FROM jsonb_array_elements(input->'excludedSources') LOOP
    IF jsonb_typeof(ar_item) IS DISTINCT FROM 'object' OR ar_item-'name'-'reason'<>'{}'::jsonb
      OR jsonb_typeof(ar_item->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(ar_item->'reason') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(ar_item->>'name')),0)<1 OR length(ar_item->>'name')>2000
      OR coalesce(length(btrim(ar_item->>'reason')),0)<1 OR length(ar_item->>'reason')>2000 THEN
      PERFORM openerp.fail('InvalidJournal','Each declared excluded source needs a name and reason. Exclusions never establish completeness.'); END IF;
  END LOOP;
  SELECT r.* INTO ar_report FROM openerp.report_snapshots r WHERE r.book_id=ar_book.id AND r.id=input->>'reportId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The internal report was not found in this book.'); END IF;
  IF ar_report.sequence<>ar_book.committed_sequence OR ar_report.body->>'currency' IS DISTINCT FROM ar_book.currency
    OR EXISTS(SELECT FROM openerp.closing_invalidations i WHERE i.book_id=ar_book.id AND i.kind='report' AND i.artifact_id=ar_report.id) THEN
    PERFORM openerp.fail('StaleDependency','Prepare a fresh internal report before capturing current source dependencies. Existing packs remain historical.'); END IF;
  -- Current committed sequence is captured under the same barrier as all kernel postings.
  -- No caller-selected intermediate correction sequence is accepted.
  IF (SELECT count(*) FROM openerp.vouchers v WHERE v.book_id=ar_book.id)>1000
    OR (SELECT count(*) FROM openerp.journal_lines l WHERE l.book_id=ar_book.id)>5000
    OR (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=ar_book.id)>1000
    OR (SELECT count(*) FROM openerp.evidence e WHERE e.book_id=ar_book.id)>1000
    OR (SELECT coalesce(sum(octet_length(e.content)),0) FROM openerp.evidence e WHERE e.book_id=ar_book.id)>2097152 THEN
    PERFORM openerp.fail('InvalidJournal','The first-year review pack supports1000 vouchers,5000 lines,1000 accounts,1000 evidence records and2 MiB retained evidence. No partial pack is created.'); END IF;
  IF EXISTS(SELECT FROM (SELECT ac.* FROM openerp.accounts ac WHERE ac.book_id=ar_book.id) a
    FULL JOIN (SELECT rl.* FROM openerp.report_lines rl WHERE rl.book_id=ar_book.id AND rl.report_id=ar_report.id) r ON r.account_id=a.id
    WHERE a.id IS NULL OR r.account_id IS NULL OR r.body->>'code' IS DISTINCT FROM a.code OR r.body->>'name' IS DISTINCT FROM a.name) THEN
    PERFORM openerp.fail('StaleDependency','The report account inventory or labels changed. Prepare a fresh report.'); END IF;
  ar_id:=openerp.new_id('review_pack');
  ar_basis:=openerp.accountant_review_basis(ar_book.id,ar_report.starts_on,ar_report.ends_on);
  INSERT INTO openerp.accountant_review_rows(book_id,pack_id,section,ordinal,body)
    SELECT ar_book.id,ar_id,'balances',row_number() OVER(ORDER BY r.account_id COLLATE "C"),
      jsonb_build_object('section','balances','accountId',r.account_id,'code',r.body->>'code','name',r.body->>'name',
        'recordedOpeningMinor',r.body->>'openingMinor','movementDebitMinor',r.body->>'debitMinor',
        'movementCreditMinor',r.body->>'creditMinor','recordedClosingMinor',r.body->>'closingMinor')
    FROM openerp.report_lines r WHERE r.book_id=ar_book.id AND r.report_id=ar_report.id;
  INSERT INTO openerp.accountant_review_rows(book_id,pack_id,section,ordinal,body)
    SELECT ar_book.id,ar_id,'journal',row_number() OVER(ORDER BY v.sequence,l.ordinal),jsonb_build_object(
      'section','journal','part',CASE WHEN v.posting_date<ar_report.starts_on THEN 'opening'
        WHEN v.posting_date<=ar_report.ends_on THEN 'movement' ELSE 'excluded_after_end' END,
      'voucherId',v.id,'lineId',l.id,'ordinal',l.ordinal,'sequence',v.sequence::text,'postingDate',v.posting_date::text,
      'fiscalYearId',v.fiscal_year_id,'periodId',v.period_id,'series',v.series,'voucherNumber',v.number::text,
      'accountId',l.account_id,'accountCode',a.code,'description',l.description,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,
      'eventId',v.event_id,'postingPurpose',v.posting_purpose,'correctsVoucherId',v.corrects_voucher_id,
      'changeSetId',v.change_set_id,'planDigest',r.body->>'planDigest','receiptId',r.id,'approvalId',r.approval_id,
      'approvedBy',ap.actor_id,'committedAt',r.body->>'committedAt','evidenceRefs',v.action->'evidenceRefs')
    FROM openerp.vouchers v JOIN openerp.journal_lines l ON l.book_id=v.book_id AND l.voucher_id=v.id
    JOIN openerp.accounts a ON a.book_id=l.book_id AND a.id=l.account_id
    JOIN openerp.execution_receipts r ON r.book_id=v.book_id AND r.voucher_id=v.id
    JOIN openerp.approvals ap ON ap.book_id=r.book_id AND ap.id=r.approval_id
    WHERE v.book_id=ar_book.id AND v.sequence<=ar_report.sequence;
  -- Refuse incomplete lineage instead of dropping a voucher through a join.
  IF (SELECT count(*) FROM openerp.accountant_review_rows rr WHERE rr.book_id=ar_book.id AND rr.pack_id=ar_id AND rr.section='journal')
    <>(SELECT count(*) FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
      WHERE v.book_id=ar_book.id AND v.sequence<=ar_report.sequence) THEN
    PERFORM openerp.fail('InvalidJournal','Posted line lineage is incomplete; no review pack was created.'); END IF;
  -- Independently reconstruct each displayed balance from the pinned lines, not the report total.
  IF EXISTS(SELECT FROM openerp.accountant_review_rows rr LEFT JOIN LATERAL(
    SELECT coalesce(sum(l.debit_minor-l.credit_minor) FILTER(WHERE v.posting_date<ar_report.starts_on),0) opening,
      coalesce(sum(l.debit_minor) FILTER(WHERE v.posting_date>=ar_report.starts_on),0) debit,
      coalesce(sum(l.credit_minor) FILTER(WHERE v.posting_date>=ar_report.starts_on),0) credit
      FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
      WHERE l.book_id=ar_book.id AND l.account_id=rr.body->>'accountId' AND v.sequence<=ar_report.sequence AND v.posting_date<=ar_report.ends_on
    ) sums ON true WHERE rr.book_id=ar_book.id AND rr.pack_id=ar_id AND rr.section='balances'
      AND ((rr.body->>'recordedOpeningMinor')::numeric<>sums.opening OR (rr.body->>'movementDebitMinor')::numeric<>sums.debit
        OR (rr.body->>'movementCreditMinor')::numeric<>sums.credit OR (rr.body->>'recordedClosingMinor')::numeric<>sums.opening+sums.debit-sums.credit)) THEN
    PERFORM openerp.fail('InvalidJournal','The report does not reconstruct from its committed ledger basis; no pack was created.'); END IF;
  INSERT INTO openerp.accountant_review_rows(book_id,pack_id,section,ordinal,body)
    SELECT ar_book.id,ar_id,'evidence',row_number() OVER(ORDER BY e.id COLLATE "C"),jsonb_build_object(
      'section','evidence','id',e.id,'title',e.title,'origin',e.origin,'mediaType',e.media_type,'sha256',e.sha256,'content',e.content,
      'createdAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'usedForOpeningExplanation',input->'openingEvidenceIds' ? e.id,
      'includedVoucherIds',uses.included,'excludedVoucherIds',uses.excluded,
      'disposition',CASE WHEN jsonb_array_length(uses.included)>0 THEN 'included_in_ledger_basis'
        WHEN input->'openingEvidenceIds' ? e.id THEN 'opening_explanation_only'
        WHEN jsonb_array_length(uses.excluded)>0 THEN 'excluded_later_posting' ELSE 'no_included_posting' END)
    FROM openerp.evidence e CROSS JOIN LATERAL(
      SELECT coalesce(jsonb_agg(v.id ORDER BY v.sequence) FILTER(WHERE v.posting_date<=ar_report.ends_on),'[]') included,
        coalesce(jsonb_agg(v.id ORDER BY v.sequence) FILTER(WHERE v.posting_date>ar_report.ends_on),'[]') excluded
      FROM openerp.vouchers v WHERE v.book_id=ar_book.id AND v.sequence<=ar_report.sequence
        AND EXISTS(SELECT FROM jsonb_array_elements(v.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=e.id)
    ) uses WHERE e.book_id=ar_book.id;
  SELECT count(*) INTO ar_earlier FROM openerp.vouchers v WHERE v.book_id=ar_book.id AND v.sequence<=ar_report.sequence AND v.posting_date<ar_report.starts_on;
  SELECT count(*) INTO ar_excluded FROM openerp.vouchers v WHERE v.book_id=ar_book.id AND v.sequence<=ar_report.sequence AND v.posting_date>ar_report.ends_on;
  SELECT count(*) INTO ar_no_posting FROM openerp.accountant_review_rows r WHERE r.book_id=ar_book.id AND r.pack_id=ar_id
    AND r.section='evidence' AND r.body->>'disposition'='no_included_posting';
  INSERT INTO openerp.accountant_review_rows(book_id,pack_id,section,ordinal,body)
    SELECT ar_book.id,ar_id,'owner_sources',row_number() OVER(ORDER BY r.id COLLATE "C"),
      jsonb_build_object('section','owner_sources','source',r.body,'revision',v.body,'review',w.body,
        'disposition',CASE WHEN r.occurred_on<=ar_report.ends_on THEN 'through_period_end' ELSE 'excluded_after_end' END)
    FROM openerp.owner_records r JOIN openerp.owner_revisions v ON v.book_id=r.book_id AND v.record_id=r.id AND v.revision=r.current_revision
    LEFT JOIN openerp.owner_reviews w ON w.book_id=r.book_id AND w.record_id=r.id AND w.revision=r.current_revision WHERE r.book_id=ar_book.id;
  INSERT INTO openerp.accountant_review_rows(book_id,pack_id,section,ordinal,body)
    SELECT ar_book.id,ar_id,'owner_controls',row_number() OVER(ORDER BY p.id COLLATE "C"),
      openerp.owner_control_body(ar_book.id,p.id,ar_report.starts_on,ar_report.ends_on)||jsonb_build_object('section','owner_controls')
    FROM openerp.owner_parties p WHERE p.book_id=ar_book.id;
  INSERT INTO openerp.accountant_review_rows(book_id,pack_id,section,ordinal,body)
    SELECT ar_book.id,ar_id,'expense_tax',row_number() OVER(ORDER BY s.id COLLATE "C"),
      jsonb_build_object('section','expense_tax','assessmentMode','actual_review','source',r.body,'review',v.body,
        'assessment',openerp.expense_tax_assess(ar_book.id,r.body,v.body,
          jsonb_build_object('mode','actual_review','startsOn',ar_report.starts_on::text,'endsOn',ar_report.ends_on::text)))
    FROM openerp.expense_tax_sources s
    JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_source_revisions x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL(SELECT x.body FROM openerp.expense_tax_reviews x WHERE x.book_id=s.book_id AND x.source_id=s.id ORDER BY x.revision DESC LIMIT 1) v ON true
    WHERE s.book_id=ar_book.id;
  ar_coverage:=jsonb_build_array(
    jsonb_build_object('section','coverage','code','opening_basis','status','unverified','detail','Only recorded pre-interval postings form the numeric opening. First year and absence of prior vouchers do not establish zero opening balances. Supplied explanation/evidence is not an approved OpeningSet.'),
    jsonb_build_object('section','coverage','code','company_profile','status','missing','detail','Legal entity type, fiscal facts, accounting method, VAT registration and complete obligations have not been verified for this synthetic book.'),
    jsonb_build_object('section','coverage','code','required_source_inventory','status','unverified','detail','The retained bank inventory is narrow and cannot establish all company records. Every expected account, privately paid item and external register needs independent review.'),
    jsonb_build_object('section','coverage','code','bank_controls','status',CASE WHEN ar_basis->'bank'->>'allRepresentedReady'='true' THEN 'observed' ELSE 'missing' END,
      'detail','Captured bank hook reports represented-source reconciliation only. Empty sources are not not-applicable. Reopen can require fresh closing signoff even when an old reconciliation is arithmetically unchanged.'),
    jsonb_build_object('section','coverage','code','commerce_controls','status','unverified','detail','Registered invoice/allocation counts and validity are captured. A zero register count does not establish no invoices or no liabilities; unregistered sources remain unknown.'),
    jsonb_build_object('section','coverage','code','schedule_controls','status','unverified','detail','Captured schedules expose due/unposted/reversed occurrences. The separate complete subledger-control dependency is retained in the pack and every export manifest, but does not establish complete inventory, approved opening basis or legal depreciation.'),
    jsonb_build_object('section','coverage','code','schedule_carrying_basis','status',
      CASE WHEN (ar_basis->'subledgerControls'->>'missingBasisCount')::bigint>0 THEN 'missing' ELSE 'unverified' END,
      'detail','Represented schedules without a retained acquisition/imported-opening carrying basis: '||
        (ar_basis->'subledgerControls'->>'missingBasisCount')||'; retained bases: '||(ar_basis->'subledgerControls'->>'basisCount')||
        '. These are current book-wide represented counts, not a complete period asset inventory. A retained basis is not legal approval or a new opening entry.'),
    jsonb_build_object('section','coverage','code','subledger_control_coverage','status','unavailable',
      'detail','Saved declared-account control snapshots: '||(ar_basis->'subledgerControls'->>'snapshotCount')||
        '. The complete dependency includes this inventory count and false coverage/reconciliation/financial-close flags. Zero differences or offsetting unexplained rows cannot establish source completeness. Control report bytes remain separate artifacts, not a passed closing gate.'),
    jsonb_build_object('section','coverage','code','owner_funding','status',CASE WHEN (ar_basis->'owners'->>'unresolvedReviewCount')::bigint>0
      OR (ar_basis->'owners'->>'unlinkedRecordCount')::bigint>0 THEN 'missing' ELSE 'unverified' END,
      'detail','Captured owner sources, reviews, posted effects, allocations and provider control balances. Unresolved reviews: '||(ar_basis->'owners'->>'unresolvedReviewCount')||
      '; sources without posted coverage: '||(ar_basis->'owners'->>'unlinkedRecordCount')||'. Unpaid linked claims are not technical errors. Opening and company completeness remain unknown.'),
    jsonb_build_object('section','coverage','code','vat_tax','status',CASE WHEN (ar_basis->'expenseTax'->>'sourceCount')::bigint>0 THEN 'missing' ELSE 'unverified' END,
      'detail','Captured every expense observation/current review and provider control/exclusion assessment in actual_review mode. Missing or stale reviews: '||
      (ar_basis->'expenseTax'->>'missingOrStaleReviewCount')||'; unsupported/unreconciled known sources: '||(ar_basis->'expenseTax'->>'sourceCount')||'. A current review may still contain unknown facts. No tax contribution, legal eligibility, VAT return or ledger reconciliation is established.'),
    jsonb_build_object('section','coverage','code','vat_return_controls','status','unavailable',
      'detail','Captured VAT fact components: '||(ar_basis->'vatReturns'->>'sourceCount')||'; saved VAT drafts: '||(ar_basis->'vatReturns'->>'draftCount')||
        '. The full bounded VAT dependency is retained in this pack and every export manifest. It does not certify source coverage, ledger reconciliation, legal profile activation or filing readiness. These counts are represented records, not unique transactions or expected period coverage.'),
    jsonb_build_object('section','coverage','code','other_obligations','status','unverified','detail','Payroll, FX, statutory disclosures and other obligations require applicability evidence. Reported no employees does not replace reviewed company facts.'),
    jsonb_build_object('section','coverage','code','unlinked_evidence','status','unverified',
      'detail',ar_no_posting::text||' retained evidence records have no included posting or opening-explanation use. Review their disposition; a source/control document need not itself create a posting. Their full content remains visible. Unretained missing sources cannot be counted.'),
    jsonb_build_object('section','coverage','code','later_dated_vouchers','status','excluded','detail',ar_excluded::text||' vouchers at the captured committed sequence are dated after the interval. Their lines and source references are visible but excluded from opening/movement totals.'),
    jsonb_build_object('section','coverage','code','statutory_outputs','status','unavailable','detail','This accountant review pack is not a financial close, annual report, SIE, iXBRL, tax filing, external acceptance or a verified Visma interchange format.')
  );
  IF jsonb_array_length(ar_basis->'declaredBankInventories')=0 THEN
    ar_coverage:=ar_coverage||jsonb_build_array(jsonb_build_object('section','coverage','code','period_inventory_unavailable',
      'status','missing','detail','No configured period inventory overlaps this report interval. Required source coverage is not established.'));
  END IF;
  FOR ar_inventory IN SELECT value FROM jsonb_array_elements(ar_basis->'declaredBankInventories') LOOP
    IF ar_inventory->>'inventoryId' IS NULL THEN
      ar_coverage:=ar_coverage||jsonb_build_array(jsonb_build_object('section','coverage','code','bank_inventory_'||(ar_inventory->>'periodId'),
        'status','missing','detail','No explicit expected bank-source declaration is retained for period '||(ar_inventory->>'periodId')||'.'));
    ELSE
      FOR ar_expected IN SELECT value FROM jsonb_array_elements_text(ar_inventory->'expectedAccountIds') LOOP
        SELECT s.value INTO ar_source FROM jsonb_array_elements(ar_basis->'bank'->'sources') s(value) WHERE s.value->>'accountId'=ar_expected;
        ar_coverage:=ar_coverage||jsonb_build_array(jsonb_build_object('section','coverage',
          'code','expected_bank_'||(ar_inventory->>'periodId')||'_'||ar_expected,
          'status',CASE WHEN ar_source->>'reconciliationId' IS NULL THEN 'missing' ELSE 'observed' END,
          'detail','Expected account '||ar_expected||' declared for period '||(ar_inventory->>'periodId')||': '||
            CASE WHEN ar_source IS NULL THEN 'no retained bank source is represented.'
              WHEN ar_source->>'reconciliationId' IS NULL THEN 'no fresh complete reconciliation covers this exact review interval.'
              ELSE 'selected reconciliation '||(ar_source->>'reconciliationId')||'; arithmetic/source freshness is not company completeness or closing signoff.' END));
      END LOOP;
    END IF;
  END LOOP;
  FOR ar_provider_row IN SELECT rr.body FROM openerp.accountant_review_rows rr
    WHERE rr.book_id=ar_book.id AND rr.pack_id=ar_id AND rr.section='owner_sources' ORDER BY rr.ordinal LOOP
    IF ar_provider_row->>'disposition'='excluded_after_end' THEN
      ar_coverage:=ar_coverage||jsonb_build_array(jsonb_build_object('section','coverage','code','owner_after_end_'||(ar_provider_row->'source'->>'id'),
        'status','excluded','detail','Owner source '||(ar_provider_row->'source'->>'id')||' is dated after the period end. Its source/review remains visible but is not in period owner controls.'));
    END IF;
  END LOOP;
  FOR ar_provider_row IN SELECT rr.body FROM openerp.accountant_review_rows rr
    WHERE rr.book_id=ar_book.id AND rr.pack_id=ar_id AND rr.section='owner_controls' ORDER BY rr.ordinal LOOP
    FOR ar_item IN SELECT value FROM jsonb_array_elements(ar_provider_row->'accountControls') LOOP
      IF (ar_item->>'unexplainedMinor')::numeric<>0 THEN
        ar_coverage:=ar_coverage||jsonb_build_array(jsonb_build_object('section','coverage',
          'code','owner_control_'||(ar_provider_row->'owner'->>'id')||'_'||(ar_item->>'accountId'),'status','missing',
          'detail','Owner provider reports unexplained whole-account difference '||(ar_item->>'unexplainedMinor')||' minor units for account '||
            (ar_item->>'accountId')||'. This is the provider comparison, not a newly inferred reconciliation.'));
      END IF;
    END LOOP;
  END LOOP;
  FOR ar_provider_row IN SELECT rr.body FROM openerp.accountant_review_rows rr
    WHERE rr.book_id=ar_book.id AND rr.pack_id=ar_id AND rr.section='expense_tax' ORDER BY rr.ordinal LOOP
    FOR ar_provider_block IN SELECT value FROM jsonb_array_elements_text(ar_provider_row->'assessment'->'blockers') LOOP
      ar_coverage:=ar_coverage||jsonb_build_array(jsonb_build_object('section','coverage',
        'code','expense_'||(ar_provider_row->'source'->>'sourceId')||'_'||ar_provider_block,'status','excluded',
        'detail','Expense source '||(ar_provider_row->'source'->>'sourceId')||': provider actual-review exclusion '||ar_provider_block||
          '. Source/reviewer amounts and nullable control differences remain visible; no contribution is emitted.'));
    END LOOP;
  END LOOP;
  FOR ar_item IN SELECT value FROM jsonb_array_elements(input->'excludedSources') LOOP
    ar_coverage:=ar_coverage||jsonb_build_array(jsonb_build_object('section','coverage','code','declared_exclusion_'||jsonb_array_length(ar_coverage)::text,
      'status','excluded','detail','Preparer declaration, not a not-applicable conclusion: '||(ar_item->>'name')||' — '||(ar_item->>'reason')));
  END LOOP;
  INSERT INTO openerp.accountant_review_rows SELECT ar_book.id,ar_id,'coverage',c.ordinal,c.value FROM jsonb_array_elements(ar_coverage) WITH ORDINALITY c(value,ordinal);
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.ordinal),'[]') INTO ar_balances FROM openerp.accountant_review_rows r WHERE r.book_id=ar_book.id AND r.pack_id=ar_id AND r.section='balances';
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.ordinal),'[]') INTO ar_journal FROM openerp.accountant_review_rows r WHERE r.book_id=ar_book.id AND r.pack_id=ar_id AND r.section='journal';
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.ordinal),'[]') INTO ar_evidence FROM openerp.accountant_review_rows r WHERE r.book_id=ar_book.id AND r.pack_id=ar_id AND r.section='evidence';
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.ordinal),'[]') INTO ar_owner_sources FROM openerp.accountant_review_rows r WHERE r.book_id=ar_book.id AND r.pack_id=ar_id AND r.section='owner_sources';
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.ordinal),'[]') INTO ar_owner_controls FROM openerp.accountant_review_rows r WHERE r.book_id=ar_book.id AND r.pack_id=ar_id AND r.section='owner_controls';
  SELECT coalesce(jsonb_agg(r.body ORDER BY r.ordinal),'[]') INTO ar_expense_tax FROM openerp.accountant_review_rows r WHERE r.book_id=ar_book.id AND r.pack_id=ar_id AND r.section='expense_tax';
  ar_rows:=jsonb_build_object('balances',ar_balances,'journal',ar_journal,'evidence',ar_evidence,'coverage',ar_coverage,
    'owner_sources',ar_owner_sources,'owner_controls',ar_owner_controls,'expense_tax',ar_expense_tax);
  ar_body:=jsonb_build_object('id',ar_id,'kind','accountant_review_pack_v1','scope',jsonb_build_object('entityId',ar_book.entity_id,'bookId',ar_book.id),
    'report',ar_report.body,'openingBasis',jsonb_build_object('status','not_verified','method','recorded_pre_interval_postings_only',
      'explanation',input->>'openingExplanation','evidenceIds',input->'openingEvidenceIds','earlierVoucherCount',ar_earlier),
    'accountantNotes',input->>'accountantNotes','basis',ar_basis,'basisDigest',openerp.digest(ar_basis),'rowsDigest',openerp.digest(ar_rows),
    'counts',jsonb_build_object('balances',jsonb_array_length(ar_balances),'journal',jsonb_array_length(ar_journal),
      'evidence',jsonb_array_length(ar_evidence),'coverage',jsonb_array_length(ar_coverage),
      'owner_sources',jsonb_array_length(ar_owner_sources),'owner_controls',jsonb_array_length(ar_owner_controls),'expense_tax',jsonb_array_length(ar_expense_tax)),
    'companyCompleteness','not_established','statutoryReady',false,'generatorVersion','accountant-review-v3','createdBy',ar_actor,
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  ar_body:=ar_body||jsonb_build_object('digest',openerp.digest(ar_body));
  SELECT coalesce(max(p.ordinal),0)+1 INTO ar_ordinal FROM openerp.accountant_review_packs p WHERE p.book_id=ar_book.id;
  INSERT INTO openerp.accountant_review_packs VALUES(ar_book.id,ar_id,ar_ordinal,ar_report.id,ar_body);
  PERFORM openerp.accountant_review_store_artifact(ar_book.id,ar_id,'json',openerp.canonical(jsonb_build_object('pack',ar_body,'sections',ar_rows)));
  ar_csv_context:=jsonb_build_object('packId',ar_id,'packDigest',ar_body->>'digest','reportId',ar_report.id,
    'recordedThroughSequence',ar_report.sequence::text,'currency',ar_book.currency,'currencyScale',ar_book.currency_scale,
    'openingBasis',ar_body->'openingBasis','companyCompleteness','not_established','statutoryReady',false,
    'coverage',ar_coverage,'providerBasis',jsonb_build_object('ownerSourceDigest',ar_basis->'owners'->>'sourceDigest',
      'expenseTaxBasisDigest',ar_basis->'expenseTax'->>'basisDigest','ownerInventoryDigest',ar_basis->>'ownerInventoryDigest',
      'vatReturns',ar_basis->'vatReturns','subledgerControls',ar_basis->'subledgerControls'),
    'generatorVersion','accountant-review-v3');
  PERFORM openerp.accountant_review_store_artifact(ar_book.id,ar_id,'balances_csv',openerp.accountant_review_csv(ar_balances,
    ARRAY['accountId','code','name','recordedOpeningMinor','movementDebitMinor','movementCreditMinor','recordedClosingMinor'],ar_csv_context));
  PERFORM openerp.accountant_review_store_artifact(ar_book.id,ar_id,'journal_csv',openerp.accountant_review_csv(ar_journal,
    ARRAY['part','sequence','postingDate','series','voucherNumber','voucherId','lineId','ordinal','accountCode','accountId','description','debitMinor','creditMinor',
      'fiscalYearId','periodId','eventId','postingPurpose','correctsVoucherId','changeSetId','planDigest','receiptId','approvalId','approvedBy','committedAt','evidenceRefs'],ar_csv_context));
  PERFORM openerp.accountant_review_store_artifact(ar_book.id,ar_id,'evidence_csv',openerp.accountant_review_csv(ar_evidence,
    ARRAY['id','title','origin','mediaType','sha256','createdAt','disposition','usedForOpeningExplanation','includedVoucherIds','excludedVoucherIds','content'],ar_csv_context));
  PERFORM openerp.accountant_review_store_artifact(ar_book.id,ar_id,'coverage_csv',openerp.accountant_review_csv(ar_coverage,ARRAY['code','status','detail'],ar_csv_context));
  PERFORM openerp.accountant_review_store_artifact(ar_book.id,ar_id,'owner_sources_csv',openerp.accountant_review_csv(ar_owner_sources,
    ARRAY['disposition','source','revision','review'],ar_csv_context));
  PERFORM openerp.accountant_review_store_artifact(ar_book.id,ar_id,'owner_controls_csv',openerp.accountant_review_csv(ar_owner_controls,
    ARRAY['owner','startsOn','endsOn','sourceCoverage','openingBalanceMinor','unlinkedRecordCount',
      'records','effects','allocations','ownerBalances','movements','accountControls','blockers'],ar_csv_context));
  PERFORM openerp.accountant_review_store_artifact(ar_book.id,ar_id,'expense_tax_csv',openerp.accountant_review_csv(ar_expense_tax,
    ARRAY['assessmentMode','source','review','assessment'],ar_csv_context));
  SELECT jsonb_agg(a.descriptor ORDER BY a.format COLLATE "C") INTO ar_descriptors FROM openerp.accountant_review_artifacts a WHERE a.book_id=ar_book.id AND a.pack_id=ar_id;
  ar_result:=jsonb_build_object('pack',ar_body,'artifacts',ar_descriptors,'dependenciesCurrent',true);
  RETURN openerp.save_command(ar_book.id,key,ar_actor,'prepare_accountant_review',input,ar_result);
END $$;

-- Historical close records stay readable when the new live subledger bound is exceeded.
-- No stale proposal becomes executable; approval/execution still require the full live basis.
CREATE OR REPLACE FUNCTION openerp.get_closing_proposal(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_proposal openerp.closing_proposals; c_receipt jsonb; c_basis jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT p.* INTO c_proposal FROM openerp.closing_proposals p WHERE p.book_id=scope->>'bookId' AND p.id=get_closing_proposal.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period transition proposal was not found.'); END IF;
  IF openerp.subledger_control_dependency_digest(c_proposal.book_id) IS NOT NULL THEN
    c_basis:=openerp.closing_basis(c_proposal.book_id,c_proposal.period_id);
  END IF;
  SELECT t.body INTO c_receipt FROM openerp.closing_transitions t WHERE t.book_id=c_proposal.book_id AND t.proposal_id=c_proposal.id;
  RETURN jsonb_build_object('proposal',c_proposal.body,'dependenciesCurrent',coalesce(c_basis=c_proposal.body->'basis',false),'receipt',c_receipt);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_closing_certificate(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_certificate openerp.closing_certificates; c_basis jsonb; c_invalidated text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT c.* INTO c_certificate FROM openerp.closing_certificates c WHERE c.book_id=scope->>'bookId' AND c.id=get_closing_certificate.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The technical lock certificate was not found.'); END IF;
  IF openerp.subledger_control_dependency_digest(c_certificate.book_id) IS NOT NULL THEN
    c_basis:=openerp.closing_basis(c_certificate.book_id,c_certificate.period_id);
  END IF;
  SELECT i.transition_id INTO c_invalidated FROM openerp.closing_invalidations i WHERE i.book_id=c_certificate.book_id
    AND i.kind='certificate' AND i.artifact_id=c_certificate.id;
  RETURN jsonb_build_object('certificate',c_certificate.body,'invalidatedBy',c_invalidated,
    'current',coalesce(c_invalidated IS NULL AND c_basis->>'locked'='true' AND c_basis->'dependencies'=c_certificate.body->'effectiveDependencies'
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_basis->'checks') ch WHERE ch->>'passed' IS DISTINCT FROM 'true'),false));
END $$;

REVOKE ALL ON FUNCTION openerp.closing_basis(text,text),openerp.accountant_review_providers_bounded(text),
  openerp.accountant_review_basis(text,date,date),openerp.prepare_accountant_review(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_closing_proposal(text,jsonb,text),openerp.get_closing_certificate(text,jsonb,text)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_accountant_review(text,jsonb,text,jsonb),
  openerp.get_closing_proposal(text,jsonb,text),openerp.get_closing_certificate(text,jsonb,text) TO openerp_runtime;
