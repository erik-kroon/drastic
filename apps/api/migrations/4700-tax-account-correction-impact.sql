-- Forward-only tax-account correction-impact closure over1700 and4100.
-- Reuse the existing review/admission consumer. No new artifact or financial action.
CREATE OR REPLACE FUNCTION openerp.correction_impact_resources(p_book text,p_voucher text,p_date date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_resources jsonb; ci_tax_resources jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.id,'detail',r.detail,'path',r.path,'blocks',r.blocks)
      ORDER BY r.kind,r.id,r.detail),'[]') INTO ci_resources FROM (
    SELECT 'bank_match' kind,m.statement_id id,'Retained bank match: row '||m.row_ordinal::text||', line '||m.line_id||'. Unmatch this active relationship before correcting the voucher.' detail,
      '/bank-statements/'||m.statement_id path,true blocks FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',a.plan_id,'Applied bank allocation: row '||a.row_ordinal::text||', line '||a.line_id||'. Unmatch this active allocation before correcting the voucher.',
      '/bank-allocation-plans/'||a.plan_id,true FROM openerp.bank_active_allocation_legs a WHERE a.book_id=p_book AND a.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',p.id,'Unexecuted bank allocation plan references this voucher. It must revalidate after any correction.',
      '/bank-allocation-plans/'||p.id,false FROM openerp.bank_allocation_plans p WHERE p.book_id=p_book
      AND NOT EXISTS(SELECT FROM openerp.bank_allocation_executions e WHERE e.book_id=p.book_id AND e.plan_id=p.id)
      AND EXISTS(SELECT FROM jsonb_array_elements(p.input->'legs') item(leg) WHERE leg->>'voucherId'=p_voucher)
    UNION ALL SELECT 'invoice',i.id,'Registered invoice recognition, line '||i.recognition_line_id||'. Use the commerce owner; generic release is unavailable.',
      '/commerce/invoices/'||i.id,true FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',a.receipt_id,'Applied invoice payment, invoice '||a.invoice_id||', line '||a.payment_line_id||'. Unallocate this active whole application before correcting the payment voucher.',
      '/commerce/invoices/'||a.invoice_id,true FROM openerp.commerce_active_allocation_legs a WHERE a.book_id=p_book AND a.payment_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',p.id,'Unapplied commerce payment plan references this voucher. Its owner must revalidate the plan; this review does not release capacity.',
      '/commerce/allocation-plans/'||p.id,false FROM openerp.commerce_allocation_plans p WHERE p.book_id=p_book
      AND p.body->'payment'->>'voucherId'=p_voucher
      AND NOT EXISTS(SELECT FROM openerp.commerce_allocation_receipts r WHERE r.book_id=p.book_id AND r.plan_id=p.id)
    UNION ALL SELECT DISTINCT 'schedule',s.schedule_id,'Represented schedule occurrence '||s.ordinal::text||'. Posted-occurrence compensation is unavailable.',
      '/schedules/'||s.schedule_id,true FROM openerp.subledger_preparations s JOIN openerp.change_sets c ON c.book_id=s.book_id AND c.id=s.change_set_id
      JOIN openerp.vouchers v ON v.book_id=s.book_id AND v.id=p_voucher
      WHERE s.book_id=p_book AND (s.change_set_id=v.change_set_id OR c.plan->'groups'->0->'actions'->0->>'eventId'=v.event_id)
    UNION ALL SELECT 'report',r.id,'Retained report covers the correction date. Its original bytes stay unchanged; prepare a new snapshot after posting.',
      '/report-snapshots/'||r.id,false FROM openerp.report_snapshots r WHERE r.book_id=p_book AND p_date BETWEEN r.starts_on AND r.ends_on
    UNION ALL SELECT 'closing',c.id,'Technical certificate depends on the ledger sequence. A new posting makes its basis stale; no automatic reopen or statutory finding.',
      '/closing-certificates/'||c.id,false FROM openerp.closing_certificates c WHERE c.book_id=p_book AND p_date IS NOT NULL
  ) r;
  -- A reserved tax relation blocks correction even when its reviewed basis is no longer usable.
  -- Only4100's evidenced unmatch releases this capacity; this reader never changes it.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'kind','tax_account_match','id',m.id,
    'detail','Retained tax-account match '||m.id||': event '||c.event_id||', voucher '||c.voucher_id||', line '||c.line_id||'. Explicitly unmatch this reserved relation before correcting the voucher.',
    'path','/tax-account/matches/'||m.id,'blocks',true,
    'taxAccountMatch',jsonb_build_object('statementId',m.body->'basis'->>'statementId',
      'statementDigest',m.body->'basis'->'selection'->>'statementDigest','eventId',c.event_id,
      'voucherId',c.voucher_id,'lineId',c.line_id,'matchDigest',m.body->>'digest',
      'usable',coalesce((effective.state->>'usable')::boolean,false)),
    'dependencyDigest',openerp.digest(jsonb_build_object('matchDigest',m.body->>'digest','capacity',to_jsonb(c),
      'active',effective.state->'active','usable',effective.state->'usable')))
    ORDER BY m.id COLLATE "C"),'[]') INTO ci_tax_resources
    FROM openerp.tax_account_match_capacity c
    JOIN openerp.tax_account_matches m ON m.book_id=c.book_id AND m.id=c.match_id
    CROSS JOIN LATERAL(SELECT openerp.tax_account_match_view(m.book_id,m.id) AS state) effective
    WHERE c.book_id=p_book AND c.voucher_id=p_voucher;
  -- Keep the original resource shape unchanged when no owner or tax record is affected.
  -- The enclosing basis comparison binds these digests at seal/approve/execute.
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind',resource->>'id',resource->>'detail'),'[]') INTO ci_resources
    FROM jsonb_array_elements(ci_resources||openerp.correction_owner_impact_resources(p_book,p_voucher)||ci_tax_resources) item(resource);
  IF jsonb_array_length(ci_resources)>1000 THEN PERFORM openerp.fail('UnsupportedProfile','This impact exceeds1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN ci_resources;
END $$;
REVOKE ALL ON FUNCTION openerp.correction_impact_resources(text,text,date) FROM PUBLIC,openerp_runtime;
