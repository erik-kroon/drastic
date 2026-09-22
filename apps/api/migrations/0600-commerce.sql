-- Synthetic invoice/open-item registration and allocation of EXISTING posted control lines.
-- No ledger write, VAT determination, payment initiation or completeness assertion.
CREATE TABLE openerp.commerce_counterparties (
  book_id text NOT NULL REFERENCES openerp.books,
  id text NOT NULL,
  external_key text COLLATE "C" NOT NULL,
  role text NOT NULL CHECK (role IN ('customer','supplier','both')),
  current_revision bigint NOT NULL CHECK (current_revision > 0),
  PRIMARY KEY (book_id,id), UNIQUE (book_id,external_key)
);
CREATE TABLE openerp.commerce_counterparty_revisions (
  book_id text NOT NULL, counterparty_id text NOT NULL, revision bigint NOT NULL CHECK (revision > 0),
  evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,counterparty_id,revision),
  FOREIGN KEY (book_id,counterparty_id) REFERENCES openerp.commerce_counterparties,
  FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence
);
ALTER TABLE openerp.commerce_counterparties ADD FOREIGN KEY (book_id,id,current_revision)
  REFERENCES openerp.commerce_counterparty_revisions(book_id,counterparty_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE openerp.commerce_control_accounts (
  book_id text NOT NULL, account_id text NOT NULL, direction text NOT NULL CHECK (direction IN ('customer','supplier')),
  PRIMARY KEY (book_id,account_id), UNIQUE (book_id,account_id,direction),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.accounts
);
CREATE TABLE openerp.commerce_invoices (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('customer','supplier')),
  counterparty_id text NOT NULL, counterparty_revision bigint NOT NULL,
  document_number text COLLATE "C" NOT NULL, issued_on date NOT NULL,
  amount_minor openerp.minor_units NOT NULL CHECK (amount_minor > 0),
  control_account_id text NOT NULL, recognition_voucher_id text NOT NULL, recognition_line_id text NOT NULL,
  evidence_id text NOT NULL, current_revision bigint NOT NULL CHECK (current_revision > 0), body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), UNIQUE (book_id,direction,counterparty_id,document_number),
  UNIQUE (book_id,recognition_voucher_id,recognition_line_id),
  FOREIGN KEY (book_id,counterparty_id,counterparty_revision) REFERENCES openerp.commerce_counterparty_revisions,
  FOREIGN KEY (book_id,control_account_id,direction) REFERENCES openerp.commerce_control_accounts(book_id,account_id,direction),
  FOREIGN KEY (book_id,recognition_voucher_id,recognition_line_id) REFERENCES openerp.journal_lines,
  FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence
);
CREATE TABLE openerp.commerce_invoice_revisions (
  book_id text NOT NULL, invoice_id text NOT NULL, revision bigint NOT NULL CHECK (revision > 0),
  evidence_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,invoice_id,revision), FOREIGN KEY (book_id,invoice_id) REFERENCES openerp.commerce_invoices,
  FOREIGN KEY (book_id,evidence_id) REFERENCES openerp.evidence
);
ALTER TABLE openerp.commerce_invoices ADD FOREIGN KEY (book_id,id,current_revision)
  REFERENCES openerp.commerce_invoice_revisions(book_id,invoice_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE openerp.commerce_allocation_plans (
  book_id text NOT NULL REFERENCES openerp.books, id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id)
);
CREATE TABLE openerp.commerce_allocation_approvals (
  book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, actor_id text NOT NULL REFERENCES openerp.actors,
  digest text NOT NULL, expires_at timestamptz NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), FOREIGN KEY (book_id,plan_id) REFERENCES openerp.commerce_allocation_plans
);
CREATE TABLE openerp.commerce_allocation_receipts (
  book_id text NOT NULL, id text NOT NULL, plan_id text NOT NULL, approval_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), UNIQUE (book_id,plan_id), UNIQUE (book_id,approval_id),
  FOREIGN KEY (book_id,plan_id) REFERENCES openerp.commerce_allocation_plans,
  FOREIGN KEY (book_id,approval_id) REFERENCES openerp.commerce_allocation_approvals
);
CREATE TABLE openerp.commerce_allocation_legs (
  book_id text NOT NULL, receipt_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 50),
  invoice_id text NOT NULL, payment_voucher_id text NOT NULL, payment_line_id text NOT NULL,
  amount_minor openerp.minor_units NOT NULL CHECK (amount_minor > 0),
  PRIMARY KEY (book_id,receipt_id,ordinal), UNIQUE (book_id,receipt_id,invoice_id),
  FOREIGN KEY (book_id,receipt_id) REFERENCES openerp.commerce_allocation_receipts,
  FOREIGN KEY (book_id,invoice_id) REFERENCES openerp.commerce_invoices,
  FOREIGN KEY (book_id,payment_voucher_id,payment_line_id) REFERENCES openerp.journal_lines
);
CREATE INDEX commerce_allocation_invoice ON openerp.commerce_allocation_legs(book_id,invoice_id);
CREATE INDEX commerce_allocation_payment ON openerp.commerce_allocation_legs(book_id,payment_voucher_id,payment_line_id);
CREATE INDEX commerce_invoice_account ON openerp.commerce_invoices(book_id,control_account_id);
CREATE TRIGGER commerce_immutable_counterparty_revision BEFORE UPDATE OR DELETE ON openerp.commerce_counterparty_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_control_account BEFORE UPDATE OR DELETE ON openerp.commerce_control_accounts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_invoice_revision BEFORE UPDATE OR DELETE ON openerp.commerce_invoice_revisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_allocation_plan BEFORE UPDATE OR DELETE ON openerp.commerce_allocation_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_allocation_approval BEFORE UPDATE OR DELETE ON openerp.commerce_allocation_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_allocation_receipt BEFORE UPDATE OR DELETE ON openerp.commerce_allocation_receipts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER commerce_immutable_allocation_leg BEFORE UPDATE OR DELETE ON openerp.commerce_allocation_legs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.commerce_freeze_identity() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM openerp.fail('Forbidden','Commerce records are retained. Deletion is unsupported.'); END IF;
  IF (to_jsonb(NEW)-'current_revision') IS DISTINCT FROM (to_jsonb(OLD)-'current_revision')
    OR NEW.current_revision <> OLD.current_revision+1 THEN
    PERFORM openerp.fail('Forbidden','Only the next immutable metadata revision may replace the current head.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commerce_freeze_counterparty BEFORE UPDATE OR DELETE ON openerp.commerce_counterparties FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();
CREATE TRIGGER commerce_freeze_invoice BEFORE UPDATE OR DELETE ON openerp.commerce_invoices FOR EACH ROW EXECUTE FUNCTION openerp.commerce_freeze_identity();

CREATE FUNCTION openerp.commerce_require_profile(p_book text) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM openerp.books b WHERE b.id=p_book AND b.profile='synthetic-core-v1' AND b.authority='native') THEN
    PERFORM openerp.fail('UnsupportedProfile','Commerce supports only native synthetic-core-v1.');
  END IF;
END $$;
CREATE FUNCTION openerp.commerce_exact_object(p_input jsonb,p_keys text[]) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Supply the documented command object.'); END IF;
  IF NOT p_input ?& p_keys OR p_input-p_keys <> '{}'::jsonb THEN
    PERFORM openerp.fail('InvalidJournal','Supply exactly the documented command fields.');
  END IF;
END $$;
CREATE FUNCTION openerp.commerce_text(p_input jsonb,p_field text,p_max integer) RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_value text := p_input->>p_field;
BEGIN
  IF jsonb_typeof(p_input->p_field) IS DISTINCT FROM 'string' OR v_value IS DISTINCT FROM btrim(v_value)
    OR length(v_value) NOT BETWEEN 1 AND p_max THEN
    PERFORM openerp.fail('InvalidJournal','Supply nonblank text without surrounding spaces within its documented limit.');
  END IF;
  RETURN v_value;
END $$;
CREATE FUNCTION openerp.commerce_positive_minor(p_input jsonb,p_field text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF jsonb_typeof(p_input->p_field) IS DISTINCT FROM 'string' OR coalesce(p_input->>p_field,'') !~ '^[1-9][0-9]{0,37}$' THEN
    PERFORM openerp.fail('InvalidJournal','Amounts must be positive exact minor-unit strings, at most 38 digits.');
  END IF;
  RETURN (p_input->>p_field)::numeric;
END $$;
CREATE FUNCTION openerp.commerce_evidence(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('evidenceId',e.id,'sha256',e.sha256) INTO v_result
    FROM openerp.evidence e WHERE e.book_id=p_book AND e.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('MissingEvidence','Retain evidence in this book before recording commerce facts.'); END IF;
  RETURN v_result;
END $$;
CREATE FUNCTION openerp.commerce_record_metadata(p_key text,p_operation text,p_actor text) RETURNS jsonb LANGUAGE sql VOLATILE
SET search_path = pg_catalog, openerp AS $$
  SELECT jsonb_build_object('createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',p_key,'operation',p_operation,'actorId',p_actor))
$$;
CREATE FUNCTION openerp.commerce_voucher_current(p_book text,p_voucher text) RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, openerp AS $$
  SELECT EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher
    AND v.corrects_voucher_id IS NULL AND v.posting_purpose<>'reversal'
    AND NOT EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=v.book_id AND r.corrects_voucher_id=v.id))
$$;
CREATE FUNCTION openerp.commerce_invoice_body(p_book text,p_id text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_invoice openerp.commerce_invoices; v_revision jsonb; v_allocated numeric; v_count bigint; v_blockers jsonb := '[]';
BEGIN
  SELECT * INTO v_invoice FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The invoice is not registered in this book.'); END IF;
  SELECT r.body INTO STRICT v_revision FROM openerp.commerce_invoice_revisions r
    WHERE r.book_id=p_book AND r.invoice_id=p_id AND r.revision=v_invoice.current_revision;
  SELECT coalesce(sum(l.amount_minor),0),count(*) INTO v_allocated,v_count FROM openerp.commerce_allocation_legs l
    WHERE l.book_id=p_book AND l.invoice_id=p_id;
  IF NOT openerp.commerce_voucher_current(p_book,v_invoice.recognition_voucher_id) THEN
    v_blockers:=v_blockers||jsonb_build_array('The retained recognition voucher was corrected.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.invoice_id=p_id
    AND NOT openerp.commerce_voucher_current(p_book,l.payment_voucher_id)) THEN
    v_blockers:=v_blockers||jsonb_build_array('A retained allocation payment voucher was corrected.'); END IF;
  IF v_allocated>v_invoice.amount_minor THEN v_blockers:=v_blockers||jsonb_build_array('Recorded allocations exceed the invoice amount.'); END IF;
  RETURN v_invoice.body||jsonb_build_object('currentRevision',v_revision,'allocationVersion',v_count::text,
    'recordedAllocatedMinor',v_allocated::text,'outstandingMinor',CASE WHEN v_blockers='[]'::jsonb THEN to_jsonb((v_invoice.amount_minor-v_allocated)::text) ELSE 'null'::jsonb END,
    'status',CASE WHEN v_blockers<>'[]'::jsonb THEN 'blocked' WHEN v_allocated=0 THEN 'open' WHEN v_allocated=v_invoice.amount_minor THEN 'allocated' ELSE 'partially_allocated' END,
    'blockers',v_blockers);
END $$;
CREATE FUNCTION openerp.commerce_payment_body(p_book text,p_voucher text,p_line text) RETURNS jsonb LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_line openerp.journal_lines; v_voucher openerp.vouchers; v_book openerp.books; v_direction text;
  v_amount numeric; v_allocated numeric; v_count bigint;
BEGIN
  SELECT * INTO v_line FROM openerp.journal_lines l WHERE l.book_id=p_book AND l.voucher_id=p_voucher AND l.id=p_line;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Select an existing posted control-account line in this book.'); END IF;
  SELECT c.direction INTO v_direction FROM openerp.commerce_control_accounts c WHERE c.book_id=p_book AND c.account_id=v_line.account_id;
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','The line account has not been explicitly registered as a commerce control account.'); END IF;
  SELECT * INTO STRICT v_voucher FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher;
  IF NOT openerp.commerce_voucher_current(p_book,p_voucher)
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher AND i.recognition_line_id=p_line)
    OR (v_direction='customer' AND v_line.credit_minor=0) OR (v_direction='supplier' AND v_line.debit_minor=0) THEN
    PERFORM openerp.fail('InvalidJournal','Use a current opposite-side settlement line, never recognition or reversal.'); END IF;
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
  v_amount:=v_line.debit_minor+v_line.credit_minor;
  SELECT coalesce(sum(l.amount_minor),0),count(*) INTO v_allocated,v_count FROM openerp.commerce_allocation_legs l
    WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line;
  IF v_allocated>v_amount THEN PERFORM openerp.fail('StaleDependency','Payment allocations exceed the posted control-line capacity.'); END IF;
  RETURN jsonb_build_object('voucherId',p_voucher,'lineId',p_line,'scope',jsonb_build_object('bookId',p_book,'entityId',v_book.entity_id),
    'direction',v_direction,'accountId',v_line.account_id,'postingDate',v_voucher.posting_date::text,'currency',v_book.currency,
    'currencyScale',v_book.currency_scale,'amountMinor',v_amount::text,'allocatedMinor',v_allocated::text,
    'remainingMinor',(v_amount-v_allocated)::text,'capacityVersion',v_count::text);
END $$;

CREATE FUNCTION openerp.commerce_create_counterparty(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_evidence jsonb; v_id text:=openerp.new_id('counterparty'); v_external text;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'commerce_create_counterparty',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(p_scope->>'bookId');
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['kind','externalKey','role','displayName','evidenceId','reason']);
  IF p_input->>'kind' IS DISTINCT FROM 'synthetic_counterparty_v1' OR coalesce(p_input->>'role','') NOT IN ('customer','supplier','both') THEN
    PERFORM openerp.fail('InvalidJournal','Select the synthetic counterpart register and an explicit counterpart role.'); END IF;
  v_external:=openerp.commerce_text(p_input,'externalKey',200);
  PERFORM openerp.commerce_text(p_input,'displayName',200); PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_evidence:=openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId');
  IF EXISTS(SELECT FROM openerp.commerce_counterparties c WHERE c.book_id=p_scope->>'bookId' AND c.external_key=v_external) THEN
    PERFORM openerp.fail('IdempotencyConflict','This supplied counterpart identity is already registered. Revise its metadata instead.'); END IF;
  v_result:=p_input||jsonb_build_object('id',v_id,'scope',p_scope,'revision','1','evidence',v_evidence,'legalIdentityVerified',false)
    ||openerp.commerce_record_metadata(p_key,'commerce_create_counterparty',v_actor);
  INSERT INTO openerp.commerce_counterparties VALUES(p_scope->>'bookId',v_id,v_external,p_input->>'role',1);
  INSERT INTO openerp.commerce_counterparty_revisions VALUES(p_scope->>'bookId',v_id,1,p_input->>'evidenceId',v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'commerce_create_counterparty',p_input,v_result);
END $$;
CREATE FUNCTION openerp.commerce_revise_counterparty(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_evidence jsonb; v_party openerp.commerce_counterparties; v_revision bigint;
  v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'commerce_revise_counterparty',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(p_scope->>'bookId');
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedRevision','displayName','evidenceId','reason']);
  SELECT * INTO v_party FROM openerp.commerce_counterparties c WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The counterpart is not registered in this book.'); END IF;
  IF openerp.commerce_text(p_input,'expectedRevision',18) IS DISTINCT FROM v_party.current_revision::text THEN
    PERFORM openerp.fail('StaleDependency','The counterpart revision changed. Read the current record first.'); END IF;
  PERFORM openerp.commerce_text(p_input,'displayName',200); PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_evidence:=openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId');
  v_revision:=v_party.current_revision+1;
  v_result:=jsonb_build_object('kind','synthetic_counterparty_v1','externalKey',v_party.external_key,'role',v_party.role,
    'displayName',p_input->>'displayName','evidenceId',p_input->>'evidenceId','reason',p_input->>'reason','id',p_id,'scope',p_scope,
    'revision',v_revision::text,'evidence',v_evidence,'legalIdentityVerified',false)
    ||openerp.commerce_record_metadata(p_key,'commerce_revise_counterparty',v_actor);
  INSERT INTO openerp.commerce_counterparty_revisions VALUES(p_scope->>'bookId',p_id,v_revision,p_input->>'evidenceId',v_result);
  UPDATE openerp.commerce_counterparties c SET current_revision=v_revision WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id;
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'commerce_revise_counterparty',v_payload,v_result);
END $$;
CREATE FUNCTION openerp.commerce_get_counterparty(p_token text,p_scope jsonb,p_id text,p_revision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF coalesce(p_revision,'')<>'' AND p_revision !~ '^[1-9][0-9]{0,17}$' THEN PERFORM openerp.fail('InvalidJournal','Choose a positive revision.'); END IF;
  SELECT r.body INTO v_result FROM openerp.commerce_counterparties c JOIN openerp.commerce_counterparty_revisions r
    ON r.book_id=c.book_id AND r.counterparty_id=c.id
    WHERE c.book_id=p_scope->>'bookId' AND c.id=p_id AND r.revision=coalesce(nullif(p_revision,'')::bigint,c.current_revision);
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The counterpart revision was not found in this book.'); END IF;
  RETURN v_result;
END $$;
CREATE FUNCTION openerp.commerce_list_counterparties(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  WITH page AS (SELECT c.id,r.body FROM openerp.commerce_counterparties c JOIN openerp.commerce_counterparty_revisions r
    ON r.book_id=c.book_id AND r.counterparty_id=c.id AND r.revision=c.current_revision
    WHERE c.book_id=p_scope->>'bookId' AND c.id COLLATE "C">coalesce(p_after,'') COLLATE "C" ORDER BY c.id COLLATE "C" LIMIT 51),
  shown AS (SELECT * FROM page ORDER BY id COLLATE "C" LIMIT 50)
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(s.body ORDER BY s.id COLLATE "C"),'[]'),
    'next',CASE WHEN (SELECT count(*) FROM page)>50 THEN max(s.id COLLATE "C") ELSE NULL END) INTO v_result FROM shown s;
  RETURN v_result;
END $$;

CREATE FUNCTION openerp.commerce_create_invoice(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_body jsonb; v_revision jsonb; v_evidence jsonb;
  v_party openerp.commerce_counterparties; v_party_body jsonb; v_line openerp.journal_lines; v_voucher openerp.vouchers;
  v_book openerp.books; v_issued date; v_due date; v_amount numeric; v_number text; v_id text:=openerp.new_id('invoice'); v_direction text;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'commerce_create_invoice',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(v_book.id);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['kind','direction','counterpartyId','counterpartyRevision','documentNumber','issuedOn','dueOn','currency','amountMinor','controlAccountId','recognitionVoucherId','recognitionLineId','evidenceId','description']);
  IF p_input->>'kind' IS DISTINCT FROM 'synthetic_invoice_v1' OR coalesce(p_input->>'direction','') NOT IN ('customer','supplier')
    OR p_input->>'currency' IS DISTINCT FROM v_book.currency THEN
    PERFORM openerp.fail('InvalidJournal','Supply a synthetic customer or supplier invoice in the exact book currency.'); END IF;
  v_direction:=p_input->>'direction'; v_number:=openerp.commerce_text(p_input,'documentNumber',200);
  PERFORM openerp.commerce_text(p_input,'description',2000);
  v_issued:=openerp.bank_date(p_input->>'issuedOn'); v_due:=openerp.bank_date(p_input->>'dueOn');
  IF v_due<v_issued THEN PERFORM openerp.fail('InvalidJournal','The due date cannot precede the issue date.'); END IF;
  v_amount:=openerp.commerce_positive_minor(p_input,'amountMinor');
  v_evidence:=openerp.commerce_evidence(v_book.id,p_input->>'evidenceId');
  SELECT * INTO v_party FROM openerp.commerce_counterparties c WHERE c.book_id=v_book.id AND c.id=p_input->>'counterpartyId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Register the counterpart in this book first.'); END IF;
  IF openerp.commerce_text(p_input,'counterpartyRevision',18) IS DISTINCT FROM v_party.current_revision::text THEN
    PERFORM openerp.fail('StaleDependency','Use the reviewed current counterpart revision.'); END IF;
  IF v_party.role NOT IN (v_direction,'both') THEN PERFORM openerp.fail('InvalidJournal','The counterpart role does not support this invoice direction.'); END IF;
  SELECT r.body INTO STRICT v_party_body FROM openerp.commerce_counterparty_revisions r
    WHERE r.book_id=v_book.id AND r.counterparty_id=v_party.id AND r.revision=v_party.current_revision;
  SELECT * INTO v_line FROM openerp.journal_lines l WHERE l.book_id=v_book.id
    AND l.voucher_id=p_input->>'recognitionVoucherId' AND l.id=p_input->>'recognitionLineId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Choose an existing posted recognition line in this book.'); END IF;
  SELECT * INTO STRICT v_voucher FROM openerp.vouchers v WHERE v.book_id=v_book.id AND v.id=v_line.voucher_id;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=v_book.id AND p.id=v_voucher.period_id AND NOT p.locked FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('PeriodLocked','New registration in a locked recognition period is unsupported.'); END IF;
  PERFORM 1 FROM openerp.accounts a WHERE a.book_id=v_book.id AND a.id=p_input->>'controlAccountId' AND a.active FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal','Choose an active explicitly declared control account.'); END IF;
  IF v_line.account_id IS DISTINCT FROM p_input->>'controlAccountId'
    OR (v_direction='customer' AND (v_line.debit_minor<>v_amount OR v_line.credit_minor<>0))
    OR (v_direction='supplier' AND (v_line.credit_minor<>v_amount OR v_line.debit_minor<>0))
    OR NOT openerp.commerce_voucher_current(v_book.id,v_voucher.id)
    OR v_voucher.posting_date<v_issued THEN
    PERFORM openerp.fail('InvalidJournal','Recognition must be current, exact in account, direction and amount, and not before invoice issue.'); END IF;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(v_voucher.action->'evidenceRefs') ref
    WHERE ref->>'evidenceId'=v_evidence->>'evidenceId' AND ref->>'sha256'=v_evidence->>'sha256') THEN
    PERFORM openerp.fail('MissingEvidence','The posted recognition must retain this original invoice evidence.'); END IF;
  IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=v_book.id AND s.account_id=v_line.account_id) THEN
    PERFORM openerp.fail('InvalidJournal','A bank source account cannot also be a commerce control account.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=v_book.id AND
    ((i.direction=v_direction AND i.counterparty_id=v_party.id AND i.document_number=v_number)
      OR (i.recognition_voucher_id=v_line.voucher_id AND i.recognition_line_id=v_line.id)))
    OR EXISTS(SELECT FROM openerp.commerce_allocation_legs l WHERE l.book_id=v_book.id AND l.payment_voucher_id=v_line.voucher_id AND l.payment_line_id=v_line.id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This invoice identity or posted line is already bound. No duplicate registration is created.'); END IF;
  INSERT INTO openerp.commerce_control_accounts VALUES(v_book.id,v_line.account_id,v_direction) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=v_book.id AND c.account_id=v_line.account_id AND c.direction=v_direction) THEN
    PERFORM openerp.fail('InvalidJournal','Customer and supplier control-account classifications cannot be mixed.'); END IF;
  v_body:=jsonb_build_object('id',v_id,'scope',p_scope,'kind','synthetic_invoice_v1','direction',v_direction,
    'counterpartyId',v_party.id,'counterpartyRevision',v_party.current_revision::text,'counterpartyName',v_party_body->>'displayName',
    'documentNumber',v_number,'issuedOn',v_issued::text,'currency',v_book.currency,'currencyScale',v_book.currency_scale,
    'amountMinor',v_amount::text,'controlAccountId',v_line.account_id,'evidence',v_evidence,
    'recognition',jsonb_build_object('voucherId',v_voucher.id,'lineId',v_line.id,'eventId',v_voucher.event_id,'postingDate',v_voucher.posting_date::text));
  v_revision:=jsonb_build_object('id',v_id,'scope',p_scope,'revision','1','dueOn',v_due::text,'description',p_input->>'description',
    'evidence',v_evidence,'reason','Initial evidence-backed registration')||openerp.commerce_record_metadata(p_key,'commerce_create_invoice',v_actor);
  INSERT INTO openerp.commerce_invoices VALUES(v_book.id,v_id,v_direction,v_party.id,v_party.current_revision,v_number,v_issued,v_amount,
    v_line.account_id,v_voucher.id,v_line.id,p_input->>'evidenceId',1,v_body);
  INSERT INTO openerp.commerce_invoice_revisions VALUES(v_book.id,v_id,1,p_input->>'evidenceId',v_revision);
  v_result:=openerp.commerce_invoice_body(v_book.id,v_id);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'commerce_create_invoice',p_input,v_result);
END $$;
CREATE FUNCTION openerp.commerce_revise_invoice(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_invoice openerp.commerce_invoices; v_evidence jsonb; v_revision jsonb; v_result jsonb;
  v_due date; v_next bigint; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'commerce_revise_invoice',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(p_scope->>'bookId');
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['expectedRevision','dueOn','description','evidenceId','reason']);
  SELECT * INTO v_invoice FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId' AND i.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The invoice is not registered in this book.'); END IF;
  IF openerp.commerce_text(p_input,'expectedRevision',18) IS DISTINCT FROM v_invoice.current_revision::text THEN
    PERFORM openerp.fail('StaleDependency','The invoice revision changed. Read its current version first.'); END IF;
  v_due:=openerp.bank_date(p_input->>'dueOn');
  IF v_due<v_invoice.issued_on THEN PERFORM openerp.fail('InvalidJournal','The due date cannot precede invoice issue.'); END IF;
  PERFORM openerp.commerce_text(p_input,'description',2000); PERFORM openerp.commerce_text(p_input,'reason',2000);
  v_evidence:=openerp.commerce_evidence(p_scope->>'bookId',p_input->>'evidenceId'); v_next:=v_invoice.current_revision+1;
  v_revision:=jsonb_build_object('id',p_id,'scope',p_scope,'revision',v_next::text,'dueOn',v_due::text,'description',p_input->>'description',
    'evidence',v_evidence,'reason',p_input->>'reason')||openerp.commerce_record_metadata(p_key,'commerce_revise_invoice',v_actor);
  INSERT INTO openerp.commerce_invoice_revisions VALUES(p_scope->>'bookId',p_id,v_next,p_input->>'evidenceId',v_revision);
  UPDATE openerp.commerce_invoices i SET current_revision=v_next WHERE i.book_id=p_scope->>'bookId' AND i.id=p_id;
  v_result:=openerp.commerce_invoice_body(p_scope->>'bookId',p_id);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'commerce_revise_invoice',v_payload,v_result);
END $$;
CREATE FUNCTION openerp.commerce_get_invoice(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  RETURN openerp.commerce_invoice_body(p_scope->>'bookId',p_id);
END $$;
CREATE FUNCTION openerp.commerce_list_invoices(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  WITH page AS (SELECT i.id FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId'
    AND i.id COLLATE "C">coalesce(p_after,'') COLLATE "C" ORDER BY i.id COLLATE "C" LIMIT 51),
  shown AS (SELECT * FROM page ORDER BY id COLLATE "C" LIMIT 50)
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(openerp.commerce_invoice_body(p_scope->>'bookId',s.id) ORDER BY s.id COLLATE "C"),'[]'),
    'next',CASE WHEN (SELECT count(*) FROM page)>50 THEN max(s.id COLLATE "C") ELSE NULL END) INTO v_result FROM shown s;
  RETURN v_result;
END $$;
CREATE FUNCTION openerp.commerce_invoice_history(p_token text,p_scope jsonb,p_id text,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF coalesce(p_after,'')<>'' AND p_after !~ '^[1-9][0-9]{0,17}$' THEN PERFORM openerp.fail('InvalidJournal','Choose a positive revision cursor.'); END IF;
  IF NOT EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_scope->>'bookId' AND i.id=p_id) THEN
    PERFORM openerp.fail('NotFound','The invoice is not registered in this book.'); END IF;
  WITH page AS (SELECT r.revision,r.body FROM openerp.commerce_invoice_revisions r
    WHERE r.book_id=p_scope->>'bookId' AND r.invoice_id=p_id AND r.revision>coalesce(nullif(p_after,'')::bigint,0) ORDER BY r.revision LIMIT 51),
  shown AS (SELECT * FROM page ORDER BY revision LIMIT 50)
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(s.body ORDER BY s.revision),'[]'),
    'next',CASE WHEN (SELECT count(*) FROM page)>50 THEN max(s.revision)::text ELSE NULL END) INTO v_result FROM shown s;
  RETURN v_result;
END $$;
CREATE FUNCTION openerp.commerce_get_payment_capacity(p_token text,p_scope jsonb,p_voucher text,p_line text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  RETURN openerp.commerce_payment_body(p_scope->>'bookId',p_voucher,p_line);
END $$;

CREATE FUNCTION openerp.commerce_allocation_selection(p_book text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE v_book openerp.books; v_payment jsonb; v_evidence jsonb; v_leg jsonb; v_invoice jsonb;
  v_legs jsonb:='[]'; v_total numeric:=0; v_amount numeric; v_counterparty text; v_account_version bigint; v_period_version bigint; v_payment_event text;
BEGIN
  PERFORM openerp.commerce_require_profile(p_book);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['voucherId','lineId','evidenceId','rationale','allocations']);
  PERFORM openerp.commerce_text(p_input,'rationale',2000);
  IF jsonb_typeof(p_input->'allocations') IS DISTINCT FROM 'array' THEN PERFORM openerp.fail('InvalidJournal','Provide an ordered allocation array.'); END IF;
  IF jsonb_array_length(p_input->'allocations') NOT BETWEEN 1 AND 50 THEN PERFORM openerp.fail('InvalidJournal','Allocate to between one and fifty invoices per plan.'); END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(p_input->'allocations') l GROUP BY l->>'invoiceId' HAVING count(*)>1) THEN
    PERFORM openerp.fail('InvalidJournal','Each invoice may appear only once in an allocation plan.'); END IF;
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
  v_payment:=openerp.commerce_payment_body(p_book,p_input->>'voucherId',p_input->>'lineId');
  v_evidence:=openerp.commerce_evidence(p_book,p_input->>'evidenceId');
  SELECT a.version INTO v_account_version FROM openerp.accounts a WHERE a.book_id=p_book AND a.id=v_payment->>'accountId' AND a.active FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('StaleDependency','The payment control account is inactive.'); END IF;
  SELECT v.event_id INTO STRICT v_payment_event FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=v_payment->>'voucherId';
  SELECT p.version INTO v_period_version FROM openerp.vouchers v JOIN openerp.periods p ON p.book_id=v.book_id AND p.id=v.period_id
    WHERE v.book_id=p_book AND v.id=v_payment->>'voucherId' AND NOT p.locked FOR SHARE OF p;
  IF NOT FOUND THEN PERFORM openerp.fail('PeriodLocked','Allocation in the posted payment period requires that period to remain open.'); END IF;
  FOR v_leg IN SELECT l.value FROM jsonb_array_elements(p_input->'allocations') WITH ORDINALITY l(value,ordinal) ORDER BY l.ordinal LOOP
    PERFORM openerp.commerce_exact_object(v_leg,ARRAY['invoiceId','amountMinor']);
    v_amount:=openerp.commerce_positive_minor(v_leg,'amountMinor');
    v_invoice:=openerp.commerce_invoice_body(p_book,v_leg->>'invoiceId');
    IF v_invoice->>'status'='blocked' OR v_invoice->>'direction' IS DISTINCT FROM v_payment->>'direction'
      OR v_invoice->>'controlAccountId' IS DISTINCT FROM v_payment->>'accountId'
      OR v_invoice->>'currency' IS DISTINCT FROM v_payment->>'currency'
      OR v_invoice->'recognition'->>'eventId'=v_payment_event
      OR (v_invoice->'recognition'->>'postingDate')::date>(v_payment->>'postingDate')::date THEN
      PERFORM openerp.fail('InvalidJournal','Use current same-account invoice recognition and a distinct later or same-date settlement event. Advances and netting are unsupported.'); END IF;
    IF v_counterparty IS NULL THEN v_counterparty:=v_invoice->>'counterpartyId'; END IF;
    IF v_counterparty IS DISTINCT FROM v_invoice->>'counterpartyId' THEN
      PERFORM openerp.fail('InvalidJournal','One payment allocation plan must identify one counterpart. Cross-counterparty netting is unsupported.'); END IF;
    IF v_amount>(v_invoice->>'outstandingMinor')::numeric THEN
      PERFORM openerp.fail('StaleDependency','An allocation exceeds current invoice outstanding capacity.'); END IF;
    v_total:=v_total+v_amount;
    v_legs:=v_legs||jsonb_build_array(jsonb_build_object('invoiceId',v_invoice->>'id','revision',v_invoice->'currentRevision'->>'revision',
      'allocationVersion',v_invoice->>'allocationVersion','documentNumber',v_invoice->>'documentNumber','counterpartyId',v_counterparty,
      'counterpartyName',v_invoice->>'counterpartyName','recognition',v_invoice->'recognition','evidence',v_invoice->'evidence',
      'outstandingBeforeMinor',v_invoice->>'outstandingMinor','amountMinor',v_amount::text,
      'outstandingAfterMinor',((v_invoice->>'outstandingMinor')::numeric-v_amount)::text));
  END LOOP;
  IF v_total>(v_payment->>'remainingMinor')::numeric THEN
    PERFORM openerp.fail('StaleDependency','The proposed total exceeds current posted payment capacity.'); END IF;
  RETURN jsonb_build_object('profileVersion',v_book.profile_version::text,'writerEpoch',v_book.writer_epoch::text,
    'accountVersion',v_account_version::text,'paymentPeriodVersion',v_period_version::text,'payment',v_payment,
    'evidence',v_evidence,'rationale',p_input->>'rationale','legs',v_legs,'totalMinor',v_total::text,
    'paymentRemainingAfterMinor',((v_payment->>'remainingMinor')::numeric-v_total)::text);
END $$;
CREATE FUNCTION openerp.commerce_allocation_current(p_book text,p_plan jsonb) RETURNS boolean LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE v_input jsonb; v_current jsonb;
BEGIN
  IF p_plan->>'digest' IS DISTINCT FROM openerp.digest(p_plan-'digest') THEN RETURN false; END IF;
  SELECT jsonb_build_object('voucherId',p_plan->'payment'->>'voucherId','lineId',p_plan->'payment'->>'lineId',
    'evidenceId',p_plan->'evidence'->>'evidenceId','rationale',p_plan->>'rationale',
    'allocations',jsonb_agg(jsonb_build_object('invoiceId',l.value->>'invoiceId','amountMinor',l.value->>'amountMinor') ORDER BY l.ordinal))
    INTO v_input FROM jsonb_array_elements(p_plan->'legs') WITH ORDINALITY l(value,ordinal);
  BEGIN
    v_current:=openerp.commerce_allocation_selection(p_book,v_input);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN false;
  END;
  RETURN v_current IS NOT DISTINCT FROM p_plan-ARRAY['id','scope','version','digest','createdAt','receipt'];
END $$;
CREATE FUNCTION openerp.commerce_prepare_allocation(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_result jsonb; v_id text:=openerp.new_id('allocation');
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'commerce_prepare_allocation',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  v_result:=openerp.commerce_allocation_selection(p_scope->>'bookId',p_input)
    ||jsonb_build_object('id',v_id,'scope',p_scope,'version',1)||openerp.commerce_record_metadata(p_key,'commerce_prepare_allocation',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  INSERT INTO openerp.commerce_allocation_plans VALUES(p_scope->>'bookId',v_id,v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'commerce_prepare_allocation',p_input,v_result);
END $$;
CREATE FUNCTION openerp.commerce_get_allocation(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_plan jsonb; v_approval jsonb; v_application jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT p.body INTO v_plan FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The allocation plan was not found in this book.'); END IF;
  SELECT a.body INTO v_approval FROM openerp.commerce_allocation_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.plan_id=p_id
    ORDER BY a.expires_at DESC,a.id COLLATE "C" DESC LIMIT 1;
  SELECT r.body INTO v_application FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.plan_id=p_id;
  RETURN jsonb_build_object('plan',v_plan,'dependenciesCurrent',openerp.commerce_allocation_current(p_scope->>'bookId',v_plan),
    'approval',v_approval,'application',v_application);
END $$;
CREATE FUNCTION openerp.commerce_approve_allocation(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_plan jsonb; v_result jsonb; v_id text:=openerp.new_id('allocation_approval');
  v_expires timestamptz; v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope,true);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'commerce_approve_allocation',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','planDigest']);
  SELECT p.body INTO v_plan FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The allocation plan was not found in this book.'); END IF;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'planDigest' IS DISTINCT FROM v_plan->>'digest'
    OR NOT openerp.commerce_allocation_current(p_scope->>'bookId',v_plan) THEN
    PERFORM openerp.fail('StaleDependency','Approve the exact current allocation digest and version. Prepare again if dependencies changed.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.plan_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This allocation was already applied. Read its retained receipt.'); END IF;
  v_expires:=clock_timestamp()+interval '1 hour';
  v_result:=jsonb_build_object('id',v_id,'planId',p_id,'planDigest',v_plan->>'digest','actorId',v_actor,
    'expiresAt',to_char(v_expires AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',p_key,'operation','commerce_approve_allocation','actorId',v_actor));
  INSERT INTO openerp.commerce_allocation_approvals VALUES(p_scope->>'bookId',v_id,p_id,v_actor,v_plan->>'digest',v_expires,v_result);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'commerce_approve_allocation',v_payload,v_result);
END $$;
CREATE FUNCTION openerp.commerce_apply_allocation(p_token text,p_scope jsonb,p_id text,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_previous jsonb; v_plan jsonb; v_approval openerp.commerce_allocation_approvals; v_result jsonb;
  v_id text:=openerp.new_id('allocation_receipt'); v_payload jsonb:=jsonb_build_object('id',p_id,'input',p_input);
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(p_scope->>'bookId',p_key,v_actor,'commerce_apply_allocation',v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['version','planDigest','approvalId']);
  SELECT p.body INTO v_plan FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_scope->>'bookId' AND p.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The allocation plan was not found in this book.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.plan_id=p_id) THEN
    PERFORM openerp.fail('IdempotencyConflict','This allocation was already applied. Read its retained receipt.'); END IF;
  IF p_input->'version' IS DISTINCT FROM '1'::jsonb OR p_input->>'planDigest' IS DISTINCT FROM v_plan->>'digest'
    OR NOT openerp.commerce_allocation_current(p_scope->>'bookId',v_plan) THEN
    PERFORM openerp.fail('StaleDependency','Execute only the exact approved allocation while all selected capacities remain current.'); END IF;
  SELECT * INTO v_approval FROM openerp.commerce_allocation_approvals a WHERE a.book_id=p_scope->>'bookId' AND a.id=p_input->>'approvalId';
  IF NOT FOUND OR v_approval.plan_id<>p_id OR v_approval.digest IS DISTINCT FROM v_plan->>'digest'
    OR v_approval.expires_at<=clock_timestamp()
    OR EXISTS(SELECT FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p_scope->>'bookId' AND r.approval_id=v_approval.id) THEN
    PERFORM openerp.fail('ApprovalRequired','A current unused operator approval for this exact allocation is required.'); END IF;
  PERFORM 1 FROM openerp.memberships m WHERE m.book_id=p_scope->>'bookId' AND m.actor_id=v_approval.actor_id AND m.role='operator' FOR SHARE;
  IF NOT FOUND THEN PERFORM openerp.fail('ApprovalRequired','The approving actor no longer has operator authority for this book.'); END IF;
  v_result:=jsonb_build_object('id',v_id,'scope',p_scope,'planId',p_id,'planDigest',v_plan->>'digest','approvalId',v_approval.id,
    'totalMinor',v_plan->>'totalMinor','paymentRemainingMinor',v_plan->>'paymentRemainingAfterMinor',
    'committedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receipt',jsonb_build_object('key',p_key,'operation','commerce_apply_allocation','actorId',v_actor));
  INSERT INTO openerp.commerce_allocation_receipts VALUES(p_scope->>'bookId',v_id,p_id,v_approval.id,v_result);
  INSERT INTO openerp.commerce_allocation_legs(book_id,receipt_id,ordinal,invoice_id,payment_voucher_id,payment_line_id,amount_minor)
    SELECT p_scope->>'bookId',v_id,l.ordinal::integer,l.value->>'invoiceId',v_plan->'payment'->>'voucherId',v_plan->'payment'->>'lineId',(l.value->>'amountMinor')::numeric
    FROM jsonb_array_elements(v_plan->'legs') WITH ORDINALITY l(value,ordinal);
  RETURN openerp.save_command(p_scope->>'bookId',p_key,v_actor,'commerce_apply_allocation',v_payload,v_result);
END $$;

-- Both directions of account classification are guarded. Ordinary source revision bumps do not fire this trigger.
CREATE FUNCTION openerp.commerce_guard_bank_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.commerce_control_accounts c WHERE c.book_id=NEW.book_id AND c.account_id=NEW.account_id) THEN
    PERFORM openerp.fail('InvalidJournal','A commerce control account cannot be registered as a bank source.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commerce_bank_source_boundary BEFORE INSERT OR UPDATE OF book_id,account_id ON openerp.bank_sources
  FOR EACH ROW EXECUTE FUNCTION openerp.commerce_guard_bank_source();
CREATE FUNCTION openerp.commerce_guard_control_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
BEGIN
  PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
  IF EXISTS(SELECT FROM openerp.bank_sources s WHERE s.book_id=NEW.book_id AND s.account_id=NEW.account_id) THEN
    PERFORM openerp.fail('InvalidJournal','A bank source cannot be registered as a commerce control account.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commerce_control_account_boundary BEFORE INSERT ON openerp.commerce_control_accounts
  FOR EACH ROW EXECUTE FUNCTION openerp.commerce_guard_control_account();

-- Shared kernel commands remain the only ledger writers. This guard covers both reversal-only and bundled correction commands.
CREATE FUNCTION openerp.commerce_guard_voucher_reversal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF NEW.corrects_voucher_id IS NOT NULL THEN
    PERFORM 1 FROM openerp.books b WHERE b.id=NEW.book_id FOR UPDATE;
    IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=NEW.book_id AND i.recognition_voucher_id=NEW.corrects_voucher_id)
      OR EXISTS(SELECT FROM openerp.commerce_allocation_legs l WHERE l.book_id=NEW.book_id AND l.payment_voucher_id=NEW.corrects_voucher_id) THEN
      PERFORM openerp.fail('StaleDependency','The voucher is bound to retained commerce recognition or allocations. A commerce release/correction workflow is required and is not implemented.');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commerce_voucher_reversal_boundary BEFORE INSERT ON openerp.vouchers
  FOR EACH ROW EXECUTE FUNCTION openerp.commerce_guard_voucher_reversal();

-- Residuals are derived only from immutable applied legs, never from mutable parallel balance counters.
CREATE FUNCTION openerp.commerce_assert_allocation(p_book text,p_receipt text) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE v_receipt openerp.commerce_allocation_receipts; v_plan jsonb; v_approval openerp.commerce_allocation_approvals;
  v_expected jsonb; v_actual jsonb;
BEGIN
  SELECT * INTO STRICT v_receipt FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p_book AND r.id=p_receipt;
  SELECT p.body INTO STRICT v_plan FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_book AND p.id=v_receipt.plan_id;
  SELECT * INTO STRICT v_approval FROM openerp.commerce_allocation_approvals a WHERE a.book_id=p_book AND a.id=v_receipt.approval_id;
  SELECT jsonb_agg(jsonb_build_object('invoiceId',l.value->>'invoiceId','amountMinor',l.value->>'amountMinor',
    'voucherId',v_plan->'payment'->>'voucherId','lineId',v_plan->'payment'->>'lineId') ORDER BY l.ordinal)
    INTO v_expected FROM jsonb_array_elements(v_plan->'legs') WITH ORDINALITY l(value,ordinal);
  SELECT jsonb_agg(jsonb_build_object('invoiceId',l.invoice_id,'amountMinor',l.amount_minor::text,
    'voucherId',l.payment_voucher_id,'lineId',l.payment_line_id) ORDER BY l.ordinal)
    INTO v_actual FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt;
  IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_actual OR v_approval.plan_id<>v_receipt.plan_id
    OR v_approval.digest IS DISTINCT FROM v_plan->>'digest' OR v_receipt.body->>'planDigest' IS DISTINCT FROM v_plan->>'digest'
    OR v_receipt.body->>'totalMinor' IS DISTINCT FROM v_plan->>'totalMinor' THEN
    PERFORM openerp.fail('InvalidJournal','Applied allocation legs and receipt must exactly match the approved sealed plan.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book
    AND i.id IN (SELECT l.invoice_id FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt)
    AND (SELECT coalesce(sum(l.amount_minor),0) FROM openerp.commerce_allocation_legs l WHERE l.book_id=i.book_id AND l.invoice_id=i.id)>i.amount_minor)
    OR EXISTS(SELECT FROM openerp.journal_lines j WHERE j.book_id=p_book
      AND (j.voucher_id,j.id) IN (SELECT l.payment_voucher_id,l.payment_line_id FROM openerp.commerce_allocation_legs l WHERE l.book_id=p_book AND l.receipt_id=p_receipt)
      AND (SELECT coalesce(sum(l.amount_minor),0) FROM openerp.commerce_allocation_legs l WHERE l.book_id=j.book_id AND l.payment_voucher_id=j.voucher_id AND l.payment_line_id=j.id)>j.debit_minor+j.credit_minor) THEN
    PERFORM openerp.fail('InvalidJournal','Applied allocations must conserve both invoice and posted payment capacities.'); END IF;
  IF EXISTS(SELECT FROM openerp.commerce_allocation_legs l
    JOIN openerp.commerce_invoices i ON i.book_id=l.book_id AND i.id=l.invoice_id
    JOIN openerp.journal_lines j ON j.book_id=l.book_id AND j.voucher_id=l.payment_voucher_id AND j.id=l.payment_line_id
    JOIN openerp.vouchers payment ON payment.book_id=j.book_id AND payment.id=j.voucher_id
    JOIN openerp.vouchers recognition ON recognition.book_id=i.book_id AND recognition.id=i.recognition_voucher_id
    WHERE l.book_id=p_book AND l.receipt_id=p_receipt AND (j.account_id<>i.control_account_id
      OR (i.direction='customer' AND j.credit_minor=0) OR (i.direction='supplier' AND j.debit_minor=0)
      OR payment.event_id=recognition.event_id OR payment.posting_date<recognition.posting_date
      OR NOT openerp.commerce_voucher_current(p_book,payment.id) OR NOT openerp.commerce_voucher_current(p_book,recognition.id))) THEN
    PERFORM openerp.fail('InvalidJournal','Allocation references must retain distinct current recognition and opposite-side settlement on the same control account.'); END IF;
END $$;
CREATE FUNCTION openerp.commerce_check_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF TG_TABLE_NAME='commerce_allocation_legs' THEN
    PERFORM openerp.commerce_assert_allocation(NEW.book_id,NEW.receipt_id);
  ELSE
    PERFORM openerp.commerce_assert_allocation(NEW.book_id,NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER commerce_conserve_legs AFTER INSERT ON openerp.commerce_allocation_legs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_check_allocation();
CREATE CONSTRAINT TRIGGER commerce_complete_receipt AFTER INSERT ON openerp.commerce_allocation_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openerp.commerce_check_allocation();

-- Internal closing dependency, not a claim that all source invoices have been registered.
-- Later-period payments and nonfinancial metadata revisions do not rewrite an earlier financial inventory digest.
CREATE FUNCTION openerp.commerce_period_status(p_book text,p_starts date,p_ends date) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, openerp AS $$
DECLARE v_registered bigint; v_recognition_invalid bigint; v_allocation_invalid bigint; v_conservation_invalid bigint;
  v_sources jsonb; v_legs jsonb; v_book openerp.books; v_blockers jsonb:='[]';
BEGIN
  IF p_starts IS NULL OR p_ends IS NULL OR p_starts>p_ends THEN PERFORM openerp.fail('InvalidJournal','Choose an ordered commerce inventory interval.'); END IF;
  SELECT * INTO v_book FROM openerp.books b WHERE b.id=p_book;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The book was not found.'); END IF;
  SELECT count(*),count(*) FILTER (WHERE NOT openerp.commerce_voucher_current(p_book,v.id)
    OR j.account_id<>i.control_account_id OR (i.direction='customer' AND j.debit_minor<>i.amount_minor)
    OR (i.direction='supplier' AND j.credit_minor<>i.amount_minor)),
    coalesce(jsonb_agg(i.body ORDER BY i.id COLLATE "C"),'[]') INTO v_registered,v_recognition_invalid,v_sources
    FROM openerp.commerce_invoices i JOIN openerp.vouchers v ON v.book_id=i.book_id AND v.id=i.recognition_voucher_id
    JOIN openerp.journal_lines j ON j.book_id=i.book_id AND j.voucher_id=i.recognition_voucher_id AND j.id=i.recognition_line_id
    WHERE i.book_id=p_book AND v.posting_date<=p_ends;
  SELECT count(*) FILTER (WHERE NOT openerp.commerce_voucher_current(p_book,v.id) OR j.account_id<>i.control_account_id
    OR (i.direction='customer' AND j.credit_minor=0) OR (i.direction='supplier' AND j.debit_minor=0)
    OR v.event_id=recognition.event_id OR v.posting_date<recognition.posting_date),
    coalesce(jsonb_agg(jsonb_build_object('receiptId',l.receipt_id,'ordinal',l.ordinal,'invoiceId',l.invoice_id,
      'voucherId',l.payment_voucher_id,'lineId',l.payment_line_id,'postingDate',v.posting_date::text,
      'amountMinor',l.amount_minor::text,'planDigest',r.body->>'planDigest') ORDER BY l.receipt_id COLLATE "C",l.ordinal),'[]')
    INTO v_allocation_invalid,v_legs FROM openerp.commerce_allocation_legs l
    JOIN openerp.commerce_allocation_receipts r ON r.book_id=l.book_id AND r.id=l.receipt_id
    JOIN openerp.commerce_invoices i ON i.book_id=l.book_id AND i.id=l.invoice_id
    JOIN openerp.vouchers recognition ON recognition.book_id=i.book_id AND recognition.id=i.recognition_voucher_id
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.payment_voucher_id
    JOIN openerp.journal_lines j ON j.book_id=l.book_id AND j.voucher_id=l.payment_voucher_id AND j.id=l.payment_line_id
    WHERE l.book_id=p_book AND v.posting_date<=p_ends;
  SELECT count(*) INTO v_conservation_invalid FROM (
    SELECT i.id FROM openerp.commerce_invoices i JOIN openerp.commerce_allocation_legs l ON l.book_id=i.book_id AND l.invoice_id=i.id
      JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.payment_voucher_id
      WHERE i.book_id=p_book AND v.posting_date<=p_ends GROUP BY i.id,i.amount_minor HAVING sum(l.amount_minor)>i.amount_minor
    UNION ALL
    SELECT j.id FROM openerp.journal_lines j JOIN openerp.commerce_allocation_legs l
      ON l.book_id=j.book_id AND l.payment_voucher_id=j.voucher_id AND l.payment_line_id=j.id
      JOIN openerp.vouchers v ON v.book_id=j.book_id AND v.id=j.voucher_id
      WHERE j.book_id=p_book AND v.posting_date<=p_ends GROUP BY j.voucher_id,j.id,j.debit_minor,j.credit_minor HAVING sum(l.amount_minor)>j.debit_minor+j.credit_minor
  ) invalid;
  IF v_recognition_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered invoice recognition is invalid or reversed.'); END IF;
  IF v_allocation_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered payment allocations have invalid or reversed references.'); END IF;
  IF v_conservation_invalid>0 THEN v_blockers:=v_blockers||jsonb_build_array('Registered allocation capacities are inconsistent.'); END IF;
  RETURN jsonb_build_object('schemaVersion',1,'coverage','not_established','startsOn',p_starts::text,'endsOn',p_ends::text,
    'registeredInvoiceCount',v_registered,'invalidRecognitionCount',v_recognition_invalid,'invalidAllocationCount',v_allocation_invalid,
    'conservationFailureCount',v_conservation_invalid,'sourceDigest',openerp.digest(jsonb_build_object(
      'scope',jsonb_build_object('bookId',p_book,'entityId',v_book.entity_id),'currency',v_book.currency,'currencyScale',v_book.currency_scale,
      'startsOn',p_starts::text,'endsOn',p_ends::text,'invoices',v_sources,'allocations',v_legs)),'blockers',v_blockers);
END $$;

-- Default privileges are not assumed: helpers, tables and triggers are private.
REVOKE ALL ON openerp.commerce_counterparties,openerp.commerce_counterparty_revisions,openerp.commerce_control_accounts,openerp.commerce_invoices,openerp.commerce_invoice_revisions,openerp.commerce_allocation_plans,openerp.commerce_allocation_approvals,openerp.commerce_allocation_receipts,openerp.commerce_allocation_legs FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_freeze_identity() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_require_profile(text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_exact_object(jsonb,text[]) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_text(jsonb,text,integer) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_positive_minor(jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_evidence(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_record_metadata(text,text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_voucher_current(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_invoice_body(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_payment_body(text,text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_create_counterparty(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_revise_counterparty(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_get_counterparty(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_list_counterparties(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_create_invoice(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_revise_invoice(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_get_invoice(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_list_invoices(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_invoice_history(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_get_payment_capacity(text,jsonb,text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_allocation_selection(text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_allocation_current(text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_prepare_allocation(text,jsonb,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_get_allocation(text,jsonb,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_approve_allocation(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_apply_allocation(text,jsonb,text,text,jsonb) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_guard_bank_source() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_guard_control_account() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_guard_voucher_reversal() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_assert_allocation(text,text) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_check_allocation() FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.commerce_period_status(text,date,date) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_create_counterparty(text,jsonb,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_revise_counterparty(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_get_counterparty(text,jsonb,text,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_list_counterparties(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_create_invoice(text,jsonb,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_revise_invoice(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_get_invoice(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_list_invoices(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_invoice_history(text,jsonb,text,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_get_payment_capacity(text,jsonb,text,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_prepare_allocation(text,jsonb,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_get_allocation(text,jsonb,text) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_approve_allocation(text,jsonb,text,text,jsonb) TO openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.commerce_apply_allocation(text,jsonb,text,text,jsonb) TO openerp_runtime;
