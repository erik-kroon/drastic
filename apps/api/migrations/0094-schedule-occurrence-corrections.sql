CREATE TABLE openerp.schedule_occurrence_correction_owners (
  book_id text NOT NULL,
  bundle_id text NOT NULL,
  schedule_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 120),
  predecessor_voucher_id text NOT NULL,
  body jsonb NOT NULL CHECK ((jsonb_typeof(body)='object' AND octet_length(body::text)<=262144
    AND body->>'kind'='schedule_occurrence_replacement_v1' AND body->>'scheduleId'=schedule_id
    AND (body->>'ordinal')::integer=ordinal AND body->>'predecessorVoucherId'=predecessor_voucher_id
    AND body->'remainingPlanDecision'->>'kind'='preserve_remaining_plan') IS TRUE),
  PRIMARY KEY (book_id,bundle_id),
  FOREIGN KEY (book_id,bundle_id) REFERENCES openerp.correction_bundles(book_id,id),
  FOREIGN KEY (book_id,schedule_id) REFERENCES openerp.subledger_schedules(book_id,id),
  FOREIGN KEY (book_id,predecessor_voucher_id) REFERENCES openerp.vouchers(book_id,id)
);
CREATE TABLE openerp.schedule_occurrence_corrections (
  book_id text NOT NULL,
  bundle_id text NOT NULL,
  schedule_id text NOT NULL,
  ordinal integer NOT NULL,
  predecessor_voucher_id text NOT NULL,
  reversal_voucher_id text NOT NULL,
  replacement_voucher_id text NOT NULL,
  PRIMARY KEY (book_id,bundle_id),
  UNIQUE (book_id,predecessor_voucher_id),
  UNIQUE (book_id,reversal_voucher_id),
  UNIQUE (book_id,replacement_voucher_id),
  FOREIGN KEY (book_id,bundle_id) REFERENCES openerp.schedule_occurrence_correction_owners(book_id,bundle_id),
  FOREIGN KEY (book_id,bundle_id) REFERENCES openerp.correction_bundle_receipts(book_id,bundle_id),
  FOREIGN KEY (book_id,schedule_id) REFERENCES openerp.subledger_schedules(book_id,id),
  FOREIGN KEY (book_id,predecessor_voucher_id) REFERENCES openerp.vouchers(book_id,id),
  FOREIGN KEY (book_id,reversal_voucher_id) REFERENCES openerp.vouchers(book_id,id),
  FOREIGN KEY (book_id,replacement_voucher_id) REFERENCES openerp.vouchers(book_id,id)
);
CREATE FUNCTION openerp.schedule_occurrence_correction_agrees() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF TG_TABLE_NAME='schedule_occurrence_correction_owners' THEN
    IF NOT EXISTS (
      SELECT FROM openerp.correction_bundles b
      JOIN openerp.subledger_preparations p ON(p.book_id,p.schedule_id,p.ordinal)=(NEW.book_id,NEW.schedule_id,NEW.ordinal)
      JOIN openerp.vouchers v ON(v.book_id,v.change_set_id)=(p.book_id,p.change_set_id)
      WHERE (b.book_id,b.id)=(NEW.book_id,NEW.bundle_id)
        AND b.original_voucher_id=NEW.predecessor_voucher_id
        AND b.body->'registerContribution'=NEW.body
        AND NEW.body->>'originalVoucherId'=v.id
        AND (v.id=NEW.predecessor_voucher_id OR EXISTS(SELECT FROM openerp.schedule_occurrence_corrections t
          WHERE (t.book_id,t.schedule_id,t.ordinal)=(NEW.book_id,NEW.schedule_id,NEW.ordinal)
            AND t.replacement_voucher_id=NEW.predecessor_voucher_id))
    ) THEN RAISE EXCEPTION 'schedule correction owner does not agree' USING ERRCODE='P0001'; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT FROM openerp.schedule_occurrence_correction_owners o
      JOIN openerp.correction_bundle_receipts c ON(c.book_id,c.bundle_id)=(o.book_id,o.bundle_id)
      JOIN openerp.execution_receipts reversal ON(reversal.book_id,reversal.id)=(c.book_id,c.reversal_receipt_id)
      JOIN openerp.execution_receipts replacement ON(replacement.book_id,replacement.id)=(c.book_id,c.replacement_receipt_id)
      JOIN openerp.correction_bundles b ON(b.book_id,b.id)=(c.book_id,c.bundle_id)
      JOIN openerp.vouchers rv ON(rv.book_id,rv.id)=(reversal.book_id,reversal.voucher_id)
      JOIN openerp.vouchers pv ON(pv.book_id,pv.id)=(replacement.book_id,replacement.voucher_id)
      WHERE (o.book_id,o.bundle_id)=(NEW.book_id,NEW.bundle_id)
        AND (o.schedule_id,o.ordinal,o.predecessor_voucher_id)=(NEW.schedule_id,NEW.ordinal,NEW.predecessor_voucher_id)
        AND c.original_voucher_id=NEW.predecessor_voucher_id
        AND reversal.voucher_id=NEW.reversal_voucher_id AND replacement.voucher_id=NEW.replacement_voucher_id
        AND rv.change_set_id=b.reversal_change_set_id AND pv.change_set_id=b.replacement_change_set_id
        AND rv.corrects_voucher_id=NEW.predecessor_voucher_id AND rv.posting_purpose='reversal'
        AND pv.corrects_voucher_id IS NULL AND pv.posting_purpose='adjustment'
    ) THEN RAISE EXCEPTION 'schedule correction transition does not agree' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION openerp.schedule_occurrence_correction_agrees() FROM PUBLIC,openerp_runtime;
CREATE TRIGGER schedule_correction_owner_agrees BEFORE INSERT ON openerp.schedule_occurrence_correction_owners
  FOR EACH ROW EXECUTE FUNCTION openerp.schedule_occurrence_correction_agrees();
CREATE TRIGGER schedule_correction_transition_agrees BEFORE INSERT ON openerp.schedule_occurrence_corrections
  FOR EACH ROW EXECUTE FUNCTION openerp.schedule_occurrence_correction_agrees();
CREATE TRIGGER immutable_schedule_correction_owner BEFORE UPDATE OR DELETE ON openerp.schedule_occurrence_correction_owners
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_schedule_correction BEFORE UPDATE OR DELETE ON openerp.schedule_occurrence_corrections
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.schedule_occurrence_correction_owners,openerp.schedule_occurrence_corrections TO openerp_runtime;
