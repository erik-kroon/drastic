-- Disambiguate the requested view visibility from the stored column.
CREATE OR REPLACE FUNCTION openerp.workspace_save_view(token text, scope jsonb, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; result jsonb; view_id text; a_visibility text;
BEGIN
  actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE id=scope->>'bookId' FOR UPDATE;
  result:=openerp.replay(scope->>'bookId',key,actor,'workspace_save_view',payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  a_visibility:=payload->>'visibility';
  IF jsonb_typeof(payload)<>'object' OR payload IS NULL OR
    EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('name','visibility','filters')) OR
    jsonb_typeof(payload->'name') IS DISTINCT FROM 'string' OR length(btrim(payload->>'name')) NOT BETWEEN 1 AND 80 OR
    a_visibility IS NULL OR a_visibility NOT IN ('personal','team') OR payload->'filters' IS NULL OR payload->'filters' ? 'after' THEN
    PERFORM openerp.fail('InvalidJournal','Supply a name, visibility and valid work filters.'); END IF;
  IF a_visibility='team' THEN PERFORM openerp.authorize(token,scope,true); END IF;
  PERFORM openerp.workspace_attention(token,scope,payload->'filters');
  IF (SELECT count(*) FROM openerp.workspace_views v WHERE v.book_id=scope->>'bookId' AND
    ((a_visibility='team' AND v.visibility='team') OR (a_visibility='personal' AND v.visibility='personal' AND v.owner_id=actor)))>=50 THEN
    PERFORM openerp.fail('InvalidJournal','Remove a saved view before adding another. The limit is 50 personal and 50 shared views.'); END IF;
  view_id:='view_'||replace(gen_random_uuid()::text,'-','');
  INSERT INTO openerp.workspace_views VALUES(scope->>'bookId',view_id,actor,btrim(payload->>'name'),a_visibility,payload->'filters');
  result:=jsonb_build_object('scope',scope,'view',jsonb_build_object('id',view_id,'ownerId',actor,'name',btrim(payload->>'name'),'visibility',a_visibility,'filters',payload->'filters'));
  RETURN openerp.save_command(scope->>'bookId',key,actor,'workspace_save_view',payload,result);
END $$;
