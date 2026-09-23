-- Synthetic tax-account source register and complete selected-account GL controls.
-- No row matching, ledger writes, tax facts, settlement, submission or close authority.
CREATE TABLE openerp.tax_account_sources (
  book_id text NOT NULL, account_id text NOT NULL, source_key text NOT NULL,
  PRIMARY KEY(book_id,account_id), UNIQUE(book_id,source_key),
  FOREIGN KEY(book_id,account_id) REFERENCES openerp.accounts(book_id,id)
);
CREATE TABLE openerp.tax_account_statements (
  book_id text NOT NULL, id text NOT NULL, account_id text NOT NULL, statement_key text NOT NULL,
  evidence_id text NOT NULL, review_evidence_id text NOT NULL, evidence_sha256 text NOT NULL, source_locator text NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,id,account_id), UNIQUE(book_id,account_id,statement_key),
  UNIQUE(book_id,account_id,evidence_sha256,source_locator), CHECK(starts_on<=ends_on),
  FOREIGN KEY(book_id,account_id) REFERENCES openerp.tax_account_sources,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  FOREIGN KEY(book_id,review_evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.tax_account_events (
  book_id text NOT NULL, id text NOT NULL, account_id text NOT NULL, event_key text NOT NULL,
  statement_id text NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 1000),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,account_id,event_key), UNIQUE(book_id,statement_id,ordinal),
  FOREIGN KEY(book_id,statement_id,account_id) REFERENCES openerp.tax_account_statements(book_id,id,account_id),
  FOREIGN KEY(book_id,account_id) REFERENCES openerp.tax_account_sources
);
CREATE TABLE openerp.tax_account_controls (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, body jsonb NOT NULL,
  content text NOT NULL, sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 8388608), PRIMARY KEY(book_id,id),
  CHECK(byte_length=octet_length(convert_to(content,'UTF8'))),
  CHECK(sha256=encode(sha256(convert_to(content,'UTF8')),'hex'))
);
CREATE TRIGGER immutable_tax_account_source BEFORE UPDATE OR DELETE ON openerp.tax_account_sources FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_statement BEFORE UPDATE OR DELETE ON openerp.tax_account_statements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_event BEFORE UPDATE OR DELETE ON openerp.tax_account_events FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_tax_account_control BEFORE UPDATE OR DELETE ON openerp.tax_account_controls FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.tax_account_sources,openerp.tax_account_statements,openerp.tax_account_events,openerp.tax_account_controls FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.record_tax_account_statement(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_actor text; t_previous jsonb; t_book openerp.books; t_field text; t_source text;
  t_sha text; t_review_sha text; t_starts date; t_ends date; t_row jsonb; t_movement numeric:=0;
  t_body jsonb; t_events jsonb:='[]'; t_ordinal integer:=0; t_id text;
BEGIN
  t_actor:=openerp.authorize(token,scope,true);
  SELECT * INTO STRICT t_book FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
  t_previous:=openerp.replay(t_book.id,key,t_actor,'record_tax_account_statement',input);
  IF t_previous IS NOT NULL THEN RETURN t_previous; END IF;
  PERFORM openerp.bank_require_profile(t_book.id);
  PERFORM openerp.expense_tax_shape(input,ARRAY['recordClass','balanceConvention','accountId','sourceAccountKey','statementKey','evidenceId','sourceLocator','reviewEvidenceId','rationale','currency','currencyScale','startsOn','endsOn','openingMinor','closingMinor','rows']);
  IF input->>'recordClass' IS DISTINCT FROM 'synthetic' OR input->>'balanceConvention' IS DISTINCT FROM 'debit_minus_credit'
    OR input->>'currency' IS DISTINCT FROM t_book.currency
    OR input->'currencyScale' IS DISTINCT FROM to_jsonb(t_book.currency_scale) THEN
    PERFORM openerp.fail('UnsupportedProfile','Use explicit synthetic records in this native book currency and scale. No conversion or legal profile is inferred.'); END IF;
  FOREACH t_field IN ARRAY ARRAY['accountId','evidenceId','reviewEvidenceId'] LOOP
    IF jsonb_typeof(input->t_field) IS DISTINCT FROM 'string' OR input->>t_field !~ '^[a-z][a-z0-9_-]{2,127}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select book-scoped account and evidence identifiers.'); END IF;
  END LOOP;
  FOREACH t_field IN ARRAY ARRAY['sourceAccountKey','statementKey'] LOOP
    IF jsonb_typeof(input->t_field) IS DISTINCT FROM 'string' OR input->>t_field !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
      PERFORM openerp.fail('InvalidJournal','Retain stable source-account and statement keys.'); END IF;
  END LOOP;
  FOREACH t_field IN ARRAY ARRAY['sourceLocator','rationale'] LOOP
    IF jsonb_typeof(input->t_field) IS DISTINCT FROM 'string' OR length(btrim(input->>t_field)) NOT BETWEEN 1 AND 2000 OR length(input->>t_field)>2000 THEN
      PERFORM openerp.fail('InvalidJournal','Retain the source locator and operator classification rationale.'); END IF;
  END LOOP;
  IF length(input->>'sourceLocator')>256 THEN PERFORM openerp.fail('InvalidJournal','Source locators are bounded at256 characters.'); END IF;
  FOREACH t_field IN ARRAY ARRAY['openingMinor','closingMinor'] LOOP
    IF jsonb_typeof(input->t_field) IS DISTINCT FROM 'string' OR input->>t_field !~ '^(0|-?[1-9][0-9]{0,37})$' THEN
      PERFORM openerp.fail('InvalidJournal','Use canonical signed integer amounts of at most38 digits.'); END IF;
  END LOOP;
  t_starts:=openerp.bank_date(input->>'startsOn'); t_ends:=openerp.bank_date(input->>'endsOn');
  IF t_starts>t_ends OR t_ends-t_starts>365 THEN PERFORM openerp.fail('InvalidJournal','Select an ordered source interval of at most366 days.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=t_book.id AND a.id=input->>'accountId' AND a.active) THEN
    PERFORM openerp.fail('NotFound','Select an active account in this book. Its legal tax-account role is not inferred.'); END IF;
  SELECT e.sha256 INTO t_sha FROM openerp.evidence e WHERE e.book_id=t_book.id AND e.id=input->>'evidenceId';
  SELECT e.sha256 INTO t_review_sha FROM openerp.evidence e WHERE e.book_id=t_book.id AND e.id=input->>'reviewEvidenceId';
  IF t_sha IS NULL OR t_review_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','Retain source and operator-review evidence in this book.'); END IF;
  SELECT s.body INTO t_previous FROM openerp.tax_account_statements s WHERE s.book_id=t_book.id AND s.account_id=input->>'accountId' AND s.statement_key=input->>'statementKey';
  IF t_previous IS NOT NULL THEN
    IF t_previous->'input' IS DISTINCT FROM input THEN PERFORM openerp.fail('IdempotencyConflict','This source statement key already identifies different immutable content.'); END IF;
    RETURN openerp.save_command(t_book.id,key,t_actor,'record_tax_account_statement',input,t_previous);
  END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_statements s WHERE s.book_id=t_book.id AND s.account_id=input->>'accountId' AND s.evidence_sha256=t_sha AND s.source_locator=input->>'sourceLocator') THEN
    PERFORM openerp.fail('IdempotencyConflict','This retained source component already has a statement identity. Read that statement instead.'); END IF;
  IF jsonb_typeof(input->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'rows')>1000 THEN
    PERFORM openerp.fail('UnsupportedProfile','A statement supports at most1000 complete rows; empty movements must be explicit.'); END IF;
  IF (SELECT count(*) FROM openerp.tax_account_statements s WHERE s.book_id=t_book.id)>=200
    OR (SELECT count(*) FROM openerp.tax_account_events e WHERE e.book_id=t_book.id)+jsonb_array_length(input->'rows')>10000 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book supports200 retained statements and10000 events; nothing is truncated.'); END IF;
  FOR t_row IN SELECT value FROM jsonb_array_elements(input->'rows') LOOP
    PERFORM openerp.expense_tax_shape(t_row,ARRAY['eventKey','occurredOn','amountMinor','classification','description']);
    IF jsonb_typeof(t_row->'eventKey') IS DISTINCT FROM 'string' OR t_row->>'eventKey' !~ '^[a-zA-Z0-9_-]{1,128}$'
      OR jsonb_typeof(t_row->'amountMinor') IS DISTINCT FROM 'string' OR t_row->>'amountMinor' !~ '^(0|-?[1-9][0-9]{0,37})$'
      OR coalesce(t_row->>'classification','') NOT IN ('unknown','tax_charge','tax_credit','interest','payment','transfer','other')
      OR jsonb_typeof(t_row->'description') IS DISTINCT FROM 'string' OR length(btrim(t_row->>'description')) NOT BETWEEN 1 AND 2000 OR length(t_row->>'description')>2000 THEN
      PERFORM openerp.fail('InvalidJournal','Each row needs a stable event key, exact signed amount, explicit classification and description.'); END IF;
    IF openerp.bank_date(t_row->>'occurredOn') NOT BETWEEN t_starts AND t_ends THEN
      PERFORM openerp.fail('InvalidJournal','Every event date must be inside its complete statement interval.'); END IF;
    IF EXISTS(SELECT FROM openerp.tax_account_events e WHERE e.book_id=t_book.id AND e.account_id=input->>'accountId' AND e.event_key=t_row->>'eventKey')
      OR EXISTS(SELECT FROM jsonb_array_elements(t_events) e WHERE e->'input'->>'eventKey'=t_row->>'eventKey') THEN
      PERFORM openerp.fail('IdempotencyConflict','An event key repeats within this source account. Retention cannot recognize it twice.'); END IF;
    t_movement:=t_movement+(t_row->>'amountMinor')::numeric; t_ordinal:=t_ordinal+1;
    t_events:=t_events||jsonb_build_array(jsonb_build_object('id',openerp.new_id('taxevent'),'ordinal',t_ordinal,'input',t_row));
  END LOOP;
  IF (input->>'openingMinor')::numeric+t_movement<>(input->>'closingMinor')::numeric THEN
    PERFORM openerp.fail('InvalidJournal','The exact opening plus all signed movements must equal closing. No balancing event is invented.'); END IF;
  SELECT s.source_key INTO t_source FROM openerp.tax_account_sources s WHERE s.book_id=t_book.id AND s.account_id=input->>'accountId';
  IF t_source IS NOT NULL AND t_source IS DISTINCT FROM input->>'sourceAccountKey' THEN
    PERFORM openerp.fail('IdempotencyConflict','The selected account already has another immutable source identity.'); END IF;
  IF EXISTS(SELECT FROM openerp.tax_account_sources s WHERE s.book_id=t_book.id AND s.source_key=input->>'sourceAccountKey' AND s.account_id<>input->>'accountId') THEN
    PERFORM openerp.fail('IdempotencyConflict','This tax-account source is already mapped to another book account.'); END IF;
  IF t_source IS NULL THEN
    IF (SELECT count(*) FROM openerp.tax_account_sources s WHERE s.book_id=t_book.id)>=20 THEN PERFORM openerp.fail('UnsupportedProfile','This synthetic register supports20 source accounts.'); END IF;
    INSERT INTO openerp.tax_account_sources VALUES(t_book.id,input->>'accountId',input->>'sourceAccountKey');
  END IF;
  t_id:=openerp.new_id('taxstatement');
  t_body:=jsonb_build_object('id',t_id,'scope',scope,'input',input,'evidenceSha256',t_sha,'reviewEvidenceSha256',t_review_sha,
    'movementMinor',t_movement::text,'events',t_events,'coverage','not_established','taxReturnEffect','none')||openerp.commerce_record_metadata(key,'record_tax_account_statement',t_actor);
  t_body:=t_body||jsonb_build_object('digest',openerp.digest(t_body));
  INSERT INTO openerp.tax_account_statements VALUES(t_book.id,t_id,input->>'accountId',input->>'statementKey',input->>'evidenceId',input->>'reviewEvidenceId',t_sha,input->>'sourceLocator',t_starts,t_ends,t_body);
  INSERT INTO openerp.tax_account_events SELECT t_book.id,e->>'id',input->>'accountId',e->'input'->>'eventKey',t_id,(e->>'ordinal')::integer FROM jsonb_array_elements(t_events) e;
  RETURN openerp.save_command(t_book.id,key,t_actor,'record_tax_account_statement',input,t_body);
END $$;

-- Caller holds the book barrier. A whole-book sequence conservatively captures any later posting/correction.
CREATE FUNCTION openerp.tax_account_dependency_digest(p_book text,p_account text,p_starts date,p_ends date) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE t_basis jsonb;
BEGIN
  SELECT jsonb_build_object('book',jsonb_build_object('sequence',b.committed_sequence::text,'profile',b.profile,'profileVersion',b.profile_version::text,
    'authority',b.authority,'writerEpoch',b.writer_epoch::text,'currency',b.currency,'currencyScale',b.currency_scale),
    'account',to_jsonb(a),'source',(SELECT to_jsonb(s) FROM openerp.tax_account_sources s WHERE s.book_id=p_book AND s.account_id=p_account),
    'statements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'digest',s.body->>'digest') ORDER BY s.id COLLATE "C")
      FROM openerp.tax_account_statements s WHERE s.book_id=p_book AND s.account_id=p_account AND s.starts_on<=p_ends AND s.ends_on>=p_starts),'[]'))
    INTO t_basis FROM openerp.books b JOIN openerp.accounts a ON a.book_id=b.id AND a.id=p_account WHERE b.id=p_book;
  RETURN openerp.digest(t_basis);
END $$;

CREATE FUNCTION openerp.create_tax_account_control(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_actor text; t_previous jsonb; t_book openerp.books; t_account openerp.accounts;
  t_starts date; t_ends date; t_cursor date; t_last_end date; t_last_id text; t_last_close numeric;
  t_statement openerp.tax_account_statements; t_statements jsonb:='[]'; t_gaps jsonb:='[]'; t_overlaps jsonb; t_breaks jsonb:='[]';
  t_source_open numeric; t_source_close numeric; t_source_movement numeric:=0; t_ledger_open numeric; t_ledger_move numeric; t_ledger_close numeric;
  t_lines jsonb; t_events jsonb:='[]'; t_unknown jsonb:='[]'; t_unmatched_lines jsonb; t_diagnostics jsonb:='["row_matching_unavailable","coverage_unestablished"]';
  t_body jsonb; t_content text; t_bytes integer; t_id text;
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
  t_id:=openerp.new_id('taxcontrol');
  t_body:=jsonb_build_object('id',t_id,'scope',scope,'input',input,'kind','synthetic_tax_account_gl_control_v1',
    'dependencyDigest',openerp.tax_account_dependency_digest(t_book.id,t_account.id,t_starts,t_ends),
    'sequence',t_book.committed_sequence::text,'currency',t_book.currency,'currencyScale',t_book.currency_scale,
    'account',jsonb_build_object('id',t_account.id,'code',t_account.code,'name',t_account.name,'version',t_account.version::text,'active',t_account.active),
    'statements',t_statements,'ledgerLines',t_lines,'sourceGaps',t_gaps,'sourceOverlaps',t_overlaps,'balanceBreaks',t_breaks,
    'sourceOpeningMinor',t_source_open::text,'sourceMovementMinor',t_source_movement::text,'sourceClosingMinor',t_source_close::text,
    'ledgerOpeningMinor',t_ledger_open::text,'ledgerMovementMinor',t_ledger_move::text,'ledgerClosingMinor',t_ledger_close::text,
    'openingDifferenceMinor',(t_source_open-t_ledger_open)::text,'movementDifferenceMinor',(t_source_movement-t_ledger_move)::text,'closingDifferenceMinor',(t_source_close-t_ledger_close)::text,
    'unmatchedEventIds',t_events,'unmatchedLedgerLineIds',t_unmatched_lines,'unknownClassificationEventIds',t_unknown,'diagnostics',t_diagnostics,
    'coverage','not_established','reconciled',false,'financialCloseReady',false,'taxReturnEffect','none')||openerp.commerce_record_metadata(key,'create_tax_account_control',t_actor);
  t_body:=t_body||jsonb_build_object('digest',openerp.digest(t_body));t_content:=openerp.canonical(t_body);t_bytes:=octet_length(convert_to(t_content,'UTF8'));
  IF t_bytes>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','The retained control exceeds8MiB. No partial control was saved.'); END IF;
  INSERT INTO openerp.tax_account_controls VALUES(t_book.id,t_id,t_body,t_content,encode(sha256(convert_to(t_content,'UTF8')),'hex'),t_bytes);
  RETURN openerp.save_command(t_book.id,key,t_actor,'create_tax_account_control',input,t_body);
END $$;

CREATE FUNCTION openerp.get_tax_account_statement(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_body jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  SELECT s.body INTO t_body FROM openerp.tax_account_statements s WHERE s.book_id=scope->>'bookId' AND s.id=get_tax_account_statement.id;
  IF t_body IS NULL THEN PERFORM openerp.fail('NotFound','The tax-account statement is not in this book.'); END IF;
  RETURN t_body;
END $$;
CREATE FUNCTION openerp.list_tax_account_statements(token text,scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_items jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'digest',s.body->>'digest','accountId',s.account_id,
    'sourceAccountKey',s.body->'input'->>'sourceAccountKey','statementKey',s.statement_key,'startsOn',s.starts_on::text,'endsOn',s.ends_on::text,
    'createdAt',s.body->>'createdAt') ORDER BY s.starts_on DESC,s.id COLLATE "C"),'[]') INTO t_items FROM openerp.tax_account_statements s WHERE s.book_id=scope->>'bookId';
  RETURN jsonb_build_object('items',t_items);
END $$;
CREATE FUNCTION openerp.get_tax_account_control(token text,scope jsonb,id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_saved openerp.tax_account_controls;t_input jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT c.* INTO t_saved FROM openerp.tax_account_controls c WHERE c.book_id=scope->>'bookId' AND c.id=get_tax_account_control.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The tax-account control is not in this book.'); END IF;
  t_input:=t_saved.body->'input';
  RETURN jsonb_build_object('snapshot',t_saved.body,'dependenciesCurrent',coalesce(t_saved.body->>'dependencyDigest'=openerp.tax_account_dependency_digest(scope->>'bookId',t_input->>'accountId',(t_input->>'startsOn')::date,(t_input->>'endsOn')::date),false),
    'artifact',jsonb_build_object('content',t_saved.content,'sha256',t_saved.sha256,'byteLength',t_saved.byte_length,'mediaType','application/json'));
END $$;
CREATE FUNCTION openerp.list_tax_account_controls(token text,scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_items jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'digest',c.body->>'digest','input',c.body->'input','createdAt',c.body->>'createdAt')
    ORDER BY c.body->>'createdAt' DESC,c.id COLLATE "C"),'[]') INTO t_items FROM openerp.tax_account_controls c WHERE c.book_id=scope->>'bookId';
  RETURN jsonb_build_object('items',t_items);
END $$;
REVOKE ALL ON FUNCTION openerp.tax_account_dependency_digest(text,text,date,date),openerp.record_tax_account_statement(text,jsonb,text,jsonb),
  openerp.get_tax_account_statement(text,jsonb,text),openerp.list_tax_account_statements(text,jsonb),openerp.create_tax_account_control(text,jsonb,text,jsonb),
  openerp.get_tax_account_control(text,jsonb,text),openerp.list_tax_account_controls(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.record_tax_account_statement(text,jsonb,text,jsonb),openerp.get_tax_account_statement(text,jsonb,text),
  openerp.list_tax_account_statements(text,jsonb),openerp.create_tax_account_control(text,jsonb,text,jsonb),openerp.get_tax_account_control(text,jsonb,text),
  openerp.list_tax_account_controls(text,jsonb) TO openerp_runtime;
