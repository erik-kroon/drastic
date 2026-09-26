-- Clean database baseline: the integrity layer.
--
-- Keep the complete helper closure of table constraints and triggers, plus the two
-- pure canonicalization helpers the application calls. Feature entrypoints have no
-- SQL dispatcher or runtime execution grant. Some retained guards enforce policy;
-- their application-boundary review remains tracked in ADR 0010.

-- Trigger entrypoints that call private helpers run as the migration owner. Their
-- fixed search path puts temporary objects last; the runtime has no EXECUTE grant
-- on these entrypoints or their helpers.

-- The canonicalization helpers. openerp.digest is also what the table check
-- constraints below are validated against, and canonical is what digest calls.
CREATE FUNCTION openerp.canonical(value jsonb) RETURNS text
  SECURITY INVOKER
  LANGUAGE plpgsql
  IMMUTABLE
  STRICT
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE result text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || openerp.canonical(val), ',' ORDER BY key COLLATE "C"), '') || '}'
        INTO result FROM jsonb_each(value) item(key, val);
    WHEN 'array' THEN
      SELECT '[' || coalesce(string_agg(openerp.canonical(val), ',' ORDER BY ordinal), '') || ']'
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY item(val, ordinal);
    ELSE result := value::text;
  END CASE;
  RETURN result;
END $$;
CREATE FUNCTION openerp.digest(value jsonb) RETURNS text
  SECURITY INVOKER
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

  SELECT 'sha256:' || encode(sha256(convert_to(openerp.canonical(value), 'UTF8')), 'hex')
$$;

-- The digest-backed check constraints. They are added here rather than in the table
-- definitions in 0001-schema.sql because a check expression is validated where it is
-- created, and openerp.digest does not exist until this file has run.
ALTER TABLE openerp.accountant_review_packs
  ADD CONSTRAINT accountant_review_packs_body_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_accounting_profiles
  ADD CONSTRAINT ar_legal_accounting_profiles_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_delivery_approvals
  ADD CONSTRAINT ar_legal_delivery_approvals_check CHECK (body ->> 'id'::text = id AND body ->> 'requestId'::text = request_id AND body ->> 'actorId'::text = actor_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_delivery_attempts
  ADD CONSTRAINT ar_legal_delivery_attempts_check CHECK (body ->> 'id'::text = id AND body ->> 'requestId'::text = request_id AND body ->> 'approvalId'::text = approval_id AND (body ->> 'ordinal'::text)::integer = ordinal AND body ->> 'status'::text = 'provider_unknown'::text AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_delivery_reconciliations
  ADD CONSTRAINT ar_legal_delivery_reconciliations_check CHECK (body ->> 'id'::text = id AND body ->> 'attemptId'::text = attempt_id AND body ->> 'outcome'::text = ANY (ARRAY['provider_accepted'::text, 'provider_rejected'::text, 'confirmed_not_sent'::text]) AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_delivery_requests
  ADD CONSTRAINT ar_legal_delivery_requests_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body -> 'input'::text ->> 'pdfCaptureId'::text = capture_id AND body -> 'input'::text ->> 'channel'::text = channel AND body ->> 'createdBy'::text = created_by AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_issue_reviews
  ADD CONSTRAINT ar_legal_issue_reviews_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_issues
  ADD CONSTRAINT ar_legal_issues_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'legalDocumentNumber'::text = legal_number AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_pdf_captures
  ADD CONSTRAINT ar_legal_pdf_captures_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'issueId'::text = issue_id AND body ->> 'sourceDigest'::text = openerp.digest(body -> 'source'::text) AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.ar_legal_policies
  ADD CONSTRAINT ar_legal_policies_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'activatedBy'::text = activated_by AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.commerce_fx_items
  ADD CONSTRAINT commerce_fx_items_check CHECK (original_currency ~ '^[A-Z]{3}$'::text AND (original_scale >= 0 AND original_scale <= 6) AND original_minor::numeric > 0::numeric AND book_currency ~ '^[A-Z]{3}$'::text AND (book_scale >= 0 AND book_scale <= 6) AND carrying_minor::numeric > 0::numeric AND original_currency <> book_currency AND rate_digest ~ '^sha256:[a-f0-9]{64}$'::text AND body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body -> 'source'::text ->> 'sourceKey'::text = source_key AND body -> 'source'::text ->> 'sourceRevision'::text = source_revision AND body -> 'original'::text ->> 'currency'::text = original_currency AND body -> 'original'::text ->> 'scale'::text = original_scale::text AND body -> 'original'::text ->> 'minor'::text = original_minor::text AND body -> 'book'::text ->> 'currency'::text = book_currency AND body -> 'book'::text ->> 'scale'::text = book_scale::text AND body -> 'book'::text ->> 'carryingMinor'::text = carrying_minor::text AND body -> 'rate'::text ->> 'digest'::text = rate_digest AND body -> 'recognition'::text ->> 'eventId'::text = event_id AND body -> 'recognition'::text ->> 'voucherId'::text = voucher_id AND body -> 'recognition'::text ->> 'lineId'::text = line_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.commerce_fx_recognition_reviews
  ADD CONSTRAINT commerce_fx_recognition_reviews_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'itemId'::text = item_id AND body ->> 'createdBy'::text = actor_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.commerce_fx_settlement_correction_reviews
  ADD CONSTRAINT commerce_fx_settlement_correction_reviews_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'settlementId'::text = settlement_id AND body ->> 'createdBy'::text = actor_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.commerce_fx_settlement_corrections
  ADD CONSTRAINT commerce_fx_settlement_corrections_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'itemId'::text = item_id AND body ->> 'settlementId'::text = settlement_id AND body ->> 'reviewId'::text = review_id AND body ->> 'approvalId'::text = approval_id AND body ->> 'originalVoucherId'::text = original_voucher_id AND body -> 'postingReceipt'::text ->> 'id'::text = posting_receipt_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.commerce_fx_settlement_reviews
  ADD CONSTRAINT commerce_fx_settlement_reviews_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'itemId'::text = item_id AND body ->> 'createdBy'::text = actor_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.commerce_fx_settlements
  ADD CONSTRAINT commerce_fx_settlements_body_check CHECK ((body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'itemId'::text = item_id AND body ->> 'reviewId'::text = review_id AND body ->> 'approvalId'::text = approval_id AND body -> 'postingReceipt'::text ->> 'id'::text = posting_receipt_id AND body -> 'postingReceipt'::text ->> 'voucherId'::text = voucher_id AND (profile = 'synthetic_full_book_currency_settlement_v1'::text AND body ->> 'originalReleasedMinor'::text = original_released_minor::text AND body ->> 'carryingReleasedMinor'::text = carrying_released_minor::text AND body ->> 'considerationMinor'::text = consideration_minor::text AND body ->> 'realizedGainMinor'::text = realized_gain_minor::text OR profile = 'synthetic_partial_book_currency_settlement_v1'::text) AND original_released_minor::numeric > 0::numeric AND consideration_minor::numeric > 0::numeric AND realized_gain_minor = consideration_minor::numeric - carrying_released_minor::numeric AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text)) IS TRUE);
ALTER TABLE openerp.correction_bundles
  ADD CONSTRAINT correction_bundles_check1 CHECK (digest = openerp.digest(body - 'bundleDigest'::text) AND body ->> 'bundleDigest'::text = digest);
ALTER TABLE openerp.exchange_rate_withdrawals
  ADD CONSTRAINT exchange_rate_withdrawals_body_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.expense_tax_source_withdrawals
  ADD CONSTRAINT expense_tax_source_withdrawals_body_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_cancellation_reviews
  ADD CONSTRAINT invoice_cancellation_reviews_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_cancellations
  ADD CONSTRAINT invoice_cancellations_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_delivery_approvals
  ADD CONSTRAINT invoice_delivery_approvals_check CHECK (body ->> 'id'::text = id AND body ->> 'requestId'::text = request_id AND body ->> 'createdBy'::text = actor_id AND body -> 'sendAuthorized'::text = 'false'::jsonb AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_delivery_attempts
  ADD CONSTRAINT invoice_delivery_attempts_check CHECK (body ->> 'id'::text = id AND body ->> 'requestId'::text = request_id AND body ->> 'approvalId'::text = approval_id AND (body ->> 'ordinal'::text)::integer = ordinal AND body ->> 'status'::text = 'simulated_unknown'::text AND body -> 'externalTraffic'::text = 'false'::jsonb AND body -> 'providerRequestId'::text = 'null'::jsonb AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_delivery_requests
  ADD CONSTRAINT invoice_delivery_requests_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'createdBy'::text = actor_id AND body -> 'input'::text ->> 'pdfCaptureId'::text = capture_id AND body -> 'input'::text ->> 'channel'::text = channel AND body -> 'sendAuthorized'::text = 'false'::jsonb AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_delivery_resolutions
  ADD CONSTRAINT invoice_delivery_resolutions_check CHECK (body ->> 'id'::text = id AND body ->> 'attemptId'::text = attempt_id AND body ->> 'outcome'::text = 'simulated_not_sent'::text AND body -> 'externalTraffic'::text = 'false'::jsonb AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_document_captures
  ADD CONSTRAINT invoice_document_captures_body_check1 CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_document_captures
  ADD CONSTRAINT invoice_document_captures_body_check2 CHECK (NOT body ->> 'sourceDigest'::text IS DISTINCT FROM openerp.digest(body -> 'source'::text));
ALTER TABLE openerp.invoice_draft_revisions
  ADD CONSTRAINT invoice_draft_revisions_body_check1 CHECK (body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_issue_reviews
  ADD CONSTRAINT invoice_issue_reviews_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_issues
  ADD CONSTRAINT invoice_issues_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_pdf_captures
  ADD CONSTRAINT invoice_pdf_captures_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body -> 'input'::text ->> 'issueId'::text = issue_id AND body ->> 'createdBy'::text = actor_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text) AND body ->> 'sourceDigest'::text = openerp.digest(body -> 'source'::text));
ALTER TABLE openerp.invoice_policy_candidates
  ADD CONSTRAINT invoice_policy_candidates_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'createdBy'::text = actor_id AND body -> 'input'::text ->> 'profileKey'::text = profile_key AND body ->> 'status'::text = 'unactivated'::text AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.invoice_policy_reviews
  ADD CONSTRAINT invoice_policy_reviews_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'candidateId'::text = candidate_id AND body ->> 'createdBy'::text = actor_id AND body ->> 'status'::text = 'reviewed_unactivated'::text AND body -> 'legalInvoiceEnabled'::text = 'false'::jsonb AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.sales_document_revisions
  ADD CONSTRAINT sales_document_revisions_check CHECK (body ->> 'id'::text = document_id AND body ->> 'revision'::text = revision::text AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.sie_transaction_captures
  ADD CONSTRAINT sie_transaction_captures_body_check1 CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.subledger_disposal_approvals
  ADD CONSTRAINT subledger_disposal_approvals_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.subledger_disposal_reviews
  ADD CONSTRAINT subledger_disposal_reviews_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.subledger_disposals
  ADD CONSTRAINT subledger_disposals_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.subledger_impairment_approvals
  ADD CONSTRAINT subledger_impairment_approvals_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.subledger_impairment_reviews
  ADD CONSTRAINT subledger_impairment_reviews_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body -> 'input'::text ->> 'scheduleId'::text = schedule_id AND body -> 'input'::text ->> 'decisionKey'::text = decision_key AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.subledger_impairments
  ADD CONSTRAINT subledger_impairments_check CHECK (loss_account_id <> accumulated_impairment_account_id AND body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'scheduleId'::text = schedule_id AND body ->> 'reviewId'::text = review_id AND body ->> 'approvalId'::text = approval_id AND body ->> 'decisionKey'::text = decision_key AND body ->> 'scheduleRevision'::text = schedule_revision::text AND body ->> 'postingDate'::text = posting_date::text AND body ->> 'impairmentMinor'::text = impairment_minor::text AND body ->> 'lossAccountId'::text = loss_account_id AND body ->> 'accumulatedImpairmentAccountId'::text = accumulated_impairment_account_id AND body -> 'postingReceipt'::text ->> 'id'::text = posting_receipt_id AND body -> 'postingReceipt'::text ->> 'voucherId'::text = voucher_id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_acceptance_reviews
  ADD CONSTRAINT supplier_acceptance_reviews_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_acceptances
  ADD CONSTRAINT supplier_acceptances_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_credit_reviews
  ADD CONSTRAINT supplier_credit_reviews_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_credits
  ADD CONSTRAINT supplier_credits_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_invoice_draft_revisions
  ADD CONSTRAINT supplier_invoice_draft_revisions_body_check1 CHECK (body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_payee_proposals
  ADD CONSTRAINT supplier_payee_proposals_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_payee_verifications
  ADD CONSTRAINT supplier_payee_verifications_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_payment_batch_exports
  ADD CONSTRAINT supplier_payment_batch_exports_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_payment_batch_previews
  ADD CONSTRAINT supplier_payment_batch_previews_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.supplier_payment_outcomes
  ADD CONSTRAINT supplier_payment_outcomes_check CHECK (body ->> 'id'::text = id AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.vat_control_profiles
  ADD CONSTRAINT vat_control_profiles_body_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.vat_control_reclassification_approvals
  ADD CONSTRAINT vat_control_reclassification_approvals_body_check1 CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.vat_control_reclassification_effects
  ADD CONSTRAINT vat_control_reclassification_effects_body_check1 CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.vat_control_reclassification_reviews
  ADD CONSTRAINT vat_control_reclassification_reviews_body_check1 CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.vat_fact_withdrawals
  ADD CONSTRAINT vat_fact_withdrawals_body_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));
ALTER TABLE openerp.vat_reporting_obligations
  ADD CONSTRAINT vat_reporting_obligations_body_check CHECK (NOT body ->> 'digest'::text IS DISTINCT FROM openerp.digest(body - 'digest'::text));

-- The integrity helpers the guards call, then the guards themselves. PL/pgSQL resolves
-- nothing in a function body at creation time, so this order is what makes the file
-- readable rather than what makes it load.
CREATE FUNCTION openerp.ar_legal_freeze_draft() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF EXISTS(SELECT FROM openerp.ar_legal_issues WHERE book_id=OLD.book_id AND draft_id=OLD.id) THEN
    PERFORM openerp.fail('Forbidden','A legally issued draft cannot be revised. Use a separately reviewed credit/correction workflow.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.ar_legal_freeze_register() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
 IF EXISTS(SELECT FROM openerp.ar_legal_issues WHERE book_id=OLD.book_id AND register_invoice_id=OLD.id) THEN
  PERFORM openerp.fail('Forbidden','Legally issued commercial due terms and recognition are immutable; use an approved correction.'); END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION openerp.ar_legal_guard_source() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.bank_allocated_source(book text, statement text, ordinal integer) RETURNS numeric
  SECURITY INVOKER
  LANGUAGE sql
  STABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

  SELECT coalesce((SELECT o.amount_minor FROM openerp.bank_active_matches m JOIN openerp.bank_observations o
    ON (o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal)
    WHERE m.book_id=bank_allocated_source.book AND m.statement_id=bank_allocated_source.statement AND m.row_ordinal=bank_allocated_source.ordinal),0)
    + coalesce((SELECT sum(a.amount_minor) FROM openerp.bank_active_allocation_legs a
      WHERE a.book_id=bank_allocated_source.book AND a.statement_id=bank_allocated_source.statement AND a.row_ordinal=bank_allocated_source.ordinal),0)
$$;
CREATE FUNCTION openerp.bank_date(value text) RETURNS date
  SECURITY INVOKER
  LANGUAGE plpgsql
  IMMUTABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE result date;
BEGIN
  BEGIN
    result := value::date;
    IF value IS NULL OR value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR to_char(result, 'YYYY-MM-DD') IS DISTINCT FROM value THEN RAISE invalid_datetime_format; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    PERFORM openerp.fail('InvalidJournal', 'Supply a valid date in YYYY-MM-DD format.');
  END;
  RETURN result;
END $$;
CREATE FUNCTION openerp.bank_exact_match_capacity_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books WHERE id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.bank_active_allocation_legs a WHERE a.book_id=NEW.book_id AND
    ((a.statement_id=NEW.statement_id AND a.row_ordinal=NEW.row_ordinal) OR
     (a.voucher_id=NEW.voucher_id AND a.line_id=NEW.line_id))) THEN
    PERFORM openerp.fail('InvalidJournal','Partial bank capacity is already allocated. Use a reviewed allocation plan for the remainder.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.bank_guard_recurring_posting() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF NEW.posting_purpose <> 'adjustment' THEN RETURN NEW; END IF;
  -- The kernel already holds this lock. Keep direct maintenance inserts in the same order.
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS (
    SELECT FROM openerp.recurring_preparations rp JOIN openerp.change_sets cs
      ON (cs.book_id,cs.id)=(rp.book_id,rp.change_set_id)
    WHERE rp.book_id=NEW.book_id
      AND openerp.bank_allocated_source(rp.book_id,rp.statement_id,rp.row_ordinal)<>0
      AND EXISTS (
        SELECT FROM jsonb_array_elements(cs.plan->'groups') AS plan_group(value)
        CROSS JOIN LATERAL jsonb_array_elements(plan_group.value->'actions') AS plan_action(value)
        WHERE plan_action.value->>'kind'='post_voucher' AND plan_action.value->>'eventId'=NEW.event_id
      )
  ) THEN
    PERFORM openerp.fail('StaleDependency','This recurring source already has bank matching allocations. Review the existing posting and match; the full-amount proposal cannot be posted.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.bank_match_open_periods(p_book text, p_legs jsonb) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE br_date date; br_periods jsonb;
BEGIN
  -- Caller holds the book barrier; lock all affected period rows before account rows.
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=p_book AND EXISTS (
    SELECT FROM jsonb_array_elements(p_legs) leg
    JOIN openerp.bank_observations o ON o.book_id=p_book AND o.statement_id=leg->>'statementId' AND o.row_ordinal=(leg->>'rowOrdinal')::integer
    JOIN openerp.vouchers v ON v.book_id=p_book AND v.id=leg->>'voucherId'
    WHERE o.observed_on BETWEEN p.starts_on AND p.ends_on OR v.posting_date BETWEEN p.starts_on AND p.ends_on
  ) ORDER BY p.id FOR SHARE;
  FOR br_date IN
    SELECT o.observed_on FROM jsonb_array_elements(p_legs) leg JOIN openerp.bank_observations o
      ON o.book_id=p_book AND o.statement_id=leg->>'statementId' AND o.row_ordinal=(leg->>'rowOrdinal')::integer
    UNION
    SELECT v.posting_date FROM jsonb_array_elements(p_legs) leg JOIN openerp.vouchers v
      ON v.book_id=p_book AND v.id=leg->>'voucherId'
  LOOP
    IF (SELECT count(*) FROM openerp.periods p WHERE p.book_id=p_book AND br_date BETWEEN p.starts_on AND p.ends_on)<>1 THEN
      PERFORM openerp.fail('UnsupportedProfile','Each matched source and posting date must belong to exactly one period.'); END IF;
    IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=p_book AND br_date BETWEEN p.starts_on AND p.ends_on AND p.locked) THEN
      PERFORM openerp.fail('PeriodLocked','Reopen the affected source and posting periods explicitly before changing bank matching.'); END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text) ORDER BY p.id),'[]') INTO br_periods
    FROM openerp.periods p WHERE p.book_id=p_book AND EXISTS (
      SELECT FROM jsonb_array_elements(p_legs) leg
      JOIN openerp.bank_observations o ON o.book_id=p_book AND o.statement_id=leg->>'statementId' AND o.row_ordinal=(leg->>'rowOrdinal')::integer
      JOIN openerp.vouchers v ON v.book_id=p_book AND v.id=leg->>'voucherId'
      WHERE o.observed_on BETWEEN p.starts_on AND p.ends_on OR v.posting_date BETWEEN p.starts_on AND p.ends_on
    );
  RETURN br_periods;
END $$;
CREATE FUNCTION openerp.bank_matching_admission_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  PERFORM openerp.bank_match_open_periods(NEW.book_id,jsonb_build_array(jsonb_build_object(
    'statementId',NEW.statement_id,'rowOrdinal',NEW.row_ordinal,'voucherId',NEW.voucher_id)));
  IF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=NEW.book_id AND v.id=NEW.voucher_id
    AND (v.posting_purpose='reversal' OR EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=v.book_id AND r.corrects_voucher_id=v.id))) THEN
    PERFORM openerp.fail('StaleDependency','A reversed or reversing voucher cannot acquire bank matching capacity.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.bank_require_profile(book text) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF NOT EXISTS (SELECT FROM openerp.books WHERE id = book AND profile = 'synthetic-core-v1' AND authority = 'native') THEN
    PERFORM openerp.fail('UnsupportedProfile', 'Only native synthetic-core-v1 bank statements are supported.');
  END IF;
END $$;
CREATE FUNCTION openerp.book_versions() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF (NEW.entity_id,NEW.currency,NEW.currency_scale) IS DISTINCT FROM (OLD.entity_id,OLD.currency,OLD.currency_scale) THEN
    PERFORM openerp.fail('Forbidden','Book entity and monetary units are immutable. Create a new book; moving history or currency conversion is not implemented.');
  END IF;
  IF (NEW.profile, NEW.currency, NEW.currency_scale) IS DISTINCT FROM (OLD.profile, OLD.currency, OLD.currency_scale) THEN
    NEW.profile_version := OLD.profile_version + 1;
  END IF;
  IF NEW.authority IS DISTINCT FROM OLD.authority THEN NEW.writer_epoch := OLD.writer_epoch + 1; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.bump_version() RETURNS trigger
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN NEW.version := OLD.version + 1; RETURN NEW; END $$;
CREATE FUNCTION openerp.check_calendar() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE year_start date; year_end date;
BEGIN
  PERFORM 1 FROM openerp.books WHERE id = NEW.book_id FOR UPDATE;
  IF TG_TABLE_NAME = 'fiscal_years' THEN
    IF EXISTS (SELECT FROM openerp.fiscal_years WHERE book_id = NEW.book_id AND id <> NEW.id
      AND daterange(starts_on, ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')) THEN
      PERFORM openerp.fail('InvalidJournal', 'Fiscal years in a book must not overlap.');
    END IF;
  ELSE
    SELECT starts_on, ends_on INTO year_start, year_end FROM openerp.fiscal_years WHERE book_id = NEW.book_id AND id = NEW.fiscal_year_id;
    IF year_start IS NULL OR NEW.starts_on < year_start OR NEW.ends_on > year_end THEN
      PERFORM openerp.fail('InvalidJournal', 'An accounting period must be inside its fiscal year.');
    END IF;
    IF EXISTS (SELECT FROM openerp.periods WHERE book_id = NEW.book_id AND id <> NEW.id
      AND daterange(starts_on, ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')) THEN
      PERFORM openerp.fail('InvalidJournal', 'Accounting periods in a book must not overlap.');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.check_identity_session() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE enabled boolean;
BEGIN
  SELECT a.enabled INTO enabled FROM openerp.identity_admissions a WHERE a.actor_id=NEW.user_id FOR SHARE;
  IF enabled IS FALSE THEN PERFORM openerp.fail('Unauthorized','This identity is disabled.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_assert_allocation(p_book text, p_receipt text) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE v_receipt openerp.commerce_allocation_receipts; v_plan jsonb; v_approval openerp.commerce_allocation_approvals;
  v_expected jsonb; v_actual jsonb;
BEGIN
  SELECT * INTO STRICT v_receipt FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p_book AND r.id=p_receipt;
  SELECT p.body INTO STRICT v_plan FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_book AND p.id=v_receipt.plan_id;
  SELECT * INTO STRICT v_approval FROM openerp.commerce_allocation_approvals a WHERE a.book_id=p_book AND a.id=v_receipt.approval_id;
  SELECT jsonb_agg(jsonb_build_object('invoiceId',l.value->>'invoiceId','amountMinor',l.value->>'amountMinor',
    'voucherId',v_plan->'payment'->>'voucherId','lineId',v_plan->'payment'->>'lineId') ORDER BY l.ordinal)
    INTO v_expected FROM jsonb_array_elements(v_plan->'legs') WITH ORDINALITY l(value,ordinal);
  SELECT jsonb_agg(jsonb_build_object('invoiceId',l.invoice_id,'amountMinor',l.amount_minor::text,
    'voucherId',l.payment_voucher_id,'lineId',l.payment_line_id) ORDER BY l.ordinal)
    INTO v_actual FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt;
  IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_actual OR v_approval.plan_id<>v_receipt.plan_id
    OR v_approval.digest IS DISTINCT FROM v_plan->>'digest' OR v_receipt.body->>'planDigest' IS DISTINCT FROM v_plan->>'digest'
    OR v_receipt.body->>'totalMinor' IS DISTINCT FROM v_plan->>'totalMinor' THEN
    PERFORM openerp.fail('InvalidJournal','Applied allocation legs and receipt must exactly match the approved sealed plan.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book
    AND i.id IN (SELECT l.invoice_id FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt)
    AND (SELECT coalesce(sum(l.amount_minor),0) FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=i.book_id AND l.invoice_id=i.id)>i.amount_minor)
    OR EXISTS(SELECT FROM openerp.journal_lines j WHERE j.book_id=p_book
      AND (j.voucher_id,j.id) IN (SELECT l.payment_voucher_id,l.payment_line_id FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt)
      AND (SELECT coalesce(sum(l.amount_minor),0) FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=j.book_id AND l.payment_voucher_id=j.voucher_id AND l.payment_line_id=j.id)>j.debit_minor+j.credit_minor) THEN
    PERFORM openerp.fail('InvalidJournal','Applied allocations must conserve both invoice and posted payment capacities.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l
    JOIN openerp.commerce_invoices i ON i.book_id=l.book_id AND i.id=l.invoice_id
    JOIN openerp.journal_lines j ON j.book_id=l.book_id AND j.voucher_id=l.payment_voucher_id AND j.id=l.payment_line_id
    JOIN openerp.vouchers payment ON payment.book_id=j.book_id AND payment.id=j.voucher_id
    JOIN openerp.vouchers recognition ON recognition.book_id=i.book_id AND recognition.id=i.recognition_voucher_id
    WHERE l.book_id=p_book AND l.receipt_id=p_receipt AND (j.account_id<>i.control_account_id
      OR (i.direction='customer' AND j.credit_minor=0) OR (i.direction='supplier' AND j.debit_minor=0)
      OR payment.event_id=recognition.event_id OR payment.posting_date<recognition.posting_date
      OR NOT openerp.commerce_voucher_current(p_book,payment.id) OR NOT openerp.commerce_voucher_current(p_book,recognition.id))) THEN
    PERFORM openerp.fail('InvalidJournal','Allocation references must retain distinct current recognition and opposite-side settlement on the same control account.'); END IF;
END $$;
CREATE FUNCTION openerp.commerce_assert_unallocation() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE cr_plan openerp.commerce_allocation_reversal_plans; cr_approval openerp.commerce_allocation_reversal_approvals;
BEGIN
 SELECT * INTO STRICT cr_plan FROM openerp.commerce_allocation_reversal_plans p WHERE p.book_id=NEW.book_id AND p.id=NEW.plan_id;
 SELECT * INTO STRICT cr_approval FROM openerp.commerce_allocation_reversal_approvals a WHERE a.book_id=NEW.book_id AND a.id=NEW.approval_id;
 IF cr_plan.receipt_id<>NEW.receipt_id OR cr_approval.plan_id<>NEW.plan_id
  OR cr_approval.body->>'digest' IS DISTINCT FROM cr_plan.body->>'digest'
  OR NEW.body->>'digest' IS DISTINCT FROM cr_plan.body->>'digest'
  OR NEW.body->'releasedLegs' IS DISTINCT FROM cr_plan.body->'snapshot'->'legs'
  OR NEW.body->>'totalMinor' IS DISTINCT FROM cr_plan.body->'snapshot'->'original'->>'totalMinor' THEN
  PERFORM openerp.fail('InvalidJournal','The unallocation receipt must release the whole exact approved original application.'); END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_check_allocation() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF TG_TABLE_NAME='commerce_allocation_legs' THEN
    PERFORM openerp.commerce_assert_allocation(NEW.book_id,NEW.receipt_id);
  ELSE
    PERFORM openerp.commerce_assert_allocation(NEW.book_id,NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.commerce_exact_object(p_input jsonb, p_keys text[]) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Supply the documented command object.'); END IF;
  IF NOT p_input ?& p_keys OR p_input-p_keys <> '{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Supply exactly the documented command fields.');
  END IF;
END $$;
CREATE FUNCTION openerp.commerce_freeze_identity() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM openerp.fail('Forbidden','Commerce records are retained. Deletion is unsupported.'); END IF;
  IF (to_jsonb(NEW)-'current_revision') IS DISTINCT FROM (to_jsonb(OLD)-'current_revision')
    OR NEW.current_revision <> OLD.current_revision+1 THEN
    PERFORM openerp.fail('Forbidden','Only the next immutable metadata revision may replace the current head.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_fx_correction_effect_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE fx_review jsonb; fx_action jsonb; fx_receipt_id text; fx_settlement_id text; fx_settlement_voucher text;
  fx_settlement_original numeric; fx_settlement_carrying numeric; fx_settlement_digest text;
BEGIN
  SELECT r.body,v.action,x.id,s.id,s.voucher_id,s.original_released_minor,s.carrying_released_minor,s.body->>'digest'
    INTO fx_review,fx_action,fx_receipt_id,fx_settlement_id,fx_settlement_voucher,fx_settlement_original,
      fx_settlement_carrying,fx_settlement_digest
    FROM openerp.commerce_fx_settlement_correction_reviews r
    JOIN openerp.commerce_fx_settlements s ON s.book_id=r.book_id AND s.id=r.settlement_id
    JOIN openerp.commerce_fx_settlement_correction_approvals a ON a.book_id=r.book_id AND a.review_id=r.id AND a.id=NEW.approval_id
    JOIN openerp.execution_receipts x ON x.book_id=r.book_id AND x.id=NEW.posting_receipt_id
    JOIN openerp.vouchers v ON v.book_id=r.book_id AND v.id=x.voucher_id AND v.corrects_voucher_id=NEW.original_voucher_id
    WHERE r.book_id=NEW.book_id AND r.id=NEW.review_id AND r.settlement_id=NEW.settlement_id
      AND s.item_id=NEW.item_id AND a.digest=r.body->>'digest' AND x.approval_id=a.id;
  IF fx_review IS NULL OR fx_receipt_id IS DISTINCT FROM NEW.posting_receipt_id
    OR fx_settlement_voucher IS DISTINCT FROM NEW.original_voucher_id
    OR NEW.body->>'settlementDigest' IS DISTINCT FROM fx_settlement_digest
    OR NEW.body->>'restoredOriginalMinor' IS DISTINCT FROM fx_settlement_original::text
    OR NEW.body->>'restoredCarryingMinor' IS DISTINCT FROM fx_settlement_carrying::text
    OR fx_action->'foreignCurrency'->>'kind' IS DISTINCT FROM 'settlement_correction_v1'
    OR fx_action->'foreignCurrency'->>'itemId' IS DISTINCT FROM NEW.item_id
    OR fx_action->'foreignCurrency'->>'settlementId' IS DISTINCT FROM NEW.settlement_id
    OR fx_action->'foreignCurrency'->>'settlementDigest' IS DISTINCT FROM NEW.body->>'settlementDigest'
    OR fx_action->'foreignCurrency'->>'reviewId' IS DISTINCT FROM NEW.review_id
    OR fx_action->'foreignCurrency'->>'reviewDigest' IS DISTINCT FROM fx_review->>'digest' THEN
    PERFORM openerp.fail('ApprovalRequired','FX correction effect, journal, receipt and approval ownership do not agree.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.item_id=NEW.item_id
      AND s.leg_ordinal>(SELECT leg_ordinal FROM openerp.commerce_fx_settlements WHERE book_id=NEW.book_id AND id=NEW.settlement_id)
      AND NOT EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c
        WHERE c.book_id=s.book_id AND c.settlement_id=s.id)) THEN
    PERFORM openerp.fail('UnsupportedProfile','Only the latest unconsumed settlement leg can be consumed by this correction.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_fx_guard_legacy_capacity() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE fx_voucher text; fx_line text;
BEGIN
  IF TG_TABLE_NAME='commerce_invoices' THEN fx_voucher:=NEW.recognition_voucher_id; fx_line:=NEW.recognition_line_id;
  ELSIF TG_TABLE_NAME='commerce_allocation_legs' THEN fx_voucher:=NEW.payment_voucher_id; fx_line:=NEW.payment_line_id;
  ELSE fx_voucher:=NEW.voucher_id; fx_line:=NEW.line_id; END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.voucher_id=fx_voucher AND i.line_id=fx_line)
    OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.voucher_id=fx_voucher
      AND fx_line IN(s.cash_line_id,s.control_line_id,s.realized_line_id)) THEN
    PERFORM openerp.fail('IdempotencyConflict','This exact line is retained by the commerce FX owner and cannot enter another capacity owner.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_fx_guard_owned_posting() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE fx_meta jsonb:=NEW.action->'foreignCurrency'; fx_plan jsonb; fx_actor text; fx_review jsonb; fx_approval jsonb;
BEGIN
  IF fx_meta IS NOT NULL THEN
    SELECT c.plan,a.actor_id INTO fx_plan,fx_actor FROM openerp.change_sets c JOIN openerp.approvals a
      ON a.book_id=c.book_id AND a.change_set_id=c.id WHERE c.book_id=NEW.book_id AND c.id=NEW.change_set_id
      AND a.digest=c.digest AND a.consumed_at IS NOT NULL;
    IF fx_plan IS NULL OR fx_plan->'groups'->0->'actions'->0 IS DISTINCT FROM NEW.action THEN
      PERFORM openerp.fail('ApprovalRequired','Commerce FX postings require the exact approved kernel action.'); END IF;
    IF fx_meta->>'kind'='recognition_v1' THEN
      SELECT r.body,a.body INTO fx_review,fx_approval FROM openerp.commerce_fx_recognition_reviews r
        JOIN openerp.commerce_fx_recognition_approvals a ON a.book_id=r.book_id AND a.review_id=r.id
        WHERE r.book_id=NEW.book_id AND r.id=fx_meta->>'reviewId' AND a.actor_id=fx_actor AND a.digest=fx_meta->>'reviewDigest';
      IF fx_review IS NULL OR fx_review->>'digest' IS DISTINCT FROM fx_meta->>'reviewDigest'
        OR fx_review->>'itemId' IS DISTINCT FROM fx_meta->>'itemId' OR fx_approval IS NULL
        OR EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.review_id=fx_meta->>'reviewId') THEN
        PERFORM openerp.fail('ApprovalRequired','Recognition is not bound to one current unused custom approval.'); END IF;
    ELSIF fx_meta->>'kind' IN('settlement_v1','partial_settlement_v1') THEN
      SELECT r.body,a.body INTO fx_review,fx_approval FROM openerp.commerce_fx_settlement_reviews r
        JOIN openerp.commerce_fx_settlement_approvals a ON a.book_id=r.book_id AND a.review_id=r.id
        WHERE r.book_id=NEW.book_id AND r.id=fx_meta->>'reviewId' AND a.actor_id=fx_actor AND a.digest=fx_meta->>'reviewDigest';
      IF fx_review IS NULL OR fx_review->>'digest' IS DISTINCT FROM fx_meta->>'reviewDigest'
        OR fx_review->>'itemId' IS DISTINCT FROM fx_meta->>'itemId' OR fx_approval IS NULL
        OR fx_meta->>'settlementDigest' IS DISTINCT FROM openerp.digest(fx_review->'snapshot'->'calculation')
        OR (fx_meta->>'kind'='partial_settlement_v1' AND
          (fx_review->'input'->>'profile'<>'synthetic_partial_book_currency_settlement_v1'
          OR fx_meta->>'legOrdinal' IS DISTINCT FROM fx_review->'snapshot'->'calculation'->>'legOrdinal'))
        OR NOT EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.id=fx_meta->>'itemId')
        OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.review_id=fx_meta->>'reviewId') THEN
        PERFORM openerp.fail('ApprovalRequired','Settlement is not bound to one current unused custom approval.'); END IF;
    ELSIF fx_meta->>'kind'='settlement_correction_v1' THEN
      SELECT r.body,a.body INTO fx_review,fx_approval FROM openerp.commerce_fx_settlement_correction_reviews r
        JOIN openerp.commerce_fx_settlement_correction_approvals a ON a.book_id=r.book_id AND a.review_id=r.id
        WHERE r.book_id=NEW.book_id AND r.id=fx_meta->>'reviewId' AND a.actor_id=fx_actor AND a.digest=fx_meta->>'reviewDigest';
      IF fx_review IS NULL OR fx_review->>'digest' IS DISTINCT FROM fx_meta->>'reviewDigest'
        OR fx_review->>'settlementId' IS DISTINCT FROM fx_meta->>'settlementId' OR fx_approval IS NULL
        OR NOT EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.id=fx_meta->>'settlementId'
          AND s.voucher_id=NEW.corrects_voucher_id AND s.body->>'digest'=fx_meta->>'settlementDigest')
        OR EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=NEW.book_id AND c.review_id=fx_meta->>'reviewId') THEN
        PERFORM openerp.fail('ApprovalRequired','Correction is not bound to one current unused custom approval and settlement digest.'); END IF;
    ELSE
      PERFORM openerp.fail('ApprovalRequired','Unsupported commerce FX posting ownership metadata.'); END IF;
  ELSIF EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.event_id=NEW.event_id)
    OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s JOIN openerp.vouchers v ON v.book_id=s.book_id AND v.id=s.voucher_id
      WHERE s.book_id=NEW.book_id AND v.event_id=NEW.event_id)
    OR (NEW.corrects_voucher_id IS NOT NULL AND (
      EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.voucher_id=NEW.corrects_voucher_id)
      OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.voucher_id=NEW.corrects_voucher_id)
      OR EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c JOIN openerp.execution_receipts x
        ON x.book_id=c.book_id AND x.id=c.posting_receipt_id
        WHERE c.book_id=NEW.book_id AND x.voucher_id=NEW.corrects_voucher_id))) THEN
    PERFORM openerp.fail('ApprovalRequired','FX recognition, settlement and correction vouchers require their commerce FX owner workflow.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_fx_settlement_effect_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE fx_item openerp.commerce_fx_items; fx_review jsonb; fx_action jsonb; fx_receipt_id text;
  fx_ordinal integer; fx_consumed_original numeric; fx_consumed_carrying numeric; fx_before_original numeric;
  fx_before_carrying numeric; fx_n numeric; fx_d numeric; fx_q numeric; fx_r numeric; fx_b numeric;
BEGIN
  SELECT * INTO STRICT fx_item FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.id=NEW.item_id;
  SELECT r.body,v.action,x.id INTO fx_review,fx_action,fx_receipt_id
    FROM openerp.commerce_fx_settlement_reviews r
    JOIN openerp.commerce_fx_settlement_approvals a ON a.book_id=r.book_id AND a.review_id=r.id AND a.id=NEW.approval_id
    JOIN openerp.vouchers v ON v.book_id=r.book_id AND v.id=NEW.voucher_id
    JOIN openerp.execution_receipts x ON x.book_id=r.book_id AND x.id=NEW.posting_receipt_id AND x.voucher_id=v.id
    WHERE r.book_id=NEW.book_id AND r.id=NEW.review_id AND r.item_id=NEW.item_id
      AND a.digest=r.body->>'digest' AND x.approval_id=a.id AND v.event_id=NEW.event_id;
  IF fx_review IS NULL OR fx_receipt_id IS DISTINCT FROM NEW.posting_receipt_id
    OR fx_action->'foreignCurrency'->>'itemId' IS DISTINCT FROM NEW.item_id
    OR fx_action->'foreignCurrency'->>'reviewId' IS DISTINCT FROM NEW.review_id
    OR fx_action->'foreignCurrency'->>'reviewDigest' IS DISTINCT FROM fx_review->>'digest'
    OR fx_action->'foreignCurrency'->>'settlementDigest' IS DISTINCT FROM openerp.digest(fx_review->'snapshot'->'calculation')
    OR fx_action->'foreignCurrency'->>'kind' IS DISTINCT FROM
      (CASE WHEN NEW.profile='synthetic_partial_book_currency_settlement_v1' THEN 'partial_settlement_v1' ELSE 'settlement_v1' END)
    OR (NEW.profile='synthetic_partial_book_currency_settlement_v1' AND
      (fx_review->'input'->>'profile'<>'synthetic_partial_book_currency_settlement_v1'
      OR fx_action->'foreignCurrency'->>'legOrdinal' IS DISTINCT FROM NEW.leg_ordinal::text))
    OR NOT EXISTS(SELECT FROM openerp.journal_lines l WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id
      AND l.id=NEW.cash_line_id AND l.debit_minor=NEW.consideration_minor AND l.credit_minor=0)
    OR (NEW.carrying_released_minor>0 AND NOT EXISTS(SELECT FROM openerp.journal_lines l
      WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.id=NEW.control_line_id
      AND l.debit_minor=0 AND l.credit_minor=NEW.carrying_released_minor))
    OR (NEW.realized_gain_minor>0 AND NOT EXISTS(SELECT FROM openerp.journal_lines l
      WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.id=NEW.realized_line_id
      AND l.debit_minor=0 AND l.credit_minor=NEW.realized_gain_minor))
    OR (NEW.realized_gain_minor<0 AND NOT EXISTS(SELECT FROM openerp.journal_lines l
      WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.id=NEW.realized_line_id
      AND l.debit_minor=abs(NEW.realized_gain_minor) AND l.credit_minor=0)) THEN
    PERFORM openerp.fail('ApprovalRequired','Settlement effect, journal, receipt and approval ownership do not agree.'); END IF;
  IF NEW.profile='synthetic_full_book_currency_settlement_v1' THEN RETURN NEW; END IF;
  SELECT coalesce(max(s.leg_ordinal),0)+1 INTO fx_ordinal
    FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.item_id=NEW.item_id
      AND s.leg_ordinal < NEW.leg_ordinal;
  SELECT coalesce(sum(s.original_released_minor) FILTER(WHERE c.id IS NULL),0),
    coalesce(sum(s.carrying_released_minor) FILTER(WHERE c.id IS NULL),0)
    INTO fx_consumed_original,fx_consumed_carrying
    FROM openerp.commerce_fx_settlements s
    LEFT JOIN openerp.commerce_fx_settlement_corrections c ON c.book_id=s.book_id AND c.settlement_id=s.id
    WHERE s.book_id=NEW.book_id AND s.item_id=NEW.item_id AND s.leg_ordinal<NEW.leg_ordinal;
  fx_before_original:=fx_item.original_minor-fx_consumed_original;
  fx_before_carrying:=fx_item.carrying_minor-fx_consumed_carrying;
  IF NEW.leg_ordinal IS DISTINCT FROM fx_ordinal OR fx_before_original<=0 OR fx_before_carrying<0
    OR NEW.original_remaining_before_minor IS DISTINCT FROM fx_before_original
    OR NEW.carrying_remaining_before_minor IS DISTINCT FROM fx_before_carrying THEN
    PERFORM openerp.fail('StaleDependency','Partial settlement does not consume the latest exact paired capacity.'); END IF;
  fx_n:=fx_before_carrying*NEW.original_released_minor; fx_d:=fx_before_original;
  fx_q:=div(fx_n,fx_d); fx_r:=mod(fx_n,fx_d); fx_b:=fx_q+CASE WHEN 2*fx_r>=fx_d THEN 1 ELSE 0 END;
  IF NEW.carrying_released_minor IS DISTINCT FROM fx_b
    OR NEW.original_remaining_after_minor IS DISTINCT FROM fx_before_original-NEW.original_released_minor
    OR NEW.carrying_remaining_after_minor IS DISTINCT FROM fx_before_carrying-fx_b THEN
    PERFORM openerp.fail('StaleDependency','Partial settlement carrying release or residual is not the exact paired half-up result.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_fx_voucher_effect_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE fx_meta jsonb:=NEW.action->'foreignCurrency';
BEGIN
  IF fx_meta->>'kind'='recognition_v1' AND NOT EXISTS(
    SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=NEW.book_id AND i.review_id=fx_meta->>'reviewId'
      AND i.voucher_id=NEW.id AND i.event_id=NEW.event_id
      AND i.posting_receipt_id IN(SELECT x.id FROM openerp.execution_receipts x WHERE x.book_id=NEW.book_id AND x.voucher_id=NEW.id))
  THEN PERFORM openerp.fail('ApprovalRequired','FX recognition voucher requires its complete owned item and receipt.'); END IF;
  IF fx_meta->>'kind' IN('settlement_v1','partial_settlement_v1') AND NOT EXISTS(
    SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=NEW.book_id AND s.review_id=fx_meta->>'reviewId'
      AND s.voucher_id=NEW.id AND s.event_id=NEW.event_id
      AND s.posting_receipt_id IN(SELECT x.id FROM openerp.execution_receipts x WHERE x.book_id=NEW.book_id AND x.voucher_id=NEW.id))
  THEN PERFORM openerp.fail('ApprovalRequired','FX settlement voucher requires its complete owned leg and receipt.'); END IF;
  IF fx_meta->>'kind'='settlement_correction_v1' AND NOT EXISTS(
    SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=NEW.book_id AND c.review_id=fx_meta->>'reviewId'
      AND c.item_id=fx_meta->>'itemId' AND c.settlement_id=fx_meta->>'settlementId'
      AND c.posting_receipt_id IN(SELECT x.id FROM openerp.execution_receipts x WHERE x.book_id=NEW.book_id AND x.voucher_id=NEW.id))
  THEN PERFORM openerp.fail('ApprovalRequired','FX correction voucher requires its complete owned correction and receipt.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_guard_bank_source() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=NEW.book_id AND c.account_id=NEW.account_id) THEN
    PERFORM openerp.fail('InvalidJournal','A commerce control account cannot be registered as a bank source.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_guard_control_account() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=NEW.book_id AND s.account_id=NEW.account_id) THEN
    PERFORM openerp.fail('InvalidJournal','A bank source cannot be registered as a commerce control account.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_guard_voucher_reversal() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    IF openerp.invoice_cancellation_admits(NEW.book_id,NEW.change_set_id,NEW.corrects_voucher_id,NEW.action) THEN RETURN NEW; END IF;
    IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=NEW.book_id AND i.recognition_voucher_id=NEW.corrects_voucher_id)
      OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=NEW.book_id AND l.payment_voucher_id=NEW.corrects_voucher_id) THEN
      PERFORM openerp.fail('StaleDependency','The voucher retains invoice recognition or active payment allocations. Unallocate active payments first; invoice recognition correction remains unsupported.');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.commerce_require_profile(p_book text) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF NOT EXISTS (SELECT FROM openerp.books b WHERE b.id=p_book AND b.profile='synthetic-core-v1' AND b.authority='native') THEN
    PERFORM openerp.fail('UnsupportedProfile','Commerce supports only native synthetic-core-v1.');
  END IF;
END $$;
CREATE FUNCTION openerp.commerce_voucher_current(p_book text, p_voucher text) RETURNS boolean
  SECURITY INVOKER
  LANGUAGE sql
  STABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

  SELECT EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher
    AND v.corrects_voucher_id IS NULL AND v.posting_purpose<>'reversal'
    AND NOT EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=v.book_id AND r.corrects_voucher_id=v.id))
$$;
CREATE FUNCTION openerp.correction_impact_resources(p_book text, p_voucher text, p_date date) RETURNS jsonb
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE c_base jsonb; c_impairment jsonb;
BEGIN
  c_base:=openerp.correction_impact_resources_before_impairment(p_book,p_voucher,p_date);
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','schedule','id',x.schedule_id,
    'detail','Asset impairment history for schedule '||x.schedule_id||' consumes this voucher. Generic correction is blocked; a complete owned correction is not implemented.',
    'path','/schedules/'||x.schedule_id,'blocks',true,
    'dependencyDigest',openerp.digest((SELECT jsonb_agg(i.body->>'digest' ORDER BY i.ordinal)
      FROM openerp.subledger_impairments i WHERE i.book_id=p_book AND i.schedule_id=x.schedule_id)))
    ORDER BY x.schedule_id COLLATE "C"),'[]') INTO c_impairment
    FROM openerp.subledger_impairment_schedule_for_voucher(p_book,p_voucher) x;
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind' COLLATE "C",resource->>'id' COLLATE "C",
    resource->>'detail' COLLATE "C"),'[]') INTO c_base
    FROM jsonb_array_elements(c_base||c_impairment) item(resource);
  IF jsonb_array_length(c_base)>1000 THEN
    PERFORM openerp.fail('UnsupportedProfile','This impact exceeds1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN c_base;
END $$;
CREATE FUNCTION openerp.correction_impact_resources_before_impairment(p_book text, p_voucher text, p_date date) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE ci_resources jsonb; ci_tax_resources jsonb; ci_disposal_resources jsonb; ci_vat_resources jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.id,'detail',r.detail,'path',r.path,'blocks',r.blocks)
      ORDER BY r.kind COLLATE "C",r.id COLLATE "C",r.detail COLLATE "C"),'[]') INTO ci_resources FROM (
    SELECT 'bank_match' kind,m.statement_id id,'Retained bank match: row '||m.row_ordinal::text||', line '||m.line_id||'. Unmatch this active relationship before correcting the voucher.' detail,
      '/bank-statements/'||m.statement_id path,true blocks FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',a.plan_id,'Applied bank allocation: row '||a.row_ordinal::text||', line '||a.line_id||'. Unmatch this active allocation before correcting the voucher.',
      '/bank-allocation-plans/'||a.plan_id,true FROM openerp.bank_active_allocation_legs a WHERE a.book_id=p_book AND a.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',p.id,'Unexecuted bank allocation plan references this voucher. It must revalidate after any correction.',
      '/bank-allocation-plans/'||p.id,false FROM openerp.bank_allocation_plans p WHERE p.book_id=p_book
      AND NOT EXISTS(SELECT FROM openerp.bank_allocation_executions e WHERE e.book_id=p.book_id AND e.plan_id=p.id)
      AND EXISTS(SELECT FROM jsonb_array_elements(p.input->'legs') item(leg) WHERE leg->>'voucherId'=p_voucher)
    UNION ALL SELECT 'invoice',i.id,'Registered invoice recognition, line '||i.recognition_line_id||'. Use the commerce owner; generic release is unavailable.',
      '/commerce/invoices/'||i.id,true FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',a.receipt_id,'Applied invoice payment, invoice '||a.invoice_id||', line '||a.payment_line_id||'. Unallocate this active whole application before correcting the payment voucher.',
      '/commerce/invoices/'||a.invoice_id,true FROM openerp.commerce_active_allocation_legs a WHERE a.book_id=p_book AND a.payment_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',p.id,'Unapplied commerce payment plan references this voucher. Its owner must revalidate the plan; this review does not release capacity.',
      '/commerce/allocation-plans/'||p.id,false FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_book
      AND p.body->'payment'->>'voucherId'=p_voucher
      AND NOT EXISTS(SELECT FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p.book_id AND r.plan_id=p.id)
    UNION ALL SELECT DISTINCT 'schedule',s.schedule_id,'Represented schedule occurrence '||s.ordinal::text||'. Posted-occurrence compensation is unavailable.',
      '/schedules/'||s.schedule_id,true FROM openerp.subledger_preparations s JOIN openerp.change_sets c ON c.book_id=s.book_id AND c.id=s.change_set_id
      JOIN openerp.vouchers v ON v.book_id=s.book_id AND v.id=p_voucher
      WHERE s.book_id=p_book AND (s.change_set_id=v.change_set_id OR c.plan->'groups'->0->'actions'->0->>'eventId'=v.event_id)
    UNION ALL SELECT 'report',r.id,'Retained report covers the correction date. Its original bytes stay unchanged; prepare a new snapshot after posting.',
      '/report-snapshots/'||r.id,false FROM openerp.report_snapshots r WHERE r.book_id=p_book AND p_date BETWEEN r.starts_on AND r.ends_on
    UNION ALL SELECT 'closing',c.id,'Technical certificate depends on the ledger sequence. A new posting makes its basis stale; no automatic reopen or statutory finding.',
      '/closing-certificates/'||c.id,false FROM openerp.closing_certificates c WHERE c.book_id=p_book AND p_date IS NOT NULL
  ) r;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'kind','tax_account_match','id',m.id,
    'detail','Retained tax-account match '||m.id||': event '||c.event_id||', voucher '||c.voucher_id||', line '||c.line_id||'. Explicitly unmatch this reserved relation before correcting the voucher.',
    'path','/tax-account/matches/'||m.id,'blocks',true,
    'taxAccountMatch',jsonb_build_object('statementId',m.body->'basis'->'statementId',
      'statementDigest',m.body->'basis'->'selection'->>'statementDigest','eventId',c.event_id,
      'voucherId',c.voucher_id,'lineId',c.line_id,'matchDigest',m.body->>'digest',
      'usable',coalesce((effective.state->>'usable')::boolean,false)),
    'dependencyDigest',openerp.digest(jsonb_build_object('matchDigest',m.body->>'digest','capacity',to_jsonb(c),
      'active',effective.state->'active','usable',effective.state->'usable')))
    ORDER BY m.id COLLATE "C"),'[]') INTO ci_tax_resources
    FROM openerp.tax_account_match_capacity c
    JOIN openerp.tax_account_matches m ON m.book_id=c.book_id AND m.id=c.match_id
    CROSS JOIN LATERAL(SELECT openerp.tax_account_match_view(m.book_id,m.id) AS state) effective
    WHERE c.book_id=p_book AND c.voucher_id=p_voucher;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','schedule','id',d.schedule_id,
    'detail','Terminal synthetic disposal '||d.id||' owns this '||
      CASE WHEN e.voucher_id=p_voucher THEN 'disposal' ELSE 'acquisition/imported-basis' END||
      ' voucher. Disposal-aware correction and reopening are unavailable; generic correction is blocked.',
    'path','/schedules/'||d.schedule_id,'blocks',true,'dependencyDigest',d.body->>'digest')
    ORDER BY d.schedule_id COLLATE "C"),'[]') INTO ci_disposal_resources
    FROM openerp.subledger_disposals d
    JOIN openerp.subledger_disposal_reviews r ON r.book_id=d.book_id AND r.id=d.review_id
    JOIN openerp.execution_receipts e ON e.book_id=d.book_id AND e.id=d.posting_receipt_id
    WHERE d.book_id=p_book AND (e.voucher_id=p_voucher OR r.body->'basis'->'carryingBasis'->'input'->>'voucherId'=p_voucher);
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind' COLLATE "C",resource->>'id' COLLATE "C",resource->>'detail' COLLATE "C"),'[]') INTO ci_vat_resources
    FROM (
      SELECT jsonb_build_object('kind','vat_control_reclassification','id',e.id,
        'detail','VAT control reclassification '||e.id||' '||
          CASE WHEN e.voucher_id=p_voucher THEN 'owns this reclassification voucher.'
            ELSE 'owns exact source voucher '||p_voucher||' through its retained contribution lineage.' END||
          ' Generic correction is blocked; the VAT owner has no correction workflow in this version.',
        'path','/vat-returns/reclassifications/'||e.review_id,'blocks',true,
        'dependencyDigest',openerp.digest(jsonb_build_object('effectDigest',e.body->>'digest','reviewDigest',e.body->>'reviewDigest',
          'contributionCount',(SELECT count(*) FROM openerp.vat_control_reclassification_contributions c
            WHERE c.book_id=e.book_id AND c.effect_id=e.id)))) resource
      FROM openerp.vat_control_reclassification_effects e
      WHERE e.book_id=p_book AND (e.voucher_id=p_voucher OR EXISTS(SELECT FROM openerp.vat_control_reclassification_contributions c
        WHERE c.book_id=e.book_id AND c.effect_id=e.id AND c.voucher_id=p_voucher))
    ) vat;
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind' COLLATE "C",resource->>'id' COLLATE "C",resource->>'detail' COLLATE "C"),'[]') INTO ci_resources
    FROM jsonb_array_elements(ci_resources||openerp.correction_owner_impact_resources(p_book,p_voucher)||ci_tax_resources||ci_disposal_resources||ci_vat_resources) item(resource);
  IF jsonb_array_length(ci_resources)>1000 THEN PERFORM openerp.fail('UnsupportedProfile','This impact exceeds 1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN ci_resources;
END $$;
CREATE FUNCTION openerp.correction_owner_impact_resources(p_book text, p_voucher text) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE ci_resources jsonb;
BEGIN
  WITH affected_records AS (
    -- A newly registered source is a blocker before any posted-effect capture.
    SELECT r.id FROM openerp.owner_records r JOIN openerp.events source_event
      ON source_event.book_id=r.book_id AND source_event.evidence_id=r.evidence_id AND source_event.event_key=r.locator
      JOIN openerp.vouchers posted_voucher ON posted_voucher.book_id=source_event.book_id AND posted_voucher.event_id=source_event.id
      WHERE r.book_id=p_book AND posted_voucher.id=p_voucher
    UNION
    SELECT posted_effect.record_id FROM openerp.owner_effects posted_effect
      WHERE posted_effect.book_id=p_book AND posted_effect.voucher_id=p_voucher
    UNION
    -- A posted, attached proposal remains provenance even before effect capture.
    SELECT proposal_link.record_id FROM openerp.owner_proposal_links proposal_link JOIN openerp.vouchers posted_voucher
      ON posted_voucher.book_id=proposal_link.book_id AND posted_voucher.change_set_id=proposal_link.change_set_id
      WHERE proposal_link.book_id=p_book AND posted_voucher.id=p_voucher
  ), dependencies AS (
    SELECT source_record.id,openerp.digest(jsonb_build_object(
      'source',to_jsonb(source_record),
      'currentRevision',(SELECT to_jsonb(record_revision) FROM openerp.owner_revisions record_revision
        WHERE record_revision.book_id=p_book AND record_revision.record_id=source_record.id AND record_revision.revision=source_record.current_revision),
      'currentReview',(SELECT to_jsonb(record_review) FROM openerp.owner_reviews record_review
        WHERE record_review.book_id=p_book AND record_review.record_id=source_record.id AND record_review.revision=source_record.current_revision),
      'proposalLinks',(SELECT coalesce(jsonb_agg(to_jsonb(proposal_link) ORDER BY proposal_link.id COLLATE "C"),'[]')
        FROM openerp.owner_proposal_links proposal_link WHERE proposal_link.book_id=p_book AND proposal_link.record_id=source_record.id),
      'effects',(SELECT coalesce(jsonb_agg(to_jsonb(posted_effect) ORDER BY posted_effect.id COLLATE "C"),'[]')
        FROM openerp.owner_effects posted_effect WHERE posted_effect.book_id=p_book AND posted_effect.record_id=source_record.id),
      'allocationLegs',(SELECT coalesce(jsonb_agg(to_jsonb(allocation_leg) ORDER BY allocation_leg.receipt_id COLLATE "C",allocation_leg.ordinal),'[]')
        FROM openerp.owner_allocation_legs allocation_leg WHERE allocation_leg.book_id=p_book AND EXISTS(
          SELECT FROM openerp.owner_effects posted_effect WHERE posted_effect.book_id=p_book AND posted_effect.record_id=source_record.id
            AND posted_effect.id IN(allocation_leg.claim_id,allocation_leg.settlement_id)))
    )) digest
    FROM openerp.owner_records source_record JOIN affected_records affected_record ON affected_record.id=source_record.id WHERE source_record.book_id=p_book
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('kind','owner_record','id',impact_dependency.id,
    'detail','A registered owner source, posted effect or posted proposal is linked to this voucher. Owner-register correction/release is unavailable; generic correction is blocked.',
    'path','/owner-register/records/'||impact_dependency.id,'blocks',true,'dependencyDigest',impact_dependency.digest)
    ORDER BY impact_dependency.id COLLATE "C"),'[]') INTO ci_resources FROM dependencies impact_dependency;
  RETURN ci_resources;
END $$;
CREATE FUNCTION openerp.correction_require_unbound(p_book text, p_voucher text) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE ci_resource jsonb;
BEGIN
  FOR ci_resource IN SELECT value FROM jsonb_array_elements(openerp.correction_impact_resources(p_book,p_voucher,NULL)) LOOP
    IF ci_resource->>'blocks'='true' THEN
      PERFORM openerp.fail('UnsupportedProfile',ci_resource->>'detail'); END IF;
  END LOOP;
END $$;
CREATE FUNCTION openerp.correction_unsupported_reversal_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    IF openerp.invoice_cancellation_admits(NEW.book_id,NEW.change_set_id,NEW.corrects_voucher_id,NEW.action) THEN RETURN NEW; END IF;
    PERFORM openerp.correction_require_unbound(NEW.book_id,NEW.corrects_voucher_id);
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.dimension_identity_guard() RETURNS trigger
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
AS $$

BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Dimension catalogue entries cannot be deleted'; END IF;
 IF (OLD.book_id, OLD.code) IS DISTINCT FROM (NEW.book_id, NEW.code) THEN
  RAISE EXCEPTION 'Dimension identity cannot be changed';
 END IF;
 IF TG_TABLE_NAME = 'dimension_values' THEN
  IF OLD.dimension_code IS DISTINCT FROM NEW.dimension_code THEN
   RAISE EXCEPTION 'Dimension identity cannot be changed';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION openerp.expense_tax_shape(value jsonb, fields text[]) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Supply an expense tax object with explicit unknown values.'); END IF;
  IF value-fields<>'{}'::jsonb OR NOT value ?& fields THEN
    PERFORM openerp.fail('InvalidJournal','Unknown fields are refused. Use explicit null values for unknown expense tax facts.'); END IF;
END $$;
CREATE FUNCTION openerp.expense_tax_source_admission() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=NEW.book_id AND w.source_id=NEW.source_id) THEN
    PERFORM openerp.fail('StaleDependency','This expense source identity is permanently withdrawn. New revisions, reviews and reactivation are refused.'); END IF;
  IF TG_TABLE_NAME='expense_tax_source_revisions' AND EXISTS(
    SELECT FROM openerp.expense_tax_sources s
    JOIN LATERAL(SELECT r.body FROM openerp.expense_tax_source_revisions r WHERE r.book_id=s.book_id AND r.source_id=s.id ORDER BY r.revision DESC LIMIT 1) latest ON true
    WHERE s.book_id=NEW.book_id AND s.id<>NEW.source_id
      AND NOT EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=s.book_id AND w.source_id=s.id)
      AND latest.body->>'evidenceSha256'=NEW.body->>'evidenceSha256'
      AND latest.body->'facts'->>'sourceLocator'=NEW.body->'facts'->>'sourceLocator') THEN
    PERFORM openerp.fail('IdempotencyConflict','This evidence component already has an active expense source. Review its identity or explicitly withdraw the erroneous observation first.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.fail(code text, message text) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = message, DETAIL = code; END $$;
CREATE FUNCTION openerp.freeze_preparation_inputs() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF TG_OP='DELETE' THEN PERFORM openerp.fail('Forbidden','Preparation runs are retained; cancel instead of deleting.'); END IF;
  IF (NEW.book_id,NEW.id,NEW.rule_id,NEW.activation_id,NEW.selection) IS DISTINCT FROM
    (OLD.book_id,OLD.id,OLD.rule_id,OLD.activation_id,OLD.selection) THEN
    PERFORM openerp.fail('Forbidden','A preparation run keeps its frozen rule, activation and observation selection.'); END IF;
  IF NEW.cursor<OLD.cursor OR jsonb_array_length(NEW.results)<>NEW.cursor OR EXISTS(
    SELECT FROM jsonb_array_elements(OLD.results) WITH ORDINALITY previous(value,ordinal)
    WHERE NEW.results->(previous.ordinal::integer-1) IS DISTINCT FROM previous.value) THEN
    PERFORM openerp.fail('Forbidden','Preparation results are append-only and the committed cursor cannot move backwards.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.guard_historical_basis() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE basis openerp.historical_bases;
BEGIN
  SELECT * INTO basis FROM openerp.historical_bases b
    WHERE b.book_id=NEW.book_id AND b.fiscal_year_id=NEW.fiscal_year_id;
  IF FOUND AND basis.mode='opening_set' THEN
    IF NEW.change_set_id=basis.change_set_id THEN
      IF basis.opening_voucher_id IS NOT NULL OR NEW.posting_date<>basis.cutover_on THEN
        PERFORM openerp.fail('AlreadyPosted','The migration opening is single-use and must post on its reviewed cutover date.'); END IF;
    ELSIF basis.opening_voucher_id IS NULL OR NEW.posting_date<basis.cutover_on THEN
      PERFORM openerp.fail('ApprovalRequired','Post the reviewed opening before later movements; never backdate through its cutover.');
    END IF;
  END IF;
  IF EXISTS(SELECT FROM openerp.sie_financial_runs r WHERE r.book_id=NEW.book_id AND r.status='running'
    AND (r.permitted_change_id IS DISTINCT FROM NEW.change_set_id OR r.lease_until<=clock_timestamp())) THEN
    PERFORM openerp.fail('StaleDependency','An active historical import fences unrelated ledger postings.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.guard_journal_ordinal() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE expected_count integer;
BEGIN
  SELECT expected_line_count INTO expected_count FROM openerp.vouchers
    WHERE book_id = NEW.book_id AND id = NEW.voucher_id;
  IF expected_count IS NULL OR NEW.ordinal > expected_count THEN
    PERFORM openerp.fail('InvalidJournal', 'The journal ordinal exceeds the sealed voucher line count.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.guard_sie_financial_proposal() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE proposal openerp.sie_financial_proposals; run openerp.sie_financial_runs;
BEGIN
  SELECT * INTO proposal FROM openerp.sie_financial_proposals
    WHERE book_id=NEW.book_id AND change_set_id=NEW.change_set_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO STRICT run FROM openerp.sie_financial_runs
    WHERE book_id=proposal.book_id AND id=proposal.run_id;
  IF run.status<>'running' OR run.lease_until<=clock_timestamp()
    OR run.permitted_change_id IS DISTINCT FROM NEW.change_set_id
    OR EXISTS(SELECT FROM openerp.sie_financial_postings
      WHERE book_id=proposal.book_id AND run_id=proposal.run_id AND ordinal=proposal.ordinal) THEN
    PERFORM openerp.fail('StaleDependency','Post this source voucher through its current financial import run.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.guard_superseded_historical_opening() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF EXISTS(SELECT FROM openerp.superseded_historical_openings
    WHERE book_id=NEW.book_id AND change_set_id=NEW.change_set_id) THEN
    PERFORM openerp.fail('StaleDependency','This opening proposal was replaced. Review and approve its replacement.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.immutable_row() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN PERFORM openerp.fail('Forbidden', 'Accounting history is append-only. Create a linked correction.'); RETURN NULL; END $$;
CREATE FUNCTION openerp.inspect_action(book text, action jsonb) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.intake_require_unsuperseded_preview() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF EXISTS(SELECT FROM openerp.intake_preview_supersessions s
    WHERE s.book_id=NEW.book_id AND s.previous_preview_id=NEW.preview_id) THEN
    PERFORM openerp.fail('StaleDependency','This preview was superseded. Review and approve its replacement.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.invoice_cancellation_admits(p_book text, p_change text, p_original text, p_action jsonb) RETURNS boolean
  SECURITY INVOKER
  LANGUAGE sql
  STABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

 SELECT EXISTS(SELECT FROM openerp.invoice_cancellation_executions x
  JOIN openerp.invoice_cancellation_reviews r ON (r.book_id,r.id)=(x.book_id,x.review_id)
  JOIN openerp.invoice_issues i ON (i.book_id,i.id)=(r.book_id,r.issue_id)
  JOIN openerp.commerce_invoices inv ON (inv.book_id,inv.id)=(i.book_id,i.register_invoice_id)
  WHERE x.book_id=p_book AND r.change_set_id=p_change AND inv.recognition_voucher_id=p_original
    AND p_action->>'postingPurpose'='reversal' AND p_action->>'correctsVoucherId'=p_original
    AND p_action=r.body->'postingPlan'->'groups'->0->'actions'->0)
$$;
CREATE FUNCTION openerp.invoice_cancellation_proof() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE c_cancel openerp.invoice_cancellations; c_review openerp.invoice_cancellation_reviews; c_issue openerp.invoice_issues;
 c_invoice openerp.commerce_invoices; c_original openerp.vouchers; c_reversal openerp.vouchers; c_receipt openerp.execution_receipts;
 c_approval openerp.invoice_cancellation_approvals; c_kernel openerp.approvals;
BEGIN
 SELECT * INTO c_cancel FROM openerp.invoice_cancellations c WHERE c.book_id=NEW.book_id AND c.review_id=NEW.review_id;
 IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','An owned cancellation admission cannot commit without its final aggregate.'); END IF;
 SELECT * INTO STRICT c_review FROM openerp.invoice_cancellation_reviews r WHERE r.book_id=c_cancel.book_id AND r.id=c_cancel.review_id;
 SELECT * INTO STRICT c_issue FROM openerp.invoice_issues i WHERE i.book_id=c_cancel.book_id AND i.id=c_cancel.issue_id;
 SELECT * INTO STRICT c_invoice FROM openerp.commerce_invoices i WHERE i.book_id=c_cancel.book_id AND i.id=c_cancel.register_invoice_id;
 SELECT * INTO STRICT c_original FROM openerp.vouchers v WHERE v.book_id=c_cancel.book_id AND v.id=c_cancel.original_voucher_id;
 SELECT * INTO STRICT c_reversal FROM openerp.vouchers v WHERE v.book_id=c_cancel.book_id AND v.id=c_cancel.reversal_voucher_id;
 SELECT * INTO STRICT c_receipt FROM openerp.execution_receipts e WHERE e.book_id=c_cancel.book_id AND e.id=c_cancel.posting_receipt_id;
 SELECT * INTO STRICT c_approval FROM openerp.invoice_cancellation_approvals a WHERE a.book_id=c_cancel.book_id AND a.id=c_cancel.approval_id;
 SELECT * INTO STRICT c_kernel FROM openerp.approvals a WHERE a.book_id=c_cancel.book_id AND a.id=c_receipt.approval_id;
 IF c_review.issue_id<>c_issue.id OR c_issue.register_invoice_id<>c_invoice.id OR c_invoice.recognition_voucher_id<>c_original.id
  OR c_issue.body IS DISTINCT FROM c_review.body->'snapshot'->'issue'
  OR c_issue.body->'postingReceipt'->>'voucherId' IS DISTINCT FROM c_original.id
  OR c_original.posting_purpose='reversal' OR c_reversal.posting_purpose<>'reversal'
  OR c_reversal.corrects_voucher_id IS DISTINCT FROM c_original.id OR c_reversal.change_set_id<>c_review.change_set_id
  OR c_reversal.action IS DISTINCT FROM c_review.body->'postingPlan'->'groups'->0->'actions'->0
  OR c_reversal.posting_date<>c_cancel.posting_date OR c_reversal.posting_date<c_original.posting_date
  OR c_receipt.change_set_id<>c_review.change_set_id OR c_receipt.voucher_id<>c_reversal.id
  OR c_receipt.body IS DISTINCT FROM c_cancel.body->'postingReceipt'
  OR c_kernel.actor_id<>c_approval.actor_id OR c_kernel.digest IS DISTINCT FROM c_review.body->'postingPlan'->>'planDigest'
  OR c_kernel.consumed_at IS NULL OR c_approval.review_id<>c_review.id OR c_approval.digest IS DISTINCT FROM c_review.body->>'digest'
  OR EXISTS(SELECT FROM openerp.invoice_cancellation_revocations r WHERE r.book_id=c_cancel.book_id AND r.approval_id=c_approval.id)
  OR c_cancel.body->>'issueId' IS DISTINCT FROM c_issue.id OR c_cancel.body->>'registerInvoiceId' IS DISTINCT FROM c_invoice.id
  OR c_cancel.body->>'originalVoucherId' IS DISTINCT FROM c_original.id OR c_cancel.body->>'reversalVoucherId' IS DISTINCT FROM c_reversal.id
  OR c_cancel.body->>'reviewId' IS DISTINCT FROM c_review.id OR c_cancel.body->>'approvalId' IS DISTINCT FROM c_approval.id
  OR c_cancel.body->>'reviewDigest' IS DISTINCT FROM c_review.body->>'digest'
  OR c_cancel.body->>'amountMinor' IS DISTINCT FROM c_invoice.amount_minor::text
  OR c_cancel.body->>'postingDate' IS DISTINCT FROM c_reversal.posting_date::text
  OR c_cancel.body->>'committedAt' IS DISTINCT FROM c_receipt.body->>'committedAt'
  OR NOT openerp.invoice_cancellation_admits(c_cancel.book_id,c_review.change_set_id,c_original.id,c_reversal.action) THEN
  PERFORM openerp.fail('InvalidJournal','The exact cancellation, original issue, register recognition, approval and kernel reversal receipt must commit together.'); END IF;
 PERFORM openerp.inspect_action(c_cancel.book_id,c_reversal.action);
 IF EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=c_cancel.book_id AND l.invoice_id=c_invoice.id) THEN
  PERFORM openerp.fail('InvalidJournal','A cancelled invoice cannot retain active payment allocations.'); END IF;
 IF EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=c_cancel.book_id AND p.id IN(c_original.period_id,c_reversal.period_id) AND p.locked) THEN
  PERFORM openerp.fail('PeriodLocked','Both recognition and cancellation periods must remain open at cancellation commit.'); END IF;
 PERFORM openerp.invoice_cancellation_resources(c_cancel.book_id,c_original.id,c_invoice.id);
 RETURN NULL;
END $$;
CREATE FUNCTION openerp.invoice_cancellation_resources(p_book text, p_voucher text, p_invoice text) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE c_resources jsonb; c_resource jsonb;
BEGIN
 IF EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.voucher_id=p_voucher) THEN
  PERFORM openerp.fail('StaleDependency','This recognition is retained as a schedule carrying basis. Linked schedule compensation is unsupported; cancellation is refused.'); END IF;
 c_resources:=openerp.correction_impact_resources(p_book,p_voucher,NULL);
 FOR c_resource IN SELECT value FROM jsonb_array_elements(c_resources) LOOP
  IF c_resource->>'blocks'='true' AND NOT(c_resource->>'kind'='invoice' AND c_resource->>'id'=p_invoice) THEN
   PERFORM openerp.fail('StaleDependency',c_resource->>'detail'); END IF;
 END LOOP;
 RETURN c_resources;
END $$;
CREATE FUNCTION openerp.invoice_issue_guard_draft() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=OLD.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.invoice_issues i WHERE i.book_id=OLD.book_id AND i.draft_id=OLD.id) THEN
    PERFORM openerp.fail('Forbidden','This draft has an immutable synthetic issue. Its issued content cannot be revised.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.invoice_issue_require_aggregate() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF EXISTS(SELECT FROM openerp.invoice_issue_reviews r
      WHERE r.book_id=NEW.book_id AND (r.event_id=NEW.event_id
        OR r.evidence_id IN (SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
        OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=r.evidence_id)))
    AND NOT EXISTS(SELECT FROM openerp.invoice_issues i
      JOIN openerp.invoice_issue_reviews r ON r.book_id=i.book_id AND r.id=i.review_id
      JOIN openerp.execution_receipts e ON e.book_id=i.book_id AND e.id=i.posting_receipt_id
      WHERE i.book_id=NEW.book_id AND r.change_set_id=NEW.change_set_id AND e.voucher_id=NEW.id)
    AND NOT EXISTS(SELECT FROM openerp.invoice_cancellations c
      JOIN openerp.invoice_cancellation_reviews r ON (r.book_id,r.id)=(c.book_id,c.review_id)
      JOIN openerp.execution_receipts e ON (e.book_id,e.id)=(c.book_id,c.posting_receipt_id)
      WHERE c.book_id=NEW.book_id AND c.reversal_voucher_id=NEW.id AND r.change_set_id=NEW.change_set_id
        AND e.voucher_id=NEW.id AND e.change_set_id=NEW.change_set_id
        AND c.original_voucher_id=NEW.corrects_voucher_id AND NEW.action=r.body->'postingPlan'->'groups'->0->'actions'->0) THEN
    PERFORM openerp.fail('ApprovalRequired','Use the synthetic invoice issue operation. An owned draft source cannot be posted separately, with another event key, or corrected outside its aggregate.');
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.owner_assert_allocation(p_book text, p_receipt text) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.owner_check_allocation() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
 IF TG_TABLE_NAME='owner_allocation_receipts' THEN PERFORM openerp.owner_assert_allocation(NEW.book_id,NEW.id);
 ELSE PERFORM openerp.owner_assert_allocation(NEW.book_id,NEW.receipt_id); END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION openerp.owner_guard_account() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.owner_guard_capacity() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE v_voucher text; v_line text;
BEGIN
 PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
 IF TG_TABLE_NAME='owner_effects' THEN
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=NEW.book_id AND i.recognition_voucher_id=NEW.voucher_id AND i.recognition_line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=NEW.book_id AND l.payment_voucher_id=NEW.voucher_id AND l.payment_line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.bank_active_matches m WHERE m.book_id=NEW.book_id AND m.voucher_id=NEW.voucher_id AND m.line_id=NEW.line_id)
   OR EXISTS(SELECT FROM openerp.bank_active_allocation_legs l WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.line_id=NEW.line_id) THEN
   PERFORM openerp.fail('StaleDependency','This posted line is already used by commerce or bank matching.'); END IF;
 ELSE
  IF TG_TABLE_NAME='commerce_invoices' THEN v_voucher:=NEW.recognition_voucher_id; v_line:=NEW.recognition_line_id;
  ELSIF TG_TABLE_NAME='commerce_allocation_legs' THEN v_voucher:=NEW.payment_voucher_id; v_line:=NEW.payment_line_id;
  ELSE v_voucher:=NEW.voucher_id; v_line:=NEW.line_id; END IF;
  IF EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=NEW.book_id AND e.voucher_id=v_voucher AND e.line_id=v_line) THEN PERFORM openerp.fail('StaleDependency','This posted control line already belongs to an owner source.'); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION openerp.owner_guard_kernel() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.owner_require_ready(p_book text, p_record text, p_review text, p_historical boolean DEFAULT false) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.owner_validate_line(p_book text, p_ready jsonb, p_action jsonb, p_line text) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.posting_guard_approval_consumption() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM openerp.fail('Forbidden','Approval history is immutable. Revoke unused authority instead.');
  END IF;
  IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    PERFORM openerp.fail('Forbidden','Approval identity and consumption are immutable.');
  END IF;
  IF NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL THEN
    IF OLD.expires_at <= clock_timestamp() THEN
      PERFORM openerp.fail('ApprovalRequired','This approval expired before consumption. Obtain a new exact-plan approval.'); END IF;
    IF EXISTS(SELECT FROM openerp.posting_approval_revocations r WHERE r.book_id=NEW.book_id AND r.approval_id=NEW.id) THEN
      PERFORM openerp.fail('ApprovalRequired','This approval was revoked. Obtain a new exact-plan approval.'); END IF;
    PERFORM 1 FROM openerp.memberships m WHERE m.book_id=NEW.book_id AND m.actor_id=NEW.actor_id AND m.role='operator' FOR SHARE;
    IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approver no longer has operator authority.'); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.posting_guard_saved_command_receipt() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE ps_request openerp.posting_saved_requests; ps_operation text; ps_payload jsonb; ps_digest text;
BEGIN
  SELECT * INTO ps_request FROM openerp.posting_saved_requests r
    WHERE r.book_id=NEW.book_id AND r.command_key=NEW.key;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF EXISTS(SELECT FROM openerp.posting_request_outcomes o
    WHERE o.book_id=ps_request.book_id AND o.key=ps_request.key AND o.state='refused') THEN
    PERFORM openerp.fail('IdempotencyConflict','This saved request was terminally refused. Its key cannot execute later.'); END IF;
  ps_operation := ps_request.command->>'operation';
  ps_payload := CASE WHEN ps_operation IN ('create_evidence','prepare_journal') THEN ps_request.command->'input'
    ELSE jsonb_build_object('id',ps_request.command->>'id','input',ps_request.command->'input') END;
  IF ps_operation='revoke_approval' THEN ps_operation := 'revoke_posting_approval'; END IF;
  ps_digest := openerp.digest(jsonb_build_object('operation',ps_operation,'actor',ps_request.actor_id,'input',ps_payload));
  IF NEW.actor_id IS DISTINCT FROM ps_request.actor_id OR NEW.operation IS DISTINCT FROM ps_operation
    OR NEW.request_digest IS DISTINCT FROM ps_digest THEN
    PERFORM openerp.fail('IdempotencyConflict','The reserved kernel key belongs to another exact saved request.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.record_historical_opening() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  UPDATE openerp.historical_bases SET opening_voucher_id=NEW.id
    WHERE book_id=NEW.book_id AND fiscal_year_id=NEW.fiscal_year_id
      AND mode='opening_set' AND change_set_id=NEW.change_set_id AND opening_voucher_id IS NULL;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.refuse_withdrawn_expense_vat_link() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.expense_tax_source_withdrawals w WHERE w.book_id=NEW.book_id
    AND w.source_id=NEW.body->'input'->'expenseLink'->>'sourceId') THEN
    PERFORM openerp.fail('StaleDependency','A new VAT fact revision cannot derive from a permanently withdrawn expense source.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.refuse_withdrawn_vat_fact_revision() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.vat_fact_withdrawals w WHERE w.book_id=NEW.book_id AND w.fact_id=NEW.fact_id) THEN
    PERFORM openerp.fail('StaleDependency','This VAT source identity is permanently withdrawn. Its history remains readable; new revisions and reactivation are refused.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.require_complete_correction_bundle() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE cb_bundle openerp.correction_bundles;
BEGIN
  SELECT b.* INTO cb_bundle FROM openerp.correction_bundles b
    WHERE b.book_id = NEW.book_id AND NEW.change_set_id IN (b.reversal_change_set_id, b.replacement_change_set_id);
  IF FOUND AND NOT EXISTS (
    SELECT FROM openerp.correction_bundle_receipts r
    JOIN openerp.execution_receipts reverse_receipt ON reverse_receipt.book_id = r.book_id AND reverse_receipt.id = r.reversal_receipt_id
    JOIN openerp.execution_receipts replace_receipt ON replace_receipt.book_id = r.book_id AND replace_receipt.id = r.replacement_receipt_id
    WHERE r.book_id = cb_bundle.book_id AND r.bundle_id = cb_bundle.id
      AND r.original_voucher_id = cb_bundle.original_voucher_id
      AND reverse_receipt.change_set_id = cb_bundle.reversal_change_set_id
      AND replace_receipt.change_set_id = cb_bundle.replacement_change_set_id
  ) THEN
    PERFORM openerp.fail('ApprovalRequired', 'This change belongs to a correction bundle. Approve and execute the complete bundle; neither part can post alone.');
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.retain_collection_statement_artifact() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  INSERT INTO openerp.collection_statement_artifacts(book_id,statement_id,content)
    VALUES(NEW.book_id,NEW.id,openerp.canonical(NEW.body));
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.subledger_basis_kernel_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE s_action jsonb;
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF TG_TABLE_NAME='vouchers' THEN
    PERFORM openerp.subledger_check_posting_basis(NEW.book_id,NEW.change_set_id,NEW.action);
  ELSE
    FOR s_action IN SELECT a.value FROM jsonb_array_elements(NEW.plan->'groups') g(value)
      CROSS JOIN LATERAL jsonb_array_elements(g.value->'actions') a(value) LOOP
      PERFORM openerp.subledger_check_posting_basis(NEW.book_id,NEW.id,s_action);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.subledger_basis_matches_revision(p_basis jsonb, p_revision jsonb) RETURNS boolean
  SECURITY INVOKER
  LANGUAGE sql
  IMMUTABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

  SELECT coalesce(p_basis->>'digest'=openerp.digest(p_basis-'digest')
    AND p_revision->>'digest'=openerp.digest(p_revision-'digest')
    AND (p_basis->>'scheduleDigest'=p_revision->>'digest'
      OR (p_revision->'amendment'->>'kind' IN('future_dates_v1','remaining_estimate_v1','remaining_lifetime_v1','impairment_v1')
        AND p_revision->'amendment'->>'basisDigest'=p_basis->>'digest'
        AND p_revision->'amendment'->>'basisScheduleDigest'=p_basis->>'scheduleDigest')),false)
$$;
CREATE FUNCTION openerp.subledger_basis_revision_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE
  s_basis jsonb; s_current jsonb; s_kind text; s_estimate boolean; s_first integer;
  s_lifetime boolean; s_book openerp.books; s_input jsonb; s_review openerp.evidence; s_actor text; s_key text;
  s_states jsonb; s_state jsonb; s_occurrence jsonb; s_period jsonb; s_impairment_review jsonb;
  s_occurrences jsonb:='[]'; s_periods jsonb:='[]'; s_remaining numeric:=0; s_recognized numeric:=0;
  s_reversed numeric:=0; s_count integer; s_new_count integer; s_index integer:=0; s_event_key text;
  s_today date; s_date date; s_last date; s_reversal_date date;
BEGIN
  s_kind:=NEW.body->'amendment'->>'kind';
  IF s_kind='impairment_v1' THEN
    SELECT r.body INTO s_impairment_review FROM openerp.subledger_impairment_reviews r
      WHERE r.book_id=NEW.book_id AND r.id=NEW.body->'amendment'->>'reviewId';
    s_current:=openerp.subledger_current(NEW.book_id,NEW.schedule_id);
    SELECT b.body INTO s_basis FROM openerp.subledger_bases b WHERE b.book_id=NEW.book_id AND b.schedule_id=NEW.schedule_id;
    IF s_impairment_review IS NULL OR s_basis IS NULL OR s_impairment_review->'proposedRevision' IS DISTINCT FROM NEW.body
      OR NEW.revision<>(s_current->>'revision')::integer+1 OR NEW.body->>'revision' IS DISTINCT FROM NEW.revision::text
      OR NEW.evidence_id IS DISTINCT FROM s_current->'terms'->>'evidenceId'
      OR s_impairment_review->'basis'->'schedule'->>'digest' IS DISTINCT FROM s_current->>'digest'
      OR NOT openerp.subledger_basis_matches_revision(s_basis,NEW.body)
      OR EXISTS(SELECT FROM openerp.subledger_impairments e WHERE e.book_id=NEW.book_id
        AND e.review_id=s_impairment_review->>'id')
      OR NOT openerp.subledger_estimate_current(NEW.book_id,NEW.body) THEN
      PERFORM openerp.fail('UnsupportedProfile','An impairment revision must be the exact reviewed aggregate over the intact current basis and complete future suffix.'); END IF;
    RETURN NEW;
  END IF;
  s_lifetime:=s_kind='remaining_lifetime_v1';
  IF s_lifetime THEN SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE; END IF;
  SELECT b.body INTO s_basis FROM openerp.subledger_bases b WHERE b.book_id=NEW.book_id AND b.schedule_id=NEW.schedule_id;
  IF NOT FOUND THEN
    IF s_lifetime THEN PERFORM openerp.fail('UnsupportedProfile','A lifetime amendment requires a linked carrying basis.'); END IF;
    RETURN NEW;
  END IF;
  s_current:=openerp.subledger_current(NEW.book_id,NEW.schedule_id);
  s_estimate:=s_kind IN('remaining_estimate_v1','remaining_lifetime_v1');
  IF s_kind IS NULL OR s_kind NOT IN('future_dates_v1','remaining_estimate_v1','remaining_lifetime_v1')
    OR NEW.body->'receipt'->>'operation' IS DISTINCT FROM
      (CASE WHEN s_estimate THEN 'amend_schedule_estimate' ELSE 'amend_schedule_future_dates' END)
    OR NEW.body->>'previousDigest' IS DISTINCT FROM s_current->>'digest'
    OR NEW.body->'amendment'->'input'->>'expectedDigest' IS DISTINCT FROM s_current->>'digest'
    OR NEW.revision<>(s_current->>'revision')::integer+1
    OR NEW.body->>'revision' IS DISTINCT FROM NEW.revision::text
    OR NEW.evidence_id IS DISTINCT FROM s_current->'terms'->>'evidenceId'
    OR NOT openerp.subledger_basis_matches_revision(s_basis,NEW.body)
    OR (NEW.body-ARRAY['digest','previousDigest','revision','createdAt','receipt','terms','occurrences','amendment','allocatedMinor'])
      IS DISTINCT FROM (s_current-ARRAY['digest','previousDigest','revision','createdAt','receipt','terms','occurrences','amendment','allocatedMinor'])
    OR (NOT s_lifetime AND jsonb_array_length(NEW.body->'occurrences')<>jsonb_array_length(s_current->'occurrences')) THEN
    PERFORM openerp.fail('UnsupportedProfile','A linked basis requires an immutable reviewed amendment with unchanged source and installment identities.'); END IF;
  IF s_lifetime THEN
    s_input:=NEW.body->'amendment'->'input';
    s_today:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
    IF s_book.profile<>'synthetic-core-v1' OR s_book.authority<>'native' THEN
      PERFORM openerp.fail('UnsupportedProfile','Only native synthetic schedules support remaining-lifetime amendments.'); END IF;
    PERFORM openerp.commerce_exact_object(s_input,ARRAY['expectedDigest','expectedBasisDigest','firstOrdinal',
      'remainingMinor','residualMinor','installments','reviewEvidenceId','rationale']);
    IF jsonb_typeof(s_input->'firstOrdinal') IS DISTINCT FROM 'number'
      OR coalesce(s_input->>'firstOrdinal','') !~ '^[1-9][0-9]{0,2}$'
      OR jsonb_typeof(s_input->'remainingMinor') IS DISTINCT FROM 'string'
      OR coalesce(s_input->>'remainingMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
      OR jsonb_typeof(s_input->'residualMinor') IS DISTINCT FROM 'string'
      OR coalesce(s_input->>'residualMinor','') !~ '^(0|[1-9][0-9]{0,37})$'
      OR jsonb_typeof(s_input->'installments') IS DISTINCT FROM 'array'
      OR jsonb_typeof(s_input->'reviewEvidenceId') IS DISTINCT FROM 'string'
      OR coalesce(s_input->>'reviewEvidenceId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR jsonb_typeof(s_input->'rationale') IS DISTINCT FROM 'string'
      OR length(s_input->>'rationale')>2000 OR length(btrim(s_input->>'rationale'))<1 THEN
      PERFORM openerp.fail('InvalidJournal','Supply the entire remaining suffix, exact remaining minor units, review evidence and rationale.'); END IF;
    IF s_input->>'expectedDigest' IS DISTINCT FROM s_current->>'digest'
      OR s_input->>'expectedBasisDigest' IS DISTINCT FROM s_basis->>'digest'
      OR NOT openerp.subledger_basis_matches_revision(s_basis,s_current)
      OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=s_book.id
        AND v.corrects_voucher_id=s_basis->'input'->>'voucherId') THEN
      PERFORM openerp.fail('StaleDependency','Lifetime amendments require the exact current schedule and intact linked carrying basis.'); END IF;
    s_actor:=NEW.body->'receipt'->>'actorId'; s_key:=NEW.body->'receipt'->>'key';
    IF jsonb_typeof(NEW.body->'receipt'->'key') IS DISTINCT FROM 'string'
      OR coalesce(s_key,'') !~ '^[a-zA-Z0-9_-]{8,128}$'
      OR jsonb_typeof(NEW.body->'receipt'->'actorId') IS DISTINCT FROM 'string'
      OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=s_book.id AND m.actor_id=s_actor AND m.role='operator')
      OR NEW.body->'receipt' IS DISTINCT FROM jsonb_build_object('key',s_key,'operation','amend_schedule_estimate','actorId',s_actor) THEN
      PERFORM openerp.fail('InvalidJournal','A lifetime revision requires the exact operator amendment receipt identity.'); END IF;
    SELECT * INTO s_review FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=s_input->>'reviewEvidenceId';
    IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the lifetime-review evidence in this book first.'); END IF;
    s_first:=(s_input->>'firstOrdinal')::integer; s_count:=jsonb_array_length(s_current->'occurrences');
    s_new_count:=s_first-1+jsonb_array_length(s_input->'installments');
    IF s_first NOT BETWEEN 1 AND s_count OR jsonb_array_length(s_input->'installments') NOT BETWEEN 1 AND 120
      OR s_new_count NOT BETWEEN 1 AND 120 OR s_new_count=s_count OR NEW.revision>20
      OR jsonb_typeof(NEW.body->'occurrences') IS DISTINCT FROM 'array'
      OR jsonb_typeof(NEW.body->'terms'->'periods') IS DISTINCT FROM 'array' THEN
      PERFORM openerp.fail('InvalidJournal','A lifetime amendment must change a nonempty remaining count within120 current occurrences and20 revisions.'); END IF;
    IF jsonb_array_length(NEW.body->'occurrences')<>s_new_count
      OR NEW.body->>'revision' IS DISTINCT FROM to_jsonb(NEW.revision)
      OR NEW.body->'terms'->>'usefulPeriods' IS DISTINCT FROM to_jsonb(s_new_count)
      OR jsonb_array_length(NEW.body->'terms'->'periods')<>s_new_count
      OR NEW.body->'terms'->>'residualMinor' IS DISTINCT FROM s_input->'residualMinor'
      OR NEW.body->'terms'->>'allocationPolicy' IS DISTINCT FROM 'explicit_remaining_minor_v1'
      OR (NEW.body->'terms'-ARRAY['periods','residualMinor','allocationPolicy','usefulPeriods'])
        IS DISTINCT FROM (s_current->'terms'-ARRAY['periods','residualMinor','allocationPolicy','usefulPeriods']) THEN
      PERFORM openerp.fail('UnsupportedProfile','Lifetime amendments may change only explicit future dates, amounts, count and residual, not source or accounts.'); END IF;
    PERFORM 1 FROM openerp.periods p WHERE p.book_id=s_book.id AND p.id IN(
      SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(s_input->'installments') x
      UNION SELECT x->>'accountingPeriodId' FROM jsonb_array_elements(s_current->'occurrences') x
        WHERE (x->>'ordinal')::integer>=s_first) ORDER BY p.id FOR SHARE;
    PERFORM 1 FROM openerp.accounts a WHERE a.book_id=s_book.id
      AND a.id IN(s_current->'terms'->>'debitAccountId',s_current->'terms'->>'creditAccountId') ORDER BY a.id FOR SHARE;
    IF (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=s_book.id AND a.active
      AND a.id IN(s_current->'terms'->>'debitAccountId',s_current->'terms'->>'creditAccountId'))<>2 THEN
      PERFORM openerp.fail('InvalidJournal','Schedule accounts must remain active.'); END IF;
    s_states:=openerp.subledger_occurrence_states(s_book.id,s_current,'9999-12-31'::date);
    IF jsonb_array_length(s_states)<>s_count THEN
      PERFORM openerp.fail('UnsupportedProfile','Occurrence history is ambiguous. Inspect postings and corrections before any amendment.'); END IF;
    FOR s_occurrence IN SELECT value FROM jsonb_array_elements(s_current->'occurrences') LOOP
      s_index:=s_index+1; s_state:=s_states->(s_index-1);
      IF s_index<s_first THEN
        IF coalesce(s_state->>'state','') NOT IN('posted','reversed') THEN
          PERFORM openerp.fail('UnsupportedProfile','Every occurrence before the remaining suffix must be posted or fully reversed, never pending or conflicted.'); END IF;
        s_reversal_date:=NULL;
        IF s_state->>'state'='reversed' THEN
          SELECT v.posting_date INTO s_reversal_date FROM openerp.vouchers v
            WHERE v.book_id=s_book.id AND v.id=s_state->>'reversalVoucherId' AND v.posting_purpose='reversal';
          IF NOT FOUND THEN PERFORM openerp.fail('UnsupportedProfile','Only an exact retained full reversal can release prior recognition for this estimate.'); END IF;
          IF EXISTS(SELECT FROM openerp.correction_bundles c JOIN openerp.vouchers v
            ON v.book_id=c.book_id AND v.change_set_id=c.replacement_change_set_id
            WHERE c.book_id=s_book.id AND c.original_voucher_id=s_state->>'voucherId') THEN
            PERFORM openerp.fail('UnsupportedProfile','A posted correction replacement needs a separate carrying-basis review; its original reversal cannot fund this estimate.'); END IF;
          s_reversed:=s_reversed+(s_occurrence->>'amountMinor')::numeric;
        ELSE s_recognized:=s_recognized+(s_occurrence->>'amountMinor')::numeric; END IF;
        s_period:=s_current->'terms'->'periods'->(s_index-1);
        s_last:=greatest(s_last,(s_occurrence->>'postingDate')::date,s_reversal_date);
        s_occurrences:=s_occurrences||jsonb_build_array(s_occurrence);
        s_periods:=s_periods||jsonb_build_array(s_period-'amountMinor');
      ELSE
        IF coalesce(s_state->>'state','') NOT IN('unprepared','prepared')
          OR EXISTS(SELECT FROM openerp.events e JOIN openerp.vouchers v ON v.book_id=e.book_id AND v.event_id=e.id
            WHERE e.book_id=s_book.id AND e.evidence_id=s_current->'terms'->>'evidenceId'
              AND e.event_key=s_occurrence->>'eventKey') THEN
          PERFORM openerp.fail('AlreadyPosted','A remaining occurrence has a posting or correction. Its identity and dates cannot be amended.'); END IF;
        IF (s_occurrence->>'postingDate')::date<=s_today
          OR EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=s_book.id
            AND p.id=s_occurrence->>'accountingPeriodId' AND p.locked) THEN
          PERFORM openerp.fail('UnsupportedProfile','Only a wholly future unposted suffix can be rescheduled. Due occurrences cannot be deferred by this command.'); END IF;
      END IF;
    END LOOP;
    s_index:=s_first-1;
    FOR s_period IN SELECT value FROM jsonb_array_elements(s_input->'installments') LOOP
      s_index:=s_index+1;
      PERFORM openerp.commerce_exact_object(s_period,ARRAY['postingDate','accountingPeriodId','amountMinor']);
      IF jsonb_typeof(s_period->'amountMinor') IS DISTINCT FROM 'string'
        OR coalesce(s_period->>'amountMinor','') !~ '^[1-9][0-9]{0,37}$'
        OR jsonb_typeof(s_period->'postingDate') IS DISTINCT FROM 'string'
        OR jsonb_typeof(s_period->'accountingPeriodId') IS DISTINCT FROM 'string'
        OR coalesce(s_period->>'accountingPeriodId','') !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
        PERFORM openerp.fail('InvalidJournal','Each remaining installment needs positive exact minor units, an explicit date and a period from this book. Zero-value completion is unsupported.'); END IF;
      s_date:=openerp.bank_date(s_period->>'postingDate');
      IF s_date<=s_today OR (s_last IS NOT NULL AND s_date<=s_last)
        OR s_date<=(s_basis->'input'->>'effectiveOn')::date
        OR NOT EXISTS(SELECT FROM openerp.periods p JOIN openerp.fiscal_years y
          ON y.book_id=p.book_id AND y.id=p.fiscal_year_id
          WHERE p.book_id=s_book.id AND p.id=s_period->>'accountingPeriodId'
            AND s_date BETWEEN p.starts_on AND p.ends_on AND p.starts_on>=y.starts_on AND p.ends_on<=y.ends_on)
        OR EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=s_book.id
          AND p.id=s_period->>'accountingPeriodId' AND p.locked) THEN
        PERFORM openerp.fail('InvalidJournal','New dates must be future, strictly increasing and after all prefix postings/reversals and the carrying basis.'); END IF;
      s_last:=s_date; s_remaining:=s_remaining+(s_period->>'amountMinor')::numeric;
      s_occurrence:=NEW.body->'occurrences'->(s_index-1); s_event_key:=s_occurrence->>'eventKey';
      IF jsonb_typeof(s_occurrence->'eventKey') IS DISTINCT FROM 'string'
        OR s_occurrence IS DISTINCT FROM s_period||jsonb_build_object('ordinal',s_index,'eventKey',s_event_key) THEN
        PERFORM openerp.fail('InvalidJournal','Every new lifetime occurrence must match its explicit installment and contiguous ordinal.'); END IF;
      IF s_event_key !~ '^[a-zA-Z0-9_-]{1,128}$'
        OR EXISTS(SELECT FROM jsonb_array_elements(s_occurrences) o WHERE o->>'eventKey'=s_event_key)
        OR EXISTS(SELECT FROM openerp.subledger_schedule_revisions r
          CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
          WHERE r.book_id=s_book.id AND o->>'eventKey'=s_event_key)
        OR EXISTS(SELECT FROM openerp.events e WHERE e.book_id=s_book.id
          AND e.evidence_id=s_current->'terms'->>'evidenceId' AND e.event_key=s_event_key) THEN
        PERFORM openerp.fail('InvalidJournal','New lifetime occurrences require fresh unique event keys that have never been retained or used.'); END IF;
      s_occurrences:=s_occurrences||jsonb_build_array(s_occurrence);
      s_periods:=s_periods||jsonb_build_array(s_period-'amountMinor');
    END LOOP;
    IF s_remaining<>(s_input->>'remainingMinor')::numeric
      OR s_recognized+s_remaining+(s_input->>'residualMinor')::numeric<>(s_current->'terms'->>'costMinor')::numeric
      OR NEW.body->'allocatedMinor' IS DISTINCT FROM to_jsonb((s_recognized+s_remaining)::text)
      OR NEW.body->'occurrences' IS DISTINCT FROM s_occurrences
      OR NEW.body->'terms'->'periods' IS DISTINCT FROM s_periods
      OR NEW.body->'amendment' IS DISTINCT FROM jsonb_build_object('kind','remaining_lifetime_v1','input',s_input,
        'recognizedMinor',s_recognized::text,'reversedMinor',s_reversed::text,'basisDigest',s_basis->>'digest',
        'basisScheduleDigest',s_basis->>'scheduleDigest','reviewSha256',s_review.sha256,'reviewedOn',s_today::text)
      OR NOT openerp.subledger_estimate_current(NEW.book_id,NEW.body) THEN
      PERFORM openerp.fail('StaleDependency','Lifetime review must preserve every historical prefix byte and conserve the exact retained net carrying basis.'); END IF;
    RETURN NEW;
  END IF;
  s_first:=(NEW.body->'amendment'->'input'->>'firstOrdinal')::integer;
  IF s_first IS NULL OR s_first NOT BETWEEN 1 AND jsonb_array_length(s_current->'occurrences') THEN
    PERFORM openerp.fail('InvalidJournal','Select the complete remaining suffix.'); END IF;
  IF s_estimate THEN
    IF NEW.body->'terms'->>'allocationPolicy' IS DISTINCT FROM 'explicit_remaining_minor_v1'
      OR (NEW.body->'terms'-ARRAY['periods','residualMinor','allocationPolicy'])
        IS DISTINCT FROM (s_current->'terms'-ARRAY['periods','residualMinor','allocationPolicy']) THEN
      PERFORM openerp.fail('UnsupportedProfile','An estimate may change only future amounts/dates and residual under the explicit synthetic policy.'); END IF;
  ELSE
    IF (NEW.body->'terms'-'periods') IS DISTINCT FROM (s_current->'terms'-'periods')
      OR NEW.body->>'allocatedMinor' IS DISTINCT FROM s_current->>'allocatedMinor' THEN
      PERFORM openerp.fail('UnsupportedProfile','Date-only amendments cannot change financial terms or allocation.'); END IF;
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(NEW.body->'occurrences') WITH ORDINALITY o(value,n)
      WHERE (o.n<s_first AND o.value IS DISTINCT FROM s_current->'occurrences'->(o.n::integer-1))
        OR (o.value-CASE WHEN s_estimate THEN ARRAY['postingDate','accountingPeriodId','amountMinor']
          ELSE ARRAY['postingDate','accountingPeriodId'] END) IS DISTINCT FROM
          ((s_current->'occurrences'->(o.n::integer-1))-CASE WHEN s_estimate
            THEN ARRAY['postingDate','accountingPeriodId','amountMinor'] ELSE ARRAY['postingDate','accountingPeriodId'] END))
    OR NOT openerp.subledger_estimate_current(NEW.book_id,NEW.body) THEN
    PERFORM openerp.fail('StaleDependency','Posted history must remain unchanged and the live recognized, future, impairment and residual amounts must conserve the retained cost.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.subledger_check_disposal(p_book text, p_change text, p_action jsonb) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE d_review openerp.subledger_disposal_reviews;
BEGIN
  SELECT * INTO d_review FROM openerp.subledger_disposal_reviews r WHERE r.book_id=p_book AND r.change_set_id=p_change;
  IF FOUND THEN
    IF p_action IS DISTINCT FROM d_review.body->'postingPlan'->'groups'->0->'actions'->0 THEN
      PERFORM openerp.fail('StaleDependency','The disposal action must be the exact retained native plan.'); END IF;
    -- Allow a deferred proposal check to see its own completed aggregate in a compound transaction.
    -- Kernel duplicate constraints still forbid another voucher for this settled change set.
    IF EXISTS(SELECT FROM openerp.subledger_disposals d JOIN openerp.execution_receipts e
      ON e.book_id=d.book_id AND e.id=d.posting_receipt_id WHERE d.book_id=p_book
      AND d.review_id=d_review.id AND e.change_set_id=p_change) THEN RETURN; END IF;
    IF openerp.subledger_disposal_basis(p_book,d_review.body->'input') IS DISTINCT FROM d_review.body->'basis' THEN
      PERFORM openerp.fail('StaleDependency','The disposal carrying basis or posting/reversal history changed. Prepare and approve a new review.'); END IF;
    RETURN;
  END IF;
  IF EXISTS(
    WITH RECURSIVE origins(change_set_id) AS (
      SELECT p_change UNION SELECT v.change_set_id FROM origins o
      JOIN openerp.correction_bundles c ON c.book_id=p_book AND c.replacement_change_set_id=o.change_set_id
      JOIN openerp.vouchers v ON v.book_id=c.book_id AND v.id=c.original_voucher_id
    ) SELECT FROM openerp.subledger_disposal_reviews r WHERE r.book_id=p_book
      AND (r.change_set_id IN(SELECT change_set_id FROM origins)
        OR r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=p_book AND e.id=p_action->>'eventId')
        OR EXISTS(SELECT FROM jsonb_array_elements(p_action->'evidenceRefs') e WHERE e->>'evidenceId'=r.evidence_id))
  ) THEN PERFORM openerp.fail('UnsupportedProfile','Owned disposal evidence and correction ancestry require their complete native disposal aggregate. Generic replacement or reversal is unsupported.'); END IF;
  IF p_action->>'correctsVoucherId' IS NOT NULL AND EXISTS(
    SELECT FROM openerp.subledger_disposals d JOIN openerp.subledger_disposal_reviews r ON r.book_id=d.book_id AND r.id=d.review_id
    WHERE d.book_id=p_book AND (p_action->>'correctsVoucherId'=r.body->'basis'->'carryingBasis'->'input'->>'voucherId'
      OR EXISTS(SELECT FROM jsonb_array_elements(r.body->'basis'->'occurrences') o
        WHERE p_action->>'correctsVoucherId' IN(o->>'voucherId',o->>'reversalVoucherId')))
  ) THEN PERFORM openerp.fail('UnsupportedProfile','A disposed asset freezes its represented acquisition and recognition history. A register-aware disposal correction is not implemented.'); END IF;
END $$;
CREATE FUNCTION openerp.subledger_check_impairment(p_book text, p_change text, p_action jsonb) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE i_review jsonb;
BEGIN
  SELECT r.body INTO i_review FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_book
    AND (r.change_set_id=p_change OR r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e
      WHERE e.book_id=p_book AND e.id=p_action->>'eventId')
      OR EXISTS(SELECT FROM jsonb_array_elements(p_action->'evidenceRefs') x WHERE x->>'evidenceId'=r.evidence_id));
  IF FOUND THEN
    IF p_action IS DISTINCT FROM i_review->'postingPlan'->'groups'->0->'actions'->0
      OR openerp.subledger_impairment_basis(p_book,i_review->'input') IS DISTINCT FROM i_review->'basis' THEN
      PERFORM openerp.fail('StaleDependency','The impairment action and complete reviewed aggregate must remain current.'); END IF;
    RETURN;
  END IF;
  IF p_action->>'correctsVoucherId' IS NOT NULL AND EXISTS(
    SELECT FROM openerp.subledger_impairment_schedule_for_voucher(p_book,p_action->>'correctsVoucherId')) THEN
    PERFORM openerp.fail('UnsupportedProfile','This voucher is consumed by an asset impairment. Generic reversal or replacement is blocked; a complete owned correction is required.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_impairment_reviews r WHERE r.book_id=p_book AND
      (r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=p_book AND e.id=p_action->>'eventId')
        OR EXISTS(SELECT FROM jsonb_array_elements(p_action->'evidenceRefs') x WHERE x->>'evidenceId'=r.evidence_id))) THEN
    PERFORM openerp.fail('UnsupportedProfile','Impairment review evidence cannot be reused by a generic proposal or correction.'); END IF;
END $$;
CREATE FUNCTION openerp.subledger_check_posting_basis(p_book text, p_change text, p_action jsonb) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE s_preparation openerp.subledger_preparations; s_basis jsonb;
BEGIN
  PERFORM openerp.subledger_check_impairment(p_book,p_change,p_action);
  PERFORM openerp.subledger_check_disposal(p_book,p_change,p_action);
  IF p_action->>'postingPurpose'='reversal' AND p_action->>'correctsVoucherId' IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO s_preparation FROM openerp.subledger_preparations p WHERE p.book_id=p_book AND p.change_set_id=p_change;
  IF FOUND THEN
    s_basis:=openerp.subledger_posting_basis(p_book,s_preparation.schedule_id);
    IF s_basis->>'supported' IS DISTINCT FROM 'true' THEN
      PERFORM openerp.fail('StaleDependency','The linked carrying basis is reversed, corrected, disposed or mismatched. Further recognition is blocked; inspect the retained basis and controls.'); END IF;
    IF s_preparation.basis_dependency IS DISTINCT FROM s_basis
      AND NOT(s_preparation.basis_dependency IS NULL AND s_basis->>'mode'='standalone_synthetic') THEN
      PERFORM openerp.fail('StaleDependency','This proposal did not capture the current carrying basis. Prepare the occurrence again and obtain a new human approval.'); END IF;
    RETURN;
  END IF;
  IF EXISTS(
    WITH RECURSIVE origin_changes(change_set_id) AS (
      SELECT p_change
      UNION
      SELECT v.change_set_id FROM origin_changes o JOIN openerp.correction_bundles c ON c.book_id=p_book AND c.replacement_change_set_id=o.change_set_id
        JOIN openerp.vouchers v ON v.book_id=c.book_id AND v.id=c.original_voucher_id
    ), origin_events(event_id) AS (
      SELECT p_action->>'eventId'
      UNION
      SELECT v.event_id FROM origin_changes o JOIN openerp.vouchers v ON v.book_id=p_book AND v.change_set_id=o.change_set_id
    )
    SELECT FROM openerp.subledger_bases b JOIN openerp.subledger_schedule_revisions r ON r.book_id=b.book_id AND r.schedule_id=b.schedule_id
      JOIN openerp.events e ON e.book_id=r.book_id AND e.evidence_id=r.evidence_id JOIN origin_events source ON source.event_id=e.id
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
    WHERE b.book_id=p_book AND e.event_key=o->>'eventKey') THEN
    PERFORM openerp.fail('StaleDependency','This event belongs to a basis-linked schedule. Use native occurrence preparation; generic replacement recognition is unsupported.');
  END IF;
END $$;
CREATE FUNCTION openerp.subledger_current(book text, schedule_id text) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE sl_body jsonb;
BEGIN
  SELECT r.body INTO sl_body FROM openerp.subledger_schedule_revisions r
    WHERE r.book_id=book AND r.schedule_id=subledger_current.schedule_id ORDER BY r.revision DESC LIMIT 1;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The schedule was not found in this book.'); END IF;
  RETURN sl_body;
END $$;
CREATE FUNCTION openerp.subledger_disposal_aggregate_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.subledger_disposal_reviews r WHERE r.book_id=NEW.book_id
    AND (r.change_set_id=NEW.change_set_id
      OR r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
      OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') e WHERE e->>'evidenceId'=r.evidence_id)))
    AND NOT EXISTS(SELECT FROM openerp.subledger_disposals d
      JOIN openerp.subledger_disposal_reviews r ON r.book_id=d.book_id AND r.id=d.review_id
      JOIN openerp.execution_receipts e ON e.book_id=d.book_id AND e.id=d.posting_receipt_id
      WHERE d.book_id=NEW.book_id AND r.change_set_id=NEW.change_set_id AND e.voucher_id=NEW.id
        AND d.posting_date=NEW.posting_date AND NEW.action=r.body->'postingPlan'->'groups'->0->'actions'->0) THEN
    PERFORM openerp.fail('ApprovalRequired','The disposal journal and immutable schedule consequence must commit through operator-only disposal execution.'); END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.subledger_disposal_basis(p_book text, p_input jsonb) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE
  d_schedule jsonb; d_basis jsonb; d_states jsonb; d_source openerp.evidence; d_review openerp.evidence;
  d_impairment_accounts jsonb; d_date date; d_gross numeric; d_opening numeric; d_recognized numeric;
  d_reversed numeric; d_impairment numeric; d_carrying numeric;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  d_schedule:=openerp.subledger_current(p_book,p_input->>'scheduleId');
  SELECT b.body INTO d_basis FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.schedule_id=p_input->>'scheduleId';
  IF d_basis IS NULL OR d_schedule->'terms'->>'kind'<>'asset' THEN
    PERFORM openerp.fail('UnsupportedProfile','Disposal supports only an asset with a retained gross and accumulated carrying basis.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book AND d.schedule_id=p_input->>'scheduleId') THEN
    PERFORM openerp.fail('AlreadyPosted','This schedule already has an immutable disposal. Recover its retained result.'); END IF;
  IF p_input->>'expectedDigest' IS DISTINCT FROM d_schedule->>'digest'
    OR p_input->>'expectedBasisDigest' IS DISTINCT FROM d_basis->>'digest'
    OR NOT openerp.subledger_basis_matches_revision(d_basis,d_schedule)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.corrects_voucher_id=d_basis->'input'->>'voucherId') THEN
    PERFORM openerp.fail('StaleDependency','Review the current post-impairment schedule and intact original carrying basis.'); END IF;
  d_date:=openerp.bank_date(p_input->>'postingDate');
  IF d_date<(d_basis->'input'->>'effectiveOn')::date THEN
    PERFORM openerp.fail('InvalidJournal','Disposal cannot precede its retained acquisition or imported basis.'); END IF;
  d_states:=openerp.subledger_occurrence_states(p_book,d_schedule,'9999-12-31'::date);
  IF jsonb_array_length(d_states)<>jsonb_array_length(d_schedule->'occurrences')
    OR EXISTS(SELECT FROM jsonb_array_elements(d_states) o WHERE o->>'state' NOT IN('unprepared','prepared','posted','reversed')
      OR (o->>'state' IN('unprepared','prepared') AND (o->>'postingDate')::date<d_date)
      OR (o->>'state' IN('posted','reversed') AND (o->>'postingDate')::date>d_date)
      OR (o->>'state'='reversed' AND NOT EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book
        AND v.id=o->>'reversalVoucherId' AND v.posting_purpose='reversal' AND v.posting_date<=d_date))
      OR EXISTS(SELECT FROM openerp.correction_bundles c JOIN openerp.vouchers v
        ON v.book_id=c.book_id AND v.change_set_id=c.replacement_change_set_id
        WHERE c.book_id=p_book AND c.original_voucher_id=o->>'voucherId')) THEN
    PERFORM openerp.fail('UnsupportedProfile','Resolve ambiguous history, later postings, reversals and earlier due occurrences before disposal.'); END IF;
  SELECT coalesce(sum((o->>'amountMinor')::numeric) FILTER(WHERE o->>'state'='posted'),0),
    coalesce(sum((o->>'amountMinor')::numeric) FILTER(WHERE o->>'state'='reversed'),0)
    INTO d_recognized,d_reversed FROM jsonb_array_elements(d_states) o;
  d_gross:=(d_basis->'input'->>'originalCostMinor')::numeric;
  d_opening:=(d_basis->'input'->>'accumulatedMinor')::numeric;
  SELECT coalesce(sum(i.impairment_minor),0),coalesce(jsonb_agg(DISTINCT i.accumulated_impairment_account_id),'[]')
    INTO d_impairment,d_impairment_accounts FROM openerp.subledger_impairments i
    WHERE i.book_id=p_book AND i.schedule_id=p_input->>'scheduleId';
  IF EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=p_book
      AND i.schedule_id=p_input->>'scheduleId' AND i.posting_date>d_date) THEN
    PERFORM openerp.fail('StaleDependency','A later impairment already changes the current carrying value.'); END IF;
  d_carrying:=d_gross-d_opening-d_recognized-d_impairment;
  IF d_carrying<0 OR d_gross<>d_opening+(d_schedule->'terms'->>'costMinor')::numeric
    OR (SELECT coalesce(sum((l->>'debitMinor')::numeric),0) FROM jsonb_array_elements(d_basis->'lines') l)<>d_gross
    OR (SELECT coalesce(sum((l->>'creditMinor')::numeric),0) FROM jsonb_array_elements(d_basis->'lines') l)<>d_opening
    OR EXISTS(SELECT FROM jsonb_array_elements(d_basis->'lines') l WHERE
      ((l->>'debitMinor')::numeric>0 AND l->>'accountId'=d_schedule->'terms'->>'creditAccountId')
      OR ((l->>'creditMinor')::numeric>0 AND l->>'accountId'<>'creditAccountId')
      OR NOT EXISTS(SELECT FROM openerp.journal_lines j WHERE j.book_id=p_book AND j.voucher_id=d_basis->'input'->>'voucherId'
        AND j.id=l->>'lineId' AND j.ordinal=(l->>'ordinal')::integer AND j.account_id=l->>'accountId'
        AND j.debit_minor=(l->>'debitMinor')::numeric AND j.credit_minor=(l->>'creditMinor')::numeric)) THEN
    PERFORM openerp.fail('UnsupportedProfile','Disposal requires intact gross, ordinary accumulated and post-impairment carrying controls.'); END IF;
  IF p_input->>'lossAccountId'=d_schedule->'terms'->>'creditAccountId'
    OR (d_impairment>0 AND p_input->>'lossAccountId'=d_impairment_accounts->>0)
    OR EXISTS(SELECT FROM openerp.subledger_bases b CROSS JOIN LATERAL jsonb_array_elements(b.body->'lines') l
      WHERE b.book_id=p_book AND l->>'accountId'=p_input->>'lossAccountId')
    OR EXISTS(SELECT FROM openerp.subledger_schedules s WHERE s.book_id=p_book
      AND openerp.subledger_current(p_book,s.id)->'terms'->>'creditAccountId'=p_input->>'lossAccountId') THEN
    PERFORM openerp.fail('InvalidJournal','Choose a disposal loss account distinct from every carrying and impairment control.'); END IF;
  IF EXISTS(WITH accounts AS (
      SELECT l->>'accountId' id FROM jsonb_array_elements(d_basis->'lines') l
      UNION SELECT d_schedule->'terms'->>'creditAccountId' UNION SELECT p_input->>'lossAccountId'
      UNION SELECT jsonb_array_elements_text(d_impairment_accounts)) SELECT FROM accounts a WHERE
      EXISTS(SELECT FROM openerp.bank_sources b WHERE b.book_id=p_book AND b.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.owner_control_accounts o WHERE o.book_id=p_book AND o.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.tax_account_sources t WHERE t.book_id=p_book AND t.account_id=a.id)
      OR EXISTS(SELECT FROM openerp.vat_control_account_roles v WHERE v.book_id=p_book AND v.account_id=a.id)
      OR NOT EXISTS(SELECT FROM openerp.accounts x WHERE x.book_id=p_book AND x.id=a.id AND x.active)) THEN
    PERFORM openerp.fail('InvalidJournal','Disposal accounts must be active and cannot be known bank, commerce, owner, VAT or tax controls.'); END IF;
  SELECT * INTO d_source FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'evidenceId';
  SELECT * INTO d_review FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'reviewEvidenceId';
  IF d_source.id IS NULL OR d_review.id IS NULL THEN
    PERFORM openerp.fail('MissingEvidence','Retain disposal source and review evidence in this book.'); END IF;
  RETURN jsonb_build_object('schedule',d_schedule,'carryingBasis',d_basis,'occurrences',d_states,
    'originalCostMinor',d_gross::text,'openingAccumulatedMinor',d_opening::text,'recognizedMinor',d_recognized::text,
    'reversedMinor',d_reversed::text,'impairmentMinor',d_impairment::text,
    'impairmentAccountId',CASE WHEN d_impairment>0 THEN d_impairment_accounts->>0 ELSE NULL END,
    'totalAccumulatedMinor',(d_opening+d_recognized)::text,'carryingMinor',d_carrying::text,
    'sourceSha256',d_source.sha256,'reviewSha256',d_review.sha256);
END $$;
CREATE FUNCTION openerp.subledger_disposal_basis_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.vouchers v JOIN openerp.subledger_disposal_reviews r
    ON r.book_id=v.book_id AND r.change_set_id=v.change_set_id WHERE v.book_id=NEW.book_id AND v.id=NEW.voucher_id) THEN
    PERFORM openerp.fail('UnsupportedProfile','A disposal release or loss voucher cannot establish another acquisition or imported carrying basis.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.subledger_disposal_revision_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=NEW.book_id AND d.schedule_id=NEW.schedule_id) THEN
    PERFORM openerp.fail('UnsupportedProfile','A disposed schedule retains its full history but cannot recognize or amend remaining installments.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.subledger_estimate_current(p_book text, p_schedule jsonb) RETURNS boolean
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE s_states jsonb; s_effective numeric; s_impairment numeric;
BEGIN
  IF p_schedule->'terms'->>'allocationPolicy' IS DISTINCT FROM 'explicit_remaining_minor_v1' THEN RETURN true; END IF;
  s_states:=openerp.subledger_occurrence_states(p_book,p_schedule,'9999-12-31'::date);
  IF jsonb_array_length(s_states)<>jsonb_array_length(p_schedule->'occurrences')
    OR EXISTS(SELECT FROM jsonb_array_elements(s_states) o WHERE o->>'state' NOT IN('unprepared','prepared','posted','reversed')
      OR (o->>'state'='reversed' AND NOT EXISTS(SELECT FROM openerp.vouchers v
        WHERE v.book_id=p_book AND v.id=o->>'reversalVoucherId' AND v.posting_purpose='reversal'))
      OR EXISTS(SELECT FROM openerp.correction_bundles c JOIN openerp.vouchers v
        ON v.book_id=c.book_id AND v.change_set_id=c.replacement_change_set_id
        WHERE c.book_id=p_book AND c.original_voucher_id=o->>'voucherId')) THEN RETURN false; END IF;
  SELECT coalesce(sum((o->>'amountMinor')::numeric),0) INTO s_effective
    FROM jsonb_array_elements(s_states) o WHERE o->>'state'<>'reversed';
  SELECT coalesce(sum(e.impairment_minor),0) INTO s_impairment
    FROM openerp.subledger_impairments e WHERE e.book_id=p_book AND e.schedule_id=p_schedule->>'scheduleId';
  IF p_schedule->'amendment'->>'kind'='impairment_v1' THEN
    s_impairment:=(p_schedule->'amendment'->>'netImpairmentMinor')::numeric;
  END IF;
  RETURN s_effective+s_impairment+(p_schedule->'terms'->>'residualMinor')::numeric=(p_schedule->'terms'->>'costMinor')::numeric
    AND s_effective=(p_schedule->>'allocatedMinor')::numeric;
END $$;
CREATE FUNCTION openerp.subledger_impairment_aggregate_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE i_review jsonb;
BEGIN
  SELECT r.body INTO i_review FROM openerp.subledger_impairment_reviews r WHERE r.book_id=NEW.book_id
    AND (r.change_set_id=NEW.change_set_id
      OR r.evidence_id IN(SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
      OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') x WHERE x->>'evidenceId'=r.evidence_id));
  IF FOUND AND (NEW.action IS DISTINCT FROM i_review->'postingPlan'->'groups'->0->'actions'->0
    OR NOT EXISTS(SELECT FROM openerp.subledger_impairments i JOIN openerp.execution_receipts e
      ON e.book_id=i.book_id AND e.id=i.posting_receipt_id
      WHERE i.book_id=NEW.book_id AND i.review_id=i_review->>'id' AND e.voucher_id=NEW.id
        AND e.change_set_id=NEW.change_set_id AND i.schedule_id=i_review->'input'->>'scheduleId'
        AND EXISTS(SELECT FROM openerp.subledger_schedule_revisions r WHERE r.book_id=i.book_id
          AND r.schedule_id=i.schedule_id AND r.body=i_review->'proposedRevision'))) THEN
    PERFORM openerp.fail('ApprovalRequired','The impairment journal, immutable effect and complete revised schedule must commit through operator-only execution.'); END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.subledger_impairment_basis(p_book text, p_input jsonb) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE
  i_current jsonb; i_basis jsonb; i_states jsonb; i_state jsonb; i_source openerp.evidence; i_review openerp.evidence;
  i_date date; i_last date; i_reversal_date date; i_seen_suffix boolean:=false;
  i_reversed numeric:=0; i_recognized numeric:=0; i_prior numeric; i_carrying numeric;
  i_post numeric; i_future numeric; i_impairment numeric; i_residual numeric; i_sum numeric:=0;
  i_installation jsonb; i_count integer;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  i_current:=openerp.subledger_current(p_book,p_input->>'scheduleId');
  SELECT b.body INTO i_basis FROM openerp.subledger_bases b
    WHERE b.book_id=p_book AND b.schedule_id=p_input->>'scheduleId';
  IF i_basis IS NULL OR i_current->'terms'->>'kind'<>'asset' THEN
    PERFORM openerp.fail('UnsupportedProfile','Impairment supports only a native asset with a retained gross and accumulated carrying basis.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book AND d.schedule_id=p_input->>'scheduleId') THEN
    PERFORM openerp.fail('AlreadyPosted','This schedule is disposed and cannot be impaired.'); END IF;
  IF p_input->>'profile' IS DISTINCT FROM 'synthetic_asset_impairment_v1'
    OR p_input->'acknowledgeSyntheticOnly' IS DISTINCT FROM 'true'::jsonb
    OR p_input->>'taxAssessment' IS DISTINCT FROM 'not_applicable'
    OR p_input->>'expectedDigest' IS DISTINCT FROM i_current->>'digest'
    OR p_input->>'expectedBasisDigest' IS DISTINCT FROM i_basis->>'digest'
    OR NOT openerp.subledger_basis_matches_revision(i_basis,i_current)
    OR openerp.subledger_posting_basis(p_book,p_input->>'scheduleId')->>'supported' IS DISTINCT FROM 'true' THEN
    PERFORM openerp.fail('StaleDependency','Review the current schedule, carrying basis and post-impairment schedule before impairment.'); END IF;
  i_date:=openerp.bank_date(p_input->>'postingDate');
  IF i_date<(i_basis->'input'->>'effectiveOn')::date THEN
    PERFORM openerp.fail('InvalidJournal','Impairment cannot precede its retained acquisition or imported basis.'); END IF;
  i_states:=openerp.subledger_occurrence_states(p_book,i_current,'9999-12-31'::date);
  IF jsonb_array_length(i_states)<>jsonb_array_length(i_current->'occurrences')
    OR EXISTS(SELECT FROM jsonb_array_elements(i_states) state
      WHERE state->>'state' NOT IN('unprepared','prepared','posted','reversed'))
    OR EXISTS(SELECT FROM jsonb_array_elements(i_states) state
      WHERE state->>'state'='reversed' AND NOT EXISTS(
        SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=state->>'reversalVoucherId'
          AND v.posting_purpose='reversal')) THEN
    PERFORM openerp.fail('UnsupportedProfile','Resolve ambiguous or unsupported occurrence history before impairment.'); END IF;
  FOR i_state IN SELECT value FROM jsonb_array_elements(i_states) LOOP
    IF NOT i_seen_suffix AND i_state->>'state' IN('posted','reversed') THEN
      IF i_state->>'state'='posted' THEN
        i_recognized:=i_recognized+(i_state->>'amountMinor')::numeric;
      ELSE
        i_reversed:=i_reversed+(i_state->>'amountMinor')::numeric;
        SELECT v.posting_date INTO i_reversal_date FROM openerp.vouchers v
          WHERE v.book_id=p_book AND v.id=i_state->>'reversalVoucherId';
      END IF;
      i_last:=greatest(i_last,i_state->>'postingDate'::date,i_reversal_date);
      i_reversal_date:=NULL;
    ELSE
      i_seen_suffix:=true;
      IF i_state->>'state' NOT IN('unprepared','prepared') THEN
        PERFORM openerp.fail('UnsupportedProfile','Every occurrence after the consumed prefix must be wholly unposted and unprepared or prepared.'); END IF;
    END IF;
  END LOOP;
  IF NOT i_seen_suffix OR (i_last IS NOT NULL AND i_date<i_last)
    OR EXISTS(SELECT FROM jsonb_array_elements(i_states) state JOIN openerp.correction_bundles c
      ON c.book_id=p_book AND c.original_voucher_id=state->>'voucherId'
      WHERE state->>'voucherId' IS NOT NULL) THEN
    PERFORM openerp.fail('UnsupportedProfile','A complete future suffix is required and consumed correction replacement history is unsupported.'); END IF;
  SELECT coalesce(sum(e.impairment_minor),0) INTO i_prior
    FROM openerp.subledger_impairments e WHERE e.book_id=p_book AND e.schedule_id=p_input->>'scheduleId';
  IF EXISTS(SELECT FROM openerp.subledger_impairments e WHERE e.book_id=p_book
      AND e.schedule_id=p_input->>'scheduleId' AND e.posting_date>i_date) THEN
    PERFORM openerp.fail('StaleDependency','A later impairment already changes this schedule. Review the current carrying amount.'); END IF;
  i_impairment:=(p_input->>'impairmentMinor')::numeric;
  i_residual:=(p_input->>'residualMinor')::numeric;
  i_carrying:=(i_basis->'input'->>'carryingMinor')::numeric-i_recognized-i_prior;
  i_post:=i_carrying-i_impairment;
  i_future:=i_post-i_residual;
  IF i_impairment<=0 OR i_impairment>=i_carrying OR i_post<=0 OR i_future<=0
    OR p_input->>'futureMinor' IS DISTINCT FROM i_future::text
    OR jsonb_typeof(p_input->'installments') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Impairment must be positive and below current carrying, with positive post-impairment carrying, future installments and nonnegative residual.'); END IF;
  i_count:=jsonb_array_length(p_input->'installments');
  IF i_count NOT BETWEEN 1 AND 120 THEN
    PERFORM openerp.fail('InvalidJournal','Supply at least one and at most120 complete future installments.'); END IF;
  FOR i_installation IN SELECT value FROM jsonb_array_elements(p_input->'installments') LOOP
    PERFORM openerp.commerce_exact_object(i_installation,ARRAY['postingDate','accountingPeriodId','amountMinor']);
    IF jsonb_typeof(i_installation->'amountMinor') IS DISTINCT FROM 'string'
      OR coalesce(i_installation->>'amountMinor','') !~ '^[1-9][0-9]{0,37}$' THEN
      PERFORM openerp.fail('InvalidJournal','Each future impairment installment needs a positive canonical minor-unit amount.'); END IF;
    i_sum:=i_sum+(i_installation->>'amountMinor')::numeric;
  END LOOP;
  IF i_sum<>i_future THEN
    PERFORM openerp.fail('InvalidJournal','The complete future suffix must sum exactly to post-impairment carrying less residual.'); END IF;
  IF p_input->>'lossAccountId'=p_input->>'accumulatedImpairmentAccountId'
    OR p_input->>'lossAccountId' IN(i_current->'terms'->>'debitAccountId',i_current->'terms'->>'creditAccountId')
    OR p_input->>'accumulatedImpairmentAccountId' IN(i_current->'terms'->>'debitAccountId',i_current->'terms'->>'creditAccountId')
    OR EXISTS(SELECT FROM jsonb_array_elements(i_basis->'lines') l
      WHERE l->>'accountId' IN(p_input->>'lossAccountId',p_input->>'accumulatedImpairmentAccountId'))
    OR (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=p_book AND a.active
      AND a.id IN(p_input->>'lossAccountId',p_input->>'accumulatedImpairmentAccountId'))<>2 THEN
    PERFORM openerp.fail('InvalidJournal','Select distinct active impairment roles outside all ordinary schedule and carrying controls.'); END IF;
  IF EXISTS(WITH ids AS (
      SELECT p_input->>'lossAccountId' id UNION SELECT p_input->>'accumulatedImpairmentAccountId'
      UNION SELECT i_current->'terms'->>'debitAccountId' UNION SELECT i_current->'terms'->>'creditAccountId'
      UNION SELECT l->>'accountId' FROM jsonb_array_elements(i_basis->'lines') l
    ) SELECT FROM ids x WHERE
      EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.owner_control_accounts c WHERE c.book_id=p_book AND c.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.tax_account_sources t WHERE t.book_id=p_book AND t.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.vat_control_account_roles v WHERE v.book_id=p_book AND v.account_id=x.id)
      OR EXISTS(SELECT FROM openerp.subledger_impairments e WHERE e.book_id=p_book
        AND e.schedule_id=p_input->>'scheduleId'
        AND e.accumulated_impairment_account_id<>p_input->>'accumulatedImpairmentAccountId'
        AND e.accumulated_impairment_account_id=x.id)) THEN
    PERFORM openerp.fail('InvalidJournal','Impairment roles must be distinct from known controls and retain one accumulated-impairment account per schedule.'); END IF;
  SELECT * INTO i_source FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'evidenceId';
  SELECT * INTO i_review FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_input->>'reviewEvidenceId';
  IF i_source.id IS NULL OR i_review.id IS NULL THEN
    PERFORM openerp.fail('MissingEvidence','Retain impairment source and review evidence in this book.'); END IF;
  RETURN jsonb_build_object('schedule',i_current,'carryingBasis',i_basis,'occurrences',i_states,
    'originalCostMinor',i_basis->'input'->>'originalCostMinor','openingAccumulatedMinor',i_basis->'input'->>'accumulatedMinor',
    'recognizedMinor',i_recognized::text,'reversedMinor',i_reversed::text,'priorImpairmentMinor',i_prior::text,
    'currentCarryingMinor',i_carrying::text,'postImpairmentCarryingMinor',i_post::text,'futureMinor',i_future::text,
    'residualMinor',i_residual::text,'sourceSha256',i_source.sha256,'reviewSha256',i_review.sha256);
END $$;
CREATE FUNCTION openerp.subledger_impairment_schedule_for_voucher(p_book text, p_voucher text) RETURNS TABLE(schedule_id text)
  SECURITY INVOKER
  LANGUAGE sql
  STABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

  SELECT DISTINCT x.schedule_id COLLATE "C" FROM (
    SELECT e.schedule_id FROM openerp.subledger_impairments e WHERE e.book_id=p_book AND e.voucher_id=p_voucher
    UNION ALL
    SELECT b.schedule_id FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.voucher_id=p_voucher
      AND EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=b.book_id AND i.schedule_id=b.schedule_id)
    UNION ALL
    SELECT r.schedule_id FROM openerp.subledger_schedule_revisions r
      JOIN openerp.events e ON e.book_id=r.book_id AND e.evidence_id=r.evidence_id
      JOIN openerp.vouchers v ON v.book_id=e.book_id AND v.event_id=e.id AND v.id=p_voucher
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
      WHERE r.book_id=p_book AND e.event_key=o->>'eventKey'
        AND EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=r.book_id AND i.schedule_id=r.schedule_id)
    UNION ALL
    SELECT r.schedule_id FROM openerp.vouchers original
      JOIN openerp.events e ON e.book_id=original.book_id AND e.id=original.event_id
      JOIN openerp.vouchers reversal ON reversal.book_id=original.book_id
        AND reversal.corrects_voucher_id=original.id AND reversal.id=p_voucher
      JOIN openerp.subledger_schedule_revisions r ON r.book_id=e.book_id AND r.evidence_id=e.evidence_id
      CROSS JOIN LATERAL jsonb_array_elements(r.body->'occurrences') o
      WHERE original.book_id=p_book AND e.event_key=o->>'eventKey'
        AND EXISTS(SELECT FROM openerp.subledger_impairments i WHERE i.book_id=r.book_id AND i.schedule_id=r.schedule_id)
  ) x ORDER BY x.schedule_id COLLATE "C"
$$;
CREATE FUNCTION openerp.subledger_occurrence_states(book text, schedule jsonb, through_date date) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE sql
  STABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

  SELECT coalesce(jsonb_agg(o.value||jsonb_build_object(
    'changeSetId',coalesce(posted_plan.id,c.id),'planDigest',coalesce(posted_plan.digest,c.digest),'voucherId',v.id,'reversalVoucherId',rv.id,
    'state',CASE WHEN v.id IS NOT NULL AND NOT EXISTS(SELECT FROM openerp.subledger_preparations linked
          WHERE linked.book_id=book AND linked.schedule_id=schedule->>'scheduleId'
            AND linked.ordinal=(o.value->>'ordinal')::integer AND linked.change_set_id=v.change_set_id) THEN 'conflicted'
      WHEN rv.id IS NOT NULL THEN 'reversed' WHEN v.id IS NOT NULL THEN 'posted'
      WHEN c.id IS NOT NULL THEN 'prepared' ELSE 'unprepared' END) ORDER BY (o.value->>'ordinal')::integer),'[]')
  FROM jsonb_array_elements(schedule->'occurrences') o(value)
  LEFT JOIN LATERAL(SELECT p.change_set_id FROM openerp.subledger_preparations p
    JOIN openerp.subledger_schedule_revisions r ON r.book_id=p.book_id AND r.schedule_id=p.schedule_id AND r.revision=p.revision
    WHERE p.book_id=book AND p.schedule_id=schedule->>'scheduleId' AND p.ordinal=(o.value->>'ordinal')::integer
      AND r.evidence_id=schedule->'terms'->>'evidenceId'
      AND r.body->'occurrences'->(p.ordinal-1)->>'ordinal'=o.value->>'ordinal'
      AND r.body->'occurrences'->(p.ordinal-1)->>'eventKey'=o.value->>'eventKey'
    ORDER BY p.attempt DESC LIMIT 1) prep ON true
  LEFT JOIN openerp.change_sets c ON c.book_id=book AND c.id=prep.change_set_id
  LEFT JOIN openerp.events e ON e.book_id=book AND e.evidence_id=schedule->'terms'->>'evidenceId' AND e.event_key=o.value->>'eventKey'
  LEFT JOIN openerp.vouchers v ON v.book_id=book AND v.event_id=e.id AND v.posting_purpose='adjustment'
    AND v.occurrence_key='manual_journal' AND v.posting_date<=through_date
  LEFT JOIN openerp.change_sets posted_plan ON posted_plan.book_id=book AND posted_plan.id=v.change_set_id
  LEFT JOIN openerp.vouchers rv ON rv.book_id=book AND rv.corrects_voucher_id=v.id AND rv.posting_date<=through_date
  WHERE (o.value->>'postingDate')::date<=through_date
$$;
CREATE FUNCTION openerp.subledger_posting_basis(p_book text, p_schedule text) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE s_basis openerp.subledger_bases; s_current jsonb; s_blocker text; s_result jsonb;
BEGIN
  s_current:=openerp.subledger_current(p_book,p_schedule);
  SELECT * INTO s_basis FROM openerp.subledger_bases b WHERE b.book_id=p_book AND b.schedule_id=p_schedule;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('mode','standalone_synthetic','supported',true,'basisDigest',NULL,'basisVoucherId',NULL,
      'blocker',NULL,'legalPolicyApproved',false);
  END IF;
  IF EXISTS(SELECT FROM openerp.subledger_disposals d WHERE d.book_id=p_book AND d.schedule_id=p_schedule) THEN s_blocker:='disposed';
  ELSIF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.corrects_voucher_id=s_basis.voucher_id) THEN s_blocker:='basis_reversed_or_corrected';
  ELSIF NOT openerp.subledger_basis_matches_revision(s_basis.body,s_current) THEN s_blocker:='basis_mismatch';
  ELSIF NOT openerp.subledger_estimate_current(p_book,s_current) THEN s_blocker:='estimate_history_changed'; END IF;
  s_result:=jsonb_build_object('mode','linked_basis','supported',s_blocker IS NULL,'basisDigest',s_basis.body->>'digest',
    'basisVoucherId',s_basis.voucher_id,'blocker',s_blocker,'legalPolicyApproved',false);
  IF s_current ? 'amendment' THEN s_result:=s_result||jsonb_build_object('scheduleDigest',s_current->>'digest'); END IF;
  RETURN s_result;
END $$;
CREATE FUNCTION openerp.supplier_acceptance_guard_draft() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=OLD.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.supplier_acceptances i WHERE i.book_id=OLD.book_id AND i.draft_id=OLD.id) THEN
    PERFORM openerp.fail('Forbidden','This draft has an immutable supplier acceptance. Its content cannot be revised.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.supplier_acceptance_require_aggregate() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.supplier_credit_conserve() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE v_amount numeric; v_credited numeric; v_allocated numeric; v_account text; v_line openerp.journal_lines;
BEGIN
  SELECT i.amount_minor,i.control_account_id INTO v_amount,v_account FROM openerp.commerce_invoices i
    WHERE i.book_id=NEW.book_id AND i.id=NEW.invoice_id AND i.direction='supplier';
  SELECT coalesce(sum(c.amount_minor),0) INTO v_credited FROM openerp.supplier_credits c
    WHERE c.book_id=NEW.book_id AND c.invoice_id=NEW.invoice_id;
  SELECT coalesce(sum(l.amount_minor),0) INTO v_allocated FROM openerp.commerce_active_allocation_legs l
    WHERE l.book_id=NEW.book_id AND l.invoice_id=NEW.invoice_id;
  SELECT * INTO v_line FROM openerp.journal_lines l
    WHERE l.book_id=NEW.book_id AND l.voucher_id=NEW.voucher_id AND l.id=NEW.control_line_id;
  IF v_amount IS NULL OR v_credited+v_allocated>v_amount OR v_line.account_id IS DISTINCT FROM v_account
    OR v_line.debit_minor IS DISTINCT FROM NEW.amount_minor OR v_line.credit_minor IS DISTINCT FROM 0 THEN
    PERFORM openerp.fail('InvalidJournal','The supplier credit and retained payment allocations must conserve the exact original payable and control line.'); END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.supplier_credit_require_aggregate() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL AND EXISTS(SELECT FROM openerp.supplier_credits c
    WHERE c.book_id=NEW.book_id AND c.voucher_id=NEW.corrects_voucher_id) THEN
    PERFORM openerp.fail('StaleDependency','A supplier credit voucher belongs to a retained register effect. Generic reversal is unsupported.');
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.supplier_credit_source_boundary() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF EXISTS(SELECT FROM openerp.supplier_credit_reviews r
    WHERE r.book_id=NEW.book_id AND (r.event_id=NEW.event_id
      OR r.evidence_id IN (SELECT e.evidence_id FROM openerp.events e WHERE e.book_id=NEW.book_id AND e.id=NEW.event_id)
      OR EXISTS(SELECT FROM jsonb_array_elements(NEW.action->'evidenceRefs') ref WHERE ref->>'evidenceId'=r.evidence_id)))
    AND NOT EXISTS(SELECT FROM openerp.supplier_credits c
      JOIN openerp.supplier_credit_reviews r ON (r.book_id,r.id)=(c.book_id,c.review_id)
      WHERE c.book_id=NEW.book_id AND r.change_set_id=NEW.change_set_id AND c.voucher_id=NEW.id) THEN
    PERFORM openerp.fail('ApprovalRequired','This supplier credit source requires its exact approved credit register and posting.');
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.tax_account_capacity_admission() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE t_match openerp.tax_account_matches;t_basis jsonb;
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  SELECT m.* INTO STRICT t_match FROM openerp.tax_account_matches m WHERE m.book_id=NEW.book_id AND m.id=NEW.match_id;
  t_basis:=openerp.tax_account_match_basis(t_match.body->'scope',t_match.body->'input'->'selection');
  IF t_basis IS DISTINCT FROM t_match.body->'basis' OR t_match.event_id<>t_basis->'event'->>'id'
    OR t_match.voucher_id<>t_basis->'line'->>'voucherId' OR t_match.line_id<>t_basis->'line'->>'lineId' THEN
    PERFORM openerp.fail('StaleDependency','The exact retained match basis no longer admits this capacity.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.tax_account_capacity_conservation() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE t_book text;t_match text;
BEGIN
  IF TG_OP='DELETE' THEN t_book:=OLD.book_id;t_match:=OLD.match_id;
  ELSE t_book:=NEW.book_id;
    IF TG_TABLE_NAME='tax_account_matches' THEN t_match:=NEW.id;ELSE t_match:=NEW.match_id;END IF;
  END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=t_book AND c.match_id=t_match)
    = EXISTS(SELECT FROM openerp.tax_account_unmatches u WHERE u.book_id=t_book AND u.match_id=t_match) THEN
    PERFORM openerp.fail('StaleDependency','Every immutable review must have exactly one active reservation or one immutable unmatch, never both.'); END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.tax_account_event_classification(p_book text, p_event text) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  STABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE t_body jsonb;
BEGIN
  SELECT jsonb_build_object('statementId',s.id,'statementDigest',s.body->>'digest',
    'event',s.body->'events'->(e.ordinal-1),'resolution',r.body,
    'effectiveClassification',coalesce(r.body->'input'->>'classification',s.body->'events'->(e.ordinal-1)->'input'->>'classification'))
    INTO t_body FROM openerp.tax_account_events e
    JOIN openerp.tax_account_statements s ON s.book_id=e.book_id AND s.id=e.statement_id
    LEFT JOIN openerp.tax_account_classification_resolutions r ON r.book_id=e.book_id AND r.event_id=e.id
    WHERE e.book_id=p_book AND e.id=p_event;
  IF t_body IS NULL THEN PERFORM openerp.fail('NotFound','The tax-account event is not in this book.'); END IF;
  RETURN t_body;
END $$;
CREATE FUNCTION openerp.tax_account_guard_correction() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=NEW.book_id AND c.voucher_id=NEW.corrects_voucher_id) THEN
      PERFORM openerp.fail('StaleDependency','Explicitly unmatch the evidenced tax-account relation before correcting this voucher.'); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.tax_account_guard_other_capacity() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE t_voucher text;t_line text;
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF TG_TABLE_NAME='commerce_invoices' THEN t_voucher:=NEW.recognition_voucher_id;t_line:=NEW.recognition_line_id;
  ELSIF TG_TABLE_NAME='commerce_allocation_legs' THEN t_voucher:=NEW.payment_voucher_id;t_line:=NEW.payment_line_id;
  ELSE t_voucher:=NEW.voucher_id;t_line:=NEW.line_id; END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=NEW.book_id AND c.voucher_id=t_voucher AND c.line_id=t_line) THEN
    PERFORM openerp.fail('StaleDependency','Explicitly unmatch the tax-account review before another register consumes this whole posted line.'); END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION openerp.tax_account_line_claimed(p_book text, p_voucher text, p_line text) RETURNS boolean
  SECURITY INVOKER
  LANGUAGE sql
  STABLE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

  SELECT EXISTS(SELECT FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher AND m.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.bank_active_allocation_legs l WHERE l.book_id=p_book AND l.voucher_id=p_voucher AND l.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.voucher_id=p_voucher AND e.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher AND i.recognition_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher AND v.posting_purpose='vat_control_reclassification_v1')
    OR EXISTS(SELECT FROM openerp.vat_control_reclassification_contributions c WHERE c.book_id=p_book AND c.voucher_id=p_voucher AND c.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=p_book AND i.voucher_id=p_voucher AND i.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=p_book AND s.voucher_id=p_voucher
      AND p_line IN(s.cash_line_id,s.control_line_id,s.realized_line_id))
$$;
CREATE FUNCTION openerp.tax_account_match_basis(p_scope jsonb, p_input jsonb) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE t_book openerp.books;t_event openerp.tax_account_events;t_statement openerp.tax_account_statements;
  t_line openerp.journal_lines;t_voucher openerp.vouchers;t_account openerp.accounts;t_row jsonb;t_period jsonb;t_body jsonb;t_field text;t_classification jsonb;
BEGIN
  PERFORM openerp.expense_tax_shape(p_input,ARRAY['eventId','statementDigest','voucherId','lineId']);
  FOREACH t_field IN ARRAY ARRAY['eventId','voucherId','lineId'] LOOP
    IF jsonb_typeof(p_input->t_field) IS DISTINCT FROM 'string' OR p_input->>t_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select retained event and posted voucher/line identities.'); END IF;
  END LOOP;
  SELECT * INTO STRICT t_book FROM openerp.books b WHERE b.id=p_scope->>'bookId';
  PERFORM openerp.bank_require_profile(t_book.id);
  SELECT e.* INTO t_event FROM openerp.tax_account_events e WHERE e.book_id=t_book.id AND e.id=p_input->>'eventId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The tax-account event is not in this book.'); END IF;
  SELECT s.* INTO STRICT t_statement FROM openerp.tax_account_statements s WHERE s.book_id=t_book.id AND s.id=t_event.statement_id;
  IF t_statement.body->>'digest' IS DISTINCT FROM p_input->>'statementDigest' THEN
    PERFORM openerp.fail('StaleDependency','The selected statement digest differs from the retained source.'); END IF;
  t_row:=t_statement.body->'events'->(t_event.ordinal-1);
  t_classification:=openerp.tax_account_event_classification(t_book.id,t_event.id);
  SELECT l.* INTO t_line FROM openerp.journal_lines l WHERE l.book_id=t_book.id AND l.voucher_id=p_input->>'voucherId' AND l.id=p_input->>'lineId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The posted voucher/line is not in this book.'); END IF;
  SELECT v.* INTO STRICT t_voucher FROM openerp.vouchers v WHERE v.book_id=t_book.id AND v.id=t_line.voucher_id;
  IF t_line.account_id<>t_event.account_id OR t_row->'input'->>'occurredOn'<>t_voucher.posting_date::text
    OR (t_row->'input'->>'amountMinor')::numeric<>t_line.debit_minor-t_line.credit_minor
    OR t_statement.body->'input'->>'currency' IS DISTINCT FROM t_book.currency
    OR t_statement.body->'input'->'currencyScale' IS DISTINCT FROM to_jsonb(t_book.currency_scale)
    OR t_classification->>'effectiveClassification'='unknown' THEN
    PERFORM openerp.fail('InvalidJournal','Match only known-classified whole events to the same account, currency, date and exact signed posted amount.'); END IF;
  IF t_voucher.sequence>t_book.committed_sequence OR t_voucher.posting_purpose='reversal'
    OR EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=t_book.id AND r.corrects_voucher_id=t_voucher.id) THEN
    PERFORM openerp.fail('StaleDependency','Reversing, subsequently corrected or uncommitted vouchers cannot acquire tax-account capacity.'); END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=t_book.id AND
    (c.event_id=t_event.id OR (c.voucher_id=t_line.voucher_id AND c.line_id=t_line.id)))
    OR openerp.tax_account_line_claimed(t_book.id,t_line.voucher_id,t_line.id) THEN
    PERFORM openerp.fail('StaleDependency','The whole event or posted line already has active matching or source capacity.'); END IF;
  t_period:=openerp.tax_account_open_period(t_book.id,t_voucher.posting_date);
  SELECT a.* INTO STRICT t_account FROM openerp.accounts a WHERE a.book_id=t_book.id AND a.id=t_event.account_id;
  IF NOT t_account.active THEN PERFORM openerp.fail('StaleDependency','The selected account is inactive.'); END IF;
  t_body:=jsonb_build_object('scope',p_scope,'selection',p_input,'statementId',t_statement.id,'accountId',t_account.id,
    'accountVersion',t_account.version::text,'currency',t_book.currency,'currencyScale',t_book.currency_scale,
    'profileVersion',t_book.profile_version::text,'writerEpoch',t_book.writer_epoch::text,'period',t_period,'event',t_row,
    'sourceEvidenceId',t_statement.evidence_id,'sourceEvidenceSha256',t_statement.evidence_sha256,
    'line',jsonb_build_object('voucherId',t_voucher.id,'lineId',t_line.id,'ordinal',t_line.ordinal,'sequence',t_voucher.sequence::text,
      'postingDate',t_voucher.posting_date::text,'debitMinor',t_line.debit_minor::text,'creditMinor',t_line.credit_minor::text,
      'description',t_line.description,'postingPurpose',t_voucher.posting_purpose,'correctsVoucherId',t_voucher.corrects_voucher_id,
      'evidenceRefs',t_voucher.action->'evidenceRefs'));
  IF t_classification->'resolution' IS DISTINCT FROM 'null'::jsonb THEN
    t_body:=t_body||jsonb_build_object('classificationResolution',jsonb_build_object(
      'id',t_classification->'resolution'->>'id','digest',t_classification->'resolution'->>'digest',
      'eventId',t_event.id,'classification',t_classification->>'effectiveClassification'));
  END IF;
  RETURN t_body||jsonb_build_object('digest',openerp.digest(t_body));
END $$;
CREATE FUNCTION openerp.tax_account_match_view(p_book text, p_id text) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE sql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

  SELECT jsonb_build_object('match',m.body,'unmatch',u.body,'active',c.match_id IS NOT NULL,
    'usable',c.match_id IS NOT NULL AND a.active AND a.version::text=m.body->'basis'->>'accountVersion'
      AND b.profile='synthetic-core-v1' AND b.authority='native' AND b.profile_version::text=m.body->'basis'->>'profileVersion'
      AND b.writer_epoch::text=m.body->'basis'->>'writerEpoch' AND b.currency=m.body->'basis'->>'currency'
      AND to_jsonb(b.currency_scale)=m.body->'basis'->'currencyScale' AND v.sequence<=b.committed_sequence
      AND v.posting_purpose<>'reversal' AND NOT EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=p_book AND r.corrects_voucher_id=v.id)
      AND NOT openerp.tax_account_line_claimed(p_book,m.voucher_id,m.line_id))
    FROM openerp.tax_account_matches m JOIN openerp.books b ON b.id=m.book_id
    JOIN openerp.vouchers v ON v.book_id=m.book_id AND v.id=m.voucher_id
    JOIN openerp.accounts a ON a.book_id=m.book_id AND a.id=m.body->'basis'->>'accountId'
    LEFT JOIN openerp.tax_account_unmatches u ON u.book_id=m.book_id AND u.match_id=m.id
    LEFT JOIN openerp.tax_account_match_capacity c ON c.book_id=m.book_id AND c.match_id=m.id
    WHERE m.book_id=p_book AND m.id=p_id
$$;
CREATE FUNCTION openerp.tax_account_open_period(p_book text, p_date date) RETURNS jsonb
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE t_period openerp.periods;
BEGIN
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=p_book AND p_date BETWEEN p.starts_on AND p.ends_on ORDER BY p.id FOR SHARE;
  IF (SELECT count(*) FROM openerp.periods p WHERE p.book_id=p_book AND p_date BETWEEN p.starts_on AND p.ends_on)<>1 THEN
    PERFORM openerp.fail('UnsupportedProfile','The exact matched event/posting date must belong to one period.'); END IF;
  SELECT p.* INTO STRICT t_period FROM openerp.periods p WHERE p.book_id=p_book AND p_date BETWEEN p.starts_on AND p.ends_on;
  IF t_period.locked THEN PERFORM openerp.fail('PeriodLocked','Reopen the affected period explicitly before changing tax-account matching.'); END IF;
  RETURN jsonb_build_object('id',t_period.id,'version',t_period.version::text);
END $$;
CREATE FUNCTION openerp.vat_control_assert_reclassification_effect(p_book text, p_effect text) RETURNS void
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.vat_control_reclassification_effect_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.vat_control_reclassification_kernel_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.vat_control_refuse_generic_correction() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.vat_control_refuse_taxable_source_voucher() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.vat_control_reserved_account_guard() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

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
CREATE FUNCTION openerp.voucher_expected_line_count() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

DECLARE
  target_book text;
  target_voucher text;
  actual_count integer;
  expected_count integer;
  debit numeric;
  credit numeric;
BEGIN
  IF TG_TABLE_NAME = 'vouchers' THEN
    target_book := NEW.book_id;
    target_voucher := NEW.id;
    expected_count := NEW.expected_line_count;
  ELSE
    target_book := NEW.book_id;
    target_voucher := NEW.voucher_id;
    SELECT expected_line_count INTO expected_count
      FROM openerp.vouchers
     WHERE book_id = target_book AND id = target_voucher;
  END IF;
  SELECT count(*), sum(debit_minor), sum(credit_minor)
    INTO actual_count, debit, credit
    FROM openerp.journal_lines
   WHERE book_id = target_book AND voucher_id = target_voucher;
  IF actual_count IS DISTINCT FROM expected_count THEN
    PERFORM openerp.fail('InvalidJournal', 'The voucher journal line count does not match its expected count.');
  END IF;
  IF actual_count < 2 OR debit IS NULL OR credit IS NULL OR debit <= 0 OR debit <> credit THEN
    PERFORM openerp.fail('InvalidJournal', 'A voucher must have at least two lines and balance exactly.');
  END IF;
  RETURN NULL;
END $$;

-- Triggers. Every one of them runs a function kept above, so a fresh install carries
-- no trigger without its guard, and no guard without the helpers it calls.
CREATE TRIGGER immutable_accountant_review_artifact BEFORE DELETE OR UPDATE ON openerp.accountant_review_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_accountant_review_pack BEFORE DELETE OR UPDATE ON openerp.accountant_review_packs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_accountant_review_row BEFORE DELETE OR UPDATE ON openerp.accountant_review_rows FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER account_version BEFORE UPDATE ON openerp.accounts FOR EACH ROW EXECUTE FUNCTION openerp.bump_version();
CREATE TRIGGER immutable_approval_consumption BEFORE DELETE OR UPDATE ON openerp.approval_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER posting_approval_consumption BEFORE DELETE OR UPDATE ON openerp.approvals FOR EACH ROW EXECUTE FUNCTION openerp.posting_guard_approval_consumption();
CREATE TRIGGER immutable_ar_legal_accounting_profile BEFORE DELETE OR UPDATE ON openerp.ar_legal_accounting_profiles FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_delivery_approval BEFORE DELETE OR UPDATE ON openerp.ar_legal_delivery_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_delivery_attempt BEFORE DELETE OR UPDATE ON openerp.ar_legal_delivery_attempts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_delivery_reconciliation BEFORE DELETE OR UPDATE ON openerp.ar_legal_delivery_reconciliations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_delivery_request BEFORE DELETE OR UPDATE ON openerp.ar_legal_delivery_requests FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_approval BEFORE DELETE OR UPDATE ON openerp.ar_legal_issue_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_review BEFORE DELETE OR UPDATE ON openerp.ar_legal_issue_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_issue BEFORE DELETE OR UPDATE ON openerp.ar_legal_issues FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_pdf_artifact BEFORE DELETE OR UPDATE ON openerp.ar_legal_pdf_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_pdf_capture BEFORE DELETE OR UPDATE ON openerp.ar_legal_pdf_captures FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_ar_legal_policy BEFORE DELETE OR UPDATE ON openerp.ar_legal_policies FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_allocation_approval BEFORE DELETE OR UPDATE ON openerp.bank_allocation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_allocation_execution BEFORE DELETE OR UPDATE ON openerp.bank_allocation_executions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER bank_allocation_admission BEFORE INSERT ON openerp.bank_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.bank_matching_admission_guard();
CREATE TRIGGER immutable_bank_allocation_leg BEFORE DELETE OR UPDATE ON openerp.bank_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER owner_bank_allocation_boundary BEFORE INSERT ON openerp.bank_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER tax_account_bank_allocation_capacity BEFORE INSERT ON openerp.bank_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER immutable_bank_allocation_plan BEFORE DELETE OR UPDATE ON openerp.bank_allocation_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_capacity_report BEFORE DELETE OR UPDATE ON openerp.bank_capacity_reconciliations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_connector_batches BEFORE DELETE OR UPDATE ON openerp.bank_connector_batches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_connector_records BEFORE DELETE OR UPDATE ON openerp.bank_connector_records FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_inventory_signoff_plan BEFORE DELETE OR UPDATE ON openerp.bank_inventory_signoff_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_inventory_signoff BEFORE DELETE OR UPDATE ON openerp.bank_inventory_signoffs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_match_reversal_approval BEFORE DELETE OR UPDATE ON openerp.bank_match_reversal_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_match_reversal_plan BEFORE DELETE OR UPDATE ON openerp.bank_match_reversal_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_match_reversal_revocation BEFORE DELETE OR UPDATE ON openerp.bank_match_reversal_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_match_reversal BEFORE DELETE OR UPDATE ON openerp.bank_match_reversals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER bank_exact_match_capacity BEFORE INSERT ON openerp.bank_matches FOR EACH ROW EXECUTE FUNCTION openerp.bank_exact_match_capacity_guard();
CREATE TRIGGER bank_matching_admission BEFORE INSERT ON openerp.bank_matches FOR EACH ROW EXECUTE FUNCTION openerp.bank_matching_admission_guard();
CREATE TRIGGER immutable_bank_match BEFORE DELETE OR UPDATE ON openerp.bank_matches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER owner_bank_match_boundary BEFORE INSERT ON openerp.bank_matches FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER tax_account_bank_match_capacity BEFORE INSERT ON openerp.bank_matches FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER immutable_bank_observation BEFORE DELETE OR UPDATE ON openerp.bank_observations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_reconciliation_signoff BEFORE DELETE OR UPDATE ON openerp.bank_reconciliation_signoffs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_reconciliation BEFORE DELETE OR UPDATE ON openerp.bank_reconciliations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_signoff_plan BEFORE DELETE OR UPDATE ON openerp.bank_signoff_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_source_coverage BEFORE DELETE OR UPDATE ON openerp.bank_source_coverage_reports FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_bank_source_boundary BEFORE INSERT OR UPDATE OF book_id, account_id ON openerp.bank_sources FOR EACH ROW EXECUTE FUNCTION openerp.commerce_guard_bank_source();
CREATE TRIGGER owner_bank_source_boundary BEFORE INSERT OR UPDATE OF account_id ON openerp.bank_sources FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_account();
CREATE TRIGGER vat_control_reserved_bank_account BEFORE INSERT ON openerp.bank_sources FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER immutable_bank_statement BEFORE DELETE OR UPDATE ON openerp.bank_statements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER book_versions BEFORE UPDATE ON openerp.books FOR EACH ROW EXECUTE FUNCTION openerp.book_versions();
CREATE TRIGGER immutable_case_item BEFORE DELETE OR UPDATE ON openerp.case_context_items FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_case_plan BEFORE DELETE OR UPDATE ON openerp.case_context_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_case_snapshot BEFORE DELETE OR UPDATE ON openerp.case_context_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER catalog_article_revision_immutable BEFORE DELETE OR UPDATE ON openerp.catalog_article_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_plan BEFORE DELETE OR UPDATE ON openerp.change_sets FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER owner_proposal_source_boundary BEFORE INSERT ON openerp.change_sets FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_kernel();
CREATE CONSTRAINT TRIGGER subledger_basis_proposal_owner AFTER INSERT ON openerp.change_sets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.subledger_basis_kernel_guard();
CREATE CONSTRAINT TRIGGER vat_control_reclassification_change_set_owner AFTER INSERT ON openerp.change_sets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reclassification_kernel_guard();
CREATE TRIGGER immutable_closing_approval BEFORE DELETE OR UPDATE ON openerp.closing_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_certificate BEFORE DELETE OR UPDATE ON openerp.closing_certificates FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_invalidation BEFORE DELETE OR UPDATE ON openerp.closing_invalidations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_inventory BEFORE DELETE OR UPDATE ON openerp.closing_inventories FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_proposal BEFORE DELETE OR UPDATE ON openerp.closing_proposals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_transition BEFORE DELETE OR UPDATE ON openerp.closing_transitions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_collection_dispute BEFORE DELETE OR UPDATE ON openerp.collection_disputes FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_collection_event BEFORE DELETE OR UPDATE ON openerp.collection_events FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_collection_statement_artifact BEFORE DELETE OR UPDATE ON openerp.collection_statement_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_collection_statement BEFORE DELETE OR UPDATE ON openerp.collection_statements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER retain_collection_statement_artifact AFTER INSERT ON openerp.collection_statements FOR EACH ROW EXECUTE FUNCTION openerp.retain_collection_statement_artifact();
CREATE TRIGGER immutable_command BEFORE DELETE OR UPDATE ON openerp.command_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER posting_saved_command_identity BEFORE INSERT ON openerp.command_receipts FOR EACH ROW EXECUTE FUNCTION openerp.posting_guard_saved_command_receipt();
CREATE TRIGGER commerce_immutable_allocation_approval BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER commerce_conserve_legs AFTER INSERT ON openerp.commerce_allocation_legs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_check_allocation();
CREATE TRIGGER commerce_fx_allocation_capacity BEFORE INSERT ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_guard_legacy_capacity();
CREATE TRIGGER commerce_immutable_allocation_leg BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER owner_commerce_capacity_boundary BEFORE INSERT ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER tax_account_payment_capacity BEFORE INSERT ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER commerce_immutable_allocation_plan BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER commerce_complete_receipt AFTER INSERT ON openerp.commerce_allocation_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_check_allocation();
CREATE TRIGGER commerce_immutable_allocation_receipt BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversal_approvals BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_reversal_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversal_plans BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_reversal_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversal_revocations BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_reversal_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER commerce_unallocation_integrity AFTER INSERT ON openerp.commerce_allocation_reversals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_assert_unallocation();
CREATE TRIGGER immutable_commerce_allocation_reversals BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_reversals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_control_account_boundary BEFORE INSERT ON openerp.commerce_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.commerce_guard_control_account();
CREATE TRIGGER commerce_immutable_control_account BEFORE DELETE OR UPDATE ON openerp.commerce_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER owner_commerce_account_boundary BEFORE INSERT ON openerp.commerce_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_account();
CREATE TRIGGER vat_control_reserved_commerce_account BEFORE INSERT ON openerp.commerce_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER commerce_freeze_counterparty BEFORE DELETE OR UPDATE ON openerp.commerce_counterparties FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER commerce_immutable_counterparty_revision BEFORE DELETE OR UPDATE ON openerp.commerce_counterparty_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_item BEFORE DELETE OR UPDATE ON openerp.commerce_fx_items FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_recognition_approval BEFORE DELETE OR UPDATE ON openerp.commerce_fx_recognition_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_recognition_review BEFORE DELETE OR UPDATE ON openerp.commerce_fx_recognition_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_settlement_approval BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_correction_approval BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_correction_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_correction_review BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_correction_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER commerce_fx_correction_effect_complete AFTER INSERT ON openerp.commerce_fx_settlement_corrections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_correction_effect_guard();
CREATE TRIGGER immutable_commerce_fx_correction BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_corrections FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_settlement_review BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER commerce_fx_settlement_effect_complete AFTER INSERT ON openerp.commerce_fx_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_settlement_effect_guard();
CREATE TRIGGER immutable_commerce_fx_settlement BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_invoice_revision BEFORE DELETE OR UPDATE ON openerp.commerce_invoice_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER ar_legal_freeze_register BEFORE UPDATE ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.ar_legal_freeze_register();
CREATE TRIGGER commerce_freeze_invoice BEFORE DELETE OR UPDATE ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER commerce_fx_invoice_capacity BEFORE INSERT ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_guard_legacy_capacity();
CREATE TRIGGER owner_invoice_capacity_boundary BEFORE INSERT ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER tax_account_invoice_capacity BEFORE INSERT ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER immutable_commerce_register_allocation_dependency BEFORE DELETE OR UPDATE ON openerp.commerce_register_allocation_dependencies FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_register_snapshot BEFORE DELETE OR UPDATE ON openerp.commerce_register_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_correction_bundle_approval BEFORE DELETE OR UPDATE ON openerp.correction_bundle_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_correction_bundle_receipt BEFORE DELETE OR UPDATE ON openerp.correction_bundle_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_correction_bundle BEFORE DELETE OR UPDATE ON openerp.correction_bundles FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_correction_impact BEFORE DELETE OR UPDATE ON openerp.correction_impact_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER crm_party_annotations_immutable BEFORE DELETE OR UPDATE ON openerp.crm_party_annotations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_deadline_activity_history BEFORE DELETE OR UPDATE ON openerp.deadline_activity_history FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_deadline_revision BEFORE DELETE OR UPDATE ON openerp.deadline_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_dimension_revisions BEFORE DELETE OR UPDATE ON openerp.dimension_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_dimension_value_revisions BEFORE DELETE OR UPDATE ON openerp.dimension_value_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER dimension_value_identity BEFORE DELETE OR UPDATE ON openerp.dimension_values FOR EACH ROW EXECUTE FUNCTION openerp.dimension_identity_guard();
CREATE TRIGGER dimension_identity BEFORE DELETE OR UPDATE ON openerp.dimensions FOR EACH ROW EXECUTE FUNCTION openerp.dimension_identity_guard();
CREATE TRIGGER immutable_event BEFORE DELETE OR UPDATE ON openerp.events FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_evidence BEFORE DELETE OR UPDATE ON openerp.evidence FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_conversion_review BEFORE DELETE OR UPDATE ON openerp.exchange_conversion_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_exchange_observation BEFORE DELETE OR UPDATE ON openerp.exchange_rate_observations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_exchange_revision BEFORE DELETE OR UPDATE ON openerp.exchange_rate_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_exchange_rate_withdrawal BEFORE DELETE OR UPDATE ON openerp.exchange_rate_withdrawals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_execution BEFORE DELETE OR UPDATE ON openerp.execution_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER expense_tax_review_admission BEFORE INSERT ON openerp.expense_tax_reviews FOR EACH ROW EXECUTE FUNCTION openerp.expense_tax_source_admission();
CREATE TRIGGER immutable_expense_tax_review BEFORE DELETE OR UPDATE ON openerp.expense_tax_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_snapshot BEFORE DELETE OR UPDATE ON openerp.expense_tax_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER expense_tax_revision_admission BEFORE INSERT ON openerp.expense_tax_source_revisions FOR EACH ROW EXECUTE FUNCTION openerp.expense_tax_source_admission();
CREATE TRIGGER immutable_expense_tax_source_revision BEFORE DELETE OR UPDATE ON openerp.expense_tax_source_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER vat_control_refuse_expense_tax_source BEFORE INSERT ON openerp.expense_tax_source_revisions FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_refuse_taxable_source_voucher();
CREATE TRIGGER immutable_expense_tax_withdrawal BEFORE DELETE OR UPDATE ON openerp.expense_tax_source_withdrawals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_source BEFORE DELETE OR UPDATE ON openerp.expense_tax_sources FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_year BEFORE DELETE OR UPDATE ON openerp.fiscal_years FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER year_calendar BEFORE INSERT ON openerp.fiscal_years FOR EACH ROW EXECUTE FUNCTION openerp.check_calendar();
CREATE TRIGGER immutable_historical_item_admission BEFORE DELETE OR UPDATE ON openerp.historical_item_admissions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_item BEFORE DELETE OR UPDATE ON openerp.historical_items FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_match BEFORE DELETE OR UPDATE ON openerp.historical_matches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_payment BEFORE DELETE OR UPDATE ON openerp.historical_payments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_admissions BEFORE DELETE OR UPDATE ON openerp.intake_admissions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER intake_admission_requires_unsuperseded_preview BEFORE INSERT ON openerp.intake_admissions FOR EACH ROW EXECUTE FUNCTION openerp.intake_require_unsuperseded_preview();
CREATE TRIGGER immutable_intake_approvals BEFORE DELETE OR UPDATE ON openerp.intake_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER intake_approval_requires_unsuperseded_preview BEFORE INSERT ON openerp.intake_approvals FOR EACH ROW EXECUTE FUNCTION openerp.intake_require_unsuperseded_preview();
CREATE TRIGGER immutable_intake_contents BEFORE DELETE OR UPDATE ON openerp.intake_contents FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_occurrences BEFORE DELETE OR UPDATE ON openerp.intake_occurrences FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_preview_supersessions BEFORE DELETE OR UPDATE ON openerp.intake_preview_supersessions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_previews BEFORE DELETE OR UPDATE ON openerp.intake_previews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellation_approvals BEFORE DELETE OR UPDATE ON openerp.invoice_cancellation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellation_executions BEFORE DELETE OR UPDATE ON openerp.invoice_cancellation_executions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER invoice_cancellation_fence_proof AFTER INSERT ON openerp.invoice_cancellation_executions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.invoice_cancellation_proof();
CREATE TRIGGER immutable_invoice_cancellation_reviews BEFORE DELETE OR UPDATE ON openerp.invoice_cancellation_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellation_revocations BEFORE DELETE OR UPDATE ON openerp.invoice_cancellation_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellations BEFORE DELETE OR UPDATE ON openerp.invoice_cancellations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER invoice_cancellation_receipt_proof AFTER INSERT ON openerp.invoice_cancellations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.invoice_cancellation_proof();
CREATE TRIGGER immutable_invoice_delivery_approval BEFORE DELETE OR UPDATE ON openerp.invoice_delivery_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_delivery_attempt BEFORE DELETE OR UPDATE ON openerp.invoice_delivery_attempts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_delivery_request BEFORE DELETE OR UPDATE ON openerp.invoice_delivery_requests FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_delivery_resolution BEFORE DELETE OR UPDATE ON openerp.invoice_delivery_resolutions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_document_artifact BEFORE DELETE OR UPDATE ON openerp.invoice_document_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_document_capture BEFORE DELETE OR UPDATE ON openerp.invoice_document_captures FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_draft_revision BEFORE DELETE OR UPDATE ON openerp.invoice_draft_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER ar_legal_freeze_draft BEFORE UPDATE ON openerp.invoice_drafts FOR EACH ROW EXECUTE FUNCTION openerp.ar_legal_freeze_draft();
CREATE TRIGGER freeze_invoice_draft_identity BEFORE DELETE OR UPDATE ON openerp.invoice_drafts FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER invoice_issue_freeze_draft BEFORE UPDATE ON openerp.invoice_drafts FOR EACH ROW EXECUTE FUNCTION openerp.invoice_issue_guard_draft();
CREATE TRIGGER immutable_invoice_issue_approval BEFORE DELETE OR UPDATE ON openerp.invoice_issue_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_issue_review BEFORE DELETE OR UPDATE ON openerp.invoice_issue_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_issue BEFORE DELETE OR UPDATE ON openerp.invoice_issues FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_pdf_artifact BEFORE DELETE OR UPDATE ON openerp.invoice_pdf_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_pdf_capture BEFORE DELETE OR UPDATE ON openerp.invoice_pdf_captures FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_policy_candidate BEFORE DELETE OR UPDATE ON openerp.invoice_policy_candidates FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_policy_review BEFORE DELETE OR UPDATE ON openerp.invoice_policy_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_line BEFORE DELETE OR UPDATE ON openerp.journal_lines FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER journal_ordinal_bound BEFORE INSERT ON openerp.journal_lines FOR EACH ROW EXECUTE FUNCTION openerp.guard_journal_ordinal();
CREATE TRIGGER immutable_owner_allocation_approvals BEFORE DELETE OR UPDATE ON openerp.owner_allocation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_allocation_legs BEFORE DELETE OR UPDATE ON openerp.owner_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER owner_leg_conservation AFTER INSERT ON openerp.owner_allocation_legs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.owner_check_allocation();
CREATE TRIGGER immutable_owner_allocation_plans BEFORE DELETE OR UPDATE ON openerp.owner_allocation_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_allocation_receipts BEFORE DELETE OR UPDATE ON openerp.owner_allocation_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER owner_receipt_conservation AFTER INSERT ON openerp.owner_allocation_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.owner_check_allocation();
CREATE TRIGGER immutable_owner_control_accounts BEFORE DELETE OR UPDATE ON openerp.owner_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER owner_control_account_boundary BEFORE INSERT ON openerp.owner_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_account();
CREATE TRIGGER vat_control_reserved_owner_account BEFORE INSERT ON openerp.owner_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER immutable_owner_controls BEFORE DELETE OR UPDATE ON openerp.owner_controls FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_fx_owner_capacity BEFORE INSERT ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_guard_legacy_capacity();
CREATE TRIGGER immutable_owner_effects BEFORE DELETE OR UPDATE ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER owner_effect_capacity_boundary BEFORE INSERT ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_capacity();
CREATE TRIGGER tax_account_owner_capacity BEFORE INSERT ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER immutable_owner_parties BEFORE DELETE OR UPDATE ON openerp.owner_parties FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_proposal_links BEFORE DELETE OR UPDATE ON openerp.owner_proposal_links FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER owner_freeze_record BEFORE DELETE OR UPDATE ON openerp.owner_records FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER immutable_owner_reviews BEFORE DELETE OR UPDATE ON openerp.owner_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_revisions BEFORE DELETE OR UPDATE ON openerp.owner_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER payroll_access_immutable BEFORE UPDATE ON openerp.payroll_access FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER payroll_employees_immutable BEFORE DELETE OR UPDATE ON openerp.payroll_employees FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER payroll_revisions_immutable BEFORE DELETE OR UPDATE ON openerp.payroll_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER period_calendar BEFORE INSERT OR UPDATE ON openerp.periods FOR EACH ROW EXECUTE FUNCTION openerp.check_calendar();
CREATE TRIGGER period_version BEFORE UPDATE ON openerp.periods FOR EACH ROW EXECUTE FUNCTION openerp.bump_version();
CREATE TRIGGER posting_revocation_immutable BEFORE DELETE OR UPDATE ON openerp.posting_approval_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_posting_group_receipt BEFORE DELETE OR UPDATE ON openerp.posting_group_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER posting_outcome_immutable BEFORE DELETE OR UPDATE ON openerp.posting_request_outcomes FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER posting_saved_immutable BEFORE DELETE OR UPDATE ON openerp.posting_saved_requests FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_preparation_audit BEFORE DELETE OR UPDATE ON openerp.preparation_run_audit FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER frozen_preparation_inputs BEFORE DELETE OR UPDATE ON openerp.preparation_runs FOR EACH ROW EXECUTE FUNCTION openerp.freeze_preparation_inputs();
CREATE TRIGGER immutable_recurring_activation BEFORE DELETE OR UPDATE ON openerp.recurring_activations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_deactivation BEFORE DELETE OR UPDATE ON openerp.recurring_deactivations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_preparation BEFORE DELETE OR UPDATE ON openerp.recurring_preparations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_rule BEFORE DELETE OR UPDATE ON openerp.recurring_rules FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_recurring_simulation BEFORE DELETE OR UPDATE ON openerp.recurring_simulations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_report_line BEFORE DELETE OR UPDATE ON openerp.report_lines FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_report BEFORE DELETE OR UPDATE ON openerp.report_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sales_document_revision BEFORE DELETE OR UPDATE ON openerp.sales_document_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER freeze_sales_document_identity BEFORE DELETE OR UPDATE ON openerp.sales_documents FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER immutable_sales_order_conversion BEFORE DELETE OR UPDATE ON openerp.sales_order_conversions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_financial_posting BEFORE DELETE OR UPDATE ON openerp.sie_financial_postings FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_financial_proposal BEFORE DELETE OR UPDATE ON openerp.sie_financial_proposals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_chunk BEFORE DELETE OR UPDATE ON openerp.sie_source_chunks FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_plan BEFORE DELETE OR UPDATE ON openerp.sie_source_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_preview BEFORE DELETE OR UPDATE ON openerp.sie_source_previews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_voucher BEFORE DELETE OR UPDATE ON openerp.sie_source_vouchers FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_artifact BEFORE DELETE OR UPDATE ON openerp.sie_transaction_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_capture BEFORE DELETE OR UPDATE ON openerp.sie_transaction_captures FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_source_review_artifact BEFORE DELETE OR UPDATE ON openerp.source_review_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_source_upload BEFORE DELETE OR UPDATE ON openerp.source_uploads FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_basis BEFORE DELETE OR UPDATE ON openerp.subledger_bases FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER subledger_disposal_not_acquisition BEFORE INSERT ON openerp.subledger_bases FOR EACH ROW EXECUTE FUNCTION openerp.subledger_disposal_basis_guard();
CREATE TRIGGER immutable_subledger_basis_line BEFORE DELETE OR UPDATE ON openerp.subledger_basis_lines FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_control BEFORE DELETE OR UPDATE ON openerp.subledger_control_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_disposal_approval BEFORE DELETE OR UPDATE ON openerp.subledger_disposal_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_disposal_review BEFORE DELETE OR UPDATE ON openerp.subledger_disposal_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_disposal BEFORE DELETE OR UPDATE ON openerp.subledger_disposals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_impairment_approval BEFORE DELETE OR UPDATE ON openerp.subledger_impairment_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_impairment_review BEFORE DELETE OR UPDATE ON openerp.subledger_impairment_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_impairment BEFORE DELETE OR UPDATE ON openerp.subledger_impairments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_preparation BEFORE DELETE OR UPDATE ON openerp.subledger_preparations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_revision BEFORE DELETE OR UPDATE ON openerp.subledger_schedule_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER subledger_basis_freezes_revision BEFORE INSERT ON openerp.subledger_schedule_revisions FOR EACH ROW EXECUTE FUNCTION openerp.subledger_basis_revision_guard();
CREATE TRIGGER subledger_disposal_freezes_revision BEFORE INSERT ON openerp.subledger_schedule_revisions FOR EACH ROW EXECUTE FUNCTION openerp.subledger_disposal_revision_guard();
CREATE TRIGGER vat_control_reserved_subledger_account BEFORE INSERT ON openerp.subledger_schedule_revisions FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER immutable_subledger_schedule BEFORE DELETE OR UPDATE ON openerp.subledger_schedules FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_superseded_historical_opening BEFORE DELETE OR UPDATE ON openerp.superseded_historical_openings FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_acceptance_approval BEFORE DELETE OR UPDATE ON openerp.supplier_acceptance_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_acceptance_review BEFORE DELETE OR UPDATE ON openerp.supplier_acceptance_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_acceptance BEFORE DELETE OR UPDATE ON openerp.supplier_acceptances FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_credit_approval_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_credit_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_credit_review_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_credit_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER supplier_credit_conservation AFTER INSERT ON openerp.supplier_credits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.supplier_credit_conserve();
CREATE TRIGGER supplier_credit_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_credits FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_extraction_attempt BEFORE DELETE OR UPDATE ON openerp.supplier_extraction_attempts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_invoice_draft_revision BEFORE DELETE OR UPDATE ON openerp.supplier_invoice_draft_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER freeze_supplier_invoice_draft_identity BEFORE DELETE OR UPDATE ON openerp.supplier_invoice_drafts FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER supplier_acceptance_freeze_draft BEFORE UPDATE ON openerp.supplier_invoice_drafts FOR EACH ROW EXECUTE FUNCTION openerp.supplier_acceptance_guard_draft();
CREATE TRIGGER supplier_payee_proposal_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_payee_proposals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payee_verification_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_payee_verifications FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payment_export_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_payment_batch_exports FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payment_item_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_payment_batch_items FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payment_preview_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_payment_batch_previews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_payment_outcome_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_payment_outcomes FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_classification_resolution BEFORE DELETE OR UPDATE ON openerp.tax_account_classification_resolutions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_control BEFORE DELETE OR UPDATE ON openerp.tax_account_controls FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_event BEFORE DELETE OR UPDATE ON openerp.tax_account_events FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_capacity_identity BEFORE UPDATE ON openerp.tax_account_match_capacity FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER tax_account_capacity_admission BEFORE INSERT ON openerp.tax_account_match_capacity FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_capacity_admission();
CREATE CONSTRAINT TRIGGER tax_account_reservation_conservation AFTER INSERT OR DELETE ON openerp.tax_account_match_capacity DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_capacity_conservation();
CREATE TRIGGER immutable_tax_account_match BEFORE DELETE OR UPDATE ON openerp.tax_account_matches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER tax_account_match_conservation AFTER INSERT ON openerp.tax_account_matches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_capacity_conservation();
CREATE TRIGGER immutable_tax_account_source BEFORE DELETE OR UPDATE ON openerp.tax_account_sources FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER vat_control_reserved_tax_account BEFORE INSERT ON openerp.tax_account_sources FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reserved_account_guard();
CREATE TRIGGER immutable_tax_account_statement BEFORE DELETE OR UPDATE ON openerp.tax_account_statements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_unmatch BEFORE DELETE OR UPDATE ON openerp.tax_account_unmatches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER tax_account_unmatch_conservation AFTER INSERT ON openerp.tax_account_unmatches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_capacity_conservation();
CREATE TRIGGER immutable_vat_control_account_role BEFORE DELETE OR UPDATE ON openerp.vat_control_account_roles FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_profile BEFORE DELETE OR UPDATE ON openerp.vat_control_profiles FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_approval BEFORE DELETE OR UPDATE ON openerp.vat_control_reclassification_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_contribution BEFORE DELETE OR UPDATE ON openerp.vat_control_reclassification_contributions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER vat_control_reclassification_contribution_complete AFTER INSERT ON openerp.vat_control_reclassification_contributions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reclassification_effect_guard();
CREATE TRIGGER immutable_vat_control_effect BEFORE DELETE OR UPDATE ON openerp.vat_control_reclassification_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER vat_control_reclassification_effect_complete AFTER INSERT ON openerp.vat_control_reclassification_effects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reclassification_effect_guard();
CREATE TRIGGER immutable_vat_control_review BEFORE DELETE OR UPDATE ON openerp.vat_control_reclassification_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_draft_amendment BEFORE DELETE OR UPDATE ON openerp.vat_draft_amendments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_fact_component BEFORE DELETE OR UPDATE ON openerp.vat_fact_components FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_fact_revision BEFORE DELETE OR UPDATE ON openerp.vat_fact_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER refuse_withdrawn_expense_vat_link BEFORE INSERT ON openerp.vat_fact_revisions FOR EACH ROW EXECUTE FUNCTION openerp.refuse_withdrawn_expense_vat_link();
CREATE TRIGGER refuse_withdrawn_vat_fact_revision BEFORE INSERT ON openerp.vat_fact_revisions FOR EACH ROW EXECUTE FUNCTION openerp.refuse_withdrawn_vat_fact_revision();
CREATE TRIGGER vat_control_refuse_vat_fact_source BEFORE INSERT ON openerp.vat_fact_revisions FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_refuse_taxable_source_voucher();
CREATE TRIGGER immutable_vat_fact_withdrawal BEFORE DELETE OR UPDATE ON openerp.vat_fact_withdrawals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_reporting_obligation BEFORE DELETE OR UPDATE ON openerp.vat_reporting_obligations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_return_draft BEFORE DELETE OR UPDATE ON openerp.vat_return_drafts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER ar_legal_owned_source AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.ar_legal_guard_source();
CREATE TRIGGER bank_recurring_source_capacity BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.bank_guard_recurring_posting();
CREATE TRIGGER commerce_fx_owned_posting BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_guard_owned_posting();
CREATE CONSTRAINT TRIGGER commerce_fx_voucher_effect_complete AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_voucher_effect_guard();
CREATE TRIGGER commerce_voucher_reversal_boundary BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.commerce_guard_voucher_reversal();
CREATE CONSTRAINT TRIGGER complete_correction_bundle AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_complete_correction_bundle();
CREATE TRIGGER correction_unsupported_reversal BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.correction_unsupported_reversal_guard();
CREATE TRIGGER guard_historical_voucher BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.guard_historical_basis();
CREATE TRIGGER guard_sie_financial_proposal BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.guard_sie_financial_proposal();
CREATE TRIGGER guard_superseded_historical_opening BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.guard_superseded_historical_opening();
CREATE TRIGGER immutable_voucher BEFORE DELETE OR UPDATE ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER invoice_issue_aggregate AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.invoice_issue_require_aggregate();
CREATE TRIGGER owner_posting_source_boundary BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.owner_guard_kernel();
CREATE TRIGGER record_historical_opening AFTER INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.record_historical_opening();
CREATE TRIGGER subledger_basis_posting_authority BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.subledger_basis_kernel_guard();
CREATE CONSTRAINT TRIGGER subledger_disposal_complete_aggregate AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.subledger_disposal_aggregate_guard();
CREATE CONSTRAINT TRIGGER subledger_impairment_complete_aggregate AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.subledger_impairment_aggregate_guard();
CREATE CONSTRAINT TRIGGER supplier_acceptance_aggregate AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.supplier_acceptance_require_aggregate();
CREATE TRIGGER supplier_credit_no_generic_correction BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.supplier_credit_require_aggregate();
CREATE CONSTRAINT TRIGGER supplier_credit_posting_boundary AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.supplier_credit_source_boundary();
CREATE TRIGGER tax_account_correction_capacity BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_correction();
CREATE CONSTRAINT TRIGGER vat_control_reclassification_voucher_complete AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (new.posting_purpose = 'vat_control_reclassification_v1'::text) EXECUTE FUNCTION openerp.vat_control_reclassification_effect_guard();
CREATE TRIGGER vat_control_reclassification_voucher_owner BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_reclassification_kernel_guard();
CREATE TRIGGER vat_control_refuse_generic_correction BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.vat_control_refuse_generic_correction();
CREATE CONSTRAINT TRIGGER voucher_expected_line_count_voucher AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.voucher_expected_line_count();
CREATE TRIGGER identity_session_admission BEFORE INSERT ON openerp_auth.session FOR EACH ROW EXECUTE FUNCTION openerp.check_identity_session();
