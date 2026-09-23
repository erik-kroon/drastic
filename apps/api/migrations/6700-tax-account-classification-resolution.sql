-- One-shot evidenced resolution of originally unknown tax-account classifications.
-- Original statements/events and all financial/matching capacity remain unchanged.
CREATE TABLE openerp.tax_account_classification_resolutions (
  book_id text NOT NULL, id text NOT NULL, event_id text NOT NULL, evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,event_id),
  FOREIGN KEY(book_id,event_id) REFERENCES openerp.tax_account_events(book_id,id),
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TRIGGER immutable_tax_account_classification_resolution BEFORE UPDATE OR DELETE
  ON openerp.tax_account_classification_resolutions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.tax_account_classification_resolutions FROM PUBLIC,openerp_runtime;

-- Resolve only the effective label. The embedded event is always the original retained row.
CREATE FUNCTION openerp.tax_account_event_classification(p_book text,p_event text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE t_body jsonb;
BEGIN
  SELECT jsonb_build_object('statementId',s.id,'statementDigest',s.body->>'digest',
    'event',s.body->'events'->(e.ordinal-1),'resolution',r.body,
    'effectiveClassification',coalesce(r.body->'input'->>'classification',s.body->'events'->(e.ordinal-1)->'input'->>'classification'))
    INTO t_body FROM openerp.tax_account_events e
    JOIN openerp.tax_account_statements s ON s.book_id=e.book_id AND s.id=e.statement_id
    LEFT JOIN openerp.tax_account_classification_resolutions r ON r.book_id=e.book_id AND r.event_id=e.id
    WHERE e.book_id=p_book AND e.id=p_event;
  IF t_body IS NULL THEN PERFORM openerp.fail('NotFound','The tax-account event is not in this book.'); END IF;
  RETURN t_body;
END $$;

CREATE FUNCTION openerp.resolve_tax_account_event_classification(token text,scope jsonb,event_id text,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_actor text;t_book text:=scope->>'bookId';t_previous jsonb;t_view jsonb;t_sha text;t_id text;t_body jsonb;
  t_request jsonb:=jsonb_build_object('eventId',event_id,'input',input);
BEGIN
  t_actor:=openerp.authorize(token,scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=t_book FOR UPDATE;
  t_previous:=openerp.replay(t_book,key,t_actor,'resolve_tax_account_event_classification',t_request);
  IF t_previous IS NOT NULL THEN RETURN t_previous; END IF;
  PERFORM openerp.bank_require_profile(t_book);
  PERFORM openerp.expense_tax_shape(input,ARRAY['expectedStatementDigest','classification','evidenceId','rationale']);
  IF event_id IS NULL OR event_id !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(input->'evidenceId') IS DISTINCT FROM 'string' OR input->>'evidenceId' !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(input->'expectedStatementDigest') IS DISTINCT FROM 'string'
    OR input->>'expectedStatementDigest' !~ '^sha256:[a-f0-9]{64}$' THEN
    PERFORM openerp.fail('InvalidJournal','Select the retained event, original statement digest and book-scoped review evidence.'); END IF;
  IF jsonb_typeof(input->'classification') IS DISTINCT FROM 'string'
    OR input->>'classification' NOT IN ('tax_charge','tax_credit','interest','payment','transfer','other') THEN
    PERFORM openerp.fail('InvalidJournal','Resolve unknown to one supported known classification. No financial or legal role is inferred.'); END IF;
  IF jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string' OR length(btrim(input->>'rationale')) NOT BETWEEN 1 AND 2000
    OR length(input->>'rationale')>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Retain the operator classification rationale.'); END IF;
  t_view:=openerp.tax_account_event_classification(t_book,event_id);
  IF t_view->>'statementDigest' IS DISTINCT FROM input->>'expectedStatementDigest' THEN
    PERFORM openerp.fail('StaleDependency','The selected statement digest differs from the retained source.'); END IF;
  IF t_view->'event'->'input'->>'classification' IS DISTINCT FROM 'unknown' THEN
    PERFORM openerp.fail('InvalidJournal','Only originally unknown events can receive a classification resolution.'); END IF;
  IF t_view->'resolution' IS DISTINCT FROM 'null'::jsonb THEN
    PERFORM openerp.fail('IdempotencyConflict','This event already has an immutable classification resolution. Read it or retry its original command key.'); END IF;
  SELECT e.sha256 INTO t_sha FROM openerp.evidence e WHERE e.book_id=t_book AND e.id=input->>'evidenceId';
  IF t_sha IS NULL THEN PERFORM openerp.fail('MissingEvidence','The classification review evidence is not retained in this book.'); END IF;
  IF (SELECT count(*) FROM openerp.tax_account_classification_resolutions r WHERE r.book_id=t_book)>=1000 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book supports1000 retained classification resolutions; none are truncated.'); END IF;
  t_id:=openerp.new_id('taxclassification');
  t_body:=jsonb_build_object('id',t_id,'scope',scope,'eventId',event_id,'statementId',t_view->>'statementId',
    'statementDigest',t_view->>'statementDigest','input',input,'evidenceSha256',t_sha)
    ||openerp.commerce_record_metadata(key,'resolve_tax_account_event_classification',t_actor);
  t_body:=t_body||jsonb_build_object('digest',openerp.digest(t_body));
  INSERT INTO openerp.tax_account_classification_resolutions VALUES(t_book,t_id,event_id,input->>'evidenceId',t_body);
  RETURN openerp.save_command(t_book,key,t_actor,'resolve_tax_account_event_classification',t_request,t_body);
END $$;

CREATE FUNCTION openerp.get_tax_account_event_classification(token text,scope jsonb,event_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  PERFORM openerp.authorize(token,scope);
  RETURN openerp.tax_account_event_classification(scope->>'bookId',event_id);
END $$;

-- Account/interval dependencies and whole-book closing use the same complete inventory.
-- An empty inventory contributes no fields, preserving untouched historical dependencies.
CREATE FUNCTION openerp.tax_account_classification_dependencies(p_book text,p_account text,p_starts date,p_ends date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE t_count integer;t_inventory jsonb;
BEGIN
  SELECT count(*) INTO t_count FROM (SELECT 1 FROM openerp.tax_account_classification_resolutions r
    WHERE r.book_id=p_book LIMIT 1001) bounded;
  IF t_count>1000 THEN RETURN NULL; END IF;
  SELECT count(*),coalesce(jsonb_agg(jsonb_build_object('id',r.id,'digest',r.body->>'digest')
    ORDER BY r.id COLLATE "C"),'[]') INTO t_count,t_inventory
    FROM openerp.tax_account_classification_resolutions r
    JOIN openerp.tax_account_events e ON e.book_id=r.book_id AND e.id=r.event_id
    JOIN openerp.tax_account_statements s ON s.book_id=e.book_id AND s.id=e.statement_id
    WHERE r.book_id=p_book AND (p_account IS NULL OR e.account_id=p_account)
      AND (p_starts IS NULL OR s.ends_on>=p_starts) AND (p_ends IS NULL OR s.starts_on<=p_ends);
  IF t_count=0 THEN RETURN '{}'::jsonb; END IF;
  RETURN jsonb_build_object('classificationResolutionCount',t_count,'classificationResolutionDigest',openerp.digest(t_inventory));
END $$;


CREATE OR REPLACE FUNCTION openerp.tax_account_match_basis(p_scope jsonb,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE t_book openerp.books;t_event openerp.tax_account_events;t_statement openerp.tax_account_statements;
  t_line openerp.journal_lines;t_voucher openerp.vouchers;t_account openerp.accounts;t_row jsonb;t_period jsonb;t_body jsonb;t_field text;t_classification jsonb;
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
  t_classification:=openerp.tax_account_event_classification(t_book.id,t_event.id);
  SELECT l.* INTO t_line FROM openerp.journal_lines l WHERE l.book_id=t_book.id AND l.voucher_id=p_input->>'voucherId' AND l.id=p_input->>'lineId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The posted voucher/line is not in this book.'); END IF;
  SELECT v.* INTO STRICT t_voucher FROM openerp.vouchers v WHERE v.book_id=t_book.id AND v.id=t_line.voucher_id;
  IF t_line.account_id<>t_event.account_id OR t_row->'input'->>'occurredOn'<>t_voucher.posting_date::text
    OR (t_row->'input'->>'amountMinor')::numeric<>t_line.debit_minor-t_line.credit_minor
    OR t_statement.body->'input'->>'currency' IS DISTINCT FROM t_book.currency
    OR t_statement.body->'input'->'currencyScale' IS DISTINCT FROM to_jsonb(t_book.currency_scale)
    OR t_classification->>'effectiveClassification'='unknown' THEN
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
  IF t_classification->'resolution' IS DISTINCT FROM 'null'::jsonb THEN
    t_body:=t_body||jsonb_build_object('classificationResolution',jsonb_build_object(
      'id',t_classification->'resolution'->>'id','digest',t_classification->'resolution'->>'digest',
      'eventId',t_event.id,'classification',t_classification->>'effectiveClassification'));
  END IF;
  RETURN t_body||jsonb_build_object('digest',openerp.digest(t_body));
END $$;

CREATE OR REPLACE FUNCTION openerp.tax_account_dependency_digest(p_book text,p_account text,p_starts date,p_ends date) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE t_basis jsonb;t_matching jsonb;t_classifications jsonb;
BEGIN
  SELECT jsonb_build_object('book',jsonb_build_object('sequence',b.committed_sequence::text,'profile',b.profile,'profileVersion',b.profile_version::text,
    'authority',b.authority,'writerEpoch',b.writer_epoch::text,'currency',b.currency,'currencyScale',b.currency_scale),
    'account',to_jsonb(a),'source',(SELECT to_jsonb(s) FROM openerp.tax_account_sources s WHERE s.book_id=p_book AND s.account_id=p_account),
    'statements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'digest',s.body->>'digest') ORDER BY s.id COLLATE "C")
      FROM openerp.tax_account_statements s WHERE s.book_id=p_book AND s.account_id=p_account AND s.starts_on<=p_ends AND s.ends_on>=p_starts),'[]'))
    INTO t_basis FROM openerp.books b JOIN openerp.accounts a ON a.book_id=b.id AND a.id=p_account WHERE b.id=p_book;
  t_matching:=openerp.tax_account_matching_dependencies(p_book);
  t_classifications:=openerp.tax_account_classification_dependencies(p_book,p_account,p_starts,p_ends);
  IF t_matching IS NULL OR t_classifications IS NULL THEN RETURN NULL; END IF;
  RETURN openerp.digest(t_basis||jsonb_build_object('matching',t_matching)||t_classifications);
END $$;

CREATE OR REPLACE FUNCTION openerp.tax_account_close_dependencies(book text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE t_statements integer; t_controls integer; t_statement_inventory jsonb; t_control_inventory jsonb; t_matching jsonb;t_classifications jsonb;
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
  t_classifications:=openerp.tax_account_classification_dependencies(book,NULL,NULL,NULL);
  IF t_matching IS NULL OR t_classifications IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('matching',t_matching,'statementCount',t_statements,'controlCount',t_controls,
    'statementInventoryDigest',openerp.digest(t_statement_inventory),
    'controlInventoryDigest',openerp.digest(t_control_inventory))||t_classifications;
END $$;

CREATE OR REPLACE FUNCTION openerp.create_tax_account_control(token text,scope jsonb,key text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE t_actor text; t_previous jsonb; t_book openerp.books; t_account openerp.accounts;
  t_starts date; t_ends date; t_cursor date; t_last_end date; t_last_id text; t_last_close numeric;
  t_statement openerp.tax_account_statements; t_statements jsonb:='[]'; t_gaps jsonb:='[]'; t_overlaps jsonb; t_breaks jsonb:='[]';
  t_source_open numeric; t_source_close numeric; t_source_movement numeric:=0; t_ledger_open numeric; t_ledger_move numeric; t_ledger_close numeric;
  t_lines jsonb; t_events jsonb:='[]'; t_unknown jsonb:='[]'; t_unmatched_lines jsonb; t_diagnostics jsonb:='["coverage_unestablished"]';
  t_matches jsonb;t_unmatched_pairs jsonb;t_body jsonb;t_resolutions jsonb:='[]';t_dependency text; t_content text; t_bytes integer; t_id text;
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
    WITH classified AS MATERIALIZED (
      SELECT e,openerp.tax_account_event_classification(t_book.id,e->>'id') AS state
        FROM jsonb_array_elements(t_statement.body->'events') e
    )
    SELECT t_unknown||coalesce(jsonb_agg(e->'id' ORDER BY (e->>'ordinal')::integer)
        FILTER(WHERE state->>'effectiveClassification'='unknown'),'[]'),
      t_resolutions||coalesce(jsonb_agg(jsonb_build_object('id',state->'resolution'->>'id',
        'digest',state->'resolution'->>'digest','eventId',e->>'id','classification',state->>'effectiveClassification')
        ORDER BY (e->>'ordinal')::integer) FILTER(WHERE state->'resolution' IS DISTINCT FROM 'null'::jsonb),'[]')
      INTO t_unknown,t_resolutions FROM classified;
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
  t_dependency:=openerp.tax_account_dependency_digest(t_book.id,t_account.id,t_starts,t_ends);
  IF t_dependency IS NULL THEN
    PERFORM openerp.fail('UnsupportedProfile','The complete tax-account dependency exceeds its bound. No control is truncated.'); END IF;
  t_id:=openerp.new_id('taxcontrol');
  t_body:=jsonb_build_object('id',t_id,'scope',scope,'input',input,'kind','synthetic_tax_account_gl_control_v3',
    'dependencyDigest',t_dependency,'classificationResolutions',t_resolutions,
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

REVOKE ALL ON FUNCTION openerp.tax_account_event_classification(text,text),
  openerp.tax_account_classification_dependencies(text,text,date,date),
  openerp.resolve_tax_account_event_classification(text,jsonb,text,text,jsonb),
  openerp.get_tax_account_event_classification(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.resolve_tax_account_event_classification(text,jsonb,text,text,jsonb),
  openerp.get_tax_account_event_classification(text,jsonb,text) TO openerp_runtime;
