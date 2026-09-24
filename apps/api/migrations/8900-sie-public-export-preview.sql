-- Bounded public SIE 4E review: permit 4,000 retained records and 500 vouchers.
-- Verified official sample is 3,490 records, 295 vouchers and <1 MiB normalized JSON.
-- Earlier preview bytes/digests and staging/financial admission rules are unchanged.
CREATE OR REPLACE FUNCTION openerp.capture_sie_source(p_token text,p_scope jsonb,p_key text,p_occurrence text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE a text; previous jsonb; request jsonb:=jsonb_build_object('occurrenceId',p_occurrence,'preview',p_body);
  source openerp.intake_occurrences; result jsonb; next_revision integer;
BEGIN
  a:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  previous:=openerp.replay(p_scope->>'bookId',p_key,a,'capture_sie_source',request);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO source FROM openerp.intake_occurrences o WHERE o.book_id=p_scope->>'bookId' AND o.id=p_occurrence;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Original source occurrence was not found.'); END IF;
  IF p_body->>'sourceSha256' IS DISTINCT FROM source.sha256
    OR p_body->>'encoding' NOT IN ('utf-8','windows-1252','ibm437')
    OR p_body->>'profile' IS DISTINCT FROM 'sie4_source_v1'
    OR jsonb_typeof(p_body->'records') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_body->'vouchers') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_body->'controls') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_body->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_body->'ready') IS DISTINCT FROM 'boolean'
    OR jsonb_array_length(p_body->'records')>4000
    OR jsonb_array_length(p_body->'vouchers')>500
    OR octet_length(p_body::text)>1048576
    THEN PERFORM openerp.fail('UnsupportedProfile','The selected SIE4 profile or bounded complete interpretation is unsupported. No records were truncated.'); END IF;
  IF EXISTS(SELECT FROM openerp.sie_source_runs r JOIN openerp.sie_source_plans p ON (p.book_id,p.id)=(r.book_id,r.plan_id)
    JOIN openerp.sie_source_previews v ON (v.book_id,v.id)=(p.book_id,p.preview_id)
    WHERE v.book_id=source.book_id AND v.occurrence_id=source.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This occurrence already has a staged run; retained source history cannot be reinterpreted in place.'); END IF;
  SELECT coalesce(max(p.ordinal),0)+1 INTO next_revision FROM openerp.sie_source_previews p
    WHERE p.book_id=source.book_id AND p.occurrence_id=source.id;
  IF next_revision>50 THEN PERFORM openerp.fail('UnsupportedProfile','The retained occurrence has reached its complete SIE preview limit.'); END IF;
  result:=p_body||jsonb_build_object('id',openerp.new_id('siepreview'),'scope',p_scope,'occurrenceId',p_occurrence,
    'createdBy',a,'ordinal',next_revision,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  result:=result||jsonb_build_object('digest',openerp.digest(result),
    'receipt',jsonb_build_object('key',p_key,'operation','capture_sie_source','actorId',a));
  INSERT INTO openerp.sie_source_previews VALUES(source.book_id,result->>'id',source.id,next_revision,result);
  RETURN openerp.save_command(source.book_id,p_key,a,'capture_sie_source',request,result);
END $$;
