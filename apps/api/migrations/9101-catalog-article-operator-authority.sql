CREATE OR REPLACE FUNCTION openerp.catalog_save_article(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_code text; v_revision bigint; v_price text; v_expected bigint;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'catalog_save_article',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['code','expectedRevision','description','unit','unitPriceMinor','taxDescription']);
  v_code:=openerp.commerce_text(p_input,'code',64);
  IF v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' THEN
    PERFORM openerp.fail('InvalidJournal','Article code must contain letters, digits, dots, hyphens or underscores.'); END IF;
  PERFORM openerp.commerce_text(p_input,'description',500);
  PERFORM openerp.commerce_text(p_input,'unit',32);
  IF jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number' OR
    (p_input->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,4})$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the article revision being replaced (zero to create).'); END IF;
  v_expected:=(p_input->>'expectedRevision')::bigint;
  IF p_input->'unitPriceMinor' IS DISTINCT FROM 'null'::jsonb THEN
    v_price:=openerp.commerce_text(p_input,'unitPriceMinor',18);
    IF v_price !~ '^(0|[1-9][0-9]{0,17})$' THEN
      PERFORM openerp.fail('InvalidJournal','Unit price must be a nonnegative minor-unit integer.'); END IF;
  END IF;
  IF p_input->'taxDescription' IS DISTINCT FROM 'null'::jsonb THEN
    PERFORM openerp.commerce_text(p_input,'taxDescription',200);
  END IF;
  SELECT a.current_revision INTO v_revision FROM openerp.catalog_articles a
    WHERE a.book_id=p_scope->>'bookId' AND a.code=v_code FOR UPDATE;
  IF coalesce(v_revision,0)<>v_expected THEN
    PERFORM openerp.fail('StaleDependency','Read the current article revision before changing its defaults.'); END IF;
  v_revision:=v_expected+1;
  IF v_expected=0 THEN
    INSERT INTO openerp.catalog_articles(book_id,code,current_revision) VALUES(p_scope->>'bookId',v_code,v_revision);
  ELSE
    UPDATE openerp.catalog_articles SET current_revision=v_revision WHERE book_id=p_scope->>'bookId' AND code=v_code;
  END IF;
  v_result:=jsonb_build_object('code',v_code,'revision',v_revision,'description',p_input->>'description',
    'unit',p_input->>'unit','unitPriceMinor',p_input->'unitPriceMinor','taxDescription',p_input->'taxDescription');
  INSERT INTO openerp.catalog_article_revisions(book_id,code,revision,body,recorded_by)
    VALUES(p_scope->>'bookId',v_code,v_revision,v_result,v_actor);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'catalog_save_article',p_input,v_result);
END $$;
