CREATE OR REPLACE FUNCTION openerp.inspect_action(book text, action jsonb) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, openerp AS $$
DECLARE b openerp.books; p openerp.periods; y openerp.fiscal_years; account openerp.accounts;
  line jsonb; original jsonb; original_line jsonb; debit numeric := 0; credit numeric := 0;
  posting_date date; reference jsonb; i integer := 0; ids text[] := '{}';
BEGIN
  SELECT * INTO STRICT b FROM openerp.books WHERE id = book;
  IF b.authority <> 'native' THEN PERFORM openerp.fail('StaleDependency', 'This book is not assigned to the native writer.'); END IF;
  IF b.profile <> 'synthetic-core-v1' THEN
    PERFORM openerp.fail('UnsupportedProfile', 'Only the explicit synthetic manual journal profile is currently implemented.');
  END IF;
  IF action->>'kind' <> 'post_voucher' OR action->>'taxAssessment' IS DISTINCT FROM 'not_applicable'
    OR action->>'currency' IS DISTINCT FROM b.currency
    OR coalesce(length(action->>'description'), 0) NOT BETWEEN 1 AND 2000
    OR coalesce(length(action->>'rationale'), 0) NOT BETWEEN 1 AND 2000
    OR coalesce(action->>'series', '') !~ '^[A-Z0-9]{1,16}$'
    OR jsonb_typeof(action->'lines') IS DISTINCT FROM 'array'
    OR jsonb_typeof(action->'evidenceRefs') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting intent is incomplete or unsupported.');
  END IF;
  IF jsonb_array_length(action->'lines') NOT BETWEEN 2 AND 500 OR jsonb_array_length(action->'evidenceRefs') < 1 THEN
    PERFORM openerp.fail('InvalidJournal', 'Provide evidence and between 2 and 500 journal lines.');
  END IF;
  BEGIN
    posting_date := (action->>'postingDate')::date;
    IF to_char(posting_date, 'YYYY-MM-DD') IS DISTINCT FROM action->>'postingDate' THEN RAISE invalid_datetime_format; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting date is not a valid calendar date.');
  END;
  SELECT * INTO p FROM openerp.periods WHERE book_id = book AND id = action->>'accountingPeriodId';
  IF NOT FOUND THEN PERFORM openerp.fail('InvalidJournal', 'The accounting period does not belong to this book.'); END IF;
  SELECT * INTO STRICT y FROM openerp.fiscal_years WHERE book_id = book AND id = p.fiscal_year_id;
  IF action->>'fiscalYearId' IS DISTINCT FROM p.fiscal_year_id OR posting_date IS NULL
    OR posting_date NOT BETWEEN p.starts_on AND p.ends_on OR posting_date NOT BETWEEN y.starts_on AND y.ends_on
    OR p.starts_on < y.starts_on OR p.ends_on > y.ends_on THEN
    PERFORM openerp.fail('InvalidJournal', 'The posting date, accounting period and fiscal year must agree.');
  END IF;
  IF p.locked THEN PERFORM openerp.fail('PeriodLocked', 'The period is locked. Use an open correction period or the authorized reopen workflow.'); END IF;
  IF action->>'postingPurpose' = 'reversal' THEN
    SELECT v.action INTO original FROM openerp.vouchers v WHERE v.book_id = book AND v.id = inspect_action.action->>'correctsVoucherId';
    IF original IS NULL OR original->>'postingPurpose' = 'reversal' THEN
      PERFORM openerp.fail('InvalidJournal', 'Choose an original voucher to reverse.');
    END IF;
    IF jsonb_array_length(action->'lines') <> jsonb_array_length(original->'lines')
      OR action->>'eventId' IS DISTINCT FROM original->>'eventId'
      OR action->'evidenceRefs' IS DISTINCT FROM original->'evidenceRefs'
      OR action->>'occurrenceKey' IS DISTINCT FROM action->>'correctsVoucherId' THEN
      PERFORM openerp.fail('InvalidJournal', 'A reversal must preserve the original evidence, event and complete line set.');
    END IF;
  ELSIF action->>'postingPurpose' IS DISTINCT FROM 'adjustment' OR action->>'correctsVoucherId' IS NOT NULL
    OR action->>'occurrenceKey' IS DISTINCT FROM 'manual_journal' THEN
    PERFORM openerp.fail('InvalidJournal', 'Unsupported posting purpose.');
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(action->'lines') LOOP
    IF coalesce(line->>'debitMinor', '') !~ '^(0|[1-9][0-9]{0,37})$'
      OR coalesce(line->>'creditMinor', '') !~ '^(0|[1-9][0-9]{0,37})$'
      OR coalesce(line->>'lineId', '') !~ '^[a-z][a-z0-9_-]{2,127}$'
      OR coalesce(length(line->>'description'), 0) NOT BETWEEN 1 AND 2000 THEN
      PERFORM openerp.fail('InvalidJournal', 'Each line needs exact nonnegative integer minor units and a description.');
    END IF;
    IF line->>'lineId' = ANY(ids) THEN PERFORM openerp.fail('InvalidJournal', 'Line identifiers must be unique.'); END IF;
    ids := array_append(ids, line->>'lineId');
    IF NOT (((line->>'debitMinor')::numeric > 0 AND (line->>'creditMinor')::numeric = 0)
      OR ((line->>'creditMinor')::numeric > 0 AND (line->>'debitMinor')::numeric = 0)) THEN
      PERFORM openerp.fail('InvalidJournal', 'Exactly one side of each line must be positive.');
    END IF;
    SELECT * INTO account FROM openerp.accounts WHERE book_id = book AND id = line->>'accountId';
    IF NOT FOUND OR (NOT account.active AND original IS NULL) THEN
      PERFORM openerp.fail('InvalidJournal', 'An account is unavailable or does not belong to this book.');
    END IF;
    IF original IS NOT NULL THEN
      original_line := original->'lines'->i;
      IF (line->>'accountId', line->>'debitMinor', line->>'creditMinor') IS DISTINCT FROM
        (original_line->>'accountId', original_line->>'creditMinor', original_line->>'debitMinor') THEN
        PERFORM openerp.fail('InvalidJournal', 'A reversal must use the original accounts and exactly opposite amounts.');
      END IF;
    END IF;
    debit := debit + (line->>'debitMinor')::numeric;
    credit := credit + (line->>'creditMinor')::numeric;
    i := i + 1;
  END LOOP;
  IF debit <> credit OR debit <= 0 THEN PERFORM openerp.fail('InvalidJournal', 'Debits and credits must balance exactly and be nonzero.'); END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(action->'evidenceRefs') LOOP
    IF NOT EXISTS (SELECT FROM openerp.evidence WHERE book_id = book AND id = reference->>'evidenceId' AND sha256 = reference->>'sha256') THEN
      PERFORM openerp.fail('MissingEvidence', 'An evidence reference is missing or its content hash differs.');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM openerp.events WHERE book_id = book AND id = action->>'eventId') THEN
    PERFORM openerp.fail('InvalidJournal', 'The business event does not belong to this book.');
  END IF;
END $$;

