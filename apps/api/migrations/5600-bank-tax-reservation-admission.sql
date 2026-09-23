-- Mirror4100's exact physical reservation rule at bank admission/currentness/discovery.
-- Do not reinterpret bank allocation sums, residuals, reconciliation or unmatch capacity.
CREATE OR REPLACE FUNCTION openerp.bank_allocation_snapshot(book text, input jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,openerp AS $$
DECLARE ba_leg jsonb; ba_source openerp.bank_observations; ba_statement openerp.bank_statements;
  ba_line openerp.journal_lines; ba_posted date; ba_source_used numeric; ba_line_used numeric;
  ba_amount numeric; ba_caps jsonb:='[]'; ba_group record; ba_candidates integer; ba_versions jsonb;
BEGIN
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Provide an allocation plan object.'); END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN ('accountId','reason','ambiguityAcknowledged','legs'))
    OR coalesce(input->>'accountId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR coalesce(length(input->>'reason'),0) NOT BETWEEN 1 AND 2000
    OR input->'ambiguityAcknowledged' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'legs') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Choose explicit allocation legs, record your reason, and acknowledge that candidate matches can be ambiguous.');
  END IF;
  IF jsonb_array_length(input->'legs') NOT BETWEEN 1 AND 100 THEN PERFORM openerp.fail('InvalidJournal','Use 1–100 explicit allocation legs.'); END IF;
  FOR ba_leg IN SELECT value FROM jsonb_array_elements(input->'legs') LOOP
    IF jsonb_typeof(ba_leg) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Each allocation leg must be an object.'); END IF;
    IF EXISTS(SELECT FROM jsonb_object_keys(ba_leg) k WHERE k NOT IN ('statementId','rowOrdinal','voucherId','lineId','amountMinor'))
      OR coalesce(ba_leg->>'statementId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR coalesce(ba_leg->>'voucherId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR coalesce(ba_leg->>'lineId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR jsonb_typeof(ba_leg->'rowOrdinal') IS DISTINCT FROM 'number' OR coalesce(ba_leg->>'rowOrdinal','') !~ '^[1-9][0-9]{0,4}$'
      OR jsonb_typeof(ba_leg->'amountMinor') IS DISTINCT FROM 'string' OR coalesce(ba_leg->>'amountMinor','') !~ '^-?[1-9][0-9]{0,37}$' THEN
      PERFORM openerp.fail('InvalidJournal','Select retained source and posted line identities with a nonzero signed minor-unit amount.');
    END IF;
  END LOOP;
  PERFORM openerp.bank_match_open_periods(book,input->'legs');
  ba_versions:=openerp.bank_allocation_versions(book,input->>'accountId');
  FOR ba_leg IN SELECT value FROM jsonb_array_elements(input->'legs') LOOP
    ba_amount:=(ba_leg->>'amountMinor')::numeric;
    SELECT * INTO ba_source FROM openerp.bank_observations o WHERE o.book_id=book
      AND o.statement_id=ba_leg->>'statementId' AND o.row_ordinal=(ba_leg->>'rowOrdinal')::integer;
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained observation was not found in this book.'); END IF;
    SELECT * INTO STRICT ba_statement FROM openerp.bank_statements s WHERE s.book_id=book AND s.id=ba_source.statement_id;
    SELECT * INTO ba_line FROM openerp.journal_lines l WHERE l.book_id=book AND l.voucher_id=ba_leg->>'voucherId' AND l.id=ba_leg->>'lineId';
    IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The posted line was not found in this book.'); END IF;
    IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c
      WHERE c.book_id=book AND c.voucher_id=ba_line.voucher_id AND c.line_id=ba_line.id) THEN
      PERFORM openerp.fail('StaleDependency','Explicitly unmatch the tax-account review before another register consumes this whole posted line.'); END IF;
    SELECT v.posting_date INTO STRICT ba_posted FROM openerp.vouchers v WHERE v.book_id=book AND v.id=ba_line.voucher_id;
    IF EXISTS(SELECT FROM openerp.vouchers v WHERE v.book_id=book AND v.id=ba_line.voucher_id
      AND (v.posting_purpose='reversal' OR EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=book AND r.corrects_voucher_id=v.id))) THEN
      PERFORM openerp.fail('StaleDependency','A reversed or reversing voucher cannot acquire bank matching capacity.'); END IF;
    IF ba_statement.account_id<>input->>'accountId' OR ba_line.account_id<>ba_statement.account_id
      OR ba_posted NOT BETWEEN ba_statement.starts_on AND ba_statement.ends_on
      OR sign(ba_amount)<>sign(ba_source.amount_minor) OR sign(ba_amount)<>sign(ba_line.debit_minor-ba_line.credit_minor) THEN
      PERFORM openerp.fail('InvalidJournal','Allocate the same bank account and sign within the whole retained statement interval; timing and opposite-sign netting are unsupported.');
    END IF;
    ba_source_used:=openerp.bank_allocated_source(book,ba_source.statement_id,ba_source.row_ordinal);
    ba_line_used:=openerp.bank_allocated_line(book,ba_line.voucher_id,ba_line.id);
    SELECT count(*) INTO ba_candidates FROM (SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v
      ON (v.book_id,v.id)=(l.book_id,l.voucher_id) WHERE l.book_id=book AND l.account_id=ba_statement.account_id
      AND v.posting_date BETWEEN ba_statement.starts_on AND ba_statement.ends_on
      AND sign(l.debit_minor-l.credit_minor)=sign(ba_source.amount_minor)
      AND abs(l.debit_minor-l.credit_minor)>abs(openerp.bank_allocated_line(book,l.voucher_id,l.id)) LIMIT 1001) candidates;
    IF ba_candidates>1000 THEN PERFORM openerp.fail('InvalidJournal','More than 1000 candidate lines require a larger-scope review workflow, which is not implemented.'); END IF;
    ba_caps:=ba_caps||jsonb_build_array(jsonb_build_object('leg',ba_leg,
      'sourceAmountMinor',ba_source.amount_minor::text,'sourceAllocatedMinor',ba_source_used::text,
      'lineAmountMinor',(ba_line.debit_minor-ba_line.credit_minor)::text,'lineAllocatedMinor',ba_line_used::text,
      'evidenceId',ba_statement.evidence_id,'evidenceSha256',(SELECT e.sha256 FROM openerp.evidence e WHERE e.book_id=book AND e.id=ba_statement.evidence_id),
      'providerId',ba_source.provider_id,'sourceBankAccountId',ba_source.source_bank_account_id,
      'observedOn',ba_source.observed_on::text,'postedOn',ba_posted::text,'candidateCount',ba_candidates));
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(input->'legs') l GROUP BY l->>'statementId',l->>'rowOrdinal',l->>'voucherId',l->>'lineId' HAVING count(*)>1) THEN
    PERFORM openerp.fail('InvalidJournal','A source/line pair repeats. Use one exact amount per pair.');
  END IF;
  FOR ba_group IN SELECT c->'leg'->>'statementId' statement_id,c->'leg'->>'rowOrdinal' ordinal,
    sum((c->'leg'->>'amountMinor')::numeric) requested,max(abs((c->>'sourceAmountMinor')::numeric)) capacity,
    max(abs((c->>'sourceAllocatedMinor')::numeric)) used FROM jsonb_array_elements(ba_caps) c GROUP BY 1,2 LOOP
    IF abs(ba_group.requested)+ba_group.used>ba_group.capacity THEN PERFORM openerp.fail('InvalidJournal','The combined legs exceed a retained observation capacity.'); END IF;
  END LOOP;
  FOR ba_group IN SELECT c->'leg'->>'voucherId' voucher_id,c->'leg'->>'lineId' line_id,
    sum((c->'leg'->>'amountMinor')::numeric) requested,max(abs((c->>'lineAmountMinor')::numeric)) capacity,
    max(abs((c->>'lineAllocatedMinor')::numeric)) used FROM jsonb_array_elements(ba_caps) c GROUP BY 1,2 LOOP
    IF abs(ba_group.requested)+ba_group.used>ba_group.capacity THEN PERFORM openerp.fail('InvalidJournal','The combined legs exceed a posted bank-line capacity.'); END IF;
  END LOOP;
  RETURN jsonb_build_object('versions',ba_versions,'capacities',ba_caps);
END $$;

CREATE OR REPLACE FUNCTION openerp.bank_allocation_checked(book text, id text, input jsonb, executing boolean) RETURNS openerp.bank_allocation_plans
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE ba_plan openerp.bank_allocation_plans;
BEGIN
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM openerp.fail('InvalidJournal','Provide an exact plan digest and version.'); END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN ('digest','version') AND (NOT executing OR k<>'approvalId'))
    OR input->'version' IS DISTINCT FROM '1'::jsonb THEN PERFORM openerp.fail('InvalidJournal','Use the exact versioned allocation command.'); END IF;
  SELECT * INTO ba_plan FROM openerp.bank_allocation_plans p WHERE p.book_id=book AND p.id=bank_allocation_checked.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank allocation plan was not found in this book.'); END IF;
  IF input->>'digest' IS DISTINCT FROM ba_plan.body->>'digest' THEN PERFORM openerp.fail('StaleDependency','Review the exact saved allocation plan digest.'); END IF;
  PERFORM openerp.bank_require_profile(book);
  PERFORM openerp.bank_match_open_periods(book,ba_plan.input->'legs');
  IF EXISTS(SELECT FROM jsonb_array_elements(ba_plan.input->'legs') leg
    JOIN openerp.tax_account_match_capacity c ON c.book_id=book
      AND c.voucher_id=leg->>'voucherId' AND c.line_id=leg->>'lineId') THEN
    PERFORM openerp.fail('StaleDependency','Explicitly unmatch the tax-account review before another register consumes this whole posted line.'); END IF;
  IF openerp.bank_allocation_versions(book,ba_plan.account_id) IS DISTINCT FROM ba_plan.body->'snapshot'->'versions' THEN
    PERFORM openerp.fail('StaleDependency','Bank source, ledger capacity or configuration changed. Prepare and approve a new allocation plan.');
  END IF;
  RETURN ba_plan;
END $$;

CREATE OR REPLACE FUNCTION openerp.get_bank_allocation(token text, scope jsonb, id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE ba_plan openerp.bank_allocation_plans; ba_approval jsonb; ba_execution jsonb; ba_current boolean;
BEGIN
  PERFORM openerp.authorize(token,scope);
  PERFORM 1 FROM openerp.books WHERE books.id=scope->>'bookId' FOR SHARE;
  SELECT * INTO ba_plan FROM openerp.bank_allocation_plans p WHERE p.book_id=scope->>'bookId' AND p.id=get_bank_allocation.id;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The bank allocation plan was not found in this book.'); END IF;
  SELECT a.body INTO ba_approval FROM openerp.bank_allocation_approvals a JOIN openerp.memberships m
    ON m.book_id=a.book_id AND m.actor_id=a.actor_id AND m.role='operator'
    WHERE a.book_id=ba_plan.book_id AND a.plan_id=get_bank_allocation.id AND a.expires_at>clock_timestamp() ORDER BY a.expires_at DESC,a.id DESC LIMIT 1;
  SELECT e.body INTO ba_execution FROM openerp.bank_allocation_executions e WHERE e.book_id=ba_plan.book_id AND e.plan_id=get_bank_allocation.id;
  BEGIN ba_current:=openerp.bank_allocation_versions(ba_plan.book_id,ba_plan.account_id)=ba_plan.body->'snapshot'->'versions'
    AND NOT EXISTS(SELECT FROM jsonb_array_elements(ba_plan.input->'legs') leg
      JOIN openerp.tax_account_match_capacity c ON c.book_id=ba_plan.book_id
        AND c.voucher_id=leg->>'voucherId' AND c.line_id=leg->>'lineId');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN ba_current:=false; END;
  RETURN jsonb_build_object('plan',ba_plan.body,'approval',ba_approval,'execution',ba_execution,'dependenciesCurrent',ba_current,
    'unmatch',(SELECT jsonb_build_object('planId',r.plan_id,'executedAt',r.body->>'executedAt','reason',r.body->>'reason')
      FROM openerp.bank_match_reversals r WHERE r.book_id=ba_plan.book_id AND r.allocation_plan_id=ba_plan.id));
END $$;

CREATE OR REPLACE FUNCTION openerp.discover_bank_match_candidates(p_token text,p_scope jsonb,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE c_book openerp.books; c_statement openerp.bank_statements; c_source openerp.bank_observations;
  c_account openerp.accounts; c_used numeric; c_remaining numeric; c_period_state text;
  c_currency_ok boolean; c_line_currency_ok boolean; c_source_blocks text[]:='{}'; c_blocks text[]; c_line record;
  c_line_used numeric; c_line_remaining numeric; c_history boolean; c_citation boolean; c_exact boolean;
  c_rows jsonb:='[]'; c_body jsonb; c_digest text; c_period_digest text; c_count integer;
  c_eligible integer; c_equal integer; c_reasons text[]; c_periods jsonb;
BEGIN
  PERFORM openerp.authorize(p_token,p_scope);
  SELECT * INTO STRICT c_book FROM openerp.books b WHERE b.id=p_scope->>'bookId' FOR SHARE;
  PERFORM openerp.bank_require_profile(c_book.id);
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    PERFORM openerp.fail('InvalidJournal','Select a retained statement and source row.'); END IF;
  IF p_input-ARRAY['statementId','rowOrdinal','previousDigest']<>'{}'::jsonb
    OR jsonb_typeof(p_input->'statementId') IS DISTINCT FROM 'string'
    OR coalesce(p_input->>'statementId','') !~ '^[a-z][a-z0-9_-]{2,127}$'
    OR jsonb_typeof(p_input->'rowOrdinal') IS DISTINCT FROM 'number'
    OR coalesce(p_input->>'rowOrdinal','') !~ '^[1-9][0-9]{0,4}$'
    OR (p_input?'previousDigest' AND (jsonb_typeof(p_input->'previousDigest') IS DISTINCT FROM 'string'
      OR coalesce(p_input->>'previousDigest','') !~ '^sha256:[a-f0-9]{64}$')) THEN
    PERFORM openerp.fail('InvalidJournal','Use valid retained source identifiers and an optional prior discovery digest.'); END IF;
  IF (p_input->>'rowOrdinal')::integer>10000 THEN
    PERFORM openerp.fail('InvalidJournal','The source row ordinal must be between 1 and 10000.'); END IF;
  SELECT * INTO c_statement FROM openerp.bank_statements s
    WHERE s.book_id=c_book.id AND s.id=p_input->>'statementId';
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained statement was not found in this book.'); END IF;
  SELECT * INTO c_source FROM openerp.bank_observations o WHERE o.book_id=c_book.id
    AND o.statement_id=c_statement.id AND o.row_ordinal=(p_input->>'rowOrdinal')::integer;
  IF NOT FOUND THEN PERFORM openerp.fail('NotFound','The retained source row was not found in this book.'); END IF;
  SELECT count(*) INTO c_count FROM (SELECT 1 FROM openerp.periods p WHERE p.book_id=c_book.id LIMIT 1001) bounded;
  IF c_count>1000 THEN PERFORM openerp.fail('UnsupportedProfile','Candidate discovery supports at most 1000 book periods. No partial result was returned.'); END IF;
  PERFORM 1 FROM openerp.periods p WHERE p.book_id=c_book.id ORDER BY p.id FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version::text,
    'startsOn',p.starts_on::text,'endsOn',p.ends_on::text,'locked',p.locked) ORDER BY p.id),'[]')
    INTO c_periods FROM openerp.periods p WHERE p.book_id=c_book.id;
  c_period_digest:=openerp.digest(c_periods);
  SELECT * INTO STRICT c_account FROM openerp.accounts a
    WHERE a.book_id=c_book.id AND a.id=c_statement.account_id FOR SHARE;
  c_used:=openerp.bank_allocated_source(c_book.id,c_statement.id,c_source.row_ordinal);
  IF abs(c_used)>abs(c_source.amount_minor) OR (c_used<>0 AND sign(c_used)<>sign(c_source.amount_minor)) THEN
    PERFORM openerp.fail('InvalidJournal','Retained source capacity is inconsistent; review its relationship history.'); END IF;
  c_remaining:=c_source.amount_minor-c_used;
  c_period_state:=openerp.bank_candidate_period_state(c_book.id,c_source.observed_on);
  c_currency_ok:=(c_statement.source->>'currency') IS NOT DISTINCT FROM c_book.currency;
  IF NOT c_account.active THEN c_source_blocks:=array_append(c_source_blocks,'account_inactive'); END IF;
  IF NOT c_currency_ok THEN c_source_blocks:=array_append(c_source_blocks,'currency_mismatch'); END IF;
  IF c_remaining=0 THEN c_source_blocks:=array_append(c_source_blocks,'source_no_capacity'); END IF;
  IF c_period_state<>'open' THEN c_source_blocks:=array_append(c_source_blocks,'source_period_'||c_period_state); END IF;

  -- Include all mapped-account lines in the supported statement interval, not merely plausible ones.
  SELECT count(*) INTO c_count FROM (SELECT 1 FROM openerp.journal_lines l JOIN openerp.vouchers v
    ON (v.book_id,v.id)=(l.book_id,l.voucher_id) WHERE l.book_id=c_book.id AND l.account_id=c_statement.account_id
    AND v.posting_date BETWEEN c_statement.starts_on AND c_statement.ends_on
    AND v.sequence<=c_book.committed_sequence LIMIT 1001) bounded;
  IF c_count>1000 THEN PERFORM openerp.fail('UnsupportedProfile','More than 1000 posted lines fall in this statement/account scope. A larger-scope review is required; no candidates were omitted.'); END IF;
  FOR c_line IN SELECT l.*,v.posting_date,v.sequence,v.posting_purpose,v.action,
    EXISTS(SELECT FROM openerp.vouchers r WHERE r.book_id=v.book_id AND r.corrects_voucher_id=v.id) AS reversed
    FROM openerp.journal_lines l JOIN openerp.vouchers v ON (v.book_id,v.id)=(l.book_id,l.voucher_id)
    WHERE l.book_id=c_book.id AND l.account_id=c_statement.account_id
      AND v.posting_date BETWEEN c_statement.starts_on AND c_statement.ends_on AND v.sequence<=c_book.committed_sequence
    ORDER BY v.id,l.id
  LOOP
    c_line_used:=openerp.bank_allocated_line(c_book.id,c_line.voucher_id,c_line.id);
    IF abs(c_line_used)>abs(c_line.debit_minor-c_line.credit_minor)
      OR (c_line_used<>0 AND sign(c_line_used)<>sign(c_line.debit_minor-c_line.credit_minor)) THEN
      PERFORM openerp.fail('InvalidJournal','Posted line capacity is inconsistent; review its relationship history.'); END IF;
    c_line_remaining:=c_line.debit_minor-c_line.credit_minor-c_line_used;
    c_blocks:=c_source_blocks;
    c_line_currency_ok:=c_currency_ok AND (c_line.action->>'currency') IS NOT DISTINCT FROM c_book.currency;
    IF c_currency_ok AND NOT c_line_currency_ok THEN c_blocks:=array_append(c_blocks,'currency_mismatch'); END IF;
    IF sign(c_line.debit_minor-c_line.credit_minor)<>sign(c_source.amount_minor) THEN
      c_blocks:=array_append(c_blocks,'opposite_sign'); END IF;
    IF c_line_remaining=0 THEN c_blocks:=array_append(c_blocks,'line_no_capacity'); END IF;
    IF EXISTS(SELECT FROM openerp.tax_account_match_capacity c
      WHERE c.book_id=c_book.id AND c.voucher_id=c_line.voucher_id AND c.line_id=c_line.id) THEN
      c_blocks:=array_append(c_blocks,'tax_account_reserved'); END IF;
    IF c_line.posting_purpose='reversal' THEN c_blocks:=array_append(c_blocks,'reversing_voucher'); END IF;
    IF c_line.reversed THEN c_blocks:=array_append(c_blocks,'reversed_voucher'); END IF;
    c_period_state:=openerp.bank_candidate_period_state(c_book.id,c_line.posting_date);
    IF c_period_state<>'open' THEN c_blocks:=array_append(c_blocks,'posting_period_'||c_period_state); END IF;
    c_history:=EXISTS(SELECT FROM openerp.bank_matches m WHERE m.book_id=c_book.id AND m.statement_id=c_statement.id
      AND m.row_ordinal=c_source.row_ordinal AND m.voucher_id=c_line.voucher_id AND m.line_id=c_line.id)
      OR EXISTS(SELECT FROM openerp.bank_allocation_legs a WHERE a.book_id=c_book.id AND a.statement_id=c_statement.id
        AND a.row_ordinal=c_source.row_ordinal AND a.voucher_id=c_line.voucher_id AND a.line_id=c_line.id);
    c_citation:=EXISTS(SELECT FROM jsonb_array_elements(c_line.action->'evidenceRefs') ref
      WHERE ref->>'evidenceId'=c_statement.evidence_id);
    c_exact:=c_remaining<>0 AND c_line_remaining=c_remaining;
    c_reasons:='{}';
    IF c_history THEN c_reasons:=array_append(c_reasons,'retained_relationship_history'); END IF;
    IF c_citation THEN c_reasons:=array_append(c_reasons,'statement_evidence_cited'); END IF;
    IF c_exact THEN c_reasons:=array_append(c_reasons,'equal_remaining_amount'); END IF;
    c_reasons:=c_reasons||ARRAY['amount_proximity_heuristic','date_proximity_heuristic'];
    c_rows:=c_rows||jsonb_build_array(jsonb_build_object('voucherId',c_line.voucher_id,'lineId',c_line.id,
      'accountId',c_line.account_id,'postedOn',c_line.posting_date::text,'sequence',c_line.sequence::text,
      'description',c_line.description,'amountMinor',(c_line.debit_minor-c_line.credit_minor)::text,
      'allocatedMinor',c_line_used::text,'remainingMinor',c_line_remaining::text,
      'eligible',cardinality(c_blocks)=0,'blockedReasons',to_jsonb(c_blocks),
      'sameAccount',true,'sameCurrency',c_line_currency_ok,
      'sameSign',sign(c_line.debit_minor-c_line.credit_minor)=sign(c_source.amount_minor),
      'retainedRelationship',c_history,'statementEvidenceCited',c_citation,'equalRemainingAmount',c_exact,
      'amountDistanceMinor',abs(abs(c_line_remaining)-abs(c_remaining))::text,
      'dayDistance',abs(c_line.posting_date-c_source.observed_on),'rankingReasons',to_jsonb(c_reasons)));
  END LOOP;
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'eligible')::boolean DESC,
      (item->>'retainedRelationship')::boolean DESC,(item->>'statementEvidenceCited')::boolean DESC,
      (item->>'equalRemainingAmount')::boolean DESC,(item->>'amountDistanceMinor')::numeric,
      (item->>'dayDistance')::integer,item->>'voucherId',item->>'lineId'),'[]'),
    count(*) FILTER(WHERE (item->>'eligible')::boolean),
    count(*) FILTER(WHERE (item->>'eligible')::boolean AND (item->>'equalRemainingAmount')::boolean)
    INTO c_rows,c_eligible,c_equal FROM jsonb_array_elements(c_rows) item;
  c_body:=jsonb_build_object('version','bank_match_candidates_v1',
    'scope',jsonb_build_object('entityId',c_book.entity_id,'bookId',c_book.id),
    'currency',c_book.currency,'currencyScale',c_book.currency_scale,
    'window',jsonb_build_object('accountId',c_statement.account_id,'startsOn',c_statement.starts_on::text,
      'endsOn',c_statement.ends_on::text,'lineLimit',1000,'completeWithinScope',true),
    'cutoff',jsonb_build_object('committedSequence',c_book.committed_sequence::text,
      'sourceRevision',(SELECT revision::text FROM openerp.bank_sources s WHERE s.book_id=c_book.id AND s.account_id=c_statement.account_id),
      'accountVersion',c_account.version::text,'profileVersion',c_book.profile_version::text,
      'writerEpoch',c_book.writer_epoch::text,'periodDigest',c_period_digest),
    'source',jsonb_build_object('statementId',c_statement.id,'rowOrdinal',c_source.row_ordinal,
      'evidenceId',c_statement.evidence_id,'evidenceSha256',(SELECT e.sha256 FROM openerp.evidence e WHERE e.book_id=c_book.id AND e.id=c_statement.evidence_id),
      'sourceBankAccountId',c_source.source_bank_account_id,'providerId',c_source.provider_id,
      'observedOn',c_source.observed_on::text,'description',c_source.description,
      'amountMinor',c_source.amount_minor::text,'allocatedMinor',c_used::text,'remainingMinor',c_remaining::text,
      'eligible',cardinality(c_source_blocks)=0,'blockedReasons',to_jsonb(c_source_blocks)),
    'candidates',c_rows,'eligibleCount',c_eligible,'equalAmountEligibleCount',c_equal,
    'multipleEligibleCandidates',c_eligible>1,'identityEstablished',false,
    'providerReferenceComparison','unavailable','rankingPolicy','retained_then_amount_date_v1',
    'coverage','not_established');
  c_digest:=openerp.digest(c_body);
  RETURN c_body||jsonb_build_object('digest',c_digest,'previousDigestMatches',
    CASE WHEN p_input?'previousDigest' THEN (p_input->>'previousDigest')=c_digest ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION openerp.bank_allocation_snapshot(text,jsonb),
  openerp.bank_allocation_checked(text,text,jsonb,boolean) FROM PUBLIC,openerp_runtime;
REVOKE ALL ON FUNCTION openerp.get_bank_allocation(text,jsonb,text),
  openerp.discover_bank_match_candidates(text,jsonb,jsonb) FROM PUBLIC,openerp_runtime;
GRANT EXECUTE ON FUNCTION openerp.get_bank_allocation(text,jsonb,text),
  openerp.discover_bank_match_candidates(text,jsonb,jsonb) TO openerp_runtime;
