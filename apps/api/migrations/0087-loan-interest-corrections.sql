ALTER TABLE openerp.treasury_loan_events
  ALTER COLUMN interest_minor TYPE numeric;
ALTER TABLE openerp.treasury_loan_events
  ADD CONSTRAINT treasury_loan_interest_exact
  CHECK (interest_minor = trunc(interest_minor) AND abs(interest_minor) < 1e38::numeric
    AND (kind = 'accrual' OR interest_minor >= 0));
