-- Factual live tax-match references on retained schedule basis lines. No eligibility or role policy.
CREATE OR REPLACE FUNCTION openerp.get_schedule(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE sl_current jsonb; sl_revisions jsonb; sl_states jsonb; sl_recognized numeric; sl_disposal jsonb; sl_tax_matches jsonb;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  sl_current:=openerp.subledger_current(scope->>'bookId',id);
  SELECT jsonb_agg(r.body ORDER BY r.revision) INTO sl_revisions FROM openerp.subledger_schedule_revisions r
    WHERE r.book_id=scope->>'bookId' AND r.schedule_id=id;
  sl_states:=openerp.subledger_occurrence_states(scope->>'bookId',sl_current,'9999-12-31'::date);
  SELECT coalesce(sum((value->>'amountMinor')::numeric),0) INTO sl_recognized
    FROM jsonb_array_elements(sl_states) WHERE value->>'state'='posted';
  SELECT d.body INTO sl_disposal FROM openerp.subledger_disposals d WHERE d.book_id=scope->>'bookId' AND d.schedule_id=get_schedule.id;
  -- Public live references only; retain even a reservation whose match is no longer usable.
  IF (SELECT count(*) FROM (SELECT 1 FROM openerp.subledger_basis_lines l
    WHERE l.book_id=scope->>'bookId' AND l.schedule_id=get_schedule.id LIMIT 21) bounded)>20 THEN
    PERFORM openerp.fail('UnsupportedProfile','This schedule exceeds20 retained basis lines. No partial references are returned.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('voucherId',l.voucher_id,'lineId',l.line_id,
    'matchId',m.id,'eventId',m.event_id,'matchDigest',m.body->>'digest')
    ORDER BY l.voucher_id COLLATE "C",l.line_id COLLATE "C",m.id COLLATE "C"),'[]') INTO sl_tax_matches
    FROM openerp.subledger_basis_lines l
    JOIN openerp.tax_account_match_capacity c ON c.book_id=l.book_id AND c.voucher_id=l.voucher_id AND c.line_id=l.line_id
    JOIN openerp.tax_account_matches m ON m.book_id=c.book_id AND m.id=c.match_id
      AND m.event_id=c.event_id AND m.voucher_id=c.voucher_id AND m.line_id=c.line_id
    WHERE l.book_id=scope->>'bookId' AND l.schedule_id=get_schedule.id;
  RETURN jsonb_build_object('basisTaxMatches',jsonb_build_object('roleCompatibility','not_assessed','matches',sl_tax_matches),
    'disposal',sl_disposal,'current',sl_current,'revisions',sl_revisions,'occurrences',sl_states,
    'recognizedMinor',sl_recognized::text,'remainingMinor',CASE WHEN sl_disposal IS NOT NULL THEN '0' ELSE ((sl_current->'terms'->>'costMinor')::numeric-sl_recognized)::text END,
    'revisionAllowed',NOT EXISTS(SELECT FROM openerp.subledger_bases b WHERE b.book_id=scope->>'bookId' AND b.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.subledger_preparations p WHERE p.book_id=scope->>'bookId' AND p.schedule_id=id)
      AND NOT EXISTS(SELECT FROM openerp.events e WHERE e.book_id=scope->>'bookId' AND e.evidence_id=sl_current->'terms'->>'evidenceId'
        AND e.event_key IN(SELECT value->>'eventKey' FROM jsonb_array_elements(sl_current->'occurrences')))
      AND (sl_current->>'revision')::integer<20,
    'controlAccountReconciled',false,'requiresPostingApproval',true,
    'postingBasis',openerp.subledger_posting_basis(scope->>'bookId',id));
END $$;
