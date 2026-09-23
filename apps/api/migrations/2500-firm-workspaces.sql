-- Firm coordination never confers financial authority. Book memberships remain explicit.
CREATE TABLE openerp.firms (
  id text PRIMARY KEY,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by text NOT NULL REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.firm_members (
  firm_id text NOT NULL REFERENCES openerp.firms(id),
  actor_id text NOT NULL REFERENCES openerp_auth."user"(id),
  role text NOT NULL CHECK(role IN ('admin','accountant')),
  active boolean NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  PRIMARY KEY(firm_id,actor_id)
);
CREATE INDEX firm_member_actor ON openerp.firm_members(actor_id,firm_id);
CREATE TABLE openerp.firm_clients (
  firm_id text NOT NULL REFERENCES openerp.firms(id),
  book_id text NOT NULL REFERENCES openerp.books(id),
  lead_id text REFERENCES openerp_auth."user"(id),
  next_review_on date,
  note text NOT NULL CHECK(length(note)<=2000),
  revision integer NOT NULL CHECK(revision>0),
  PRIMARY KEY(firm_id,book_id)
);
CREATE TABLE openerp.firm_commands (
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  key text NOT NULL,
  firm_id text NOT NULL REFERENCES openerp.firms(id),
  operation text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,key)
);
REVOKE ALL ON openerp.firms,openerp.firm_members,openerp.firm_clients,openerp.firm_commands FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.firm_actor(token text) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE actor text;
BEGIN
  actor:=openerp.authenticate(token);
  IF NOT EXISTS(SELECT FROM openerp_auth.session s WHERE s.token=firm_actor.token AND s.user_id=actor AND s.expires_at>clock_timestamp()) THEN
    PERFORM openerp.fail('Forbidden','Sign in with a human account to use firm workspaces.'); END IF;
  RETURN actor;
END $$;
CREATE FUNCTION openerp.firm_authorize(actor text, firm text, writing boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE member_role text;
BEGIN
  -- Take the final lock mode immediately; never upgrade a shared firm lock.
  IF writing THEN PERFORM 1 FROM openerp.firms WHERE id=firm FOR UPDATE;
  ELSE PERFORM 1 FROM openerp.firms WHERE id=firm FOR SHARE; END IF;
  SELECT m.role INTO member_role FROM openerp.firm_members m WHERE m.firm_id=firm AND m.actor_id=actor AND m.active;
  IF member_role IS NULL OR (writing AND member_role<>'admin') THEN
    PERFORM openerp.fail('Forbidden','You do not have access to this firm action.'); END IF;
  RETURN member_role;
END $$;
CREATE FUNCTION openerp.firm_replay(actor text, firm text, key text, operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE previous openerp.firm_commands;
BEGIN
  IF key IS NULL OR key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN PERFORM openerp.fail('InvalidJournal','Supply a valid request key.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('firm-command:'||actor||':'||key,0));
  SELECT * INTO previous FROM openerp.firm_commands c WHERE c.actor_id=actor AND c.key=firm_replay.key;
  IF FOUND THEN
    IF previous.firm_id IS DISTINCT FROM firm OR previous.operation<>operation OR previous.payload IS DISTINCT FROM payload THEN
      PERFORM openerp.fail('IdempotencyConflict','This request key was already used for different details.'); END IF;
    RETURN previous.result;
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.firm_record(actor text, firm text, key text, operation text, payload jsonb, revision integer) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE result jsonb:=jsonb_build_object('firmId',firm,'revision',revision);
BEGIN
  INSERT INTO openerp.firm_commands(actor_id,key,firm_id,operation,payload,result) VALUES(actor,key,firm,operation,payload,result);
  RETURN result;
END $$;
CREATE FUNCTION openerp.firm_list(token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); result jsonb;
BEGIN
  PERFORM f.id FROM openerp.firms f JOIN openerp.firm_members m ON m.firm_id=f.id WHERE m.actor_id=actor AND m.active ORDER BY f.id FOR SHARE OF f;
  IF (SELECT count(*) FROM openerp.firm_members m WHERE m.actor_id=actor AND m.active)>100 THEN
    PERFORM openerp.fail('Unavailable','This account exceeds the supported 100 firms.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'role',m.role) ORDER BY f.name,f.id),'[]') INTO result
    FROM openerp.firms f JOIN openerp.firm_members m ON m.firm_id=f.id WHERE m.actor_id=actor AND m.active;
  RETURN result;
END $$;
CREATE FUNCTION openerp.firm_get(token text, firm text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); member_role text; team jsonb; clients jsonb;
BEGIN
  member_role:=openerp.firm_authorize(actor,firm);
  -- Hold current client-book grants while producing this observation. No book writer barrier.
  PERFORM m.book_id FROM openerp.memberships m JOIN openerp.firm_clients c ON c.book_id=m.book_id
    WHERE c.firm_id=firm ORDER BY m.book_id,m.actor_id FOR SHARE OF m;
  SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',m.actor_id,'name',u.name,'email',u.email,
    'role',m.role,'active',m.active,'revision',m.revision) ORDER BY m.active DESC,u.name,u.id),'[]') INTO team
    FROM openerp.firm_members m JOIN openerp_auth."user" u ON u.id=m.actor_id WHERE m.firm_id=firm;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'book',jsonb_build_object('entityId',b.entity_id,'id',b.id,'name',b.name,'currency',b.currency,'profile',b.profile,'role',m.role,'sequence',b.committed_sequence::text),
    'leadId',c.lead_id,'leadAvailable',EXISTS(SELECT FROM openerp.firm_members fm JOIN openerp.memberships bm ON bm.actor_id=fm.actor_id
      WHERE fm.firm_id=firm AND fm.active AND fm.actor_id=c.lead_id AND bm.book_id=b.id),
    'eligibleLeadIds',(SELECT coalesce(jsonb_agg(fm.actor_id ORDER BY fm.actor_id),'[]') FROM openerp.firm_members fm
      JOIN openerp.memberships bm ON bm.actor_id=fm.actor_id WHERE fm.firm_id=firm AND fm.active AND bm.book_id=b.id),
    'nextReviewOn',c.next_review_on::text,'note',c.note,'revision',c.revision) ORDER BY b.name,b.id),'[]') INTO clients
    FROM openerp.firm_clients c JOIN openerp.books b ON b.id=c.book_id
    JOIN openerp.memberships m ON m.book_id=b.id AND m.actor_id=actor WHERE c.firm_id=firm;
  RETURN jsonb_build_object('firm',jsonb_build_object('id',firm,'name',(SELECT name FROM openerp.firms WHERE id=firm),'role',member_role),
    'actorId',actor,'members',team,'clients',clients);
END $$;
CREATE FUNCTION openerp.firm_create(token text, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); firm text; previous openerp.firm_commands;
BEGIN
  IF key IS NULL OR key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN PERFORM openerp.fail('InvalidJournal','Supply a valid request key.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('firm-command:'||actor||':'||key,0));
  SELECT * INTO previous FROM openerp.firm_commands c WHERE c.actor_id=actor AND c.key=firm_create.key;
  IF FOUND THEN
    IF previous.operation<>'create' OR previous.payload IS DISTINCT FROM payload THEN PERFORM openerp.fail('IdempotencyConflict','This request key was already used.'); END IF;
    -- Do not take a firm lock after the key lock; no protected client data is replayed.
    RETURN previous.result;
  END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR jsonb_typeof(payload->'name') IS DISTINCT FROM 'string' OR
    length(btrim(payload->>'name')) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k<>'name') THEN
    PERFORM openerp.fail('InvalidJournal','Enter a firm name of 1–100 characters.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('firm-create:'||actor,0));
  IF (SELECT count(*) FROM openerp.firms f WHERE f.created_by=actor)>=100 THEN PERFORM openerp.fail('InvalidJournal','This account has reached the limit of 100 created firms.'); END IF;
  firm:='firm_'||replace(gen_random_uuid()::text,'-','');
  INSERT INTO openerp.firms(id,name,created_by) VALUES(firm,btrim(payload->>'name'),actor);
  INSERT INTO openerp.firm_members VALUES(firm,actor,'admin',true,1);
  RETURN openerp.firm_record(actor,firm,key,'create',payload,1);
END $$;
CREATE FUNCTION openerp.firm_save_client(token text, firm text, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); result jsonb; current_revision integer; next_revision integer;
BEGIN
  PERFORM openerp.firm_authorize(actor,firm,true);
  PERFORM openerp.authorize(token,payload->'scope',true);
  result:=openerp.firm_replay(actor,firm,key,'save_client',payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR
    EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('scope','leadId','nextReviewOn','note','expectedRevision')) OR
    jsonb_typeof(payload->'note') IS DISTINCT FROM 'string' OR length(payload->>'note')>2000 OR
    jsonb_typeof(payload->'expectedRevision') IS DISTINCT FROM 'number' OR (payload->>'expectedRevision') !~ '^[0-9]{1,9}$' OR
    coalesce(jsonb_typeof(payload->'leadId'),'missing') NOT IN ('null','string') OR
    coalesce(jsonb_typeof(payload->'nextReviewOn'),'missing') NOT IN ('null','string') THEN
    PERFORM openerp.fail('InvalidJournal','Supply client details and the current revision.'); END IF;
  IF payload->>'leadId' IS NOT NULL THEN
    PERFORM 1 FROM openerp.memberships m JOIN openerp.firm_members fm ON fm.actor_id=m.actor_id
      WHERE m.book_id=payload->'scope'->>'bookId' AND fm.firm_id=firm AND fm.active AND fm.actor_id=payload->>'leadId' FOR SHARE OF m;
    IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Choose a current team member with access to this company.'); END IF;
  END IF;
  IF payload->>'nextReviewOn' IS NOT NULL THEN
    IF payload->>'nextReviewOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN PERFORM openerp.fail('InvalidJournal','Enter a valid review date.'); END IF;
    BEGIN PERFORM (payload->>'nextReviewOn')::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN PERFORM openerp.fail('InvalidJournal','Enter a valid review date.'); END;
  END IF;
  SELECT coalesce((SELECT c.revision FROM openerp.firm_clients c WHERE c.firm_id=firm AND c.book_id=payload->'scope'->>'bookId'),0) INTO current_revision;
  IF current_revision<>(payload->>'expectedRevision')::integer THEN PERFORM openerp.fail('StaleDependency','This client changed. Reload its details before saving.'); END IF;
  IF current_revision=0 AND (SELECT count(*) FROM openerp.firm_clients c WHERE c.firm_id=firm)>=200 THEN PERFORM openerp.fail('InvalidJournal','This firm supports up to 200 client books.'); END IF;
  UPDATE openerp.firms SET revision=revision+1 WHERE id=firm RETURNING revision INTO next_revision;
  INSERT INTO openerp.firm_clients VALUES(firm,payload->'scope'->>'bookId',payload->>'leadId',(payload->>'nextReviewOn')::date,payload->>'note',next_revision)
    ON CONFLICT(firm_id,book_id) DO UPDATE SET lead_id=EXCLUDED.lead_id,next_review_on=EXCLUDED.next_review_on,note=EXCLUDED.note,revision=EXCLUDED.revision;
  RETURN openerp.firm_record(actor,firm,key,'save_client',payload,next_revision);
END $$;
CREATE FUNCTION openerp.firm_remove_client(token text, firm text, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); result jsonb; current_revision integer; next_revision integer;
BEGIN
  PERFORM openerp.firm_authorize(actor,firm,true);
  PERFORM openerp.authorize(token,payload->'scope',true);
  result:=openerp.firm_replay(actor,firm,key,'remove_client',payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR
    EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('scope','expectedRevision')) OR
    jsonb_typeof(payload->'expectedRevision') IS DISTINCT FROM 'number' OR (payload->>'expectedRevision') !~ '^[0-9]{1,9}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the client and current revision.'); END IF;
  SELECT c.revision INTO current_revision FROM openerp.firm_clients c WHERE c.firm_id=firm AND c.book_id=payload->'scope'->>'bookId';
  IF current_revision IS NULL OR current_revision<>(payload->>'expectedRevision')::integer THEN PERFORM openerp.fail('StaleDependency','This client changed. Reload its details.'); END IF;
  DELETE FROM openerp.firm_clients c WHERE c.firm_id=firm AND c.book_id=payload->'scope'->>'bookId';
  UPDATE openerp.firms SET revision=revision+1 WHERE id=firm RETURNING revision INTO next_revision;
  RETURN openerp.firm_record(actor,firm,key,'remove_client',payload,next_revision);
END $$;
CREATE FUNCTION openerp.firm_save_member(token text, firm text, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); result jsonb; target text; current_member openerp.firm_members; next_revision integer;
BEGIN
  PERFORM openerp.firm_authorize(actor,firm,true);
  result:=openerp.firm_replay(actor,firm,key,'save_member',payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR
    EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('email','role','active','expectedRevision')) OR
    jsonb_typeof(payload->'email') IS DISTINCT FROM 'string' OR length(payload->>'email') NOT BETWEEN 3 AND 254 OR
    coalesce(payload->>'role','') NOT IN ('admin','accountant') OR jsonb_typeof(payload->'active') IS DISTINCT FROM 'boolean' OR
    jsonb_typeof(payload->'expectedRevision') IS DISTINCT FROM 'number' OR (payload->>'expectedRevision') !~ '^[0-9]{1,9}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the member, firm role and current revision.'); END IF;
  SELECT u.id INTO target FROM openerp_auth."user" u WHERE lower(u.email)=lower(btrim(payload->>'email'));
  IF target IS NULL THEN PERFORM openerp.fail('InvalidJournal','This person needs a provisioned sign-in account before joining the firm.'); END IF;
  SELECT * INTO current_member FROM openerp.firm_members m WHERE m.firm_id=firm AND m.actor_id=target;
  IF coalesce(current_member.revision,0)<>(payload->>'expectedRevision')::integer THEN PERFORM openerp.fail('StaleDependency','This membership changed. Reload the team before saving.'); END IF;
  IF current_member.active AND current_member.role='admin' AND (payload->>'role'<>'admin' OR NOT (payload->>'active')::boolean) AND
    (SELECT count(*) FROM openerp.firm_members m WHERE m.firm_id=firm AND m.active AND m.role='admin')<=1 THEN
    PERFORM openerp.fail('InvalidJournal','Keep at least one active firm administrator.'); END IF;
  IF current_member.actor_id IS NULL AND (SELECT count(*) FROM openerp.firm_members m WHERE m.firm_id=firm)>=100 THEN
    PERFORM openerp.fail('InvalidJournal','This firm supports up to 100 registered team members.'); END IF;
  UPDATE openerp.firms SET revision=revision+1 WHERE id=firm RETURNING revision INTO next_revision;
  INSERT INTO openerp.firm_members VALUES(firm,target,payload->>'role',(payload->>'active')::boolean,next_revision)
    ON CONFLICT(firm_id,actor_id) DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active,revision=EXCLUDED.revision;
  RETURN openerp.firm_record(actor,firm,key,'save_member',payload,next_revision);
END $$;
GRANT EXECUTE ON FUNCTION openerp.firm_list(text),openerp.firm_get(text,text),openerp.firm_create(text,text,jsonb),
  openerp.firm_save_client(text,text,text,jsonb),openerp.firm_remove_client(text,text,text,jsonb),openerp.firm_save_member(text,text,text,jsonb) TO openerp_runtime;
