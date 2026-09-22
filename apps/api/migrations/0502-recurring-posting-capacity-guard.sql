-- Depends on0500 and recorded recurring preparation identities from0200.
-- A prepared full-amount proposal is not authority to recognize an already matched source again.
CREATE FUNCTION openerp.bank_guard_recurring_posting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF NEW.posting_purpose <> 'adjustment' THEN RETURN NEW; END IF;
  -- The kernel already holds this lock. Keep direct maintenance inserts in the same order.
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS (
    SELECT FROM openerp.recurring_preparations rp JOIN openerp.change_sets cs
      ON (cs.book_id,cs.id)=(rp.book_id,rp.change_set_id)
    WHERE rp.book_id=NEW.book_id
      AND openerp.bank_allocated_source(rp.book_id,rp.statement_id,rp.row_ordinal)<>0
      AND EXISTS (
        SELECT FROM jsonb_array_elements(cs.plan->'groups') AS plan_group(value)
        CROSS JOIN LATERAL jsonb_array_elements(plan_group.value->'actions') AS plan_action(value)
        WHERE plan_action.value->>'kind'='post_voucher' AND plan_action.value->>'eventId'=NEW.event_id
      )
  ) THEN
    PERFORM openerp.fail('StaleDependency','This recurring source already has bank matching allocations. Review the existing posting and match; the full-amount proposal cannot be posted.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_recurring_source_capacity BEFORE INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.bank_guard_recurring_posting();
REVOKE ALL ON FUNCTION openerp.bank_guard_recurring_posting() FROM PUBLIC,openerp_runtime;
