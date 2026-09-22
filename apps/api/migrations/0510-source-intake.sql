-- Forward-only source retention and bounded CSV intake. Does not replace bank or ledger authority.
CREATE TABLE openerp.intake_contents (
  book_id text NOT NULL REFERENCES openerp.books, sha256 text NOT NULL,
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 65536),
  PRIMARY KEY(book_id,sha256),
  CHECK(sha256='sha256:'||encode(sha256(bytes),'hex'))
);
CREATE TABLE openerp.intake_occurrences (
  book_id text NOT NULL, id text NOT NULL, sha256 text NOT NULL,
  source_system text NOT NULL, source_account_id text NOT NULL,
  occurrence_key text NOT NULL, source_revision text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id),
  UNIQUE(book_id,source_system,source_account_id,occurrence_key,source_revision),
  FOREIGN KEY(book_id,sha256) REFERENCES openerp.intake_contents
);
CREATE TABLE openerp.intake_previews (
  book_id text NOT NULL, id text NOT NULL, occurrence_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 50), body jsonb NOT NULL,
  PRIMARY KEY(book_id,id), UNIQUE(book_id,occurrence_id,ordinal),
  FOREIGN KEY(book_id,occurrence_id) REFERENCES openerp.intake_occurrences
);
CREATE TABLE openerp.intake_approvals (
  book_id text NOT NULL, id text NOT NULL, preview_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors, expires_at timestamptz NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,preview_id) REFERENCES openerp.intake_previews
);
CREATE TABLE openerp.intake_admissions (
  book_id text NOT NULL, occurrence_id text NOT NULL, preview_id text NOT NULL,
  approval_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(book_id,occurrence_id),
  FOREIGN KEY(book_id,occurrence_id) REFERENCES openerp.intake_occurrences,
  FOREIGN KEY(book_id,preview_id) REFERENCES openerp.intake_previews,
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.intake_approvals
);
CREATE TRIGGER immutable_intake_contents BEFORE UPDATE OR DELETE ON openerp.intake_contents FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_occurrences BEFORE UPDATE OR DELETE ON openerp.intake_occurrences FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_previews BEFORE UPDATE OR DELETE ON openerp.intake_previews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_approvals BEFORE UPDATE OR DELETE ON openerp.intake_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_intake_admissions BEFORE UPDATE OR DELETE ON openerp.intake_admissions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.intake_diagnostic(code text, message text, record integer DEFAULT NULL, line integer DEFAULT NULL, offset_byte integer DEFAULT NULL, severity text DEFAULT 'error') RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
 SELECT jsonb_build_array(jsonb_build_object('severity',severity,'code',code,'message',message,'recordOrdinal',record,'line',line,'byteOffset',offset_byte))
$$;
CREATE FUNCTION openerp.intake_dependencies(book text, account text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
 SELECT jsonb_build_object('profileVersion',b.profile_version::text,'writerEpoch',b.writer_epoch::text,
 'accountVersion',a.version::text,'sourceRevision',coalesce(s.revision,0)::text)
 FROM openerp.books b LEFT JOIN openerp.accounts a ON a.book_id=b.id AND a.id=intake_dependencies.account
 LEFT JOIN openerp.bank_sources s ON s.book_id=b.id AND s.account_id=intake_dependencies.account WHERE b.id=intake_dependencies.book
$$;

-- Byte offsets are zero-based, end-exclusive. Physical lines and records are one-based.
-- Decode once to validate UTF-8, then scan ASCII syntax with O(1) byte access.
CREATE FUNCTION openerp.intake_csv_records(bytes bytea, delimiter text, endings text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_size integer:=octet_length(bytes); v_pos integer:=0; v_field_start integer:=0;
 v_field_end integer; v_record_start integer:=0; v_line integer:=1; v_record_line integer:=1;
 v_ordinal integer:=1; v_state text:='start'; v_byte integer; v_step integer;
 v_delimiter integer:=ascii(delimiter); v_fields jsonb:='[]'; v_records jsonb:='[]';
 v_value text; v_bom boolean:=false; v_error text; v_message text;
BEGIN
 BEGIN PERFORM convert_from(bytes,'UTF8');
 EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN
   RETURN jsonb_build_object('structuralComplete',false,'hasBom',false,'records','[]'::jsonb,
     'diagnostics',openerp.intake_diagnostic('encoding','Only valid UTF-8 without NUL is supported. Original bytes remain retained.'));
 END;
 IF substring(bytes FROM 1 FOR 3)=decode('efbbbf','hex') THEN v_bom:=true; v_pos:=3; v_field_start:=3; v_record_start:=3; END IF;
 WHILE v_pos<=v_size LOOP
   v_byte:=CASE WHEN v_pos=v_size THEN -1 ELSE get_byte(bytes,v_pos) END;
   v_step:=1;
   IF v_state='quoted' THEN
     IF v_byte=-1 THEN v_error:='unclosed_quote'; v_message:='The quoted field is not closed.'; EXIT; END IF;
     IF v_byte=34 THEN
       IF v_pos+1<v_size AND get_byte(bytes,v_pos+1)=34 THEN v_pos:=v_pos+2; CONTINUE; END IF;
       v_field_end:=v_pos; v_state:='closed';
     ELSIF v_byte IN (10,13) THEN
       IF v_byte=13 AND endings='crlf' AND v_pos+1<v_size AND get_byte(bytes,v_pos+1)=10 THEN v_step:=2;
       ELSIF NOT(v_byte=10 AND endings='lf') THEN v_error:='line_ending'; v_message:='Line endings do not match the reviewed profile.'; EXIT; END IF;
       v_line:=v_line+1;
     END IF;
     IF v_pos-v_field_start>4000 THEN v_error:='field_limit'; v_message:='A field exceeds 4000 source bytes.'; EXIT; END IF;
     v_pos:=v_pos+v_step; CONTINUE;
   END IF;
   IF v_state='start' AND v_byte=34 THEN v_state:='quoted'; v_field_start:=v_pos+1; v_pos:=v_pos+1; CONTINUE; END IF;
   IF v_byte IN (-1,10,13,v_delimiter) THEN
     -- A terminal line ending is not an extra empty record. A blank record is still an error later.
     IF v_byte=-1 AND v_pos=v_record_start AND v_fields='[]'::jsonb AND v_state='start' THEN EXIT; END IF;
     IF v_byte=13 AND endings='crlf' AND v_pos+1<v_size AND get_byte(bytes,v_pos+1)=10 THEN v_step:=2;
     ELSIF v_byte=13 OR (v_byte=10 AND endings<>'lf') THEN v_error:='line_ending'; v_message:='Line endings do not match the reviewed profile.'; EXIT; END IF;
     IF v_state<>'closed' THEN v_field_end:=v_pos; END IF;
     IF v_field_end-v_field_start>4000 THEN v_error:='field_limit'; v_message:='A field exceeds 4000 source bytes.'; EXIT; END IF;
     v_value:=convert_from(substring(bytes FROM v_field_start+1 FOR v_field_end-v_field_start),'UTF8');
     IF v_state='closed' THEN v_value:=replace(v_value,'""','"'); END IF;
     v_fields:=v_fields||jsonb_build_array(v_value);
     IF jsonb_array_length(v_fields)>32 THEN v_error:='column_limit'; v_message:='At most 32 columns are supported.'; EXIT; END IF;
     IF v_byte<>v_delimiter THEN
       IF v_ordinal>201 THEN v_error:='record_limit'; v_message:='At most 200 data records are supported. No partial import is available.'; EXIT; END IF;
       v_records:=v_records||jsonb_build_array(jsonb_build_object('recordOrdinal',v_ordinal,'lineStart',v_record_line,
         'lineEnd',v_line,'byteStart',v_record_start,'byteEnd',v_pos,'fields',v_fields));
       v_fields:='[]'; v_ordinal:=v_ordinal+1;
       IF v_byte<>-1 THEN v_line:=v_line+1; END IF;
       v_record_line:=v_line; v_record_start:=v_pos+v_step;
     END IF;
     v_state:='start'; v_field_start:=v_pos+v_step;
   ELSIF v_byte=34 OR v_state='closed' THEN
     v_error:='quote_syntax'; v_message:='Quotes must surround the whole field; text after a closing quote is unsupported.'; EXIT;
   ELSE v_state:='unquoted';
   END IF;
   v_pos:=v_pos+v_step;
 END LOOP;
 IF v_error IS NOT NULL THEN
   RETURN jsonb_build_object('structuralComplete',false,'hasBom',v_bom,'records','[]'::jsonb,
    'diagnostics',openerp.intake_diagnostic(v_error,v_message,v_ordinal,v_line,v_pos));
 END IF;
 RETURN jsonb_build_object('structuralComplete',true,'hasBom',v_bom,'records',v_records,'diagnostics','[]'::jsonb);
END $$;

CREATE FUNCTION openerp.intake_check_mapping(input jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_name text;
BEGIN
 IF input->>'profile' IS DISTINCT FROM 'bank_csv_utf8_v1'
 OR coalesce(input->>'delimiter','') NOT IN (',',';',E'\t') OR coalesce(input->>'lineEnding','') NOT IN ('lf','crlf')
 OR coalesce(input->>'dateFormat','') NOT IN ('YYYY-MM-DD','DD/MM/YYYY')
 OR coalesce(input->>'decimalSeparator','') NOT IN ('.',',') OR coalesce(input->>'sign','') NOT IN ('inflow_positive','outflow_positive')
 OR coalesce(input->>'currency','') !~ '^[A-Z]{3}$' OR coalesce(input->>'accountId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
 OR jsonb_typeof(input->'currencyScale') IS DISTINCT FROM 'number' OR coalesce(input->>'currencyScale','') !~ '^[0-6]$'
 OR coalesce(input->>'openingMinor','') !~ '^(0|-?[1-9][0-9]{0,37})$' OR coalesce(input->>'closingMinor','') !~ '^(0|-?[1-9][0-9]{0,37})$'
 OR jsonb_typeof(input->'openingMinor') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'closingMinor') IS DISTINCT FROM 'string'
 OR jsonb_typeof(input->'completeness'->'declaredComplete') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(input->'completeness'->'basis') IS DISTINCT FROM 'string'
 OR coalesce(length(input->'completeness'->>'basis'),0) NOT BETWEEN 1 AND 2000
 THEN PERFORM openerp.fail('InvalidJournal','Supply an explicit supported CSV mapping, exact declared controls and coverage basis.'); END IF;
 FOREACH v_name IN ARRAY ARRAY['dateColumn','descriptionColumn','amountColumn'] LOOP
   IF jsonb_typeof(input->v_name) IS DISTINCT FROM 'string' OR coalesce(length(input->>v_name),0) NOT BETWEEN 1 AND 200 THEN
     PERFORM openerp.fail('InvalidJournal','Map date, description and amount using exact header names.'); END IF;
 END LOOP;
 IF NOT(input?'providerIdColumn') OR (input->'providerIdColumn'<>'null'::jsonb AND
   (jsonb_typeof(input->'providerIdColumn') IS DISTINCT FROM 'string' OR length(input->>'providerIdColumn') NOT BETWEEN 1 AND 200)) THEN
   PERFORM openerp.fail('InvalidJournal','Select a provider ID column or explicitly choose none.'); END IF;
 IF openerp.bank_date(input->>'startsOn')>openerp.bank_date(input->>'endsOn') THEN PERFORM openerp.fail('InvalidJournal','The declared interval is reversed.'); END IF;
END $$;

CREATE FUNCTION openerp.intake_parse_money(value text, separator text, scale integer) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_pattern text; v_integer text; v_fraction text; v_result numeric;
BEGIN
 v_pattern:='^[+-]?(0|[1-9][0-9]*)(['||separator||'][0-9]{1,'||scale||'})?$';
 IF scale=0 THEN v_pattern:='^[+-]?(0|[1-9][0-9]*)$'; END IF;
 IF value IS NULL OR length(value)>48 OR value!~v_pattern THEN RETURN NULL; END IF;
 v_integer:=split_part(value,separator,1); v_fraction:=split_part(value,separator,2);
 v_result:=abs(v_integer::numeric)*power(10::numeric,scale)+coalesce(nullif(rpad(v_fraction,scale,'0'),''),'0')::numeric;
 IF left(value,1)='-' THEN v_result:=-v_result; END IF;
 IF abs(v_result)>=1e38::numeric THEN RETURN NULL; END IF;
 RETURN trunc(v_result);
END $$;

CREATE FUNCTION openerp.intake_interpret(book text, occurrence openerp.intake_occurrences, mapping jsonb, parsed jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_diagnostics jsonb:=parsed->'diagnostics'; v_records jsonb:=parsed->'records'; v_rows jsonb:='[]';
 v_headers jsonb:=v_records->0->'fields'; v_record jsonb; v_fields jsonb; v_header text;
 v_date_index integer; v_description_index integer; v_amount_index integer; v_provider_index integer;
 v_date text; v_valid_date date; v_description text; v_provider text; v_amount numeric;
 v_total numeric:=0; v_before integer; v_ordinal integer; v_statement jsonb; v_ready boolean;
BEGIN
 IF coalesce(jsonb_array_length(v_records),0)=0 THEN
   IF (parsed->>'structuralComplete')::boolean THEN v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('empty_file','A header and at least one data record are required.'); END IF;
 ELSE
   IF jsonb_array_length(v_records)<2 THEN v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('no_records','At least one data record is required.'); END IF;
   IF EXISTS(SELECT FROM jsonb_array_elements_text(v_headers) h(value) WHERE length(h.value) NOT BETWEEN 1 AND 200)
     OR (SELECT count(*)<>count(DISTINCT h.value) FROM jsonb_array_elements_text(v_headers) h(value)) THEN
     v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('header','Header names must be nonempty, unique and at most 200 characters.',1,1,0);
   END IF;
   SELECT (ordinality-1)::integer INTO v_date_index FROM jsonb_array_elements_text(v_headers) WITH ORDINALITY h(value,ordinality) WHERE h.value=mapping->>'dateColumn' LIMIT 1;
   SELECT (ordinality-1)::integer INTO v_description_index FROM jsonb_array_elements_text(v_headers) WITH ORDINALITY h(value,ordinality) WHERE h.value=mapping->>'descriptionColumn' LIMIT 1;
   SELECT (ordinality-1)::integer INTO v_amount_index FROM jsonb_array_elements_text(v_headers) WITH ORDINALITY h(value,ordinality) WHERE h.value=mapping->>'amountColumn' LIMIT 1;
   SELECT (ordinality-1)::integer INTO v_provider_index FROM jsonb_array_elements_text(v_headers) WITH ORDINALITY h(value,ordinality) WHERE h.value=mapping->>'providerIdColumn' LIMIT 1;
   IF v_date_index IS NULL OR v_description_index IS NULL OR v_amount_index IS NULL OR (mapping->>'providerIdColumn' IS NOT NULL AND v_provider_index IS NULL)
      OR (SELECT count(*)<>count(DISTINCT n) FROM unnest(ARRAY[v_date_index,v_description_index,v_amount_index,v_provider_index]) n WHERE n IS NOT NULL) THEN
     v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('columns','Select different, exact existing header names for every mapped column.',1,1,0);
   ELSE
     FOR v_header IN SELECT value FROM jsonb_array_elements_text(v_headers) h(value) WHERE h.value<>ALL(array_remove(ARRAY[mapping->>'dateColumn',mapping->>'descriptionColumn',mapping->>'amountColumn',mapping->>'providerIdColumn'],NULL)) LOOP
       v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('unmapped_column','Retained but not interpreted: '||v_header,1,1,0,'warning');
     END LOOP;
     FOR v_record IN SELECT value FROM jsonb_array_elements(v_records) r(value) WHERE (r.value->>'recordOrdinal')::integer>1 LOOP
       v_fields:=v_record->'fields'; v_ordinal:=(v_record->>'recordOrdinal')::integer;
       v_before:=jsonb_array_length(v_diagnostics);
       IF jsonb_array_length(v_fields)<>jsonb_array_length(v_headers) OR v_fields='[""]'::jsonb THEN
         v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('row_width','Blank records and records with a different column count are unsupported.',v_ordinal,(v_record->>'lineStart')::integer,(v_record->>'byteStart')::integer); CONTINUE;
       END IF;
       v_date:=v_fields->>v_date_index;
       IF mapping->>'dateFormat'='DD/MM/YYYY' THEN
         IF v_date~'^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN v_date:=substring(v_date,7,4)||'-'||substring(v_date,4,2)||'-'||substring(v_date,1,2); ELSE v_date:=NULL; END IF;
       END IF;
       v_valid_date:=NULL;
       BEGIN
         IF v_date~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN v_valid_date:=v_date::date; END IF;
       EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN v_valid_date:=NULL; END;
       IF v_valid_date IS NULL OR to_char(v_valid_date,'YYYY-MM-DD') IS DISTINCT FROM v_date OR v_date<mapping->>'startsOn' OR v_date>mapping->>'endsOn' THEN
         v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('date','Use a valid date in the selected format and declared interval.',v_ordinal,(v_record->>'lineStart')::integer,(v_record->>'byteStart')::integer);
       END IF;
       v_description:=v_fields->>v_description_index;
       IF length(v_description) NOT BETWEEN 1 AND 2000 THEN v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('description','Description must contain 1–2000 characters.',v_ordinal,(v_record->>'lineStart')::integer,(v_record->>'byteStart')::integer); END IF;
       v_amount:=openerp.intake_parse_money(v_fields->>v_amount_index,mapping->>'decimalSeparator',(mapping->>'currencyScale')::integer);
       IF v_amount IS NULL THEN v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('amount','Unsupported amount, fractional precision or 38-digit minor-unit bound. Grouping and spaces are not supported.',v_ordinal,(v_record->>'lineStart')::integer,(v_record->>'byteStart')::integer); END IF;
       IF mapping->>'sign'='outflow_positive' THEN v_amount:=-v_amount; END IF;
       v_provider:=CASE WHEN v_provider_index IS NULL THEN NULL ELSE v_fields->>v_provider_index END;
       IF v_provider_index IS NOT NULL AND (length(v_provider) NOT BETWEEN 1 AND 200 OR EXISTS(SELECT FROM jsonb_array_elements(v_rows) r WHERE r->>'providerId'=v_provider)
         OR EXISTS(SELECT FROM openerp.bank_observations o WHERE o.book_id=book AND o.source_bank_account_id=occurrence.source_account_id AND o.provider_id=v_provider)) THEN
         v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('provider_identity','Provider ID is empty, too long or already represented. No row was discarded.',v_ordinal,(v_record->>'lineStart')::integer,(v_record->>'byteStart')::integer);
       END IF;
       IF v_before=jsonb_array_length(v_diagnostics) THEN
         v_rows:=v_rows||jsonb_build_array(jsonb_build_object('rowOrdinal',v_ordinal-1,'providerId',v_provider,'date',v_date,'description',v_description,'amountMinor',v_amount::text)); v_total:=v_total+v_amount;
       END IF;
     END LOOP;
   END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM openerp.books b JOIN openerp.accounts a ON a.book_id=b.id WHERE b.id=book AND a.id=mapping->>'accountId' AND a.active AND b.currency=mapping->>'currency' AND b.currency_scale=(mapping->>'currencyScale')::integer) THEN
   v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('account_currency','Select an active account and explicitly confirm the book currency and scale.'); END IF;
 IF NOT EXISTS(SELECT FROM openerp.books b WHERE b.id=book AND b.profile='synthetic-core-v1' AND b.authority='native') THEN
   v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('admission_profile','Current bank admission supports only native synthetic-core-v1 books. Retention and diagnostics do not activate a real company.'); END IF;
 IF EXISTS(SELECT FROM openerp.bank_statements s WHERE s.book_id=book AND s.account_id=mapping->>'accountId' AND s.starts_on<=(mapping->>'endsOn')::date AND s.ends_on>=(mapping->>'startsOn')::date) THEN
   v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('overlap','An existing statement overlaps the declared interval. Explicit overlap reconciliation is not supported.'); END IF;
 IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=book AND ((s.account_id=mapping->>'accountId' AND s.source_bank_account_id<>occurrence.source_account_id) OR (s.source_bank_account_id=occurrence.source_account_id AND s.account_id<>mapping->>'accountId'))) THEN
   v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('source_mapping','The source account conflicts with an existing bank mapping.'); END IF;
 IF (mapping->>'openingMinor')::numeric+v_total<>(mapping->>'closingMinor')::numeric THEN
   v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('controls','Declared opening plus all valid movements does not equal declared closing. Invalid records also block admission.'); END IF;
 v_statement:=jsonb_build_object('kind','synthetic_bank_statement_v1','statementIdentifier',occurrence.id,'sourceBankAccountId',occurrence.source_account_id,
   'accountId',mapping->>'accountId','currency',mapping->>'currency','startsOn',mapping->>'startsOn','endsOn',mapping->>'endsOn',
   'openingMinor',mapping->>'openingMinor','closingMinor',mapping->>'closingMinor','completeness',mapping->'completeness','rows',v_rows);
 IF length(v_statement::text)>65536 OR octet_length(v_statement::text)>262144 THEN v_diagnostics:=v_diagnostics||openerp.intake_diagnostic('normalized_limit','Normalized evidence exceeds the current evidence authority limit. No partial admission is available.'); END IF;
 v_ready:=NOT EXISTS(SELECT FROM jsonb_array_elements(v_diagnostics) d WHERE d->>'severity'='error');
 RETURN parsed||jsonb_build_object('rows',v_rows,'diagnostics',v_diagnostics,'ready',v_ready,'movementMinor',v_total::text,'statement',CASE WHEN v_ready THEN v_statement ELSE NULL END);
END $$;

CREATE FUNCTION openerp.retain_source(token text, scope jsonb, key text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_bytes bytea; v_hash text; v_name text;
 v_occurrence openerp.intake_occurrences; v_body jsonb;
BEGIN
 v_actor:=openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'retain_source',input);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 FOREACH v_name IN ARRAY ARRAY['sourceSystem','sourceAccountId','occurrenceKey','sourceRevision','filename'] LOOP
   IF jsonb_typeof(input->v_name) IS DISTINCT FROM 'string' OR coalesce(length(input->>v_name),0) NOT BETWEEN 1 AND 200 THEN
     PERFORM openerp.fail('InvalidJournal','Supply explicit source, occurrence, revision and filename labels of 1–200 characters.'); END IF;
 END LOOP;
 IF jsonb_typeof(input->'contentBase64') IS DISTINCT FROM 'string' OR coalesce(length(input->>'contentBase64'),0) NOT BETWEEN 4 AND 87384
   OR input->>'contentBase64'!~'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN
   PERFORM openerp.fail('InvalidJournal','Supply canonical base64 for an original file of 1–65536 bytes.'); END IF;
 v_bytes:=decode(input->>'contentBase64','base64');
 IF octet_length(v_bytes) NOT BETWEEN 1 AND 65536 OR replace(encode(v_bytes,'base64'),E'\n','') IS DISTINCT FROM input->>'contentBase64' THEN
   PERFORM openerp.fail('InvalidJournal','Supply canonical base64 for an original file of 1–65536 bytes.'); END IF;
 v_hash:='sha256:'||encode(sha256(v_bytes),'hex');
 SELECT * INTO v_occurrence FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId'
   AND o.source_system=input->>'sourceSystem' AND o.source_account_id=input->>'sourceAccountId'
   AND o.occurrence_key=input->>'occurrenceKey' AND o.source_revision=input->>'sourceRevision';
 IF FOUND THEN
   IF v_occurrence.sha256<>v_hash OR v_occurrence.body->>'filename'<>input->>'filename' THEN
     PERFORM openerp.fail('IdempotencyConflict','This source occurrence already retains different content or metadata. Supply a distinct occurrence only for a distinct acquisition.'); END IF;
   v_body:=v_occurrence.body;
 ELSE
   INSERT INTO openerp.intake_contents VALUES(scope->>'bookId',v_hash,v_bytes) ON CONFLICT DO NOTHING;
   v_body:=jsonb_build_object('id',openerp.new_id('source'),'scope',scope,'sourceSystem',input->>'sourceSystem',
     'sourceAccountId',input->>'sourceAccountId','occurrenceKey',input->>'occurrenceKey','sourceRevision',input->>'sourceRevision',
     'filename',input->>'filename','sha256',v_hash,'byteLength',octet_length(v_bytes),'mediaType','text/csv','retainedBy',v_actor,
     'retainedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'receipt',jsonb_build_object('key',key,'operation','retain_source','actorId',v_actor));
   INSERT INTO openerp.intake_occurrences VALUES(scope->>'bookId',v_body->>'id',v_hash,input->>'sourceSystem',input->>'sourceAccountId',input->>'occurrenceKey',input->>'sourceRevision',v_body);
 END IF;
 RETURN openerp.save_command(scope->>'bookId',key,v_actor,'retain_source',input,v_body);
END $$;

CREATE FUNCTION openerp.intake_summary(occurrence openerp.intake_occurrences) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
 SELECT jsonb_build_object('occurrence',(occurrence).body,'latestPreviewId',
   (SELECT p.id FROM openerp.intake_previews p WHERE p.book_id=(occurrence).book_id AND p.occurrence_id=(occurrence).id ORDER BY p.ordinal DESC LIMIT 1),
   'admission',(SELECT a.body FROM openerp.intake_admissions a WHERE a.book_id=(occurrence).book_id AND a.occurrence_id=(occurrence).id))
$$;
CREATE FUNCTION openerp.list_source_occurrences(token text, scope jsonb, cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_items jsonb; v_next text;
BEGIN
 PERFORM openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
 SELECT coalesce(jsonb_agg(openerp.intake_summary(page::openerp.intake_occurrences) ORDER BY page.id),'[]') INTO v_items
   FROM (SELECT o.* FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId' AND (cursor IS NULL OR o.id>cursor) ORDER BY o.id LIMIT 20) page;
 IF jsonb_array_length(v_items)=20 AND EXISTS(SELECT FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId' AND o.id>v_items->19->'occurrence'->>'id') THEN
   v_next:=v_items->19->'occurrence'->>'id'; END IF;
 RETURN jsonb_build_object('items',v_items,'nextCursor',v_next);
END $$;
CREATE FUNCTION openerp.get_source_occurrence(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_occurrence openerp.intake_occurrences; v_bytes bytea; v_previews jsonb;
BEGIN
 PERFORM openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
 SELECT * INTO v_occurrence FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId' AND o.id=get_source_occurrence.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained occurrence was not found in this book.'); END IF;
 SELECT c.bytes INTO STRICT v_bytes FROM openerp.intake_contents c WHERE c.book_id=v_occurrence.book_id AND c.sha256=v_occurrence.sha256;
 SELECT coalesce(jsonb_agg(p.id ORDER BY p.ordinal DESC),'[]') INTO v_previews FROM openerp.intake_previews p WHERE p.book_id=v_occurrence.book_id AND p.occurrence_id=v_occurrence.id;
 RETURN openerp.intake_summary(v_occurrence)||jsonb_build_object('contentBase64',replace(encode(v_bytes,'base64'),E'\n',''),'previewIds',v_previews);
END $$;
CREATE FUNCTION openerp.preview_source_csv(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_request jsonb:=jsonb_build_object('occurrenceId',id,'mapping',input);
 v_previous jsonb; v_occurrence openerp.intake_occurrences; v_bytes bytea; v_body jsonb; v_ordinal integer;
BEGIN
 v_actor:=openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'preview_source_csv',v_request);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 PERFORM openerp.intake_check_mapping(input);
 SELECT * INTO v_occurrence FROM openerp.intake_occurrences o WHERE o.book_id=scope->>'bookId' AND o.id=preview_source_csv.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained occurrence was not found in this book.'); END IF;
 IF EXISTS(SELECT FROM openerp.intake_admissions a WHERE a.book_id=v_occurrence.book_id AND a.occurrence_id=v_occurrence.id) THEN
   PERFORM openerp.fail('IdempotencyConflict','This occurrence already has an admitted interpretation. Retained provenance cannot be replaced.'); END IF;
 SELECT count(*)+1 INTO v_ordinal FROM openerp.intake_previews p WHERE p.book_id=v_occurrence.book_id AND p.occurrence_id=v_occurrence.id;
 IF v_ordinal>50 THEN PERFORM openerp.fail('InvalidJournal','This occurrence has reached its 50-preview bound. Existing interpretations and bytes remain retained.'); END IF;
 SELECT c.bytes INTO STRICT v_bytes FROM openerp.intake_contents c WHERE c.book_id=v_occurrence.book_id AND c.sha256=v_occurrence.sha256;
 v_body:=openerp.intake_interpret(v_occurrence.book_id,v_occurrence,input,openerp.intake_csv_records(v_bytes,input->>'delimiter',input->>'lineEnding'))
   ||jsonb_build_object('id',openerp.new_id('preview'),'occurrenceId',id,'scope',scope,'version',1,'sourceSha256',v_occurrence.sha256,
     'mapping',input,'dependencies',openerp.intake_dependencies(v_occurrence.book_id,input->>'accountId'),
     'createdBy',v_actor,'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_body:=v_body||jsonb_build_object('digest',openerp.digest(v_body),'receipt',jsonb_build_object('key',key,'operation','preview_source_csv','actorId',v_actor));
 INSERT INTO openerp.intake_previews VALUES(v_occurrence.book_id,v_body->>'id',id,v_ordinal,v_body);
 RETURN openerp.save_command(v_occurrence.book_id,key,v_actor,'preview_source_csv',v_request,v_body);
END $$;
CREATE FUNCTION openerp.get_source_preview(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_preview openerp.intake_previews; v_approval jsonb; v_admission jsonb; v_actor text;
BEGIN
 v_actor:=openerp.authorize(token,scope);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
 SELECT * INTO v_preview FROM openerp.intake_previews p WHERE p.book_id=scope->>'bookId' AND p.id=get_source_preview.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
 SELECT a.body INTO v_approval FROM openerp.intake_approvals a WHERE a.book_id=v_preview.book_id AND a.preview_id=v_preview.id AND a.actor_id=v_actor AND a.expires_at>clock_timestamp() ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
 SELECT a.body INTO v_admission FROM openerp.intake_admissions a WHERE a.book_id=v_preview.book_id AND a.occurrence_id=v_preview.occurrence_id;
 RETURN jsonb_build_object('preview',v_preview.body,'approval',v_approval,'admission',v_admission,
   'dependenciesCurrent',v_preview.body->'dependencies'=openerp.intake_dependencies(v_preview.book_id,v_preview.body->'mapping'->>'accountId'));
END $$;
CREATE FUNCTION openerp.approve_source_preview(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_request jsonb:=jsonb_build_object('previewId',id,'input',input); v_previous jsonb;
 v_preview openerp.intake_previews; v_body jsonb; v_expires timestamptz;
BEGIN
 v_actor:=openerp.authorize(token,scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'approve_source_preview',v_request);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 SELECT * INTO v_preview FROM openerp.intake_previews p WHERE p.book_id=scope->>'bookId' AND p.id=approve_source_preview.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
 IF input->>'digest' IS DISTINCT FROM v_preview.body->>'digest' OR input->'version' IS DISTINCT FROM '1'::jsonb
   OR jsonb_typeof(input->'rationale') IS DISTINCT FROM 'string' OR coalesce(length(input->>'rationale'),0) NOT BETWEEN 1 AND 2000 THEN
   PERFORM openerp.fail('ApprovalRequired','Review the exact digest/version and record your rationale.'); END IF;
 IF v_preview.body->'ready' IS DISTINCT FROM 'true'::jsonb THEN PERFORM openerp.fail('InvalidJournal','Resolve every blocking diagnostic in a new preview before approval.'); END IF;
 IF v_preview.body->'dependencies' IS DISTINCT FROM openerp.intake_dependencies(v_preview.book_id,v_preview.body->'mapping'->>'accountId') THEN
   PERFORM openerp.fail('StaleDependency','Source or configuration changed. Create and review a new preview.'); END IF;
 IF EXISTS(SELECT FROM openerp.intake_admissions a WHERE a.book_id=v_preview.book_id AND a.occurrence_id=v_preview.occurrence_id) THEN
   PERFORM openerp.fail('IdempotencyConflict','This occurrence already has an admitted interpretation.'); END IF;
 v_expires:=clock_timestamp()+interval '1 hour';
 v_body:=input||jsonb_build_object('id',openerp.new_id('intakeapproval'),'previewId',id,'actorId',v_actor,
   'expiresAt',to_char(v_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'receipt',jsonb_build_object('key',key,'operation','approve_source_preview','actorId',v_actor));
 INSERT INTO openerp.intake_approvals VALUES(v_preview.book_id,v_body->>'id',id,v_actor,v_expires,v_body);
 RETURN openerp.save_command(v_preview.book_id,key,v_actor,'approve_source_preview',v_request,v_body);
END $$;
CREATE FUNCTION openerp.admit_source_preview(token text, scope jsonb, key text, id text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_actor text; v_request jsonb:=jsonb_build_object('previewId',id,'input',input); v_previous jsonb;
 v_preview openerp.intake_previews; v_approval openerp.intake_approvals; v_existing openerp.intake_admissions;
 v_evidence jsonb; v_import jsonb; v_body jsonb; v_internal text;
BEGIN
 -- The approving operator admits their own exact interpretation. Ordinary agent tools cannot approve/admit.
 v_actor:=openerp.authorize(token,scope,true);
 PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR UPDATE;
 v_previous:=openerp.replay(scope->>'bookId',key,v_actor,'admit_source_preview',v_request);
 IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
 SELECT * INTO v_preview FROM openerp.intake_previews p WHERE p.book_id=scope->>'bookId' AND p.id=admit_source_preview.id;
 IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained preview was not found in this book.'); END IF;
 IF input->>'digest' IS DISTINCT FROM v_preview.body->>'digest' OR input->'version' IS DISTINCT FROM '1'::jsonb THEN
   PERFORM openerp.fail('ApprovalRequired','Admit only the exact reviewed digest and version.'); END IF;
 SELECT * INTO v_existing FROM openerp.intake_admissions a WHERE a.book_id=v_preview.book_id AND a.occurrence_id=v_preview.occurrence_id;
 IF FOUND THEN
   IF v_existing.preview_id<>id OR v_existing.approval_id IS DISTINCT FROM input->>'approvalId' THEN
     PERFORM openerp.fail('IdempotencyConflict','This occurrence already has a different admitted interpretation.'); END IF;
   RETURN openerp.save_command(v_preview.book_id,key,v_actor,'admit_source_preview',v_request,v_existing.body);
 END IF;
 SELECT * INTO v_approval FROM openerp.intake_approvals a WHERE a.book_id=v_preview.book_id AND a.id=input->>'approvalId' AND a.preview_id=v_preview.id AND a.actor_id=v_actor;
 IF NOT FOUND OR v_approval.expires_at<=clock_timestamp() OR v_approval.body->>'digest' IS DISTINCT FROM input->>'digest' THEN
   PERFORM openerp.fail('ApprovalRequired','A current exact approval by this operator is required.'); END IF;
 IF v_preview.body->'ready' IS DISTINCT FROM 'true'::jsonb OR v_preview.body->'statement'='null'::jsonb THEN
   PERFORM openerp.fail('InvalidJournal','A blocked preview cannot admit observations.'); END IF;
 IF v_preview.body->'dependencies' IS DISTINCT FROM openerp.intake_dependencies(v_preview.book_id,v_preview.body->'mapping'->>'accountId') THEN
   PERFORM openerp.fail('StaleDependency','Source or configuration changed. Create and review a new preview.'); END IF;
 v_internal:='intake_'||v_preview.occurrence_id;
 v_evidence:=openerp.create_evidence(token,scope,v_internal||'_evidence',jsonb_build_object(
   'title','Reviewed bank CSV interpretation '||v_preview.id,'content',(v_preview.body->'statement')::text,
   'mediaType','application/json','origin','Retained source '||v_preview.occurrence_id||'; preview '||v_preview.id||'; '||(v_preview.body->>'sourceSha256')));
 v_import:=openerp.import_bank_statement(token,scope,v_internal||'_import',v_preview.body->'statement'||jsonb_build_object('evidenceId',v_evidence->>'id','existingMatches','[]'::jsonb));
 v_body:=jsonb_build_object('occurrenceId',v_preview.occurrence_id,'previewId',id,'approvalId',v_approval.id,'digest',input->>'digest',
   'admittedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'imported',v_import,
   'receipt',jsonb_build_object('key',key,'operation','admit_source_preview','actorId',v_actor));
 INSERT INTO openerp.intake_admissions VALUES(v_preview.book_id,v_preview.occurrence_id,id,v_approval.id,v_body);
 RETURN openerp.save_command(v_preview.book_id,key,v_actor,'admit_source_preview',v_request,v_body);
END $$;
REVOKE ALL ON FUNCTION openerp.intake_diagnostic(text,text,integer,integer,integer,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.intake_dependencies(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.intake_csv_records(bytea,text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.intake_check_mapping(jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.intake_parse_money(text,text,integer) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.intake_interpret(text,openerp.intake_occurrences,jsonb,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.retain_source(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.intake_summary(openerp.intake_occurrences) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.list_source_occurrences(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_source_occurrence(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.preview_source_csv(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_source_preview(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.approve_source_preview(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.admit_source_preview(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.retain_source(text,jsonb,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_source_occurrences(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_source_occurrence(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.preview_source_csv(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_source_preview(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.approve_source_preview(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.admit_source_preview(text,jsonb,text,text,jsonb) TO openerp_runtime;
