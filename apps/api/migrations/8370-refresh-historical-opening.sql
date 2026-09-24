-- Keep replaced opening proposals auditable and permanently ineligible for posting.
CREATE TABLE openerp.superseded_historical_openings (
  book_id text NOT NULL, change_set_id text NOT NULL, replacement_id text NOT NULL,
  PRIMARY KEY(book_id,change_set_id),
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY(book_id,replacement_id) REFERENCES openerp.change_sets
);
CREATE TRIGGER immutable_superseded_historical_opening
  BEFORE UPDATE OR DELETE ON openerp.superseded_historical_openings
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.superseded_historical_openings FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.guard_superseded_historical_opening() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.superseded_historical_openings
    WHERE book_id=NEW.book_id AND change_set_id=NEW.change_set_id) THEN
    PERFORM openerp.fail('StaleDependency','This opening proposal was replaced. Review and approve its replacement.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_superseded_historical_opening BEFORE INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.guard_superseded_historical_opening();

CREATE FUNCTION openerp.refresh_historical_opening(p_token text,p_scope jsonb,p_key text,p_year text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; prior jsonb; basis openerp.historical_bases; period openerp.periods;
  evidence jsonb; proposal jsonb; lines jsonb; row jsonb; amount numeric; updated jsonb;
  request jsonb:=jsonb_build_object('fiscalYearId',p_year,'input',p_input);
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  prior:=openerp.replay(p_scope->>'bookId',p_key,actor,'refresh_historical_opening',request);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedChangeSetId','accountingPeriodId','series','rationale']);
  SELECT * INTO basis FROM openerp.historical_bases WHERE book_id=p_scope->>'bookId' AND fiscal_year_id=p_year;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Historical basis was not found.'); END IF;
  IF basis.mode<>'opening_set' OR basis.opening_voucher_id IS NOT NULL THEN
    PERFORM openerp.fail('AlreadyPosted','Only an unposted opening proposal can be prepared again.'); END IF;
  IF basis.change_set_id IS DISTINCT FROM p_input->>'expectedChangeSetId' THEN
    PERFORM openerp.fail('StaleDependency','Reload the current opening proposal before preparing it again.'); END IF;
  SELECT * INTO period FROM openerp.periods WHERE book_id=basis.book_id AND id=p_input->>'accountingPeriodId';
  IF NOT FOUND OR period.fiscal_year_id<>p_year THEN
    PERFORM openerp.fail('InvalidJournal','Choose an accounting period in the selected fiscal year.'); END IF;
  IF coalesce(p_input->>'series','')!~'^[A-Z0-9]{1,16}$'
    OR coalesce(length(p_input->>'rationale'),0) NOT BETWEEN 1 AND 2000 THEN
    PERFORM openerp.fail('InvalidJournal','Supply a voucher series and reason for preparing the opening again.'); END IF;
  lines:='[]'::jsonb;
  FOR row IN SELECT value FROM jsonb_array_elements(basis.control) LOOP
    amount:=(row->>'signedMinor')::numeric;
    lines:=lines||jsonb_build_array(jsonb_build_object('accountId',row->>'accountId',
      'debitMinor',greatest(amount,0)::text,'creditMinor',greatest(-amount,0)::text,
      'description','Reviewed historical opening'));
  END LOOP;
  evidence:=openerp.create_evidence(p_token,p_scope,p_key||'_evidence',jsonb_build_object(
    'title','Historical opening prepared again','origin','Retained historical basis and independent controls',
    'mediaType','application/json','content',jsonb_build_object('basis',basis.body,'refresh',p_input)::text));
  proposal:=openerp.prepare_journal(p_token,p_scope,p_key||'_journal',jsonb_build_object(
    'kind','manual_journal','evidenceId',evidence->>'id','eventKey','opening_'||p_year,
    'accountingPeriodId',period.id,'postingDate',basis.cutover_on::text,'series',p_input->>'series',
    'description','Reviewed historical opening','rationale',p_input->>'rationale',
    'taxAssessment','not_applicable','lines',lines));
  INSERT INTO openerp.superseded_historical_openings VALUES(basis.book_id,basis.change_set_id,proposal->>'id');
  updated:=basis.body||jsonb_build_object('changeSetId',proposal->>'id');
  UPDATE openerp.historical_bases SET change_set_id=proposal->>'id',body=updated
    WHERE book_id=basis.book_id AND fiscal_year_id=p_year;
  RETURN openerp.save_command(basis.book_id,p_key,actor,'refresh_historical_opening',request,
    jsonb_build_object('basis',updated,'proposal',proposal));
END $$;
REVOKE ALL ON FUNCTION openerp.refresh_historical_opening(text,jsonb,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.refresh_historical_opening(text,jsonb,text,text,jsonb) TO openerp_runtime;
