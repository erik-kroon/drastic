-- Recovery reads use retained kernel history. They never approve, retry or post.
CREATE INDEX posting_recovery_change_order ON openerp.change_sets(book_id, created_at DESC, id DESC);
CREATE INDEX posting_recovery_command_change ON openerp.command_receipts
  (book_id, (coalesce(result->>'changeSetId',result->>'id')), recorded_at DESC, key DESC)
  WHERE operation IN ('prepare_journal','prepare_correction','validate_change','approve_change','execute_change');

-- Corrections owns the later replacement of this gate for grouped child proposals.
CREATE FUNCTION openerp.posting_recovery_standalone(book text, id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, openerp AS $$ SELECT true $$;

CREATE FUNCTION openerp.posting_recovery_summary(book text, proposal openerp.change_sets) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
DECLARE pr_action jsonb; pr_receipt jsonb; pr_posted_id text;
BEGIN
  pr_action := proposal.plan->'groups'->0->'actions'->0;
  SELECT e.body,e.change_set_id INTO pr_receipt,pr_posted_id
    FROM openerp.vouchers v JOIN openerp.execution_receipts e ON e.book_id=v.book_id AND e.voucher_id=v.id
    WHERE v.book_id=book AND (v.change_set_id=proposal.id OR
      (v.event_id=pr_action->>'eventId' AND v.posting_purpose=pr_action->>'postingPurpose'
        AND v.occurrence_key=pr_action->>'occurrenceKey') OR
      (pr_action->>'postingPurpose'='reversal' AND v.corrects_voucher_id=pr_action->>'correctsVoucherId'))
    ORDER BY (v.change_set_id=proposal.id) DESC,v.sequence LIMIT 1;
  RETURN jsonb_build_object('changeSetId',proposal.id,'planDigest',proposal.digest,
    'createdAt',to_char(proposal.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'createdBy',proposal.created_by,'description',pr_action->>'description',
    'postingStatus',CASE WHEN pr_receipt IS NULL THEN 'unposted_at_check'
      WHEN pr_posted_id=proposal.id THEN 'posted' ELSE 'posted_by_other_proposal' END,
    'executionReceipt',pr_receipt);
END $$;

CREATE FUNCTION openerp.list_posting_recovery(token text, scope jsonb, after_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE pr_actor text; pr_anchor openerp.change_sets; pr_items jsonb; pr_next text; pr_checked text; pr_sequence text;
BEGIN
  pr_actor := openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  IF after_id IS NOT NULL THEN
    SELECT * INTO pr_anchor FROM openerp.change_sets c WHERE c.book_id=scope->>'bookId' AND c.id=after_id;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The recovery continuation does not belong to this book.'); END IF;
  END IF;
  SELECT b.committed_sequence::text INTO pr_sequence FROM openerp.books b WHERE b.id=scope->>'bookId';
  pr_checked := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  WITH candidates AS (
    SELECT c.* FROM openerp.change_sets c WHERE c.book_id=scope->>'bookId'
      AND openerp.posting_recovery_standalone(c.book_id,c.id)
      AND (after_id IS NULL OR (c.created_at,c.id)<(pr_anchor.created_at,pr_anchor.id))
    ORDER BY c.created_at DESC,c.id DESC LIMIT 21
  ), page AS (SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT 20)
  SELECT coalesce(jsonb_agg(openerp.posting_recovery_summary(scope->>'bookId',ROW(p.book_id,p.id,p.plan,p.digest,p.created_by,p.created_at)::openerp.change_sets) ORDER BY p.created_at DESC,p.id DESC),'[]'),
    CASE WHEN (SELECT count(*) FROM candidates)>20 THEN (SELECT id FROM page ORDER BY created_at,id LIMIT 1) ELSE NULL END
    INTO pr_items,pr_next FROM page p;
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',scope->>'entityId','bookId',scope->>'bookId'),
    'actorId',pr_actor,'checkedAt',pr_checked,'sequence',pr_sequence,'items',pr_items,'next',pr_next);
END $$;

CREATE FUNCTION openerp.get_posting_recovery(token text, scope jsonb, id text, after_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE pr_actor text; pr_proposal openerp.change_sets; pr_anchor openerp.command_receipts;
  pr_approval jsonb; pr_requests jsonb; pr_next text; pr_validation jsonb; pr_error text; pr_message text;
  pr_checked timestamptz; pr_sequence text;
BEGIN
  pr_actor := openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO pr_proposal FROM openerp.change_sets c WHERE c.book_id=scope->>'bookId' AND c.id=get_posting_recovery.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained proposal was not found in this book.'); END IF;
  IF NOT openerp.posting_recovery_standalone(pr_proposal.book_id,pr_proposal.id) THEN
    PERFORM openerp.fail('UnsupportedProfile','This proposal belongs to an atomic correction bundle. Review and recover the whole bundle instead.'); END IF;
  IF after_key IS NOT NULL THEN
    SELECT * INTO pr_anchor FROM openerp.command_receipts r WHERE r.book_id=scope->>'bookId' AND r.key=after_key
      AND r.operation IN ('prepare_journal','prepare_correction','validate_change','approve_change','execute_change')
      AND coalesce(r.result->>'changeSetId',r.result->>'id')=get_posting_recovery.id;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The request continuation does not belong to this proposal.'); END IF;
  END IF;
  pr_checked := clock_timestamp();
  SELECT b.committed_sequence::text INTO pr_sequence FROM openerp.books b WHERE b.id=scope->>'bookId';
  -- This is live diagnostic information, not a new validation receipt or authority grant.
  BEGIN
    PERFORM openerp.check_dependencies(scope,pr_proposal.plan);
    pr_validation := jsonb_build_object('status','current','blocker',NULL);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS pr_error=PG_EXCEPTION_DETAIL,pr_message=MESSAGE_TEXT;
    IF pr_error NOT IN ('StaleDependency','PeriodLocked','UnsupportedProfile','InvalidJournal','MissingEvidence') THEN RAISE; END IF;
    pr_validation := jsonb_build_object('status','blocked','blocker',jsonb_build_object('code',pr_error,'message',pr_message));
  END;
  SELECT jsonb_build_object('id',a.id,'changeSetId',a.change_set_id,'planDigest',a.digest,'actorId',a.actor_id,
    'expiresAt',to_char(a.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) INTO pr_approval
    FROM openerp.approvals a JOIN openerp.memberships m ON m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator'
    WHERE a.book_id=scope->>'bookId' AND a.change_set_id=get_posting_recovery.id AND a.digest=pr_proposal.digest
      AND a.consumed_at IS NULL AND a.expires_at>pr_checked
    ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
  WITH candidates AS (
    SELECT r.* FROM openerp.command_receipts r WHERE r.book_id=scope->>'bookId'
      AND r.operation IN ('prepare_journal','prepare_correction','validate_change','approve_change','execute_change')
      AND coalesce(r.result->>'changeSetId',r.result->>'id')=get_posting_recovery.id
      AND (after_key IS NULL OR (r.recorded_at,r.key)<(pr_anchor.recorded_at,pr_anchor.key))
    ORDER BY r.recorded_at DESC,r.key DESC LIMIT 21
  ), page AS (SELECT * FROM candidates ORDER BY recorded_at DESC,key DESC LIMIT 20)
  SELECT coalesce(jsonb_agg(jsonb_build_object('key',r.key,'operation',r.operation,'actorId',r.actor_id,
      'requestDigest',r.request_digest,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'resultId',r.result->>'id','planDigest',r.result->>'planDigest',
      'approvalState',CASE WHEN r.operation<>'approve_change' THEN NULL
        WHEN a.consumed_at IS NOT NULL THEN 'consumed'
        WHEN a.expires_at<=pr_checked THEN 'expired'
        WHEN NOT EXISTS(SELECT FROM openerp.memberships m WHERE m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator') THEN 'authority_lost'
        ELSE 'unconsumed_at_check' END)
      ORDER BY r.recorded_at DESC,r.key DESC),'[]'),
    CASE WHEN (SELECT count(*) FROM candidates)>20 THEN (SELECT key FROM page ORDER BY recorded_at,key LIMIT 1) ELSE NULL END
    INTO pr_requests,pr_next FROM page r LEFT JOIN openerp.approvals a
      ON r.operation='approve_change' AND a.book_id=r.book_id AND a.id=r.result->>'id';
  RETURN jsonb_build_object('scope',jsonb_build_object('entityId',scope->>'entityId','bookId',scope->>'bookId'),
    'actorId',pr_actor,'checkedAt',to_char(pr_checked AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sequence',pr_sequence,'summary',openerp.posting_recovery_summary(scope->>'bookId',pr_proposal),
    'plan',pr_proposal.plan,'validation',pr_validation,'availableApproval',pr_approval,
    'requests',pr_requests,'nextRequest',pr_next);
END $$;

CREATE FUNCTION openerp.recover_posting_request(token text, scope jsonb, key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, openerp AS $$
DECLARE pr_actor text; pr_receipt openerp.command_receipts; pr_result jsonb;
BEGIN
  pr_actor := openerp.authorize(token,scope);
  IF key IS NULL OR key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    PERFORM openerp.fail('IdempotencyConflict','Supply the original request key.'); END IF;
  PERFORM 1 FROM openerp.books b WHERE b.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO pr_receipt FROM openerp.command_receipts r WHERE r.book_id=scope->>'bookId' AND r.key=recover_posting_request.key
    AND r.operation IN ('prepare_journal','prepare_correction','validate_change','approve_change','execute_change');
  IF FOUND THEN
    pr_result := jsonb_build_object('state','committed','operation',pr_receipt.operation,'actorId',pr_receipt.actor_id,
      'requestDigest',pr_receipt.request_digest,'result',pr_receipt.result,
      'recordedAt',to_char(pr_receipt.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'sameActor',pr_receipt.actor_id=pr_actor);
  ELSE
    -- A late request can still arrive after this check; absence is not a failed command.
    pr_result := jsonb_build_object('state','not_observed','operation',NULL,'actorId',NULL,
      'requestDigest',NULL,'result',NULL,'recordedAt',NULL,'sameActor',NULL);
  END IF;
  RETURN pr_result||jsonb_build_object('scope',jsonb_build_object('entityId',scope->>'entityId','bookId',scope->>'bookId'),
    'key',key,'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;

REVOKE ALL ON FUNCTION openerp.posting_recovery_standalone(text,text),openerp.posting_recovery_summary(text,openerp.change_sets),
  openerp.list_posting_recovery(text,jsonb,text),openerp.get_posting_recovery(text,jsonb,text,text),
  openerp.recover_posting_request(text,jsonb,text) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.list_posting_recovery(text,jsonb,text),
  openerp.get_posting_recovery(text,jsonb,text,text),openerp.recover_posting_request(text,jsonb,text) TO openerp_runtime;
