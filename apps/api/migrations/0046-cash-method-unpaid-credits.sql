-- Owned unpaid credits append commercial and exact recognized corrections.
-- Existing year-end runs, recognition rows, and positive VAT facts stay immutable.
ALTER TABLE openerp.cash_method_lines ADD CONSTRAINT cash_complete_original_components CHECK (
  (original_net_minor IS NULL AND original_tax_minor IS NULL AND original_deductible_minor IS NULL)
  OR (original_net_minor IS NOT NULL AND original_tax_minor IS NOT NULL AND original_deductible_minor IS NOT NULL)
);
CREATE FUNCTION openerp.cash_method_original_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF NEW.original_net_minor IS NULL OR NOT EXISTS (
    SELECT FROM openerp.commerce_invoices i, jsonb_array_elements(i.body->'cashMethod'->'lines') l
    WHERE i.book_id=NEW.book_id AND i.id=NEW.invoice_id
      AND i.cash_method_source_draft_id IS NOT NULL
      AND l->>'sourceLineId'=NEW.source_line_id
      AND l->>'netMinor'=NEW.original_net_minor AND l->>'taxMinor'=NEW.original_tax_minor
      AND l->>'deductibleMinor'=NEW.original_deductible_minor AND l->>'grossMinor'=NEW.original_gross_minor
      AND i.body->'cashMethod'->>'methodFactRevisionId'=NEW.profile_witness
      AND i.body->'cashMethod'->>'componentPolicy'=NEW.component_policy
      AND i.body->'cashMethod'->>'rounding'=NEW.rounding
  ) THEN RAISE EXCEPTION 'cash coverage must retain its complete frozen native original'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION openerp.cash_method_original_identity() FROM PUBLIC;
CREATE TRIGGER cash_method_original_identity BEFORE INSERT ON openerp.cash_method_lines
  FOR EACH ROW EXECUTE FUNCTION openerp.cash_method_original_identity();
CREATE TABLE openerp.cash_method_credit_plans (
  book_id text NOT NULL, id text NOT NULL, invoice_id text NOT NULL,
  change_set_id text, evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,change_set_id),
  FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices(book_id,id),
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets(book_id,id),
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
  CHECK(body->>'digest'=openerp.digest(body-'digest'))
);
CREATE TABLE openerp.cash_method_credit_approvals (
  book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, actor_id text NOT NULL,
  consumed_at timestamptz, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.cash_method_credit_plans(book_id,id),
  FOREIGN KEY(actor_id) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.cash_method_credits (
  book_id text NOT NULL, id text NOT NULL, invoice_id text NOT NULL,
  plan_id text NOT NULL, approval_id text NOT NULL, evidence_id text NOT NULL,
  draft_id text NOT NULL, draft_revision bigint NOT NULL,
  supplier_credit_number text NOT NULL, credit_date date NOT NULL,
  gross_minor numeric(20,0) NOT NULL CHECK(gross_minor>0),
  recognized_minor numeric(20,0) NOT NULL CHECK(recognized_minor>=0 AND recognized_minor<=gross_minor),
  voucher_id text, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,plan_id), UNIQUE(book_id,approval_id),
  UNIQUE(book_id,evidence_id), UNIQUE(book_id,invoice_id,supplier_credit_number),
  UNIQUE(book_id,draft_id),
  FOREIGN KEY(book_id,draft_id,draft_revision) REFERENCES openerp.supplier_invoice_draft_revisions(book_id,draft_id,revision),
  FOREIGN KEY(book_id,invoice_id) REFERENCES openerp.commerce_invoices(book_id,id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.cash_method_credit_plans(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.cash_method_credit_approvals(book_id,id),
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
  FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
  CHECK((recognized_minor=0)=(voucher_id IS NULL))
);
CREATE TABLE openerp.cash_method_credit_lines (
  book_id text NOT NULL, id text NOT NULL, credit_id text NOT NULL, line_id text NOT NULL,
  original_recognition_id text, original_vat_fact_id text, vat_fact_id text,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,credit_id,line_id), UNIQUE(book_id,vat_fact_id),
  FOREIGN KEY(book_id,credit_id) REFERENCES openerp.cash_method_credits(book_id,id),
  FOREIGN KEY(book_id,line_id) REFERENCES openerp.cash_method_lines(book_id,id),
  FOREIGN KEY(book_id,original_recognition_id) REFERENCES openerp.cash_method_recognitions(book_id,id),
  FOREIGN KEY(book_id,original_vat_fact_id) REFERENCES openerp.vat_fact_components(book_id,id),
  FOREIGN KEY(book_id,vat_fact_id) REFERENCES openerp.vat_fact_components(book_id,id) DEFERRABLE INITIALLY DEFERRED,
  CHECK(body ?& ARRAY['lineId','before','after','creditGrossMinor','recognizedCorrectionMinor','correctionTaxMinor']),
  CHECK(jsonb_typeof(body->'before')='object' AND jsonb_typeof(body->'after')='object'),
  CHECK(body->'before' ?& ARRAY['recognizedVersion','paidGrossMinor','creditedGrossMinor','recognizedGrossMinor','releasedDeductibleMinor']),
  CHECK(body->'after' ?& ARRAY['recognizedVersion','paidGrossMinor','creditedGrossMinor','recognizedGrossMinor','releasedDeductibleMinor']),
  CHECK(jsonb_typeof(body->'lineId')='string' AND body->>'lineId'=line_id),
  CHECK(jsonb_typeof(body->'creditGrossMinor')='string' AND jsonb_typeof(body->'recognizedCorrectionMinor')='string' AND jsonb_typeof(body->'correctionTaxMinor')='string'),
  CHECK((body->>'creditGrossMinor')::numeric>0),
  CHECK((body->>'recognizedCorrectionMinor')::numeric>=0),
  CHECK((body->'before'->>'paidGrossMinor')::numeric=(body->'after'->>'paidGrossMinor')::numeric),
  CHECK((body->'after'->>'creditedGrossMinor')::numeric-(body->'before'->>'creditedGrossMinor')::numeric=(body->>'creditGrossMinor')::numeric),
  CHECK((body->'before'->>'recognizedGrossMinor')::numeric-(body->'after'->>'recognizedGrossMinor')::numeric=(body->>'recognizedCorrectionMinor')::numeric),
  CHECK(((body->>'recognizedCorrectionMinor')::numeric=0)=(original_recognition_id IS NULL)),
  CHECK(((body->>'correctionTaxMinor')::numeric=0)=(vat_fact_id IS NULL))
);
ALTER TABLE openerp.vat_fact_components ADD COLUMN cash_method_credit_id text,
  ADD FOREIGN KEY(book_id,cash_method_credit_id) REFERENCES openerp.cash_method_credit_lines(book_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX vat_cash_credit_key ON openerp.vat_fact_components(book_id,cash_method_credit_id) WHERE cash_method_credit_id IS NOT NULL;

CREATE TRIGGER immutable_cash_credit_plan BEFORE UPDATE OR DELETE ON openerp.cash_method_credit_plans
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_cash_credit BEFORE UPDATE OR DELETE ON openerp.cash_method_credits
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_cash_credit_line BEFORE UPDATE OR DELETE ON openerp.cash_method_credit_lines
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE OR REPLACE FUNCTION openerp.cash_method_line_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF NEW.book_id<>OLD.book_id OR NEW.id<>OLD.id OR NEW.version<>OLD.version+1
     OR OLD.original_net_minor IS NULL
     OR NEW.invoice_id<>OLD.invoice_id OR NEW.source_line_id<>OLD.source_line_id
     OR NEW.direction<>OLD.direction OR NEW.currency<>OLD.currency
     OR NEW.original_gross_minor<>OLD.original_gross_minor
     OR NEW.original_net_minor IS DISTINCT FROM OLD.original_net_minor
     OR NEW.original_tax_minor IS DISTINCT FROM OLD.original_tax_minor
     OR NEW.original_deductible_minor IS DISTINCT FROM OLD.original_deductible_minor
     OR NEW.component_policy<>OLD.component_policy OR NEW.rounding<>OLD.rounding
     OR NEW.profile_witness<>OLD.profile_witness
     OR NEW.paid_gross_minor::numeric<OLD.paid_gross_minor::numeric
     OR NEW.credited_gross_minor::numeric<OLD.credited_gross_minor::numeric THEN
    RAISE EXCEPTION 'cash method original identity and paid history cannot change';
  END IF;
  IF NEW.credited_gross_minor<>OLD.credited_gross_minor OR NEW.recognized_gross_minor::numeric<OLD.recognized_gross_minor::numeric
     OR NEW.released_deductible_minor::numeric<OLD.released_deductible_minor::numeric THEN
    IF NOT EXISTS(SELECT FROM openerp.cash_method_credit_lines c WHERE c.book_id=NEW.book_id AND c.line_id=NEW.id
      AND c.body->'before'->>'recognizedVersion'=OLD.version::text
      AND c.body->'after'->>'recognizedVersion'=NEW.version::text
      AND c.body->'before'->>'paidGrossMinor'=OLD.paid_gross_minor
      AND c.body->'after'->>'paidGrossMinor'=NEW.paid_gross_minor
      AND c.body->'before'->>'creditedGrossMinor'=OLD.credited_gross_minor
      AND c.body->'after'->>'creditedGrossMinor'=NEW.credited_gross_minor
      AND c.body->'before'->>'recognizedGrossMinor'=OLD.recognized_gross_minor
      AND c.body->'after'->>'recognizedGrossMinor'=NEW.recognized_gross_minor
      AND c.body->'before'->>'releasedDeductibleMinor'=OLD.released_deductible_minor
      AND c.body->'after'->>'releasedDeductibleMinor'=NEW.released_deductible_minor) THEN
      RAISE EXCEPTION 'cash method credit requires its exact immutable correction receipt';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION openerp.cash_method_line_fence() FROM PUBLIC;
GRANT SELECT,INSERT ON openerp.cash_method_credit_plans,openerp.cash_method_credit_approvals,
  openerp.cash_method_credits,openerp.cash_method_credit_lines TO openerp_runtime;
GRANT UPDATE(consumed_at) ON openerp.cash_method_credit_approvals TO openerp_runtime;
GRANT UPDATE(credited_gross_minor) ON openerp.cash_method_lines TO openerp_runtime;
