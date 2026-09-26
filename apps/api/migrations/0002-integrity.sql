-- Clean baseline: relational validity, sealed records and exact voucher integrity.
-- Application operations own authorization, policy, calculation and workflow state.
-- Helpers have a fixed search path and private execution; canonical/digest are also
-- used by sealed-record CHECK constraints and pure read projections.

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
CREATE FUNCTION openerp.dimension_identity_guard() RETURNS trigger
  SECURITY INVOKER
  LANGUAGE plpgsql
  VOLATILE

  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
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
CREATE FUNCTION openerp.immutable_row() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE

  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $$

BEGIN PERFORM openerp.fail('Forbidden', 'Accounting history is append-only. Create a linked correction.'); RETURN NULL; END $$;
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
  RETURN NEW;
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
CREATE TRIGGER immutable_bank_allocation_leg BEFORE DELETE OR UPDATE ON openerp.bank_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
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
CREATE TRIGGER immutable_bank_match BEFORE DELETE OR UPDATE ON openerp.bank_matches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_observation BEFORE DELETE OR UPDATE ON openerp.bank_observations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_reconciliation_signoff BEFORE DELETE OR UPDATE ON openerp.bank_reconciliation_signoffs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_reconciliation BEFORE DELETE OR UPDATE ON openerp.bank_reconciliations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_signoff_plan BEFORE DELETE OR UPDATE ON openerp.bank_signoff_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_source_coverage BEFORE DELETE OR UPDATE ON openerp.bank_source_coverage_reports FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_statement BEFORE DELETE OR UPDATE ON openerp.bank_statements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER book_versions BEFORE UPDATE ON openerp.books FOR EACH ROW EXECUTE FUNCTION openerp.book_versions();
CREATE TRIGGER immutable_case_item BEFORE DELETE OR UPDATE ON openerp.case_context_items FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_case_plan BEFORE DELETE OR UPDATE ON openerp.case_context_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_case_snapshot BEFORE DELETE OR UPDATE ON openerp.case_context_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER catalog_article_revision_immutable BEFORE DELETE OR UPDATE ON openerp.catalog_article_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_plan BEFORE DELETE OR UPDATE ON openerp.change_sets FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
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
CREATE TRIGGER immutable_command BEFORE DELETE OR UPDATE ON openerp.command_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_allocation_approval BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_allocation_leg BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_allocation_plan BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_allocation_receipt BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversal_approvals BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_reversal_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversal_plans BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_reversal_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversal_revocations BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_reversal_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_allocation_reversals BEFORE DELETE OR UPDATE ON openerp.commerce_allocation_reversals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_control_account BEFORE DELETE OR UPDATE ON openerp.commerce_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_freeze_counterparty BEFORE DELETE OR UPDATE ON openerp.commerce_counterparties FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER commerce_immutable_counterparty_revision BEFORE DELETE OR UPDATE ON openerp.commerce_counterparty_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_item BEFORE DELETE OR UPDATE ON openerp.commerce_fx_items FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_recognition_approval BEFORE DELETE OR UPDATE ON openerp.commerce_fx_recognition_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_recognition_review BEFORE DELETE OR UPDATE ON openerp.commerce_fx_recognition_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_settlement_approval BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_correction_approval BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_correction_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_correction_review BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_correction_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_correction BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_corrections FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_settlement_review BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_settlement BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_invoice_revision BEFORE DELETE OR UPDATE ON openerp.commerce_invoice_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER ar_legal_freeze_register BEFORE UPDATE ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.ar_legal_freeze_register();
CREATE TRIGGER commerce_freeze_invoice BEFORE DELETE OR UPDATE ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
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
CREATE TRIGGER immutable_expense_tax_review BEFORE DELETE OR UPDATE ON openerp.expense_tax_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_snapshot BEFORE DELETE OR UPDATE ON openerp.expense_tax_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_source_revision BEFORE DELETE OR UPDATE ON openerp.expense_tax_source_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_withdrawal BEFORE DELETE OR UPDATE ON openerp.expense_tax_source_withdrawals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_expense_tax_source BEFORE DELETE OR UPDATE ON openerp.expense_tax_sources FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_year BEFORE DELETE OR UPDATE ON openerp.fiscal_years FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER year_calendar BEFORE INSERT ON openerp.fiscal_years FOR EACH ROW EXECUTE FUNCTION openerp.check_calendar();
CREATE TRIGGER immutable_historical_item_admission BEFORE DELETE OR UPDATE ON openerp.historical_item_admissions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_item BEFORE DELETE OR UPDATE ON openerp.historical_items FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_match BEFORE DELETE OR UPDATE ON openerp.historical_matches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_payment BEFORE DELETE OR UPDATE ON openerp.historical_payments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_admissions BEFORE DELETE OR UPDATE ON openerp.intake_admissions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_approvals BEFORE DELETE OR UPDATE ON openerp.intake_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_contents BEFORE DELETE OR UPDATE ON openerp.intake_contents FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_occurrences BEFORE DELETE OR UPDATE ON openerp.intake_occurrences FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_preview_supersessions BEFORE DELETE OR UPDATE ON openerp.intake_preview_supersessions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_previews BEFORE DELETE OR UPDATE ON openerp.intake_previews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellation_approvals BEFORE DELETE OR UPDATE ON openerp.invoice_cancellation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellation_executions BEFORE DELETE OR UPDATE ON openerp.invoice_cancellation_executions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellation_reviews BEFORE DELETE OR UPDATE ON openerp.invoice_cancellation_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellation_revocations BEFORE DELETE OR UPDATE ON openerp.invoice_cancellation_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_cancellations BEFORE DELETE OR UPDATE ON openerp.invoice_cancellations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
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
CREATE TRIGGER immutable_owner_allocation_plans BEFORE DELETE OR UPDATE ON openerp.owner_allocation_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_allocation_receipts BEFORE DELETE OR UPDATE ON openerp.owner_allocation_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_control_accounts BEFORE DELETE OR UPDATE ON openerp.owner_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_controls BEFORE DELETE OR UPDATE ON openerp.owner_controls FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_owner_effects BEFORE DELETE OR UPDATE ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
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
CREATE TRIGGER immutable_subledger_schedule BEFORE DELETE OR UPDATE ON openerp.subledger_schedules FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_superseded_historical_opening BEFORE DELETE OR UPDATE ON openerp.superseded_historical_openings FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_acceptance_approval BEFORE DELETE OR UPDATE ON openerp.supplier_acceptance_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_acceptance_review BEFORE DELETE OR UPDATE ON openerp.supplier_acceptance_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_acceptance BEFORE DELETE OR UPDATE ON openerp.supplier_acceptances FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_credit_approval_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_credit_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER supplier_credit_review_immutable BEFORE DELETE OR UPDATE ON openerp.supplier_credit_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
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
CREATE TRIGGER immutable_tax_account_match BEFORE DELETE OR UPDATE ON openerp.tax_account_matches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_source BEFORE DELETE OR UPDATE ON openerp.tax_account_sources FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_statement BEFORE DELETE OR UPDATE ON openerp.tax_account_statements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_unmatch BEFORE DELETE OR UPDATE ON openerp.tax_account_unmatches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_account_role BEFORE DELETE OR UPDATE ON openerp.vat_control_account_roles FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_profile BEFORE DELETE OR UPDATE ON openerp.vat_control_profiles FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_approval BEFORE DELETE OR UPDATE ON openerp.vat_control_reclassification_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_contribution BEFORE DELETE OR UPDATE ON openerp.vat_control_reclassification_contributions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_effect BEFORE DELETE OR UPDATE ON openerp.vat_control_reclassification_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_control_review BEFORE DELETE OR UPDATE ON openerp.vat_control_reclassification_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_draft_amendment BEFORE DELETE OR UPDATE ON openerp.vat_draft_amendments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_fact_component BEFORE DELETE OR UPDATE ON openerp.vat_fact_components FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_fact_revision BEFORE DELETE OR UPDATE ON openerp.vat_fact_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_fact_withdrawal BEFORE DELETE OR UPDATE ON openerp.vat_fact_withdrawals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_reporting_obligation BEFORE DELETE OR UPDATE ON openerp.vat_reporting_obligations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_return_draft BEFORE DELETE OR UPDATE ON openerp.vat_return_drafts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_voucher BEFORE DELETE OR UPDATE ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE CONSTRAINT TRIGGER voucher_expected_line_count_voucher AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.voucher_expected_line_count();
