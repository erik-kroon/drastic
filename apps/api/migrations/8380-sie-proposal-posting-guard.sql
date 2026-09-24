-- Source-derived proposals may post only through their owning financial run.
-- A pause or completed run must not make a prepared duplicate eligible for direct execution.
CREATE FUNCTION openerp.guard_sie_financial_proposal() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE proposal openerp.sie_financial_proposals; run openerp.sie_financial_runs;
BEGIN
  SELECT * INTO proposal FROM openerp.sie_financial_proposals
    WHERE book_id=NEW.book_id AND change_set_id=NEW.change_set_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO STRICT run FROM openerp.sie_financial_runs
    WHERE book_id=proposal.book_id AND id=proposal.run_id;
  IF run.status<>'running' OR run.lease_until<=clock_timestamp()
    OR run.permitted_change_id IS DISTINCT FROM NEW.change_set_id
    OR EXISTS(SELECT FROM openerp.sie_financial_postings
      WHERE book_id=proposal.book_id AND run_id=proposal.run_id AND ordinal=proposal.ordinal) THEN
    PERFORM openerp.fail('StaleDependency','Post this source voucher through its current financial import run.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_sie_financial_proposal BEFORE INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.guard_sie_financial_proposal();
