-- Immutable reparse lineage for unadmitted retained CSV interpretations.
-- Existing source bytes, previews, approvals and admitted bank observations stay unchanged.
CREATE TABLE openerp.intake_preview_supersessions (
  book_id text NOT NULL,
  previous_preview_id text NOT NULL,
  replacement_preview_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY(book_id,previous_preview_id),
  UNIQUE(book_id,replacement_preview_id),
  FOREIGN KEY(book_id,previous_preview_id) REFERENCES openerp.intake_previews(book_id,id),
  FOREIGN KEY(book_id,replacement_preview_id) REFERENCES openerp.intake_previews(book_id,id),
  CHECK(previous_preview_id<>replacement_preview_id)
);
CREATE TRIGGER immutable_intake_preview_supersessions
  BEFORE UPDATE OR DELETE ON openerp.intake_preview_supersessions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- All intake writes serialize on the book lock. Guard both existing approval and
-- admission authorities without changing sealed previews or historical receipts.
CREATE FUNCTION openerp.intake_require_unsuperseded_preview() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF EXISTS(SELECT FROM openerp.intake_preview_supersessions s
    WHERE s.book_id=NEW.book_id AND s.previous_preview_id=NEW.preview_id) THEN
    PERFORM openerp.fail('StaleDependency','This preview was superseded. Review and approve its replacement.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER intake_approval_requires_unsuperseded_preview
  BEFORE INSERT ON openerp.intake_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.intake_require_unsuperseded_preview();
CREATE TRIGGER intake_admission_requires_unsuperseded_preview
  BEFORE INSERT ON openerp.intake_admissions
  FOR EACH ROW EXECUTE FUNCTION openerp.intake_require_unsuperseded_preview();

CREATE FUNCTION openerp.reparse_source_csv(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_request jsonb:=jsonb_build_object('previewId',id,'input',input);
  v_previous jsonb; v_preview openerp.intake_previews; v_replacement jsonb;
  v_supersession jsonb; v_body jsonb;
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'reparse_source_csv',v_request);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Supply an exact preview digest/version, replacement mapping and rationale.');
  END IF;
  IF input->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(input->'digest') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(input->>'rationale')),0) NOT BETWEEN 1 AND 2000
    OR length(input->>'rationale')>2000
    OR jsonb_typeof(input->'mapping') IS DISTINCT FROM 'object'
    OR EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN ('digest','version','rationale','mapping')) THEN
    PERFORM openerp.fail('InvalidJournal','Supply an exact preview digest/version, replacement mapping and rationale.');
  END IF;
  SELECT * INTO v_preview FROM openerp.intake_previews p
    WHERE p.book_id=scope->>'bookId' AND p.id=reparse_source_csv.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
  IF input->>'digest' IS DISTINCT FROM v_preview.body->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','The reparse must identify the exact retained preview digest.');
  END IF;
  IF EXISTS(SELECT FROM openerp.intake_admissions a
    WHERE a.book_id=v_preview.book_id AND a.occurrence_id=v_preview.occurrence_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','An admitted source interpretation cannot be replaced by reparse.');
  END IF;
  IF EXISTS(SELECT FROM openerp.intake_preview_supersessions s
    WHERE s.book_id=v_preview.book_id AND s.previous_preview_id=v_preview.id) THEN
    PERFORM openerp.fail('StaleDependency','This preview already has a replacement. Recover its revision history.');
  END IF;
  -- The existing parser owns byte access, profile bounds, mapping and diagnostics.
  -- Its receipt and this lineage edge commit together, including blocked results.
  v_replacement:=openerp.preview_source_csv(token,scope,openerp.new_id('intakereparse'),
    v_preview.occurrence_id,input->'mapping');
  v_supersession:=jsonb_build_object(
    'occurrenceId',v_preview.occurrence_id,'previousPreviewId',v_preview.id,
    'previousDigest',v_preview.body->>'digest','replacementPreviewId',v_replacement->>'id',
    'replacementDigest',v_replacement->>'digest','rationale',input->>'rationale',
    'actorId',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',key,'operation','reparse_source_csv','actorId',v_actor));
  INSERT INTO openerp.intake_preview_supersessions VALUES(
    v_preview.book_id,v_preview.id,v_replacement->>'id',v_supersession);
  v_body:=jsonb_build_object('preview',v_replacement,'supersession',v_supersession);
  RETURN openerp.save_command(v_preview.book_id,key,v_actor,'reparse_source_csv',v_request,v_body);
END $$;

CREATE FUNCTION openerp.get_source_revision_history(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previews jsonb; v_supersessions jsonb; v_approvals jsonb; v_admission jsonb;
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF NOT EXISTS(SELECT FROM openerp.intake_occurrences o
    WHERE o.book_id=scope->>'bookId' AND o.id=get_source_revision_history.id) THEN
    PERFORM openerp.fail('NotFound','The retained occurrence was not found in this book.');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'previewId',p.id,'digest',p.body->>'digest','ordinal',p.ordinal,
    'ready',p.body->'ready','createdAt',p.body->>'createdAt','createdBy',p.body->>'createdBy',
    'diagnosticCount',jsonb_array_length(p.body->'diagnostics'),
    'supersededByPreviewId',s.replacement_preview_id) ORDER BY p.ordinal),'[]'::jsonb)
    INTO v_previews FROM openerp.intake_previews p
    LEFT JOIN openerp.intake_preview_supersessions s ON s.book_id=p.book_id AND s.previous_preview_id=p.id
    WHERE p.book_id=scope->>'bookId' AND p.occurrence_id=get_source_revision_history.id;
  SELECT coalesce(jsonb_agg(s.body ORDER BY p.ordinal),'[]'::jsonb) INTO v_supersessions
    FROM openerp.intake_previews p JOIN openerp.intake_preview_supersessions s
      ON s.book_id=p.book_id AND s.previous_preview_id=p.id
    WHERE p.book_id=scope->>'bookId' AND p.occurrence_id=get_source_revision_history.id;
  -- At most one own approval per preview keeps recovery bounded by 50 previews.
  -- Include expired/superseded reviews as history, never as admission authority.
  SELECT coalesce(jsonb_agg(reviews.body ORDER BY reviews.ordinal),'[]'::jsonb) INTO v_approvals
    FROM (SELECT DISTINCT ON (p.id) p.ordinal,a.body
      FROM openerp.intake_previews p JOIN openerp.intake_approvals a
        ON a.book_id=p.book_id AND a.preview_id=p.id AND a.actor_id=v_actor
      WHERE p.book_id=scope->>'bookId' AND p.occurrence_id=get_source_revision_history.id
      ORDER BY p.id,a.expires_at DESC,a.id DESC) reviews;
  SELECT a.body INTO v_admission FROM openerp.intake_admissions a
    WHERE a.book_id=scope->>'bookId' AND a.occurrence_id=get_source_revision_history.id;
  RETURN jsonb_build_object('occurrenceId',id,'previews',v_previews,'supersessions',v_supersessions,
    'ownApprovals',v_approvals,'admission',v_admission);
END $$;

CREATE OR REPLACE FUNCTION openerp.get_source_preview(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_preview openerp.intake_previews; v_approval jsonb; v_admission jsonb; v_actor text; v_replacement text;
BEGIN
  v_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO v_preview FROM openerp.intake_previews p WHERE p.book_id=scope->>'bookId' AND p.id=get_source_preview.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
  SELECT s.replacement_preview_id INTO v_replacement FROM openerp.intake_preview_supersessions s
    WHERE s.book_id=v_preview.book_id AND s.previous_preview_id=v_preview.id;
  IF v_replacement IS NULL THEN
    SELECT a.body INTO v_approval FROM openerp.intake_approvals a WHERE a.book_id=v_preview.book_id AND a.preview_id=v_preview.id AND a.actor_id=v_actor AND a.expires_at>clock_timestamp() ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
  END IF;
  SELECT a.body INTO v_admission FROM openerp.intake_admissions a WHERE a.book_id=v_preview.book_id AND a.occurrence_id=v_preview.occurrence_id;
  RETURN jsonb_build_object('preview',v_preview.body,'approval',v_approval,'admission',v_admission,
    'supersededByPreviewId',v_replacement,
    'dependenciesCurrent',v_replacement IS NULL AND v_preview.body->'dependencies'=openerp.intake_dependencies(v_preview.book_id,v_preview.body->'mapping'->>'accountId'));
END $$;

REVOKE ALL ON TABLE openerp.intake_preview_supersessions FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.intake_require_unsuperseded_preview() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.reparse_source_csv(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_source_revision_history(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.reparse_source_csv(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_source_revision_history(text,jsonb,text) TO openerp_runtime;
-- get_source_preview retains its existing execute grant through CREATE OR REPLACE.
