-- Diagnostic source coverage only. Reuses0930 inventory; does not change closing or reconciliation gates.
CREATE TABLE openerp.bank_source_coverage_reports (
  book_id text NOT NULL REFERENCES openerp.books,id text NOT NULL,inventory_id text NOT NULL,
  body jsonb NOT NULL,content text NOT NULL,sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 8388608),PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,inventory_id) REFERENCES openerp.closing_inventories(book_id,id)
);
CREATE TRIGGER immutable_bank_source_coverage BEFORE UPDATE OR DELETE ON openerp.bank_source_coverage_reports
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
REVOKE ALL ON openerp.bank_source_coverage_reports FROM PUBLIC,openerp_runtime;

-- Caller holds the book barrier. Null means the live dependency scope is unavailable/oversized.
CREATE FUNCTION openerp.bank_source_coverage_dependency_digest(p_book text,p_inventory text) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE c_inventory openerp.closing_inventories; c_period openerp.periods; c_ids text[]; c_count integer;
  c_accounts jsonb; c_statements jsonb; c_book openerp.books; c_latest jsonb;
BEGIN
  SELECT * INTO c_inventory FROM openerp.closing_inventories i WHERE i.book_id=p_book AND i.id=p_inventory;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c_period FROM openerp.periods p WHERE p.book_id=p_book AND p.id=c_inventory.period_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT c_book FROM openerp.books b WHERE b.id=p_book;
  SELECT array_agg(account_id ORDER BY account_id COLLATE "C") INTO c_ids FROM (
    SELECT jsonb_array_elements_text(c_inventory.body->'bankAccountIds') account_id
    UNION SELECT s.account_id FROM openerp.bank_sources s WHERE s.book_id=p_book LIMIT 101
  ) bounded;
  IF coalesce(cardinality(c_ids),0)>100 THEN RETURN NULL; END IF;
  IF EXISTS(SELECT FROM unnest(c_ids) selected(account_id)
    WHERE NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=selected.account_id)) THEN RETURN NULL; END IF;
  SELECT count(*) INTO c_count FROM (SELECT 1 FROM openerp.bank_statements s WHERE s.book_id=p_book
    AND s.account_id=ANY(c_ids) AND s.starts_on<=c_period.ends_on AND s.ends_on>=c_period.starts_on LIMIT 201) bounded;
  IF c_count>200 THEN RETURN NULL; END IF;
  IF (SELECT coalesce(sum(jsonb_array_length(s.source->'rows')),0) FROM openerp.bank_statements s
    WHERE s.book_id=p_book AND s.account_id=ANY(c_ids) AND s.starts_on<=c_period.ends_on AND s.ends_on>=c_period.starts_on)>10000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.bank_observations o JOIN openerp.bank_statements s
      ON (s.book_id,s.id)=(o.book_id,o.statement_id) WHERE s.book_id=p_book AND s.account_id=ANY(c_ids)
      AND s.starts_on<=c_period.ends_on AND s.ends_on>=c_period.starts_on LIMIT 10001) bounded)>10000 THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',a.id,'code',a.code,'name',a.name,
    'active',a.active,'version',a.version::text,'sourceBankAccountId',s.source_bank_account_id,'sourceRevision',s.revision::text)
    ORDER BY a.id COLLATE "C"),'[]') INTO c_accounts FROM openerp.accounts a LEFT JOIN openerp.bank_sources s
    ON (s.book_id,s.account_id)=(a.book_id,a.id) WHERE a.book_id=p_book AND a.id=ANY(c_ids);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'accountId',s.account_id,'startsOn',s.starts_on::text,
    'endsOn',s.ends_on::text,'evidenceId',s.evidence_id,'evidenceSha256',e.sha256) ORDER BY s.id COLLATE "C"),'[]')
    INTO c_statements FROM openerp.bank_statements s JOIN openerp.evidence e ON (e.book_id,e.id)=(s.book_id,s.evidence_id)
    WHERE s.book_id=p_book AND s.account_id=ANY(c_ids) AND s.starts_on<=c_period.ends_on AND s.ends_on>=c_period.starts_on;
  SELECT i.body INTO c_latest FROM openerp.closing_inventories i WHERE i.book_id=p_book AND i.period_id=c_inventory.period_id
    ORDER BY i.ordinal DESC LIMIT 1;
  RETURN openerp.digest(jsonb_build_object('inventory',c_inventory.body,'latestInventory',c_latest,
    'period',jsonb_build_object('id',c_period.id,'version',c_period.version::text,'startsOn',c_period.starts_on::text,
      'endsOn',c_period.ends_on::text,'locked',c_period.locked),
    'book',jsonb_build_object('id',c_book.id,'entityId',c_book.entity_id,'profile',c_book.profile,'profileVersion',c_book.profile_version::text,
      'writerEpoch',c_book.writer_epoch::text,'authority',c_book.authority,'currency',c_book.currency,
      'currencyScale',c_book.currency_scale,'committedSequence',c_book.committed_sequence::text),
    'accounts',c_accounts,'statements',c_statements));
END $$;

CREATE FUNCTION openerp.create_bank_source_coverage(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_actor text; c_previous jsonb; c_book openerp.books; c_inventory openerp.closing_inventories;
  c_period openerp.periods; c_starts date; c_ends date; c_digest text; c_ids text[]; c_account record;
  c_statements jsonb; c_statement openerp.bank_statements; c_statement_body jsonb; c_movement numeric; c_difference numeric;
  c_rows integer; c_cursor date; c_gaps jsonb; c_diagnostics jsonb; c_pairs jsonb; c_overlaps jsonb;
  c_accounts jsonb:='[]'; c_open numeric; c_close numeric; c_body jsonb; c_content text; c_bytes integer; c_hash text;
BEGIN
  c_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT c_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  c_previous:=openerp.replay(c_book.id,p_key,c_actor,'create_bank_source_coverage',p_input);
  IF c_previous IS NOT NULL THEN RETURN c_previous; END IF;
  PERFORM openerp.bank_require_profile(c_book.id);
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Select a retained closing inventory and its explicit interval.'); END IF;
  IF p_input-ARRAY['inventoryId','startsOn','endsOn']<>'{}'::jsonb
    OR jsonb_typeof(p_input->'inventoryId') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'inventoryId','')!~'^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'startsOn') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'endsOn') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Supply an inventory ID and inclusive start/end dates.'); END IF;
  c_starts:=openerp.bank_date(p_input->>'startsOn'); c_ends:=openerp.bank_date(p_input->>'endsOn');
  SELECT * INTO c_inventory FROM openerp.closing_inventories i WHERE i.book_id=c_book.id AND i.id=p_input->>'inventoryId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The closing source inventory was not found in this book.'); END IF;
  SELECT * INTO STRICT c_period FROM openerp.periods p WHERE p.book_id=c_book.id AND p.id=c_inventory.period_id FOR SHARE;
  IF c_starts<>c_period.starts_on OR c_ends<>c_period.ends_on OR c_starts>c_ends THEN
    PERFORM openerp.fail('InvalidJournal','Use exactly the inclusive accounting-period interval owned by this source inventory.'); END IF;
  IF EXISTS(SELECT FROM openerp.closing_inventories i WHERE i.book_id=c_book.id AND i.period_id=c_inventory.period_id AND i.ordinal>c_inventory.ordinal) THEN
    PERFORM openerp.fail('StaleDependency','Select the latest retained inventory for this period.'); END IF;
  IF (SELECT count(*) FROM openerp.bank_source_coverage_reports r WHERE r.book_id=c_book.id)>=200 THEN
    PERFORM openerp.fail('UnsupportedProfile','This book already has200 saved source coverage reports. Existing artifacts remain readable.'); END IF;
  c_digest:=openerp.bank_source_coverage_dependency_digest(c_book.id,c_inventory.id);
  IF c_digest IS NULL THEN PERFORM openerp.fail('UnsupportedProfile','Coverage capture requires at most100 known/declared accounts,200 intersecting statements and10000 full retained rows. No partial report was saved.'); END IF;
  SELECT array_agg(account_id ORDER BY account_id COLLATE "C") INTO c_ids FROM (
    SELECT jsonb_array_elements_text(c_inventory.body->'bankAccountIds') account_id
    UNION SELECT s.account_id FROM openerp.bank_sources s WHERE s.book_id=c_book.id
  ) selected;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=c_book.id AND a.id=ANY(c_ids) ORDER BY a.id FOR SHARE;
  FOR c_account IN SELECT a.*,s.source_bank_account_id,s.revision AS source_revision,
    c_inventory.body->'bankAccountIds'?a.id AS declared
    FROM openerp.accounts a LEFT JOIN openerp.bank_sources s ON (s.book_id,s.account_id)=(a.book_id,a.id)
    WHERE a.book_id=c_book.id AND a.id=ANY(c_ids) ORDER BY a.id COLLATE "C"
  LOOP
    c_statements:='[]'; c_gaps:='[]'; c_diagnostics:='[]'; c_cursor:=c_starts;
    IF NOT c_account.declared THEN c_diagnostics:=c_diagnostics||jsonb_build_array('mapped_account_not_declared'); END IF;
    IF c_account.source_bank_account_id IS NULL THEN c_diagnostics:=c_diagnostics||jsonb_build_array('source_mapping_missing'); END IF;
    FOR c_statement IN SELECT s.* FROM openerp.bank_statements s WHERE s.book_id=c_book.id AND s.account_id=c_account.id
      AND s.starts_on<=c_ends AND s.ends_on>=c_starts ORDER BY s.starts_on,s.ends_on,s.id COLLATE "C"
    LOOP
      IF c_statement.starts_on>c_cursor THEN c_gaps:=c_gaps||jsonb_build_array(jsonb_build_object('startsOn',c_cursor::text,'endsOn',(c_statement.starts_on-1)::text)); END IF;
      c_cursor:=greatest(c_cursor,least(c_statement.ends_on,c_ends)+1);
      SELECT coalesce(sum(o.amount_minor),0),count(*) INTO c_movement,c_rows FROM openerp.bank_observations o
        WHERE o.book_id=c_book.id AND o.statement_id=c_statement.id;
      c_difference:=(c_statement.source->>'openingMinor')::numeric+c_movement-(c_statement.source->>'closingMinor')::numeric;
      c_statement_body:=jsonb_build_object('statement',openerp.bank_statement_body(c_statement),
        'movementMinor',c_movement::text,'movementDifferenceMinor',c_difference::text,'observedRowCount',c_rows,
        'cutsRequestedBoundary',c_statement.starts_on<c_starts OR c_statement.ends_on>c_ends,
        'diagnostics',to_jsonb(array_remove(ARRAY[
          CASE WHEN c_statement.source->'completeness'->'declaredComplete' IS DISTINCT FROM 'true'::jsonb THEN 'statement_declared_incomplete' END,
          CASE WHEN c_statement.starts_on<c_starts OR c_statement.ends_on>c_ends THEN 'statement_crosses_boundary' END,
          CASE WHEN c_statement.source_bank_account_id IS DISTINCT FROM c_account.source_bank_account_id
            OR c_statement.source->>'currency' IS DISTINCT FROM c_book.currency THEN 'source_identity_or_currency_mismatch' END,
          CASE WHEN c_difference<>0 THEN 'statement_balance_difference' END,
          CASE WHEN c_rows<>jsonb_array_length(c_statement.source->'rows') THEN 'statement_row_count_difference' END
        ],NULL)));
      c_statements:=c_statements||jsonb_build_array(c_statement_body);
    END LOOP;
    IF c_cursor<=c_ends THEN c_gaps:=c_gaps||jsonb_build_array(jsonb_build_object('startsOn',c_cursor::text,'endsOn',c_ends::text)); END IF;
    IF c_statements='[]'::jsonb THEN c_diagnostics:=c_diagnostics||jsonb_build_array('statements_missing'); END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('leftStatementId',a->'statement'->>'id','rightStatementId',b->'statement'->>'id',
      'startsOn',greatest((a->'statement'->>'startsOn')::date,(b->'statement'->>'startsOn')::date)::text,
      'endsOn',least((a->'statement'->>'endsOn')::date,(b->'statement'->>'endsOn')::date)::text)
      ORDER BY a->'statement'->>'id' COLLATE "C",b->'statement'->>'id' COLLATE "C"),'[]') INTO c_overlaps
      FROM jsonb_array_elements(c_statements) a CROSS JOIN jsonb_array_elements(c_statements) b
      WHERE (a->'statement'->>'id') COLLATE "C"<(b->'statement'->>'id') COLLATE "C"
        AND (a->'statement'->>'startsOn')::date<=(b->'statement'->>'endsOn')::date
        AND (b->'statement'->>'startsOn')::date<=(a->'statement'->>'endsOn')::date;
    SELECT coalesce(jsonb_agg(jsonb_build_object('leftStatementId',a->'statement'->>'id','rightStatementId',b->'statement'->>'id',
      'leftClosingMinor',a->'statement'->>'closingMinor','rightOpeningMinor',b->'statement'->>'openingMinor',
      'differenceMinor',((b->'statement'->>'openingMinor')::numeric-(a->'statement'->>'closingMinor')::numeric)::text)
      ORDER BY a->'statement'->>'endsOn',a->'statement'->>'id' COLLATE "C",b->'statement'->>'id' COLLATE "C"),'[]') INTO c_pairs
      FROM jsonb_array_elements(c_statements) a CROSS JOIN jsonb_array_elements(c_statements) b
      WHERE (b->'statement'->>'startsOn')::date=(a->'statement'->>'endsOn')::date+1
        AND a->'statement'->>'sourceBankAccountId'=b->'statement'->>'sourceBankAccountId'
        AND a->'statement'->>'currency'=b->'statement'->>'currency'
        AND a->'statement'->>'currency'=c_book.currency;
    c_open:=NULL; c_close:=NULL;
    IF (SELECT count(*) FROM jsonb_array_elements(c_statements) s WHERE (s->'statement'->>'startsOn')::date<=c_starts
      AND (s->'statement'->>'endsOn')::date>=c_starts)=1 THEN
      SELECT (s->'statement'->>'openingMinor')::numeric INTO c_open FROM jsonb_array_elements(c_statements) s
        WHERE (s->'statement'->>'startsOn')::date=c_starts AND s->'statement'->>'currency'=c_book.currency
          AND s->'statement'->>'sourceBankAccountId'=c_account.source_bank_account_id;
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(c_statements) s WHERE (s->'statement'->>'startsOn')::date<=c_ends
      AND (s->'statement'->>'endsOn')::date>=c_ends)=1 THEN
      SELECT (s->'statement'->>'closingMinor')::numeric INTO c_close FROM jsonb_array_elements(c_statements) s
        WHERE (s->'statement'->>'endsOn')::date=c_ends AND s->'statement'->>'currency'=c_book.currency
          AND s->'statement'->>'sourceBankAccountId'=c_account.source_bank_account_id;
    END IF;
    IF c_open IS NULL THEN c_diagnostics:=c_diagnostics||jsonb_build_array('opening_checkpoint_unavailable'); END IF;
    IF c_close IS NULL THEN c_diagnostics:=c_diagnostics||jsonb_build_array('closing_checkpoint_unavailable'); END IF;
    c_accounts:=c_accounts||jsonb_build_array(jsonb_build_object('accountId',c_account.id,'code',c_account.code,'name',c_account.name,
      'active',c_account.active,'accountVersion',c_account.version::text,'declared',c_account.declared,
      'sourceBankAccountId',c_account.source_bank_account_id,'sourceRevision',c_account.source_revision::text,
      'statements',c_statements,'gaps',c_gaps,'overlaps',c_overlaps,'adjacentBalances',c_pairs,
      'openingMinor',c_open::text,'closingMinor',c_close::text,'diagnostics',c_diagnostics,
      'hasReviewGaps',c_diagnostics<>'[]'::jsonb OR c_gaps<>'[]'::jsonb OR c_overlaps<>'[]'::jsonb
        OR EXISTS(SELECT FROM jsonb_array_elements(c_pairs) pair WHERE (pair->>'differenceMinor')::numeric<>0)
        OR EXISTS(SELECT FROM jsonb_array_elements(c_statements) s WHERE s->'diagnostics'<>'[]'::jsonb)));
  END LOOP;
  c_body:=jsonb_build_object('id',openerp.new_id('bank_coverage'),'kind','synthetic_bank_source_coverage_v1',
    'scope',jsonb_build_object('entityId',c_book.entity_id,'bookId',c_book.id),'input',p_input,
    'inventory',c_inventory.body,'period',jsonb_build_object('id',c_period.id,'version',c_period.version::text,
      'startsOn',c_period.starts_on::text,'endsOn',c_period.ends_on::text,'locked',c_period.locked),
    'currency',c_book.currency,'currencyScale',c_book.currency_scale,'sequence',c_book.committed_sequence::text,
    'dependencyDigest',c_digest,'accounts',c_accounts,
    'diagnostics',CASE WHEN jsonb_array_length(c_inventory.body->'bankAccountIds')=0 THEN '["no_declared_accounts"]'::jsonb ELSE '[]'::jsonb END,
    'hasReviewGaps',jsonb_array_length(c_inventory.body->'bankAccountIds')=0
      OR EXISTS(SELECT FROM jsonb_array_elements(c_accounts) a WHERE (a->>'hasReviewGaps')::boolean),
    'coverage','not_established','financialCloseReady',false,'knowledgeBasis','current_known_facts_at_capture')
    ||openerp.commerce_record_metadata(p_key,'create_bank_source_coverage',c_actor);
  c_body:=c_body||jsonb_build_object('digest',openerp.digest(c_body));
  c_content:=openerp.canonical(c_body); c_bytes:=octet_length(convert_to(c_content,'UTF8'));
  IF c_bytes>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','Coverage JSON exceeds8 MiB. No partial snapshot was saved.'); END IF;
  c_hash:=encode(sha256(convert_to(c_content,'UTF8')),'hex');
  INSERT INTO openerp.bank_source_coverage_reports VALUES(c_book.id,c_body->>'id',c_inventory.id,c_body,c_content,c_hash,c_bytes);
  RETURN openerp.save_command(c_book.id,p_key,c_actor,'create_bank_source_coverage',p_input,c_body);
END $$;

CREATE FUNCTION openerp.get_bank_source_coverage(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_saved openerp.bank_source_coverage_reports; c_digest text;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT * INTO c_saved FROM openerp.bank_source_coverage_reports r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The saved bank source coverage report was not found in this book.'); END IF;
  c_digest:=openerp.bank_source_coverage_dependency_digest(c_saved.book_id,c_saved.inventory_id);
  RETURN jsonb_build_object('report',c_saved.body,'dependenciesCurrent',coalesce(c_saved.body->>'dependencyDigest'=c_digest,false),
    'artifact',jsonb_build_object('content',c_saved.content,'sha256',c_saved.sha256,'byteLength',c_saved.byte_length,'mediaType','application/json'));
END $$;
CREATE FUNCTION openerp.list_bank_source_coverage(p_token text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_items jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'inventoryId',r.inventory_id,'startsOn',r.body->'input'->>'startsOn',
    'endsOn',r.body->'input'->>'endsOn','createdAt',r.body->>'createdAt','sequence',r.body->>'sequence',
    'hasReviewGaps',r.body->'hasReviewGaps','digest',r.body->>'digest') ORDER BY r.body->>'createdAt' DESC,r.id COLLATE "C"),'[]')
    INTO c_items FROM openerp.bank_source_coverage_reports r WHERE r.book_id=p_scope->>'bookId';
  RETURN jsonb_build_object('scope',p_scope,'items',c_items,'coverage','not_established');
END $$;
REVOKE ALL ON FUNCTION openerp.bank_source_coverage_dependency_digest(text,text),
  openerp.create_bank_source_coverage(text,jsonb,text,jsonb),openerp.get_bank_source_coverage(text,jsonb,text),
  openerp.list_bank_source_coverage(text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.create_bank_source_coverage(text,jsonb,text,jsonb),
  openerp.get_bank_source_coverage(text,jsonb,text),openerp.list_bank_source_coverage(text,jsonb) TO openerp_runtime;
