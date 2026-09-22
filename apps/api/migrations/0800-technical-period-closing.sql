-- Synthetic technical period locking only. No statutory close, carryforward or filing.
-- Requires the schedule and source-inventory dependency hooks; see CLOSING.md.
CREATE TABLE openerp.closing_inventories (
  book_id text NOT NULL, id text NOT NULL, period_id text NOT NULL,
  ordinal bigint NOT NULL CHECK(ordinal>0), body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,period_id,ordinal),
  FOREIGN KEY(book_id,period_id) REFERENCES openerp.periods
);
CREATE TRIGGER immutable_closing_inventory BEFORE UPDATE OR DELETE ON openerp.closing_inventories
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TABLE openerp.closing_proposals (
  book_id text NOT NULL, id text NOT NULL, period_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,period_id) REFERENCES openerp.periods
);
CREATE TABLE openerp.closing_approvals (
  book_id text NOT NULL, id text NOT NULL, proposal_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors, expires_at timestamptz NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.closing_proposals
);
CREATE TABLE openerp.closing_transitions (
  book_id text NOT NULL, id text NOT NULL, period_id text NOT NULL,
  proposal_id text NOT NULL, approval_id text NOT NULL, period_version bigint NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id), UNIQUE(book_id,proposal_id),
  UNIQUE(book_id,approval_id), UNIQUE(book_id,period_id,period_version),
  FOREIGN KEY(book_id,period_id) REFERENCES openerp.periods,
  FOREIGN KEY(book_id,proposal_id) REFERENCES openerp.closing_proposals,
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.closing_approvals
);
CREATE TABLE openerp.closing_certificates (
  book_id text NOT NULL, id text NOT NULL, period_id text NOT NULL,
  transition_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,period_id) REFERENCES openerp.periods,
  FOREIGN KEY(book_id,transition_id) REFERENCES openerp.closing_transitions
);
CREATE TABLE openerp.closing_invalidations (
  book_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('certificate','report','bank_reconciliation')),
  artifact_id text NOT NULL, transition_id text NOT NULL,
  PRIMARY KEY(book_id,kind,artifact_id),
  FOREIGN KEY(book_id,transition_id) REFERENCES openerp.closing_transitions
);
CREATE TRIGGER immutable_closing_proposal BEFORE UPDATE OR DELETE ON openerp.closing_proposals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_approval BEFORE UPDATE OR DELETE ON openerp.closing_approvals
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_transition BEFORE UPDATE OR DELETE ON openerp.closing_transitions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_certificate BEFORE UPDATE OR DELETE ON openerp.closing_certificates
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_closing_invalidation BEFORE UPDATE OR DELETE ON openerp.closing_invalidations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.declare_closing_inventory(token text, scope jsonb, period_id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_payload jsonb; c_body jsonb; c_evidence openerp.evidence;
BEGIN
  c_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  c_payload:=jsonb_build_object('periodId',period_id,'input',input);
  c_previous:=openerp.replay(scope->>'bookId',key,c_actor,'declare_closing_inventory',c_payload);
  IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
  PERFORM openerp.bank_require_profile(scope->>'bookId');
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId' AND p.id=period_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period was not found in this book.'); END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-'evidenceId'-'bankAccountIds'<>'{}'::jsonb
    OR jsonb_typeof(input->'bankAccountIds') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Declare expected bank accounts and retained inventory evidence.'); END IF;
  IF jsonb_array_length(input->'bankAccountIds')>100
    OR EXISTS(SELECT FROM jsonb_array_elements(input->'bankAccountIds') a WHERE jsonb_typeof(a) IS DISTINCT FROM 'string')
    OR (SELECT count(DISTINCT a) FROM jsonb_array_elements_text(input->'bankAccountIds') a)<>jsonb_array_length(input->'bankAccountIds')
    OR EXISTS(SELECT FROM jsonb_array_elements_text(input->'bankAccountIds') a(account_id)
      WHERE NOT EXISTS(SELECT FROM openerp.accounts ac WHERE ac.book_id=scope->>'bookId' AND ac.id=a.account_id)) THEN
    PERFORM openerp.fail('InvalidJournal','Declare at most100 distinct existing book accounts. An empty list is an explicit synthetic no-bank declaration.'); END IF;
  SELECT e.* INTO c_evidence FROM openerp.evidence e WHERE e.book_id=scope->>'bookId' AND e.id=input->>'evidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain evidence for this synthetic bank-source inventory first.'); END IF;
  c_body:=input||jsonb_build_object('id',openerp.new_id('closing_inventory'),'evidenceSha256',c_evidence.sha256,
    'actorId',c_actor,'declaredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'coverage','synthetic_bank_sources_only');
  -- The book lock serializes this period-local ordinal without non-MVCC sequence state.
  INSERT INTO openerp.closing_inventories(book_id,id,period_id,ordinal,body)
    SELECT scope->>'bookId',c_body->>'id',declare_closing_inventory.period_id,coalesce(max(i.ordinal),0)+1,c_body
      FROM openerp.closing_inventories i WHERE i.book_id=scope->>'bookId' AND i.period_id=declare_closing_inventory.period_id;
  RETURN openerp.save_command(scope->>'bookId',key,c_actor,'declare_closing_inventory',c_payload,c_body);
END $$;

CREATE FUNCTION openerp.closing_basis(p_book text, p_period text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE c_book openerp.books; c_period openerp.periods; c_report text;
  c_sources jsonb; c_schedules jsonb; c_inventory jsonb; c_accounts jsonb;
  c_checks jsonb; c_dependencies jsonb; c_banks_ready boolean; c_periods jsonb; c_commerce jsonb; c_bank_state jsonb; c_latest_reopen timestamptz;
BEGIN
  SELECT b.* INTO STRICT c_book FROM openerp.books b WHERE b.id=p_book;
  SELECT p.* INTO c_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=p_period;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period was not found in this book.'); END IF;
  SELECT r.id INTO c_report FROM openerp.report_snapshots r
    WHERE r.book_id=p_book AND r.starts_on=c_period.starts_on AND r.ends_on=c_period.ends_on
      AND r.sequence=c_book.committed_sequence AND r.body->>'balanced'='true'
      AND NOT EXISTS(SELECT FROM openerp.closing_invalidations i WHERE i.book_id=p_book AND i.kind='report' AND i.artifact_id=r.id)
    ORDER BY r.body->>'createdAt' DESC,r.id DESC LIMIT 1;
  c_bank_state:=openerp.bank_close_dependencies(p_book,c_period.starts_on,c_period.ends_on);
  c_sources:=c_bank_state->'sources';
  SELECT max((t.body->>'committedAt')::timestamptz) INTO c_latest_reopen
    FROM openerp.closing_transitions t JOIN openerp.periods p ON p.book_id=t.book_id AND p.id=t.period_id
    WHERE t.book_id=p_book AND t.body->>'action'='reopen' AND p.starts_on<=c_period.ends_on;
  c_banks_ready:=coalesce((c_bank_state->>'allRepresentedReady')::boolean,false)
    AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_sources) s
      WHERE (s->>'reconciliationCreatedAt')::timestamptz<=c_latest_reopen);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'version',a.version::text) ORDER BY a.id),'[]')
    INTO c_accounts FROM openerp.accounts a WHERE a.book_id=p_book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text,'locked',p.locked,
      'startsOn',p.starts_on::text,'endsOn',p.ends_on::text) ORDER BY p.id),'[]')
    INTO c_periods FROM openerp.periods p WHERE p.book_id=p_book AND p.starts_on<=c_period.ends_on;
  c_schedules:=openerp.subledger_close_dependencies(p_book,c_period.ends_on);
  c_commerce:=openerp.commerce_period_status(p_book,c_period.starts_on,c_period.ends_on);
  -- Missing source/company obligations cannot become an empty, complete inventory.
  SELECT i.body INTO c_inventory FROM openerp.closing_inventories i WHERE i.book_id=p_book AND i.period_id=p_period
    ORDER BY i.ordinal DESC LIMIT 1;
  IF jsonb_array_length(c_sources)=0 AND c_inventory->'bankAccountIds'='[]'::jsonb THEN c_banks_ready:=true; END IF;
  c_checks:=jsonb_build_array(
    jsonb_build_object('code','DeclaredBankInventory','passed',c_inventory IS NOT NULL
      AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(c_inventory->'bankAccountIds') expected(account_id)
        WHERE NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book AND s.account_id=expected.account_id))
      AND NOT EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=p_book
        AND NOT (c_inventory->'bankAccountIds' ? s.account_id)),
      'detail','An operator must explicitly declare expected synthetic bank accounts with evidence. Every expected account needs a retained source, and every observed source must be declared.'),
    jsonb_build_object('code','SyntheticNativeProfile','passed',c_book.profile='synthetic-core-v1' AND c_book.authority='native',
      'detail','Only the native synthetic profile supports this technical lock.'),
    jsonb_build_object('code','PeriodBoundaries','passed',EXISTS(SELECT FROM openerp.fiscal_years y
      WHERE y.book_id=p_book AND y.id=c_period.fiscal_year_id AND c_period.starts_on>=y.starts_on AND c_period.ends_on<=y.ends_on)
      AND NOT EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=p_book AND p.id<>p_period
        AND p.starts_on<=c_period.ends_on AND p.ends_on>=c_period.starts_on),
      'detail','The period must fit its fiscal year and must not overlap another posting period.'),
    jsonb_build_object('code','CurrentTrialBalance','passed',c_report IS NOT NULL,
      'detail','A current balanced internal trial balance must cover this exact period. It is not an annual report.'),
    jsonb_build_object('code','RepresentedBankSources','passed',c_banks_ready,
      'detail','Every represented bank source needs a fresh complete reconciliation for this exact period; missing sources are not inferred absent.'),
    jsonb_build_object('code','RegisteredCommerce','passed',
      coalesce((c_commerce->>'invalidRecognitionCount')::bigint=0 AND (c_commerce->>'invalidAllocationCount')::bigint=0
        AND (c_commerce->>'conservationFailureCount')::bigint=0,false),
      'detail','Registered invoices and allocations must remain valid and conserve exact amounts. Unpaid invoices are allowed; company invoice completeness is not established.'),
    jsonb_build_object('code','RepresentedSchedules','passed',
      coalesce((c_schedules->>'dueUnpreparedCount')::bigint=0 AND (c_schedules->>'dueUnpostedCount')::bigint=0
        AND (c_schedules->>'reversedOccurrenceCount')::bigint=0,false),
      'detail','Represented due schedule occurrences must be posted and unreversed; schedule inventory and control-account completeness remain unestablished.')
  );
  c_dependencies:=jsonb_build_object('periodVersion',c_period.version::text,'ledgerSequence',c_book.committed_sequence::text,
    'profileVersion',c_book.profile_version::text,'writerEpoch',c_book.writer_epoch::text,
    'periodDigest',openerp.digest(jsonb_build_object('periods',c_periods,'fiscalYear',(SELECT to_jsonb(y) FROM openerp.fiscal_years y WHERE y.book_id=p_book AND y.id=c_period.fiscal_year_id))),'accountsDigest',openerp.digest(c_accounts),
    'bankDigest',openerp.digest(c_bank_state),'scheduleDigest',openerp.digest(c_schedules),
    'inventoryDigest',openerp.digest(jsonb_build_object('bankInventory',c_inventory,'commerce',c_commerce)),'reportId',c_report);
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',c_book.entity_id,'bookId',p_book),
    'periodId',p_period,'startsOn',c_period.starts_on::text,'endsOn',c_period.ends_on::text,'locked',c_period.locked,
    'inventory',c_inventory,'dependencies',c_dependencies,'checks',c_checks,
    'technicalCloseAllowed',NOT c_period.locked AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_checks) ch WHERE ch->>'passed' IS DISTINCT FROM 'true'),
    'statutoryReady',false,'statutoryBlockers',jsonb_build_array(
      'Actual company profile, accounting method, obligations and complete expected source inventory are not established.',
      'Tax, receivables/payables, owner balances, assets, payroll, valuation and control-account completeness are not certified.',
      'Technical locking does not perform year-end transfers, tax calculation, annual reporting, SIE or iXBRL validation.',
      'Retention, restore, reviewed statutory schemas, signing authority and filing acceptance remain unverified.'));
END $$;

CREATE FUNCTION openerp.get_closing_readiness(token text, scope jsonb, period_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId' AND p.id=period_id FOR SHARE;
  RETURN openerp.closing_basis(scope->>'bookId',period_id);
END $$;

CREATE FUNCTION openerp.prepare_closing(token text, scope jsonb, period_id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_basis jsonb; c_body jsonb; c_payload jsonb;
BEGIN
  c_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  c_payload:=jsonb_build_object('periodId',period_id,'input',input);
  c_previous:=openerp.replay(scope->>'bookId',key,c_actor,'prepare_closing',c_payload);
  IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-'action'-'reason'<>'{}'::jsonb
    OR coalesce(input->>'action','') NOT IN ('close','reopen')
    OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string'
    OR coalesce(length(btrim(input->>'reason')),0)<1 OR coalesce(length(input->>'reason'),0)>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Choose technical close or reopen and supply a reason.');
  END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=scope->>'bookId' AND p.id=period_id FOR UPDATE;
  c_basis:=openerp.closing_basis(scope->>'bookId',period_id);
  PERFORM openerp.bank_require_profile(scope->>'bookId');
  IF (input->>'action'='close' AND c_basis->>'technicalCloseAllowed'<>'true')
    OR (input->>'action'='reopen' AND c_basis->>'locked'<>'true') THEN
    PERFORM openerp.fail('StaleDependency','Review live period prerequisites before preparing this transition.');
  END IF;
  c_body:=jsonb_build_object('id',openerp.new_id('closing_proposal'),'scope',c_basis->'scope','periodId',period_id,
    'action',input->>'action','reason',input->>'reason','basis',c_basis,'proposedBy',c_actor,
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  c_body:=c_body||jsonb_build_object('digest',openerp.digest(c_body));
  INSERT INTO openerp.closing_proposals VALUES(scope->>'bookId',c_body->>'id',period_id,c_body);
  RETURN openerp.save_command(scope->>'bookId',key,c_actor,'prepare_closing',c_payload,c_body);
END $$;

CREATE FUNCTION openerp.get_closing_proposal(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_proposal openerp.closing_proposals; c_receipt jsonb; c_basis jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT p.* INTO c_proposal FROM openerp.closing_proposals p WHERE p.book_id=scope->>'bookId' AND p.id=get_closing_proposal.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period transition proposal was not found.'); END IF;
  c_basis:=openerp.closing_basis(c_proposal.book_id,c_proposal.period_id);
  SELECT t.body INTO c_receipt FROM openerp.closing_transitions t WHERE t.book_id=c_proposal.book_id AND t.proposal_id=c_proposal.id;
  RETURN jsonb_build_object('proposal',c_proposal.body,'dependenciesCurrent',c_basis=c_proposal.body->'basis','receipt',c_receipt);
END $$;

CREATE FUNCTION openerp.approve_closing(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_proposal openerp.closing_proposals; c_basis jsonb;
  c_body jsonb; c_payload jsonb; c_expires timestamptz;
BEGIN
  c_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  c_payload:=jsonb_build_object('proposalId',id,'input',input);
  c_previous:=openerp.replay(scope->>'bookId',key,c_actor,'approve_closing',c_payload);
  IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-'digest'<>'{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Approve only the exact period proposal digest.'); END IF;
  SELECT p.* INTO c_proposal FROM openerp.closing_proposals p WHERE p.book_id=scope->>'bookId' AND p.id=approve_closing.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period transition proposal was not found.'); END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=c_proposal.book_id AND p.id=c_proposal.period_id FOR UPDATE;
  c_basis:=openerp.closing_basis(c_proposal.book_id,c_proposal.period_id);
  IF input->>'digest' IS DISTINCT FROM c_proposal.body->>'digest' OR c_basis IS DISTINCT FROM c_proposal.body->'basis' THEN
    PERFORM openerp.fail('StaleDependency','Period dependencies changed. Prepare and review a new proposal.'); END IF;
  c_expires:=clock_timestamp()+interval '15 minutes';
  c_body:=jsonb_build_object('id',openerp.new_id('closing_approval'),'proposalId',id,'digest',input->>'digest',
    'actorId',c_actor,'expiresAt',to_char(c_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.closing_approvals VALUES(c_proposal.book_id,c_body->>'id',id,c_actor,c_expires,c_body);
  RETURN openerp.save_command(c_proposal.book_id,key,c_actor,'approve_closing',c_payload,c_body);
END $$;

CREATE FUNCTION openerp.execute_closing(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_proposal openerp.closing_proposals; c_approval openerp.closing_approvals;
  c_period openerp.periods; c_basis jsonb; c_payload jsonb; c_body jsonb; c_transition text;
  c_certificate text; c_certificate_body jsonb; c_cert_count integer:=0; c_report_count integer:=0;
BEGIN
  c_actor:=openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  c_payload:=jsonb_build_object('proposalId',id,'input',input);
  c_previous:=openerp.replay(scope->>'bookId',key,c_actor,'execute_closing',c_payload);
  IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-'digest'-'approvalId'<>'{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Execute only the exact proposal and operator approval.'); END IF;
  SELECT p.* INTO c_proposal FROM openerp.closing_proposals p WHERE p.book_id=scope->>'bookId' AND p.id=execute_closing.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The period transition proposal was not found.'); END IF;
  SELECT t.body INTO c_previous FROM openerp.closing_transitions t WHERE t.book_id=c_proposal.book_id AND t.proposal_id=c_proposal.id;
  IF c_previous IS NOT NULL THEN
    IF input->>'digest' IS DISTINCT FROM c_proposal.body->>'digest' OR input->>'approvalId' IS DISTINCT FROM c_previous->>'approvalId' THEN
      PERFORM openerp.fail('IdempotencyConflict','The committed transition used a different proposal or approval.'); END IF;
    RETURN openerp.save_command(c_proposal.book_id,key,c_actor,'execute_closing',c_payload,c_previous);
  END IF;
  SELECT p.* INTO STRICT c_period FROM openerp.periods p WHERE p.book_id=c_proposal.book_id AND p.id=c_proposal.period_id FOR UPDATE;
  c_basis:=openerp.closing_basis(c_proposal.book_id,c_proposal.period_id);
  IF input->>'digest' IS DISTINCT FROM c_proposal.body->>'digest' OR c_basis IS DISTINCT FROM c_proposal.body->'basis' THEN
    PERFORM openerp.fail('StaleDependency','Period dependencies changed. Prepare and approve a new proposal.'); END IF;
  SELECT a.* INTO c_approval FROM openerp.closing_approvals a WHERE a.book_id=c_proposal.book_id
    AND a.id=input->>'approvalId' AND a.proposal_id=c_proposal.id;
  IF NOT FOUND OR c_approval.expires_at<=clock_timestamp() OR c_approval.body->>'digest' IS DISTINCT FROM input->>'digest' THEN
    PERFORM openerp.fail('ApprovalRequired','A current exact operator approval is required.'); END IF;
  PERFORM 1 FROM openerp.memberships m WHERE m.book_id=c_proposal.book_id AND m.actor_id=c_approval.actor_id AND m.role='operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approving operator no longer has book authority.'); END IF;
  c_transition:=openerp.new_id('closing_receipt');
  IF c_proposal.body->>'action'='close' THEN
    c_certificate:=openerp.new_id('technical_certificate');
  ELSE
    SELECT count(*) INTO c_cert_count FROM openerp.closing_certificates c JOIN openerp.periods p ON p.book_id=c.book_id AND p.id=c.period_id
      WHERE c.book_id=c_proposal.book_id AND p.ends_on>=c_period.starts_on
      AND NOT EXISTS(SELECT FROM openerp.closing_invalidations i WHERE i.book_id=c.book_id AND i.kind='certificate' AND i.artifact_id=c.id);
    SELECT count(*) INTO c_report_count FROM openerp.report_snapshots r WHERE r.book_id=c_proposal.book_id AND r.ends_on>=c_period.starts_on
      AND NOT EXISTS(SELECT FROM openerp.closing_invalidations i WHERE i.book_id=r.book_id AND i.kind='report' AND i.artifact_id=r.id);
  END IF;
  UPDATE openerp.periods p SET locked=c_proposal.body->>'action'='close'
    WHERE p.book_id=c_proposal.book_id AND p.id=c_proposal.period_id RETURNING p.* INTO c_period;
  c_body:=jsonb_build_object('id',c_transition,'scope',c_proposal.body->'scope','periodId',c_period.id,
    'proposalId',c_proposal.id,'approvalId',c_approval.id,'action',c_proposal.body->>'action','locked',c_period.locked,
    'periodVersion',c_period.version::text,'certificateId',c_certificate,'invalidatedCertificates',c_cert_count,
    'invalidatedReports',c_report_count,'approvedBy',c_approval.actor_id,'executedBy',c_actor,
    'committedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'statutoryReady',false);
  INSERT INTO openerp.closing_transitions VALUES(c_proposal.book_id,c_transition,c_period.id,c_proposal.id,c_approval.id,c_period.version,c_body);
  IF c_certificate IS NOT NULL THEN
    c_basis:=openerp.closing_basis(c_proposal.book_id,c_period.id);
    c_certificate_body:=jsonb_build_object('id',c_certificate,'kind','synthetic_technical_period_lock_v1',
      'proposal',c_proposal.body,'receipt',c_body,'effectiveDependencies',c_basis->'dependencies');
    c_certificate_body:=c_certificate_body||jsonb_build_object('digest',openerp.digest(c_certificate_body));
    INSERT INTO openerp.closing_certificates VALUES(c_proposal.book_id,c_certificate,c_period.id,c_transition,c_certificate_body);
  ELSE
    INSERT INTO openerp.closing_invalidations SELECT c.book_id,'certificate',c.id,c_transition
      FROM openerp.closing_certificates c JOIN openerp.periods p ON p.book_id=c.book_id AND p.id=c.period_id
      WHERE c.book_id=c_proposal.book_id AND p.ends_on>=c_period.starts_on ON CONFLICT DO NOTHING;
    INSERT INTO openerp.closing_invalidations SELECT r.book_id,'report',r.id,c_transition FROM openerp.report_snapshots r
      WHERE r.book_id=c_proposal.book_id AND r.ends_on>=c_period.starts_on ON CONFLICT DO NOTHING;
    INSERT INTO openerp.closing_invalidations SELECT r.book_id,'bank_reconciliation',r.id,c_transition FROM openerp.bank_reconciliations r
      WHERE r.book_id=c_proposal.book_id AND (r.body->>'endsOn')::date>=c_period.starts_on ON CONFLICT DO NOTHING;
  END IF;
  RETURN openerp.save_command(c_proposal.book_id,key,c_actor,'execute_closing',c_payload,c_body);
END $$;

CREATE FUNCTION openerp.get_closing_certificate(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_certificate openerp.closing_certificates; c_basis jsonb; c_invalidated text;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT c.* INTO c_certificate FROM openerp.closing_certificates c WHERE c.book_id=scope->>'bookId' AND c.id=get_closing_certificate.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The technical lock certificate was not found.'); END IF;
  c_basis:=openerp.closing_basis(c_certificate.book_id,c_certificate.period_id);
  SELECT i.transition_id INTO c_invalidated FROM openerp.closing_invalidations i WHERE i.book_id=c_certificate.book_id
    AND i.kind='certificate' AND i.artifact_id=c_certificate.id;
  RETURN jsonb_build_object('certificate',c_certificate.body,'invalidatedBy',c_invalidated,
    'current',c_invalidated IS NULL AND c_basis->>'locked'='true' AND c_basis->'dependencies'=c_certificate.body->'effectiveDependencies'
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(c_basis->'checks') ch WHERE ch->>'passed' IS DISTINCT FROM 'true'));
END $$;

CREATE FUNCTION openerp.get_closing_history(token text, scope jsonb, period_id text, after_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE c_items jsonb; c_next text; c_after numeric;
BEGIN
  PERFORM openerp.authorize(token,scope);
  IF coalesce(nullif(after_version,''),'0') !~ '^(0|[1-9][0-9]{0,37})$' THEN
    PERFORM openerp.fail('InvalidJournal','Invalid history cursor.'); END IF;
  c_after:=coalesce(nullif(after_version,''),'0')::numeric;
  IF NOT EXISTS(SELECT FROM openerp.periods p WHERE p.book_id=scope->>'bookId' AND p.id=period_id) THEN
    PERFORM openerp.fail('NotFound','The period was not found in this book.'); END IF;
  SELECT coalesce(jsonb_agg(t.body ORDER BY t.period_version),'[]') INTO c_items FROM (
    SELECT t.body,t.period_version FROM openerp.closing_transitions t WHERE t.book_id=scope->>'bookId'
      AND t.period_id=get_closing_history.period_id AND t.period_version>c_after ORDER BY t.period_version LIMIT 50
  ) t;
  IF jsonb_array_length(c_items)=50 AND EXISTS(SELECT FROM openerp.closing_transitions t WHERE t.book_id=scope->>'bookId'
    AND t.period_id=get_closing_history.period_id AND t.period_version>(c_items->49->>'periodVersion')::numeric) THEN
    c_next:=c_items->49->>'periodVersion'; END IF;
  RETURN jsonb_build_object('items',c_items,'next',c_next);
END $$;
REVOKE ALL ON openerp.closing_inventories,openerp.closing_proposals,openerp.closing_approvals,openerp.closing_transitions,
  openerp.closing_certificates,openerp.closing_invalidations FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.declare_closing_inventory(text,jsonb,text,text,jsonb),openerp.closing_basis(text,text),openerp.get_closing_readiness(text,jsonb,text),
  openerp.prepare_closing(text,jsonb,text,text,jsonb),openerp.get_closing_proposal(text,jsonb,text),
  openerp.approve_closing(text,jsonb,text,text,jsonb),openerp.execute_closing(text,jsonb,text,text,jsonb),
  openerp.get_closing_certificate(text,jsonb,text),openerp.get_closing_history(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.declare_closing_inventory(text,jsonb,text,text,jsonb),openerp.get_closing_readiness(text,jsonb,text),openerp.prepare_closing(text,jsonb,text,text,jsonb),
  openerp.get_closing_proposal(text,jsonb,text),openerp.approve_closing(text,jsonb,text,text,jsonb),
  openerp.execute_closing(text,jsonb,text,text,jsonb),openerp.get_closing_certificate(text,jsonb,text),
  openerp.get_closing_history(text,jsonb,text,text) TO openerp_runtime;
