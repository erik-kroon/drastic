ALTER TABLE openerp.outbox DROP CONSTRAINT outbox_book_id_receipt_id_kind_key;
CREATE UNIQUE INDEX outbox_receipt_kind_key ON openerp.outbox(book_id,receipt_id,kind) WHERE kind<>'payroll.payslip.render_requested';
CREATE UNIQUE INDEX outbox_payroll_document_key ON openerp.outbox(book_id,receipt_id,(payload->>'documentId')) WHERE kind='payroll.payslip.render_requested';

CREATE TABLE openerp.payroll_runs (
  book_id text NOT NULL,
  id text NOT NULL,
  change_set_id text NOT NULL,
  event_id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,change_set_id),
  UNIQUE (book_id,event_id),
  FOREIGN KEY (book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
  FOREIGN KEY (book_id,event_id) REFERENCES openerp.events(book_id,id),
  CHECK(octet_length(body::text)<=8388608),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'digest'=digest
    AND body->'postingPlan'->>'id'=change_set_id AND body->>'state'='prepared') IS TRUE)
);
CREATE TABLE openerp.payroll_run_executions (
  book_id text NOT NULL,
  id text NOT NULL,
  run_id text NOT NULL,
  voucher_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,run_id),
  UNIQUE(book_id,voucher_id),
  UNIQUE(book_id,posting_receipt_id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.payroll_runs(book_id,id),
  FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
  FOREIGN KEY(book_id,posting_receipt_id) REFERENCES openerp.execution_receipts(book_id,id),
  CHECK(octet_length(body::text)<=8388608),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'runId'=run_id
    AND body->>'status'='posted_unpaid' AND body->'postingReceipt'->>'voucherId'=voucher_id
    AND body->'postingReceipt'->>'id'=posting_receipt_id) IS TRUE)
);
CREATE TABLE openerp.payroll_run_obligations (
  book_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  calculation_id text NOT NULL,
  payable_minor numeric NOT NULL CHECK(payable_minor>=0 AND payable_minor=trunc(payable_minor)),
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,run_id,employee_id),
  UNIQUE(book_id,calculation_id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.payroll_run_executions(book_id,run_id),
  FOREIGN KEY(book_id,calculation_id) REFERENCES openerp.payroll_calculations(book_id,id),
  FOREIGN KEY(book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id),
  CHECK((body->>'employeeId'=employee_id AND body->>'calculationId'=calculation_id
    AND body->>'payableMinor'=payable_minor::text) IS TRUE)
);
CREATE TABLE openerp.payroll_earning_reservations (
  book_id text NOT NULL,
  employee_id text NOT NULL,
  earnings_period_start date NOT NULL,
  earnings_period_end date NOT NULL,
  run_id text NOT NULL,
  calculation_id text NOT NULL,
  PRIMARY KEY(book_id,employee_id,earnings_period_start,earnings_period_end),
  UNIQUE(book_id,calculation_id),
  FOREIGN KEY(book_id,run_id,employee_id) REFERENCES openerp.payroll_run_obligations(book_id,run_id,employee_id),
  FOREIGN KEY(book_id,calculation_id) REFERENCES openerp.payroll_calculations(book_id,id)
);
CREATE TABLE openerp.payroll_month_reservations (
  book_id text NOT NULL,
  employee_id text NOT NULL,
  month text NOT NULL CHECK(month ~ '^[0-9]{4}-[0-9]{2}$'),
  run_id text NOT NULL,
  calculation_id text NOT NULL,
  contribution_base_minor numeric NOT NULL CHECK(contribution_base_minor>=0 AND contribution_base_minor=trunc(contribution_base_minor)),
  PRIMARY KEY(book_id,employee_id,month),
  UNIQUE(book_id,calculation_id),
  FOREIGN KEY(book_id,run_id,employee_id) REFERENCES openerp.payroll_run_obligations(book_id,run_id,employee_id)
);
CREATE TABLE openerp.payroll_payslip_documents (
  book_id text NOT NULL,
  id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,run_id,employee_id),
  FOREIGN KEY(book_id,run_id,employee_id) REFERENCES openerp.payroll_run_obligations(book_id,run_id,employee_id),
  CHECK(octet_length(body::text)<=1048576),
  CHECK((body->>'id'=id AND body->'scope'->>'bookId'=book_id AND body->>'runId'=run_id
    AND body->>'employeeId'=employee_id AND body->>'digest'=digest AND body->>'status'='posted_unpaid') IS TRUE)
);
CREATE TABLE openerp.payroll_payslip_artifacts (
  book_id text NOT NULL,
  id text NOT NULL,
  document_id text NOT NULL,
  descriptor jsonb NOT NULL,
  content_base64 text NOT NULL,
  PRIMARY KEY(book_id,id),
  UNIQUE(book_id,document_id),
  FOREIGN KEY(book_id,document_id) REFERENCES openerp.payroll_payslip_documents(book_id,id),
  CHECK(octet_length(content_base64)<=8388608),
  CHECK((descriptor->>'id'=id AND descriptor->'scope'->>'bookId'=book_id
    AND descriptor->>'documentId'=document_id AND descriptor->>'mediaType'='application/pdf') IS TRUE)
);
CREATE TABLE openerp.payroll_payslip_render_failures (
  book_id text NOT NULL,
  document_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
  code text NOT NULL,
  failed_at timestamptz NOT NULL,
  PRIMARY KEY(book_id,document_id,ordinal),
  FOREIGN KEY(book_id,document_id) REFERENCES openerp.payroll_payslip_documents(book_id,id)
);
CREATE TRIGGER immutable_payroll_run BEFORE UPDATE OR DELETE ON openerp.payroll_runs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_run_execution BEFORE UPDATE OR DELETE ON openerp.payroll_run_executions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_run_obligation BEFORE UPDATE OR DELETE ON openerp.payroll_run_obligations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_earning_reservation BEFORE UPDATE OR DELETE ON openerp.payroll_earning_reservations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_month_reservation BEFORE UPDATE OR DELETE ON openerp.payroll_month_reservations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_payslip_document BEFORE UPDATE OR DELETE ON openerp.payroll_payslip_documents FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_payslip_artifact BEFORE UPDATE OR DELETE ON openerp.payroll_payslip_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_payroll_payslip_render_failure BEFORE UPDATE OR DELETE ON openerp.payroll_payslip_render_failures FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.require_payroll_run_consequences() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE retained openerp.payroll_runs%ROWTYPE; employee jsonb; obligation jsonb;
BEGIN
  SELECT * INTO retained FROM openerp.payroll_runs WHERE book_id=NEW.book_id AND (change_set_id=NEW.change_set_id OR event_id=NEW.event_id);
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT FROM openerp.payroll_run_executions WHERE book_id=NEW.book_id AND run_id=retained.id AND voucher_id=NEW.id) THEN
    RAISE EXCEPTION 'payroll run requires atomic execution' USING ERRCODE='23514';
  END IF;
  FOR employee IN SELECT value FROM jsonb_array_elements(retained.body->'employees') LOOP
    SELECT body INTO obligation FROM openerp.payroll_run_obligations WHERE book_id=NEW.book_id AND run_id=retained.id AND employee_id=employee->'calculation'->>'employeeId';
    IF obligation IS NULL OR obligation->>'payableMinor' IS DISTINCT FROM employee->'calculation'->'calculation'->>'payableMinor'
      OR NOT EXISTS(SELECT FROM openerp.payroll_earning_reservations WHERE book_id=NEW.book_id AND run_id=retained.id AND calculation_id=employee->'calculation'->>'id')
      OR NOT EXISTS(SELECT FROM openerp.payroll_month_reservations WHERE book_id=NEW.book_id AND run_id=retained.id AND calculation_id=employee->'calculation'->>'id')
      OR NOT EXISTS(SELECT FROM openerp.payroll_payslip_documents d JOIN openerp.outbox o ON o.book_id=d.book_id AND o.payload->>'documentId'=d.id AND o.kind='payroll.payslip.render_requested'
        WHERE d.book_id=NEW.book_id AND d.run_id=retained.id AND d.employee_id=employee->'calculation'->>'employeeId') THEN
      RAISE EXCEPTION 'payroll employee consequences incomplete' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION openerp.require_payroll_run_consequences() FROM PUBLIC,openerp_runtime;
CREATE CONSTRAINT TRIGGER payroll_run_atomic_consequences AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.require_payroll_run_consequences();
GRANT SELECT,INSERT ON openerp.payroll_runs,openerp.payroll_run_executions,openerp.payroll_run_obligations,
  openerp.payroll_earning_reservations,openerp.payroll_month_reservations,openerp.payroll_payslip_documents,
  openerp.payroll_payslip_artifacts,openerp.payroll_payslip_render_failures TO openerp_runtime;
