ALTER TABLE openerp.dimensions
 ADD COLUMN current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision BETWEEN 1 AND 100000);
ALTER TABLE openerp.dimension_values
 ADD COLUMN current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision BETWEEN 1 AND 100000);

CREATE TABLE openerp.dimension_revisions (
 book_id text NOT NULL,
 code text NOT NULL,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 100000),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 effective_from date NOT NULL,
 effective_to date,
 archived_at timestamptz,
 PRIMARY KEY (book_id, code, revision),
 FOREIGN KEY (book_id, code) REFERENCES openerp.dimensions(book_id, code),
 CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE TABLE openerp.dimension_value_revisions (
 book_id text NOT NULL,
 dimension_code text NOT NULL,
 code text NOT NULL,
 revision integer NOT NULL CHECK (revision BETWEEN 1 AND 100000),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 effective_from date NOT NULL,
 effective_to date,
 archived_at timestamptz,
 PRIMARY KEY (book_id, dimension_code, code, revision),
 FOREIGN KEY (book_id, dimension_code, code) REFERENCES openerp.dimension_values(book_id, dimension_code, code),
 CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

INSERT INTO openerp.dimension_revisions(book_id, code, revision, name, effective_from, effective_to, archived_at)
 SELECT book_id, code, 1, name, effective_from, effective_to, archived_at FROM openerp.dimensions;
INSERT INTO openerp.dimension_value_revisions(book_id, dimension_code, code, revision, name, effective_from, effective_to, archived_at)
 SELECT book_id, dimension_code, code, 1, name, effective_from, effective_to, archived_at FROM openerp.dimension_values;

CREATE TRIGGER immutable_dimension_revisions
 BEFORE UPDATE OR DELETE ON openerp.dimension_revisions
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_dimension_value_revisions
 BEFORE UPDATE OR DELETE ON openerp.dimension_value_revisions
 FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

ALTER TABLE openerp.dimensions ADD CONSTRAINT dimension_current_revision_fk
 FOREIGN KEY (book_id, code, current_revision) REFERENCES openerp.dimension_revisions(book_id, code, revision)
 DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.dimension_values ADD CONSTRAINT dimension_value_current_revision_fk
 FOREIGN KEY (book_id, dimension_code, code, current_revision)
 REFERENCES openerp.dimension_value_revisions(book_id, dimension_code, code, revision)
 DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION openerp.save_dimension(p_token text, p_scope jsonb, p_key text, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_result jsonb; v_from date; v_to date; v_current integer; v_expected integer; v_revision integer;
BEGIN
 v_actor := openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior := openerp.replay(p_scope->>'bookId',p_key,v_actor,'save_dimension',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['code','expectedRevision','name','effectiveFrom','effectiveTo','archived']);
 IF jsonb_typeof(p_input->'archived') IS DISTINCT FROM 'boolean' THEN
  PERFORM openerp.fail('InvalidJournal','Archived must be a boolean.'); END IF;
 IF jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number'
  OR (p_input->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,4})$' THEN
  PERFORM openerp.fail('InvalidJournal','Supply the dimension revision being replaced.'); END IF;
 v_expected := (p_input->>'expectedRevision')::integer;
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
 SELECT current_revision INTO v_current FROM openerp.dimensions
  WHERE book_id=p_scope->>'bookId' AND code=p_input->>'code' FOR UPDATE;
 IF coalesce(v_current,0)<>v_expected THEN
  PERFORM openerp.fail('StaleDependency','Read the current dimension revision before saving.'); END IF;
 v_revision := v_expected+1;
 IF v_expected=0 THEN
  INSERT INTO openerp.dimensions(book_id,code,name,effective_from,effective_to,archived_at,current_revision)
  VALUES(p_scope->>'bookId',p_input->>'code',p_input->>'name',v_from,v_to,
   CASE WHEN (p_input->>'archived')::boolean THEN statement_timestamp() END,v_revision);
 ELSE
  UPDATE openerp.dimensions SET name=p_input->>'name',effective_from=v_from,effective_to=v_to,
   archived_at=CASE WHEN (p_input->>'archived')::boolean
    THEN coalesce(openerp.dimensions.archived_at,statement_timestamp()) ELSE NULL END,
   current_revision=v_revision
  WHERE book_id=p_scope->>'bookId' AND code=p_input->>'code';
 END IF;
 INSERT INTO openerp.dimension_revisions(book_id,code,revision,name,effective_from,effective_to,archived_at)
 VALUES(p_scope->>'bookId',p_input->>'code',v_revision,p_input->>'name',v_from,v_to,
  CASE WHEN (p_input->>'archived')::boolean THEN statement_timestamp() END);
 SELECT jsonb_build_object('scope',p_scope,'code',code,'name',name,'effectiveFrom',effective_from,
  'effectiveTo',effective_to,'archived',archived_at IS NOT NULL,'revision',current_revision) INTO v_result
 FROM openerp.dimensions WHERE book_id=p_scope->>'bookId' AND code=p_input->>'code';
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'save_dimension',p_input,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.save_dimension_value(p_token text, p_scope jsonb, p_key text, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_prior jsonb; v_result jsonb; v_from date; v_to date; v_current integer; v_expected integer; v_revision integer;
BEGIN
 v_actor := openerp.authorize(p_token,p_scope,true);
 PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
 v_prior := openerp.replay(p_scope->>'bookId',p_key,v_actor,'save_dimension_value',p_input);
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 PERFORM openerp.commerce_exact_object(p_input,ARRAY['dimensionCode','code','expectedRevision','name','effectiveFrom','effectiveTo','archived']);
 IF jsonb_typeof(p_input->'archived') IS DISTINCT FROM 'boolean' THEN
  PERFORM openerp.fail('InvalidJournal','Archived must be a boolean.'); END IF;
 IF jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number'
  OR (p_input->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,4})$' THEN
  PERFORM openerp.fail('InvalidJournal','Supply the dimension value revision being replaced.'); END IF;
 v_expected := (p_input->>'expectedRevision')::integer;
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
  PERFORM openerp.fail('InvalidJournal','Invalid dimension value code, name or date range.'); END IF;
 IF jsonb_typeof(p_input->'dimensionCode') IS DISTINCT FROM 'string'
  OR coalesce(p_input->>'dimensionCode','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' THEN
  PERFORM openerp.fail('InvalidJournal','Supply a dimension code.'); END IF;
 IF NOT EXISTS(SELECT FROM openerp.dimensions WHERE book_id=p_scope->>'bookId' AND code=p_input->>'dimensionCode') THEN
  PERFORM openerp.fail('NotFound','Dimension was not found in this book.'); END IF;
 SELECT current_revision INTO v_current FROM openerp.dimension_values
  WHERE book_id=p_scope->>'bookId' AND dimension_code=p_input->>'dimensionCode' AND code=p_input->>'code' FOR UPDATE;
 IF coalesce(v_current,0)<>v_expected THEN
  PERFORM openerp.fail('StaleDependency','Read the current dimension value revision before saving.'); END IF;
 v_revision := v_expected+1;
 IF v_expected=0 THEN
  INSERT INTO openerp.dimension_values(book_id,dimension_code,code,name,effective_from,effective_to,archived_at,current_revision)
  VALUES(p_scope->>'bookId',p_input->>'dimensionCode',p_input->>'code',p_input->>'name',v_from,v_to,
   CASE WHEN (p_input->>'archived')::boolean THEN statement_timestamp() END,v_revision);
 ELSE
  UPDATE openerp.dimension_values SET name=p_input->>'name',effective_from=v_from,effective_to=v_to,
   archived_at=CASE WHEN (p_input->>'archived')::boolean
    THEN coalesce(openerp.dimension_values.archived_at,statement_timestamp()) ELSE NULL END,
   current_revision=v_revision
  WHERE book_id=p_scope->>'bookId' AND dimension_code=p_input->>'dimensionCode' AND code=p_input->>'code';
 END IF;
 INSERT INTO openerp.dimension_value_revisions(book_id,dimension_code,code,revision,name,effective_from,effective_to,archived_at)
 VALUES(p_scope->>'bookId',p_input->>'dimensionCode',p_input->>'code',v_revision,p_input->>'name',v_from,v_to,
  CASE WHEN (p_input->>'archived')::boolean THEN statement_timestamp() END);
 SELECT jsonb_build_object('scope',p_scope,'dimensionCode',dimension_code,'code',code,'name',name,
  'effectiveFrom',effective_from,'effectiveTo',effective_to,'archived',archived_at IS NOT NULL,'revision',current_revision) INTO v_result
 FROM openerp.dimension_values WHERE book_id=p_scope->>'bookId' AND dimension_code=p_input->>'dimensionCode' AND code=p_input->>'code';
 RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'save_dimension_value',p_input,v_result);
END $$;

CREATE OR REPLACE FUNCTION openerp.list_dimensions(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
 PERFORM openerp.authorize(p_token,p_scope);
 RETURN jsonb_build_object('scope',p_scope,'dimensions',
  (SELECT coalesce(jsonb_agg(jsonb_build_object('code',d.code,'name',d.name,'effectiveFrom',d.effective_from,
   'effectiveTo',d.effective_to,'archived',d.archived_at IS NOT NULL,'revision',d.current_revision,'revisions',
   (SELECT coalesce(jsonb_agg(jsonb_build_object('revision',r.revision,'name',r.name,'effectiveFrom',r.effective_from,
    'effectiveTo',r.effective_to,'archived',r.archived_at IS NOT NULL) ORDER BY r.revision),'[]'::jsonb)
    FROM openerp.dimension_revisions r WHERE r.book_id=d.book_id AND r.code=d.code),'values',
   (SELECT coalesce(jsonb_agg(jsonb_build_object('code',v.code,'name',v.name,'effectiveFrom',v.effective_from,
    'effectiveTo',v.effective_to,'archived',v.archived_at IS NOT NULL,'revision',v.current_revision,'revisions',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('revision',rv.revision,'name',rv.name,'effectiveFrom',rv.effective_from,
     'effectiveTo',rv.effective_to,'archived',rv.archived_at IS NOT NULL) ORDER BY rv.revision),'[]'::jsonb)
     FROM openerp.dimension_value_revisions rv WHERE rv.book_id=v.book_id AND rv.dimension_code=v.dimension_code AND rv.code=v.code))
    ORDER BY v.code),'[]'::jsonb)
    FROM openerp.dimension_values v WHERE v.book_id=d.book_id AND v.dimension_code=d.code)) ORDER BY d.code),'[]'::jsonb)
   FROM openerp.dimensions d WHERE d.book_id=p_scope->>'bookId'));
END $$;

REVOKE ALL ON openerp.dimension_revisions, openerp.dimension_value_revisions FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.save_dimension(text,jsonb,text,jsonb),
 openerp.save_dimension_value(text,jsonb,text,jsonb), openerp.list_dimensions(text,jsonb) FROM PUBLIC, openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.save_dimension(text,jsonb,text,jsonb),
 openerp.save_dimension_value(text,jsonb,text,jsonb), openerp.list_dimensions(text,jsonb) TO openerp_runtime;
