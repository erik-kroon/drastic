-- Installed behavior and unverified production readiness are separate facts.
CREATE OR REPLACE FUNCTION openerp.get_book_status(token text, scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE book openerp.books; features jsonb; synthetic boolean;
BEGIN
  PERFORM openerp.authorize(token,scope);
  SELECT b.* INTO book FROM openerp.books b WHERE b.id=scope->>'bookId';
  synthetic:=book.profile='synthetic-core-v1' AND book.authority='native';
  SELECT jsonb_agg(jsonb_build_object('id',f.id,'installed',to_regprocedure(f.signature) IS NOT NULL,
    'available',synthetic AND to_regprocedure(f.signature) IS NOT NULL,'limitation',f.limitation) ORDER BY f.ordinal)
  INTO features FROM (VALUES
    (1,'journals','openerp.execute_change(text,jsonb,text,text,jsonb)','Synthetic exact manual journals only; execution requires operator approval.'),
    (2,'bank_reconciliation','openerp.reconcile_bank(text,jsonb,text,jsonb)','Declared synthetic source coverage; exact one-row/one-line matches only.'),
    (3,'internal_reports','openerp.prepare_report(text,jsonb,text,jsonb)','Internal trial balance only; balanced does not mean complete.'),
    (5,'recurring_preparation','openerp.create_preparation_run(text,jsonb,text,jsonb)','Exact synthetic recurring proposals only; no scheduler or automatic posting authority.'),
    (4,'case_contexts','openerp.prepare_case_snapshot(text,jsonb,text,jsonb)','Manual journal events only; source and tax facts are not inferred.')
  ) f(ordinal,id,signature,limitation);
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',book.entity_id,'bookId',book.id),
    'profile',book.profile,'writerAuthority',book.authority,'sequence',book.committed_sequence::text,
    'productionReady',false,'verification','not_verified','features',features,
    'blockers',jsonb_build_array(
      jsonb_build_object('code','CompanyProfileRequired','message','No real company compliance profile is supported by this release.',
        'requiredInputs',jsonb_build_array('Legal entity facts and accounting method','VAT registration and filing periods','Required payroll, assets, foreign currency and statutory obligations')),
      jsonb_build_object('code','RuleReviewRequired','message','Swedish tax calculations and statutory formats are not implemented or legally reviewed.',
        'requiredInputs',jsonb_build_array('Dated official rule sources','Versioned treatment mappings','Applicable official schemas and independent validation')),
      jsonb_build_object('code','VerificationRequired','message','Static checks and manual development receipts do not establish concurrency, recovery or profile conformance.',
        'requiredInputs',jsonb_build_array('Approval to add the required automated verification','Independent correctness and failure evidence')),
      jsonb_build_object('code','SourceCoverageRequired','message','An individual bank reconciliation does not prove all company records are present.',
        'requiredInputs',jsonb_build_array('Complete expected source inventory','Opening balances and historical source data')),
      jsonb_build_object('code','ArchiveAndMigrationRequired','message','Immutable database rows are not an external retention archive or a verified restore.',
        'requiredInputs',jsonb_build_array('Archive retention policy and storage','Restore evidence','Single-writer migration and cutover approval')),
      jsonb_build_object('code','ExternalAuthorityUnavailable','message','No provider enrollment, signature, deployment or authority submission has been performed.',
        'requiredInputs',jsonb_build_array('Provider-specific capability approval','Authorized credentials and delegated signatory','Separate deployment and submission approval'))
    ));
END $$;
