DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM openerp.payroll_revisions r
    LEFT JOIN openerp.evidence e ON e.book_id=r.book_id AND e.id=r.evidence_id
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION 'PAY-01 migration refused: retained payroll evidence reference is missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM openerp.payroll_revisions child
    LEFT JOIN openerp.payroll_revisions parent
      ON parent.book_id=child.book_id AND parent.employee_id=child.employee_id
      AND parent.kind=child.kind AND parent.effective_on=child.effective_on AND parent.id=child.supersedes
    WHERE child.supersedes IS NOT NULL AND parent.id IS NULL
  ) THEN
    RAISE EXCEPTION 'PAY-01 migration refused: retained payroll predecessor is missing or incompatible';
  END IF;
END $$;

ALTER TABLE openerp.payroll_revisions
  ADD CONSTRAINT payroll_revision_logical_id
    UNIQUE (book_id,employee_id,kind,effective_on,id),
  ADD CONSTRAINT payroll_revision_evidence_fk
    FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence(book_id,id),
  ADD CONSTRAINT payroll_revision_predecessor_fk
    FOREIGN KEY (book_id,employee_id,kind,effective_on,supersedes)
    REFERENCES openerp.payroll_revisions(book_id,employee_id,kind,effective_on,id);

CREATE TABLE openerp.payroll_current_revisions (
  book_id text NOT NULL,
  employee_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('employment','work','opening')),
  effective_on date NOT NULL,
  revision_id text NOT NULL,
  PRIMARY KEY (book_id,employee_id,kind,effective_on),
  FOREIGN KEY (book_id,employee_id) REFERENCES openerp.payroll_employees(book_id,id),
  FOREIGN KEY (book_id,employee_id,kind,effective_on,revision_id)
    REFERENCES openerp.payroll_revisions(book_id,employee_id,kind,effective_on,id)
    DEFERRABLE INITIALLY DEFERRED
);

INSERT INTO openerp.payroll_current_revisions(book_id,employee_id,kind,effective_on,revision_id)
  SELECT r.book_id,r.employee_id,r.kind,r.effective_on,r.id
  FROM openerp.payroll_revisions r
  WHERE NOT EXISTS (
    SELECT FROM openerp.payroll_revisions child
    WHERE child.book_id=r.book_id AND child.supersedes=r.id
  );

CREATE FUNCTION openerp.list_payroll_employees(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb; next_cursor text;
BEGIN
  PERFORM openerp.payroll_authorize(p_token,p_scope);
  IF coalesce(p_after,'') !~ '^$|^[a-z][a-z0-9_-]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Use a returned employee directory cursor.'); END IF;
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
  WITH page AS (
    SELECT e.id,e.created_at FROM openerp.payroll_employees e
    WHERE e.book_id=p_scope->>'bookId' AND e.id COLLATE "C">coalesce(p_after,'') COLLATE "C"
    ORDER BY e.id COLLATE "C" LIMIT 51
  ), shown AS (
    SELECT * FROM page ORDER BY id COLLATE "C" LIMIT 50
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('scope',p_scope,'employeeId',s.id,'createdAt',s.created_at)
    ORDER BY s.id COLLATE "C"),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>50 THEN max(s.id COLLATE "C") ELSE NULL END
  INTO items,next_cursor FROM shown s;
  RETURN jsonb_build_object('scope',p_scope,'items',items,'nextCursor',next_cursor);
END $$;

CREATE OR REPLACE FUNCTION openerp.capture_payroll_revision(p_token text,p_scope jsonb,p_key text,p_employee text,
  p_kind text,p_effective date,p_supersedes text,p_evidence text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; previous openerp.payroll_revisions; head openerp.payroll_current_revisions;
  has_current boolean; result jsonb;
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
    OR p_evidence IS NULL OR p_evidence !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR p_body='{}'::jsonb
    OR octet_length(p_body::text)>65536 THEN
    PERFORM openerp.fail('InvalidJournal','Payroll identity, dated kind, evidence and bounded facts are required.'); END IF;
  IF NOT EXISTS (
    SELECT FROM openerp.evidence e WHERE e.book_id=p_scope->>'bookId' AND e.id=p_evidence
  ) THEN
    PERFORM openerp.fail('MissingEvidence','Retain evidence in this book before recording payroll facts.'); END IF;
  IF (p_kind='employment' AND (p_body-ARRAY['personRef','jurisdiction','residency','payTerms','workSchedule','taxFacts']<>'{}'::jsonb
        OR nullif(p_body->>'personRef','') IS NULL
        OR nullif(p_body->>'jurisdiction','') IS NULL OR nullif(p_body->>'residency','') IS NULL
        OR nullif(p_body->>'payTerms','') IS NULL OR nullif(p_body->>'workSchedule','') IS NULL
        OR nullif(p_body->>'taxFacts','') IS NULL))
    OR (p_kind='work' AND (p_body-ARRAY['periodStart','periodEnd','inputs']<>'{}'::jsonb
        OR nullif(p_body->>'periodStart','') IS NULL
        OR nullif(p_body->>'periodEnd','') IS NULL OR jsonb_typeof(p_body->'inputs') IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_body->'inputs')<1))
    OR (p_kind='opening' AND (p_body-ARRAY['asOf','balanceMinor','obligation']<>'{}'::jsonb
        OR p_body->>'asOf' IS DISTINCT FROM p_effective::text
        OR coalesce((p_body->>'balanceMinor') ~ '^(0|-?[1-9][0-9]*)$',false)=false
        OR nullif(p_body->>'obligation','') IS NULL)) THEN
    PERFORM openerp.fail('InvalidJournal','Required payroll facts, dated work inputs or exact opening balance are missing.'); END IF;
  IF p_kind='work' AND (coalesce((p_body->>'periodStart') ~ '^\d{4}-\d{2}-\d{2}$',false)=false
    OR coalesce((p_body->>'periodEnd') ~ '^\d{4}-\d{2}-\d{2}$',false)=false
    OR (p_body->>'periodStart')>(p_body->>'periodEnd')) THEN
    PERFORM openerp.fail('InvalidJournal','Work input period must have valid ordered dates.'); END IF;
  SELECT * INTO head FROM openerp.payroll_current_revisions
    WHERE book_id=p_scope->>'bookId' AND employee_id=p_employee AND kind=p_kind AND effective_on=p_effective
    FOR UPDATE;
  has_current:=FOUND;
  IF (has_current AND p_supersedes IS DISTINCT FROM head.revision_id)
    OR (NOT has_current AND p_supersedes IS NOT NULL) THEN
    PERFORM openerp.fail('StaleDependency','Reload the current payroll fact revision before saving.'); END IF;
  INSERT INTO openerp.payroll_employees(book_id,id) VALUES(p_scope->>'bookId',p_employee)
    ON CONFLICT (book_id,id) DO NOTHING;
  result:=jsonb_build_object('id',openerp.new_id('payrev'),'scope',p_scope,'employeeId',p_employee,
    'kind',p_kind,'effectiveOn',p_effective,'supersedes',p_supersedes,'evidenceId',p_evidence,
    'body',p_body,'createdBy',actor);
  INSERT INTO openerp.payroll_revisions(book_id,id,command_key,employee_id,kind,effective_on,supersedes,body,evidence_id,created_by)
    VALUES(p_scope->>'bookId',result->>'id',p_key,p_employee,p_kind,p_effective,p_supersedes,p_body,p_evidence,actor);
  IF has_current THEN
    UPDATE openerp.payroll_current_revisions SET revision_id=result->>'id'
      WHERE book_id=p_scope->>'bookId' AND employee_id=p_employee AND kind=p_kind AND effective_on=p_effective;
  ELSE
    INSERT INTO openerp.payroll_current_revisions(book_id,employee_id,kind,effective_on,revision_id)
      VALUES(p_scope->>'bookId',p_employee,p_kind,p_effective,result->>'id');
  END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION openerp.list_payroll_revisions(p_token text,p_scope jsonb,p_employee text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE items jsonb;
BEGIN
  PERFORM openerp.payroll_authorize(p_token,p_scope);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'employeeId',r.employee_id,'kind',r.kind,
    'effectiveOn',r.effective_on,'supersedes',r.supersedes,'evidenceId',r.evidence_id,
    'body',r.body,'createdBy',r.created_by,'createdAt',r.created_at,
    'isCurrent',EXISTS(SELECT FROM openerp.payroll_current_revisions h
      WHERE h.book_id=r.book_id AND h.employee_id=r.employee_id AND h.kind=r.kind
      AND h.effective_on=r.effective_on AND h.revision_id=r.id))
    ORDER BY r.effective_on,r.created_at,r.id),'[]'::jsonb)
    INTO items FROM openerp.payroll_revisions r WHERE r.book_id=p_scope->>'bookId' AND r.employee_id=p_employee;
  RETURN jsonb_build_object('scope',p_scope,'employeeId',p_employee,'items',items);
END $$;

REVOKE ALL ON TABLE openerp.payroll_current_revisions FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.list_payroll_employees(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_payroll_employees(text,jsonb,text) TO openerp_runtime;
