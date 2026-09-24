-- PAY-01: payroll facts are private, append-only and scoped to an explicit grant.
CREATE TABLE openerp.payroll_access (
  book_id text NOT NULL REFERENCES openerp.books(id),
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  granted_by text NOT NULL REFERENCES openerp.actors(id),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,actor_id),
  FOREIGN KEY (book_id,actor_id) REFERENCES openerp.memberships(book_id,actor_id) ON DELETE CASCADE
);
CREATE TABLE openerp.payroll_employees (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,id)
);
CREATE TABLE openerp.payroll_revisions (
  book_id text NOT NULL,
  id text NOT NULL,
  command_key text NOT NULL,
  employee_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('employment','work','opening')),
  effective_on date NOT NULL,
  supersedes text,
  body jsonb NOT NULL CHECK (jsonb_typeof(body)='object' AND body <> '{}'::jsonb),
  evidence_id text NOT NULL CHECK (length(evidence_id)>0),
  created_by text NOT NULL REFERENCES openerp.actors(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,command_key),
  FOREIGN KEY (book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id),
  FOREIGN KEY (book_id,supersedes) REFERENCES openerp.payroll_revisions(book_id,id),
  UNIQUE (book_id,supersedes)
);
CREATE INDEX payroll_revisions_employee ON openerp.payroll_revisions(book_id,employee_id,kind,effective_on,id);
CREATE TRIGGER payroll_access_immutable BEFORE UPDATE ON openerp.payroll_access FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER payroll_employees_immutable BEFORE UPDATE OR DELETE ON openerp.payroll_employees FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER payroll_revisions_immutable BEFORE UPDATE OR DELETE ON openerp.payroll_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.payroll_authorize(p_token text,p_scope jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text;
BEGIN
  actor:=openerp.authorize(p_token,p_scope);
  IF NOT EXISTS (SELECT FROM openerp.payroll_access a
    WHERE a.book_id=p_scope->>'bookId' AND a.actor_id=actor FOR SHARE) THEN
    PERFORM openerp.fail('Forbidden','Payroll access is required.');
  END IF;
  RETURN actor;
END $$;

CREATE FUNCTION openerp.set_payroll_access(p_token text,p_scope jsonb,p_actor text,p_allow boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text;
BEGIN
  actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  IF NOT EXISTS (SELECT FROM openerp.memberships
    WHERE book_id=p_scope->>'bookId' AND actor_id=p_actor FOR SHARE) THEN
    PERFORM openerp.fail('NotFound','The payroll actor must belong to this book.');
  END IF;
  IF p_allow IS NULL THEN PERFORM openerp.fail('InvalidJournal','Choose whether payroll access is allowed.'); END IF;
  IF p_allow THEN
    INSERT INTO openerp.payroll_access(book_id,actor_id,granted_by) VALUES(p_scope->>'bookId',p_actor,actor)
      ON CONFLICT (book_id,actor_id) DO NOTHING;
  ELSE
    DELETE FROM openerp.payroll_access WHERE book_id=p_scope->>'bookId' AND actor_id=p_actor;
  END IF;
  RETURN jsonb_build_object('scope',p_scope,'actorId',p_actor,'allowed',p_allow);
END $$;

CREATE FUNCTION openerp.capture_payroll_revision(p_token text,p_scope jsonb,p_key text,p_employee text,
  p_kind text,p_effective date,p_supersedes text,p_evidence text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; previous openerp.payroll_revisions; old_revision openerp.payroll_revisions; result jsonb;
BEGIN
  actor:=openerp.payroll_authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR UPDATE;
  IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    PERFORM openerp.fail('IdempotencyConflict','Supply a valid payroll command key.'); END IF;
  SELECT * INTO previous FROM openerp.payroll_revisions WHERE book_id=p_scope->>'bookId' AND command_key=p_key;
  IF FOUND THEN
    IF (previous.employee_id,previous.kind,previous.effective_on,previous.supersedes,previous.evidence_id,previous.body,previous.created_by)
      IS DISTINCT FROM (p_employee,p_kind,p_effective,p_supersedes,p_evidence,p_body,actor) THEN
      PERFORM openerp.fail('IdempotencyConflict','The payroll command key belongs to another request.'); END IF;
    RETURN jsonb_build_object('id',previous.id,'scope',p_scope,'employeeId',previous.employee_id,
      'kind',previous.kind,'effectiveOn',previous.effective_on,'supersedes',previous.supersedes,
      'evidenceId',previous.evidence_id,'body',previous.body,'createdBy',previous.created_by);
  END IF;
  IF p_employee IS NULL OR p_employee !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR p_kind NOT IN ('employment','work','opening') OR p_kind IS NULL OR p_effective IS NULL
    OR p_evidence IS NULL OR length(p_evidence)=0 OR length(p_evidence)>256
    OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR p_body='{}'::jsonb
    OR octet_length(p_body::text)>65536 THEN
    PERFORM openerp.fail('InvalidJournal','Payroll identity, dated kind, evidence and bounded facts are required.');
  END IF;
  -- Missing legal/tax facts are represented as missing; they never default to a rate or amount.
  IF (p_kind='employment' AND (nullif(p_body->>'personRef','') IS NULL
        OR nullif(p_body->>'jurisdiction','') IS NULL OR nullif(p_body->>'residency','') IS NULL
        OR nullif(p_body->>'payTerms','') IS NULL OR nullif(p_body->>'workSchedule','') IS NULL
        OR nullif(p_body->>'taxFacts','') IS NULL))
    OR (p_kind='work' AND (nullif(p_body->>'periodStart','') IS NULL
        OR nullif(p_body->>'periodEnd','') IS NULL OR jsonb_typeof(p_body->'inputs') IS DISTINCT FROM 'array'))
    OR (p_kind='opening' AND (p_body->>'asOf' IS DISTINCT FROM p_effective::text
        OR coalesce((p_body->>'balanceMinor') ~ '^-?[0-9]{1,18}$',false)=false
        OR nullif(p_body->>'obligation','') IS NULL)) THEN
    PERFORM openerp.fail('InvalidJournal','Required payroll facts, dated work inputs or exact opening balance are missing.');
  END IF;
  IF p_kind='work' AND (coalesce((p_body->>'periodStart') ~ '^\d{4}-\d{2}-\d{2}$',false)=false
    OR coalesce((p_body->>'periodEnd') ~ '^\d{4}-\d{2}-\d{2}$',false)=false
    OR (p_body->>'periodStart')>(p_body->>'periodEnd')) THEN
    PERFORM openerp.fail('InvalidJournal','Work input period must have valid ordered dates.');
  END IF;
  IF p_supersedes IS NOT NULL THEN
    SELECT * INTO old_revision FROM openerp.payroll_revisions
      WHERE book_id=p_scope->>'bookId' AND id=p_supersedes FOR SHARE;
    IF NOT FOUND OR old_revision.employee_id<>p_employee OR old_revision.kind<>p_kind
      OR old_revision.effective_on<>p_effective OR EXISTS(
        SELECT FROM openerp.payroll_revisions WHERE book_id=p_scope->>'bookId' AND supersedes=p_supersedes) THEN
      PERFORM openerp.fail('IdempotencyConflict','Only the current same-employee, same-kind, same-date revision may be superseded.');
    END IF;
  END IF;
  INSERT INTO openerp.payroll_employees(book_id,id) VALUES(p_scope->>'bookId',p_employee)
    ON CONFLICT (book_id,id) DO NOTHING;
  result:=jsonb_build_object('id',openerp.new_id('payrev'),'scope',p_scope,'employeeId',p_employee,
    'kind',p_kind,'effectiveOn',p_effective,'supersedes',p_supersedes,'evidenceId',p_evidence,
    'body',p_body,'createdBy',actor);
  INSERT INTO openerp.payroll_revisions(book_id,id,command_key,employee_id,kind,effective_on,supersedes,body,evidence_id,created_by)
    VALUES(p_scope->>'bookId',result->>'id',p_key,p_employee,p_kind,p_effective,p_supersedes,p_body,p_evidence,actor);
  RETURN result;
END $$;

CREATE FUNCTION openerp.list_payroll_revisions(p_token text,p_scope jsonb,p_employee text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb;
BEGIN
  PERFORM openerp.payroll_authorize(p_token,p_scope);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'employeeId',r.employee_id,'kind',r.kind,
    'effectiveOn',r.effective_on,'supersedes',r.supersedes,'evidenceId',r.evidence_id,
    'body',r.body,'createdBy',r.created_by,'createdAt',r.created_at) ORDER BY r.effective_on,r.created_at,r.id),'[]'::jsonb)
    INTO items FROM openerp.payroll_revisions r WHERE r.book_id=p_scope->>'bookId' AND r.employee_id=p_employee;
  RETURN jsonb_build_object('scope',p_scope,'employeeId',p_employee,'items',items);
END $$;

REVOKE ALL ON TABLE openerp.payroll_access,openerp.payroll_employees,openerp.payroll_revisions FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.payroll_authorize(text,jsonb),openerp.set_payroll_access(text,jsonb,text,boolean),
  openerp.capture_payroll_revision(text,jsonb,text,text,text,date,text,text,jsonb),
  openerp.list_payroll_revisions(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openerp.set_payroll_access(text,jsonb,text,boolean),
  openerp.capture_payroll_revision(text,jsonb,text,text,text,date,text,text,jsonb),
  openerp.list_payroll_revisions(text,jsonb,text) TO openerp_runtime;
