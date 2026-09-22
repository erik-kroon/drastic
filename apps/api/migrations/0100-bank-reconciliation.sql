-- Synthetic observations are evidence, never additional ledger postings.
CREATE TABLE openerp.bank_sources (
  book_id text NOT NULL, account_id text NOT NULL,
  source_bank_account_id text NOT NULL, revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (book_id, account_id), UNIQUE (book_id, source_bank_account_id),
  FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts
);
CREATE TABLE openerp.bank_statements (
  book_id text NOT NULL, id text NOT NULL, account_id text NOT NULL,
  source_bank_account_id text NOT NULL, statement_identifier text NOT NULL,
  evidence_id text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
  source jsonb NOT NULL, import_input jsonb NOT NULL,
  PRIMARY KEY (book_id, id), UNIQUE (book_id, source_bank_account_id, statement_identifier),
  UNIQUE (book_id, evidence_id), CHECK (starts_on <= ends_on),
  FOREIGN KEY (book_id, account_id) REFERENCES openerp.bank_sources,
  FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.bank_observations (
  book_id text NOT NULL, statement_id text NOT NULL, row_ordinal integer NOT NULL CHECK (row_ordinal BETWEEN 1 AND 10000),
  provider_id text, source_bank_account_id text NOT NULL, observed_on date NOT NULL,
  description text NOT NULL, amount_minor numeric NOT NULL CHECK (amount_minor = trunc(amount_minor) AND abs(amount_minor) < 1e38::numeric),
  PRIMARY KEY (book_id, statement_id, row_ordinal), UNIQUE (book_id, source_bank_account_id, provider_id),
  FOREIGN KEY (book_id, statement_id) REFERENCES openerp.bank_statements
);
CREATE TABLE openerp.bank_matches (
  book_id text NOT NULL, statement_id text NOT NULL, row_ordinal integer NOT NULL,
  voucher_id text NOT NULL, line_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('imported', 'explicit')),
  actor_id text NOT NULL REFERENCES openerp.actors,
  PRIMARY KEY (book_id, statement_id, row_ordinal), UNIQUE (book_id, voucher_id, line_id),
  FOREIGN KEY (book_id, statement_id, row_ordinal) REFERENCES openerp.bank_observations,
  FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines
);
CREATE TABLE openerp.bank_reconciliations (
  book_id text NOT NULL, id text NOT NULL, account_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id, id),
  FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts
);
CREATE TRIGGER immutable_bank_statement BEFORE UPDATE OR DELETE ON openerp.bank_statements
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_observation BEFORE UPDATE OR DELETE ON openerp.bank_observations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_match BEFORE UPDATE OR DELETE ON openerp.bank_matches
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_reconciliation BEFORE UPDATE OR DELETE ON openerp.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.bank_date(value text) RETURNS date LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE result date;
BEGIN
  BEGIN
    result := value::date;
    IF value IS NULL OR value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR to_char(result, 'YYYY-MM-DD') IS DISTINCT FROM value THEN RAISE invalid_datetime_format; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    PERFORM openerp.fail('InvalidJournal', 'Supply a valid date in YYYY-MM-DD format.');
  END;
  RETURN result;
END $$;
CREATE FUNCTION openerp.bank_require_profile(book text) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM openerp.books WHERE id = book AND profile = 'synthetic-core-v1' AND authority = 'native') THEN
    PERFORM openerp.fail('UnsupportedProfile', 'Only native synthetic-core-v1 bank statements are supported.');
  END IF;
END $$;
CREATE FUNCTION openerp.bank_checkpoint(book text, account text) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT jsonb_build_object('sequence', b.committed_sequence::text, 'sourceRevision', coalesce(s.revision, 0)::text)
  FROM openerp.books b LEFT JOIN openerp.bank_sources s ON s.book_id = b.id AND s.account_id = account WHERE b.id = book
$$;
CREATE FUNCTION openerp.bank_match_body(m openerp.bank_matches) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT jsonb_build_object('statementId', m.statement_id, 'rowOrdinal', m.row_ordinal,
    'voucherId', m.voucher_id, 'lineId', m.line_id, 'origin', m.origin, 'actorId', m.actor_id)
$$;
CREATE FUNCTION openerp.bank_statement_body(s openerp.bank_statements) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT s.source || jsonb_build_object('id', s.id, 'evidenceId', s.evidence_id, 'evidenceSha256', e.sha256)
  FROM openerp.evidence e WHERE e.book_id = s.book_id AND e.id = s.evidence_id
$$;
CREATE FUNCTION openerp.bank_add_match(book text, actor text, input jsonb, match_origin text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE observation openerp.bank_observations; statement openerp.bank_statements;
  line openerp.journal_lines; matched openerp.bank_matches; posted_on date;
BEGIN
  IF coalesce(input->>'rowOrdinal', '') !~ '^[1-9][0-9]{0,4}$'
    OR jsonb_typeof(input->'rowOrdinal') IS DISTINCT FROM 'number'
    OR (input->>'rowOrdinal')::integer > 10000 THEN
    PERFORM openerp.fail('InvalidJournal', 'Select one retained row by ordinal; split matches are unsupported.');
  END IF;
  SELECT * INTO observation FROM openerp.bank_observations o WHERE o.book_id = book
    AND o.statement_id = input->>'statementId' AND o.row_ordinal = (input->>'rowOrdinal')::integer;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound', 'The source observation was not found in this book.'); END IF;
  SELECT * INTO STRICT statement FROM openerp.bank_statements s WHERE s.book_id = book AND s.id = observation.statement_id;
  SELECT * INTO line FROM openerp.journal_lines l WHERE l.book_id = book
    AND l.voucher_id = input->>'voucherId' AND l.id = input->>'lineId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound', 'The posted journal line was not found in this book.'); END IF;
  SELECT v.posting_date INTO STRICT posted_on FROM openerp.vouchers v WHERE v.book_id = book AND v.id = line.voucher_id;
  IF line.account_id <> statement.account_id OR line.debit_minor - line.credit_minor <> observation.amount_minor
    OR posted_on NOT BETWEEN statement.starts_on AND statement.ends_on THEN
    PERFORM openerp.fail('InvalidJournal', 'Match one exact bank line with equal signed amount in the statement interval. Splits and timing allocations are unsupported.');
  END IF;
  SELECT * INTO matched FROM openerp.bank_matches m WHERE m.book_id = book AND m.statement_id = observation.statement_id AND m.row_ordinal = observation.row_ordinal;
  IF FOUND THEN
    IF matched.voucher_id <> line.voucher_id OR matched.line_id <> line.id THEN
      PERFORM openerp.fail('InvalidJournal', 'This observation already consumes another journal line.');
    END IF;
    RETURN openerp.bank_match_body(matched);
  END IF;
  IF EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id = book AND m.voucher_id = line.voucher_id AND m.line_id = line.id) THEN
    PERFORM openerp.fail('InvalidJournal', 'The journal line is already matched; its capacity cannot be consumed twice.');
  END IF;
  INSERT INTO openerp.bank_matches VALUES(book, observation.statement_id, observation.row_ordinal, line.voucher_id, line.id, match_origin, actor) RETURNING * INTO matched;
  UPDATE openerp.bank_sources SET revision = revision + 1 WHERE book_id = book AND account_id = statement.account_id;
  RETURN openerp.bank_match_body(matched);
END $$;

CREATE FUNCTION openerp.import_bank_statement(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; source jsonb := input - 'evidenceId' - 'existingMatches';
  evidence openerp.evidence; statement openerp.bank_statements; source_row jsonb; match_input jsonb;
  starts date; ends date; row_date date; total numeric := 0; matches jsonb := '[]'; result jsonb;
BEGIN
  actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'import_bank_statement', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  PERFORM openerp.bank_require_profile(scope->>'bookId');
  IF input->>'kind' IS DISTINCT FROM 'synthetic_bank_statement_v1'
    OR jsonb_typeof(input->'statementIdentifier') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'sourceBankAccountId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'completeness'->'basis') IS DISTINCT FROM 'string'
    OR coalesce(length(input->>'statementIdentifier'), 0) NOT BETWEEN 1 AND 200
    OR coalesce(length(input->>'sourceBankAccountId'), 0) NOT BETWEEN 1 AND 200
    OR coalesce(input->>'openingMinor', '') !~ '^(0|-?[1-9][0-9]{0,37})$'
    OR coalesce(input->>'closingMinor', '') !~ '^(0|-?[1-9][0-9]{0,37})$'
    OR jsonb_typeof(input->'openingMinor') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'closingMinor') IS DISTINCT FROM 'string'
    OR jsonb_typeof(input->'completeness'->'declaredComplete') IS DISTINCT FROM 'boolean'
    OR coalesce(length(input->'completeness'->>'basis'), 0) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(input->'rows') IS DISTINCT FROM 'array'
    OR jsonb_typeof(input->'existingMatches') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal', 'Provide a synthetic statement with exact balances, rows and an explicit coverage declaration.');
  END IF;
  IF jsonb_array_length(input->'rows') > 10000 OR jsonb_array_length(input->'existingMatches') > 10000 THEN
    PERFORM openerp.fail('InvalidJournal', 'The synthetic import supports at most 10000 rows and matches.');
  END IF;
  starts := openerp.bank_date(input->>'startsOn'); ends := openerp.bank_date(input->>'endsOn');
  IF starts > ends THEN PERFORM openerp.fail('InvalidJournal', 'The statement interval is reversed.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.accounts a JOIN openerp.books b ON b.id = a.book_id
    WHERE a.book_id = scope->>'bookId' AND a.id = input->>'accountId' AND a.active AND b.currency = input->>'currency') THEN
    PERFORM openerp.fail('InvalidJournal', 'Choose an active book account and the book currency.');
  END IF;
  SELECT * INTO evidence FROM openerp.evidence e WHERE e.book_id = scope->>'bookId' AND e.id = input->>'evidenceId';
  IF NOT FOUND OR evidence.media_type <> 'application/json' THEN
    PERFORM openerp.fail('MissingEvidence', 'Retain the exact synthetic statement source as JSON evidence first.');
  END IF;
  IF evidence.content::jsonb IS DISTINCT FROM source THEN
    PERFORM openerp.fail('MissingEvidence', 'The retained JSON must equal the statement input without evidenceId and existingMatches.');
  END IF;
  SELECT * INTO statement FROM openerp.bank_statements s WHERE s.book_id = scope->>'bookId'
    AND s.source_bank_account_id = input->>'sourceBankAccountId' AND s.statement_identifier = input->>'statementIdentifier';
  IF FOUND THEN
    IF statement.import_input IS DISTINCT FROM input THEN
      PERFORM openerp.fail('IdempotencyConflict', 'The stable statement identity already has different retained content or matches.');
    END IF;
  ELSE
    IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id = scope->>'bookId' AND
      ((s.account_id = input->>'accountId' AND s.source_bank_account_id <> input->>'sourceBankAccountId') OR
       (s.source_bank_account_id = input->>'sourceBankAccountId' AND s.account_id <> input->>'accountId'))) THEN
      PERFORM openerp.fail('InvalidJournal', 'The bank source mapping conflicts with the retained book account mapping.');
    END IF;
    IF EXISTS(SELECT FROM openerp.bank_statements s WHERE s.book_id = scope->>'bookId' AND s.account_id = input->>'accountId'
      AND s.starts_on <= ends AND s.ends_on >= starts) THEN
      PERFORM openerp.fail('InvalidJournal', 'Overlapping bank statements require explicit set reconciliation, which is unsupported. No rows were discarded.');
    END IF;
    INSERT INTO openerp.bank_sources(book_id, account_id, source_bank_account_id)
      VALUES(scope->>'bookId', input->>'accountId', input->>'sourceBankAccountId') ON CONFLICT DO NOTHING;
    INSERT INTO openerp.bank_statements VALUES(scope->>'bookId', openerp.new_id('statement'), input->>'accountId',
      input->>'sourceBankAccountId', input->>'statementIdentifier', evidence.id, starts, ends, source, input) RETURNING * INTO statement;
    FOR source_row IN SELECT value FROM jsonb_array_elements(input->'rows') LOOP
      IF coalesce(source_row->>'rowOrdinal', '') !~ '^[1-9][0-9]{0,4}$'
        OR jsonb_typeof(source_row->'rowOrdinal') IS DISTINCT FROM 'number'
        OR (source_row->>'rowOrdinal')::integer > 10000
        OR coalesce(source_row->>'amountMinor', '') !~ '^(0|-?[1-9][0-9]{0,37})$'
        OR jsonb_typeof(source_row->'amountMinor') IS DISTINCT FROM 'string'
        OR jsonb_typeof(source_row->'description') IS DISTINCT FROM 'string'
        OR coalesce(length(source_row->>'description'), 0) NOT BETWEEN 1 AND 2000
        OR NOT (source_row ? 'providerId')
        OR (source_row->'providerId' <> 'null'::jsonb AND
          (jsonb_typeof(source_row->'providerId') <> 'string' OR length(source_row->>'providerId') NOT BETWEEN 1 AND 200)) THEN
        PERFORM openerp.fail('InvalidJournal', 'Each retained row needs a unique ordinal, optional provider ID, date, description and exact signed amount.');
      END IF;
      row_date := openerp.bank_date(source_row->>'date');
      IF row_date NOT BETWEEN starts AND ends THEN PERFORM openerp.fail('InvalidJournal', 'Every observation must lie inside the statement interval.'); END IF;
      IF EXISTS(SELECT FROM openerp.bank_observations o WHERE o.book_id = statement.book_id AND
        ((o.statement_id = statement.id AND o.row_ordinal = (source_row->>'rowOrdinal')::integer) OR
        (o.source_bank_account_id = statement.source_bank_account_id AND o.provider_id = source_row->>'providerId'))) THEN
        PERFORM openerp.fail('InvalidJournal', 'A row ordinal or provider identity repeats. Equal amounts alone are not duplicates.');
      END IF;
      INSERT INTO openerp.bank_observations VALUES(statement.book_id, statement.id, (source_row->>'rowOrdinal')::integer,
        source_row->>'providerId', statement.source_bank_account_id, row_date, source_row->>'description', (source_row->>'amountMinor')::numeric);
      total := total + (source_row->>'amountMinor')::numeric;
    END LOOP;
    IF (input->>'openingMinor')::numeric + total <> (input->>'closingMinor')::numeric THEN
      PERFORM openerp.fail('InvalidJournal', 'The complete retained row sum does not equal the stated closing balance.');
    END IF;
    UPDATE openerp.bank_sources SET revision = revision + 1 WHERE book_id = statement.book_id AND account_id = statement.account_id;
    FOR match_input IN SELECT value FROM jsonb_array_elements(input->'existingMatches') LOOP
      PERFORM openerp.bank_add_match(statement.book_id, actor, match_input || jsonb_build_object('statementId', statement.id), 'imported');
    END LOOP;
  END IF;
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(m) ORDER BY m.row_ordinal), '[]') INTO matches
    FROM openerp.bank_matches m WHERE m.book_id = statement.book_id AND m.statement_id = statement.id;
  result := jsonb_build_object('statement', openerp.bank_statement_body(statement), 'matches', matches,
    'checkpoint', openerp.bank_checkpoint(statement.book_id, statement.account_id),
    'receipt', jsonb_build_object('key', key, 'operation', 'import_bank_statement', 'actorId', actor));
  RETURN openerp.save_command(statement.book_id, key, actor, 'import_bank_statement', input, result);
END $$;

CREATE FUNCTION openerp.get_bank_statement(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE statement openerp.bank_statements; matches jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE books.id = scope->>'bookId' FOR SHARE;
  SELECT * INTO statement FROM openerp.bank_statements s WHERE s.book_id = scope->>'bookId' AND s.id = get_bank_statement.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound', 'The bank statement was not found in this book.'); END IF;
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(m) ORDER BY m.row_ordinal), '[]') INTO matches
    FROM openerp.bank_matches m WHERE m.book_id = statement.book_id AND m.statement_id = statement.id;
  RETURN jsonb_build_object('statement', openerp.bank_statement_body(statement), 'matches', matches,
    'checkpoint', openerp.bank_checkpoint(statement.book_id, statement.account_id));
END $$;
CREATE FUNCTION openerp.match_bank_observation(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; result jsonb; matched jsonb; account text;
BEGIN
  actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'match_bank_observation', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  PERFORM openerp.bank_require_profile(scope->>'bookId');
  matched := openerp.bank_add_match(scope->>'bookId', actor, input, 'explicit');
  SELECT s.account_id INTO STRICT account FROM openerp.bank_statements s WHERE s.book_id = scope->>'bookId' AND s.id = input->>'statementId';
  result := jsonb_build_object('match', matched, 'checkpoint', openerp.bank_checkpoint(scope->>'bookId', account),
    'receipt', jsonb_build_object('key', key, 'operation', 'match_bank_observation', 'actorId', actor));
  RETURN openerp.save_command(scope->>'bookId', key, actor, 'match_bank_observation', input, result);
END $$;

CREATE FUNCTION openerp.reconcile_bank(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; b openerp.books; account text := input->>'accountId';
  starts date; ends date; statement openerp.bank_statements; last_end date; last_closing numeric;
  bank_open numeric; bank_close numeric; ledger_open numeric; ledger_close numeric;
  watermark bigint; account_sequence bigint; source_revision bigint;
  statements jsonb := '[]'; observations jsonb; ledger_lines jsonb; matches jsonb;
  unmatched_source jsonb; unmatched_ledger jsonb; differences jsonb := '[]'; gaps jsonb := '[]';
  result jsonb; report_id text := openerp.new_id('reconciliation'); report_status text;
BEGIN
  actor := openerp.authorize(token, scope);
  SELECT * INTO STRICT b FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(b.id, key, actor, 'reconcile_bank', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  PERFORM openerp.bank_require_profile(b.id);
  starts := openerp.bank_date(input->>'startsOn'); ends := openerp.bank_date(input->>'endsOn');
  IF starts > ends OR NOT EXISTS(SELECT FROM openerp.accounts a WHERE a.book_id = b.id AND a.id = account) THEN
    PERFORM openerp.fail('InvalidJournal', 'Choose a book account and an ordered date interval.');
  END IF;
  -- Partial statements cannot establish independent opening/closing checkpoints.
  IF EXISTS(SELECT FROM openerp.bank_statements s WHERE s.book_id = b.id AND s.account_id = account
    AND s.starts_on <= ends AND s.ends_on >= starts AND (s.starts_on < starts OR s.ends_on > ends)) THEN
    PERFORM openerp.fail('InvalidJournal', 'The report cuts through a statement. Use whole statement intervals; unsupported splits cannot prove coverage.');
  END IF;
  watermark := b.committed_sequence;
  SELECT coalesce(s.revision, 0) INTO source_revision FROM openerp.bank_sources s WHERE s.book_id = b.id AND s.account_id = account;
  source_revision := coalesce(source_revision, 0);
  FOR statement IN SELECT s.* FROM openerp.bank_statements s WHERE s.book_id = b.id AND s.account_id = account
    AND s.starts_on >= starts AND s.ends_on <= ends ORDER BY s.starts_on, s.id LOOP
    statements := statements || jsonb_build_array(openerp.bank_statement_body(statement));
    IF last_end IS NULL THEN
      bank_open := (statement.source->>'openingMinor')::numeric;
      IF statement.starts_on <> starts THEN gaps := gaps || jsonb_build_array('No statement covers the start of the requested interval.'); END IF;
    ELSE
      IF statement.starts_on <> last_end + 1 THEN gaps := gaps || jsonb_build_array('There is a gap between retained statement intervals.'); END IF;
      IF (statement.source->>'openingMinor')::numeric <> last_closing THEN
        differences := differences || jsonb_build_array('Consecutive statement closing and opening balances differ.');
      END IF;
    END IF;
    IF statement.source->'completeness'->>'declaredComplete' <> 'true' THEN
      gaps := gaps || jsonb_build_array('Statement ' || statement.id || ' is explicitly declared incomplete.');
    END IF;
    bank_close := (statement.source->>'closingMinor')::numeric;
    last_closing := bank_close; last_end := statement.ends_on;
  END LOOP;
  IF last_end IS NULL THEN gaps := gaps || jsonb_build_array('No bank statement covers this interval.');
  ELSIF last_end <> ends THEN gaps := gaps || jsonb_build_array('No statement covers the end of the requested interval.'); END IF;

  SELECT coalesce(sum(l.debit_minor - l.credit_minor) FILTER (WHERE v.posting_date < starts), 0),
    coalesce(sum(l.debit_minor - l.credit_minor), 0), coalesce(max(v.sequence), 0)
    INTO ledger_open, ledger_close, account_sequence
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = b.id AND l.account_id = account AND v.posting_date <= ends AND v.sequence <= watermark;
  SELECT coalesce(jsonb_agg(jsonb_build_object('statementId', o.statement_id, 'evidenceId', s.evidence_id,
      'evidenceSha256', e.sha256, 'rowOrdinal', o.row_ordinal, 'providerId', o.provider_id,
      'date', o.observed_on::text, 'description', o.description, 'amountMinor', o.amount_minor::text)
      ORDER BY s.starts_on, o.row_ordinal), '[]') INTO observations
    FROM openerp.bank_observations o JOIN openerp.bank_statements s ON s.book_id = o.book_id AND s.id = o.statement_id
    JOIN openerp.evidence e ON e.book_id = s.book_id AND e.id = s.evidence_id
    WHERE s.book_id = b.id AND s.account_id = account AND s.starts_on >= starts AND s.ends_on <= ends;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId', v.id, 'lineId', l.id,
      'date', v.posting_date::text, 'sequence', v.sequence::text, 'description', l.description,
      'amountMinor', (l.debit_minor - l.credit_minor)::text) ORDER BY v.sequence, l.ordinal), '[]') INTO ledger_lines
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = b.id AND l.account_id = account AND v.posting_date BETWEEN starts AND ends AND v.sequence <= watermark;
  SELECT coalesce(jsonb_agg(openerp.bank_match_body(m) ORDER BY s.starts_on, m.row_ordinal), '[]') INTO matches
    FROM openerp.bank_matches m JOIN openerp.bank_statements s ON s.book_id = m.book_id AND s.id = m.statement_id
    WHERE s.book_id = b.id AND s.account_id = account AND s.starts_on >= starts AND s.ends_on <= ends;
  SELECT coalesce(jsonb_agg(o.value ORDER BY o.ordinal), '[]') INTO unmatched_source
    FROM jsonb_array_elements(observations) WITH ORDINALITY o(value, ordinal)
    WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(matches) m WHERE m->>'statementId' = o.value->>'statementId' AND m->>'rowOrdinal' = o.value->>'rowOrdinal');
  SELECT coalesce(jsonb_agg(l.value ORDER BY l.ordinal), '[]') INTO unmatched_ledger
    FROM jsonb_array_elements(ledger_lines) WITH ORDINALITY l(value, ordinal)
    WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(matches) m WHERE m->>'voucherId' = l.value->>'voucherId' AND m->>'lineId' = l.value->>'lineId');
  IF bank_open IS NULL OR bank_close IS NULL THEN
    differences := differences || jsonb_build_array('Bank opening and closing balances are unavailable.');
  ELSE
    IF bank_open <> ledger_open THEN differences := differences || jsonb_build_array('The bank and ledger opening balances differ.'); END IF;
    IF bank_close <> ledger_close THEN differences := differences || jsonb_build_array('The bank and ledger closing balances differ.'); END IF;
  END IF;
  IF jsonb_array_length(unmatched_source) > 0 THEN differences := differences || jsonb_build_array('Retained bank observations have no exact posted-line match.'); END IF;
  IF jsonb_array_length(unmatched_ledger) > 0 THEN differences := differences || jsonb_build_array('Posted bank lines have no retained source match.'); END IF;
  report_status := CASE WHEN jsonb_array_length(differences) > 0 THEN 'differences'
    WHEN jsonb_array_length(gaps) > 0 THEN 'balanced_but_incomplete' ELSE 'complete' END;
  result := jsonb_build_object('id', report_id, 'scope', scope, 'accountId', account, 'currency', b.currency,
    'startsOn', starts::text, 'endsOn', ends::text, 'status', report_status,
    'checkpoint', jsonb_build_object('sequence', watermark::text, 'sourceRevision', source_revision::text),
    'accountLedgerSequence', account_sequence::text,
    'ledgerOpeningMinor', ledger_open::text, 'ledgerClosingMinor', ledger_close::text,
    'bankOpeningMinor', bank_open::text, 'bankClosingMinor', bank_close::text,
    'openingDifferenceMinor', (bank_open - ledger_open)::text, 'closingDifferenceMinor', (bank_close - ledger_close)::text,
    'sourceCoverageComplete', jsonb_array_length(gaps) = 0,
    'statements', statements, 'sourceRows', observations, 'ledgerLines', ledger_lines, 'matches', matches,
    'unmatchedSource', unmatched_source, 'unmatchedLedger', unmatched_ledger, 'differences', differences, 'coverageGaps', gaps,
    'receipt', jsonb_build_object('key', key, 'operation', 'reconcile_bank', 'actorId', actor),
    'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.bank_reconciliations VALUES(b.id, report_id, account, result);
  RETURN openerp.save_command(b.id, key, actor, 'reconcile_bank', input, result);
END $$;
CREATE FUNCTION openerp.get_bank_reconciliation(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE report jsonb; source_revision bigint; account_sequence bigint; current_currency text;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT b.currency INTO current_currency FROM openerp.books b WHERE b.id = scope->>'bookId' FOR SHARE;
  SELECT r.body INTO report FROM openerp.bank_reconciliations r WHERE r.book_id = scope->>'bookId' AND r.id = get_bank_reconciliation.id;
  IF report IS NULL THEN PERFORM openerp.fail('NotFound', 'The reconciliation was not found in this book.'); END IF;
  SELECT coalesce(s.revision, 0) INTO source_revision FROM openerp.bank_sources s
    WHERE s.book_id = scope->>'bookId' AND s.account_id = report->>'accountId';
  source_revision := coalesce(source_revision, 0);
  SELECT coalesce(max(v.sequence), 0) INTO account_sequence FROM openerp.journal_lines l
    JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
    WHERE l.book_id = scope->>'bookId' AND l.account_id = report->>'accountId' AND v.posting_date <= (report->>'endsOn')::date;
  RETURN jsonb_build_object('report', report, 'fresh',
    source_revision::text = report->'checkpoint'->>'sourceRevision'
    AND account_sequence::text = report->>'accountLedgerSequence' AND current_currency = report->>'currency'
    AND EXISTS(SELECT FROM openerp.books b WHERE b.id = scope->>'bookId' AND b.profile = 'synthetic-core-v1' AND b.authority = 'native'),
    'currentSourceRevision', source_revision::text, 'currentAccountLedgerSequence', account_sequence::text);
END $$;

REVOKE ALL ON openerp.bank_sources, openerp.bank_statements, openerp.bank_observations,
  openerp.bank_matches, openerp.bank_reconciliations FROM PUBLIC, openerp_runtime;
REVOKE ALL ON FUNCTION openerp.bank_date(text), openerp.bank_require_profile(text),
  openerp.bank_checkpoint(text,text), openerp.bank_match_body(openerp.bank_matches),
  openerp.bank_statement_body(openerp.bank_statements), openerp.bank_add_match(text,text,jsonb,text),
  openerp.import_bank_statement(text,jsonb,text,jsonb), openerp.get_bank_statement(text,jsonb,text),
  openerp.match_bank_observation(text,jsonb,text,jsonb), openerp.reconcile_bank(text,jsonb,text,jsonb),
  openerp.get_bank_reconciliation(text,jsonb,text) FROM PUBLIC, openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.import_bank_statement(text,jsonb,text,jsonb),
  openerp.get_bank_statement(text,jsonb,text), openerp.match_bank_observation(text,jsonb,text,jsonb),
  openerp.reconcile_bank(text,jsonb,text,jsonb), openerp.get_bank_reconciliation(text,jsonb,text) TO openerp_runtime;
