CREATE TABLE openerp.payroll_settlement_reviews (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  change_set_id text GENERATED ALWAYS AS (body->'postingPlan'->>'id') STORED, event_id text, FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id), FOREIGN KEY(book_id,event_id) REFERENCES openerp.events(book_id,id), UNIQUE(book_id,change_set_id),
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_settlement_approvals (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  review_id text GENERATED ALWAYS AS (body->>'reviewId') STORED NOT NULL, FOREIGN KEY(book_id,review_id) REFERENCES openerp.payroll_settlement_reviews(book_id,id),
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_settlement_executions (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  review_id text GENERATED ALWAYS AS (body->>'reviewId') STORED NOT NULL, approval_id text GENERATED ALWAYS AS (body->>'approvalId') STORED NOT NULL, voucher_id text GENERATED ALWAYS AS (body->'postingReceipt'->>'voucherId') STORED, FOREIGN KEY(book_id,review_id) REFERENCES openerp.payroll_settlement_reviews(book_id,id), FOREIGN KEY(book_id,approval_id) REFERENCES openerp.payroll_settlement_approvals(book_id,id), FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id), UNIQUE(book_id,review_id), UNIQUE(book_id,voucher_id),
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_paid_events (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  run_id text GENERATED ALWAYS AS (body->>'runId') STORED NOT NULL, employee_id text GENERATED ALWAYS AS (body->>'employeeId') STORED NOT NULL, execution_id text GENERATED ALWAYS AS (body->>'settlementExecutionId') STORED NOT NULL, FOREIGN KEY(book_id,run_id,employee_id) REFERENCES openerp.payroll_run_obligations(book_id,run_id,employee_id), FOREIGN KEY(book_id,execution_id) REFERENCES openerp.payroll_settlement_executions(book_id,id) DEFERRABLE INITIALLY DEFERRED, UNIQUE(book_id,run_id,employee_id),
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_correction_comparisons (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  paid_event_id text GENERATED ALWAYS AS (body->>'paidEventId') STORED NOT NULL, FOREIGN KEY(book_id,paid_event_id) REFERENCES openerp.payroll_paid_events(book_id,id), CHECK((body->>'kind'='paid_correction_comparison' AND body->>'noFinancialEffect'='true') IS TRUE),
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_adjustment_bases (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  comparison_id text GENERATED ALWAYS AS (body->'input'->>'comparisonId') STORED NOT NULL, FOREIGN KEY(book_id,comparison_id) REFERENCES openerp.payroll_correction_comparisons(book_id,id), CHECK((body->>'qualification'='synthetic_only') IS TRUE),
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_recovery_claims (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  paid_event_id text GENERATED ALWAYS AS (body->>'paidEventId') STORED NOT NULL, comparison_id text GENERATED ALWAYS AS (body->>'comparisonId') STORED NOT NULL, execution_id text GENERATED ALWAYS AS (body->>'executionId') STORED NOT NULL, FOREIGN KEY(book_id,paid_event_id) REFERENCES openerp.payroll_paid_events(book_id,id), FOREIGN KEY(book_id,comparison_id) REFERENCES openerp.payroll_correction_comparisons(book_id,id), FOREIGN KEY(book_id,execution_id) REFERENCES openerp.payroll_settlement_executions(book_id,id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_recovery_allocations (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED NOT NULL, execution_id text GENERATED ALWAYS AS (body->>'executionId') STORED NOT NULL, FOREIGN KEY(book_id,claim_id) REFERENCES openerp.payroll_recovery_claims(book_id,id), FOREIGN KEY(book_id,execution_id) REFERENCES openerp.payroll_settlement_executions(book_id,id) DEFERRABLE INITIALLY DEFERRED, UNIQUE(book_id,execution_id),
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_adjustment_instructions (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  paid_event_id text GENERATED ALWAYS AS (body->>'paidEventId') STORED NOT NULL, execution_id text GENERATED ALWAYS AS (body->>'executionId') STORED NOT NULL, FOREIGN KEY(book_id,paid_event_id) REFERENCES openerp.payroll_paid_events(book_id,id), FOREIGN KEY(book_id,execution_id) REFERENCES openerp.payroll_settlement_executions(book_id,id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_reporting_corrections (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  paid_event_id text GENERATED ALWAYS AS (body->>'paidEventId') STORED NOT NULL, execution_id text GENERATED ALWAYS AS (body->>'executionId') STORED NOT NULL, FOREIGN KEY(book_id,paid_event_id) REFERENCES openerp.payroll_paid_events(book_id,id), FOREIGN KEY(book_id,execution_id) REFERENCES openerp.payroll_settlement_executions(book_id,id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_period_revisions (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  CHECK((body->>'profile'='synthetic_paid_semantics_v1' AND body->>'externalState'='not_submitted') IS TRUE),
  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.payroll_adjustment_reservations (
  book_id text NOT NULL,instruction_id text NOT NULL,run_id text NOT NULL,approval_id text NOT NULL,snapshot jsonb NOT NULL,
  PRIMARY KEY(book_id,instruction_id,approval_id),
  FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.payroll_adjustment_instructions(book_id,id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.payroll_runs(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.approvals(book_id,id),
  CHECK((snapshot->>'id'=instruction_id) IS TRUE)
);
CREATE TABLE openerp.payroll_adjustment_consumptions (
  book_id text NOT NULL,instruction_id text NOT NULL,run_id text NOT NULL,employee_id text NOT NULL,snapshot jsonb NOT NULL,
  PRIMARY KEY(book_id,instruction_id),
  FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.payroll_adjustment_instructions(book_id,id),
  FOREIGN KEY(book_id,run_id,employee_id) REFERENCES openerp.payroll_run_obligations(book_id,run_id,employee_id),
  CHECK((snapshot->>'id'=instruction_id AND snapshot->>'employeeId'=employee_id) IS TRUE)
);
CREATE TRIGGER immutable_payroll_settlement_reviews BEFORE UPDATE OR DELETE ON openerp.payroll_settlement_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_settlement_reviews TO openerp_runtime;
CREATE TRIGGER immutable_payroll_settlement_approvals BEFORE UPDATE OR DELETE ON openerp.payroll_settlement_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_settlement_approvals TO openerp_runtime;
CREATE TRIGGER immutable_payroll_settlement_executions BEFORE UPDATE OR DELETE ON openerp.payroll_settlement_executions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_settlement_executions TO openerp_runtime;
CREATE TRIGGER immutable_payroll_paid_events BEFORE UPDATE OR DELETE ON openerp.payroll_paid_events FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_paid_events TO openerp_runtime;
CREATE TRIGGER immutable_payroll_correction_comparisons BEFORE UPDATE OR DELETE ON openerp.payroll_correction_comparisons FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_correction_comparisons TO openerp_runtime;
CREATE TRIGGER immutable_payroll_adjustment_bases BEFORE UPDATE OR DELETE ON openerp.payroll_adjustment_bases FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_adjustment_bases TO openerp_runtime;
CREATE TRIGGER immutable_payroll_recovery_claims BEFORE UPDATE OR DELETE ON openerp.payroll_recovery_claims FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_recovery_claims TO openerp_runtime;
CREATE TRIGGER immutable_payroll_recovery_allocations BEFORE UPDATE OR DELETE ON openerp.payroll_recovery_allocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_recovery_allocations TO openerp_runtime;
CREATE TRIGGER immutable_payroll_adjustment_instructions BEFORE UPDATE OR DELETE ON openerp.payroll_adjustment_instructions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_adjustment_instructions TO openerp_runtime;
CREATE TRIGGER immutable_payroll_reporting_corrections BEFORE UPDATE OR DELETE ON openerp.payroll_reporting_corrections FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_reporting_corrections TO openerp_runtime;
CREATE TRIGGER immutable_payroll_period_revisions BEFORE UPDATE OR DELETE ON openerp.payroll_period_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_period_revisions TO openerp_runtime;
CREATE TRIGGER immutable_payroll_adjustment_reservations BEFORE UPDATE OR DELETE ON openerp.payroll_adjustment_reservations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_adjustment_reservations TO openerp_runtime;
CREATE TRIGGER immutable_payroll_adjustment_consumptions BEFORE UPDATE OR DELETE ON openerp.payroll_adjustment_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_adjustment_consumptions TO openerp_runtime;
CREATE TABLE openerp.payroll_settlement_capacity_reservations (
  book_id text NOT NULL, capacity_key text NOT NULL, review_id text NOT NULL, approval_id text NOT NULL,
  PRIMARY KEY(book_id,capacity_key,approval_id),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.payroll_settlement_reviews(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.payroll_settlement_approvals(book_id,id)
);
CREATE TRIGGER immutable_payroll_settlement_capacity_reservations BEFORE UPDATE OR DELETE ON openerp.payroll_settlement_capacity_reservations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_settlement_capacity_reservations TO openerp_runtime;

CREATE FUNCTION openerp.require_payroll_settlement_consequences() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
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
CREATE CONSTRAINT TRIGGER complete_payroll_settlement AFTER INSERT ON openerp.payroll_settlement_executions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_payroll_settlement_consequences();
CREATE CONSTRAINT TRIGGER complete_payroll_adjustment_consumption AFTER INSERT ON openerp.payroll_run_executions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_payroll_settlement_consequences();
CREATE CONSTRAINT TRIGGER complete_payroll_settlement_voucher AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_payroll_settlement_consequences();

REVOKE ALL ON FUNCTION openerp.require_payroll_settlement_consequences() FROM PUBLIC,openerp_runtime;
