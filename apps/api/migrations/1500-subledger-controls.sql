-- Evidence-backed synthetic basis and immutable declared-account reporting only.
CREATE TABLE openerp.subledger_bases (
  book_id text NOT NULL, schedule_id text NOT NULL, evidence_id text NOT NULL,
  source_locator text NOT NULL, voucher_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,schedule_id), UNIQUE(book_id,evidence_id,source_locator),
  FOREIGN KEY(book_id,schedule_id) REFERENCES openerp.subledger_schedules,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  FOREIGN KEY(book_id,voucher_id) REFERENCES openerp.vouchers
);
CREATE TABLE openerp.subledger_basis_lines (
  book_id text NOT NULL, schedule_id text NOT NULL, voucher_id text NOT NULL, line_id text NOT NULL,
  PRIMARY KEY(book_id,voucher_id,line_id),
  FOREIGN KEY(book_id,schedule_id) REFERENCES openerp.subledger_bases,
  FOREIGN KEY(book_id,voucher_id,line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id)
);
CREATE TABLE openerp.subledger_control_snapshots (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  body jsonb NOT NULL, content text NOT NULL, sha256 text NOT NULL, byte_length integer NOT NULL,
  PRIMARY KEY(book_id,id), CHECK(byte_length BETWEEN 1 AND 8388608)
);
CREATE TRIGGER immutable_subledger_basis BEFORE UPDATE OR DELETE ON openerp.subledger_bases
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_basis_line BEFORE UPDATE OR DELETE ON openerp.subledger_basis_lines
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_subledger_control BEFORE UPDATE OR DELETE ON openerp.subledger_control_snapshots
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.subledger_basis_revision_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN
  -- Existing schedule commands already hold the book barrier before inserting revisions.
  IF EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=NEW.book_id AND b.schedule_id=NEW.schedule_id) THEN
    PERFORM openerp.fail('UnsupportedProfile','A linked carrying basis freezes this schedule. Basis corrections and future amendments require a separate reviewed workflow.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subledger_basis_freezes_revision BEFORE INSERT ON openerp.subledger_schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION openerp.subledger_basis_revision_guard();

-- Existing schedule reads retain all fields; a newly linked basis also freezes the revision affordance.
CREATE OR REPLACE FUNCTION openerp.get_schedule(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_current jsonb; sl_revisions jsonb; sl_states jsonb; sl_recognized numeric;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  sl_current:=openerp.subledger_current(scope->>'bookId',id);
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO sl_revisions FROM openerp.subledger_schedule_revisions r
    WHERE r.book_id=scope->>'bookId' AND r.schedule_id=id;
  sl_states:=openerp.subledger_occurrence_states(scope->>'bookId',sl_current,'9999-12-31'::date);
  SELECT coalesce(sum((value->>'amountMinor')::numeric),0) INTO sl_recognized
    FROM jsonb_array_elements(sl_states) WHERE value->>'state'='posted';
  RETURN jsonb_build_object('current',sl_current,'revisions',sl_revisions,'occurrences',sl_states,
    'recognizedMinor',sl_recognized::text,'remainingMinor',((sl_current->'terms'->>'costMinor')::numeric-sl_recognized)::text,
    'revisionAllowed',NOT EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=scope->>'bookId' AND b.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.subledger_preparations p WHERE p.book_id=scope->>'bookId' AND p.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.events e WHERE e.book_id=scope->>'bookId' AND e.evidence_id=sl_current->'terms'->>'evidenceId'
        AND e.event_key IN(SELECT value->>'eventKey' FROM jsonb_array_elements(sl_current->'occurrences')))
      AND (sl_current->>'revision')::integer<20,
    'controlAccountReconciled',false,'requiresPostingApproval',true);
END $$;

CREATE FUNCTION openerp.record_subledger_basis(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE s_actor text; s_book openerp.books; s_previous jsonb; s_schedule jsonb; s_voucher openerp.vouchers;
  s_evidence openerp.evidence; s_review openerp.evidence; s_date date; s_field text;
  s_cost numeric; s_accumulated numeric; s_carrying numeric; s_debit numeric; s_credit numeric;
  s_lines jsonb; s_body jsonb; s_count integer;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope,true);
  SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(s_book.id,p_key,s_actor,'record_subledger_basis',p_input);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  IF s_book.profile<>'synthetic-core-v1' OR s_book.authority<>'native' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only native synthetic schedules support carrying-basis linkage.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['scheduleId','expectedDigest','kind','effectiveOn','evidenceId',
    'sourceLocator','reviewEvidenceId','rationale','originalCostMinor','accumulatedMinor','carryingMinor','voucherId','lineIds']);
  FOREACH s_field IN ARRAY ARRAY['scheduleId','evidenceId','reviewEvidenceId','voucherId'] LOOP
    IF jsonb_typeof(p_input->s_field) IS DISTINCT FROM 'string' OR p_input->>s_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Use retained identifiers from this book.'); END IF;
  END LOOP;
  FOREACH s_field IN ARRAY ARRAY['sourceLocator','rationale'] LOOP
    IF jsonb_typeof(p_input->s_field) IS DISTINCT FROM 'string' OR length(btrim(p_input->>s_field)) NOT BETWEEN 1 AND 2000 OR p_input->>s_field IS DISTINCT FROM btrim(p_input->>s_field) THEN
      PERFORM openerp.fail('InvalidJournal','Retain a source component locator and review rationale.'); END IF;
  END LOOP;
  IF length(p_input->>'sourceLocator')>256 THEN
    PERFORM openerp.fail('InvalidJournal','A retained source component locator supports at most256 characters.'); END IF;
  IF coalesce(p_input->>'kind','') NOT IN ('acquisition','imported_opening')
    OR jsonb_typeof(p_input->'effectiveOn') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Choose acquisition or imported opening and its actual posted date.'); END IF;
  s_date:=openerp.bank_date(p_input->>'effectiveOn');
  FOREACH s_field IN ARRAY ARRAY['originalCostMinor','accumulatedMinor','carryingMinor'] LOOP
    IF jsonb_typeof(p_input->s_field) IS DISTINCT FROM 'string' OR p_input->>s_field !~ '^(0|[1-9][0-9]{0,37})$' THEN
      PERFORM openerp.fail('InvalidJournal','Use canonical nonnegative integer minor-unit amounts.'); END IF;
  END LOOP;
  s_cost:=(p_input->>'originalCostMinor')::numeric;
  s_accumulated:=(p_input->>'accumulatedMinor')::numeric;
  s_carrying:=(p_input->>'carryingMinor')::numeric;
  IF s_carrying<=0 OR s_cost<>s_accumulated+s_carrying
    OR (p_input->>'kind'='acquisition' AND s_accumulated<>0) THEN
    PERFORM openerp.fail('InvalidJournal','Original cost must equal accumulated recognition plus positive carrying amount. Acquisition has no accumulated opening.'); END IF;
  IF (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_schedules s WHERE s.book_id=s_book.id LIMIT 201) bounded)>200 THEN
    PERFORM openerp.fail('UnsupportedProfile','Basis linkage supports at most200 retained schedules in this book.'); END IF;
  s_schedule:=openerp.subledger_current(s_book.id,p_input->>'scheduleId');
  IF p_input->>'expectedDigest' IS DISTINCT FROM s_schedule->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','Review the current schedule digest before linking its basis.'); END IF;
  IF s_carrying<>(s_schedule->'terms'->>'costMinor')::numeric
    OR s_date>=(s_schedule->'occurrences'->0->>'postingDate')::date THEN
    PERFORM openerp.fail('InvalidJournal','Schedule cost must equal the carrying basis. The basis must precede its first occurrence; historical depreciation cannot restart.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=s_book.id
      AND (b.schedule_id=p_input->>'scheduleId' OR (b.evidence_id=p_input->>'evidenceId' AND b.source_locator=p_input->>'sourceLocator'))) THEN
    PERFORM openerp.fail('IdempotencyConflict','This schedule or evidence component already has an immutable basis. Recover the retained basis.'); END IF;
  IF (SELECT count(*) FROM openerp.subledger_bases b WHERE b.book_id=s_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book reached its 200-basis bound.'); END IF;
  SELECT * INTO s_evidence FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=p_input->>'evidenceId';
  SELECT * INTO s_review FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=p_input->>'reviewEvidenceId';
  IF s_evidence.id IS NULL OR s_review.id IS NULL THEN
    PERFORM openerp.fail('MissingEvidence','Retain source and review evidence in this book first.'); END IF;
  SELECT * INTO s_voucher FROM openerp.vouchers v WHERE v.book_id=s_book.id AND v.id=p_input->>'voucherId';
  IF s_voucher.id IS NULL OR s_voucher.sequence>s_book.committed_sequence OR s_voucher.posting_date<>s_date
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(s_voucher.action->'evidenceRefs') e WHERE e->>'evidenceId'=s_evidence.id) THEN
    PERFORM openerp.fail('MissingEvidence','The existing posted voucher must cite the source evidence and match the basis date.'); END IF;
  IF s_voucher.corrects_voucher_id IS NOT NULL OR EXISTS(SELECT FROM openerp.vouchers v
      WHERE v.book_id=s_book.id AND v.corrects_voucher_id=s_voucher.id)
    OR EXISTS(SELECT FROM openerp.subledger_preparations p WHERE p.book_id=s_book.id AND p.change_set_id=s_voucher.change_set_id)
    OR EXISTS(SELECT FROM openerp.subledger_schedules s
      CROSS JOIN LATERAL jsonb_array_elements(openerp.subledger_current(s_book.id,s.id)->'occurrences') o
      JOIN openerp.events e ON e.book_id=s_book.id AND e.id=s_voucher.event_id AND e.event_key=o->>'eventKey'
      WHERE s.book_id=s_book.id) THEN
    PERFORM openerp.fail('UnsupportedProfile','A reversed, correcting or schedule-occurrence voucher cannot establish an acquisition or imported opening.'); END IF;
  IF jsonb_typeof(p_input->'lineIds') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Select the complete basis control lines, at most20.'); END IF;
  s_count:=jsonb_array_length(p_input->'lineIds');
  IF s_count NOT BETWEEN 1 AND 20 OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'lineIds') x
    WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR x#>>'{}' !~ '^[a-z][a-z0-9_-]{2,127}$')
    OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements_text(p_input->'lineIds') x) THEN
    PERFORM openerp.fail('InvalidJournal','Select1–20 distinct posted line identifiers.'); END IF;
  IF EXISTS(SELECT FROM openerp.subledger_basis_lines l WHERE l.book_id=s_book.id AND l.voucher_id=s_voucher.id
      AND l.line_id IN(SELECT jsonb_array_elements_text(p_input->'lineIds'))) THEN
    PERFORM openerp.fail('IdempotencyConflict','A selected posted line already belongs to another carrying basis.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',l.account_id,'lineId',l.id,'ordinal',l.ordinal,
    'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text) ORDER BY l.ordinal),'[]'),
    coalesce(sum(l.debit_minor),0),coalesce(sum(l.credit_minor),0) INTO s_lines,s_debit,s_credit
    FROM openerp.journal_lines l WHERE l.book_id=s_book.id AND l.voucher_id=s_voucher.id
      AND l.id IN(SELECT jsonb_array_elements_text(p_input->'lineIds'));
  IF jsonb_array_length(s_lines)<>s_count OR s_debit<>s_cost OR s_credit<>s_accumulated
    OR EXISTS(SELECT FROM jsonb_array_elements(s_lines) l WHERE l->>'accountId'=s_schedule->'terms'->>'debitAccountId') THEN
    PERFORM openerp.fail('InvalidJournal','Selected control debits must equal original cost and credits accumulated recognition. Expense/debit schedule accounts are not carrying controls.'); END IF;
  s_body:=jsonb_build_object('scope',p_scope,'input',p_input,'scheduleDigest',s_schedule->>'digest',
    'sourceSha256',s_evidence.sha256,'reviewSha256',s_review.sha256,'voucherSequence',s_voucher.sequence::text,
    'currency',s_book.currency,'currencyScale',s_book.currency_scale,'lines',s_lines,
    'coverage','not_established','legalPolicyApproved',false)
    ||openerp.commerce_record_metadata(p_key,'record_subledger_basis',s_actor);
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  INSERT INTO openerp.subledger_bases VALUES(s_book.id,p_input->>'scheduleId',s_evidence.id,p_input->>'sourceLocator',s_voucher.id,s_body);
  INSERT INTO openerp.subledger_basis_lines SELECT s_book.id,p_input->>'scheduleId',s_voucher.id,x
    FROM jsonb_array_elements_text(p_input->'lineIds') x;
  RETURN openerp.save_command(s_book.id,p_key,s_actor,'record_subledger_basis',p_input,s_body);
END $$;

CREATE FUNCTION openerp.get_subledger_basis(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE s_body jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT b.body INTO s_body FROM openerp.subledger_bases b WHERE b.book_id=p_scope->>'bookId' AND b.schedule_id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','No carrying basis is retained for this schedule.'); END IF;
  RETURN s_body;
END $$;
CREATE FUNCTION openerp.list_subledger_bases(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE s_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(b.body ORDER BY b.schedule_id COLLATE "C"),'[]') INTO s_items
    FROM openerp.subledger_bases b WHERE b.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',s_items,'coverage','not_established');
END $$;

-- Caller holds the book barrier. Null means over-bound, never current or complete.
CREATE FUNCTION openerp.subledger_control_dependency_digest(p_book text) RETURNS text LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE s_body jsonb;
BEGIN
  IF (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_schedules s WHERE s.book_id=p_book LIMIT 201) x)>200
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.accounts a WHERE a.book_id=p_book LIMIT 1001) x)>1000
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.periods p WHERE p.book_id=p_book LIMIT 1001) x)>1000
    OR (SELECT count(*) FROM(SELECT 1 FROM openerp.subledger_preparations p WHERE p.book_id=p_book LIMIT 10001) x)>10000 THEN
    RETURN NULL; END IF;
  SELECT jsonb_build_object('sequence',b.committed_sequence::text,'profile',b.profile,'profileVersion',b.profile_version::text,
    'authority',b.authority,'writerEpoch',b.writer_epoch::text,'currency',b.currency,'currencyScale',b.currency_scale,
    'periods',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text,'locked',p.locked,'startsOn',p.starts_on,'endsOn',p.ends_on,'year',p.fiscal_year_id) ORDER BY p.id COLLATE "C")
      FROM openerp.periods p WHERE p.book_id=p_book),'[]'),
    'accounts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'version',a.version::text,'code',a.code,'name',a.name,'active',a.active) ORDER BY a.id COLLATE "C")
      FROM openerp.accounts a WHERE a.book_id=p_book),'[]'),
    'schedules',coalesce((SELECT jsonb_agg(openerp.subledger_current(p_book,s.id)->>'digest' ORDER BY s.id COLLATE "C")
      FROM openerp.subledger_schedules s WHERE s.book_id=p_book),'[]'),
    'bases',coalesce((SELECT jsonb_agg(x.body->>'digest' ORDER BY x.schedule_id COLLATE "C")
      FROM openerp.subledger_bases x WHERE x.book_id=p_book),'[]'),
    'preparations',coalesce((SELECT jsonb_agg(jsonb_build_array(p.schedule_id,p.ordinal,p.attempt,p.change_set_id)
      ORDER BY p.schedule_id COLLATE "C",p.ordinal,p.attempt) FROM openerp.subledger_preparations p WHERE p.book_id=p_book),'[]'))
    INTO s_body FROM openerp.books b WHERE b.id=p_book;
  RETURN openerp.digest(s_body);
END $$;

CREATE FUNCTION openerp.create_subledger_control(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE s_actor text; s_book openerp.books; s_previous jsonb; s_date date; s_digest text; s_evidence openerp.evidence;
  s_schedules jsonb; s_effects jsonb; s_lines jsonb; s_controls jsonb; s_body jsonb; s_content text;
  s_line_count integer; s_account_count integer; s_hash text; s_bytes integer;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT s_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(s_book.id,p_key,s_actor,'create_subledger_control',p_input);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  IF s_book.profile<>'synthetic-core-v1' OR s_book.authority<>'native' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only native synthetic schedule controls are implemented.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['asOfDate','accountIds','inventoryEvidenceId','rationale']);
  IF jsonb_typeof(p_input->'asOfDate') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'rationale') IS DISTINCT FROM 'string' OR length(btrim(p_input->>'rationale')) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(p_input->'inventoryEvidenceId') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the control date and evidence-backed account inventory rationale.'); END IF;
  s_date:=openerp.bank_date(p_input->>'asOfDate');
  SELECT * INTO s_evidence FROM openerp.evidence e WHERE e.book_id=s_book.id AND e.id=p_input->>'inventoryEvidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain evidence for the declared control accounts.'); END IF;
  IF jsonb_typeof(p_input->'accountIds') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Declare1–20 distinct control accounts.'); END IF;
  s_account_count:=jsonb_array_length(p_input->'accountIds');
  IF s_account_count NOT BETWEEN 1 AND 20 OR EXISTS(SELECT FROM jsonb_array_elements(p_input->'accountIds') a
    WHERE jsonb_typeof(a) IS DISTINCT FROM 'string' OR a#>>'{}' !~ '^[a-z][a-z0-9_-]{2,127}$')
    OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements_text(p_input->'accountIds') x)
    OR (SELECT count(*) FROM openerp.accounts a WHERE a.book_id=s_book.id
      AND a.id IN(SELECT jsonb_array_elements_text(p_input->'accountIds')))<>s_account_count THEN
    PERFORM openerp.fail('InvalidJournal','Declare distinct existing control accounts from this book. Inactive accounts remain reportable.'); END IF;
  s_digest:=openerp.subledger_control_dependency_digest(s_book.id);
  IF s_digest IS NULL THEN PERFORM openerp.fail('UnsupportedProfile','Control capture exceeds200 schedules,1000 book accounts/periods or10000 preparations. No partial snapshot was saved.'); END IF;
  IF (SELECT count(*) FROM openerp.subledger_control_snapshots c WHERE c.book_id=s_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book reached its200 retained control-snapshot bound.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('revision',r.body,'basis',b.body,'occurrences',o.states,
    'basisReversed',EXISTS(SELECT FROM openerp.vouchers rv WHERE rv.book_id=s_book.id AND rv.corrects_voucher_id=b.voucher_id
      AND rv.posting_date<=s_date AND rv.sequence<=s_book.committed_sequence),
    'recognizedMinor',recognized.amount::text,
    'carryingMinor',CASE WHEN b.body IS NULL OR (b.body->'input'->>'effectiveOn')::date>s_date
      OR EXISTS(SELECT FROM openerp.vouchers rv WHERE rv.book_id=s_book.id AND rv.corrects_voucher_id=b.voucher_id
        AND rv.posting_date<=s_date AND rv.sequence<=s_book.committed_sequence)
      THEN NULL ELSE ((b.body->'input'->>'carryingMinor')::numeric-recognized.amount)::text END)
    ORDER BY s.id COLLATE "C"),'[]') INTO s_schedules FROM openerp.subledger_schedules s
    CROSS JOIN LATERAL(SELECT openerp.subledger_current(s_book.id,s.id) body) r
    LEFT JOIN openerp.subledger_bases b ON b.book_id=s.book_id AND b.schedule_id=s.id
    CROSS JOIN LATERAL(SELECT openerp.subledger_occurrence_states(s_book.id,r.body,s_date) states) o
    CROSS JOIN LATERAL(SELECT coalesce(sum((x->>'amountMinor')::numeric),0) amount FROM jsonb_array_elements(o.states) x
      WHERE x->>'state'='posted') recognized WHERE s.book_id=s_book.id;
  IF EXISTS(SELECT FROM jsonb_array_elements(s_schedules) s
      WHERE NOT (p_input->'accountIds' ? (s->'revision'->'terms'->>'creditAccountId'))
        OR p_input->'accountIds' ? (s->'revision'->'terms'->>'debitAccountId'))
    OR EXISTS(SELECT FROM openerp.subledger_bases b CROSS JOIN LATERAL jsonb_array_elements(b.body->'lines') l
      WHERE b.book_id=s_book.id AND NOT (p_input->'accountIds' ? (l->>'accountId'))) THEN
    PERFORM openerp.fail('InvalidJournal','Declare every known basis account and schedule credit account, but no schedule expense/debit account. No account was silently omitted.'); END IF;

  -- Expected effects use retained basis amounts and fixed0700 occurrence ordinal2, not GL sums.
  WITH effects AS (
    SELECT b.schedule_id,'basis'::text kind,b.voucher_id,(l->>'ordinal')::integer ordinal,l->>'accountId' account_id,
      (l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric amount
      FROM openerp.subledger_bases b CROSS JOIN LATERAL jsonb_array_elements(b.body->'lines') l
      WHERE b.book_id=s_book.id AND (b.body->'input'->>'effectiveOn')::date<=s_date
    UNION ALL
    SELECT s->'revision'->>'scheduleId','occurrence',o->>'voucherId',2,s->'revision'->'terms'->>'creditAccountId',-(o->>'amountMinor')::numeric
      FROM jsonb_array_elements(s_schedules) s CROSS JOIN LATERAL jsonb_array_elements(s->'occurrences') o
      WHERE o->>'state' IN('posted','reversed')
    UNION ALL
    SELECT s->'revision'->>'scheduleId','occurrence_reversal',o->>'reversalVoucherId',2,s->'revision'->'terms'->>'creditAccountId',(o->>'amountMinor')::numeric
      FROM jsonb_array_elements(s_schedules) s CROSS JOIN LATERAL jsonb_array_elements(s->'occurrences') o WHERE o->>'state'='reversed'
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('scheduleId',e.schedule_id,'kind',e.kind,'voucherId',e.voucher_id,
      'ordinal',e.ordinal,'accountId',e.account_id,'expectedMinor',e.amount::text)
      ORDER BY e.schedule_id COLLATE "C",e.kind COLLATE "C",e.voucher_id COLLATE "C",e.ordinal),'[]') INTO s_effects FROM effects e;
  IF EXISTS(SELECT FROM jsonb_array_elements(s_effects) e GROUP BY e->>'voucherId',e->>'ordinal' HAVING count(*)>1) THEN
    PERFORM openerp.fail('InvalidJournal','Basis and occurrence effects claim the same posted line. No snapshot was saved.'); END IF;
  SELECT count(*) INTO s_line_count FROM(SELECT 1 FROM openerp.journal_lines l
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id WHERE l.book_id=s_book.id
      AND l.account_id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'))
      AND v.posting_date<=s_date AND v.sequence<=s_book.committed_sequence LIMIT 5001) bounded;
  IF s_line_count>5000 THEN PERFORM openerp.fail('UnsupportedProfile','Declared-account controls exceed5000 ledger lines. No partial snapshot was saved.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId',v.id,'lineId',l.id,'ordinal',l.ordinal,'sequence',v.sequence::text,
    'postingDate',v.posting_date::text,'accountId',l.account_id,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,
    'description',l.description,'correctsVoucherId',v.corrects_voucher_id,'evidenceRefs',v.action->'evidenceRefs',
    'scheduleId',e.body->>'scheduleId','effectKind',e.body->>'kind','expectedMinor',coalesce(e.body->>'expectedMinor','0'),
    'unexplainedMinor',(l.debit_minor-l.credit_minor-coalesce((e.body->>'expectedMinor')::numeric,0))::text)
    ORDER BY v.sequence,l.ordinal),'[]') INTO s_lines FROM openerp.journal_lines l
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    LEFT JOIN LATERAL(SELECT x body FROM jsonb_array_elements(s_effects) x WHERE x->>'voucherId'=v.id
      AND (x->>'ordinal')::integer=l.ordinal AND x->>'accountId'=l.account_id) e ON true
    WHERE l.book_id=s_book.id AND l.account_id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'))
      AND v.posting_date<=s_date AND v.sequence<=s_book.committed_sequence;
  IF jsonb_array_length(s_lines)<>s_line_count THEN PERFORM openerp.fail('InvalidJournal','Control contribution count changed. No partial report was saved.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',a.id,'code',a.code,'name',a.name,'version',a.version::text,'active',a.active,
    'expectedMinor',expected.amount::text,'ledgerMinor',ledger.amount::text,'differenceMinor',(ledger.amount-expected.amount)::text,
    'unexplainedLineCount',ledger.unexplained,
    'missingEffectCount',(SELECT count(*) FROM jsonb_array_elements(s_effects) e WHERE e->>'accountId'=a.id
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(s_lines) l WHERE l->>'voucherId'=e->>'voucherId'
        AND l->>'ordinal'=e->>'ordinal' AND l->>'accountId'=e->>'accountId')))
    ORDER BY a.id COLLATE "C"),'[]') INTO s_controls FROM openerp.accounts a
    CROSS JOIN LATERAL(SELECT coalesce(sum((e->>'expectedMinor')::numeric),0) amount
      FROM jsonb_array_elements(s_effects) e WHERE e->>'accountId'=a.id) expected
    CROSS JOIN LATERAL(SELECT coalesce(sum((l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric),0) amount,
      count(*) FILTER(WHERE (l->>'unexplainedMinor')::numeric<>0) unexplained
      FROM jsonb_array_elements(s_lines) l WHERE l->>'accountId'=a.id) ledger
    WHERE a.book_id=s_book.id AND a.id IN(SELECT jsonb_array_elements_text(p_input->'accountIds'));
  s_body:=jsonb_build_object('id',openerp.new_id('schedule_control'),'scope',p_scope,'kind','synthetic_subledger_control_v1',
    'input',p_input,'inventorySha256',s_evidence.sha256,'sequence',s_book.committed_sequence::text,
    'currency',s_book.currency,'currencyScale',s_book.currency_scale,'dependencyDigest',s_digest,
    'knowledgeBasis','current_known_facts_at_capture','coverage','not_established','financialCloseReady',false,
    'schedules',s_schedules,'expectedEffects',s_effects,'ledgerLines',s_lines,'controls',s_controls,
    'hasReviewGaps',jsonb_array_length(s_schedules)=0 OR EXISTS(SELECT FROM jsonb_array_elements(s_schedules) s
      WHERE s->'basis'='null'::jsonb OR (s->>'basisReversed')::boolean
        OR s->'basis'->>'scheduleDigest' IS DISTINCT FROM s->'revision'->>'digest'
        OR EXISTS(SELECT FROM jsonb_array_elements(s->'occurrences') o WHERE o->>'state'<>'posted'))
      OR EXISTS(SELECT FROM jsonb_array_elements(s_controls) c WHERE (c->>'differenceMinor')::numeric<>0
        OR (c->>'unexplainedLineCount')::integer<>0 OR (c->>'missingEffectCount')::integer<>0))
    ||openerp.commerce_record_metadata(p_key,'create_subledger_control',s_actor);
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  s_content:=openerp.canonical(s_body);
  s_bytes:=octet_length(convert_to(s_content,'UTF8'));
  IF s_bytes>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','The retained control JSON exceeds8MiB. No partial snapshot was saved.'); END IF;
  s_hash:=encode(sha256(convert_to(s_content,'UTF8')),'hex');
  INSERT INTO openerp.subledger_control_snapshots VALUES(s_book.id,s_body->>'id',s_body,s_content,s_hash,s_bytes);
  RETURN openerp.save_command(s_book.id,p_key,s_actor,'create_subledger_control',p_input,s_body);
END $$;
CREATE FUNCTION openerp.get_subledger_control(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE s_saved openerp.subledger_control_snapshots; s_digest text;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO s_saved FROM openerp.subledger_control_snapshots c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The schedule control snapshot was not found in this book.'); END IF;
  s_digest:=openerp.subledger_control_dependency_digest(p_scope->>'bookId');
  RETURN jsonb_build_object('snapshot',s_saved.body,'dependenciesCurrent',coalesce(s_saved.body->>'dependencyDigest'=s_digest,false),
    'artifact',jsonb_build_object('content',s_saved.content,'sha256',s_saved.sha256,'byteLength',s_saved.byte_length,'mediaType','application/json'));
END $$;
CREATE FUNCTION openerp.list_subledger_controls(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE s_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'createdAt',c.body->>'createdAt','asOfDate',c.body->'input'->>'asOfDate',
    'digest',c.body->>'digest','sequence',c.body->>'sequence','hasReviewGaps',c.body->'hasReviewGaps')
    ORDER BY c.body->>'createdAt' DESC,c.id COLLATE "C"),'[]') INTO s_items
    FROM openerp.subledger_control_snapshots c WHERE c.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',s_items,'coverage','not_established');
END $$;

-- Root may bind this entire body into closing/review-pack dependencies. No readiness is granted.
CREATE FUNCTION openerp.subledger_control_dependencies(p_book text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE s_digest text;
BEGIN
  s_digest:=openerp.subledger_control_dependency_digest(p_book);
  IF s_digest IS NULL THEN PERFORM openerp.fail('UnsupportedProfile','Schedule control dependencies exceed their bounded capture scope.'); END IF;
  RETURN jsonb_build_object('version','synthetic_subledger_controls_v1','basisDigest',s_digest,
    'basisCount',(SELECT count(*) FROM openerp.subledger_bases b WHERE b.book_id=p_book),
    'snapshotCount',(SELECT count(*) FROM openerp.subledger_control_snapshots c WHERE c.book_id=p_book),
    'missingBasisCount',(SELECT count(*) FROM openerp.subledger_schedules s WHERE s.book_id=p_book
      AND NOT EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=s.book_id AND b.schedule_id=s.id)),
    'coverageEstablished',false,'controlAccountReconciled',false,'financialCloseReady',false);
END $$;

REVOKE ALL ON openerp.subledger_bases,openerp.subledger_basis_lines,openerp.subledger_control_snapshots FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.subledger_basis_revision_guard(),openerp.subledger_control_dependency_digest(text),
  openerp.subledger_control_dependencies(text),
  openerp.record_subledger_basis(text,jsonb,text,jsonb),openerp.get_subledger_basis(text,jsonb,text),openerp.list_subledger_bases(text,jsonb),
  openerp.create_subledger_control(text,jsonb,text,jsonb),openerp.get_subledger_control(text,jsonb,text),openerp.list_subledger_controls(text,jsonb)
  FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.record_subledger_basis(text,jsonb,text,jsonb),openerp.get_subledger_basis(text,jsonb,text),
  openerp.list_subledger_bases(text,jsonb),openerp.create_subledger_control(text,jsonb,text,jsonb),
  openerp.get_subledger_control(text,jsonb,text),openerp.list_subledger_controls(text,jsonb) TO openerp_runtime;
