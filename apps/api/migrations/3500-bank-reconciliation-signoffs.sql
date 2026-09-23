-- One-account evidenced bank review. No posting, matching, waiver or closing authority.
CREATE TABLE openerp.bank_signoff_plans (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  coverage_report_id text NOT NULL, reconciliation_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,coverage_report_id) REFERENCES openerp.bank_source_coverage_reports(book_id,id),
  FOREIGN KEY(book_id,reconciliation_id) REFERENCES openerp.bank_capacity_reconciliations(book_id,id)
);
CREATE TABLE openerp.bank_reconciliation_signoffs (
  book_id text NOT NULL, plan_id text NOT NULL, evidence_id text NOT NULL,
  body jsonb NOT NULL, content text NOT NULL, sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 1048576),
  PRIMARY KEY(book_id,plan_id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.bank_signoff_plans(book_id,id),
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence(book_id,id)
);
CREATE TRIGGER immutable_bank_signoff_plan BEFORE UPDATE OR DELETE ON openerp.bank_signoff_plans
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_reconciliation_signoff BEFORE UPDATE OR DELETE ON openerp.bank_reconciliation_signoffs
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.bank_signoff_plans,openerp.bank_reconciliation_signoffs FROM PUBLIC,openerp_runtime;

-- Caller holds the book barrier. Reuse coverage's bounded currentness contract,
-- including source/allocation revisions and the conservative whole-book ledger cutoff.
CREATE FUNCTION openerp.bank_signoff_current(p_book text,p_plan jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE s_digest text;
BEGIN
  s_digest:=openerp.bank_source_coverage_dependency_digest(p_book,p_plan->'basis'->>'inventoryId');
  RETURN coalesce(s_digest=p_plan->'basis'->>'dependencyDigest',false)
    AND EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=p_book
      AND a.id=p_plan->>'accountId' AND a.active);
END $$;

CREATE FUNCTION openerp.prepare_bank_signoff(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_previous jsonb; s_book openerp.books;
  s_coverage openerp.bank_source_coverage_reports; s_report openerp.bank_capacity_reconciliations;
  s_account jsonb; s_digest text; s_body jsonb; s_statement_basis jsonb; s_report_statements jsonb;
  s_account_sequence bigint;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(s_book.id,p_key,s_actor,'prepare_bank_signoff',p_input);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  PERFORM openerp.bank_require_profile(s_book.id);
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Select existing source coverage and capacity reconciliation reports.'); END IF;
  IF p_input-ARRAY['coverageReportId','reconciliationId']<>'{}'::jsonb
    OR jsonb_typeof(p_input->'coverageReportId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'reconciliationId') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'coverageReportId','')!~'^[a-z][a-z0-9_-]{2,127}$'
    OR coalesce(p_input->>'reconciliationId','')!~'^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Select existing source coverage and capacity reconciliation reports.'); END IF;
  SELECT * INTO s_coverage FROM openerp.bank_source_coverage_reports r
    WHERE r.book_id=s_book.id AND r.id=p_input->>'coverageReportId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The source coverage report was not found in this book.'); END IF;
  SELECT * INTO s_report FROM openerp.bank_capacity_reconciliations r
    WHERE r.book_id=s_book.id AND r.id=p_input->>'reconciliationId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The capacity reconciliation was not found in this book.'); END IF;
  IF (SELECT count(*) FROM openerp.bank_signoff_plans p WHERE p.book_id=s_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book has reached its 200 signoff preparations. Saved history remains readable.'); END IF;
  s_digest:=openerp.bank_source_coverage_dependency_digest(s_book.id,s_coverage.inventory_id);
  IF s_digest IS NULL OR s_digest IS DISTINCT FROM s_coverage.body->>'dependencyDigest' THEN
    PERFORM openerp.fail('StaleDependency','Capture current source coverage before preparing signoff.'); END IF;
  SELECT a INTO s_account FROM jsonb_array_elements(s_coverage.body->'accounts') a
    WHERE a->>'accountId'=s_report.account_id;
  IF s_account IS NULL OR s_account->'declared' IS DISTINCT FROM 'true'::jsonb
    OR s_account->'active' IS DISTINCT FROM 'true'::jsonb
    OR s_account->'hasReviewGaps' IS DISTINCT FROM 'false'::jsonb
    OR s_coverage.body->'diagnostics' IS DISTINCT FROM '[]'::jsonb
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(coalesce(s_coverage.body->'inventory'->'families','[]')) f
      WHERE f->>'family'='bank_sources' AND f->>'status'='required') THEN
    PERFORM openerp.fail('InvalidJournal','Signoff needs an active declared account, resolved source controls and an evidenced required bank-family decision. Unknowns cannot be waived.'); END IF;
  SELECT coalesce(max(v.sequence),0) INTO s_account_sequence
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.voucher_id)
    WHERE l.book_id=s_book.id AND l.account_id=s_report.account_id
      AND v.posting_date<=(s_report.body->>'endsOn')::date;
  IF s_report.body->>'startsOn' IS DISTINCT FROM s_coverage.body->'input'->>'startsOn'
    OR s_report.body->>'endsOn' IS DISTINCT FROM s_coverage.body->'input'->>'endsOn'
    OR s_report.body->>'currency' IS DISTINCT FROM s_book.currency
    OR s_report.body->'currencyScale' IS DISTINCT FROM to_jsonb(s_book.currency_scale)
    OR s_report.body->'checkpoint'->>'sequence' IS DISTINCT FROM s_coverage.body->>'sequence'
    OR s_report.body->'checkpoint'->>'sourceRevision' IS DISTINCT FROM s_account->>'sourceRevision'
    OR s_report.body->>'accountLedgerSequence' IS DISTINCT FROM s_account_sequence::text THEN
    PERFORM openerp.fail('StaleDependency','Use reports for the same whole period, currency, source revision and current ledger cutoff.'); END IF;
  IF s_report.body->>'schemaVersion' IS DISTINCT FROM 'bank-capacity-v2'
    OR s_report.body->>'status' IS DISTINCT FROM 'complete'
    OR s_report.body->'sourceCoverageComplete' IS DISTINCT FROM 'true'::jsonb
    OR s_report.body->'unmatchedSource' IS DISTINCT FROM '[]'::jsonb
    OR s_report.body->'unmatchedLedger' IS DISTINCT FROM '[]'::jsonb
    OR s_report.body->'differences' IS DISTINCT FROM '[]'::jsonb
    OR s_report.body->'coverageGaps' IS DISTINCT FROM '[]'::jsonb
    OR s_report.body->>'openingDifferenceMinor' IS DISTINCT FROM '0'
    OR s_report.body->>'closingDifferenceMinor' IS DISTINCT FROM '0'
    OR s_report.body->>'bankOpeningMinor' IS DISTINCT FROM s_account->>'openingMinor'
    OR s_report.body->>'bankClosingMinor' IS DISTINCT FROM s_account->>'closingMinor' THEN
    PERFORM openerp.fail('InvalidJournal','Resolve every item residual, source gap and independent balance difference before signoff.'); END IF;
  SELECT coalesce(jsonb_agg(s->'statement' ORDER BY s->'statement'->>'id' COLLATE "C"),'[]')
    INTO s_statement_basis FROM jsonb_array_elements(s_account->'statements') s;
  SELECT coalesce(jsonb_agg(s ORDER BY s->>'id' COLLATE "C"),'[]')
    INTO s_report_statements FROM jsonb_array_elements(s_report.body->'statements') s;
  IF s_statement_basis IS DISTINCT FROM s_report_statements THEN
    PERFORM openerp.fail('StaleDependency','The reports must pin the same retained statements and evidence.'); END IF;
  s_body:=jsonb_build_object('id',openerp.new_id('banksignoff'),'version',1,'scope',p_scope,'input',p_input,
    'accountId',s_report.account_id,'startsOn',s_report.body->>'startsOn','endsOn',s_report.body->>'endsOn',
    'currency',s_book.currency,'currencyScale',s_book.currency_scale,
    'basis',jsonb_build_object('inventoryId',s_coverage.inventory_id,
      'inventoryDigest',openerp.digest(s_coverage.body->'inventory'),'coverageDigest',s_coverage.body->>'digest',
      'reconciliationDigest',openerp.digest(s_report.body),'statementDigest',openerp.digest(s_statement_basis),
      'allocationDigest',openerp.digest(jsonb_build_object('matches',s_report.body->'matches','allocations',s_report.body->'allocations')),
      'dependencyDigest',s_digest,'sourceRevision',s_account->>'sourceRevision',
      'ledgerSequence',s_book.committed_sequence::text,'accountLedgerSequence',s_account_sequence::text,'checkVersion','bank_signoff_v1'),
    'reviewScope','selected_declared_bank_account','coverage','not_established','financialCloseReady',false)
    ||openerp.commerce_record_metadata(p_key,'prepare_bank_signoff',s_actor);
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  INSERT INTO openerp.bank_signoff_plans VALUES(s_book.id,s_body->>'id',s_coverage.id,s_report.id,s_body);
  RETURN openerp.save_command(s_book.id,p_key,s_actor,'prepare_bank_signoff',p_input,s_body);
END $$;

CREATE FUNCTION openerp.sign_bank_reconciliation(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_previous jsonb; s_request jsonb:=jsonb_build_object('planId',p_id,'input',p_input);
  s_plan openerp.bank_signoff_plans; s_existing openerp.bank_reconciliation_signoffs;
  s_evidence openerp.evidence; s_body jsonb; s_content text; s_bytes integer;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(p_scope->>'bookId',p_key,s_actor,'sign_bank_reconciliation',s_request);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('ApprovalRequired','Review the exact plan and retain your signoff evidence and rationale.'); END IF;
  IF p_input-ARRAY['digest','version','evidenceId','rationale']<>'{}'::jsonb
    OR p_input->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(p_input->'digest') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'evidenceId') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'evidenceId','')!~'^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(p_input->>'rationale')),0) NOT BETWEEN 1 AND 2000
    OR length(p_input->>'rationale')>2000 THEN
    PERFORM openerp.fail('ApprovalRequired','Review the exact plan and retain your signoff evidence and rationale.'); END IF;
  SELECT * INTO s_plan FROM openerp.bank_signoff_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank signoff plan was not found in this book.'); END IF;
  IF p_input->>'digest' IS DISTINCT FROM s_plan.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Sign only the exact retained plan digest.'); END IF;
  SELECT * INTO s_existing FROM openerp.bank_reconciliation_signoffs s WHERE s.book_id=s_plan.book_id AND s.plan_id=s_plan.id;
  IF FOUND THEN
    IF s_existing.body->>'actorId' IS DISTINCT FROM s_actor
      OR s_existing.body-ARRAY['planId','evidenceSha256','actorId','signedAt','receipt'] IS DISTINCT FROM p_input THEN
      PERFORM openerp.fail('IdempotencyConflict','This preparation already has a different immutable signoff.'); END IF;
    RETURN openerp.save_command(s_plan.book_id,p_key,s_actor,'sign_bank_reconciliation',s_request,s_existing.body);
  END IF;
  PERFORM openerp.bank_require_profile(s_plan.book_id);
  IF NOT openerp.bank_signoff_current(s_plan.book_id,s_plan.body) THEN
    PERFORM openerp.fail('StaleDependency','The source, inventory, ledger or configuration basis changed. Prepare a fresh signoff.'); END IF;
  SELECT * INTO s_evidence FROM openerp.evidence e WHERE e.book_id=s_plan.book_id AND e.id=p_input->>'evidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the review evidence in this book before signing.'); END IF;
  s_body:=p_input||jsonb_build_object('planId',s_plan.id,'evidenceSha256',s_evidence.sha256,'actorId',s_actor,
    'signedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',p_key,'operation','sign_bank_reconciliation','actorId',s_actor));
  s_content:=openerp.canonical(jsonb_build_object('plan',s_plan.body,'signoff',s_body));
  s_bytes:=octet_length(convert_to(s_content,'UTF8'));
  IF s_bytes>1048576 THEN PERFORM openerp.fail('UnsupportedProfile','The signoff artifact exceeds1 MiB. Nothing was signed.'); END IF;
  INSERT INTO openerp.bank_reconciliation_signoffs VALUES(s_plan.book_id,s_plan.id,s_evidence.id,s_body,s_content,
    encode(sha256(convert_to(s_content,'UTF8')),'hex'),s_bytes);
  RETURN openerp.save_command(s_plan.book_id,p_key,s_actor,'sign_bank_reconciliation',s_request,s_body);
END $$;

CREATE FUNCTION openerp.get_bank_signoff(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_plan openerp.bank_signoff_plans; s_signed openerp.bank_reconciliation_signoffs; s_artifact jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO s_plan FROM openerp.bank_signoff_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank signoff plan was not found in this book.'); END IF;
  SELECT * INTO s_signed FROM openerp.bank_reconciliation_signoffs s WHERE s.book_id=s_plan.book_id AND s.plan_id=s_plan.id;
  IF FOUND THEN s_artifact:=jsonb_build_object('content',s_signed.content,'sha256',s_signed.sha256,
    'byteLength',s_signed.byte_length,'mediaType','application/json'); END IF;
  RETURN jsonb_build_object('plan',s_plan.body,'signoff',s_signed.body,'artifact',s_artifact,
    'dependenciesCurrent',openerp.bank_signoff_current(s_plan.book_id,s_plan.body));
END $$;
CREATE FUNCTION openerp.list_bank_signoffs(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'accountId',p.body->>'accountId',
    'startsOn',p.body->>'startsOn','endsOn',p.body->>'endsOn','createdAt',p.body->>'createdAt',
    'digest',p.body->>'digest','signedAt',s.body->>'signedAt') ORDER BY p.body->>'createdAt' DESC,p.id COLLATE "C"),'[]')
    INTO s_items FROM openerp.bank_signoff_plans p LEFT JOIN openerp.bank_reconciliation_signoffs s
      ON (s.book_id,s.plan_id)=(p.book_id,p.id) WHERE p.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',s_items);
END $$;
REVOKE ALL ON FUNCTION openerp.bank_signoff_current(text,jsonb),openerp.prepare_bank_signoff(text,jsonb,text,jsonb),
  openerp.sign_bank_reconciliation(text,jsonb,text,text,jsonb),openerp.get_bank_signoff(text,jsonb,text),
  openerp.list_bank_signoffs(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_bank_signoff(text,jsonb,text,jsonb),
  openerp.sign_bank_reconciliation(text,jsonb,text,text,jsonb),openerp.get_bank_signoff(text,jsonb,text),
  openerp.list_bank_signoffs(text,jsonb) TO openerp_runtime;
