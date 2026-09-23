-- Recover only this actor's committed source-retention result by original request key.
-- No upload completion, storage access, new artifact or generic receipt disclosure.
CREATE FUNCTION openerp.recover_source_retention(p_token text,p_scope jsonb,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE r_actor text; r_result jsonb;
BEGIN
  r_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  IF coalesce(p_key,'') !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the original source-retention request key.'); END IF;
  SELECT r.result INTO r_result FROM openerp.command_receipts r
    WHERE r.book_id=p_scope->>'bookId' AND r.key=p_key AND r.actor_id=r_actor
      AND r.operation IN('retain_source','retain_source_object');
  IF NOT FOUND THEN
    PERFORM openerp.fail('NotFound','No committed source-retention result was found for this actor, book and key at this check. An in-flight request can still commit; absence is not permission to use a new key.'); END IF;
  -- A duplicate retention can return an earlier occurrence's actor/key provenance.
  -- Bind ownership to the command receipt above, never to fields in its frozen result.
  RETURN r_result;
END $$;
REVOKE ALL ON FUNCTION openerp.recover_source_retention(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.recover_source_retention(text,jsonb,text) TO openerp_runtime;
