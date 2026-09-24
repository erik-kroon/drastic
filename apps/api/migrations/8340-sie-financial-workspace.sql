-- Retain the link from each immutable source voucher to its reviewable ledger proposals.
CREATE TABLE openerp.sie_financial_proposals (
  book_id text NOT NULL, run_id text NOT NULL, ordinal integer NOT NULL,
  change_set_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(book_id,change_set_id),
  FOREIGN KEY(book_id,run_id) REFERENCES openerp.sie_financial_runs,
  FOREIGN KEY(book_id,change_set_id) REFERENCES openerp.change_sets
);
CREATE INDEX sie_financial_proposals_cursor ON openerp.sie_financial_proposals(book_id,run_id,ordinal,created_at DESC);
CREATE TRIGGER immutable_sie_financial_proposal BEFORE UPDATE OR DELETE ON openerp.sie_financial_proposals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.sie_financial_proposals FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.get_sie_financial_workspace(p_token text,p_scope jsonb,p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE run openerp.sie_financial_runs; proposal jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF NOT EXISTS(SELECT FROM openerp.sie_source_runs WHERE book_id=p_scope->>'bookId' AND id=p_source) THEN
    PERFORM openerp.fail('NotFound','Source run was not found.'); END IF;
  SELECT * INTO run FROM openerp.sie_financial_runs WHERE book_id=p_scope->>'bookId' AND source_run_id=p_source;
  IF NOT FOUND THEN RETURN jsonb_build_object('run',NULL,'nextProposal',NULL); END IF;
  SELECT c.plan INTO proposal FROM openerp.sie_financial_proposals p
    JOIN openerp.change_sets c ON c.book_id=p.book_id AND c.id=p.change_set_id
    WHERE p.book_id=run.book_id AND p.run_id=run.id AND p.ordinal=run.next_ordinal
    ORDER BY p.created_at DESC,p.change_set_id DESC LIMIT 1;
  RETURN jsonb_build_object('run',openerp.sie_financial_run_view(p_token,p_scope,run.id),'nextProposal',proposal);
END $$;

CREATE FUNCTION openerp.prepare_sie_financial_voucher(p_token text,p_scope jsonb,p_key text,p_id text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; previous jsonb; request jsonb:=jsonb_build_object('runId',p_id,'input',p_input);
  run openerp.sie_financial_runs; source openerp.sie_source_runs; plan openerp.sie_source_plans;
  voucher openerp.sie_source_vouchers; period openerp.periods; evidence jsonb; result jsonb; lines jsonb;
BEGIN
  actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,actor,'prepare_sie_financial_voucher',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['fence','planDigest','ordinal','accountingPeriodId','series','rationale']);
  SELECT * INTO run FROM openerp.sie_financial_runs WHERE book_id=p_scope->>'bookId' AND id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Financial run was not found.'); END IF;
  IF run.status<>'running' OR run.lease_until<=clock_timestamp()
    OR p_input->>'fence' IS DISTINCT FROM run.fence::text
    OR p_input->>'planDigest' IS DISTINCT FROM run.source_plan_digest
    OR p_input->>'ordinal' IS DISTINCT FROM run.next_ordinal::text THEN
    PERFORM openerp.fail('StaleDependency','Resume the current financial run and prepare its next source voucher.'); END IF;
  IF coalesce(p_input->>'series','')!~'^[A-Z0-9]{1,16}$'
    OR coalesce(length(p_input->>'rationale'),0) NOT BETWEEN 1 AND 2000 THEN
    PERFORM openerp.fail('InvalidJournal','Choose a voucher series and record the review rationale.'); END IF;
  SELECT * INTO STRICT source FROM openerp.sie_source_runs WHERE book_id=run.book_id AND id=run.source_run_id;
  SELECT * INTO STRICT plan FROM openerp.sie_source_plans WHERE book_id=run.book_id AND id=source.plan_id;
  SELECT * INTO voucher FROM openerp.sie_source_vouchers WHERE book_id=run.book_id AND run_id=source.id AND ordinal=run.next_ordinal;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The next source voucher was not found.'); END IF;
  SELECT * INTO period FROM openerp.periods WHERE book_id=run.book_id AND id=p_input->>'accountingPeriodId';
  IF NOT FOUND OR period.fiscal_year_id<>run.fiscal_year_id
    OR to_date(voucher.body->>'date','YYYYMMDD') NOT BETWEEN period.starts_on AND period.ends_on THEN
    PERFORM openerp.fail('InvalidJournal','Select the accounting period containing the source voucher date.'); END IF;
  SELECT jsonb_agg(jsonb_build_object('accountId',m->>'accountId',
      'debitMinor',greatest((t->>'amount')::numeric*100,0)::numeric(38,0)::text,
      'creditMinor',greatest(-(t->>'amount')::numeric*100,0)::numeric(38,0)::text,
      'description',coalesce(nullif(t->>'text',''),'SIE '||voucher.source_reference)) ORDER BY tx.ordinal)
    INTO lines FROM jsonb_array_elements(voucher.body->'transactions') WITH ORDINALITY tx(t,ordinal)
    JOIN LATERAL jsonb_array_elements(plan.body->'input'->'mappings') m ON m->>'sourceAccount'=t->>'account'
    WHERE t->>'kind'='TRANS';
  evidence:=openerp.create_evidence(p_token,p_scope,p_key||'_evidence',jsonb_build_object(
    'title','SIE '||voucher.source_reference,'mediaType','application/json','origin','Retained SIE source voucher',
    'content',jsonb_build_object('sourcePlanId',plan.id,'sourcePlanDigest',run.source_plan_digest,
      'sourceSha256',plan.body->>'sourceSha256','sourceRunId',source.id,'sourceReference',voucher.source_reference,
      'voucher',voucher.body)::text));
  result:=openerp.prepare_journal(p_token,p_scope,p_key||'_journal',jsonb_build_object(
    'kind','manual_journal','evidenceId',evidence->>'id','eventKey','sie_'||source.id||'_'||voucher.ordinal::text,
    'accountingPeriodId',period.id,'postingDate',to_char(to_date(voucher.body->>'date','YYYYMMDD'),'YYYY-MM-DD'),
    'series',p_input->>'series','description','SIE '||voucher.source_reference,'rationale',p_input->>'rationale',
    'taxAssessment','not_applicable','lines',lines));
  INSERT INTO openerp.sie_financial_proposals(book_id,run_id,ordinal,change_set_id)
    VALUES(run.book_id,run.id,run.next_ordinal,result->>'id');
  RETURN openerp.save_command(run.book_id,p_key,actor,'prepare_sie_financial_voucher',request,result);
END $$;
REVOKE ALL ON FUNCTION openerp.get_sie_financial_workspace(text,jsonb,text),
  openerp.prepare_sie_financial_voucher(text,jsonb,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.get_sie_financial_workspace(text,jsonb,text),
  openerp.prepare_sie_financial_voucher(text,jsonb,text,text,jsonb) TO openerp_runtime;
