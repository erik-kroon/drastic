-- Forward-only:0800 remains immutable. Requires0610 owner and0710 expense-review providers.
-- Existing callers hold book lock before invoking this private helper.
-- Old proposals/certificates retain their old shape; new live basis equality makes them stale.
CREATE OR REPLACE FUNCTION openerp.closing_basis(p_book text, p_period text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE c_book openerp.books; c_period openerp.periods; c_report text;
  c_sources jsonb; c_schedules jsonb; c_inventory jsonb; c_accounts jsonb;
  c_checks jsonb; c_dependencies jsonb; c_banks_ready boolean; c_periods jsonb; c_commerce jsonb; c_bank_state jsonb; c_latest_reopen timestamptz; c_owners jsonb; c_expense_tax jsonb;
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
  c_dependencies:=jsonb_build_object('periodVersion',c_period.version::text,'ledgerSequence',c_book.committed_sequence::text,
    'profileVersion',c_book.profile_version::text,'writerEpoch',c_book.writer_epoch::text,
    'periodDigest',openerp.digest(jsonb_build_object('periods',c_periods,'fiscalYear',(SELECT to_jsonb(y) FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=c_period.fiscal_year_id))),'accountsDigest',openerp.digest(c_accounts),
    'bankDigest',openerp.digest(c_bank_state),'scheduleDigest',openerp.digest(c_schedules),
    'inventoryDigest',openerp.digest(jsonb_build_object('bankInventory',c_inventory,'commerce',c_commerce)),
    'ownerSourceDigest',c_owners->>'sourceDigest','expenseTaxBasisDigest',c_expense_tax->>'basisDigest','reportId',c_report);
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',c_book.entity_id,'bookId',p_book),
    'periodId',p_period,'startsOn',c_period.starts_on::text,'endsOn',c_period.ends_on::text,'locked',c_period.locked,
    'inventory',c_inventory,'dependencies',c_dependencies,'checks',c_checks,
    'ownerTaxStatus',jsonb_build_object('owners',c_owners,'expenseTax',c_expense_tax),
    'technicalCloseAllowed',NOT c_period.locked AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_checks) ch WHERE ch->>'passed' IS DISTINCT FROM 'true'),
    'statutoryReady',false,'statutoryBlockers',jsonb_build_array(
      'Actual company profile, accounting method, obligations and complete expected source inventory are not established.',
      'Tax, receivables/payables, owner balances, assets, payroll, valuation and control-account completeness are not certified.',
      'Technical locking does not perform year-end transfers, tax calculation, annual reporting, SIE or iXBRL validation.',
      'Retention, restore, reviewed statutory schemas, signing authority and filing acceptance remain unverified.'));
END $$;

REVOKE ALL ON FUNCTION openerp.closing_basis(text,text) FROM PUBLIC,openerp_runtime;
