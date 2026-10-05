CREATE TABLE openerp.invoice_recognition_replacement_owners (
  book_id text NOT NULL,
  bundle_id text NOT NULL,
  invoice_id text NOT NULL,
  predecessor_voucher_id text NOT NULL,
  body jsonb NOT NULL CHECK ((jsonb_typeof(body) = 'object'
    AND octet_length(body::text) <= 262144
    AND body->>'kind' = 'invoice_recognition_replacement_v1'
    AND body->>'invoiceId' = invoice_id
    AND body->>'predecessorVoucherId' = predecessor_voucher_id
    AND body->>'basisDigest' ~ '^sha256:[a-f0-9]{64}$') IS TRUE),
  PRIMARY KEY (book_id, bundle_id),
  FOREIGN KEY (book_id, bundle_id) REFERENCES openerp.correction_bundles(book_id, id),
  FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  FOREIGN KEY (book_id, predecessor_voucher_id) REFERENCES openerp.vouchers(book_id, id)
);

CREATE TABLE openerp.invoice_recognition_replacements (
  book_id text NOT NULL,
  bundle_id text NOT NULL,
  invoice_id text NOT NULL,
  predecessor_voucher_id text NOT NULL,
  reversal_voucher_id text NOT NULL,
  replacement_voucher_id text NOT NULL,
  reversal_line_id text NOT NULL,
  replacement_line_id text NOT NULL,
  PRIMARY KEY (book_id, bundle_id),
  UNIQUE (book_id, predecessor_voucher_id),
  UNIQUE (book_id, reversal_voucher_id),
  UNIQUE (book_id, replacement_voucher_id),
  FOREIGN KEY (book_id, bundle_id) REFERENCES openerp.invoice_recognition_replacement_owners(book_id, bundle_id),
  FOREIGN KEY (book_id, bundle_id) REFERENCES openerp.correction_bundle_receipts(book_id, bundle_id),
  FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  FOREIGN KEY (book_id, predecessor_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  FOREIGN KEY (book_id, reversal_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  FOREIGN KEY (book_id, replacement_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  FOREIGN KEY (book_id, reversal_voucher_id, reversal_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  FOREIGN KEY (book_id, replacement_voucher_id, replacement_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CHECK (predecessor_voucher_id <> replacement_voucher_id AND reversal_voucher_id <> replacement_voucher_id)
);
CREATE INDEX invoice_recognition_replacement_history ON openerp.invoice_recognition_replacements(book_id, invoice_id);
CREATE FUNCTION openerp.invoice_recognition_replacement_agrees() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF TG_TABLE_NAME = 'invoice_recognition_replacement_owners' THEN
    IF NOT EXISTS (
      SELECT FROM openerp.correction_bundles b
      JOIN openerp.commerce_invoices i ON (i.book_id,i.id)=(b.book_id,NEW.invoice_id)
      WHERE (b.book_id,b.id)=(NEW.book_id,NEW.bundle_id)
        AND b.original_voucher_id=NEW.predecessor_voucher_id
        AND b.body->'registerContribution'=NEW.body
        AND NEW.body->>'originalRecognitionVoucherId'=i.recognition_voucher_id
        AND NEW.body->>'controlAccountId'=i.control_account_id
        AND NEW.body->>'amountMinor'=i.amount_minor::text
        AND (i.recognition_voucher_id=NEW.predecessor_voucher_id OR EXISTS (
          SELECT FROM openerp.invoice_recognition_replacements t
          WHERE (t.book_id,t.invoice_id)=(NEW.book_id,NEW.invoice_id)
            AND t.replacement_voucher_id=NEW.predecessor_voucher_id))
    ) THEN RAISE EXCEPTION 'invoice recognition owner does not agree' USING ERRCODE='P0001'; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT FROM openerp.invoice_recognition_replacement_owners o
      JOIN openerp.correction_bundle_receipts c ON(c.book_id,c.bundle_id)=(o.book_id,o.bundle_id)
      JOIN openerp.execution_receipts reversal ON(reversal.book_id,reversal.id)=(c.book_id,c.reversal_receipt_id)
      JOIN openerp.execution_receipts replacement ON(replacement.book_id,replacement.id)=(c.book_id,c.replacement_receipt_id)
      JOIN openerp.correction_bundles b ON(b.book_id,b.id)=(c.book_id,c.bundle_id)
      JOIN openerp.commerce_invoices i ON(i.book_id,i.id)=(o.book_id,o.invoice_id)
      JOIN openerp.vouchers rv ON(rv.book_id,rv.id)=(reversal.book_id,reversal.voucher_id)
      JOIN openerp.vouchers pv ON(pv.book_id,pv.id)=(replacement.book_id,replacement.voucher_id)
      JOIN openerp.journal_lines rl ON(rl.book_id,rl.voucher_id,rl.id)=(NEW.book_id,NEW.reversal_voucher_id,NEW.reversal_line_id)
      JOIN openerp.journal_lines pl ON(pl.book_id,pl.voucher_id,pl.id)=(NEW.book_id,NEW.replacement_voucher_id,NEW.replacement_line_id)
      WHERE (o.book_id,o.bundle_id)=(NEW.book_id,NEW.bundle_id)
        AND o.invoice_id=NEW.invoice_id AND o.predecessor_voucher_id=NEW.predecessor_voucher_id
        AND c.original_voucher_id=NEW.predecessor_voucher_id
        AND reversal.voucher_id=NEW.reversal_voucher_id AND replacement.voucher_id=NEW.replacement_voucher_id
        AND rv.change_set_id=b.reversal_change_set_id AND pv.change_set_id=b.replacement_change_set_id
        AND rv.corrects_voucher_id=NEW.predecessor_voucher_id AND rv.posting_purpose='reversal'
        AND pv.corrects_voucher_id IS NULL AND pv.posting_purpose='adjustment'
        AND rl.account_id=i.control_account_id AND pl.account_id=i.control_account_id
        AND rl.debit_minor=i.amount_minor AND rl.credit_minor=0
        AND pl.credit_minor=i.amount_minor AND pl.debit_minor=0
    ) THEN RAISE EXCEPTION 'invoice recognition transition does not agree' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION openerp.invoice_recognition_replacement_agrees() FROM PUBLIC, openerp_runtime;
CREATE TRIGGER invoice_recognition_owner_agrees BEFORE INSERT ON openerp.invoice_recognition_replacement_owners
  FOR EACH ROW EXECUTE FUNCTION openerp.invoice_recognition_replacement_agrees();
CREATE TRIGGER invoice_recognition_transition_agrees BEFORE INSERT ON openerp.invoice_recognition_replacements
  FOR EACH ROW EXECUTE FUNCTION openerp.invoice_recognition_replacement_agrees();
CREATE TRIGGER immutable_invoice_recognition_replacement_owner BEFORE UPDATE OR DELETE
  ON openerp.invoice_recognition_replacement_owners FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_invoice_recognition_replacement BEFORE UPDATE OR DELETE
  ON openerp.invoice_recognition_replacements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT, INSERT ON openerp.invoice_recognition_replacement_owners,
  openerp.invoice_recognition_replacements TO openerp_runtime;
