-- Supplier acceptance is synthetic-only. The supplier number stays the original source assertion.
-- No draft is posted; execution atomically posts and registers the accepted invoice.
CREATE TABLE openerp.supplier_acceptance_reviews (
  book_id text NOT NULL, id text NOT NULL, draft_id text NOT NULL, draft_revision bigint NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 50), change_set_id text NOT NULL, event_id text NOT NULL, evidence_id text NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text)<=262144),
  PRIMARY KEY (book_id,id), UNIQUE (book_id,draft_id,ordinal), UNIQUE (book_id,change_set_id),
  UNIQUE (book_id,id,draft_id,draft_revision),
  FOREIGN KEY (book_id,draft_id,draft_revision) REFERENCES openerp.supplier_invoice_draft_revisions,
  FOREIGN KEY (book_id,change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY (book_id,event_id) REFERENCES openerp.events,
  FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE INDEX supplier_acceptance_review_event ON openerp.supplier_acceptance_reviews(book_id,event_id);
CREATE INDEX supplier_acceptance_review_evidence ON openerp.supplier_acceptance_reviews(book_id,evidence_id);
CREATE TABLE openerp.supplier_acceptance_approvals (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 50),
  actor_id text NOT NULL REFERENCES openerp.actors, digest text NOT NULL, expires_at timestamptz NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id,id), UNIQUE (book_id,review_id,ordinal),
  UNIQUE (book_id,id,review_id), FOREIGN KEY (book_id,review_id) REFERENCES openerp.supplier_acceptance_reviews
);
CREATE TABLE openerp.supplier_acceptances (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL, approval_id text NOT NULL,
  draft_id text NOT NULL, draft_revision bigint NOT NULL, posting_receipt_id text NOT NULL, register_invoice_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), UNIQUE (book_id,draft_id), UNIQUE (book_id,review_id),
  UNIQUE (book_id,approval_id), UNIQUE (book_id,posting_receipt_id),
  UNIQUE (book_id,register_invoice_id),
  FOREIGN KEY (book_id,review_id,draft_id,draft_revision) REFERENCES openerp.supplier_acceptance_reviews(book_id,id,draft_id,draft_revision),
  FOREIGN KEY (book_id,approval_id,review_id) REFERENCES openerp.supplier_acceptance_approvals(book_id,id,review_id),
  FOREIGN KEY (book_id,posting_receipt_id) REFERENCES openerp.execution_receipts,
  FOREIGN KEY (book_id,register_invoice_id) REFERENCES openerp.commerce_invoices,
  CHECK (body->>'id'=id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_supplier_acceptance_review BEFORE UPDATE OR DELETE ON openerp.supplier_acceptance_reviews
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_acceptance_approval BEFORE UPDATE OR DELETE ON openerp.supplier_acceptance_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_acceptance BEFORE UPDATE OR DELETE ON openerp.supplier_acceptances
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.supplier_acceptance_guard_draft() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=OLD.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.supplier_acceptances i WHERE i.book_id=OLD.book_id AND i.draft_id=OLD.id) THEN
    PERFORM openerp.fail('Forbidden','This draft has an immutable supplier acceptance. Its content cannot be revised.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_acceptance_freeze_draft BEFORE UPDATE ON openerp.supplier_invoice_drafts
  FOR EACH ROW EXECUTE FUNCTION openerp.supplier_acceptance_guard_draft();

-- Ownership persists for both the event and retained source. Changing eventKey is not an escape.
-- Historical owned sources and corrections stay blocked until a linked issue-correction workflow exists.
CREATE FUNCTION openerp.supplier_acceptance_require_aggregate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.supplier_acceptance_reviews r
      WHERE r.book_id=NEW.book_id AND (r.event_id=NEW.event_id
        OR r.evidence_id IN (SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
        OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=r.evidence_id)))
    AND NOT EXISTS(SELECT FROM openerp.supplier_acceptances i
      JOIN openerp.supplier_acceptance_reviews r ON r.book_id=i.book_id AND r.id=i.review_id
      JOIN openerp.execution_receipts e ON e.book_id=i.book_id AND e.id=i.posting_receipt_id
      WHERE i.book_id=NEW.book_id AND r.change_set_id=NEW.change_set_id AND e.voucher_id=NEW.id) THEN
    PERFORM openerp.fail('ApprovalRequired','Use the supplier acceptance operation. An owned draft source cannot be posted separately, with another event key, or corrected outside its aggregate.');
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER supplier_acceptance_aggregate AFTER INSERT ON openerp.vouchers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.supplier_acceptance_require_aggregate();

CREATE FUNCTION openerp.supplier_acceptance_draft(p_book text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_draft jsonb; v_recalculated jsonb; v_head bigint;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  SELECT d.current_revision,r.body INTO v_head,v_draft FROM openerp.supplier_invoice_drafts d
    JOIN openerp.supplier_invoice_draft_revisions r ON r.book_id=d.book_id AND r.draft_id=d.id AND r.revision=d.current_revision
    WHERE d.book_id=p_book AND d.id=p_input->>'draftId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The current supplier draft was not found in this book.'); END IF;
  IF p_input->>'expectedRevision' IS DISTINCT FROM v_head::text OR p_input->>'expectedDigest' IS DISTINCT FROM v_draft->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Reopen the current supplier draft and prepare a new acceptance review.');
  END IF;
  IF EXISTS(SELECT FROM openerp.supplier_acceptances i WHERE i.book_id=p_book AND i.draft_id=p_input->>'draftId') THEN
    PERFORM openerp.fail('AlreadyPosted','This draft already has a supplier acceptance. Recover it from acceptance history.');
  END IF;
  v_recalculated:=openerp.supplier_invoice_draft_calculate(p_book,v_draft->'content');
  IF v_recalculated IS DISTINCT FROM (v_draft - ARRAY['id','scope','draftKey','revision','status','acceptanceSupported','recognitionSupported','recognitionAssessment',
    'calculationBasis','content','reason','createdAt','receipt','digest']) THEN
    PERFORM openerp.fail('StaleDependency','The retained draft facts or counterpart changed. Save and review a new revision.');
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(v_draft->'blockers') b WHERE b->>'code' NOT IN
    ('acceptance_not_implemented','recognition_not_implemented','legal_identity_not_verified','tax_profile_not_activated'))
    OR v_draft->'content'->>'supplierDocumentNumber' IS NULL
    OR v_draft->'totals'->>'taxMinor' IS DISTINCT FROM '0'
    OR coalesce(v_draft->'totals'->>'grossMinor','') !~ '^[1-9][0-9]{0,37}$'
    OR v_draft->'totals'->'sourceTotalMatches' IS DISTINCT FROM 'true'::jsonb
    OR EXISTS(SELECT FROM jsonb_array_elements(v_draft->'calculatedLines') l WHERE l->'sourceGrossMatches' IS DISTINCT FROM 'true'::jsonb) THEN
    PERFORM openerp.fail('UnsupportedProfile','Synthetic supplier acceptance requires a source number, complete exact lines, matching source totals and evidenced zero asserted tax. This does not activate a real VAT rule.');
  END IF;
  RETURN v_draft;
END $$;
CREATE FUNCTION openerp.supplier_acceptance_accounts(p_book text,p_input jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF p_input->>'controlAccountId'=p_input->>'debitAccountId' THEN
    PERFORM openerp.fail('InvalidJournal','Choose different supplier payable and expense accounts.'); END IF;
  IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book
      AND s.account_id IN (p_input->>'controlAccountId',p_input->>'debitAccountId'))
    OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book
      AND (c.account_id=p_input->>'debitAccountId' OR (c.account_id=p_input->>'controlAccountId' AND c.direction<>'supplier'))) THEN
    PERFORM openerp.fail('InvalidJournal','Synthetic supplier recognition cannot use bank accounts, a customer control account or another commerce control account for its debit.'); END IF;
END $$;

CREATE FUNCTION openerp.prepare_supplier_acceptance(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_draft jsonb; v_evidence jsonb; v_posting jsonb;
  v_result jsonb; v_id text:=openerp.new_id('supplier_review'); v_ordinal integer; v_field text; v_amount text;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'prepare_supplier_acceptance',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','draftId','expectedRevision','expectedDigest','controlAccountId',
    'debitAccountId','accountingPeriodId','series','reason','acknowledgeSyntheticOnly']);
  IF p_input->>'profile' IS DISTINCT FROM 'synthetic-manual-supplier-v1' OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Explicitly acknowledge synthetic-only supplier acceptance and recognition. Real-company tax treatment is unsupported.');
  END IF;
  FOREACH v_field IN ARRAY ARRAY['draftId','controlAccountId','debitAccountId','accountingPeriodId'] LOOP
    IF openerp.commerce_text(p_input,v_field,128) !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Supply scoped identifiers for the draft, both accounts and period.');
    END IF;
  END LOOP;
  IF openerp.commerce_text(p_input,'expectedRevision',18) !~ '^[1-9][0-9]{0,17}$'
    OR openerp.commerce_text(p_input,'expectedDigest',71) !~ '^sha256:[a-f0-9]{64}$'
    OR openerp.commerce_text(p_input,'series',16) !~ '^[A-Z0-9]{1,16}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply an exact draft revision/digest and an uppercase voucher series.');
  END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_draft:=openerp.supplier_acceptance_draft(v_book.id,p_input);
  PERFORM openerp.supplier_acceptance_accounts(v_book.id,p_input);
  SELECT count(*)+1 INTO v_ordinal FROM openerp.supplier_acceptance_reviews r WHERE r.book_id=v_book.id AND r.draft_id=p_input->>'draftId';
  IF v_ordinal>50 THEN PERFORM openerp.fail('InvalidJournal','This draft reached its 50-review bound. No partial history or new review is admitted.'); END IF;
  v_evidence:=openerp.commerce_evidence(v_book.id,v_draft->'content'->>'sourceEvidenceId');
  IF EXISTS(SELECT FROM openerp.vouchers v JOIN openerp.events e ON e.book_id=v.book_id AND e.id=v.event_id
    WHERE v.book_id=v_book.id AND (e.evidence_id=v_evidence->>'evidenceId'
      OR EXISTS(SELECT FROM jsonb_array_elements(v.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=v_evidence->>'evidenceId'))) THEN
    PERFORM openerp.fail('AlreadyPosted','This original supplier source has posted history. Synthetic acceptance cannot recognize it again.');
  END IF;
  v_amount:=v_draft->'totals'->>'grossMinor';
  v_posting:=openerp.prepare_journal(p_token,p_scope,'sa_'||v_id||'_prepare',jsonb_build_object(
    'kind','manual_journal','evidenceId',v_evidence->>'evidenceId','eventKey','synthetic_supplier_'||(v_draft->>'id'),
    'accountingPeriodId',p_input->>'accountingPeriodId','postingDate',v_draft->'content'->>'documentDate',
    'series',p_input->>'series','description','Synthetic supplier invoice: '||(v_draft->'content'->>'title'),
    'rationale',p_input->>'reason','taxAssessment','not_applicable','lines',jsonb_build_array(
      jsonb_build_object('accountId',p_input->>'debitAccountId','debitMinor',v_amount,'creditMinor','0','description','Explicit supplier expense'),
      jsonb_build_object('accountId',p_input->>'controlAccountId','debitMinor','0','creditMinor',v_amount,'description','Explicit supplier payable'))));
  v_result:=jsonb_build_object('id',v_id,'scope',jsonb_build_object('entityId',v_book.entity_id,'bookId',v_book.id),
    'version',1,'profile','synthetic-manual-supplier-v1','ordinal',v_ordinal,'input',p_input,
    'draftSnapshot',v_draft,'postingPlan',v_posting,'evidence',v_evidence,
    'legalBlockers',jsonb_build_array('legal_identity_not_verified','tax_profile_not_activated','payment_not_initiated'))
    ||openerp.commerce_record_metadata(p_key,'prepare_supplier_acceptance',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The complete acceptance review exceeds 256 KiB. Nothing was saved.'); END IF;
  INSERT INTO openerp.supplier_acceptance_reviews VALUES(v_book.id,v_id,v_draft->>'id',(v_draft->>'revision')::bigint,v_ordinal,v_posting->>'id',v_posting->'groups'->0->'actions'->0->>'eventId',v_evidence->>'evidenceId',v_result);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'prepare_supplier_acceptance',p_input,v_result);
END $$;

CREATE FUNCTION openerp.supplier_acceptance_blockers(p_book text,p_review jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_message text;
BEGIN
  IF EXISTS(SELECT FROM openerp.supplier_acceptances i WHERE i.book_id=p_book AND i.draft_id=p_review->'input'->>'draftId') THEN
    RETURN '["This draft already has a retained supplier acceptance."]'::jsonb;
  END IF;
  IF EXISTS(SELECT FROM openerp.vouchers v JOIN openerp.events e ON e.book_id=v.book_id AND e.id=v.event_id
    WHERE v.book_id=p_book AND (e.evidence_id=p_review->'evidence'->>'evidenceId'
      OR EXISTS(SELECT FROM jsonb_array_elements(v.action->'evidenceRefs') ref
        WHERE ref->>'evidenceId'=p_review->'evidence'->>'evidenceId'))) THEN
    RETURN '["The original supplier source already has posted history; a second recognition is refused."]'::jsonb;
  END IF;
  BEGIN
    PERFORM openerp.supplier_acceptance_draft(p_book,p_review->'input');
    PERFORM openerp.supplier_acceptance_accounts(p_book,p_review->'input');
    PERFORM openerp.check_dependencies(p_review->'scope',p_review->'postingPlan');
    IF EXISTS(SELECT FROM openerp.execution_receipts e WHERE e.book_id=p_book AND e.change_set_id=p_review->'postingPlan'->>'id') THEN
      RETURN '["The linked posting already executed. A second recognition is refused."]'::jsonb;
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    RETURN jsonb_build_array(v_message);
  END;
  RETURN '[]'::jsonb;
END $$;
CREATE FUNCTION openerp.supplier_acceptance_checked(p_book text,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_review jsonb;
BEGIN
  SELECT r.body INTO v_review FROM openerp.supplier_acceptance_reviews r WHERE r.book_id=p_book AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','This acceptance review was not found in the authorized book.'); END IF;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR openerp.commerce_text(p_input,'digest',71) IS DISTINCT FROM v_review->>'digest'
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM openerp.fail('StaleDependency','Approve or execute the exact reviewed digest and acknowledge its synthetic-only scope.');
  END IF;
  IF openerp.supplier_acceptance_blockers(p_book,v_review)<>'[]'::jsonb THEN
    PERFORM openerp.fail('StaleDependency','Acceptance review dependencies changed or this draft already accepted. Reopen the retained review before taking another action.');
  END IF;
  RETURN v_review;
END $$;
CREATE FUNCTION openerp.approve_supplier_acceptance(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_review jsonb; v_result jsonb; v_ordinal integer;
  v_id text:=openerp.new_id('supplier_approval'); v_expires timestamptz; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'approve_supplier_acceptance',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','acknowledgeSyntheticOnly']);
  v_review:=openerp.supplier_acceptance_checked(p_scope->>'bookId',p_id,p_input);
  SELECT count(*)+1 INTO v_ordinal FROM openerp.supplier_acceptance_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id;
  IF v_ordinal>50 THEN PERFORM openerp.fail('InvalidJournal','This review reached its 50-approval bound. Prepare a new review.'); END IF;
  v_expires:=clock_timestamp()+interval '1 hour';
  v_result:=jsonb_build_object('id',v_id,'scope',v_review->'scope','reviewId',p_id,'digest',v_review->>'digest','version',1,
    'actorId',v_actor,'ordinal',v_ordinal,'expiresAt',to_char(v_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'approve_supplier_acceptance',v_actor);
  INSERT INTO openerp.supplier_acceptance_approvals VALUES(p_scope->>'bookId',v_id,p_id,v_ordinal,v_actor,v_review->>'digest',v_expires,v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'approve_supplier_acceptance',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.execute_supplier_acceptance(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_review jsonb; v_approval openerp.supplier_acceptance_approvals;
  v_kernel_approval jsonb; v_posting jsonb; v_registered jsonb; v_result jsonb; v_draft jsonb;
  v_id text:=openerp.new_id('supplier_acceptance');
  v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'execute_supplier_acceptance',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','digest','approvalId','acknowledgeSyntheticOnly']);
  v_review:=openerp.supplier_acceptance_checked(p_scope->>'bookId',p_id,p_input);
  PERFORM openerp.commerce_text(p_input,'approvalId',128);
  SELECT * INTO v_approval FROM openerp.supplier_acceptance_approvals a
    WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR v_approval.actor_id IS DISTINCT FROM v_actor OR v_approval.digest IS DISTINCT FROM v_review->>'digest'
    OR v_approval.expires_at<=clock_timestamp()
    OR EXISTS(SELECT FROM openerp.supplier_acceptances i WHERE i.book_id=p_scope->>'bookId' AND i.approval_id=v_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','The same current operator must execute their unexpired, unused approval of this exact supplier acceptance and posting.');
  END IF;
  -- Kernel approval is created only inside this transaction, by the still-authorized human.
  v_kernel_approval:=openerp.approve_change(p_token,p_scope,v_review->'postingPlan'->>'id','sa_'||v_approval.id||'_approve',
    jsonb_build_object('version',1,'planDigest',v_review->'postingPlan'->>'planDigest'));
  v_posting:=openerp.execute_change(p_token,p_scope,v_review->'postingPlan'->>'id','sa_'||v_approval.id||'_post',
    jsonb_build_object('version',1,'planDigest',v_review->'postingPlan'->>'planDigest','approvalId',v_kernel_approval->>'id'));
  v_draft:=v_review->'draftSnapshot';
  v_registered:=openerp.commerce_create_invoice(p_token,p_scope,'sa_'||v_approval.id||'_register',jsonb_build_object(
    'kind','synthetic_invoice_v1','direction','supplier','counterpartyId',v_draft->'content'->>'counterpartyId',
    'counterpartyRevision',v_draft->'content'->>'counterpartyRevision','documentNumber',v_draft->'content'->>'supplierDocumentNumber',
    'issuedOn',v_draft->'content'->>'documentDate','dueOn',v_draft->'content'->>'dueDate',
    'currency',v_draft->'content'->>'currency','amountMinor',v_draft->'totals'->>'grossMinor',
    'controlAccountId',v_review->'input'->>'controlAccountId','recognitionVoucherId',v_posting->>'voucherId',
    'recognitionLineId',v_review->'postingPlan'->'groups'->0->'actions'->0->'lines'->1->>'lineId',
    'evidenceId',v_review->'evidence'->>'evidenceId','description','Synthetic supplier invoice: '||(v_draft->'content'->>'title')));
  v_result:=jsonb_build_object('id',v_id,'scope',v_review->'scope','reviewId',p_id,'reviewDigest',v_review->>'digest',
    'approvalId',v_approval.id,'profile','synthetic-manual-supplier-v1','draftId',v_draft->>'id',
    'draftRevision',v_draft->>'revision','draftDigest',v_draft->>'digest','supplierDocumentNumber',v_draft->'content'->>'supplierDocumentNumber',
    'accepted',true,'recognized',true,'paid',false,'postingReceipt',v_posting,'registerInvoiceId',v_registered->>'id',
    'legalBlockers',v_review->'legalBlockers')||openerp.commerce_record_metadata(p_key,'execute_supplier_acceptance',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.supplier_acceptances VALUES(p_scope->>'bookId',v_id,p_id,v_approval.id,v_draft->>'id',
    (v_draft->>'revision')::bigint,v_posting->>'id',v_registered->>'id',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'execute_supplier_acceptance',v_payload,v_result);
END $$;

CREATE FUNCTION openerp.get_supplier_acceptance_review(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_review jsonb; v_approval jsonb; v_issue jsonb; v_blockers jsonb; v_usable boolean:=false;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT r.body INTO v_review FROM openerp.supplier_acceptance_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','This acceptance review was not found in the authorized book.'); END IF;
  SELECT a.body,(a.actor_id=v_actor AND a.expires_at>clock_timestamp() AND EXISTS(SELECT FROM openerp.memberships m
    WHERE m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator')) INTO v_approval,v_usable
    FROM openerp.supplier_acceptance_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.review_id=p_id ORDER BY a.ordinal DESC LIMIT 1;
  SELECT i.body INTO v_issue FROM openerp.supplier_acceptances i WHERE i.book_id=p_scope->>'bookId' AND i.review_id=p_id;
  v_blockers:=openerp.supplier_acceptance_blockers(p_scope->>'bookId',v_review);
  RETURN jsonb_build_object('plan',v_review,'approval',v_approval,'acceptance',v_issue,'blockers',v_blockers,
    'dependenciesCurrent',v_blockers='[]'::jsonb,'approvalUsable',coalesce(v_usable,false) AND v_issue IS NULL AND v_blockers='[]'::jsonb);
END $$;
CREATE FUNCTION openerp.supplier_acceptance_history(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb; v_count bigint;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  IF NOT EXISTS(SELECT FROM openerp.supplier_invoice_drafts d WHERE d.book_id=p_scope->>'bookId' AND d.id=p_id) THEN
    PERFORM openerp.fail('NotFound','This supplier draft was not found in the authorized book.');
  END IF;
  SELECT count(*) INTO v_count FROM openerp.supplier_acceptance_reviews r WHERE r.book_id=p_scope->>'bookId' AND r.draft_id=p_id;
  IF v_count>50 THEN PERFORM openerp.fail('InvalidJournal','Acceptance history exceeds its complete-list bound. No partial history is returned.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'ordinal',r.ordinal,'draftRevision',r.draft_revision::text,
    'digest',r.body->>'digest','createdAt',r.body->>'createdAt','acceptanceId',i.id,'supplierDocumentNumber',i.body->>'supplierDocumentNumber') ORDER BY r.ordinal),'[]')
    INTO v_items FROM openerp.supplier_acceptance_reviews r LEFT JOIN openerp.supplier_acceptances i ON i.book_id=r.book_id AND i.review_id=r.id
    WHERE r.book_id=p_scope->>'bookId' AND r.draft_id=p_id;
  IF jsonb_array_length(v_items)<>v_count THEN PERFORM openerp.fail('InvalidJournal','Acceptance history is incomplete.'); END IF;
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',p_scope->>'entityId','bookId',p_scope->>'bookId'),
    'draftId',p_id,'complete',true,'count',v_count,'items',v_items);
END $$;

REVOKE ALL ON openerp.supplier_acceptance_reviews,openerp.supplier_acceptance_approvals,openerp.supplier_acceptances FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.supplier_acceptance_guard_draft(),openerp.supplier_acceptance_require_aggregate(),
  openerp.supplier_acceptance_draft(text,jsonb),openerp.supplier_acceptance_accounts(text,jsonb),openerp.supplier_acceptance_blockers(text,jsonb),openerp.supplier_acceptance_checked(text,text,jsonb),
  openerp.prepare_supplier_acceptance(text,jsonb,text,jsonb),openerp.approve_supplier_acceptance(text,jsonb,text,text,jsonb),
  openerp.execute_supplier_acceptance(text,jsonb,text,text,jsonb),openerp.get_supplier_acceptance_review(text,jsonb,text),openerp.supplier_acceptance_history(text,jsonb,text)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_supplier_acceptance(text,jsonb,text,jsonb),openerp.approve_supplier_acceptance(text,jsonb,text,text,jsonb),
  openerp.execute_supplier_acceptance(text,jsonb,text,text,jsonb),openerp.get_supplier_acceptance_review(text,jsonb,text),openerp.supplier_acceptance_history(text,jsonb,text)
  TO openerp_runtime;
