-- Exact reviewed tax-account event/posted-line matching. No financial writes.
-- Forward-only over3800 and3950. Immutable history; a private reservation projection owns capacity.
CREATE TABLE openerp.tax_account_matches (
  book_id text NOT NULL, id text NOT NULL, event_id text NOT NULL, voucher_id text NOT NULL, line_id text NOT NULL,
  evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,id,event_id,voucher_id,line_id),
  FOREIGN KEY(book_id,event_id) REFERENCES openerp.tax_account_events(book_id,id),
  FOREIGN KEY(book_id,voucher_id,line_id) REFERENCES openerp.journal_lines,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.tax_account_unmatches (
  book_id text NOT NULL, id text NOT NULL, match_id text NOT NULL, evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,match_id),
  FOREIGN KEY(book_id,match_id) REFERENCES openerp.tax_account_matches,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.tax_account_match_capacity (
  book_id text NOT NULL, match_id text NOT NULL, event_id text NOT NULL, voucher_id text NOT NULL, line_id text NOT NULL,
  PRIMARY KEY(book_id,match_id), UNIQUE(book_id,event_id), UNIQUE(book_id,voucher_id,line_id),
  FOREIGN KEY(book_id,match_id,event_id,voucher_id,line_id)
    REFERENCES openerp.tax_account_matches(book_id,id,event_id,voucher_id,line_id)
);
CREATE TRIGGER immutable_tax_account_match BEFORE UPDATE OR DELETE ON openerp.tax_account_matches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_unmatch BEFORE UPDATE OR DELETE ON openerp.tax_account_unmatches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_capacity_identity BEFORE UPDATE ON openerp.tax_account_match_capacity FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.tax_account_matches,openerp.tax_account_unmatches,openerp.tax_account_match_capacity FROM PUBLIC,openerp_runtime;

-- Reuse effective bank/commerce owners: released allocations do not reserve capacity forever.
CREATE FUNCTION openerp.tax_account_line_claimed(p_book text,p_voucher text,p_line text) RETURNS boolean
LANGUAGE sql SET search_path=pg_catalog,openerp AS $$
  SELECT EXISTS(SELECT FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher AND m.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.bank_active_allocation_legs l WHERE l.book_id=p_book AND l.voucher_id=p_voucher AND l.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.voucher_id=p_voucher AND e.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher AND i.recognition_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line)
$$;
CREATE FUNCTION openerp.tax_account_open_period(p_book text,p_date date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE t_period openerp.periods;
BEGIN
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=p_book AND p_date BETWEEN p.starts_on AND p.ends_on ORDER BY p.id FOR SHARE;
  IF (SELECT count(*) FROM openerp.periods p WHERE p.book_id=p_book AND p_date BETWEEN p.starts_on AND p.ends_on)<>1 THEN
    PERFORM openerp.fail('UnsupportedProfile','The exact matched event/posting date must belong to one period.'); END IF;
  SELECT p.* INTO STRICT t_period FROM openerp.periods p WHERE p.book_id=p_book AND p_date BETWEEN p.starts_on AND p.ends_on;
  IF t_period.locked THEN PERFORM openerp.fail('PeriodLocked','Reopen the affected period explicitly before changing tax-account matching.'); END IF;
  RETURN jsonb_build_object('id',t_period.id,'version',t_period.version::text);
END $$;
CREATE FUNCTION openerp.tax_account_match_basis(p_scope jsonb,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE t_book openerp.books;t_event openerp.tax_account_events;t_statement openerp.tax_account_statements;
  t_line openerp.journal_lines;t_voucher openerp.vouchers;t_account openerp.accounts;t_row jsonb;t_period jsonb;t_body jsonb;t_field text;
BEGIN
  PERFORM openerp.expense_tax_shape(p_input,ARRAY['eventId','statementDigest','voucherId','lineId']);
  FOREACH t_field IN ARRAY ARRAY['eventId','voucherId','lineId'] LOOP
    IF jsonb_typeof(p_input->t_field) IS DISTINCT FROM 'string' OR p_input->>t_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select retained event and posted voucher/line identities.'); END IF;
  END LOOP;
  SELECT * INTO STRICT t_book FROM openerp.books b WHERE b.id=p_scope->>'bookId';
  PERFORM openerp.bank_require_profile(t_book.id);
  SELECT e.* INTO t_event FROM openerp.tax_account_events e WHERE e.book_id=t_book.id AND e.id=p_input->>'eventId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The tax-account event is not in this book.'); END IF;
  SELECT s.* INTO STRICT t_statement FROM openerp.tax_account_statements s WHERE s.book_id=t_book.id AND s.id=t_event.statement_id;
  IF t_statement.body->>'digest' IS DISTINCT FROM p_input->>'statementDigest' THEN
    PERFORM openerp.fail('StaleDependency','The selected statement digest differs from the retained source.'); END IF;
  t_row:=t_statement.body->'events'->(t_event.ordinal-1);
  SELECT l.* INTO t_line FROM openerp.journal_lines l WHERE l.book_id=t_book.id AND l.voucher_id=p_input->>'voucherId' AND l.id=p_input->>'lineId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The posted voucher/line is not in this book.'); END IF;
  SELECT v.* INTO STRICT t_voucher FROM openerp.vouchers v WHERE v.book_id=t_book.id AND v.id=t_line.voucher_id;
  IF t_line.account_id<>t_event.account_id OR t_row->'input'->>'occurredOn'<>t_voucher.posting_date::text
    OR (t_row->'input'->>'amountMinor')::numeric<>t_line.debit_minor-t_line.credit_minor
    OR t_statement.body->'input'->>'currency' IS DISTINCT FROM t_book.currency
    OR t_statement.body->'input'->'currencyScale' IS DISTINCT FROM to_jsonb(t_book.currency_scale)
    OR t_row->'input'->>'classification'='unknown' THEN
    PERFORM openerp.fail('InvalidJournal','Match only known-classified whole events to the same account, currency, date and exact signed posted amount.'); END IF;
  IF t_voucher.sequence>t_book.committed_sequence OR t_voucher.posting_purpose='reversal'
    OR EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=t_book.id AND r.corrects_voucher_id=t_voucher.id) THEN
    PERFORM openerp.fail('StaleDependency','Reversing, subsequently corrected or uncommitted vouchers cannot acquire tax-account capacity.'); END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=t_book.id AND
    (c.event_id=t_event.id OR (c.voucher_id=t_line.voucher_id AND c.line_id=t_line.id)))
    OR openerp.tax_account_line_claimed(t_book.id,t_line.voucher_id,t_line.id) THEN
    PERFORM openerp.fail('StaleDependency','The whole event or posted line already has active matching or source capacity.'); END IF;
  t_period:=openerp.tax_account_open_period(t_book.id,t_voucher.posting_date);
  SELECT a.* INTO STRICT t_account FROM openerp.accounts a WHERE a.book_id=t_book.id AND a.id=t_event.account_id;
  IF NOT t_account.active THEN PERFORM openerp.fail('StaleDependency','The selected account is inactive.'); END IF;
  t_body:=jsonb_build_object('scope',p_scope,'selection',p_input,'statementId',t_statement.id,'accountId',t_account.id,
    'accountVersion',t_account.version::text,'currency',t_book.currency,'currencyScale',t_book.currency_scale,
    'profileVersion',t_book.profile_version::text,'writerEpoch',t_book.writer_epoch::text,'period',t_period,'event',t_row,
    'sourceEvidenceId',t_statement.evidence_id,'sourceEvidenceSha256',t_statement.evidence_sha256,
    'line',jsonb_build_object('voucherId',t_voucher.id,'lineId',t_line.id,'ordinal',t_line.ordinal,'sequence',t_voucher.sequence::text,
      'postingDate',t_voucher.posting_date::text,'debitMinor',t_line.debit_minor::text,'creditMinor',t_line.credit_minor::text,
      'description',t_line.description,'postingPurpose',t_voucher.posting_purpose,'correctsVoucherId',t_voucher.corrects_voucher_id,
      'evidenceRefs',t_voucher.action->'evidenceRefs'));
  RETURN t_body||jsonb_build_object('digest',openerp.digest(t_body));
END $$;

-- Symmetric insertion fences without replacing any bank, owner or commerce owner function.
CREATE FUNCTION openerp.tax_account_guard_other_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_voucher text;t_line text;
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF TG_TABLE_NAME='commerce_invoices' THEN t_voucher:=NEW.recognition_voucher_id;t_line:=NEW.recognition_line_id;
  ELSIF TG_TABLE_NAME='commerce_allocation_legs' THEN t_voucher:=NEW.payment_voucher_id;t_line:=NEW.payment_line_id;
  ELSE t_voucher:=NEW.voucher_id;t_line:=NEW.line_id; END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=NEW.book_id AND c.voucher_id=t_voucher AND c.line_id=t_line) THEN
    PERFORM openerp.fail('StaleDependency','Explicitly unmatch the tax-account review before another register consumes this whole posted line.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_account_bank_match_capacity BEFORE INSERT ON openerp.bank_matches FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER tax_account_bank_allocation_capacity BEFORE INSERT ON openerp.bank_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER tax_account_owner_capacity BEFORE INSERT ON openerp.owner_effects FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER tax_account_invoice_capacity BEFORE INSERT ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE TRIGGER tax_account_payment_capacity BEFORE INSERT ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_other_capacity();
CREATE FUNCTION openerp.tax_account_guard_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=NEW.book_id AND c.voucher_id=NEW.corrects_voucher_id) THEN
      PERFORM openerp.fail('StaleDependency','Explicitly unmatch the evidenced tax-account relation before correcting this voucher.'); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_account_correction_capacity BEFORE INSERT ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_guard_correction();
CREATE FUNCTION openerp.tax_account_capacity_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_match openerp.tax_account_matches;t_basis jsonb;
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  SELECT m.* INTO STRICT t_match FROM openerp.tax_account_matches m WHERE m.book_id=NEW.book_id AND m.id=NEW.match_id;
  t_basis:=openerp.tax_account_match_basis(t_match.body->'scope',t_match.body->'input'->'selection');
  IF t_basis IS DISTINCT FROM t_match.body->'basis' OR t_match.event_id<>t_basis->'event'->>'id'
    OR t_match.voucher_id<>t_basis->'line'->>'voucherId' OR t_match.line_id<>t_basis->'line'->>'lineId' THEN
    PERFORM openerp.fail('StaleDependency','The exact retained match basis no longer admits this capacity.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_account_capacity_admission BEFORE INSERT ON openerp.tax_account_match_capacity FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_capacity_admission();
CREATE FUNCTION openerp.tax_account_capacity_conservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_book text;t_match text;
BEGIN
  IF TG_OP='DELETE' THEN t_book:=OLD.book_id;t_match:=OLD.match_id;
  ELSE t_book:=NEW.book_id;
    IF TG_TABLE_NAME='tax_account_matches' THEN t_match:=NEW.id;ELSE t_match:=NEW.match_id;END IF;
  END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=t_book AND c.match_id=t_match)
    = EXISTS(SELECT FROM openerp.tax_account_unmatches u WHERE u.book_id=t_book AND u.match_id=t_match) THEN
    PERFORM openerp.fail('StaleDependency','Every immutable review must have exactly one active reservation or one immutable unmatch, never both.'); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tax_account_match_conservation AFTER INSERT ON openerp.tax_account_matches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_capacity_conservation();
CREATE CONSTRAINT TRIGGER tax_account_unmatch_conservation AFTER INSERT ON openerp.tax_account_unmatches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_capacity_conservation();
CREATE CONSTRAINT TRIGGER tax_account_reservation_conservation AFTER INSERT OR DELETE ON openerp.tax_account_match_capacity DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.tax_account_capacity_conservation();

CREATE FUNCTION openerp.preview_tax_account_match(token text,scope jsonb,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  RETURN openerp.tax_account_match_basis(scope,input);
END $$;
CREATE FUNCTION openerp.match_tax_account_event(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_actor text;t_previous jsonb;t_book text:=scope->>'bookId';t_basis jsonb;t_sha text;t_id text;t_body jsonb;
BEGIN
  t_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=t_book FOR UPDATE;
  t_previous:=openerp.replay(t_book,key,t_actor,'match_tax_account_event',input);
  IF t_previous IS NOT NULL THEN RETURN t_previous; END IF;
  PERFORM openerp.expense_tax_shape(input,ARRAY['selection','expectedBasisDigest','evidenceId','rationale']);
  IF jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string' OR length(btrim(input->>'rationale')) NOT BETWEEN 1 AND 2000 OR length(input->>'rationale')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Retain the operator matching rationale.'); END IF;
  SELECT e.sha256 INTO t_sha FROM openerp.evidence e WHERE e.book_id=t_book AND e.id=input->>'evidenceId';
  IF t_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','The matching review evidence is not retained in this book.'); END IF;
  IF (SELECT count(*) FROM openerp.tax_account_matches m WHERE m.book_id=t_book)>=1000 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book supports1000 retained matching reviews; none are truncated.'); END IF;
  t_basis:=openerp.tax_account_match_basis(scope,input->'selection');
  IF t_basis->>'digest' IS DISTINCT FROM input->>'expectedBasisDigest' THEN
    PERFORM openerp.fail('StaleDependency','Read and review the current exact matching basis before execution.'); END IF;
  t_id:=openerp.new_id('taxmatch');
  t_body:=jsonb_build_object('id',t_id,'scope',scope,'input',input,'basis',t_basis,'evidenceSha256',t_sha)
    ||openerp.commerce_record_metadata(key,'match_tax_account_event',t_actor);
  t_body:=t_body||jsonb_build_object('digest',openerp.digest(t_body));
  INSERT INTO openerp.tax_account_matches VALUES(t_book,t_id,t_basis->'event'->>'id',t_basis->'line'->>'voucherId',t_basis->'line'->>'lineId',input->>'evidenceId',t_body);
  INSERT INTO openerp.tax_account_match_capacity VALUES(t_book,t_id,t_basis->'event'->>'id',t_basis->'line'->>'voucherId',t_basis->'line'->>'lineId');
  RETURN openerp.save_command(t_book,key,t_actor,'match_tax_account_event',input,t_body);
END $$;
CREATE FUNCTION openerp.unmatch_tax_account_event(token text,scope jsonb,key text,id text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_actor text;t_previous jsonb;t_book text:=scope->>'bookId';t_request jsonb:=jsonb_build_object('id',id,'input',input);
  t_match openerp.tax_account_matches;t_sha text;t_id text;t_body jsonb;
BEGIN
  t_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=t_book FOR UPDATE;
  t_previous:=openerp.replay(t_book,key,t_actor,'unmatch_tax_account_event',t_request);
  IF t_previous IS NOT NULL THEN RETURN t_previous; END IF;
  PERFORM openerp.bank_require_profile(t_book);
  PERFORM openerp.expense_tax_shape(input,ARRAY['expectedDigest','evidenceId','rationale']);
  SELECT m.* INTO t_match FROM openerp.tax_account_matches m WHERE m.book_id=t_book AND m.id=unmatch_tax_account_event.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The matching review is not in this book.'); END IF;
  IF t_match.body->>'digest' IS DISTINCT FROM input->>'expectedDigest' THEN
    PERFORM openerp.fail('StaleDependency','The selected immutable matching review differs.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.tax_account_match_capacity c WHERE c.book_id=t_book AND c.match_id=t_match.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This matching review was already unmatched. Read its history or retry its original command key.'); END IF;
  IF jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string' OR length(btrim(input->>'rationale')) NOT BETWEEN 1 AND 2000 OR length(input->>'rationale')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Retain the operator unmatching rationale.'); END IF;
  SELECT e.sha256 INTO t_sha FROM openerp.evidence e WHERE e.book_id=t_book AND e.id=input->>'evidenceId';
  IF t_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','The unmatching review evidence is not retained in this book.'); END IF;
  PERFORM openerp.tax_account_open_period(t_book,(t_match.body->'basis'->'event'->'input'->>'occurredOn')::date);
  t_id:=openerp.new_id('taxunmatch');
  t_body:=jsonb_build_object('id',t_id,'scope',scope,'matchId',t_match.id,'input',input,'evidenceSha256',t_sha)
    ||openerp.commerce_record_metadata(key,'unmatch_tax_account_event',t_actor);
  t_body:=t_body||jsonb_build_object('digest',openerp.digest(t_body));
  INSERT INTO openerp.tax_account_unmatches VALUES(t_book,t_id,t_match.id,input->>'evidenceId',t_body);
  DELETE FROM openerp.tax_account_match_capacity c WHERE c.book_id=t_book AND c.match_id=t_match.id;
  RETURN openerp.save_command(t_book,key,t_actor,'unmatch_tax_account_event',t_request,t_body);
END $$;

-- History and active reservation are distinct from current eligibility. No restored historical match is inferred.
CREATE FUNCTION openerp.tax_account_match_view(p_book text,p_id text) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog,openerp AS $$
  SELECT jsonb_build_object('match',m.body,'unmatch',u.body,'active',c.match_id IS NOT NULL,
    'usable',c.match_id IS NOT NULL AND a.active AND a.version::text=m.body->'basis'->>'accountVersion'
      AND b.profile='synthetic-core-v1' AND b.authority='native' AND b.profile_version::text=m.body->'basis'->>'profileVersion'
      AND b.writer_epoch::text=m.body->'basis'->>'writerEpoch' AND b.currency=m.body->'basis'->>'currency'
      AND to_jsonb(b.currency_scale)=m.body->'basis'->'currencyScale' AND v.sequence<=b.committed_sequence
      AND v.posting_purpose<>'reversal' AND NOT EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=p_book AND r.corrects_voucher_id=v.id)
      AND NOT openerp.tax_account_line_claimed(p_book,m.voucher_id,m.line_id))
    FROM openerp.tax_account_matches m JOIN openerp.books b ON b.id=m.book_id
    JOIN openerp.vouchers v ON v.book_id=m.book_id AND v.id=m.voucher_id
    JOIN openerp.accounts a ON a.book_id=m.book_id AND a.id=m.body->'basis'->>'accountId'
    LEFT JOIN openerp.tax_account_unmatches u ON u.book_id=m.book_id AND u.match_id=m.id
    LEFT JOIN openerp.tax_account_match_capacity c ON c.book_id=m.book_id AND c.match_id=m.id
    WHERE m.book_id=p_book AND m.id=p_id
$$;
CREATE FUNCTION openerp.get_tax_account_match(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_body jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  t_body:=openerp.tax_account_match_view(scope->>'bookId',id);
  IF t_body IS NULL THEN PERFORM openerp.fail('NotFound','The matching review is not in this book.'); END IF;
  RETURN t_body;
END $$;
CREATE FUNCTION openerp.list_tax_account_matches(token text,scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_items jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(openerp.tax_account_match_view(m.book_id,m.id) ORDER BY m.id COLLATE "C"),'[]') INTO t_items
    FROM openerp.tax_account_matches m WHERE m.book_id=scope->>'bookId';
  RETURN jsonb_build_object('items',t_items);
END $$;

-- Complete, bounded matching histories and separate live capacity/eligibility state.
CREATE FUNCTION openerp.tax_account_matching_dependencies(p_book text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE t_matches integer;t_unmatches integer;t_match_inventory jsonb;t_unmatch_inventory jsonb;t_active jsonb;
BEGIN
  SELECT count(*) INTO t_matches FROM (SELECT 1 FROM openerp.tax_account_matches m WHERE m.book_id=p_book LIMIT 1001) bounded;
  SELECT count(*) INTO t_unmatches FROM (SELECT 1 FROM openerp.tax_account_unmatches u WHERE u.book_id=p_book LIMIT 1001) bounded;
  IF t_matches>1000 OR t_unmatches>1000 THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'digest',m.body->>'digest') ORDER BY m.id COLLATE "C"),'[]')
    INTO t_match_inventory FROM openerp.tax_account_matches m WHERE m.book_id=p_book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'matchId',u.match_id,'digest',u.body->>'digest') ORDER BY u.id COLLATE "C"),'[]')
    INTO t_unmatch_inventory FROM openerp.tax_account_unmatches u WHERE u.book_id=p_book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'active',state->'active','usable',state->'usable',
    'corrections',coalesce((SELECT jsonb_agg(r.id ORDER BY r.id COLLATE "C") FROM openerp.vouchers r WHERE r.book_id=p_book AND r.corrects_voucher_id=m.voucher_id),'[]'))
    ORDER BY m.id COLLATE "C"),'[]') INTO t_active FROM openerp.tax_account_matches m
    CROSS JOIN LATERAL (SELECT openerp.tax_account_match_view(m.book_id,m.id) AS state) effective WHERE m.book_id=p_book;
  RETURN jsonb_build_object('matchCount',t_matches,'unmatchCount',t_unmatches,
    'matchInventoryDigest',openerp.digest(t_match_inventory),'unmatchInventoryDigest',openerp.digest(t_unmatch_inventory),'activeStateDigest',openerp.digest(t_active));
END $$;

CREATE OR REPLACE FUNCTION openerp.tax_account_close_dependencies(book text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE t_statements integer; t_controls integer; t_statement_inventory jsonb; t_control_inventory jsonb; t_matching jsonb;
BEGIN
  SELECT count(*) INTO t_statements FROM (SELECT 1 FROM openerp.tax_account_statements s
    WHERE s.book_id=book LIMIT 201) bounded;
  SELECT count(*) INTO t_controls FROM (SELECT 1 FROM openerp.tax_account_controls c
    WHERE c.book_id=book LIMIT 201) bounded;
  -- Null means unavailable complete dependency, never an empty or truncated inventory.
  -- Read consumers keep historical artifacts readable; preparation must fail closed.
  IF t_statements>200 OR t_controls>200 THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'digest',s.body->>'digest')
    ORDER BY s.id COLLATE "C"),'[]') INTO t_statement_inventory
    FROM openerp.tax_account_statements s WHERE s.book_id=book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'digest',c.body->>'digest',
    'sha256',c.sha256,'byteLength',c.byte_length) ORDER BY c.id COLLATE "C"),'[]') INTO t_control_inventory
    FROM openerp.tax_account_controls c WHERE c.book_id=book;
  t_matching:=openerp.tax_account_matching_dependencies(book);
  IF t_matching IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('matching',t_matching,'statementCount',t_statements,'controlCount',t_controls,
    'statementInventoryDigest',openerp.digest(t_statement_inventory),
    'controlInventoryDigest',openerp.digest(t_control_inventory));
END $$;

CREATE OR REPLACE FUNCTION openerp.tax_account_dependency_digest(p_book text,p_account text,p_starts date,p_ends date) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE t_basis jsonb;t_matching jsonb;
BEGIN
  SELECT jsonb_build_object('book',jsonb_build_object('sequence',b.committed_sequence::text,'profile',b.profile,'profileVersion',b.profile_version::text,
    'authority',b.authority,'writerEpoch',b.writer_epoch::text,'currency',b.currency,'currencyScale',b.currency_scale),
    'account',to_jsonb(a),'source',(SELECT to_jsonb(s) FROM openerp.tax_account_sources s WHERE s.book_id=p_book AND s.account_id=p_account),
    'statements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'digest',s.body->>'digest') ORDER BY s.id COLLATE "C")
      FROM openerp.tax_account_statements s WHERE s.book_id=p_book AND s.account_id=p_account AND s.starts_on<=p_ends AND s.ends_on>=p_starts),'[]'))
    INTO t_basis FROM openerp.books b JOIN openerp.accounts a ON a.book_id=b.id AND a.id=p_account WHERE b.id=p_book;
  t_matching:=openerp.tax_account_matching_dependencies(p_book);
  IF t_matching IS NULL THEN RETURN NULL; END IF;
  RETURN openerp.digest(t_basis||jsonb_build_object('matching',t_matching));
END $$;

CREATE OR REPLACE FUNCTION openerp.create_tax_account_control(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_actor text; t_previous jsonb; t_book openerp.books; t_account openerp.accounts;
  t_starts date; t_ends date; t_cursor date; t_last_end date; t_last_id text; t_last_close numeric;
  t_statement openerp.tax_account_statements; t_statements jsonb:='[]'; t_gaps jsonb:='[]'; t_overlaps jsonb; t_breaks jsonb:='[]';
  t_source_open numeric; t_source_close numeric; t_source_movement numeric:=0; t_ledger_open numeric; t_ledger_move numeric; t_ledger_close numeric;
  t_lines jsonb; t_events jsonb:='[]'; t_unknown jsonb:='[]'; t_unmatched_lines jsonb; t_diagnostics jsonb:='["coverage_unestablished"]';
  t_matches jsonb;t_unmatched_pairs jsonb;t_body jsonb; t_content text; t_bytes integer; t_id text;
BEGIN
  t_actor:=openerp.authorize(token,scope);
  SELECT * INTO STRICT t_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  t_previous:=openerp.replay(t_book.id,key,t_actor,'create_tax_account_control',input);
  IF t_previous IS NOT NULL THEN RETURN t_previous; END IF;
  PERFORM openerp.bank_require_profile(t_book.id);
  PERFORM openerp.expense_tax_shape(input,ARRAY['accountId','startsOn','endsOn']);
  t_starts:=openerp.bank_date(input->>'startsOn');t_ends:=openerp.bank_date(input->>'endsOn');t_cursor:=t_starts;
  IF t_starts>t_ends OR t_ends-t_starts>365 THEN PERFORM openerp.fail('InvalidJournal','Select an ordered control interval of at most366 days.'); END IF;
  SELECT a.* INTO t_account FROM openerp.accounts a WHERE a.book_id=t_book.id AND a.id=input->>'accountId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The selected account is not in this book.'); END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_statements s WHERE s.book_id=t_book.id AND s.account_id=t_account.id
    AND s.starts_on<=t_ends AND s.ends_on>=t_starts AND (s.starts_on<t_starts OR s.ends_on>t_ends)) THEN
    PERFORM openerp.fail('InvalidJournal','Use whole retained statement intervals. A partial source cannot establish opening and closing amounts.'); END IF;
  IF (SELECT count(*) FROM openerp.tax_account_controls c WHERE c.book_id=t_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book supports200 retained tax-account controls.'); END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.voucher_id)
    WHERE l.book_id=t_book.id AND l.account_id=t_account.id AND v.posting_date<=t_ends AND v.sequence<=t_book.committed_sequence LIMIT 5001) bounded)>5000 THEN
    PERFORM openerp.fail('UnsupportedProfile','The full selected-account GL through period end exceeds5000 lines. No opening history is omitted.'); END IF;
  FOR t_statement IN SELECT s.* FROM openerp.tax_account_statements s WHERE s.book_id=t_book.id AND s.account_id=t_account.id
    AND s.starts_on>=t_starts AND s.ends_on<=t_ends ORDER BY s.starts_on,s.ends_on,s.id COLLATE "C" LOOP
    IF t_statement.starts_on>t_cursor THEN t_gaps:=t_gaps||jsonb_build_array(jsonb_build_object('startsOn',t_cursor::text,'endsOn',(t_statement.starts_on-1)::text)); END IF;
    t_cursor:=greatest(t_cursor,t_statement.ends_on+1);
    IF t_last_end IS NULL THEN t_source_open:=(t_statement.body->'input'->>'openingMinor')::numeric;
    ELSIF t_statement.starts_on=t_last_end+1 AND (t_statement.body->'input'->>'openingMinor')::numeric<>t_last_close THEN
      t_breaks:=t_breaks||jsonb_build_array(jsonb_build_object('leftStatementId',t_last_id,'rightStatementId',t_statement.id,
        'differenceMinor',((t_statement.body->'input'->>'openingMinor')::numeric-t_last_close)::text));
    END IF;
    t_last_end:=t_statement.ends_on;t_last_id:=t_statement.id;t_last_close:=(t_statement.body->'input'->>'closingMinor')::numeric;
    t_source_close:=t_last_close;t_source_movement:=t_source_movement+(t_statement.body->>'movementMinor')::numeric;
    t_statements:=t_statements||jsonb_build_array(t_statement.body);
    t_events:=t_events||(SELECT coalesce(jsonb_agg(e->'id' ORDER BY (e->>'ordinal')::integer),'[]') FROM jsonb_array_elements(t_statement.body->'events') e);
    t_unknown:=t_unknown||(SELECT coalesce(jsonb_agg(e->'id' ORDER BY (e->>'ordinal')::integer),'[]') FROM jsonb_array_elements(t_statement.body->'events') e WHERE e->'input'->>'classification'='unknown');
  END LOOP;
  IF t_cursor<=t_ends THEN t_gaps:=t_gaps||jsonb_build_array(jsonb_build_object('startsOn',t_cursor::text,'endsOn',t_ends::text)); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('leftStatementId',a->>'id','rightStatementId',b->>'id') ORDER BY a->>'id' COLLATE "C",b->>'id' COLLATE "C"),'[]')
    INTO t_overlaps FROM jsonb_array_elements(t_statements) a CROSS JOIN jsonb_array_elements(t_statements) b
    WHERE (a->>'id') COLLATE "C"<(b->>'id') COLLATE "C" AND a->'input'->>'startsOn'<=b->'input'->>'endsOn' AND b->'input'->>'startsOn'<=a->'input'->>'endsOn';
  IF t_statements='[]'::jsonb THEN t_diagnostics:=t_diagnostics||'"missing_source"'::jsonb; END IF;
  IF t_gaps<>'[]'::jsonb THEN t_diagnostics:=t_diagnostics||'"source_gaps"'::jsonb; END IF;
  IF t_overlaps<>'[]'::jsonb THEN t_diagnostics:=t_diagnostics||'"source_overlaps"'::jsonb; END IF;
  IF t_breaks<>'[]'::jsonb THEN t_diagnostics:=t_diagnostics||'"source_balance_chain"'::jsonb; END IF;
  IF NOT t_account.active THEN t_diagnostics:=t_diagnostics||'"inactive_account"'::jsonb; END IF;
  IF t_unknown<>'[]'::jsonb THEN t_diagnostics:=t_diagnostics||'"unknown_classifications"'::jsonb; END IF;
  IF t_gaps<>'[]'::jsonb OR t_overlaps<>'[]'::jsonb OR t_breaks<>'[]'::jsonb THEN
    t_source_open:=NULL;t_source_close:=NULL;t_source_movement:=NULL;
  END IF;
  SELECT coalesce(sum(l.debit_minor-l.credit_minor) FILTER(WHERE v.posting_date<t_starts),0),
    coalesce(sum(l.debit_minor-l.credit_minor) FILTER(WHERE v.posting_date>=t_starts),0),coalesce(sum(l.debit_minor-l.credit_minor),0),
    coalesce(jsonb_agg(jsonb_build_object('voucherId',v.id,'lineId',l.id,'ordinal',l.ordinal,'sequence',v.sequence::text,'postingDate',v.posting_date::text,
      'part',CASE WHEN v.posting_date<t_starts THEN 'opening' ELSE 'movement' END,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,
      'amountMinor',(l.debit_minor-l.credit_minor)::text,'description',l.description,'postingPurpose',v.posting_purpose,'correctsVoucherId',v.corrects_voucher_id,
      'reversedByVoucherIds',coalesce((SELECT jsonb_agg(r.id ORDER BY r.id COLLATE "C") FROM openerp.vouchers r WHERE r.book_id=t_book.id AND r.corrects_voucher_id=v.id AND r.posting_purpose='reversal' AND r.sequence<=t_book.committed_sequence),'[]'))
      ORDER BY v.sequence,l.ordinal),'[]'),coalesce(jsonb_agg(l.id ORDER BY v.sequence,l.ordinal),'[]')
    INTO t_ledger_open,t_ledger_move,t_ledger_close,t_lines,t_unmatched_lines
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.voucher_id)
    WHERE l.book_id=t_book.id AND l.account_id=t_account.id AND v.posting_date<=t_ends AND v.sequence<=t_book.committed_sequence;
  IF t_source_open<>t_ledger_open OR t_source_movement<>t_ledger_move OR t_source_close<>t_ledger_close THEN
    t_diagnostics:=t_diagnostics||'"source_ledger_difference"'::jsonb; END IF;
  IF openerp.tax_account_matching_dependencies(t_book.id) IS NULL THEN
    PERFORM openerp.fail('UnsupportedProfile','The complete matching dependency exceeds its bound. No control is truncated.'); END IF;
  SELECT coalesce(jsonb_agg(openerp.tax_account_match_view(m.book_id,m.id) ORDER BY m.id COLLATE "C"),'[]') INTO t_matches
    FROM openerp.tax_account_matches m WHERE m.book_id=t_book.id AND m.body->'basis'->>'accountId'=t_account.id
      AND (m.body->'basis'->'event'->'input'->>'occurredOn')::date<=t_ends;
  SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality),'[]') INTO t_events
    FROM jsonb_array_elements(t_events) WITH ORDINALITY e(value,ordinality)
    WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(t_matches) matched WHERE matched->>'usable'='true'
      AND matched->'match'->'basis'->'event'->'id'=e.value);
  SELECT coalesce(jsonb_agg(line->'lineId' ORDER BY ordinal),'[]'),
    coalesce(jsonb_agg(jsonb_build_object('voucherId',line->>'voucherId','lineId',line->>'lineId') ORDER BY ordinal),'[]')
    INTO t_unmatched_lines,t_unmatched_pairs FROM jsonb_array_elements(t_lines) WITH ORDINALITY ledger(line,ordinal)
    WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(t_matches) matched WHERE matched->>'usable'='true'
      AND matched->'match'->'basis'->'line'->>'voucherId'=line->>'voucherId'
      AND matched->'match'->'basis'->'line'->>'lineId'=line->>'lineId');
  IF t_events<>'[]'::jsonb THEN t_diagnostics:=t_diagnostics||'"unmatched_events"'::jsonb; END IF;
  IF t_unmatched_pairs<>'[]'::jsonb THEN t_diagnostics:=t_diagnostics||'"unmatched_ledger_lines"'::jsonb; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(t_matches) matched WHERE matched->>'active'='true' AND matched->>'usable'<>'true') THEN
    t_diagnostics:=t_diagnostics||'"invalid_matches"'::jsonb; END IF;
  t_id:=openerp.new_id('taxcontrol');
  t_body:=jsonb_build_object('id',t_id,'scope',scope,'input',input,'kind','synthetic_tax_account_gl_control_v2',
    'dependencyDigest',openerp.tax_account_dependency_digest(t_book.id,t_account.id,t_starts,t_ends),
    'sequence',t_book.committed_sequence::text,'currency',t_book.currency,'currencyScale',t_book.currency_scale,
    'account',jsonb_build_object('id',t_account.id,'code',t_account.code,'name',t_account.name,'version',t_account.version::text,'active',t_account.active),
    'statements',t_statements,'ledgerLines',t_lines,'sourceGaps',t_gaps,'sourceOverlaps',t_overlaps,'balanceBreaks',t_breaks,
    'sourceOpeningMinor',t_source_open::text,'sourceMovementMinor',t_source_movement::text,'sourceClosingMinor',t_source_close::text,
    'ledgerOpeningMinor',t_ledger_open::text,'ledgerMovementMinor',t_ledger_move::text,'ledgerClosingMinor',t_ledger_close::text,
    'openingDifferenceMinor',(t_source_open-t_ledger_open)::text,'movementDifferenceMinor',(t_source_movement-t_ledger_move)::text,'closingDifferenceMinor',(t_source_close-t_ledger_close)::text,
    'matches',t_matches,'unmatchedLedgerLines',t_unmatched_pairs,'unmatchedEventIds',t_events,'unmatchedLedgerLineIds',t_unmatched_lines,'unknownClassificationEventIds',t_unknown,'diagnostics',t_diagnostics,
    'coverage','not_established','reconciled',false,'financialCloseReady',false,'taxReturnEffect','none')||openerp.commerce_record_metadata(key,'create_tax_account_control',t_actor);
  t_body:=t_body||jsonb_build_object('digest',openerp.digest(t_body));t_content:=openerp.canonical(t_body);t_bytes:=octet_length(convert_to(t_content,'UTF8'));
  IF t_bytes>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','The retained control exceeds8MiB. No partial control was saved.'); END IF;
  INSERT INTO openerp.tax_account_controls VALUES(t_book.id,t_id,t_body,t_content,encode(sha256(convert_to(t_content,'UTF8')),'hex'),t_bytes);
  RETURN openerp.save_command(t_book.id,key,t_actor,'create_tax_account_control',input,t_body);
END $$;

REVOKE ALL ON FUNCTION openerp.tax_account_line_claimed(text,text,text),
  openerp.tax_account_open_period(text,date),
  openerp.tax_account_match_basis(jsonb,jsonb),
  openerp.tax_account_guard_other_capacity(),
  openerp.tax_account_guard_correction(),
  openerp.tax_account_capacity_admission(),
  openerp.tax_account_capacity_conservation(),
  openerp.preview_tax_account_match(text,jsonb,jsonb),
  openerp.match_tax_account_event(text,jsonb,text,jsonb),
  openerp.unmatch_tax_account_event(text,jsonb,text,text,jsonb),
  openerp.tax_account_match_view(text,text),
  openerp.get_tax_account_match(text,jsonb,text),
  openerp.list_tax_account_matches(text,jsonb),
  openerp.tax_account_matching_dependencies(text),
  openerp.tax_account_close_dependencies(text),
  openerp.tax_account_dependency_digest(text,text,date,date),
  openerp.create_tax_account_control(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.preview_tax_account_match(text,jsonb,jsonb),
  openerp.match_tax_account_event(text,jsonb,text,jsonb),
  openerp.unmatch_tax_account_event(text,jsonb,text,text,jsonb),
  openerp.get_tax_account_match(text,jsonb,text),
  openerp.list_tax_account_matches(text,jsonb),
  openerp.create_tax_account_control(text,jsonb,text,jsonb) TO openerp_runtime;
