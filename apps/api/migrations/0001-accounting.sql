CREATE SCHEMA openerp;
REVOKE ALL ON SCHEMA openerp FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openerp_runtime') THEN
    CREATE ROLE openerp_runtime NOLOGIN;
  END IF;
END $$;

CREATE DOMAIN openerp.minor_units AS numeric
  CHECK (VALUE = trunc(VALUE) AND VALUE >= 0 AND VALUE < 1e38::numeric);
CREATE TABLE openerp.entities (
  id text PRIMARY KEY, name text NOT NULL
);
CREATE TABLE openerp.books (
  id text PRIMARY KEY,
  entity_id text NOT NULL REFERENCES openerp.entities,
  name text NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  currency_scale integer NOT NULL CHECK (currency_scale BETWEEN 0 AND 6),
  profile text NOT NULL,
  profile_version bigint NOT NULL DEFAULT 1,
  writer_epoch bigint NOT NULL DEFAULT 1,
  authority text NOT NULL DEFAULT 'native' CHECK (authority = 'native'),
  committed_sequence bigint NOT NULL DEFAULT 0 CHECK (committed_sequence >= 0),
  UNIQUE (entity_id, id)
);
CREATE TABLE openerp.actors (
  id text PRIMARY KEY, name text NOT NULL
);
CREATE TABLE openerp.credentials (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL REFERENCES openerp.actors,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE openerp.memberships (
  book_id text NOT NULL REFERENCES openerp.books,
  actor_id text NOT NULL REFERENCES openerp.actors,
  role text NOT NULL CHECK (role IN ('operator', 'agent')),
  PRIMARY KEY (book_id, actor_id)
);
CREATE TABLE openerp.fiscal_years (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
  CHECK (starts_on <= ends_on), PRIMARY KEY (book_id, id)
);
CREATE TABLE openerp.periods (
  book_id text NOT NULL, id text NOT NULL, fiscal_year_id text NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL,
  locked boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1,
  CHECK (starts_on <= ends_on), PRIMARY KEY (book_id, id),
  FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years,
  UNIQUE (book_id, fiscal_year_id, id)
);
CREATE TABLE openerp.accounts (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  code text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (book_id, id), UNIQUE (book_id, code)
);
CREATE TABLE openerp.evidence (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  title text NOT NULL, content text NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 262144),
  media_type text NOT NULL CHECK (media_type IN ('text/plain', 'application/json')),
  origin text NOT NULL, sha256 text NOT NULL,
  created_by text NOT NULL REFERENCES openerp.actors,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, id), UNIQUE (book_id, sha256),
  CHECK (sha256 = encode(sha256(convert_to(content, 'UTF8')), 'hex'))
);
CREATE TABLE openerp.events (
  book_id text NOT NULL, id text NOT NULL,
  evidence_id text NOT NULL, event_key text NOT NULL,
  PRIMARY KEY (book_id, id), UNIQUE (book_id, evidence_id, event_key),
  FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.change_sets (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  plan jsonb NOT NULL, digest text NOT NULL, created_by text NOT NULL REFERENCES openerp.actors,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, id)
);
CREATE TABLE openerp.approvals (
  book_id text NOT NULL, id text NOT NULL, change_set_id text NOT NULL,
  digest text NOT NULL, actor_id text NOT NULL REFERENCES openerp.actors,
  expires_at timestamptz NOT NULL, consumed_at timestamptz,
  PRIMARY KEY (book_id, id),
  FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets
);
CREATE TABLE openerp.series_counters (
  book_id text NOT NULL, fiscal_year_id text NOT NULL,
  series text NOT NULL, last_number bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, fiscal_year_id, series),
  FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years
);
CREATE TABLE openerp.vouchers (
  book_id text NOT NULL, id text NOT NULL,
  fiscal_year_id text NOT NULL, period_id text NOT NULL,
  series text NOT NULL, number bigint NOT NULL CHECK (number > 0),
  sequence bigint NOT NULL CHECK (sequence > 0), posting_date date NOT NULL,
  event_id text NOT NULL, posting_purpose text NOT NULL, occurrence_key text NOT NULL,
  corrects_voucher_id text, change_set_id text NOT NULL,
  action jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, fiscal_year_id, series, number), UNIQUE (book_id, sequence),
  UNIQUE (book_id, event_id, posting_purpose, occurrence_key), UNIQUE (book_id, change_set_id),
  FOREIGN KEY (book_id, fiscal_year_id, period_id) REFERENCES openerp.periods(book_id, fiscal_year_id, id),
  FOREIGN KEY (book_id, event_id) REFERENCES openerp.events,
  FOREIGN KEY (book_id, corrects_voucher_id) REFERENCES openerp.vouchers,
  FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets
);
CREATE UNIQUE INDEX one_reversal_per_voucher ON openerp.vouchers(book_id, corrects_voucher_id)
  WHERE posting_purpose = 'reversal';
CREATE TABLE openerp.journal_lines (
  book_id text NOT NULL, voucher_id text NOT NULL, id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 1), account_id text NOT NULL,
  debit_minor openerp.minor_units NOT NULL, credit_minor openerp.minor_units NOT NULL,
  description text NOT NULL,
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
  PRIMARY KEY (book_id, voucher_id, id), UNIQUE (book_id, voucher_id, ordinal),
  FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers,
  FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts
);
CREATE TABLE openerp.execution_receipts (
  book_id text NOT NULL, id text NOT NULL, change_set_id text NOT NULL,
  voucher_id text NOT NULL, approval_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id, id), UNIQUE (book_id, change_set_id),
  FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets,
  FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers,
  FOREIGN KEY (book_id, approval_id) REFERENCES openerp.approvals
);
CREATE TABLE openerp.command_receipts (
  book_id text NOT NULL REFERENCES openerp.books,
  key text NOT NULL, request_digest text NOT NULL, operation text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors, result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (book_id, key)
);
CREATE TABLE openerp.outbox (
  book_id text NOT NULL, id text NOT NULL,
  receipt_id text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, id), UNIQUE (book_id, receipt_id, kind),
  FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.execution_receipts
);

CREATE FUNCTION openerp.fail(code text, message text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = message, DETAIL = code; END $$;

CREATE FUNCTION openerp.new_id(prefix text) RETURNS text LANGUAGE sql VOLATILE
SET search_path = pg_catalog, openerp AS $$ SELECT prefix || '_' || replace(gen_random_uuid()::text, '-', '') $$;

CREATE FUNCTION openerp.canonical(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, openerp AS $$
DECLARE result text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || openerp.canonical(val), ',' ORDER BY key COLLATE "C"), '') || '}'
        INTO result FROM jsonb_each(value) item(key, val);
    WHEN 'array' THEN
      SELECT '[' || coalesce(string_agg(openerp.canonical(val), ',' ORDER BY ordinal), '') || ']'
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY item(val, ordinal);
    ELSE result := value::text;
  END CASE;
  RETURN result;
END $$;
CREATE FUNCTION openerp.digest(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, openerp AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(openerp.canonical(value), 'UTF8')), 'hex')
$$;

CREATE FUNCTION openerp.authenticate(token text) RETURNS text LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE actor text;
BEGIN
  IF token IS NULL OR length(token) < 32 OR length(token) > 512 THEN
    PERFORM openerp.fail('Unauthorized', 'A valid access token is required.');
  END IF;
  SELECT actor_id INTO actor FROM openerp.credentials
    WHERE token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
      AND revoked_at IS NULL AND expires_at > statement_timestamp();
  IF actor IS NULL THEN PERFORM openerp.fail('Unauthorized', 'The access token is invalid or expired.'); END IF;
  RETURN actor;
END $$;
CREATE FUNCTION openerp.authorize(token text, scope jsonb, operator_only boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; access_role text;
BEGIN
  actor := openerp.authenticate(token);
  SELECT m.role INTO access_role FROM openerp.memberships m JOIN openerp.books b ON b.id = m.book_id
    WHERE m.actor_id = actor AND b.id = scope->>'bookId' AND b.entity_id = scope->>'entityId';
  IF access_role IS NULL OR (operator_only AND access_role <> 'operator') THEN
    PERFORM openerp.fail('Forbidden', 'This credential does not have the required book authority.');
  END IF;
  RETURN actor;
END $$;

CREATE FUNCTION openerp.immutable_row() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN PERFORM openerp.fail('Forbidden', 'Accounting history is append-only. Create a linked correction.'); RETURN NULL; END $$;
CREATE TRIGGER immutable_voucher BEFORE UPDATE OR DELETE ON openerp.vouchers FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_line BEFORE UPDATE OR DELETE ON openerp.journal_lines FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON openerp.evidence FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON openerp.events FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_plan BEFORE UPDATE OR DELETE ON openerp.change_sets FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_execution BEFORE UPDATE OR DELETE ON openerp.execution_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_command BEFORE UPDATE OR DELETE ON openerp.command_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.check_voucher_balance() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE voucher text; line_count bigint; debit numeric; credit numeric;
BEGIN
  IF TG_TABLE_NAME = 'vouchers' THEN voucher := NEW.id; ELSE voucher := NEW.voucher_id; END IF;
  SELECT count(*), sum(debit_minor), sum(credit_minor) INTO line_count, debit, credit
    FROM openerp.journal_lines WHERE book_id = NEW.book_id AND voucher_id = voucher;
  IF line_count < 2 OR debit IS NULL OR debit <= 0 OR debit <> credit THEN
    PERFORM openerp.fail('InvalidJournal', 'A voucher must have at least two lines and balance exactly.');
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER voucher_balance AFTER INSERT ON openerp.vouchers DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION openerp.check_voucher_balance();
CREATE CONSTRAINT TRIGGER line_balance AFTER INSERT ON openerp.journal_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION openerp.check_voucher_balance();

CREATE FUNCTION openerp.replay(book text, key text, actor text, operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE previous openerp.command_receipts; fingerprint text;
BEGIN
  IF key IS NULL OR key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    PERFORM openerp.fail('IdempotencyConflict', 'Supply an Idempotency-Key containing 8–128 letters, digits, underscores or hyphens.');
  END IF;
  fingerprint := openerp.digest(jsonb_build_object('operation', operation, 'actor', actor, 'input', payload));
  SELECT * INTO previous FROM openerp.command_receipts r WHERE r.book_id = book AND r.key = replay.key;
  IF FOUND THEN
    IF previous.request_digest <> fingerprint THEN
      PERFORM openerp.fail('IdempotencyConflict', 'This idempotency key was already used for a different command.');
    END IF;
    RETURN previous.result;
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION openerp.save_command(book text, key text, actor text, operation text, payload jsonb, result jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
BEGIN
  INSERT INTO openerp.command_receipts VALUES (book, key,
    openerp.digest(jsonb_build_object('operation', operation, 'actor', actor, 'input', payload)), operation, actor, result, clock_timestamp());
  RETURN result;
END $$;

CREATE FUNCTION openerp.list_books(token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; result jsonb;
BEGIN
  actor := openerp.authenticate(token);
  SELECT coalesce(jsonb_agg(jsonb_build_object('entityId', b.entity_id, 'id', b.id, 'name', b.name,
    'currency', b.currency, 'profile', b.profile, 'role', m.role, 'sequence', b.committed_sequence::text) ORDER BY b.id), '[]') INTO result
    FROM openerp.books b JOIN openerp.memberships m ON m.book_id = b.id WHERE m.actor_id = actor;
  RETURN result;
END $$;
CREATE FUNCTION openerp.book_setup(token text, scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
DECLARE accounts jsonb; periods jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'active', active) ORDER BY code), '[]') INTO accounts
    FROM openerp.accounts WHERE book_id = scope->>'bookId';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'startsOn', starts_on::text, 'endsOn', ends_on::text, 'locked', locked) ORDER BY starts_on), '[]') INTO periods
    FROM openerp.periods WHERE book_id = scope->>'bookId';
  RETURN jsonb_build_object('accounts', accounts, 'periods', periods, 'blockers', jsonb_build_array(
    'Only the synthetic-core-v1 manual journal profile is implemented. This book is not verified for production accounting or Swedish compliance.',
    'Tax treatment, source completeness, external archive and statutory reporting are not implemented.'));
END $$;
CREATE FUNCTION openerp.create_evidence(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; row openerp.evidence; result jsonb; hash text;
BEGIN
  actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'create_evidence', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  IF coalesce(length(input->>'content'), 0) NOT BETWEEN 1 AND 65536
    OR coalesce(length(input->>'title'), 0) NOT BETWEEN 1 AND 2000
    OR coalesce(length(input->>'origin'), 0) NOT BETWEEN 1 AND 2000
    OR coalesce(input->>'mediaType', '') NOT IN ('text/plain', 'application/json') THEN
    PERFORM openerp.fail('MissingEvidence', 'Provide a title, origin and retained text of at most 65,536 characters.');
  END IF;
  IF input->>'mediaType' = 'application/json' THEN
    BEGIN PERFORM (input->>'content')::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN PERFORM openerp.fail('MissingEvidence', 'The evidence is not valid JSON.'); END;
  END IF;
  hash := encode(sha256(convert_to(input->>'content', 'UTF8')), 'hex');
  SELECT * INTO row FROM openerp.evidence WHERE book_id = scope->>'bookId' AND sha256 = hash;
  IF NOT FOUND THEN
    INSERT INTO openerp.evidence(book_id, id, title, content, media_type, origin, sha256, created_by)
      VALUES(scope->>'bookId', openerp.new_id('evidence'), input->>'title', input->>'content', input->>'mediaType', input->>'origin', hash, actor)
      RETURNING * INTO row;
  END IF;
  result := jsonb_build_object('id', row.id, 'title', row.title, 'sha256', row.sha256, 'mediaType', row.media_type,
    'origin', row.origin, 'createdAt', to_char(row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  RETURN openerp.save_command(scope->>'bookId', key, actor, 'create_evidence', input, result);
END $$;

CREATE FUNCTION openerp.bump_version() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
BEGIN NEW.version := OLD.version + 1; RETURN NEW; END $$;
CREATE TRIGGER account_version BEFORE UPDATE ON openerp.accounts FOR EACH ROW EXECUTE FUNCTION openerp.bump_version();
CREATE TRIGGER period_version BEFORE UPDATE ON openerp.periods FOR EACH ROW EXECUTE FUNCTION openerp.bump_version();
CREATE FUNCTION openerp.book_versions() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF (NEW.profile, NEW.currency, NEW.currency_scale) IS DISTINCT FROM (OLD.profile, OLD.currency, OLD.currency_scale) THEN
    NEW.profile_version := OLD.profile_version + 1;
  END IF;
  IF NEW.authority IS DISTINCT FROM OLD.authority THEN NEW.writer_epoch := OLD.writer_epoch + 1; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER book_versions BEFORE UPDATE ON openerp.books FOR EACH ROW EXECUTE FUNCTION openerp.book_versions();

CREATE FUNCTION openerp.inspect_action(book text, action jsonb) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE b openerp.books; p openerp.periods; y openerp.fiscal_years; account openerp.accounts;
  line jsonb; original jsonb; original_line jsonb; debit numeric := 0; credit numeric := 0;
  posting_date date; reference jsonb; i integer := 0; ids text[] := '{}';
BEGIN
  SELECT * INTO STRICT b FROM openerp.books WHERE id = book;
  IF b.authority <> 'native' THEN PERFORM openerp.fail('StaleDependency', 'This book is not assigned to the native writer.'); END IF;
  IF b.profile <> 'synthetic-core-v1' THEN
    PERFORM openerp.fail('UnsupportedProfile', 'Only the explicit synthetic manual journal profile is currently implemented.');
  END IF;
  IF action->>'kind' <> 'post_voucher' OR action->>'taxAssessment' IS DISTINCT FROM 'not_applicable'
    OR action->>'currency' IS DISTINCT FROM b.currency
    OR coalesce(length(action->>'description'), 0) NOT BETWEEN 1 AND 2000
    OR coalesce(length(action->>'rationale'), 0) NOT BETWEEN 1 AND 2000
    OR coalesce(action->>'series', '') !~ '^[A-Z0-9]{1,16}$'
    OR jsonb_typeof(action->'lines') IS DISTINCT FROM 'array'
    OR jsonb_typeof(action->'evidenceRefs') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting intent is incomplete or unsupported.');
  END IF;
  IF jsonb_array_length(action->'lines') NOT BETWEEN 2 AND 500 OR jsonb_array_length(action->'evidenceRefs') < 1 THEN
    PERFORM openerp.fail('InvalidJournal', 'Provide evidence and between 2 and 500 journal lines.');
  END IF;
  BEGIN
    posting_date := (action->>'postingDate')::date;
    IF to_char(posting_date, 'YYYY-MM-DD') IS DISTINCT FROM action->>'postingDate' THEN RAISE invalid_datetime_format; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting date is not a valid calendar date.');
  END;
  SELECT * INTO p FROM openerp.periods WHERE book_id = book AND id = action->>'accountingPeriodId';
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal', 'The accounting period does not belong to this book.'); END IF;
  SELECT * INTO STRICT y FROM openerp.fiscal_years WHERE book_id = book AND id = p.fiscal_year_id;
  IF action->>'fiscalYearId' IS DISTINCT FROM p.fiscal_year_id OR posting_date IS NULL
    OR posting_date NOT BETWEEN p.starts_on AND p.ends_on OR posting_date NOT BETWEEN y.starts_on AND y.ends_on
    OR p.starts_on < y.starts_on OR p.ends_on > y.ends_on THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting date, accounting period and fiscal year must agree.');
  END IF;
  IF p.locked THEN PERFORM openerp.fail('PeriodLocked', 'The period is locked. Use an open correction period or the authorized reopen workflow.'); END IF;
  IF action->>'postingPurpose' = 'reversal' THEN
    SELECT v.action INTO original FROM openerp.vouchers v WHERE v.book_id = book AND v.id = action->>'correctsVoucherId';
    IF original IS NULL OR original->>'postingPurpose' = 'reversal' THEN
      PERFORM openerp.fail('InvalidJournal', 'Choose an original voucher to reverse.');
    END IF;
    IF jsonb_array_length(action->'lines') <> jsonb_array_length(original->'lines')
      OR action->>'eventId' IS DISTINCT FROM original->>'eventId'
      OR action->'evidenceRefs' IS DISTINCT FROM original->'evidenceRefs'
      OR action->>'occurrenceKey' IS DISTINCT FROM action->>'correctsVoucherId' THEN
      PERFORM openerp.fail('InvalidJournal', 'A reversal must preserve the original evidence, event and complete line set.');
    END IF;
  ELSIF action->>'postingPurpose' IS DISTINCT FROM 'adjustment' OR action->>'correctsVoucherId' IS NOT NULL
    OR action->>'occurrenceKey' IS DISTINCT FROM 'manual_journal' THEN
    PERFORM openerp.fail('InvalidJournal', 'Unsupported posting purpose.');
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(action->'lines') LOOP
    IF coalesce(line->>'debitMinor', '') !~ '^(0|[1-9][0-9]{0,37})$'
      OR coalesce(line->>'creditMinor', '') !~ '^(0|[1-9][0-9]{0,37})$'
      OR coalesce(line->>'lineId', '') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR coalesce(length(line->>'description'), 0) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal', 'Each line needs exact nonnegative integer minor units and a description.');
    END IF;
    IF line->>'lineId' = ANY(ids) THEN PERFORM openerp.fail('InvalidJournal', 'Line identifiers must be unique.'); END IF;
    ids := array_append(ids, line->>'lineId');
    IF NOT (((line->>'debitMinor')::numeric > 0 AND (line->>'creditMinor')::numeric = 0)
      OR ((line->>'creditMinor')::numeric > 0 AND (line->>'debitMinor')::numeric = 0)) THEN
      PERFORM openerp.fail('InvalidJournal', 'Exactly one side of each line must be positive.');
    END IF;
    SELECT * INTO account FROM openerp.accounts WHERE book_id = book AND id = line->>'accountId';
    IF NOT FOUND OR (NOT account.active AND original IS NULL) THEN
      PERFORM openerp.fail('InvalidJournal', 'An account is unavailable or does not belong to this book.');
    END IF;
    IF original IS NOT NULL THEN
      original_line := original->'lines'->i;
      IF (line->>'accountId', line->>'debitMinor', line->>'creditMinor') IS DISTINCT FROM
        (original_line->>'accountId', original_line->>'creditMinor', original_line->>'debitMinor') THEN
        PERFORM openerp.fail('InvalidJournal', 'A reversal must use the original accounts and exactly opposite amounts.');
      END IF;
    END IF;
    debit := debit + (line->>'debitMinor')::numeric;
    credit := credit + (line->>'creditMinor')::numeric;
    i := i + 1;
  END LOOP;
  IF debit <> credit OR debit <= 0 THEN PERFORM openerp.fail('InvalidJournal', 'Debits and credits must balance exactly and be nonzero.'); END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(action->'evidenceRefs') LOOP
    IF NOT EXISTS (SELECT FROM openerp.evidence WHERE book_id = book AND id = reference->>'evidenceId' AND sha256 = reference->>'sha256') THEN
      PERFORM openerp.fail('MissingEvidence', 'An evidence reference is missing or its content hash differs.');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM openerp.events WHERE book_id = book AND id = action->>'eventId') THEN
    PERFORM openerp.fail('InvalidJournal', 'The business event does not belong to this book.');
  END IF;
END $$;

CREATE FUNCTION openerp.seal(scope jsonb, actor text, action jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE b openerp.books; p openerp.periods; dependencies jsonb; account_dependencies jsonb;
  plan jsonb; id text := openerp.new_id('change'); fingerprint text;
BEGIN
  PERFORM openerp.inspect_action(scope->>'bookId', action);
  SELECT * INTO STRICT b FROM openerp.books WHERE books.id = scope->>'bookId';
  SELECT * INTO STRICT p FROM openerp.periods WHERE book_id = b.id AND periods.id = action->>'accountingPeriodId';
  dependencies := jsonb_build_array(
    jsonb_build_object('kind', 'profile', 'resourceId', b.id, 'version', b.profile_version::text, 'reason', 'Book currency and supported profile'),
    jsonb_build_object('kind', 'writer_epoch', 'resourceId', b.id, 'version', b.writer_epoch::text, 'reason', 'Single authoritative writer'),
    jsonb_build_object('kind', 'period', 'resourceId', p.id, 'version', p.version::text, 'reason', 'Posting dates and lock state'));
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', 'account', 'resourceId', a.id, 'version', a.version::text,
      'reason', 'Exact account configuration') ORDER BY a.id), '[]') INTO account_dependencies
    FROM openerp.accounts a WHERE a.book_id = b.id AND a.id IN (SELECT value->>'accountId' FROM jsonb_array_elements(action->'lines'));
  plan := jsonb_build_object('schemaVersion', '1', 'canonicalization', 'openerp-c14n-v1', 'id', id, 'version', 1,
    'scope', scope, 'createdAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'dependencies', dependencies || account_dependencies,
    'groups', jsonb_build_array(jsonb_build_object('id', openerp.new_id('group'), 'dependsOnGroupIds', '[]'::jsonb, 'actions', jsonb_build_array(action))));
  fingerprint := openerp.digest(plan);
  plan := plan || jsonb_build_object('planDigest', fingerprint);
  INSERT INTO openerp.change_sets(book_id, id, plan, digest, created_by) VALUES(b.id, id, plan, fingerprint, actor);
  RETURN plan;
END $$;

CREATE FUNCTION openerp.prepare_journal(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; evidence openerp.evidence; event_id text; fiscal_year text; currency text;
  action jsonb; lines jsonb; result jsonb;
BEGIN
  actor := openerp.authorize(token, scope);
  SELECT b.currency INTO currency FROM openerp.books b WHERE id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'prepare_journal', input);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  IF input->>'kind' IS DISTINCT FROM 'manual_journal' OR coalesce(input->>'eventKey', '') !~ '^[a-zA-Z0-9_-]{1,128}$' THEN
    PERFORM openerp.fail('InvalidJournal', 'Choose the manual journal intent and a stable source component key.');
  END IF;
  SELECT * INTO evidence FROM openerp.evidence WHERE book_id = scope->>'bookId' AND id = input->>'evidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence', 'Retain the source evidence before preparing a journal.'); END IF;
  SELECT id INTO event_id FROM openerp.events WHERE book_id = scope->>'bookId' AND evidence_id = evidence.id AND event_key = input->>'eventKey';
  IF NOT FOUND THEN
    event_id := openerp.new_id('event');
    INSERT INTO openerp.events VALUES(scope->>'bookId', event_id, evidence.id, input->>'eventKey');
  END IF;
  SELECT fiscal_year_id INTO fiscal_year FROM openerp.periods WHERE book_id = scope->>'bookId' AND id = input->>'accountingPeriodId';
  IF jsonb_typeof(input->'lines') IS DISTINCT FROM 'array' THEN PERFORM openerp.fail('InvalidJournal', 'Provide journal lines.'); END IF;
  SELECT jsonb_agg(value || jsonb_build_object('lineId', openerp.new_id('line')) ORDER BY ordinal) INTO lines
    FROM jsonb_array_elements(input->'lines') WITH ORDINALITY item(value, ordinal);
  action := jsonb_build_object('kind', 'post_voucher', 'correctsVoucherId', NULL, 'eventId', event_id,
    'postingPurpose', 'adjustment', 'occurrenceKey', 'manual_journal', 'fiscalYearId', fiscal_year,
    'accountingPeriodId', input->>'accountingPeriodId', 'postingDate', input->>'postingDate', 'series', input->>'series',
    'currency', currency, 'description', input->>'description', 'rationale', input->>'rationale',
    'taxAssessment', input->>'taxAssessment', 'lines', lines,
    'evidenceRefs', jsonb_build_array(jsonb_build_object('evidenceId', evidence.id, 'sha256', evidence.sha256, 'locator', input->>'eventKey')));
  result := openerp.seal(scope, actor, action);
  RETURN openerp.save_command(scope->>'bookId', key, actor, 'prepare_journal', input, result);
END $$;

CREATE FUNCTION openerp.get_change(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT plan INTO result FROM openerp.change_sets WHERE book_id = scope->>'bookId' AND change_sets.id = get_change.id;
  IF result IS NULL THEN PERFORM openerp.fail('NotFound', 'The change set was not found in this book.'); END IF;
  RETURN result;
END $$;
CREATE FUNCTION openerp.check_dependencies(scope jsonb, plan jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE dependency jsonb; current_version text;
BEGIN
  IF plan->>'planDigest' IS DISTINCT FROM openerp.digest(plan - 'planDigest') THEN
    PERFORM openerp.fail('StaleDependency', 'The sealed plan digest is invalid.');
  END IF;
  FOR dependency IN SELECT value FROM jsonb_array_elements(plan->'dependencies') LOOP
    current_version := NULL;
    CASE dependency->>'kind'
      WHEN 'profile' THEN SELECT profile_version::text INTO current_version FROM openerp.books WHERE id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'writer_epoch' THEN SELECT writer_epoch::text INTO current_version FROM openerp.books WHERE id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'period' THEN SELECT version::text INTO current_version FROM openerp.periods WHERE book_id = scope->>'bookId' AND id = dependency->>'resourceId';
      WHEN 'account' THEN SELECT version::text INTO current_version FROM openerp.accounts WHERE book_id = scope->>'bookId' AND id = dependency->>'resourceId';
      ELSE PERFORM openerp.fail('StaleDependency', 'An unsupported dependency is present.');
    END CASE;
    IF current_version IS DISTINCT FROM dependency->>'version' THEN
      PERFORM openerp.fail('StaleDependency', 'The ' || (dependency->>'kind') || ' dependency ' || (dependency->>'resourceId') || ' changed. Prepare and approve a new plan.');
    END IF;
  END LOOP;
  PERFORM openerp.inspect_action(scope->>'bookId', plan->'groups'->0->'actions'->0);
END $$;
CREATE FUNCTION openerp.validate_change(token text, scope jsonb, id text, key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; plan jsonb; result jsonb; payload jsonb := jsonb_build_object('id', id);
BEGIN
  actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'validate_change', payload);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  plan := openerp.get_change(token, scope, id);
  PERFORM openerp.check_dependencies(scope, plan);
  result := jsonb_build_object('changeSetId', id, 'planDigest', plan->>'planDigest', 'status', 'valid',
    'checkedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  RETURN openerp.save_command(scope->>'bookId', key, actor, 'validate_change', payload, result);
END $$;
CREATE FUNCTION openerp.approve_change(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; plan jsonb; row openerp.approvals; result jsonb;
  payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  actor := openerp.authorize(token, scope, true);
  PERFORM 1 FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'approve_change', payload);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  plan := openerp.get_change(token, scope, id);
  IF input->>'planDigest' IS DISTINCT FROM plan->>'planDigest' OR input->>'version' IS DISTINCT FROM '1' THEN
    PERFORM openerp.fail('StaleDependency', 'Approve the exact version and digest shown in the review.');
  END IF;
  PERFORM openerp.check_dependencies(scope, plan);
  IF EXISTS (SELECT FROM openerp.execution_receipts WHERE book_id = scope->>'bookId' AND change_set_id = approve_change.id) THEN
    PERFORM openerp.fail('AlreadyPosted', 'This change set has already been posted.');
  END IF;
  INSERT INTO openerp.approvals(book_id, id, change_set_id, digest, actor_id, expires_at)
    VALUES(scope->>'bookId', openerp.new_id('approval'), id, plan->>'planDigest', actor, clock_timestamp() + interval '1 hour') RETURNING * INTO row;
  result := jsonb_build_object('id', row.id, 'changeSetId', id, 'planDigest', row.digest, 'actorId', actor,
    'expiresAt', to_char(row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  RETURN openerp.save_command(scope->>'bookId', key, actor, 'approve_change', payload, result);
END $$;

CREATE FUNCTION openerp.execute_change(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; plan jsonb; action jsonb; approval openerp.approvals;
  voucher_id text := openerp.new_id('voucher'); receipt_id text := openerp.new_id('receipt');
  voucher_number bigint; sequence bigint; recorded_at timestamptz; result jsonb;
  payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'execute_change', payload);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  plan := openerp.get_change(token, scope, id);
  action := plan->'groups'->0->'actions'->0;
  IF input->>'planDigest' IS DISTINCT FROM plan->>'planDigest' OR input->>'version' IS DISTINCT FROM '1' THEN
    PERFORM openerp.fail('StaleDependency', 'Execute the exact approved version and digest.');
  END IF;
  PERFORM 1 FROM openerp.periods WHERE book_id = scope->>'bookId' AND periods.id = action->>'accountingPeriodId' FOR SHARE;
  PERFORM 1 FROM openerp.accounts WHERE book_id = scope->>'bookId'
    AND accounts.id IN (SELECT value->>'accountId' FROM jsonb_array_elements(action->'lines')) ORDER BY accounts.id FOR SHARE;
  PERFORM openerp.check_dependencies(scope, plan);
  SELECT * INTO approval FROM openerp.approvals WHERE book_id = scope->>'bookId' AND approvals.id = input->>'approvalId' FOR UPDATE;
  IF NOT FOUND OR approval.change_set_id <> id OR approval.digest <> plan->>'planDigest'
    OR approval.consumed_at IS NOT NULL OR approval.expires_at <= clock_timestamp() THEN
    PERFORM openerp.fail('ApprovalRequired', 'A current, unconsumed human approval of this exact change set is required.');
  END IF;
  PERFORM 1 FROM openerp.memberships WHERE book_id = scope->>'bookId' AND actor_id = approval.actor_id AND role = 'operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired', 'The approver no longer has authority for this book.'); END IF;
  IF EXISTS (SELECT FROM openerp.vouchers WHERE book_id = scope->>'bookId' AND
    ((event_id = action->>'eventId' AND posting_purpose = action->>'postingPurpose' AND occurrence_key = action->>'occurrenceKey')
      OR change_set_id = execute_change.id OR (action->>'postingPurpose' = 'reversal' AND corrects_voucher_id = action->>'correctsVoucherId'))) THEN
    PERFORM openerp.fail('AlreadyPosted', 'This economic posting already exists. Inspect the original voucher or recover its receipt.');
  END IF;
  INSERT INTO openerp.series_counters(book_id, fiscal_year_id, series, last_number)
    VALUES(scope->>'bookId', action->>'fiscalYearId', action->>'series', 1)
    ON CONFLICT (book_id, fiscal_year_id, series) DO UPDATE SET last_number = openerp.series_counters.last_number + 1
    RETURNING last_number INTO voucher_number;
  UPDATE openerp.books SET committed_sequence = committed_sequence + 1 WHERE books.id = scope->>'bookId'
    RETURNING committed_sequence INTO sequence;
  INSERT INTO openerp.vouchers(book_id, id, fiscal_year_id, period_id, series, number, sequence, posting_date,
      event_id, posting_purpose, occurrence_key, corrects_voucher_id, change_set_id, action)
    VALUES(scope->>'bookId', voucher_id, action->>'fiscalYearId', action->>'accountingPeriodId', action->>'series', voucher_number,
      sequence, (action->>'postingDate')::date, action->>'eventId', action->>'postingPurpose', action->>'occurrenceKey',
      action->>'correctsVoucherId', id, action) RETURNING vouchers.recorded_at INTO recorded_at;
  INSERT INTO openerp.journal_lines(book_id, voucher_id, id, ordinal, account_id, debit_minor, credit_minor, description)
    SELECT scope->>'bookId', voucher_id, value->>'lineId', ordinal, value->>'accountId', (value->>'debitMinor')::numeric,
      (value->>'creditMinor')::numeric, value->>'description'
      FROM jsonb_array_elements(action->'lines') WITH ORDINALITY item(value, ordinal);
  result := jsonb_build_object('id', receipt_id, 'changeSetId', id, 'voucherId', voucher_id, 'planDigest', plan->>'planDigest',
    'sequence', sequence::text, 'voucherNumber', voucher_number::text,
    'committedAt', to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO openerp.execution_receipts VALUES(scope->>'bookId', receipt_id, id, voucher_id, approval.id, result);
  UPDATE openerp.approvals SET consumed_at = recorded_at WHERE book_id = scope->>'bookId' AND approvals.id = approval.id;
  INSERT INTO openerp.outbox(book_id, id, receipt_id, kind, payload)
    VALUES(scope->>'bookId', openerp.new_id('outbox'), receipt_id, 'voucher.posted.v1', result);
  RETURN openerp.save_command(scope->>'bookId', key, actor, 'execute_change', payload, result);
END $$;
CREATE FUNCTION openerp.prepare_correction(token text, scope jsonb, id text, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; previous jsonb; original jsonb; action jsonb; lines jsonb; fiscal_year text; result jsonb;
  payload jsonb := jsonb_build_object('id', id, 'input', input);
BEGIN
  actor := openerp.authorize(token, scope);
  PERFORM 1 FROM openerp.books WHERE books.id = scope->>'bookId' FOR UPDATE;
  previous := openerp.replay(scope->>'bookId', key, actor, 'prepare_correction', payload);
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT v.action INTO original FROM openerp.vouchers v WHERE book_id = scope->>'bookId' AND v.id = prepare_correction.id;
  IF original IS NULL THEN PERFORM openerp.fail('NotFound', 'The original voucher was not found in this book.'); END IF;
  SELECT fiscal_year_id INTO fiscal_year FROM openerp.periods WHERE book_id = scope->>'bookId' AND periods.id = input->>'accountingPeriodId';
  SELECT jsonb_agg(value || jsonb_build_object('lineId', openerp.new_id('line'), 'debitMinor', value->>'creditMinor',
    'creditMinor', value->>'debitMinor') ORDER BY ordinal) INTO lines FROM jsonb_array_elements(original->'lines') WITH ORDINALITY item(value, ordinal);
  action := original || jsonb_build_object('correctsVoucherId', id, 'postingPurpose', 'reversal', 'occurrenceKey', id,
    'fiscalYearId', fiscal_year, 'accountingPeriodId', input->>'accountingPeriodId', 'postingDate', input->>'postingDate',
    'description', 'Reversal: ' || left(original->>'description', 1990), 'rationale', input->>'rationale', 'lines', lines);
  result := openerp.seal(scope, actor, action);
  RETURN openerp.save_command(scope->>'bookId', key, actor, 'prepare_correction', payload, result);
END $$;
CREATE FUNCTION openerp.voucher_body(voucher openerp.vouchers) RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT jsonb_build_object('id', voucher.id, 'number', voucher.number::text, 'sequence', voucher.sequence::text,
    'recordedAt', to_char(voucher.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'action', voucher.action)
$$;
CREATE FUNCTION openerp.get_voucher(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT openerp.voucher_body(v) INTO result FROM openerp.vouchers v WHERE book_id = scope->>'bookId' AND v.id = get_voucher.id;
  IF result IS NULL THEN PERFORM openerp.fail('NotFound', 'The voucher was not found in this book.'); END IF;
  RETURN result;
END $$;
CREATE FUNCTION openerp.list_vouchers(token text, scope jsonb, after_sequence text DEFAULT '0') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE items jsonb; last_sequence bigint; has_more boolean;
BEGIN
  PERFORM openerp.authorize(token, scope);
  IF coalesce(after_sequence, '') !~ '^(0|[1-9][0-9]{0,37})$' THEN PERFORM openerp.fail('InvalidJournal', 'The cursor must be a nonnegative sequence string.'); END IF;
  SELECT coalesce(jsonb_agg(openerp.voucher_body(page) ORDER BY page.sequence), '[]'), max(page.sequence) INTO items, last_sequence
    FROM (SELECT v.* FROM openerp.vouchers v WHERE book_id = scope->>'bookId' AND v.sequence > after_sequence::numeric ORDER BY v.sequence LIMIT 100) page;
  SELECT EXISTS(SELECT FROM openerp.vouchers WHERE book_id = scope->>'bookId' AND sequence > last_sequence) INTO has_more;
  RETURN jsonb_build_object('items', items, 'next', CASE WHEN has_more THEN last_sequence::text ELSE NULL END);
END $$;
CREATE FUNCTION openerp.ledger_snapshot(token text, scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sequence bigint; accounts jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT committed_sequence INTO sequence FROM openerp.books WHERE id = scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId', a.id, 'code', a.code, 'name', a.name,
    'debitMinor', coalesce(t.debit, 0)::text, 'creditMinor', coalesce(t.credit, 0)::text,
    'balanceMinor', (coalesce(t.debit, 0) - coalesce(t.credit, 0))::text) ORDER BY a.code), '[]') INTO accounts
    FROM openerp.accounts a LEFT JOIN (
      SELECT l.account_id, sum(l.debit_minor) debit, sum(l.credit_minor) credit
      FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
      WHERE l.book_id = scope->>'bookId' AND v.sequence <= ledger_snapshot.sequence GROUP BY l.account_id
    ) t ON t.account_id = a.id WHERE a.book_id = scope->>'bookId';
  RETURN jsonb_build_object('sequence', sequence::text, 'accounts', accounts);
END $$;
CREATE FUNCTION openerp.get_receipt(token text, scope jsonb, key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT r.result INTO result FROM openerp.command_receipts r
    WHERE book_id = scope->>'bookId' AND r.key = get_receipt.key AND operation = 'execute_change';
  IF result IS NULL THEN PERFORM openerp.fail('NotFound', 'No committed execution receipt exists for this idempotency key.'); END IF;
  RETURN result;
END $$;

CREATE FUNCTION openerp.check_calendar() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE year_start date; year_end date;
BEGIN
  PERFORM 1 FROM openerp.books WHERE id = NEW.book_id FOR UPDATE;
  IF TG_TABLE_NAME = 'fiscal_years' THEN
    IF EXISTS (SELECT FROM openerp.fiscal_years WHERE book_id = NEW.book_id AND id <> NEW.id
      AND daterange(starts_on, ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')) THEN
      PERFORM openerp.fail('InvalidJournal', 'Fiscal years in a book must not overlap.');
    END IF;
  ELSE
    SELECT starts_on, ends_on INTO year_start, year_end FROM openerp.fiscal_years WHERE book_id = NEW.book_id AND id = NEW.fiscal_year_id;
    IF year_start IS NULL OR NEW.starts_on < year_start OR NEW.ends_on > year_end THEN
      PERFORM openerp.fail('InvalidJournal', 'An accounting period must be inside its fiscal year.');
    END IF;
    IF EXISTS (SELECT FROM openerp.periods WHERE book_id = NEW.book_id AND id <> NEW.id
      AND daterange(starts_on, ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')) THEN
      PERFORM openerp.fail('InvalidJournal', 'Accounting periods in a book must not overlap.');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER year_calendar BEFORE INSERT ON openerp.fiscal_years FOR EACH ROW EXECUTE FUNCTION openerp.check_calendar();
CREATE TRIGGER immutable_year BEFORE UPDATE OR DELETE ON openerp.fiscal_years FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER period_calendar BEFORE INSERT OR UPDATE ON openerp.periods FOR EACH ROW EXECUTE FUNCTION openerp.check_calendar();

REVOKE ALL ON ALL TABLES IN SCHEMA openerp FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA openerp FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA openerp FROM PUBLIC;
GRANT USAGE ON SCHEMA openerp TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_books(text), openerp.book_setup(text,jsonb),
  openerp.create_evidence(text,jsonb,text,jsonb), openerp.prepare_journal(text,jsonb,text,jsonb),
  openerp.get_change(text,jsonb,text), openerp.validate_change(text,jsonb,text,text),
  openerp.approve_change(text,jsonb,text,text,jsonb), openerp.execute_change(text,jsonb,text,text,jsonb),
  openerp.prepare_correction(text,jsonb,text,text,jsonb), openerp.get_voucher(text,jsonb,text),
  openerp.list_vouchers(text,jsonb,text), openerp.ledger_snapshot(text,jsonb), openerp.get_receipt(text,jsonb,text)
  TO openerp_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA openerp REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
