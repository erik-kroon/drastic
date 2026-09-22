-- Owner expense/funding retention and synthetic-only bridges to the existing kernel.
-- Dependencies: 0001–0006, 0100, 0500 and 0600. No existing migration is replaced.
CREATE TABLE openerp.owner_parties (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, source_key text COLLATE "C" NOT NULL,
 evidence_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,source_key),
 FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.owner_records (
 book_id text NOT NULL, id text NOT NULL, owner_id text NOT NULL, source_key text COLLATE "C" NOT NULL,
 evidence_id text NOT NULL, locator text COLLATE "C" NOT NULL, occurred_on date NOT NULL,
 amount_minor openerp.minor_units NOT NULL CHECK(amount_minor>0), current_revision bigint NOT NULL CHECK(current_revision>0), body jsonb NOT NULL,
 PRIMARY KEY(book_id,id), UNIQUE(book_id,source_key), UNIQUE(book_id,evidence_id,locator),
 FOREIGN KEY(book_id,owner_id) REFERENCES openerp.owner_parties,
 FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.owner_revisions (
 book_id text NOT NULL, record_id text NOT NULL, revision bigint NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY(book_id,record_id,revision), FOREIGN KEY(book_id,record_id) REFERENCES openerp.owner_records
);
ALTER TABLE openerp.owner_records ADD FOREIGN KEY(book_id,id,current_revision)
 REFERENCES openerp.owner_revisions(book_id,record_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE openerp.owner_reviews (
 book_id text NOT NULL, id text NOT NULL, record_id text NOT NULL, revision bigint NOT NULL,
 actor_id text NOT NULL REFERENCES openerp.actors, body jsonb NOT NULL,
 PRIMARY KEY(book_id,id), UNIQUE(book_id,record_id,revision),
 FOREIGN KEY(book_id,record_id,revision) REFERENCES openerp.owner_revisions
);
CREATE TABLE openerp.owner_control_accounts (
 book_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY(book_id,account_id),
 FOREIGN KEY(book_id,account_id) REFERENCES openerp.accounts
);
CREATE TABLE openerp.owner_proposal_links (
 book_id text NOT NULL, id text NOT NULL, record_id text NOT NULL, review_id text NOT NULL,
 change_set_id text NOT NULL, line_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY(book_id,id), UNIQUE(book_id,record_id,change_set_id), UNIQUE(book_id,change_set_id,line_id),
 FOREIGN KEY(book_id,record_id) REFERENCES openerp.owner_records,
 FOREIGN KEY(book_id,review_id) REFERENCES openerp.owner_reviews,
 FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets
);
CREATE TABLE openerp.owner_effects (
 book_id text NOT NULL, id text NOT NULL, record_id text NOT NULL, owner_id text NOT NULL, review_id text NOT NULL,
 voucher_id text NOT NULL, line_id text NOT NULL, account_id text NOT NULL, posting_date date NOT NULL,
 side text NOT NULL CHECK(side IN ('debit','credit')), classification text NOT NULL,
 origin text NOT NULL CHECK(origin IN ('opening','current')), amount_minor openerp.minor_units NOT NULL CHECK(amount_minor>0), body jsonb NOT NULL,
 PRIMARY KEY(book_id,id), UNIQUE(book_id,record_id), UNIQUE(book_id,voucher_id,line_id),
 FOREIGN KEY(book_id,record_id) REFERENCES openerp.owner_records, FOREIGN KEY(book_id,owner_id) REFERENCES openerp.owner_parties,
 FOREIGN KEY(book_id,review_id) REFERENCES openerp.owner_reviews,
 FOREIGN KEY(book_id,voucher_id,line_id) REFERENCES openerp.journal_lines,
 FOREIGN KEY(book_id,account_id) REFERENCES openerp.owner_control_accounts
);
CREATE TABLE openerp.owner_allocation_plans (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(book_id,id)
);
CREATE TABLE openerp.owner_allocation_approvals (
 book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, actor_id text NOT NULL REFERENCES openerp.actors,
 digest text NOT NULL, expires_at timestamptz NOT NULL, body jsonb NOT NULL, PRIMARY KEY(book_id,id),
 FOREIGN KEY(book_id,plan_id) REFERENCES openerp.owner_allocation_plans
);
CREATE TABLE openerp.owner_allocation_receipts (
 book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, approval_id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY(book_id,id), UNIQUE(book_id,plan_id), UNIQUE(book_id,approval_id),
 FOREIGN KEY(book_id,plan_id) REFERENCES openerp.owner_allocation_plans,
 FOREIGN KEY(book_id,approval_id) REFERENCES openerp.owner_allocation_approvals
);
CREATE TABLE openerp.owner_allocation_legs (
 book_id text NOT NULL, receipt_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
 claim_id text NOT NULL, settlement_id text NOT NULL, amount_minor openerp.minor_units NOT NULL CHECK(amount_minor>0),
 PRIMARY KEY(book_id,receipt_id,ordinal), UNIQUE(book_id,receipt_id,claim_id),
 FOREIGN KEY(book_id,receipt_id) REFERENCES openerp.owner_allocation_receipts,
 FOREIGN KEY(book_id,claim_id) REFERENCES openerp.owner_effects, FOREIGN KEY(book_id,settlement_id) REFERENCES openerp.owner_effects
);
CREATE TABLE openerp.owner_controls (
 book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(book_id,id)
);
CREATE INDEX owner_record_owner ON openerp.owner_records(book_id,owner_id,occurred_on);
CREATE INDEX owner_effect_account ON openerp.owner_effects(book_id,account_id,posting_date);
CREATE INDEX owner_allocation_claim ON openerp.owner_allocation_legs(book_id,claim_id);
CREATE INDEX owner_allocation_settlement ON openerp.owner_allocation_legs(book_id,settlement_id);

CREATE TRIGGER immutable_owner_parties BEFORE UPDATE OR DELETE ON openerp.owner_parties FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_revisions BEFORE UPDATE OR DELETE ON openerp.owner_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_reviews BEFORE UPDATE OR DELETE ON openerp.owner_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_control_accounts BEFORE UPDATE OR DELETE ON openerp.owner_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_proposal_links BEFORE UPDATE OR DELETE ON openerp.owner_proposal_links FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_effects BEFORE UPDATE OR DELETE ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_allocation_plans BEFORE UPDATE OR DELETE ON openerp.owner_allocation_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_allocation_approvals BEFORE UPDATE OR DELETE ON openerp.owner_allocation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_allocation_receipts BEFORE UPDATE OR DELETE ON openerp.owner_allocation_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_allocation_legs BEFORE UPDATE OR DELETE ON openerp.owner_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_owner_controls BEFORE UPDATE OR DELETE ON openerp.owner_controls FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER owner_freeze_record BEFORE UPDATE OR DELETE ON openerp.owner_records FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();


CREATE FUNCTION openerp.owner_date(p_input jsonb,p_field text) RETURNS date LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_date date;
BEGIN
 BEGIN
  v_date:=(p_input->>p_field)::date;
  IF v_date IS NULL OR to_char(v_date,'YYYY-MM-DD') IS DISTINCT FROM p_input->>p_field THEN RAISE invalid_datetime_format; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  PERFORM openerp.fail('InvalidJournal','Supply an exact calendar date.');
 END;
 RETURN v_date;
END $$;
CREATE FUNCTION openerp.owner_validate_revision(p_kind text,p_input jsonb) RETURNS void LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
BEGIN
 PERFORM openerp.commerce_text(p_input,'description',2000); PERFORM openerp.commerce_text(p_input,'reason',2000);
 IF coalesce(p_input->>'origin','') NOT IN ('unknown','opening','current') OR NOT (
  p_input->>'classification'='unknown' OR
  (p_kind='expense' AND p_input->>'classification'='owner_expense') OR
  (p_kind='funding' AND p_input->>'classification' IN ('shareholder_loan','conditional_contribution','unconditional_contribution')) OR
  (p_kind='settlement' AND p_input->>'classification' IN ('owner_reimbursement','loan_repayment'))
 ) IS TRUE THEN PERFORM openerp.fail('InvalidJournal','Select an explicit compatible classification and origin, or retain unknown.'); END IF;
END $$;
CREATE FUNCTION openerp.owner_record_body(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_record openerp.owner_records; v_revision jsonb; v_review jsonb; v_effect jsonb; v_proposals jsonb; v_allocated numeric; v_reason text; v_blockers jsonb:='[]';
BEGIN
 SELECT * INTO v_record FROM openerp.owner_records r WHERE r.book_id=p_book AND r.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The owner record was not found in this book.'); END IF;
 SELECT r.body INTO STRICT v_revision FROM openerp.owner_revisions r WHERE r.book_id=p_book AND r.record_id=p_id AND r.revision=v_record.current_revision;
 SELECT r.body INTO v_review FROM openerp.owner_reviews r WHERE r.book_id=p_book AND r.record_id=p_id AND r.revision=v_record.current_revision;
 SELECT e.body INTO v_effect FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.record_id=p_id;
 SELECT coalesce(jsonb_agg(p.body ORDER BY p.id),'[]') INTO v_proposals FROM openerp.owner_proposal_links p WHERE p.book_id=p_book AND p.record_id=p_id;
 SELECT coalesce(sum(l.amount_minor),0) INTO v_allocated FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book AND (l.claim_id=v_effect->>'id' OR l.settlement_id=v_effect->>'id');
 IF v_record.body->>'dataNature'<>'synthetic_example' THEN v_blockers:=v_blockers||'"Company accounting activation is not implemented; retained review only."'::jsonb; END IF;
 IF v_review IS NULL THEN v_blockers:=v_blockers||'"An exact operator classification review is required."'::jsonb; END IF;
 IF v_revision->>'classification'='unknown' OR v_revision->>'origin'='unknown' THEN v_blockers:=v_blockers||'"Classification or opening/current origin is unresolved."'::jsonb; END IF;
 IF v_review IS NOT NULL AND (v_review->>'controlAccountId' IS NULL OR v_review->'syntheticNoTaxConfirmed'<>'true'::jsonb) THEN v_blockers:=v_blockers||'"Explicit synthetic treatment and control account are not confirmed."'::jsonb; END IF;
 IF v_effect IS NULL AND v_blockers='[]'::jsonb THEN
  BEGIN PERFORM openerp.owner_require_ready(p_book,p_id,v_review->>'id',true);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_reason=MESSAGE_TEXT; v_blockers:=v_blockers||jsonb_build_array(v_reason);
  END;
 END IF;
 RETURN jsonb_build_object('source',v_record.body,'currentRevision',v_revision,'review',v_review,'effect',v_effect,
  'proposals',v_proposals,'allocatedMinor',v_allocated::text,'remainingMinor',CASE WHEN v_effect IS NULL THEN NULL ELSE (v_record.amount_minor-v_allocated)::text END,
  'sourceCoverage','unknown','blockers',v_blockers);
END $$;
CREATE FUNCTION openerp.owner_require_ready(p_book text,p_record text,p_review text,p_historical boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_record openerp.owner_records; v_revision jsonb; v_review openerp.owner_reviews; v_book openerp.books; v_account openerp.accounts; v_posted_review boolean:=false;
BEGIN
 SELECT * INTO v_record FROM openerp.owner_records r WHERE r.book_id=p_book AND r.id=p_record;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The owner record was not found.'); END IF;
 SELECT r.body INTO STRICT v_revision FROM openerp.owner_revisions r WHERE r.book_id=p_book AND r.record_id=p_record AND r.revision=v_record.current_revision;
 IF v_revision->>'digest' IS DISTINCT FROM openerp.digest(jsonb_build_object('source',v_record.body,'revision',v_revision-'digest')) THEN PERFORM openerp.fail('StaleDependency','The retained source/revision digest differs.'); END IF;
 SELECT * INTO v_book FROM openerp.books b WHERE b.id=p_book;
 IF v_record.body->>'dataNature'<>'synthetic_example' OR v_book.profile<>'synthetic-core-v1' OR v_book.authority<>'native'
  OR v_record.body->>'currency'<>v_book.currency OR (v_record.body->>'currencyScale')::integer<>v_book.currency_scale THEN
  PERFORM openerp.fail('UnsupportedProfile','Only explicitly synthetic, same-currency reviewed sources can use this bridge. Company treatment and FX activation are not implemented.'); END IF;
 SELECT * INTO v_review FROM openerp.owner_reviews r WHERE r.book_id=p_book AND r.id=p_review AND r.record_id=p_record AND r.revision=v_record.current_revision;
 IF NOT FOUND OR v_review.body->>'revisionDigest' IS DISTINCT FROM v_revision->>'digest'
  OR v_revision->>'classification'='unknown' OR v_revision->>'origin'='unknown'
  OR v_review.body->'syntheticNoTaxConfirmed' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM openerp.fail('ApprovalRequired','Resolve the classification/origin and obtain the exact operator review with an explicit synthetic no-tax declaration.'); END IF;
 SELECT p_historical AND EXISTS(SELECT FROM openerp.owner_proposal_links l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.change_set_id=l.change_set_id WHERE l.book_id=p_book AND l.record_id=p_record AND l.review_id=p_review) INTO v_posted_review;
 IF NOT v_posted_review THEN
  PERFORM 1 FROM openerp.memberships m WHERE m.book_id=p_book AND m.actor_id=v_review.actor_id AND m.role='operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','A currently authorized operator must review this unlinked source.'); END IF;
 END IF;
 SELECT * INTO v_account FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=v_review.body->>'controlAccountId';
 IF NOT FOUND OR (NOT v_posted_review AND (NOT v_account.active OR v_account.version::text IS DISTINCT FROM v_review.body->>'accountVersion'
  OR v_book.profile_version::text IS DISTINCT FROM v_review.body->>'profileVersion' OR v_book.writer_epoch::text IS DISTINCT FROM v_review.body->>'writerEpoch')) THEN
  PERFORM openerp.fail('StaleDependency','The reviewed account/profile changed. Append a revision and obtain a new review.'); END IF;
 IF v_revision->>'origin'='opening' AND v_record.body->>'sourceKind'='settlement' THEN PERFORM openerp.fail('UnsupportedProfile','Opening settlement treatment is not implemented.'); END IF;
 RETURN v_revision||jsonb_build_object('source',v_record.body,'review',v_review.body);
END $$;

CREATE FUNCTION openerp.owners_create_owner(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_payload jsonb:=p_input; v_id text:=openerp.new_id('owner'); v_evidence jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_create_owner',v_payload);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

 PERFORM openerp.commerce_exact_object(p_input,ARRAY['sourceKey','displayName','dataNature','evidenceId','reason']);
 PERFORM openerp.commerce_text(p_input,'sourceKey',200); PERFORM openerp.commerce_text(p_input,'displayName',200); PERFORM openerp.commerce_text(p_input,'reason',2000);
 IF coalesce(p_input->>'dataNature','') NOT IN ('company_record','synthetic_example') THEN PERFORM openerp.fail('InvalidJournal','Declare whether this is an actual source or a genuinely synthetic example.'); END IF;
 v_evidence:=openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId');
 IF EXISTS(SELECT FROM openerp.owner_parties p WHERE p.book_id=p_scope->>'bookId' AND p.source_key=p_input->>'sourceKey') THEN PERFORM openerp.fail('IdempotencyConflict','This owner source identity is already retained.'); END IF;
 v_result:=p_input||jsonb_build_object('id',v_id,'scope',p_scope,'evidence',v_evidence,'legalIdentityVerified',false)||openerp.commerce_record_metadata(p_key,'owners_create_owner',v_actor);
 INSERT INTO openerp.owner_parties VALUES(p_scope->>'bookId',v_id,p_input->>'sourceKey',p_input->>'evidenceId',v_result);

 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_create_owner',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.owners_create_record(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_payload jsonb:=p_input; v_id text:=openerp.new_id('owner_record'); v_owner jsonb; v_source jsonb; v_revision jsonb; v_date date; v_amount numeric;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_create_record',v_payload);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

 PERFORM openerp.commerce_exact_object(p_input,ARRAY['ownerId','dataNature','sourceKey','sourceKind','evidenceId','locator','occurredOn','currency','currencyScale','amountMinor','counterparty','description','classification','origin','reason']);
 PERFORM openerp.commerce_text(p_input,'sourceKey',200);
 IF coalesce(p_input->>'sourceKind','') NOT IN ('expense','funding','settlement') OR coalesce(p_input->>'locator','') !~ '^[a-zA-Z0-9_-]{1,128}$'
 OR coalesce(p_input->>'currency','') !~ '^[A-Z]{3}$' OR jsonb_typeof(p_input->'currencyScale') IS DISTINCT FROM 'number' OR (p_input->>'currencyScale') !~ '^[0-6]$' THEN
 PERFORM openerp.fail('InvalidJournal','Preserve the source kind, stable locator, currency and explicit minor-unit scale.'); END IF;
 IF p_input->'counterparty'<>'null'::jsonb THEN
  PERFORM openerp.commerce_exact_object(p_input->'counterparty',ARRAY['sourceKey','displayName']);
  PERFORM openerp.commerce_text(p_input->'counterparty','sourceKey',200); PERFORM openerp.commerce_text(p_input->'counterparty','displayName',200);
 END IF;
 SELECT p.body INTO v_owner FROM openerp.owner_parties p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_input->>'ownerId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Retain the owner identity in this book first.'); END IF;
 IF p_input->>'dataNature' IS DISTINCT FROM v_owner->>'dataNature' THEN PERFORM openerp.fail('InvalidJournal','Source and owner data nature must agree; real facts cannot be relabelled synthetic.'); END IF;
 PERFORM openerp.owner_validate_revision(p_input->>'sourceKind',p_input);
 v_date:=openerp.owner_date(p_input,'occurredOn'); v_amount:=openerp.commerce_positive_minor(p_input,'amountMinor');
 IF EXISTS(SELECT FROM openerp.owner_records r WHERE r.book_id=p_scope->>'bookId' AND (r.source_key=p_input->>'sourceKey' OR (r.evidence_id=p_input->>'evidenceId' AND r.locator=p_input->>'locator'))) THEN PERFORM openerp.fail('IdempotencyConflict','This supplied source occurrence is already retained.'); END IF;
 v_source:=p_input-ARRAY['description','classification','origin','reason']||jsonb_build_object('id',v_id,'scope',p_scope,'ownerName',v_owner->>'displayName','evidence',openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId'))||openerp.commerce_record_metadata(p_key,'owners_create_record',v_actor);
 v_revision:=jsonb_build_object('id',v_id,'scope',p_scope,'revision','1','description',p_input->>'description','classification',p_input->>'classification','origin',p_input->>'origin','reason',p_input->>'reason','evidence',v_source->'evidence')||openerp.commerce_record_metadata(p_key,'owners_create_record',v_actor);
 v_revision:=v_revision||jsonb_build_object('digest',openerp.digest(jsonb_build_object('source',v_source,'revision',v_revision)));
 INSERT INTO openerp.owner_records VALUES(p_scope->>'bookId',v_id,p_input->>'ownerId',p_input->>'sourceKey',p_input->>'evidenceId',p_input->>'locator',v_date,v_amount,1,v_source);
 INSERT INTO openerp.owner_revisions VALUES(p_scope->>'bookId',v_id,1,v_revision);
 v_result:=openerp.owner_record_body(p_scope->>'bookId',v_id);

 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_create_record',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.owners_revise_record(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input); v_record openerp.owner_records; v_revision jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_revise_record',v_payload);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

 PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedRevision','description','classification','origin','evidenceId','reason']);
 SELECT * INTO v_record FROM openerp.owner_records r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The record was not found.'); END IF;
 IF p_input->>'expectedRevision' IS DISTINCT FROM v_record.current_revision::text THEN PERFORM openerp.fail('StaleDependency','Revise the current retained revision.'); END IF;
 IF EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_scope->>'bookId' AND e.record_id=p_id) OR EXISTS(SELECT FROM openerp.owner_proposal_links l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.change_set_id=l.change_set_id WHERE l.book_id=p_scope->>'bookId' AND l.record_id=p_id) THEN PERFORM openerp.fail('StaleDependency','A posted link fixes this classification. Linked correction/release is not implemented.'); END IF;
 PERFORM openerp.owner_validate_revision(v_record.body->>'sourceKind',p_input);
 v_revision:=p_input-ARRAY['expectedRevision','evidenceId']||jsonb_build_object('id',p_id,'scope',p_scope,'revision',(v_record.current_revision+1)::text,'evidence',openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId'))||openerp.commerce_record_metadata(p_key,'owners_revise_record',v_actor);
 v_revision:=v_revision||jsonb_build_object('digest',openerp.digest(jsonb_build_object('source',v_record.body,'revision',v_revision)));
 INSERT INTO openerp.owner_revisions VALUES(p_scope->>'bookId',p_id,v_record.current_revision+1,v_revision);
 UPDATE openerp.owner_records SET current_revision=current_revision+1 WHERE book_id=p_scope->>'bookId' AND id=p_id;
 v_result:=openerp.owner_record_body(p_scope->>'bookId',p_id);

 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_revise_record',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.owners_review_record(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input); v_record openerp.owner_records; v_revision jsonb; v_account openerp.accounts; v_book openerp.books; v_id text:=openerp.new_id('owner_review');
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_review_record',v_payload);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

 PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedRevision','revisionDigest','controlAccountId','syntheticNoTaxConfirmed','evidenceId','reason']);
 SELECT * INTO v_record FROM openerp.owner_records r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The record was not found.'); END IF;
 SELECT r.body INTO STRICT v_revision FROM openerp.owner_revisions r WHERE r.book_id=p_scope->>'bookId' AND r.record_id=p_id AND r.revision=v_record.current_revision;
 IF p_input->>'expectedRevision' IS DISTINCT FROM v_record.current_revision::text OR p_input->>'revisionDigest' IS DISTINCT FROM v_revision->>'digest' THEN PERFORM openerp.fail('StaleDependency','Review the exact current source revision and digest.'); END IF;
 IF EXISTS(SELECT FROM openerp.owner_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.record_id=p_id AND r.revision=v_record.current_revision) THEN PERFORM openerp.fail('IdempotencyConflict','This revision already has an immutable review; append a revision for a changed decision.'); END IF;
 PERFORM openerp.commerce_text(p_input,'reason',2000);
 IF jsonb_typeof(p_input->'syntheticNoTaxConfirmed') IS DISTINCT FROM 'boolean' OR (p_input->'syntheticNoTaxConfirmed'='true'::jsonb AND v_record.body->>'dataNature'<>'synthetic_example') THEN PERFORM openerp.fail('UnsupportedProfile','A synthetic tax declaration cannot activate company facts.'); END IF;
 IF p_input->>'controlAccountId' IS NOT NULL THEN
  SELECT * INTO v_account FROM openerp.accounts a WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'controlAccountId';
  IF NOT FOUND OR NOT v_account.active THEN PERFORM openerp.fail('InvalidJournal','Select an active account in this book or retain an unknown account.'); END IF;
  INSERT INTO openerp.owner_control_accounts VALUES(p_scope->>'bookId',v_account.id) ON CONFLICT DO NOTHING;
 END IF;
 SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId';
 v_result:=p_input-ARRAY['expectedRevision','evidenceId']||jsonb_build_object('id',v_id,'recordId',p_id,'scope',p_scope,'revision',v_record.current_revision::text,'classification',v_revision->>'classification','origin',v_revision->>'origin','accountVersion',v_account.version::text,'profileVersion',v_book.profile_version::text,'writerEpoch',v_book.writer_epoch::text,'evidence',openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId'))||openerp.commerce_record_metadata(p_key,'owners_review_record',v_actor);
 INSERT INTO openerp.owner_reviews VALUES(p_scope->>'bookId',v_id,p_id,v_record.current_revision,v_actor,v_result);

 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_review_record',v_payload,v_result);
END $$;


CREATE FUNCTION openerp.owner_validate_line(p_book text,p_ready jsonb,p_action jsonb,p_line text) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_line jsonb; v_debit boolean:=(p_ready->'source'->>'sourceKind'='settlement');
BEGIN
 IF p_action->>'postingPurpose' IS DISTINCT FROM 'adjustment' OR p_action->>'occurrenceKey' IS DISTINCT FROM 'manual_journal'
 OR p_action->>'correctsVoucherId' IS NOT NULL OR p_action->>'currency' IS DISTINCT FROM p_ready->'source'->>'currency'
 OR p_action->>'taxAssessment' IS DISTINCT FROM 'not_applicable' OR (p_action->>'postingDate')::date<(p_ready->'source'->>'occurredOn')::date
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(p_action->'evidenceRefs') ref(value) WHERE ref.value->>'evidenceId'=p_ready->'source'->>'evidenceId' AND ref.value->>'sha256'=p_ready->'source'->'evidence'->>'sha256' AND ref.value->>'locator'=p_ready->'source'->>'locator')
 OR NOT EXISTS(SELECT FROM openerp.events e WHERE e.book_id=p_book AND e.id=p_action->>'eventId' AND e.evidence_id=p_ready->'source'->>'evidenceId' AND e.event_key=p_ready->'source'->>'locator') THEN
 PERFORM openerp.fail('InvalidJournal','The bridge requires the exact ordinary kernel source occurrence, currency and synthetic treatment.'); END IF;
 SELECT l.value INTO v_line FROM jsonb_array_elements(p_action->'lines') l(value) WHERE l.value->>'lineId'=p_line;
 IF v_line IS NULL OR v_line->>'accountId' IS DISTINCT FROM p_ready->'review'->>'controlAccountId'
 OR v_line->>(CASE WHEN v_debit THEN 'debitMinor' ELSE 'creditMinor' END) IS DISTINCT FROM p_ready->'source'->>'amountMinor'
 OR v_line->>(CASE WHEN v_debit THEN 'creditMinor' ELSE 'debitMinor' END) IS DISTINCT FROM '0' THEN
 PERFORM openerp.fail('InvalidJournal','Select the exact full control amount and reviewed account on the classification side. Splits and netting are unsupported.'); END IF;
 RETURN v_line;
END $$;

CREATE FUNCTION openerp.owners_attach_proposal(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input); v_ready jsonb; v_plan jsonb; v_id text:=openerp.new_id('owner_proposal');
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_attach_proposal',v_payload);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

 PERFORM openerp.commerce_exact_object(p_input,ARRAY['reviewId','changeSetId','lineId']);
 v_ready:=openerp.owner_require_ready(p_scope->>'bookId',p_id,p_input->>'reviewId');
 IF EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_scope->>'bookId' AND e.record_id=p_id) THEN PERFORM openerp.fail('AlreadyPosted','This source already has an immutable posted effect.'); END IF;
 SELECT p.plan INTO v_plan FROM openerp.change_sets p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_input->>'changeSetId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Prepare the exact source in the existing journal workbench first.'); END IF;
 IF jsonb_array_length(v_plan->'groups')<>1 OR jsonb_array_length(v_plan->'groups'->0->'actions')<>1 THEN PERFORM openerp.fail('UnsupportedProfile','Bundled owner posting attachment is not implemented.'); END IF;
 PERFORM openerp.check_dependencies(p_scope,v_plan);
 PERFORM openerp.owner_validate_line(p_scope->>'bookId',v_ready,v_plan->'groups'->0->'actions'->0,p_input->>'lineId');
 IF EXISTS(SELECT FROM openerp.owner_proposal_links l WHERE l.book_id=p_scope->>'bookId' AND ((l.record_id=p_id AND l.change_set_id=p_input->>'changeSetId') OR (l.change_set_id=p_input->>'changeSetId' AND l.line_id=p_input->>'lineId'))) THEN PERFORM openerp.fail('IdempotencyConflict','This proposal attachment already exists. Read the record or recover its original command.'); END IF;
 v_result:=p_input||jsonb_build_object('id',v_id,'scope',p_scope,'recordId',p_id,'revision',v_ready->>'revision','revisionDigest',v_ready->>'digest','planDigest',v_plan->>'planDigest')||openerp.commerce_record_metadata(p_key,'owners_attach_proposal',v_actor);
 INSERT INTO openerp.owner_proposal_links VALUES(p_scope->>'bookId',v_id,p_id,p_input->>'reviewId',p_input->>'changeSetId',p_input->>'lineId',v_result);

 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_attach_proposal',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.owners_attach_posted_line(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input); v_ready jsonb; v_voucher openerp.vouchers; v_line openerp.journal_lines; v_id text:=openerp.new_id('owner_effect');
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_attach_posted_line',v_payload);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

 PERFORM openerp.commerce_exact_object(p_input,ARRAY['reviewId','voucherId','lineId']);
 v_ready:=openerp.owner_require_ready(p_scope->>'bookId',p_id,p_input->>'reviewId',true);
 SELECT * INTO v_voucher FROM openerp.vouchers v WHERE v.book_id=p_scope->>'bookId' AND v.id=p_input->>'voucherId';
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select an existing posted voucher from this book.'); END IF;
 IF NOT openerp.commerce_voucher_current(p_scope->>'bookId',v_voucher.id) THEN PERFORM openerp.fail('StaleDependency','A corrected voucher cannot become a new owner effect.'); END IF;
 PERFORM 1 FROM openerp.periods p WHERE p.book_id=p_scope->>'bookId' AND p.id=v_voucher.period_id AND NOT p.locked;
 IF NOT FOUND THEN PERFORM openerp.fail('PeriodLocked','Reopen the recognition/settlement period before changing its registered coverage.'); END IF;
 IF EXISTS(SELECT FROM openerp.owner_proposal_links l WHERE l.book_id=p_scope->>'bookId' AND l.record_id=p_id AND l.change_set_id=v_voucher.change_set_id AND (l.review_id<>p_input->>'reviewId' OR l.line_id<>p_input->>'lineId' OR l.body->>'revisionDigest' IS DISTINCT FROM v_ready->>'digest')) THEN PERFORM openerp.fail('StaleDependency','The posted proposal is bound to another reviewed source revision or control line.'); END IF;
 PERFORM openerp.owner_validate_line(p_scope->>'bookId',v_ready,v_voucher.action,p_input->>'lineId');
 SELECT * INTO v_line FROM openerp.journal_lines l WHERE l.book_id=p_scope->>'bookId' AND l.voucher_id=v_voucher.id AND l.id=p_input->>'lineId';
 IF NOT FOUND OR v_line.account_id IS DISTINCT FROM v_ready->'review'->>'controlAccountId' OR (v_line.debit_minor+v_line.credit_minor)::text IS DISTINCT FROM v_ready->'source'->>'amountMinor' THEN PERFORM openerp.fail('InvalidJournal','The posted line differs from the reviewed source.'); END IF;
 IF EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_scope->>'bookId' AND (e.record_id=p_id OR (e.voucher_id=v_voucher.id AND e.line_id=v_line.id))) THEN PERFORM openerp.fail('AlreadyPosted','This source or posted line already has a retained owner effect.'); END IF;
 v_result:=p_input||jsonb_build_object('id',v_id,'scope',p_scope,'recordId',p_id,'ownerId',v_ready->'source'->>'ownerId','revisionDigest',v_ready->>'digest','accountId',v_line.account_id,'postingDate',v_voucher.posting_date::text,'occurredOn',v_ready->'source'->>'occurredOn','locator',v_ready->'source'->>'locator','eventId',v_voucher.event_id,'changeSetId',v_voucher.change_set_id,'classification',v_ready->>'classification','origin',v_ready->>'origin','side',CASE WHEN v_line.debit_minor>0 THEN 'debit' ELSE 'credit' END,'amountMinor',v_ready->'source'->>'amountMinor','currency',v_ready->'source'->>'currency','currencyScale',v_ready->'source'->'currencyScale','evidence',v_ready->'source'->'evidence')||openerp.commerce_record_metadata(p_key,'owners_attach_posted_line',v_actor);
 INSERT INTO openerp.owner_effects VALUES(p_scope->>'bookId',v_id,p_id,v_ready->'source'->>'ownerId',p_input->>'reviewId',v_voucher.id,v_line.id,v_line.account_id,v_voucher.posting_date,v_result->>'side',v_ready->>'classification',v_ready->>'origin',(v_ready->'source'->>'amountMinor')::numeric,v_result);

 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_attach_posted_line',v_payload,v_result);
END $$;


-- Both registration orders are protected under the owning book lock.
CREATE FUNCTION openerp.owner_guard_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
 PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
 IF TG_TABLE_NAME='owner_control_accounts' THEN
  IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=NEW.book_id AND s.account_id=NEW.account_id)
   OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=NEW.book_id AND c.account_id=NEW.account_id) THEN
   PERFORM openerp.fail('InvalidJournal','Owner, commerce and bank control accounts must be separately declared.'); END IF;
 ELSE
  IF EXISTS(SELECT FROM openerp.owner_control_accounts c WHERE c.book_id=NEW.book_id AND c.account_id=NEW.account_id) THEN PERFORM openerp.fail('InvalidJournal','A declared owner control account cannot become a bank/commerce account.'); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER owner_control_account_boundary BEFORE INSERT ON openerp.owner_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_account();
CREATE TRIGGER owner_bank_source_boundary BEFORE INSERT OR UPDATE OF account_id ON openerp.bank_sources FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_account();
CREATE TRIGGER owner_commerce_account_boundary BEFORE INSERT ON openerp.commerce_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_account();
CREATE FUNCTION openerp.owner_guard_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE v_voucher text; v_line text;
BEGIN
 PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
 IF TG_TABLE_NAME='owner_effects' THEN
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=NEW.book_id AND i.recognition_voucher_id=NEW.voucher_id AND i.recognition_line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.commerce_allocation_legs l WHERE l.book_id=NEW.book_id AND l.payment_voucher_id=NEW.voucher_id AND l.payment_line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id=NEW.book_id AND m.voucher_id=NEW.voucher_id AND m.line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.bank_allocation_legs l WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.line_id=NEW.line_id) THEN
   PERFORM openerp.fail('StaleDependency','This posted line is already used by commerce or bank matching.'); END IF;
 ELSE
  IF TG_TABLE_NAME='commerce_invoices' THEN v_voucher:=NEW.recognition_voucher_id; v_line:=NEW.recognition_line_id;
  ELSIF TG_TABLE_NAME='commerce_allocation_legs' THEN v_voucher:=NEW.payment_voucher_id; v_line:=NEW.payment_line_id;
  ELSE v_voucher:=NEW.voucher_id; v_line:=NEW.line_id; END IF;
  IF EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=NEW.book_id AND e.voucher_id=v_voucher AND e.line_id=v_line) THEN PERFORM openerp.fail('StaleDependency','This posted control line already belongs to an owner source.'); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER owner_effect_capacity_boundary BEFORE INSERT ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER owner_invoice_capacity_boundary BEFORE INSERT ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER owner_commerce_capacity_boundary BEFORE INSERT ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER owner_bank_match_boundary BEFORE INSERT ON openerp.bank_matches FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER owner_bank_allocation_boundary BEFORE INSERT ON openerp.bank_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE FUNCTION openerp.owner_guard_kernel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
DECLARE v_action jsonb; v_actions jsonb; v_record openerp.owner_records; v_review text; v_ready jsonb; v_attachment openerp.owner_proposal_links;
BEGIN
 PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
 IF TG_TABLE_NAME='vouchers' THEN
  IF NEW.corrects_voucher_id IS NOT NULL AND EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=NEW.book_id AND e.voucher_id=NEW.corrects_voucher_id) THEN
   PERFORM openerp.fail('StaleDependency','A linked owner voucher requires a supported linked release/correction, which is not implemented.'); END IF;
 END IF;
 IF TG_TABLE_NAME='change_sets' THEN
  SELECT coalesce(jsonb_agg(a.value),'[]') INTO v_actions FROM jsonb_array_elements(NEW.plan->'groups') g(value) CROSS JOIN LATERAL jsonb_array_elements(g.value->'actions') a(value);
 ELSE v_actions:=jsonb_build_array(NEW.action); END IF;
 FOR v_action IN SELECT value FROM jsonb_array_elements(v_actions) LOOP
  FOR v_record IN SELECT r.* FROM openerp.owner_records r JOIN openerp.events e ON e.book_id=r.book_id AND e.evidence_id=r.evidence_id AND e.event_key=r.locator
   WHERE r.book_id=NEW.book_id AND e.id=v_action->>'eventId'
  LOOP
   SELECT r.id INTO v_review FROM openerp.owner_reviews r WHERE r.book_id=NEW.book_id AND r.record_id=v_record.id AND r.revision=v_record.current_revision;
   v_ready:=openerp.owner_require_ready(NEW.book_id,v_record.id,v_review);
   IF TG_TABLE_NAME='vouchers' THEN
    SELECT * INTO v_attachment FROM openerp.owner_proposal_links l WHERE l.book_id=NEW.book_id AND l.record_id=v_record.id AND l.change_set_id=NEW.change_set_id;
    IF NOT FOUND OR v_attachment.review_id IS DISTINCT FROM v_review OR v_attachment.body->>'revisionDigest' IS DISTINCT FROM v_ready->>'digest' THEN
     PERFORM openerp.fail('StaleDependency','Attach the exact current reviewed source to this kernel proposal before posting.'); END IF;
    PERFORM openerp.owner_validate_line(NEW.book_id,v_ready,v_action,v_attachment.line_id);
   END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER owner_proposal_source_boundary BEFORE INSERT ON openerp.change_sets FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_kernel();
CREATE TRIGGER owner_posting_source_boundary BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_kernel();


CREATE FUNCTION openerp.owner_capacity(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_effect openerp.owner_effects; v_allocated numeric; v_count bigint;
BEGIN
 SELECT * INTO v_effect FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select a retained posted owner effect in this book.'); END IF;
 IF NOT openerp.commerce_voucher_current(p_book,v_effect.voucher_id) THEN PERFORM openerp.fail('StaleDependency','The retained posted owner effect was corrected.'); END IF;
 SELECT coalesce(sum(l.amount_minor),0),count(*) INTO v_allocated,v_count FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book AND (l.claim_id=p_id OR l.settlement_id=p_id);
 IF v_allocated>v_effect.amount_minor THEN PERFORM openerp.fail('StaleDependency','Registered allocations exceed source capacity.'); END IF;
 RETURN jsonb_build_object('effect',v_effect.body,'allocatedMinor',v_allocated::text,'remainingMinor',(v_effect.amount_minor-v_allocated)::text,'capacityVersion',v_count::text);
END $$;
CREATE FUNCTION openerp.owner_allocation_selection(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_settlement jsonb; v_claim jsonb; v_leg jsonb; v_legs jsonb:='[]'; v_total numeric:=0; v_amount numeric;
 v_ids text[]:='{}'; v_book openerp.books; v_account openerp.accounts; v_period openerp.periods;
BEGIN
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['settlementId','evidenceId','rationale','allocations']);
 PERFORM openerp.commerce_require_profile(p_book); PERFORM openerp.commerce_text(p_input,'rationale',2000);
 IF jsonb_typeof(p_input->'allocations') IS DISTINCT FROM 'array' THEN PERFORM openerp.fail('InvalidJournal','Supply an allocation array.'); END IF;
 IF jsonb_array_length(p_input->'allocations') NOT BETWEEN 1 AND 50 THEN PERFORM openerp.fail('InvalidJournal','Select between 1 and 50 claims.'); END IF;
 v_settlement:=openerp.owner_capacity(p_book,p_input->>'settlementId');
 IF v_settlement->'effect'->>'classification' NOT IN ('owner_reimbursement','loan_repayment') OR v_settlement->'effect'->>'side'<>'debit' THEN PERFORM openerp.fail('InvalidJournal','Select a reviewed reimbursement or loan-repayment effect. Contributions are not ordinary repayable claims.'); END IF;
 SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
 SELECT * INTO STRICT v_account FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=v_settlement->'effect'->>'accountId';
 IF NOT v_account.active THEN PERFORM openerp.fail('StaleDependency','The settlement control account is inactive.'); END IF;
 SELECT p.* INTO STRICT v_period FROM openerp.periods p JOIN openerp.vouchers v ON v.book_id=p.book_id AND v.period_id=p.id WHERE v.book_id=p_book AND v.id=v_settlement->'effect'->>'voucherId';
 IF v_period.locked THEN PERFORM openerp.fail('PeriodLocked','Reopen the settlement period before allocating.'); END IF;
 FOR v_leg IN SELECT value FROM jsonb_array_elements(p_input->'allocations') LOOP
  PERFORM openerp.commerce_exact_object(v_leg,ARRAY['claimId','amountMinor']);
  IF v_leg->>'claimId'=ANY(v_ids) THEN PERFORM openerp.fail('InvalidJournal','Each selected claim occurs once.'); END IF;
  v_ids:=array_append(v_ids,v_leg->>'claimId'); v_amount:=openerp.commerce_positive_minor(v_leg,'amountMinor');
  v_claim:=openerp.owner_capacity(p_book,v_leg->>'claimId');
  IF v_claim->'effect'->>'classification' IS DISTINCT FROM (CASE WHEN v_settlement->'effect'->>'classification'='owner_reimbursement' THEN 'owner_expense' ELSE 'shareholder_loan' END)
   OR v_claim->'effect'->>'side'<>'credit'
   OR (v_claim->'effect'->>'ownerId',v_claim->'effect'->>'accountId',v_claim->'effect'->>'currency',v_claim->'effect'->>'currencyScale') IS DISTINCT FROM
      (v_settlement->'effect'->>'ownerId',v_settlement->'effect'->>'accountId',v_settlement->'effect'->>'currency',v_settlement->'effect'->>'currencyScale')
   OR (v_claim->'effect'->>'postingDate')::date>(v_settlement->'effect'->>'postingDate')::date
   OR (v_claim->'effect'->>'occurredOn')::date>(v_settlement->'effect'->>'occurredOn')::date THEN
   PERFORM openerp.fail('InvalidJournal','Allocate only earlier compatible claims of the same owner/account/currency. Advances and contribution repayments are unsupported.'); END IF;
  IF v_amount>(v_claim->>'remainingMinor')::numeric THEN PERFORM openerp.fail('StaleDependency','The selected claim has insufficient remaining capacity.'); END IF;
  v_total:=v_total+v_amount;
  v_legs:=v_legs||jsonb_build_array(jsonb_build_object('claim',v_claim,'amountMinor',v_amount::text,'remainingAfterMinor',((v_claim->>'remainingMinor')::numeric-v_amount)::text));
 END LOOP;
 IF v_total>(v_settlement->>'remainingMinor')::numeric THEN PERFORM openerp.fail('StaleDependency','The settlement has insufficient remaining capacity.'); END IF;
 RETURN jsonb_build_object('input',p_input,'settlement',v_settlement,'legs',v_legs,'totalMinor',v_total::text,'settlementRemainingAfterMinor',((v_settlement->>'remainingMinor')::numeric-v_total)::text,'evidence',openerp.commerce_evidence(p_book,p_input->>'evidenceId'),'profileVersion',v_book.profile_version::text,'writerEpoch',v_book.writer_epoch::text,'accountVersion',v_account.version::text,'settlementPeriodVersion',v_period.version::text);
END $$;
CREATE FUNCTION openerp.owner_allocation_current(p_book text,p_plan jsonb) RETURNS boolean LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_current jsonb;
BEGIN
 IF p_plan->>'digest' IS DISTINCT FROM openerp.digest(p_plan-'digest') THEN RETURN false; END IF;
 BEGIN v_current:=openerp.owner_allocation_selection(p_book,p_plan->'input'); EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN false; END;
 RETURN v_current IS NOT DISTINCT FROM p_plan-ARRAY['id','scope','version','digest','createdAt','receipt'];
END $$;

CREATE FUNCTION openerp.owners_prepare_allocation(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_id text:=openerp.new_id('allocation');
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_prepare_allocation',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  v_result:=openerp.owner_allocation_selection(p_scope->>'bookId',p_input)
    ||jsonb_build_object('id',v_id,'scope',p_scope,'version',1)||openerp.commerce_record_metadata(p_key,'owners_prepare_allocation',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.owner_allocation_plans VALUES(p_scope->>'bookId',v_id,v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_prepare_allocation',p_input,v_result);
END $$;

CREATE FUNCTION openerp.owners_approve_allocation(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_plan jsonb; v_result jsonb; v_id text:=openerp.new_id('allocation_approval');
  v_expires timestamptz; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_approve_allocation',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','planDigest']);
  SELECT p.body INTO v_plan FROM openerp.owner_allocation_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The allocation plan was not found in this book.'); END IF;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'planDigest' IS DISTINCT FROM v_plan->>'digest'
    OR NOT openerp.owner_allocation_current(p_scope->>'bookId',v_plan) THEN
    PERFORM openerp.fail('StaleDependency','Approve the exact current allocation digest and version. Prepare again if dependencies changed.'); END IF;
  IF EXISTS(SELECT FROM openerp.owner_allocation_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.plan_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This allocation was already applied. Read its retained receipt.'); END IF;
  v_expires:=clock_timestamp()+interval '1 hour';
  v_result:=jsonb_build_object('id',v_id,'planId',p_id,'planDigest',v_plan->>'digest','actorId',v_actor,
    'expiresAt',to_char(v_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',p_key,'operation','owners_approve_allocation','actorId',v_actor));
  INSERT INTO openerp.owner_allocation_approvals VALUES(p_scope->>'bookId',v_id,p_id,v_actor,v_plan->>'digest',v_expires,v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_approve_allocation',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.owners_apply_allocation(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_plan jsonb; v_approval openerp.owner_allocation_approvals; v_result jsonb;
  v_id text:=openerp.new_id('allocation_receipt'); v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_apply_allocation',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','planDigest','approvalId']);
  SELECT p.body INTO v_plan FROM openerp.owner_allocation_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The allocation plan was not found in this book.'); END IF;
  IF EXISTS(SELECT FROM openerp.owner_allocation_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.plan_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This allocation was already applied. Read its retained receipt.'); END IF;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'planDigest' IS DISTINCT FROM v_plan->>'digest'
    OR NOT openerp.owner_allocation_current(p_scope->>'bookId',v_plan) THEN
    PERFORM openerp.fail('StaleDependency','Execute only the exact approved allocation while all selected capacities remain current.'); END IF;
  SELECT * INTO v_approval FROM openerp.owner_allocation_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId';
  IF NOT FOUND OR v_approval.plan_id<>p_id OR v_approval.digest IS DISTINCT FROM v_plan->>'digest'
    OR v_approval.expires_at<=clock_timestamp()
    OR EXISTS(SELECT FROM openerp.owner_allocation_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.approval_id=v_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','A current unused operator approval for this exact allocation is required.'); END IF;
  PERFORM 1 FROM openerp.memberships m WHERE m.book_id=p_scope->>'bookId' AND m.actor_id=v_approval.actor_id AND m.role='operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approving actor no longer has operator authority for this book.'); END IF;
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'planId',p_id,'planDigest',v_plan->>'digest','approvalId',v_approval.id,
    'totalMinor',v_plan->>'totalMinor','settlementRemainingMinor',v_plan->>'settlementRemainingAfterMinor',
    'committedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',p_key,'operation','owners_apply_allocation','actorId',v_actor));
  INSERT INTO openerp.owner_allocation_receipts VALUES(p_scope->>'bookId',v_id,p_id,v_approval.id,v_result);
  INSERT INTO openerp.owner_allocation_legs(book_id,receipt_id,ordinal,claim_id,settlement_id,amount_minor)
    SELECT p_scope->>'bookId',v_id,l.ordinal::integer,l.value->'claim'->'effect'->>'id',v_plan->'settlement'->'effect'->>'id',(l.value->>'amountMinor')::numeric
    FROM jsonb_array_elements(v_plan->'legs') WITH ORDINALITY l(value,ordinal);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_apply_allocation',v_payload,v_result);
END $$;


CREATE FUNCTION openerp.owner_assert_allocation(p_book text,p_receipt text) RETURNS void LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_receipt openerp.owner_allocation_receipts; v_plan jsonb; v_approval openerp.owner_allocation_approvals;
 v_leg openerp.owner_allocation_legs; v_expected jsonb; v_claim openerp.owner_effects; v_settlement openerp.owner_effects; v_sum numeric;
BEGIN
 PERFORM 1 FROM openerp.books b WHERE b.id=p_book FOR UPDATE;
 SELECT * INTO STRICT v_receipt FROM openerp.owner_allocation_receipts r WHERE r.book_id=p_book AND r.id=p_receipt;
 SELECT p.body INTO STRICT v_plan FROM openerp.owner_allocation_plans p WHERE p.book_id=p_book AND p.id=v_receipt.plan_id;
 SELECT * INTO STRICT v_approval FROM openerp.owner_allocation_approvals a WHERE a.book_id=p_book AND a.id=v_receipt.approval_id;
 IF v_plan->>'digest' IS DISTINCT FROM openerp.digest(v_plan-'digest') OR v_approval.plan_id<>v_receipt.plan_id OR v_approval.digest<>v_plan->>'digest'
 OR v_plan->>'id' IS DISTINCT FROM v_receipt.plan_id OR v_plan->'scope'->>'bookId' IS DISTINCT FROM p_book
 OR v_receipt.body->>'id' IS DISTINCT FROM v_receipt.id OR v_receipt.body->>'planId' IS DISTINCT FROM v_receipt.plan_id
 OR v_receipt.body->>'approvalId' IS DISTINCT FROM v_receipt.approval_id OR v_receipt.body->'scope'->>'bookId' IS DISTINCT FROM p_book
 OR v_approval.body->>'id' IS DISTINCT FROM v_approval.id OR v_approval.body->>'planId' IS DISTINCT FROM v_receipt.plan_id
 OR v_approval.body->>'planDigest' IS DISTINCT FROM v_plan->>'digest' OR v_approval.body->>'actorId' IS DISTINCT FROM v_approval.actor_id
 OR v_receipt.body->>'planDigest' IS DISTINCT FROM v_plan->>'digest'
 OR (SELECT count(*) FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt)<>jsonb_array_length(v_plan->'legs') THEN
 PERFORM openerp.fail('InvalidJournal','An owner allocation receipt must contain exactly its approved sealed legs.'); END IF;
 SELECT * INTO STRICT v_settlement FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.id=v_plan->'settlement'->'effect'->>'id';
 FOR v_leg IN SELECT l.* FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt LOOP
  v_expected:=v_plan->'legs'->(v_leg.ordinal-1);
  SELECT * INTO STRICT v_claim FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.id=v_leg.claim_id;
  IF v_leg.claim_id IS DISTINCT FROM v_expected->'claim'->'effect'->>'id' OR v_leg.settlement_id<>v_settlement.id OR v_leg.amount_minor<>(v_expected->>'amountMinor')::numeric
   OR v_claim.side<>'credit' OR v_settlement.side<>'debit' OR v_claim.owner_id<>v_settlement.owner_id OR v_claim.account_id<>v_settlement.account_id
   OR (v_claim.body->>'currency',v_claim.body->>'currencyScale') IS DISTINCT FROM (v_settlement.body->>'currency',v_settlement.body->>'currencyScale')
   OR v_claim.posting_date>v_settlement.posting_date OR (v_claim.body->>'occurredOn')::date>(v_settlement.body->>'occurredOn')::date OR v_claim.classification IS DISTINCT FROM (CASE WHEN v_settlement.classification='owner_reimbursement' THEN 'owner_expense' WHEN v_settlement.classification='loan_repayment' THEN 'shareholder_loan' ELSE NULL END) THEN
   PERFORM openerp.fail('InvalidJournal','Owner allocation identity, classification or approved amount differs.'); END IF;
  SELECT coalesce(sum(l.amount_minor),0) INTO v_sum FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book AND l.claim_id=v_leg.claim_id;
  IF v_sum>v_claim.amount_minor THEN PERFORM openerp.fail('InvalidJournal','Owner claim capacity was exceeded.'); END IF;
 END LOOP;
 SELECT coalesce(sum(l.amount_minor),0) INTO v_sum FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book AND l.settlement_id=v_settlement.id;
 IF v_sum>v_settlement.amount_minor THEN PERFORM openerp.fail('InvalidJournal','Owner settlement capacity was exceeded.'); END IF;
 SELECT coalesce(sum(l.amount_minor),0) INTO v_sum FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt;
 IF v_sum<>(v_plan->>'totalMinor')::numeric OR v_receipt.body->>'totalMinor' IS DISTINCT FROM v_plan->>'totalMinor' THEN PERFORM openerp.fail('InvalidJournal','Owner allocation totals differ from the sealed plan.'); END IF;
END $$;
CREATE FUNCTION openerp.owner_check_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
 IF TG_TABLE_NAME='owner_allocation_receipts' THEN PERFORM openerp.owner_assert_allocation(NEW.book_id,NEW.id);
 ELSE PERFORM openerp.owner_assert_allocation(NEW.book_id,NEW.receipt_id); END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER owner_receipt_conservation AFTER INSERT ON openerp.owner_allocation_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.owner_check_allocation();
CREATE CONSTRAINT TRIGGER owner_leg_conservation AFTER INSERT ON openerp.owner_allocation_legs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.owner_check_allocation();


CREATE FUNCTION openerp.owner_control_body(p_book text,p_owner text,p_starts date,p_ends date) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_owner jsonb; v_records jsonb; v_effects jsonb; v_allocations jsonb; v_movements jsonb; v_accounts jsonb; v_balances jsonb; v_unlinked bigint; v_book openerp.books;
BEGIN
 SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
 IF EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.posting_date<=p_ends AND (e.body->>'currency' IS DISTINCT FROM v_book.currency OR (e.body->>'currencyScale')::integer IS DISTINCT FROM v_book.currency_scale)) THEN PERFORM openerp.fail('UnsupportedProfile','Mixed-unit owner controls after a book currency/scale change are unsupported.'); END IF;
 IF p_starts IS NULL OR p_ends IS NULL OR p_starts>p_ends THEN PERFORM openerp.fail('InvalidJournal','Choose an ordered as-of interval.'); END IF;
 SELECT p.body INTO v_owner FROM openerp.owner_parties p WHERE p.book_id=p_book AND p.id=p_owner;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The owner was not found.'); END IF;
 IF (SELECT count(*) FROM openerp.owner_records r WHERE r.book_id=p_book AND r.owner_id=p_owner AND r.occurred_on<=p_ends)>1000 THEN PERFORM openerp.fail('InvalidJournal','This bounded owner control supports at most 1000 retained sources through the cutoff.'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('source',r.body,'revision',v.body,'review',w.body) ORDER BY r.id),'[]'),
  count(*) FILTER(WHERE NOT EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.record_id=r.id AND e.posting_date<=p_ends))
 INTO v_records,v_unlinked FROM openerp.owner_records r JOIN openerp.owner_revisions v ON v.book_id=r.book_id AND v.record_id=r.id AND v.revision=r.current_revision
 LEFT JOIN openerp.owner_reviews w ON w.book_id=r.book_id AND w.record_id=r.id AND w.revision=r.current_revision
 WHERE r.book_id=p_book AND r.owner_id=p_owner AND r.occurred_on<=p_ends;
 SELECT coalesce(jsonb_agg(e.body ORDER BY e.id),'[]') INTO v_effects FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.owner_id=p_owner AND e.posting_date<=p_ends;
 SELECT coalesce(jsonb_agg(jsonb_build_object('receiptId',l.receipt_id,'ordinal',l.ordinal,'claimId',l.claim_id,'settlementId',l.settlement_id,'amountMinor',l.amount_minor::text) ORDER BY l.receipt_id,l.ordinal),'[]') INTO v_allocations
 FROM openerp.owner_allocation_legs l JOIN openerp.owner_effects e ON e.book_id=l.book_id AND e.id=l.settlement_id WHERE e.book_id=p_book AND e.owner_id=p_owner AND e.posting_date<=p_ends;
 SELECT coalesce(jsonb_agg(x.body ORDER BY x.account_id,x.classification),'[]') INTO v_movements FROM (
 SELECT e.account_id,e.classification,jsonb_build_object('accountId',e.account_id,'classification',e.classification,
 'registeredOpeningMinor',coalesce(sum(CASE WHEN e.side='credit' THEN e.amount_minor ELSE -e.amount_minor END) FILTER(WHERE e.origin='opening'),0)::text,
 'priorCurrentMinor',coalesce(sum(CASE WHEN e.side='credit' THEN e.amount_minor ELSE -e.amount_minor END) FILTER(WHERE e.origin='current' AND e.posting_date<p_starts),0)::text,
 'currentMovementMinor',coalesce(sum(CASE WHEN e.side='credit' THEN e.amount_minor ELSE -e.amount_minor END) FILTER(WHERE e.origin='current' AND e.posting_date>=p_starts),0)::text,
 'recordedClosingMinor',sum(CASE WHEN e.side='credit' THEN e.amount_minor ELSE -e.amount_minor END)::text) body
 FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.owner_id=p_owner AND e.posting_date<=p_ends GROUP BY e.account_id,e.classification) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',c.account_id,'allOwnersRegisteredMinor',r.amount::text,'allOwnersEffectsDigest',r.digest,'ledgerCreditBalanceMinor',g.amount::text,'unexplainedMinor',(g.amount-r.amount)::text,'ledgerSequence',g.sequence::text) ORDER BY c.account_id),'[]') INTO v_accounts
 FROM (SELECT DISTINCT e.account_id FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.owner_id=p_owner AND e.posting_date<=p_ends) c
 CROSS JOIN LATERAL (SELECT coalesce(sum(CASE WHEN e.side='credit' THEN e.amount_minor ELSE -e.amount_minor END),0) amount,openerp.digest(coalesce(jsonb_agg(e.body ORDER BY e.id),'[]')) digest FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.account_id=c.account_id AND e.posting_date<=p_ends) r
 CROSS JOIN LATERAL (SELECT coalesce(sum(l.credit_minor-l.debit_minor),0) amount,coalesce(max(v.sequence),0) sequence FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id WHERE l.book_id=p_book AND l.account_id=c.account_id AND v.posting_date<=p_ends) g;
 SELECT coalesce(jsonb_agg(x.body ORDER BY x.account_id),'[]') INTO v_balances FROM (
 SELECT e.account_id,jsonb_build_object('accountId',e.account_id,
 'recordedNetCreditMinor',sum(CASE WHEN e.side='credit' THEN e.amount_minor ELSE -e.amount_minor END)::text,
 'openExpenseMinor',coalesce(sum(e.amount_minor-a.amount) FILTER(WHERE e.classification='owner_expense'),0)::text,
 'openLoanMinor',coalesce(sum(e.amount_minor-a.amount) FILTER(WHERE e.classification='shareholder_loan'),0)::text,
 'unappliedReimbursementMinor',coalesce(sum(e.amount_minor-a.amount) FILTER(WHERE e.classification='owner_reimbursement'),0)::text,
 'unappliedLoanRepaymentMinor',coalesce(sum(e.amount_minor-a.amount) FILTER(WHERE e.classification='loan_repayment'),0)::text,
 'conditionalContributionMinor',coalesce(sum(e.amount_minor) FILTER(WHERE e.classification='conditional_contribution'),0)::text,
 'unconditionalContributionMinor',coalesce(sum(e.amount_minor) FILTER(WHERE e.classification='unconditional_contribution'),0)::text) body
 FROM openerp.owner_effects e CROSS JOIN LATERAL (
 SELECT coalesce(sum(l.amount_minor),0) amount FROM openerp.owner_allocation_legs l JOIN openerp.owner_effects s ON s.book_id=l.book_id AND s.id=l.settlement_id
 WHERE l.book_id=p_book AND (l.claim_id=e.id OR l.settlement_id=e.id) AND s.posting_date<=p_ends
 ) a WHERE e.book_id=p_book AND e.owner_id=p_owner AND e.posting_date<=p_ends GROUP BY e.account_id) x;
 RETURN jsonb_build_object('owner',v_owner,'currency',v_book.currency,'currencyScale',v_book.currency_scale,'startsOn',p_starts::text,'endsOn',p_ends::text,'sourceCoverage','unknown','openingBalanceMinor',NULL,'unlinkedRecordCount',v_unlinked,
 'records',v_records,'effects',v_effects,'allocations',v_allocations,'ownerBalances',v_balances,'movements',v_movements,'accountControls',v_accounts,
 'blockers',jsonb_build_array('Source coverage and complete opening balances are not established.','Company accounting, statutory treatment and contribution repayment rights are not activated.'));
END $$;

CREATE FUNCTION openerp.owners_prepare_control(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_payload jsonb:=p_input; v_id text:=openerp.new_id('owner_control'); v_starts date; v_ends date;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'owners_prepare_control',v_payload);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

 PERFORM openerp.commerce_exact_object(p_input,ARRAY['ownerId','startsOn','endsOn']);
 v_starts:=openerp.owner_date(p_input,'startsOn'); v_ends:=openerp.owner_date(p_input,'endsOn');
 v_result:=openerp.owner_control_body(p_scope->>'bookId',p_input->>'ownerId',v_starts,v_ends)||jsonb_build_object('id',v_id,'scope',p_scope,'version',1)||openerp.commerce_record_metadata(p_key,'owners_prepare_control',v_actor);
 v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
 INSERT INTO openerp.owner_controls VALUES(p_scope->>'bookId',v_id,v_result);

 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'owners_prepare_control',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.owners_get_owner(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb; 
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 SELECT p.body INTO v_result FROM openerp.owner_parties p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The owner was not found.'); END IF;
 RETURN v_result;
END $$;

CREATE FUNCTION openerp.owners_get_record(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb; 
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 v_result:=openerp.owner_record_body(p_scope->>'bookId',p_id);
 RETURN v_result;
END $$;

CREATE FUNCTION openerp.owners_list_owners(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb; v_items jsonb; v_next text;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 SELECT coalesce(jsonb_agg(x.body ORDER BY x.id COLLATE "C"),'[]') INTO v_items FROM (SELECT p.id,p.body body FROM openerp.owner_parties p WHERE p.book_id=p_scope->>'bookId' AND (coalesce(p_after,'')='' OR p.id COLLATE "C">p_after COLLATE "C") ORDER BY p.id COLLATE "C" LIMIT 50) x;
 v_next:=CASE WHEN jsonb_array_length(v_items)=50 THEN v_items->49->>'id' ELSE NULL END;
 v_result:=jsonb_build_object('items',v_items,'next',v_next);
 RETURN v_result;
END $$;

CREATE FUNCTION openerp.owners_list_records(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb; v_items jsonb; v_next text;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
 SELECT coalesce(jsonb_agg(x.body ORDER BY x.id COLLATE "C"),'[]') INTO v_items FROM (SELECT p.id,openerp.owner_record_body(p_scope->>'bookId',p.id) body FROM openerp.owner_records p WHERE p.book_id=p_scope->>'bookId' AND (coalesce(p_after,'')='' OR p.id COLLATE "C">p_after COLLATE "C") ORDER BY p.id COLLATE "C" LIMIT 50) x;
 v_next:=CASE WHEN jsonb_array_length(v_items)=50 THEN v_items->49->'source'->>'id' ELSE NULL END;
 v_result:=jsonb_build_object('items',v_items,'next',v_next);
 RETURN v_result;
END $$;

CREATE FUNCTION openerp.owners_record_history(p_token text,p_scope jsonb,p_id text,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb; v_items jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;

 PERFORM openerp.owner_record_body(p_scope->>'bookId',p_id);
 IF coalesce(p_after,'')<>'' AND p_after !~ '^[1-9][0-9]{0,17}$' THEN PERFORM openerp.fail('InvalidJournal','Use the returned revision cursor.'); END IF;
 SELECT coalesce(jsonb_agg(x.body ORDER BY x.revision),'[]') INTO v_items FROM (SELECT r.revision,jsonb_build_object('revision',r.body,'review',w.body) body FROM openerp.owner_revisions r LEFT JOIN openerp.owner_reviews w ON w.book_id=r.book_id AND w.record_id=r.record_id AND w.revision=r.revision WHERE r.book_id=p_scope->>'bookId' AND r.record_id=p_id AND r.revision>coalesce(nullif(p_after,''),'0')::bigint ORDER BY r.revision LIMIT 50) x;
 v_result:=jsonb_build_object('items',v_items,'next',CASE WHEN jsonb_array_length(v_items)=50 THEN v_items->49->'revision'->>'revision' ELSE NULL END);

 RETURN v_result;
END $$;

CREATE FUNCTION openerp.owners_get_allocation(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb; v_plan jsonb; v_approval jsonb; v_receipt jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;

 SELECT p.body INTO v_plan FROM openerp.owner_allocation_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The allocation plan was not found.'); END IF;
 SELECT a.body INTO v_approval FROM openerp.owner_allocation_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.plan_id=p_id ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
 SELECT r.body INTO v_receipt FROM openerp.owner_allocation_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.plan_id=p_id;
 v_result:=jsonb_build_object('plan',v_plan,'dependenciesCurrent',openerp.owner_allocation_current(p_scope->>'bookId',v_plan),'approval',v_approval,'application',v_receipt);

 RETURN v_result;
END $$;

CREATE FUNCTION openerp.owners_get_control(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb; v_snapshot jsonb; v_current jsonb;
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;

 SELECT c.body INTO v_snapshot FROM openerp.owner_controls c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The control snapshot was not found.'); END IF;
 BEGIN
  v_current:=openerp.owner_control_body(p_scope->>'bookId',v_snapshot->'owner'->>'id',(v_snapshot->>'startsOn')::date,(v_snapshot->>'endsOn')::date);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN v_current:=NULL;
 END;
 v_result:=jsonb_build_object('snapshot',v_snapshot,'current',v_snapshot->>'digest'=openerp.digest(v_snapshot-'digest') AND v_current IS NOT DISTINCT FROM v_snapshot-ARRAY['id','scope','version','createdAt','receipt','digest']);

 RETURN v_result;
END $$;

CREATE FUNCTION openerp.owners_recover_command(p_token text,p_scope jsonb,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_result jsonb; 
BEGIN
 v_actor:=openerp.authorize(p_token,p_scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;

 IF coalesce(p_key,'') !~ '^[a-zA-Z0-9_-]{8,128}$' THEN PERFORM openerp.fail('InvalidJournal','Supply the exact saved command key.'); END IF;
 SELECT jsonb_build_object('operation',r.operation,'result',r.result) INTO v_result FROM openerp.command_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.key=p_key AND r.actor_id=v_actor AND r.operation IN ('owners_create_owner','owners_create_record','owners_revise_record','owners_review_record','owners_attach_proposal','owners_attach_posted_line','owners_prepare_allocation','owners_approve_allocation','owners_apply_allocation','owners_prepare_control');
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','No owner command receipt exists for this actor, book and key. An absent receipt is not proof that an in-flight request cannot still commit.'); END IF;

 RETURN v_result;
END $$;


-- Closing may consume this private hook under its existing book lock. Coverage never becomes complete.
CREATE FUNCTION openerp.owner_period_status(p_book text,p_starts date,p_ends date) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE v_sources jsonb; v_effects jsonb; v_legs jsonb; v_unknown bigint; v_unlinked bigint;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('source',r.body,'revision',v.body,'review',w.body) ORDER BY r.id),'[]'),
 count(*) FILTER(WHERE w.id IS NULL OR v.body->>'classification'='unknown' OR v.body->>'origin'='unknown'),
 count(*) FILTER(WHERE NOT EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.record_id=r.id AND e.posting_date<=p_ends))
 INTO v_sources,v_unknown,v_unlinked FROM openerp.owner_records r JOIN openerp.owner_revisions v ON v.book_id=r.book_id AND v.record_id=r.id AND v.revision=r.current_revision LEFT JOIN openerp.owner_reviews w ON w.book_id=r.book_id AND w.record_id=r.id AND w.revision=r.current_revision WHERE r.book_id=p_book AND r.occurred_on<=p_ends;
 SELECT coalesce(jsonb_agg(e.body ORDER BY e.id),'[]') INTO v_effects FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.posting_date<=p_ends;
 SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.receipt_id,l.ordinal),'[]') INTO v_legs FROM openerp.owner_allocation_legs l JOIN openerp.owner_effects e ON e.book_id=l.book_id AND e.id=l.settlement_id WHERE e.book_id=p_book AND e.posting_date<=p_ends;
 RETURN jsonb_build_object('schemaVersion',1,'coverage','not_established','startsOn',p_starts::text,'endsOn',p_ends::text,'registeredRecordCount',jsonb_array_length(v_sources),'unresolvedReviewCount',v_unknown,'unlinkedRecordCount',v_unlinked,'sourceDigest',openerp.digest(jsonb_build_object('sources',v_sources,'effects',v_effects,'allocations',v_legs)),'blockers',CASE WHEN v_unknown+v_unlinked>0 THEN jsonb_build_array('Owner sources have unresolved review or posted-reference coverage.') ELSE '[]'::jsonb END);
END $$;

REVOKE ALL ON openerp.owner_parties,openerp.owner_records,openerp.owner_revisions,openerp.owner_reviews,openerp.owner_control_accounts,openerp.owner_proposal_links,openerp.owner_effects,openerp.owner_allocation_plans,openerp.owner_allocation_approvals,openerp.owner_allocation_receipts,openerp.owner_allocation_legs,openerp.owner_controls FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_date(jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_validate_revision(text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_record_body(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_require_ready(text,text,text,boolean) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_create_owner(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_create_owner(text,jsonb,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_create_record(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_create_record(text,jsonb,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_revise_record(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_revise_record(text,jsonb,text,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_review_record(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_review_record(text,jsonb,text,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_validate_line(text,jsonb,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_attach_proposal(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_attach_proposal(text,jsonb,text,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_attach_posted_line(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_attach_posted_line(text,jsonb,text,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_guard_account() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_guard_capacity() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_guard_kernel() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_capacity(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_allocation_selection(text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_allocation_current(text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_prepare_allocation(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_prepare_allocation(text,jsonb,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_approve_allocation(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_approve_allocation(text,jsonb,text,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_apply_allocation(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_apply_allocation(text,jsonb,text,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_assert_allocation(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_check_allocation() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_control_body(text,text,date,date) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_prepare_control(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_prepare_control(text,jsonb,text,jsonb) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_get_owner(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_get_owner(text,jsonb,text) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_get_record(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_get_record(text,jsonb,text) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_list_owners(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_list_owners(text,jsonb,text) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_list_records(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_list_records(text,jsonb,text) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_record_history(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_record_history(text,jsonb,text,text) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_get_allocation(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_get_allocation(text,jsonb,text) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_get_control(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_get_control(text,jsonb,text) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owners_recover_command(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.owners_recover_command(text,jsonb,text) TO openerp_runtime;
REVOKE ALL ON FUNCTION openerp.owner_period_status(text,date,date) FROM PUBLIC,openerp_runtime;
