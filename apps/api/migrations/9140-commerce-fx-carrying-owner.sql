CREATE TABLE openerp.commerce_fx_recognition_reviews (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  item_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,item_id),
  CHECK (body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'itemId'=item_id
    AND body->>'createdBy'=actor_id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.commerce_fx_recognition_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,review_id,id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.commerce_fx_recognition_reviews
);
CREATE TABLE openerp.commerce_fx_items (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  counterparty_id text NOT NULL,
  counterparty_revision bigint NOT NULL,
  source_key text COLLATE "C" NOT NULL,
  source_revision text NOT NULL,
  evidence_id text NOT NULL,
  rate_observation_id text NOT NULL,
  rate_revision integer NOT NULL,
  rate_digest text NOT NULL,
  event_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  original_currency text NOT NULL,
  original_scale integer NOT NULL,
  original_minor openerp.minor_units NOT NULL,
  book_currency text NOT NULL,
  book_scale integer NOT NULL,
  carrying_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,source_key),
  UNIQUE (book_id,posting_receipt_id),
  UNIQUE (book_id,voucher_id,line_id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.commerce_fx_recognition_reviews,
  FOREIGN KEY (book_id,approval_id) REFERENCES openerp.commerce_fx_recognition_approvals,
  FOREIGN KEY (book_id,posting_receipt_id) REFERENCES openerp.execution_receipts,
  FOREIGN KEY (book_id,counterparty_id,counterparty_revision) REFERENCES openerp.commerce_counterparty_revisions,
  FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence,
  FOREIGN KEY (book_id,rate_observation_id,rate_revision) REFERENCES openerp.exchange_rate_revisions,
  FOREIGN KEY (book_id,event_id) REFERENCES openerp.events,
  FOREIGN KEY (book_id,voucher_id,line_id) REFERENCES openerp.journal_lines,
  CHECK (original_currency ~ '^[A-Z]{3}$' AND original_scale BETWEEN 0 AND 6 AND original_minor>0
    AND book_currency ~ '^[A-Z]{3}$' AND book_scale BETWEEN 0 AND 6 AND carrying_minor>0
    AND original_currency<>book_currency AND rate_digest ~ '^sha256:[a-f0-9]{64}$'
    AND body->>'id'=id AND body->'scope'->>'bookId'=book_id
    AND body->'source'->>'sourceKey'=source_key AND body->'source'->>'sourceRevision'=source_revision
    AND body->'original'->>'currency'=original_currency AND body->'original'->>'scale'=original_scale::text
    AND body->'original'->>'minor'=original_minor::text AND body->'book'->>'currency'=book_currency
    AND body->'book'->>'scale'=book_scale::text AND body->'book'->>'carryingMinor'=carrying_minor::text
    AND body->'rate'->>'digest'=rate_digest AND body->'recognition'->>'eventId'=event_id
    AND body->'recognition'->>'voucherId'=voucher_id AND body->'recognition'->>'lineId'=line_id
    AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.commerce_fx_settlement_reviews (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  item_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,item_id) REFERENCES openerp.commerce_fx_items,
  CHECK (body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'itemId'=item_id
    AND body->>'createdBy'=actor_id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.commerce_fx_settlement_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,review_id,id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.commerce_fx_settlement_reviews
);
CREATE TABLE openerp.commerce_fx_settlements (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  item_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  event_id text NOT NULL,
  voucher_id text NOT NULL,
  cash_line_id text NOT NULL,
  control_line_id text NOT NULL,
  realized_line_id text,
  original_released_minor openerp.minor_units NOT NULL,
  carrying_released_minor openerp.minor_units NOT NULL,
  consideration_minor openerp.minor_units NOT NULL,
  realized_gain_minor numeric NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,item_id),
  UNIQUE (book_id,review_id),
  UNIQUE (book_id,approval_id),
  UNIQUE (book_id,posting_receipt_id),
  FOREIGN KEY (book_id,item_id) REFERENCES openerp.commerce_fx_items,
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.commerce_fx_settlement_reviews,
  FOREIGN KEY (book_id,approval_id) REFERENCES openerp.commerce_fx_settlement_approvals,
  FOREIGN KEY (book_id,posting_receipt_id) REFERENCES openerp.execution_receipts,
  FOREIGN KEY (book_id,event_id) REFERENCES openerp.events,
  FOREIGN KEY (book_id,voucher_id,cash_line_id) REFERENCES openerp.journal_lines,
  FOREIGN KEY (book_id,voucher_id,control_line_id) REFERENCES openerp.journal_lines,
  FOREIGN KEY (book_id,voucher_id,realized_line_id) REFERENCES openerp.journal_lines,
  CHECK (original_released_minor>0 AND carrying_released_minor>0 AND consideration_minor>0
    AND realized_gain_minor=consideration_minor-carrying_released_minor
    AND body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'itemId'=item_id
    AND body->>'reviewId'=review_id AND body->>'approvalId'=approval_id
    AND body->>'originalReleasedMinor'=original_released_minor::text
    AND body->>'carryingReleasedMinor'=carrying_released_minor::text
    AND body->>'considerationMinor'=consideration_minor::text
    AND body->>'realizedGainMinor'=realized_gain_minor::text
    AND body->'postingReceipt'->>'id'=posting_receipt_id
    AND body->'postingReceipt'->>'voucherId'=voucher_id
    AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.commerce_fx_settlement_correction_reviews (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  settlement_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,settlement_id) REFERENCES openerp.commerce_fx_settlements,
  CHECK (body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'settlementId'=settlement_id
    AND body->>'createdBy'=actor_id AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.commerce_fx_settlement_correction_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,review_id,id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.commerce_fx_settlement_correction_reviews
);
CREATE TABLE openerp.commerce_fx_settlement_corrections (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  item_id text NOT NULL,
  settlement_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  original_voucher_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,settlement_id),
  UNIQUE (book_id,review_id),
  UNIQUE (book_id,approval_id),
  UNIQUE (book_id,posting_receipt_id),
  FOREIGN KEY (book_id,item_id) REFERENCES openerp.commerce_fx_items,
  FOREIGN KEY (book_id,settlement_id) REFERENCES openerp.commerce_fx_settlements,
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.commerce_fx_settlement_correction_reviews,
  FOREIGN KEY (book_id,approval_id) REFERENCES openerp.commerce_fx_settlement_correction_approvals,
  FOREIGN KEY (book_id,posting_receipt_id) REFERENCES openerp.execution_receipts,
  FOREIGN KEY (book_id,original_voucher_id) REFERENCES openerp.vouchers,
  CHECK (body->>'id'=id AND body->'scope'->>'bookId'=book_id
    AND body->>'itemId'=item_id AND body->>'settlementId'=settlement_id
    AND body->>'reviewId'=review_id AND body->>'approvalId'=approval_id
    AND body->>'originalVoucherId'=original_voucher_id
    AND body->'postingReceipt'->>'id'=posting_receipt_id
    AND body->>'digest'=openerp.digest(body-'digest'))
);
CREATE INDEX commerce_fx_item_status ON openerp.commerce_fx_items(book_id,event_id);
CREATE INDEX commerce_fx_settlement_item ON openerp.commerce_fx_settlements(book_id,item_id);
CREATE INDEX commerce_fx_correction_settlement ON openerp.commerce_fx_settlement_corrections(book_id,settlement_id);
CREATE TRIGGER immutable_commerce_fx_recognition_review BEFORE UPDATE OR DELETE ON openerp.commerce_fx_recognition_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_recognition_approval BEFORE UPDATE OR DELETE ON openerp.commerce_fx_recognition_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_item BEFORE UPDATE OR DELETE ON openerp.commerce_fx_items FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_settlement_review BEFORE UPDATE OR DELETE ON openerp.commerce_fx_settlement_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_settlement_approval BEFORE UPDATE OR DELETE ON openerp.commerce_fx_settlement_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_settlement BEFORE UPDATE OR DELETE ON openerp.commerce_fx_settlements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_correction_review BEFORE UPDATE OR DELETE ON openerp.commerce_fx_settlement_correction_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_correction_approval BEFORE UPDATE OR DELETE ON openerp.commerce_fx_settlement_correction_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_commerce_fx_correction BEFORE UPDATE OR DELETE ON openerp.commerce_fx_settlement_corrections FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.commerce_fx_recognition_reviews,openerp.commerce_fx_recognition_approvals,
  openerp.commerce_fx_items,openerp.commerce_fx_settlement_reviews,openerp.commerce_fx_settlement_approvals,
  openerp.commerce_fx_settlements,openerp.commerce_fx_settlement_correction_reviews,
  openerp.commerce_fx_settlement_correction_approvals,openerp.commerce_fx_settlement_corrections
  FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.commerce_fx_item_body(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_item openerp.commerce_fx_items; fx_settlement openerp.commerce_fx_settlements;
  fx_correction openerp.commerce_fx_settlement_corrections;
BEGIN
  SELECT * INTO fx_item FROM openerp.commerce_fx_items i WHERE i.book_id=p_book AND i.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The commerce foreign-currency item was not found in this book.'); END IF;
  SELECT * INTO fx_settlement FROM openerp.commerce_fx_settlements s WHERE s.book_id=p_book AND s.item_id=p_id;
  SELECT * INTO fx_correction FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=p_book AND c.settlement_id=fx_settlement.id;
  RETURN fx_item.body||jsonb_build_object(
    'status',CASE WHEN fx_settlement.id IS NULL THEN 'open' WHEN fx_correction.id IS NULL THEN 'settled' ELSE 'corrected' END,
    'remainingOriginalMinor',CASE WHEN fx_settlement.id IS NULL OR fx_correction.id IS NOT NULL THEN fx_item.original_minor::text ELSE '0' END,
    'remainingCarryingMinor',CASE WHEN fx_settlement.id IS NULL OR fx_correction.id IS NOT NULL THEN fx_item.carrying_minor::text ELSE '0' END,
    'settlement',fx_settlement.body,'correction',fx_correction.body);
END $$;

CREATE FUNCTION openerp.commerce_fx_recognition_selection(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_book openerp.books; fx_period openerp.periods; fx_year text; fx_counterparty openerp.commerce_counterparties;
  fx_counterpart jsonb; fx_rate jsonb; fx_evidence jsonb; fx_roles jsonb; fx_amount numeric; fx_n numeric; fx_d numeric;
  fx_q numeric; fx_r numeric; fx_rounded numeric; fx_date date;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','sourceKey','sourceRevision','counterpartyId',
    'counterpartyRevision','documentNumber','recognitionDate','originalCurrency','originalScale','originalMinor',
    'rateObservationId','rateDigest','accountingPeriodId','series','controlAccountId','revenueAccountId','cashAccountId',
    'realizedGainAccountId','realizedLossAccountId','accountRoleEvidence','evidenceId','eventKey','reason',
    'syntheticNoTaxConfirmed','acknowledgeLimitedProfile']);
  IF p_input->>'profile'<>'synthetic_customer_foreign_receivable_v1'
    OR p_input->'syntheticNoTaxConfirmed'<>'true'::jsonb OR p_input->'acknowledgeLimitedProfile'<>'true'::jsonb
    OR jsonb_typeof(p_input->'originalScale') IS DISTINCT FROM 'number' OR p_input->>'originalScale' !~ '^[0-6]$'
    OR p_input->>'originalCurrency' !~ '^[A-Z]{3}$' OR p_input->>'sourceRevision' !~ '^[1-9][0-9]{0,17}$'
    OR p_input->>'series' !~ '^[A-Z0-9]{1,16}$' OR p_input->>'eventKey' !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
    PERFORM openerp.fail('UnsupportedProfile','Select the explicit synthetic no-tax foreign-customer recognition profile and exact identifiers.'); END IF;
  PERFORM openerp.commerce_text(p_input,'sourceKey',128);
  PERFORM openerp.commerce_text(p_input,'documentNumber',200);
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  fx_date:=openerp.bank_date(p_input->>'recognitionDate');
  fx_amount:=openerp.commerce_positive_minor(p_input,'originalMinor');
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_book;
  IF p_input->>'originalCurrency'=fx_book.currency THEN
    PERFORM openerp.fail('UnsupportedProfile','This owner requires a foreign original currency distinct from the book currency.'); END IF;
  SELECT * INTO STRICT fx_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_input->>'accountingPeriodId';
  SELECT p.fiscal_year_id INTO STRICT fx_year FROM openerp.periods p WHERE p.book_id=p_book AND p.id=fx_period.id;
  IF fx_period.locked OR fx_date NOT BETWEEN fx_period.starts_on AND fx_period.ends_on
    OR NOT EXISTS(SELECT FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=fx_year
      AND fx_date BETWEEN y.starts_on AND y.ends_on) THEN
    PERFORM openerp.fail('PeriodLocked','Recognition requires an open period and matching fiscal year on the explicit date.'); END IF;
  SELECT * INTO STRICT fx_counterparty FROM openerp.commerce_counterparties c
    WHERE c.book_id=p_book AND c.id=p_input->>'counterpartyId';
  IF fx_counterparty.role NOT IN ('customer','both') OR p_input->>'counterpartyRevision' IS DISTINCT FROM fx_counterparty.current_revision::text THEN
    PERFORM openerp.fail('StaleDependency','Select the current reviewed customer counterpart revision.'); END IF;
  SELECT r.body INTO STRICT fx_counterpart FROM openerp.commerce_counterparty_revisions r
    WHERE r.book_id=p_book AND r.counterparty_id=fx_counterparty.id AND r.revision=fx_counterparty.current_revision;
  fx_rate:=openerp.exchange_rate_current(p_book,p_input->>'rateObservationId');
  PERFORM openerp.exchange_rate_require_active(p_book,p_input->>'rateObservationId');
  IF p_input->>'rateDigest' IS DISTINCT FROM fx_rate->>'digest'
    OR fx_rate->'terms'->>'fromCurrency' IS DISTINCT FROM p_input->>'originalCurrency'
    OR fx_rate->'terms'->>'toCurrency' IS DISTINCT FROM fx_book.currency
    OR fx_rate->'terms'->>'effectiveOn' IS DISTINCT FROM fx_date::text THEN
    PERFORM openerp.fail('StaleDependency','Select the exact active directional rate revision for the recognition date and currencies.'); END IF;
  fx_evidence:=openerp.commerce_evidence(p_book,p_input->>'evidenceId');
  PERFORM openerp.invoice_policy_require_evidence(p_book,p_input->'accountRoleEvidence');
  IF (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=p_book AND a.active AND a.id IN
      (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'cashAccountId',
       p_input->>'realizedGainAccountId',p_input->>'realizedLossAccountId'))<>5
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(ARRAY[
      p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'cashAccountId',
      p_input->>'realizedGainAccountId',p_input->>'realizedLossAccountId']))<>5 THEN
    PERFORM openerp.fail('InvalidJournal','Select five distinct active book accounts for the frozen FX account-role profile.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=p_input->>'cashAccountId')
    OR EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id IN
      (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'realizedGainAccountId',p_input->>'realizedLossAccountId'))
    OR EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id IN
      (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'realizedGainAccountId',p_input->>'realizedLossAccountId'))
    OR EXISTS(SELECT FROM openerp.owner_control_accounts c WHERE c.book_id=p_book AND c.account_id IN
      (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'realizedGainAccountId',p_input->>'realizedLossAccountId'))
    OR EXISTS(SELECT FROM openerp.vat_control_account_roles c WHERE c.book_id=p_book AND c.account_id IN
      (p_input->>'controlAccountId',p_input->>'revenueAccountId',p_input->>'realizedGainAccountId',p_input->>'realizedLossAccountId')) THEN
    PERFORM openerp.fail('InvalidJournal','Cash must be a declared book-currency bank account; the four noncash FX roles cannot share bank, legacy commerce, owner or VAT control roles.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=p_book AND i.source_key=p_input->>'sourceKey')
    OR EXISTS(SELECT FROM openerp.events e WHERE e.book_id=p_book
      AND e.evidence_id=p_input->>'evidenceId' AND e.event_key=p_input->>'eventKey') THEN
    PERFORM openerp.fail('IdempotencyConflict','The source obligation or evidence occurrence already has an FX recognition posting history.'); END IF;
  fx_n:=fx_amount*(fx_rate->'terms'->>'rateNumerator')::numeric*('1'||repeat('0',fx_book.currency_scale))::numeric;
  fx_d:=(fx_rate->'terms'->>'rateDenominator')::numeric*('1'||repeat('0',(p_input->>'originalScale')::integer))::numeric;
  fx_q:=div(fx_n,fx_d); fx_r:=mod(fx_n,fx_d); fx_rounded:=fx_q+CASE WHEN 2*fx_r>=fx_d THEN 1 ELSE 0 END;
  IF fx_rounded<=0 OR fx_rounded>=1e38::numeric THEN
    PERFORM openerp.fail('InvalidJournal','The exact recognition conversion must produce a positive book carrying amount below the supported bound.'); END IF;
  SELECT jsonb_agg(jsonb_build_object('role',x.role,'accountId',x.account_id,'version',x.version::text) ORDER BY x.ordinal) INTO fx_roles
    FROM unnest(ARRAY['control','revenue','cash','realized_gain','realized_loss'])
      WITH ORDINALITY x(role,ordinal)
    JOIN openerp.accounts a ON a.book_id=p_book AND a.id=CASE x.role WHEN 'control' THEN p_input->>'controlAccountId'
      WHEN 'revenue' THEN p_input->>'revenueAccountId' WHEN 'cash' THEN p_input->>'cashAccountId'
      WHEN 'realized_gain' THEN p_input->>'realizedGainAccountId' ELSE p_input->>'realizedLossAccountId' END;
  RETURN jsonb_build_object('bookBasis',openerp.exchange_rate_book_basis(p_book),'rate',fx_rate,
    'counterpart',fx_counterpart,'sourceEvidence',fx_evidence,'accountRoleEvidence',p_input->'accountRoleEvidence',
    'accountBindings',fx_roles,
    'calculation',jsonb_build_object('originalCurrency',p_input->>'originalCurrency','originalScale',(p_input->>'originalScale')::integer,
      'originalMinor',fx_amount::text,'bookCurrency',fx_book.currency,'bookScale',fx_book.currency_scale,
      'carryingMinor',fx_rounded::text,'exactNumerator',fx_n::text,'exactDenominator',fx_d::text,
      'quotientMinor',fx_q::text,'remainderNumerator',fx_r::text,'residualNumerator',(fx_n-fx_rounded*fx_d)::text,
      'residualDenominator',fx_d::text,'roundingPolicy','synthetic_half_up_nonnegative_v1',
      'formula','N = originalMinor * rateNumerator * 10^bookScale; D = rateDenominator * 10^originalScale; rounded = div(N,D) + (2*mod(N,D) >= D ? 1 : 0); residualNumerator = N - rounded*D'),
    'fiscalYearId',fx_year,'profileVersion',fx_book.profile_version::text,'writerEpoch',fx_book.writer_epoch::text,
    'periodVersion',fx_period.version::text);
END $$;

CREATE FUNCTION openerp.commerce_fx_recognition_checked(p_book text,p_id text,p_input jsonb,p_executing boolean) RETURNS openerp.commerce_fx_recognition_reviews
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE fx_review openerp.commerce_fx_recognition_reviews;
BEGIN
  PERFORM openerp.commerce_exact_object(p_input,CASE WHEN p_executing THEN ARRAY['version','digest','approvalId'] ELSE ARRAY['version','digest'] END);
  SELECT * INTO STRICT fx_review FROM openerp.commerce_fx_recognition_reviews r WHERE r.book_id=p_book AND r.id=p_id;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'digest' IS DISTINCT FROM fx_review.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Use the exact saved recognition review digest and version.'); END IF;
  IF openerp.commerce_fx_recognition_selection(p_book,fx_review.body->'input') IS DISTINCT FROM fx_review.body->'snapshot' THEN
    PERFORM openerp.fail('StaleDependency','Rate, counterpart, evidence, account, period or profile dependencies changed. Prepare and approve a new review.'); END IF;
  RETURN fx_review;
END $$;

CREATE FUNCTION openerp.prepare_commerce_fx_recognition(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_snapshot jsonb; fx_body jsonb; fx_book openerp.books;
  fx_id text:=openerp.new_id('fx_review'); fx_item text:=openerp.new_id('fx_item');
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'prepare_commerce_fx_recognition',p_input);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_snapshot:=openerp.commerce_fx_recognition_selection(fx_book.id,p_input);
  fx_body:=jsonb_build_object('id',fx_id,'scope',p_scope,'version',1,'itemId',fx_item,'input',p_input,'snapshot',fx_snapshot)
    ||openerp.commerce_record_metadata(p_key,'prepare_commerce_fx_recognition',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  IF octet_length(fx_body::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The recognition review exceeds 256 KiB.'); END IF;
  INSERT INTO openerp.commerce_fx_recognition_reviews(book_id,id,item_id,actor_id,body)
    VALUES(fx_book.id,fx_id,fx_item,fx_actor,fx_body);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'prepare_commerce_fx_recognition',p_input,fx_body);
END $$;

CREATE FUNCTION openerp.approve_commerce_fx_recognition(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_recognition_reviews; fx_body jsonb;
  fx_id text:=openerp.new_id('fx_recognition_approval'); fx_expires timestamptz:=clock_timestamp()+interval '1 hour';
  fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(p_scope->>'bookId',p_key,fx_actor,'approve_commerce_fx_recognition',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_recognition_checked(p_scope->>'bookId',p_id,p_input,false);
  IF fx_actor=fx_review.actor_id THEN PERFORM openerp.fail('ApprovalRequired','An independent current operator must approve recognition.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=fx_review.book_id AND i.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Recognition already executed. Recover its monetary item.'); END IF;
  fx_body:=jsonb_build_object('id',fx_id,'scope',p_scope,'kind','recognition','reviewId',p_id,
    'reviewDigest',fx_review.body->>'digest','actorId',fx_actor,
    'expiresAt',to_char(fx_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'approve_commerce_fx_recognition',fx_actor);
  INSERT INTO openerp.commerce_fx_recognition_approvals VALUES(p_scope->>'bookId',fx_id,p_id,fx_actor,fx_review.body->>'digest',fx_expires,fx_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,fx_actor,'approve_commerce_fx_recognition',fx_payload,fx_body);
END $$;

CREATE FUNCTION openerp.commerce_fx_post(p_scope jsonb,p_action jsonb,p_approval_id text,p_actor text,p_expires timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_book openerp.books; fx_plan_id text:=openerp.new_id('change'); fx_voucher text:=openerp.new_id('voucher');
  fx_receipt text:=openerp.new_id('receipt'); fx_number bigint; fx_sequence bigint; fx_recorded timestamptz;
  fx_plan jsonb; fx_posting jsonb;
BEGIN
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId';
  fx_plan:=jsonb_build_object('schemaVersion','1','canonicalization','openerp-c14n-v1','id',fx_plan_id,'version',1,
    'scope',p_scope,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'dependencies','[]'::jsonb,'groups',jsonb_build_array(jsonb_build_object('id',openerp.new_id('group'),
      'dependsOnGroupIds','[]'::jsonb,'actions',jsonb_build_array(p_action))));
  fx_plan:=fx_plan||jsonb_build_object('planDigest',openerp.digest(fx_plan));
  INSERT INTO openerp.change_sets VALUES(fx_book.id,fx_plan_id,fx_plan,fx_plan->>'planDigest',p_actor,clock_timestamp());
  INSERT INTO openerp.approvals(book_id,id,change_set_id,digest,actor_id,expires_at,consumed_at)
    VALUES(fx_book.id,p_approval_id,fx_plan_id,fx_plan->>'planDigest',p_actor,p_expires,clock_timestamp());
  INSERT INTO openerp.series_counters(book_id,fiscal_year_id,series,last_number) VALUES(fx_book.id,
    p_action->>'fiscalYearId',p_action->>'series',1) ON CONFLICT(book_id,fiscal_year_id,series)
    DO UPDATE SET last_number=openerp.series_counters.last_number+1 RETURNING last_number INTO fx_number;
  UPDATE openerp.books SET committed_sequence=committed_sequence+1 WHERE id=fx_book.id RETURNING committed_sequence INTO fx_sequence;
  INSERT INTO openerp.vouchers(book_id,id,fiscal_year_id,period_id,series,number,sequence,posting_date,event_id,
    posting_purpose,occurrence_key,corrects_voucher_id,change_set_id,action)
    VALUES(fx_book.id,fx_voucher,p_action->>'fiscalYearId',p_action->>'accountingPeriodId',p_action->>'series',fx_number,
      fx_sequence,(p_action->>'postingDate')::date,p_action->>'eventId',p_action->>'postingPurpose',p_action->>'occurrenceKey',
      p_action->>'correctsVoucherId',fx_plan_id,p_action) RETURNING recorded_at INTO fx_recorded;
  INSERT INTO openerp.journal_lines(book_id,voucher_id,id,ordinal,account_id,debit_minor,credit_minor,description)
    SELECT fx_book.id,fx_voucher,value->>'lineId',ordinal,value->>'accountId',(value->>'debitMinor')::numeric,
      (value->>'creditMinor')::numeric,value->>'description' FROM jsonb_array_elements(p_action->'lines') WITH ORDINALITY l(value,ordinal);
  fx_posting:=jsonb_build_object('id',fx_receipt,'changeSetId',fx_plan_id,'voucherId',fx_voucher,
    'planDigest',fx_plan->>'planDigest','sequence',fx_sequence::text,'voucherNumber',fx_number::text,
    'committedAt',to_char(fx_recorded AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.execution_receipts VALUES(fx_book.id,fx_receipt,fx_plan_id,fx_voucher,p_approval_id,fx_posting);
  INSERT INTO openerp.outbox(book_id,id,receipt_id,kind,payload) VALUES(fx_book.id,openerp.new_id('outbox'),
    fx_receipt,'voucher.posted.v1',fx_posting);
  RETURN fx_posting;
END $$;

CREATE FUNCTION openerp.execute_commerce_fx_recognition(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_recognition_reviews; fx_approval openerp.commerce_fx_recognition_approvals;
  fx_book openerp.books; fx_event text; fx_control_line text:=openerp.new_id('line'); fx_revenue_line text:=openerp.new_id('line');
  fx_action jsonb; fx_lines jsonb; fx_posting jsonb; fx_body jsonb; fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
  fx_rate jsonb; fx_counterpart jsonb; fx_source jsonb; fx_bindings jsonb; fx_calculation jsonb;
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'execute_commerce_fx_recognition',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_recognition_checked(fx_book.id,p_id,p_input,true);
  IF EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=fx_book.id AND i.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Recognition already executed. Recover the original command or monetary item.'); END IF;
  SELECT * INTO STRICT fx_approval FROM openerp.commerce_fx_recognition_approvals a
    WHERE a.book_id=fx_book.id AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR fx_approval.digest IS DISTINCT FROM fx_review.body->>'digest' OR fx_approval.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=fx_book.id AND m.actor_id=fx_approval.actor_id AND m.role='operator') THEN
    PERFORM openerp.fail('ApprovalRequired','A current unused independent operator approval of this exact recognition is required.'); END IF;
  SELECT e.id INTO fx_event FROM openerp.events e WHERE e.book_id=fx_book.id
    AND e.evidence_id=fx_review.body->'snapshot'->'sourceEvidence'->>'evidenceId' AND e.event_key=fx_review.body->'input'->>'eventKey';
  IF NOT FOUND THEN
    fx_event:=openerp.new_id('event');
    INSERT INTO openerp.events VALUES(fx_book.id,fx_event,fx_review.body->'snapshot'->'sourceEvidence'->>'evidenceId',fx_review.body->'input'->>'eventKey');
  END IF;
  fx_calculation:=fx_review.body->'snapshot'->'calculation';
  fx_lines:=jsonb_build_array(
    jsonb_build_object('lineId',fx_control_line,'accountId',fx_review.body->'input'->>'controlAccountId',
      'debitMinor',fx_calculation->>'carryingMinor','creditMinor','0','description','Foreign customer receivable recognition'),
    jsonb_build_object('lineId',fx_revenue_line,'accountId',fx_review.body->'input'->>'revenueAccountId',
      'debitMinor','0','creditMinor',fx_calculation->>'carryingMinor','description','Synthetic foreign-customer revenue recognition'));
  fx_action:=jsonb_build_object('kind','post_voucher','correctsVoucherId',NULL,'eventId',fx_event,
    'postingPurpose','adjustment','occurrenceKey','commerce_fx_recognition_'||fx_review.item_id,
    'fiscalYearId',fx_review.body->'snapshot'->>'fiscalYearId','accountingPeriodId',fx_review.body->'input'->>'accountingPeriodId',
    'postingDate',fx_review.body->'input'->>'recognitionDate','series',fx_review.body->'input'->>'series','currency',fx_book.currency,
    'description','Synthetic foreign customer receivable recognition','rationale',fx_review.body->'input'->>'reason',
    'taxAssessment','not_applicable','lines',fx_lines,
    'evidenceRefs',jsonb_build_array(fx_review.body->'snapshot'->'sourceEvidence'||jsonb_build_object('locator',fx_review.body->'input'->>'eventKey')),
    'foreignCurrency',jsonb_build_object('kind','recognition_v1','itemId',fx_review.item_id,
      'reviewId',p_id,'reviewDigest',fx_review.body->>'digest','sourceKey',fx_review.body->'input'->>'sourceKey',
      'sourceRevision',fx_review.body->'input'->>'sourceRevision'));
  fx_posting:=openerp.commerce_fx_post(p_scope,fx_action,fx_approval.id,fx_approval.actor_id,fx_approval.expires_at);
  fx_rate:=jsonb_build_object('observationId',fx_review.body->'snapshot'->'rate'->>'observationId',
    'revision',fx_review.body->'snapshot'->'rate'->>'revision','digest',fx_review.body->'snapshot'->'rate'->>'digest',
    'rate',fx_review.body->'snapshot'->'rate');
  fx_counterpart:=fx_review.body->'snapshot'->'counterpart';
  fx_source:=jsonb_build_object('kind',fx_review.body->'input'->>'profile','sourceKey',fx_review.body->'input'->>'sourceKey',
    'sourceRevision',fx_review.body->'input'->>'sourceRevision','counterpartyId',fx_counterpart->>'id',
    'counterpartyRevision',fx_counterpart->>'revision','counterpartyName',fx_counterpart->>'displayName',
    'documentNumber',fx_review.body->'input'->>'documentNumber','recognitionDate',fx_review.body->'input'->>'recognitionDate',
    'evidence',fx_review.body->'snapshot'->'sourceEvidence');
  fx_bindings:=fx_review.body->'snapshot'->'accountBindings';
  fx_body:=jsonb_build_object('id',fx_review.item_id,'scope',p_scope,'kind',fx_review.body->'input'->>'profile',
    'direction','customer','source',fx_source,'rate',fx_rate,
    'original',jsonb_build_object('currency',fx_review.body->'input'->>'originalCurrency','scale',(fx_review.body->'input'->>'originalScale')::integer,'minor',fx_calculation->>'originalMinor'),
    'book',jsonb_build_object('currency',fx_book.currency,'scale',fx_book.currency_scale,'carryingMinor',fx_calculation->>'carryingMinor'),
    'initialOriginalMinor',fx_calculation->>'originalMinor','initialCarryingMinor',fx_calculation->>'carryingMinor',
    'accountBindings',fx_bindings,
    'recognition',jsonb_build_object('eventId',fx_event,'voucherId',fx_posting->>'voucherId','lineId',fx_control_line,'postingReceipt',fx_posting))
    ||openerp.commerce_record_metadata(p_key,'execute_commerce_fx_recognition',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  INSERT INTO openerp.commerce_fx_items(book_id,id,review_id,approval_id,posting_receipt_id,counterparty_id,
    counterparty_revision,source_key,source_revision,evidence_id,rate_observation_id,rate_revision,rate_digest,event_id,
    voucher_id,line_id,original_currency,original_scale,original_minor,book_currency,book_scale,carrying_minor,body)
    VALUES(fx_book.id,fx_review.item_id,p_id,fx_approval.id,fx_posting->>'id',fx_counterpart->>'id',
      (fx_counterpart->>'revision')::bigint,fx_review.body->'input'->>'sourceKey',fx_review.body->'input'->>'sourceRevision',
      fx_review.body->'snapshot'->'sourceEvidence'->>'evidenceId',fx_rate->>'observationId',fx_rate->>'revision',fx_rate->>'digest',
      fx_event,fx_posting->>'voucherId',fx_control_line,fx_review.body->'input'->>'originalCurrency',
      (fx_review.body->'input'->>'originalScale')::integer,(fx_calculation->>'originalMinor')::numeric,fx_book.currency,
      fx_book.currency_scale,(fx_calculation->>'carryingMinor')::numeric,fx_body);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'execute_commerce_fx_recognition',fx_payload,
    openerp.commerce_fx_item_body(fx_book.id,fx_review.item_id));
END $$;

CREATE FUNCTION openerp.commerce_fx_settlement_selection(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_book openerp.books; fx_period openerp.periods; fx_year text; fx_item jsonb; fx_evidence jsonb;
  fx_roles jsonb; fx_date date; fx_consideration numeric; fx_gain numeric;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','itemId','settlementDate','accountingPeriodId',
    'considerationMinor','evidenceId','eventKey','series','reason','feesExcluded','fullSettlementOnly','acknowledgeLimitedProfile']);
  IF p_input->>'profile'<>'synthetic_full_book_currency_settlement_v1' OR p_input->'feesExcluded'<>'true'::jsonb
    OR p_input->'fullSettlementOnly'<>'true'::jsonb OR p_input->'acknowledgeLimitedProfile'<>'true'::jsonb
    OR p_input->>'series' !~ '^[A-Z0-9]{1,16}$' OR p_input->>'eventKey' !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
    PERFORM openerp.fail('UnsupportedProfile','Select the explicit full book-currency settlement profile without fees.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  fx_date:=openerp.bank_date(p_input->>'settlementDate');
  fx_consideration:=openerp.commerce_positive_minor(p_input,'considerationMinor');
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_book;
  fx_item:=openerp.commerce_fx_item_body(p_book,p_input->>'itemId');
  IF fx_item->>'status'<>'open' OR fx_item->>'remainingOriginalMinor' IS DISTINCT FROM fx_item->>'initialOriginalMinor'
    OR fx_item->>'remainingCarryingMinor' IS DISTINCT FROM fx_item->>'initialCarryingMinor' THEN
    PERFORM openerp.fail('StaleDependency','Only the current open full paired capacity can use this settlement profile.'); END IF;
  IF fx_date<(fx_item->'source'->>'recognitionDate')::date THEN
    PERFORM openerp.fail('InvalidJournal','Settlement cannot precede recognition.'); END IF;
  SELECT * INTO STRICT fx_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_input->>'accountingPeriodId';
  SELECT p.fiscal_year_id INTO STRICT fx_year FROM openerp.periods p WHERE p.book_id=p_book AND p.id=fx_period.id;
  IF fx_period.locked OR fx_date NOT BETWEEN fx_period.starts_on AND fx_period.ends_on
    OR NOT EXISTS(SELECT FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=fx_year
      AND fx_date BETWEEN y.starts_on AND y.ends_on) THEN
    PERFORM openerp.fail('PeriodLocked','Settlement requires an open period and matching fiscal year on the explicit date.'); END IF;
  fx_evidence:=openerp.commerce_evidence(p_book,p_input->>'evidenceId');
  IF EXISTS(SELECT FROM openerp.events e WHERE e.book_id=p_book
    AND e.evidence_id=p_input->>'evidenceId' AND e.event_key=p_input->>'eventKey') THEN
    PERFORM openerp.fail('IdempotencyConflict','The actual-settlement evidence occurrence already has an event identity.'); END IF;
  SELECT jsonb_agg(value ORDER BY ordinal) INTO fx_roles FROM jsonb_array_elements(fx_item->'accountBindings') WITH ORDINALITY x(value,ordinal);
  IF EXISTS(SELECT FROM jsonb_array_elements(fx_roles) role
      WHERE NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=role->>'accountId'
        AND a.active AND a.version::text=role->>'version'))
    OR NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=
      (SELECT value->>'accountId' FROM jsonb_array_elements(fx_roles) WHERE value->>'role'='cash')) THEN
    PERFORM openerp.fail('StaleDependency','The frozen account roles or declared book-currency cash account changed.'); END IF;
  fx_gain:=fx_consideration-(fx_item->>'remainingCarryingMinor')::numeric;
  IF fx_gain<0 AND abs(fx_gain)>=1e38::numeric OR fx_gain>=1e38::numeric THEN
    PERFORM openerp.fail('InvalidJournal','The realized FX result exceeds the supported exact bound.'); END IF;
  RETURN jsonb_build_object('item',fx_item-ARRAY['status','remainingOriginalMinor','remainingCarryingMinor','settlement','correction'],
    'sourceEvidence',fx_evidence,
    'calculation',jsonb_build_object('originalReleasedMinor',fx_item->>'remainingOriginalMinor',
      'carryingReleasedMinor',fx_item->>'remainingCarryingMinor','considerationMinor',fx_consideration::text,
      'realizedGainMinor',fx_gain::text,
      'formula','realizedGainMinor = considerationMinor - carryingReleasedMinor; positive gain is credit and negative loss is debit'),
    'fiscalYearId',fx_year,'profileVersion',fx_book.profile_version::text,'writerEpoch',fx_book.writer_epoch::text,
    'periodVersion',fx_period.version::text,'accountBindings',fx_roles);
END $$;

CREATE FUNCTION openerp.commerce_fx_settlement_checked(p_book text,p_id text,p_input jsonb,p_executing boolean) RETURNS openerp.commerce_fx_settlement_reviews
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE fx_review openerp.commerce_fx_settlement_reviews;
BEGIN
  PERFORM openerp.commerce_exact_object(p_input,CASE WHEN p_executing THEN ARRAY['version','digest','approvalId'] ELSE ARRAY['version','digest'] END);
  SELECT * INTO STRICT fx_review FROM openerp.commerce_fx_settlement_reviews r WHERE r.book_id=p_book AND r.id=p_id;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'digest' IS DISTINCT FROM fx_review.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Use the exact saved settlement review digest and version.'); END IF;
  IF openerp.commerce_fx_settlement_selection(p_book,fx_review.body->'input') IS DISTINCT FROM fx_review.body->'snapshot' THEN
    PERFORM openerp.fail('StaleDependency','Item capacity, evidence, account, period or profile dependencies changed. Prepare and approve a new review.'); END IF;
  RETURN fx_review;
END $$;

CREATE FUNCTION openerp.prepare_commerce_fx_settlement(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_body jsonb; fx_book openerp.books; fx_id text:=openerp.new_id('fx_settlement_review');
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'prepare_commerce_fx_settlement',p_input);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_body:=jsonb_build_object('id',fx_id,'scope',p_scope,'version',1,'itemId',p_input->>'itemId','input',p_input,
    'snapshot',openerp.commerce_fx_settlement_selection(fx_book.id,p_input))
    ||openerp.commerce_record_metadata(p_key,'prepare_commerce_fx_settlement',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  IF octet_length(fx_body::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The settlement review exceeds 256 KiB.'); END IF;
  INSERT INTO openerp.commerce_fx_settlement_reviews VALUES(fx_book.id,fx_id,p_input->>'itemId',fx_actor,fx_body);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'prepare_commerce_fx_settlement',p_input,fx_body);
END $$;

CREATE FUNCTION openerp.approve_commerce_fx_settlement(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_settlement_reviews; fx_body jsonb;
  fx_id text:=openerp.new_id('fx_settlement_approval'); fx_expires timestamptz:=clock_timestamp()+interval '1 hour';
  fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(p_scope->>'bookId',p_key,fx_actor,'approve_commerce_fx_settlement',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_settlement_checked(p_scope->>'bookId',p_id,p_input,false);
  IF fx_actor=fx_review.actor_id THEN PERFORM openerp.fail('ApprovalRequired','An independent current operator must approve settlement.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=fx_review.book_id AND s.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Settlement already executed. Recover its receipt.'); END IF;
  fx_body:=jsonb_build_object('id',fx_id,'scope',p_scope,'kind','settlement','reviewId',p_id,
    'reviewDigest',fx_review.body->>'digest','actorId',fx_actor,
    'expiresAt',to_char(fx_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'approve_commerce_fx_settlement',fx_actor);
  INSERT INTO openerp.commerce_fx_settlement_approvals VALUES(p_scope->>'bookId',fx_id,p_id,fx_actor,fx_review.body->>'digest',fx_expires,fx_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,fx_actor,'approve_commerce_fx_settlement',fx_payload,fx_body);
END $$;

CREATE FUNCTION openerp.execute_commerce_fx_settlement(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_settlement_reviews; fx_approval openerp.commerce_fx_settlement_approvals;
  fx_book openerp.books; fx_event text; fx_cash_line text:=openerp.new_id('line'); fx_control_line text:=openerp.new_id('line');
  fx_realized_line text; fx_action jsonb; fx_lines jsonb; fx_posting jsonb; fx_body jsonb;
  fx_calculation jsonb; fx_roles jsonb; fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'execute_commerce_fx_settlement',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_settlement_checked(fx_book.id,p_id,p_input,true);
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=fx_book.id AND s.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Settlement already executed. Recover the original command.'); END IF;
  SELECT * INTO STRICT fx_approval FROM openerp.commerce_fx_settlement_approvals a
    WHERE a.book_id=fx_book.id AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR fx_approval.digest IS DISTINCT FROM fx_review.body->>'digest' OR fx_approval.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=fx_book.id AND m.actor_id=fx_approval.actor_id AND m.role='operator') THEN
    PERFORM openerp.fail('ApprovalRequired','A current unused independent operator approval of this exact settlement is required.'); END IF;
  SELECT e.id INTO fx_event FROM openerp.events e WHERE e.book_id=fx_book.id
    AND e.evidence_id=fx_review.body->'snapshot'->'sourceEvidence'->>'evidenceId' AND e.event_key=fx_review.body->'input'->>'eventKey';
  IF NOT FOUND THEN
    fx_event:=openerp.new_id('event');
    INSERT INTO openerp.events VALUES(fx_book.id,fx_event,fx_review.body->'snapshot'->'sourceEvidence'->>'evidenceId',fx_review.body->'input'->>'eventKey');
  END IF;
  fx_calculation:=fx_review.body->'snapshot'->'calculation'; fx_roles:=fx_review.body->'snapshot'->'accountBindings';
  fx_lines:=jsonb_build_array(
    jsonb_build_object('lineId',fx_cash_line,'accountId',fx_roles->2->>'accountId','debitMinor',fx_calculation->>'considerationMinor',
      'creditMinor','0','description','Book-currency customer cash settlement'),
    jsonb_build_object('lineId',fx_control_line,'accountId',fx_roles->0->>'accountId','debitMinor','0',
      'creditMinor',fx_calculation->>'carryingReleasedMinor','description','Foreign customer receivable carrying release'));
  IF (fx_calculation->>'realizedGainMinor')::numeric>0 THEN
    fx_realized_line:=openerp.new_id('line');
    fx_lines:=fx_lines||jsonb_build_array(jsonb_build_object('lineId',fx_realized_line,'accountId',fx_roles->3->>'accountId',
      'debitMinor','0','creditMinor',fx_calculation->>'realizedGainMinor','description','Realized foreign-currency gain'));
  ELSIF (fx_calculation->>'realizedGainMinor')::numeric<0 THEN
    fx_realized_line:=openerp.new_id('line');
    fx_lines:=jsonb_build_array(jsonb_build_object('lineId',fx_cash_line,'accountId',fx_roles->2->>'accountId',
      'debitMinor',fx_calculation->>'considerationMinor','creditMinor','0','description','Book-currency customer cash settlement'),
      jsonb_build_object('lineId',fx_realized_line,'accountId',fx_roles->4->>'accountId','debitMinor',abs((fx_calculation->>'realizedGainMinor')::numeric)::text,
        'creditMinor','0','description','Realized foreign-currency loss'),
      jsonb_build_object('lineId',fx_control_line,'accountId',fx_roles->0->>'accountId','debitMinor','0',
        'creditMinor',fx_calculation->>'carryingReleasedMinor','description','Foreign customer receivable carrying release'));
  END IF;
  fx_action:=jsonb_build_object('kind','post_voucher','correctsVoucherId',NULL,'eventId',fx_event,
    'postingPurpose','adjustment','occurrenceKey','commerce_fx_settlement_'||p_id,
    'fiscalYearId',fx_review.body->'snapshot'->>'fiscalYearId','accountingPeriodId',fx_review.body->'input'->>'accountingPeriodId',
    'postingDate',fx_review.body->'input'->>'settlementDate','series',fx_review.body->'input'->>'series','currency',fx_book.currency,
    'description','Synthetic full book-currency foreign-customer settlement','rationale',fx_review.body->'input'->>'reason',
    'taxAssessment','not_applicable','lines',fx_lines,
    'evidenceRefs',jsonb_build_array(fx_review.body->'snapshot'->'sourceEvidence'||jsonb_build_object('locator',fx_review.body->'input'->>'eventKey')),
    'foreignCurrency',jsonb_build_object('kind','settlement_v1','itemId',fx_review.item_id,'reviewId',p_id,
      'reviewDigest',fx_review.body->>'digest','settlementDigest',openerp.digest(fx_review.body->'snapshot'->'calculation')));
  fx_posting:=openerp.commerce_fx_post(p_scope,fx_action,fx_approval.id,fx_approval.actor_id,fx_approval.expires_at);
  fx_body:=jsonb_build_object('id',openerp.new_id('fx_settlement'),'scope',p_scope,'itemId',fx_review.item_id,
    'reviewId',p_id,'reviewDigest',fx_review.body->>'digest','approvalId',fx_approval.id,
    'originalReleasedMinor',fx_calculation->>'originalReleasedMinor','carryingReleasedMinor',fx_calculation->>'carryingReleasedMinor',
    'considerationMinor',fx_calculation->>'considerationMinor','realizedGainMinor',fx_calculation->>'realizedGainMinor',
    'formula',fx_calculation->>'formula','postingReceipt',fx_posting,
    'committedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'execute_commerce_fx_settlement',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  INSERT INTO openerp.commerce_fx_settlements(book_id,id,item_id,review_id,approval_id,posting_receipt_id,event_id,
    voucher_id,cash_line_id,control_line_id,realized_line_id,original_released_minor,carrying_released_minor,
    consideration_minor,realized_gain_minor,body)
    VALUES(fx_book.id,fx_body->>'id',fx_review.item_id,p_id,fx_approval.id,fx_posting->>'id',fx_event,fx_posting->>'voucherId',
      fx_cash_line,fx_control_line,fx_realized_line,(fx_calculation->>'originalReleasedMinor')::numeric,
      (fx_calculation->>'carryingReleasedMinor')::numeric,(fx_calculation->>'considerationMinor')::numeric,
      (fx_calculation->>'realizedGainMinor')::numeric,fx_body);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'execute_commerce_fx_settlement',fx_payload,fx_body);
END $$;

CREATE FUNCTION openerp.commerce_fx_correction_selection(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,openerp AS $$
DECLARE fx_book openerp.books; fx_settlement openerp.commerce_fx_settlements; fx_item jsonb; fx_voucher openerp.vouchers;
  fx_period openerp.periods; fx_year text; fx_evidence jsonb; fx_lines jsonb; fx_roles jsonb; fx_date date;
  fx_resource jsonb; fx_blocker text;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['profile','settlementId','accountingPeriodId','postingDate',
    'evidenceId','reason','latestUnconsumedOnly','acknowledgeLimitedProfile']);
  IF p_input->>'profile'<>'synthetic_latest_settlement_correction_v1' OR p_input->'latestUnconsumedOnly'<>'true'::jsonb
    OR p_input->'acknowledgeLimitedProfile'<>'true'::jsonb THEN
    PERFORM openerp.fail('UnsupportedProfile','Select the explicit latest-unconsumed settlement correction profile.'); END IF;
  PERFORM openerp.commerce_text(p_input,'reason',2000);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_book;
  SELECT * INTO STRICT fx_settlement FROM openerp.commerce_fx_settlements s WHERE s.book_id=p_book AND s.id=p_input->>'settlementId';
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=p_book AND c.settlement_id=fx_settlement.id) THEN
    PERFORM openerp.fail('AlreadyPosted','The latest settlement is already consumed by an owned correction.'); END IF;
  SELECT * INTO STRICT fx_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=fx_settlement.voucher_id;
  IF NOT openerp.commerce_voucher_current(p_book,fx_voucher.id) THEN
    PERFORM openerp.fail('StaleDependency','The settlement voucher is already corrected outside this owner.'); END IF;
  FOR fx_resource IN SELECT value FROM jsonb_array_elements(openerp.correction_impact_resources(p_book,fx_voucher.id,NULL)) LOOP
    IF fx_resource->>'blocks'='true' THEN fx_blocker:=fx_resource->>'detail'; END IF;
  END LOOP;
  IF fx_blocker IS NOT NULL THEN PERFORM openerp.fail('UnsupportedProfile',fx_blocker); END IF;
  fx_item:=openerp.commerce_fx_item_body(p_book,fx_settlement.item_id);
  IF fx_item->>'status'<>'settled' OR fx_item->>'remainingOriginalMinor'<>'0' OR fx_item->>'remainingCarryingMinor'<>'0' THEN
    PERFORM openerp.fail('StaleDependency','Correction requires the settled zero-residual owner state.'); END IF;
  fx_date:=openerp.bank_date(p_input->>'postingDate');
  IF fx_date<fx_voucher.posting_date THEN PERFORM openerp.fail('InvalidJournal','Correction cannot precede the settlement posting.'); END IF;
  SELECT * INTO STRICT fx_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_input->>'accountingPeriodId';
  SELECT p.fiscal_year_id INTO STRICT fx_year FROM openerp.periods p WHERE p.book_id=p_book AND p.id=fx_period.id;
  IF fx_period.locked OR fx_date NOT BETWEEN fx_period.starts_on AND fx_period.ends_on
    OR NOT EXISTS(SELECT FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=fx_year
      AND fx_date BETWEEN y.starts_on AND y.ends_on) THEN
    PERFORM openerp.fail('PeriodLocked','Correction requires an open period and matching fiscal year on the explicit date.'); END IF;
  fx_evidence:=openerp.commerce_evidence(p_book,p_input->>'evidenceId');
  SELECT jsonb_agg(value ORDER BY ordinal) INTO fx_roles FROM jsonb_array_elements(fx_item->'accountBindings') WITH ORDINALITY x(value,ordinal);
  IF EXISTS(SELECT FROM jsonb_array_elements(fx_roles) role
      WHERE NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=role->>'accountId'
        AND a.active AND a.version::text=role->>'version')) THEN
    PERFORM openerp.fail('StaleDependency','An account used by the frozen settlement role profile changed.'); END IF;
  SELECT jsonb_agg(value||jsonb_build_object('lineId',openerp.new_id('line'),'debitMinor',value->>'creditMinor',
    'creditMinor',value->>'debitMinor') ORDER BY ordinal) INTO fx_lines
    FROM jsonb_array_elements(fx_voucher.action->'lines') WITH ORDINALITY l(value,ordinal);
  RETURN jsonb_build_object('item',fx_item,'settlement',fx_settlement.body,'voucher',openerp.voucher_body(fx_voucher),
    'sourceEvidence',fx_evidence,'reversalLines',fx_lines,'fiscalYearId',fx_year,
    'profileVersion',fx_book.profile_version::text,'writerEpoch',fx_book.writer_epoch::text,
    'periodVersion',fx_period.version::text,'accountBindings',fx_roles);
END $$;

CREATE FUNCTION openerp.commerce_fx_correction_checked(p_book text,p_id text,p_input jsonb,p_executing boolean) RETURNS openerp.commerce_fx_settlement_correction_reviews
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE fx_review openerp.commerce_fx_settlement_correction_reviews;
BEGIN
  PERFORM openerp.commerce_exact_object(p_input,CASE WHEN p_executing THEN ARRAY['version','digest','approvalId'] ELSE ARRAY['version','digest'] END);
  SELECT * INTO STRICT fx_review FROM openerp.commerce_fx_settlement_correction_reviews r WHERE r.book_id=p_book AND r.id=p_id;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'digest' IS DISTINCT FROM fx_review.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Use the exact saved correction review digest and version.'); END IF;
  IF openerp.commerce_fx_correction_selection(p_book,fx_review.body->'input') IS DISTINCT FROM fx_review.body->'snapshot' THEN
    PERFORM openerp.fail('StaleDependency','Settlement, dependencies, evidence or downstream blockers changed. Prepare and approve a new correction.'); END IF;
  RETURN fx_review;
END $$;

CREATE FUNCTION openerp.prepare_commerce_fx_settlement_correction(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_body jsonb; fx_book openerp.books;
  fx_id text:=openerp.new_id('fx_settlement_correction_review');
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'prepare_commerce_fx_settlement_correction',p_input);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_body:=jsonb_build_object('id',fx_id,'scope',p_scope,'version',1,'settlementId',p_input->>'settlementId','input',p_input,
    'snapshot',openerp.commerce_fx_correction_selection(fx_book.id,p_input))
    ||openerp.commerce_record_metadata(p_key,'prepare_commerce_fx_settlement_correction',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  IF octet_length(fx_body::text)>262144 THEN PERFORM openerp.fail('InvalidJournal','The correction review exceeds 256 KiB.'); END IF;
  INSERT INTO openerp.commerce_fx_settlement_correction_reviews VALUES(fx_book.id,fx_id,p_input->>'settlementId',fx_actor,fx_body);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'prepare_commerce_fx_settlement_correction',p_input,fx_body);
END $$;

CREATE FUNCTION openerp.approve_commerce_fx_settlement_correction(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_settlement_correction_reviews; fx_body jsonb;
  fx_id text:=openerp.new_id('fx_correction_approval'); fx_expires timestamptz:=clock_timestamp()+interval '1 hour';
  fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(p_scope->>'bookId',p_key,fx_actor,'approve_commerce_fx_settlement_correction',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_correction_checked(p_scope->>'bookId',p_id,p_input,false);
  IF fx_actor=fx_review.actor_id THEN PERFORM openerp.fail('ApprovalRequired','An independent current operator must approve settlement correction.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=fx_review.book_id AND c.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Correction already executed. Recover its receipt.'); END IF;
  fx_body:=jsonb_build_object('id',fx_id,'scope',p_scope,'kind','correction','reviewId',p_id,
    'reviewDigest',fx_review.body->>'digest','actorId',fx_actor,
    'expiresAt',to_char(fx_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'approve_commerce_fx_settlement_correction',fx_actor);
  INSERT INTO openerp.commerce_fx_settlement_correction_approvals VALUES(p_scope->>'bookId',fx_id,p_id,fx_actor,fx_review.body->>'digest',fx_expires,fx_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,fx_actor,'approve_commerce_fx_settlement_correction',fx_payload,fx_body);
END $$;

CREATE FUNCTION openerp.execute_commerce_fx_settlement_correction(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_previous jsonb; fx_review openerp.commerce_fx_settlement_correction_reviews;
  fx_approval openerp.commerce_fx_settlement_correction_approvals; fx_book openerp.books; fx_settlement openerp.commerce_fx_settlements;
  fx_action jsonb; fx_posting jsonb; fx_body jsonb; fx_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT fx_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  fx_previous:=openerp.replay(fx_book.id,p_key,fx_actor,'execute_commerce_fx_settlement_correction',fx_payload);
  IF fx_previous IS NOT NULL THEN RETURN fx_previous; END IF;
  fx_review:=openerp.commerce_fx_correction_checked(fx_book.id,p_id,p_input,true);
  SELECT * INTO STRICT fx_settlement FROM openerp.commerce_fx_settlements s WHERE s.book_id=fx_book.id AND s.id=fx_review.settlement_id;
  IF EXISTS(SELECT FROM openerp.commerce_fx_settlement_corrections c WHERE c.book_id=fx_book.id AND c.review_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','Correction already executed. Recover the original command.'); END IF;
  SELECT * INTO STRICT fx_approval FROM openerp.commerce_fx_settlement_correction_approvals a
    WHERE a.book_id=fx_book.id AND a.id=p_input->>'approvalId' AND a.review_id=p_id;
  IF NOT FOUND OR fx_approval.digest IS DISTINCT FROM fx_review.body->>'digest' OR fx_approval.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=fx_book.id AND m.actor_id=fx_approval.actor_id AND m.role='operator') THEN
    PERFORM openerp.fail('ApprovalRequired','A current unused independent operator approval of this exact correction is required.'); END IF;
  fx_action:=jsonb_build_object('kind','post_voucher','correctsVoucherId',fx_settlement.voucher_id,
    'eventId',fx_review.body->'snapshot'->'voucher'->'action'->>'eventId','postingPurpose','reversal',
    'occurrenceKey',fx_review.settlement_id,'fiscalYearId',fx_review.body->'snapshot'->>'fiscalYearId',
    'accountingPeriodId',fx_review.body->'input'->>'accountingPeriodId','postingDate',fx_review.body->'input'->>'postingDate',
    'series',fx_review.body->'snapshot'->'voucher'->'action'->>'series','currency',fx_book.currency,
    'description','Correction: synthetic foreign-customer settlement','rationale',fx_review.body->'input'->>'reason',
    'taxAssessment','not_applicable','lines',fx_review.body->'snapshot'->'reversalLines',
    'evidenceRefs',jsonb_build_array(
      fx_review.body->'snapshot'->'voucher'->'action'->'evidenceRefs'->0,
      fx_review.body->'snapshot'->'sourceEvidence'||jsonb_build_object('locator','correction')),
    'foreignCurrency',jsonb_build_object('kind','settlement_correction_v1','itemId',fx_settlement.item_id,
      'settlementId',fx_settlement.id,'settlementDigest',fx_settlement.body->>'digest','reviewId',p_id,
      'reviewDigest',fx_review.body->>'digest','correctionEvidence',fx_review.body->'snapshot'->'sourceEvidence'));
  fx_posting:=openerp.commerce_fx_post(p_scope,fx_action,fx_approval.id,fx_approval.actor_id,fx_approval.expires_at);
  fx_body:=jsonb_build_object('id',openerp.new_id('fx_settlement_correction'),'scope',p_scope,'itemId',fx_settlement.item_id,
    'settlementId',fx_settlement.id,'settlementDigest',fx_settlement.body->>'digest','reviewId',p_id,
    'reviewDigest',fx_review.body->>'digest','approvalId',fx_approval.id,'originalVoucherId',fx_settlement.voucher_id,
    'postingReceipt',fx_posting,'restoredOriginalMinor',fx_settlement.original_released_minor::text,
    'restoredCarryingMinor',fx_settlement.carrying_released_minor::text,'reason',fx_review.body->'input'->>'reason',
    'committedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||openerp.commerce_record_metadata(p_key,'execute_commerce_fx_settlement_correction',fx_actor);
  fx_body:=fx_body||jsonb_build_object('digest',openerp.digest(fx_body));
  INSERT INTO openerp.commerce_fx_settlement_corrections(book_id,id,item_id,settlement_id,review_id,approval_id,
    posting_receipt_id,original_voucher_id,body)
    VALUES(fx_book.id,fx_body->>'id',fx_settlement.item_id,fx_settlement.id,p_id,fx_approval.id,fx_posting->>'id',
      fx_settlement.voucher_id,fx_body);
  RETURN openerp.save_command(fx_book.id,p_key,fx_actor,'execute_commerce_fx_settlement_correction',fx_payload,fx_body);
END $$;

CREATE FUNCTION openerp.get_commerce_fx_item(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  RETURN openerp.commerce_fx_item_body(p_scope->>'bookId',p_id);
END $$;

CREATE FUNCTION openerp.recover_commerce_fx_command(p_token text,p_scope jsonb,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE fx_actor text; fx_receipt openerp.command_receipts;
BEGIN
  fx_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN PERFORM openerp.fail('InvalidJournal','Supply the original commerce FX command key.'); END IF;
  SELECT * INTO fx_receipt FROM openerp.command_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.key=p_key
    AND r.actor_id=fx_actor AND r.operation IN('prepare_commerce_fx_recognition','approve_commerce_fx_recognition',
      'execute_commerce_fx_recognition','prepare_commerce_fx_settlement','approve_commerce_fx_settlement',
      'execute_commerce_fx_settlement','prepare_commerce_fx_settlement_correction',
      'approve_commerce_fx_settlement_correction','execute_commerce_fx_settlement_correction');
  RETURN jsonb_build_object('key',p_key,'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'status',CASE WHEN fx_receipt.key IS NULL THEN 'not_recorded_at_check' ELSE 'recorded' END,
    'operation',fx_receipt.operation,'result',fx_receipt.result);
END $$;

CREATE FUNCTION openerp.commerce_fx_guard_owned_posting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
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
    ELSIF fx_meta->>'kind'='settlement_v1' THEN
      SELECT r.body,a.body INTO fx_review,fx_approval FROM openerp.commerce_fx_settlement_reviews r
        JOIN openerp.commerce_fx_settlement_approvals a ON a.book_id=r.book_id AND a.review_id=r.id
        WHERE r.book_id=NEW.book_id AND r.id=fx_meta->>'reviewId' AND a.actor_id=fx_actor AND a.digest=fx_meta->>'reviewDigest';
      IF fx_review IS NULL OR fx_review->>'digest' IS DISTINCT FROM fx_meta->>'reviewDigest'
        OR fx_review->>'itemId' IS DISTINCT FROM fx_meta->>'itemId' OR fx_approval IS NULL
        OR fx_meta->>'settlementDigest' IS DISTINCT FROM openerp.digest(fx_review.body->'snapshot'->'calculation')
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
CREATE TRIGGER commerce_fx_owned_posting BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_guard_owned_posting();

CREATE FUNCTION openerp.commerce_fx_guard_legacy_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,openerp AS $$
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
CREATE TRIGGER commerce_fx_invoice_capacity BEFORE INSERT ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_guard_legacy_capacity();
CREATE TRIGGER commerce_fx_allocation_capacity BEFORE INSERT ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_guard_legacy_capacity();
CREATE TRIGGER commerce_fx_owner_capacity BEFORE INSERT ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.commerce_fx_guard_legacy_capacity();

CREATE OR REPLACE FUNCTION openerp.tax_account_line_claimed(p_book text,p_voucher text,p_line text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT EXISTS(SELECT FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher AND m.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.bank_active_allocation_legs l WHERE l.book_id=p_book AND l.voucher_id=p_voucher AND l.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.voucher_id=p_voucher AND e.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher AND i.recognition_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher AND v.posting_purpose='vat_control_reclassification_v1')
    OR EXISTS(SELECT FROM openerp.commerce_fx_items i WHERE i.book_id=p_book AND i.voucher_id=p_voucher AND i.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_fx_settlements s WHERE s.book_id=p_book AND s.voucher_id=p_voucher
      AND p_line IN(s.cash_line_id,s.control_line_id,s.realized_line_id))
$$;

REVOKE ALL ON FUNCTION openerp.commerce_fx_item_body(text,text),openerp.commerce_fx_recognition_selection(text,jsonb),
  openerp.commerce_fx_recognition_checked(text,text,jsonb,boolean),openerp.commerce_fx_post(jsonb,jsonb,text,text,timestamptz),
  openerp.commerce_fx_settlement_selection(text,jsonb),openerp.commerce_fx_settlement_checked(text,text,jsonb,boolean),
  openerp.commerce_fx_correction_selection(text,jsonb),openerp.commerce_fx_correction_checked(text,text,jsonb,boolean),
  openerp.commerce_fx_guard_owned_posting(),openerp.commerce_fx_guard_legacy_capacity(),
  openerp.tax_account_line_claimed(text,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.prepare_commerce_fx_recognition(text,jsonb,text,jsonb),
  openerp.approve_commerce_fx_recognition(text,jsonb,text,text,jsonb),
  openerp.execute_commerce_fx_recognition(text,jsonb,text,text,jsonb),
  openerp.prepare_commerce_fx_settlement(text,jsonb,text,jsonb),
  openerp.approve_commerce_fx_settlement(text,jsonb,text,text,jsonb),
  openerp.execute_commerce_fx_settlement(text,jsonb,text,text,jsonb),
  openerp.prepare_commerce_fx_settlement_correction(text,jsonb,text,jsonb),
  openerp.approve_commerce_fx_settlement_correction(text,jsonb,text,text,jsonb),
  openerp.execute_commerce_fx_settlement_correction(text,jsonb,text,text,jsonb),
  openerp.get_commerce_fx_item(text,jsonb,text),openerp.recover_commerce_fx_command(text,jsonb,text) TO openerp_runtime;
