CREATE TABLE openerp.collection_statement_artifacts (
  book_id text NOT NULL REFERENCES openerp.books,
  statement_id text NOT NULL,
  content text NOT NULL CHECK (octet_length(convert_to(content,'UTF8')) BETWEEN 1 AND 262144),
  PRIMARY KEY(book_id,statement_id),
  FOREIGN KEY(book_id,statement_id) REFERENCES openerp.collection_statements(book_id,id)
);
INSERT INTO openerp.collection_statement_artifacts(book_id,statement_id,content)
  SELECT book_id,id,openerp.canonical(body) FROM openerp.collection_statements;
CREATE TRIGGER immutable_collection_statement_artifact
  BEFORE UPDATE OR DELETE ON openerp.collection_statement_artifacts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE FUNCTION openerp.retain_collection_statement_artifact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
BEGIN
  INSERT INTO openerp.collection_statement_artifacts(book_id,statement_id,content)
    VALUES(NEW.book_id,NEW.id,openerp.canonical(NEW.body));
  RETURN NEW;
END $$;
CREATE TRIGGER retain_collection_statement_artifact
  AFTER INSERT ON openerp.collection_statements
  FOR EACH ROW EXECUTE FUNCTION openerp.retain_collection_statement_artifact();
REVOKE ALL ON openerp.collection_statement_artifacts FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.retain_collection_statement_artifact() FROM PUBLIC,openerp_runtime;

CREATE FUNCTION openerp.collection_worklist(p_token text,p_scope jsonb,p_page text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_checked timestamptz:=statement_timestamp(); v_today date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
  v_page integer; v_result jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  PERFORM 1 FROM openerp.books WHERE id=p_scope->>'bookId' FOR SHARE;
  IF coalesce(p_page,'') !~ '^[1-9][0-9]{0,5}$' THEN
    PERFORM openerp.fail('InvalidJournal','Choose a supported collection worklist page.');
  END IF;
  v_page:=p_page::integer;
  WITH live AS MATERIALIZED (
    SELECT i.id,i.document_number,i.counterparty_id,v.body,
      EXISTS(SELECT FROM openerp.collection_disputes d WHERE d.book_id=i.book_id AND d.invoice_id=i.id
        AND NOT EXISTS(SELECT FROM openerp.collection_events e WHERE e.book_id=d.book_id AND e.dispute_id=d.id AND e.kind='dispute_resolved')) disputed,
      EXISTS(SELECT FROM openerp.collection_disputes d WHERE d.book_id=i.book_id AND d.invoice_id=i.id
        AND d.body->'holdReminders'='true'::jsonb
        AND NOT EXISTS(SELECT FROM openerp.collection_events e WHERE e.book_id=d.book_id AND e.dispute_id=d.id AND e.kind='dispute_resolved')) hold_reminders
    FROM openerp.commerce_invoices i
    CROSS JOIN LATERAL (SELECT openerp.commerce_invoice_body(i.book_id,i.id) body) v
    WHERE i.book_id=p_scope->>'bookId' AND i.direction='customer'
      AND v.body->>'status' IN ('open','partially_allocated','blocked')
  ), entries AS MATERIALIZED (
    SELECT l.id,jsonb_build_object(
      'invoiceId',l.id,'invoiceNumber',l.document_number,'customerId',l.counterparty_id,
      'customerName',l.body->>'counterpartyName','dueOn',l.body->'currentRevision'->>'dueOn',
      'currency',l.body->>'currency','currencyScale',(l.body->>'currencyScale')::integer,
      'residualMinor',l.body->'outstandingMinor','status',l.body->>'status',
      'disputed',l.disputed,'holdReminders',l.hold_reminders,
      'nextAction',CASE WHEN l.hold_reminders THEN 'review_hold' WHEN l.disputed THEN 'review_dispute'
        WHEN l.body->>'status'='blocked' THEN 'review_blocked_invoice'
        WHEN (l.body->'currentRevision'->>'dueOn')::date<v_today THEN 'follow_up_overdue'
        ELSE 'follow_up' END) row
    FROM live l
  ), ordered AS MATERIALIZED (
    SELECT e.*,row_number() OVER (ORDER BY (e.row->>'dueOn')::date,lower(e.row->>'customerName') COLLATE "C",e.id COLLATE "C") ordinal
    FROM entries e
  ), page AS (
    SELECT * FROM ordered WHERE ordinal>(v_page-1)*50 AND ordinal<=v_page*50
  )
  SELECT jsonb_build_object('scope',p_scope,
    'checkedAt',to_char(v_checked AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'asOf',v_today::text,
    'page',v_page,'pageSize',50,'total',(SELECT count(*) FROM ordered),
    'items',coalesce((SELECT jsonb_agg(p.row ORDER BY p.ordinal) FROM page p),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END $$;

CREATE FUNCTION openerp.collection_statement_export(p_token text,p_scope jsonb,p_statement text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE v_customer text; v_body jsonb; v_content text;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  IF p_statement !~ '^[a-z][a-z0-9_]{2,127}$' THEN
    PERFORM openerp.fail('InvalidJournal','Select a valid collection statement identity.');
  END IF;
  SELECT s.customer_id,s.body,a.content INTO v_customer,v_body,v_content
  FROM openerp.collection_statements s
  JOIN openerp.collection_statement_artifacts a ON a.book_id=s.book_id AND a.statement_id=s.id
  WHERE s.book_id=p_scope->>'bookId' AND s.id=p_statement;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','Collection statement not found in this book.'); END IF;
  IF openerp.canonical(v_body) IS DISTINCT FROM v_content THEN
    PERFORM openerp.fail('StaleDependency','Retained collection statement body and export bytes disagree.');
  END IF;
  RETURN jsonb_build_object('scope',p_scope,'statementId',p_statement,'customerId',v_customer,
    'mediaType','application/json','encoding','UTF-8','filename',p_statement||'.json',
    'byteLength',octet_length(convert_to(v_content,'UTF8')),
    'sha256',encode(sha256(convert_to(v_content,'UTF8')),'hex'),'body',v_content);
END $$;
REVOKE ALL ON FUNCTION openerp.collection_worklist(text,jsonb,text),openerp.collection_statement_export(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.collection_worklist(text,jsonb,text),openerp.collection_statement_export(text,jsonb,text) TO openerp_runtime;
