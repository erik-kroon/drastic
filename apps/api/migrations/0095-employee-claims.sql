CREATE TABLE openerp.employee_claims (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL, claim_key text NOT NULL,
  employee_id text NOT NULL, month text NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,claim_key),
  FOREIGN KEY(book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id),
  CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE openerp.employee_claim_revisions (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  revision integer GENERATED ALWAYS AS ((body->>'revision')::integer) STORED NOT NULL, employee_id text GENERATED ALWAYS AS (body->'input'->>'employeeId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  UNIQUE(book_id,claim_id,revision), FOREIGN KEY(book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id)
);
CREATE INDEX employee_claim_revisions_claim ON openerp.employee_claim_revisions(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_reviews (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  input_id text GENERATED ALWAYS AS (body->'preparedInput'->>'id') STORED NOT NULL, input_review_id text GENERATED ALWAYS AS (body->'preparedRecognition'->>'id') STORED NOT NULL, change_set_id text GENERATED ALWAYS AS (body->'preparedRecognition'->'postingPlan'->>'id') STORED NOT NULL, event_id text GENERATED ALWAYS AS (body->'preparedRecognition'->'postingPlan'->'groups'->0->'actions'->0->>'eventId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  UNIQUE(book_id,input_id), UNIQUE(book_id,input_review_id), UNIQUE(book_id,change_set_id), UNIQUE(book_id,event_id), FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id), FOREIGN KEY(book_id,input_review_id) REFERENCES openerp.payroll_input_reviews(book_id,id), FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id)
);
CREATE INDEX employee_claim_reviews_claim ON openerp.employee_claim_reviews(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_completion_requests (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  revision_id text GENERATED ALWAYS AS (body->>'revisionId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  FOREIGN KEY(book_id,revision_id) REFERENCES openerp.employee_claim_revisions(book_id,id)
);
CREATE INDEX employee_claim_completion_requests_claim ON openerp.employee_claim_completion_requests(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_recognitions (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  review_id text GENERATED ALWAYS AS (body->>'reviewId') STORED NOT NULL, voucher_id text GENERATED ALWAYS AS (body->'postingReceipt'->>'voucherId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  UNIQUE(book_id,claim_id), UNIQUE(book_id,review_id), UNIQUE(book_id,voucher_id), FOREIGN KEY(book_id,review_id) REFERENCES openerp.employee_claim_reviews(book_id,id), FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id)
);
CREATE INDEX employee_claim_recognitions_claim ON openerp.employee_claim_recognitions(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_instructions (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  recognition_id text GENERATED ALWAYS AS (body->>'recognitionId') STORED NOT NULL, kind text GENERATED ALWAYS AS (body->>'kind') STORED NOT NULL, amount_minor numeric GENERATED ALWAYS AS ((body->>'amountMinor')::numeric) STORED NOT NULL, employee_id text GENERATED ALWAYS AS (body->>'employeeId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  UNIQUE(book_id,recognition_id,kind), FOREIGN KEY(book_id,recognition_id) REFERENCES openerp.employee_claim_recognitions(book_id,id) DEFERRABLE INITIALLY DEFERRED, FOREIGN KEY(book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id), CHECK(kind IN ('direct','payroll')), CHECK(amount_minor>0 AND amount_minor=trunc(amount_minor))
);
CREATE INDEX employee_claim_instructions_claim ON openerp.employee_claim_instructions(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_payee_proposals (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  employee_id text GENERATED ALWAYS AS (body->'input'->>'employeeId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  FOREIGN KEY(book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id)
);
CREATE INDEX employee_claim_payee_proposals_claim ON openerp.employee_claim_payee_proposals(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_payee_verifications (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  proposal_id text GENERATED ALWAYS AS (body->'proposal'->>'id') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  UNIQUE(book_id,proposal_id), FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.employee_claim_payee_proposals(book_id,id)
);
CREATE INDEX employee_claim_payee_verifications_claim ON openerp.employee_claim_payee_verifications(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_payment_previews (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  instruction_id text GENERATED ALWAYS AS (body->'instruction'->>'id') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.employee_claim_instructions(book_id,id)
);
CREATE INDEX employee_claim_payment_previews_claim ON openerp.employee_claim_payment_previews(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_payment_exports (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  instruction_id text GENERATED ALWAYS AS (body->>'instructionId') STORED NOT NULL, preview_id text GENERATED ALWAYS AS (body->>'previewId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  UNIQUE(book_id,instruction_id), UNIQUE(book_id,preview_id), FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.employee_claim_instructions(book_id,id), FOREIGN KEY(book_id,preview_id) REFERENCES openerp.employee_claim_payment_previews(book_id,id)
);
CREATE INDEX employee_claim_payment_exports_claim ON openerp.employee_claim_payment_exports(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_settlement_reviews (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  instruction_id text GENERATED ALWAYS AS (body->>'instructionId') STORED NOT NULL, change_set_id text GENERATED ALWAYS AS (body->'postingPlan'->>'id') STORED NOT NULL, event_id text GENERATED ALWAYS AS (body->'postingPlan'->'groups'->0->'actions'->0->>'eventId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  UNIQUE(book_id,change_set_id), UNIQUE(book_id,event_id), FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.employee_claim_instructions(book_id,id), FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id)
);
CREATE INDEX employee_claim_settlement_reviews_claim ON openerp.employee_claim_settlement_reviews(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_settlements (
  book_id text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
  claim_id text GENERATED ALWAYS AS (body->>'claimId') STORED,
  instruction_id text GENERATED ALWAYS AS (body->>'instructionId') STORED NOT NULL, review_id text GENERATED ALWAYS AS (body->>'reviewId') STORED NOT NULL, voucher_id text GENERATED ALWAYS AS (body->'postingReceipt'->>'voucherId') STORED NOT NULL,
  PRIMARY KEY(book_id,id), FOREIGN KEY(book_id,claim_id) REFERENCES openerp.employee_claims(book_id,id),
  CHECK(octet_length(body::text)<=4194304),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id) IS TRUE),
  UNIQUE(book_id,instruction_id), UNIQUE(book_id,voucher_id), FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.employee_claim_instructions(book_id,id), FOREIGN KEY(book_id,review_id) REFERENCES openerp.employee_claim_settlement_reviews(book_id,id), FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id)
);
CREATE INDEX employee_claim_settlements_claim ON openerp.employee_claim_settlements(book_id,claim_id,id COLLATE "C");

CREATE TABLE openerp.employee_claim_payroll_reservations (
  book_id text NOT NULL, instruction_id text NOT NULL, run_id text NOT NULL, approval_id text NOT NULL, snapshot jsonb NOT NULL,
  PRIMARY KEY(book_id,instruction_id,approval_id),
  FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.employee_claim_instructions(book_id,id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.payroll_runs(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.approvals(book_id,id),
  CHECK((snapshot->>'instructionId'=instruction_id) IS TRUE)
);
CREATE TABLE openerp.employee_claim_payroll_consumptions (
  book_id text NOT NULL, instruction_id text NOT NULL, run_id text NOT NULL, employee_id text NOT NULL,
  amount_minor numeric NOT NULL CHECK(amount_minor>0 AND amount_minor=trunc(amount_minor)), snapshot jsonb NOT NULL,
  PRIMARY KEY(book_id,instruction_id),
  FOREIGN KEY(book_id,instruction_id) REFERENCES openerp.employee_claim_instructions(book_id,id),
  FOREIGN KEY(book_id,run_id,employee_id) REFERENCES openerp.payroll_run_obligations(book_id,run_id,employee_id),
  CHECK((snapshot->>'instructionId'=instruction_id AND snapshot->>'amountMinor'=amount_minor::text) IS TRUE)
);

CREATE TRIGGER employee_claims_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claims FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claims TO openerp_runtime;

CREATE TRIGGER employee_claim_revisions_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_revisions TO openerp_runtime;

CREATE TRIGGER employee_claim_reviews_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_reviews TO openerp_runtime;

CREATE TRIGGER employee_claim_completion_requests_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_completion_requests FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_completion_requests TO openerp_runtime;

CREATE TRIGGER employee_claim_recognitions_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_recognitions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_recognitions TO openerp_runtime;

CREATE TRIGGER employee_claim_instructions_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_instructions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_instructions TO openerp_runtime;

CREATE TRIGGER employee_claim_payee_proposals_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_payee_proposals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_payee_proposals TO openerp_runtime;

CREATE TRIGGER employee_claim_payee_verifications_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_payee_verifications FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_payee_verifications TO openerp_runtime;

CREATE TRIGGER employee_claim_payment_previews_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_payment_previews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_payment_previews TO openerp_runtime;

CREATE TRIGGER employee_claim_payment_exports_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_payment_exports FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_payment_exports TO openerp_runtime;

CREATE TRIGGER employee_claim_settlement_reviews_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_settlement_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_settlement_reviews TO openerp_runtime;

CREATE TRIGGER employee_claim_settlements_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_settlements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_settlements TO openerp_runtime;

CREATE TRIGGER employee_claim_payroll_reservations_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_payroll_reservations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_payroll_reservations TO openerp_runtime;

CREATE TRIGGER employee_claim_payroll_consumptions_immutable BEFORE UPDATE OR DELETE ON openerp.employee_claim_payroll_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.employee_claim_payroll_consumptions TO openerp_runtime;

CREATE FUNCTION openerp.require_employee_claim_consequences() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE reviewed openerp.employee_claim_reviews%ROWTYPE; recognized openerp.employee_claim_recognitions%ROWTYPE;
  settlement openerp.employee_claim_settlement_reviews%ROWTYPE; run openerp.payroll_runs%ROWTYPE; employee jsonb; instruction jsonb;
BEGIN
  SELECT * INTO reviewed FROM openerp.employee_claim_reviews WHERE book_id=NEW.book_id AND (change_set_id=NEW.change_set_id OR event_id=NEW.event_id);
  IF FOUND THEN
    SELECT * INTO recognized FROM openerp.employee_claim_recognitions WHERE book_id=NEW.book_id AND review_id=reviewed.id AND voucher_id=NEW.id;
    IF NOT FOUND OR ((reviewed.body->>'directMinor')::numeric>0 AND NOT EXISTS(SELECT FROM openerp.employee_claim_instructions WHERE book_id=NEW.book_id AND recognition_id=recognized.id AND kind='direct' AND amount_minor::text=reviewed.body->>'directMinor'))
      OR ((reviewed.body->>'payrollMinor')::numeric>0 AND NOT EXISTS(SELECT FROM openerp.employee_claim_instructions WHERE book_id=NEW.book_id AND recognition_id=recognized.id AND kind='payroll' AND amount_minor::text=reviewed.body->>'payrollMinor'))
      OR EXISTS(SELECT FROM openerp.employee_claim_instructions WHERE book_id=NEW.book_id AND recognition_id=recognized.id AND ((kind='direct' AND reviewed.body->>'directMinor'='0') OR (kind='payroll' AND reviewed.body->>'payrollMinor'='0')))
      OR (SELECT coalesce(sum(amount_minor),0) FROM openerp.employee_claim_instructions WHERE book_id=NEW.book_id AND recognition_id=recognized.id)<>(reviewed.body->>'liabilityMinor')::numeric THEN
      RAISE EXCEPTION 'employee claim recognition requires both fixed instructions' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT * INTO settlement FROM openerp.employee_claim_settlement_reviews WHERE book_id=NEW.book_id AND (change_set_id=NEW.change_set_id OR event_id=NEW.event_id);
  IF FOUND THEN
    IF NOT EXISTS(SELECT FROM openerp.employee_claim_settlements WHERE book_id=NEW.book_id AND review_id=settlement.id AND instruction_id=settlement.instruction_id AND voucher_id=NEW.id)
      OR NOT EXISTS(SELECT FROM openerp.bank_matches WHERE book_id=NEW.book_id AND statement_id=settlement.body->'input'->>'statementId' AND row_ordinal=(settlement.body->'input'->>'rowOrdinal')::integer AND voucher_id=NEW.id) THEN
      RAISE EXCEPTION 'employee claim settlement requires atomic consumption and bank match' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT * INTO run FROM openerp.payroll_runs WHERE book_id=NEW.book_id AND (change_set_id=NEW.change_set_id OR event_id=NEW.event_id);
  IF NOT FOUND THEN RETURN NEW; END IF;
  FOR employee IN SELECT value FROM jsonb_array_elements(run.body->'employees') LOOP
    FOR instruction IN SELECT value FROM jsonb_array_elements(coalesce(employee->'calculation'->'basis'->'claimInstructions','[]'::jsonb)) LOOP
      IF NOT EXISTS(SELECT FROM openerp.employee_claim_payroll_consumptions WHERE book_id=NEW.book_id AND instruction_id=instruction->>'instructionId' AND run_id=run.id AND employee_id=employee->'calculation'->>'employeeId' AND amount_minor::text=instruction->>'amountMinor' AND snapshot=instruction)
        OR NOT EXISTS(SELECT FROM openerp.employee_claim_payroll_reservations r WHERE r.book_id=NEW.book_id AND r.instruction_id=instruction->>'instructionId' AND r.run_id=run.id AND r.snapshot=instruction AND NOT EXISTS(SELECT FROM openerp.payroll_run_reservation_releases x WHERE x.book_id=r.book_id AND x.approval_id=r.approval_id)) THEN
        RAISE EXCEPTION 'employee claim payroll consumption incomplete' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION openerp.require_employee_claim_consequences() FROM PUBLIC,openerp_runtime;
CREATE CONSTRAINT TRIGGER employee_claim_atomic_consequences AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_employee_claim_consequences();
