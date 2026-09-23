-- Client handoffs require current book operation authority. Linking and unlinking remain firm administration.
CREATE OR REPLACE FUNCTION openerp.firm_get(token text, firm text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); member_role text; team jsonb; clients jsonb;
BEGIN
  member_role:=openerp.firm_authorize(actor,firm);
  -- Hold current client-book grants while producing this observation. No book writer barrier.
  PERFORM m.book_id FROM openerp.memberships m JOIN openerp.firm_clients c ON c.book_id=m.book_id
    WHERE c.firm_id=firm ORDER BY m.book_id,m.actor_id FOR SHARE OF m;
  SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',m.actor_id,'name',u.name,'email',u.email,
    'role',m.role,'active',m.active,'revision',m.revision,'signInEnabled',NOT EXISTS(SELECT FROM openerp.identity_admissions ia WHERE ia.actor_id=m.actor_id AND NOT ia.enabled)) ORDER BY m.active DESC,u.name,u.id),'[]') INTO team
    FROM openerp.firm_members m JOIN openerp_auth."user" u ON u.id=m.actor_id WHERE m.firm_id=firm;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'book',jsonb_build_object('entityId',b.entity_id,'id',b.id,'name',b.name,'currency',b.currency,'profile',b.profile,'role',m.role,'sequence',b.committed_sequence::text),
    'leadId',c.lead_id,'leadAvailable',EXISTS(SELECT FROM openerp.firm_members fm JOIN openerp.memberships bm ON bm.actor_id=fm.actor_id
      WHERE fm.firm_id=firm AND fm.active AND NOT EXISTS(SELECT FROM openerp.identity_admissions ia WHERE ia.actor_id=fm.actor_id AND NOT ia.enabled) AND fm.actor_id=c.lead_id AND bm.book_id=b.id),
    'eligibleLeadIds',(SELECT coalesce(jsonb_agg(fm.actor_id ORDER BY fm.actor_id),'[]') FROM openerp.firm_members fm
      JOIN openerp.memberships bm ON bm.actor_id=fm.actor_id WHERE fm.firm_id=firm AND fm.active AND NOT EXISTS(SELECT FROM openerp.identity_admissions ia WHERE ia.actor_id=fm.actor_id AND NOT ia.enabled) AND bm.book_id=b.id),
    'nextReviewOn',c.next_review_on::text,'note',c.note,'revision',c.revision) ORDER BY b.name,b.id),'[]') INTO clients
    FROM openerp.firm_clients c JOIN openerp.books b ON b.id=c.book_id
    JOIN openerp.memberships m ON m.book_id=b.id AND m.actor_id=actor WHERE c.firm_id=firm;
  RETURN jsonb_build_object('firm',jsonb_build_object('id',firm,'name',(SELECT name FROM openerp.firms WHERE id=firm),'role',member_role),
    'actorId',actor,'members',team,'clients',clients);
END $$;

CREATE OR REPLACE FUNCTION openerp.firm_save_client(token text, firm text, key text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text:=openerp.firm_actor(token); result jsonb; current_revision integer; next_revision integer; member_role text;
BEGIN
  PERFORM 1 FROM openerp.firms WHERE id=firm FOR UPDATE;
  member_role:=openerp.firm_authorize(actor,firm);
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
      WHERE m.book_id=payload->'scope'->>'bookId' AND fm.firm_id=firm AND fm.active AND NOT EXISTS(SELECT FROM openerp.identity_admissions ia WHERE ia.actor_id=fm.actor_id AND NOT ia.enabled) AND fm.actor_id=payload->>'leadId' FOR SHARE OF m;
    IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Choose a current team member with access to this company.'); END IF;
  END IF;
  IF payload->>'nextReviewOn' IS NOT NULL THEN
    IF payload->>'nextReviewOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN PERFORM openerp.fail('InvalidJournal','Enter a valid review date.'); END IF;
    BEGIN PERFORM (payload->>'nextReviewOn')::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN PERFORM openerp.fail('InvalidJournal','Enter a valid review date.'); END;
  END IF;
  SELECT coalesce((SELECT c.revision FROM openerp.firm_clients c WHERE c.firm_id=firm AND c.book_id=payload->'scope'->>'bookId'),0) INTO current_revision;
  IF current_revision<>(payload->>'expectedRevision')::integer THEN PERFORM openerp.fail('StaleDependency','This client changed. Reload its details before saving.'); END IF;
  IF current_revision=0 AND member_role<>'admin' THEN PERFORM openerp.fail('Forbidden','Only a firm administrator can link a new client.'); END IF;
  IF current_revision=0 AND (SELECT count(*) FROM openerp.firm_clients c WHERE c.firm_id=firm)>=200 THEN PERFORM openerp.fail('InvalidJournal','This firm supports up to 200 client books.'); END IF;
  UPDATE openerp.firms SET revision=revision+1 WHERE id=firm RETURNING revision INTO next_revision;
  INSERT INTO openerp.firm_clients VALUES(firm,payload->'scope'->>'bookId',payload->>'leadId',(payload->>'nextReviewOn')::date,payload->>'note',next_revision)
    ON CONFLICT(firm_id,book_id) DO UPDATE SET lead_id=EXCLUDED.lead_id,next_review_on=EXCLUDED.next_review_on,note=EXCLUDED.note,revision=EXCLUDED.revision;
  RETURN openerp.firm_record(actor,firm,key,'save_client',payload,next_revision);
END $$;

CREATE OR REPLACE FUNCTION openerp.firm_save_member(token text, firm text, key text, payload jsonb) RETURNS jsonb
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
  IF (payload->>'active')::boolean AND EXISTS(SELECT FROM openerp.identity_admissions ia WHERE ia.actor_id=target AND NOT ia.enabled) THEN PERFORM openerp.fail('InvalidJournal','This sign-in account is disabled.'); END IF;
  SELECT * INTO current_member FROM openerp.firm_members m WHERE m.firm_id=firm AND m.actor_id=target;
  IF coalesce(current_member.revision,0)<>(payload->>'expectedRevision')::integer THEN PERFORM openerp.fail('StaleDependency','This membership changed. Reload the team before saving.'); END IF;
  IF current_member.active AND current_member.role='admin' AND (payload->>'role'<>'admin' OR NOT (payload->>'active')::boolean) AND
    (SELECT count(*) FROM openerp.firm_members m WHERE m.firm_id=firm AND m.active AND m.role='admin' AND NOT EXISTS(SELECT FROM openerp.identity_admissions ia WHERE ia.actor_id=m.actor_id AND NOT ia.enabled))<=1 THEN
    PERFORM openerp.fail('InvalidJournal','Keep at least one active firm administrator.'); END IF;
  IF current_member.actor_id IS NULL AND (SELECT count(*) FROM openerp.firm_members m WHERE m.firm_id=firm)>=100 THEN
    PERFORM openerp.fail('InvalidJournal','This firm supports up to 100 registered team members.'); END IF;
  UPDATE openerp.firms SET revision=revision+1 WHERE id=firm RETURNING revision INTO next_revision;
  INSERT INTO openerp.firm_members VALUES(firm,target,payload->>'role',(payload->>'active')::boolean,next_revision)
    ON CONFLICT(firm_id,actor_id) DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active,revision=EXCLUDED.revision;
  RETURN openerp.firm_record(actor,firm,key,'save_member',payload,next_revision);
END $$;
