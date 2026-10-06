CREATE TABLE openerp.payroll_mileage_correction_proposals (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  original_input_id text GENERATED ALWAYS AS (body->'input'->>'originalInputId') STORED NOT NULL,
  employee_id text GENERATED ALWAYS AS (body->'employee'->>'id') STORED NOT NULL,
  FOREIGN KEY(book_id,original_input_id) REFERENCES openerp.payroll_inputs(book_id,id),

  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_payroll_mileage_correction_proposals BEFORE UPDATE OR DELETE ON openerp.payroll_mileage_correction_proposals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_mileage_correction_proposals TO openerp_runtime;

CREATE TABLE openerp.payroll_mileage_correction_review_links (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  proposal_id text GENERATED ALWAYS AS (body->>'proposalId') STORED NOT NULL,
  FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.payroll_mileage_correction_proposals(book_id,id),
  UNIQUE(book_id,proposal_id),

  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_payroll_mileage_correction_review_links BEFORE UPDATE OR DELETE ON openerp.payroll_mileage_correction_review_links FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_mileage_correction_review_links TO openerp_runtime;

CREATE TABLE openerp.payroll_mileage_correction_submissions (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  proposal_id text GENERATED ALWAYS AS (body->>'proposalId') STORED NOT NULL,
  FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.payroll_mileage_correction_proposals(book_id,id),
  UNIQUE(book_id,proposal_id),

  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_payroll_mileage_correction_submissions BEFORE UPDATE OR DELETE ON openerp.payroll_mileage_correction_submissions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_mileage_correction_submissions TO openerp_runtime;

CREATE TABLE openerp.payroll_mileage_correction_cancellations (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  proposal_id text GENERATED ALWAYS AS (body->>'proposalId') STORED NOT NULL,
  FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.payroll_mileage_correction_proposals(book_id,id),
  UNIQUE(book_id,proposal_id),

  PRIMARY KEY(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_payroll_mileage_correction_cancellations BEFORE UPDATE OR DELETE ON openerp.payroll_mileage_correction_cancellations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_mileage_correction_cancellations TO openerp_runtime;

ALTER TABLE openerp.payroll_mileage_correction_review_links ADD COLUMN review_id text GENERATED ALWAYS AS (body->>'reviewId') STORED NOT NULL;
ALTER TABLE openerp.payroll_mileage_correction_review_links ADD FOREIGN KEY(book_id,review_id) REFERENCES openerp.payroll_settlement_reviews(book_id,id);
ALTER TABLE openerp.payroll_mileage_correction_review_links ADD UNIQUE(book_id,review_id);
ALTER TABLE openerp.payroll_mileage_correction_submissions ADD COLUMN review_id text GENERATED ALWAYS AS (body->>'reviewId') STORED NOT NULL;
ALTER TABLE openerp.payroll_mileage_correction_submissions ADD FOREIGN KEY(book_id,review_id) REFERENCES openerp.payroll_settlement_reviews(book_id,id);
CREATE INDEX payroll_mileage_correction_discovery ON openerp.payroll_mileage_correction_proposals(book_id,employee_id,original_input_id,id);

CREATE TABLE openerp.payroll_mileage_correction_successors (
  book_id text NOT NULL,
  original_input_id text NOT NULL,
  previous_execution_id text,
  execution_id text NOT NULL,
  proposal_id text NOT NULL,
  PRIMARY KEY(book_id,execution_id),
  UNIQUE NULLS NOT DISTINCT(book_id,original_input_id,previous_execution_id),
  UNIQUE(book_id,proposal_id),
  FOREIGN KEY(book_id,original_input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  FOREIGN KEY(book_id,previous_execution_id) REFERENCES openerp.payroll_settlement_executions(book_id,id),
  FOREIGN KEY(book_id,execution_id) REFERENCES openerp.payroll_settlement_executions(book_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.payroll_mileage_correction_proposals(book_id,id)
);
CREATE TRIGGER immutable_payroll_mileage_correction_successors BEFORE UPDATE OR DELETE ON openerp.payroll_mileage_correction_successors FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_mileage_correction_successors TO openerp_runtime;

ALTER TABLE openerp.payroll_adjustment_instructions
  ADD COLUMN net_claim_id text GENERATED ALWAYS AS (body->'netRecovery'->>'claimId') STORED,
  ADD FOREIGN KEY(book_id,net_claim_id) REFERENCES openerp.payroll_recovery_claims(book_id,id),
  ADD CHECK(NOT body ? 'netRecovery' OR
    (body->>'kind'='future_pay' AND body->>'signedGrossDeltaMinor'='0'
     AND (body->'netRecovery'->>'amountMinor')::numeric>0) IS TRUE);
ALTER TABLE openerp.payroll_recovery_allocations
  ADD COLUMN payroll_run_id text GENERATED ALWAYS AS (body->>'payrollRunId') STORED,
  ADD FOREIGN KEY(book_id,payroll_run_id) REFERENCES openerp.payroll_runs(book_id,id);

CREATE FUNCTION openerp.require_net_recovery_consumption() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE instruction openerp.payroll_adjustment_instructions%ROWTYPE;
BEGIN
  SELECT * INTO instruction FROM openerp.payroll_adjustment_instructions
    WHERE book_id=NEW.book_id AND id=NEW.instruction_id;
  IF instruction.body ? 'netRecovery' AND NOT EXISTS(
    SELECT FROM openerp.payroll_recovery_allocations a
    JOIN openerp.payroll_run_executions r ON r.book_id=a.book_id AND r.run_id=a.payroll_run_id
    WHERE a.book_id=NEW.book_id AND a.payroll_run_id=NEW.run_id
      AND a.execution_id=instruction.execution_id AND a.claim_id=instruction.net_claim_id
      AND a.body->>'amountMinor'=instruction.body->'netRecovery'->>'amountMinor'
      AND NEW.snapshot=instruction.body - 'scope' - 'createdAt' - 'createdBy' - 'receipt'
  ) THEN RAISE EXCEPTION 'net recovery requires exact run, allocation and instruction consumption' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION openerp.require_net_recovery_consumption() FROM PUBLIC,openerp_runtime;
CREATE CONSTRAINT TRIGGER complete_net_recovery_consumption AFTER INSERT ON openerp.payroll_adjustment_consumptions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_net_recovery_consumption();

CREATE TABLE openerp.payroll_adjustment_instruction_cancellations (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  instruction_id text GENERATED ALWAYS AS (body->>'instructionId') STORED NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,instruction_id),
  FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.payroll_adjustment_instructions(book_id,id),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest) IS TRUE),
  CHECK(digest=openerp.digest(body-'digest'))
);
CREATE TRIGGER immutable_payroll_adjustment_instruction_cancellations BEFORE UPDATE OR DELETE ON openerp.payroll_adjustment_instruction_cancellations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_adjustment_instruction_cancellations TO openerp_runtime;

CREATE FUNCTION openerp.require_net_instruction_terminal_exclusion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE target_id text;
BEGIN
  target_id := NEW.instruction_id;
  IF TG_TABLE_NAME='payroll_adjustment_instruction_cancellations' THEN
    IF EXISTS(SELECT FROM openerp.payroll_adjustment_consumptions WHERE book_id=NEW.book_id AND instruction_id=target_id)
      OR EXISTS(SELECT FROM openerp.payroll_adjustment_reservations r
        JOIN openerp.approvals a ON a.book_id=r.book_id AND a.id=r.approval_id
        WHERE r.book_id=NEW.book_id AND r.instruction_id=target_id AND a.expires_at>clock_timestamp()
          AND NOT EXISTS(SELECT FROM openerp.posting_approval_revocations v WHERE v.book_id=a.book_id AND v.approval_id=a.id)
          AND NOT EXISTS(SELECT FROM openerp.payroll_run_reservation_releases x WHERE x.book_id=a.book_id AND x.approval_id=a.id))
      OR NOT EXISTS(SELECT FROM openerp.payroll_adjustment_instructions WHERE book_id=NEW.book_id AND id=target_id AND body ? 'netRecovery' AND digest=NEW.body->>'instructionDigest')
    THEN RAISE EXCEPTION 'net cancellation requires exact unconsumed instruction' USING ERRCODE='23514'; END IF;
  ELSIF EXISTS(SELECT FROM openerp.payroll_adjustment_instruction_cancellations WHERE book_id=NEW.book_id AND instruction_id=target_id)
    THEN RAISE EXCEPTION 'cancelled net instruction cannot be consumed or reserved' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION openerp.require_net_instruction_terminal_exclusion() FROM PUBLIC,openerp_runtime;
CREATE CONSTRAINT TRIGGER net_instruction_cancellation_exclusion AFTER INSERT ON openerp.payroll_adjustment_instruction_cancellations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_net_instruction_terminal_exclusion();
CREATE CONSTRAINT TRIGGER net_instruction_consumption_exclusion AFTER INSERT ON openerp.payroll_adjustment_consumptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_net_instruction_terminal_exclusion();
CREATE CONSTRAINT TRIGGER net_instruction_reservation_exclusion AFTER INSERT ON openerp.payroll_adjustment_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_net_instruction_terminal_exclusion();
