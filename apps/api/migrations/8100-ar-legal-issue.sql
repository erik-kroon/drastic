-- Domestic B2B SEK 25% accrual AR only. This does not change synthetic issue semantics.
-- Mervärdesskattelag (2023:200) 9 kap. 2 § and 17 kap. 22–24 §§; pinned rule evidence is in ar_legal_policies.
-- Separate activation of the accounting method and three account roles. A seller/VAT policy alone remains blocked.
CREATE TABLE openerp.ar_legal_accounting_profiles (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, policy_id text NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors, body jsonb NOT NULL CHECK(octet_length(body::text)<=131072),
 PRIMARY KEY(book_id,id), UNIQUE(book_id,policy_id),
 FOREIGN KEY(book_id,policy_id) REFERENCES openerp.ar_legal_policies,
 CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_ar_legal_accounting_profile BEFORE UPDATE OR DELETE ON openerp.ar_legal_accounting_profiles
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.ar_legal_accounting_profiles FROM PUBLIC,openerp_runtime;
CREATE FUNCTION openerp.activate_ar_legal_accounting_profile(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_policy openerp.ar_legal_policies; v_book openerp.books; v_body jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(v_book.id,p_key,v_actor,'activate_ar_legal_accounting_profile',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['policyId','policyDigest','profile','accountingMethod',
  'ruleVersion','effectiveFrom','controlAccountId','revenueAccountId','outputVatAccountId',
  'accountRoleEvidence','reason','acceptLegalAccounting']);
 SELECT * INTO v_policy FROM openerp.ar_legal_policies WHERE book_id=v_book.id AND id=p_input->>'policyId';
 IF NOT FOUND OR v_policy.body->>'digest' IS DISTINCT FROM p_input->>'policyDigest'
  OR v_policy.body->>'status' IS DISTINCT FROM 'active'
  OR v_actor=v_policy.activated_by
  OR v_book.currency<>'SEK' OR v_book.currency_scale<>2 OR v_book.authority<>'native'
  OR v_book.profile<>'synthetic-core-v1'
  OR p_input->>'profile' IS DISTINCT FROM 'se-domestic-b2b-sek-25-accrual-v1'
  OR p_input->>'accountingMethod' IS DISTINCT FROM 'accrual'
  OR p_input->>'ruleVersion' IS DISTINCT FROM 'se-domestic-standard-25-2023-200-v1'
  OR p_input->>'effectiveFrom' IS DISTINCT FROM v_policy.body->'candidate'->'input'->>'effectiveFrom'
  OR p_input->'acceptLegalAccounting' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('UnsupportedProfile','A separate operator must activate exact domestic SEK accrual account roles for the active reviewed legal sales policy.'); END IF;
 IF p_input->>'controlAccountId'=p_input->>'revenueAccountId'
  OR p_input->>'controlAccountId'=p_input->>'outputVatAccountId'
  OR p_input->>'revenueAccountId'=p_input->>'outputVatAccountId'
  OR (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=v_book.id AND a.active AND a.id IN
   (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'outputVatAccountId'))<>3
  OR EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=v_book.id AND s.account_id IN
   (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'outputVatAccountId'))
  OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=v_book.id AND
   ((c.account_id=p_input->>'controlAccountId' AND c.direction<>'customer')
     OR c.account_id IN (p_input->>'revenueAccountId',p_input->>'outputVatAccountId'))) THEN
  PERFORM openerp.fail('InvalidJournal','Choose three active separately evidenced, non-bank AR control, sales and output VAT accounts.'); END IF;
 PERFORM openerp.invoice_policy_require_evidence(v_book.id,p_input->'accountRoleEvidence');
 PERFORM openerp.commerce_text(p_input,'reason',2000);
 IF EXISTS(SELECT FROM openerp.ar_legal_accounting_profiles WHERE book_id=v_book.id AND policy_id=v_policy.id) THEN
  PERFORM openerp.fail('IdempotencyConflict','This legal policy already has an immutable accounting activation.'); END IF;
 v_body:=jsonb_build_object('id',openerp.new_id('ar_accounting_profile'),'scope',p_scope,'policyId',v_policy.id,
  'policyDigest',v_policy.body->>'digest','input',p_input,'status','active','activatedBy',v_actor,
  'activatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 INSERT INTO openerp.ar_legal_accounting_profiles VALUES(v_book.id,v_body->>'id',v_policy.id,v_actor,v_body);
 RETURN openerp.save_command(v_book.id,p_key,v_actor,'activate_ar_legal_accounting_profile',p_input,v_body);
END $$;
CREATE FUNCTION openerp.get_ar_legal_accounting_profile(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_body jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT body INTO v_body FROM openerp.ar_legal_accounting_profiles WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal accounting profile does not exist in this book.'); END IF;
 RETURN v_body;
END $$;

CREATE TABLE openerp.ar_legal_issue_reviews (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, draft_id text NOT NULL,
  policy_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
  actor_id text NOT NULL REFERENCES openerp.actors, body jsonb NOT NULL CHECK(octet_length(body::text)<=262144),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,draft_id,ordinal),
  FOREIGN KEY(book_id,draft_id) REFERENCES openerp.invoice_drafts,
  FOREIGN KEY(book_id,policy_id) REFERENCES openerp.ar_legal_policies,
  CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.ar_legal_issue_approvals (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50), actor_id text NOT NULL REFERENCES openerp.actors,
  digest text NOT NULL, expires_at timestamptz NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,review_id,ordinal),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.ar_legal_issue_reviews
);
CREATE TABLE openerp.ar_legal_issue_counters (
  book_id text NOT NULL, policy_id text NOT NULL, last_number bigint NOT NULL CHECK(last_number BETWEEN 1 AND 999999999999999999),
  PRIMARY KEY(book_id,policy_id), FOREIGN KEY(book_id,policy_id) REFERENCES openerp.ar_legal_policies
);
CREATE TABLE openerp.ar_legal_issues (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL, approval_id text NOT NULL,
  draft_id text NOT NULL, policy_id text NOT NULL, legal_number text COLLATE "C" NOT NULL,
  posting_receipt_id text NOT NULL, register_invoice_id text NOT NULL,
  body jsonb NOT NULL CHECK(octet_length(body::text)<=262144),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,review_id), UNIQUE(book_id,approval_id),
  UNIQUE(book_id,draft_id), UNIQUE(book_id,legal_number), UNIQUE(book_id,posting_receipt_id),
  UNIQUE(book_id,register_invoice_id),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.ar_legal_issue_reviews,
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.ar_legal_issue_approvals,
  FOREIGN KEY(book_id,policy_id) REFERENCES openerp.ar_legal_policies,
  FOREIGN KEY(book_id,posting_receipt_id) REFERENCES openerp.execution_receipts,
  FOREIGN KEY(book_id,register_invoice_id) REFERENCES openerp.commerce_invoices,
  CHECK(body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'legalDocumentNumber'=legal_number
    AND body->>'digest'=openerp.digest(body-'digest'))
);
ALTER TABLE openerp.ar_legal_pdf_captures ADD CONSTRAINT ar_legal_pdf_issue_fk
  FOREIGN KEY(book_id,issue_id) REFERENCES openerp.ar_legal_issues(book_id,id);
CREATE TRIGGER immutable_ar_legal_review BEFORE UPDATE OR DELETE ON openerp.ar_legal_issue_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_approval BEFORE UPDATE OR DELETE ON openerp.ar_legal_issue_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_issue BEFORE UPDATE OR DELETE ON openerp.ar_legal_issues FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.ar_legal_issue_reviews,openerp.ar_legal_issue_approvals,openerp.ar_legal_issue_counters,openerp.ar_legal_issues FROM PUBLIC,openerp_runtime;

-- Existing synthetic draft freeze only checks SYN receipts; legal receipts have their own immutable fence.
CREATE FUNCTION openerp.ar_legal_freeze_draft() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.ar_legal_issues WHERE book_id=OLD.book_id AND draft_id=OLD.id) THEN
    PERFORM openerp.fail('Forbidden','A legally issued draft cannot be revised. Use a separately reviewed credit/correction workflow.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_legal_freeze_draft BEFORE UPDATE ON openerp.invoice_drafts FOR EACH ROW EXECUTE FUNCTION openerp.ar_legal_freeze_draft();

-- Block independent posting or correction against the owned immutable source, including a changed event key.
CREATE FUNCTION openerp.ar_legal_guard_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.ar_legal_issue_reviews r WHERE r.book_id=NEW.book_id
    AND (r.body->'sourceEvidence'->>'evidenceId'=(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
      OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=r.body->'sourceEvidence'->>'evidenceId')))
    AND NOT EXISTS(SELECT FROM openerp.ar_legal_issues i
      JOIN openerp.execution_receipts x ON x.book_id=i.book_id AND x.id=i.posting_receipt_id
      WHERE i.book_id=NEW.book_id AND x.voucher_id=NEW.id AND x.change_set_id=NEW.change_set_id) THEN
    PERFORM openerp.fail('ApprovalRequired','Legal invoice source belongs to its atomic approved issue. Independent posting and generic correction are blocked.');
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ar_legal_owned_source AFTER INSERT ON openerp.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.ar_legal_guard_source();

CREATE FUNCTION openerp.ar_legal_issue_calculate(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_draft jsonb; v_policy openerp.ar_legal_policies; v_accounting openerp.ar_legal_accounting_profiles; v_book openerp.books;
 v_customer jsonb; v_seller jsonb; v_counterpart jsonb; v_line jsonb; v_computed jsonb:='[]'::jsonb;
 v_base numeric; v_net numeric; v_tax numeric; v_gross numeric; v_net_total numeric:=0;
 v_tax_total numeric:=0; v_gross_total numeric:=0; v_date date; v_period openerp.periods;
BEGIN
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','draftId','expectedRevision','expectedDigest','policyId',
  'policyDigest','accountingProfileId','accountingProfileDigest','controlAccountId','revenueAccountId','outputVatAccountId','accountingPeriodId','voucherSeries',
  'reason','acknowledgeLimitedProfile']);
 IF p_input->>'profile' IS DISTINCT FROM 'se-domestic-b2b-sek-25-accrual-v1'
   OR p_input->'acknowledgeLimitedProfile' IS DISTINCT FROM 'true'::jsonb THEN
   PERFORM openerp.fail('UnsupportedProfile','Select the explicit domestic B2B SEK 25% accrual-only legal profile.'); END IF;
 SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_book;
 IF v_book.authority<>'native' OR v_book.currency<>'SEK' OR v_book.currency_scale<>2
    OR v_book.profile<>'synthetic-core-v1' THEN
  PERFORM openerp.fail('UnsupportedProfile','This bounded legal AR kernel requires a native SEK two-decimal book; unrelated book profiles remain unsupported.'); END IF;
 SELECT * INTO v_policy FROM openerp.ar_legal_policies WHERE book_id=p_book AND id=p_input->>'policyId';
 IF NOT FOUND OR v_policy.body->>'digest' IS DISTINCT FROM p_input->>'policyDigest'
   OR v_policy.body->'input'->>'ruleVersion' IS DISTINCT FROM 'se-domestic-standard-25-2023-200-v1'
   OR v_policy.body->'candidate'->'input'->>'vatTreatment' IS DISTINCT FROM 'se-domestic-standard-25-v1'
   OR v_policy.body->'candidate'->'input'->>'roundingMethod' IS DISTINCT FROM 'line-tax-half-up-minor-v1' THEN
  PERFORM openerp.fail('UnsupportedProfile','Select the exact active reviewed domestic 25% policy.'); END IF;
 SELECT * INTO v_accounting FROM openerp.ar_legal_accounting_profiles
  WHERE book_id=p_book AND id=p_input->>'accountingProfileId' AND policy_id=v_policy.id;
 IF NOT FOUND OR v_accounting.body->>'digest' IS DISTINCT FROM p_input->>'accountingProfileDigest'
  OR v_accounting.body->>'status' IS DISTINCT FROM 'active'
  OR v_accounting.body->'input'->>'controlAccountId' IS DISTINCT FROM p_input->>'controlAccountId'
  OR v_accounting.body->'input'->>'revenueAccountId' IS DISTINCT FROM p_input->>'revenueAccountId'
  OR v_accounting.body->'input'->>'outputVatAccountId' IS DISTINCT FROM p_input->>'outputVatAccountId' THEN
  PERFORM openerp.fail('UnsupportedProfile','Choose the exact active per-book domestic accrual and account-role profile.'); END IF;
 SELECT r.body INTO v_draft FROM openerp.invoice_drafts d JOIN openerp.invoice_draft_revisions r
   ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision
  WHERE d.book_id=p_book AND d.id=p_input->>'draftId';
 IF NOT FOUND OR v_draft->>'revision' IS DISTINCT FROM p_input->>'expectedRevision'
  OR v_draft->>'digest' IS DISTINCT FROM p_input->>'expectedDigest' THEN
  PERFORM openerp.fail('StaleDependency','Select the exact current commercial draft revision and digest.'); END IF;
 IF EXISTS(SELECT FROM openerp.invoice_issues WHERE book_id=p_book AND draft_id=p_input->>'draftId')
   OR EXISTS(SELECT FROM openerp.ar_legal_issues WHERE book_id=p_book AND draft_id=p_input->>'draftId') THEN
  PERFORM openerp.fail('AlreadyPosted','The draft already has a retained issue.'); END IF;
 IF v_draft->'totals'->'sourceTotalMatches' IS DISTINCT FROM 'true'::jsonb
  OR EXISTS(SELECT FROM jsonb_array_elements(v_draft->'blockers') b WHERE b->>'code' NOT IN
   ('issuance_not_implemented','legal_identity_not_verified','tax_profile_not_activated')) THEN
  PERFORM openerp.fail('UnsupportedProfile','Draft amounts, dates and evidence must be complete and exact before legal issue.'); END IF;
 IF openerp.invoice_draft_calculate(p_book,v_draft->'content') IS DISTINCT FROM
   (v_draft - ARRAY['id','scope','draftKey','revision','status','issued','recognized','delivered',
     'calculationBasis','content','reason','createdAt','receipt','digest']) THEN
  PERFORM openerp.fail('StaleDependency','Retained draft calculation or counterpart changed.'); END IF;
 IF p_input->>'voucherSeries' !~ '^[A-Z0-9]{1,16}$' THEN
  PERFORM openerp.fail('InvalidJournal','Choose a supported voucher series.'); END IF;
 PERFORM openerp.commerce_text(p_input,'reason',2000);
 v_seller:=v_draft->'content'->'seller'; v_customer:=v_draft->'content'->'customer';
 v_counterpart:=v_draft->'counterparty';
 IF v_seller->>'legalName' IS DISTINCT FROM v_policy.body->'candidate'->'input'->'sellerIdentity'->>'legalName'
   OR v_seller->>'registrationId' IS DISTINCT FROM v_policy.body->'candidate'->'input'->'sellerIdentity'->>'registrationNumber'
   OR v_seller->>'taxId' IS DISTINCT FROM v_policy.body->'candidate'->'input'->'sellerIdentity'->>'vatRegistrationNumber'
   OR v_seller->>'address' IS DISTINCT FROM v_policy.body->'candidate'->'input'->'sellerIdentity'->>'postalAddress'
   OR v_seller->>'countryCode' IS DISTINCT FROM 'SE'
   OR v_customer->>'countryCode' IS DISTINCT FROM 'SE'
   OR coalesce(v_customer->>'registrationId','') !~ '^[0-9]{6}-?[0-9]{4}$'
   OR v_customer->>'legalName' IS DISTINCT FROM v_counterpart->>'displayName'
   OR v_customer->>'evidenceId' IS DISTINCT FROM v_counterpart->>'evidenceId'
   OR v_customer->>'address' IS NULL
   OR v_draft->'sellerEvidence'->>'evidenceId' IS DISTINCT FROM v_policy.body->'candidate'->'input'->'sellerEvidence'->>'evidenceId' THEN
  PERFORM openerp.fail('UnsupportedProfile','Seller and domestic B2B customer legal identities must match their reviewed evidence and current counterpart.'); END IF;
 IF v_draft->'content'->>'currency' IS DISTINCT FROM 'SEK'
   OR v_draft->'content'->'currencyScale' IS DISTINCT FROM '2'::jsonb
   OR (v_draft->'content'->>'supplyDate')::date < (v_policy.body->'candidate'->'input'->>'effectiveFrom')::date THEN
  PERFORM openerp.fail('UnsupportedProfile','Only SEK supplies within the reviewed policy effective interval are supported.'); END IF;
 v_date:=openerp.bank_date(v_draft->'content'->>'plannedIssueDate');
 IF v_date < (v_policy.body->'candidate'->'input'->>'effectiveFrom')::date
   OR v_date IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
   OR (v_draft->'content'->>'supplyDate')::date > v_date THEN
  PERFORM openerp.fail('UnsupportedProfile','Issue must use today in UTC, not a backdated/future date or an advance supply date.'); END IF;
 SELECT * INTO v_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_input->>'accountingPeriodId';
 IF NOT FOUND OR v_period.locked OR v_date NOT BETWEEN v_period.starts_on AND v_period.ends_on
   OR NOT EXISTS(SELECT FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=v_period.fiscal_year_id
     AND v_date BETWEEN y.starts_on AND y.ends_on) THEN
  PERFORM openerp.fail('PeriodLocked','The issue date requires an open period in its fiscal year.'); END IF;
 IF p_input->>'controlAccountId'=p_input->>'revenueAccountId'
  OR p_input->>'controlAccountId'=p_input->>'outputVatAccountId'
  OR p_input->>'revenueAccountId'=p_input->>'outputVatAccountId' THEN
  PERFORM openerp.fail('InvalidJournal','AR control, revenue and output VAT must use three distinct accounts.'); END IF;
 IF (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=p_book AND a.active
    AND a.id IN (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'outputVatAccountId'))<>3
   OR EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id IN
    (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'outputVatAccountId'))
   OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND
    ((c.account_id=p_input->>'controlAccountId' AND c.direction<>'customer')
     OR c.account_id IN (p_input->>'revenueAccountId',p_input->>'outputVatAccountId'))) THEN
  PERFORM openerp.fail('InvalidJournal','Use three active unreserved book accounts with AR control separate from revenue and output VAT.'); END IF;
 FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'content'->'lines') LOOP
  v_base:=(v_line->>'baseMinor')::numeric;
  v_net:=v_base-(v_line->>'discountMinor')::numeric+(v_line->>'chargeMinor')::numeric;
  IF v_line->>'unitPriceMinor' IS NULL OR v_net<=0 OR v_net>=1e38::numeric
    OR v_line->>'taxDescription' IS DISTINCT FROM 'se-domestic-standard-25-v1'
    OR v_line->>'taxEvidenceId' IS DISTINCT FROM v_policy.body->'candidate'->'input'->'vatEvidence'->>'evidenceId' THEN
   PERFORM openerp.fail('UnsupportedProfile','Each positive line must use the documented domestic 25% tax treatment and policy tax evidence.'); END IF;
  v_tax:=floor(v_net*25/100+0.5); v_gross:=v_net+v_tax;
  IF v_tax<=0 OR v_gross>=1e38::numeric OR v_line->>'taxMinor' IS DISTINCT FROM v_tax::text
   OR v_line->>'sourceGrossMinor' IS DISTINCT FROM v_gross::text THEN
   PERFORM openerp.fail('UnsupportedProfile','Each line tax must equal half-up rounding of 25% net; asserted and calculated gross must agree.'); END IF;
  v_computed:=v_computed||jsonb_build_array(jsonb_build_object('id',v_line->>'id','description',v_line->>'description',
   'quantity',v_line->>'quantity','unitPriceMinor',v_line->>'unitPriceMinor',
   'baseMinor',v_base::text,'discountMinor',v_line->>'discountMinor','chargeMinor',v_line->>'chargeMinor',
   'netMinor',v_net::text,'taxMinor',v_tax::text,'grossMinor',v_gross::text,'vatTreatment','se-domestic-standard-25-v1'));
  v_net_total:=v_net_total+v_net;v_tax_total:=v_tax_total+v_tax;v_gross_total:=v_gross_total+v_gross;
 END LOOP;
 IF v_net_total>=1e38::numeric OR v_tax_total>=1e38::numeric OR v_gross_total>=1e38::numeric
   OR v_draft->'totals'->>'netMinor' IS DISTINCT FROM v_net_total::text
   OR v_draft->'totals'->>'taxMinor' IS DISTINCT FROM v_tax_total::text
   OR v_draft->'totals'->>'grossMinor' IS DISTINCT FROM v_gross_total::text
   OR v_draft->'content'->>'sourceTotalMinor' IS DISTINCT FROM v_gross_total::text THEN
  PERFORM openerp.fail('InvalidJournal','The exact line, tax, receivable and document totals disagree or exceed the supported minor-unit bound.'); END IF;
 RETURN jsonb_build_object('draftSnapshot',v_draft,'policySnapshot',v_policy.body,
  'accountingProfileSnapshot',v_accounting.body,'lines',v_computed,
  'totals',jsonb_build_object('netMinor',v_net_total::text,'taxMinor',v_tax_total::text,'grossMinor',v_gross_total::text),
  'fiscalYearId',v_period.fiscal_year_id);
END $$;

CREATE FUNCTION openerp.prepare_ar_legal_issue(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_prior jsonb; v_calc jsonb; v_source jsonb;
 v_id text:=openerp.new_id('ar_review'); v_ordinal integer; v_body jsonb; v_evidence openerp.evidence;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(v_book.id,p_key,v_actor,'prepare_ar_legal_issue',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 v_calc:=openerp.ar_legal_issue_calculate(v_book.id,p_input);
 SELECT count(*)+1 INTO v_ordinal FROM openerp.ar_legal_issue_reviews WHERE book_id=v_book.id AND draft_id=p_input->>'draftId';
 IF v_ordinal>50 THEN PERFORM openerp.fail('UnsupportedProfile','This draft reached the complete 50-review bound.'); END IF;
 SELECT * INTO v_evidence FROM openerp.evidence e WHERE e.book_id=v_book.id
  AND e.sha256=encode(sha256(convert_to((v_calc->'draftSnapshot')::text,'UTF8')),'hex');
 IF NOT FOUND THEN
  v_source:=openerp.create_evidence(p_token,p_scope,'ar_'||v_id||'_source',jsonb_build_object(
   'title','Legal AR issue source: '||(v_calc->'draftSnapshot'->'content'->>'title'),
   'mediaType','application/json','content',(v_calc->'draftSnapshot')::text,
   'origin','Exact retained commercial draft revision for a reviewed legal AR issue; not itself a delivered invoice'));
  SELECT * INTO STRICT v_evidence FROM openerp.evidence e WHERE e.book_id=v_book.id AND e.id=v_source->>'id';
 END IF;
 IF EXISTS(SELECT FROM openerp.vouchers v JOIN openerp.events e ON e.book_id=v.book_id AND e.id=v.event_id
    WHERE v.book_id=v_book.id AND (e.evidence_id=v_evidence.id
      OR EXISTS(SELECT FROM jsonb_array_elements(v.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=v_evidence.id))) THEN
  PERFORM openerp.fail('AlreadyPosted','The legal draft source already has posting history.'); END IF;
 v_body:=jsonb_build_object('id',v_id,'scope',p_scope,'version',1,'profile','se-domestic-b2b-sek-25-accrual-v1',
  'ordinal',v_ordinal,'input',p_input,'draftSnapshot',v_calc->'draftSnapshot',
  'policySnapshot',v_calc->'policySnapshot','accountingProfileSnapshot',v_calc->'accountingProfileSnapshot','lines',v_calc->'lines','totals',v_calc->'totals',
  'fiscalYearId',v_calc->>'fiscalYearId','sourceEvidence',jsonb_build_object('evidenceId',v_evidence.id,'sha256',v_evidence.sha256))
  ||openerp.commerce_record_metadata(p_key,'prepare_ar_legal_issue',v_actor);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 IF octet_length(v_body::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The complete legal issue review exceeds 256 KiB.'); END IF;
 INSERT INTO openerp.ar_legal_issue_reviews VALUES(v_book.id,v_id,p_input->>'draftId',p_input->>'policyId',v_ordinal,v_actor,v_body);
 RETURN openerp.save_command(v_book.id,p_key,v_actor,'prepare_ar_legal_issue',p_input,v_body);
END $$;

CREATE FUNCTION openerp.ar_legal_issue_checked(p_book text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_review jsonb; v_calc jsonb; v_evidence openerp.evidence;
BEGIN
 SELECT body INTO v_review FROM openerp.ar_legal_issue_reviews WHERE book_id=p_book AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','This legal issue review does not exist in this book.'); END IF;
 IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'digest' IS DISTINCT FROM v_review->>'digest'
   OR p_input->'acknowledgeLimitedProfile' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('StaleDependency','Select the exact legal review digest and limited profile.'); END IF;
 v_calc:=openerp.ar_legal_issue_calculate(p_book,v_review->'input');
 IF v_calc->'draftSnapshot' IS DISTINCT FROM v_review->'draftSnapshot'
   OR v_calc->'policySnapshot' IS DISTINCT FROM v_review->'policySnapshot'
   OR v_calc->'accountingProfileSnapshot' IS DISTINCT FROM v_review->'accountingProfileSnapshot'
   OR v_calc->'lines' IS DISTINCT FROM v_review->'lines'
   OR v_calc->'totals' IS DISTINCT FROM v_review->'totals'
   OR v_calc->>'fiscalYearId' IS DISTINCT FROM v_review->>'fiscalYearId' THEN
  PERFORM openerp.fail('StaleDependency','Legal policy, draft or exact posting values changed. Prepare a fresh review.'); END IF;
 SELECT * INTO v_evidence FROM openerp.evidence WHERE book_id=p_book AND id=v_review->'sourceEvidence'->>'evidenceId';
 IF NOT FOUND OR v_evidence.sha256 IS DISTINCT FROM v_review->'sourceEvidence'->>'sha256' THEN
  PERFORM openerp.fail('MissingEvidence','The retained legal draft evidence changed or is unavailable.'); END IF;
 IF EXISTS(SELECT FROM openerp.vouchers v JOIN openerp.events e ON e.book_id=v.book_id AND e.id=v.event_id
   WHERE v.book_id=p_book AND (e.evidence_id=v_evidence.id OR EXISTS
    (SELECT FROM jsonb_array_elements(v.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=v_evidence.id))) THEN
  PERFORM openerp.fail('AlreadyPosted','The legal source already has posted history.'); END IF;
 RETURN v_review;
END $$;

CREATE FUNCTION openerp.approve_ar_legal_issue(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_review jsonb; v_ordinal integer; v_expires timestamptz;
 v_id text:=openerp.new_id('ar_approval'); v_body jsonb; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'approve_ar_legal_issue',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','acknowledgeLimitedProfile']);
 v_review:=openerp.ar_legal_issue_checked(p_scope->>'bookId',p_id,p_input);
 IF v_actor=(SELECT r.actor_id FROM openerp.ar_legal_issue_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id) THEN
  PERFORM openerp.fail('ApprovalRequired','An independent current operator must approve legal issue and accounting.'); END IF;
 SELECT count(*)+1 INTO v_ordinal FROM openerp.ar_legal_issue_approvals WHERE book_id=p_scope->>'bookId' AND review_id=p_id;
 IF v_ordinal>50 THEN PERFORM openerp.fail('UnsupportedProfile','Legal issue approval history reached its 50-item bound.'); END IF;
 v_expires:=clock_timestamp()+interval '1 hour';
 v_body:=jsonb_build_object('id',v_id,'scope',p_scope,'reviewId',p_id,'digest',v_review->>'digest',
  'version',1,'actorId',v_actor,'ordinal',v_ordinal,
  'expiresAt',to_char(v_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  ||openerp.commerce_record_metadata(p_key,'approve_ar_legal_issue',v_actor);
 INSERT INTO openerp.ar_legal_issue_approvals VALUES(p_scope->>'bookId',v_id,p_id,v_ordinal,v_actor,v_review->>'digest',v_expires,v_body);
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'approve_ar_legal_issue',v_payload,v_body);
END $$;

CREATE FUNCTION openerp.execute_ar_legal_issue(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_prior jsonb; v_review jsonb; v_approval openerp.ar_legal_issue_approvals;
 v_draft jsonb; v_input jsonb; v_source jsonb; v_event text; v_action jsonb; v_plan jsonb; v_plan_id text:=openerp.new_id('change');
 v_voucher_id text:=openerp.new_id('voucher'); v_posting_id text:=openerp.new_id('receipt');
 v_invoice_id text:=openerp.new_id('invoice'); v_issue_id text:=openerp.new_id('ar_issue');
 v_lines jsonb; v_number bigint; v_voucher_number bigint; v_sequence bigint; v_document text; v_posting jsonb; v_body jsonb;
 v_recorded timestamptz; v_issued_at timestamptz; v_issued_on date; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 SELECT * INTO STRICT v_book FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior:=openerp.replay(v_book.id,p_key,v_actor,'execute_ar_legal_issue',v_payload);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','approvalId','acknowledgeLimitedProfile']);
 v_review:=openerp.ar_legal_issue_checked(v_book.id,p_id,p_input);
 SELECT * INTO v_approval FROM openerp.ar_legal_issue_approvals a WHERE a.book_id=v_book.id AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
 IF NOT FOUND OR v_approval.digest IS DISTINCT FROM v_review->>'digest' OR v_approval.expires_at<=clock_timestamp()
   OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=v_book.id AND m.actor_id=v_approval.actor_id AND m.role='operator')
   OR EXISTS(SELECT FROM openerp.ar_legal_issues i WHERE i.book_id=v_book.id AND i.approval_id=v_approval.id) THEN
  PERFORM openerp.fail('ApprovalRequired','A current unexpired unused independent operator approval is required.'); END IF;
 v_input:=v_review->'input';v_draft:=v_review->'draftSnapshot';v_source:=v_review->'sourceEvidence';
 v_issued_at:=clock_timestamp();v_issued_on:=(v_issued_at AT TIME ZONE 'UTC')::date;
 IF v_issued_on IS DISTINCT FROM (v_draft->'content'->>'plannedIssueDate')::date THEN
  PERFORM openerp.fail('StaleDependency','The reviewed UTC issue day changed. Prepare a draft dated for today and a new issue review.'); END IF;
 IF EXISTS(SELECT FROM openerp.ar_legal_issue_counters c WHERE c.book_id=v_book.id AND c.policy_id=v_input->>'policyId'
  AND c.last_number>=999999999999999999)
  OR EXISTS(SELECT FROM openerp.series_counters c WHERE c.book_id=v_book.id
   AND c.fiscal_year_id=v_review->>'fiscalYearId' AND c.series=v_input->>'voucherSeries'
   AND c.last_number>=9223372036854775807)
  OR v_book.committed_sequence>=9223372036854775807 THEN
  PERFORM openerp.fail('UnsupportedProfile','Number or ledger sequence exhausted. Nothing issued.'); END IF;
 INSERT INTO openerp.ar_legal_issue_counters VALUES(v_book.id,v_input->>'policyId',1)
  ON CONFLICT(book_id,policy_id) DO UPDATE SET last_number=openerp.ar_legal_issue_counters.last_number+1
  RETURNING last_number INTO v_number;
 v_document:=(v_review->'policySnapshot'->'input'->>'series')||'-'||v_number::text;
 IF EXISTS(SELECT FROM openerp.commerce_invoices WHERE book_id=v_book.id AND direction='customer' AND
  counterparty_id=v_draft->'content'->>'counterpartyId' AND document_number=v_document) THEN
  PERFORM openerp.fail('IdempotencyConflict','This legal number already belongs to a registered customer invoice.'); END IF;
 SELECT e.id INTO v_event FROM openerp.events e WHERE e.book_id=v_book.id AND e.evidence_id=v_source->>'evidenceId'
  AND e.event_key='legal_ar_'||(v_draft->>'id');
 IF NOT FOUND THEN
  v_event:=openerp.new_id('event');
  INSERT INTO openerp.events VALUES(v_book.id,v_event,v_source->>'evidenceId','legal_ar_'||(v_draft->>'id'));
 END IF;
 v_lines:=jsonb_build_array(
  jsonb_build_object('lineId',openerp.new_id('line'),'accountId',v_input->>'controlAccountId',
    'debitMinor',v_review->'totals'->>'grossMinor','creditMinor','0','description','Customer receivable '||v_document),
  jsonb_build_object('lineId',openerp.new_id('line'),'accountId',v_input->>'revenueAccountId',
    'debitMinor','0','creditMinor',v_review->'totals'->>'netMinor','description','Domestic 25% net sales '||v_document),
  jsonb_build_object('lineId',openerp.new_id('line'),'accountId',v_input->>'outputVatAccountId',
    'debitMinor','0','creditMinor',v_review->'totals'->>'taxMinor','description','Domestic 25% output VAT '||v_document));
 v_action:=jsonb_build_object('kind','post_voucher','correctsVoucherId',NULL,'eventId',v_event,
  'postingPurpose','legal_ar_recognition','occurrenceKey','legal_ar_'||(v_draft->>'id'),
  'fiscalYearId',v_review->>'fiscalYearId','accountingPeriodId',v_input->>'accountingPeriodId',
  'postingDate',v_issued_on::text,'series',v_input->>'voucherSeries',
  'currency','SEK','description','Legal customer invoice '||v_document,
  'rationale',v_input->>'reason','taxAssessment','se-domestic-standard-25-v1','lines',v_lines,
  'evidenceRefs',jsonb_build_array(v_source||jsonb_build_object('locator','legal_ar_'||(v_draft->>'id'))),
  'legalIssue',jsonb_build_object('profile','se-domestic-b2b-sek-25-accrual-v1','number',v_document,
    'policyId',v_input->>'policyId','reviewId',p_id,'reviewDigest',v_review->>'digest',
    'netMinor',v_review->'totals'->>'netMinor','taxMinor',v_review->'totals'->>'taxMinor'));
 -- A dedicated approved action: generic inspect_action remains synthetic-only and must reject this action.
 v_plan:=jsonb_build_object('schemaVersion','1','canonicalization','openerp-c14n-v1','id',v_plan_id,'version',1,
  'scope',p_scope,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'dependencies','[]'::jsonb,'groups',jsonb_build_array(jsonb_build_object('id',openerp.new_id('group'),
    'dependsOnGroupIds','[]'::jsonb,'actions',jsonb_build_array(v_action))));
 v_plan:=v_plan||jsonb_build_object('planDigest',openerp.digest(v_plan));
 INSERT INTO openerp.change_sets VALUES(v_book.id,v_plan_id,v_plan,v_plan->>'planDigest',v_actor,clock_timestamp());
 INSERT INTO openerp.approvals(book_id,id,change_set_id,digest,actor_id,expires_at,consumed_at)
  VALUES(v_book.id,v_approval.id,v_plan_id,v_plan->>'planDigest',v_approval.actor_id,v_approval.expires_at,clock_timestamp());
 INSERT INTO openerp.series_counters(book_id,fiscal_year_id,series,last_number)
  VALUES(v_book.id,v_review->>'fiscalYearId',v_input->>'voucherSeries',1)
  ON CONFLICT(book_id,fiscal_year_id,series) DO UPDATE SET last_number=openerp.series_counters.last_number+1
  RETURNING last_number INTO v_voucher_number;
 UPDATE openerp.books SET committed_sequence=committed_sequence+1 WHERE id=v_book.id RETURNING committed_sequence INTO v_sequence;
 INSERT INTO openerp.vouchers(book_id,id,fiscal_year_id,period_id,series,number,sequence,posting_date,event_id,
   posting_purpose,occurrence_key,corrects_voucher_id,change_set_id,action)
 VALUES(v_book.id,v_voucher_id,v_review->>'fiscalYearId',v_input->>'accountingPeriodId',v_input->>'voucherSeries',
  v_voucher_number,v_sequence,v_issued_on,v_event,'legal_ar_recognition',
  'legal_ar_'||(v_draft->>'id'),NULL,v_plan_id,v_action) RETURNING recorded_at INTO v_recorded;
 INSERT INTO openerp.journal_lines(book_id,voucher_id,id,ordinal,account_id,debit_minor,credit_minor,description)
  SELECT v_book.id,v_voucher_id,value->>'lineId',ordinal,value->>'accountId',(value->>'debitMinor')::numeric,
   (value->>'creditMinor')::numeric,value->>'description' FROM jsonb_array_elements(v_lines) WITH ORDINALITY l(value,ordinal);
 v_posting:=jsonb_build_object('id',v_posting_id,'changeSetId',v_plan_id,'voucherId',v_voucher_id,
   'planDigest',v_plan->>'planDigest','sequence',v_sequence::text,'voucherNumber',v_voucher_number::text,
   'committedAt',to_char(v_recorded AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 INSERT INTO openerp.execution_receipts VALUES(v_book.id,v_posting_id,v_plan_id,v_voucher_id,v_approval.id,v_posting);
 INSERT INTO openerp.outbox(book_id,id,receipt_id,kind,payload)
 VALUES(v_book.id,openerp.new_id('outbox'),v_posting_id,'voucher.posted.v1',v_posting);
 INSERT INTO openerp.commerce_control_accounts VALUES(v_book.id,v_input->>'controlAccountId','customer') ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT FROM openerp.commerce_control_accounts WHERE book_id=v_book.id
   AND account_id=v_input->>'controlAccountId' AND direction='customer') THEN
  PERFORM openerp.fail('InvalidJournal','An AR control account cannot be classified as supplier control.'); END IF;
 INSERT INTO openerp.commerce_invoices(book_id,id,direction,counterparty_id,counterparty_revision,
  document_number,issued_on,amount_minor,control_account_id,recognition_voucher_id,recognition_line_id,
  evidence_id,current_revision,body)
 VALUES(v_book.id,v_invoice_id,'customer',v_draft->'content'->>'counterpartyId',
  (v_draft->'content'->>'counterpartyRevision')::bigint,v_document,
  v_issued_on,(v_review->'totals'->>'grossMinor')::numeric,
  v_input->>'controlAccountId',v_voucher_id,v_lines->0->>'lineId',v_source->>'evidenceId',1,
  jsonb_build_object('id',v_invoice_id,'scope',p_scope,'kind','legal_customer_invoice_v1',
   'direction','customer','counterpartyId',v_draft->'content'->>'counterpartyId',
   'counterpartyRevision',v_draft->'content'->>'counterpartyRevision',
   'counterpartyName',v_draft->'content'->'customer'->>'legalName','documentNumber',v_document,
   'issuedOn',v_issued_on::text,'currency','SEK','currencyScale',2,
   'amountMinor',v_review->'totals'->>'grossMinor','controlAccountId',v_input->>'controlAccountId',
   'evidence',v_source,'legalIssueId',v_issue_id,'policyId',v_input->>'policyId',
   'recognition',jsonb_build_object('voucherId',v_voucher_id,'lineId',v_lines->0->>'lineId',
    'eventId',v_event,'postingDate',v_issued_on::text)));
 INSERT INTO openerp.commerce_invoice_revisions VALUES(v_book.id,v_invoice_id,1,v_source->>'evidenceId',
  jsonb_build_object('id',v_invoice_id,'scope',p_scope,'revision','1',
   'dueOn',v_draft->'content'->>'dueDate','description',v_draft->'content'->>'title',
   'evidence',v_source,'reason','Original legal customer issue')
   ||openerp.commerce_record_metadata(p_key,'execute_ar_legal_issue',v_actor));
 v_body:=jsonb_build_object('id',v_issue_id,'scope',p_scope,'profile','se-domestic-b2b-sek-25-accrual-v1',
  'reviewId',p_id,'reviewDigest',v_review->>'digest','approvalId',v_approval.id,
  'draftId',v_draft->>'id','draftRevision',v_draft->>'revision','draftDigest',v_draft->>'digest',
  'draftSnapshot',v_draft,'policyId',v_input->>'policyId',
  'policyDigest',v_review->'policySnapshot'->>'digest','policySnapshot',v_review->'policySnapshot',
  'accountingProfileId',v_input->>'accountingProfileId',
  'accountingProfileDigest',v_review->'accountingProfileSnapshot'->>'digest',
  'accountingProfileSnapshot',v_review->'accountingProfileSnapshot',
  'legalDocumentNumber',v_document,'issuedOn',v_issued_on::text,
  'issuedAt',to_char(v_issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'issued',true,'legalInvoice',true,'recognized',true,'delivered',false,
  'totals',v_review->'totals','lines',v_review->'lines','postingReceipt',v_posting,
  'registerInvoiceId',v_invoice_id,'sourceEvidence',v_source)
  ||openerp.commerce_record_metadata(p_key,'execute_ar_legal_issue',v_actor);
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body));
 IF octet_length(v_body::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The legal receipt exceeds 256 KiB. No issue was committed.'); END IF;
 INSERT INTO openerp.ar_legal_issues VALUES(v_book.id,v_issue_id,p_id,v_approval.id,v_draft->>'id',
  v_input->>'policyId',v_document,v_posting_id,v_invoice_id,v_body);
 RETURN openerp.save_command(v_book.id,p_key,v_actor,'execute_ar_legal_issue',v_payload,v_body);
END $$;

CREATE FUNCTION openerp.get_ar_legal_issue_review(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_review jsonb; v_approval jsonb; v_issue jsonb; v_blockers jsonb:='[]'::jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 SELECT body INTO v_review FROM openerp.ar_legal_issue_reviews WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal issue review does not exist in this book.'); END IF;
 SELECT body INTO v_approval FROM openerp.ar_legal_issue_approvals WHERE book_id=p_scope->>'bookId' AND review_id=p_id ORDER BY ordinal DESC LIMIT 1;
 SELECT body INTO v_issue FROM openerp.ar_legal_issues WHERE book_id=p_scope->>'bookId' AND review_id=p_id;
 IF v_issue IS NULL THEN
  BEGIN
   PERFORM openerp.ar_legal_issue_checked(p_scope->>'bookId',p_id,
    jsonb_build_object('version',1,'digest',v_review->>'digest','acknowledgeLimitedProfile',true));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   v_blockers:=jsonb_build_array('Review dependencies changed; prepare a new review.');
  END;
 END IF;
 RETURN jsonb_build_object('review',v_review,'approval',v_approval,'issue',v_issue,'blockers',v_blockers,
  'approvalUsable',v_issue IS NULL AND v_blockers='[]'::jsonb AND v_approval IS NOT NULL
   AND v_approval->>'actorId'=v_actor AND (v_approval->>'expiresAt')::timestamptz>clock_timestamp());
END $$;
CREATE FUNCTION openerp.get_ar_legal_issue(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_body jsonb;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 SELECT body INTO v_body FROM openerp.ar_legal_issues WHERE book_id=p_scope->>'bookId' AND id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Legal customer invoice issue does not exist in this book.'); END IF;
 RETURN v_body;
END $$;
CREATE FUNCTION openerp.ar_legal_issue_history(p_token text,p_scope jsonb,p_draft text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb; v_count bigint;
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 IF NOT EXISTS(SELECT FROM openerp.invoice_drafts WHERE book_id=p_scope->>'bookId' AND id=p_draft) THEN
  PERFORM openerp.fail('NotFound','The customer draft does not exist in this book.'); END IF;
 SELECT count(*) INTO v_count FROM openerp.ar_legal_issue_reviews WHERE book_id=p_scope->>'bookId' AND draft_id=p_draft;
 IF v_count>50 THEN PERFORM openerp.fail('InvalidJournal','Legal review history exceeds its complete bound.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'ordinal',r.ordinal,'digest',r.body->>'digest',
  'draftRevision',r.body->'draftSnapshot'->>'revision','createdAt',r.body->>'createdAt',
  'issueId',i.id,'legalDocumentNumber',i.legal_number) ORDER BY r.ordinal),'[]'::jsonb) INTO v_items
 FROM openerp.ar_legal_issue_reviews r LEFT JOIN openerp.ar_legal_issues i ON i.book_id=r.book_id AND i.review_id=r.id
 WHERE r.book_id=p_scope->>'bookId' AND r.draft_id=p_draft;
 RETURN jsonb_build_object('scope',p_scope,'draftId',p_draft,'complete',true,'count',v_count,'items',v_items);
END $$;

-- The synthetic metadata update route may not alter legal document terms after issuance.
CREATE FUNCTION openerp.ar_legal_freeze_register() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
 IF EXISTS(SELECT FROM openerp.ar_legal_issues WHERE book_id=OLD.book_id AND register_invoice_id=OLD.id) THEN
  PERFORM openerp.fail('Forbidden','Legally issued commercial due terms and recognition are immutable; use an approved correction.'); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_legal_freeze_register BEFORE UPDATE ON openerp.commerce_invoices
 FOR EACH ROW EXECUTE FUNCTION openerp.ar_legal_freeze_register();

REVOKE ALL ON FUNCTION openerp.ar_legal_freeze_draft(),openerp.ar_legal_guard_source(),
 openerp.activate_ar_legal_accounting_profile(text,jsonb,text,jsonb),
 openerp.get_ar_legal_accounting_profile(text,jsonb,text),
 openerp.ar_legal_issue_calculate(text,jsonb),openerp.ar_legal_issue_checked(text,text,jsonb),
 openerp.prepare_ar_legal_issue(text,jsonb,text,jsonb),openerp.approve_ar_legal_issue(text,jsonb,text,text,jsonb),
 openerp.execute_ar_legal_issue(text,jsonb,text,text,jsonb),openerp.get_ar_legal_issue_review(text,jsonb,text),
 openerp.get_ar_legal_issue(text,jsonb,text),openerp.ar_legal_issue_history(text,jsonb,text),
 openerp.ar_legal_freeze_register() FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.activate_ar_legal_accounting_profile(text,jsonb,text,jsonb),
 openerp.get_ar_legal_accounting_profile(text,jsonb,text),openerp.prepare_ar_legal_issue(text,jsonb,text,jsonb),openerp.approve_ar_legal_issue(text,jsonb,text,text,jsonb),
 openerp.execute_ar_legal_issue(text,jsonb,text,text,jsonb),openerp.get_ar_legal_issue_review(text,jsonb,text),
 openerp.get_ar_legal_issue(text,jsonb,text),openerp.ar_legal_issue_history(text,jsonb,text) TO openerp_runtime;
