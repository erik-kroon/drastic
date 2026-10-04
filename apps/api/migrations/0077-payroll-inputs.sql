CREATE TABLE openerp.payroll_inputs (
  book_id text NOT NULL, id text NOT NULL, employee_id text NOT NULL, month text NOT NULL,
  economic_key text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,economic_key),
  FOREIGN KEY(book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id),
  CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CHECK(octet_length(body::text)<=1048576),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest
    AND body->'input'->>'employeeId'=employee_id AND body->'input'->>'month'=month
    AND body->'input'->>'economicKey'=economic_key AND body->'input'->>'recordClass'='synthetic') IS TRUE)
);
CREATE TABLE openerp.payroll_input_reviews (
  book_id text NOT NULL, id text NOT NULL, input_id text NOT NULL, kind text NOT NULL,
  change_set_id text NOT NULL, event_id text NOT NULL, digest text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,change_set_id), UNIQUE(book_id,event_id),
  FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
  FOREIGN KEY(book_id,event_id) REFERENCES openerp.events(book_id,id),
  CHECK(kind IN ('recognition','direct_payment')), CHECK(octet_length(body::text)<=2097152),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'inputId'=input_id
    AND body->>'kind'=kind AND body->>'digest'=digest AND body->'postingPlan'->>'id'=change_set_id) IS TRUE)
);
CREATE TABLE openerp.payroll_input_executions (
  book_id text NOT NULL, id text NOT NULL, input_id text NOT NULL, review_id text NOT NULL,
  kind text NOT NULL, voucher_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,review_id), UNIQUE(book_id,voucher_id),
  FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  FOREIGN KEY(book_id,review_id) REFERENCES openerp.payroll_input_reviews(book_id,id),
  FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
  CHECK(kind IN ('recognition','direct_payment')),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'inputId'=input_id
    AND body->>'reviewId'=review_id AND body->>'kind'=kind AND body->'postingReceipt'->>'voucherId'=voucher_id) IS TRUE)
);
CREATE UNIQUE INDEX payroll_input_one_recognition ON openerp.payroll_input_executions(book_id,input_id) WHERE kind='recognition';
CREATE TABLE openerp.payroll_input_components (
  book_id text NOT NULL, component_key text NOT NULL, input_id text NOT NULL,
  PRIMARY KEY(book_id,component_key), FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id)
);
CREATE TABLE openerp.payroll_input_allocations (
  book_id text NOT NULL, input_id text NOT NULL, execution_id text NOT NULL,
  amount_minor numeric NOT NULL CHECK(amount_minor>0 AND amount_minor=trunc(amount_minor)),
  PRIMARY KEY(book_id,execution_id), FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  FOREIGN KEY(book_id,execution_id) REFERENCES openerp.payroll_input_executions(book_id,id)
);
CREATE TABLE openerp.payroll_input_reservations (
  book_id text NOT NULL, input_id text NOT NULL, run_id text NOT NULL, approval_id text NOT NULL, snapshot jsonb NOT NULL,
  PRIMARY KEY(book_id,input_id,approval_id), FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.payroll_runs(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.approvals(book_id,id),
  CHECK((snapshot->>'inputId'=input_id) IS TRUE)
);
CREATE TABLE openerp.payroll_input_consumptions (
  book_id text NOT NULL, input_id text NOT NULL, run_id text NOT NULL, employee_id text NOT NULL,
  reimbursement_minor numeric NOT NULL CHECK(reimbursement_minor>=0 AND reimbursement_minor=trunc(reimbursement_minor)),
  gross_minor numeric NOT NULL CHECK(gross_minor>=0 AND gross_minor=trunc(gross_minor)),
  PRIMARY KEY(book_id,input_id),
  FOREIGN KEY(book_id,input_id) REFERENCES openerp.payroll_inputs(book_id,id),
  FOREIGN KEY(book_id,run_id,employee_id) REFERENCES openerp.payroll_run_obligations(book_id,run_id,employee_id)
);
CREATE TABLE openerp.payroll_run_approval_reservations (
  book_id text NOT NULL, employee_id text NOT NULL, month text NOT NULL, run_id text NOT NULL, approval_id text NOT NULL,
  PRIMARY KEY(book_id,employee_id,month,approval_id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.payroll_runs(book_id,id),
  FOREIGN KEY(book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.approvals(book_id,id)
);
CREATE TABLE openerp.payroll_run_reservation_releases (
  book_id text NOT NULL, approval_id text NOT NULL, run_id text NOT NULL,
  reason text NOT NULL CHECK(reason='approval_expired_or_revoked'), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(book_id,approval_id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.payroll_runs(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.approvals(book_id,id)
);
CREATE TRIGGER immutable_payroll_input BEFORE UPDATE OR DELETE ON openerp.payroll_inputs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_input_review BEFORE UPDATE OR DELETE ON openerp.payroll_input_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_input_execution BEFORE UPDATE OR DELETE ON openerp.payroll_input_executions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_input_component BEFORE UPDATE OR DELETE ON openerp.payroll_input_components FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_input_allocation BEFORE UPDATE OR DELETE ON openerp.payroll_input_allocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_input_reservation BEFORE UPDATE OR DELETE ON openerp.payroll_input_reservations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_input_consumption BEFORE UPDATE OR DELETE ON openerp.payroll_input_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_run_approval_reservation BEFORE UPDATE OR DELETE ON openerp.payroll_run_approval_reservations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_run_reservation_release BEFORE UPDATE OR DELETE ON openerp.payroll_run_reservation_releases FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.payroll_inputs,openerp.payroll_input_reviews,openerp.payroll_input_executions,
  openerp.payroll_input_components,openerp.payroll_input_allocations,openerp.payroll_input_reservations,openerp.payroll_input_consumptions,
  openerp.payroll_run_approval_reservations,openerp.payroll_run_reservation_releases TO openerp_runtime;

CREATE FUNCTION openerp.require_payroll_input_consequences() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE review openerp.payroll_input_reviews%ROWTYPE; execution openerp.payroll_input_executions%ROWTYPE;
  run openerp.payroll_runs%ROWTYPE; component text; employee jsonb; input jsonb;
BEGIN
  SELECT * INTO review FROM openerp.payroll_input_reviews WHERE book_id=NEW.book_id AND (change_set_id=NEW.change_set_id OR event_id=NEW.event_id);
  IF FOUND THEN
    SELECT * INTO execution FROM openerp.payroll_input_executions WHERE book_id=NEW.book_id AND review_id=review.id AND input_id=review.input_id AND voucher_id=NEW.id AND kind=review.kind;
    IF NOT FOUND THEN RAISE EXCEPTION 'payroll input requires atomic execution' USING ERRCODE='23514'; END IF;
    IF review.kind='recognition' THEN
      FOR component IN SELECT value FROM jsonb_array_elements_text(review.body->'componentKeys') LOOP
        IF NOT EXISTS(SELECT FROM openerp.payroll_input_components WHERE book_id=NEW.book_id AND input_id=review.input_id AND component_key=component) THEN
          RAISE EXCEPTION 'payroll input components incomplete' USING ERRCODE='23514';
        END IF;
      END LOOP;
    ELSE
      IF NOT EXISTS(SELECT FROM openerp.payroll_input_allocations WHERE book_id=NEW.book_id AND input_id=review.input_id AND execution_id=execution.id AND amount_minor::text=review.body->'payment'->>'amountMinor') THEN
        RAISE EXCEPTION 'payroll input cash allocation incomplete' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  SELECT * INTO run FROM openerp.payroll_runs WHERE book_id=NEW.book_id AND (change_set_id=NEW.change_set_id OR event_id=NEW.event_id);
  IF NOT FOUND THEN RETURN NEW; END IF;
  FOR employee IN SELECT value FROM jsonb_array_elements(run.body->'employees') LOOP
    FOR input IN SELECT value FROM jsonb_array_elements(coalesce(employee->'calculation'->'basis'->'payrollInputs','[]'::jsonb)) LOOP
      IF NOT EXISTS(SELECT FROM openerp.payroll_input_consumptions WHERE book_id=NEW.book_id AND input_id=input->>'inputId' AND run_id=run.id AND employee_id=employee->'calculation'->>'employeeId' AND reimbursement_minor::text=input->>'reimbursementMinor' AND gross_minor::text=input->>'grossMinor')
        OR NOT EXISTS(SELECT FROM openerp.payroll_input_reservations r WHERE r.book_id=NEW.book_id AND r.input_id=input->>'inputId' AND r.run_id=run.id AND r.snapshot=input AND NOT EXISTS(SELECT FROM openerp.payroll_run_reservation_releases x WHERE x.book_id=r.book_id AND x.approval_id=r.approval_id)) THEN
        RAISE EXCEPTION 'payroll input consumption incomplete' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION openerp.require_payroll_input_consequences() FROM PUBLIC,openerp_runtime;
CREATE CONSTRAINT TRIGGER payroll_input_atomic_consequences AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_payroll_input_consequences();
