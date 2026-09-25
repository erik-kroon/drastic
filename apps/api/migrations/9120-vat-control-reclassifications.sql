CREATE TABLE openerp.vat_control_profiles (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  identity_key text COLLATE "C" NOT NULL,
  role_evidence_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,identity_key),
  FOREIGN KEY (book_id,role_evidence_id) REFERENCES openerp.evidence(book_id,id),
  CHECK (body->>'id' IS NOT DISTINCT FROM id),
  CHECK (body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest'))
);

CREATE TABLE openerp.vat_control_account_roles (
  book_id text NOT NULL,
  profile_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('output_vat_control','input_vat_control','vat_settlement_control')),
  account_id text NOT NULL,
  account_version bigint NOT NULL CHECK (account_version>0),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL,
  PRIMARY KEY (book_id,profile_id,role),
  UNIQUE (book_id,profile_id,role,account_id),
  FOREIGN KEY (book_id,profile_id) REFERENCES openerp.vat_control_profiles(book_id,id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.accounts(book_id,id)
);

CREATE TABLE openerp.vat_reporting_obligations (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  registration_namespace text NOT NULL CHECK (registration_namespace='synthetic'),
  registration_id text NOT NULL,
  jurisdiction text NOT NULL CHECK (jurisdiction='SE'),
  scheme text NOT NULL CHECK (scheme='synthetic_output_input_v1'),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  period_evidence_id text,
  period_evidence_sha256 text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,registration_namespace,registration_id,jurisdiction,scheme,starts_on,ends_on),
  FOREIGN KEY (book_id,period_evidence_id) REFERENCES openerp.evidence(book_id,id),
  CHECK (starts_on<=ends_on),
  CHECK ((period_evidence_id IS NULL)=(period_evidence_sha256 IS NULL)),
  CHECK (body->>'id' IS NOT DISTINCT FROM id),
  CHECK (body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest')),
  CHECK (digest ~ '^sha256:[a-f0-9]{64}$')
);

CREATE TABLE openerp.vat_control_reclassification_reviews (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  obligation_id text NOT NULL,
  profile_id text NOT NULL,
  draft_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  change_set_id text,
  body jsonb NOT NULL CHECK (octet_length(body::text)<=1048576),
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,change_set_id),
  FOREIGN KEY (book_id,obligation_id) REFERENCES openerp.vat_reporting_obligations(book_id,id),
  FOREIGN KEY (book_id,profile_id) REFERENCES openerp.vat_control_profiles(book_id,id),
  FOREIGN KEY (book_id,draft_id) REFERENCES openerp.vat_return_drafts(book_id,id),
  FOREIGN KEY (book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (body->>'id' IS NOT DISTINCT FROM id),
  CHECK (body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest')),
  CHECK ((body->'postingPlan'='null'::jsonb)=(change_set_id IS NULL))
);

CREATE TABLE openerp.vat_control_reclassification_approvals (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  review_digest text NOT NULL,
  kernel_approval_id text,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text)<=262144),
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.vat_control_reclassification_reviews(book_id,id),
  FOREIGN KEY (book_id,kernel_approval_id) REFERENCES openerp.approvals(book_id,id),
  CHECK ((kernel_approval_id IS NULL)=(body->'kernelApproval'='null'::jsonb)),
  CHECK (body->>'id' IS NOT DISTINCT FROM id),
  CHECK (body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest'))
);

CREATE TABLE openerp.vat_control_reclassification_effects (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  obligation_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  draft_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('posted','no_effect')),
  change_set_id text,
  voucher_id text,
  posting_receipt_id text,
  posting_date date NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text)<=262144),
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,obligation_id),
  UNIQUE (book_id,review_id),
  UNIQUE (book_id,approval_id),
  UNIQUE (book_id,change_set_id),
  UNIQUE (book_id,voucher_id),
  FOREIGN KEY (book_id,obligation_id) REFERENCES openerp.vat_reporting_obligations(book_id,id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.vat_control_reclassification_reviews(book_id,id),
  FOREIGN KEY (book_id,approval_id) REFERENCES openerp.vat_control_reclassification_approvals(book_id,id),
  FOREIGN KEY (book_id,draft_id) REFERENCES openerp.vat_return_drafts(book_id,id),
  FOREIGN KEY (book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
  FOREIGN KEY (book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
  FOREIGN KEY (book_id,posting_receipt_id) REFERENCES openerp.execution_receipts(book_id,id),
  CHECK ((outcome='posted')=(change_set_id IS NOT NULL AND voucher_id IS NOT NULL AND posting_receipt_id IS NOT NULL)),
  CHECK ((outcome='no_effect')=(change_set_id IS NULL AND voucher_id IS NULL AND posting_receipt_id IS NULL)),
  CHECK (body->>'id' IS NOT DISTINCT FROM id),
  CHECK (body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest'))
);

CREATE TABLE openerp.vat_control_reclassification_contributions (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  effect_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 500),
  fact_id text NOT NULL,
  fact_revision_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,effect_id,ordinal),
  UNIQUE (book_id,effect_id,voucher_id,line_id),
  UNIQUE (book_id,voucher_id,line_id),
  FOREIGN KEY (book_id,effect_id) REFERENCES openerp.vat_control_reclassification_effects(book_id,id),
  FOREIGN KEY (book_id,voucher_id,line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id),
  CHECK (body->>'factId' IS NOT DISTINCT FROM fact_id),
  CHECK (body->>'factRevisionId' IS NOT DISTINCT FROM fact_revision_id),
  CHECK (body->>'voucherId' IS NOT DISTINCT FROM voucher_id),
  CHECK (body->>'lineId' IS NOT DISTINCT FROM line_id)
);
ALTER TABLE openerp.vat_fact_revisions
  ADD CONSTRAINT vat_fact_revision_identity UNIQUE (book_id,id,fact_id);
ALTER TABLE openerp.vat_control_reclassification_contributions
  ADD CONSTRAINT vat_contribution_fact_revision
  FOREIGN KEY (book_id,fact_revision_id,fact_id) REFERENCES openerp.vat_fact_revisions(book_id,id,fact_id);

CREATE TRIGGER immutable_vat_control_profile BEFORE UPDATE OR DELETE ON openerp.vat_control_profiles
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_account_role BEFORE UPDATE OR DELETE ON openerp.vat_control_account_roles
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_reporting_obligation BEFORE UPDATE OR DELETE ON openerp.vat_reporting_obligations
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_review BEFORE UPDATE OR DELETE ON openerp.vat_control_reclassification_reviews
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_approval BEFORE UPDATE OR DELETE ON openerp.vat_control_reclassification_approvals
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_effect BEFORE UPDATE OR DELETE ON openerp.vat_control_reclassification_effects
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_contribution BEFORE UPDATE OR DELETE ON openerp.vat_control_reclassification_contributions
FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE INDEX vat_control_obligation_interval ON openerp.vat_reporting_obligations(book_id,starts_on,ends_on);
CREATE INDEX vat_control_review_obligation ON openerp.vat_control_reclassification_reviews(book_id,obligation_id,ordinal);
CREATE INDEX vat_control_approval_review ON openerp.vat_control_reclassification_approvals(book_id,review_id,expires_at);
CREATE INDEX vat_control_contribution_fact ON openerp.vat_control_reclassification_contributions(book_id,fact_id,voucher_id,line_id);
CREATE INDEX vat_control_contribution_voucher ON openerp.vat_control_reclassification_contributions(book_id,voucher_id,line_id);

REVOKE ALL ON openerp.vat_control_profiles,openerp.vat_control_account_roles,openerp.vat_reporting_obligations,
  openerp.vat_control_reclassification_reviews,openerp.vat_control_reclassification_approvals,
  openerp.vat_control_reclassification_effects,openerp.vat_control_reclassification_contributions
FROM PUBLIC,openerp_runtime;

CREATE OR REPLACE FUNCTION openerp.vat_control_validate_reclassification_input(p_input jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_field text;
BEGIN
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','draftId','expectedDraftDigest','outputAccountId','inputAccountId',
    'settlementAccountId','roleEvidenceId','reviewEvidenceId','accountingPeriodId','postingDate','series','rationale','acknowledgeSyntheticOnly']);
  FOREACH v_field IN ARRAY ARRAY['draftId','outputAccountId','inputAccountId','settlementAccountId','roleEvidenceId',
    'reviewEvidenceId','accountingPeriodId'] LOOP
    IF jsonb_typeof(p_input->v_field) IS DISTINCT FROM 'string' OR p_input->>v_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select valid retained VAT draft, account, period and evidence identities.');
    END IF;
  END LOOP;
  IF p_input->>'profile' IS DISTINCT FROM 'vat_control_reclassification_v1'
     OR jsonb_typeof(p_input->'expectedDraftDigest') IS DISTINCT FROM 'string'
     OR p_input->>'expectedDraftDigest' !~ '^sha256:[a-f0-9]{64}$'
     OR jsonb_typeof(p_input->'series') IS DISTINCT FROM 'string'
     OR p_input->>'series' !~ '^[A-Z0-9]{1,16}$'
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Use the exact synthetic VAT control reclassification profile and acknowledge its synthetic-only scope.');
  END IF;
  PERFORM openerp.commerce_text(p_input,'rationale',2000);
  PERFORM openerp.bank_date(p_input->>'postingDate');
END $$;

CREATE OR REPLACE FUNCTION openerp.vat_control_profile_resolve(p_scope jsonb,p_input jsonb,p_create boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_identity text; v_body jsonb; v_id text; v_roles jsonb; v_sha text; v_count bigint;
  v_account_ids text[]; v_conflict boolean;
BEGIN
  SELECT e.sha256 INTO v_sha FROM openerp.evidence e WHERE e.book_id=p_scope->>'bookId' AND e.id=p_input->>'roleEvidenceId';
  IF v_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain the account-role evidence in this book first.'); END IF;
  IF p_input->>'outputAccountId'=p_input->>'inputAccountId'
    OR p_input->>'outputAccountId'=p_input->>'settlementAccountId'
    OR p_input->>'inputAccountId'=p_input->>'settlementAccountId' THEN
    PERFORM openerp.fail('InvalidJournal','Output, input and settlement VAT control accounts must be distinct.');
  END IF;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=p_scope->>'bookId'
    AND a.id IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId') ORDER BY a.id FOR SHARE;
  IF (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=p_scope->>'bookId' AND a.active
      AND a.id IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId'))<>3 THEN
    PERFORM openerp.fail('StaleDependency','Select three distinct active accounts in this book.');
  END IF;
  IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_scope->>'bookId'
      AND s.account_id IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId'))
    OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_scope->>'bookId'
      AND c.account_id IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId'))
    OR EXISTS(SELECT FROM openerp.owner_control_accounts c WHERE c.book_id=p_scope->>'bookId'
      AND c.account_id IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId'))
    OR EXISTS(SELECT FROM openerp.tax_account_sources s WHERE s.book_id=p_scope->>'bookId'
      AND s.account_id IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId'))
    OR EXISTS(SELECT FROM openerp.subledger_schedules s
      CROSS JOIN LATERAL(SELECT r.body FROM openerp.subledger_schedule_revisions r
        WHERE r.book_id=s.book_id AND r.schedule_id=s.id ORDER BY r.revision DESC LIMIT 1) r
       WHERE s.book_id=p_scope->>'bookId' AND (
         r.body->'terms'->>'debitAccountId'
           IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId')
         OR r.body->'terms'->>'creditAccountId'
           IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId'))) THEN
    PERFORM openerp.fail('InvalidJournal','The selected accounts already have a bank, commerce, owner, tax or subledger control role.');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('role',x.role,'accountId',a.id,
      'accountVersion',a.version::text,'code',a.code,'name',a.name,'active',a.active)
      ORDER BY CASE x.role WHEN 'output_vat_control' THEN 1 WHEN 'input_vat_control' THEN 2 ELSE 3 END),'[]')
    INTO v_roles
    FROM (VALUES ('output_vat_control',p_input->>'outputAccountId'),
      ('input_vat_control',p_input->>'inputAccountId'),('vat_settlement_control',p_input->>'settlementAccountId')) x(role,account_id)
    JOIN openerp.accounts a ON a.book_id=p_scope->>'bookId' AND a.id=x.account_id;
  v_account_ids:=ARRAY[p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId'];
  IF to_regclass('openerp.commerce_fx_items') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=$1
      AND EXISTS(SELECT FROM jsonb_array_elements(i.body->''accountBindings'') role
        WHERE role->>''accountId''=ANY($2::text[])))' INTO v_conflict USING p_scope->>'bookId',v_account_ids;
    IF v_conflict THEN PERFORM openerp.fail('InvalidJournal','A retained foreign-currency item already owns one of the selected VAT control accounts.'); END IF;
  END IF;
  IF to_regclass('openerp.subledger_impairments') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=$1
      AND (i.loss_account_id=ANY($2::text[]) OR i.accumulated_impairment_account_id=ANY($2::text[])))'
      INTO v_conflict USING p_scope->>'bookId',v_account_ids;
    IF v_conflict THEN PERFORM openerp.fail('InvalidJournal','A retained impairment already owns one of the selected VAT control accounts.'); END IF;
  END IF;
  v_identity:=openerp.digest(jsonb_build_object('profile','vat_control_reclassification_v1','profileVersion','1',
    'roleEvidenceId',p_input->>'roleEvidenceId','accountRoles',v_roles));
  SELECT p.body INTO v_body FROM openerp.vat_control_profiles p
    WHERE p.book_id=p_scope->>'bookId' AND p.identity_key=v_identity;
  IF NOT FOUND AND NOT p_create THEN
    PERFORM openerp.fail('StaleDependency','The reviewed VAT account-role profile changed. Prepare a new reclassification review.');
  END IF;
  IF FOUND THEN
    SELECT p.id INTO v_id FROM openerp.vat_control_profiles p
      WHERE p.book_id=p_scope->>'bookId' AND p.identity_key=v_identity;
    IF (SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.role,'accountId',r.account_id,
        'accountVersion',r.account_version::text,'code',r.code,'name',r.name,'active',r.active)
        ORDER BY CASE r.role WHEN 'output_vat_control' THEN 1 WHEN 'input_vat_control' THEN 2 ELSE 3 END),'[]')
        FROM openerp.vat_control_account_roles r WHERE r.book_id=p_scope->>'bookId' AND r.profile_id=v_id) IS DISTINCT FROM v_roles THEN
      PERFORM openerp.fail('StaleDependency','The retained account-role profile no longer matches the current account versions.');
    END IF;
  ELSE
    SELECT count(*) INTO v_count FROM openerp.vat_control_profiles p WHERE p.book_id=p_scope->>'bookId';
    IF v_count>=20 THEN PERFORM openerp.fail('UnsupportedProfile','This book supports 20 retained VAT control profiles; none were omitted.'); END IF;
    v_id:=openerp.new_id('vatprofile');
    v_body:=jsonb_build_object('id',v_id,'profile','vat_control_reclassification_v1','profileVersion','1','jurisdiction','SE',
      'scheme','synthetic_output_input_v1','evidenceSha256',v_sha);
    v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
    INSERT INTO openerp.vat_control_profiles(book_id,id,identity_key,role_evidence_id,body)
      VALUES(p_scope->>'bookId',v_id,v_identity,p_input->>'roleEvidenceId',v_body);
    INSERT INTO openerp.vat_control_account_roles(book_id,profile_id,role,account_id,account_version,code,name,active)
      SELECT p_scope->>'bookId',v_id,x.role,a.id,a.version,a.code,a.name,a.active
      FROM (VALUES ('output_vat_control',p_input->>'outputAccountId'),
        ('input_vat_control',p_input->>'inputAccountId'),('vat_settlement_control',p_input->>'settlementAccountId')) x(role,account_id)
      JOIN openerp.accounts a ON a.book_id=p_scope->>'bookId' AND a.id=x.account_id;
  END IF;
  RETURN jsonb_build_object('profileId',v_id,'profile',v_body,'accountRoles',v_roles);
END $$;

CREATE OR REPLACE FUNCTION openerp.vat_control_obligation_resolve(p_scope jsonb,p_draft openerp.vat_return_drafts,p_create boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_body jsonb; v_id text; v_sha text; v_existing_sha text; v_count bigint;
BEGIN
  IF p_draft.body->'input'->'periodEvidenceId' IS DISTINCT FROM 'null'::jsonb THEN
    SELECT e.sha256 INTO v_sha FROM openerp.evidence e WHERE e.book_id=p_scope->>'bookId'
      AND e.id=p_draft.body->'input'->>'periodEvidenceId';
    IF v_sha IS NULL OR v_sha IS DISTINCT FROM p_draft.body->>'periodEvidenceSha256' THEN
      PERFORM openerp.fail('StaleDependency','The saved VAT draft no longer retains its exact reporting-period evidence.');
    END IF;
  END IF;
  v_body:=jsonb_build_object('registrationNamespace','synthetic','registrationId','synthetic_registration',
    'jurisdiction','SE','scheme','synthetic_output_input_v1','startsOn',p_draft.body->'input'->>'startsOn',
    'endsOn',p_draft.body->'input'->>'endsOn','periodEvidenceId',p_draft.body->'input'->>'periodEvidenceId');
  SELECT o.id,o.body,o.period_evidence_sha256 INTO v_id,v_body,v_existing_sha FROM openerp.vat_reporting_obligations o
    WHERE o.book_id=p_scope->>'bookId' AND o.registration_namespace='synthetic'
      AND o.registration_id='synthetic_registration' AND o.jurisdiction='SE' AND o.scheme='synthetic_output_input_v1'
      AND o.starts_on=(p_draft.body->'input'->>'startsOn')::date AND o.ends_on=(p_draft.body->'input'->>'endsOn')::date;
  IF v_id IS NOT NULL AND (v_body->>'periodEvidenceId' IS DISTINCT FROM p_draft.body->'input'->>'periodEvidenceId'
    OR v_existing_sha IS DISTINCT FROM v_sha) THEN
    PERFORM openerp.fail('StaleDependency','The reporting-period evidence differs from the retained VAT obligation. Keep one reviewed period basis for this obligation.');
  END IF;
  IF v_id IS NULL AND NOT p_create THEN
    PERFORM openerp.fail('StaleDependency','The retained VAT reporting obligation is unavailable. Prepare a new reclassification review.');
  END IF;
  IF v_id IS NULL THEN
    SELECT count(*) INTO v_count FROM openerp.vat_reporting_obligations o WHERE o.book_id=p_scope->>'bookId';
    IF v_count>=200 THEN PERFORM openerp.fail('UnsupportedProfile','This book supports 200 retained VAT reporting obligations; none were omitted.'); END IF;
    v_body:=jsonb_build_object('registrationNamespace','synthetic','registrationId','synthetic_registration',
      'jurisdiction','SE','scheme','synthetic_output_input_v1','startsOn',p_draft.body->'input'->>'startsOn',
      'endsOn',p_draft.body->'input'->>'endsOn','periodEvidenceId',p_draft.body->'input'->>'periodEvidenceId');
    v_id:=openerp.new_id('vatobligation');
    v_body:=jsonb_build_object('id',v_id)||v_body;
    v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
    INSERT INTO openerp.vat_reporting_obligations(book_id,id,registration_namespace,registration_id,jurisdiction,scheme,
      starts_on,ends_on,period_evidence_id,period_evidence_sha256,body,digest)
      VALUES(p_scope->>'bookId',v_id,'synthetic','synthetic_registration','SE','synthetic_output_input_v1',
        (p_draft.body->'input'->>'startsOn')::date,(p_draft.body->'input'->>'endsOn')::date,
        p_draft.body->'input'->>'periodEvidenceId',v_sha,v_body,v_body->>'digest');
  END IF;
  RETURN v_body;
END $$;

CREATE OR REPLACE FUNCTION openerp.vat_control_reclassification_basis(p_scope jsonb,p_input jsonb,p_create boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE
  v_book openerp.books; v_period openerp.periods; v_year openerp.fiscal_years; v_draft openerp.vat_return_drafts;
  v_profile_selection jsonb; v_profile jsonb; v_roles jsonb; v_obligation jsonb; v_sha text;
  v_current_facts jsonb; v_saved_facts jsonb; v_saved_observation jsonb; v_current_observation jsonb;
  v_assessment jsonb; v_fact jsonb; v_input jsonb; v_tax_line jsonb; v_voucher openerp.vouchers; v_line openerp.journal_lines;
  v_account_version bigint; v_account_active boolean; v_role text; v_expected_account text; v_balance numeric; v_ledger_tax numeric:=0;
  v_source_tax numeric; v_source_difference numeric; v_rate_difference numeric;
  v_relevant boolean; v_current_relevant boolean; v_saved_relevant_ids text[]:='{}'; v_pair text;
  v_contributions jsonb:='[]'; v_current_relevant_facts jsonb:='[]'::jsonb; v_source_states jsonb:='[]'; v_posting_lines jsonb:='[]';
  v_role_ledger jsonb; v_box10 numeric; v_box48 numeric; v_net numeric;
  v_reported numeric; v_residual numeric; v_output numeric:=0; v_input_tax numeric:=0;
  v_dependency jsonb; v_dependency_digest text; v_relevant_count integer:=0; v_index integer; v_latest_source_date date;
BEGIN
  PERFORM openerp.vat_control_validate_reclassification_input(p_input);
  SELECT b.* INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId';
  IF v_book.profile<>'synthetic-core-v1' OR v_book.authority<>'native' OR v_book.currency<>'SEK' OR v_book.currency_scale<>2 THEN
    PERFORM openerp.fail('UnsupportedProfile','VAT control reclassification supports only native synthetic-core-v1 books in SEK with scale 2.');
  END IF;
  SELECT d.* INTO v_draft FROM openerp.vat_return_drafts d WHERE d.book_id=v_book.id AND d.id=p_input->>'draftId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The selected VAT draft was not found in this book.'); END IF;
  IF v_draft.body->>'digest' IS DISTINCT FROM p_input->>'expectedDraftDigest'
    OR v_draft.body->>'digest' IS DISTINCT FROM openerp.digest(v_draft.body-'digest')
    OR v_draft.body->'scope' IS DISTINCT FROM p_scope THEN
    PERFORM openerp.fail('StaleDependency','Select the exact saved VAT draft and digest in this book.');
  END IF;
  IF v_draft.body->'input'->>'mode' IS DISTINCT FROM 'synthetic_demonstration'
    OR v_draft.body->'input'->>'otherBoxes' IS DISTINCT FROM 'absent_in_synthetic_example'
    OR v_draft.body->'calculation'->>'engine' IS DISTINCT FROM 'vat-return-draft-v3'
    OR v_draft.body->'basis'->>'bookProfile' IS DISTINCT FROM 'synthetic-core-v1'
    OR v_draft.body->'basis'->>'currency' IS DISTINCT FROM 'SEK'
    OR v_draft.body->'basis'->'currencyScale' IS DISTINCT FROM '2'::jsonb
    OR v_draft.body->'calculation'->'coverageEstablished' IS DISTINCT FROM 'false'::jsonb
    OR v_draft.body->'calculation'->'ledgerReconciled' IS DISTINCT FROM 'false'::jsonb
    OR v_draft.body->'calculation'->'legalProfileActive' IS DISTINCT FROM 'false'::jsonb
    OR v_draft.body->'calculation'->'filingReady' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(v_draft.body->'calculation'->'syntheticBoxes') IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('UnsupportedProfile','Use a saved SEK scale-2 vat-return-draft-v3 synthetic demonstration with other boxes explicitly absent.');
  END IF;
  SELECT e.sha256 INTO v_sha FROM openerp.evidence e WHERE e.book_id=v_book.id AND e.id=p_input->>'reviewEvidenceId';
  IF v_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain the operator review evidence in this book first.'); END IF;
  SELECT p.* INTO v_period FROM openerp.periods p WHERE p.book_id=v_book.id AND p.id=p_input->>'accountingPeriodId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The selected accounting period was not found in this book.'); END IF;
  SELECT y.* INTO STRICT v_year FROM openerp.fiscal_years y WHERE y.book_id=v_book.id AND y.id=v_period.fiscal_year_id;
  PERFORM openerp.bank_date(p_input->>'postingDate');
  IF v_period.locked OR (p_input->>'postingDate')::date NOT BETWEEN v_period.starts_on AND v_period.ends_on
    OR v_period.starts_on<v_year.starts_on OR v_period.ends_on>v_year.ends_on THEN
    PERFORM openerp.fail('PeriodLocked','The reclassification posting date must fall in the selected open accounting period.');
  END IF;
  v_profile_selection:=openerp.vat_control_profile_resolve(p_scope,p_input,p_create);
  v_profile:=v_profile_selection->'profile'; v_roles:=v_profile_selection->'accountRoles';
  v_obligation:=openerp.vat_control_obligation_resolve(p_scope,v_draft,p_create);
  IF EXISTS(SELECT FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=v_book.id
      AND e.obligation_id=v_obligation->>'id') THEN
    PERFORM openerp.fail('AlreadyPosted','This VAT reporting obligation already has its first reclassification effect.');
  END IF;
  v_saved_facts:=v_draft.body->'basis'->'facts';
  IF jsonb_typeof(v_saved_facts) IS DISTINCT FROM 'array' OR jsonb_typeof(v_draft.body->'calculation'->'assessments') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_saved_facts)>200 OR jsonb_array_length(v_saved_facts)<>jsonb_array_length(v_draft.body->'calculation'->'assessments')
    OR jsonb_array_length(v_saved_facts)<>(SELECT count(DISTINCT x->'fact'->>'factId') FROM jsonb_array_elements(v_saved_facts) x)
    OR jsonb_array_length(v_saved_facts)<>(SELECT count(DISTINCT x->>'factId') FROM jsonb_array_elements(v_draft.body->'calculation'->'assessments') x) THEN
    PERFORM openerp.fail('UnsupportedProfile','The saved VAT draft has incomplete or ambiguous fact-assessment lineage.');
  END IF;
  v_current_facts:=openerp.vat_return_basis_body(v_book.id)->'facts';
  FOR v_index,v_saved_observation IN SELECT x.ordinality,x.value FROM jsonb_array_elements(v_saved_facts) WITH ORDINALITY x(value,ordinality)
    ORDER BY x.ordinality LOOP
    v_fact:=v_saved_observation->'fact'; v_input:=v_fact->'input';
    v_assessment:=v_draft.body->'calculation'->'assessments'->(v_index-1);
    IF v_assessment->>'factId' IS DISTINCT FROM v_fact->>'factId' OR v_assessment->>'sourceDigest' IS DISTINCT FROM v_fact->>'digest' THEN
      PERFORM openerp.fail('UnsupportedProfile','The saved VAT fact and assessment identities do not agree.');
    END IF;
    SELECT x.value INTO v_current_observation FROM jsonb_array_elements(v_current_facts) x
      WHERE x.value->'fact'->>'factId'=v_fact->>'factId';
    v_relevant:=v_input->>'taxPointOn' IS NULL OR v_input->>'taxPointOn' BETWEEN v_draft.body->'input'->>'startsOn' AND v_draft.body->'input'->>'endsOn';
    v_current_relevant:=v_current_observation IS NOT NULL AND
      (v_current_observation->'fact'->'input'->>'taxPointOn' IS NULL OR
        v_current_observation->'fact'->'input'->>'taxPointOn' BETWEEN v_draft.body->'input'->>'startsOn' AND v_draft.body->'input'->>'endsOn');
    IF v_relevant OR v_current_relevant THEN
      IF v_current_observation IS NULL OR v_relevant IS DISTINCT FROM v_current_relevant
        OR v_current_observation IS DISTINCT FROM v_saved_observation THEN
        PERFORM openerp.fail('StaleDependency','A relevant VAT fact, withdrawal, expense link, voucher or tax line changed after the saved draft.');
      END IF;
      IF v_assessment->>'state' IS DISTINCT FROM 'included_synthetic' OR v_assessment->'blockers'<>'[]'::jsonb
        OR v_assessment->'contribution' IS NULL
        OR v_assessment->>'sourceDifferenceMinor' IS DISTINCT FROM '0'
        OR v_assessment->>'rateDifferenceNumerator' IS DISTINCT FROM '0'
        OR v_assessment->'ledgerDifferenceMinor' IS DISTINCT FROM '0'
        OR v_assessment->'ledgerTaxMinor' IS NULL THEN
        PERFORM openerp.fail('StaleDependency','Every relevant VAT fact must be included with exact source, rate and ledger agreement and no assessment blocker.');
      END IF;
      v_saved_relevant_ids:=array_append(v_saved_relevant_ids,v_fact->>'factId');
      v_current_relevant_facts:=v_current_relevant_facts||v_current_observation;
      v_relevant_count:=v_relevant_count+1;
      IF v_input->>'recordClass' IS DISTINCT FROM 'synthetic' OR v_input->>'treatment' NOT IN ('domestic_sale','domestic_purchase') THEN
        PERFORM openerp.fail('UnsupportedProfile','Only included synthetic sale and purchase VAT facts can be reclassified.');
      END IF;
      v_role:=CASE WHEN v_input->>'treatment'='domestic_sale' THEN 'output_vat_control' ELSE 'input_vat_control' END;
      v_expected_account:=CASE WHEN v_role='output_vat_control' THEN p_input->>'outputAccountId' ELSE p_input->>'inputAccountId' END;
      v_source_difference:=(v_input->>'grossMinor')::numeric-(v_input->>'netMinor')::numeric-(v_input->>'vatMinor')::numeric;
      v_rate_difference:=(v_input->>'vatMinor')::numeric*4-(v_input->>'netMinor')::numeric;
      IF v_source_difference<>0 OR v_rate_difference<>0 THEN
        PERFORM openerp.fail('StaleDependency','The relevant VAT fact no longer has exact source and rate agreement.');
      END IF;
      IF v_role='output_vat_control' THEN
        IF v_assessment->'contribution'->>'box05Minor' IS DISTINCT FROM v_input->>'netMinor'
          OR v_assessment->'contribution'->>'box10Minor' IS DISTINCT FROM v_input->>'vatMinor'
          OR v_assessment->'contribution'->>'box48Minor' IS DISTINCT FROM '0' THEN
          PERFORM openerp.fail('StaleDependency','The output VAT contribution does not exactly match its saved assessment.');
        END IF;
      ELSE
        IF v_assessment->'contribution'->>'box05Minor' IS DISTINCT FROM '0'
          OR v_assessment->'contribution'->>'box10Minor' IS DISTINCT FROM '0'
          OR v_assessment->'contribution'->>'box48Minor' IS DISTINCT FROM v_input->>'vatMinor' THEN
          PERFORM openerp.fail('StaleDependency','The input VAT contribution does not exactly match its saved assessment.');
        END IF;
      END IF;
      IF v_input->>'voucherId' IS NULL OR jsonb_typeof(v_input->'taxLineIds') IS DISTINCT FROM 'array'
        OR jsonb_array_length(v_input->>'taxLineIds')=0
        OR jsonb_array_length(v_input->'taxLineIds')<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(v_input->'taxLineIds') x)
        OR jsonb_array_length(v_input->'taxLineIds')<>jsonb_array_length(v_current_observation->'taxLines')
        OR v_current_observation->'withdrawal'<>'null'::jsonb
        OR v_current_observation->'expenseSourceWithdrawn'<>'false'::jsonb
        OR v_current_observation->'expenseLinkCurrent'<>'true'::jsonb
        OR v_current_observation->'voucherReversed'<>'false'::jsonb
        OR v_current_observation->>'voucherPostingDate' NOT BETWEEN v_draft.body->'input'->>'startsOn' AND v_draft.body->'input'->>'endsOn' THEN
        PERFORM openerp.fail('StaleDependency','Every relevant VAT fact needs a current, unreversed, exact posted VAT line basis inside the reporting interval.');
      END IF;
      SELECT v.* INTO STRICT v_voucher FROM openerp.vouchers v WHERE v.book_id=v_book.id AND v.id=v_input->>'voucherId';
      IF v_voucher.sequence>v_book.committed_sequence OR v_voucher.posting_purpose IN ('reversal','vat_control_reclassification_v1')
        OR v_voucher.posting_date NOT BETWEEN v_draft.body->'input'->>'startsOn' AND v_draft.body->'input'->>'endsOn'
        OR EXISTS(SELECT FROM openerp.vouchers c WHERE c.book_id=v_book.id AND c.corrects_voucher_id=v_voucher.id) THEN
       PERFORM openerp.fail('StaleDependency','A relevant VAT source voucher is reversed, corrected, reclassification-owned or outside the committed reporting basis.');
       END IF;
       v_latest_source_date:=greatest(coalesce(v_latest_source_date,v_voucher.posting_date),v_voucher.posting_date);
       v_ledger_tax:=0;
      FOR v_tax_line IN SELECT x.value FROM jsonb_array_elements(v_current_observation->'taxLines') x(value) ORDER BY x.value->>'id' COLLATE "C" LOOP
        SELECT a.version,a.active INTO STRICT v_account_version,v_account_active FROM openerp.accounts a WHERE a.book_id=v_book.id AND a.id=v_tax_line->>'accountId';
        SELECT l.* INTO STRICT v_line FROM openerp.journal_lines l
          WHERE l.book_id=v_book.id AND l.voucher_id=v_voucher.id AND l.id=v_tax_line->>'id';
        IF v_line.account_id IS DISTINCT FROM v_expected_account OR NOT v_account_active
          OR (v_role='output_vat_control' AND (v_line.debit_minor<>0 OR v_line.credit_minor<=0))
          OR (v_role='input_vat_control' AND (v_line.debit_minor<=0 OR v_line.credit_minor<>0))
          OR (v_tax_line->>'accountId' IS DISTINCT FROM v_line.account_id)
          OR (v_tax_line->>'debitMinor' IS DISTINCT FROM v_line.debit_minor::text)
          OR (v_tax_line->>'creditMinor' IS DISTINCT FROM v_line.credit_minor::text)
          OR openerp.tax_account_line_claimed(v_book.id,v_line.voucher_id,v_line.id)
          OR EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=v_book.id AND c.voucher_id=v_line.voucher_id AND c.line_id=v_line.id)
          OR EXISTS(SELECT FROM openerp.subledger_basis_lines s WHERE s.book_id=v_book.id AND s.voucher_id=v_line.voucher_id AND s.line_id=v_line.id) THEN
          PERFORM openerp.fail('InvalidJournal','Each selected VAT line must use its exact reviewed role, sign and amount and have no other retained capacity.');
        END IF;
        v_pair:=v_line.voucher_id||':'||v_line.id;
        IF EXISTS(SELECT FROM jsonb_array_elements(v_contributions) x WHERE x.value->>'voucherId'||':'||x.value->>'lineId'=v_pair) THEN
          PERFORM openerp.fail('InvalidJournal','A posted VAT line cannot contribute to more than one fact.');
        END IF;
        v_ledger_tax:=v_ledger_tax+CASE WHEN v_role='output_vat_control' THEN v_line.credit_minor-v_line.debit_minor ELSE v_line.debit_minor-v_line.credit_minor END;
        v_balance:=v_line.debit_minor-v_line.credit_minor;
        v_contributions:=v_contributions||jsonb_build_array(jsonb_build_object(
          'factId',v_fact->>'factId','factRevisionId',v_fact->>'id','factRevision',v_fact->'revision','factDigest',v_fact->>'digest',
          'voucherId',v_line.voucher_id,'lineId',v_line.id,'role',v_role,'accountId',v_line.account_id,
          'accountVersion',v_account_version::text,'debitMinor',v_line.debit_minor::text,'creditMinor',v_line.credit_minor::text,
          'balanceMinor',v_balance::text));
        v_source_states:=v_source_states||jsonb_build_array(jsonb_build_object(
          'factId',v_fact->>'factId','voucher',jsonb_build_object('id',v_voucher.id,'sequence',v_voucher.sequence::text,
            'postingDate',v_voucher.posting_date::text,'eventId',v_voucher.event_id,'postingPurpose',v_voucher.posting_purpose,
            'correctsVoucherId',v_voucher.corrects_voucher_id,'changeSetId',v_voucher.change_set_id,'action',v_voucher.action),
          'line',jsonb_build_object('id',v_line.id,'ordinal',v_line.ordinal,'accountId',v_line.account_id,
            'debitMinor',v_line.debit_minor::text,'creditMinor',v_line.credit_minor::text,'description',v_line.description),
          'correctionVoucherIds',coalesce((SELECT jsonb_agg(c.id ORDER BY c.id COLLATE "C") FROM openerp.vouchers c
            WHERE c.book_id=v_book.id AND c.corrects_voucher_id=v_voucher.id),'[]')));
      END LOOP;
      v_source_tax:=CASE WHEN v_role='output_vat_control' THEN (v_input->>'vatMinor')::numeric ELSE (v_input->>'vatMinor')::numeric END;
      IF v_ledger_tax IS DISTINCT FROM v_source_tax OR v_assessment->>'ledgerTaxMinor' IS DISTINCT FROM v_ledger_tax::text THEN
        PERFORM openerp.fail('StaleDependency','The saved ledger VAT amount does not exactly match the current posted VAT lines.');
      END IF;
    END IF;
  END LOOP;
  IF v_latest_source_date IS NOT NULL AND (p_input->>'postingDate')::date<v_latest_source_date THEN
    PERFORM openerp.fail('StaleDependency','The reclassification posting date cannot precede a selected VAT source voucher.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(v_current_facts) x
      WHERE (x.value->'fact'->'input'->>'taxPointOn' IS NULL OR x.value->'fact'->'input'->>'taxPointOn'
          BETWEEN v_draft.body->'input'->>'startsOn' AND v_draft.body->'input'->>'endsOn')
        AND NOT x.value->'fact'->>'factId'=ANY(v_saved_relevant_ids)) THEN
    PERFORM openerp.fail('StaleDependency','A current VAT fact relevant to the interval is not included in the saved draft.');
  END IF;
  IF jsonb_array_length(v_contributions)>500 THEN
    PERFORM openerp.fail('UnsupportedProfile','A VAT control reclassification supports at most 500 exact contribution lines.');
  END IF;
  IF (v_draft.body->'calculation'->>'includedCount')::integer<>(SELECT count(*) FROM jsonb_array_elements(v_draft.body->'calculation'->'assessments') x WHERE x.value->'contribution' IS NOT NULL)
    OR (v_draft.body->'calculation'->>'excludedCount')::integer<>(SELECT count(*) FROM jsonb_array_elements(v_draft.body->'calculation'->'assessments') x WHERE x.value->'contribution' IS NULL) THEN
    PERFORM openerp.fail('UnsupportedProfile','The saved VAT inclusion counts do not match its exact assessments.');
  END IF;
  IF (v_draft.body->'calculation'->'syntheticBoxes'->'box10'->>'exactMinor')::numeric
      IS DISTINCT FROM (SELECT coalesce(sum((x.value->'contribution'->>'box10Minor')::numeric),0) FROM jsonb_array_elements(v_draft.body->'calculation'->'assessments') x WHERE x.value->'contribution' IS NOT NULL)
    OR (v_draft.body->'calculation'->'syntheticBoxes'->'box48'->>'exactMinor')::numeric
      IS DISTINCT FROM (SELECT coalesce(sum((x.value->'contribution'->>'box48Minor')::numeric),0) FROM jsonb_array_elements(v_draft.body->'calculation'->'assessments') x WHERE x.value->'contribution' IS NOT NULL) THEN
    PERFORM openerp.fail('UnsupportedProfile','The saved synthetic VAT boxes do not reconstruct from all included contributions.');
  END IF;
  IF v_draft.body->'calculation'->'syntheticBoxes'->'box10'->>'exactMinor' IS NULL
      OR v_draft.body->'calculation'->'syntheticBoxes'->'box10'->>'exactMinor' !~ '^(0|[1-9][0-9]{0,37})$'
    OR v_draft.body->'calculation'->'syntheticBoxes'->'box48'->>'exactMinor' IS NULL
      OR v_draft.body->'calculation'->'syntheticBoxes'->'box48'->>'exactMinor' !~ '^(0|[1-9][0-9]{0,37})$'
    OR v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'exactMinor' IS NULL
      OR v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'exactMinor' !~ '^(0|-?[1-9][0-9]{0,37})$'
    OR v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'reportedKrona' IS NULL
      OR v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'reportedKrona' !~ '^(0|-?[1-9][0-9]{0,37})$'
    OR v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'residualMinor' IS NULL
      OR v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'residualMinor' !~ '^(0|-?[1-9][0-9]{0,37})$' THEN
    PERFORM openerp.fail('UnsupportedProfile','Boxes 10, 48 and 49 require canonical exact minor-unit strings.');
  END IF;
  v_box10:=(v_draft.body->'calculation'->'syntheticBoxes'->'box10'->>'exactMinor')::numeric;
  v_box48:=(v_draft.body->'calculation'->'syntheticBoxes'->'box48'->>'exactMinor')::numeric;
  v_net:=(v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'exactMinor')::numeric;
  v_reported:=(v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'reportedKrona')::numeric;
  v_residual:=(v_draft.body->'calculation'->'syntheticBoxes'->'box49'->>'residualMinor')::numeric;
  IF v_box10<0 OR v_box48<0 OR v_net<>v_box10-v_box48 THEN
     PERFORM openerp.fail('UnsupportedProfile','The selected synthetic net must equal output tax less deductible input tax; reported kronor and residuals remain separate and unposted.');
   END IF;
   SELECT coalesce(sum((x.value->'fact'->'input'->>'vatMinor')::numeric) FILTER (WHERE x.value->'fact'->'input'->>'treatment'='domestic_sale'),0),
     coalesce(sum((x.value->'fact'->'input'->>'vatMinor')::numeric) FILTER (WHERE x.value->'fact'->'input'->>'treatment'='domestic_purchase'),0)
    INTO v_output,v_input_tax FROM jsonb_array_elements(v_current_relevant_facts) x;
  IF v_output<>v_box10 OR v_input_tax<>v_box48 THEN
    PERFORM openerp.fail('StaleDependency','The exact current contribution VAT amounts differ from saved boxes 10 and 48.');
  END IF;
  IF v_relevant_count=0 AND (v_box10<>0 OR v_box48<>0 OR v_net<>0 OR jsonb_array_length(v_contributions)<>0) THEN
    PERFORM openerp.fail('InvalidJournal','Only exact zero boxes may produce a no-effect reclassification receipt.');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId',v.id,'lineId',l.id,'ordinal',l.ordinal,'sequence',v.sequence::text,
      'postingDate',v.posting_date::text,'eventId',v.event_id,'postingPurpose',v.posting_purpose,
      'correctsVoucherId',v.corrects_voucher_id,'changeSetId',v.change_set_id,'accountId',l.account_id,
      'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,'description',l.description)
      ORDER BY v.sequence,l.ordinal,l.id COLLATE "C"),'[]')
    INTO v_role_ledger
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
     WHERE l.book_id=v_book.id AND l.account_id IN(p_input->>'outputAccountId',p_input->>'inputAccountId',p_input->>'settlementAccountId')
       AND v.posting_purpose<>'vat_control_reclassification_v1'
       AND v.posting_date BETWEEN v_draft.body->'input'->>'startsOn' AND v_draft.body->'input'->>'endsOn'
      AND v.sequence<=v_book.committed_sequence;
  IF EXISTS(SELECT FROM jsonb_array_elements(v_role_ledger) l
      WHERE l.value->>'accountId' IN(p_input->>'outputAccountId',p_input->>'inputAccountId')
        AND NOT EXISTS(SELECT FROM jsonb_array_elements(v_contributions) c
          WHERE c.value->>'voucherId'=l.value->>'voucherId' AND c.value->>'lineId'=l.value->>'lineId'))
    OR EXISTS(SELECT FROM jsonb_array_elements(v_role_ledger) l WHERE l.value->>'accountId'=p_input->>'settlementAccountId') THEN
    PERFORM openerp.fail('StaleDependency','Every output and input role line in the interval must be selected, and settlement must have no prior unexplained line.');
  END IF;
  FOR v_tax_line IN SELECT x.value FROM jsonb_array_elements(v_contributions) x(value) ORDER BY x.value->>'voucherId' COLLATE "C",x.value->>'lineId' COLLATE "C" LOOP
    v_balance:=(v_tax_line->>'balanceMinor')::numeric;
    IF v_balance<>0 THEN
      v_posting_lines:=v_posting_lines||jsonb_build_array(jsonb_build_object('lineId','vatline_'||substr(openerp.digest(jsonb_build_object('obligationId',v_obligation->>'id','kind','reverse','factId',v_tax_line->>'factId','voucherId',v_tax_line->>'voucherId','lineId',v_tax_line->>'lineId')),9,32),
        'accountId',v_tax_line->>'accountId','debitMinor',(CASE WHEN v_balance<0 THEN -v_balance ELSE 0 END)::text,
        'creditMinor',(CASE WHEN v_balance>0 THEN v_balance ELSE 0 END)::text,
        'description','Reverse '||v_tax_line->>'role'||' VAT control'));
    END IF;
  END LOOP;
  IF v_net<>0 THEN
    v_posting_lines:=v_posting_lines||jsonb_build_array(jsonb_build_object('lineId','vatline_'||substr(openerp.digest(jsonb_build_object('obligationId',v_obligation->>'id','kind','settlement')),9,32),
      'accountId',p_input->>'settlementAccountId','debitMinor',(CASE WHEN v_net<0 THEN -v_net ELSE 0 END)::text,
      'creditMinor',(CASE WHEN v_net>0 THEN v_net ELSE 0 END)::text,'description','VAT settlement control'));
  END IF;
  IF jsonb_array_length(v_posting_lines)>500 THEN
    PERFORM openerp.fail('UnsupportedProfile','The exact reclassification plan exceeds 500 posting lines; no partial voucher was created.');
  END IF;
  v_dependency:=jsonb_build_object('version','vat_control_reclassification_dependency_v1',
    'book',jsonb_build_object('profile',v_book.profile,'profileVersion',v_book.profile_version::text,'authority',v_book.authority,
      'writerEpoch',v_book.writer_epoch::text,'currency',v_book.currency,'currencyScale',v_book.currency_scale),
    'draft',jsonb_build_object('id',v_draft.id,'digest',v_draft.body->>'digest','basisDigest',v_draft.body->'basis'->>'digest',
      'engine',v_draft.body->'calculation'->>'engine','input',v_draft.body->'input','calculation',v_draft.body->'calculation'),
    'profile',v_profile,'accountRoles',v_roles,'obligation',v_obligation,
    'period',to_jsonb(v_period),'fiscalYear',to_jsonb(v_year),
    'roleEvidenceSha256',v_profile->>'evidenceSha256','reviewEvidenceSha256',v_sha,
    'currentFacts',v_current_relevant_facts,'sourceStates',v_source_states,'roleLedger',v_role_ledger,
    'amounts',jsonb_build_object('outputTaxMinor',v_box10::text,'deductibleInputTaxMinor',v_box48::text,
      'accountingNetMinor',v_net::text,'reportedNetKrona',v_reported::text,'reportedResidualMinor',v_residual::text,'assessedMinor',NULL),
    'contributions',v_contributions);
  v_dependency_digest:=openerp.digest(v_dependency);
  RETURN jsonb_build_object('profile',v_profile,'obligation',v_obligation,
    'draft',jsonb_build_object('id',v_draft.id,'digest',v_draft.body->>'digest','basisDigest',v_draft.body->'basis'->>'digest',
      'engine',v_draft.body->'calculation'->>'engine','startsOn',v_draft.body->'input'->>'startsOn','endsOn',v_draft.body->'input'->>'endsOn'),
    'amounts',jsonb_build_object('outputTaxMinor',v_box10::text,'deductibleInputTaxMinor',v_box48::text,
      'accountingNetMinor',v_net::text,'reportedNetKrona',v_reported::text,'reportedResidualMinor',v_residual::text,'assessedMinor',NULL),
    'accountRoles',v_roles,'contributions',v_contributions,'period',jsonb_build_object('id',v_period.id,'version',v_period.version::text),
    'roleEvidenceSha256',v_profile->>'evidenceSha256','reviewEvidenceSha256',v_sha,'postingLines',v_posting_lines,
    'currentFactDigest',openerp.digest(v_current_relevant_facts),'dependencyDigest',v_dependency_digest,
    'coverage','not_established','legalProfileActive',false,'taxAccountMatched',false);
END $$;

CREATE OR REPLACE FUNCTION openerp.prepare_vat_control_reclassification(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_basis jsonb; v_plan jsonb; v_action jsonb; v_dependencies jsonb; v_account_dependencies jsonb;
  v_book openerp.books; v_period openerp.periods; v_review_id text; v_change_id text; v_event_id text; v_event_key text;
  v_role_sha text; v_review_sha text; v_ordinal integer; v_count bigint; v_body jsonb;
BEGIN
  v_actor:=openerp.authorize(token,scope,true);
  SELECT b.* INTO STRICT v_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,key,v_actor,'prepare_vat_control_reclassification',input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  v_basis:=openerp.vat_control_reclassification_basis(scope,input,true);
  SELECT e.sha256 INTO v_role_sha FROM openerp.evidence e WHERE e.book_id=v_book.id AND e.id=input->>'roleEvidenceId';
  SELECT e.sha256 INTO v_review_sha FROM openerp.evidence e WHERE e.book_id=v_book.id AND e.id=input->>'reviewEvidenceId';
  SELECT count(*) INTO v_count FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=v_book.id;
  IF v_count>=500 THEN PERFORM openerp.fail('UnsupportedProfile','This book supports 500 retained VAT reclassification reviews; none were omitted.'); END IF;
  SELECT count(*)+1 INTO v_ordinal FROM openerp.vat_control_reclassification_reviews r
    WHERE r.book_id=v_book.id AND r.obligation_id=v_basis->'obligation'->>'id';
  IF v_ordinal>20 THEN PERFORM openerp.fail('UnsupportedProfile','A VAT reporting obligation supports 20 retained reclassification reviews.'); END IF;
  SELECT p.* INTO STRICT v_period FROM openerp.periods p WHERE p.book_id=v_book.id AND p.id=input->>'accountingPeriodId';
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','account','resourceId',a.id,'version',a.version::text,
      'reason','Exact VAT control account configuration') ORDER BY a.id COLLATE "C"),'[]')
    INTO v_account_dependencies FROM openerp.accounts a WHERE a.book_id=v_book.id
      AND a.id IN(input->>'outputAccountId',input->>'inputAccountId',input->>'settlementAccountId');
  v_dependencies:=jsonb_build_array(
    jsonb_build_object('kind','profile','resourceId',v_book.id,'version',v_book.profile_version::text,'reason','Book currency and supported native synthetic profile'),
    jsonb_build_object('kind','writer_epoch','resourceId',v_book.id,'version',v_book.writer_epoch::text,'reason','Single authoritative writer'))||
    jsonb_build_array(jsonb_build_object('kind','period','resourceId',v_period.id,'version',v_period.version::text,'reason','VAT reclassification posting period'))||
    v_account_dependencies;
  v_event_key:='vat_control_reclassification_'||v_basis->'obligation'->>'id';
  SELECT e.id INTO v_event_id FROM openerp.events e WHERE e.book_id=v_book.id AND e.evidence_id=input->>'roleEvidenceId' AND e.event_key=v_event_key;
  IF v_event_id IS NULL THEN
    v_event_id:=openerp.new_id('event');
    INSERT INTO openerp.events(book_id,id,evidence_id,event_key) VALUES(v_book.id,v_event_id,input->>'roleEvidenceId',v_event_key);
  END IF;
  v_review_id:=openerp.new_id('vatreview');
  IF jsonb_array_length(v_basis->'postingLines')>0 THEN
    v_change_id:=openerp.new_id('change');
    v_action:=jsonb_build_object('kind','post_voucher','correctsVoucherId',NULL,'eventId',v_event_id,
      'postingPurpose','vat_control_reclassification_v1','occurrenceKey',v_event_key,'fiscalYearId',v_period.fiscal_year_id,
      'accountingPeriodId',v_period.id,'postingDate',input->>'postingDate','series',input->>'series','currency',v_book.currency,
      'description','VAT control reclassification '||v_basis->'obligation'->>'id','rationale',input->>'rationale','taxAssessment','not_applicable',
      'vatReclassification',jsonb_build_object('reviewId',v_review_id,'obligationId',v_basis->'obligation'->>'id','draftId',input->>'draftId'),
      'lines',v_basis->'postingLines','evidenceRefs',jsonb_build_array(
        jsonb_build_object('evidenceId',input->>'roleEvidenceId','sha256',v_role_sha,'locator','vat-control-account-roles'),
        jsonb_build_object('evidenceId',input->>'reviewEvidenceId','sha256',v_review_sha,'locator','vat-control-reclassification-review')));
    v_plan:=jsonb_build_object('schemaVersion','1','canonicalization','openerp-c14n-v1','id',v_change_id,'version',1,'scope',scope,
      'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'dependencies',v_dependencies,
      'groups',jsonb_build_array(jsonb_build_object('id',openerp.new_id('group'),'dependsOnGroupIds','[]'::jsonb,'actions',jsonb_build_array(v_action))));
    v_plan:=v_plan||jsonb_build_object('planDigest',openerp.digest(v_plan));
  END IF;
  v_body:=jsonb_build_object('id',v_review_id,'scope',scope,'version',1,'ordinal',v_ordinal,'state','prepared','input',input,
    'basis',v_basis,'postingPlan',v_plan,'requiresOperatorApproval',true,'assessmentEffect','none','cashTransferEffect','none',
    'filingReady',false,'externalState','not_submitted',
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','prepare_vat_control_reclassification','actorId',v_actor));
  v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
  INSERT INTO openerp.vat_control_reclassification_reviews(book_id,id,obligation_id,profile_id,draft_id,actor_id,ordinal,change_set_id,body)
    SELECT v_book.id,v_review_id,v_basis->'obligation'->>'id',v_basis->'profile'->>'id',input->>'draftId',v_actor,v_ordinal,v_change_id,v_body;
  IF v_plan IS NOT NULL THEN INSERT INTO openerp.change_sets(book_id,id,plan,digest,created_by) VALUES(v_book.id,v_change_id,v_plan,v_plan->>'planDigest',v_actor); END IF;
  RETURN openerp.save_command(v_book.id,key,v_actor,'prepare_vat_control_reclassification',input,v_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.approve_vat_control_reclassification(token text,scope jsonb,id text,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_review openerp.vat_control_reclassification_reviews; v_current jsonb;
  v_kernel jsonb; v_kernel_id text; v_approval_id text; v_expires timestamptz; v_body jsonb; v_payload jsonb:=jsonb_build_object('id',id,'input',input);
BEGIN
  v_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'approve_vat_control_reclassification',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(input,ARRAY['expectedReviewDigest','acknowledgeSyntheticOnly']);
  IF jsonb_typeof(input->'expectedReviewDigest') IS DISTINCT FROM 'string' OR input->>'expectedReviewDigest' !~ '^sha256:[a-f0-9]{64}$'
    OR input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('ApprovalRequired','Approve the exact current review digest and acknowledge synthetic-only scope.');
  END IF;
  SELECT r.* INTO v_review FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=scope->>'bookId' AND r.id=approve_vat_control_reclassification.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The VAT control reclassification review was not found in this book.'); END IF;
  IF v_review.body->>'digest' IS DISTINCT FROM input->>'expectedReviewDigest' THEN
    PERFORM openerp.fail('StaleDependency','Approve the exact current immutable VAT reclassification review.');
  END IF;
  IF (SELECT count(*) FROM openerp.vat_control_reclassification_approvals a WHERE a.book_id=scope->>'bookId' AND a.review_id=v_review.id)>=20 THEN
    PERFORM openerp.fail('UnsupportedProfile','A VAT reclassification review supports 20 retained approvals; none were omitted.');
  END IF;
  v_current:=openerp.vat_control_reclassification_basis(scope,v_review.body->'input',false);
  IF v_current IS DISTINCT FROM v_review.body->'basis' THEN
    PERFORM openerp.fail('StaleDependency','The VAT reclassification basis changed. Prepare and review a new exact plan.');
  END IF;
  IF v_review.body->'postingPlan' IS DISTINCT FROM 'null'::jsonb THEN
    PERFORM openerp.check_dependencies(scope,v_review.body->'postingPlan');
    v_kernel:=openerp.approve_change(token,scope,v_review.change_set_id,openerp.new_id('vatapprove'),
      jsonb_build_object('planDigest',v_review.body->'postingPlan'->>'planDigest','version',1));
    v_kernel_id:=v_kernel->>'id';
  END IF;
  v_approval_id:=openerp.new_id('vatapproval'); v_expires:=clock_timestamp()+interval '1 hour';
  v_body:=jsonb_build_object('id',v_approval_id,'scope',scope,'version',1,'reviewId',v_review.id,'reviewDigest',v_review.body->>'digest',
    'actorId',v_actor,'expiresAt',to_char(v_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kernelApproval',v_kernel,
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','approve_vat_control_reclassification','actorId',v_actor));
  v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
  INSERT INTO openerp.vat_control_reclassification_approvals(book_id,id,review_id,actor_id,review_digest,kernel_approval_id,expires_at,body)
    VALUES(scope->>'bookId',v_approval_id,v_review.id,v_actor,v_review.body->>'digest',v_kernel_id,v_expires,v_body);
  RETURN openerp.save_command(scope->>'bookId',key,v_actor,'approve_vat_control_reclassification',v_payload,v_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.execute_vat_control_reclassification(token text,scope jsonb,id text,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_review openerp.vat_control_reclassification_reviews; v_approval openerp.vat_control_reclassification_approvals;
  v_current jsonb; v_posting jsonb; v_effect_id text; v_body jsonb; v_payload jsonb:=jsonb_build_object('id',id,'input',input);
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'execute_vat_control_reclassification',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(input,ARRAY['expectedReviewDigest','acknowledgeSyntheticOnly','approvalId']);
  IF jsonb_typeof(input->'expectedReviewDigest') IS DISTINCT FROM 'string' OR input->>'expectedReviewDigest' !~ '^sha256:[a-f0-9]{64}$'
    OR input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(input->'approvalId') IS DISTINCT FROM 'string' OR input->>'approvalId' !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('ApprovalRequired','Execute the exact current review with a current operator approval and synthetic-only acknowledgement.');
  END IF;
  SELECT r.* INTO v_review FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=scope->>'bookId' AND r.id=execute_vat_control_reclassification.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The VAT control reclassification review was not found in this book.'); END IF;
  IF v_review.body->>'digest' IS DISTINCT FROM input->>'expectedReviewDigest' THEN
    PERFORM openerp.fail('StaleDependency','Execute the exact current immutable VAT reclassification review.');
  END IF;
  IF EXISTS(SELECT FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=scope->>'bookId' AND e.obligation_id=v_review.obligation_id) THEN
    PERFORM openerp.fail('AlreadyPosted','This VAT reporting obligation already has its first reclassification effect. Recover the original request or inspect the retained effect.');
  END IF;
  SELECT a.* INTO v_approval FROM openerp.vat_control_reclassification_approvals a
    WHERE a.book_id=scope->>'bookId' AND a.id=input->>'approvalId' AND a.review_id=v_review.id;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The requested VAT reclassification approval was not found for this exact review.'); END IF;
  IF v_approval.review_digest IS DISTINCT FROM v_review.body->>'digest' OR v_approval.expires_at<=clock_timestamp() THEN
    PERFORM openerp.fail('ApprovalRequired','A current unused operator approval of this exact VAT reclassification is required.');
  END IF;
  PERFORM 1 FROM openerp.memberships m WHERE m.book_id=scope->>'bookId' AND m.actor_id=v_approval.actor_id AND m.role='operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approving actor is no longer an operator for this book.'); END IF;
  v_current:=openerp.vat_control_reclassification_basis(scope,v_review.body->'input',false);
  IF v_current IS DISTINCT FROM v_review.body->'basis' THEN
    PERFORM openerp.fail('StaleDependency','The approved VAT reclassification basis changed. Prepare and approve a new exact review.');
  END IF;
  IF (SELECT count(*) FROM openerp.vat_control_reclassification_contributions c WHERE c.book_id=scope->>'bookId')
      +jsonb_array_length(v_review.body->'basis'->'contributions')>5000 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book supports 5000 retained VAT contribution lineage rows; none were omitted.');
  END IF;
  v_effect_id:=openerp.new_id('vateffect'); v_posting:=NULL;
  IF v_review.body->'postingPlan' IS DISTINCT FROM 'null'::jsonb THEN
    IF v_approval.kernel_approval_id IS NULL THEN PERFORM openerp.fail('ApprovalRequired','A kernel approval of the exact posted VAT plan is required.'); END IF;
    PERFORM openerp.check_dependencies(scope,v_review.body->'postingPlan');
    v_posting:=openerp.execute_change(token,scope,v_review.change_set_id,openerp.new_id('vatexecute'),
      jsonb_build_object('planDigest',v_review.body->'postingPlan'->>'planDigest','version',1,'approvalId',v_approval.kernel_approval_id));
  END IF;
  v_body:=jsonb_build_object('id',v_effect_id,'scope',scope,'version',1,'obligationId',v_review.obligation_id,'draftId',v_review.draft_id,
    'reviewId',v_review.id,'reviewDigest',v_review.body->>'digest','approvalId',v_approval.id,
    'outcome',CASE WHEN v_posting IS NULL THEN 'no_effect' ELSE 'posted' END,'amounts',v_review.body->'basis'->'amounts',
    'changeSetId',CASE WHEN v_posting IS NULL THEN NULL ELSE v_review.change_set_id END,
    'voucherId',CASE WHEN v_posting IS NULL THEN NULL ELSE v_posting->>'voucherId' END,'postingReceipt',v_posting,
    'postingDate',v_review.body->'input'->>'postingDate','assessmentEffect','none','cashTransferEffect','none','filingReady',false,
    'externalState','not_submitted','createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','execute_vat_control_reclassification','actorId',v_actor));
  v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
  INSERT INTO openerp.vat_control_reclassification_effects(book_id,id,obligation_id,review_id,approval_id,draft_id,outcome,
    change_set_id,voucher_id,posting_receipt_id,posting_date,body)
    VALUES(scope->>'bookId',v_effect_id,v_review.obligation_id,v_review.id,v_approval.id,v_review.draft_id,v_body->>'outcome',
      v_body->>'changeSetId',v_body->>'voucherId',v_posting->>'id',(v_review.body->'input'->>'postingDate')::date,v_body);
  IF v_posting IS NOT NULL THEN
    INSERT INTO openerp.vat_control_reclassification_contributions(book_id,id,effect_id,ordinal,fact_id,fact_revision_id,voucher_id,line_id,body)
      SELECT scope->>'bookId',openerp.new_id('vatcontribution'),v_effect_id,(x.ordinality)::integer,
        x.value->>'factId',x.value->>'factRevisionId',x.value->>'voucherId',x.value->>'lineId',x.value
      FROM jsonb_array_elements(v_review.body->'basis'->'contributions') WITH ORDINALITY x(value,ordinality);
  END IF;
  RETURN openerp.save_command(scope->>'bookId',key,v_actor,'execute_vat_control_reclassification',v_payload,v_body);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_vat_control_reclassification(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_review jsonb; v_approvals jsonb; v_effect jsonb; v_checked text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT r.body INTO v_review FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=scope->>'bookId' AND r.id=get_vat_control_reclassification.id;
  IF v_review IS NULL THEN PERFORM openerp.fail('NotFound','The VAT control reclassification review was not found in this book.'); END IF;
  SELECT coalesce(jsonb_agg(a.body ORDER BY a.body->>'createdAt',a.id COLLATE "C"),'[]') INTO v_approvals
    FROM openerp.vat_control_reclassification_approvals a WHERE a.book_id=scope->>'bookId' AND a.review_id=get_vat_control_reclassification.id;
  SELECT e.body INTO v_effect FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=scope->>'bookId' AND e.review_id=get_vat_control_reclassification.id;
  v_checked:=NULL;
  IF v_effect IS NULL THEN
    BEGIN
      PERFORM openerp.vat_control_reclassification_basis(scope,v_review->'input',false);
      v_checked:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    EXCEPTION WHEN SQLSTATE 'P0001' THEN v_checked:=NULL;
    END;
  END IF;
  RETURN jsonb_build_object('review',v_review,'approvals',v_approvals,'reclassification',v_effect,'liveBasisCheckedAt',v_checked);
END $$;

CREATE OR REPLACE FUNCTION openerp.list_vat_control_reclassifications(token text,scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb; v_count bigint;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT count(*) INTO v_count FROM (SELECT 1 FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=scope->>'bookId' LIMIT 501) bounded;
  IF v_count>500 THEN PERFORM openerp.fail('UnsupportedProfile','VAT reclassification history exceeds 500 retained reviews; no item was omitted.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('reviewId',r.id,'reviewDigest',r.body->>'digest','obligationId',r.obligation_id,'draftId',r.draft_id,
      'startsOn',r.body->'basis'->'obligation'->>'startsOn','endsOn',r.body->'basis'->'obligation'->>'endsOn',
      'accountingNetMinor',r.body->'basis'->'amounts'->>'accountingNetMinor',
      'state',CASE WHEN e.id IS NOT NULL THEN e.outcome WHEN a.id IS NOT NULL THEN 'approved' ELSE 'prepared' END,
      'reclassificationId',e.id,'recordedAt',r.body->>'createdAt') ORDER BY r.body->>'createdAt' DESC,r.id COLLATE "C" DESC),'[]') INTO v_items
    FROM openerp.vat_control_reclassification_reviews r
    LEFT JOIN openerp.vat_control_reclassification_effects e ON e.book_id=r.book_id AND e.review_id=r.id
    LEFT JOIN LATERAL(SELECT a.id FROM openerp.vat_control_reclassification_approvals a
      WHERE a.book_id=r.book_id AND a.review_id=r.id ORDER BY a.body->>'createdAt' DESC,a.id COLLATE "C" DESC LIMIT 1) a ON true
    WHERE r.book_id=scope->>'bookId';
  RETURN jsonb_build_object('scope',scope,'items',v_items);
END $$;

CREATE OR REPLACE FUNCTION openerp.recover_vat_control_reclassification_request(token text,scope jsonb,key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb;
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF key IS NULL OR key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN PERFORM openerp.fail('IdempotencyConflict','Supply the original VAT reclassification request key.'); END IF;
  SELECT r.result INTO v_result FROM openerp.command_receipts r WHERE r.book_id=scope->>'bookId' AND r.key=recover_vat_control_reclassification_request.key
    AND r.actor_id=v_actor AND r.operation IN('prepare_vat_control_reclassification','approve_vat_control_reclassification','execute_vat_control_reclassification');
  IF v_result IS NULL THEN PERFORM openerp.fail('NotFound','No committed VAT reclassification request exists for this actor, book and key.'); END IF;
  RETURN jsonb_build_object('state','committed','result',v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.inspect_action(book text, action jsonb) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE b openerp.books; p openerp.periods; y openerp.fiscal_years; account openerp.accounts;
  line jsonb; original jsonb; original_line jsonb; debit numeric := 0; credit numeric := 0;
  posting_date date; reference jsonb; i integer := 0; ids text[] := '{}'; review jsonb;
BEGIN
  SELECT * INTO STRICT b FROM openerp.books WHERE id = book;
  IF b.authority <> 'native' THEN PERFORM openerp.fail('StaleDependency', 'This book is not assigned to the native writer.'); END IF;
  IF b.profile <> 'synthetic-core-v1' THEN
    PERFORM openerp.fail('UnsupportedProfile', 'Only the explicit synthetic manual journal profile is currently implemented.');
  END IF;
  IF action->>'kind' <> 'post_voucher' OR action->>'taxAssessment' IS DISTINCT FROM 'not_applicable'
    OR action->>'currency' IS DISTINCT FROM b.currency
    OR coalesce(length(action->>'description'), 0) NOT BETWEEN 1 AND 2000
    OR coalesce(length(action->>'rationale'), 0) NOT BETWEEN 1 AND 2000
    OR coalesce(action->>'series', '') !~ '^[A-Z0-9]{1,16}$'
    OR jsonb_typeof(action->'lines') IS DISTINCT FROM 'array'
    OR jsonb_typeof(action->'evidenceRefs') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting intent is incomplete or unsupported.');
  END IF;
  IF jsonb_array_length(action->'lines') NOT BETWEEN 2 AND 500 OR jsonb_array_length(action->'evidenceRefs') < 1 THEN
    PERFORM openerp.fail('InvalidJournal', 'Provide evidence and between 2 and 500 journal lines.');
  END IF;
  BEGIN
    posting_date := (action->>'postingDate')::date;
    IF to_char(posting_date, 'YYYY-MM-DD') IS DISTINCT FROM action->>'postingDate' THEN RAISE invalid_datetime_format; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting date is not a valid calendar date.');
  END;
  SELECT * INTO p FROM openerp.periods WHERE book_id = book AND id = action->>'accountingPeriodId';
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal', 'The accounting period does not belong to this book.'); END IF;
  SELECT * INTO STRICT y FROM openerp.fiscal_years WHERE book_id = book AND id = p.fiscal_year_id;
  IF action->>'fiscalYearId' IS DISTINCT FROM p.fiscal_year_id OR posting_date IS NULL
    OR posting_date NOT BETWEEN p.starts_on AND p.ends_on OR posting_date NOT BETWEEN y.starts_on AND y.ends_on
    OR p.starts_on < y.starts_on OR p.ends_on > y.ends_on THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting date, accounting period and fiscal year must agree.');
  END IF;
  IF p.locked THEN PERFORM openerp.fail('PeriodLocked', 'The period is locked. Use an open correction period or the authorized reopen workflow.'); END IF;
  IF action->>'postingPurpose' = 'reversal' THEN
    SELECT v.action INTO original FROM openerp.vouchers v WHERE v.book_id = book AND v.id = action->>'correctsVoucherId';
    IF original IS NULL OR original->>'postingPurpose' = 'reversal' THEN
      PERFORM openerp.fail('InvalidJournal', 'Choose an original voucher to reverse.');
    END IF;
    IF jsonb_array_length(action->'lines') <> jsonb_array_length(original->'lines')
      OR action->>'eventId' IS DISTINCT FROM original->>'eventId'
      OR action->'evidenceRefs' IS DISTINCT FROM original->'evidenceRefs'
      OR action->>'occurrenceKey' IS DISTINCT FROM action->>'correctsVoucherId' THEN
      PERFORM openerp.fail('InvalidJournal', 'A reversal must preserve the original evidence, event and complete line set.');
    END IF;
  ELSIF action->>'postingPurpose' = 'vat_control_reclassification_v1' THEN
    IF action->'correctsVoucherId'<>'null'::jsonb
      OR action->>'occurrenceKey' IS DISTINCT FROM 'vat_control_reclassification_'||action->'vatReclassification'->>'obligationId'
      OR action->'vatReclassification'-ARRAY['reviewId','obligationId','draftId']<>'{}'::jsonb
      OR action->'vatReclassification'->>'reviewId' IS NULL OR action->'vatReclassification'->>'draftId' IS NULL THEN
      PERFORM openerp.fail('InvalidJournal','A VAT control reclassification requires exact review, obligation and draft metadata.');
    END IF;
    SELECT r.body INTO review FROM openerp.vat_control_reclassification_reviews r
      WHERE r.book_id=book AND r.id=action->'vatReclassification'->>'reviewId';
    IF review IS NULL OR review->'basis'->'obligation'->>'id' IS DISTINCT FROM action->'vatReclassification'->>'obligationId'
      OR review->'input'->>'draftId' IS DISTINCT FROM action->'vatReclassification'->>'draftId' THEN
      PERFORM openerp.fail('InvalidJournal','Generic execution cannot bypass the retained VAT reclassification aggregate.');
    END IF;
  ELSIF action->>'postingPurpose' IS DISTINCT FROM 'adjustment' OR action->>'correctsVoucherId' IS NOT NULL
    OR action->>'occurrenceKey' IS DISTINCT FROM 'manual_journal' THEN
    PERFORM openerp.fail('InvalidJournal', 'Unsupported posting purpose.');
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(action->'lines') LOOP
    IF coalesce(line->>'debitMinor', '') !~ '^(0|[1-9][0-9]{0,37})$'
      OR coalesce(line->>'creditMinor', '') !~ '^(0|[1-9][0-9]{0,37})$'
      OR coalesce(line->>'lineId', '') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR coalesce(length(line->>'description'), 0) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal', 'Each line needs exact nonnegative integer minor units and a description.');
    END IF;
    IF line->>'lineId' = ANY(ids) THEN PERFORM openerp.fail('InvalidJournal', 'Line identifiers must be unique.'); END IF;
    ids := array_append(ids, line->>'lineId');
    IF NOT (((line->>'debitMinor')::numeric > 0 AND (line->>'creditMinor')::numeric = 0)
      OR ((line->>'creditMinor')::numeric > 0 AND (line->>'debitMinor')::numeric = 0)) THEN
      PERFORM openerp.fail('InvalidJournal', 'Exactly one side of each line must be positive.');
    END IF;
    SELECT * INTO account FROM openerp.accounts WHERE book_id = book AND id = line->>'accountId';
    IF NOT FOUND OR (NOT account.active AND original IS NULL) THEN
      PERFORM openerp.fail('InvalidJournal', 'An account is unavailable or does not belong to this book.');
    END IF;
    IF original IS NOT NULL THEN
      original_line := original->'lines'->i;
      IF (line->>'accountId', line->>'debitMinor', line->>'creditMinor') IS DISTINCT FROM
        (original_line->>'accountId', original_line->>'creditMinor', original_line->>'debitMinor') THEN
        PERFORM openerp.fail('InvalidJournal', 'A reversal must use the original accounts and exactly opposite amounts.');
      END IF;
    END IF;
    debit := debit + (line->>'debitMinor')::numeric;
    credit := credit + (line->>'creditMinor')::numeric;
    i := i + 1;
  END LOOP;
  IF debit <> credit OR debit <= 0 THEN PERFORM openerp.fail('InvalidJournal', 'Debits and credits must balance exactly and be nonzero.'); END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(action->'evidenceRefs') LOOP
    IF NOT EXISTS(SELECT FROM openerp.evidence WHERE book_id = book AND id = reference->>'evidenceId' AND sha256 = reference->>'sha256') THEN
      PERFORM openerp.fail('MissingEvidence', 'An evidence reference is missing or its content hash differs.');
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT FROM openerp.events WHERE book_id = book AND id = action->>'eventId') THEN
    PERFORM openerp.fail('InvalidJournal', 'The business event does not belong to this book.');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION openerp.check_dependencies(scope jsonb, plan jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE dependency jsonb; current_version text; action jsonb; review jsonb; current_basis jsonb;
BEGIN
  IF plan->>'planDigest' IS DISTINCT FROM openerp.digest(plan - 'planDigest') THEN
    PERFORM openerp.fail('StaleDependency', 'The sealed plan digest is invalid.');
  END IF;
  FOR dependency IN SELECT value FROM jsonb_array_elements(plan->'dependencies') LOOP
    current_version := NULL;
    CASE dependency->>'kind'
      WHEN 'profile' THEN SELECT profile_version::text INTO current_version FROM openerp.books WHERE id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'writer_epoch' THEN SELECT writer_epoch::text INTO current_version FROM openerp.books WHERE id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'period' THEN SELECT version::text INTO current_version FROM openerp.periods WHERE book_id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'account' THEN SELECT version::text INTO current_version FROM openerp.accounts WHERE book_id = scope->>'bookId' AND id = dependency->>'resourceId';
      ELSE PERFORM openerp.fail('StaleDependency', 'An unsupported dependency is present.');
    END CASE;
    IF current_version IS DISTINCT FROM dependency->>'version' THEN
      PERFORM openerp.fail('StaleDependency', 'The ' || (dependency->>'kind') || ' dependency ' || (dependency->>'resourceId') || ' changed. Prepare and approve a new plan.');
    END IF;
  END LOOP;
  action:=plan->'groups'->0->'actions'->0;
  PERFORM openerp.inspect_action(scope->>'bookId',action);
  PERFORM openerp.subledger_check_posting_basis(scope->>'bookId',plan->>'id',action);
  IF action->>'postingPurpose'='vat_control_reclassification_v1' THEN
    SELECT r.body INTO review FROM openerp.vat_control_reclassification_reviews r
      WHERE r.book_id=scope->>'bookId' AND r.change_set_id=plan->>'id';
    IF review IS NULL OR review->>'digest' IS DISTINCT FROM openerp.digest(review-'digest')
      OR review->'postingPlan' IS DISTINCT FROM plan
      OR action->'vatReclassification'->>'reviewId' IS DISTINCT FROM review->>'id'
      OR action->'vatReclassification'->>'obligationId' IS DISTINCT FROM review->'basis'->'obligation'->>'id'
      OR action->'vatReclassification'->>'draftId' IS DISTINCT FROM review->'input'->>'draftId' THEN
      PERFORM openerp.fail('StaleDependency','The VAT plan must exactly match its retained immutable review and action.');
    END IF;
    current_basis:=openerp.vat_control_reclassification_basis(scope,review->'input',false);
    IF current_basis IS DISTINCT FROM review->'basis' OR EXISTS(SELECT FROM openerp.vat_control_reclassification_effects e
      WHERE e.book_id=scope->>'bookId' AND e.obligation_id=review->'obligation_id') THEN
      PERFORM openerp.fail('StaleDependency','The VAT reclassification basis changed or its obligation already has an effect.');
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION openerp.vat_control_reclassification_kernel_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_action jsonb; v_plan jsonb; v_review jsonb;
BEGIN
  IF TG_TABLE_NAME='change_sets' THEN
    FOR v_action IN SELECT a.value FROM jsonb_array_elements(NEW.plan->'groups') g(value)
      CROSS JOIN LATERAL jsonb_array_elements(g.value->'actions') a(value) LOOP
      IF v_action->>'postingPurpose'='vat_control_reclassification_v1' THEN
        SELECT r.body INTO v_review FROM openerp.vat_control_reclassification_reviews r
          WHERE r.book_id=NEW.book_id AND r.change_set_id=NEW.id;
        IF v_review IS NULL OR v_review->'postingPlan' IS DISTINCT FROM NEW.plan THEN
          PERFORM openerp.fail('InvalidJournal','A VAT control reclassification plan must be created by its retained aggregate review.');
        END IF;
      END IF;
    END LOOP;
  ELSE
    v_action:=NEW.action;
    IF v_action->>'postingPurpose'='vat_control_reclassification_v1' THEN
      PERFORM openerp.inspect_action(NEW.book_id,v_action);
      SELECT c.plan INTO v_plan FROM openerp.change_sets c WHERE c.book_id=NEW.book_id AND c.id=NEW.change_set_id;
      SELECT r.body INTO v_review FROM openerp.vat_control_reclassification_reviews r
        WHERE r.book_id=NEW.book_id AND r.change_set_id=NEW.change_set_id;
      IF v_plan IS NULL OR v_review IS NULL OR v_review->'postingPlan' IS DISTINCT FROM v_plan
        OR v_plan->'groups'->0->'actions'->0 IS DISTINCT FROM v_action THEN
        PERFORM openerp.fail('InvalidJournal','Generic voucher execution cannot bypass the VAT reclassification aggregate.');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER vat_control_reclassification_change_set_owner AFTER INSERT ON openerp.change_sets
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reclassification_kernel_guard();
CREATE TRIGGER vat_control_reclassification_voucher_owner BEFORE INSERT ON openerp.vouchers
FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reclassification_kernel_guard();

CREATE OR REPLACE FUNCTION openerp.vat_control_assert_reclassification_effect(p_book text,p_effect text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
  DECLARE v_effect openerp.vat_control_reclassification_effects; v_review jsonb; v_approval jsonb; v_plan jsonb; v_action jsonb;
  v_voucher jsonb; v_receipt jsonb; v_kernel_approval_id text; v_expected jsonb; v_row openerp.vat_control_reclassification_contributions; v_count integer;
BEGIN
  SELECT e.* INTO STRICT v_effect FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=p_book AND e.id=p_effect;
  SELECT r.body INTO STRICT v_review FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=p_book AND r.id=v_effect.review_id;
  SELECT a.body INTO STRICT v_approval FROM openerp.vat_control_reclassification_approvals a WHERE a.book_id=p_book AND a.id=v_effect.approval_id;
  IF v_effect.body->>'digest' IS DISTINCT FROM openerp.digest(v_effect.body-'digest')
    OR v_effect.body->>'obligationId' IS DISTINCT FROM v_effect.obligation_id
    OR v_effect.body->>'reviewId' IS DISTINCT FROM v_effect.review_id
    OR v_effect.body->>'approvalId' IS DISTINCT FROM v_effect.approval_id
    OR v_effect.body->>'draftId' IS DISTINCT FROM v_effect.draft_id
    OR v_effect.body->>'outcome' IS DISTINCT FROM v_effect.outcome
    OR v_effect.body->>'changeSetId' IS DISTINCT FROM v_effect.change_set_id
    OR v_effect.body->>'voucherId' IS DISTINCT FROM v_effect.voucher_id
    OR v_effect.body->'postingReceipt'->>'id' IS DISTINCT FROM v_effect.posting_receipt_id
    OR v_effect.body->>'reviewDigest' IS DISTINCT FROM v_review->>'digest'
    OR v_effect.body->'amounts' IS DISTINCT FROM v_review->'basis'->'amounts'
    OR v_effect.body->>'postingDate' IS DISTINCT FROM v_effect.posting_date::text
    OR v_approval->>'reviewDigest' IS DISTINCT FROM v_review->>'digest' THEN
    PERFORM openerp.fail('InvalidJournal','The VAT reclassification effect does not match its immutable review and approval.');
  END IF;
  IF v_effect.outcome='no_effect' THEN
    IF v_review->'postingPlan'<>'null'::jsonb OR (SELECT count(*) FROM openerp.vat_control_reclassification_contributions c
      WHERE c.book_id=p_book AND c.effect_id=v_effect.id)<>0 THEN
      PERFORM openerp.fail('InvalidJournal','A no-effect VAT reclassification cannot own a voucher or contribution lineage.');
    END IF;
    RETURN;
  END IF;
  v_plan:=v_review->'postingPlan'; v_action:=v_plan->'groups'->0->'actions'->0;
  SELECT v.action INTO v_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=v_effect.voucher_id;
  SELECT e.approval_id,e.body INTO STRICT v_kernel_approval_id,v_receipt FROM openerp.execution_receipts e WHERE e.book_id=p_book AND e.id=v_effect.posting_receipt_id;
  IF v_voucher IS NULL OR v_voucher IS DISTINCT FROM v_action OR v_receipt IS NULL
    OR v_receipt->>'voucherId' IS DISTINCT FROM v_effect.voucher_id OR v_receipt->>'changeSetId' IS DISTINCT FROM v_effect.change_set_id
    OR v_receipt->>'planDigest' IS DISTINCT FROM v_plan->>'planDigest' OR v_approval->'kernelApproval' IS NULL
    OR v_approval->'kernelApproval'->>'id' IS DISTINCT FROM v_kernel_approval_id THEN
    PERFORM openerp.fail('InvalidJournal','A posted VAT reclassification requires its exact voucher and kernel execution receipt.');
  END IF;
  SELECT count(*) INTO v_count FROM openerp.vat_control_reclassification_contributions c WHERE c.book_id=p_book AND c.effect_id=v_effect.id;
  IF v_count<>jsonb_array_length(v_review->'basis'->'contributions') THEN
    PERFORM openerp.fail('InvalidJournal','A posted VAT reclassification must retain every exact contribution line once.');
  END IF;
  FOR v_row IN SELECT c.* FROM openerp.vat_control_reclassification_contributions c
    WHERE c.book_id=p_book AND c.effect_id=v_effect.id ORDER BY c.ordinal LOOP
    v_expected:=v_review->'basis'->'contributions'->(v_row.ordinal-1);
    IF v_row.body IS DISTINCT FROM v_expected THEN
      PERFORM openerp.fail('InvalidJournal','A VAT contribution lineage row differs from its retained review basis.');
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION openerp.vat_control_reclassification_effect_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_effect text:=CASE WHEN TG_TABLE_NAME='vouchers' THEN
  (SELECT e.id::text FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=NEW.book_id AND e.voucher_id=NEW.id)
  ELSE CASE WHEN TG_TABLE_NAME='vat_control_reclassification_contributions' THEN NEW.effect_id ELSE NEW.id END END;
BEGIN
  IF v_effect IS NULL THEN
    PERFORM openerp.fail('InvalidJournal','A VAT reclassification voucher must commit with its domain effect in the same transaction.');
  END IF;
  PERFORM openerp.vat_control_assert_reclassification_effect(NEW.book_id,v_effect);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER vat_control_reclassification_voucher_complete AFTER INSERT ON openerp.vouchers
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.posting_purpose='vat_control_reclassification_v1')
EXECUTE FUNCTION openerp.vat_control_reclassification_effect_guard();
CREATE CONSTRAINT TRIGGER vat_control_reclassification_effect_complete AFTER INSERT ON openerp.vat_control_reclassification_effects
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reclassification_effect_guard();
CREATE CONSTRAINT TRIGGER vat_control_reclassification_contribution_complete AFTER INSERT ON openerp.vat_control_reclassification_contributions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reclassification_effect_guard();

CREATE OR REPLACE FUNCTION openerp.vat_control_refuse_taxable_source_voucher() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_voucher text;
BEGIN
  IF TG_TABLE_NAME='vat_fact_revisions' THEN v_voucher:=NEW.voucher_id;
  ELSE v_voucher:=coalesce(NEW.voucher_id,NEW.body->'facts'->>'voucherId'); END IF;
  IF v_voucher IS NOT NULL AND EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=NEW.book_id AND v.id=v_voucher
    AND v.posting_purpose='vat_control_reclassification_v1') THEN
    PERFORM openerp.fail('StaleDependency','A committed VAT control reclassification voucher cannot become a taxable VAT or expense-tax source.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vat_control_refuse_vat_fact_source BEFORE INSERT ON openerp.vat_fact_revisions
FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_refuse_taxable_source_voucher();
CREATE TRIGGER vat_control_refuse_expense_tax_source BEFORE INSERT ON openerp.expense_tax_source_revisions
FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_refuse_taxable_source_voucher();

CREATE OR REPLACE FUNCTION openerp.vat_control_reserved_account_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_accounts text[];
BEGIN
  IF TG_TABLE_NAME='subledger_schedule_revisions' THEN
    v_accounts:=ARRAY[NEW.body->'terms'->>'debitAccountId',NEW.body->'terms'->>'creditAccountId'];
  ELSE
    v_accounts:=ARRAY[NEW.account_id];
  END IF;
  IF EXISTS(SELECT FROM unnest(v_accounts) account_id
      WHERE account_id IS NOT NULL AND EXISTS(SELECT FROM openerp.vat_control_account_roles r
        WHERE r.book_id=NEW.book_id AND r.account_id=account_id)) THEN
    PERFORM openerp.fail('InvalidJournal','A retained VAT control account cannot acquire an incompatible bank, commerce, owner, tax-account or subledger control role.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vat_control_reserved_bank_account BEFORE INSERT ON openerp.bank_sources FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER vat_control_reserved_commerce_account BEFORE INSERT ON openerp.commerce_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER vat_control_reserved_owner_account BEFORE INSERT ON openerp.owner_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER vat_control_reserved_tax_account BEFORE INSERT ON openerp.tax_account_sources FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER vat_control_reserved_subledger_account BEFORE INSERT ON openerp.subledger_schedule_revisions FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();

CREATE OR REPLACE FUNCTION openerp.vat_control_refuse_generic_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL AND EXISTS(
    SELECT FROM openerp.vat_control_reclassification_effects e
    WHERE e.book_id=NEW.book_id AND e.voucher_id=NEW.corrects_voucher_id
    UNION ALL
    SELECT FROM openerp.vat_control_reclassification_contributions c
    WHERE c.book_id=NEW.book_id AND c.voucher_id=NEW.corrects_voucher_id
  ) THEN
    PERFORM openerp.fail('UnsupportedProfile','Generic correction cannot reverse a VAT reclassification or its evidenced source lines. The VAT owner has no correction workflow in this version.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vat_control_refuse_generic_correction BEFORE INSERT ON openerp.vouchers
FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_refuse_generic_correction();

REVOKE ALL ON FUNCTION openerp.vat_control_validate_reclassification_input(jsonb),
  openerp.vat_control_profile_resolve(jsonb,jsonb,boolean),openerp.vat_control_obligation_resolve(jsonb,openerp.vat_return_drafts,boolean),
  openerp.vat_control_reclassification_basis(jsonb,jsonb,boolean),openerp.vat_control_reclassification_kernel_guard(),
  openerp.vat_control_assert_reclassification_effect(text,text),openerp.vat_control_reclassification_effect_guard(),
  openerp.vat_control_refuse_taxable_source_voucher(),openerp.vat_control_reserved_account_guard(),
  openerp.vat_control_refuse_generic_correction() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.prepare_vat_control_reclassification(text,jsonb,text,jsonb),
  openerp.approve_vat_control_reclassification(text,jsonb,text,text,jsonb),
  openerp.execute_vat_control_reclassification(text,jsonb,text,text,jsonb),
  openerp.get_vat_control_reclassification(text,jsonb,text),openerp.list_vat_control_reclassifications(text,jsonb),
  openerp.recover_vat_control_reclassification_request(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_vat_control_reclassification(text,jsonb,text,jsonb),
  openerp.approve_vat_control_reclassification(text,jsonb,text,text,jsonb),
  openerp.execute_vat_control_reclassification(text,jsonb,text,text,jsonb),
  openerp.get_vat_control_reclassification(text,jsonb,text),openerp.list_vat_control_reclassifications(text,jsonb),
  openerp.recover_vat_control_reclassification_request(text,jsonb,text) TO openerp_runtime;
