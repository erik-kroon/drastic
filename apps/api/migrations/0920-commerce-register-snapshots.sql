-- Reporting only: no journal, invoice, allocation, approval or close transitions.
CREATE TABLE openerp.commerce_register_snapshots (
  book_id text NOT NULL REFERENCES openerp.books,
  id text COLLATE "C" NOT NULL,
  ordinal bigint NOT NULL CHECK (ordinal>0),
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 2097152),
  PRIMARY KEY (book_id,id), UNIQUE (book_id,ordinal)
);
CREATE TRIGGER immutable_commerce_register_snapshot BEFORE UPDATE OR DELETE ON openerp.commerce_register_snapshots
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE FUNCTION openerp.create_register_report(p_token text,p_scope jsonb,p_key text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_actor text; v_book openerp.books; v_previous jsonb; v_date date; v_result jsonb;
  v_invoices jsonb; v_allocations jsonb; v_lines jsonb; v_controls jsonb;
  v_invoice_count integer; v_allocation_count integer; v_line_count integer; v_account_count integer;
  v_ordinal bigint;
BEGIN
  v_actor:=openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR UPDATE;
  v_previous:=openerp.replay(v_book.id,p_key,v_actor,'create_register_report',p_input);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  PERFORM openerp.commerce_require_profile(v_book.id);
  PERFORM openerp.commerce_exact_object(p_input,ARRAY['asOfDate']);
  IF jsonb_typeof(p_input->'asOfDate') IS DISTINCT FROM 'string' THEN
    PERFORM openerp.fail('InvalidJournal','Choose an as-of date in YYYY-MM-DD format.');
  END IF;
  v_date:=openerp.bank_date(p_input->>'asOfDate');

  -- Count only to the rejection boundary before building any snapshot arrays.
  SELECT count(*) INTO v_account_count FROM (
    SELECT 1 FROM openerp.commerce_control_accounts c WHERE c.book_id=v_book.id LIMIT 101
  ) bounded;
  SELECT count(*) INTO v_invoice_count FROM (
    SELECT 1 FROM openerp.commerce_invoices i JOIN openerp.vouchers v
      ON v.book_id=i.book_id AND v.id=i.recognition_voucher_id
      WHERE i.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence LIMIT 2001
  ) bounded;
  SELECT count(*) INTO v_allocation_count FROM (
    SELECT 1 FROM openerp.commerce_allocation_legs l JOIN openerp.vouchers v
      ON v.book_id=l.book_id AND v.id=l.payment_voucher_id
      WHERE l.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence LIMIT 2001
  ) bounded;
  SELECT count(*) INTO v_line_count FROM (
    SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
      JOIN openerp.commerce_control_accounts c ON c.book_id=l.book_id AND c.account_id=l.account_id
      WHERE l.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence LIMIT 2001
  ) bounded;
  IF v_account_count>100 OR v_invoice_count+v_allocation_count+v_line_count>2000 THEN
    PERFORM openerp.fail('InvalidJournal','Register snapshots support at most 100 declared accounts and 2000 combined invoices, allocation legs and ledger lines. No partial snapshot was saved.');
  END IF;

  IF EXISTS(SELECT FROM openerp.commerce_invoices i
    JOIN openerp.vouchers v ON v.book_id=i.book_id AND v.id=i.recognition_voucher_id
    JOIN openerp.journal_lines j ON j.book_id=i.book_id AND j.voucher_id=v.id AND j.id=i.recognition_line_id
    WHERE i.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence
      AND (NOT openerp.commerce_voucher_current(v_book.id,v.id) OR j.account_id<>i.control_account_id
        OR i.body->>'currency' IS DISTINCT FROM v_book.currency
        OR (i.direction='customer' AND (j.debit_minor<>i.amount_minor OR j.credit_minor<>0))
        OR (i.direction='supplier' AND (j.credit_minor<>i.amount_minor OR j.debit_minor<>0)))) THEN
    PERFORM openerp.fail('InvalidJournal','A selected invoice has invalid recognition. Resolve the linked register before reporting.');
  END IF;
  IF EXISTS(SELECT FROM openerp.commerce_allocation_legs l
    JOIN openerp.commerce_invoices i ON i.book_id=l.book_id AND i.id=l.invoice_id
    JOIN openerp.vouchers recognition ON recognition.book_id=i.book_id AND recognition.id=i.recognition_voucher_id
    JOIN openerp.vouchers payment ON payment.book_id=l.book_id AND payment.id=l.payment_voucher_id
    JOIN openerp.journal_lines j ON j.book_id=l.book_id AND j.voucher_id=payment.id AND j.id=l.payment_line_id
    WHERE l.book_id=v_book.id AND payment.posting_date<=v_date AND payment.sequence<=v_book.committed_sequence
      AND (NOT openerp.commerce_voucher_current(v_book.id,payment.id) OR j.account_id<>i.control_account_id
        OR recognition.posting_date>payment.posting_date OR recognition.sequence>v_book.committed_sequence
        OR recognition.event_id=payment.event_id
        OR (i.direction='customer' AND (j.credit_minor=0 OR j.debit_minor<>0))
        OR (i.direction='supplier' AND (j.debit_minor=0 OR j.credit_minor<>0)))) THEN
    PERFORM openerp.fail('InvalidJournal','A selected allocation has invalid payment or recognition links. Resolve the register before reporting.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'receiptId',l.receipt_id,'ordinal',l.ordinal,'invoiceId',l.invoice_id,
    'paymentVoucherId',l.payment_voucher_id,'paymentLineId',l.payment_line_id,
    'postingDate',v.posting_date::text,'amountMinor',l.amount_minor::text,
    'planId',r.plan_id,'planDigest',r.body->>'planDigest','committedAt',r.body->>'committedAt'
  ) ORDER BY l.receipt_id COLLATE "C",l.ordinal),'[]') INTO v_allocations
    FROM openerp.commerce_allocation_legs l
    JOIN openerp.commerce_allocation_receipts r ON r.book_id=l.book_id AND r.id=l.receipt_id
    JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.payment_voucher_id
    WHERE l.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'direction',i.direction,'counterpartyId',i.counterparty_id,
    'counterpartyRevision',i.counterparty_revision::text,'counterpartyName',i.body->>'counterpartyName',
    'documentNumber',i.document_number,'issuedOn',i.issued_on::text,'amountMinor',i.amount_minor::text,
    'controlAccountId',i.control_account_id,'evidence',i.body->'evidence','recognition',i.body->'recognition',
    'revision',r.body,'allocatedMinor',paid.amount::text,'outstandingMinor',(i.amount_minor-paid.amount)::text,
    'daysOverdue',greatest(v_date-(r.body->>'dueOn')::date,0),
    'ageBucket',CASE WHEN v_date<=(r.body->>'dueOn')::date THEN 'not_due'
      WHEN v_date-(r.body->>'dueOn')::date<=30 THEN 'days_1_30'
      WHEN v_date-(r.body->>'dueOn')::date<=60 THEN 'days_31_60'
      WHEN v_date-(r.body->>'dueOn')::date<=90 THEN 'days_61_90' ELSE 'over_90' END
  ) ORDER BY i.id COLLATE "C"),'[]') INTO v_invoices
    FROM openerp.commerce_invoices i
    JOIN openerp.commerce_invoice_revisions r ON r.book_id=i.book_id AND r.invoice_id=i.id AND r.revision=i.current_revision
    JOIN openerp.vouchers v ON v.book_id=i.book_id AND v.id=i.recognition_voucher_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((a->>'amountMinor')::numeric),0) AS amount FROM jsonb_array_elements(v_allocations) a
        WHERE a->>'invoiceId'=i.id
    ) paid
    WHERE i.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence;
  IF EXISTS(SELECT FROM jsonb_array_elements(v_invoices) i WHERE (i->>'outstandingMinor')::numeric<0) THEN
    PERFORM openerp.fail('InvalidJournal','Recorded allocations exceed a selected invoice amount. No snapshot was saved.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'accountId',l.account_id,'voucherId',v.id,'lineId',l.id,'sequence',v.sequence::text,'ordinal',l.ordinal,
    'postingDate',v.posting_date::text,'debitMinor',l.debit_minor::text,'creditMinor',l.credit_minor::text,
    'invoiceId',invoice.value->>'id','allocatedMinor',paid.amount::text,
    'registerEffectMinor',(coalesce((invoice.value->>'amountMinor')::numeric,0)-paid.amount)::text,
    'unexplainedMinor',((CASE WHEN c.direction='customer' THEN l.debit_minor-l.credit_minor ELSE l.credit_minor-l.debit_minor END)
      -coalesce((invoice.value->>'amountMinor')::numeric,0)+paid.amount)::text
  ) ORDER BY v.sequence,l.ordinal),'[]') INTO v_lines
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
    JOIN openerp.commerce_control_accounts c ON c.book_id=l.book_id AND c.account_id=l.account_id
    LEFT JOIN LATERAL (
      SELECT i AS value FROM jsonb_array_elements(v_invoices) i
        WHERE i->'recognition'->>'voucherId'=v.id AND i->'recognition'->>'lineId'=l.id
    ) invoice ON true
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((a->>'amountMinor')::numeric),0) AS amount FROM jsonb_array_elements(v_allocations) a
        WHERE a->>'paymentVoucherId'=v.id AND a->>'paymentLineId'=l.id
    ) paid
    WHERE l.book_id=v_book.id AND v.posting_date<=v_date AND v.sequence<=v_book.committed_sequence;
  IF EXISTS(SELECT FROM jsonb_array_elements(v_lines) l
    WHERE (l->>'allocatedMinor')::numeric>(l->>'debitMinor')::numeric+(l->>'creditMinor')::numeric) THEN
    PERFORM openerp.fail('InvalidJournal','Recorded allocations exceed a selected payment line. No snapshot was saved.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'accountId',c.account_id,'code',a.code,'name',a.name,'version',a.version::text,'active',a.active,'direction',c.direction,
    'recognizedMinor',invoices.recognized::text,'allocatedMinor',invoices.allocated::text,
    'outstandingMinor',invoices.outstanding::text,'ledgerMinor',ledger.balance::text,
    'differenceMinor',(ledger.balance-invoices.outstanding)::text,'unexplainedLineCount',ledger.unexplained,
    'ageing',jsonb_build_object('not_due',invoices.not_due::text,'days_1_30',invoices.days_1_30::text,
      'days_31_60',invoices.days_31_60::text,'days_61_90',invoices.days_61_90::text,'over_90',invoices.over_90::text)
  ) ORDER BY c.account_id COLLATE "C"),'[]') INTO v_controls
    FROM openerp.commerce_control_accounts c JOIN openerp.accounts a ON a.book_id=c.book_id AND a.id=c.account_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((i->>'amountMinor')::numeric),0) AS recognized,
        coalesce(sum((i->>'allocatedMinor')::numeric),0) AS allocated,
        coalesce(sum((i->>'outstandingMinor')::numeric),0) AS outstanding,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='not_due'),0) AS not_due,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='days_1_30'),0) AS days_1_30,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='days_31_60'),0) AS days_31_60,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='days_61_90'),0) AS days_61_90,
        coalesce(sum((i->>'outstandingMinor')::numeric) FILTER (WHERE i->>'ageBucket'='over_90'),0) AS over_90
      FROM jsonb_array_elements(v_invoices) i WHERE i->>'controlAccountId'=c.account_id
    ) invoices
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(CASE WHEN c.direction='customer' THEN (l->>'debitMinor')::numeric-(l->>'creditMinor')::numeric
        ELSE (l->>'creditMinor')::numeric-(l->>'debitMinor')::numeric END),0) AS balance,
        count(*) FILTER (WHERE (l->>'unexplainedMinor')::numeric<>0) AS unexplained
      FROM jsonb_array_elements(v_lines) l WHERE l->>'accountId'=c.account_id
    ) ledger WHERE c.book_id=v_book.id;

  IF jsonb_array_length(v_invoices)<>v_invoice_count OR jsonb_array_length(v_allocations)<>v_allocation_count
    OR jsonb_array_length(v_lines)<>v_line_count OR jsonb_array_length(v_controls)<>v_account_count THEN
    PERFORM openerp.fail('InvalidJournal','Selected register records are missing from the materialized basis. No partial snapshot was saved.');
  END IF;
  -- This reporting ordinal is serialized by the book lock; it is not a financial document number.
  SELECT coalesce(max(r.ordinal),0) INTO v_ordinal FROM openerp.commerce_register_snapshots r WHERE r.book_id=v_book.id;
  IF v_ordinal=9223372036854775807 THEN
    PERFORM openerp.fail('InvalidJournal','The register report inventory has reached its ordinal limit.');
  END IF;
  v_ordinal:=v_ordinal+1;
  v_result:=jsonb_build_object('id',openerp.new_id('register_report'),'ordinal',v_ordinal::text,'kind','synthetic_register_snapshot_v1',
    'scope',jsonb_build_object('entityId',v_book.entity_id,'bookId',v_book.id),'asOfDate',v_date::text,
    'sequence',v_book.committed_sequence::text,'currency',v_book.currency,'currencyScale',v_book.currency_scale,
    'profileVersion',v_book.profile_version::text,'knowledgeBasis','current_known_facts_at_capture','coverage','not_established',
    'status',CASE WHEN v_account_count=0 THEN 'no_declared_accounts'
      WHEN EXISTS(SELECT FROM jsonb_array_elements(v_controls) c
        WHERE (c->>'differenceMinor')::numeric<>0 OR (c->>'unexplainedLineCount')::integer<>0) THEN 'differences' ELSE 'balanced' END,
    'invoiceCount',v_invoice_count,'allocationCount',v_allocation_count,'ledgerLineCount',v_line_count,'accountCount',v_account_count,
    'controls',v_controls,'invoices',v_invoices,'allocations',v_allocations,'ledgerLines',v_lines)
    ||openerp.commerce_record_metadata(p_key,'create_register_report',v_actor);
  v_result:=v_result||jsonb_build_object('digest',openerp.digest(v_result));
  IF octet_length(v_result::text)>2097152 THEN
    PERFORM openerp.fail('InvalidJournal','The register snapshot exceeds the 2 MiB retained report limit. No partial snapshot was saved.');
  END IF;
  INSERT INTO openerp.commerce_register_snapshots VALUES(v_book.id,v_result->>'id',v_ordinal,v_result);
  RETURN openerp.save_command(v_book.id,p_key,v_actor,'create_register_report',p_input,v_result);
END $$;

CREATE FUNCTION openerp.get_register_report(p_token text,p_scope jsonb,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT r.body INTO v_result FROM openerp.commerce_register_snapshots r WHERE r.book_id=p_scope->>'bookId' AND r.id=p_id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The register snapshot was not found in this book.'); END IF;
  RETURN v_result;
END $$;

CREATE FUNCTION openerp.list_register_reports(p_token text,p_scope jsonb,p_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE v_items jsonb; v_next text; v_first text; v_cursor jsonb; v_cutoff bigint; v_after bigint:=0;
  v_current bigint; v_total bigint; v_last bigint; v_scope jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  v_scope:=jsonb_build_object('entityId',p_scope->>'entityId','bookId',p_scope->>'bookId');
  -- New captures wait on this short read barrier; all subsequent pages pin the returned cutoff.
  PERFORM 1 FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  SELECT coalesce(max(r.ordinal),0) INTO v_current FROM openerp.commerce_register_snapshots r WHERE r.book_id=p_scope->>'bookId';
  v_cutoff:=v_current;
  IF p_after IS NOT NULL AND p_after<>'' THEN
    IF length(p_after)>2048 OR p_after !~ '^rr1_[a-f0-9]+$' OR (length(p_after)-4)%2<>0 THEN
      PERFORM openerp.fail('InvalidJournal','Use an unchanged register inventory cursor returned by this book.');
    END IF;
    BEGIN
      v_cursor:=convert_from(decode(substr(p_after,5),'hex'),'UTF8')::jsonb;
    EXCEPTION WHEN invalid_parameter_value OR character_not_in_repertoire OR invalid_text_representation
      OR untranslatable_character THEN
      PERFORM openerp.fail('InvalidJournal','The register inventory cursor is malformed.');
    END;
    PERFORM openerp.commerce_exact_object(v_cursor,ARRAY['version','scope','cutoff','after']);
    IF v_cursor->'version' IS DISTINCT FROM '1'::jsonb OR v_cursor->'scope' IS DISTINCT FROM v_scope
      OR jsonb_typeof(v_cursor->'cutoff') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_cursor->'after') IS DISTINCT FROM 'string'
      OR coalesce(v_cursor->>'cutoff','') !~ '^(0|[1-9][0-9]{0,18})$'
      OR coalesce(v_cursor->>'after','') !~ '^(0|[1-9][0-9]{0,18})$' THEN
      PERFORM openerp.fail('InvalidJournal','The register inventory cursor has the wrong scope or bounds.');
    END IF;
    BEGIN
      v_cutoff:=(v_cursor->>'cutoff')::bigint; v_after:=(v_cursor->>'after')::bigint;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      PERFORM openerp.fail('InvalidJournal','The register inventory cursor exceeds supported bounds.');
    END;
    IF v_after>v_cutoff OR v_cutoff>v_current THEN
      PERFORM openerp.fail('InvalidJournal','The register inventory cursor exceeds its captured inventory.');
    END IF;
  END IF;
  SELECT count(*) INTO v_total FROM openerp.commerce_register_snapshots r
    WHERE r.book_id=p_scope->>'bookId' AND r.ordinal<=v_cutoff;
  IF v_total<>v_cutoff THEN
    PERFORM openerp.fail('InvalidJournal','The captured register inventory has missing ordinals.');
  END IF;
  SELECT coalesce(jsonb_agg(page.body ORDER BY page.ordinal),'[]') INTO v_items FROM (
    SELECT r.ordinal,r.body-ARRAY['controls','invoices','allocations','ledgerLines'] AS body
      FROM openerp.commerce_register_snapshots r WHERE r.book_id=p_scope->>'bookId'
        AND r.ordinal>v_after AND r.ordinal<=v_cutoff ORDER BY r.ordinal LIMIT 20
  ) page;
  IF jsonb_array_length(v_items)<>least(20,v_cutoff-v_after) THEN
    PERFORM openerp.fail('InvalidJournal','The captured register inventory page is incomplete.');
  END IF;
  v_first:='rr1_'||encode(convert_to(openerp.canonical(jsonb_build_object(
    'version',1,'scope',v_scope,'cutoff',v_cutoff::text,'after','0')),'UTF8'),'hex');
  v_last:=v_after+jsonb_array_length(v_items);
  IF v_last<v_cutoff THEN
    v_next:='rr1_'||encode(convert_to(openerp.canonical(jsonb_build_object(
      'version',1,'scope',v_scope,'cutoff',v_cutoff::text,'after',v_last::text)),'UTF8'),'hex');
  END IF;
  RETURN jsonb_build_object('scope',v_scope,'cutoff',v_cutoff::text,'total',v_total::text,
    'first',v_first,'items',v_items,'next',v_next);
END $$;

REVOKE ALL ON openerp.commerce_register_snapshots FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.create_register_report(text,jsonb,text,jsonb),
  openerp.get_register_report(text,jsonb,text),openerp.list_register_reports(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.create_register_report(text,jsonb,text,jsonb),
  openerp.get_register_report(text,jsonb,text),openerp.list_register_reports(text,jsonb,text) TO openerp_runtime;
