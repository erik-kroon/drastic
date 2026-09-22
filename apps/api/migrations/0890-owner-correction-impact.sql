-- Root-reserved correction integration; requires0410 and0610 before invocation.
-- Retained impact bodies and command/execution receipts are never rewritten.
CREATE FUNCTION openerp.correction_owner_impact_resources(p_book text,p_voucher text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_resources jsonb;
BEGIN
  WITH affected_records AS (
    -- A newly registered source is a blocker before any posted-effect capture.
    SELECT r.id FROM openerp.owner_records r JOIN openerp.events source_event
      ON source_event.book_id=r.book_id AND source_event.evidence_id=r.evidence_id AND source_event.event_key=r.locator
      JOIN openerp.vouchers posted_voucher ON posted_voucher.book_id=source_event.book_id AND posted_voucher.event_id=source_event.id
      WHERE r.book_id=p_book AND posted_voucher.id=p_voucher
    UNION
    SELECT posted_effect.record_id FROM openerp.owner_effects posted_effect
      WHERE posted_effect.book_id=p_book AND posted_effect.voucher_id=p_voucher
    UNION
    -- A posted, attached proposal remains provenance even before effect capture.
    SELECT proposal_link.record_id FROM openerp.owner_proposal_links proposal_link JOIN openerp.vouchers posted_voucher
      ON posted_voucher.book_id=proposal_link.book_id AND posted_voucher.change_set_id=proposal_link.change_set_id
      WHERE proposal_link.book_id=p_book AND posted_voucher.id=p_voucher
  ), dependencies AS (
    SELECT source_record.id,openerp.digest(jsonb_build_object(
      'source',to_jsonb(source_record),
      'currentRevision',(SELECT to_jsonb(record_revision) FROM openerp.owner_revisions record_revision
        WHERE record_revision.book_id=p_book AND record_revision.record_id=source_record.id AND record_revision.revision=source_record.current_revision),
      'currentReview',(SELECT to_jsonb(record_review) FROM openerp.owner_reviews record_review
        WHERE record_review.book_id=p_book AND record_review.record_id=source_record.id AND record_review.revision=source_record.current_revision),
      'proposalLinks',(SELECT coalesce(jsonb_agg(to_jsonb(proposal_link) ORDER BY proposal_link.id COLLATE "C"),'[]')
        FROM openerp.owner_proposal_links proposal_link WHERE proposal_link.book_id=p_book AND proposal_link.record_id=source_record.id),
      'effects',(SELECT coalesce(jsonb_agg(to_jsonb(posted_effect) ORDER BY posted_effect.id COLLATE "C"),'[]')
        FROM openerp.owner_effects posted_effect WHERE posted_effect.book_id=p_book AND posted_effect.record_id=source_record.id),
      'allocationLegs',(SELECT coalesce(jsonb_agg(to_jsonb(allocation_leg) ORDER BY allocation_leg.receipt_id COLLATE "C",allocation_leg.ordinal),'[]')
        FROM openerp.owner_allocation_legs allocation_leg WHERE allocation_leg.book_id=p_book AND EXISTS(
          SELECT FROM openerp.owner_effects posted_effect WHERE posted_effect.book_id=p_book AND posted_effect.record_id=source_record.id
            AND posted_effect.id IN(allocation_leg.claim_id,allocation_leg.settlement_id)))
    )) digest
    FROM openerp.owner_records source_record JOIN affected_records affected_record ON affected_record.id=source_record.id WHERE source_record.book_id=p_book
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('kind','owner_record','id',impact_dependency.id,
    'detail','A registered owner source, posted effect or posted proposal is linked to this voucher. Owner-register correction/release is unavailable; generic correction is blocked.',
    'path','/owner-register/records/'||impact_dependency.id,'blocks',true,'dependencyDigest',impact_dependency.digest)
    ORDER BY impact_dependency.id COLLATE "C"),'[]') INTO ci_resources FROM dependencies impact_dependency;
  RETURN ci_resources;
END $$;
REVOKE ALL ON FUNCTION openerp.correction_owner_impact_resources(text,text) FROM PUBLIC,openerp_runtime;

CREATE OR REPLACE FUNCTION openerp.correction_impact_resources(p_book text,p_voucher text,p_date date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ci_resources jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.id,'detail',r.detail,'path',r.path,'blocks',r.blocks)
      ORDER BY r.kind,r.id,r.detail),'[]') INTO ci_resources FROM (
    SELECT 'bank_match' kind,m.statement_id id,'Retained bank match: row '||m.row_ordinal::text||', line '||m.line_id||'. Match supersession is unavailable.' detail,
      '/bank-statements/'||m.statement_id path,true blocks FROM openerp.bank_matches m WHERE m.book_id=p_book AND m.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',a.plan_id,'Applied bank allocation: row '||a.row_ordinal::text||', line '||a.line_id||'. Compensation is unavailable.',
      '/bank-allocation-plans/'||a.plan_id,true FROM openerp.bank_allocation_legs a WHERE a.book_id=p_book AND a.voucher_id=p_voucher
    UNION ALL SELECT 'bank_allocation',p.id,'Unexecuted bank allocation plan references this voucher. It must revalidate after any correction.',
      '/bank-allocation-plans/'||p.id,false FROM openerp.bank_allocation_plans p WHERE p.book_id=p_book
      AND NOT EXISTS(SELECT FROM openerp.bank_allocation_executions e WHERE e.book_id=p.book_id AND e.plan_id=p.id)
      AND EXISTS(SELECT FROM jsonb_array_elements(p.input->'legs') item(leg) WHERE leg->>'voucherId'=p_voucher)
    UNION ALL SELECT 'invoice',i.id,'Registered invoice recognition, line '||i.recognition_line_id||'. Use the commerce owner; generic release is unavailable.',
      '/commerce/invoices/'||i.id,true FROM openerp.commerce_invoices i WHERE i.book_id=p_book AND i.recognition_voucher_id=p_voucher
    UNION ALL SELECT 'payment_allocation',a.receipt_id,'Applied invoice payment, invoice '||a.invoice_id||', line '||a.payment_line_id||'. Allocation compensation is unavailable.',
      '/commerce/invoices/'||a.invoice_id,true FROM openerp.commerce_allocation_legs a WHERE a.book_id=p_book AND a.payment_voucher_id=p_voucher
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
  -- Keep the original resource shape unchanged when no owner record is affected.
  -- The enclosing basis comparison binds these digests at seal/approve/execute.
  SELECT coalesce(jsonb_agg(resource ORDER BY resource->>'kind',resource->>'id',resource->>'detail'),'[]') INTO ci_resources
    FROM jsonb_array_elements(ci_resources||openerp.correction_owner_impact_resources(p_book,p_voucher)) item(resource);
  IF jsonb_array_length(ci_resources)>1000 THEN PERFORM openerp.fail('UnsupportedProfile','This impact exceeds1000 retained relationships. No partial impact is returned.'); END IF;
  RETURN ci_resources;
END $$;
REVOKE ALL ON FUNCTION openerp.correction_impact_resources(text,text,date) FROM PUBLIC,openerp_runtime;
