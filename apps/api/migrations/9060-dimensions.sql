-- DIM-1 owns the book-scoped catalogue only. Ledger assignment and posting policies belong to DIM-2/3.
CREATE TABLE openerp.dimensions (
 book_id text NOT NULL REFERENCES openerp.books(id),
 code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 effective_from date NOT NULL,
 effective_to date,
 archived_at timestamptz,
 PRIMARY KEY (book_id, code),
 CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE TABLE openerp.dimension_values (
 book_id text NOT NULL,
 dimension_code text NOT NULL,
 code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 effective_from date NOT NULL,
 effective_to date,
 archived_at timestamptz,
 PRIMARY KEY (book_id, dimension_code, code),
 FOREIGN KEY (book_id, dimension_code) REFERENCES openerp.dimensions(book_id, code),
 CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
REVOKE ALL ON openerp.dimensions, openerp.dimension_values FROM PUBLIC, openerp_runtime;

-- Codes and identity cannot change: future assignments can safely retain these references.
CREATE FUNCTION openerp.dimension_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Dimension catalogue entries cannot be deleted'; END IF;
 IF (OLD.book_id, OLD.code) IS DISTINCT FROM (NEW.book_id, NEW.code) THEN
  RAISE EXCEPTION 'Dimension identity cannot be changed';
 END IF;
 IF TG_TABLE_NAME = 'dimension_values' THEN
  IF OLD.dimension_code IS DISTINCT FROM NEW.dimension_code THEN
   RAISE EXCEPTION 'Dimension identity cannot be changed';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dimension_identity BEFORE UPDATE OR DELETE ON openerp.dimensions
 FOR EACH ROW EXECUTE FUNCTION openerp.dimension_identity_guard();
CREATE TRIGGER dimension_value_identity BEFORE UPDATE OR DELETE ON openerp.dimension_values
 FOR EACH ROW EXECUTE FUNCTION openerp.dimension_identity_guard();

CREATE FUNCTION openerp.save_dimension(p_token text, p_scope jsonb, p_key text, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_result jsonb; v_from date; v_to date; v_archived timestamptz;
BEGIN
 v_actor := openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior := openerp.replay(p_scope->>'bookId',p_key,v_actor,'save_dimension',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['code','name','effectiveFrom','effectiveTo','archived']);
 IF jsonb_typeof(p_input->'archived') IS DISTINCT FROM 'boolean' THEN PERFORM openerp.fail('InvalidJournal','Archived must be a boolean.'); END IF;
 BEGIN
  v_from := (p_input->>'effectiveFrom')::date;
  v_to := (p_input->>'effectiveTo')::date;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  PERFORM openerp.fail('InvalidJournal','Invalid dimension date.');
 END;
 IF v_from IS NULL OR (p_input->>'effectiveFrom') !~ '^\d{4}-\d{2}-\d{2}$'
  OR (v_to IS NOT NULL AND (p_input->>'effectiveTo') !~ '^\d{4}-\d{2}-\d{2}$') THEN
  PERFORM openerp.fail('InvalidJournal','Supply ISO dimension dates.'); END IF;
 IF jsonb_typeof(p_input->'code') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'name') IS DISTINCT FROM 'string'
  OR coalesce(p_input->>'code','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
  OR length(btrim(coalesce(p_input->>'name',''))) NOT BETWEEN 1 AND 120
  OR (v_to IS NOT NULL AND v_to<v_from) THEN
  PERFORM openerp.fail('InvalidJournal','Invalid dimension code, name or date range.'); END IF;
 INSERT INTO openerp.dimensions(book_id,code,name,effective_from,effective_to,archived_at)
 VALUES(p_scope->>'bookId',p_input->>'code',p_input->>'name',v_from,v_to,
  CASE WHEN (p_input->>'archived')::boolean THEN statement_timestamp() END)
 ON CONFLICT(book_id,code) DO UPDATE SET name=excluded.name,effective_from=excluded.effective_from,
  effective_to=excluded.effective_to,archived_at=CASE WHEN (p_input->>'archived')::boolean
   THEN coalesce(openerp.dimensions.archived_at,statement_timestamp()) ELSE NULL END;
 SELECT jsonb_build_object('scope',p_scope,'code',code,'name',name,'effectiveFrom',effective_from,
  'effectiveTo',effective_to,'archived',archived_at IS NOT NULL) INTO v_result
 FROM openerp.dimensions WHERE book_id=p_scope->>'bookId' AND code=p_input->>'code';
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'save_dimension',p_input,v_result);
END $$;

CREATE FUNCTION openerp.save_dimension_value(p_token text, p_scope jsonb, p_key text, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_result jsonb; v_from date; v_to date;
BEGIN
 v_actor := openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior := openerp.replay(p_scope->>'bookId',p_key,v_actor,'save_dimension_value',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['dimensionCode','code','name','effectiveFrom','effectiveTo','archived']);
 IF jsonb_typeof(p_input->'archived') IS DISTINCT FROM 'boolean' THEN PERFORM openerp.fail('InvalidJournal','Archived must be a boolean.'); END IF;
 BEGIN
  v_from := (p_input->>'effectiveFrom')::date; v_to := (p_input->>'effectiveTo')::date;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  PERFORM openerp.fail('InvalidJournal','Invalid dimension date.');
 END;
 IF v_from IS NULL OR (p_input->>'effectiveFrom') !~ '^\d{4}-\d{2}-\d{2}$'
  OR (v_to IS NOT NULL AND (p_input->>'effectiveTo') !~ '^\d{4}-\d{2}-\d{2}$') THEN
  PERFORM openerp.fail('InvalidJournal','Supply ISO dimension dates.'); END IF;
 IF jsonb_typeof(p_input->'code') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'name') IS DISTINCT FROM 'string'
  OR coalesce(p_input->>'code','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
  OR length(btrim(coalesce(p_input->>'name',''))) NOT BETWEEN 1 AND 120
  OR (v_to IS NOT NULL AND v_to<v_from) THEN
  PERFORM openerp.fail('InvalidJournal','Invalid dimension code, name or date range.'); END IF;
 IF jsonb_typeof(p_input->'dimensionCode') IS DISTINCT FROM 'string' THEN
  PERFORM openerp.fail('InvalidJournal','Supply a dimension code.'); END IF;
 IF NOT EXISTS(SELECT FROM openerp.dimensions WHERE book_id=p_scope->>'bookId' AND code=p_input->>'dimensionCode') THEN
  PERFORM openerp.fail('NotFound','Dimension was not found in this book.'); END IF;
 INSERT INTO openerp.dimension_values(book_id,dimension_code,code,name,effective_from,effective_to,archived_at)
 VALUES(p_scope->>'bookId',p_input->>'dimensionCode',p_input->>'code',p_input->>'name',v_from,v_to,
  CASE WHEN (p_input->>'archived')::boolean THEN statement_timestamp() END)
 ON CONFLICT(book_id,dimension_code,code) DO UPDATE SET name=excluded.name,effective_from=excluded.effective_from,
  effective_to=excluded.effective_to,archived_at=CASE WHEN (p_input->>'archived')::boolean
   THEN coalesce(openerp.dimension_values.archived_at,statement_timestamp()) ELSE NULL END;
 SELECT jsonb_build_object('scope',p_scope,'dimensionCode',dimension_code,'code',code,'name',name,
  'effectiveFrom',effective_from,'effectiveTo',effective_to,'archived',archived_at IS NOT NULL) INTO v_result
 FROM openerp.dimension_values WHERE book_id=p_scope->>'bookId' AND dimension_code=p_input->>'dimensionCode' AND code=p_input->>'code';
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'save_dimension_value',p_input,v_result);
END $$;

CREATE FUNCTION openerp.list_dimensions(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 RETURN jsonb_build_object('scope',p_scope,'dimensions',
  (SELECT coalesce(jsonb_agg(jsonb_build_object('code',d.code,'name',d.name,'effectiveFrom',d.effective_from,
   'effectiveTo',d.effective_to,'archived',d.archived_at IS NOT NULL,'values',
   (SELECT coalesce(jsonb_agg(jsonb_build_object('code',v.code,'name',v.name,'effectiveFrom',v.effective_from,
    'effectiveTo',v.effective_to,'archived',v.archived_at IS NOT NULL) ORDER BY v.code),'[]'::jsonb)
    FROM openerp.dimension_values v WHERE v.book_id=d.book_id AND v.dimension_code=d.code)) ORDER BY d.code),'[]'::jsonb)
   FROM openerp.dimensions d WHERE d.book_id=p_scope->>'bookId'));
END $$;

REVOKE ALL ON FUNCTION openerp.dimension_identity_guard(), openerp.save_dimension(text,jsonb,text,jsonb),
 openerp.save_dimension_value(text,jsonb,text,jsonb), openerp.list_dimensions(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.save_dimension(text,jsonb,text,jsonb),
 openerp.save_dimension_value(text,jsonb,text,jsonb), openerp.list_dimensions(text,jsonb) TO openerp_runtime;
