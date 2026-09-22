-- Synthetic SIE4I only. Immutable capture, then external pure rendering, then seal.
-- Requires0810 retained review packs; no ledger writes or external acceptance.
CREATE TABLE openerp.sie_transaction_captures (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, ordinal bigint NOT NULL CHECK(ordinal>0),
  pack_id text NOT NULL, evidence_id text NOT NULL, actor_id text NOT NULL REFERENCES openerp.actors,
  body jsonb NOT NULL CHECK(octet_length(body::text)<=8388608),
  PRIMARY KEY(book_id,id), UNIQUE(book_id,ordinal),
  FOREIGN KEY(book_id,pack_id) REFERENCES openerp.accountant_review_packs,
  FOREIGN KEY(book_id,evidence_id) REFERENCES openerp.evidence,
  CHECK(body->>'id' IS NOT DISTINCT FROM id), CHECK(body->'scope'->>'bookId' IS NOT DISTINCT FROM book_id),
  CHECK(body->'input'->>'packId' IS NOT DISTINCT FROM pack_id),
  CHECK(body->'input'->>'legalNameEvidenceId' IS NOT DISTINCT FROM evidence_id),
  CHECK(body->>'createdBy' IS NOT DISTINCT FROM actor_id),
  CHECK(body->>'digest' IS NOT DISTINCT FROM openerp.digest(body-'digest'))
);
CREATE TABLE openerp.sie_transaction_artifacts (
  book_id text NOT NULL, capture_id text NOT NULL, descriptor jsonb NOT NULL, content bytea NOT NULL,
  PRIMARY KEY(book_id,capture_id), FOREIGN KEY(book_id,capture_id) REFERENCES openerp.sie_transaction_captures,
  CHECK(octet_length(content) BETWEEN 1 AND 8388608),
  CHECK(descriptor->>'captureId' IS NOT DISTINCT FROM capture_id),
  CHECK(descriptor->'scope'->>'bookId' IS NOT DISTINCT FROM book_id),
  CHECK(descriptor->>'sha256' IS NOT DISTINCT FROM encode(sha256(content),'hex')),
  CHECK((descriptor->>'byteLength')::bigint IS NOT DISTINCT FROM octet_length(content)::bigint)
);
CREATE TRIGGER immutable_sie_capture BEFORE UPDATE OR DELETE ON openerp.sie_transaction_captures
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_sie_artifact BEFORE UPDATE OR DELETE ON openerp.sie_transaction_artifacts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.capture_sie_transaction(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_previous jsonb; s_pack jsonb; s_evidence openerp.evidence;
  s_lines jsonb; s_accounts jsonb; s_source jsonb; s_body jsonb; s_ordinal bigint; s_now timestamptz;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  s_previous:=openerp.replay(p_scope->>'bookId',p_key,s_actor,'capture_sie_transaction',p_input);
  IF s_previous IS NOT NULL THEN RETURN s_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['packId','packDigest','selection','legalName','legalNameEvidenceId']);
  PERFORM openerp.commerce_text(p_input,'legalName',2000);
  IF p_input->>'selection' IS DISTINCT FROM 'all_pack_movement_vouchers' THEN
    PERFORM openerp.fail('UnsupportedProfile','Select every complete movement voucher from one retained review pack.'); END IF;
  SELECT p.body INTO s_pack FROM openerp.accountant_review_packs p
    WHERE p.book_id=p_scope->>'bookId' AND p.id=p_input->>'packId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The review pack was not found in this book.'); END IF;
  IF p_input->>'packDigest' IS DISTINCT FROM s_pack->>'digest' THEN
    PERFORM openerp.fail('StaleDependency','The selected review pack digest does not match.'); END IF;
  IF s_pack->'basis'->>'profile' IS DISTINCT FROM 'synthetic-core-v1'
    OR s_pack->'basis'->>'writerAuthority' IS DISTINCT FROM 'native'
    OR s_pack->'basis'->>'currencyScale' IS DISTINCT FROM '2'
    OR s_pack->'basis'->>'currency' IS DISTINCT FROM 'SEK' THEN
    PERFORM openerp.fail('UnsupportedProfile','Only native synthetic review packs in SEK with currency scale two support this SIE4I preparation.'); END IF;
  SELECT e.* INTO s_evidence FROM openerp.evidence e
    WHERE e.book_id=p_scope->>'bookId' AND e.id=p_input->>'legalNameEvidenceId';
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain the explicitly supplied legal-name evidence in this book first.'); END IF;
  IF (SELECT count(*) FROM openerp.accountant_review_rows r WHERE r.book_id=p_scope->>'bookId'
      AND r.pack_id=p_input->>'packId' AND r.section='journal')<>(s_pack->'counts'->>'journal')::bigint THEN
    PERFORM openerp.fail('InvalidJournal','The retained review pack journal is incomplete.'); END IF;
  SELECT coalesce(jsonb_agg(r.body ORDER BY (r.body->>'sequence')::numeric,(r.body->>'ordinal')::integer),'[]') INTO s_lines
    FROM openerp.accountant_review_rows r WHERE r.book_id=p_scope->>'bookId' AND r.pack_id=p_input->>'packId'
      AND r.section='journal' AND r.body->>'part'='movement';
  IF jsonb_array_length(s_lines) NOT BETWEEN 2 AND 5000 THEN
    PERFORM openerp.fail('UnsupportedProfile','Select a review pack with 2 to 5000 movement lines. Empty or partial transfers are not created.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(s_lines) l
    WHERE l->>'postingDate'<s_pack->'report'->>'startsOn' OR l->>'postingDate'>s_pack->'report'->>'endsOn')
    OR EXISTS(SELECT FROM openerp.accountant_review_rows r WHERE r.book_id=p_scope->>'bookId'
      AND r.pack_id=p_input->>'packId' AND r.section='journal' AND r.body->>'part'<>'movement'
      AND EXISTS(SELECT FROM jsonb_array_elements(s_lines) l WHERE l->>'voucherId'=r.body->>'voucherId'))
    OR EXISTS(SELECT FROM jsonb_array_elements(s_lines) l GROUP BY l->>'voucherId'
      HAVING count(*)<2 OR min((l->>'ordinal')::integer)<>1 OR max((l->>'ordinal')::integer)<>count(*)
        OR count(DISTINCT l->>'ordinal')<>count(*) OR sum((l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric)<>0
        OR count(DISTINCT (l->>'series',l->>'voucherNumber',l->>'postingDate',l->>'fiscalYearId',l->>'periodId',l->>'sequence',
          l->>'receiptId',l->>'planDigest',l->>'changeSetId',l->>'eventId',l->>'postingPurpose',l->>'correctsVoucherId',l->>'approvalId',l->>'approvedBy'))<>1)
    OR (SELECT count(DISTINCT l->>'voucherId') FROM jsonb_array_elements(s_lines) l)>1000
    OR EXISTS(SELECT FROM jsonb_array_elements(s_lines) l GROUP BY l->>'series',l->>'voucherNumber'
      HAVING count(DISTINCT l->>'voucherId')>1) THEN
    PERFORM openerp.fail('InvalidJournal','SIE4I requires complete balanced vouchers with consistent metadata and unique series/number identities.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',r.body->>'accountId','code',r.body->>'code','name',r.body->>'name')
    ORDER BY r.body->>'accountId' COLLATE "C"),'[]') INTO s_accounts FROM openerp.accountant_review_rows r
    WHERE r.book_id=p_scope->>'bookId' AND r.pack_id=p_input->>'packId' AND r.section='balances'
      AND EXISTS(SELECT FROM jsonb_array_elements(s_lines) l WHERE l->>'accountId'=r.body->>'accountId');
  IF jsonb_array_length(s_accounts)>1000
    OR (SELECT count(DISTINCT a->>'accountId') FROM jsonb_array_elements(s_accounts) a)<>jsonb_array_length(s_accounts)
    OR (SELECT count(DISTINCT a->>'code') FROM jsonb_array_elements(s_accounts) a)<>jsonb_array_length(s_accounts)
    OR EXISTS(SELECT FROM jsonb_array_elements(s_lines) l WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(s_accounts) a
      WHERE a->>'accountId'=l->>'accountId' AND a->>'code'=l->>'accountCode')) THEN
    PERFORM openerp.fail('InvalidJournal','SIE4I requires complete unique captured account declarations.'); END IF;
  s_source:=jsonb_build_object('accounts',s_accounts,'lines',s_lines);
  SELECT coalesce(max(c.ordinal),0) INTO s_ordinal FROM openerp.sie_transaction_captures c WHERE c.book_id=p_scope->>'bookId';
  IF s_ordinal=9223372036854775807 THEN PERFORM openerp.fail('UnsupportedProfile','SIE capture sequence is exhausted.'); END IF;
  s_now:=clock_timestamp();
  s_body:=jsonb_build_object('id',openerp.new_id('sie_capture'),'scope',p_scope,'input',p_input,
    'legalNameEvidenceSha256',s_evidence.sha256,'generatorVersion','openerp-sie4i-v1',
    'specificationSha256','96fcd3f7931b2aa22d18fbd518a33f863b57edd5562a78af195251e2bf38bac1',
    'format','SIE4I','generatedOn',(s_now AT TIME ZONE 'UTC')::date::text,
    'startsOn',s_pack->'report'->>'startsOn','endsOn',s_pack->'report'->>'endsOn',
    'currency',s_pack->'basis'->>'currency','currencyScale',2,'sequence',s_pack->'basis'->>'sequence',
    'source',s_source,'sourceDigest',openerp.digest(s_source),'createdBy',s_actor,
    'createdAt',to_char(s_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'syntheticOnly',true,'externalAcceptance','not_established');
  s_body:=s_body||jsonb_build_object('digest',openerp.digest(s_body));
  IF octet_length(s_body::text)>8388608 THEN PERFORM openerp.fail('UnsupportedProfile','SIE source capture exceeds 8 MiB. No truncated capture was saved.'); END IF;
  INSERT INTO openerp.sie_transaction_captures VALUES(p_scope->>'bookId',s_body->>'id',s_ordinal+1,
    p_input->>'packId',p_input->>'legalNameEvidenceId',s_actor,s_body);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,s_actor,'capture_sie_transaction',p_input,s_body);
END $$;

CREATE FUNCTION openerp.get_sie_transaction(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_capture jsonb; s_artifact jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT c.body INTO s_capture FROM openerp.sie_transaction_captures c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The SIE capture was not found in this book.'); END IF;
  SELECT a.descriptor||jsonb_build_object('contentBase64',replace(encode(a.content,'base64'),E'\n','')) INTO s_artifact
    FROM openerp.sie_transaction_artifacts a WHERE a.book_id=p_scope->>'bookId' AND a.capture_id=p_id;
  RETURN jsonb_build_object('capture',s_capture,'artifact',s_artifact);
END $$;

-- Internal backend seal operation: not a public HTTP/MCP payload. Rendering is outside this transaction.
CREATE FUNCTION openerp.seal_sie_transaction(p_token text,p_scope jsonb,p_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_actor text; s_capture openerp.sie_transaction_captures; s_content bytea; s_descriptor jsonb; s_existing bytea;
BEGIN
  s_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  SELECT c.* INTO s_capture FROM openerp.sie_transaction_captures c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The SIE capture was not found in this book.'); END IF;
  IF s_actor<>s_capture.actor_id THEN PERFORM openerp.fail('Forbidden','Only the capture author can resume its rendering.'); END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['captureDigest','sourceDigest','generatorVersion','contentBase64','sha256','byteLength']);
  IF p_input->>'captureDigest' IS DISTINCT FROM s_capture.body->>'digest'
    OR p_input->>'sourceDigest' IS DISTINCT FROM s_capture.body->>'sourceDigest'
    OR p_input->>'generatorVersion' IS DISTINCT FROM s_capture.body->>'generatorVersion'
    OR s_capture.body->>'digest' IS DISTINCT FROM openerp.digest(s_capture.body-'digest')
    OR s_capture.body->>'sourceDigest' IS DISTINCT FROM openerp.digest(s_capture.body->'source')
    OR NOT EXISTS(SELECT FROM openerp.accountant_review_packs p WHERE p.book_id=s_capture.book_id AND p.id=s_capture.pack_id
      AND p.body->>'digest'=s_capture.body->'input'->>'packDigest')
    OR NOT EXISTS(SELECT FROM openerp.evidence e WHERE e.book_id=s_capture.book_id AND e.id=s_capture.evidence_id
      AND e.sha256=s_capture.body->>'legalNameEvidenceSha256') THEN
    PERFORM openerp.fail('StaleDependency','Seal only the exact captured immutable source and generator version.'); END IF;
  IF jsonb_typeof(p_input->'contentBase64') IS DISTINCT FROM 'string'
    OR length(p_input->>'contentBase64') NOT BETWEEN 4 AND 11184812
    OR (p_input->>'contentBase64') !~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
    OR jsonb_typeof(p_input->'byteLength') IS DISTINCT FROM 'number'
    OR coalesce(p_input->>'byteLength','') !~ '^[1-9][0-9]{0,6}$'
    OR coalesce(p_input->>'sha256','') !~ '^[a-f0-9]{64}$' THEN
    PERFORM openerp.fail('InvalidJournal','Supply canonical bounded base64, exact byte length and SHA256.'); END IF;
  s_content:=decode(p_input->>'contentBase64','base64');
  IF octet_length(s_content) NOT BETWEEN 1 AND 8388608
    OR replace(encode(s_content,'base64'),E'\n','') IS DISTINCT FROM p_input->>'contentBase64'
    OR octet_length(s_content)<>(p_input->>'byteLength')::integer
    OR encode(sha256(s_content),'hex') IS DISTINCT FROM p_input->>'sha256'
    OR substring(s_content FROM 1 FOR 11)<>convert_to(E'#FLAGGA 0\r\n','UTF8')
    OR substring(s_content FROM octet_length(s_content)-1 FOR 2)<>decode('0d0a','hex') THEN
    PERFORM openerp.fail('InvalidJournal','Rendered SIE bytes do not match their size, hash or record boundaries.'); END IF;
  SELECT a.content INTO s_existing FROM openerp.sie_transaction_artifacts a WHERE a.book_id=p_scope->>'bookId' AND a.capture_id=p_id;
  IF FOUND THEN
    IF s_existing IS DISTINCT FROM s_content THEN PERFORM openerp.fail('IdempotencyConflict','This capture already has different sealed bytes. They cannot be replaced.'); END IF;
    RETURN openerp.get_sie_transaction(p_token,p_scope,p_id);
  END IF;
  IF s_capture.body->>'generatedOn' IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date::text THEN
    PERFORM openerp.fail('StaleDependency','The capture generation date has passed. Start a separate capture with a new request key; old captured sources remain retained.'); END IF;
  s_descriptor:=jsonb_build_object('captureId',p_id,'scope',p_scope,'captureDigest',s_capture.body->>'digest',
    'sourceDigest',s_capture.body->>'sourceDigest','packDigest',s_capture.body->'input'->>'packDigest',
    'generatorVersion',s_capture.body->>'generatorVersion','format','SIE4I','filename',p_id||'.SI',
    'encoding','CP437','mediaType','application/octet-stream','byteLength',octet_length(s_content),
    'sha256',encode(sha256(s_content),'hex'),'sealedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'syntheticOnly',true,'externalAcceptance','not_established');
  INSERT INTO openerp.sie_transaction_artifacts VALUES(p_scope->>'bookId',p_id,s_descriptor,s_content);
  RETURN openerp.get_sie_transaction(p_token,p_scope,p_id);
END $$;

CREATE FUNCTION openerp.list_sie_transactions(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE s_items jsonb; s_next text; s_first text; s_cursor jsonb; s_cutoff bigint; s_after bigint:=0;
  s_current bigint; s_total bigint; s_last bigint; s_scope jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  s_scope:=jsonb_build_object('entityId',p_scope->>'entityId','bookId',p_scope->>'bookId');
  -- Membership is pinned. Read each capture separately for current sealed state.
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(max(c.ordinal),0) INTO s_current FROM openerp.sie_transaction_captures c WHERE c.book_id=p_scope->>'bookId';
  s_cutoff:=s_current;
  IF coalesce(p_after,'')<>'' THEN
    IF length(p_after)>2048 OR p_after !~ '^si1_[a-f0-9]+$' OR (length(p_after)-4)%2<>0 THEN
      PERFORM openerp.fail('InvalidJournal','Use an unchanged SIE inventory cursor returned by this book.'); END IF;
    BEGIN
      s_cursor:=convert_from(decode(substr(p_after,5),'hex'),'UTF8')::jsonb;
    EXCEPTION WHEN invalid_parameter_value OR character_not_in_repertoire OR invalid_text_representation
      OR untranslatable_character THEN
      PERFORM openerp.fail('InvalidJournal','The SIE inventory cursor is malformed.');
    END;
    PERFORM openerp.commerce_exact_object(s_cursor,ARRAY['version','scope','cutoff','after']);
    IF s_cursor->'version' IS DISTINCT FROM '1'::jsonb OR s_cursor->'scope' IS DISTINCT FROM s_scope
      OR jsonb_typeof(s_cursor->'cutoff') IS DISTINCT FROM 'string'
      OR jsonb_typeof(s_cursor->'after') IS DISTINCT FROM 'string'
      OR coalesce(s_cursor->>'cutoff','') !~ '^(0|[1-9][0-9]{0,18})$'
      OR coalesce(s_cursor->>'after','') !~ '^(0|[1-9][0-9]{0,18})$' THEN
      PERFORM openerp.fail('InvalidJournal','The SIE inventory cursor has the wrong scope or bounds.'); END IF;
    BEGIN
      s_cutoff:=(s_cursor->>'cutoff')::bigint; s_after:=(s_cursor->>'after')::bigint;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      PERFORM openerp.fail('InvalidJournal','The SIE inventory cursor exceeds supported bounds.');
    END;
    IF s_after>s_cutoff OR s_cutoff>s_current THEN
      PERFORM openerp.fail('InvalidJournal','The SIE inventory cursor exceeds its captured membership.'); END IF;
  END IF;
  SELECT count(*) INTO s_total FROM openerp.sie_transaction_captures c
    WHERE c.book_id=p_scope->>'bookId' AND c.ordinal<=s_cutoff;
  IF s_total<>s_cutoff THEN
    PERFORM openerp.fail('InvalidJournal','The captured SIE inventory has missing ordinals.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'packId',c.pack_id,'captureDigest',c.body->>'digest',
    'createdAt',c.body->>'createdAt') ORDER BY c.ordinal),'[]') INTO s_items
    FROM (SELECT * FROM openerp.sie_transaction_captures x WHERE x.book_id=p_scope->>'bookId'
      AND x.ordinal>s_after AND x.ordinal<=s_cutoff ORDER BY x.ordinal LIMIT 25) c;
  IF jsonb_array_length(s_items)<>least(25,s_cutoff-s_after) THEN
    PERFORM openerp.fail('InvalidJournal','The captured SIE inventory page is incomplete.'); END IF;
  s_first:='si1_'||encode(convert_to(openerp.canonical(jsonb_build_object(
    'version',1,'scope',s_scope,'cutoff',s_cutoff::text,'after','0')),'UTF8'),'hex');
  s_last:=s_after+jsonb_array_length(s_items);
  IF s_last<s_cutoff THEN
    s_next:='si1_'||encode(convert_to(openerp.canonical(jsonb_build_object(
      'version',1,'scope',s_scope,'cutoff',s_cutoff::text,'after',s_last::text)),'UTF8'),'hex');
  END IF;
  RETURN jsonb_build_object('scope',s_scope,'cutoff',s_cutoff::text,'total',s_total::text,
    'first',s_first,'items',s_items,'next',s_next);
END $$;

REVOKE ALL ON openerp.sie_transaction_captures,openerp.sie_transaction_artifacts FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.capture_sie_transaction(text,jsonb,text,jsonb),openerp.get_sie_transaction(text,jsonb,text),
  openerp.seal_sie_transaction(text,jsonb,text,jsonb),openerp.list_sie_transactions(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.capture_sie_transaction(text,jsonb,text,jsonb),openerp.get_sie_transaction(text,jsonb,text),
  openerp.seal_sie_transaction(text,jsonb,text,jsonb),openerp.list_sie_transactions(text,jsonb,text) TO openerp_runtime;
