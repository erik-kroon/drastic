ALTER FUNCTION openerp.check_voucher_balance() SECURITY DEFINER;

CREATE OR REPLACE FUNCTION openerp.ledger_snapshot(token text, scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE watermark bigint; accounts jsonb;
BEGIN
  PERFORM openerp.authorize(token, scope);
  SELECT committed_sequence INTO watermark FROM openerp.books WHERE id = scope->>'bookId' FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId', a.id, 'code', a.code, 'name', a.name,
    'debitMinor', coalesce(t.debit, 0)::text, 'creditMinor', coalesce(t.credit, 0)::text,
    'balanceMinor', (coalesce(t.debit, 0) - coalesce(t.credit, 0))::text) ORDER BY a.code), '[]') INTO accounts
    FROM openerp.accounts a LEFT JOIN (
      SELECT l.account_id, sum(l.debit_minor) debit, sum(l.credit_minor) credit
      FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id = l.book_id AND v.id = l.voucher_id
      WHERE l.book_id = scope->>'bookId' AND v.sequence <= watermark GROUP BY l.account_id
    ) t ON t.account_id = a.id WHERE a.book_id = scope->>'bookId';
  RETURN jsonb_build_object('sequence', watermark::text, 'accounts', accounts);
END $$;
