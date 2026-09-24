-- Book-scoped directory annotations. Issued invoice party revisions remain untouched.
CREATE TABLE openerp.crm_party_annotations (
  book_id text NOT NULL, party_id text NOT NULL, id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('contact','alias','registry_provenance')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  detail text NOT NULL CHECK (length(detail) BETWEEN 1 AND 2000),
  evidence_id text NOT NULL, recorded_by text NOT NULL REFERENCES openerp.actors,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,party_id) REFERENCES openerp.commerce_counterparties,
  FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE INDEX crm_party_annotations_party ON openerp.crm_party_annotations(book_id,party_id,id);
CREATE TRIGGER crm_party_annotations_immutable BEFORE UPDATE OR DELETE ON openerp.crm_party_annotations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.crm_add_annotation(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_id text;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'crm_add_annotation',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['partyId','kind','label','detail','evidenceId']);
  IF coalesce(p_input->>'kind','') NOT IN ('contact','alias','registry_provenance') OR jsonb_typeof(p_input->'kind') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Choose contact, alias or registry provenance.'); END IF;
  PERFORM openerp.commerce_text(p_input,'partyId',200);
  PERFORM openerp.commerce_text(p_input,'label',200);
  PERFORM openerp.commerce_text(p_input,'detail',2000);
  PERFORM openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId');
  IF NOT EXISTS (SELECT FROM openerp.commerce_counterparties c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_input->>'partyId') THEN
    PERFORM openerp.fail('NotFound','The party does not exist in this book.'); END IF;
  v_id:=openerp.new_id('crm');
  INSERT INTO openerp.crm_party_annotations(book_id,party_id,id,kind,label,detail,evidence_id,recorded_by)
    VALUES (p_scope->>'bookId',p_input->>'partyId',v_id,p_input->>'kind',p_input->>'label',p_input->>'detail',p_input->>'evidenceId',v_actor);
  SELECT jsonb_build_object('id',a.id,'partyId',a.party_id,'kind',a.kind,'label',a.label,'detail',a.detail,
    'evidenceId',a.evidence_id,'recordedBy',a.recorded_by,'recordedAt',a.recorded_at) INTO v_result
    FROM openerp.crm_party_annotations a WHERE a.book_id=p_scope->>'bookId' AND a.id=v_id;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'crm_add_annotation',p_input,v_result);
END $$;

CREATE FUNCTION openerp.crm_directory(p_token text,p_scope jsonb,p_search text,p_role text,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF length(coalesce(p_search,''))>200 OR length(coalesce(p_after,''))>200 OR coalesce(p_role,'') NOT IN ('','customer','supplier','both') THEN
    PERFORM openerp.fail('InvalidJournal','Invalid directory search, cursor or role.'); END IF;
  WITH page AS (
    SELECT c.id,c.role,c.external_key,r.body
    FROM openerp.commerce_counterparties c
    JOIN openerp.commerce_counterparty_revisions r ON r.book_id=c.book_id AND r.counterparty_id=c.id AND r.revision=c.current_revision
    WHERE c.book_id=p_scope->>'bookId' AND c.id COLLATE "C">coalesce(p_after,'') COLLATE "C"
      AND (coalesce(p_role,'')='' OR c.role=p_role OR (c.role='both' AND p_role IN ('customer','supplier')))
      AND (coalesce(p_search,'')='' OR c.external_key ILIKE '%'||p_search||'%' OR r.body->>'displayName' ILIKE '%'||p_search||'%'
        OR EXISTS (SELECT FROM openerp.crm_party_annotations a WHERE a.book_id=c.book_id AND a.party_id=c.id
          AND a.kind='alias' AND a.label ILIKE '%'||p_search||'%'))
    ORDER BY c.id COLLATE "C" LIMIT 51
  ), shown AS (SELECT * FROM page ORDER BY id COLLATE "C" LIMIT 50)
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('party',s.body,'annotations',
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'label',a.label,'detail',a.detail,
      'evidenceId',a.evidence_id,'recordedBy',a.recorded_by,'recordedAt',a.recorded_at) ORDER BY a.id COLLATE "C")
      FROM openerp.crm_party_annotations a WHERE a.book_id=p_scope->>'bookId' AND a.party_id=s.id),'[]'::jsonb)) ORDER BY s.id COLLATE "C"),'[]'::jsonb),
    'next',CASE WHEN (SELECT count(*) FROM page)>50 THEN max(s.id COLLATE "C") ELSE NULL END)
    INTO v_result FROM shown s;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION openerp.crm_add_annotation(text,jsonb,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION openerp.crm_directory(text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.crm_add_annotation(text,jsonb,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.crm_directory(text,jsonb,text,text,text) TO openerp_runtime;
