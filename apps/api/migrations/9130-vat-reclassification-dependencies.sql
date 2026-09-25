CREATE OR REPLACE FUNCTION openerp.correction_impact_resources(p_book text,p_voucher text,p_date date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_resources jsonb; ci_tax_resources jsonb; ci_disposal_resources jsonb; ci_vat_resources jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.id,'detail',r.detail,'path',r.path,'blocks',r.blocks)
      ORDER BY r.kind COLLATE "C",r.id COLLATE "C",r.detail COLLATE "C"),'[]') INTO ci_resources FROM (
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
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'kind','tax_account_match','id',m.id,
    'detail','Retained tax-account match '||m.id||': event '||c.event_id||', voucher '||c.voucher_id||', line '||c.line_id||'. Explicitly unmatch this reserved relation before correcting the voucher.',
    'path','/tax-account/matches/'||m.id,'blocks',true,
    'taxAccountMatch',jsonb_build_object('statementId',m.body->'basis'->'statementId',
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','schedule','id',d.schedule_id,
    'detail','Terminal synthetic disposal '||d.id||' owns this '||
      CASE WHEN e.voucher_id=p_voucher THEN 'disposal' ELSE 'acquisition/imported-basis' END||
      ' voucher. Disposal-aware correction and reopening are unavailable; generic correction is blocked.',
    'path','/schedules/'||d.schedule_id,'blocks',true,'dependencyDigest',d.body->>'digest')
    ORDER BY d.schedule_id COLLATE "C"),'[]') INTO ci_disposal_resources
    FROM openerp.subledger_disposals d
    JOIN openerp.subledger_disposal_reviews r ON r.book_id=d.book_id AND r.id=d.review_id
    JOIN openerp.execution_receipts e ON e.book_id=d.book_id AND e.id=d.posting_receipt_id
    WHERE d.book_id=p_book AND (e.voucher_id=p_voucher OR r.body->'basis'->'carryingBasis'->'input'->>'voucherId'=p_voucher);
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind' COLLATE "C",resource->>'id' COLLATE "C",resource->>'detail' COLLATE "C"),'[]') INTO ci_vat_resources
    FROM (
      SELECT jsonb_build_object('kind','vat_control_reclassification','id',e.id,
        'detail','VAT control reclassification '||e.id||' '||
          CASE WHEN e.voucher_id=p_voucher THEN 'owns this reclassification voucher.'
            ELSE 'owns exact source voucher '||p_voucher||' through its retained contribution lineage.' END||
          ' Generic correction is blocked; the VAT owner has no correction workflow in this version.',
        'path','/vat-returns/reclassifications/'||e.review_id,'blocks',true,
        'dependencyDigest',openerp.digest(jsonb_build_object('effectDigest',e.body->>'digest','reviewDigest',e.body->>'reviewDigest',
          'contributionCount',(SELECT count(*) FROM openerp.vat_control_reclassification_contributions c
            WHERE c.book_id=e.book_id AND c.effect_id=e.id)))) resource
      FROM openerp.vat_control_reclassification_effects e
      WHERE e.book_id=p_book AND (e.voucher_id=p_voucher OR EXISTS(SELECT FROM openerp.vat_control_reclassification_contributions c
        WHERE c.book_id=e.book_id AND c.effect_id=e.id AND c.voucher_id=p_voucher))
    ) vat;
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind' COLLATE "C",resource->>'id' COLLATE "C",resource->>'detail' COLLATE "C"),'[]') INTO ci_resources
    FROM jsonb_array_elements(ci_resources||openerp.correction_owner_impact_resources(p_book,p_voucher)||ci_tax_resources||ci_disposal_resources||ci_vat_resources) item(resource);
  IF jsonb_array_length(ci_resources)>1000 THEN PERFORM openerp.fail('UnsupportedProfile','This impact exceeds 1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN ci_resources;
END $$;

CREATE OR REPLACE FUNCTION openerp.tax_account_line_claimed(p_book text,p_voucher text,p_line text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT EXISTS(SELECT FROM openerp.bank_active_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher AND m.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.bank_active_allocation_legs l WHERE l.book_id=p_book AND l.voucher_id=p_voucher AND l.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.owner_effects e WHERE e.book_id=p_book AND e.voucher_id=p_voucher AND e.line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher AND i.recognition_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.commerce_active_allocation_legs l WHERE l.book_id=p_book AND l.payment_voucher_id=p_voucher AND l.payment_line_id=p_line)
    OR EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=p_book AND v.id=p_voucher
      AND v.posting_purpose='vat_control_reclassification_v1')
$$;

CREATE OR REPLACE FUNCTION openerp.posting_recovery_standalone(book text,id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT NOT EXISTS(SELECT FROM openerp.correction_bundles b WHERE b.book_id=book
      AND posting_recovery_standalone.id IN(b.reversal_change_set_id,b.replacement_change_set_id))
    AND NOT EXISTS(SELECT FROM openerp.vat_control_reclassification_reviews r
      WHERE r.book_id=book AND r.change_set_id=posting_recovery_standalone.id)
$$;

CREATE OR REPLACE FUNCTION openerp.vat_return_dependencies(book text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_facts integer; v_drafts integer; v_amendments integer; v_profiles integer; v_obligations integer;
  v_reviews integer; v_approvals integer; v_effects integer; v_contributions integer; v_basis jsonb; v_tax_accounts jsonb;
  v_profile_inventory jsonb; v_obligation_inventory jsonb; v_review_inventory jsonb; v_approval_inventory jsonb;
  v_effect_inventory jsonb; v_contribution_inventory jsonb; v_amendment_inventory jsonb;
BEGIN
  SELECT count(*) INTO v_facts FROM (SELECT 1 FROM openerp.vat_fact_components f WHERE f.book_id=book LIMIT 201) bounded;
  SELECT count(*) INTO v_drafts FROM (SELECT 1 FROM openerp.vat_return_drafts d WHERE d.book_id=book LIMIT 501) bounded;
  SELECT count(*) INTO v_amendments FROM (SELECT 1 FROM openerp.vat_draft_amendments a WHERE a.book_id=book LIMIT 501) bounded;
  SELECT count(*) INTO v_profiles FROM (SELECT 1 FROM openerp.vat_control_profiles p WHERE p.book_id=book LIMIT 21) bounded;
  SELECT count(*) INTO v_obligations FROM (SELECT 1 FROM openerp.vat_reporting_obligations o WHERE o.book_id=book LIMIT 201) bounded;
  SELECT count(*) INTO v_reviews FROM (SELECT 1 FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=book LIMIT 501) bounded;
  SELECT count(*) INTO v_approvals FROM (SELECT 1 FROM openerp.vat_control_reclassification_approvals a WHERE a.book_id=book LIMIT 10001) bounded;
  SELECT count(*) INTO v_effects FROM (SELECT 1 FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=book LIMIT 501) bounded;
  SELECT count(*) INTO v_contributions FROM (SELECT 1 FROM openerp.vat_control_reclassification_contributions c WHERE c.book_id=book LIMIT 5001) bounded;
  IF v_facts>200 OR v_drafts>500 OR v_amendments>500 OR v_profiles>20 OR v_obligations>200 OR v_reviews>500
    OR v_approvals>10000 OR v_effects>500 OR v_contributions>5000 THEN RETURN NULL; END IF;
  IF EXISTS(SELECT FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=book
      GROUP BY r.obligation_id HAVING count(*)>20)
    OR EXISTS(SELECT FROM openerp.vat_control_reclassification_approvals a WHERE a.book_id=book
      GROUP BY a.review_id HAVING count(*)>20) THEN RETURN NULL; END IF;
  v_tax_accounts:=openerp.tax_account_close_dependencies(book);
  IF v_tax_accounts IS NULL THEN RETURN NULL; END IF;
  v_basis:=openerp.vat_return_basis_body(book);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'digest',p.body->>'digest') ORDER BY p.id COLLATE "C"),'[]')
    INTO v_profile_inventory FROM openerp.vat_control_profiles p WHERE p.book_id=book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'digest',o.digest,'startsOn',o.starts_on::text,'endsOn',o.ends_on::text)
      ORDER BY o.starts_on,o.ends_on,o.id COLLATE "C"),'[]') INTO v_obligation_inventory
    FROM openerp.vat_reporting_obligations o WHERE o.book_id=book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'obligationId',r.obligation_id,'digest',r.body->>'digest')
      ORDER BY r.obligation_id COLLATE "C",r.ordinal,r.id COLLATE "C"),'[]') INTO v_review_inventory
    FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'reviewId',a.review_id,'digest',a.body->>'digest')
      ORDER BY a.review_id COLLATE "C",a.body->>'createdAt',a.id COLLATE "C"),'[]') INTO v_approval_inventory
    FROM openerp.vat_control_reclassification_approvals a WHERE a.book_id=book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'obligationId',e.obligation_id,'reviewId',e.review_id,
      'digest',e.body->>'digest','outcome',e.outcome) ORDER BY e.obligation_id COLLATE "C",e.id COLLATE "C"),'[]')
    INTO v_effect_inventory FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'effectId',c.effect_id,'ordinal',c.ordinal,
      'factId',c.fact_id,'voucherId',c.voucher_id,'lineId',c.line_id,'digest',openerp.digest(c.body))
      ORDER BY c.effect_id COLLATE "C",c.ordinal,c.id COLLATE "C"),'[]') INTO v_contribution_inventory
    FROM openerp.vat_control_reclassification_contributions c WHERE c.book_id=book;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'digest',a.body->>'digest') ORDER BY a.id COLLATE "C"),'[]')
    INTO v_amendment_inventory FROM openerp.vat_draft_amendments a WHERE a.book_id=book;
  RETURN jsonb_build_object('basisDigest',v_basis->>'digest','sourceCount',jsonb_array_length(v_basis->'facts'),
    'draftCount',v_drafts,'taxAccounts',v_tax_accounts,'profileCount',v_profiles,
    'profileInventoryDigest',openerp.digest(v_profile_inventory),'obligationCount',v_obligations,
    'obligationInventoryDigest',openerp.digest(v_obligation_inventory),'reviewCount',v_reviews,
    'reviewInventoryDigest',openerp.digest(v_review_inventory),'approvalCount',v_approvals,
    'approvalInventoryDigest',openerp.digest(v_approval_inventory),'effectCount',v_effects,
    'effectInventoryDigest',openerp.digest(v_effect_inventory),'contributionCount',v_contributions,
    'contributionInventoryDigest',openerp.digest(v_contribution_inventory),'amendmentCount',v_amendments,
    'amendmentInventoryDigest',openerp.digest(v_amendment_inventory),'coverageEstablished',false,
    'ledgerReconciled',false,'legalProfileActive',false,'filingReady',false);
END $$;

CREATE OR REPLACE FUNCTION openerp.accountant_review_providers_bounded(p_book text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,openerp AS $$
  SELECT openerp.tax_account_close_dependencies(p_book) IS NOT NULL
    AND openerp.vat_return_dependencies(p_book) IS NOT NULL
    AND NOT((SELECT count(*) FROM (SELECT 1 FROM openerp.owner_parties p WHERE p.book_id=p_book LIMIT 101) bounded)>100
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_records r WHERE r.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_effects e WHERE e.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.owner_allocation_legs l WHERE l.book_id=p_book LIMIT 5001) bounded)>5000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.expense_tax_sources s WHERE s.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_fact_components v WHERE v.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_return_drafts v WHERE v.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_draft_amendments a WHERE a.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_profiles p WHERE p.book_id=p_book LIMIT 21) bounded)>20
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_reporting_obligations o WHERE o.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_reclassification_reviews r WHERE r.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_reclassification_approvals a WHERE a.book_id=p_book LIMIT 10001) bounded)>10000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_reclassification_effects e WHERE e.book_id=p_book LIMIT 501) bounded)>500
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.vat_control_reclassification_contributions c WHERE c.book_id=p_book LIMIT 5001) bounded)>5000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_schedules s WHERE s.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_bases b WHERE b.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_control_snapshots c WHERE c.book_id=p_book LIMIT 201) bounded)>200
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_preparations p WHERE p.book_id=p_book LIMIT 10001) bounded)>10000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.accounts a WHERE a.book_id=p_book LIMIT 1001) bounded)>1000
    OR (SELECT count(*) FROM (SELECT 1 FROM openerp.periods p WHERE p.book_id=p_book LIMIT 1001) bounded)>1000)
$$;

REVOKE ALL ON FUNCTION openerp.correction_impact_resources(text,text,date),
  openerp.tax_account_line_claimed(text,text,text),openerp.posting_recovery_standalone(text,text),
  openerp.vat_return_dependencies(text),openerp.accountant_review_providers_bounded(text)
FROM PUBLIC,openerp_runtime;
