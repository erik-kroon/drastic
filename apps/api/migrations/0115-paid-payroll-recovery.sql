CREATE TABLE openerp.payroll_paid_recovery_assessments (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  comparison_id text GENERATED ALWAYS AS (body->>'comparisonId') STORED NOT NULL,
  FOREIGN KEY(book_id,comparison_id) REFERENCES openerp.payroll_correction_comparisons(book_id,id),
  paid_event_id text GENERATED ALWAYS AS (body->>'paidEventId') STORED NOT NULL,
  FOREIGN KEY(book_id,paid_event_id) REFERENCES openerp.payroll_paid_events(book_id,id),
  calculation_id text GENERATED ALWAYS AS (body->'capacity'->>'calculationId') STORED NOT NULL,
  FOREIGN KEY(book_id,calculation_id) REFERENCES openerp.payroll_calculations(book_id,id),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,id,digest),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);

CREATE TRIGGER immutable_payroll_paid_recovery_assessments BEFORE UPDATE OR DELETE ON openerp.payroll_paid_recovery_assessments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT,INSERT ON openerp.payroll_paid_recovery_assessments TO openerp_runtime;

CREATE TABLE openerp.payroll_paid_recovery_drafts (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  assessment_id text GENERATED ALWAYS AS (body->>'assessmentId') STORED NOT NULL,
  FOREIGN KEY(book_id,assessment_id) REFERENCES openerp.payroll_paid_recovery_assessments(book_id,id),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,id,digest),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')),
  UNIQUE(book_id,assessment_id)
);

CREATE TRIGGER immutable_payroll_paid_recovery_drafts BEFORE UPDATE OR DELETE ON openerp.payroll_paid_recovery_drafts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT,INSERT ON openerp.payroll_paid_recovery_drafts TO openerp_runtime;

CREATE TABLE openerp.payroll_paid_recovery_legs (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  assessment_id text GENERATED ALWAYS AS (body->>'assessmentId') STORED NOT NULL,
  FOREIGN KEY(book_id,assessment_id) REFERENCES openerp.payroll_paid_recovery_assessments(book_id,id),
  draft_id text GENERATED ALWAYS AS (body->>'draftId') STORED NOT NULL,
  FOREIGN KEY(book_id,draft_id) REFERENCES openerp.payroll_paid_recovery_drafts(book_id,id),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,id,digest),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')),
  month text GENERATED ALWAYS AS (body->>'month') STORED NOT NULL,
  capacity_calculation_id text GENERATED ALWAYS AS (body->>'capacityCalculationId') STORED,
  FOREIGN KEY(book_id,capacity_calculation_id) REFERENCES openerp.payroll_calculations(book_id,id),
  UNIQUE(book_id,assessment_id,month),
  CHECK(body->>'amountMinor' ~ '^[1-9][0-9]{0,37}$')
);

CREATE TRIGGER immutable_payroll_paid_recovery_legs BEFORE UPDATE OR DELETE ON openerp.payroll_paid_recovery_legs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT,INSERT ON openerp.payroll_paid_recovery_legs TO openerp_runtime;

CREATE TABLE openerp.payroll_paid_recovery_attachments (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  assessment_id text GENERATED ALWAYS AS (body->>'assessmentId') STORED NOT NULL,
  FOREIGN KEY(book_id,assessment_id) REFERENCES openerp.payroll_paid_recovery_assessments(book_id,id),
  evidence_id text GENERATED ALWAYS AS (body->'evidence'->>'evidenceId') STORED NOT NULL,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,id,digest),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);

CREATE TRIGGER immutable_payroll_paid_recovery_attachments BEFORE UPDATE OR DELETE ON openerp.payroll_paid_recovery_attachments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT,INSERT ON openerp.payroll_paid_recovery_attachments TO openerp_runtime;

CREATE TABLE openerp.payroll_paid_recovery_qualifications (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  assessment_id text GENERATED ALWAYS AS (body->>'assessmentId') STORED NOT NULL,
  FOREIGN KEY(book_id,assessment_id) REFERENCES openerp.payroll_paid_recovery_assessments(book_id,id),
  attachment_id text GENERATED ALWAYS AS (body->>'attachmentId') STORED NOT NULL,
  FOREIGN KEY(book_id,attachment_id) REFERENCES openerp.payroll_paid_recovery_attachments(book_id,id),
  basis_id text GENERATED ALWAYS AS (body->'adjustmentBasis'->>'id') STORED NOT NULL,
  FOREIGN KEY(book_id,basis_id) REFERENCES openerp.payroll_adjustment_bases(book_id,id),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,id,digest),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')),
  purpose text GENERATED ALWAYS AS (body->>'purpose') STORED NOT NULL,
  UNIQUE(book_id,attachment_id,purpose),
  CHECK(purpose IN ('gross_claim','net_offset'))
);

CREATE TRIGGER immutable_payroll_paid_recovery_qualifications BEFORE UPDATE OR DELETE ON openerp.payroll_paid_recovery_qualifications FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT,INSERT ON openerp.payroll_paid_recovery_qualifications TO openerp_runtime;

CREATE TABLE openerp.payroll_paid_recovery_claim_reviews (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  assessment_id text GENERATED ALWAYS AS (body->>'assessmentId') STORED NOT NULL,
  FOREIGN KEY(book_id,assessment_id) REFERENCES openerp.payroll_paid_recovery_assessments(book_id,id),
  qualification_id text GENERATED ALWAYS AS (body->>'qualificationId') STORED NOT NULL,
  FOREIGN KEY(book_id,qualification_id) REFERENCES openerp.payroll_paid_recovery_qualifications(book_id,id),
  review_id text GENERATED ALWAYS AS (body->>'reviewId') STORED NOT NULL,
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.payroll_settlement_reviews(book_id,id),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,id,digest),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')),
  UNIQUE(book_id,assessment_id),
  UNIQUE(book_id,review_id)
);

CREATE TRIGGER immutable_payroll_paid_recovery_claim_reviews BEFORE UPDATE OR DELETE ON openerp.payroll_paid_recovery_claim_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT,INSERT ON openerp.payroll_paid_recovery_claim_reviews TO openerp_runtime;

CREATE TABLE openerp.payroll_paid_recovery_cancellations (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  assessment_id text GENERATED ALWAYS AS (body->>'assessmentId') STORED NOT NULL,
  FOREIGN KEY(book_id,assessment_id) REFERENCES openerp.payroll_paid_recovery_assessments(book_id,id),
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,id,digest),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest')),
  UNIQUE(book_id,assessment_id)
);

CREATE TRIGGER immutable_payroll_paid_recovery_cancellations BEFORE UPDATE OR DELETE ON openerp.payroll_paid_recovery_cancellations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT,INSERT ON openerp.payroll_paid_recovery_cancellations TO openerp_runtime;

ALTER TABLE openerp.payroll_adjustment_instructions ADD COLUMN paid_recovery_leg_id text GENERATED ALWAYS AS (body->'netRecovery'->>'paidRecoveryLegId') STORED, ADD FOREIGN KEY(book_id,paid_recovery_leg_id) REFERENCES openerp.payroll_paid_recovery_legs(book_id,id);

CREATE INDEX payroll_paid_recovery_discovery ON openerp.payroll_paid_recovery_assessments(book_id,id);

CREATE INDEX payroll_paid_recovery_leg_reviews ON openerp.payroll_settlement_reviews(book_id,(body->'input'->>'paidRecoveryLegId'));

CREATE OR REPLACE FUNCTION openerp.require_payroll_settlement_consequences() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE review openerp.payroll_settlement_reviews%ROWTYPE;
  run openerp.payroll_runs%ROWTYPE; employee jsonb; instruction jsonb;
BEGIN
  IF TG_TABLE_NAME='payroll_settlement_executions' THEN
    SELECT * INTO review FROM openerp.payroll_settlement_reviews WHERE book_id=NEW.book_id AND id=NEW.review_id;
    IF review.change_set_id IS NOT NULL AND NOT EXISTS(
      SELECT FROM openerp.vouchers v WHERE v.book_id=NEW.book_id AND v.id=NEW.voucher_id AND v.change_set_id=review.change_set_id AND v.event_id=review.event_id
    ) THEN RAISE EXCEPTION 'payroll settlement requires its exact retained voucher' USING ERRCODE='23514'; END IF;
    IF review.body->'cash' <> 'null'::jsonb AND NOT EXISTS(
      SELECT FROM openerp.bank_matches m WHERE m.book_id=NEW.book_id AND m.statement_id=review.body->'cash'->>'statementId'
        AND m.row_ordinal=(review.body->'cash'->>'rowOrdinal')::integer AND m.voucher_id=NEW.voucher_id
    ) THEN RAISE EXCEPTION 'payroll settlement requires its exact retained bank match' USING ERRCODE='23514'; END IF;
    CASE NEW.body->>'kind'
      WHEN 'payment' THEN
        IF NOT EXISTS(SELECT FROM openerp.payroll_paid_events p WHERE p.book_id=NEW.book_id AND p.execution_id=NEW.id AND p.id=NEW.body->'paidEvent'->>'id') THEN
          RAISE EXCEPTION 'payroll payment requires its retained paid event' USING ERRCODE='23514'; END IF;
      WHEN 'noncash_payment' THEN
        IF review.body->'cash'<>'null'::jsonb OR NEW.voucher_id IS NOT NULL OR NOT EXISTS(
          SELECT FROM openerp.payroll_paid_events p
          JOIN openerp.payroll_run_executions r ON r.book_id=p.book_id AND r.run_id=p.run_id
          JOIN openerp.payroll_run_obligations o ON o.book_id=p.book_id AND o.run_id=p.run_id AND o.employee_id=p.employee_id
          WHERE p.book_id=NEW.book_id AND p.execution_id=NEW.id AND p.id=NEW.body->'paidEvent'->>'id'
            AND p.body->>'paidMinor'='0' AND o.body->>'payableMinor'='0'
            AND p.run_id=review.body->'input'->>'runId' AND p.employee_id=review.body->'input'->>'employeeId'
            AND EXISTS(SELECT FROM openerp.payroll_adjustment_consumptions c
              JOIN openerp.payroll_adjustment_instructions i ON i.book_id=c.book_id AND i.id=c.instruction_id
              WHERE c.book_id=p.book_id AND c.run_id=p.run_id AND c.employee_id=p.employee_id AND i.body ? 'netRecovery')
        ) THEN RAISE EXCEPTION 'noncash payroll settlement requires an executed zero-net offset and its paid event' USING ERRCODE='23514'; END IF;
      WHEN 'cash_recovery' THEN
        IF NOT EXISTS(SELECT FROM openerp.payroll_recovery_allocations a WHERE a.book_id=NEW.book_id AND a.execution_id=NEW.id AND a.claim_id=review.body->'input'->>'claimId') THEN
          RAISE EXCEPTION 'payroll recovery cash requires its retained allocation' USING ERRCODE='23514'; END IF;
      WHEN 'gross_recovery' THEN
        IF NOT EXISTS(SELECT FROM openerp.payroll_recovery_claims c WHERE c.book_id=NEW.book_id AND c.execution_id=NEW.id AND c.id=NEW.body->'recoveryClaim'->>'id') OR
           NOT EXISTS(SELECT FROM openerp.payroll_reporting_corrections c WHERE c.book_id=NEW.book_id AND c.execution_id=NEW.id) THEN
          RAISE EXCEPTION 'payroll recovery requires its retained claim and reporting correction' USING ERRCODE='23514'; END IF;
      WHEN 'future_pay','additional_compensation' THEN
        IF NOT EXISTS(SELECT FROM openerp.payroll_adjustment_instructions i WHERE i.book_id=NEW.book_id AND i.execution_id=NEW.id AND i.id=NEW.body->'instruction'->>'id') THEN
          RAISE EXCEPTION 'payroll adjustment requires its retained instruction' USING ERRCODE='23514'; END IF;
      WHEN 'reporting_only' THEN
        IF NOT EXISTS(SELECT FROM openerp.payroll_reporting_corrections c WHERE c.book_id=NEW.book_id AND c.execution_id=NEW.id) THEN
          RAISE EXCEPTION 'payroll reporting correction requires its retained child' USING ERRCODE='23514'; END IF;
      ELSE RAISE EXCEPTION 'unknown payroll settlement kind' USING ERRCODE='23514';
    END CASE;
  ELSIF TG_TABLE_NAME='payroll_run_executions' THEN
    SELECT * INTO run FROM openerp.payroll_runs WHERE book_id=NEW.book_id AND id=NEW.run_id;
    FOR employee IN SELECT value FROM jsonb_array_elements(run.body->'employees') LOOP
      FOR instruction IN SELECT value FROM jsonb_array_elements(coalesce(employee->'calculation'->'basis'->'adjustmentInstructions','[]'::jsonb)) LOOP
        IF NOT EXISTS(SELECT FROM openerp.payroll_adjustment_consumptions c WHERE c.book_id=NEW.book_id AND c.run_id=NEW.run_id
          AND c.instruction_id=instruction->>'id' AND c.employee_id=employee->'calculation'->>'employeeId' AND c.snapshot=instruction) THEN
          RAISE EXCEPTION 'payroll run requires exact retained adjustment consumption' USING ERRCODE='23514'; END IF;
      END LOOP;
    END LOOP;
  ELSE
    SELECT * INTO review FROM openerp.payroll_settlement_reviews WHERE book_id=NEW.book_id AND event_id=NEW.event_id;
    IF FOUND AND NOT EXISTS(SELECT FROM openerp.payroll_settlement_executions e WHERE e.book_id=NEW.book_id AND e.review_id=review.id AND e.voucher_id=NEW.id) THEN
      RAISE EXCEPTION 'payroll settlement voucher requires its execution children' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;


REVOKE ALL ON FUNCTION openerp.require_payroll_settlement_consequences() FROM PUBLIC,openerp_runtime;
